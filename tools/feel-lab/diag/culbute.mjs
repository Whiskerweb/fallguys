/** Le saut declenche-t-il une culbute a l'atterrissage ? On court sans sauter, puis on saute. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.addInitScript(() => localStorage.setItem('tumble-model', 'char-tycoon'));
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(700);
await page.keyboard.press('Enter');
await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 60000 });
const lire = () => page.evaluate(() => {
  const c = window.__probeCharacter?.(); if (!c) return null;
  const t = c.body.translation();
  return { x: +t.x.toFixed(1), y: +t.y.toFixed(1), z: +t.z.toFixed(1), etat: c.state };
});
console.log('depart      ', JSON.stringify(await lire()));
await page.keyboard.down('KeyW');
for (const s of [1, 2, 3]) { await page.waitForTimeout(1000); console.log(`course ${s}s  `, JSON.stringify(await lire())); }
console.log('-- saut --');
await page.keyboard.press('Space');
for (const s of [1, 2]) { await page.waitForTimeout(700); console.log(`apres ${s}   `, JSON.stringify(await lire())); }
await page.keyboard.up('KeyW');
await browser.close();
