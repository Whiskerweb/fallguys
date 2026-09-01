/**
 * SONDE — avant de tourner quoi que ce soit : quelle est la taille REELLE de chaque
 * carte, et combien coute une image ?
 *
 * Les constantes de cadrage ne se devinent pas : une carte fait 220 m de long, une autre
 * tient dans 40. Elles se LISENT ici, une fois, et `plans.mjs` s'en sert. La sonde ecrit
 * aussi une vue de trois quarts par epreuve, pour juger a l'oeil avant de tourner
 * plusieurs milliers d'images.
 *
 * Usage : node cine/sonde.mjs
 */
import fs from 'node:fs/promises';
import { ouvrirScene, preparer, monterEpreuve, avancer, poser, capturer, decorLarge, SORTIE } from './noyau.mjs';

const OUT = `${SORTIE}/sonde`;
await fs.mkdir(OUT, { recursive: true });

const { page, fermer } = await ouvrirScene({ largeur: 1280, hauteur: 720, params: '&graine=4242' });
await preparer(page);

const ids = await page.evaluate(() => window.__MINIGAMES.map((m) => m.id));
const fiches = [];

for (const id of ids) {
  const a = await monterEpreuve(page, id, { cacherJoueur: true });
  const [x0, y0, z0, x1, y1, z1] = a.jouable ?? a.boite;
  const largeur = x1 - x0, hauteur = y1 - y0, profondeur = z1 - z0;
  const centre = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];

  /*
   * Rayon de cadrage. Un demi-champ vertical de 25 degres (fov 50) voit une hauteur
   * `2 * d * tan(25°)` ; on cadre sur la plus grande dimension horizontale vue en
   * diagonale, avec 15 % d'air autour.
   */
  const etendue = Math.hypot(largeur, profondeur) * 0.5;
  const TAN_H = Math.tan((25 * Math.PI) / 180) * (16 / 9);   // demi-champ HORIZONTAL
  const rayon = Math.max(30, (etendue * 1.05) / TAN_H);

  await decorLarge(page, true);
  await poser(page, {
    pos: [centre[0] + rayon * 0.62, centre[1] + rayon * 0.42, centre[2] + rayon * 0.62],
    look: centre,
    fov: 50,
  });
  await avancer(page, 8);

  const t0 = Date.now();
  const N = 8;
  for (let i = 0; i < N; i++) { await avancer(page, 1); await capturer(page, `${OUT}/${id}.jpg`); }
  const cout = (Date.now() - t0) / N;

  fiches.push({ id, nom: a.nom, jouable: a.jouable, checkpoints: a.checkpoints, spawn: a.spawn, finishZ: a.finishZ, killY: a.killY, survie: a.survie, rayon, centre, cout });
  console.log(`${id.padEnd(10)} ${a.nom.padEnd(12)} ` +
    `X[${x0.toFixed(0)},${x1.toFixed(0)}] Y[${y0.toFixed(0)},${y1.toFixed(0)}] Z[${z0.toFixed(0)},${z1.toFixed(0)}]  ` +
    `l${largeur.toFixed(0)} h${hauteur.toFixed(0)} p${profondeur.toFixed(0)}  ` +
    `rayon ${rayon.toFixed(0)} m  ${cout.toFixed(0)} ms/img`);
}

await fs.writeFile(`${OUT}/fiches.json`, JSON.stringify(fiches, null, 2));
console.log(`\nMoyenne : ${(fiches.reduce((s, f) => s + f.cout, 0) / fiches.length).toFixed(0)} ms par image.`);
fermer();
process.exit(0);
