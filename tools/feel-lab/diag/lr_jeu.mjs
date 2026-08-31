/**
 * Captures A HAUTEUR DE JOUEUR, avec la camera du JEU.
 *
 * Tous mes apercus precedents placaient la camera a la main, loin et haut : ils montraient
 * la geometrie, pas la partie. Or ce que le joueur voit, c'est le cadrage du jeu depuis le
 * personnage — et c'est la que les defauts de decor se voient.
 *
 * Usage : node diag/lr_jeu.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
const PORT = process.env.FEELLAB_PORT ?? '5273';
await fs.mkdir('shots/lr', { recursive: true });
browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1400,height:800} });
page.setDefaultTimeout(240000);
await page.goto(`http://127.0.0.1:${PORT}/?nointro&graine=7777`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>{const l=document.getElementById('loading');return l&&getComputedStyle(l).display==='none';},{timeout:300000});
await page.evaluate(()=>{const g=window.__probeGame();const j=window.__MINIGAMES.find(m=>m.id==='rondin');g.partie={parcours:[j],index:0,temps:[],chutes:0};g.startRace();});
await page.waitForFunction(()=>(window.__probeGame?.()?.runTime??0)>0.3,{timeout:240000});

const points = await page.evaluate(()=>{
  const a = window.__probeGame().arena;
  const s = a.__sections();
  const out = [['depart', a.spawn.z]];
  s.forEach((sec,i)=>out.push([`${i}-${sec.type}`, sec.z0 - (sec.z0-sec.z1)*0.35]));
  out.push(['arrivee', a.finishZ + 6]);
  return out;
});
for (const [nom, z] of points) {
  await page.evaluate(({z})=>{
    const g = window.__probeGame(), c = g.arena.__cotes();
    g.character.respawn({ x: 0, y: c.CRETE + 1.2, z });
    g.snapCamera = true;
  }, { z });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/lr/${nom}.png` });
  console.log(`OK  ${nom}  z=${z.toFixed(0)}`);
}
await browser.close();
