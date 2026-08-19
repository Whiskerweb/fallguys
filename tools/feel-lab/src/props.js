import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonMaterial, addOutline } from './world.js';
import { hazardStripes, softChecker, polkaStagger } from './textures.js';

/**
 * Aucune arête vive dans ce jeu : toutes les surfaces jouables passent par ici.
 * Un cube brut se lit comme un placeholder ; une forme biseautée avec un liseré
 * se lit comme un objet dessiné. C'est la différence entre un prototype et un jeu.
 */

// Les textures vivent desormais dans textures.js : raccordables par construction,
// bien plus riches (matelassage, touffes, ecailles, bandes gonflees).
// Ces trois alias gardent les appels existants valides.
export function stripeTexture(a, b, bands = 8, repeat = [4, 1]) {
  return hazardStripes({ a, b, bands, repeat });
}
export function checkerTexture(a, b, cells = 8, repeat = [1, 1]) {
  return softChecker({ a, b, cells: Math.max(2, Math.round(cells / 2)), repeat });
}
export function dotTexture(base, dot, repeat = [8, 8]) {
  return polkaStagger({ base, dot, repeat });
}

/** Boîte à coins arrondis, avec texture et contour cartoon. */
export function roundedBox(w, h, d, color, opts = {}) {
  const radius = Math.min(opts.radius ?? 0.28, Math.min(w, h, d) / 2.05);
  const geo = new RoundedBoxGeometry(w, h, d, opts.segments ?? 3, radius);
  const mat = toonMaterial(color);
  if (opts.map) mat.map = opts.map;
  if (opts.emissive) mat.emissive = new THREE.Color(opts.emissive);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (opts.outline !== false) addOutline(mesh, opts.outline ?? 0.014, 0x2a1b45);
  return mesh;
}

/** Pilule allongée : rails, poutres, bordures. Jamais un parallélépipède. */
export function pill(length, radius, color, opts = {}) {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 14);
  const mesh = new THREE.Mesh(geo, toonMaterial(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (opts.outline !== false) addOutline(mesh, 0.03, 0x2a1b45);
  return mesh;
}

/** Contour arrondi réutilisable. */
function roundedRectPath(w, d, r) {
  const path = new THREE.Path();
  const hw = w / 2, hd = d / 2;
  const rad = Math.min(r, Math.min(hw, hd) * 0.95);
  path.moveTo(-hw + rad, -hd);
  path.lineTo(hw - rad, -hd); path.quadraticCurveTo(hw, -hd, hw, -hd + rad);
  path.lineTo(hw, hd - rad); path.quadraticCurveTo(hw, hd, hw - rad, hd);
  path.lineTo(-hw + rad, hd); path.quadraticCurveTo(-hw, hd, -hw, hd - rad);
  path.lineTo(-hw, -hd + rad); path.quadraticCurveTo(-hw, -hd, -hw + rad, -hd);
  return path;
}

/**
 * Liseré lumineux qui souligne le BORD d'une plateforme.
 * C'est un anneau, pas un disque : une ShapeGeometry pleine poserait un voile
 * semi-transparent sur toute la surface et délaverait la couleur du sol.
 */
export function rimGlow(w, d, color = 0xffe9b8, y = 0.02, thickness = 0.42) {
  const outer = new THREE.Shape();
  outer.curves = roundedRectPath(w, d, 0.3).curves;
  const inner = roundedRectPath(Math.max(0.2, w - thickness * 2), Math.max(0.2, d - thickness * 2), 0.22);
  outer.holes.push(inner);

  const geo = new THREE.ShapeGeometry(outer);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false,
  }));
  mesh.position.y = y;
  mesh.scale.setScalar(1.02);
  return mesh;
}

/** Bannière souple (arrivée, départ) : un ruban courbé, pas une planche. */
export function banner(width, color, text) {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-width / 2, 0.35, 0),
    new THREE.Vector3(0, -0.15, 0),
    new THREE.Vector3(width / 2, 0.35, 0),
  ]);
  const geo = new THREE.TubeGeometry(curve, 24, 0.42, 8, false);
  geo.scale(1, 1, 0.35);
  const mat = toonMaterial(color);
  if (text) mat.map = checkerTexture('#ffffff', '#1f7a3d', 6, [8, 1]);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

/**
 * Tube gonflable courbé — la brique visuelle signature du genre : arches, bordures,
 * portiques. Un tore partiel plutôt qu'un cylindre : rien ne doit avoir d'arête.
 */
export function inflatableArch(width, height, radius, color) {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-width / 2, 0, 0),
    new THREE.Vector3(-width / 2 * 0.86, height * 0.66, 0),
    new THREE.Vector3(0, height, 0),
    new THREE.Vector3(width / 2 * 0.86, height * 0.66, 0),
    new THREE.Vector3(width / 2, 0, 0),
  ]);
  const geo = new THREE.TubeGeometry(curve, 40, radius, 12, false);
  const mesh = new THREE.Mesh(geo, toonMaterial(color));
  mesh.castShadow = true;
  addOutline(mesh, 0.02);
  group.add(mesh);
  return group;
}

/** Ballon géant de décor : gonflé, mat, posé au sol par une petite embase. */
export function balloon(radius, color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 22, 18), toonMaterial(color));
  body.scale.y = 1.12;
  body.position.y = radius * 1.12;
  body.castShadow = true;
  addOutline(body, 0.018);
  group.add(body);
  const knot = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.22, radius * 0.34, 10), toonMaterial(color));
  knot.position.y = radius * 0.14;
  group.add(knot);
  return group;
}

/** Plot / borne gonflable, sert de bumper visuel et de repère de couloir. */
export function bollard(height, radius, color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, height - radius * 2), 6, 18), toonMaterial(color));
  body.position.y = height / 2;
  body.castShadow = true;
  addOutline(body, 0.026);
  group.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.04, radius * 0.16, 10, 22), toonMaterial(0xffffff));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = height * 0.62;
  group.add(ring);
  return group;
}

/** Fanions tendus entre deux points — habille le ciel au-dessus de la piste. */
export function bunting(width, count = 14, colors = [0xff5f7e, 0x4fd1c5, 0xffd83d, 0x8b7bff]) {
  const group = new THREE.Group();
  const rope = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-width / 2, 0, 0),
        new THREE.Vector3(0, -width * 0.055, 0),
        new THREE.Vector3(width / 2, 0, 0),
      ]), 22, 0.06, 6, false),
    toonMaterial(0xffffff)
  );
  group.add(rope);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = -width / 2 + t * width;
    const sag = -Math.sin(t * Math.PI) * width * 0.055;
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.62, 3), toonMaterial(colors[i % colors.length]));
    flag.position.set(x, sag - 0.32, 0);
    flag.rotation.x = Math.PI;
    group.add(flag);
  }
  return group;
}

/**
 * Drapeau flottant. L'ondulation est injectée dans le vertex shader d'un MeshToonMaterial
 * via onBeforeCompile : on garde l'ombrage en aplats du reste du jeu tout en déformant
 * le maillage sur le GPU. Animer 40 drapeaux sur le CPU coûterait bien plus cher.
 * L'amplitude croît avec la distance au mât — c'est ce qui donne l'air d'un tissu tenu
 * d'un seul côté plutôt que d'une plaque qui vibre.
 */
const wavingShaders = [];

export function flag(width, height, color, { map = null, amplitude = 0.28, speed = 3.2 } = {}) {
  const geo = new THREE.PlaneGeometry(width, height, 24, 8);
  geo.translate(width / 2, 0, 0);          // le bord gauche reste au mât
  const mat = toonMaterial(color);
  mat.side = THREE.DoubleSide;
  if (map) mat.map = map;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uAmp = { value: amplitude };
    shader.uniforms.uSpeed = { value: speed };
    shader.uniforms.uWidth = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uAmp; uniform float uSpeed; uniform float uWidth;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float grip = clamp(transformed.x / uWidth, 0.0, 1.0);
        float t = uTime * uSpeed;
        transformed.z += sin(transformed.x * 3.4 - t) * uAmp * grip;
        transformed.z += sin(transformed.y * 2.1 + t * 0.7) * uAmp * 0.35 * grip;
        transformed.y += cos(transformed.x * 2.6 - t * 1.1) * uAmp * 0.28 * grip;`);
    wavingShaders.push(shader);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/** À appeler une fois par frame : fait avancer tous les drapeaux d'un coup. */
export function updateFlags(elapsed) {
  for (const sh of wavingShaders) sh.uniforms.uTime.value = elapsed;
}

/** Mât + drapeau, prêt à poser. */
export function flagPole(poleHeight, flagWidth, flagHeight, poleColor, flagColor, opts = {}) {
  const group = new THREE.Group();
  const pole = pill(poleHeight, 0.12, poleColor, { outline: false });
  pole.position.y = poleHeight / 2;
  group.add(pole);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), toonMaterial(0xffd83d));
  knob.position.y = poleHeight + 0.08;
  group.add(knob);
  const f = flag(flagWidth, flagHeight, flagColor, opts);
  f.position.set(0.1, poleHeight - flagHeight / 2 - 0.35, 0);
  group.add(f);
  return group;
}

/** Oriflamme verticale : bannière étroite et haute, très lisible de loin. */
export function pennant(poleHeight, width, height, poleColor, color, opts = {}) {
  const group = new THREE.Group();
  const pole = pill(poleHeight, 0.14, poleColor, { outline: false });
  pole.position.y = poleHeight / 2;
  group.add(pole);
  const f = flag(width, height, color, { amplitude: 0.16, speed: 2.4, ...opts });
  f.rotation.z = -Math.PI / 2;             // suspendue par le haut
  f.position.set(0.08, poleHeight - 0.3, 0);
  group.add(f);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), toonMaterial(0xffd83d));
  cap.position.y = poleHeight + 0.22;
  group.add(cap);
  return group;
}

/**
 * Dalle de sol à tranche visible : un plateau coloré posé sur un socle d'une autre
 * couleur, légèrement plus large. C'est ce qui donne l'épaisseur de matelas du genre —
 * une dalle monochrome, même épaisse, se lit comme une surface plate.
 */
export function slabMesh(w, h, d, topColor, edgeColor, { map = null, radius = 0.5 } = {}) {
  const group = new THREE.Group();

  const base = roundedBox(w + 0.34, h, d + 0.34, edgeColor, { radius: radius * 0.9, outline: 0.006 });
  base.position.y = -0.06;
  group.add(base);

  const top = roundedBox(w, h * 0.72, d, topColor, { radius, map, outline: 0 });
  top.position.y = h * 0.2;
  group.add(top);

  return group;
}

/**
 * Sommet strié : un cône aux bandes horizontales. Les stries se lisent de très loin et
 * donnent une échelle au décor — c'est ce qui manque à une simple colline unie.
 */
export function stripedPeak(radius, height, baseColor, capColor, opts = {}) {
  const {
    sharpness = 0.55,     // 0 = dôme très rond, 1 = cône pointu
    capRatio = 0.30,      // part de la hauteur couverte par la calotte
    segments = 22,
    seed = 0,             // decale les harmoniques : deux sommets ne se ressemblent pas
  } = opts;

  const group = new THREE.Group();

  // Profil : demi-sphère étirée dont le resserrement vers le haut est réglable.
  // Un cône pur donne un sommet dur ; les références ont des sommets pleins et arrondis.
  const geo = new THREE.SphereGeometry(radius, segments, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const x0 = pos.getX(k), z0 = pos.getZ(k), y = pos.getY(k);
    const t = Math.max(0, Math.min(1, y / radius));
    const shrink = 1 - Math.pow(t, 1 - sharpness * 0.55) * (0.12 + sharpness * 0.5);

    // Irregularite de silhouette : un profil de revolution parfait se lit comme un cone
    // de signalisation. Trois harmoniques de faible amplitude suffisent a donner une
    // montagne, avec des epaulements et des versants inegaux.
    const ang = Math.atan2(z0, x0);
    const noise = Math.sin(ang * 3 + seed) * 0.10
                + Math.sin(ang * 5 - seed * 1.7) * 0.055
                + Math.sin(ang * 8 + seed * 0.6) * 0.03;
    const bulge = 1 + noise * (1 - t * 0.55);

    pos.setX(k, x0 * shrink * bulge);
    pos.setZ(k, z0 * shrink * bulge);
    // Le sommet lui-meme derive legerement : une cime pile au centre parait fabriquee.
    pos.setY(k, y * (height / radius) * (1 + Math.sin(ang * 2 + seed) * 0.04 * t));
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, toonMaterial(baseColor));
  group.add(body);

  /**
   * Calotte à bord ONDULÉ. Une calotte à bord net se lit comme un chapeau pose dessus ;
   * l'ondulation lui donne l'air de couler sur les flancs, ce qui est la lecture juste.
   */
  const capH = height * capRatio;
  const capBase = height - capH;
  const capR = radius * (1 - Math.pow(capBase / height, 1 - sharpness * 0.55) * (0.12 + sharpness * 0.5)) * 1.02;
  const capGeo = new THREE.SphereGeometry(capR, segments, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const cpos = capGeo.attributes.position;
  for (let k = 0; k < cpos.count; k++) {
    const x = cpos.getX(k), y = cpos.getY(k), z = cpos.getZ(k);
    const t = Math.max(0, Math.min(1, y / capR));
    const shrink = 1 - Math.pow(t, 1 - sharpness * 0.55) * (0.12 + sharpness * 0.5);
    // Le bord bas ondule : amplitude maximale a la base, nulle au sommet.
    const ang = Math.atan2(z, x);
    const wave = Math.sin(ang * 5) * 0.035 + Math.sin(ang * 8 + 1.3) * 0.02;
    const drop = (1 - t) * wave * capH * 1.5;
    cpos.setX(k, x * shrink);
    cpos.setZ(k, z * shrink);
    cpos.setY(k, y * (capH / capR) + drop);
  }
  capGeo.computeVertexNormals();
  const cap = new THREE.Mesh(capGeo, toonMaterial(capColor));
  cap.position.y = capBase;
  group.add(cap);

  return group;
}

/**
 * Chaîne de montagnes étagée en trois plans.
 * L'étagement est ce qui crée la profondeur : les sommets lointains sont plus PÂLES et
 * moins saturés, ce qui reproduit la perspective atmosphérique. Un seul plan de montagnes
 * de même teinte se lit comme un décor peint, quelle que soit sa qualité de forme.
 */
export function mountainRange(groundY) {
  const group = new THREE.Group();

  // La piste va de z=+20 a z=-148 : son centre est vers z=-64. Les montagnes forment
  // une CEINTURE autour de ce centre, pas une rangee au fond. Deux raisons : elles
  // masquent le bord du terrain quelle que soit l'orientation de la camera, et un
  // horizon ferme de tous cotes donne un monde, la ou une rangee donne un fond de scene.
  const CX = 0, CZ = -64;

  const RINGS = [
    // rayon, nombre, echelle, teinte de base, teinte de calotte, arrondi
    { r: 168, n: 11, scale: 0.62, base: 0xf274a2, cap: 0xffeaf2, sharp: 0.62 },
    { r: 246, n: 14, scale: 0.95, base: 0xf59ab8, cap: 0xfff4f8, sharp: 0.5 },
    { r: 340, n: 16, scale: 1.45, base: 0xf7dfe8, cap: 0xffffff, sharp: 0.36 },
  ];
  const TINTS = [null, 0xb98ae0, 0xffab8a, 0x7cc8e8, null, 0xe08ab4];

  let seed = 1;
  RINGS.forEach((ring, li) => {
    for (let i = 0; i < ring.n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const r1 = seed / 233280;
      seed = (seed * 9301 + 49297) % 233280;
      const r2 = seed / 233280;
      seed = (seed * 9301 + 49297) % 233280;
      const r3 = seed / 233280;

      // Angle irregulier : une repartition parfaitement reguliere se voit immediatement.
      const ang = (i / ring.n) * Math.PI * 2 + (r1 - 0.5) * (Math.PI / ring.n) * 1.5;
      const dist = ring.r * (0.82 + r2 * 0.36);

      // Ecart de taille tres large a l'interieur d'un meme anneau : c'est cet ecart,
      // plus que le nombre, qui fait lire une chaine plutot qu'une palissade.
      const size = 0.45 + Math.pow(r3, 1.7) * 1.5;
      const radius = (20 + r1 * 16) * ring.scale * size;
      const height = (34 + r2 * 44) * ring.scale * size;

      const tint = TINTS[(i * 3 + li) % TINTS.length];
      const peak = stripedPeak(radius, height, tint ?? ring.base, ring.cap, {
        sharpness: ring.sharp + (r1 - 0.5) * 0.3,
        capRatio: 0.10 + r2 * 0.14,
        segments: li === 2 ? 16 : 20,     // les plus lointaines sont moins detaillees
        seed: r3 * 12,
      });
      peak.position.set(CX + Math.cos(ang) * dist, groundY, CZ + Math.sin(ang) * dist);
      peak.rotation.y = r1 * Math.PI * 2;
      group.add(peak);
    }
  });
  return group;
}
