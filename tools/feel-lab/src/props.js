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

/**
 * Portique néon : un demi-tore lumineux sur deux pieds, découpé en segments colorés.
 *
 * Construit en code plutôt que généré. Le modèle Meshy correspondant avait la bonne
 * forme mais est ressorti entièrement gris anthracite, sans la moindre bande lumineuse :
 * invisible dans une scène noire. Tout ce décor repose sur l'émissif, et c'est
 * précisément ce qu'un pipeline text-to-3D ne garantit pas — alors qu'un
 * MeshBasicMaterial, lui, brille toujours.
 */
export function neonArch(rayon, tube, couleurs = [0x22e8ff, 0xff2ed2, 0x8b5cf6]) {
  const group = new THREE.Group();
  const segments = couleurs.length * 2;
  const arc = Math.PI / segments;
  for (let i = 0; i < segments; i++) {
    const geo = new THREE.TorusGeometry(rayon, tube, 10, 14, arc);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: couleurs[i % couleurs.length], toneMapped: false,
    }));
    // Les segments partent de la droite et couvrent le demi-cercle supérieur.
    mesh.rotation.z = i * arc;
    group.add(mesh);
  }
  // Pieds : ils ancrent le portique sans le faire flotter.
  for (const sx of [-1, 1]) {
    const pied = new THREE.Mesh(
      new THREE.CylinderGeometry(tube * 1.9, tube * 2.6, tube * 3, 10),
      new THREE.MeshBasicMaterial({ color: 0x1b1030, toneMapped: false }));
    pied.position.set(sx * rayon, -tube * 1.5, 0);
    group.add(pied);
  }
  return group;
}

/**
 * Champ de plots INSTANCIÉ : un seul lot pour tous les plots d'un parcours.
 *
 * Un plot pèse trois maillages — corps, contour, anneau — et le parcours en aligne une
 * quarantaine le long des rambardes : près de cent quarante appels de dessin pour un
 * élément purement décoratif, plus que tout le reste du décor réuni. Instanciés, ils
 * n'en coûtent plus que trois, quel que soit leur nombre.
 *
 * `positions` est un tableau de [x, y, z].
 */
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
