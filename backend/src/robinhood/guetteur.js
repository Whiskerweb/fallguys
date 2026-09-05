/**
 * LE GUETTEUR — il regarde arriver les depots et les inscrit au grand livre.
 *
 * Boucle simple : lire les evenements `Transfer` du contrat USDC vers les wallets de nos
 * joueurs, crediter ceux qu'on n'a pas encore vus. C'est tout — ON NE BALAIE PAS : les
 * USDC restent sur le wallet du joueur, qui est son compte de jeu. Ses mises en partent,
 * ses gains y reviennent, et n'importe qui peut relire son solde sur l'explorateur.
 *
 * Deux proprietes non negociables :
 *
 *   1. IL REJOUE, et c'est normal. Un guetteur redemarre, relit des blocs deja traites.
 *      « hache de transaction # index du journal » est donc la cle primaire de `deposits`
 *      ET la cle d'idempotence du mouvement — deux barrieres tenues par la BASE.
 *
 *   2. IL DISTINGUE UN DEPOT D'UN RETOUR. Le wallet du joueur recoit aussi ses GAINS et
 *      ses mises RENDUES, envoyes par nous depuis un pot. Les crediter comme des depots
 *      doublerait son solde : ces transactions-la sont dans `chain_tx`, et on les ecarte.
 *      Une FRAPPE du robinet, elle, EST un depot (elle n'est journalisee pour personne).
 *
 * Le curseur : le tour de fond garde le dernier bloc lu (`chain_curseur`) et repart un
 * peu avant, parce qu'une relecture de trop ne coute qu'un appel RPC alors qu'un bloc
 * saute coute un depot. La verification manuelle d'un joueur (« CHECK DEPOSITS ») relit
 * une fenetre de blocs recents pour sa seule adresse.
 */

import { zeroPadValue, getAddress } from 'ethers';
import { poster, compte } from '../livre.js';
import { config } from '../config.js';
import { connexion, contratDe, SUJET_TRANSFERT } from './chaine.js';

/** Combien de blocs par requete `eth_getLogs` : les RPC publics plafonnent, on reste sage. */
const PAS = 2_000;
/** Le tour de fond repart ce nombre de blocs avant son curseur : une reorg ne lui fait rien. */
const MARGE = 30;
/** La verification manuelle d'un joueur remonte jusque-la. */
const FENETRE = 20_000;

/** Les evenements Transfer vers `adresses` (ou vers tout le monde) entre deux blocs. */
async function transferts(de, a, vers = null) {
  const co = connexion();
  const journaux = [];
  for (let debut = de; debut <= a; debut += PAS) {
    const fin = Math.min(a, debut + PAS - 1);
    const lot = await co.getLogs({
      address: contratDe('usdc'), fromBlock: debut, toBlock: fin,
      topics: [SUJET_TRANSFERT, null, vers ? zeroPadValue(vers, 32) : null],
    });
    for (const l of lot) {
      journaux.push({
        hache: l.transactionHash, index: l.index, bloc: l.blockNumber,
        de: getAddress('0x' + l.topics[1].slice(26)), vers: getAddress('0x' + l.topics[2].slice(26)),
        micros: Number(BigInt(l.data)),
      });
    }
  }
  return journaux;
}

/** Ce qui a deja ete vu ou envoye par nous : ni l'un ni l'autre n'est un depot. */
async function dejaConnus(db, userId) {
  const vus = new Set(
    (await db.query('select signature from public.deposits where user_id = $1', [userId])).rows.map((r) => r.signature),
  );
  const notres = new Set(
    (await db.query(`select signature from public.chain_tx where user_id = $1 and signature is not null`, [userId])).rows.map((r) => r.signature),
  );
  return { vus, notres };
}

/**
 * Lit les depots arrives sur l'adresse d'un joueur et les credite.
 *
 * @returns {Promise<Array<{signature: string, micros: number, deja: boolean}>>}
 */
export async function releverDepots(db, { userId, adresse }) {
  const co = connexion();
  const dernier = await co.getBlockNumber();
  let journaux;
  try {
    journaux = await transferts(Math.max(0, dernier - FENETRE), dernier, adresse);
  } catch {
    return [];   // RPC muet : on reessaiera, rien n'est perdu.
  }
  const { vus, notres } = await dejaConnus(db, userId);
  const nouveaux = [];
  for (const j of journaux) {
    const signature = `${j.hache}#${j.index}`;
    if (vus.has(signature) || notres.has(j.hache) || j.micros <= 0) continue;
    const r = await crediter(db, { userId, signature, micros: j.micros, bloc: j.bloc, expediteur: j.de });
    nouveaux.push({ signature, micros: j.micros, deja: r.deja });
  }
  return nouveaux;
}

/**
 * Inscrit un depot : la ligne `deposits` et le mouvement du livre, dans UNE transaction.
 *
 * Les deux ensemble ou aucun des deux. Separer les deux ecritures ouvrirait la fenetre ou
 * le depot est marque traite sans que le joueur ait ete credite — le seul etat dont on ne
 * se remet pas tout seul, puisque la relecture suivante le considererait comme deja vu.
 */
async function crediter(db, { userId, signature, micros, bloc, expediteur }) {
  return db.transaction(async (tx) => {
    const r = await poster(tx, {
      genre: 'depot',
      ref: signature,          // idempotence : la chaine fournit la cle, la base la tient.
      metadata: { signature, userId, reseau: config.reseau, expediteur },
      lignes: [
        { compte: compte.entree, montant: -micros },
        { compte: compte.joueur(userId), montant: +micros },
      ],
    });

    await tx.query(
      `insert into public.deposits (signature, user_id, amount_micros, bloc, expediteur, credite_le, tx_id)
       values ($1, $2, $3, $4, $5, now(), $6)
       on conflict (signature) do nothing`,
      [signature, userId, micros, bloc, expediteur, r.id],
    );

    return r;
  });
}

/**
 * Un tour de guet : tous les transferts USDC depuis le curseur, croises avec les adresses
 * de nos joueurs.
 *
 * Un tour coute O(blocs ecoules / PAS) appels RPC, quel que soit le nombre de joueurs :
 * c'est le contraire de l'ancienne version, qui interrogeait chaque adresse. Sur un
 * mainnet ou l'USDC circule beaucoup, chaque requete rend plus d'evenements, et un jour
 * il faudra un RPC paye avec un abonnement WebSocket — pas le probleme d'aujourd'hui.
 */
export async function unTour(db) {
  const co = connexion();
  const dernier = await co.getBlockNumber();
  const curseur = (await db.query(`select bloc from public.chain_curseur where nom = 'depots'`)).rows[0]?.bloc;
  const de = curseur === undefined ? Math.max(0, dernier - PAS) : Math.max(0, Number(curseur) - MARGE);
  if (de > dernier) return [];

  const joueurs = (await db.query('select id, adresse_depot from public.profiles where adresse_depot is not null')).rows;
  const parAdresse = new Map(joueurs.map((j) => [j.adresse_depot.toLowerCase(), j.id]));

  const journaux = await transferts(de, dernier);
  const bilan = [];
  const connus = new Map();
  for (const j of journaux) {
    const userId = parAdresse.get(j.vers.toLowerCase());
    if (!userId || j.micros <= 0) continue;
    if (!connus.has(userId)) connus.set(userId, await dejaConnus(db, userId));
    const { vus, notres } = connus.get(userId);
    const signature = `${j.hache}#${j.index}`;
    if (vus.has(signature) || notres.has(j.hache)) continue;
    const r = await crediter(db, { userId, signature, micros: j.micros, bloc: j.bloc, expediteur: j.de });
    vus.add(signature);
    if (!r.deja) bilan.push({ userId, signature, micros: j.micros });
  }
  await db.query(
    `insert into public.chain_curseur (nom, bloc, lu_le) values ('depots', $1, now())
     on conflict (nom) do update set bloc = excluded.bloc, lu_le = now()`, [dernier],
  );
  return bilan;
}
