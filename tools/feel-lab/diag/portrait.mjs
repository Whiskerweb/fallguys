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
// `alpha=1` : le portrait sort DETOURE, pour que la tuile de la vitrine puisse poser sa
// propre couleur de rarete derriere le personnage.
await page.goto(`http://127.0.0.1:5273/viewer.html?m=${modele}.glb&alpha=1`, { waitUntil: 'domcontentloaded' });
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
  /*
   * Le plancher en hauteur n'est PAS decoratif : sans lui, un personnage etroit est colle
   * a la caméra. Le cadrage est pilote par l'envergure, ce qui va tant que les silhouettes
   * se ressemblent ; Captain Leeky, tout en verticalite (1,19 m d'envergure contre 1,43 a
   * 1,64 pour les autres), se retrouvait coupe au niveau du torse quand ses voisins
   * montrent la tete ET le buste. L'ancien plancher — 0,78 fois la hauteur — ne se
   * declenchait jamais : la branche largeur le depassait pour les cinq personnages, il ne
   * gardait rien. Il vaut desormais le rapport le plus serre observe dans le catalogue,
   * donc il ne change le cadrage d'aucun personnage existant et rattrape les etroits.
   */
  const distance = Math.max(largeur * 1.9, hauteur * 1.6);
  cam.position.set(0, centre, distance);
  cam.lookAt(0, centre, 0);
  cam.fov = 42;
  cam.updateProjectionMatrix();
  document.getElementById('info').style.display = 'none';
}, { clip, fraction, hauteur, largeur });
await page.waitForTimeout(350);

const dest = `public/icons/port-${modele}.png`;
const brut = await page.screenshot({ omitBackground: true });

/*
 * RECADRAGE SUR LE SUJET, pas sur la fenetre.
 *
 * Le cadrage camera est calcule a partir des dimensions du modele, mais celles-ci varient
 * du simple au double d'un personnage a l'autre : Captain Leeky mesure 1,19 m d'envergure
 * la ou la Grenouille en fait 1,64. Rendus dans la meme fenetre, les uns remplissaient
 * leur tuile et les autres flottaient au milieu d'un grand vide. On mesure donc la boite
 * REELLE des pixels opaques et on recoupe un carre dessus : les cinq vignettes se
 * ressemblent enfin, quelle que soit la silhouette.
 */
const recadre = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const mesure = document.createElement('canvas');
  mesure.width = img.width; mesure.height = img.height;
  const m = mesure.getContext('2d');
  m.drawImage(img, 0, 0);
  const px = m.getImageData(0, 0, mesure.width, mesure.height).data;

  let gauche = mesure.width, haut = mesure.height, droite = -1, bas = -1;
  for (let y = 0; y < mesure.height; y++) {
    for (let x = 0; x < mesure.width; x++) {
      // Seuil et non zero : le bord anticrenele du modele laisse des pixels a alpha 1 ou 2.
      if (px[(y * mesure.width + x) * 4 + 3] <= 12) continue;
      if (x < gauche) gauche = x;
      if (x > droite) droite = x;
      if (y < haut) haut = y;
      if (y > bas) bas = y;
    }
  }
  if (droite < 0) return b64;  // image vide : on rend le brut plutot que rien.

  const cote = Math.round(Math.max(droite - gauche + 1, bas - haut + 1) * 1.12);
  const cx = (gauche + droite) / 2, cy = (haut + bas) / 2;
  const sortie = document.createElement('canvas');
  sortie.width = sortie.height = 512;
  const s = sortie.getContext('2d');
  s.imageSmoothingQuality = 'high';
  s.drawImage(img, cx - cote / 2, cy - cote / 2, cote, cote, 0, 0, 512, 512);
  return sortie.toDataURL('image/png').split(',')[1];
}, brut.toString('base64'));

await fs.writeFile(dest, Buffer.from(recadre, 'base64'));
const { size } = await fs.stat(dest);
console.log(`${dest} · ${Math.round(size / 1024)} Ko`);

// Le manifeste reflete le CONTENU du dossier : regenerer un portrait ne doit pas
// effacer les autres de la liste.
const dir = 'public/icons';
const liste = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort();
await fs.writeFile(`${dir}/manifest.json`, JSON.stringify(liste, null, 2));
console.log(`manifeste icones : ${liste.length} entrees`);
await browser.close();
