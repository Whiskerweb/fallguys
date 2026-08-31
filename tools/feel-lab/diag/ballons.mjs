/** Les ballons devalent-ils vraiment ? On releve leur position a deux instants. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
page.setDefaultTimeout(90000);
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(700);
await page.keyboard.press('Enter');
await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 60000 });
await page.evaluate(() => {
  const g = window.__probeGame?.(); g.freezeCamera = true;
  g.view.camera.position.set(-5, 8, -96); g.view.camera.lookAt(-5, 3, -114);
  document.querySelectorAll('body > div').forEach(e => e.style.visibility = 'hidden');
});
for (let i = 0; i < 4; i++) { await page.waitForTimeout(700); await page.screenshot({ path: `shots/ballons-${i}.png` }); }
console.log('captures ballons');
await browser.close();
