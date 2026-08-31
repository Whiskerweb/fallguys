/** Capture le personnage en pleine course a quatre instants, recadre sur lui. */
import { chromium } from 'playwright';
const id = process.argv[2] ?? 'char-tycoon';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
await page.addInitScript((m) => {
  localStorage.setItem('tumble-model', m);
  // Reglages appliques AVANT le chargement : le jeu lit localStorage au demarrage.

}, id);
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(900);
await page.keyboard.press('Enter');
await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 120000 });
// On rapproche la camera pour que le personnage occupe l'image.

await page.keyboard.down('KeyW');
await page.waitForTimeout(1400);
for (let i = 0; i < 4; i++) { await page.screenshot({ path: `shots/run-${id}-${i}.png` }); await page.waitForTimeout(130); }
await page.keyboard.up('KeyW');
const amp = await page.evaluate(() => {
  const c = window.__probeCharacter?.(); const r = c?.rig; if (!r) return null;
  return { vitesse: +Math.hypot(c.body.linvel().x, c.body.linvel().z).toFixed(2), etat: c.state };
});
console.log(id, JSON.stringify(amp));
await browser.close();
