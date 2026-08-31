/**
 * Réglages joueur : touches et caméra, persistés dans le navigateur.
 *
 * Distinct du panneau « Game feel », qui sert au réglage de conception : celui-ci
 * appartient au joueur, il est accessible en jeu et ne touche jamais à la simulation.
 * Les codes de touche sont PHYSIQUES (KeyW, KeyA…) : ils désignent une position sur le
 * clavier, pas une lettre, donc un même réglage marche en AZERTY comme en QWERTY.
 */

export const ACTIONS = [
  { id: 'forward', label: 'Forward', def: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Back', def: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Left', def: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Right', def: ['KeyD', 'ArrowRight'] },
  { id: 'jump', label: 'Jump', def: ['Space'] },
  { id: 'dive', label: 'Dive', def: ['ShiftLeft', 'ShiftRight'] },
  { id: 'camLeft', label: 'Camera left', def: ['KeyQ'] },
  { id: 'camRight', label: 'Camera right', def: ['KeyE'] },
  { id: 'restart', label: 'Restart', def: ['KeyR'] },
];

const CAMERA_DEFAULTS = {
  height: 3.9,        // hauteur de la caméra au-dessus du joueur
  distance: 7.8,     // recul
  lookHeight: 2.2,    // hauteur du point visé — c'est LUI qui règle l'inclinaison
  fov: 55,
  smoothing: 7.5,
};

export const CAMERA_RANGES = {
  height: [0.5, 14, 0.1],
  distance: [3, 24, 0.1],
  lookHeight: [-2, 10, 0.1],
  fov: [30, 90, 1],
  smoothing: [1, 20, 0.1],
};

export const CAMERA_LABELS = {
  height: 'Height',
  distance: 'Pull-back',
  lookHeight: 'Tilt (aim height)',
  fov: 'Field of view',
  smoothing: 'Smoothing',
};

const KEY_STORE = 'tumble-keys';
const CAM_STORE = 'tumble-camera';
// Version du cadrage par defaut. Les reglages sauvegardes ecrasent les defauts : sans
// ce marqueur, un joueur ayant deja ouvert le panneau resterait bloque sur l'ancien
// cadrage lointain, ou le personnage occupait 7 % de la hauteur d'ecran.
const CAM_VERSION = 2;

function loadKeys() {
  const out = {};
  for (const a of ACTIONS) out[a.id] = [...a.def];
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_STORE) || '{}');
    for (const a of ACTIONS) if (Array.isArray(saved[a.id]) && saved[a.id].length) out[a.id] = saved[a.id];
  } catch { /* réglages illisibles : on garde les valeurs d'usine */ }
  return out;
}

function loadCamera() {
  const out = { ...CAMERA_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(CAM_STORE) || '{}');
    if (saved.v !== CAM_VERSION) return out;   // cadrage refondu : on repart des defauts
    for (const k of Object.keys(CAMERA_DEFAULTS)) {
      if (typeof saved[k] === 'number' && Number.isFinite(saved[k])) out[k] = saved[k];
    }
  } catch { /* idem */ }
  return out;
}

export const settings = {
  keys: loadKeys(),
  camera: loadCamera(),

  /** true si l'une des touches de l'action est enfoncée. */
  isDown(pressed, action) {
    const codes = this.keys[action];
    if (!codes) return false;
    for (const c of codes) if (pressed.has(c)) return true;
    return false;
  },

  /** true si `code` déclenche cette action. */
  matches(code, action) {
    return (this.keys[action] ?? []).includes(code);
  },

  bind(action, code) {
    // Une touche ne sert qu'à une action : on la retire partout ailleurs, sinon
    // remapper « sauter » sur une touche déjà prise en casse silencieusement une autre.
    for (const a of ACTIONS) {
      if (a.id === action) continue;
      this.keys[a.id] = this.keys[a.id].filter((c) => c !== code);
    }
    this.keys[action] = [code];
    localStorage.setItem(KEY_STORE, JSON.stringify(this.keys));
  },

  resetKeys() {
    for (const a of ACTIONS) this.keys[a.id] = [...a.def];
    localStorage.setItem(KEY_STORE, JSON.stringify(this.keys));
  },

  setCamera(k, v) {
    this.camera[k] = v;
    localStorage.setItem(CAM_STORE, JSON.stringify({ ...this.camera, v: CAM_VERSION }));
  },

  resetCamera() {
    Object.assign(this.camera, CAMERA_DEFAULTS);
    localStorage.setItem(CAM_STORE, JSON.stringify({ ...this.camera, v: CAM_VERSION }));
  },
};

/** Nom lisible d'un code de touche physique. */
export function keyName(code) {
  if (!code) return '—';
  const map = {
    Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'Alt Gr',
    Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: '⌫',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
