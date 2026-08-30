/** La culbute se declenche-t-elle encore sur un vrai impact ? On fonce dans le parcours. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.addInitScript(() => localStorage.setItem('tumble-model', 'char-tycoon'));
await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(700);
await page.keyboard.press('Enter');
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 60000 });
await page.evaluate(() => {
  window.__etats = new Set();
  const c = window.__probeCharacter?.();
  setInterval(() => { const k = window.__probeCharacter?.(); if (k) window.__etats.add(k.state); }, 40);
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(14000);
await page.keyboard.up('KeyW');
const r = await page.evaluate(() => ({ etats: [...window.__etats], chutes: document.body.innerText.match(/Chutes : (\d+)/)?.[1] }));
console.log(JSON.stringify(r));
await browser.close();
