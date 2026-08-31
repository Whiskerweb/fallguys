/** Le rig converge-t-il vers sa pose cible ? On l'appelle nous-memes, hors boucle du lobby. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 500, height: 400 } });
await page.addInitScript(() => localStorage.setItem('tumble-model', 'char-tycoon'));
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(1200);
console.log(JSON.stringify(await page.evaluate(() => {
  const a = window.__probeLobbyAvatar?.(); if (!a?.rig) return 'pas de rig';
  const rig = a.rig, arm = rig.bones.get('LeftArm');
  const euler = () => ({ x: +arm.rotation.x.toFixed(3), y: +arm.rotation.y.toFixed(3), z: +arm.rotation.z.toFixed(3) });
  const out = { ok: rig.ok, osTrouves: rig.bones.size, avant: euler() };
  rig.frozen = false;
  for (let i = 0; i < 60; i++) rig.update(0.016, 0, 8, 'grounded', 0);   // course a l'arret
  out.apres_idle = euler();
  for (let i = 0; i < 60; i++) rig.update(0.016, 7, 8, 'grounded', 0);   // pleine course
  out.apres_course = euler();
  out.repos_enregistre = (() => { const q = rig.rest.get('LeftArm'); return q ? { x: +q.x.toFixed(3), y: +q.y.toFixed(3), z: +q.z.toFixed(3), w: +q.w.toFixed(3) } : null; })();
  return out;
}), null, 2));
await browser.close();
