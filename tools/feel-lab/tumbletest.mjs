/** Vérifie la culbute : on court jusqu'à percuter un obstacle et on relève l'état. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => localStorage.setItem('tumble-model', 'char-penguin'));
await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(1000);
await page.keyboard.press('Enter');
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 120000 });
await page.keyboard.down('KeyW');

// On surveille l'état jusqu'à voir une culbute, sans dépasser 90 s réelles.
const seen = new Set();
const t0 = Date.now();
let tumbleShot = false;
while (Date.now() - t0 < 90000) {
  const s = await page.evaluate(() => window.__probeCharacter?.()?.state ?? null);
  if (s) seen.add(s);
  if ((s === 'tumbling' || s === 'gettingUp') && !tumbleShot) {
    await page.screenshot({ path: `shots/anim-${s}.png` });
    console.log(`capture de l'etat ${s}`);
    tumbleShot = true;
  }
  if (seen.has('tumbling') && seen.has('gettingUp')) break;
  await page.waitForTimeout(220);
}
await page.keyboard.up('KeyW');
console.log('etats observes :', [...seen].join(', '));
await browser.close();
