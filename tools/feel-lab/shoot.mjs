/**
 * Captures d'ecran automatisees via Chromium headless.
 * Permet de VOIR le rendu et de lire les erreurs console sans intervention humaine —
 * c'est ce qui rend le travail sur le visuel verifiable de bout en bout.
 * Usage : node shoot.mjs [url]
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const URL = process.argv[2] ?? 'http://127.0.0.1:5273/';
const OUT = 'shots';
await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// Le rendu logiciel est lent : on laisse le temps aux 57 Mo de modeles de se charger.
try {
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && (l.style.display === 'none' || getComputedStyle(l).display === 'none');
  }, { timeout: 180000 });
  console.log('chargement termine');
} catch {
  console.log('TIMEOUT au chargement — capture de l ecran en l etat');
}

await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/1-lobby.png` });
console.log('1-lobby.png');

// Garde-robe
await page.click('#btn-wardrobe');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/1b-garde-robe.png` });
console.log('1b-garde-robe.png');
const swatches = await page.$$('#wardrobe .swatch');
if (swatches[3]) { await swatches[3].click(); await page.waitForTimeout(900); }
await page.screenshot({ path: `${OUT}/1c-skin.png` });
console.log('1c-skin.png');
await page.click('#btn-wardrobe');
await page.waitForTimeout(300);

// Lancer la course : compte a rebours
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/2a-decompte.png` });
console.log('2a-decompte.png');
await page.waitForTimeout(3200);
await page.screenshot({ path: `${OUT}/2-depart.png` });
console.log('2-depart.png');

// Courir vers les premiers obstacles
await page.keyboard.down('KeyW');
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/3-course.png` });
console.log('3-course.png');
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/4-obstacles.png` });
console.log('4-obstacles.png');
await page.keyboard.up('KeyW');

// Retour au lobby : verifie que la bascule inverse fonctionne aussi
await page.keyboard.press('Escape');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/5-retour-lobby.png` });
console.log('5-retour-lobby.png');

// Etat interne
const state = await page.evaluate(() => ({
  fps: window.__fps ?? null,
  triangles: window.__tris ?? null,
  timer: document.getElementById('timer')?.textContent,
  falls: document.getElementById('falls')?.textContent,
  canvas: (() => { const c = document.querySelector('canvas'); return c ? `${c.width}x${c.height}` : 'aucun'; })(),
}));

await browser.close();

console.log('\n--- etat ---');
console.log(JSON.stringify(state, null, 2));
console.log('\n--- console ---');
const interesting = logs.filter((l) => !/Download the React|DevTools/.test(l));
console.log(interesting.slice(0, 40).join('\n') || '(vide)');
const errors = logs.filter((l) => /error|pageerror|Failed|Uncaught/i.test(l));
if (errors.length) { console.log('\n--- ERREURS ---'); console.log(errors.join('\n')); }
