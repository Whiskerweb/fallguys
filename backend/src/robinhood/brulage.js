/**
 * LE BRULAGE — les frais achetent des BG, et les BG sont detruits.
 *
 * C'est la promesse du jeton : le rake de chaque partie (10 % du pot en moyenne) n'est pas
 * garde, il sert a racheter des « Baby Guy » sur le marche, qui sont brules aussitot.
 * L'offre — un milliard a la creation, sans fonction de frappe — ne peut que baisser, et
 * chaque partie jouee la fait baisser un peu.
 *
 * ─── COMMENT ON ACHETE, ET POURQUOI C'EST DIFFERENT SUR LE TESTNET ─────────
 *
 * Sur mainnet, un rachat est un swap sur un vrai marche : une paire BG/USDG sur un DEX de
 * Robinhood Chain, atteinte par son routeur. Sur le testnet, ce marche n'existe pas pour
 * un jeton neuf, et il n'existera jamais tout seul. Le service tient donc LUI-MEME une
 * reserve de liquidite — le wallet POOL, avec des BG et des USDG — et applique la regle
 * des marches automatises, le PRODUIT CONSTANT : x · y = k. Pour `u` USDG qui entrent,
 * il en sort
 *
 *     bg = y · u / (x + u)        (x : USDG du pool, y : BG du pool)
 *
 * Le prix monte a chaque rachat, exactement comme sur un vrai AMM, et il se lit sur la
 * chaine : ce sont les soldes du pool qui le fixent, pas une constante du code.
 *
 * L'ACHAT ET LE BRULAGE SONT UNE SEULE TRANSACTION, atomique (contrat Lot) : les USDG
 * vont des frais au pool, et les BG achetes sont brules DEPUIS le pool — deux appels, un
 * seul bloc. Il n'existe aucun etat ou des BG achetes ne sont pas encore brules.
 *
 * Le jour du mainnet, `racheterEtBruler` change de corps (un appel au routeur du DEX a la
 * place du virement vers le pool) et rien d'autre ne bouge : le seuil, le journal, la
 * table `burns`, la page de suivi lisent la meme chose.
 */

import { randomUUID } from 'node:crypto';
import { poster, compte, mouvementExistant } from '../livre.js';
import { config } from '../config.js';
import { tresorerie } from './tresorerie.js';
import { ChaineEchouee, ChaineIncertaine } from './chaine.js';

/**
 * Combien de BG sortent du pool pour `usdgIn` USDG — produit constant, tronque vers le bas.
 *
 * Tout en entiers : `BigInt` pour le produit intermediaire, qui depasse 2^53 des que le
 * pool tient quelques millions de BG. Le resultat, lui, tient dans un entier sur.
 */
export function prixAchat(poolUsdg, poolBg, usdgIn) {
  if (poolUsdg < 0 || poolBg <= 0 || usdgIn <= 0) return 0;
  const bg = (BigInt(poolBg) * BigInt(usdgIn)) / (BigInt(poolUsdg) + BigInt(usdgIn));
  return Number(bg);
}

/** L'etat du marche, lu sur la chaine : ce que la page de suivi montre comme « prix ». */
export async function etatMarche(chaine) {
  const pool = tresorerie.pool().address;
  const frais = tresorerie.frais().address;
  const [poolUsdg, poolBg, fraisUsdg] = await Promise.all([
    chaine.solde(pool, 'usdg'), chaine.solde(pool, 'bg').catch(() => 0), chaine.solde(frais, 'usdg'),
  ]);
  let offre = null;
  try { offre = (await chaine.offre('bg')).offre; } catch { /* jeton pas encore cree */ }
  return {
    pool: { adresse: pool, usdg: poolUsdg, bg: poolBg },
    frais: { adresse: frais, usdg: fraisUsdg },
    /*
     * Le prix, dans le sens ou il se lit : COMBIEN DE BG POUR UN USDG (en micros de BG).
     * Un BG vaut une fraction de micro-USDG tant que le pool tient un milliard de BG pour
     * quelques centaines d'USDG ; l'exprimer « en USDG par BG » donnerait zero. Ce nombre
     * ne sert qu'a l'affichage — l'achat lui-meme passe par `prixAchat`, en entiers.
     */
    bgParUsdg: poolUsdg > 0 && poolBg > 0 ? Number((BigInt(poolBg) * 1_000_000n) / BigInt(poolUsdg)) : null,
    prixUsdgParBg: poolBg > 0 ? poolUsdg / poolBg : null,
    offre,
    seuil: config.brulageSeuil,
  };
}

/**
 * Un tour de brulage : si les frais atteignent le seuil, on achete et on brule.
 *
 * @returns {Promise<null | {id: string, usdg: number, bg: number, signature?: string, statut: string}>}
 */
export async function racheterEtBruler(db, chaine, { seuil = config.brulageSeuil } = {}) {
  if (!config.bgAdresse) return null;
  const frais = tresorerie.frais();
  const pool = tresorerie.pool();
  const usdg = await chaine.solde(frais.address, 'usdg');
  if (usdg < seuil) return null;

  const poolUsdg = await chaine.solde(pool.address, 'usdg');
  const poolBg = await chaine.solde(pool.address, 'bg');
  /*
   * UN POOL SANS USDG N'A PAS DE PRIX. Le produit constant avec x = 0 donne y · u / u = y :
   * TOUT le pool pour n'importe quelle somme. Un pool amorce en BG mais pas encore en USDG
   * ne doit donc jamais vendre — on attend qu'il soit dote, et la page de suivi le dit.
   */
  if (poolUsdg <= 0 || poolBg <= 0) return { statut: 'pool_non_amorce', usdg, bg: 0, poolUsdg, poolBg };
  const bg = prixAchat(poolUsdg, poolBg, usdg);
  if (bg <= 0) return { statut: 'pool_vide', usdg, bg: 0 };

  const id = randomUUID();

  // LE LIVRE D'ABORD : les USDG quittent les frais pour le pool.
  await db.transaction((tx) => poster(tx, {
    genre: 'rachat',
    ref: id,
    metadata: { usdg, bg, poolUsdg, poolBg, reseau: config.reseau },
    lignes: [
      { compte: compte.rake, montant: -usdg },
      { compte: compte.pool, montant: +usdg },
    ],
  }));

  try {
    const r = await chaine.executer({
      operations: [
        { type: 'virement', de: frais, vers: pool.address, mint: 'usdg', montant: usdg, objet: 'rachat', ref: `${id}:usdg` },
        { type: 'brulage', de: pool, mint: 'bg', montant: bg, objet: 'rachat', ref: `${id}:brulage` },
      ],
    });
    await consignerRachat(db, chaine, id, r.signature);
    return { id, usdg, bg, signature: r.signature, statut: 'brule' };
  } catch (e) {
    if (e instanceof ChaineEchouee) {
      await annulerRachat(db, id, e.message);
      return { id, usdg, bg, statut: 'echoue', raison: e.message };
    }
    if (e instanceof ChaineIncertaine) return { id, usdg, bg, signature: e.signature, statut: 'incertain' };
    throw e;
  }
}

/** Inscrit un rachat confirme dans `burns` — une fois, quelle que soit la voie qui l'apprend. */
export async function consignerRachat(db, chaine, id, signature) {
  const mvt = (await db.query(`select id, metadata from public.ledger_tx where genre = 'rachat' and ref = $1`, [id])).rows[0];
  if (!mvt) return;
  let supply = null;
  try { supply = (await chaine.offre('bg')).offre; } catch { /* pas grave */ }
  await db.query(
    `insert into public.burns (id, signature, usdg_micros, bg_micros, supply_apres, reseau, tx_id)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
    [id, signature, mvt.metadata.usdg, mvt.metadata.bg, supply, config.reseau, mvt.id],
  );
}

/** Defait un rachat dont la chaine dit qu'il n'a jamais eu lieu : le mouvement inverse. */
export async function annulerRachat(db, id, raison) {
  const mvt = (await db.query(`select metadata from public.ledger_tx where genre = 'rachat' and ref = $1`, [id])).rows[0];
  if (!mvt) return;
  await db.transaction(async (tx) => {
    if (await mouvementExistant(tx, 'rachat_echoue', id)) return;
    await poster(tx, {
      genre: 'rachat_echoue', ref: id, metadata: { raison },
      lignes: [
        { compte: compte.pool, montant: -mvt.metadata.usdg },
        { compte: compte.rake, montant: +mvt.metadata.usdg },
      ],
    });
  });
}

/** Ce que la page de suivi affiche : le total brule, et les derniers rachats. */
export async function bilanBrulage(db) {
  const total = (await db.query(
    `select coalesce(sum(usdg_micros), 0)::text as usdg, coalesce(sum(bg_micros), 0)::text as bg, count(*)::int as n from public.burns`,
  )).rows[0];
  const derniers = (await db.query(
    `select id, signature, usdg_micros::text as usdg, bg_micros::text as bg, supply_apres::text as supply, cree_le
       from public.burns order by cree_le desc limit 20`,
  )).rows;
  return { usdgDepenses: Number(total.usdg), bgBrules: Number(total.bg), rachats: total.n, derniers };
}
