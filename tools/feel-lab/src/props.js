import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonMaterial, addOutline } from './world.js';

/**
 * Aucune arête vive dans ce jeu : toutes les surfaces jouables passent par ici.
 * Un cube brut se lit comme un placeholder ; une forme biseautée avec un liseré
 * se lit comme un objet dessiné. C'est la différence entre un prototype et un jeu.
 */

const texCache = new Map();

function canvasTexture(key, size, draw, repeat = [1, 1]) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

/**
 * Deux régimes de texture, et il ne faut pas les mélanger :
 *  - MOTIF (sol) : niveaux clairs quasi neutres. La teinte vient du matériau, la texture
 *    ne fait que la moduler. Une texture colorée multiplierait la couleur et l'assombrirait
 *    deux fois — c'est ce qui faisait virier le rose au brun.
 *  - SIGNAL (danger) : la texture porte les couleurs, et le matériau reste blanc.
 */

/** Rayures diagonales — signal de danger, lisible à toute vitesse. Matériau blanc attendu. */
export function stripeTexture(a = '#ffc93c', b = '#ff8a3d', bands = 8, repeat = [4, 1]) {
  return canvasTexture(`stripe-${a}-${b}-${bands}-${repeat}`, 256, (ctx, s) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = b;
    const w = s / bands;
    ctx.save();
    ctx.translate(-s, 0);
    ctx.rotate(-0.5);
    for (let i = 0; i < bands * 4; i++) ctx.fillRect(i * w * 2, -s, w, s * 4);
    ctx.restore();
  }, repeat);
}

/** Damier — départ, arrivée, zones neutres. */
export function checkerTexture(a = '#ffffff', b = '#2a1b45', squares = 8, repeat = [3, 1]) {
  return canvasTexture(`check-${a}-${b}-${squares}-${repeat}`, 256, (ctx, s) => {
    const q = s / squares;
    for (let y = 0; y < squares; y++)
      for (let x = 0; x < squares; x++) {
        ctx.fillStyle = (x + y) % 2 ? a : b;
        ctx.fillRect(x * q, y * q, q, q);
      }
  }, repeat);
}

/** Pois doux — sol des zones calmes, évite l'aplat mort. */
export function dotTexture(bg = '#f5a3c7', dot = '#ffd2e6', repeat = [8, 8]) {
  return canvasTexture(`dots-${bg}-${dot}-${repeat}`, 256, (ctx, s) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = dot;
    for (const [cx, cy] of [[0.25, 0.25], [0.75, 0.75]]) {
      ctx.beginPath();
      ctx.arc(cx * s, cy * s, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  }, repeat);
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
