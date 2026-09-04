/**
 * Budget de rendu : ce qui coute vraiment, map par map.
 *
 * Les DRAW CALLS comptent plus que les triangles. Un GPU moderne avale des millions de
 * triangles sans broncher, mais chaque appel de dessin coute un aller-retour avec le
 * pilote : c'est le nombre d'appels qui fait sacader, pas la geometrie. Un jeu soigne
 * vise 100 a 300 appels ; au-dela de 600 la machine peine quel que soit son GPU.
 *
 * Mesure aussi le POIDS TELECHARGE : charger les decors de toutes les maps au demarrage
 * fait payer a chaque joueur ce qu'il ne verra pas.
 */
import { chromium } from 'playwright';
import { dossierDeBanc } from '../src/boutique.js';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 160)); });

// BabyTrump est en BOUTIQUE depuis le 2 septembre 2026 : sans ce dossier de possession,
// le catalogue refuse de l'equiper et la machine repart avec le personnage suivant, sans
// un mot. La forme du dossier vient de `src/boutique.js`, jamais recopiee ici.
await page.addInitScript(({ cle, valeur }) => localStorage.setItem(cle, valeur), dossierDeBanc());
await page.addInitScript(() => localStorage.setItem('tumble-model', 'char-babytrump'));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}/?lowfx&nointro`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 300000 });
const boot = ((Date.now() - t0) / 1000).toFixed(1);

const poids = await page.evaluate(() => {
  const e = performance.getEntriesByType('resource');
  const somme = (f) => e.filter(f).reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0);
  return {
    total: +(somme(() => true) / 1048576).toFixed(1),
    glb: +(somme((r) => r.name.endsWith('.glb')) / 1048576).toFixed(1),
    nbGlb: e.filter((r) => r.name.endsWith('.glb')).length,
    images: +(somme((r) => /\.(png|jpg|webp)(\?|$)/.test(r.name)) / 1048576).toFixed(1),
  };
});
console.log(`demarrage : ${boot} s · ${poids.total} Mo telecharges `
  + `(${poids.glb} Mo de modeles en ${poids.nbGlb} fichiers, ${poids.images} Mo d'images)`);
console.log('');
console.log('map          construction   triangles   draw calls   corps');

const bilan = [];
for (const id of ['course', 'doors', 'rondin', 'dalles', 'hexagone']) {
  const t1 = Date.now();
  await page.evaluate((x) => {
    const g = window.__probeGame();
    const jeu = window.__MINIGAMES.find((m) => m.id === x);
    g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
    g.startRace();
  }, id);
  const construction = Date.now() - t1;
  /*
   * Conditions de mesure FIGEES.
   *
   * `renderer.info.calls` ne compte que ce qui entre dans le champ : selon l'endroit ou
   * se trouve le personnage au moment du releve, le meme niveau annonce 244 ou 114
   * appels. Sans caler la camera au meme point, deux mesures ne se comparent pas — et
   * une optimisation peut sembler diviser le cout par deux alors qu'elle n'a rien fait.
   */
  await page.evaluate(() => {
    const g = window.__probeGame();
    const c = window.__probeCharacter();
    const s = g.arena.spawn;
    c.body.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    g.snapCamera = true;
  });
  await page.waitForTimeout(2600);   // laisser le compteur de rendu se remplir
  const m = await page.evaluate(() => {
    const g = window.__probeGame();
    return {
      tris: window.__tris ?? 0, draws: window.__draws ?? 0,
      corps: g.arena ? g.arena.world.bodies.len() : -1,
      mode: g.mode, z: window.__probeCharacter()?.body.translation().z ?? null,
    };
  });
  bilan.push({ id, construction, ...m });
  console.log(`${id.padEnd(12)} ${String(construction).padStart(8)} ms ${String(m.tris).padStart(11)} `
    + `${String(m.draws).padStart(12)} ${String(m.corps).padStart(7)}   [${m.mode} z=${m.z?.toFixed?.(1)}]`);
  await page.evaluate(() => window.__probeGame().returnToLobby());
  await page.waitForTimeout(400);
}

const pire = bilan.reduce((a, b) => (b.draws > a.draws ? b : a));
console.log('');
console.log(`pire cas : ${pire.id} avec ${pire.draws} draw calls `
  + `-> ${pire.draws <= 300 ? 'dans le budget' : pire.draws <= 600 ? 'lourd' : 'HORS BUDGET'}`);
console.log(`erreurs : ${erreurs.length}`);
for (const e of erreurs.slice(0, 4)) console.log('  ' + e);
await browser.close();
