/**
 * Vérifie les animations EN COURSE, état par état.
 * On relève à la fois l'image et l'état interne du personnage : une capture seule ne
 * dit pas si le squelette bouge ou si le corps entier glisse.
 */
import { chromium } from 'playwright';

const model = process.argv[2] ?? 'char-penguin';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((m) => localStorage.setItem('tumble-model', m), model);
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 180000 });
await page.waitForTimeout(1200);

// Expose l'état interne pour pouvoir le lire depuis le test
await page.evaluate(() => {
  const g = window.__game;
  if (!g) return;
});

await page.keyboard.press('Enter');
// On attend que le chrono DEMARRE plutot qu'un delai fixe : en rendu logiciel le temps
// simule avance bien plus lentement que le temps reel, et un delai echantillonnerait
// encore le decompte.
await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3,
  { timeout: 120000 });

const probe = () => page.evaluate(() => {
  const c = window.__probeCharacter?.();
  if (!c) return null;
  const b = c.rig?.bones;
  const arm = b?.get('LeftArm');
  const leg = b?.get('LeftUpLeg');
  return {
    state: c.state,
    rig: !!c.rig,
    bones: b?.size ?? 0,
    armX: arm ? +arm.rotation.x.toFixed(3) : null,
    legX: leg ? +leg.rotation.x.toFixed(3) : null,
    speed: +Math.hypot(c.body.linvel().x, c.body.linvel().z).toFixed(2),
  };
});

const shots = [];
async function step(label, action, wait) {
  await action();
  await page.waitForTimeout(wait);
  const s = await probe();
  await page.screenshot({ path: `shots/anim-${label}.png` });
  shots.push([label, s]);
}

await step('course', async () => { await page.keyboard.down('KeyW'); }, 4000);
await step('course2', async () => {}, 2500);                       // 2e releve : les os doivent avoir bouge
await step('saut', async () => { await page.keyboard.press('Space'); }, 900);
await step('chute', async () => {}, 1800);
await step('plongeon', async () => { await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(120); await page.keyboard.up('ShiftLeft'); }, 1400);
await step('impact', async () => {}, 6000);                       // le temps de percuter un obstacle
await page.keyboard.up('KeyW');

await browser.close();
console.log(`--- ${model} ---`);
for (const [label, s] of shots) {
  console.log(label.padEnd(10), s ? `etat=${String(s.state).padEnd(10)} rig=${s.rig} os=${s.bones} brasX=${s.armX} jambeX=${s.legX} v=${s.speed}` : 'sonde indisponible');
}
if (errors.length) console.log('ERREURS :', errors.slice(0, 3).join(' | '));
