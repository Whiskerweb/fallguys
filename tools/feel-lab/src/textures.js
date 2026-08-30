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
  // Ces trois motifs sont les plus employes du parcours et interrogeaient deja
  // painted(), mais n'etaient pas dans la liste : leur remplacement par un fichier
  // peint etait impossible par construction.
  'ground-dash', 'ground-maze', 'ground-swoosh',
  'hazard-stripes', 'grass', 'inflatable-bands', 'confetti',
  // Mini-jeu « Les Portes ».
  'door-paper', 'wall-plating', 'ground-runway', 'foam-pit', 'crowd-tier',
  // Mini-jeu « Le Rondin ».
  'log-bark', 'log-path', 'lagoon-water', 'jungle-canopy',
  // Deja genere et livre de longue date, mais absent de cette liste : il n'avait donc
  // jamais ete charge une seule fois. Les berges du lagon lui donnent enfin un emploi.
  'foam-moss-turf',
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
  // La cle reste attachee au canevas : les scripts de diagnostic peuvent ainsi savoir
  // QUELLE texture porte un materiau, ce que l'uuid ne dit pas.
  c.dataset.cle = k;
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
export function softChecker({ a = '#ffffff', b = '#e6e6e6', cells = 4, repeat = [5, 10] } = {}) {
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

/**
 * SIGNAL — tapis roulant. Des chevrons qui montrent OU la bande pousse.
 *
 * Les tapis reprenaient la texture des rouleaux : les deux tapis se ressemblaient donc
 * entre eux, ET ressemblaient au rouleau pose dessus. Impossible de savoir de quel cote
 * on allait etre chasse avant de l'avoir subi. Cette fabrique n'a volontairement PAS de
 * slot peint : une surface dont la lecture decide de la trajectoire ne doit pas pouvoir
 * etre remplacee par une image qui ne dit plus rien.
 *
 * Les chevrons pointent vers +X de la texture. Pour le tapis oppose, on retourne la
 * repetition horizontale plutot que de dessiner un second canevas.
 */
export function conveyorArrows({ base = '#2f6bff', arrow = '#dce8ff', rows = 3, cols = 3, repeat = [1, 1] } = {}) {
  return make(`belt-${base}-${arrow}-${rows}-${cols}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    // Lattes claires en travers du sens de poussee : elles donnent le grain du tapis,
    // les chevrons donnent son sens.
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < rows; i++) ctx.fillRect(0, (i + 0.94) * s / rows, s, s / rows * 0.12);
    ctx.strokeStyle = arrow;
    ctx.lineWidth = s * 0.05;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const w = s / cols, h = s / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * w, y = (r + 0.45) * h;
        wrap(ctx, s, x, y, w, (px, py) => {
          ctx.beginPath();
          ctx.moveTo(px - w * 0.16, py - h * 0.2);
          ctx.lineTo(px + w * 0.16, py);
          ctx.lineTo(px - w * 0.16, py + h * 0.2);
          ctx.stroke();
        });
      }
    }
  }, repeat);
}

/**
 * SIGNAL — patinoire. Une surface qui ANNONCE qu'elle ne tient pas.
 *
 * Un sol glissant qui ressemble a un sol normal n'est pas une difficulte, c'est une
 * trahison : le joueur perd sans avoir eu la moindre chance de lire le piege. Il faut
 * donc que la glace se voie de loin — teinte froide, reflets francs, et les TRACES DE
 * PATINS qui disent, avant meme d'y poser le pied, que ca part de cote.
 *
 * Pas de slot peint, comme pour les tapis : une surface dont la lecture decide de la
 * trajectoire ne doit pas pouvoir etre remplacee par une image qui ne dit plus rien.
 */
export function iceRink({ base = '#dff2ff', trace = '#ffffff', reflet = '#b6e3ff', arcs = 5, repeat = [1, 1] } = {}) {
  return make(`ice-${base}-${trace}-${reflet}-${arcs}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);

    // Plaques froides : la glace n'est jamais d'une seule teinte, elle prend par zones.
    const r = rng(23);
    ctx.fillStyle = reflet;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 7; i++) {
      const x = r() * s, y = r() * s, rad = s * (0.1 + r() * 0.16);
      wrap(ctx, s, x, y, rad, (px, py) => {
        ctx.beginPath(); ctx.ellipse(px, py, rad, rad * 0.62, r() * 3, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.globalAlpha = 1;

    // Traces de patins : des arcs, jamais des droites. Une rayure droite se lit comme
    // une fissure ; c'est la courbe qui dit « ici, on derape ».
    ctx.strokeStyle = trace;
    ctx.lineCap = 'round';
    for (let i = 0; i < arcs; i++) {
      const x = r() * s, y = r() * s, rad = s * (0.14 + r() * 0.2);
      const a0 = r() * Math.PI * 2, arc = 0.7 + r() * 1.5;
      ctx.lineWidth = s * (0.008 + r() * 0.012);
      ctx.globalAlpha = 0.5 + r() * 0.35;
      wrap(ctx, s, x, y, rad, (px, py) => {
        ctx.beginPath(); ctx.arc(px, py, rad, a0, a0 + arc); ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, rad * 0.86, a0 + 0.15, a0 + arc - 0.1); ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;

    // Eclats brillants : quelques points francs, pour que la surface accroche la lumiere
    // meme en aplat toon, ou aucun reflet speculaire ne viendra la sauver.
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 14; i++) {
      const x = r() * s, y = r() * s, rad = s * (0.006 + r() * 0.012);
      wrap(ctx, s, x, y, rad, (px, py) => {
        ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
      });
    }
  }, repeat);
}

/**
 * SIGNAL — toboggan. Des filets de vitesse dans le SENS de la descente.
 *
 * La piste et le motif partagent le meme axe : les filets suivent la pente, donc ils
 * disent ou l'on va etre emporte. Un damier ou des pois, sur une glissade, ne disent
 * rien du tout et la descente se lit comme un sol ordinaire.
 */
export function slideStreaks({ base = '#9fd8ff', streak = '#ffffff', lanes = 7, repeat = [1, 1] } = {}) {
  return make(`slide-${base}-${streak}-${lanes}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const r = rng(77);
    ctx.strokeStyle = streak;
    ctx.lineCap = 'round';
    for (let i = 0; i < lanes * 3; i++) {
      const x = ((i % lanes) + 0.5) * s / lanes + (r() - 0.5) * s / lanes * 0.6;
      const y = r() * s, len = s * (0.16 + r() * 0.3);
      ctx.lineWidth = s * (0.01 + r() * 0.02);
      ctx.globalAlpha = 0.3 + r() * 0.4;
      wrap(ctx, s, x, y, len, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py - len / 2);
        ctx.lineTo(px, py + len / 2);
        ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
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

/** MOTIF — traits arrondis épars, le marquage signature des sols du genre. Gros et lisibles. */
export function dashPattern({ base = '#ffffff', dash = '#ececec', count = 22, repeat = [3, 6] } = {}) {
  const hand = painted('ground-dash', repeat);
  if (hand) return hand;
  return make(`dash-${base}-${dash}-${count}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = dash;
    const r = rng(91);
    for (let i = 0; i < count; i++) {
      const x = r() * s, y = r() * s;
      const w = s * (0.055 + r() * 0.05), h = s * 0.021;
      const rot = r() * Math.PI;
      wrap(ctx, s, x, y, w, (px, py) => {
        ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
        ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, h / 2); ctx.fill();
        ctx.restore();
      });
    }
  }, repeat);
}

/** MOTIF — labyrinthe à angles arrondis : un grand graphisme qui occupe la surface. */
export function mazePattern({ base = '#ffffff', line = '#e8e8e8', cells = 6, repeat = [3, 6] } = {}) {
  const hand = painted('ground-maze', repeat);
  if (hand) return hand;
  return make(`maze-${base}-${line}-${cells}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = line;
    ctx.lineWidth = s * 0.032;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const q = s / cells;
    const r = rng(7);
    // Segments alignés sur la grille : les extrémités tombent sur les bords, donc ça raccorde.
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const cx = x * q, cy = y * q;
        const kind = Math.floor(r() * 4);
        ctx.beginPath();
        if (kind === 0) { ctx.moveTo(cx, cy + q / 2); ctx.lineTo(cx + q, cy + q / 2); }
        else if (kind === 1) { ctx.moveTo(cx + q / 2, cy); ctx.lineTo(cx + q / 2, cy + q); }
        else if (kind === 2) { ctx.moveTo(cx, cy + q / 2); ctx.lineTo(cx + q / 2, cy + q / 2); ctx.lineTo(cx + q / 2, cy + q); }
        else { ctx.moveTo(cx + q / 2, cy); ctx.lineTo(cx + q / 2, cy + q / 2); ctx.lineTo(cx + q, cy + q / 2); }
        ctx.stroke();
      }
    }
  }, repeat);
}

/** MOTIF — grandes courbes larges, façon marquage de piste. */
export function swoosh({ base = '#ffffff', line = '#ededed', repeat = [2, 5] } = {}) {
  const hand = painted('ground-swoosh', repeat);
  if (hand) return hand;
  return make(`swoosh-${base}-${line}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = line;
    ctx.lineCap = 'round';
    ctx.lineWidth = s * 0.075;
    for (let i = 0; i < 4; i++) {
      const yBase = (s / 4) * i;
      for (const dy of [-s, 0, s]) {
        ctx.beginPath();
        for (let x = 0; x <= s; x += 6) {
          const y = yBase + dy + Math.sin((x / s) * Math.PI * 2 + i * 1.4) * s * 0.06;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }, repeat);
}

// ───────────────────────── Mini-jeu « Les Portes » ─────────────────────────

/**
 * MOTIF — papier de soie tendu sur un cadre.
 * Les fibres sont TRÈS fines et le grain quasi nul : ce panneau porte l'indice qui dit
 * au joueur si la porte cède. Une texture bruyante noierait ce signal, qui doit rester
 * lisible à vingt mètres.
 */
export function tissuePaper({ base = '#ffffff', fiber = '#ebebeb', repeat = [1, 1] } = {}) {
  const hand = painted('door-paper', repeat);
  if (hand) return hand;
  return make(`paper-${base}-${fiber}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const r = rng(0x9a17);
    ctx.strokeStyle = fiber;
    ctx.lineWidth = 1;
    // Fibres longues et presque horizontales, rebouclées en haut et en bas : une fibre
    // qui sort par un bord rentre par l'autre, donc aucune couture.
    for (let i = 0; i < 130; i++) {
      const y = r() * s, amp = 2 + r() * 5, phase = r() * Math.PI * 2;
      ctx.globalAlpha = 0.25 + r() * 0.4;
      ctx.beginPath();
      for (let x = 0; x <= s; x += 8) {
        const yy = (y + Math.sin(x / s * Math.PI * 2 + phase) * amp + s) % s;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Deux plis mous : ils suffisent à faire lire « feuille tendue » plutôt que « mur ».
    for (const cy of [s * 0.34, s * 0.71]) {
      const g = ctx.createLinearGradient(0, cy - s * 0.06, 0, cy + s * 0.06);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.05)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, cy - s * 0.06, s, s * 0.12);
    }
  }, repeat);
}

/** MOTIF — paroi gonflable en tubes verticaux soudés. Le mur qui porte les portes. */
export function weldedTubes({ base = '#ffffff', groove = '#d2d2d2', tubes = 6, repeat = [1, 1] } = {}) {
  const hand = painted('wall-plating', repeat);
  if (hand) return hand;
  return make(`tubes-${base}-${groove}-${tubes}`, 512, (ctx, s) => {
    const w = s / tubes;
    for (let i = 0; i < tubes; i++) {
      const g = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      g.addColorStop(0, groove);
      g.addColorStop(0.18, base);
      g.addColorStop(0.42, '#ffffff');
      g.addColorStop(0.82, base);
      g.addColorStop(1, groove);
      ctx.fillStyle = g;
      ctx.fillRect(i * w, 0, w + 1, s);
    }
    // Piqûre pointillée le long de chaque soudure.
    ctx.strokeStyle = 'rgba(0,0,0,0.13)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 9]);
    for (let i = 0; i <= tubes; i++) {
      ctx.beginPath(); ctx.moveTo(i * w, 0); ctx.lineTo(i * w, s); ctx.stroke();
    }
    ctx.setLineDash([]);
  }, repeat);
}

/** MOTIF — couloirs de piste : bandes longitudinales et grains antidérapants. */
export function runwayLanes({ base = '#ffffff', line = '#dcdcdc', lanes = 4, repeat = [2, 8] } = {}) {
  const hand = painted('ground-runway', repeat);
  if (hand) return hand;
  return make(`runway-${base}-${line}-${lanes}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const r = rng(0x51ab);
    ctx.fillStyle = 'rgba(0,0,0,0.045)';
    for (let i = 0; i < 900; i++) {
      const x = r() * s, y = r() * s, rad = 1 + r() * 2.2;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    const w = s / lanes;
    ctx.strokeStyle = line;
    ctx.lineWidth = 4;
    for (let i = 0; i <= lanes; i++) {
      ctx.beginPath(); ctx.moveTo(i * w, 0); ctx.lineTo(i * w, s); ctx.stroke();
    }
  }, repeat);
}

/** MOTIF — fosse de mousse : cubes empilés, sol d'amortissement. */
export function foamPit({ base = '#ffffff', edge = '#dadada', cells = 4, repeat = [3, 3] } = {}) {
  const hand = painted('foam-pit', repeat);
  if (hand) return hand;
  return make(`foam-${base}-${edge}-${cells}`, 512, (ctx, s) => {
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, s, s);
    const step = s / cells;
    const r = rng(0x30fa);
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        // Décalage borné à un quart de case : le bloc reste dans sa case, donc les
        // blocs du bord ne débordent jamais et le raccord tient.
        const pad = step * 0.09;
        const cx = gx * step + pad + (r() - 0.5) * step * 0.12;
        const cy = gy * step + pad + (r() - 0.5) * step * 0.12;
        const size = step - pad * 2;
        ctx.fillStyle = r() > 0.5 ? base : '#f4f4f4';
        ctx.beginPath();
        ctx.roundRect(cx, cy, size, size, size * 0.3);
        ctx.fill();
      }
    }
  }, repeat);
}

/**
 * SIGNAL — gradins garnis de spectateurs. Matériau blanc attendu.
 * Le repli procédural n'a pas d'ambition : il évite un mur gris si la texture peinte
 * manque, sur une surface qu'on ne voit jamais de près.
 */
export function crowdTier({ rows = 5, repeat = [6, 1] } = {}) {
  const hand = painted('crowd-tier', repeat);
  if (hand) return hand;
  const teintes = ['#ff4fa3', '#2dd9d9', '#ffee7a', '#ff8a1f', '#a5d440', '#b072ff'];
  return make(`crowd-${rows}`, 512, (ctx, s) => {
    ctx.fillStyle = '#f0f0f4';
    ctx.fillRect(0, 0, s, s);
    const r = rng(0x77cd);
    const h = s / rows;
    for (let row = 0; row < rows; row++) {
      const y = s - (row + 1) * h;
      ctx.fillStyle = row % 2 ? '#ffffff' : '#e8e8ee';
      ctx.fillRect(0, y, s, h);
      const per = 9 + row;
      const w = s / per;
      for (let i = 0; i < per; i++) {
        ctx.fillStyle = teintes[Math.floor(r() * teintes.length)];
        const cw = w * 0.62, ch = h * 0.72;
        ctx.beginPath();
        ctx.roundRect(i * w + (w - cw) / 2, y + h - ch, cw, ch, cw / 2);
        ctx.fill();
      }
    }
  }, repeat);
}

/**
 * SIGNAL — emblème peint au centre d'une porte. Fond transparent.
 *
 * Purement DÉCORATIF, et c'est une exigence, pas une facilité : l'emblème dépend de la
 * POSITION de la porte dans le mur, jamais de son état. Il donne au mur sa variété et
 * un vocabulaire commun aux joueurs (« la porte à l'étoile »), sans jamais dire laquelle
 * cède. Toute corrélation avec l'état ferait de ce mur une devinette à réponse affichée.
 */
export function doorCrest(kind, { color = '#ffffff', alpha = 0.5 } = {}) {
  return make(`crest-${kind}-${color}-${alpha}`, 256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.055;
    ctx.lineJoin = 'round';
    const c = s / 2, r = s * 0.3;

    const polygone = (branches, rExt, rInt) => {
      ctx.beginPath();
      for (let i = 0; i < branches * 2; i++) {
        const a = (i / (branches * 2)) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 ? rInt : rExt;
        const x = c + Math.cos(a) * rad, y = c + Math.sin(a) * rad;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    };

    if (kind === 'disque') {
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'anneau') {
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(c, c, r * 0.45, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'etoile') {
      polygone(5, r * 1.15, r * 0.48);
    } else if (kind === 'fleur') {
      polygone(6, r * 1.1, r * 0.62);
    } else if (kind === 'triangle') {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
        const x = c + Math.cos(a) * r * 1.1, y = c + Math.sin(a) * r * 1.1;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
    } else if (kind === 'losange') {
      ctx.beginPath();
      ctx.moveTo(c, c - r * 1.15); ctx.lineTo(c + r * 0.82, c);
      ctx.lineTo(c, c + r * 1.15); ctx.lineTo(c - r * 0.82, c);
      ctx.closePath(); ctx.fill();
    } else {   // 'barres'
      const w = s * 0.11;
      for (const dx of [-w * 2.1, 0, w * 2.1]) {
        ctx.fillRect(c + dx - w / 2, c - r, w, r * 2);
      }
    }
    ctx.globalAlpha = 1;
  }, [1, 1]);
}

export const DOOR_CRESTS = ['disque', 'anneau', 'etoile', 'fleur', 'triangle', 'losange', 'barres'];

/**
 * MOTIF — papier de soie AVEC son emblème déjà peint dessus.
 *
 * L'emblème était un second plan posé devant le panneau : un maillage et un appel de
 * dessin de plus par porte, soit quarante-sept appels pour une décoration. Peint dans la
 * même texture, il ne coûte plus rien — les textures sont mises en cache par clé, donc
 * les sept emblèmes ne font que sept textures pour toute la map.
 */
/** Éclaircit ou assombrit une couleur `#rrggbb`. `k > 1` éclaircit vers le blanc. */
function teinter(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/**
 * MOTIF — panneau de porte COMPLET : couronne festonnée, chevrons, emblème, plinthe.
 *
 * Le panneau ne portait qu'un papier uni et un emblème pâle : de loin, un mur de portes
 * ressemblait à une palissade de draps. La référence tire toute sa lisibilité d'un motif
 * à FORT CONTRASTE — chevrons blancs sur couleur vive — encadré par une couronne et une
 * plinthe qui donnent au panneau une silhouette de porte, et non de bâche.
 *
 * Tout est peint dans une seule texture, donc un seul appel de dessin par porte. Les
 * textures étant mises en cache par clé, un mur entier de portes identiques n'en coûte
 * qu'une.
 *
 * `aspect` = largeur/hauteur du panneau. Il pré-compense l'étirement : sans lui, un
 * chevron dessiné à 45° sur une texture carrée arrive à 30° sur un panneau deux fois plus
 * haut que large, et le motif part en biais mou.
 *
 * ATTENTION — cette texture ne doit JAMAIS dépendre de l'état de la porte. Elle ne reçoit
 * que la teinte du mur et l'emblème de la case, tous deux tirés sur la position.
 */
export function doorPanel(kind, { teinte = '#ff5fa8', aspect = 0.7 } = {}) {
  const papier = painted('door-paper', [1, 1]);
  return make(`porte-${kind}-${teinte}-${aspect.toFixed(2)}`, 512, (ctx, s) => {
    const clair = teinter(teinte, 1.55);
    const fonce = teinter(teinte, 0.78);
    const hCouronne = s * 0.2, hPlinthe = s * 0.085;

    ctx.fillStyle = '#fffdfa';
    ctx.fillRect(0, 0, s, s);

    // --- chevrons, cantonnés entre couronne et plinthe ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, hCouronne, s, s - hCouronne - hPlinthe);
    ctx.clip();
    ctx.fillStyle = teinte;
    const bande = s * 0.135;   // épais : la référence compte cinq ou six chevrons par porte,
                               // pas douze. Trop fins, ils moirent dès qu'on s'éloigne.
    // La pente est divisée par l'aspect : le panneau étant plus haut que large, un
    // chevron dessiné trop plat sur la texture s'écrase encore à l'affichage.
    const pente = 0.62 / Math.max(0.25, aspect);
    for (let k = -8; k < 22; k++) {
      const y0 = hCouronne + k * bande * 2;
      const dy = (s / 2) * pente;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(s / 2, y0 - dy);
      ctx.lineTo(s, y0);
      ctx.lineTo(s, y0 + bande);
      ctx.lineTo(s / 2, y0 + bande - dy);
      ctx.lineTo(0, y0 + bande);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // --- emblème : PÂLE, il donne au mur son vocabulaire sans dominer le motif ---
    // Emblème SOMBRE et non blanc : posé sur des chevrons blancs, un emblème blanc
    // disparaissait une bande sur deux et ne se lisait plus du tout.
    const crest = doorCrest(kind, { color: fonce, alpha: 0.95 });
    if (crest?.image) {
      const t = s * 0.32, x = (s - t) / 2, y = hCouronne + (s - hCouronne - hPlinthe - t) / 2;
      ctx.globalAlpha = 0.42;
      ctx.drawImage(crest.image, x, y, t, t);
      ctx.globalAlpha = 1;
    }

    // --- couronne festonnée ---
    ctx.fillStyle = fonce;
    ctx.fillRect(0, 0, s, hCouronne);
    const lobes = 7, r = s / (lobes * 2);
    ctx.beginPath();
    for (let i = 0; i < lobes; i++) ctx.arc((i + 0.5) * (s / lobes), hCouronne, r, 0, Math.PI);
    ctx.fill();
    // Pastilles : le petit détail sucré de la référence, qui casse l'aplat.
    ctx.fillStyle = clair;
    for (let i = 0; i < lobes; i++) {
      ctx.beginPath();
      ctx.arc((i + 0.5) * (s / lobes), hCouronne * 0.44, s * 0.026, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = clair;
    ctx.fillRect(0, hCouronne * 0.78, s, s * 0.012);

    // --- plinthe, festonnée vers le haut ---
    ctx.fillStyle = fonce;
    ctx.fillRect(0, s - hPlinthe, s, hPlinthe);
    ctx.beginPath();
    for (let i = 0; i < lobes; i++) ctx.arc((i + 0.5) * (s / lobes), s - hPlinthe, r * 0.7, Math.PI, 0);
    ctx.fill();

    // --- fibres du papier, en multiplication : le panneau reste une FEUILLE tendue ---
    if (papier?.image) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(papier.image, 0, 0, s, s);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // --- galbe : lumière en haut, ombre en bas, comme sur les autres pièces gonflées ---
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,0.20)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.03)');
    g.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, [1, 1]);
}

export function doorSheet(kind, { repeat = [1, 1] } = {}) {
  const papier = painted('door-paper', repeat);
  return make(`sheet-${kind}`, 512, (ctx, s) => {
    if (papier?.image) ctx.drawImage(papier.image, 0, 0, s, s);
    else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, s, s);
    }
    // L'emblème reste PÂLE : il donne au mur sa variété sans jamais dominer le panneau,
    // et surtout il ne doit pas se confondre avec un signal de jeu.
    const crest = doorCrest(kind, { color: '#b9a2c8', alpha: 0.5 });
    if (crest?.image) {
      const t = s * 0.46, x = (s - t) / 2, y = (s - t) / 2 - s * 0.04;
      ctx.globalAlpha = 0.62;
      ctx.drawImage(crest.image, x, y, t, t);
      ctx.globalAlpha = 1;
    }
  }, repeat);
}

// ───────────────────────── Mini-jeu « Le Rondin » ─────────────────────────

/** MOTIF — écorce du rondin : sillons verticaux, la teinte vient du matériau. */
export function logBark({ base = '#ffffff', sillon = '#e6e6e6', repeat = [1, 1] } = {}) {
  const hand = painted('log-bark', repeat);
  if (hand) return hand;
  return make(`bark-${base}-${sillon}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = sillon;
    ctx.lineCap = 'round';
    // Sillons verticaux d'epaisseur variable. La phase est un multiple entier de la
    // periode, donc le motif se raccorde d'un bord a l'autre par construction.
    for (let i = 0; i < 26; i++) {
      const x0 = (i / 26) * s;
      ctx.lineWidth = Math.max(1.5, s / 220) * (1 + (i % 4) * 0.55);
      ctx.beginPath();
      for (let y = 0; y <= s; y += 4) {
        const x = x0 + Math.sin((y / s) * Math.PI * 2 * (2 + (i % 3)) + i) * s * 0.012;
        if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    grain(ctx, s, 17, 0.03, 90);
  }, repeat);
}

/** SIGNAL — terre battue du sentier de crête. Matériau blanc attendu. */
export function logPath({ repeat = [1, 1] } = {}) {
  const hand = painted('log-path', repeat);
  if (hand) return hand;
  return make('path-proc', 512, (ctx, s) => {
    ctx.fillStyle = '#e8c88f';
    ctx.fillRect(0, 0, s, s);
    for (const [teinte, n, r] of [['#d2a868', 26, 0.055], ['#f6e3bc', 14, 0.038]]) {
      ctx.fillStyle = teinte;
      for (let i = 0; i < n; i++) {
        const x = ((i * 97) % 100) / 100 * s, y = ((i * 61) % 100) / 100 * s;
        const rad = s * r * (0.7 + ((i * 37) % 10) / 14);
        // Repete sur les quatre cotes : une tache qui deborde revient de l'autre bord.
        for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
          ctx.beginPath(); ctx.arc(x + dx, y + dy, rad, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }, repeat);
}

/** SIGNAL — surface du lagon. Matériau blanc attendu. */
export function lagoonWater({ repeat = [1, 1] } = {}) {
  const hand = painted('lagoon-water', repeat);
  if (hand) return hand;
  return make('lagoon-proc', 512, (ctx, s) => {
    ctx.fillStyle = '#35c8c0';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#6fe0d6';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, s / 150);
    for (let i = 0; i < 90; i++) {
      const x = ((i * 53) % 100) / 100 * s, y = ((i * 89) % 100) / 100 * s;
      const a = ((i * 41) % 100) / 100 * Math.PI, len = s * 0.05;
      for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
        ctx.beginPath();
        ctx.moveTo(x + dx - Math.cos(a) * len, y + dy - Math.sin(a) * len);
        ctx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
        ctx.stroke();
      }
    }
  }, repeat);
}

/** SIGNAL — canopée vue de dessus, pour les berges et le rideau lointain. */
export function jungleCanopy({ repeat = [1, 1] } = {}) {
  const hand = painted('jungle-canopy', repeat);
  if (hand) return hand;
  return make('canopy-proc', 512, (ctx, s) => {
    ctx.fillStyle = '#2e9e44';
    ctx.fillRect(0, 0, s, s);
    for (const [teinte, n] of [['#46c24e', 40], ['#86d96a', 20]]) {
      ctx.fillStyle = teinte;
      for (let i = 0; i < n; i++) {
        const x = ((i * 73) % 100) / 100 * s, y = ((i * 29) % 100) / 100 * s;
        const rad = s * 0.06 * (0.7 + ((i * 17) % 10) / 12);
        for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
          ctx.beginPath(); ctx.arc(x + dx, y + dy, rad, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }, repeat);
}

/** SIGNAL — tapis de mousse des berges. */
export function mossTurf({ repeat = [1, 1] } = {}) {
  const hand = painted('foam-moss-turf', repeat);
  if (hand) return hand;
  return jungleCanopy({ repeat });
}

/**
 * SIGNAL — cernes de la tranche d'un rondin.
 *
 * Volontairement PROCÉDURALE. Un motif de cernes est centré : il ne se raccorde pas, et
 * le lissage de bord du pipeline de textures le détruirait en tentant de le rendre
 * répétable. Or il n'est jamais répété — il couvre un disque, une fois.
 */
export function logRings({ repeat = [1, 1] } = {}) {
  return make('rings-proc', 512, (ctx, s) => {
    ctx.fillStyle = '#efcb94';
    ctx.fillRect(0, 0, s, s);
    const cx = s * 0.52, cy = s * 0.47;
    for (let r = s * 0.5; r > 0; r -= s * 0.021) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.97 + Math.sin(r * 0.09) * 0.03), 0, Math.PI * 2);
      ctx.fillStyle = (Math.round(r / (s * 0.021)) % 2) ? '#d9a05b' : '#efcb94';
      ctx.fill();
    }
    ctx.strokeStyle = '#b57f42';
    ctx.lineWidth = s * 0.035;
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.48, 0, Math.PI * 2); ctx.stroke();
  }, repeat);
}
