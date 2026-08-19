import * as THREE from 'three';

/**
 * Textures procédurales RACCORDABLES PAR CONSTRUCTION.
 *
 * Toute forme qui déborde d'un bord est redessinée de l'autre côté (voir `wrap`), et
 * toutes les périodes divisent exactement la taille du canevas. Il n'existe donc aucune
 * couture — ce n'est pas « peu visible », c'est mathématiquement absent. Une image
 * générée par IA ne peut pas offrir cette garantie : ses bords ne coïncident pas et il
 * faut la rapiécer, ce qui laisse soit une symétrie, soit un flou.
 *
 * Deux régimes, à ne pas mélanger :
 *  - MOTIF  : niveaux clairs quasi neutres, la teinte vient du matériau.
 *  - SIGNAL : la texture porte les couleurs, le matériau reste blanc.
 */

const cache = new Map();

/**
 * Textures peintes à la main déposées dans public/textures/.
 * Chargées au démarrage ; chaque fabrique regarde d'abord ici avant de générer sa
 * version procédurale. Déposer un fichier suffit donc à remplacer une surface, sans
 * toucher au code, et son absence n'empêche jamais le jeu de tourner.
 */
const external = new Map();

export const TEXTURE_SLOTS = [
  'ground-quilt', 'ground-check', 'ground-scale', 'ground-polka',
  'hazard-stripes', 'grass', 'inflatable-bands', 'confetti',
];

export async function loadExternalTextures(onProgress = () => {}) {
  const loader = new THREE.TextureLoader();
  let done = 0, found = 0;
  await Promise.all(TEXTURE_SLOTS.map(async (slot) => {
    for (const ext of ['png', 'jpg', 'webp']) {
      try {
        const res = await fetch(`/textures/${slot}.${ext}`, { method: 'HEAD' });
        if (!res.ok) continue;
        const tex = await loader.loadAsync(`/textures/${slot}.${ext}`);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        tex.colorSpace = THREE.SRGBColorSpace;
        external.set(slot, tex);
        found++;
        break;
      } catch { /* absent : on gardera le procedural */ }
    }
    onProgress(++done, TEXTURE_SLOTS.length);
  }));
  console.log(`[textures] ${found}/${TEXTURE_SLOTS.length} textures peintes chargees`);
  return found;
}

/** Renvoie la texture peinte du slot, réglée sur la répétition demandée. */
function painted(slot, repeat) {
  const src = external.get(slot);
  if (!src) return null;
  const key = `ext-${slot}|${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const tex = src.clone();
  tex.needsUpdate = true;
  tex.repeat.set(repeat[0], repeat[1]);
  cache.set(key, tex);
  return tex;
}

function make(key, size, draw, repeat) {
  const k = `${key}|${repeat}`;
  if (cache.has(k)) return cache.get(k);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(k, tex);
  return tex;
}

/** Dessine une forme et ses répliques débordantes : c'est ce qui supprime la couture. */
function wrap(ctx, size, x, y, extent, drawAt) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx, py = y + dy;
      if (px < -extent || px > size + extent || py < -extent || py > size + extent) continue;
      drawAt(px, py);
    }
  }
}

/** PRNG déterministe : deux exécutions donnent la même texture, donc le même rendu. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Salissure douce : évite l'aplat parfaitement mort sans salir la couleur. */
function grain(ctx, size, seed, amount = 0.035, blobs = 90) {
  const r = rng(seed);
  for (let i = 0; i < blobs; i++) {
    const x = r() * size, y = r() * size, rad = size * (0.03 + r() * 0.07);
    const dark = r() > 0.5;
    ctx.fillStyle = dark ? `rgba(0,0,0,${amount})` : `rgba(255,255,255,${amount * 1.4})`;
    wrap(ctx, size, x, y, rad, (px, py) => {
      ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
    });
  }
}

/** MOTIF — vinyle matelassé : losanges gonflés, coutures et points. La signature du genre. */
export function quiltedVinyl({ base = '#ffffff', seam = '#d7d7d7', cells = 5, repeat = [4, 8] } = {}) {
  const hand = painted('ground-quilt', repeat);
  if (hand) return hand;
  return make(`quilt-${base}-${seam}-${cells}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const step = s / cells;

    // Bombé de chaque losange
    for (let i = 0; i <= cells; i++) {
      for (let j = 0; j <= cells; j++) {
        const cx = i * step, cy = j * step;
        wrap(ctx, s, cx, cy, step, (px, py) => {
          const g = ctx.createRadialGradient(px, py, 0, px, py, step * 0.72);
          g.addColorStop(0, 'rgba(255,255,255,0.30)');
          g.addColorStop(0.65, 'rgba(255,255,255,0.05)');
          g.addColorStop(1, 'rgba(0,0,0,0.045)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(px, py, step * 0.72, 0, Math.PI * 2); ctx.fill();
        });
      }
    }

    // Coutures diagonales (périodiques donc raccordables)
    ctx.strokeStyle = seam;
    ctx.lineWidth = Math.max(2, s / 220);
    ctx.setLineDash([s / 44, s / 62]);
    for (let k = -cells * 2; k <= cells * 2; k++) {
      ctx.beginPath(); ctx.moveTo(k * step, 0); ctx.lineTo(k * step + s, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k * step, s); ctx.lineTo(k * step + s, 0); ctx.stroke();
    }
    ctx.setLineDash([]);
    grain(ctx, s, 7, 0.03);
  }, repeat);
}

/** MOTIF — damier à cases arrondies, plus doux qu'un damier net. */
export function softChecker({ a = '#ffffff', b = '#d4d4d4', cells = 4, repeat = [5, 10] } = {}) {
  const hand = painted('ground-check', repeat);
  if (hand) return hand;
  return make(`checker-${a}-${b}-${cells}`, 512, (ctx, s) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, s, s);
    const q = s / cells, r = q * 0.22;
    ctx.fillStyle = b;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        if ((x + y) % 2 === 0) continue;
        const px = x * q, py = y * q;
        ctx.beginPath();
        ctx.roundRect(px + q * 0.04, py + q * 0.04, q * 0.92, q * 0.92, r);
        ctx.fill();
      }
    }
    grain(ctx, s, 13, 0.028);
  }, repeat);
}

/** SIGNAL — rayures diagonales de danger, bords adoucis. Matériau blanc attendu. */
export function hazardStripes({ a = '#ffb01f', b = '#ff6a2b', bands = 6, repeat = [6, 2] } = {}) {
  const hand = painted('hazard-stripes', repeat);
  if (hand) return hand;
  return make(`hazard-${a}-${b}-${bands}`, 512, (ctx, s) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, s, s);
    const w = s / bands;
    ctx.save();
    ctx.translate(s / 2, s / 2); ctx.rotate(-Math.PI / 4); ctx.translate(-s, -s);
    for (let i = -bands; i <= bands * 3; i++) {
      const x = i * w * 2;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, b); g.addColorStop(0.5, b); g.addColorStop(1, b);
      ctx.fillStyle = g;
      ctx.fillRect(x, -s, w, s * 4);
    }
    ctx.restore();
    // Reflet longitudinal : donne le côté vinyle gonflé
    const gl = ctx.createLinearGradient(0, 0, 0, s);
    gl.addColorStop(0, 'rgba(255,255,255,0.22)');
    gl.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    gl.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, s, s);
  }, repeat);
}

/** MOTIF — pois en quinconce, calibrés pour se raccorder. */
export function polkaStagger({ base = '#ffffff', dot = '#e6e6e6', cells = 3, repeat = [8, 16] } = {}) {
  const hand = painted('ground-polka', repeat);
  if (hand) return hand;
  return make(`polka-${base}-${dot}-${cells}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const step = s / cells, rad = step * 0.17;
    ctx.fillStyle = dot;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const cx = x * step + (y % 2 ? step * 0.5 : 0) + step * 0.5;
        const cy = y * step + step * 0.5;
        wrap(ctx, s, cx, cy, rad, (px, py) => {
          ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
        });
      }
    }
    grain(ctx, s, 29, 0.025);
  }, repeat);
}

/** MOTIF — herbe cartoon : touffes réparties, aucune ligne d'horizon. */
export function grassTufts({ base = '#ffffff', tuft = '#eaeaea', count = 220, repeat = [26, 32] } = {}) {
  const hand = painted('grass', repeat);
  if (hand) return hand;
  return make(`grass-${base}-${tuft}-${count}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = tuft;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, s / 190);
    // Sinusoides de periode entiere : elles se raccordent d'un bord a l'autre.
    for (let i = 0; i < 7; i++) {
      const yBase = (s / 7) * i;
      const amp = s * 0.035 * (1 + (i % 3) * 0.4);
      for (const dy of [-s, 0, s]) {
        ctx.beginPath();
        for (let x = 0; x <= s; x += 4) {
          const y = yBase + dy + Math.sin((x / s) * Math.PI * 4 + i) * amp;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    grain(ctx, s, 41, 0.025, 100);
  }, repeat);
}

/** SIGNAL — bandes gonflées, pour les tubes, arches et rouleaux. */
export function inflatedBands({ a = '#1fc9b8', b = '#f2fffd', bands = 8, repeat = [1, 8] } = {}) {
  const hand = painted('inflatable-bands', repeat);
  if (hand) return hand;
  return make(`bands-${a}-${b}-${bands}`, 512, (ctx, s) => {
    const h = s / bands;
    for (let i = 0; i < bands; i++) {
      const g = ctx.createLinearGradient(0, i * h, 0, (i + 1) * h);
      const c = i % 2 ? b : a;
      g.addColorStop(0, 'rgba(0,0,0,0.10)');
      g.addColorStop(0.18, c);
      g.addColorStop(0.42, '#ffffff22');
      g.addColorStop(0.5, c);
      g.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = c;
      ctx.fillRect(0, i * h, s, h);
      ctx.fillStyle = g;
      ctx.fillRect(0, i * h, s, h);
    }
  }, repeat);
}

/** MOTIF — écailles arrondies, pour varier des pois et du damier. */
export function scales({ base = '#ffffff', line = '#dedede', cells = 5, repeat = [6, 12] } = {}) {
  const hand = painted('ground-scale', repeat);
  if (hand) return hand;
  return make(`scales-${base}-${line}-${cells}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const step = s / cells, rad = step * 0.62;
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(2, s / 200);
    for (let y = 0; y <= cells; y++) {
      for (let x = 0; x <= cells; x++) {
        const cx = x * step + (y % 2 ? step * 0.5 : 0);
        const cy = y * step;
        wrap(ctx, s, cx, cy, rad, (px, py) => {
          ctx.beginPath();
          ctx.arc(px, py, rad, Math.PI * 0.12, Math.PI * 0.88);
          ctx.stroke();
        });
      }
    }
    grain(ctx, s, 53, 0.022);
  }, repeat);
}

/** SIGNAL — confettis épars, pour les zones de fête et le lobby. */
export function confettiPattern({ base = '#ffffff', colors = ['#ff5f7e', '#4fd1c5', '#ffd83d', '#8b7bff'], count = 90, repeat = [4, 4] } = {}) {
  const hand = painted('confetti', repeat);
  if (hand) return hand;
  return make(`confetti-${base}-${count}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const r = rng(17);
    for (let i = 0; i < count; i++) {
      const x = r() * s, y = r() * s, w = s * 0.016, h = s * 0.032, rot = r() * Math.PI;
      ctx.fillStyle = colors[Math.floor(r() * colors.length)];
      wrap(ctx, s, x, y, h, (px, py) => {
        ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
        ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, w * 0.35); ctx.fill();
        ctx.restore();
      });
    }
  }, repeat);
}

/**
 * Marquages peints au sol, en blanc sur fond transparent : flèches de direction,
 * cercles concentriques, chevrons, grille. Posés à plat au-dessus de la piste, ils
 * donnent de l'information au joueur et cassent l'uniformité d'un long couloir.
 */
export function floorMarkings(kind, { color = '#ffffff', alpha = 0.55 } = {}) {
  return make(`mark-${kind}-${color}`, 512, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (kind === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.16);
      ctx.lineTo(s * 0.80, s * 0.52);
      ctx.lineTo(s * 0.64, s * 0.52);
      ctx.lineTo(s * 0.64, s * 0.84);
      ctx.lineTo(s * 0.36, s * 0.84);
      ctx.lineTo(s * 0.36, s * 0.52);
      ctx.lineTo(s * 0.20, s * 0.52);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'rings') {
      for (const [r, w] of [[0.42, 0.07], [0.28, 0.055], [0.13, 0.11]]) {
        ctx.lineWidth = s * w;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s * r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (kind === 'chevrons') {
      ctx.lineWidth = s * 0.075;
      for (let i = 0; i < 3; i++) {
        const y = s * (0.24 + i * 0.26);
        ctx.beginPath();
        ctx.moveTo(s * 0.2, y + s * 0.12);
        ctx.lineTo(s * 0.5, y - s * 0.09);
        ctx.lineTo(s * 0.8, y + s * 0.12);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = s * 0.035;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo((s / 4) * i, 0); ctx.lineTo((s / 4) * i, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (s / 4) * i); ctx.lineTo(s, (s / 4) * i); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }, [1, 1]);
}
