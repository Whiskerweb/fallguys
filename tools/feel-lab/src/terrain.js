import * as THREE from 'three';
import { toonMaterial } from './world.js';

/**
 * Terrain en relief continu.
 *
 * Avant, le sol était un plan et les montagnes des cônes POSÉS dessus : on voyait le
 * joint, et le terrain restait visiblement plat entre eux. Ici, il n'y a qu'un seul
 * maillage dont les sommets sont déplacés en hauteur : les crêtes et les falaises
 * émergent du sol, elles ne s'y ajoutent pas.
 *
 * Trois principes :
 *  - une CUVETTE plate au centre, sous la piste, pour ne jamais gêner le jeu ;
 *  - une CEINTURE de crêtes tout autour, qui masque le bord du monde quelle que soit
 *    l'orientation de la caméra ;
 *  - la couleur vient de l'ALTITUDE (couleurs par sommet), donc herbe en bas, roche rose
 *    à mi-hauteur, neige au sommet — sans aucune texture ni matériau supplémentaire.
 */

/** Bruit de valeur lissé, déterministe : deux exécutions donnent le même relief. */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
}

const smoothstep = (a, b, t) => {
  const k = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * Crêtes disposées en anneaux. Chacune est une cloche : sa hauteur retombe avec la
 * distance. `steep` contrôle la raideur du versant — au-delà de ~2 la cloche devient
 * une falaise à flanc quasi vertical.
 */
function buildRidges() {
  const ridges = [];
  const CX = 0, CZ = -64;
  const RINGS = [
    { r: 250, n: 14, h: [22, 40], w: [30, 52], steep: [1.6, 2.8] },
    { r: 350, n: 16, h: [38, 70], w: [40, 70], steep: [1.3, 2.3] },
    { r: 470, n: 18, h: [58, 108], w: [54, 96], steep: [1.0, 1.8] },
  ];
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  for (const ring of RINGS) {
    for (let i = 0; i < ring.n; i++) {
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
      // Angle et rayon irréguliers : un anneau régulier se lit comme une palissade.
      const ang = (i / ring.n) * Math.PI * 2 + (r1 - 0.5) * (Math.PI / ring.n) * 1.7;
      const dist = ring.r * (0.80 + r2 * 0.40);
      // Écart de taille volontairement large : c'est lui qui fait lire une chaîne.
      const bias = Math.pow(r3, 1.8);
      ridges.push({
        x: CX + Math.cos(ang) * dist,
        z: CZ + Math.sin(ang) * dist,
        h: ring.h[0] + bias * (ring.h[1] - ring.h[0]),
        w: ring.w[0] + r4 * (ring.w[1] - ring.w[0]),
        steep: ring.steep[0] + r1 * (ring.steep[1] - ring.steep[0]),
        // Les crêtes sont étirées dans une direction : des cloches rondes donnent des
        // pains de sucre, pas des massifs.
        dir: r2 * Math.PI,
        stretch: 1.5 + r4 * 1.7,
      });
    }
  }
  return ridges;
}

export function createTerrain({ groundY = -15, size = 1300, segments = 220 } = {}) {
  const ridges = buildRidges();
  const CX = 0, CZ = -64;

  function heightAt(x, z) {
    // Cuvette centrale : sous la piste le terrain reste plat, et la transition est
    // progressive pour qu'aucune arête ne trahisse la zone protégée.
    const d = Math.hypot(x - CX, z - CZ);
    const open = smoothstep(120, 300, d);
    if (open <= 0.001) return 0;

    let h = 0;
    for (const r of ridges) {
      // Coordonnées locales tournées, pour étirer la cloche dans sa direction.
      const dx = x - r.x, dz = z - r.z;
      const ca = Math.cos(r.dir), sa = Math.sin(r.dir);
      const lx = (dx * ca + dz * sa) / r.stretch;
      const lz = -dx * sa + dz * ca;
      const dd = Math.hypot(lx, lz) / r.w;
      if (dd > 2.2) continue;                       // au-delà, la contribution est nulle
      h += r.h * Math.exp(-Math.pow(dd, r.steep) * 2.1);
    }

    // Ondulation de fond : elle empêche les plaines entre crêtes d'être des miroirs.
    h += (fbm(x * 0.006, z * 0.006) - 0.5) * 9;
    h += (fbm(x * 0.028, z * 0.028) - 0.5) * 3.2;

    return Math.max(0, h) * open;
  }

  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const GRASS = new THREE.Color(0x8ede6d);
  const GRASS_HI = new THREE.Color(0x6fce7a);
  const ROCK = new THREE.Color(0xf07fae);
  const ROCK_HI = new THREE.Color(0xd9a0e8);
  const SNOW = new THREE.Color(0xffffff);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + CX;
    const z = pos.getZ(i) + CZ;
    const h = heightAt(x, z);
    pos.setY(i, h);

    // Couleur par ALTITUDE. Les seuils se chevauchent, sinon on voit des bandes nettes
    // qui trahissent le procédé.
    if (h < 9) {
      tmp.copy(GRASS).lerp(GRASS_HI, smoothstep(0, 9, h));
    } else if (h < 34) {
      tmp.copy(GRASS_HI).lerp(ROCK, smoothstep(9, 30, h));
    } else if (h < 62) {
      tmp.copy(ROCK).lerp(ROCK_HI, smoothstep(34, 58, h));
    } else {
      tmp.copy(ROCK_HI).lerp(SNOW, smoothstep(62, 84, h));
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = toonMaterial(0xffffff);
  mat.vertexColors = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(CX, groundY, CZ);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  return { mesh, heightAt, groundY };
}
