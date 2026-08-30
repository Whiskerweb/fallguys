/** Quel axe de rotation de l'os 'LeftArm' rabat le bras le long du corps ?
 *  On mesure l'ecart horizontal main <-> bassin pour chaque axe et chaque signe. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
for (const id of process.argv.slice(2)) {
  const page = await browser.newPage({ viewport: { width: 500, height: 400 } });
  await page.addInitScript((m) => localStorage.setItem('tumble-model', m), id);
  await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const a = window.__probeLobbyAvatar?.(); if (!a?.rig) return 'pas de rig';
    a.rig.frozen = true;
    const arm = a.rig.bones.get('LeftArm'), hand = a.rig.bones.get('LeftHand'), hips = a.rig.bones.get('Hips');
    if (!arm || !hand || !hips) return 'os manquants';
    const rest = arm.quaternion.clone();
    const V = new (arm.position.constructor)();
    const H = new (arm.position.constructor)();
    const ecart = () => {
      a.model.updateWorldMatrix(true, true);
      hand.getWorldPosition(V); hips.getWorldPosition(H);
      return { lat: +Math.abs(V.x - H.x).toFixed(3), haut: +(V.y - H.y).toFixed(3) };
    };
    const out = { repos: ecart() };
    for (const axe of ['x', 'y', 'z']) for (const signe of [1, -1]) {
      arm.quaternion.copy(rest);
      arm.rotation[axe] += signe * 1.28;
      out[`${axe}${signe > 0 ? '+' : '-'}`] = ecart();
    }
    arm.quaternion.copy(rest);
    return out;
  });
  console.log(id, JSON.stringify(r));
  await page.close();
}
await browser.close();
