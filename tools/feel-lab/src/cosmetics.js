/**
 * Cosmétiques du joueur. Minuscule pour l'instant — une couleur — mais c'est le point
 * d'ancrage du modèle économique : c'est ici que viendront les skins de collab en édition
 * limitée, et (selon le spec) la réduction de rake attachée aux cosmétiques premium.
 * Le personnage du lobby et celui de la course lisent la même source.
 */
export const SKINS = [
  { name: 'Fraise', hex: 0xff5f7e },
  { name: 'Menthe', hex: 0x4fd1c5 },
  { name: 'Citron', hex: 0xffd83d },
  { name: 'Myrtille', hex: 0x8b7bff },
  { name: 'Pêche', hex: 0xffa36b },
  { name: 'Pistache', hex: 0x9ede6a },
  { name: 'Bubblegum', hex: 0xff8bd0 },
  { name: 'Océan', hex: 0x4fa8ff },
];

const KEY = 'tumble-skin';
const listeners = new Set();

export const cosmetics = {
  hex: Number(localStorage.getItem(KEY)) || SKINS[0].hex,
  set(hex) {
    this.hex = hex;
    localStorage.setItem(KEY, String(hex));
    for (const fn of listeners) fn(hex);
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
