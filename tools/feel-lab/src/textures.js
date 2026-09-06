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
  //
  // Le tronc, ses arêtes et ses anneaux n'ont PLUS de texture peinte : la référence est un
  // aplat, et cinq PNG générés pesaient plus de quatre mégaoctets pour un résultat trop
  // détaillé qui jurait avec le reste du jeu. Ils sont remplacés par `boisLisse`,
  // `sentierBois` et `anneauxBois`, procéduraux et gratuits. Pas de 'finish-checker' non
  // plus : un damier se dessine mieux qu'il ne se génère.
  'lagoon-water', 'jungle-canopy', 'plank-bridge', 'river-stone',
  // Deja genere et livre de longue date, mais absent de cette liste : il n'avait donc
  // jamais ete charge une seule fois. Les berges du lagon lui donnent enfin un emploi.
  'foam-moss-turf',
  // Mini-jeu « Les Dalles ».
  'sky-meadow', 'cloud-bank',
  /*
   * Mini-jeu « L'Hexagone ».
   *
   * Trois SIGNAL de fond seulement. Les motifs des faces d'hexagone, eux, ne sont PAS ici
   * et n'y seront jamais : ce sont des motifs CENTRES sur une face, et `seamless.mjs` les
   * detruirait en les rendant raccordables — le meme piege que la face des Dalles. Ils
   * sont procéduraux, plus bas dans ce fichier.
   */
  'slime-pink', 'candy-hills', 'sky-triangles',
  // L'enseigne « FINISH » de la porte d'arrivée (`arrivee.js`) : une image, pas un
  // motif — elle ne se répète jamais, et `seamless.mjs` ne doit pas y toucher.
  'finish-sign',
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
  // `size` est un côté (canevas carré, le cas de tous les motifs) ou `[largeur, hauteur]`
  // pour une IMAGE qui a un rapport, comme l'enseigne d'arrivée.
  [c.width, c.height] = Array.isArray(size) ? size : [size, size];
  const ctx = c.getContext('2d');
  draw(ctx, c.width, c.height);
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

/**
 * SIGNAL — rayures de sucre d'orge, diagonales, dans les DEUX couleurs demandées.
 *
 * `hazardStripes` rend la texture PEINTE dès que `hazard-stripes.jpg` existe, quelles
 * que soient les couleurs qu'on lui passe : les piliers de la porte d'arrivée demandaient
 * du blanc et rouge et sortaient orange et jaune sur les quatre cartes. Celle-ci n'a pas
 * de repli peint, exprès. Et elle est raccordable PAR CONSTRUCTION : chaque bande est le
 * lieu des points où (x − y) tombe dans un intervalle, de période s / bands — une
 * translation de s en x ou en y retombe donc exactement sur la même bande, ce qu'une
 * rotation de 45° d'un remplissage ne garantit jamais.
 */
export function candyStripes({ a = '#ffffff', b = '#ff3d8b', bands = 6, repeat = [1, 1] } = {}) {
  return make(`candy-${a}-${b}-${bands}`, 512, (ctx, s) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = b;
    const p = s / bands;
    for (let k = -bands - 1; k <= bands + 1; k++) {
      const d = k * p;
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d + p / 2, 0);
      ctx.lineTo(d + p / 2 + s, s);
      ctx.lineTo(d + s, s);
      ctx.closePath();
      ctx.fill();
    }
    // Un reflet le long du tube, comme sur les bandes gonflées : ça dit « vinyle ».
    const gl = ctx.createLinearGradient(0, 0, s, 0);
    gl.addColorStop(0, 'rgba(255,255,255,0.18)');
    gl.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    gl.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, s, s);
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
 * Longtemps PUREMENT procédurale : un motif de cernes est centré, il ne se raccorde pas,
 * et le lissage de bord du pipeline de textures le détruit en tentant de le rendre
 * répétable. Or il n'est jamais répété — il couvre un disque, une fois.
 *
 * L'épreuve a nuancé la règle. Un motif de cernes est RADIALEMENT SYMÉTRIQUE, donc ses
 * quatre bords se ressemblent déjà : le lissage n'a presque rien eu à corriger (0,8/255
 * mesuré) et n'a donc rien abîmé. La version peinte est admise ici, et elle seule — le
 * damier d'arrivée, lui, a été détruit par le même lissage et reste procédural.
 */
export function logRings({ repeat = [1, 1] } = {}) {
  return painted('log-rings-cut', repeat) ?? make('rings-proc', 512, (ctx, s) => {
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

// ───────────────────────── Mini-jeu « Les Dalles » ─────────────────────────

/**
 * MOTIF — face d'une dalle. La teinte vient du matériau.
 *
 * Volontairement PROCÉDURALE, et pour la même raison que `logRings` : ce motif est
 * CENTRÉ sur son carré, il n'est jamais répété, et le lissage de bord du pipeline de
 * textures le détruirait en essayant de le rendre raccordable. Une dalle porte une
 * image, pas un tissu.
 *
 * Ce que le dessin doit apporter : un bord franc. Six cents dalles jaunes identiques
 * posées bord à bord forment un aplat où l'on ne distingue plus UNE dalle — or c'est
 * exactement l'unité de décision du mini-jeu. Le liseré et le panneau creusé rendent
 * chaque case comptable d'un coup d'œil, à la distance où l'on doit choisir.
 */
export function tileFace({ repeat = [1, 1] } = {}) {
  return make('tile-face-proc', 256, (ctx, s) => {
    const arrondi = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    ctx.fillStyle = '#d9d9d9';           // liseré : le bord de la dalle
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#ffffff';           // plateau
    arrondi(s * 0.055, s * 0.055, s * 0.89, s * 0.89, s * 0.10);
    ctx.fill();
    ctx.fillStyle = '#efefef';           // panneau creusé
    arrondi(s * 0.155, s * 0.155, s * 0.69, s * 0.69, s * 0.07);
    ctx.fill();
    // Quatre rainures courtes dans les coins du panneau : elles cassent l'aplat central
    // sans introduire de motif directionnel, qui donnerait un sens de lecture faux.
    ctx.fillStyle = '#e2e2e2';
    for (const [ux, uy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = s * (0.235 + ux * 0.415), y = s * (0.235 + uy * 0.415);
      arrondi(x, y, s * 0.115, s * 0.115, s * 0.03);
      ctx.fill();
    }
    grain(ctx, s, 41, 0.018, 60);
  }, repeat);
}

/** SIGNAL — herbe rase des plateformes et des îlots volants. Matériau blanc attendu. */
export function skyMeadow({ repeat = [1, 1] } = {}) {
  const hand = painted('sky-meadow', repeat);
  if (hand) return hand;
  return make('meadow-proc', 512, (ctx, s) => {
    ctx.fillStyle = '#6fd44a';
    ctx.fillRect(0, 0, s, s);
    for (const [teinte, n, r] of [['#5cbf3c', 30, 0.06], ['#8ee265', 18, 0.04]]) {
      ctx.fillStyle = teinte;
      for (let i = 0; i < n; i++) {
        const x = ((i * 71) % 100) / 100 * s, y = ((i * 43) % 100) / 100 * s;
        const rad = s * r * (0.7 + ((i * 23) % 10) / 13);
        for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
          ctx.beginPath(); ctx.arc(x + dx, y + dy, rad, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }, repeat);
}

/** SIGNAL — banc de nuages du fond. Matériau blanc attendu. */
export function cloudBank({ repeat = [1, 1] } = {}) {
  const hand = painted('cloud-bank', repeat);
  if (hand) return hand;
  return make('cloudbank-proc', 512, (ctx, s) => {
    ctx.fillStyle = '#bfe9ff';
    ctx.fillRect(0, 0, s, s);
    for (const [teinte, n, r] of [['#9fd8f2', 22, 0.11], ['#ffffff', 34, 0.10]]) {
      ctx.fillStyle = teinte;
      for (let i = 0; i < n; i++) {
        const x = ((i * 59) % 100) / 100 * s, y = ((i * 83) % 100) / 100 * s;
        const rad = s * r * (0.6 + ((i * 31) % 10) / 11);
        for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
          ctx.beginPath(); ctx.arc(x + dx, y + dy, rad, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }, repeat);
}

// ───────────────────── Échine et liaisons (mini-jeu « Le Rondin ») ─────────────────────

/**
 * SIGNAL — arête d'écorce : segments dodus ceinturés d'un cordage.
 *
 * Rouge et bleu sont le MÊME objet dans deux teintes. La référence s'en sert pour rythmer
 * une longue échine sans introduire un second vocabulaire : le joueur n'a pas à apprendre
 * que bleu voudrait dire autre chose que rouge, il voit juste qu'il en a déjà passé un.
 */
export function barkRidge(teinte = 'red', { repeat = [1, 1] } = {}) {
  const slot = teinte === 'blue' ? 'bark-ridge-blue' : 'bark-ridge-red';
  const hand = painted(slot, repeat);
  if (hand) return hand;
  const [clair, sombre] = teinte === 'blue'
    ? ['#2e6fd0', '#1b4487']
    : ['#d93a2b', '#a82a1e'];
  return make(`ridge-${teinte}`, 256, (ctx, s) => {
    ctx.fillStyle = clair;
    ctx.fillRect(0, 0, s, s);
    // Huit segments : la période divise la taille, donc le bord gauche prolonge le droit.
    const n = 8, pas = s / n;
    ctx.fillStyle = sombre;
    for (let i = 0; i < n; i++) {
      ctx.fillRect(i * pas - s * 0.008, 0, s * 0.016, s);
    }
    // Cordage : une bande horizontale qui ne touche aucun bord vertical, donc raccordée.
    const y = s * 0.62, h = s * 0.12;
    ctx.fillStyle = '#f0c75a';
    ctx.fillRect(0, y, s, h);
    ctx.strokeStyle = '#c99b32';
    ctx.lineWidth = Math.max(2, s / 128);
    for (let i = 0; i < n * 2; i++) {
      const x = (i * s) / (n * 2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + s / (n * 2) * 0.7, y + h);
      ctx.stroke();
    }
    grain(ctx, s, 31, 0.028);
  }, repeat);
}

/** SIGNAL — tablier de planches du pont de cordes. */
export function plankBridge({ repeat = [1, 1] } = {}) {
  const hand = painted('plank-bridge', repeat);
  if (hand) return hand;
  return make('plank-proc', 256, (ctx, s) => {
    // Sept planches : la période divise la taille, donc la planche du haut prolonge celle
    // du bas. Les teintes suivent un cycle de longueur 7 pour la même raison — un tirage
    // aléatoire par bande casserait le raccord vertical.
    const n = 7, pas = s / n;
    const teintes = ['#e0a163', '#efbe86', '#c4813f', '#e0a163', '#c4813f', '#efbe86', '#e0a163'];
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = teintes[i];
      ctx.fillRect(0, i * pas, s, pas);
      ctx.fillStyle = '#8a5a2e';
      ctx.fillRect(0, i * pas, s, Math.max(1, s * 0.012));
    }
    grain(ctx, s, 53, 0.03);
  }, repeat);
}

/** SIGNAL — dessus usé d'une pierre de gué. */
export function riverStone({ repeat = [1, 1] } = {}) {
  const hand = painted('river-stone', repeat);
  if (hand) return hand;
  return make('stone-proc', 256, (ctx, s) => {
    ctx.fillStyle = '#ab7a6c';
    ctx.fillRect(0, 0, s, s);
    const r = rng(17);
    for (const [couleur, n, taille] of [['#c1978a', 9, 0.16], ['#8e5f55', 5, 0.11]]) {
      ctx.fillStyle = couleur;
      for (let i = 0; i < n; i++) {
        const x = r() * s, y = r() * s, rad = s * taille * (0.6 + r() * 0.6);
        wrap(ctx, s, x, y, rad, (px, py) => {
          ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
        });
      }
    }
    grain(ctx, s, 91, 0.03);
  }, repeat);
}

/**
 * SIGNAL — damier d'arrivée, PUREMENT procédural et sans repli peint possible.
 *
 * Le pipeline d'images a bien produit un damier, et le lissage de bord l'a détruit : des
 * bavures grises sur tout le pourtour, mesurées à 155/255. C'est attendu et non
 * corrigeable. Le lissage remplace les pixels de bord par le contenu du centre décalé
 * d'une demi-image, ce qui suppose que le motif soit à basse fréquence ; un damier est
 * exactement le contraire. Ici le procédural n'est pas un repli, c'est la bonne réponse :
 * un nombre PAIR de cases suffit à garantir le raccord, et les bords restent nets.
 */
export function finishChecker({ cells = 8, repeat = [1, 1] } = {}) {
  const n = cells % 2 === 0 ? cells : cells + 1;
  return make(`finish-checker-${n}`, 256, (ctx, s) => {
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, s, s);
    const q = s / n;
    ctx.fillStyle = '#141414';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if ((x + y) % 2) ctx.fillRect(x * q, y * q, q, q);
      }
    }
  }, repeat);
}

// ─────────────────── Le Rondin, deuxième passe : la platitude ───────────────────
//
// Le premier jeu de textures de l'échine était généré, détaillé, ombré — et faux. La
// référence est presque NUE : le tronc est un aplat orange traversé de quelques stries
// douces, les arêtes d'écorce n'ont aucun motif, et le relief vient entièrement du toon
// shading et de la silhouette. Une texture d'écorce photographique, même stylisée, ramène
// une fréquence spatiale que le reste du jeu n'a pas, et la map se met à jurer avec les
// autres épreuves.
//
// Ces trois fabriques sont donc volontairement PAUVRES, et purement procédurales. Elles ne
// passent pas par `painted()` : il n'y a rien à peindre à la main dans un aplat, et les
// PNG générés qu'elles remplacent pesaient à eux seuls plus de trois mégaoctets.

/** MOTIF — bois lisse : un aplat, et quelques stries dans le sens du fil. */
export function boisLisse({ repeat = [1, 1] } = {}) {
  return make('bois-lisse', 256, (ctx, s) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    // Les stries suivent v, donc l'axe du tronc. Leurs positions sont fixes et leur nombre
    // divise la taille : le raccord est acquis par construction, pas par retouche.
    const r = rng(5);
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const x = (i / 14) * s + r() * (s / 28);
      const largeur = s * (0.004 + r() * 0.010);
      ctx.strokeStyle = `rgba(0,0,0,${0.030 + r() * 0.045})`;
      ctx.lineWidth = largeur;
      // Une strie legerement ondulee : parfaitement droite, elle se lit comme une rayure
      // d'impression plutot que comme du bois.
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const y = (k / 8) * s;
        const dx = Math.sin((k / 8) * Math.PI * 2 + i) * s * 0.006;
        k === 0 ? ctx.moveTo(x + dx, y) : ctx.lineTo(x + dx, y);
      }
      ctx.stroke();
    }
  }, repeat);
}

/** SIGNAL — sentier d'usure sur le tronc : un sable clair, à peine tacheté. */
export function sentierBois({ repeat = [1, 1] } = {}) {
  return make('sentier-bois', 256, (ctx, s) => {
    ctx.fillStyle = '#e9c489';
    ctx.fillRect(0, 0, s, s);
    const r = rng(23);
    ctx.fillStyle = '#dcb073';
    for (let i = 0; i < 16; i++) {
      const x = r() * s, y = r() * s, rad = s * (0.05 + r() * 0.09);
      wrap(ctx, s, x, y, rad, (px, py) => {
        ctx.beginPath(); ctx.ellipse(px, py, rad, rad * 0.62, 0, 0, Math.PI * 2); ctx.fill();
      });
    }
  }, repeat);
}

/**
 * SIGNAL — tranche de tronc : peu d'anneaux, épais et bien espacés.
 *
 * La version générée en comptait une quarantaine de fins : à l'écran, à trente mètres, cela
 * donnait un moiré gris. La référence en montre six ou sept, larges. On la suit.
 */
export function anneauxBois({ repeat = [1, 1] } = {}) {
  return make('anneaux-bois', 256, (ctx, s) => {
    ctx.fillStyle = '#f0954f';
    ctx.fillRect(0, 0, s, s);
    const cx = s * 0.52, cy = s * 0.48;
    ctx.strokeStyle = '#e0613a';
    for (let i = 7; i >= 1; i--) {
      const rad = (i / 7.4) * s * 0.5;
      ctx.lineWidth = s * 0.018;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad, rad * 0.96, 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, repeat);
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * MINI-JEU « L'HEXAGONE »
 *
 * Les trois premières fabriques dessinent le motif de la FACE d'un hexagone, et elles sont
 * procédurales par nécessité, pas par économie : un motif centré sur une face ne survit
 * pas à `seamless.mjs`, dont le mélange par décalage sert justement à rendre une image
 * raccordable — il couperait le motif en quatre et recollerait les morceaux aux coins.
 * C'est exactement la raison qui rend `tileFace()` procédurale.
 *
 * Et ce n'est pas de la décoration. Dans la référence, chaque couleur d'étage porte son
 * propre motif — chevrons, zigzags, pois — ajouté après le correctif d'octobre 2020 comme
 * dispositif d'ACCESSIBILITÉ : un joueur daltonien distingue les étages à la forme quand
 * la teinte ne lui dit rien. Un clone qui garderait les couleurs en jetant les motifs
 * reprendrait le défaut que la référence a corrigé.
 *
 * MOTIF, donc : quasi blanc, le matériau porte la couleur de l'étage.
 * ═════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Fond commun des trois faces : un liseré hexagonal tracé À L'INTÉRIEUR de la dalle.
 *
 * Deux versions ont échoué avant celle-ci, et la seconde explique la troisième.
 *
 * La première dessinait un disque clair sur fond gris : vu du dessus, un étage entier se
 * lisait comme un tapis uni où l'on ne distinguait plus une dalle de sa voisine. Sur une
 * carte dont l'unité de décision EST la dalle, ne pas voir la grille revient à jouer à
 * pile ou face.
 *
 * La seconde dessinait l'hexagone lui-même, en comptant sur les UV du capuchon d'un
 * `CylinderGeometry` — qui projettent la face sur le cercle inscrit dans le carré, donc
 * les six sommets sur le cercle de rayon 0,5. En théorie le tracé coïncide avec l'arête.
 * En pratique le fond gris ressortait aux six coins et l'étage se lisait comme un pavage
 * de TRIANGLES : au bord exact du tracé, le filtrage et les niveaux de détail échantillonnent
 * des deux côtés de la frontière, et c'est le fond qui gagne.
 *
 * D'où celle-ci : le plateau occupe TOUT le carré — plus de fond, donc plus rien à faire
 * ressortir — et le liseré est tracé nettement en dedans, là où aucun filtrage ne peut
 * l'atteindre. On y perd que l'arête dessinée n'est pas exactement l'arête réelle ; on y
 * gagne une grille qui se voit, ce qui est la seule chose que ce liseré doit faire.
 */
function faceHexa(ctx, s) {
  const cx = s / 2, cy = s / 2;
  /*
   * Le quart de tour du `thetaStart` de la géométrie se retrouve ici, décalé de 30°.
   *
   * Mesuré, pas déduit : sans lui, les liserés de deux dalles voisines s'emboîtaient en un
   * pavage de TRIANGLES parfaitement régulier — assez convaincant pour qu'on cherche
   * l'erreur ailleurs. C'est la capture à la verticale qui l'a tranché, en montrant le
   * liseré tourné par rapport à la silhouette réelle d'une dalle d'une autre couleur.
   */
  const chemin = (rayon) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (Math.PI / 3) * i;
      const x = cx + Math.cos(a) * rayon, y = cy + Math.sin(a) * rayon;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, s, s);
  // Le biseau : une couronne sombre en dedans du bord. C'est elle qui dessine la grille.
  ctx.fillStyle = '#c2c2c2';
  chemin(s * 0.470);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  chemin(s * 0.395);
  ctx.fill();
}

/** MOTIF — face d'un étage JAUNE : chevrons. */
export function hexFaceChevron({ repeat = [1, 1] } = {}) {
  return make('hex-face-chevron', 256, (ctx, s) => {
    faceHexa(ctx, s);
    ctx.strokeStyle = '#e4e4e4';
    ctx.lineWidth = s * 0.055;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = -1; i <= 1; i++) {
      const y = s * (0.5 + i * 0.19);
      ctx.beginPath();
      ctx.moveTo(s * 0.31, y + s * 0.075);
      ctx.lineTo(s * 0.50, y - s * 0.075);
      ctx.lineTo(s * 0.69, y + s * 0.075);
      ctx.stroke();
    }
    grain(ctx, s, 17, 0.016, 60);
  }, repeat);
}

/** MOTIF — face d'un étage CYAN : zigzag, l'éclair de la référence. */
export function hexFaceZigzag({ repeat = [1, 1] } = {}) {
  return make('hex-face-zigzag', 256, (ctx, s) => {
    faceHexa(ctx, s);
    ctx.strokeStyle = '#e4e4e4';
    ctx.lineWidth = s * 0.062;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s * 0.30, s * 0.62);
    ctx.lineTo(s * 0.44, s * 0.38);
    ctx.lineTo(s * 0.56, s * 0.62);
    ctx.lineTo(s * 0.70, s * 0.38);
    ctx.stroke();
    grain(ctx, s, 29, 0.016, 60);
  }, repeat);
}

/** MOTIF — face d'un étage VIOLET : pois. */
export function hexFacePois({ repeat = [1, 1] } = {}) {
  return make('hex-face-pois', 256, (ctx, s) => {
    faceHexa(ctx, s);
    ctx.fillStyle = '#e4e4e4';
    // Sept pois en fleur : un au centre, six autour. C'est la maille hexagonale
    // elle-même, en petit — le motif dit donc aussi de quelle grille il vient.
    const points = [[0, 0]];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      points.push([Math.cos(a) * 0.17, Math.sin(a) * 0.17]);
    }
    for (const [dx, dy] of points) {
      ctx.beginPath();
      ctx.arc(s * (0.5 + dx), s * (0.5 + dy), s * 0.052, 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, s, 53, 0.016, 60);
  }, repeat);
}

/** SIGNAL — la boue rose sous la tour, parcourue de courants plus clairs. */
export function slimePink({ repeat = [1, 1] } = {}) {
  const hand = painted('slime-pink', repeat);
  if (hand) return hand;
  return make('slime-proc', 512, (ctx, s) => {
    ctx.fillStyle = '#ff4f9e';
    ctx.fillRect(0, 0, s, s);
    // Des courants, pas des vagues : dans la référence la boue est lisse et striée de
    // longues traînées claires qui suivent le relief. Des ondulations lui donneraient une
    // agitation qu'elle n'a pas, et qui suggérerait à tort qu'elle bouge.
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const y = ((i * 73) % 100) / 100 * s;
      ctx.strokeStyle = i % 2 ? '#ff7ab8' : '#ff98c9';
      ctx.lineWidth = s * (0.012 + (i % 3) * 0.008);
      for (const dy of [-s, 0, s]) {
        ctx.beginPath();
        ctx.moveTo(0, y + dy);
        for (let x = 0; x <= s; x += s / 8) {
          ctx.lineTo(x, y + dy + Math.sin((x / s) * Math.PI * 2 + i) * s * 0.035);
        }
        ctx.stroke();
      }
    }
    grain(ctx, s, 11, 0.02, 255);
  }, repeat);
}

/** SIGNAL — les collines vertes du fond, striées de lignes de niveau. */
export function candyHills({ repeat = [1, 1] } = {}) {
  const hand = painted('candy-hills', repeat);
  if (hand) return hand;
  return make('hills-proc', 512, (ctx, s) => {
    ctx.fillStyle = '#7ad94f';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#63c43c';
    ctx.lineWidth = s * 0.011;
    for (let i = 0; i < 9; i++) {
      const y = (i / 9) * s;
      for (const dy of [-s, 0, s]) {
        ctx.beginPath();
        ctx.moveTo(0, y + dy);
        for (let x = 0; x <= s; x += s / 12) {
          ctx.lineTo(x, y + dy + Math.sin((x / s) * Math.PI * 2 + i * 1.7) * s * 0.028);
        }
        ctx.stroke();
      }
    }
    grain(ctx, s, 7, 0.018, 80);
  }, repeat);
}

/** SIGNAL — ciel bleu pâle à triangles, le fond de l'arène de la référence. */
export function skyTriangles({ repeat = [1, 1] } = {}) {
  const hand = painted('sky-triangles', repeat);
  if (hand) return hand;
  return make('sky-tri-proc', 512, (ctx, s) => {
    ctx.fillStyle = '#a9e4fb';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#bdebfd';
    const n = 8, w = s / n, h = w * 0.87;
    for (let r = 0; r * h <= s; r++) {
      for (let c = -1; c <= n; c++) {
        const x = c * w + (r % 2 ? w / 2 : 0), y = r * h;
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.lineTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        ctx.fill();
      }
    }
  }, repeat);
}

// ─────────────────────────── L'enseigne d'arrivée ───────────────────────────

/**
 * SIGNAL — l'enseigne « FINISH » de la porte d'arrivée, la même sur les quatre courses.
 *
 * Peinte de préférence (`finish-sign.jpg`, 1376 × 768, générée via OpenRouter le
 * 6 septembre 2026 et choisie à l'œil parmi quatre candidates : la seule qui remplit
 * l'image bord à bord, sans fond blanc à rogner). Le repli au canevas dessine la même
 * chose — planche magenta, liseré clair, ampoules, lettres jaunes cerclées de blanc —
 * avec la police arrondie de l'interface, pour que le jeu tourne sans le fichier. Sur
 * le serveur, le canevas est doublé et rien de ceci n'est jamais dessiné.
 */
export function finishSign({ texte = 'FINISH' } = {}) {
  const hand = painted('finish-sign', [1, 1]);
  if (hand) return hand;
  return make(`finish-sign-${texte}`, [1376, 768], (ctx, w, h) => {
    const arrondi = (x, y, ww, hh, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + ww - r, y); ctx.quadraticCurveTo(x + ww, y, x + ww, y + r);
      ctx.lineTo(x + ww, y + hh - r); ctx.quadraticCurveTo(x + ww, y + hh, x + ww - r, y + hh);
      ctx.lineTo(x + r, y + hh); ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };
    ctx.fillStyle = '#ff1a8c';
    ctx.fillRect(0, 0, w, h);
    // Le liseré clair, et la planche intérieure un ton plus sombre.
    ctx.lineWidth = 30;
    ctx.strokeStyle = '#ffd3ea';
    arrondi(56, 56, w - 112, h - 112, 70);
    ctx.stroke();
    ctx.fillStyle = '#ee1a80';
    arrondi(100, 100, w - 200, h - 200, 50);
    ctx.fill();
    // Les ampoules, une tous les 64 px le long du liseré.
    ctx.fillStyle = '#ffe23d';
    const pas = 64, r = 13;
    for (let x = 120; x <= w - 120; x += pas) {
      ctx.beginPath(); ctx.arc(x, 56, r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, h - 56, r, 0, Math.PI * 2); ctx.fill();
    }
    for (let y = 120; y <= h - 120; y += pas) {
      ctx.beginPath(); ctx.arc(56, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(w - 56, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Les lettres : on descend la taille jusqu'à ce que le mot tienne dans 70 % de la
    // largeur. `measureText` rend 0 sur le serveur, où l'on ne dessine rien de toute façon.
    const famille = 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif';
    let taille = 360;
    ctx.font = `900 ${taille}px ${famille}`;
    while (taille > 80 && ctx.measureText(texte).width > w * 0.7) {
      taille -= 10;
      ctx.font = `900 ${taille}px ${famille}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#b8155e';                      // l'ombre portée
    ctx.fillText(texte, w / 2 + 8, h / 2 + 12);
    ctx.lineWidth = 22;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(texte, w / 2, h / 2);
    ctx.fillStyle = '#ffd83d';
    ctx.fillText(texte, w / 2, h / 2);
  }, [1, 1]);
}
