/**
 * UN PERSONNAGE COURT TOUT DROIT SUR UNE CARTE, SANS JAMAIS SAUTER. Où tombe-t-il ?
 *
 * C'est la sonde la plus rapide du dépôt pour une question de TERRAIN : la vraie
 * physique, les vrais modules du jeu (`monde.js`, `tick.js`), zéro navigateur, une
 * seconde de calcul. Elle note chaque changement d'état du personnage et chaque marche
 * (variation d'altitude au sol de plus de 5 cm) — une culbute là où il n'y a pas
 * d'obstacle est une marche de trop, et on la voit avec sa cote.
 *
 * Elle est née du premier pont du Rondin : « quand on marche sans sauter on tombe »
 * (directeur produit, 4 septembre 2026). Deux culbutes à z = 0,66 et z = −0,13, sur un
 * escalier de planches de 17 cm — trouvées ici avant d'être vues à l'écran.
 *
 * Ce n'est PAS une suite de verdicts : elle rapporte. Un personnage qui court tout droit
 * finit toujours par tomber quelque part, et c'est la carte qui dit si c'est juste.
 *
 * Usage : node marche.mjs [carte=rondin] [graine=7] [zDepart] [zFin] [durée=120]
 *   node marche.mjs rondin 7                 depuis le départ, jusqu'à l'arrivée ou la chute
 *   node marche.mjs rondin 7 -116 -134       posé à z = −116, arrêt passé z = −134
 */

import { preparer, construire, creerPerso, liberer } from '../../serveur/src/monde.js';
import { avancerTick } from '../../serveur/src/tick.js';

const carte = process.argv[2] ?? 'rondin';
const graine = Number(process.argv[3] ?? 7);
const zDepart = process.argv[4] !== undefined ? Number(process.argv[4]) : null;
const zFin = process.argv[5] !== undefined ? Number(process.argv[5]) : null;
const DUREE = Number(process.argv[6] ?? 120);
const DT = 1 / 30;

await preparer();
const monde = construire(carte, graine);
const perso = creerPerso(monde, 0, 2);
if (zDepart !== null) perso.respawn({ x: 0, y: (monde.spawn?.y ?? 1.6), z: zDepart });
const arrivee = zFin ?? monde.finishZ ?? -Infinity;

console.log(`\n${carte} · graine ${graine} · tout droit, sans sauter\n`);
let t = 0, etat = null, dernierY = null, auSol = null;
const marches = [];
const entree = () => ({ x: 0, z: -1, jump: false, dive: false });
for (let tick = 0; tick < DUREE * 30; tick++) {
  avancerTick(monde, [{ perso, entrees: [entree(), entree()] }], t, DT, true);
  t += DT;
  const p = perso.position;
  if (perso.state !== etat) {
    console.log(`  t=${t.toFixed(2).padStart(6)}  z=${p.z.toFixed(2).padStart(8)}  y=${p.y.toFixed(2).padStart(6)}  ${etat ?? '—'} → ${perso.state}`);
    etat = perso.state;
  }
  if (perso.grounded !== auSol) auSol = perso.grounded;
  if (dernierY !== null && perso.grounded && Math.abs(p.y - dernierY) > 0.05) {
    marches.push(`z=${p.z.toFixed(1)} ${p.y - dernierY > 0 ? '+' : ''}${Math.round((p.y - dernierY) * 100)} cm`);
  }
  dernierY = p.y;
  if (p.y < monde.killY) { console.log(`\n  CHUTE à t=${t.toFixed(2)} s, z=${p.z.toFixed(2)}`); break; }
  if (p.z < arrivee) { console.log(`\n  ARRIVÉ passé z=${arrivee} à t=${t.toFixed(2)} s`); break; }
}
console.log(`\n  marches au sol (> 5 cm) : ${marches.length ? marches.join(' · ') : 'aucune'}\n`);
liberer(monde);
