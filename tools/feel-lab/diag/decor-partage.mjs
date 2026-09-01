/**
 * LE DÉCOR EST PARTAGÉ — une porte cassée par un joueur l'est chez tous les autres.
 *
 * Le défaut que ce harnais surveille a été trouvé en jouant, pas en mesurant : « quand un
 * joueur va casser une porte, l'autre ne va pas voir la porte cassée. Il va voir le
 * personnage partir à travers la porte. »
 *
 * La cause était nette : le serveur passait TOUTES les positions à `arena.update`, le
 * client seulement la sienne. Chacun voyait donc un monde intact traversé par des
 * fantômes. Trois cartes en dépendent — Les Portes, Les Dalles, L'Hexagone : ce sont les
 * trois à terrain interactif.
 *
 * Le montage isole la question : UN SEUL joueur avance, l'autre ne bouge pas du tout. Si
 * l'immobile voit les mêmes portes brisées que celui qui les enfonce, le décor est
 * réellement partagé — et pas seulement chez celui qui agit.
 *
 * Aucun serveur à lancer d'avance ; il faut que le jeu soit compilé.
 *   cd tools/feel-lab && npm run build && node diag/decor-partage.mjs
 */
import { chromium } from 'playwright';
import { demarrerServeur } from '../../../serveur/src/serveur.js';
const s = await demarrerServeur({ port: 0,
  politique: { nom:'DUEL_TEST', cible:2, minimum:2, attente:1, proposerApres:1, bots:'jamais', dureeManche:300 },
  graine: 20260901 });   // graine qui tire « doors »
const BASE = `http://127.0.0.1:${s.port}`;
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const erreursPage = [];
const pages = [];
for (const nom of ['fonceur','temoin']) {
  const page = await browser.newPage({ viewport:{width:800,height:500} });
  page.setDefaultTimeout(300000);
  page.on('pageerror', e => { erreursPage.push(`${nom}: ${String(e).slice(0,120)}`); });
  await page.goto(`${BASE}/?lowfx&nointro&noassets`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout:300000 });
  await page.click('#btn-enligne');
  await page.waitForFunction(() => document.getElementById('enligne-url').value.includes(location.host), { timeout:20000 });
  await page.fill('#enligne-nom', nom);
  await page.click('#enligne-jouer');
  pages.push({ nom, page });
}
const [A, B] = pages;
for (const { page } of pages) await page.waitForFunction(() => window.__probeGame()?.mode === 'racing', { timeout:120000 });
const carte = await A.page.evaluate(() => window.__probeGame().jeuId);
console.log('carte :', carte);
if (carte !== 'doors') { console.log('pas la bonne carte, on abandonne'); await browser.close(); await s.arreter(); process.exit(1); }
for (const { page } of pages) await page.waitForFunction(() => window.__probeGame().countdown <= 0, { timeout:180000 });

let ko = 0;
const dit = (ok, texte) => { if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };

const brisees = (p) => p.page.evaluate(() => window.__probeGame().arena.__portes().filter(x => x.brisee).length);
const posA = () => A.page.evaluate(() => {
  const p = window.__probeGame().character?.body.translation();
  return p ? { x: p.x, y: p.y, z: p.z } : null;
});

dit(await brisees(A) === 0 && await brisees(B) === 0, 'au depart, aucune porte n\'est brisee des deux cotes');

// SEUL A avance. B ne bouge pas du tout : ce qu'il voit ceder ne peut venir que de A.
await A.page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { code:'ArrowUp', bubbles:true })));

let accords = 0;
let pire = 0;
for (let i = 0; i < 8; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const [a, b] = [await brisees(A), await brisees(B)];
  const p = await posA();
  if (!p) break;
  pire = Math.max(pire, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
  if (a > 0 && a === b) accords++;
  console.log(`     t${(i*5).toString().padStart(3)}  celui qui fonce : ${a} brisees, z=${p.z.toFixed(1)}`
    + `  ·  l'immobile : ${b}${a === b ? '   identiques' : '   DIVERGENCE'}`);
}

dit(accords >= 5, `les deux clients voient les memes portes brisees (${accords} releves sur 8)`);

/*
 * ET LA PHYSIQUE NE DOIT PAS EXPLOSER.
 *
 * Corriger a chaque image un personnage coince contre une porte faisait s'emballer le
 * solveur : mesure, z = -191 467. Le solo, lui, cale proprement contre la meme porte sans
 * jamais depasser 39 m. Le garde-fou est dans `reconciliation.js` ; ce verdict le surveille.
 */
dit(pire < 500, `aucune coordonnee absurde : maximum vu ${pire.toFixed(0)} m`);

dit(erreursPage.length === 0, erreursPage.length
  ? `erreurs de page : ${[...new Set(erreursPage)].join(' | ')}`
  : 'aucune erreur de page');

console.log(`\n--- ${ko === 0 ? 'aucun ecart' : `${ko} ECHEC(S)`} ---`);
await browser.close(); await s.arreter();
process.exit(ko ? 1 : 0);
