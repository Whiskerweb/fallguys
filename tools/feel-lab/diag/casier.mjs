import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(1200);
// L'onglet vestiaire est le deuxieme de la barre.
const onglets = await page.$$('.tab, .lobby-tab, [data-tab]');
console.log('onglets trouves :', onglets.length);
for (const o of onglets) {
  const t = await o.getAttribute('data-tab');
  if (t && /skin|vestiaire|locker|wardrobe/i.test(t)) { await o.click(); console.log('clic sur', t); break; }
}
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/casier.png' });
await browser.close();
