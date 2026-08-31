import * as THREE from 'three';
import { toonMaterial } from './world.js';
import { grassTufts } from './textures.js';

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
function buildRidges(CX = 0, CZ = -64, rayon = 1) {
  const ridges = [];
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
      const dist = ring.r * rayon * (0.80 + r2 * 0.40);
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

/**
 * @param {object} o
 *   `cx` / `cz`   centre de la cuvette et de la ceinture de crêtes
 *   `echelleX`    resserre la cuvette en X. À 1 elle est circulaire ; au-delà elle devient
 *                 un COULOIR, ce qu'exige une carte longue et étroite comme un lagon.
 *   `plat` / `ouvert`  rayons de début et de fin du relèvement
 *   `rayonCretes` multiplie la distance des crêtes : les rapprocher resserre l'horizon
 *
 * Les valeurs par défaut reproduisent exactement le terrain de La Course et des Portes :
 * ces deux cartes ne doivent rien voir de ce paramétrage.
 */
export function createTerrain({
  groundY = -15, size = 1300, segments = 220,
  cx = 0, cz = -64, echelleX = 1, plat = 120, ouvert = 300, rayonCretes = 1, releve = 0,
} = {}) {
  const ridges = buildRidges(cx, cz, rayonCretes);
  const CX = cx, CZ = cz;

  function heightAt(x, z) {
    // Cuvette centrale : sous la piste le terrain reste plat, et la transition est
    // progressive pour qu'aucune arête ne trahisse la zone protégée.
    //
    // `echelleX` rend la cuvette ELLIPTIQUE. Une cuvette ronde convient à un parcours qui
    // serpente dans toutes les directions ; sur un lagon de 220 m de long il faudrait un
    // rayon si grand que la terre disparaîtrait de l'écran. En resserrant l'axe X on
    // obtient un couloir : de l'eau devant et derrière, la berge à portée de regard.
    const d = Math.hypot((x - CX) * echelleX, z - CZ);
    const open = smoothstep(plat, ouvert, d);
    if (open <= 0.001) return 0;

    /**
     * RELÈVEMENT DE LA PLAINE.
     *
     * Sans lui, la cuvette et la plaine qui l'entoure sont à la MÊME altitude : le module
     * ne sait produire du dénivelé qu'aux crêtes, et entre elles tout est plat. C'est sans
     * conséquence quand la piste court sur le sol — mais une carte dont le centre est un
     * LAGON a besoin que la plaine soit au-dessus de l'eau et la cuvette en dessous. Un
     * relèvement constant appliqué hors de la cuvette suffit : la cuvette reste le fond du
     * lagon, la plaine devient la berge, et le rivage naît là où le sol traverse le plan
     * d'eau — une découpe irrégulière qu'on n'a pas eu à dessiner.
     *
     * À zéro, le terrain est exactement celui d'avant.
     */
    let h = releve;
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
  // Couleurs par sommet ET texture : elles se MULTIPLIENT. Le degrade d'altitude porte
  // la teinte, le motif porte le grain. Sans grain, le sol est un aplat sans echelle et
  // les objets poses dessus semblent flotter — c'est le repere de taille qui manque,
  // pas la couleur.
  mat.vertexColors = true;
  mat.map = grassTufts({ repeat: [size / 16, size / 16] });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(CX, groundY, CZ);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  return { mesh, heightAt, groundY };
}

/**
 * RIVAGE DE LAGON — lagon, plage et colline, en un seul maillage.
 *
 * `createTerrain` ne convient pas ici, et il a fallu s'y casser les dents pour le voir. Il
 * modèle une CUVETTE entourée d'une CEINTURE de crêtes : entre les deux, la plaine est
 * plate et à la même altitude que la cuvette. C'est parfait pour une piste posée sur le
 * sol, et inutilisable pour un lagon — il n'existe aucun réglage qui donne à la fois de
 * l'eau au centre, une plage étroite, et une colline proche.
 *
 * Ici la carte est un COULOIR : le décor ne dépend donc pas de la distance au centre, mais
 * de la seule distance à l'AXE. On définit un profil en travers — fond, pente, plage,
 * colline — et on le balaie sur toute la longueur. Trois conséquences :
 *
 *   1. la plage a la largeur qu'on veut, et pas celle qui tombe ;
 *   2. la colline est PROCHE et ferme la vue à hauteur d'œil, ce qui dispense d'un lointain
 *      lisse qui s'étend sur des centaines de mètres pour simuler la profondeur ;
 *   3. en faisant ONDULER le profil le long de Z, le rivage devient une courbe organique
 *      au lieu d'une ligne droite — c'est le même bruit qui déplace la plage et la colline,
 *      donc les bandes restent parallèles comme sur une vraie côte.
 */
export function createRivage({
  zDebut = 0, zFin = -200, eauY = -6.5,
  fond = -13, lagon = 24, pente = 40, plage = 56, colline = 108, hauteur = 24,
  seed = 3, nx = 120, nz = 150,
} = {}) {
  const MARGE = 70;
  const z0 = zDebut + MARGE, z1 = zFin - MARGE;
  const X = colline + 60;

  /** Hauteur du profil en travers, à `ax` mètres de l'axe. */
  const profil = (ax) => {
    if (ax <= lagon) return fond;
    if (ax <= pente) return fond + (eauY + 0.9 - fond) * smoothstep(lagon, pente, ax);
    if (ax <= plage) return eauY + 0.9 + 0.5 * smoothstep(pente, plage, ax);
    return eauY + 1.4 + hauteur * smoothstep(plage, colline, ax);
  };

  /**
   * Ondulation du rivage. Deux harmoniques de périodes incommensurables : une seule
   * donnerait une côte en vague régulière, qu'on lit aussitôt comme un motif.
   */
  const onde = (z) => (fbm(z * 0.014 + seed, seed * 3.1) - 0.5) * 22
                    + (fbm(z * 0.045 - seed, seed * 1.7) - 0.5) * 7;

  const hauteurAt = (x, z) => profil(Math.max(0, Math.abs(x) - onde(z)));

  const geo = new THREE.PlaneGeometry(X * 2, z0 - z1, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const couleurs = new Float32Array(pos.count * 3);

  const SABLE_MOUILLE = new THREE.Color(0xe8c78a);
  const SABLE = new THREE.Color(0xf7dfa8);
  const HERBE = new THREE.Color(0x86d95e);
  const HERBE_HI = new THREE.Color(0x63c46b);
  const t = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i) + (z0 + z1) / 2;
    const y = hauteurAt(x, z);
    pos.setY(i, y);

    // Couleur par ALTITUDE, seuils chevauchants. Le sable mouillé juste au bord de l'eau
    // est ce qui fait lire une plage plutôt qu'une bande jaune : une côte a toujours une
    // frange plus sombre là où la vague vient de passer.
    if (y < eauY + 1.1) t.copy(SABLE_MOUILLE).lerp(SABLE, smoothstep(eauY - 0.6, eauY + 1.1, y));
    else if (y < eauY + 3.4) t.copy(SABLE).lerp(HERBE, smoothstep(eauY + 1.6, eauY + 3.4, y));
    else t.copy(HERBE).lerp(HERBE_HI, smoothstep(eauY + 3.4, eauY + hauteur * 0.8, y));

    couleurs[i * 3] = t.r; couleurs[i * 3 + 1] = t.g; couleurs[i * 3 + 2] = t.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(couleurs, 3));
  geo.computeVertexNormals();

  const mat = toonMaterial(0xffffff);
  mat.vertexColors = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = (z0 + z1) / 2;
  mesh.receiveShadow = true;
  return { mesh, hauteurAt };
}
