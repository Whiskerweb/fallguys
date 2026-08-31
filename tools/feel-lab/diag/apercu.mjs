/** Vue d'ensemble du parcours : de dessus et de trois-quarts, pour juger le trace. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.setDefaultTimeout(90000);
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(800);
await page.keyboard.press('Enter');
await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 60000 });
await page.evaluate(() => { document.querySelectorAll('body > div').forEach(e => e.style.visibility = 'hidden'); });
const vues = [
  // Vues a hauteur de course
  ['jeu-virage',   [2, 9, 4],       [5, 1, -16]],
  ['jeu-fourche',  [-6, 11, -55],   [-6, 2, -74]],
  ['jeu-ballons',  [-5, 13, -93],   [-5, 8, -117]],
  ['jeu-plateaux', [-5, 16, -128],  [-1, 9, -146]],
  ['jeu-patinoire',[2, 14, -150],   [3, 9, -168]],
  ['jeu-toboggan', [3, 15, -166],   [-1, 3, -186]],
  // Zooms de dessus : c'est la qu'on juge le RACCORD entre deux troncons.
  ['zoom-virage1', [3, 46, -14],    [3, 0, -14]],
  ['zoom-montee',  [4, 46, -36],    [4, 0, -36]],
  ['zoom-fourche', [-5, 52, -72],   [-5, 0, -72]],
  ['zoom-tapis',   [1, 34, -81],    [1, 0, -81]],
  ['zoom-fusion',  [-5, 52, -100],  [-5, 0, -100]],
  ['zoom-cote',    [-5, 60, -115],  [-5, 4, -115]],
  ['zoom-patinoire', [2, 46, -164], [2, 9, -164]],
  ['zoom-finale',  [1, 56, -186],   [1, 0, -186]],
  ['dessus',  [0, 290, -90], [0, 0, -90]],
  // Vue de FLANC, basse : c'est la seule qui montre le denivele. Vue de haut, une
  // montee de huit metres se lit comme un sol plat.
  ['profil',  [120, 26, -120], [0, 6, -140]],
  ['profil-cote', [70, 14, -112], [-5, 6, -120]],
  ['debut',   [0, 40, 40],   [0, 0, -40]],
  ['fin',     [0, 45, -225], [0, 0, -150]],
];


for (const [nom, pos, look] of vues) {
  await page.evaluate(([p, l]) => {
    const g = window.__probeGame?.(); if (!g) return;
    g.freezeCamera = true;
    g.view.camera.position.set(p[0], p[1], p[2]);
    g.view.camera.lookAt(l[0], l[1], l[2]);
  }, [pos, look]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/apercu-${nom}.png` });
  console.log(nom);
}
await browser.close();
