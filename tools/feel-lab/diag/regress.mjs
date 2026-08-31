/** Non-regression : chaque personnage se charge, court, et ne produit aucune erreur console. */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
let ko = 0;
for (const id of process.argv.slice(2)) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 120)); });
  page.on('pageerror', (e) => erreurs.push('PAGE ' + String(e).slice(0, 120)));
  await page.addInitScript((m) => localStorage.setItem('tumble-model', m), id);
  await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
  await page.waitForTimeout(700);
  await page.keyboard.press('Enter');
  /*
   * Le chrono s'affiche en mm:ss:cs. `parseFloat` sur « 00:00:00 » rend donc 0 quoi qu'il
   * arrive : l'attente d'origine ne se debloquait qu'a la minute pleine — « 01:02:03 »
   * rend 1 — c'est-a-dire par accident. On lit les trois champs.
   */
  await page.waitForFunction(() => {
    const [m, s, cs] = (document.getElementById('timer')?.textContent ?? '').split(':').map(Number);
    return Number.isFinite(cs) && m * 60 + s + cs / 100 > 0.3;
  }, { timeout: 60000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  const etat = await page.evaluate(() => {
    const c = window.__probeCharacter?.();
    // On lit le CORPS physique, pas le conteneur d'affichage : celui-ci n'est
    // synchronise qu'au rendu et renvoyait un z fige a 0, donnant a croire que le
    // personnage n'avait pas bouge alors qu'il courait normalement.
    if (!c) return null;
    const t = c.body.translation();
    return { z: +t.z.toFixed(1), etat: c.state, os: c.rig?.bones.size ?? 0 };
  });
  const verdict = erreurs.length ? 'ERREURS' : 'ok';
  if (erreurs.length) ko++;
  console.log(id.padEnd(15), verdict.padEnd(8), JSON.stringify(etat), erreurs.slice(0, 2).join(' | '));
  await page.close();
}
await browser.close();
process.exit(ko ? 1 : 0);
