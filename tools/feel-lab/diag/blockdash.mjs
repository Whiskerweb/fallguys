/**
 * Diagnostic de Block Dash.
 *
 * La question centrale n'est pas « la map se construit-elle ? » mais « chaque obstacle
 * est-il franchissable PAR CE PERSONNAGE ? ». La premiere version de la map a ete
 * dimensionnee a l'oeil, et ses cotes ne correspondaient a rien : des blocs de 1,75 m
 * pour un corps de 1,60 m, des passages de 2,68 m pour une largeur de 0,90 m.
 *
 * Ce harnais verifie donc les COTES avant de jouer, puis mesure les franchissements un
 * par un, isolement, avant de tenter la traversee complete.
 */
import { chromium } from 'playwright';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.setDefaultTimeout(240000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)); });

await page.addInitScript(() => localStorage.setItem('tumble-model', 'char-runner'));
await page.goto('http://127.0.0.1:5273/?lowfx&noassets&skip=scenery', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 300000 });

await page.evaluate(() => {
  const g = window.__probeGame();
  const jeu = window.__MINIGAMES.find((m) => m.id === 'blockdash');
  g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
// Le decompte dure quatre secondes de JEU : en rendu logiciel cela peut demander une
// minute d'horloge, d'ou un plafond large.
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 300000 });

// ── 1. Les cotes sont-elles coherentes avec le personnage ? ──
const cotes = await page.evaluate(() => window.__probeGame().arena.__cotes());
console.log('--- cotes, verifiees contre le personnage ---');
const regles = [
  ['barriere sautable', cotes.hBarriere < cotes.saut - 0.5, `${cotes.hBarriere} m < saut ${cotes.saut} m - marge`],
  ['pilier infranchissable', cotes.hPilier > cotes.saut + 0.3, `${cotes.hPilier} m > saut ${cotes.saut} m + marge`],
  ['balayeuse sautable', cotes.hBalayeuse < cotes.saut - 1.0, `${cotes.hBalayeuse} m, tres sous le saut`],
  ['passage large', cotes.passageLarge > cotes.persoLarge * 2, `${cotes.passageLarge.toFixed(2)} m pour ${cotes.persoLarge} m de large`],
  ['passage serre jouable', cotes.passageSerre > cotes.persoLarge * 1.4, `${cotes.passageSerre.toFixed(2)} m, soit ${(cotes.passageSerre / cotes.persoLarge).toFixed(1)}x le corps`],
  ['fosse facile', cotes.fosseFacile < cotes.portee * 0.65, `${cotes.fosseFacile.toFixed(1)} m pour ${cotes.portee.toFixed(1)} m de portee`],
  ['fosse dur franchissable', cotes.fosseDur < cotes.portee * 0.85, `${cotes.fosseDur.toFixed(1)} m, marge ${(cotes.portee - cotes.fosseDur).toFixed(1)} m`],
];
let cotesOk = true;
for (const [nom, ok, detail] of regles) {
  if (!ok) cotesOk = false;
  console.log(`  ${ok ? 'ok  ' : 'FAUX'} ${nom.padEnd(26)} ${detail}`);
}

// ── 2. Inventaire : la map propose-t-elle vraiment plusieurs mecaniques ? ──
const obs = await page.evaluate(() => window.__probeGame().arena.__obstacles());
const parType = {};
for (const o of obs) parType[o.type] = (parType[o.type] ?? 0) + 1;
console.log(`\n--- ${obs.length} obstacles : `
  + Object.entries(parType).map(([k, v]) => `${v} ${k}`).join(', ') + ' ---');
const varie = Object.keys(parType).length >= 4;
console.log(`  ${varie ? 'ok  ' : 'PAUVRE'} ${Object.keys(parType).length} mecaniques distinctes`);

// ── 3. Chaque obstacle se franchit-il ISOLEMENT ? ──
// On depose le joueur juste avant, on le lance, et on regarde s'il passe. Un obstacle
// infranchissable seul le restera dans le parcours complet.
/*
 * Ou se trouve le passage ? Le pilote doit VISER, comme un joueur.
 *
 * Une premiere version fonçait tout droit : elle echouait sur toute barriere dont le
 * trou n'etait pas centre, et concluait a un obstacle infranchissable alors que le
 * passage etait simplement ailleurs. Un test qui ne sait pas jouer ne mesure rien.
 */
function viser(o, cotes) {
  if (o.type === 'barriere') return o.trous.length ? o.trous[0][0] : 0;
  if (o.type === 'piliers') {
    // Milieu du plus large intervalle entre deux piliers, bords de piste compris.
    const bords = [-cotes.largeur / 2, ...o.positions.slice().sort((a, b) => a - b), cotes.largeur / 2];
    let meilleur = 0, large = -1;
    for (let i = 0; i < bords.length - 1; i++) {
      const w = bords[i + 1] - bords[i];
      if (w > large) { large = w; meilleur = (bords[i] + bords[i + 1]) / 2; }
    }
    return meilleur;
  }
  return 0;
}

async function franchir(o, cible, elan = 9) {
  const z = o.z;
  await page.evaluate(([z, elan, cible]) => {
    const c = window.__probeCharacter();
    c.body.setTranslation({ x: cible, y: 2.2, z: z + elan }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }, [z, elan, cible]);
  await page.waitForTimeout(250);
  const depart = await page.evaluate(() => window.__probeGame().runTime);
  await page.keyboard.down('ArrowUp');
  // Saut repete : le pilote n'anticipe pas, il saute en rythme. Un obstacle qui
  // exigerait un timing parfait ne passerait pas — c'est justement ce qu'on veut voir.
  const sauts = setInterval(() => page.keyboard.press('Space').catch(() => {}), 420);
  await page.waitForFunction((t) => window.__probeGame().runTime > t + 4.0, depart, { timeout: 120000 }).catch(() => {});
  clearInterval(sauts);
  await page.keyboard.up('ArrowUp');
  return page.evaluate(() => {
    const c = window.__probeCharacter();
    return { z: c.body.translation().z, y: c.body.translation().y, chutes: window.__probeGame().falls };
  });
}

console.log('\n--- franchissement, obstacle par obstacle ---');
let franchis = 0, testes = 0;
const aTester = obs.filter((o) => o.type !== 'fosse' || o.largeur > 3).slice(0, 8);
for (const o of aTester) {
  const avant = await page.evaluate(() => window.__probeGame().falls);
  const cible = viser(o, { ...cotes, largeur: await page.evaluate(() => window.__probeGame().arena.largeur) });
  /*
   * L'elan s'arrete a l'obstacle PRECEDENT.
   *
   * Une premiere version deposait toujours le joueur neuf metres en amont, sans regarder
   * ce qui se trouvait dans l'intervalle : il percutait l'obstacle d'avant et le test
   * concluait que celui qu'on voulait mesurer etait infranchissable, alors qu'il n'avait
   * jamais ete atteint.
   */
  const precedent = obs.filter((x) => x.z > o.z).sort((a, b) => a.z - b.z)[0];
  const elan = Math.max(4, Math.min(9, precedent ? precedent.z - o.z - 1.5 : 9));
  const r = await franchir(o, cible, elan);
  const passe = r.z < o.z - 2.5;
  testes++;
  if (passe) franchis++;
  const detail = o.type === 'fosse' ? `${o.largeur.toFixed(1)} m`
    : o.type === 'piliers' ? `${o.positions.length} piliers${o.mobile ? ' mobiles' : ''}`
    : o.type === 'barriere' ? `${o.trous.length} passage(s)` : `v=${o.vitesse}`;
  console.log(`  z=${String(o.z).padStart(7)} ${o.type.padEnd(10)} ${detail.padEnd(18)} `
    + `vise x=${cible.toFixed(1).padStart(5)} elan ${elan.toFixed(1)} m -> `
    + `${passe ? 'FRANCHI' : `BLOQUE a z=${r.z.toFixed(1)}`}`
    + `${r.chutes > avant ? ' (chute)' : ''}`);
}
console.log(`  ${franchis}/${testes} obstacles franchis isolement`);

// ── 4. Vues du parcours, une par mecanique ──
for (const [nom, z] of [['barrieres', 6], ['piliers', -28], ['fosse', -68], ['balayeuses', -101], ['finale', -128]]) {
  await page.evaluate((z) => {
    const g = window.__probeGame();
    const c = window.__probeCharacter();
    c.body.setTranslation({ x: 0, y: 2.4, z }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    g.snapCamera = true;
  }, z);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/bd-${nom}.png` });
}

console.log(`\nerreurs : ${erreurs.length}`);
for (const e of erreurs.slice(0, 5)) console.log('  ' + e);
await browser.close();
process.exit(erreurs.length || !cotesOk || !varie || franchis < testes ? 1 : 0);
