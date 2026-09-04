/**
 * LE GUETTEUR — il regarde arriver les depots et les inscrit au grand livre.
 *
 * Boucle simple : pour chaque joueur, lire les transactions recues par son wallet,
 * crediter celles qu'on n'a pas encore vues. C'est tout — depuis le 2 septembre 2026 ON
 * NE BALAIE PLUS : les USDC restent sur le wallet du joueur, qui est son compte de jeu.
 * Ses mises en partent, ses gains y reviennent, et n'importe qui peut relire son solde
 * sur un explorateur. Une caisse commune ou tout se melange, c'est un solde qu'il faut
 * croire ; un wallet par joueur, c'est un solde qu'on peut verifier.
 *
 * Deux proprietes non negociables :
 *
 *   1. IL REJOUE, et c'est normal. Un guetteur redemarre, relit des signatures deja
 *      traitees. La signature Solana est donc la cle primaire de `deposits` ET la cle
 *      d'idempotence du mouvement — deux barrieres tenues par la BASE.
 *
 *   2. IL DISTINGUE UN DEPOT D'UN RETOUR. Le wallet du joueur recoit aussi ses GAINS et
 *      ses mises RENDUES, envoyes par nous. Les crediter comme des depots doublerait son
 *      solde : ces signatures-la sont dans `chain_tx`, et on les ecarte.
 */

import { PublicKey } from '@solana/web3.js';
import { poster, compte } from '../livre.js';
import { config } from '../config.js';
import { connexion, compteDe } from './chaine.js';

/**
 * Lit les depots arrives sur l'adresse d'un joueur et les credite.
 *
 * @returns {Promise<Array<{signature: string, micros: number, deja: boolean}>>}
 */
export async function releverDepots(db, { userId, adresse }) {
  const co = connexion();
  const ata = await compteDe(adresse, 'usdc');

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
  // Nos propres envois vers ce wallet (gains, mises rendues) ne sont pas des depots.
  for (const r of (await db.query(
    `select signature from public.chain_tx where user_id = $1 and signature is not null`, [userId],
  )).rows) vues.add(r.signature);

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
  }
  return bilan;
}
