/** Capture un personnage donne dans le lobby, via localStorage (pas de clic fragile). */
import { chromium } from 'playwright';
const model = process.argv[2] ?? 'char-tycoon';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript((m) => localStorage.setItem('tumble-model', m), model);
await page.goto('http://127.0.0.1:5273/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 180000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `shots/perso-${model}.png` });
console.log(`shots/perso-${model}.png`);
await browser.close();
