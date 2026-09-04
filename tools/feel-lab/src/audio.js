/**
 * Sons entièrement synthétisés en Web Audio — aucun fichier à charger.
 * Juger un game feel sans retour sonore est trompeur : le son porte la moitié de
 * l'impact d'un saut ou d'une chute. Ces sons sont des marqueurs de timing, pas une
 * bande-son : ils indiquent QUAND ça claque, ce qui est précisément ce qu'il faut régler.
 * Le contexte ne démarre qu'au premier geste du joueur (politique des navigateurs).
 */
let ctx = null;
let master = null;
export const audio = { enabled: true, volume: 0.35 };

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = audio.volume;
  master.connect(ctx.destination);
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

function tone({ type = 'sine', from, to, duration, gain = 0.5, delay = 0, curve = 'exp' }) {
  const c = ensure();
  if (!c || !audio.enabled) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) {
    if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
    else osc.frequency.linearRampToValueAtTime(to, t0 + duration);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noise({ duration = 0.18, gain = 0.35, cutoff = 1400, delay = 0 }) {
  const c = ensure();
  if (!c || !audio.enabled) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.25), t0 + duration);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  jump() { tone({ type: 'triangle', from: 240, to: 620, duration: 0.16, gain: 0.32 }); },
  land(strength = 1) {
    noise({ duration: 0.13, gain: 0.16 * Math.min(1.6, strength), cutoff: 900 });
    tone({ type: 'sine', from: 180, to: 70, duration: 0.14, gain: 0.24 * Math.min(1.5, strength) });
  },
  dive() {
    noise({ duration: 0.26, gain: 0.18, cutoff: 2600 });
    tone({ type: 'sawtooth', from: 420, to: 130, duration: 0.24, gain: 0.14 });
  },
  tumble() {
    noise({ duration: 0.34, gain: 0.26, cutoff: 1800 });
    tone({ type: 'square', from: 320, to: 90, duration: 0.3, gain: 0.12 });
  },
  getUp() { tone({ type: 'triangle', from: 300, to: 520, duration: 0.14, gain: 0.16 }); },
  beep() { tone({ type: 'square', from: 620, to: 620, duration: 0.11, gain: 0.2 }); },
  go() {
    tone({ type: 'square', from: 880, to: 880, duration: 0.18, gain: 0.26 });
    tone({ type: 'sine', from: 1320, to: 1320, duration: 0.22, gain: 0.16, delay: 0.04 });
  },
  finish() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ type: 'triangle', from: f, to: f, duration: 0.26, gain: 0.24, delay: i * 0.085 }));
  },
  checkpoint() { tone({ type: 'sine', from: 700, to: 980, duration: 0.14, gain: 0.18 }); },
  click() { tone({ type: 'square', from: 520, to: 700, duration: 0.07, gain: 0.14 }); },

  /*
   * LA ROUE. Trois sons, et ils vivent ICI parce que `tone` et `noise` sont prives : les
   * ecrire ailleurs demanderait de les exporter, donc d'ouvrir la fabrique de sons a tout
   * le jeu pour trois appels.
   */

  /**
   * Le cran d'un cliquet. Il part QUARANTE FOIS pendant un lancer : il doit etre bref et
   * discret, sinon la roue ne fait pas un bruit de roue mais un bruit de mitraillette.
   * Trente millisecondes et un gain de 0,07 — au-dela, l'oreille entend une note.
   */
  tick() { tone({ type: 'square', from: 1180, to: 940, duration: 0.03, gain: 0.07 }); },

  /** Le lancer : un souffle qui monte, le temps que le disque prenne sa vitesse. */
  lancer() {
    noise({ duration: 0.45, gain: 0.13, cutoff: 3200 });
    tone({ type: 'sawtooth', from: 180, to: 460, duration: 0.4, gain: 0.08 });
  },

  /**
   * Le calage sur un palier qui paie gros. `finish()` sonne deja la victoire ; celui-ci
   * monte d'une octave et ajoute une quinte, pour que le diamant ne sonne pas comme une
   * mise rendue.
   */
  jackpot() {
    [784, 1047, 1319, 1568, 2093].forEach((f, i) =>
      tone({ type: 'triangle', from: f, to: f, duration: 0.3, gain: 0.2, delay: i * 0.07 }));
    noise({ duration: 0.5, gain: 0.1, cutoff: 5200, delay: 0.02 });
  },
};
