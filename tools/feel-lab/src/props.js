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

/**
 * Balle roulante : sphere CENTREE sur son origine, sans embase.
 * `balloon` ne convient pas : son maillage est decale vers le haut et porte un noeud,
 * donc il ne coincide plus avec son collider des qu'il roule.
 */
export function ballMesh(radius, color) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), toonMaterial(color));
  mesh.castShadow = true;
  // Deux calottes claires : sans reperes de surface, une sphere unie parait immobile
  // meme lancee a pleine vitesse.
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.004, 20, 8, 0, Math.PI * 2, 0, 0.5),
    toonMaterial(0xffffff));
  mesh.add(cap);
  const cap2 = cap.clone();
  cap2.rotation.x = Math.PI;
  mesh.add(cap2);
  addOutline(mesh, 0.02);
  return mesh;
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

  /*
   * Les fanions sont INSTANCIÉS, pas créés un par un.
   *
   * Une guirlande de quatorze fanions coûtait quinze appels de dessin à elle seule, et
   * il y en a cinq sur le parcours. En instances, la guirlande entière n'en coûte que
   * deux — la corde et le lot de fanions — pour un rendu identique. Les couleurs sont
   * portées par instance, donc la variété est conservée.
   */
  const geo = new THREE.ConeGeometry(0.26, 0.62, 3);
  const flags = new THREE.InstancedMesh(geo, toonMaterial(0xffffff), count);
  const dummy = new THREE.Object3D();
  const teinte = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = -width / 2 + t * width;
    const sag = -Math.sin(t * Math.PI) * width * 0.055;
    dummy.position.set(x, sag - 0.32, 0);
    dummy.rotation.set(Math.PI, 0, 0);
    dummy.updateMatrix();
    flags.setMatrixAt(i, dummy.matrix);
    flags.setColorAt(i, teinte.setHex(colors[i % colors.length]));
  }
  flags.instanceMatrix.needsUpdate = true;
  if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
  flags.castShadow = false;
  group.add(flags);
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
/**
 * @param {number} groundY  altitude de pose
 * @param {object} o
 *   `cx` / `cz`  centre de la ceinture
 *   `densite`    fraction des sommets a poser, de 0 a 1. Chaque sommet coute deux appels
 *                de dessin : une carte deja chargee peut vouloir la meme chaine en moins
 *                dense plutot que pas de chaine du tout.
 *   `rayon`      multiplie la distance des anneaux
 *
 * Les valeurs par defaut reproduisent exactement la chaine de La Course.
 */
export function mountainRange(groundY, { cx = 0, cz = -64, densite = 1, rayon = 1 } = {}) {
  const group = new THREE.Group();

  // Les montagnes forment une CEINTURE autour du centre, pas une rangee au fond. Deux
  // raisons : elles masquent le bord du terrain quelle que soit l'orientation de la camera,
  // et un horizon ferme de tous cotes donne un monde, la ou une rangee donne un fond de scene.
  const CX = cx, CZ = cz;

  const RINGS = [
    // rayon, nombre, echelle, teinte de base, teinte de calotte, arrondi
    { r: 168, n: 11, scale: 0.62, base: 0xf274a2, cap: 0xffeaf2, sharp: 0.62 },
    { r: 246, n: 14, scale: 0.95, base: 0xf59ab8, cap: 0xfff4f8, sharp: 0.5 },
    { r: 340, n: 16, scale: 1.45, base: 0xf7dfe8, cap: 0xffffff, sharp: 0.36 },
  ];
  const TINTS = [null, 0xb98ae0, 0xffab8a, 0x7cc8e8, null, 0xe08ab4];

  let seed = 1;
  RINGS.forEach((ring, li) => {
    // On tire TOUJOURS les memes nombres aleatoires, et on ne pose qu'un sommet sur n :
    // baisser la densite ne doit pas redessiner une autre chaine, seulement l'eclaircir.
    const pas = Math.max(1, Math.round(1 / Math.max(0.05, densite)));
    for (let i = 0; i < ring.n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const r1 = seed / 233280;
      seed = (seed * 9301 + 49297) % 233280;
      const r2 = seed / 233280;
      seed = (seed * 9301 + 49297) % 233280;
      const r3 = seed / 233280;

      // Angle irregulier : une repartition parfaitement reguliere se voit immediatement.
      const ang = (i / ring.n) * Math.PI * 2 + (r1 - 0.5) * (Math.PI / ring.n) * 1.5;
      if (i % pas) continue;
      const dist = ring.r * rayon * (0.82 + r2 * 0.36);

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

// ───────────────────────── Mini-jeu « Les Portes » ─────────────────────────

/**
 * Panneau de porte en papier tendu, découpé en QUATRE QUARTIERS jointifs.
 *
 * Le découpage n'est pas décoratif : il existe pour que la porte se déchire à la
 * traversée. Un panneau d'une seule pièce ne pourrait que disparaître, et une porte qui
 * s'évapore ne dit pas au joueur qu'il vient de la traverser — c'est ce retour qui lui
 * apprend qu'il a lu le bon indice.
 *
 * Le bombement est calculé dans le repère du PANNEAU ENTIER, pas du quartier : les
 * quartiers se raccordent donc exactement, et la couture est invisible.
 */
export function paperPanel(width, height, color, { map = null, bulge = 0 } = {}) {
  const geo = new THREE.PlaneGeometry(width, height, 10, 10);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const X = pos.getX(i), Y = pos.getY(i);
    pos.setZ(i, bulge * Math.cos(Math.PI * X / width) * Math.cos(Math.PI * Y / height));
  }
  geo.computeVertexNormals();
  const mat = toonMaterial(color);
  if (map) mat.map = map;
  mat.side = THREE.DoubleSide;
  mat.transparent = true;                 // requis par le fondu de la déchirure
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;                // une feuille de papier ne porte pas d'ombre
  mesh.receiveShadow = true;
  mesh.userData.taille = { width, height, bulge };
  return mesh;
}

/**
 * Déchire un panneau en quatre quartiers qui s'écartent.
 *
 * Les quartiers ne sont créés QU'ICI, au moment où la porte cède. Les construire
 * d'avance coûtait quatre maillages par porte en permanence — cent quatre-vingt-huit
 * appels de dessin pour une découpe que la plupart des portes ne subissent jamais.
 *
 * Le bombement est recalculé dans le repère du panneau ENTIER : les quartiers se
 * raccordent donc exactement, et la couture reste invisible le temps qu'ils s'écartent.
 */
/** Bruit déterministe : même rupture, même éclat, sur toutes les machines. */
function bruit(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Éclatement d'un panneau de porte.
 *
 * Trois défauts de la version à quatre quartiers, tous visibles à l'écran :
 *
 *  1. CHAQUE MORCEAU MONTRAIT LE PANNEAU ENTIER. Les quartiers héritaient d'un plan neuf,
 *     donc d'un jeu de coordonnées de texture complet : on voyait quatre portes
 *     miniatures s'envoler au lieu d'une porte en morceaux. Le défaut passait inaperçu
 *     sur un papier uni ; avec un motif à chevrons, il saute aux yeux. Les coordonnées
 *     sont maintenant redécoupées case par case.
 *  2. QUATRE MORCEAUX, ÇA NE CASSE PAS, ÇA SE DÉPLIE. Neuf morceaux donnent une gerbe.
 *  3. LE FONDU COMMENÇAIT À L'INSTANT DE LA RUPTURE. Les morceaux étaient à demi
 *     transparents avant même d'avoir quitté le cadre, et l'impact n'existait pas. Ils
 *     restent maintenant pleins pendant les deux tiers de leur vol.
 *
 * `vers` est le sens de la course (-1 vers le fond) : le papier part DEVANT le joueur,
 * pas dans toutes les directions. C'est ce qui donne l'impression de l'avoir traversé.
 */
export function dechirerPanneau(panneau, { vers = -1, cases = 3 } = {}) {
  const { width, height, bulge } = panneau.userData.taille;
  const parent = panneau.parent;
  const n = Math.max(2, cases);
  const morceaux = [];
  // Un seul matériau pour toute la gerbe : neuf clones par porte brisée, c'était neuf
  // fois le même fondu calculé et neuf états de rendu pour une seconde d'animation.
  const mat = panneau.material.clone();
  mat.transparent = true;
  mat.opacity = 1;

  for (let ix = 0; ix < n; ix++) {
    for (let iy = 0; iy < n; iy++) {
      // Léger débord : deux morceaux strictement jointifs laissent voir un fil de fond
      // dès que la caméra bouge, à cause de l'arrondi à l'écran.
      const qw = (width / n) * 1.03, qh = (height / n) * 1.03;
      const cx = (ix - (n - 1) / 2) * (width / n);
      const cy = (iy - (n - 1) / 2) * (height / n);

      const geo = new THREE.PlaneGeometry(qw, qh, 2, 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const X = pos.getX(i) + cx, Y = pos.getY(i) + cy;
        pos.setZ(i, bulge * Math.cos(Math.PI * X / width) * Math.cos(Math.PI * Y / height));
      }
      // Redécoupage des coordonnées de texture sur la case : le morceau montre la
      // portion du motif qu'il occupait, et la porte se recompose à l'œil.
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (ix + uv.getX(i)) / n, (iy + uv.getY(i)) / n);
      }
      geo.computeVertexNormals();

      const m = new THREE.Mesh(geo, mat);
      m.position.set(cx, cy, panneau.position.z);
      m.castShadow = false;
      const a = bruit(ix * 31 + iy * 17), b = bruit(ix * 13 + iy * 71);
      // Gerbe : chaque morceau part de son propre côté, et d'autant plus vite qu'il
      // était loin du centre — c'est ce qui fait une déchirure et non une explosion.
      const rx = cx / Math.max(0.001, width / 2), ry = cy / Math.max(0.001, height / 2);
      m.userData.vitesse = new THREE.Vector3(
        rx * (2.4 + a * 1.6),
        ry * 1.5 + 1.9 + b * 1.1,
        vers * (4.2 + a * 2.2));
      m.userData.spin = new THREE.Vector3(
        (a - 0.5) * 11, (b - 0.5) * 11, (a - b) * 11);
      parent.add(m);
      morceaux.push(m);
    }
  }
  panneau.visible = false;
  return morceaux;
}

export function grandstand(longueur, {
  rangees = 4,
  profondeurRangee = 2.2,
  hauteurRangee = 1.35,
  couleurs = [0x3ed0d8, 0xfec809, 0xfe2a96, 0xfb7813],
  publicCouleurs = [0xff4fa3, 0x2dd9d9, 0xffee7a, 0xff8a1f, 0xa5d440, 0xb072ff],
  seed = 1,
} = {}) {
  const group = new THREE.Group();
  let a = seed >>> 0 || 1;
  const rnd = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Bancs : chaque rangée est un matelas gonflé, décalé vers l'arrière et vers le haut.
  for (let r = 0; r < rangees; r++) {
    const banc = roundedBox(longueur, hauteurRangee, profondeurRangee, couleurs[r % couleurs.length],
      { radius: 0.34, outline: 0 });
    banc.position.set(0, (r + 0.5) * hauteurRangee, -r * profondeurRangee);
    group.add(banc);
  }

  // Garde-corps devant la première rangée : il ferme la tribune par le bas.
  const rambarde = pill(longueur, 0.3, 0xffffff, { outline: false });
  rambarde.rotation.z = Math.PI / 2;
  rambarde.position.set(0, hauteurRangee + 0.5, profondeurRangee * 0.45);
  group.add(rambarde);

  // Public.
  const rayon = 0.34, hauteur = 0.95;
  const parRangee = Math.max(2, Math.floor(longueur / (rayon * 3.4)));
  const total = parRangee * rangees;
  const geo = new THREE.CapsuleGeometry(rayon, hauteur - rayon * 2, 3, 8);
  const mesh = new THREE.InstancedMesh(geo, toonMaterial(0xffffff), total);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const bases = [];
  const dummy = new THREE.Object3D();
  const couleur = new THREE.Color();
  let i = 0;
  for (let r = 0; r < rangees; r++) {
    for (let k = 0; k < parRangee; k++) {
      const x = -longueur / 2 + (k + 0.5) * (longueur / parRangee);
      const y = (r + 1) * hauteurRangee + hauteur / 2;
      const z = -r * profondeurRangee + (rnd() - 0.5) * 0.4;
      // La phase dépend de la POSITION : c'est ce qui fait une ola qui traverse la
      // tribune, au lieu d'une foule qui sautille toute ensemble.
      bases.push({ x, y, z, phase: x * 0.22 + r * 0.5, ampl: 0.16 + rnd() * 0.2 });
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, couleur.setHex(publicCouleurs[Math.floor(rnd() * publicCouleurs.length)]));
      i++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);

  return {
    group,
    update(t) {
      for (let j = 0; j < bases.length; j++) {
        const b = bases[j];
        const saut = Math.max(0, Math.sin(t * 2.4 - b.phase)) * b.ampl;
        dummy.position.set(b.x, b.y + saut, b.z);
        dummy.updateMatrix();
        mesh.setMatrixAt(j, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

export function bollardField(positions, height, radius, color) {
  const group = new THREE.Group();
  if (!positions.length) return group;
  const n = positions.length;
  const dummy = new THREE.Object3D();

  const corps = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(radius, Math.max(0.01, height - radius * 2), 6, 14),
    toonMaterial(color), n);
  corps.castShadow = true;

  // Le contour est lui aussi instancié : une capsule légèrement grossie, vue de
  // l'intérieur. Le même effet que addOutline, pour un seul appel de dessin.
  const contour = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(radius + 0.026, Math.max(0.01, height - radius * 2) + 0.05, 6, 14),
    new THREE.MeshBasicMaterial({ color: 0x2a1b45, side: THREE.BackSide }), n);
  contour.castShadow = false;

  const anneau = new THREE.InstancedMesh(
    new THREE.TorusGeometry(radius * 1.04, radius * 0.16, 8, 16),
    toonMaterial(0xffffff), n);

  positions.forEach(([x, y, z], i) => {
    dummy.position.set(x, y + height / 2, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    corps.setMatrixAt(i, dummy.matrix);
    contour.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + height * 0.62, z);
    dummy.rotation.set(Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    anneau.setMatrixAt(i, dummy.matrix);
  });
  for (const m of [corps, contour, anneau]) { m.instanceMatrix.needsUpdate = true; group.add(m); }
  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// JUNGLE — pièces de l'échine et de ses liaisons
//
// Toutes ces pièces portent un collider. Elles sont donc PROCÉDURALES, et chacune publie
// ses demi-dimensions exactes dans `userData.colliders` : la scène n'a jamais à redevenir
// le visuel pour poser sa boîte. C'est la seule façon de garantir que la hitbox suit le
// dessin, ce qui n'est pas négociable quand de l'argent est en jeu.
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * ARÊTE D'ÉCORCE — le bourrelet segmenté qui barre l'échine.
 *
 * Une rangée de segments dodus posés côte à côte, ceinturés d'un cordage. Deux emplois
 * selon la hauteur, et c'est la scène qui tranche : basse elle se saute, haute elle se
 * contourne. La forme ne change pas, seule la cote change — le joueur lit la réponse à la
 * silhouette, sans qu'on ait à lui coller deux vocabulaires visuels différents.
 *
 * Les segments sont INSCRITS dans la boîte du collider : les gorges entre eux sont en
 * retrait de deux centimètres. Le collider n'est donc jamais plus petit que le visuel —
 * on ne traverse jamais ce qu'on voit — et son léger excédent au fond des gorges est
 * invisible à l'œil comme au jeu.
 */
export function areteEcorce(longueur, hauteur, epaisseur, couleur, opts = {}) {
  const group = new THREE.Group();
  const segLarge = opts.segment ?? 1.6;
  const n = Math.max(1, Math.round(longueur / segLarge));
  const pas = longueur / n;

  for (let i = 0; i < n; i++) {
    // 0,04 m de jeu latéral : c'est lui qui creuse la gorge entre deux segments.
    const seg = roundedBox(pas - 0.04, hauteur, epaisseur, couleur, {
      radius: Math.min(epaisseur, hauteur) * 0.34,
      map: opts.map ?? null,
      outline: 0.01,
    });
    seg.position.x = -longueur / 2 + pas * (i + 0.5);
    group.add(seg);
  }

  // Cordage : un tore aplati qui ceinture la rangée au tiers inférieur. Décor pur, posé à
  // l'intérieur du gabarit du collider, donc il ne ment sur rien.
  if (opts.corde !== false) {
    const corde = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(epaisseur, hauteur) * 0.52, 0.09, 6, 18),
      toonMaterial(opts.couleurCorde ?? 0xf0c75a),
    );
    corde.rotation.y = Math.PI / 2;
    corde.scale.set(1, hauteur / Math.max(epaisseur, hauteur), 1);
    corde.position.set(-longueur / 2 + pas * 0.5, -hauteur * 0.16, 0);
    const corde2 = corde.clone();
    corde2.position.x = longueur / 2 - pas * 0.5;
    group.add(corde, corde2);
  }

  group.userData.colliders = [
    { type: 'cuboid', hx: longueur / 2, hy: hauteur / 2, hz: epaisseur / 2, x: 0, y: 0, z: 0 },
  ];
  return group;
}

/**
 * BARIL — le rondin qui dévale l'échine.
 *
 * C'est lui qui porte désormais la pression temporelle, à la place du mur qui balayait
 * quand le tronc tournait vite. Il roule dans l'axe du parcours, donc son axe est
 * TRANSVERSAL : un cylindre couché sur X qui roule vers +Z ou −Z.
 *
 * Les deux faces reçoivent leurs anneaux de coupe. Sans elles le baril se lit comme un
 * tuyau, et surtout on ne voit plus qu'il tourne : les cernes sont le seul repère de
 * rotation d'un cylindre uni.
 */
export function baril(rayon, longueur, couleur, opts = {}) {
  const group = new THREE.Group();

  const corps = new THREE.Mesh(
    new THREE.CylinderGeometry(rayon, rayon, longueur, 20, 1),
    toonMaterial(couleur),
  );
  if (opts.map) corps.material.map = opts.map;
  corps.rotation.z = Math.PI / 2;          // couché sur X
  corps.castShadow = true;
  corps.receiveShadow = true;
  addOutline(corps, 0.02, 0x2a1b45);
  group.add(corps);

  if (opts.mapAnneaux) {
    const disque = new THREE.CircleGeometry(rayon * 1.002, 24);
    const mat = new THREE.MeshBasicMaterial({ map: opts.mapAnneaux });
    for (const s of [1, -1]) {
      const d = new THREE.Mesh(disque, mat);
      d.position.x = (s * longueur) / 2;
      d.rotation.y = (s * Math.PI) / 2;
      group.add(d);
    }
  }

  group.userData.colliders = [
    { type: 'cylinderX', halfHeight: longueur / 2, radius: rayon, x: 0, y: 0, z: 0 },
  ];
  return group;
}

/**
 * PIERRE DE GUÉ — le rocher plat posé sur le lagon.
 *
 * Un cylindre bas et large, à peine irrégulier. Le dessus est PLAT et horizontal : un
 * galet bombé se lit bien mais se joue mal, on glisse d'un sommet qu'on croyait poser.
 * Le collider est le cylindre exact, donc le pied porte là où l'œil le pose.
 */
export function pierreDeGue(rayon, hauteur, couleur, opts = {}) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(rayon, rayon * 0.86, hauteur, opts.faces ?? 9, 1);
  const mesh = new THREE.Mesh(geo, toonMaterial(couleur));
  if (opts.map) mesh.material.map = opts.map;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  addOutline(mesh, 0.016, 0x2a1b45);
  group.add(mesh);

  group.userData.colliders = [
    { type: 'cylinder', halfHeight: hauteur / 2, radius: rayon, x: 0, y: 0, z: 0 },
  ];
  return group;
}

/**
 * PONT DE CORDES — la liaison entre deux échines.
 *
 * Le pont est une RESPIRATION, pas un obstacle : après une échine qui dérobe, il faut un
 * segment où l'on court droit. Ses garde-corps portent donc un vrai collider et on ne
 * tombe pas d'un pont — sans quoi la liaison redeviendrait un piège, et la manche
 * n'offrirait plus aucun répit.
 *
 * Le tablier est légèrement affaissé au milieu : c'est ce qui le fait lire comme suspendu
 * plutôt que posé. L'affaissement est repris marche par marche dans le collider, donc la
 * courbe qu'on voit est celle qu'on foule.
 */
export function pontDeCordes(longueur, largeur, opts = {}) {
  const group = new THREE.Group();
  const colliders = [];

  const nPlanches = Math.max(4, Math.round(longueur / 1.15));
  const pas = longueur / nPlanches;
  const flecheMax = opts.fleche ?? 0.55;    // affaissement au milieu, en mètres
  /*
   * APPUIS PLATS. Sur `appui` mètres à chaque bout, le tablier reste à hauteur d'appui ;
   * la cloche ne commence qu'ensuite. C'est là que la scène pose son seuil de jonction —
   * une planche 8 cm au-dessus de la crête. Sans appui plat, le seuil surplombait un
   * tablier déjà affaissé de 17 cm sous lui : une marche de 25 cm à l'entrée de chaque
   * échine, et la culbute pour qui arrivait en courant.
   */
  const appui = Math.min(opts.appui ?? 0, longueur * 0.4);
  const portee = longueur - 2 * appui;      // la partie qui s'affaisse
  const EP = 0.22;

  /** Abscisse dans la cloche, 0 à 1, bornée : nulle sur l'appui de départ, pleine sur l'autre. */
  const cloche = (t) => Math.min(1, Math.max(0, (t * longueur - appui) / portee));
  /** Affaissement en cloche : nul sur les appuis, maximal au centre. */
  const fleche = (t) => -flecheMax * Math.sin(Math.PI * cloche(t));
  /** Pente du tablier en t (dy/dz) : la dérivée de la flèche ; nulle sur les appuis. */
  const pente = (t) => {
    const u = cloche(t);
    if (u <= 0 || u >= 1) return 0;
    return (-flecheMax * Math.PI * Math.cos(Math.PI * u)) / portee;
  };
  /*
   * CHAQUE PLANCHE SUIT LA TANGENTE DU TABLIER — visuel et collider, du même angle.
   *
   * Posées à plat à des hauteurs différentes, les planches faisaient un ESCALIER : des
   * marches de 15 à 17 cm près des appuis, là où la pente est la plus forte. En descente
   * on ne sentait rien ; en montée, une capsule lancée à 7,6 m/s heurtait l'arête de la
   * marche suivante, et la secousse dépassait le seuil de culbute — le joueur tombait sur
   * un pont, sans obstacle, en marchant. Le directeur produit l'a signalé sur le premier
   * pont du Rondin (4 septembre 2026) ; `tools/test-harness/marche.mjs` l'a reproduit
   * sans navigateur, deux culbutes à z = 0,66 et z = −0,13.
   *
   * Inclinée sur la tangente, chaque planche prolonge la précédente : le tablier est une
   * rampe, et il ne reste entre deux planches que la flèche de la courbe sur un pas —
   * un centimètre. Rotation autour de X : y' = y·cos θ − z·sin θ, donc l'extrémité +z
   * monte de −sin θ ; on veut qu'elle monte de la pente, d'où θ = −atan(pente).
   */

  // Les planches sont INSTANCIEES. Posees une a une, les onze planches d'un pont coutaient
  // vingt-deux appels de dessin avec leur contour, soit quarante-quatre pour les deux ponts
  // de la carte — un huitieme du budget de la scene pour un objet que l'on traverse en deux
  // secondes. Elles partagent la meme geometrie : seule leur hauteur change.
  const geoPlanche = new RoundedBoxGeometry(largeur, EP, pas - 0.06, 2, 0.07);
  const matPlanche = toonMaterial(opts.couleur ?? 0xe0a163);
  if (opts.map) matPlanche.map = opts.map;
  const planches = new THREE.InstancedMesh(geoPlanche, matPlanche, nPlanches);
  planches.castShadow = true;
  planches.receiveShadow = true;
  const pose = new THREE.Object3D();
  for (let i = 0; i < nPlanches; i++) {
    const t = (i + 0.5) / nPlanches;
    const z = -longueur / 2 + pas * (i + 0.5);
    const y = fleche(t);
    const rx = -Math.atan(pente(t));
    pose.position.set(0, y, z);
    pose.rotation.set(rx, 0, 0);
    pose.updateMatrix();
    planches.setMatrixAt(i, pose.matrix);
    // Les colliders se RECOUVRENT de 2 cm. Bord à bord, deux cuboïdes partagent une face
    // d'épaisseur nulle, et un rayon tiré exactement dessus peut passer entre les deux —
    // le harnais de continuité a trouvé ce trou au milieu du pont. Un personnage de 0,45 m
    // de rayon n'y serait jamais tombé, mais un vide qui n'existe qu'à une abscisse précise
    // est le genre de défaut qui ressort plus tard, ailleurs, sans qu'on le reconnaisse.
    colliders.push({ type: 'cuboid', hx: largeur / 2, hy: EP / 2, hz: pas / 2 + 0.02, x: 0, y, z, rx });
  }
  planches.instanceMatrix.needsUpdate = true;
  group.add(planches);

  // Garde-corps : deux cordes tendues par côté, plus les montants d'appui.
  const RC = 0.075;
  for (const cote of [-1, 1]) {
    for (const h of [0.55, 1.15]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector3(
          (cote * largeur) / 2,
          fleche(t) + h + flecheMax * 0.35 * Math.sin(Math.PI * t),
          -longueur / 2 + longueur * t,
        ));
      }
      const corde = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, RC, 6, false),
        toonMaterial(opts.couleurCorde ?? 0x9fc4e8),
      );
      corde.castShadow = true;
      group.add(corde);
    }
    // Un seul collider vertical par côté : il tient lieu des deux cordes. Les modéliser
    // séparément doublerait le nombre de formes sans rien changer à ce qu'on peut faire.
    colliders.push({
      type: 'cuboid', hx: RC, hy: 0.62, hz: longueur / 2,
      x: (cote * largeur) / 2, y: 0.55, z: 0,
    });
  }

  // Montants aux deux extrémités.
  for (const cote of [-1, 1]) {
    for (const bout of [-1, 1]) {
      const m = pill(1.9, 0.19, opts.couleurMontant ?? 0xd79a5c, { outline: false });
      m.position.set((cote * largeur) / 2, 0.5, (bout * longueur) / 2);
      group.add(m);
    }
  }

  group.userData.colliders = colliders;
  return group;
}

/**
 * CRÊTE LOINTAINE — une ligne de collines, en UNE seule maille.
 *
 * Un horizon fermé est ce qui manque le plus à une scène ouverte : sans lui le décor
 * s'arrête sur une ligne droite et le regard sort du monde. La solution évidente est de
 * poser une dizaine de sommets — et elle coûte deux appels de dessin chacun, pour une masse
 * qu'on ne voit jamais que de loin et de face.
 *
 * Ici la ligne entière est UNE silhouette : une bande de triangles dont le profil supérieur
 * ondule. À cette distance la profondeur d'une colline ne se lit pas, seule sa découpe
 * compte — et une découpe n'a pas besoin de volume.
 *
 * Le profil somme trois harmoniques de périodes non commensurables. Une seule sinusoïde
 * donnerait une vague régulière, qu'on lit immédiatement comme un motif ; trois suffisent
 * à ce que l'œil n'y retrouve plus de répétition.
 */
export function creteLointaine(largeur, hauteur, base, couleur, { seed = 0, n = 72 } = {}) {
  const pos = [];
  const hautAt = (t) => {
    const a = t * Math.PI * 2;
    return base + hauteur * (
      0.55
      + 0.26 * Math.sin(a * 3.0 + seed)
      + 0.13 * Math.sin(a * 7.0 - seed * 1.6)
      + 0.06 * Math.sin(a * 13.0 + seed * 0.7)
    );
  };
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const x0 = -largeur / 2 + largeur * t0, x1 = -largeur / 2 + largeur * t1;
    const y0 = hautAt(t0), y1 = hautAt(t1);
    // Deux triangles par tranche, entre le profil et la base.
    pos.push(x0, base, 0, x1, base, 0, x1, y1, 0);
    pos.push(x0, base, 0, x1, y1, 0, x0, y0, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // `MeshBasicMaterial` et non toon : une silhouette d'arrière-plan ne doit pas réagir à la
  // lumière du parcours, sinon elle s'assombrit quand le soleil tourne et attire l'œil.
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: couleur, side: THREE.DoubleSide, toneMapped: false, fog: false,
  }));
  return mesh;
}
