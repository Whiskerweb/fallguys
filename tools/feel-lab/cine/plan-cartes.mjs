/**
 * PLAN DE CARTE — une video par epreuve : la camera fait le tour du terrain en le
 * remontant, du depart a l'arrivee.
 *
 * Le mouvement est une HELICE (voir `cadrage.mjs`) : orbite et survol menes ensemble
 * plutot que raccordes. Rien n'est ecrit en dur — le rayon vient de la taille mesuree de
 * la carte, la trajectoire d'un releve au rayon dans le monde physique.
 *
 * Le joueur est masque : ces plans presentent un TERRAIN. Les personnages ont les leurs.
 *
 * Usage :
 *   node cine/plan-cartes.mjs                 # les cinq cartes, en video
 *   node cine/plan-cartes.mjs course rondin   # seulement celles-la
 *   node cine/plan-cartes.mjs --apercu        # six images par carte, pas de video :
 *                                             # juger le cadrage sans tourner 3 000 images
 */
import fs from 'node:fs/promises';
import {
  ouvrirScene, preparer, monterEpreuve, decorLarge, releverRail,
  tourner, poser, avancer, capturer, encoder, brouillard,
  SORTIE, IMAGES, FPS,
} from './noyau.mjs';
import { rayonDeCadrage, helice } from './cadrage.mjs';

const args = process.argv.slice(2);
const apercu = args.includes('--apercu');
const voulus = args.filter((a) => !a.startsWith('--'));

/** Duree de chaque plan, en secondes. Une carte longue merite un peu plus de temps. */
const DUREE = 22;
const GRAINE = 4242;

/**
 * Use les deux etages du haut de L'Hexagone : on promene le personnage (invisible) sur
 * un hexagone sur trois, en laissant tourner le jeu entre deux poses, puis on attend que
 * le sursis expire. Rien n'est simule a la main — c'est la regle du mini-jeu qui fait
 * tomber les tuiles, donc l'image montre un etat que le jeu produit vraiment.
 */
async function creuser(page) {
  const etages = await page.evaluate(() => window.__probeGame().arena.__etages?.().length ?? 0);
  if (!etages) return;
  for (const e of [0, 1]) {
    const n = await page.evaluate((e) => window.__probeGame().arena.__hexas(e).length, e);
    for (let i = 0; i < n; i += 3) {
      await page.evaluate(({ e, i }) => {
        const a = window.__probeGame().arena, c = window.__probeGame().character;
        const h = a.__hexas(e)[i], et = a.__etages()[e];
        c.body.setTranslation({ x: h.x, y: et.y + 0.85, z: h.z }, true);
        c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }, { e, i });
      await avancer(page, 1);
    }
  }
  /*
   * On GELE le personnage au-dessus de la tour.
   *
   * Le laisser tomber le ferait passer sous `killY`, ce qui, sur une epreuve de SURVIE,
   * declenche `perdreManche()` : bandeau ELIMINE, puis retour au lobby trois secondes
   * plus tard — au milieu du plan. Le corps passe donc en statique, hors de portee de la
   * regle, et n'use plus aucun hexagone.
   */
  await page.evaluate(() => {
    const R = window.__RAPIER, a = window.__probeGame().arena, c = window.__probeGame().character;
    c.body.setTranslation({ x: 0, y: a.__etages()[0].y + 30, z: 0 }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    c.body.setBodyType(R.RigidBodyType.Fixed, true);
  });
  await avancer(page, 40);           // le temps que les sursis expirent et que ca tombe
}

const { page, fermer } = await ouvrirScene({ largeur: 1920, hauteur: 1080, params: `&graine=${GRAINE}` });
await preparer(page);

const ids = (await page.evaluate(() => window.__MINIGAMES.map((m) => m.id)))
  .filter((id) => !voulus.length || voulus.includes(id));

for (const id of ids) {
  const a = await monterEpreuve(page, id, { cacherJoueur: true });
  await decorLarge(page, true);
  // Assez de brouillard pour donner de la profondeur au lointain, assez peu pour ne pas
  // effacer une carte de 250 m vue de son extremite.
  await brouillard(page, 620, 2600);

  const [x0, y0, z0, x1, y1, z1] = a.jouable;
  const rayon = rayonDeCadrage(a.jouable);
  const arene = Math.abs(a.spawn[2] - a.finishZ) < 12;

  /*
   * Deux formes de terrain, deux rails.
   *
   * Un parcours se remonte : le rail est sa ligne moyenne, relevee au rayon. Une ARENE
   * n'avance nulle part — son depart et son arrivee sont a la meme cote — mais elle
   * DESCEND : sa hauteur joue le role que la longueur joue ailleurs. Le rail est alors
   * vertical, du sommet de la tour a la boue, et l'helice s'enroule autour.
   */
  const rail = arene
    ? Array.from({ length: 12 }, (_, i) => ({
      x: (x0 + x1) / 2,
      y: y1 - 8 - ((y1 - y0 - 26) * i) / 11,
      z: (z0 + z1) / 2,
    }))
    : await releverRail(page);

  // Une tour intacte ne montre rien de ce que L'Hexagone donne a jouer : ce sont les
  // TROUS qui font l'image. On use les deux etages du haut avant de tourner, comme
  // `diag/hexavues.mjs` le fait avant de photographier.
  if (arene) await creuser(page);

  const centre = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  /*
   * Le rayon de cadrage fait tenir la carte ENTIERE dans l'image, quel que soit l'angle.
   * C'est la bonne mesure pour une photo, pas pour un plan : un ruban de 230 m sur 40
   * cadre en entier n'occupe qu'un bandeau au milieu d'un ecran de verdure. On resserre
   * d'un cinquieme — les extremites sortent du champ sur les angles les plus defavorables,
   * et c'est justement le mouvement qui les montre l'une apres l'autre.
   */
  const cadre = arene ? rayon : rayon * 0.8;
  const pose = helice(rail, cadre, centre, arene
    ? { tours: 1.35, rayonFin: cadre * 0.70, hautDebut: cadre * 0.24, hautFin: 16, azimutDebut: -0.5, regard: 2, bords: 0.18 }
    : { tours: 1, hautDebut: cadre * 0.42, hautFin: 24, azimutDebut: 0, regard: 5, bords: 0.16 });

  console.log(`\n${id} — ${a.nom} · rayon ${rayon.toFixed(0)} m · rail ${rail.length} points${arene ? ' (arene)' : ''}`);

  if (apercu) {
    const dossier = `${SORTIE}/apercu`;
    await fs.mkdir(dossier, { recursive: true });
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      await poser(page, pose(t));
      await avancer(page, 3);
      await capturer(page, `${dossier}/${id}-${i}.jpg`);
      process.stdout.write(`\r    apercu ${i + 1}/6  `);
    }
    process.stdout.write('\n');
    continue;
  }

  const dossier = `${IMAGES}/carte-${id}`;
  await fs.rm(dossier, { recursive: true, force: true });
  await tourner(page, { dossier, duree: DUREE, pose, prechauffe: 12 });
  await encoder(dossier, `${SORTIE}/carte-${id}.mp4`, FPS);
  await fs.rm(dossier, { recursive: true, force: true });
}

fermer();
process.exit(0);
