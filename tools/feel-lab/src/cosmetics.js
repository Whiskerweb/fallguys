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
  { id: 'player-rigged', name: 'Blob', rigged: true },
  { id: 'player-custom', name: 'Perso importé', rigged: false },
];

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
