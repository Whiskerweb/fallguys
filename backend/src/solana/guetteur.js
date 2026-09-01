/**
 * LE GUETTEUR — il regarde arriver les depots et les inscrit au grand livre.
 *
 * Boucle simple : pour chaque joueur, lire les transactions recues par son compte de
 * jetons, crediter celles qu'on n'a pas encore vues, puis balayer les fonds vers la
 * caisse.
 *
 * Deux proprietes non negociables :
 *
 *   1. IL REJOUE, et c'est normal. Un guetteur redemarre, relit des signatures deja
 *      traitees. Ce n'est pas un cas limite : c'est son fonctionnement ordinaire. La
 *      signature Solana est donc la cle primaire de `deposits` ET la cle d'idempotence du
 *      mouvement — deux barrieres tenues par la BASE, pas par la prudence de ce fichier.
 *
 *   2. IL EST SEUL. Deux guetteurs qui balaient la meme adresse produisent deux
 *      transactions concurrentes sur le meme solde. L'une echoue, mais l'etat intermediaire
 *      est desagreable a demeler. D'ou un processus unique — voir README.md, hebergement.
 *
 * Le CREDIT est independant du BALAYAGE : on credite le joueur des qu'on voit son depot,
 * meme si le balayage vers la caisse echoue. L'inverse — attendre le balayage pour
 * crediter — ferait dependre l'affichage du solde d'une transaction qui ne concerne pas
 * le joueur, et le laisserait sans son argent parce que la caisse manque de SOL.
 */

import { PublicKey } from '@solana/web3.js';
import { poster, compte } from '../livre.js';
import { config } from '../config.js';
import { cleDepot } from './adresses.js';
import { connexion, compteJetons, soldeJetons, envoyer, caisse } from './chaine.js';

/**
 * Lit les depots arrives sur l'adresse d'un joueur et les credite.
 *
 * @returns {Promise<Array<{signature: string, micros: number, deja: boolean}>>}
 */
export async function releverDepots(db, { userId, adresse }) {
  const co = connexion();
  const ata = await compteJetons(adresse);

  /*
   * On demande a la chaine les signatures RECENTES du compte, puis on ecarte celles
   * qu'on connait deja. On ne tient pas de curseur « derniere signature vue » : un
   * curseur qui derape saute des depots en silence, alors qu'une relecture de trop ne
   * coute qu'un appel RPC. Sur un jeu a mises, rater un depot est bien pire que le relire.
   */
  let signatures;
  try {
    signatures = await co.getSignaturesForAddress(new PublicKey(ata), { limit: 50 }, 'confirmed');
  } catch {
    return [];   // compte de jetons inexistant : ce joueur n'a jamais rien recu.
  }

  const vues = new Set(
    (await db.query('select signature from public.deposits where user_id = $1', [userId]))
      .rows.map((r) => r.signature),
  );

  const nouveaux = [];
  for (const { signature, err } of signatures.reverse()) {
    if (err) continue;              // transaction echouee sur la chaine : rien n'est arrive.
    if (vues.has(signature)) continue;

    const montant = await montantRecu(signature, ata.toBase58());
    if (montant <= 0) continue;     // une sortie, ou un mouvement d'un autre jeton.

    const r = await crediter(db, { userId, signature, micros: montant });
    nouveaux.push({ signature, micros: montant, deja: r.deja });
  }
  return nouveaux;
}

/**
 * Combien d'USDC cette transaction a-t-elle DEPOSE sur ce compte ?
 *
 * On le lit dans les soldes avant/apres que Solana attache a chaque transaction, plutot
 * que d'interpreter les instructions. C'est plus robuste : le montant recu est la
 * difference constatee, quel que soit le chemin — transfert simple, passage par un
 * programme, instruction interne d'un swap.
 */
async function montantRecu(signature, ata) {
  const tx = await connexion().getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
  if (!tx?.meta) return 0;

  const trouver = (liste) => liste?.find(
    (b) => b.mint === config.mintUsdc
      && tx.transaction.message.accountKeys[b.accountIndex]?.pubkey?.toBase58() === ata,
  );

  const avant = trouver(tx.meta.preTokenBalances)?.uiTokenAmount?.amount ?? '0';
  const apres = trouver(tx.meta.postTokenBalances)?.uiTokenAmount?.amount ?? '0';
  return Number(apres) - Number(avant);
}

/**
 * Inscrit un depot : la ligne `deposits` et le mouvement du livre, dans UNE transaction.
 *
 * Les deux ensemble ou aucun des deux. Separer les deux ecritures ouvrirait la fenetre ou
 * le depot est marque traite sans que le joueur ait ete credite — le seul etat dont on ne
 * se remet pas tout seul, puisque la relecture suivante le considererait comme deja vu.
 */
async function crediter(db, { userId, signature, micros }) {
  return db.transaction(async (tx) => {
    const r = await poster(tx, {
      genre: 'depot',
      ref: signature,          // idempotence : la chaine fournit la cle, la base la tient.
      metadata: { signature, userId, reseau: config.reseau },
      lignes: [
        { compte: compte.entree, montant: -micros },
        { compte: compte.joueur(userId), montant: +micros },
      ],
    });

    await tx.query(
      `insert into public.deposits (signature, user_id, amount_micros, credite_le, tx_id)
       values ($1, $2, $3, now(), $4)
       on conflict (signature) do nothing`,
      [signature, userId, micros, r.id],
    );

    return r;
  });
}

/**
 * Balaie une adresse de depot vers la caisse.
 *
 * PUREMENT ON-CHAIN : aucun mouvement de grand livre. Le joueur a deja ete credite au
 * moment ou son depot a ete vu ; deplacer les jetons de son adresse dediee vers la caisse
 * ne change rien a ce qu'il possede. Ecrire une ligne ici doublerait son solde.
 *
 * La caisse paie les frais : un compte de depot n'a pas de SOL et ne peut pas payer sa
 * propre sortie.
 */
export async function balayer(userId) {
  const cle = cleDepot(userId);
  const ata = await compteJetons(cle.publicKey.toBase58());
  const montant = await soldeJetons(ata);
  if (montant <= 0) return null;

  const tresor = caisse();
  const signature = await envoyer({
    payeur: tresor,
    proprietaire: cle,
    vers: tresor.publicKey.toBase58(),
    micros: montant,
  });
  return { signature, micros: montant };
}

/**
 * Un tour de guet sur tous les joueurs ayant une adresse de depot.
 *
 * Un tour est O(nombre de joueurs) en appels RPC. C'est sans importance sur devnet et
 * ca ne tiendra pas a l'echelle : le jour ou il y aura des milliers de comptes, il
 * faudra restreindre aux joueurs actifs recemment, ou passer aux abonnements WebSocket
 * du RPC. Ce n'est pas le probleme d'aujourd'hui, mais ce n'en sera un que d'un coup.
 */
export async function unTour(db) {
  const joueurs = await db.query(
    'select id, adresse_depot from public.profiles where adresse_depot is not null',
  );
  const bilan = [];
  for (const j of joueurs.rows) {
    const vus = await releverDepots(db, { userId: j.id, adresse: j.adresse_depot });
    for (const v of vus) if (!v.deja) bilan.push({ userId: j.id, ...v });
    if (vus.some((v) => !v.deja)) {
      try {
        await balayer(j.id);
      } catch (e) {
        // Un balayage rate n'est PAS grave : le joueur est deja credite, les jetons
        // restent sur son adresse dediee, et le prochain tour reessaiera. On le signale
        // sans interrompre le tour — un joueur en echec ne doit pas bloquer les autres.
        console.error(`balayage de ${j.id} : ${e.message}`);
      }
    }
  }
  return bilan;
}
