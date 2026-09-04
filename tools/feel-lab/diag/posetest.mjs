/** Capture chaque personnage au repos puis dans une pose extreme imposee.
 *  Un maillage correctement skinne doit visiblement se deformer entre les deux. */
import { chromium } from 'playwright';
import { dossierDeBanc } from '../src/boutique.js';
const MODELS = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
for (const id of MODELS) {
  const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
  // Un personnage de boutique doit etre possede pour etre equipe (`src/boutique.js`).
  await page.addInitScript(({ cle, valeur }) => localStorage.setItem(cle, valeur), dossierDeBanc());
  await page.addInitScript((m) => localStorage.setItem('tumble-model', m), id);
  await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelectorAll('.lobby-ui,#hud,#topbar,.panel').forEach(e=>e.style.opacity='0'); });
  await page.screenshot({ path: `shots/pose-${id}-repos.png` });
  const info = await page.evaluate(() => {
    const a = window.__probeLobbyAvatar?.(); if (!a?.rig) return 'pas de rig';
    a.rig.frozen = true;
    const set = (n, x) => { const b = a.rig.bones.get(n); if (b) { b.rotation.x = x; b.updateMatrix(); } };
    set('LeftUpLeg', -1.3); set('RightUpLeg', 1.3);
    set('LeftArm', -1.2); set('RightArm', 1.2);
    set('LeftLeg', 1.4); set('RightLeg', 1.4);
    return `${a.rig.bones.size} os pilotes`;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/pose-${id}-pose.png` });
  console.log(id, '->', info);
  await page.close();
}
await browser.close();
