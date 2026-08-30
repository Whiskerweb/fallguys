/**
 * Fabrique le portrait de vitrine d'un personnage A PARTIR DU MODELE LUI-MEME.
 *
 * Les portraits des autres personnages avaient ete dessines par un generateur d'images :
 * jolis, mais ils ne montraient pas exactement le personnage qu'on incarne. Rendre le
 * modele garantit que la tuile et l'avatar sont la meme chose — et un portrait ne peut
 * plus dater d'une version anterieure du modele.
 *
 * Usage : node diag/portrait.mjs <modele> [clip] [fraction]
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

let browser;
process.on('exit', () => { try { browser?.close(); } catch {} });

const [modele, clip = 'idle', fraction = '0.35'] = process.argv.slice(2);
if (!modele) { console.error('usage: node diag/portrait.mjs <modele> [clip] [fraction]'); process.exit(1); }

browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
await page.goto(`http://127.0.0.1:5273/viewer.html?m=${modele}.glb`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, { timeout: 240000 });

/*
 * Les dimensions viennent du VISUALISEUR, pas d'un calcul maison.
 *
 * Mesurer soi-meme la boite d'un SkinnedMesh ne marche pas : `computeBoundingBox` rend
 * la pose de liaison sans le squelette, et le cadrage obtenu visait le vide. Le
 * visualiseur, lui, affiche deja la bonne taille — on la lui reprend telle quelle.
 */
const dims = (await page.textContent('#info')).match(/dim ([\d.]+) x ([\d.]+) x ([\d.]+)/);
if (!dims) { console.error('dimensions illisibles dans le visualiseur'); await browser.close(); process.exit(1); }
const [, largeur, hauteur, profondeur] = dims.map(Number);
console.log(`modele ${largeur} x ${hauteur} x ${profondeur} m`);

await page.evaluate(({ clip, fraction, hauteur, largeur }) => {
  if (window.__jouer) window.__jouer(clip, parseFloat(fraction));
  const cam = window.__cam;
  // Le visualiseur a recentre le modele sur l'origine : son sommet est a +h/2.
  // On vise le tiers superieur, la ou se lit l'identite du personnage.
  const centre = hauteur * 0.5 - hauteur * 0.22;
  const distance = Math.max(largeur * 1.9, hauteur * 0.78);
  cam.position.set(0, centre, distance);
  cam.lookAt(0, centre, 0);
  cam.fov = 42;
  cam.updateProjectionMatrix();
  document.getElementById('info').style.display = 'none';
}, { clip, fraction, hauteur, largeur });
await page.waitForTimeout(350);

const dest = `public/icons/port-${modele}.png`;
await page.screenshot({ path: dest });
const { size } = await fs.stat(dest);
console.log(`${dest} · ${Math.round(size / 1024)} Ko`);

// Le manifeste reflete le CONTENU du dossier : regenerer un portrait ne doit pas
// effacer les autres de la liste.
const dir = 'public/icons';
const liste = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort();
await fs.writeFile(`${dir}/manifest.json`, JSON.stringify(liste, null, 2));
console.log(`manifeste icones : ${liste.length} entrees`);
await browser.close();
