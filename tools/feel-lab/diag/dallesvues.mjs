/**
 * Vues des Dalles — pour REGARDER, pas pour mesurer.
 *
 * Le harnais `dalles.mjs` prouve que la carte est juste ; il ne dit rien de ce qu'elle
 * donne à voir. On cadre donc six vues fixes : le départ, un damier vu du dessus, un
 * tremblement pris en flagrant délit, des trous déjà ouverts, la troisième section et
 * l'arrivée.
 *
 * Le décor Meshy est CHARGÉ ici, contrairement au harnais de mesure : c'est justement lui
 * qu'on vient juger.
 *
 * Lancer depuis tools/feel-lab, serveur actif :
 *   node diag/dallesvues.mjs            (serveur de dev)
 *   FEELLAB_PORT=5274 node diag/dallesvues.mjs   (build fige)
 */
import { chromium } from 'playwright';

const BASE = `http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}`;
let browser;
process.on('exit', () => { try { browser?.close(); } catch {} });

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(600000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 160)));

await page.goto(`${BASE}/?lowfx&nointro`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 600000 });
await page.evaluate(() => {
  const u = new URL(location.href);
  u.searchParams.set('graine', '4242');
  history.replaceState(null, '', u);
  const g = window.__probeGame();
  const jeu = window.__MINIGAMES.find((m) => m.id === 'dalles');
  g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => window.__probeGame().arena?.__sections, { timeout: 600000 });
await page.waitForTimeout(2500);

// On fait tomber quelques dalles AVANT de photographier : un damier intact ne montre pas
// ce que le mini-jeu donne réellement à voir. Ce sont les trous qui font l'image.
await page.evaluate(async () => {
  const g = window.__probeGame();
  const a = g.arena, c = g.character;
  const { PAS, SOL } = a.__cotes();
  const s = a.__sections()[0];
  const sur = new Set(s.chemin.map((d) => `${d.r},${d.c}`));
  for (let r = 1; r < 7; r += 2) {
    for (let col = 0; col < s.cols; col++) {
      if (sur.has(`${r},${col}`) || col % 3) continue;
      c.respawn({ x: (col - (s.cols - 1) / 2) * PAS, y: SOL + 1.1,
        z: s.zAvant - PAS / 2 - r * PAS });
      await new Promise((res) => setTimeout(res, 320));
    }
  }
  c.respawn({ x: 0, y: SOL + 1.2, z: s.zAvant + 4 });
});
await page.waitForTimeout(900);

await page.evaluate(() => {
  window.__probeGame().freezeCamera = true;
  document.querySelectorAll('body > div').forEach((e) => { e.style.visibility = 'hidden'; });
});

const cotes = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  return { ...a.__cotes(), sections: a.__sections() };
});
const [s0, s1, s2] = cotes.sections;

const vues = [
  // nom              position caméra                     point visé
  ['depart', [0, 7, 22], [0, 0, 2]],
  ['damier-dessus', [0, 26, -4], [0, 0, -14]],
  ['trous-ouverts', [-6, 5.5, 4], [1, 0, -16]],
  ['section2', [0, 9, s1.zAvant + 8], [0, 0, s1.zAvant - 18]],
  ['section3-large', [0, 30, s2.zAvant + 6], [0, 0, s2.zAvant - 26]],
  ['arrivee', [0, 8, s2.zArriere - 22], [0, 1, s2.zArriere - 2]],
];

for (const [nom, pos, cible] of vues) {
  await page.evaluate(([p, c]) => {
    const cam = window.__probeGame().view.camera;
    cam.position.set(p[0], p[1], p[2]);
    cam.lookAt(c[0], c[1], c[2]);
  }, [pos, cible]);
  await page.waitForTimeout(320);
  await page.screenshot({ path: `diag/vues/dalles-${nom}.png` });
  console.log(`diag/vues/dalles-${nom}.png`);
}
console.log(erreurs.length ? `erreurs : ${[...new Set(erreurs)].join(' | ')}` : 'erreurs : aucune');
await browser.close();
