/** Mesure l'OSCILLATION des os pendant une course a vitesse constante.
 *  Des valeurs qui changent entre deux etats ne prouvent rien : il faut voir le cycle
 *  de foulee aller et venir. */
import { chromium } from 'playwright';
const model = process.argv[2] ?? 'char-penguin';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.addInitScript((m) => localStorage.setItem('tumble-model', m), model);
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(900);
await page.keyboard.press('Enter');
await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 120000 });
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);

const res = await page.evaluate(() => new Promise((resolve) => {
  const samples = [];
  let n = 0;
  const tick = () => {
    const c = window.__probeCharacter?.();
    if (c?.rig) {
      const b = c.rig.bones;
      const g = (name) => { const o = b.get(name); return o ? +o.rotation.x.toFixed(4) : null; };
      const v = c.body.linvel();
      samples.push({
        LeftUpLeg: g('LeftUpLeg'), RightUpLeg: g('RightUpLeg'),
        LeftArm: g('LeftArm'), phase: +c.rig.phase.toFixed(3),
        speed: +Math.hypot(v.x, v.z).toFixed(2),
      });
    }
    if (++n < 45) requestAnimationFrame(tick); else resolve(samples);
  };
  tick();
}));
await page.keyboard.up('KeyW');
await browser.close();

const col = (k) => res.map((s) => s[k]).filter((v) => v !== null);
const stats = (k) => {
  const a = col(k);
  if (!a.length) return 'aucune donnee';
  const min = Math.min(...a), max = Math.max(...a);
  return `min=${min.toFixed(3)} max=${max.toFixed(3)} amplitude=${(max - min).toFixed(3)}`;
};
console.log(`--- ${model} · ${res.length} echantillons ---`);
for (const k of ['LeftUpLeg', 'RightUpLeg', 'LeftArm', 'phase', 'speed']) console.log(k.padEnd(12), stats(k));
