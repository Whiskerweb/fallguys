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
 * Combien de manches pour un effectif donné.
 *
 * Chaque manche élimine environ la moitié, jusqu'au vainqueur. Plafonné à trois : au-delà
 * une partie s'allonge sans devenir plus intéressante, et le spec en retient trois.
 */
export function manchesPour(joueurs) {
  return Math.min(3, Math.max(1, Math.ceil(Math.log2(Math.max(2, joueurs)))));
}

/**
 * La configuration d'une partie à N joueurs — port de `MatchConfiguration.ForPlayers`.
 *
 * Le démarrage à froid (risque n°1 du spec) impose d'ouvrir des salons plus petits que
 * seize : il faut seize joueurs vivants, prêts à miser le même montant, au même instant,
 * et au premier jour il n'y en a aucun. Un salon réduit doit donc être payé selon SON
 * effectif — le payer au barème de seize promettrait un pot qui n'existe pas.
 *
 * DEUX JOUEURS SONT REFUSÉS, et ce n'est pas un oubli. Il faut au moins deux manches, donc
 * la manche 1 laisse moins de deux joueurs, donc la manche 2 devrait en laisser moins d'un.
 * C'est structurellement impossible. Un duel n'est pas une compétition à places : s'il faut
 * en autoriser un, c'est une partie d'exhibition, hors table de gains.
 */
export function configPour(joueurs, rakeBp = 1000) {
  if (!Number.isInteger(joueurs) || joueurs < 3) {
    throw new Error(`une partie payante demande au moins 3 joueurs ; ${joueurs} demandé(s). `
      + 'Un duel se joue hors table de gains.');
  }
  const manches = Math.max(2, manchesPour(joueurs));
  const survivants = new Array(manches);
  for (let i = 1; i < manches; i++) {
    // Le plancher `manches - i + 1` garantit qu'il reste toujours assez de joueurs pour
    // tenir les manches suivantes ; sans lui, un petit effectif produirait une suite non
    // strictement décroissante, qu'aucun des deux noyaux n'accepte.
    survivants[i - 1] = Math.max(manches - i + 1, joueurs >> i);
  }
  survivants[manches - 1] = 1;

  const finalistes = survivants[manches - 2];
  const REFERENCE = [40, 15, 7, 2];
  const poidsFinalistes = Array.from(
    { length: Math.max(finalistes, REFERENCE.length) },
    (_, i) => (i < REFERENCE.length ? REFERENCE[i] : 1),
  );
  return { joueurs, survivants, rakeBp, poidsFinalistes };
}

/**
 * Table des gains — `PayoutPolicy.Compute`, repris pas à pas.
 *
 * Règle unique : les survivants de la manche 1 récupèrent leur mise, et ce qui reste après
 * le rake est réparti en bonus entre les finalistes. Le seuil de non-perte tombe donc
 * exactement à la fin de la première manche.
 *
 * @param {number} mise mise d'entrée en micro-USDC
 * @param {number} [joueurs] effectif réel de la partie. 16 par défaut — mais un salon
 *   réduit DOIT passer le sien, sans quoi il serait payé au barème de seize.
 * @returns {{pot: number, rake: number, parRang: number[]}} tout en micro-USDC
 */
export function table(mise, joueurs = CONFIG.joueurs) {
  const c = joueurs === CONFIG.joueurs ? CONFIG : configPour(joueurs, CONFIG.rakeBp);
  const seuil = c.survivants[0];
  const nbFinalistes = c.survivants[c.survivants.length - 2];

  const pot = mise * c.joueurs;
  const rake = pointsDeBase(pot, c.rakeBp);   // meme troncature que Money.MultiplyByBasisPoints
  const distribuable = pot - rake;

  const parRang = new Array(c.joueurs).fill(0);

  // 1. Remboursement de la mise aux survivants de la manche 1.
  for (let rang = 1; rang <= seuil; rang++) parRang[rang - 1] = mise;
  const bonus = distribuable - mise * seuil;

  // 2. Répartition du bonus entre finalistes, au prorata des poids.
  const poids = c.poidsFinalistes.slice(0, nbFinalistes);
  const sommePoids = poids.reduce((s, p) => s + p, 0);
  let alloue = 0;
  for (let i = 0; i < nbFinalistes; i++) {
    const part = Math.floor((bonus * poids[i]) / sommePoids);
    parRang[i] += part;
    alloue += part;
  }

  // 3. Le reste de division entière revient au vainqueur : aucune unité ne se perd.
  parRang[0] += bonus - alloue;

  return { pot, rake, parRang };
}
