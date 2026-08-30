/** Le joueur survit-il a la rampe aux ballons ? On l'y pose et on suit sa position. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 480 } });
page.setDefaultTimeout(90000);
await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(700);
await page.keyboard.press('Enter');
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 60000 });
await page.evaluate(() => {
  const c = window.__probeCharacter?.();
  c.body.setTranslation({ x: -5, y: 3.4, z: -106 }, true);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
});
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(500);
  const p = await page.evaluate(() => {
    const c = window.__probeCharacter?.(); const t = c.body.translation();
    return { x: +t.x.toFixed(1), y: +t.y.toFixed(1), z: +t.z.toFixed(1), etat: c.state };
  });
  console.log(`t+${((i + 1) * 0.5).toFixed(1)}s`, JSON.stringify(p));
}
await browser.close();
