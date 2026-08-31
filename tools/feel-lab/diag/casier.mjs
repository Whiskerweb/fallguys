import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(1200);
// La barre d'onglets a disparu : la vitrine s'ouvre par le bouton PERSONNAGE, seul
// bouton de fonctionnalite qui subsiste dans le lobby.
await page.click('#btn-perso');
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/casier.png' });
await browser.close();
