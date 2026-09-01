/**
 * Faire tourner le CODE DU JEU sans navigateur.
 *
 * Le serveur doit exécuter exactement le même déplacement que le client — c'est la seule
 * façon qu'une prédiction côté client colle à l'autorité du serveur. On importe donc les
 * vrais modules de `tools/feel-lab/src/`, pas une réimplémentation « serveur » qui
 * divergerait au premier réglage.
 *
 * Ces modules touchent au navigateur en trois endroits, et trois seulement — c'est le
 * résultat d'une mesure, pas une estimation :
 *
 *   1. `textures.js` dessine dans un `<canvas>` ;
 *   2. les cartes lisent leurs drapeaux dans `location.search` ;
 *   3. `cosmetics.js` et `settings.js` mémorisent des choix dans `localStorage`.
 *
 * On fournit donc trois doublures, et RIEN DE PLUS. Chaque simulacre supplémentaire est
 * une occasion pour le serveur de se comporter autrement que le client.
 *
 * En particulier : PAS d'`AudioContext`. `audio.js` teste `window.AudioContext`, ne le
 * trouve pas, et chaque son sort immédiatement — l'absence est une meilleure doublure
 * qu'un faux contexte, qui n'irait qu'un cran plus loin avant de casser.
 */

const rien = () => {};

/** Contexte 2D qui accepte tout et ne dessine rien. Le serveur ne rend aucune image. */
const contexte2d = () => new Proxy({}, {
  get(_, p) {
    if (p === 'canvas') return toile(1, 1);
    if (p === 'measureText') return () => ({ width: 0 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') {
      return () => ({ addColorStop: rien });
    }
    if (p === 'getImageData' || p === 'createImageData') {
      return (a, b, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    }
    return rien;
  },
  set: () => true,
});

function toile(w = 1, h = 1) {
  return {
    width: w,
    height: h,
    // `textures.js` y attache la clé de chaque texture, pour que les diagnostics sachent
    // laquelle porte un matériau. Sans cet objet, la construction s'arrête là.
    dataset: {},
    style: {},
    getContext: () => contexte2d(),
    toDataURL: () => 'data:image/png;base64,',
    addEventListener: rien,
    removeEventListener: rien,
  };
}

/**
 * Les drapeaux d'URL demandés par défaut.
 *
 * Ce ne sont pas des réglages inventés pour l'occasion : ce sont ceux dont les harnais de
 * `diag/` se servent tous les jours. `skip=scenery` retire le décor, `noassets` les
 * modèles Meshy, `lowfx` les effets — rien de tout cela ne porte de collider, donc rien de
 * tout cela ne change ce que le serveur arbitre.
 */
export const DRAPEAUX_SERVEUR = '?skip=scenery&lowfx&noassets&nointro';

let pose = false;

export function poserDoublures(drapeaux = DRAPEAUX_SERVEUR) {
  if (pose) return false;
  pose = true;

  globalThis.window = globalThis;
  globalThis.location = { search: drapeaux, href: `http://serveur/${drapeaux}`, origin: 'http://serveur' };

  globalThis.document = {
    createElement: (nom) => (nom === 'canvas' ? toile() : { style: {}, dataset: {}, appendChild: rien, setAttribute: rien }),
    createElementNS: () => toile(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: rien },
    addEventListener: rien,
  };

  // En mémoire, jamais sur disque : le serveur n'a aucune préférence à conserver d'une
  // partie sur l'autre, et deux parties ne doivent surtout pas se les partager.
  const memoire = new Map();
  globalThis.localStorage = {
    getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
    setItem: (k, v) => memoire.set(k, String(v)),
    removeItem: (k) => memoire.delete(k),
    clear: () => memoire.clear(),
  };

  globalThis.Image = function Image() { this.addEventListener = rien; };
  globalThis.ImageData = function ImageData(w = 1, h = 1) { this.data = new Uint8ClampedArray(w * h * 4); };
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  return true;
}
