/**
 * La table des gains — TROISIEME implementation de la meme regle.
 *
 * Les deux autres : `src/Fallguys.Rules/PayoutPolicy.cs` (la reference) et
 * `tools/feel-lab/src/economie.js` (ce que le lobby annonce au joueur). Celle-ci est
 * celle qui PAIE.
 *
 * Trois implementations d'une meme regle derivent toujours les unes des autres. C'est
 * pourquoi `test/gains.mjs` ne se contente pas de verifier des valeurs attendues : il
 * charge reellement `economie.js` et compare les deux tables rang par rang. Le jour ou
 * quelqu'un change un poids d'un seul cote, le test le dit — au lieu que le joueur
 * decouvre l'ecart entre le gain annonce et le gain recu.
 *
 * On ne l'importe pas depuis feel-lab : ce module-la touche a `localStorage` et vit dans
 * le dossier du client. Le service qui paie ne doit rien devoir au code du navigateur.
 */

import { pointsDeBase } from './argent.js';

/**
 * Recopie de `MatchConfiguration.Default` : 16 joueurs, 3 manches, rake 10 %.
 *
 * Poids [40, 15, 7, 2] et non [35, 15, 5, 1] : ces derniers tombaient sur des chiffres
 * ronds A 15 % DE RAKE. A 10 %, la meme formule paie 2,714285 au deuxieme. Le rake et les
 * poids forment un couple ; reviser l'un sans l'autre donne des gains justes au centieme
 * et illisibles a l'ecran.
 */
export const CONFIG = {
  joueurs: 16,
  survivants: [8, 4, 1],
  rakeBp: 1000,
  poidsFinalistes: [40, 15, 7, 2],
};

/** Les trois tables ouvertes, en USDC. */
export const PALIERS = [1, 2, 5];

/** Rang au-dela duquel le joueur ne recupere plus sa mise. */
export const SEUIL_REMBOURSEMENT = CONFIG.survivants[0];
/** Nombre de joueurs qui entrent dans la derniere manche. */
export const NB_FINALISTES = CONFIG.survivants[CONFIG.survivants.length - 2];

/**
 * Table des gains pour une mise donnee — `PayoutPolicy.Compute`, repris pas a pas.
 *
 * Regle unique : les survivants de la manche 1 recuperent leur mise, et ce qui reste
 * apres le rake est reparti en bonus entre les finalistes. Le seuil de non-perte tombe
 * donc exactement a la fin de la premiere manche.
 *
 * @param {number} mise mise d'entree en micro-USDC
 * @returns {{pot: number, rake: number, parRang: number[]}} tout en micro-USDC
 */
export function table(mise) {
  const { joueurs, rakeBp, poidsFinalistes } = CONFIG;

  const pot = mise * joueurs;
  const rake = pointsDeBase(pot, rakeBp);
  const distribuable = pot - rake;

  const parRang = new Array(joueurs).fill(0);

  // 1. Remboursement de la mise aux survivants de la manche 1.
  for (let rang = 1; rang <= SEUIL_REMBOURSEMENT; rang++) parRang[rang - 1] = mise;
  const bonus = distribuable - mise * SEUIL_REMBOURSEMENT;

  // 2. Repartition du bonus entre finalistes, au prorata des poids.
  const poids = poidsFinalistes.slice(0, NB_FINALISTES);
  const sommePoids = poids.reduce((s, p) => s + p, 0);
  let alloue = 0;
  for (let i = 0; i < NB_FINALISTES; i++) {
    const part = Math.floor((bonus * poids[i]) / sommePoids);
    parRang[i] += part;
    alloue += part;
  }

  // 3. Le reste de division entiere revient au vainqueur : aucune unite ne se perd.
  parRang[0] += bonus - alloue;

  return { pot, rake, parRang };
}
