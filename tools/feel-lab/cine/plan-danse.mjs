/**
 * PLAN DANSE — les cinq personnages alignes, chacun sur sa propre choregraphie.
 *
 * ── LES CLIPS SE GREFFENT, ILS NE SE RECOPIENT PAS ──────────────────────────────
 * Les cinq danses sont livrees dans des glTF a part, avec leur propre maillage dont on ne
 * garde RIEN : seule l'animation nous interesse. Elles s'appliquent telles quelles parce
 * que les personnages du catalogue et les fichiers de danse partagent le meme squelette a
 * 24 os — `Hips`, `Spine`, `LeftUpLeg`… — et qu'un `AnimationMixer` relie ses pistes aux
 * os PAR LEUR NOM. Aucun ciblage a ecrire, aucune conversion : c'est la meme raison qui
 * permet au jeu de monter un unique clip d'attente sur les cinq personnages.
 *
 * Les fichiers vivent dans `public/models/` mais PAS dans le manifeste : le jeu ne les
 * joue jamais, il n'a aucune raison de telecharger six megaoctets de danse au demarrage.
 * Le harnais les charge a la demande, par le chargeur du jeu (`__probeAssets`).
 *
 * ── POURQUOI LE RIG DU JEU EST GELE ─────────────────────────────────────────────
 * Un personnage arrive avec son `ClipRig`, qui melange repos/marche/course selon sa
 * vitesse. Deux mixeurs sur le meme squelette se battraient. On pose donc `frozen` — le
 * rig cesse de pousser ses poids, qui valent zero tant qu'il n'a jamais tourne — et on
 * ajoute la danse SUR SON MIXEUR. Un seul mixeur, une seule animation active.
 *
 * Usage :
 *   node cine/plan-danse.mjs
 *   node cine/plan-danse.mjs --apercu
 */
import fs from 'node:fs/promises';
import {
  ouvrirScene, preparer, monterEpreuve, brouillard,
  tourner, poser, avancer, capturer, encoder,
  SORTIE, IMAGES, FPS,
} from './noyau.mjs';
import { FOV, profil, lerp, seuil } from './cadrage.mjs';

const args = process.argv.slice(2);
const apercu = args.includes('--apercu');
/*
 * Sans argument, la troupe entiere. Avec, seulement les personnages nommes, DANS L'ORDRE
 * DU CATALOGUE et non celui de la ligne de commande : un duo doit toujours se ranger de la
 * meme facon d'une prise a l'autre, sinon deux plans du meme couple ne se raccordent pas.
 * `char-` est facultatif — `babytrump` suffit.
 */
const demandes = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/^char-/, ''));

const GRAINE = 4242;
const DUREE = 14;
/** Ecart lateral entre deux danseurs, en metres. */
const ECART = 2.35;
/** Terrain : la ligne de depart de La Course, plate, large et coloree. */
const EPREUVE = 'course';
const SANS_OBSTACLES = 'rollers,balls,hammers,pendulums,spinners,bumpers';

/**
 * L'affiche. L'ordre est celui de la ligne, de gauche a droite vue de la camera ; chaque
 * personnage garde SA danse — c'est ce qui distingue une troupe d'un corps de ballet.
 */
const TROUPE = [
  { modele: 'char-captainleeky', danse: 'danse-captainleeky', nom: 'Captain Leeky' },
  { modele: 'char-grenouille', danse: 'danse-grenouille', nom: 'Pepe' },
  { modele: 'char-babytrump', danse: 'danse-babytrump', nom: 'BabyTrump' },
  { modele: 'char-techtitan', danse: 'danse-techtitan', nom: 'BabyMusk' },
  { modele: 'char-diplomate', danse: 'danse-diplomate', nom: 'BabyNetan' },
];

const AFFICHE = demandes.length
  ? TROUPE.filter((t) => demandes.includes(t.modele.replace(/^char-/, '')))
  : TROUPE;

if (AFFICHE.length !== (demandes.length || TROUPE.length)) {
  console.error(`ECHEC : personnage inconnu. Disponibles : ${TROUPE.map((t) => t.modele).join(', ')}`);
  process.exit(1);
}
if (!AFFICHE.length) { console.error('ECHEC : aucun danseur.'); process.exit(1); }

/** Nom du fichier : la troupe complete garde son nom, un extrait porte celui des danseurs. */
const SORTIE_NOM = AFFICHE.length === TROUPE.length
  ? 'danse-troupe'
  : `danse-${AFFICHE.map((t) => t.modele.replace(/^char-/, '')).join('-')}`;

const { page, fermer } = await ouvrirScene({
  largeur: 1920, hauteur: 1080,
  params: `&graine=${GRAINE}&skip=${SANS_OBSTACLES}`,
});
await preparer(page);
await monterEpreuve(page, EPREUVE, { cacherJoueur: true });
await brouillard(page, 90, 340);
/*
 * Deux images avant de sonder le sol.
 *
 * Rapier ne repond a aucun rayon tant que le monde n'a pas fait un pas : sur une arene
 * qui vient d'etre construite, `castRay` renvoie null partout et les danseurs se
 * poseraient sur une hauteur de repli.
 */
await avancer(page, 2);

/** Cote du sol sous la ligne de danse : relevee au rayon, jamais supposee. */
const scene = await page.evaluate(({ troupe, ecart }) => {
  const T = window.__THREE, R = window.__RAPIER, g = window.__probeGame();
  const monde = g.arena.world;
  // Quelques metres devant la ligne de depart : de la place devant l'arche, et le sol y
  // est plat.
  const z = g.arena.spawn.z - 6;
  const sol = (x) => {
    const h = monde.castRay(new R.Ray({ x, y: g.arena.spawn.y + 12, z }, { x: 0, y: -1, z: 0 }), 60, true);
    return h ? g.arena.spawn.y + 12 - h.timeOfImpact : null;
  };
  window.__danseurs = [];
  const rapport = [];
  troupe.forEach((t, i) => {
    const f = window.__probeFigurant(t.modele, 1.6);
    if (!f) { rapport.push({ nom: t.nom, erreur: 'modele introuvable' }); return; }
    const x = (i - (troupe.length - 1) / 2) * ecart;
    const socle = new T.Group(), pivot = new T.Group();
    // yaw 0 regarde vers +Z, et la camera est posee du cote des Z croissants : les
    // danseurs sont donc face a elle sans rien tourner.
    pivot.add(f.model);
    socle.add(pivot);
    socle.position.set(x, sol(x) ?? g.arena.spawn.y - 0.8, z);
    g.view.scene.add(socle);
    window.__danseurs.push({ ...t, socle, rig: f.rig, action: null });
    rapport.push({ nom: t.nom, x: +x.toFixed(2), y: +socle.position.y.toFixed(2) });
  });
  return { z, danseurs: rapport };
}, { troupe: AFFICHE, ecart: ECART });

console.log(`ligne de danse en z=${scene.z.toFixed(1)}`);
for (const d of scene.danseurs) console.log(`  ${JSON.stringify(d)}`);

/*
 * Chargement des danses, une par danseur. On lit `gltf.animations` et on jette le reste :
 * le maillage livre avec la danse est un avatar generique dont personne n'a besoin.
 */
const clips = await page.evaluate(async () => {
  const assets = window.__probeAssets;
  const rapport = [];
  for (const d of window.__danseurs) {
    let gltf;
    try { gltf = await assets.loader.loadAsync(`/models/${d.danse}.glb`); }
    catch (e) { rapport.push({ nom: d.nom, erreur: e.message }); continue; }
    const clip = gltf.animations?.[0];
    if (!clip) { rapport.push({ nom: d.nom, erreur: 'aucune animation' }); continue; }
    // Le rig du jeu cesse de peser sur le squelette ; la danse prend sa place sur le
    // meme mixeur (voir l'en-tete).
    d.rig.frozen = true;
    if (!d.rig.mixer) { rapport.push({ nom: d.nom, erreur: 'ce personnage n a pas de mixeur' }); continue; }
    const action = d.rig.mixer.clipAction(clip);
    action.setLoop(window.__THREE.LoopRepeat, Infinity);
    action.setEffectiveWeight(1);
    action.play();
    d.action = action;
    // Combien de pistes trouvent effectivement un os ? Une danse dont le squelette ne
    // correspondrait pas se jouerait en silence, sur un personnage parfaitement immobile.
    const os = new Set();
    d.socle.traverse((o) => { if (o.isBone) os.add(o.name); });
    const liees = clip.tracks.filter((t) => os.has(t.name.split('.')[0])).length;
    rapport.push({ nom: d.nom, clip: clip.name, duree: +clip.duration.toFixed(2), pistes: clip.tracks.length, liees });
  }
  window.__majDanse = (dt) => { for (const d of window.__danseurs) d.rig.mixer.update(dt); };
  return rapport;
});

for (const c of clips) console.log(`  ${JSON.stringify(c)}`);
if (clips.some((c) => c.erreur || c.liees === 0)) {
  console.error('ECHEC : une danse au moins ne se lie a aucun os.');
  fermer(); process.exit(1);
}

/*
 * La camera. Un plan de troupe se filme de FACE : on part large, tous les cinq dans le
 * cadre, et on se rapproche lentement en derivant sur le cote. Le leger travelling
 * lateral suffit a donner du volume — une camera parfaitement fixe sur cinq danseurs
 * alignes donne une photo qui bouge, pas un plan.
 */
/** Le sol de la ligne, relu depuis le rapport : les cinq y sont poses a la meme cote. */
scene.sol = scene.danseurs.reduce((s, d) => s + (d.y ?? 0), 0) / scene.danseurs.length;

/*
 * Le recul se DEDUIT de la largeur de la ligne, il ne se choisit pas a l'oeil.
 *
 * Cinq danseurs a 2,35 m d'ecart tiennent dans dix metres, corps compris. A un demi-champ
 * horizontal de tan 0,83 (champ vertical 50 degres en 16/9), la largeur vue vaut deux
 * fois la distance fois 0,83 : il faut donc six metres pour la remplir, huit pour la
 * poser dans le cadre avec de l'air. Premier essai a onze metres cinquante : la troupe
 * occupait un tiers de l'image et la moitie basse n'etait que du sol.
 */
const TAN_V = Math.tan((FOV / 2) * Math.PI / 180);
const TAN_H = TAN_V * (16 / 9);
const LARGEUR_LIGNE = (AFFICHE.length - 1) * ECART + 1.1;
const TAILLE = 1.6;
/*
 * Deux contraintes, et on garde la plus exigeante.
 *
 * La largeur suffit tant que la ligne est longue. Sur un DUO elle ne fait plus que
 * trois metres et demi : la camera finissait a deux metres, ou un personnage de 1,60 m
 * remplit 86 % de la hauteur d'image. Plus de ciel au-dessus de la tete, une perspective
 * de grand angle sur les visages, et le moindre travelling lateral coupait un danseur.
 * La hauteur pose donc un plancher que la largeur ne connait pas.
 */
const pourLargeur = (part) => (LARGEUR_LIGNE / part) / (2 * TAN_H);
const pourHauteur = (part) => (TAILLE / part) / (2 * TAN_V);
const RECUL_DEBUT = Math.max(pourLargeur(1 / 1.18), pourHauteur(0.45));
const RECUL_FIN = Math.max(pourLargeur(1 / 0.96), pourHauteur(0.62));

const marche = profil(0.2);
const pose = (t) => {
  const u = marche(t);
  const recul = lerp(RECUL_DEBUT, RECUL_FIN, u);
  // La derive laterale suit la largeur de la ligne : sur un duo, deux metres de travelling
  // sortent un danseur du cadre alors qu'ils passent inapercus sur cinq.
  const derive = Math.min(2.1, LARGEUR_LIGNE * 0.15);
  const lateral = lerp(-derive, derive, u);
  // Camera a hauteur de POITRINE et regard presque horizontal : viser plus bas remplissait
  // le bas du cadre de piste, et les danseurs remontaient dans le tiers superieur.
  const haut = lerp(1.35, 1.05, seuil(0.1, 1, u));
  return {
    pos: [lateral, scene.sol + haut, scene.z + recul],
    look: [lateral * 0.3, scene.sol + 0.92, scene.z],
    fov: FOV,
  };
};

const pendant = async (i, p) => {
  await (p ?? page).evaluate((dt) => window.__majDanse(dt), 1 / FPS);
};

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
    if (i % pas === 0 && pris < 8) await capturer(page, `${dossier}/${SORTIE_NOM}-${pris++}.jpg`);
  }
  console.log('apercu ecrit');
} else {
  const dossier = `${IMAGES}/${SORTIE_NOM}`;
  await fs.rm(dossier, { recursive: true, force: true });
  await tourner(page, { dossier, duree: DUREE, pose, pendant, prechauffe: 8 });
  await encoder(dossier, `${SORTIE}/${SORTIE_NOM}.mp4`, FPS);
  await fs.rm(dossier, { recursive: true, force: true });
}

fermer();
process.exit(0);
