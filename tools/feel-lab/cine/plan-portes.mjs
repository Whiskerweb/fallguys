/**
 * PLAN PORTES — la camera traverse les sept murs, et chaque porte qu'elle vise EXPLOSE
 * juste avant son passage.
 *
 * ── LA PORTE SE CASSE POUR DE VRAI ──────────────────────────────────────────────
 * Rien n'est anime a la main. La regle du mini-jeu casse une porte franchissable quand un
 * point de reference — le joueur, en partie — arrive a 1,25 m d'elle. On se contente donc
 * de lui donner un AUTRE point : un « ouvreur » invisible qui precede la camera de quatre
 * metres sur son propre rail. La rupture qu'on filme est celle du jeu, avec ses neuf
 * quartiers de papier, sa gerbe de confettis a la teinte de la porte et l'onde de choc qui
 * fait fremir ses voisines. Une animation recopiee dans le harnais aurait diverge du jeu
 * a la premiere retouche.
 *
 * Et comme l'ouvreur suit exactement la trajectoire de la camera, SEULE la porte qu'on
 * traverse cede. Les autres restent intactes dans le champ, ce qui est tout l'interet :
 * un mur dont les six portes explosent ne raconte plus rien.
 *
 * ── DEUX REGLAGES DU JEU QU'IL FAUT DESACTIVER ──────────────────────────────────
 * `masquerMurs` efface le mur que la CAMERA traverse, a 3,2 m. C'est indispensable en
 * partie — sinon un panneau remplit l'ecran au moment ou le joueur doit lire le mur
 * suivant — et c'est exactement ce qu'il ne faut pas ici : le mur disparaitrait juste
 * avant qu'on le franchisse. On passe donc `camera = null` a `arena.update`, ce qui
 * neutralise la fonction sans y toucher.
 *
 * Usage :
 *   node cine/plan-portes.mjs
 *   node cine/plan-portes.mjs --apercu     # huit images, pas de video
 */
import fs from 'node:fs/promises';
import {
  ouvrirScene, preparer, monterEpreuve, brouillard, releverRail,
  tourner, poser, avancer, capturer, encoder,
  SORTIE, IMAGES, FPS,
} from './noyau.mjs';
import { FOV, profil, courbe, lerp } from './cadrage.mjs';

const apercu = process.argv.includes('--apercu');
const rupture = process.argv.includes('--rupture');

const GRAINE = 4242;
const DUREE = 17;
/*
 * Distance dont l'ouvreur precede la camera : c'est elle qui regle le TEMPS de la rupture.
 *
 * A 4,2 m, la porte se dechirait deux dixiemes de seconde avant le passage — six images,
 * de quoi voir un eclair de papier, pas une porte qui explose. A sept metres, elle cede
 * une demi-seconde avant : on voit la dechirure s'ouvrir, les quartiers partir vers nous,
 * et on traverse le nuage.
 */
const AVANCE = 7;
/** Hauteur de la porte : son centre est a mi-hauteur du panneau (`doors.js`). */
const DEMI_PORTE = 2.1;
/*
 * On vole un demi-metre AU-DESSUS du centre des portes.
 *
 * Pile au centre, le mur se posait dans la moitie haute du cadre et les quarante pour
 * cent du bas n'etaient que du sol. La porte fait 4,2 m : un demi-metre plus haut, on
 * reste largement dans le passage et le mur vient au milieu de l'image.
 */
const SURELEVATION = 0.5;
/*
 * Roulis maximal, en radians.
 *
 * A 0,11 (six degres) la camera n'avait pas l'air de s'inscrire dans son virage : elle
 * avait l'air DE TRAVERS. Un mur de portes est une ligne horizontale franche qui occupe
 * toute la largeur du cadre, et l'oeil la prend pour l'horizon — la moindre inclinaison
 * s'y lit comme un defaut de cadrage, pas comme du mouvement. Quatre degres suffisent a
 * donner de la vie sans mettre le mur de biais.
 */
const ROULIS_MAX = 0.07;
/** Distance a laquelle la camera regarde devant elle. Voir `pose`. */
const REGARD = 6;
/** Longueur du couloir droit de part et d'autre d'un mur. Voir les points de calage. */
const CALAGE = 5;

const { page, fermer } = await ouvrirScene({
  largeur: 1920, hauteur: 1080, params: `&graine=${GRAINE}`,
});
await preparer(page);
const a = await monterEpreuve(page, 'doors', { cacherJoueur: true });
await brouillard(page, 110, 420);

const murs = await page.evaluate(() => window.__probeGame().arena.__murs());
const rail = await releverRail(page);

/*
 * PRENDRE LA MAIN SUR LE POINT DE RUPTURE.
 *
 * `game.update` appelle `arena.update(elapsed, dt, focus, camera, enJeu)` avec la position
 * du joueur et la camera du jeu. On enveloppe la methode pour lui substituer l'ouvreur, et
 * pour lui passer `camera = null` — deux valeurs, aucune ligne de la scene modifiee.
 */
await page.evaluate(() => {
  const arene = window.__probeGame().arena;
  const rendre = arene.update.bind(arene);
  window.__cineOuvreur = null;
  arene.update = (elapsed, dt, focus, camera, enJeu) =>
    rendre(elapsed, dt, window.__cineOuvreur ?? focus, null, enJeu);
});

/**
 * Le sol sous une cote Z, lu sur le rail. Sert aux deux extremites du vol, qui tombent
 * hors des murs : le couloir descend par paliers, une hauteur fixe y passerait sous terre.
 */
const solEn = (z) => {
  const pts = rail;
  if (z >= pts[0].z) return pts[0].y;
  if (z <= pts[pts.length - 1].z) return pts[pts.length - 1].y;
  for (let i = 1; i < pts.length; i++) {
    if (z >= pts[i].z) {
      const f = (pts[i - 1].z - z) / (pts[i - 1].z - pts[i].z);
      return lerp(pts[i - 1].y, pts[i].y, f);
    }
  }
  return pts[pts.length - 1].y;
};

/*
 * CHOIX DES PORTES — c'est lui qui dessine le zigzag.
 *
 * On ne prend pas la porte la plus ecartee : entre deux murs distants de huit metres, un
 * ecart de douze metres se lit comme un coup de volant, pas comme un vol. On vise donc un
 * deplacement lateral PROPORTIONNEL a la distance qui separe les deux murs, et on penalise
 * la porte qui repartirait du meme cote que la precedente — un zigzag change de bord.
 */
let xPrec = 0, signePrec = 0, zPrec = murs[0].z + 30;
const passages = [];
for (const m of murs) {
  const ecartVoulu = Math.min(11, Math.abs(m.z - zPrec) * 0.45);
  let meilleure = null, meilleurScore = Infinity;
  for (const x of m.xOuvertes) {
    const dx = x - xPrec;
    const score = Math.abs(Math.abs(dx) - ecartVoulu) + (Math.sign(dx) === signePrec ? 3.5 : 0);
    if (score < meilleurScore) { meilleurScore = score; meilleure = x; }
  }
  if (meilleure == null) continue;
  passages.push({ x: meilleure, y: m.y + DEMI_PORTE + SURELEVATION, z: m.z });
  signePrec = Math.sign(meilleure - xPrec);
  xPrec = meilleure;
  zPrec = m.z;
}

/*
 * Le rail de vol. Deux points de calage de part et d'autre de chaque mur, a la meme cote
 * laterale : sans eux la courbe aborde le plan des portes en biais et la camera frole le
 * montant. On traverse une porte tout droit ou on ne la traverse pas.
 */
const points = [
  { x: 0, y: solEn(26) + 2.6, z: 26 },
  { x: 0, y: solEn(18) + 2.6, z: 18 },
];
for (const p of passages) {
  points.push({ x: p.x, y: p.y, z: p.z + CALAGE });
  points.push({ x: p.x, y: p.y, z: p.z });
  points.push({ x: p.x, y: p.y, z: p.z - CALAGE });
}
points.push({ x: 0, y: solEn(a.finishZ - 6) + 2.8, z: a.finishZ - 6 });
points.push({ x: 0, y: solEn(a.finishZ - 18) + 3.4, z: a.finishZ - 18 });

const vol = courbe(points);
const marche = profil(0.13);

console.log(`portes traversees : ${passages.map((p) => `z${p.z}@x${p.x.toFixed(1)}`).join('  ')}`);
console.log(`longueur du vol : ${vol.longueur.toFixed(0)} m sur ${DUREE} s`);

/** Position sur le rail, plus la meme un peu plus loin : c'est elle qu'on regarde. */
const surLeRail = (u) => vol.point(Math.min(1, Math.max(0, u)));
/** Fraction de rail equivalente a une distance en metres. */
const enFraction = (m) => m / vol.longueur;

/*
 * OU REGARDE LA CAMERA.
 *
 * Premier essai : neuf metres devant, sur le rail. A cinq metres d'un mur, le point vise
 * etait donc DERRIERE lui, deja en train de derber vers la porte suivante — la camera
 * abordait chaque mur de biais et ne montrait pas la porte qu'elle allait franchir. Le
 * regard est ramene a six metres, et sa composante laterale est ramenee des deux tiers
 * vers l'axe de la camera : on suit le mouvement sans quitter des yeux ce qu'on traverse.
 */
const pose = (t) => {
  const u = marche(t);
  const p = surLeRail(u);
  const vise = surLeRail(u + enFraction(REGARD));
  // Roulis proportionnel a la derive laterale : la camera s'inscrit dans son virage.
  const avant = surLeRail(u + enFraction(3));
  const arriere = surLeRail(u - enFraction(3));
  const derive = (avant.x - arriere.x) / 6;
  const roulis = Math.max(-ROULIS_MAX, Math.min(ROULIS_MAX, -derive * 0.9));
  return {
    pos: [p.x, p.y, p.z],
    /*
     * Le regard reste HORIZONTAL, un rien releve.
     *
     * Viser le rail six metres devant faisait piquer la camera : le couloir descend par
     * paliers, donc le point vise est presque toujours plus bas que la camera. Le mur
     * remontait dans le cadre et le bas de l'image se remplissait de sol.
     */
    look: [lerp(p.x, vise.x, 0.35), p.y + 0.35, vise.z],
    up: [Math.sin(roulis), Math.cos(roulis), 0],
    fov: FOV + 8,          // un champ plus large donne de la vitesse au defilement
    ombre: false,
  };
};

/** Instant du plan (0 a 1) auquel la camera atteint une cote Z donnee. */
const instantEn = (z) => {
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    if (surLeRail(marche(t)).z <= z) return t;
  }
  return 1;
};

/** L'ouvreur precede la camera : c'est lui qui fait ceder la porte, quatre metres avant. */
const pendant = async (i, p) => {
  const t = i < 0 ? 0 : i / (Math.round(DUREE * FPS) - 1);
  const q = surLeRail(marche(t) + enFraction(AVANCE));
  await (p ?? page).evaluate((o) => { window.__cineOuvreur = o; }, { x: q.x, y: q.y, z: q.z });
};

if (apercu || rupture) {
  const dossier = `${SORTIE}/apercu`;
  await fs.mkdir(dossier, { recursive: true });
  const total = Math.round(DUREE * FPS);
  /*
   * Deux facons de juger. `--apercu` etale huit images sur tout le plan : c'est ce qu'il
   * faut pour le cadrage. `--rupture` les concentre autour d'un mur, une image sur trois :
   * une porte casse et disparait en moins d'une seconde, donc un echantillonnage regulier
   * peut traverser les sept murs sans en montrer une seule.
   */
  const debut = rupture ? Math.max(0, Math.round(instantEn(passages[1].z + 11) * (total - 1))) : 0;
  const pas = rupture ? 3 : Math.floor(total / 8);
  let pris = 0;
  for (let i = 0; i < total; i++) {
    await pendant(i, page);
    await poser(page, pose(i / (total - 1)));
    await avancer(page, 1);
    if (i >= debut && (i - debut) % pas === 0 && pris < 8) {
      await capturer(page, `${dossier}/portes${rupture ? '-rupture' : ''}-${pris++}.jpg`);
    }
  }
  console.log('apercu ecrit');
} else {
  const dossier = `${IMAGES}/portes`;
  await fs.rm(dossier, { recursive: true, force: true });
  await tourner(page, { dossier, duree: DUREE, pose, pendant, prechauffe: 6 });
  await encoder(dossier, `${SORTIE}/portes-traversee.mp4`, FPS);
  await fs.rm(dossier, { recursive: true, force: true });
}

fermer();
process.exit(0);
