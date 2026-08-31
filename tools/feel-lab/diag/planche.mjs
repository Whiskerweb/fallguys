/** Planche contact : chaque personnage sur le podium du lobby, meme cadrage. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
for (const id of process.argv.slice(2)) {
  const page = await browser.newPage({ viewport: { width: 600, height: 640 } });
  await page.addInitScript((m) => localStorage.setItem('tumble-model', m), id);
  await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
  await page.waitForTimeout(1400);
  // On fige la rotation du podium pour que tous les personnages soient vus de face.
  await page.evaluate(() => { document.querySelectorAll('body > div').forEach(e => { if (e.tagName === 'DIV') e.style.visibility = 'hidden'; }); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `shots/planche-${id}.png`, clip: { x: 130, y: 90, width: 340, height: 400 } });
  const h = await page.evaluate(() => {
    const a = window.__probeLobbyAvatar?.(); if (!a?.model) return null;
    const b = new (window.THREE?.Box3 ?? Object)();
    return { echelle: +a.model.scale.x.toFixed(2), os: a.rig?.bones.size ?? 0, rigOk: !!a.rig?.ok };
  });
  console.log(id.padEnd(15), JSON.stringify(h));
  await page.close();
}
await browser.close();
