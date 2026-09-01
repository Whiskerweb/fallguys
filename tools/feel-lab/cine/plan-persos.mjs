/**
 * PLAN PERSONNAGE — un plan identique par personnage, pour pouvoir les couper bout a
 * bout au montage.
 *
 * Le personnage court VERS la camera, qui recule devant lui a sa vitesse : il reste au
 * meme endroit dans le cadre pendant que le decor defile derriere. C'est le plan qui
 * montre a la fois la silhouette de face et l'animation de course.
 *
 * ── POURQUOI LES CINQ PLANS SE SUPERPOSENT EXACTEMENT ───────────────────────────
 * Le choix du personnage ne touche que le VISUEL : le controleur, la capsule de collision
 * et le reglage sont les memes pour tous. A meme carte, meme graine et memes touches, les
 * cinq courses sont donc la meme course a l'unite pres, et la camera — qui est calee sur
 * la position du personnage — decrit cinq fois le meme mouvement. Un montage peut les
 * substituer image par image.
 *
 * Le personnage se choisit avant le chargement de la page (voir `ouvrirScene`), ce qui
 * impose une page par personnage : c'est le prix d'emprunter le vrai chemin de code.
 *
 * Usage :
 *   node cine/plan-persos.mjs                    # les cinq
 *   node cine/plan-persos.mjs char-grenouille    # un seul
 *   node cine/plan-persos.mjs --apercu           # six images par personnage
 */
import fs from 'node:fs/promises';
import {
  ouvrirScene, preparer, monterEpreuve, brouillard,
  tourner, poser, avancer, capturer, encoder,
  SORTIE, IMAGES, FPS,
} from './noyau.mjs';
import { FOV, lerp, seuil } from './cadrage.mjs';

const args = process.argv.slice(2);
const apercu = args.includes('--apercu');
const voulus = args.filter((a) => !a.startsWith('--'));

/** Meme terrain, meme graine, meme depart pour les cinq : c'est ce qui rend les plans substituables. */
const EPREUVE = 'course';
const GRAINE = 4242;
/*
 * Les obstacles mobiles sont ECARTES, et c'est un choix de plan, pas une facilite.
 *
 * Ce plan montre une SILHOUETTE et une animation de course, pas une partie. Le premier
 * essai a ete tourne sur le parcours complet : un rouleau est passe entre la camera et le
 * personnage sur deux plans sur six, et un ballon l'a couche au troisieme. Aucun des cinq
 * plans n'aurait alors ete substituable a un autre, ce qui est justement leur seule raison
 * d'exister. Le jeu tel qu'il se joue est montre par `plan-jeu.mjs`, obstacles compris.
 */
const SANS_OBSTACLES = 'rollers,balls,hammers,pendulums,spinners,bumpers';
const DUREE = 7;
const ATTENTE = 0.55;          // secondes d'immobilite avant le depart

/** Cadrage. Distances en metres, mesurees depuis le personnage. */
const RECUL_DEBUT = 6.2;       // au repos : on le voit en pied, avec du terrain autour
const RECUL_FIN = 4.0;         // en course : on se rapproche du buste
const HAUTEUR = 1.35;          // hauteur d'oeil de la camera au-dessus de ses pieds
const REGARD = 0.75;           // point vise sur le corps
const ARC = 0.24;              // radians balayes lateralement, pour que le plan respire

const modeles = [
  'char-babytrump', 'char-techtitan', 'char-grenouille', 'char-diplomate', 'char-captainleeky',
];
const choisis = modeles.filter((m) => !voulus.length || voulus.includes(m));

for (const modele of choisis) {
  const { page, fermer } = await ouvrirScene({
    largeur: 1920, hauteur: 1080,
    params: `&graine=${GRAINE}&skip=${SANS_OBSTACLES}`,
    stockage: { 'tumble-model': modele },
  });
  await preparer(page);
  await monterEpreuve(page, EPREUVE);
  // Brouillard de plan rapproche : c'est lui qui met de l'air entre le personnage et le
  // fond. Celui des plans larges commence a 600 m et n'aurait aucun effet ici.
  await brouillard(page, 90, 340);

  /*
   * La camera est calee sur la position REELLE du personnage, relue a chaque image, et
   * non sur une trajectoire calculee d'avance. Un lissage exponentiel absorbe les
   * micro-secousses du solveur : sans lui, la capsule vibre d'un centimetre par pas de
   * physique et le cadre tremble.
   */
  let suivi = null;
  const pose = async (t) => {
    const p = await page.evaluate(() => {
      const c = window.__probeGame().character;
      return [c.position.x, c.position.y, c.position.z];
    });
    suivi = suivi ? suivi.map((v, i) => lerp(v, p[i], 0.35)) : p;
    const [x, y, z] = suivi;
    const avance = seuil(ATTENTE / DUREE, 0.75, t);
    const recul = lerp(RECUL_DEBUT, RECUL_FIN, avance);
    const angle = lerp(-ARC, ARC, t);           // le balayage lateral court sur tout le plan
    return {
      // Le personnage avance vers les Z decroissants : la camera se place DEVANT lui,
      // donc a un Z plus petit, et regarde en arriere.
      pos: [x + Math.sin(angle) * recul, y + HAUTEUR, z - Math.cos(angle) * recul],
      look: [x, y + REGARD, z],
      fov: FOV,
      ombre: true,
    };
  };

  /** Le depart : on maintient la touche « avancer », comme un joueur le ferait. */
  const pendant = async (i) => {
    if (i !== Math.round(ATTENTE * FPS)) return;
    await page.evaluate(() => {
      dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    });
  };

  console.log(`\n${modele}`);

  if (apercu) {
    const dossier = `${SORTIE}/apercu`;
    await fs.mkdir(dossier, { recursive: true });
    const total = Math.round(DUREE * FPS);
    for (let i = 0; i < total; i++) {
      await pendant(i);
      await poser(page, await pose(i / (total - 1)));
      await avancer(page, 1);
      if (i % Math.round(total / 6) === 0 && i / Math.round(total / 6) < 6) {
        await capturer(page, `${dossier}/${modele}-${i / Math.round(total / 6)}.jpg`);
      }
    }
    process.stdout.write('  apercu ecrit\n');
    fermer();
    continue;
  }

  const dossier = `${IMAGES}/perso-${modele}`;
  await fs.rm(dossier, { recursive: true, force: true });
  /*
   * Quarante images de prechauffe, et non dix.
   *
   * Le personnage apparait en l'air et retombe : l'atterrissage souleve une bouffee de
   * poussiere qui le masquait entierement pendant la premiere demi-seconde des cinq
   * plans — soit exactement le moment ou on le decouvre. On laisse la poussiere retomber
   * avant la premiere image gardee.
   */
  await tourner(page, { dossier, duree: DUREE, pose, pendant, prechauffe: 40 });
  await encoder(dossier, `${SORTIE}/perso-${modele}.mp4`, FPS);
  await fs.rm(dossier, { recursive: true, force: true });
  fermer();
}

process.exit(0);
