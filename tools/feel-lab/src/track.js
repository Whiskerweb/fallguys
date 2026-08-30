import * as THREE from 'three';
import { toonMaterial } from './world.js';

/**
 * LE TRACE. Un chemin, pas un tas de dalles.
 *
 * Le parcours etait construit dalle par dalle : un rectangle par troncon, pose a une
 * position et une largeur choisies a la main. Vu de dessus le resultat ne se lisait pas
 * comme une piste — les rectangles se chevauchaient dans les virages, leurs coins
 * arrondis laissaient des encoches, les rambardes se croisaient, et deux troncons de
 * largeurs differentes ne se raccordaient jamais. Personne ne dessine une route ainsi.
 *
 * Ici on decrit une LIGNE MOYENNE — une suite de points avec une largeur et une
 * altitude — et le module en tire :
 *   - des virages CIRCULAIRES, tangents aux deux droites qu'ils relient (aucun angle
 *     vif, aucune encoche) ;
 *   - un ruban continu extrude le long de cette ligne, dont la largeur et la pente
 *     varient sans rupture (les jonctions n'existent plus, il n'y a plus qu'une surface) ;
 *   - un collider TRIMESH construit sur les memes sommets. Le collider n'approche plus
 *     le visuel : c'est le meme maillage. Dans un jeu ou l'on mise, c'est la seule
 *     garantie acceptable.
 *   - des rambardes qui suivent la courbe d'un bout a l'autre, au lieu de segments
 *     droits raboutes.
 */

/** Pas d'echantillonnage sur les lignes droites (m). */
const STEP = 2.2;
/** Pas angulaire dans les virages (rad) : 0,15 donne un arc lisse a l'oeil. */
const ARC_STEP = 0.15;
/** Cote couvert par une periode de texture (m). Les UV sont en metres/UV. */
const UV = 8;

/**
 * Demi-profil transversal, du bas exterieur vers la surface roulable.
 * `o` : deport vers l'EXTERIEUR depuis le bord de la surface. `h` : hauteur relative
 * a cette surface. C'est ce profil, balaye le long du chemin, qui donne l'epaisseur de
 * matelas du genre — un ruban plat se lirait comme un decalque.
 */
const SIDE = [
  { o: -0.12, h: -1.24, m: 'dark' },   // dessous, legerement rentre
  { o: 0.18, h: -1.06, m: 'dark' },    // socle, plus large que la surface
  { o: 0.18, h: -0.66, m: 'socle' },
  { o: 0.00, h: -0.54, m: 'socle' },
  { o: 0.00, h: -0.18, m: 'lip' },     // flanc du matelas
  { o: -0.13, h: -0.04, m: 'lip' },    // epaulement arrondi
];

/** Nombre de bandes longitudinales dans la surface roulable. Fixe : il permet a une
 *  zone de porter plusieurs matieres cote a cote (deux tapis roulants opposes, par
 *  exemple) sans changer la topologie du ruban. */
const TOP_COLUMNS = 4;
/** Retrait de la surface roulable par rapport au bord, mange par l'epaulement. */
const SHOULDER = 0.40;

/** Anneau complet : cote gauche de bas en haut, surface, cote droit de haut en bas. */
const RING = (() => {
  const r = [];
  for (const p of SIDE) r.push({ side: -1, o: p.o, h: p.h, m: p.m });
  r.push({ top: 0, h: 0, m: 'top' });
  for (let i = 1; i < TOP_COLUMNS; i++) r.push({ top: i / TOP_COLUMNS, h: 0, m: 'top' });
  r.push({ top: 1, h: 0, m: 'top' });
  for (let i = SIDE.length - 1; i >= 0; i--) r.push({ side: 1, o: SIDE[i].o, h: SIDE[i].h, m: SIDE[i].m });
  return r;
})();

/** Indice, dans RING, du premier sommet de la surface roulable. */
const TOP0 = SIDE.length;

/** Matiere d'un segment de profil, deduite de celle de ses deux extremites. */
function segKind(a, b) {
  if (a === 'top' && b === 'top') return 'top';
  if (a === 'lip' || b === 'lip') return 'lip';
  if (a === 'dark' && b === 'dark') return 'dark';
  return 'socle';
}
const SEG_KIND = RING.map((p, i) => segKind(p.m, RING[(i + 1) % RING.length].m));

/** Position laterale d'un sommet de profil, pour une demi-largeur donnee. */
function lateral(p, hw) {
  if (p.top !== undefined) {
    const half = Math.max(0.1, hw - SHOULDER);
    return -half + p.top * 2 * half;
  }
  return p.side * (hw + p.o);
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Raccordement doux entre deux noeuds : lineaire au milieu, tangente NULLE aux deux
 * bouts. C'est ce qui supprime l'arete au pied et au sommet des rampes — une pente
 * raccordee brutalement se sent a la manette, le personnage y decolle ou s'y accroche.
 */
function ease(f, e = 0.24) {
  if (e <= 0) return f;
  const k = 1 / (1 - e);
  if (f < e) return (f * f) / (2 * e) * k;
  if (f > 1 - e) return 1 - ((1 - f) * (1 - f)) / (2 * e) * k;
  return (f - e / 2) * k;
}

/**
 * Construit la ligne moyenne echantillonnee a partir des noeuds.
 *
 * `nodes` : [{ x, z, y = 0, w, zone, rail }]. `zone` s'applique du noeud au suivant.
 * `corner` : rayon VOULU des virages ; il est rabote quand les droites voisines sont
 * trop courtes pour l'accueillir, jamais l'inverse — un arc qui deborde de son segment
 * produirait un repli sur lui-meme.
 */
export function trackPath(nodes, { corner = 7 } = {}) {
  const N = nodes.length;
  if (N < 2) throw new Error('trackPath: il faut au moins deux noeuds');

  const dir = [], len = [];
  for (let i = 0; i < N - 1; i++) {
    const dx = nodes[i + 1].x - nodes[i].x, dz = nodes[i + 1].z - nodes[i].z;
    const L = Math.hypot(dx, dz);
    if (L < 1e-3) throw new Error(`trackPath: noeuds ${i} et ${i + 1} confondus`);
    len.push(L); dir.push([dx / L, dz / L]);
  }

  const tan = new Array(N).fill(0);
  const rad = new Array(N).fill(0);
  const turn = new Array(N).fill(0);
  for (let i = 1; i < N - 1; i++) {
    const [ax, az] = dir[i - 1], [bx, bz] = dir[i];
    const dot = Math.max(-1, Math.min(1, ax * bx + az * bz));
    const phi = Math.acos(dot);
    if (phi < 0.02) continue;
    turn[i] = phi;
    // 0,46 de chaque cote : deux virages voisins ne peuvent pas se disputer la meme
    // droite, meme colles l'un a l'autre.
    const cr = nodes[i].corner ?? corner;
    const t = Math.min(cr * Math.tan(phi / 2), len[i - 1] * 0.46, len[i] * 0.46);
    tan[i] = t;
    rad[i] = t / Math.tan(phi / 2);
    // Un rayon inferieur a la demi-largeur replierait le bord interieur sur lui-meme :
    // la piste se croiserait elle-meme dans le virage. Mieux vaut le savoir tout de suite.
    const need = Math.max(nodes[i].w, nodes[i - 1].w, nodes[i + 1].w) / 2;
    if (rad[i] < need * 1.05) {
      console.warn(`trace: virage trop serre au noeud ${i} (rayon ${rad[i].toFixed(1)} m pour ${need.toFixed(1)} m de demi-largeur)`);
    }
  }

  const raw = [];
  const emit = (x, z, u) => raw.push({ x, z, u });
  emit(nodes[0].x, nodes[0].z, 0);

  for (let i = 0; i < N - 1; i++) {
    const ax = nodes[i].x + dir[i][0] * tan[i], az = nodes[i].z + dir[i][1] * tan[i];
    const au = i + tan[i] / len[i];
    const bx = nodes[i + 1].x - dir[i][0] * tan[i + 1], bz = nodes[i + 1].z - dir[i][1] * tan[i + 1];
    const bu = i + 1 - tan[i + 1] / len[i];

    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / STEP));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      emit(lerp(ax, bx, f), lerp(az, bz, f), lerp(au, bu, f));
    }

    const j = i + 1;
    if (tan[j] > 0) {
      const [ix, iz] = dir[j - 1], [ox, oz] = dir[j];
      const s = Math.sign(ix * oz - iz * ox) || 1;
      // Perpendiculaire a la direction entrante, tournee vers l'interieur du virage.
      const px = -iz * s, pz = ix * s;
      const cx = bx + px * rad[j], cz = bz + pz * rad[j];
      const a0 = Math.atan2(bz - cz, bx - cx);
      const steps = Math.max(2, Math.ceil(turn[j] / ARC_STEP));
      const uA = j - tan[j] / len[j - 1], uB = j + tan[j] / len[j];
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        const a = a0 + s * turn[j] * f;
        emit(cx + Math.cos(a) * rad[j], cz + Math.sin(a) * rad[j], lerp(uA, uB, f));
      }
    }
  }

  // Altitude, largeur et zone se lisent au parametre u, donc varient sans rupture.
  const pts = raw.map((p) => {
    const i = Math.max(0, Math.min(N - 2, Math.floor(p.u)));
    const f = Math.max(0, Math.min(1, p.u - i));
    const g = ease(f);
    const a = nodes[i], b = nodes[i + 1];
    return {
      x: p.x, z: p.z, u: p.u,
      y: lerp(a.y ?? 0, b.y ?? 0, g),
      w: lerp(a.w, b.w, g),
      zone: a.zone ?? null,
      rail: a.rail !== false,
    };
  });

  // Reperes : tangente par difference centree (donc bissectrice dans les virages),
  // normale a droite, et facteur d'onglet pour que les bords ne s'ecartent jamais.
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const L = Math.hypot(tx, tz) || 1;
    tx /= L; tz /= L;
    pts[i].tx = tx; pts[i].tz = tz;
    pts[i].nx = -tz; pts[i].nz = tx;
    pts[i].yaw = Math.atan2(-tx, -tz);   // 0 = cap vers -Z, sens des dalles du jeu
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pts[i].s = s;
    // Onglet : demi-angle entre les deux segments qui se rejoignent au point.
    const px = pts[i].x - a.x, pz = pts[i].z - a.z;
    const qx = b.x - pts[i].x, qz = b.z - pts[i].z;
    const lp = Math.hypot(px, pz), lq = Math.hypot(qx, qz);
    const dot = lp > 1e-6 && lq > 1e-6 ? (px * qx + pz * qz) / (lp * lq) : 1;
    pts[i].miter = 1 / Math.max(0.4, Math.sqrt(Math.max(0, (1 + dot) / 2)));
  }

  const frameAt = (a, b, f) => ({
    x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f),
    w: lerp(a.w, b.w, f), s: lerp(a.s, b.s, f),
    nx: lerp(a.nx, b.nx, f), nz: lerp(a.nz, b.nz, f),
    tx: lerp(a.tx, b.tx, f), tz: lerp(a.tz, b.tz, f),
    yaw: Math.abs(b.yaw - a.yaw) > Math.PI ? a.yaw : lerp(a.yaw, b.yaw, f),
  });

  return {
    nodes, pts, length: s,

    /** Repere a l'abscisse curviligne demandee. */
    at(dist) {
      const d = Math.max(0, Math.min(s, dist));
      for (let i = 0; i < pts.length - 1; i++) {
        if (d <= pts[i + 1].s) {
          const span = pts[i + 1].s - pts[i].s;
          return frameAt(pts[i], pts[i + 1], span < 1e-6 ? 0 : (d - pts[i].s) / span);
        }
      }
      return frameAt(pts[pts.length - 1], pts[pts.length - 1], 0);
    },

    /**
     * Repere a la cote Z demandee. Le parcours descend toujours en Z : c'est donc la
     * coordonnee sous laquelle les obstacles ont ete regles, et sous laquelle le jeu
     * mesure la progression. Placer un obstacle par son Z garde ce reglage intact
     * quelle que soit la forme du trace.
     */
    atZ(z) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if ((z <= a.z && z >= b.z) || (z >= a.z && z <= b.z)) {
          const span = b.z - a.z;
          return frameAt(a, b, Math.abs(span) < 1e-6 ? 0 : (z - a.z) / span);
        }
      }
      return frameAt(pts[0], pts[0], 0);
    },

    /** Point du monde a `lat` metres a droite de l'axe, a la cote Z demandee. */
    side(z, lat = 0) {
      const f = this.atZ(z);
      return new THREE.Vector3(f.x + f.nx * lat, f.y, f.z + f.nz * lat);
    },
  };
}

/** Materiau d'une bande de surface. `zone` : { color, map, bands }. */
function topMaterials(zone) {
  const mk = (spec) => {
    const m = toonMaterial(spec.color ?? 0xffffff);
    if (spec.map) m.map = spec.map;
    return m;
  };
  const bands = zone?.bands;
  if (bands && bands.length) {
    const out = [];
    for (let i = 0; i < TOP_COLUMNS; i++) out.push(mk(bands[Math.floor(i * bands.length / TOP_COLUMNS)]));
    return out;
  }
  const one = mk(zone ?? {});
  return new Array(TOP_COLUMNS).fill(one);
}

/**
 * Extrude le profil le long du chemin : un maillage, un collider, aucune jonction.
 *
 * `zones` : dictionnaire nom -> { color, map, bands }. Le collider est un TRIMESH bati
 * sur les memes sommets que le rendu — pas une suite de boites qui l'approche.
 */
export function buildTrack({ RAPIER, world, group }, path, {
  zones = {}, edge = 0xffffff, socle = 0xf0eaff, dark = 0x2a1b45, shadow = true,
} = {}) {
  const pts = path.pts;
  const R = pts.length;
  const NS = RING.length;

  // --- sommets : une bande longitudinale par segment de profil, sommets non partages,
  // pour que l'epaulement garde une arete franche au lieu d'etre lisse par moyenne.
  const pos = new Float32Array(NS * 2 * R * 3);
  const uv = new Float32Array(NS * 2 * R * 2);
  // Sommets mutualises pour le collider : la meme surface, sans duplication.
  const cpos = new Float32Array(R * NS * 3);

  const put = (arr, i, x, y, z) => { arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z; };

  for (let k = 0; k < R; k++) {
    const p = pts[k];
    const hw = p.w / 2;
    for (let j = 0; j < NS; j++) {
      const lat = lateral(RING[j], hw) * p.miter;
      const x = p.x + p.nx * lat, y = p.y + RING[j].h, z = p.z + p.nz * lat;
      put(cpos, k * NS + j, x, y, z);
    }
  }

  for (let j = 0; j < NS; j++) {
    const j2 = (j + 1) % NS;
    for (let k = 0; k < R; k++) {
      const p = pts[k];
      const hw = p.w / 2;
      const base = (j * 2 * R + k * 2);
      for (const [slot, jj] of [[0, j], [1, j2]]) {
        const lat = lateral(RING[jj], hw) * p.miter;
        put(pos, base + slot, p.x + p.nx * lat, p.y + RING[jj].h, p.z + p.nz * lat);
        uv[(base + slot) * 2] = lat / UV;
        uv[(base + slot) * 2 + 1] = p.s / UV;
      }
    }
  }

  // --- sens de parcours des triangles : deduit une fois pour toutes de la surface,
  // dont la normale doit pointer vers le haut. Le deviner a la main est une source
  // d'erreur silencieuse — un ruban retourne ne se voit qu'a l'ombrage.
  let flip = false;
  {
    const b = TOP0 * 2 * R;
    const a0 = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    const a1 = [pos[(b + 1) * 3], pos[(b + 1) * 3 + 1], pos[(b + 1) * 3 + 2]];
    const b0 = [pos[(b + 2) * 3], pos[(b + 2) * 3 + 1], pos[(b + 2) * 3 + 2]];
    const e1 = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
    const e2 = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]];
    flip = (e1[2] * e2[0] - e1[0] * e2[2]) < 0;
  }

  const idx = [];
  const groups = [];
  const quad = (base, k) => {
    const a0 = base + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
    if (flip) idx.push(a0, b1, a1, a0, b0, b1);
    else idx.push(a0, a1, b1, a0, b1, b0);
  };

  // Zones : on decoupe le ruban en tronçons homogenes. La frontiere tombe exactement
  // sur un noeud du trace, donc la coupure est nette et perpendiculaire.
  const runs = [];
  for (let k = 0; k < R - 1; k++) {
    const z = pts[k].zone;
    const last = runs[runs.length - 1];
    if (last && last.zone === z) last.end = k + 1;
    else runs.push({ zone: z, start: k, end: k + 1 });
  }

  const materials = [];
  const addGroup = (start, mat) => {
    if (idx.length === start) return;
    groups.push({ start, count: idx.length - start, mat });
  };

  // Surface : par zone, puis par matiere de bande (deux bandes voisines peuvent
  // porter des matieres differentes — c'est ce qui permet deux tapis opposes).
  for (const run of runs) {
    const mats = topMaterials(zones[run.zone]);
    const distinct = [...new Set(mats)];
    for (const m of distinct) {
      const start = idx.length;
      for (let c = 0; c < TOP_COLUMNS; c++) {
        if (mats[c] !== m) continue;
        const base = (TOP0 + c) * 2 * R;
        for (let k = run.start; k < run.end; k++) quad(base, k);
      }
      addGroup(start, m);
    }
  }

  const lipMat = toonMaterial(edge);
  const socleMat = toonMaterial(socle);
  const darkMat = new THREE.MeshBasicMaterial({ color: dark });
  for (const [kind, mat] of [['lip', lipMat], ['socle', socleMat], ['dark', darkMat]]) {
    const start = idx.length;
    for (let j = 0; j < NS; j++) {
      if (SEG_KIND[j] !== kind) continue;
      const base = j * 2 * R;
      for (let k = 0; k < R - 1; k++) quad(base, k);
    }
    addGroup(start, mat);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  for (const g of groups) {
    let mi = materials.indexOf(g.mat);
    if (mi < 0) { mi = materials.length; materials.push(g.mat); }
    geo.addGroup(g.start, g.count, mi);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  group.add(mesh);

  // --- collider : le meme maillage, ferme par ses deux bouts.
  // Le sens de parcours est le MEME que celui du rendu. Rapier calcule des
  // pseudo-normales de sommet et d'arete (drapeau FIX_INTERNAL_EDGES, qui implique
  // ORIENTED) : un maillage retourne les orienterait vers l'interieur, et les contacts
  // sur une surface plate reprendraient les faux rebonds que ce drapeau existe pour
  // supprimer. Le defaut ne se verrait qu'a la manette, jamais a l'image.
  const cIdx = [];
  for (let k = 0; k < R - 1; k++) {
    for (let j = 0; j < NS; j++) {
      const j2 = (j + 1) % NS;
      const a0 = k * NS + j, a1 = k * NS + j2, b0 = (k + 1) * NS + j, b1 = (k + 1) * NS + j2;
      if (flip) cIdx.push(a0, b1, a1, a0, b0, b1);
      else cIdx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  // Bouchons : sans eux le personnage tomberait a travers la tranche d'un ruban
  // interrompu au-dessus du vide.
  const capVerts = [];
  for (const [ring, dirSign] of [[0, -1], [R - 1, 1]]) {
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < NS; j++) {
      cx += cpos[(ring * NS + j) * 3]; cy += cpos[(ring * NS + j) * 3 + 1]; cz += cpos[(ring * NS + j) * 3 + 2];
    }
    capVerts.push([cx / NS, cy / NS, cz / NS, ring, dirSign]);
  }
  const total = new Float32Array(cpos.length + capVerts.length * 3);
  total.set(cpos, 0);
  capVerts.forEach((c, i) => {
    const b = R * NS + i;
    total[b * 3] = c[0]; total[b * 3 + 1] = c[1]; total[b * 3 + 2] = c[2];
    for (let j = 0; j < NS; j++) {
      const j2 = (j + 1) % NS;
      const avant = (c[4] > 0) !== flip;
      if (avant) cIdx.push(b, c[3] * NS + j, c[3] * NS + j2);
      else cIdx.push(b, c[3] * NS + j2, c[3] * NS + j);
    }
  });

  const flags = (RAPIER.TriMeshFlags?.MERGE_DUPLICATE_VERTICES ?? 16)
    | (RAPIER.TriMeshFlags?.FIX_INTERNAL_EDGES ?? 152);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const collider = world.createCollider(
    RAPIER.ColliderDesc.trimesh(total, new Uint32Array(cIdx), flags).setFriction(0.62), body);

  return { mesh, body, collider, materials };
}

/**
 * Rambardes gonflables continues, tirees de la meme ligne moyenne.
 *
 * Un seul tube par cote, d'un bout a l'autre : dans les virages il se courbe avec la
 * piste au lieu de la couper en corde, et deux troncons ne se croisent plus jamais.
 * Le collider est une chaine de boites inscrites dans le tube — sa demi-hauteur est
 * calee sur le rayon visible, sans mur invisible au-dessus.
 */
export function buildRails({ RAPIER, world, group }, path, {
  color = 0xffe45c, radius = 0.38, height = 0.42, off = 0.30, plots = null, plotEvery = 8,
} = {}) {
  const pts = path.pts;
  const meshes = [];

  for (const side of [-1, 1]) {
    // Les rambardes s'interrompent la ou le trace le demande (bord d'un saut).
    let run = [];
    const runs = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p.rail) { if (run.length > 1) runs.push(run); run = []; continue; }
      const lat = side * (p.w / 2 + off) * p.miter;
      run.push(new THREE.Vector3(p.x + p.nx * lat, p.y + height, p.z + p.nz * lat));
    }
    if (run.length > 1) runs.push(run);

    for (const line of runs) {
      const curve = new THREE.CatmullRomCurve3(line, false, 'centripetal', 0.5);
      const geo = new THREE.TubeGeometry(curve, Math.max(8, line.length * 2), radius, 9, false);
      const mesh = new THREE.Mesh(geo, toonMaterial(color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      meshes.push(mesh);

      // Collider : une boite tous les deux points. Assez fin pour epouser un virage,
      // assez grossier pour ne pas noyer le moteur sous les corps. La demi-hauteur est
      // calee sur le RAYON VISIBLE — l'ancienne version montait a 2,2 m pour un tube de
      // 0,72 m, soit un mur invisible infranchissable au-dessus de la rambarde.
      const q = new THREE.Quaternion(), fwd = new THREE.Vector3(), axe = new THREE.Vector3(0, 0, 1);
      for (let i = 0; i < line.length - 1; i += 2) {
        const a = line[i], b = line[Math.min(line.length - 1, i + 2)];
        const len = a.distanceTo(b);
        if (len < 0.05) continue;
        fwd.subVectors(b, a).normalize();
        q.setFromUnitVectors(axe, fwd);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
          .setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(radius, radius, len / 2).setFriction(0.3), body);
      }

      // Plots au pied de la rambarde, releves a intervalle REGULIER en metres : compter
      // en points donnerait des plots serres dans les virages, ou l'echantillonnage est
      // plus fin, et clairsemes sur les droites.
      if (plots) {
        let reste = plotEvery / 2;
        for (let i = 1; i < line.length; i++) {
          reste -= line[i].distanceTo(line[i - 1]);
          if (reste > 0) continue;
          reste = plotEvery;
          plots.push([line[i].x, line[i].y - height - 0.5, line[i].z]);
        }
      }
    }
  }
  return meshes;
}
