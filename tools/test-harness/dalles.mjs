/**
 * LES DALLES, SANS NAVIGATEUR : les trois règles, et les deux exploits qu'elles ferment.
 *
 * Le 4 septembre 2026 le directeur produit a dit : « il suffit de courir tout droit et
 * de sauter pour passer sans chercher le chemin ». C'était vrai, et pour deux raisons
 * distinctes — une dalle se traverse en 0,32 s quand le sursis en durait 0,36, et un
 * saut tamponné repart à l'image même de l'atterrissage. Trois règles y répondent
 * (`scenes/dalles.js`, en-tête ; `tuning.js:jumpLanding`), et ce fichier les tient :
 *
 *   1. poser le pied sur le BORD d'une fausse dalle déclenche le sursis, entier ;
 *   2. s'y ENGAGER de 75 cm la rompt sans sursis ;
 *   3. s'y RECEVOIR d'un saut la rompt sans sursis — et une dalle du chemin, jamais ;
 *   4. le coureur en ligne droite tombe DANS LA PREMIÈRE SECTION ;
 *   5. le sauteur en rafale aussi.
 *
 * Tout passe par `avancerTick` — la vraie physique, le vrai tick du serveur — et par les
 * positions que `tick.js` passe à la scène (`sonde`, avec l'impact). Un test qui
 * appellerait la scène à la main avec des positions choisies prouverait la scène, pas le
 * jeu : le premier essai de la règle 2 (un carré au centre de la dalle) passait ce
 * test-là et laissait courir un joueur décalé de 90 cm. C'est ici qu'il est tombé.
 */

import { preparer, construire, creerPerso, liberer } from '../../serveur/src/monde.js';
import { avancerTick } from '../../serveur/src/tick.js';

let total = 0, ko = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const DT = 1 / 30;

await preparer();

/** Une scène neuve, avec une dalle piégée et la dalle sûre du même rang, en section 1. */
function scene(graine) {
  const monde = construire('dalles', graine);
  const perso = creerPerso(monde, 0, 2);
  const a = monde.arene;
  const { PAS, SOL, KILL_Y } = a.__cotes();
  const s = a.__sections()[0];
  const sur = new Set(s.chemin.map((d) => `${d.r},${d.c}`));
  const rang = Math.floor(s.rangs / 2);
  const sure = s.chemin.filter((d) => d.r === rang)[0];
  let col = -1;
  for (let k = 0; k < s.cols; k++) if (!sur.has(`${rang},${k}`)) { col = k; break; }
  const piege = { r: rang, c: col, x: (col - (s.cols - 1) / 2) * PAS, z: sure.z };
  return { monde, perso, a, PAS, SOL, KILL_Y, s, piege, sure };
}
const etatDe = (c, d) => c.a.__etats().find((v) => v.s === c.s.indice && v.r === d.r && v.c === d.c);

/** Joue des ticks jusqu'à `duree` secondes ou jusqu'à ce que `arret(t)` dise vrai. */
function jouer(c, entree, duree, arret) {
  let t = 0;
  for (let tick = 0; tick < duree * 30; tick++) {
    const e = entree(t);
    avancerTick(c.monde, [{ perso: c.perso, entrees: [e, { ...e }] }], t, DT, true);
    t += DT;
    if (arret?.(t)) return t;
  }
  return t;
}
const immobile = () => ({ x: 0, z: 0, jump: false, dive: false });
const toutDroit = () => ({ x: 0, z: -1, jump: false, dive: false });
const chuteDe = (c, d) => (t) => etatDe(c, d)?.etat === 'chute';

console.log('\n\x1b[1mLes Dalles : poser le pied tremble, s\'engager rompt, se recevoir rompt\x1b[0m\n');

// 1. Le bord : posé à 90 cm du centre, à 10 cm du sol, immobile. Le sursis entier.
{
  const c = scene(11);
  c.perso.respawn({ x: c.piege.x, y: c.SOL + 0.9, z: c.piege.z + 0.9 });
  const t = jouer(c, immobile, 3, chuteDe(c, c.piege));
  const e = etatDe(c, c.piege);
  dit(e?.etat === 'chute' && e.rupture === null && Math.abs(e.sursisReel - c.s.sursis) < 0.05,
    `poser le pied sur le bord d'une fausse dalle laisse le sursis entier — ${e?.sursisReel?.toFixed(2)} s pour ${c.s.sursis} annoncés, rupture ${e?.rupture}`);
  dit(t < 1, `et elle tombe bien — à ${t.toFixed(2)} s`);
  liberer(c.monde);
}

// 2. S'engager : posé sur le bord, un pas en avant.
{
  const c = scene(11);
  c.perso.respawn({ x: c.piege.x - 0.9, y: c.SOL + 0.9, z: c.piege.z + 1.0 });
  let zEntree = null;
  const t = jouer(c, toutDroit, 3, (t) => {
    if (zEntree === null && etatDe(c, c.piege)?.etat === 'tremble') zEntree = c.perso.position.z;
    return etatDe(c, c.piege)?.etat === 'chute';
  });
  const e = etatDe(c, c.piege);
  const parcouru = zEntree === null ? NaN : zEntree - c.perso.position.z;
  dit(e?.rupture === 'engage' && t < c.s.sursis,
    `s'engager sur une fausse dalle la rompt avant le sursis — rupture « ${e?.rupture} » à ${t.toFixed(2)} s, ${parcouru.toFixed(2)} m après l'entrée`);
  liberer(c.monde);
}

// 3. Se recevoir : lâché d'un mètre et demi sur le bord ; et sur la dalle sûre, rien.
{
  const c = scene(11);
  c.perso.respawn({ x: c.piege.x, y: c.SOL + 0.8 + 1.5, z: c.piege.z + 0.9 });
  const t = jouer(c, immobile, 3, chuteDe(c, c.piege));
  const e = etatDe(c, c.piege);
  dit(e?.rupture === 'atterrissage' && t < c.s.sursis,
    `se recevoir sur une fausse dalle la rompt sans sursis — rupture « ${e?.rupture} » à ${t.toFixed(2)} s, impact ${c.perso.impact.toFixed(1)} m/s`);
  liberer(c.monde);
  const c2 = scene(11);
  c2.perso.respawn({ x: c2.sure.x, y: c2.SOL + 0.8 + 1.5, z: c2.sure.z });
  jouer(c2, immobile, 2);
  dit(etatDe(c2, c2.sure) === undefined && c2.perso.position.y > c2.SOL + 0.7,
    `une dalle du chemin ne rompt sous rien — toujours debout à y=${c2.perso.position.y.toFixed(2)} après 2 s`);
  liberer(c2.monde);
}

// 4 et 5. Les deux exploits, sur trois graines : le coureur tout droit, le sauteur en rafale.
for (const [nom, entree] of [
  ['courir tout droit sans sauter', toutDroit],
  ['courir tout droit en martelant le saut', () => ({ x: 0, z: -1, jump: true, dive: false })],
]) {
  const resultats = [];
  for (const graine of [11, 12, 13]) {
    const c = scene(graine);
    let tombe = null;
    jouer(c, entree, 40, (t) => {
      if (c.perso.position.y < c.KILL_Y) { tombe = t; return true; }
      return c.perso.position.z < c.monde.finishZ;
    });
    const z = c.perso.position.z;
    resultats.push({ graine, tombe, z, dansS1: tombe !== null && z <= c.s.zAvant && z >= c.s.zArriere - 1 });
    liberer(c.monde);
  }
  dit(resultats.every((r) => r.dansS1),
    `${nom} tombe dans la PREMIÈRE section — ${resultats.map((r) => `graine ${r.graine} : ${r.tombe ? `chute à ${r.tombe.toFixed(1)} s, z=${r.z.toFixed(1)}` : 'JAMAIS TOMBÉ'}`).join(' · ')}`);
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`} ---`);
process.exit(ko === 0 ? 0 : 1);
