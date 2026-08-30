import { chromium } from 'playwright';
const file = process.argv[2];
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
await page.goto(`http://127.0.0.1:5273/viewer.html?m=${file}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
console.log(await page.textContent('#info'));
for (const [i, a] of [0, Math.PI / 2].entries()) {
  await page.evaluate((x) => window.__tourner(x), a);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `shots/glb-${file.replace('.glb','')}-${i}.png` });
}
await browser.close();
