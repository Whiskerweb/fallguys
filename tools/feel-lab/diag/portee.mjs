/**
 * Quelle distance un saut couvre-t-il REELLEMENT ?
 *
 * La map dimensionnait ses fosses avec PORTEE = vitesseMax x tempsDeVol, une formule de
 * projectile parfait. Les fosses se rataient pourtant de 30 cm. On mesure donc au lieu
 * de calculer : course lancee sur piste plate, saut, distance decollage -> contact.
 */
import { chromium } from 'playwright';
let browser;
process.on('exit', () => { try { browser?.close(); } catch {} });
browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 460 } });
page.setDefaultTimeout(600000);
await page.goto('http://127.0.0.1:5273/?lowfx&noassets&skip=scenery', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 600000 });
await page.evaluate(() => {
  const g = window.__probeGame();
  g.partie = { parcours: [window.__MINIGAMES.find((m) => m.id === 'course')], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 600000 });

const r = await page.evaluate(() => new Promise((resolve) => {
  const g = window.__probeGame(), c = g.character;
  const k = (code, bas) => dispatchEvent(new KeyboardEvent(bas ? 'keydown' : 'keyup', { code, bubbles: true }));
  const mesures = [];
  let phase = 'lance', t = 0, depart = null, vDepart = 0;
  k('ArrowUp', true);
  const tick = () => {
    const p = c.body.translation(), v = c.body.linvel();
    t++;
    if (phase === 'lance') {
      // Piste plate de l'acte 2 : on attend d'y etre, lance, avant de sauter.
      if (p.z < -26 && c.state === 'grounded' && Math.abs(v.z) > 7.0) {
        phase = 'saut'; depart = { z: p.z, y: p.y }; vDepart = Math.abs(v.z);
        k('Space', true); setTimeout(() => k('Space', false), 90);
      }
    } else if (phase === 'saut') {
      if (c.state === 'grounded' && t > 12) {
        mesures.push({ portee: +(depart.z - p.z).toFixed(2), vitesse: +vDepart.toFixed(2) });
        if (mesures.length >= 4) { k('ArrowUp', false); return resolve(mesures); }
        phase = 'lance'; t = 0;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(() => resolve(mesures), 120000);
}));
const p = r.map((m) => m.portee);
console.log('portees mesurees :', p.join(' m, '), 'm');
console.log('vitesse au decollage :', r.map((m) => m.vitesse).join(', '), 'm/s');
if (p.length) console.log(`portee mediane : ${p.sort((a,b)=>a-b)[Math.floor(p.length/2)]} m  (formule : 5.66 m)`);
await browser.close();
