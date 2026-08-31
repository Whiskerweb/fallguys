/**
 * Cosmétiques du joueur. Minuscule pour l'instant — une couleur — mais c'est le point
 * d'ancrage du modèle économique : c'est ici que viendront les skins de collab en édition
 * limitée, et (selon le spec) la réduction de rake attachée aux cosmétiques premium.
 * Le personnage du lobby et celui de la course lisent la même source.
 */
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
    id: 'char-grenouille', name: 'Pepe', rigged: true, rarity: 'legendary', accent: 0x4f9e3f,
    desc: 'Grin from ear to ear, spotless diaper. He runs and he walks.',
    season: 'Limited edition',
  },
  {
    id: 'char-diplomate', name: 'BabyNetan', rigged: true, rarity: 'common', accent: 0x8ede6d,
    desc: 'Dark suit, diaper, furrowed brows. He negotiates at a sprint.',
    season: 'Limited edition',
  },
  {
    id: 'char-captainleeky', name: 'Captain Leeky', rigged: true, rarity: 'common', accent: 0x1f6ad4,
    desc: 'Three leaves for hair, blue jersey, determined brows. He runs and he walks.',
    season: 'Limited edition',
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
   * Le personnage memorise doit encore EXISTER.
   *
   * Un joueur ayant choisi un personnage retire du catalogue gardait son identifiant en
   * memoire locale : le modele restait introuvable, et il se retrouvait avec le blob de
   * secours sous une fiche qui annoncait tout autre chose. On retombe donc sur le
   * premier du catalogue des que la selection n'y figure plus.
   */
  model: MODELS.some((m) => m.id === localStorage.getItem(MODEL_KEY))
    ? localStorage.getItem(MODEL_KEY) : MODELS[0].id,

  setModel(id) {
    this.model = id;
    localStorage.setItem(MODEL_KEY, id);
    for (const fn of listeners) fn(this.hex);
  },
  set(hex) {
    this.hex = hex;
    localStorage.setItem(KEY, String(hex));
    for (const fn of listeners) fn(hex);
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
