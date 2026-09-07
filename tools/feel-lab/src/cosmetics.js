/**
 * Cosmétiques du joueur. Minuscule pour l'instant — une couleur — mais c'est le point
 * d'ancrage du modèle économique : c'est ici que viendront les skins de collab en édition
 * limitée, et (selon le spec) la réduction de rake attachée aux cosmétiques premium.
 * Le personnage du lobby et celui de la course lisent la même source.
 */
import { estDebloque, surChangement } from './boutique.js';

export const SKINS = [
  // Le premier est le skin par defaut : il doit trancher sur un sol bleu.
  { name: 'Mandarine', hex: 0xff7a2f },
  { name: 'Fraise', hex: 0xff5f7e },
  { name: 'Citron', hex: 0xffd83d },
  { name: 'Menthe', hex: 0x4fd1c5 },
  { name: 'Myrtille', hex: 0x8b7bff },
  { name: 'Pêche', hex: 0xffa36b },
  { name: 'Pistache', hex: 0x9ede6a },
  { name: 'Bubblegum', hex: 0xff8bd0 },
];

/**
 * Modèles de personnage. Le modèle riggé est le défaut parce que c'est le seul qui
 * porte un squelette, donc le seul réellement animé (course, envol, culbute). Un modèle
 * sans squelette reste jouable mais n'est anime que par le corps entier : inclinaison,
 * ecrasement, rotation. C'est indiqué dans la garde-robe plutôt que subi en silence.
 */
/*
 * Catalogue REFAIT. Les huit premiers venaient d'un pipeline text-to-3D qui donnait des
 * silhouettes inegales et aucune animation propre — ils etaient animes par un rig
 * procedural faute de mieux, et leurs fichiers dorment dans meshy-pipeline/old-chars/.
 * Ceux-ci arrivent riggees avec leurs propres clips de course et de marche, fusionnes par
 * `meshy-pipeline/fusion-anims.mjs` puis allegees : 15 a 17 Mo livres, moins d'un Mo dans
 * le jeu.
 */
export const MODELS = [
  /*
   * PEPE OUVRE LE CATALOGUE, et il est le seul qu'on a en arrivant (decision produit du
   * 5 septembre 2026 : « on commence de base avec Pepe »). Tous les autres sont EN
   * BOUTIQUE : BabyTrump se gagne en publiant un post sur X, les trois suivants
   * s'achetent en USDG (`boutique.js`). La garde-robe montre donc un personnage porte
   * et quatre cadenas — et c'est exactement ce qu'on veut qu'on voie en l'ouvrant.
   *
   * La CONDITION et le PRIX ne sont pas ecrits ici : `boutique.js` les detient, ce
   * fichier ne decrit que le personnage. Deux endroits pour la meme regle, et l'un des
   * deux finit faux.
   */
  {
    id: 'char-grenouille', name: 'Pepe', rigged: true, rarity: 'legendary', accent: 0x4f9e3f,
    desc: 'Grin from ear to ear, spotless diaper. He runs and he walks.',
    season: 'Starter',
  },
  {
    id: 'char-babytrump', name: 'BabyTrump', rigged: true, rarity: 'epic', accent: 0xf5a623,
    desc: 'Small format, big temper. He runs, he walks and he waits with his own animations.',
    season: 'Limited edition',
  },
  {
    id: 'char-techtitan', name: 'BabyMusk', rigged: true, rarity: 'epic', accent: 0x4fd1c5,
    desc: 'Black tee, matching diaper, orbital ambitions. He runs with his own animations.',
    season: 'Limited edition',
  },
  {
    id: 'char-diplomate', name: 'BabyNetan', rigged: true, rarity: 'common', accent: 0x8ede6d,
    desc: 'Dark suit, diaper, furrowed brows. He negotiates at a sprint.',
    season: 'Limited edition',
  },
  {
    id: 'char-captainleeky', name: 'CyberLeek', rigged: true, rarity: 'common', accent: 0x1f6ad4,
    desc: 'Three leaves for hair, blue jersey, determined brows. He runs and he walks.',
    season: 'Limited edition',
  },
  /*
   * BABYVLAD EST LE CADEAU DE BIENVENUE (directeur produit, 5 septembre 2026) : la boite
   * s'ouvre a la premiere arrivee dans le lobby et l'equipe (`cadeau.js`, article
   * `cadeau` de `boutique.js`). Le fichier s'appelle `tinytrader` — le petit courtier a la
   * chevelure longue et a la veste de soie, zero commission ; EPIC, parce qu'un cadeau
   * « common » n'en est pas un.
   *
   * Le PREMIER a livrer son propre clip d'attente. Les cinq autres portent un `idle`
   * greffe apres coup (README, « Greffer l'animation d'attente ») parce que Meshy n'en
   * fournissait pas ; celui-ci est arrive avec, il n'y a rien a lui greffer.
   *
   * Il n'a EN REVANCHE pas de danse de podium — les cinq autres en ont une, toutes
   * differentes. Sans `danse-tinytrader.glb`, `montrerVainqueur` retombe proprement sur
   * sa pose d'attente, sans erreur ; le fichier suffira a la lui donner.
   */
  {
    id: 'char-tinytrader', name: 'BabyVlad', rigged: true, rarity: 'epic', accent: 0x2fb36a,
    desc: 'Long hair, goatee, silk blazer over the diaper, zero commission. He runs, he walks and he waits with his own animations.',
    season: 'Welcome gift',
  },
];

export const RARITY = {
  common: { label: 'COMMON', color: '#7f8fa6' },
  epic: { label: 'EPIC', color: '#a855f7' },
  legendary: { label: 'LEGENDARY', color: '#f5a623' },
};

const KEY = 'tumble-skin';
const MODEL_KEY = 'tumble-model';
const listeners = new Set();

export const cosmetics = {
  hex: Number(localStorage.getItem(KEY)) || SKINS[0].hex,
  /*
   * Le personnage memorise doit encore EXISTER — et etre A NOUS.
   *
   * Un joueur ayant choisi un personnage retire du catalogue gardait son identifiant en
   * memoire locale : le modele restait introuvable, et il se retrouvait avec le blob de
   * secours sous une fiche qui annoncait tout autre chose. On retombe donc sur le
   * premier PORTABLE du catalogue des que la selection n'y figure plus.
   *
   * « Portable » et non « present » : depuis que BabyTrump est en boutique, le premier du
   * catalogue est verrouille. `MODELS[0].id` en defaut aurait equipe tout le monde avec
   * le seul personnage que personne ne possede encore — la garde-robe l'aurait affiche
   * EQUIPPED et cadenasse en meme temps.
   *
   * Consequence assumee : une machine qui portait deja BabyTrump repasse au suivant. Il
   * n'y a pas de droit acquis a rattraper — le jeu n'est pas sorti, et laisser leur skin
   * aux porteurs actuels rendrait la campagne impossible a tester pour la seule personne
   * qui la relit.
   */
  model: (MODELS.some((m) => m.id === localStorage.getItem(MODEL_KEY)) && estDebloque(localStorage.getItem(MODEL_KEY)))
    ? localStorage.getItem(MODEL_KEY)
    : (MODELS.find((m) => estDebloque(m.id)) ?? MODELS[0]).id,

  /**
   * Equipe un personnage. REFUSE — et rend `false` — si la boutique le retient encore.
   *
   * Le garde est ici et pas seulement dans la vitrine : le jour ou un autre ecran voudra
   * equiper quelqu'un (une recompense, un raccourci clavier, un harnais), il passera par
   * cette porte-la. Une garantie qui ne tient qu'a l'interface tient a un clic ajoute.
   */
  setModel(id) {
    if (!estDebloque(id)) return false;
    this.model = id;
    localStorage.setItem(MODEL_KEY, id);
    for (const fn of listeners) fn(this.hex);
    return true;
  },
  set(hex) {
    this.hex = hex;
    localStorage.setItem(KEY, String(hex));
    for (const fn of listeners) fn(hex);
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

/*
 * QUAND LE SERVEUR PARLE, ON REVERIFIE CE QU'ON PORTE. Un skin payant porte au chargement
 * sur la foi de la memoire locale (un banc, ou une memoire bricolee) doit tomber des que
 * le serveur de production dit qu'il y a de l'argent et que le backend ne le liste pas
 * dans les possessions. On retombe alors sur le premier portable, sans un mot : le lobby
 * se repeint par `onChange`.
 */
surChangement(() => {
  if (estDebloque(cosmetics.model)) return;
  const repli = (MODELS.find((m) => estDebloque(m.id)) ?? MODELS[0]).id;
  cosmetics.model = repli;
  localStorage.setItem(MODEL_KEY, repli);
  for (const fn of listeners) fn(cosmetics.hex);
});
