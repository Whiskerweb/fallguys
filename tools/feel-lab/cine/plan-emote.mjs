/**
 * PLAN EMOTE — un personnage seul, de face, sur une animation greffee.
 *
 * Meme mecanique que `plan-danse.mjs` : les fichiers d'emote partagent le squelette a
 * 24 os des personnages du catalogue, donc un `AnimationMixer` relie ses pistes aux os
 * par leur nom, sans ciblage a ecrire. Le `ClipRig` du jeu est gele le temps du plan et
 * l'emote joue sur SON mixeur — deux mixeurs sur le meme squelette se battraient.
 *
 * Ce plan-ci est un PORTRAIT : champ resserre a 40 degres plutot que 50. Un grand angle
 * a trois metres deforme le visage et allonge les bras tendus vers l'objectif, ce qui est
 * exactement ce qu'une emote met en avant. On recule l'objectif et on serre le champ.
 *
 * Usage :
 *   node cine/plan-emote.mjs                              # BabyTrump, emote-cri
 *   node cine/plan-emote.mjs char-grenouille emote-cri
 *   node cine/plan-emote.mjs --apercu
 */
import fs from 'node:fs/promises';
import {
  ouvrirScene, preparer, monterEpreuve, brouillard,
  tourner, poser, avancer, capturer, encoder,
  SORTIE, IMAGES, FPS,
} from './noyau.mjs';
import { profil, lerp, seuil } from './cadrage.mjs';

const args = process.argv.slice(2);
const apercu = args.includes('--apercu');
const positionnels = args.filter((a) => !a.startsWith('--'));
const MODELE = positionnels[0] ?? 'char-babytrump';
const EMOTE = positionnels[1] ?? 'emote-cri';

const GRAINE = 4242;
const EPREUVE = 'course';
const SANS_OBSTACLES = 'rollers,balls,hammers,pendulums,spinners,bumpers';

/** Champ resserre : voir l'en-tete. */
const FOV_PORTRAIT = 40;
const TAN_V = Math.tan((FOV_PORTRAIT / 2) * Math.PI / 180);
/** Part de la hauteur d'image occupee par le personnage, au debut puis a la fin. */
const CADRE_DEBUT = 0.52;
const CADRE_FIN = 0.68;
const TAILLE = 1.6;
/** Arc balaye autour du personnage, en radians. Il donne le volume sans tourner autour. */
const ARC = 0.34;

const { page, fermer } = await ouvrirScene({
  largeur: 1920, hauteur: 1080,
  params: `&graine=${GRAINE}&skip=${SANS_OBSTACLES}`,
});
await preparer(page);
await monterEpreuve(page, EPREUVE, { cacherJoueur: true });
await brouillard(page, 90, 340);
// Rapier ne repond a aucun rayon tant que le monde n'a pas fait un pas.
await avancer(page, 2);

const scene = await page.evaluate(async ({ modele, emote }) => {
  const T = window.__THREE, R = window.__RAPIER, g = window.__probeGame();
  const monde = g.arena.world;
  const z = g.arena.spawn.z - 6;
  const h = monde.castRay(new R.Ray({ x: 0, y: g.arena.spawn.y + 12, z }, { x: 0, y: -1, z: 0 }), 60, true);
  const sol = h ? g.arena.spawn.y + 12 - h.timeOfImpact : g.arena.spawn.y - 0.8;

  const f = window.__probeFigurant(modele, 1.6);
  if (!f) return { erreur: `modele introuvable : ${modele}` };
  const socle = new T.Group(), pivot = new T.Group();
  // yaw 0 regarde vers +Z, et la camera est du cote des Z croissants : il est de face.
  pivot.add(f.model);
  socle.add(pivot);
  socle.position.set(0, sol, z);
  g.view.scene.add(socle);

  let gltf;
  try { gltf = await window.__probeAssets.loader.loadAsync(`/models/${emote}.glb`); }
  catch (e) { return { erreur: `emote illisible : ${e.message}` }; }
  const clip = gltf.animations?.[0];
  if (!clip) return { erreur: 'aucune animation dans le fichier' };
  if (!f.rig.mixer) return { erreur: 'ce personnage n a pas de mixeur de clips' };

  f.rig.frozen = true;
  const action = f.rig.mixer.clipAction(clip);
  action.setLoop(T.LoopRepeat, Infinity);
  action.setEffectiveWeight(1);
  action.play();

  const os = new Set();
  socle.traverse((o) => { if (o.isBone) os.add(o.name); });
  const liees = clip.tracks.filter((t) => os.has(t.name.split('.')[0])).length;

  window.__majEmote = (dt) => f.rig.mixer.update(dt);
  return { z, sol, clip: clip.name, duree: clip.duration, pistes: clip.tracks.length, liees };
}, { modele: MODELE, emote: EMOTE });

if (scene.erreur) { console.error(`ECHEC : ${scene.erreur}`); fermer(); process.exit(1); }
console.log(`${MODELE} + ${EMOTE} — ${scene.clip}, ${scene.duree.toFixed(2)} s, ${scene.liees}/${scene.pistes} pistes liees`);
if (!scene.liees) { console.error('ECHEC : aucune piste ne trouve son os.'); fermer(); process.exit(1); }

/*
 * Duree du plan : on montre l'emote DEUX FOIS quand elle est courte, une fois et demie
 * sinon. Une emote vue une seule fois se lit comme un accident ; vue deux fois, elle se
 * lit comme un geste, et le montage peut couper sur l'une ou l'autre occurrence.
 */
const DUREE = Math.min(14, Math.max(6, scene.duree * (scene.duree < 5 ? 2 : 1.5)));
console.log(`plan de ${DUREE.toFixed(1)} s`);

/** Distance a laquelle le personnage occupe `part` de la hauteur d'image. */
const reculPour = (part) => (TAILLE / part) / (2 * TAN_V);

const marche = profil(0.22);
const pose = (t) => {
  const u = marche(t);
  const recul = lerp(reculPour(CADRE_DEBUT), reculPour(CADRE_FIN), u);
  const angle = lerp(-ARC, ARC, u);
  const haut = lerp(1.25, 1.05, seuil(0.1, 1, u));
  return {
    pos: [Math.sin(angle) * recul, scene.sol + haut, scene.z + Math.cos(angle) * recul],
    look: [0, scene.sol + 0.92, scene.z],
    fov: FOV_PORTRAIT,
  };
};

const pendant = async (i, p) => {
  await (p ?? page).evaluate((dt) => window.__majEmote(dt), 1 / FPS);
};

const nom = `emote-${MODELE.replace(/^char-/, '')}-${EMOTE.replace(/^emote-/, '')}`;

if (apercu) {
  const dossier = `${SORTIE}/apercu`;
  await fs.mkdir(dossier, { recursive: true });
  const total = Math.round(DUREE * FPS);
  const pas = Math.floor(total / 8);
  let pris = 0;
  for (let i = 0; i < total; i++) {
    await pendant(i, page);
    await poser(page, pose(i / (total - 1)));
    await avancer(page, 1);
    if (i % pas === 0 && pris < 8) await capturer(page, `${dossier}/${nom}-${pris++}.jpg`);
  }
  console.log('apercu ecrit');
} else {
  const dossier = `${IMAGES}/${nom}`;
  await fs.rm(dossier, { recursive: true, force: true });
  await tourner(page, { dossier, duree: DUREE, pose, pendant, prechauffe: 8 });
  await encoder(dossier, `${SORTIE}/${nom}.mp4`, FPS);
  await fs.rm(dossier, { recursive: true, force: true });
}

fermer();
process.exit(0);
