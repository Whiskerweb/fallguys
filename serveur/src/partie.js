/**
 * UNE PARTIE — trois manches, une couronne.
 *
 * La pyramide d'élimination de la spec (section 3) : 16 → 8 → 4 → 1. Chaque manche est
 * une carte tirée par la graine, et les éliminés d'une manche gardent le rang qu'ils y ont
 * atteint. C'est ce classement final que le backend paie.
 *
 * L'effectif n'est PAS figé à seize. `MatchConfiguration` accepte déjà d'autres tailles
 * (les tests C# couvrent 12 et 24), et le démarrage à froid imposera des salons plus
 * petits avant d'en imposer de grands. Les survivants de chaque manche se déduisent donc
 * de l'effectif, ils ne sont pas écrits en dur.
 */

import { jouerManche } from './manche.js';
import { epreuves } from './monde.js';

/** mulberry32 — le générateur de graines du jeu. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Combien de joueurs survivent à chaque manche, pour un effectif donné.
 *
 * On divise par deux, puis par deux, et la dernière manche désigne un vainqueur unique.
 * `MatchConfiguration.Validate()` en C# exige une suite strictement décroissante finissant
 * par 1 — cette fonction produit exactement cela, quel que soit l'effectif.
 */
export function survivants(effectif, manches = 3) {
  const out = [];
  let n = effectif;
  for (let i = 0; i < manches - 1; i++) {
    n = Math.max(2, Math.floor(n / 2));
    out.push(n);
  }
  out.push(1);
  // Une suite qui n'est pas strictement décroissante ferait échouer la validation du
  // noyau de règles : on la resserre plutôt que de la laisser produire un pot ingagnable.
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i] >= out[i - 1]) out[i - 1] = out[i] + 1;
  }
  return out;
}

/**
 * Tire le parcours : une épreuve par manche, toutes différentes.
 *
 * Tiré de la graine de partie, jamais de `Math.random` — deux serveurs qui rejouent la
 * même partie doivent tirer les mêmes cartes, sans quoi un replay ne reproduit rien.
 */
export function tirerParcours(graine, manches = 3) {
  const alea = mulberry32(graine >>> 0);
  const restantes = epreuves().map((e) => e.id);
  const out = [];
  for (let i = 0; i < manches && restantes.length; i++) {
    out.push(restantes.splice(Math.floor(alea() * restantes.length), 1)[0]);
  }
  return out;
}

/**
 * Joue une partie entière.
 *
 * @param {object} p
 * @param {number} p.graine
 * @param {Array}  p.inscrits    la grille de départ, telle que `salon.composer()` la rend
 * @param {number} [p.manches]
 * @param {function} [p.surManche] appelé après chaque manche, pour observer
 */
export function jouerPartie({ graine, inscrits, manches = 3, surManche, dureeMax = 180 }) {
  const parcours = tirerParcours(graine, manches);
  const paliers = survivants(inscrits.length, manches);

  let enLice = inscrits.slice();
  const elimines = [];          // du dernier éliminé au premier : l'ordre inverse du rang
  const details = [];

  for (let m = 0; m < parcours.length && enLice.length > 1; m++) {
    const qualifies = Math.min(paliers[m], enLice.length - 1);
    // Une graine par manche, dérivée de celle de la partie : deux manches de la même
    // partie ne doivent pas se ressembler, et la partie entière doit rester reproductible.
    const graineManche = (graine ^ ((m + 1) * 0x85EBCA6B)) >>> 0;

    const r = jouerManche({
      epreuve: parcours[m],
      graine: graineManche,
      inscrits: enLice,
      qualifies,
      dureeMax,
    });

    const passent = new Set(r.qualifies);
    // Les éliminés de cette manche sont empilés du MOINS bon au meilleur : à la fin, on
    // dépile pour obtenir les rangs, et ceux qui sont allés le plus loin ressortent devant.
    const sortis = r.classement.filter((c) => !passent.has(c.nom)).reverse();
    for (const c of sortis) elimines.push(c.nom);

    enLice = enLice.filter((i) => passent.has(i.nom));
    details.push({ manche: m + 1, ...r });
    surManche?.(m + 1, r, enLice);
  }

  /*
   * LE CLASSEMENT FINAL.
   *
   * Les survivants en tête — dans l'ordre de la dernière manche —, puis les éliminés du
   * plus récent au plus ancien. Aller loin dans la partie vaut donc mieux que tomber tôt,
   * ce qui est la seule chose que le joueur attend d'un classement.
   */
  const ordre = [...enLice.map((i) => i.nom), ...elimines.reverse()];
  const classement = ordre.map((nom, i) => {
    const inscrit = inscrits.find((x) => x.nom === nom);
    return { nom, rang: i + 1, estBot: Boolean(inscrit?.estBot), niveau: inscrit?.niveau ?? null };
  });

  return { graine, parcours, paliers, classement, manches: details };
}
