/**
 * Le dernier tiers du parcours est-il JOUABLE ?
 *
 * Deux mecaniques y sont neuves et aucune ne se verifie a l'oeil : la grande cote aux
 * ballons se monte-t-elle vraiment, et la patinoire glisse-t-elle vraiment ? On y pilote
 * donc le personnage pour de bon, touche enfoncee, et on releve ce qu'il devient.
 */
import { chromium } from 'playwright';
let browser; process.on('exit', () => { try { browser?.close(); } catch {} });
browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 420 } });
page.setDefaultTimeout(120000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)); });
const SKIP = process.argv[2] ?? 'balls,pendulums';
await page.goto(`http://127.0.0.1:5273/?lowfx&skip=${SKIP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l = document.getElementById('loading'); return l && getComputedStyle(l).display === 'none'; }, { timeout: 300000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 120000 });

const poser = (voie, z) => page.evaluate(([voie, z]) => {
  const g = window.__probeGame(); const c = window.__probeCharacter();
  const pts = g.course.trajectoires[voie];
  let best = pts[0];
  for (const p of pts) if (Math.abs(p.z - z) < Math.abs(best.z - z)) best = p;
  c.body.setTranslation({ x: best.x, y: best.y + 1.4, z: best.z }, true);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  g.freezeCamera = false;
}, [voie, z]);

const etat = () => page.evaluate(() => {
  const g = window.__probeGame(); const c = window.__probeCharacter();
  const t = c.body.translation(), v = c.body.linvel();
  return {
    x: +t.x.toFixed(1), y: +t.y.toFixed(1), z: +t.z.toFixed(1),
    v: +Math.hypot(v.x, v.z).toFixed(2), glisse: +(c.glisse ?? 0).toFixed(2),
    sol: c.grounded, etat: c.state,
  };
});

// ── 1. La grande cote : on monte, touche avant enfoncee.
await poser('commun-fusion', -101);
await page.waitForTimeout(400);
const depart = await etat();
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(14000);
await page.keyboard.up('ArrowUp');
const arrivee = await etat();
console.log('--- grande cote aux ballons ---');
console.log(`  depart  ${JSON.stringify(depart)}`);
console.log(`  14 s    ${JSON.stringify(arrivee)}`);
// Verdict robuste au rendu logiciel : la question n'est pas « combien de metres en
// quatorze secondes » — la simulation tourne au ralenti — mais « le personnage est-il
// TOUJOURS pose sur la pente, en progression ». Un blocage se voit a l'ecart entre sa
// hauteur et celle du ruban sous lui.
const surSol = await page.evaluate(([z]) => {
  const g = window.__probeGame();
  return g.course.paths.FUSION.atZ(z).y;
}, [arrivee.z]);
const ecart = arrivee.y - surSol;
console.log(`  monte de ${(arrivee.y - depart.y).toFixed(1)} m sur ${(depart.z - arrivee.z).toFixed(1)} m`);
console.log(`  hauteur du ruban sous lui : ${surSol.toFixed(2)} m, ecart ${ecart.toFixed(2)} m`);
console.log(`  -> ${arrivee.z < depart.z - 6 && arrivee.y > depart.y + 1.5 && Math.abs(ecart - 0.85) < 0.5 ? 'COTE FRANCHIE (pose sur la pente, en progression)' : 'BLOQUE'}`);
await page.screenshot({ path: 'shots/fin-cote.png' });

// ── 2. La patinoire : on lance, puis on LACHE tout. Ce qui compte est la distance
// parcourue APRES avoir lache — sur un sol normal on s'arrete en un metre.
for (const [nom, z] of [['sol normal', -152], ['patinoire', -163], ['toboggan', -176]]) {
  await poser('commun-fin', z);
  await page.waitForTimeout(600);
  await page.keyboard.down('ArrowUp');
  const trace = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(300); trace.push((await etat()).v); }
  const lance = await etat();
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(1600);
  const apres = await etat();
  const derive = Math.hypot(apres.x - lance.x, apres.z - lance.z);
  console.log(`  ${nom.padEnd(12)} montee en vitesse : ${trace.join(' ')}`);
  console.log(`  ${' '.repeat(12)} lance ${JSON.stringify(lance)}`);
  console.log(`  ${' '.repeat(12)} apres ${JSON.stringify(apres)}  derive : ${derive.toFixed(1)} m`);
  if (nom === 'patinoire') await page.screenshot({ path: 'shots/fin-patinoire.png' });
}
console.log('erreurs :', erreurs.length ? erreurs.join('\n') : 0);
