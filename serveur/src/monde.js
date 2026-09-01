/**
 * Charger une carte, côté serveur, avec le code du jeu.
 *
 * On importe les VRAIS modules de `tools/feel-lab/src/` — les mêmes fichiers que le
 * navigateur exécute. C'est un choix, et c'est le plus important de ce dossier : une
 * réimplémentation « serveur » du déplacement diverge au premier réglage, et le jour où
 * elle diverge, la prédiction du client cesse de coller sans que rien ne le signale.
 *
 * Résolution des dépendances : les modules du jeu font `import * as THREE from 'three'`,
 * et Node résout depuis LE DOSSIER DU FICHIER IMPORTÉ, pas depuis le nôtre. Ils trouvent
 * donc `tools/feel-lab/node_modules/three`, celui-là même que le client utilise. Rien à
 * dupliquer, aucune version à tenir en phase.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { poserDoublures } from './navigateur-absent.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const JEU = path.resolve(ICI, '..', '..', 'tools', 'feel-lab', 'src');

const url = (rel) => pathToFileURL(path.join(JEU, rel)).href;

/*
 * Le moteur vient de `src/moteur.js`, DANS LE JEU — jamais de notre propre `node_modules`.
 *
 * C'est ce qui garantit UNE SEULE instance de Three. Les cartes font `import * as THREE
 * from 'three'` et Node resout depuis leur emplacement ; en passant par un fichier qui vit
 * au meme endroit, on obtient exactement le meme module.
 *
 * Premiere tentative, ecartee : `createRequire(...).resolve('three')`. Elle rend l'entree
 * CommonJS alors que les cartes chargent l'entree ESM — deux fichiers, donc deux copies,
 * et Three le dit lui-meme (« Multiple instances of Three.js being imported »). Les objets
 * se ressemblaient assez pour fonctionner par canard-typage, et assez peu pour qu'un
 * `instanceof` echoue un jour sans rien expliquer.
 */
const importerMoteur = () => import(url('moteur.js'));

/**
 * Bibliothèque d'assets VIDE.
 *
 * C'est exactement l'état du mode `noassets`, que les cinq cartes savent déjà traverser
 * puisque tous les harnais de diagnostic s'en servent. Les modèles Meshy sont du décor :
 * aucun ne porte de collider, donc leur absence ne change rien à ce que le serveur
 * arbitre. Charger 150 Mo de GLB pour les jeter serait le seul effet de les garder.
 */
export const AUCUN_ASSET = {
  has: () => false,
  get: () => null,
  getFitted: () => null,
  clipsOf: () => [],
  models: new Map(),
};

let RAPIER = null;
let THREE = null;
let Character = null;
let MINIGAMES = null;
let TUNING = null;
let ECONOMIE = null;

/**
 * Prépare le moteur. À appeler une fois au démarrage du processus.
 *
 * `RAPIER.init()` compile le WebAssembly : ~50 ms, une seule fois. Le faire à la création
 * de chaque partie ajouterait ces 50 ms à chaque lancement de manche, pour rien.
 */
export async function preparer() {
  if (RAPIER) return { RAPIER, THREE, Character, MINIGAMES, TUNING };

  poserDoublures();

  const moteur = await importerMoteur();
  RAPIER = moteur.RAPIER;
  await RAPIER.init();
  THREE = moteur.THREE;

  ({ Character } = await import(url('character.js')));
  ({ MINIGAMES } = await import(url('scenes/index.js')));
  ({ TUNING } = await import(url('tuning.js')));

  /*
   * L'ÉCONOMIE VIENT DU JEU, ELLE AUSSI.
   *
   * `configPour(n)` dit combien de manches se jouent et combien de joueurs survivent à
   * chacune. Le serveur en a besoin pour arbitrer, le lobby pour annoncer les gains. En
   * réécrire une version « serveur » ferait diverger la partie JOUÉE de la partie PAYÉE —
   * un joueur verrait trois manches annoncées et en disputerait deux.
   */
  ECONOMIE = await import(url('economie.js'));

  return { RAPIER, THREE, Character, MINIGAMES, TUNING };
}

/** La pyramide d'élimination et la table des gains, telles que le jeu les définit. */
export function economie() {
  if (!ECONOMIE) throw new Error("monde : appeler preparer() d'abord");
  return ECONOMIE;
}

/** Le moteur partagé, pour qui a besoin de lancer un rayon ou de faire un vecteur. */
export function moteur() {
  if (!RAPIER) throw new Error("monde : appeler preparer() d'abord");
  return { RAPIER, THREE, TUNING };
}

/** Les épreuves disponibles, telles que le jeu les déclare. Aucune liste en double ici. */
export function epreuves() {
  if (!MINIGAMES) throw new Error('monde : appeler preparer() d\'abord');
  return MINIGAMES;
}

/**
 * Construit une arène : le monde physique d'une manche.
 *
 * @param {string} id identifiant d'épreuve (`hexagone`, `course`, …)
 * @param {number} graine la graine de manche — TOUT ce qui varie en découle
 */
export function construire(id, graine) {
  const epreuve = MINIGAMES.find((m) => m.id === id);
  if (!epreuve) throw new Error(`monde : epreuve inconnue « ${id} »`);

  const arene = epreuve.build(RAPIER, AUCUN_ASSET, { seed: graine });

  /*
   * On note ce que la scène a déclaré, plutôt que de le redemander partout.
   *
   * `survie` distingue une manche de survie d'une course : la première se gagne en tenant
   * une durée, la seconde en franchissant `finishZ`. C'est la seule différence de règle
   * entre les cinq cartes, et la scène est la seule à savoir laquelle elle est.
   */
  return {
    id,
    graine,
    arene,
    survie: arene.survie ?? null,
    finishZ: arene.finishZ,
    killY: arene.killY,
    spawn: arene.spawn,
    largeur: arene.largeur ?? 20,
    duree: arene.survie?.duree ?? null,
  };
}

/**
 * Crée un personnage dans une arène, au départ.
 *
 * Les positions de départ sont RANGÉES, jamais tirées au sort : la spec l'impose
 * (section 5) parce qu'attribuer une place au hasard introduirait du hasard machine dans
 * une compétition qui doit rester de pure compétence. On aligne donc les joueurs sur une
 * grille régulière, à distance identique du premier obstacle.
 */
export function creerPerso(monde, index, total) {
  const scene = new THREE.Scene();
  const parRang = Math.min(total, 8);
  const colonne = index % parRang;
  const rangee = Math.floor(index / parRang);

  const ecart = 1.4;
  const largeurUtile = Math.min(monde.largeur * 0.8, parRang * ecart);
  const pas = parRang > 1 ? largeurUtile / (parRang - 1) : 0;

  const depart = new THREE.Vector3(
    monde.spawn.x - largeurUtile / 2 + colonne * pas,
    monde.spawn.y,
    monde.spawn.z + rangee * ecart,
  );

  /*
   * La graine de culbute dérive de la graine de MANCHE et du numéro du joueur.
   *
   * Le client la calcule de la même façon : c'est ce qui fait que deux culbutes,
   * l'une simulée sur le serveur et l'autre prédite dans le navigateur, tombent au même
   * endroit. Sans cela, le personnage prédit et le personnage autoritatif divergeraient à
   * la première chute, et le joueur verrait un saut inexpliqué.
   */
  const graineCulbute = (monde.graine ^ ((index + 1) * 0x9E3779B1)) >>> 0;
  const perso = new Character(RAPIER, monde.arene.world, scene, depart, graineCulbute);
  perso.__scene = scene;   // gardée pour que `dispose()` puisse la vider
  return perso;
}

/** Rend la mémoire d'une manche : monde physique wasm et maillages construits pour rien. */
export function liberer(monde) {
  monde.arene.dispose?.();
}
