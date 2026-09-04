/**
 * LE TRONC QUE JE VOIS EST-IL CELUI QUI ME HEURTE ?
 *
 * Sur Le Rondin, l'angle d'un tronc est une fonction PURE du temps écoulé, et il fixe à la
 * fois le visuel et le collider kinématique. Si le client et le serveur ne comptent pas ce
 * temps de la même façon, le joueur heurte un tronc qui n'est pas là où il le voit —
 * rapporté en jouant : « je me prends des obstacles invisibles ».
 *
 * On ne compare pas deux navigateurs entre eux : ils pourraient être d'accord et faux tous
 * les deux. On reconstruit la MÊME arène ici, dans ce processus, avec la graine que le
 * serveur a imposée, on la met à l'heure que le client déclare, et on regarde si les
 * troncs tombent au même angle.
 *
 *   cd tools/feel-lab && npm run build && node diag/horloge-rondin.mjs
 */
import { chromium } from 'playwright';
import { demarrerServeur } from '../../../serveur/src/serveur.js';
import { preparer, construire, liberer } from '../../../serveur/src/monde.js';

let ko = 0;
const dit = (ok, t) => { if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${t}`); };

await preparer();

const s = await demarrerServeur({
  port: 0,
  politique: { nom: 'DUEL_TEST', cible: 2, minimum: 2, attente: 1, proposerApres: 1, bots: 'jamais', dureeManche: 300 },
  graine: 2,           // graine serveur qui tire « rondin » pour un duel
});
const BASE = `http://127.0.0.1:${s.port}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function ouvrir(nom) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.setDefaultTimeout(300000);
  // Un DUEL, explicitement : le ticket par défaut est une arène à 2 USDC, et un serveur à
  // effectif deux refuse désormais d'y prendre une mise — aucun barème ne paie ça.
  await page.addInitScript(() => localStorage.setItem('tumble-mode', 'duel'));
  // Le nom se pose AVANT le chargement, comme le personnage : c'est `bonjour` qui le porte.
  await page.addInitScript((n) => localStorage.setItem('tumble-pseudo', n), nom);
  await page.goto(`${BASE}/?lowfx&nointro&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && getComputedStyle(l).display === 'none';
  }, { timeout: 300000 });
  // Plus de panneau ONLINE : la page se connecte toute seule au serveur qui l'a servie, et
  // le nom est parti avec `bonjour` (posé avant le chargement). On attend la liaison, puis
  // PLAY entre en file — c'est exactement le geste du joueur.
  await page.waitForFunction(() => window.__probeGame()?.file?.etat === 'ouvert', { timeout: 20000 });
  await page.click('#play');
  return { nom, page };
}

const un = await ouvrir('m1');
const deux = await ouvrir('m2');
for (const j of [un, deux]) await j.page.waitForFunction(() => window.__probeGame()?.mode === 'racing', { timeout: 120000 });

const carte = await un.page.evaluate(() => ({
  id: window.__probeGame().jeuId,
  graine: window.__probeGame().imposee?.graine ?? null,
}));
console.log(`carte : ${carte.id} · graine ${carte.graine}`);
if (carte.id !== 'rondin') {
  console.log('pas la bonne carte — changer la graine du serveur');
  await browser.close(); await s.arreter(); process.exit(1);
}

for (const j of [un, deux]) await j.page.waitForFunction(() => window.__probeGame().countdown <= 0, { timeout: 180000 });

// L'arène de référence, construite ICI avec la graine imposée par le serveur.
const monde = construire(carte.id, carte.graine);

/**
 * L'écart entre deux angles, par le plus court chemin.
 *
 * `angleCourant()` rend `2·atan2(z, w)`, qui saute de +2π à −2π : comparer deux angles
 * bruts fait passer 57° pour 303°. C'est exactement l'erreur qu'a commise la première
 * version de ce harnais.
 */
function ecartAngle(a, b) {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

let pire = 0;
let pireTemps = 0;
for (let i = 0; i < 8; i++) {
  await new Promise((r) => setTimeout(r, 1200));

  const vu = await un.page.evaluate(() => ({
    temps: window.__probeGame().enligne?.tempsMonde ?? null,
    page: performance.now() / 1000,
    angles: window.__probeGame().arena.__echines().map((e) => e.angle),
  }));
  if (vu.temps === null || !vu.angles.length) continue;

  /*
   * On met l'arène de référence à l'heure du client — PUIS ON FAIT UN PAS.
   *
   * `setAngle` n'appelle que `setNextKinematicRotation`, qui pose une CIBLE : le corps ne
   * l'adopte qu'au pas de physique suivant. Sans ce `step()`, la référence resterait à son
   * angle de construction et le harnais accuserait le jeu de son propre oubli — ce qu'il a
   * fait au premier essai, en annonçant 303° d'écart.
   */
  monde.arene.update(vu.temps, 0, null, null, true);
  monde.arene.world.step();
  const attendus = monde.arene.__echines().map((e) => e.angle);

  const ecarts = vu.angles.map((a, k) => ecartAngle(a, attendus[k] ?? a));
  const ecart = Math.max(...ecarts);
  pire = Math.max(pire, ecart);
  pireTemps = Math.max(pireTemps, Math.abs(vu.temps - vu.page));

  console.log(`     t=${vu.temps.toFixed(2)} s (page ${vu.page.toFixed(0)} s)`
    + ` · ${vu.angles.length} troncs · écart d'angle max ${(ecart * 180 / Math.PI).toFixed(2)}°`);
}

console.log('');
dit(pire < 0.05, `le tronc affiché est celui qui heurte — écart max ${(pire * 180 / Math.PI).toFixed(2)}°`);
dit(pireTemps > 5, 'l\'horloge du décor est bien celle de la manche, pas l\'âge de la page');

liberer(monde);
await browser.close();
await s.arreter();
console.log(`\n--- ${ko === 0 ? 'aucun écart' : ko + ' ECHEC(S)'} ---`);
process.exit(ko === 0 ? 0 : 1);
