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
export const MODELS = [
  {
    id: 'player-rigged', name: 'Blob', rigged: true, rarity: 'commun', accent: 0xff5f7e,
    desc: "Le personnage d'origine. Rond, souple, increvable — il rebondit sur tout ce qu'il croise.",
    season: 'Disponible depuis : Saison 1',
  },
  // Personnages de la galerie crypto. Meme charte graphique, memes proportions,
  // memes grands yeux : ce sont des variantes d'une seule famille, pas six styles.
  // Tous rigges, donc animes par le squelette comme le blob.
  {
    id: 'char-tycoon', name: 'Le Magnat', rigged: true, rarity: 'épique', accent: 0xffc93c,
    desc: "Il annonce la victoire avant le départ. Chevelure indomptable, cravate plus longue que la piste.",
    season: 'Disponible depuis : Saison 1',
  },
  {
    id: 'char-engineer', name: "L'Ingénieur", rigged: true, rarity: 'épique', accent: 0x31c7f0,
    desc: "Il a calculé la trajectoire optimale. Il tombera quand même dans le premier trou.",
    season: 'Disponible depuis : Saison 1',
  },
  {
    id: 'char-penguin', name: 'Le Pingouin', rigged: true, rarity: 'légendaire', accent: 0x4fa8ff,
    desc: "Édition Glacier — collaboration. Glisse mieux que les autres, tombe aussi bien.",
    season: 'Édition limitée · 3 000 exemplaires',
  },
  {
    id: 'char-shiba', name: 'Le Shiba', rigged: true, rarity: 'légendaire', accent: 0xffa63d,
    desc: "Édition Meme — collaboration. Court vite, comprend rien, gagne quand même.",
    season: 'Édition limitée',
  },
  {
    id: 'char-frog', name: 'La Grenouille', rigged: true, rarity: 'légendaire', accent: 0x6ee86e,
    desc: "Édition Marais — collaboration. Saute plus haut dans sa tête que dans le jeu.",
    season: 'Édition limitée',
  },
  {
    id: 'char-bull', name: 'Le Taureau', rigged: true, rarity: 'épique', accent: 0xffd83d,
    desc: "Il ne connaît qu'une direction : devant. Les obstacles sont un détail administratif.",
    season: 'Disponible depuis : Saison 1',
  },
  {
    id: 'player-custom', name: 'Perso importé', rigged: false, rarity: 'commun', accent: 0xff7a2f,
    desc: "Modèle importé depuis un fichier. Sans squelette : il glisse au lieu de courir.",
    season: 'Importé localement',
  },
];

export const RARITY = {
  commun: { label: 'COMMUN', color: '#7f8fa6' },
  épique: { label: 'ÉPIQUE', color: '#a855f7' },
  légendaire: { label: 'LÉGENDAIRE', color: '#f5a623' },
};

const KEY = 'tumble-skin';
const MODEL_KEY = 'tumble-model';
const listeners = new Set();

export const cosmetics = {
  hex: Number(localStorage.getItem(KEY)) || SKINS[0].hex,
  model: localStorage.getItem(MODEL_KEY) || MODELS[0].id,

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
