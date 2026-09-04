/**
 * LE LIEN AVEC SOLANA — et le JOURNAL de tout ce qu'on y envoie.
 *
 * Ce module ne connait aucune regle du jeu : il sait ouvrir une connexion, trouver un
 * compte de jetons, construire une transaction a partir d'une liste d'OPERATIONS
 * (virement, brulage, fermeture de compte), la signer, la diffuser, et surtout se
 * souvenir de ce qu'il a fait — parce que c'est la seule chose qui distingue « payer »
 * de « payer deux fois ».
 *
 * ─── LE JOURNAL (`chain_tx`) ────────────────────────────────────────────────
 *
 * Chaque operation a une ligne, clee par `(objet, ref)`, qui passe par quatre etats :
 *
 *   prevu ──► signe ──► confirme
 *                 └────► echoue
 *
 * La ligne est ecrite en `prevu` AVANT de construire quoi que ce soit ; la signature y
 * est ecrite AVANT la diffusion — c'est la regle apprise sur les retraits : sur Solana la
 * signature est connue des la signature, et l'ecrire d'abord est le seul moyen de savoir,
 * apres un arret brutal, quelle transaction est peut-etre partie. `reprendre()` relit ces
 * lignes-la et tranche en interrogeant la chaine, jamais en re-signant a l'aveugle.
 *
 * ─── UNE OPERATION PEUT ECHOUER DE DEUX FACONS, ET CE N'EST PAS LA MEME ───
 *
 *   - `ChaineEchouee` : la chaine a REFUSE, ou le blockhash a expire sans que la
 *     transaction ne soit vue. Rien n'est parti, c'est certain ; l'appelant peut defaire
 *     ce qu'il avait ecrit au grand livre ;
 *   - `ChaineIncertaine` : le reseau a coupe pendant la diffusion. La transaction est
 *     PEUT-ETRE passee. L'appelant ne doit RIEN defaire — c'est `reprendre()` qui le
 *     saura, plus tard, en relisant la chaine.
 *
 * Confondre les deux, c'est rembourser une mise qui est bel et bien partie.
 *
 * Le doublure de test, `factice.js`, offre la meme interface sur une chaine en memoire :
 * les tests du grand livre exercent les MEMES chemins de code, journal compris.
 */

import { randomUUID } from 'node:crypto';
import {
  Connection, PublicKey, Transaction, TransactionExpiredBlockheightExceededError,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, getAccount, getMint,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction,
  createBurnCheckedInstruction, createCloseAccountInstruction,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { config } from '../config.js';
import { tresorerie } from './tresorerie.js';

/** USDC et BG ont six decimales : la meme echelle que nos micros. */
export const DECIMALES = { usdc: 6, bg: 6 };

/** Au-dela, une transaction depasse les 1232 octets de Solana. Mesure a la main. */
export const VIREMENTS_PAR_TRANSACTION = 5;

export class ChaineEchouee extends Error {
  constructor(message, detail = {}) { super(message); this.code = 'CHAINE_ECHOUEE'; Object.assign(this, detail); }
}
export class ChaineIncertaine extends Error {
  constructor(message, detail = {}) { super(message); this.code = 'CHAINE_INCERTAINE'; Object.assign(this, detail); }
}

let _connexion = null;
export function connexion() {
  if (!_connexion) _connexion = new Connection(config.rpc, 'confirmed');
  return _connexion;
}

/** Le mint d'une devise, par son nom court. `bg` peut ne pas exister encore. */
export function mintDe(quoi) {
  if (quoi === 'usdc') return new PublicKey(config.mintUsdc);
  if (quoi === 'bg') {
    if (!config.mintBg) throw new Error('BG_MINT absent : lancez « node outils/jeton.mjs »');
    return new PublicKey(config.mintBg);
  }
  throw new Error(`devise inconnue « ${quoi} »`);
}

/*
 * USDC vit sous le programme Token classique ; BG sous Token-2022, qui porte ses
 * metadonnees lui-meme. Les instructions sont les memes, mais le programme change et
 * l'adresse du compte de jetons avec lui. On le lit une fois sur le compte du mint plutot
 * que de l'ecrire en dur : le jour ou USDC migre, rien ici ne change.
 */
const programmes = new Map();
export async function programmeDe(quoi) {
  if (programmes.has(quoi)) return programmes.get(quoi);
  const info = await connexion().getAccountInfo(mintDe(quoi));
  if (!info) throw new Error(`le mint ${quoi} (${mintDe(quoi).toBase58()}) n'existe pas sur ${config.reseau}`);
  const p = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  programmes.set(quoi, p);
  return p;
}

/** Le compte de jetons associe d'un proprietaire, pour une devise. */
export async function compteDe(proprietaire, quoi) {
  return getAssociatedTokenAddressSync(mintDe(quoi), new PublicKey(proprietaire), true, await programmeDe(quoi));
}

/** Solde en micros. `0` si le compte n'existe pas : c'est l'etat normal d'un compte neuf. */
export async function soldeJetons(proprietaire, quoi = 'usdc') {
  try {
    const c = await getAccount(connexion(), await compteDe(proprietaire, quoi), 'confirmed', await programmeDe(quoi));
    return Number(c.amount);
  } catch {
    return 0;
  }
}

/** L'offre en circulation d'un jeton, en micros. */
export async function offreDe(quoi) {
  const m = await getMint(connexion(), mintDe(quoi), 'confirmed', await programmeDe(quoi));
  return { offre: Number(m.supply), decimales: m.decimals, autoriteFrappe: m.mintAuthority?.toBase58() ?? null };
}

/** Un lien vers l'explorateur, pour les journaux et la page de suivi. */
export function lienExplorateur(signature, reseau = config.reseau) {
  const cluster = reseau === 'mainnet' || reseau === 'mainnet-beta' ? '' : `?cluster=${reseau}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}
export function lienAdresse(adresse, reseau = config.reseau) {
  const cluster = reseau === 'mainnet' || reseau === 'mainnet-beta' ? '' : `?cluster=${reseau}`;
  return `https://explorer.solana.com/address/${adresse}${cluster}`;
}

// ---------------------------------------------------------------- le journal

/**
 * Ouvre (ou retrouve) la ligne de journal de chaque operation.
 *
 * @returns {Promise<Array<{id: string, statut: string, signature: string|null}>>} dans
 *   l'ordre des operations
 */
export async function ouvrirJournal(db, operations) {
  const lignes = [];
  for (const op of operations) {
    if (!op.objet || !op.ref) throw new Error('operation sans objet ou sans ref : pas de journal, pas de transaction');
    await db.query(
      `insert into public.chain_tx (id, objet, ref, de, vers, mint, montant, partie, user_id, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (objet, ref) do nothing`,
      [randomUUID(), op.objet, op.ref,
        op.de?.publicKey?.toBase58?.() ?? op.proprietaire?.publicKey?.toBase58?.() ?? null,
        op.vers ?? op.versLamports ?? null,
        op.mint ?? null, op.montant ?? 0, op.partie ?? null, op.userId ?? null,
        JSON.stringify(op.metadata ?? {})],
    );
    const r = await db.query(
      `select id, statut, signature from public.chain_tx where objet = $1 and ref = $2`, [op.objet, op.ref],
    );
    lignes.push(r.rows[0]);
  }
  return lignes;
}

export async function marquer(db, ids, statut, { signature = null, blockhash = null, raison = null } = {}) {
  if (!ids.length) return;
  await db.query(
    `update public.chain_tx
        set statut = $2,
            signature = coalesce($3, signature),
            blockhash = coalesce($4, blockhash),
            raison_echec = coalesce($5, raison_echec),
            soumis_le = case when $2 = 'signe' then now() else soumis_le end,
            clos_le = case when $2 in ('confirme', 'echoue', 'inutile') then now() else clos_le end
      where id = any($1::uuid[])`,
    [ids, statut, signature, blockhash, raison],
  );
}

/**
 * Ouvre le journal et ne garde que ce qui reste a faire.
 *
 * Un lot peut melanger des operations deja confirmees (une annulation rejouee apres un
 * premier retour reussi) et des neuves : on n'envoie que les neuves. Rejouer une operation
 * confirmee, c'est payer deux fois — c'est exactement ce que le journal existe pour empecher.
 * Une operation en suspens (« signe ») bloque le lot : on ne re-signe pas par-dessus.
 */
export async function trier(db, operations) {
  const lignes = await ouvrirJournal(db, operations);
  const suspendues = lignes.filter((l) => l.statut === 'signe');
  if (suspendues.length) {
    throw new ChaineIncertaine('une transaction precedente est peut-etre partie ; reprise necessaire',
      { signature: suspendues[0].signature });
  }
  const restantes = operations.filter((_, i) => lignes[i].statut !== 'confirme');
  return { lignes, restantes };
}

// ---------------------------------------------------------------- la chaine

/**
 * La chaine REELLE.
 *
 * @param {object} p
 * @param {{query: Function}} p.db  pour le journal
 * @param {(evenement: object) => void} [p.surEvenement] prevenu a chaque confirmation —
 *   c'est par la que la page de suivi apprend qu'une transaction vient de passer
 */
export function creerChaine({ db, surEvenement = null }) {
  const co = connexion();

  async function instructionsDe(op, payeur) {
    const quoi = op.mint ?? 'usdc';
    const mint = mintDe(quoi);
    const programme = await programmeDe(quoi);
    const decimales = DECIMALES[quoi];
    const ixs = [];

    if (op.type === 'virement') {
      const source = getAssociatedTokenAddressSync(mint, op.de.publicKey, true, programme);
      const proprietaire = new PublicKey(op.vers);
      const cible = getAssociatedTokenAddressSync(mint, proprietaire, true, programme);
      // Le compte du destinataire n'existe peut-etre pas : la caisse en avance la rente.
      // « Idempotent » : si un autre virement du meme lot l'a deja cree, rien ne casse.
      let existe = true;
      try { await getAccount(co, cible, 'confirmed', programme); } catch { existe = false; }
      if (!existe) ixs.push(createAssociatedTokenAccountIdempotentInstruction(payeur.publicKey, cible, proprietaire, mint, programme));
      // « Checked » : le programme verifie le mint et les decimales. C'est ce qui empeche
      // d'envoyer 25 unites d'un jeton a 9 decimales en croyant en envoyer 25 a 6.
      ixs.push(createTransferCheckedInstruction(source, mint, cible, op.de.publicKey, op.montant, decimales, [], programme));
      return { ixs, signataire: op.de };
    }
    if (op.type === 'brulage') {
      const compte = getAssociatedTokenAddressSync(mint, op.de.publicKey, true, programme);
      ixs.push(createBurnCheckedInstruction(compte, mint, op.de.publicKey, op.montant, decimales, [], programme));
      return { ixs, signataire: op.de };
    }
    if (op.type === 'fermer_ata') {
      const compte = getAssociatedTokenAddressSync(mint, op.proprietaire.publicKey, true, programme);
      ixs.push(createCloseAccountInstruction(compte, new PublicKey(op.versLamports), op.proprietaire.publicKey, [], programme));
      return { ixs, signataire: op.proprietaire };
    }
    throw new Error(`operation inconnue « ${op.type} »`);
  }

  return {
    reelle: true,
    reseau: config.reseau,

    solde: (proprietaire, quoi = 'usdc') => soldeJetons(proprietaire, quoi),
    offre: (quoi) => offreDe(quoi),

    /**
     * Execute une liste d'operations dans UNE transaction — atomique, donc.
     *
     * @returns {Promise<{signature: string, deja: boolean}>}
     */
    async executer({ operations, payeur = tresorerie.caisse() }) {
      if (!operations.length) throw new Error('executer : aucune operation');
      const { lignes, restantes } = await trier(db, operations);
      if (!restantes.length) return { signature: lignes[0].signature, deja: true };
      operations = restantes;
      const ids = lignes.filter((l) => l.statut !== 'confirme').map((l) => l.id);

      const tx = new Transaction();
      const signataires = new Map([[payeur.publicKey.toBase58(), payeur]]);
      for (const op of operations) {
        const { ixs, signataire } = await instructionsDe(op, payeur);
        for (const ix of ixs) tx.add(ix);
        signataires.set(signataire.publicKey.toBase58(), signataire);
      }

      const { blockhash, lastValidBlockHeight } = await co.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = payeur.publicKey;
      tx.sign(...signataires.values());
      const signature = bs58.encode(tx.signature);

      // LA SIGNATURE D'ABORD, LA DIFFUSION ENSUITE.
      await marquer(db, ids, 'signe', { signature, blockhash });

      try {
        await co.sendRawTransaction(tx.serialize(), { maxRetries: 5, skipPreflight: false });
      } catch (e) {
        /*
         * Un refus a l'ENVOI (simulation ratee, solde insuffisant, compte inconnu) est
         * definitif : le RPC n'a pas transmis. On peut le dire, et l'appelant peut defaire.
         */
        await marquer(db, ids, 'echoue', { raison: e.message.slice(0, 500) });
        throw new ChaineEchouee(`refusee a l'envoi : ${e.message.slice(0, 200)}`, { signature });
      }

      let etat;
      try {
        etat = await co.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      } catch (e) {
        if (e instanceof TransactionExpiredBlockheightExceededError) {
          // Le blockhash a expire. Elle n'a pas ete vue... sauf si elle l'a ete entre-temps.
          const s = (await co.getSignatureStatuses([signature])).value[0];
          if (s && !s.err) { etat = { value: { err: null } }; }
          else {
            await marquer(db, ids, 'echoue', { raison: 'blockhash expire sans confirmation' });
            throw new ChaineEchouee('expiree sans etre vue', { signature });
          }
        } else {
          // Reseau coupe pendant l'attente : on ne SAIT PAS. On laisse en « signe ».
          throw new ChaineIncertaine(`confirmation interrompue : ${e.message.slice(0, 200)}`, { signature });
        }
      }

      if (etat.value.err) {
        await marquer(db, ids, 'echoue', { raison: JSON.stringify(etat.value.err).slice(0, 500) });
        throw new ChaineEchouee(`rejetee par la chaine : ${JSON.stringify(etat.value.err)}`, { signature });
      }

      await marquer(db, ids, 'confirme');
      surEvenement?.({ signature, operations: operations.map((o) => ({ objet: o.objet, ref: o.ref, montant: o.montant, mint: o.mint ?? 'usdc' })) });
      return { signature, deja: false };
    },

    /**
     * Tranche les lignes laissees en suspens par un arret, EN RELISANT LA CHAINE.
     *
     * @param {{echoue?: (ligne: object) => Promise<void>, confirme?: (ligne: object) => Promise<void>}} gestionnaires
     *   ce que le domaine fait d'une operation dont on apprend qu'elle a echoue (rendre une
     *   mise au grand livre, par exemple)
     */
    async reprendre(gestionnaires = {}) {
      const bilan = { confirmees: 0, echouees: 0, enAttente: 0 };
      const signees = await db.query(`select * from public.chain_tx where statut = 'signe' order by soumis_le`);
      const parSignature = new Map();
      for (const l of signees.rows) {
        if (!parSignature.has(l.signature)) parSignature.set(l.signature, []);
        parSignature.get(l.signature).push(l);
      }
      for (const [signature, lignes] of parSignature) {
        const ids = lignes.map((l) => l.id);
        const s = (await co.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
        if (s && !s.err) {
          await marquer(db, ids, 'confirme');
          bilan.confirmees += lignes.length;
          for (const l of lignes) await gestionnaires.confirme?.(l);
          continue;
        }
        if (s?.err) {
          await marquer(db, ids, 'echoue', { raison: JSON.stringify(s.err).slice(0, 500) });
          bilan.echouees += lignes.length;
          for (const l of lignes) await gestionnaires.echoue?.(l);
          continue;
        }
        // Pas vue. Tant que le blockhash vaut, elle peut encore passer : on attend.
        const valide = lignes[0].blockhash
          ? (await co.isBlockhashValid(lignes[0].blockhash, { commitment: 'confirmed' })).value
          : false;
        if (valide) { bilan.enAttente += lignes.length; continue; }
        await marquer(db, ids, 'echoue', { raison: 'jamais vue, blockhash expire' });
        bilan.echouees += lignes.length;
        for (const l of lignes) await gestionnaires.echoue?.(l);
      }

      // Prevues et jamais signees : le processus est tombe avant de construire quoi que ce
      // soit. Rien n'est parti ; on le dit au domaine, qui rend ce qu'il avait reserve.
      const orphelines = await db.query(
        `select * from public.chain_tx where statut = 'prevu' and cree_le < now() - interval '2 minutes'`,
      );
      for (const l of orphelines.rows) {
        await marquer(db, [l.id], 'echoue', { raison: 'jamais signee' });
        bilan.echouees++;
        await gestionnaires.echoue?.(l);
      }
      return bilan;
    },
  };
}
