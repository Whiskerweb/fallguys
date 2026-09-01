/**
 * LES RETRAITS — le seul endroit du systeme ou un bug se solde par un double paiement.
 *
 * Tout le reste se rattrape : un depot manque se relit, un classement faux se corrige, un
 * pot mal solde se voit dans l'invariant. Une transaction Solana envoyee deux fois, non.
 * Ce fichier est donc ecrit pour cette seule crainte.
 *
 * Trois regles, dans l'ordre ou elles comptent :
 *
 *   1. ON DEBITE AVANT D'ENVOYER. Si l'on envoyait d'abord, un arret entre l'envoi et le
 *      debit laisserait le joueur paye ET credite. Dans l'autre sens, un arret laisse
 *      l'argent immobilise mais jamais perdu — et une reprise le retrouve.
 *
 *   2. ON ENREGISTRE LA SIGNATURE AVANT DE DIFFUSER. Sur Solana, la signature est connue
 *      des que la transaction est signee, avant meme d'etre envoyee. On l'ecrit donc en
 *      base d'abord. Sans cela, un arret au mauvais moment laisse une transaction peut-etre
 *      partie, dont on ne connait pas le nom — et rien ne permet plus de savoir si elle a
 *      abouti.
 *
 *   3. ON NE RE-SIGNE JAMAIS SANS AVOIR RELU LA CHAINE. Et pas seulement « la transaction
 *      est-elle confirmee ? » : une transaction non confirmee peut encore l'etre tant que
 *      son blockhash est valide. Il faut donc que le blockhash soit EXPIRE avant de
 *      considerer qu'elle ne partira jamais. C'est la seule verification qui autorise a
 *      recommencer.
 */

import { randomUUID } from 'node:crypto';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { poster, compte, solde, verrouillerJoueur } from '../livre.js';
import { config } from '../config.js';
import { connexion, mint, caisse, DECIMALES_USDC } from './chaine.js';
import { ecrire } from '../argent.js';

/**
 * Enregistre une demande de retrait, et RESERVE les fonds immediatement.
 *
 * Le debit a lieu ici, pas a l'envoi : entre la demande et la diffusion, le joueur ne doit
 * plus pouvoir miser cet argent. Sans cette reserve, il demande un retrait de tout son
 * solde, joue une partie pendant que la transaction se prepare, et la caisse paie deux fois.
 */
export async function demander(db, { userId, montant }) {
  return db.transaction(async (tx) => {
    await verrouillerJoueur(tx, userId);

    const p = (await tx.query(
      `select wallet, wallet_lie_le from public.profiles where id = $1`, [userId],
    )).rows[0];
    if (!p) throw refus('COMPTE_INCONNU', 'compte introuvable');

    /*
     * La destination est TOUJOURS le wallet lie, jamais une adresse fournie par
     * l'appelant. C'est la protection la plus efficace du fichier : un compte vole ne
     * peut pas rediriger les fonds, parce qu'il n'y a aucun parametre a detourner.
     */
    if (!p.wallet) throw refus('WALLET_ABSENT', 'aucun wallet lie a ce compte');

    if (montant < config.retraitMinimum) {
      throw refus('SOUS_LE_MINIMUM',
        `retrait minimum ${ecrire(config.retraitMinimum)} USDC`);
    }

    /*
     * Delai sur le PREMIER retrait, compte depuis la liaison du wallet.
     *
     * Ancre sur la liaison et non sur la creation du compte, ce qui donne au passage une
     * seconde propriete : changer d'adresse de paiement fait repartir le delai. Un compte
     * vole dont l'attaquant relie son propre wallet doit donc attendre un jour avant de
     * pouvoir sortir quoi que ce soit — le temps que le proprietaire s'en apercoive.
     */
    const dejaRetire = (await tx.query(
      `select 1 from public.withdrawals where user_id = $1 and statut = 'confirme' limit 1`,
      [userId],
    )).rows.length > 0;

    if (!dejaRetire) {
      const pret = (await tx.query(
        `select ($1::timestamptz + make_interval(hours => $2)) <= now() as pret`,
        [p.wallet_lie_le, config.delaiPremierRetraitHeures],
      )).rows[0]?.pret;
      if (!pret) {
        throw refus('DELAI_PREMIER_RETRAIT',
          `le premier retrait s'ouvre ${config.delaiPremierRetraitHeures} h apres la liaison du wallet`);
      }
    }

    const disponible = await solde(tx, compte.joueur(userId));
    if (disponible < montant) {
      throw refus('SOLDE_INSUFFISANT',
        `solde ${ecrire(disponible)} USDC, demande ${ecrire(montant)} USDC`);
    }

    const id = randomUUID();
    const mvt = await poster(tx, {
      genre: 'retrait',
      ref: id,
      metadata: { userId, destination: p.wallet, reseau: config.reseau },
      lignes: [
        { compte: compte.joueur(userId), montant: -montant },
        { compte: compte.sortie, montant: +montant },
      ],
    });

    await tx.query(
      `insert into public.withdrawals (id, user_id, amount_micros, destination, statut, tx_id)
       values ($1, $2, $3, $4, 'demande', $5)`,
      [id, userId, montant, p.wallet, mvt.id],
    );

    return { id, montant, destination: p.wallet, solde: disponible - montant };
  });
}

/**
 * Envoie un retrait demande. Reprend proprement un retrait laisse en plan.
 *
 * @returns {Promise<{id: string, statut: string, signature?: string}>}
 */
export async function executer(db, id) {
  const r = (await db.query('select * from public.withdrawals where id = $1', [id])).rows[0];
  if (!r) throw refus('RETRAIT_INCONNU', 'retrait introuvable');
  if (r.statut === 'confirme') return { id, statut: 'confirme', signature: r.signature };
  if (r.statut === 'echoue') return { id, statut: 'echoue' };

  const co = connexion();

  /*
   * REPRISE. Une signature deja enregistree veut dire qu'une transaction est peut-etre
   * partie. On interroge la chaine AVANT toute chose.
   */
  if (r.signature) {
    const etat = (await co.getSignatureStatuses([r.signature])).value[0];
    if (etat && !etat.err) {
      await clore(db, id, 'confirme');
      return { id, statut: 'confirme', signature: r.signature };
    }
    if (etat?.err) {
      // Elle a ete rejetee par la chaine : l'argent n'est pas parti, on rend au joueur.
      await rembourser(db, r, `transaction rejetee : ${JSON.stringify(etat.err)}`);
      return { id, statut: 'echoue' };
    }
    /*
     * Elle n'est pas sur la chaine. Cela ne suffit PAS a re-signer : tant que son
     * blockhash est valide, elle peut encore etre acceptee, et une seconde transaction
     * paierait alors deux fois. On ne recommence que si le blockhash a expire.
     */
    if (r.blockhash) {
      const encoreValide = await co.isBlockhashValid(r.blockhash, { commitment: 'confirmed' });
      if (encoreValide.value) {
        return { id, statut: 'soumis', signature: r.signature, attente: 'blockhash encore valide' };
      }
    }
    // Blockhash expire et rien sur la chaine : elle ne partira jamais. On peut re-signer.
  }

  const tresor = caisse();
  const m = mint();
  const source = await getAssociatedTokenAddress(m, tresor.publicKey, true);
  const proprietaire = new PublicKey(r.destination);
  const cible = await getAssociatedTokenAddress(m, proprietaire, true);

  const tx = new Transaction();
  try {
    await getAccount(co, cible);
  } catch {
    // Le wallet du joueur n'a jamais detenu d'USDC : il faut lui creer le compte, et la
    // caisse en avance la rente. Cout reel du premier retrait vers un wallet neuf.
    tx.add(createAssociatedTokenAccountInstruction(tresor.publicKey, cible, proprietaire, m));
  }
  tx.add(createTransferCheckedInstruction(
    source, m, cible, tresor.publicKey, Number(r.amount_micros), DECIMALES_USDC, [], TOKEN_PROGRAM_ID,
  ));

  const { blockhash, lastValidBlockHeight } = await co.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = tresor.publicKey;
  tx.sign(tresor);

  const signature = bs58.encode(tx.signature);

  /*
   * ON ECRIT LA SIGNATURE AVANT DE DIFFUSER. C'est l'ordre qui rend la reprise possible :
   * apres cette ligne, un arret brutal laisse en base de quoi savoir quoi chercher sur la
   * chaine. Avant elle, la transaction n'existe nulle part.
   */
  await db.query(
    `update public.withdrawals
        set statut = 'soumis', signature = $2, blockhash = $3, soumis_le = now()
      where id = $1`,
    [id, signature, blockhash],
  );

  try {
    await co.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
    await co.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    await clore(db, id, 'confirme');
    return { id, statut: 'confirme', signature };
  } catch (e) {
    /*
     * Un echec ici est AMBIGU : la transaction peut avoir ete acceptee malgre l'erreur
     * (une coupure reseau apres l'envoi ressemble a un envoi rate). On ne rembourse donc
     * PAS : on laisse le retrait en « soumis », et la reprise ci-dessus tranchera en
     * interrogeant la chaine. Rembourser sur un doute, c'est payer deux fois.
     */
    return { id, statut: 'soumis', signature, erreur: e.message };
  }
}

async function clore(db, id, statut) {
  await db.query(
    `update public.withdrawals set statut = $2, clos_le = now() where id = $1`, [id, statut],
  );
}

/** Annule un retrait et rend l'argent : le mouvement inverse, jamais une suppression. */
async function rembourser(db, r, raison) {
  await db.transaction(async (tx) => {
    await poster(tx, {
      genre: 'retrait_echoue',
      ref: r.id,
      metadata: { raison, signature: r.signature },
      lignes: [
        { compte: compte.sortie, montant: -Number(r.amount_micros) },
        { compte: compte.joueur(r.user_id), montant: +Number(r.amount_micros) },
      ],
    });
    await tx.query(
      `update public.withdrawals set statut = 'echoue', raison_echec = $2, clos_le = now()
        where id = $1`,
      [r.id, raison],
    );
  });
}

function refus(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
