import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { toonMaterial } from '../world.js';
import { roundedBox, pill, rimGlow, banner, stripeTexture, checkerTexture, dotTexture } from '../props.js';

/**
 * La Course — mini-jeu 1 du spec.
 * CONTRAINTE LÉGALE : tous les obstacles suivent des cycles temporels FIXES, démarrés au
 * même instant pour tous. Aucun aléatoire ne décide du gagnant.
 *
 * Note d'implémentation : le VISUEL vient de Meshy, la COLLISION reste une primitive
 * (boîte, cylindre). C'est la pratique standard — un collider en maillage détaillé coûte
 * 50 à 100 fois plus cher et produit des accrochages invisibles. Le joueur voit le modèle,
 * la physique voit la forme simple.
 */

const C = {
  ground: 0xf5a3c7, groundAlt: 0xffd2e6, rail: 0x7b4bd1,
  hazard: 0xffc93c, roller: 0x4fd1c5, platform: 0xa78bfa, finish: 0x4ade80,
};

export function buildCourse(RAPIER, assets) {
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = 1 / 60;
  const group = new THREE.Group();
  const animated = [];
  const checkpoints = [];
  const spawn = new THREE.Vector3(0, 2.2, 4);
  const finishZ = -118;

  // ---------- helpers ----------
  function solid(mesh, px, py, pz, hx, hy, hz, friction = 0.6) {
    mesh.position.set(px, py, pz);
    group.add(mesh);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz));
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction), body);
    return mesh;
  }

  function kinematic(px, py, pz, colliderDesc) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(px, py, pz));
    world.createCollider(colliderDesc, body);
    return body;
  }

  /** Sol d'un segment : dalle arrondie texturée + liseré + garde-corps en pilules. */
  function segment(zStart, zEnd, width, map, color = C.ground) {
    const len = Math.abs(zEnd - zStart);
    const zc = (zStart + zEnd) / 2;
    const slab = roundedBox(width, 1.1, len, color, { radius: 0.45, map, outline: 0.008 });
    solid(slab, 0, -0.55, zc, width / 2, 0.55, len / 2);
    const glow = rimGlow(width, len);
    glow.position.set(0, 0.03, zc);
    group.add(glow);
    for (const sx of [-1, 1]) {
      const rail = pill(len, 0.42, C.rail);
      rail.rotation.x = Math.PI / 2;
      solid(rail, sx * (width / 2 + 0.25), 0.55, zc, 0.42, 0.9, len / 2);
      for (let z = zStart; z >= zEnd; z -= 6) {
        const post = pill(2.1, 0.3, 0x5b34a3);
        post.position.set(sx * (width / 2 + 0.25), 0.1, z);
        group.add(post);
      }
    }
    return slab;
  }

  // ---------- départ ----------
  segment(8, -16, 14, checkerTexture('#ffffff', '#f5a3c7', 6, [6, 12]));
  checkpoints.push(new THREE.Vector3(0, 2.2, 4));
  const startArch = assets.getFitted('finish-arch', { x: 15, y: 6 }) ;
  if (startArch) { startArch.position.set(0, 0, 6); group.add(startArch); }
  else { const b = banner(15, C.finish, true); b.position.set(0, 4.4, 6); group.add(b); }

  // ---------- zone 1 : bras rotatifs ----------
  segment(-16, -38, 12, dotTexture('#f5a3c7', '#ffd2e6', [10, 22]));
  checkpoints.push(new THREE.Vector3(0, 2.2, -17));
  addSpinner(0, 1.05, -23, 11, 1.0, 0);
  addSpinner(0, 1.05, -33, 11, -1.25, Math.PI / 2);

  // ---------- zone 2 : pendules ----------
  segment(-38, -58, 10, dotTexture('#ffd2e6', '#f5a3c7', [9, 20]));
  checkpoints.push(new THREE.Vector3(0, 2.2, -39));
  addPendulum(0, 7.0, -43, 0);
  addPendulum(0, 7.0, -49, Math.PI * 0.6);
  addPendulum(0, 7.0, -55, Math.PI * 1.2);

  // ---------- zone 3 : rouleaux ----------
  segment(-58, -74, 10, stripeTexture('#ffd2e6', '#f5a3c7', 10, [6, 12]));
  checkpoints.push(new THREE.Vector3(0, 2.2, -59));
  addRoller(0, 0.9, -63, 3.4);
  addRoller(0, 0.9, -67, -3.4);
  addRoller(0, 0.9, -71, 3.4);

  // ---------- zone 4 : plateformes mobiles ----------
  checkpoints.push(new THREE.Vector3(0, 2.2, -75));
  island(0, -76, 9, 5);
  addMovingPlatform(-79, 5.5, 2.2, 0.45);
  island(0, -84, 6, 3.6);
  addMovingPlatform(-88, 5.5, -2.2, 0.62);
  island(0, -93, 9, 5);

  // ---------- zone 5 : final ----------
  segment(-96, -120, 11, stripeTexture('#ffc93c', '#ff8a3d', 12, [5, 14]));
  checkpoints.push(new THREE.Vector3(0, 2.2, -94));
  addSpinner(0, 1.05, -104, 10, 1.6, 0);
  addSpinner(0, 2.45, -112, 9, -2.1, Math.PI / 3);

  const arch = assets.getFitted('finish-arch', { x: 13, y: 6.5 });
  if (arch) { arch.position.set(0, 0, finishZ); group.add(arch); }
  else {
    for (const sx of [-1, 1]) { const p = pill(6, 0.7, C.finish); p.position.set(sx * 5.4, 3, finishZ); group.add(p); }
    const b = banner(11.5, C.finish, true); b.position.set(0, 5.6, finishZ); group.add(b);
  }

  dressScenery();

  // ---------- constructeurs d'obstacles ----------
  function addSpinner(x, y, z, length, speed, phase) {
    const visual = assets.getFitted('spinner-arm', { x: length }, { groundAlign: false })
      ?? roundedBox(length, 0.9, 0.9, C.hazard, { radius: 0.42, map: stripeTexture('#ffc93c', '#ff8a3d', 14, [7, 1]) });
    visual.position.set(x, y, z);
    group.add(visual);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.75, 2.2, 16), toonMaterial(C.rail));
    hub.position.set(x, y - 0.35, z);
    hub.castShadow = true;
    group.add(hub);

    const body = kinematic(x, y, z, RAPIER.ColliderDesc.cuboid(length / 2, 0.45, 0.45).setFriction(0.5));
    const q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 1, 0);
    animated.push((t) => {
      q.setFromAxisAngle(axis, t * speed + phase);
      body.setNextKinematicRotation(q);
      visual.quaternion.copy(q);
    });
  }

  function addPendulum(x, pivotY, z, phase) {
    const armLen = 5.0;
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, z);
    group.add(pivot);

    const rope = pill(armLen, 0.11, 0x3d2d5c, { outline: false });
    rope.position.y = -armLen / 2;
    pivot.add(rope);

    const ball = assets.get('wrecking-ball', 3.0, { groundAlign: false })
      ?? new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 2), toonMaterial(0xff8a3d));
    ball.position.y = -armLen;
    pivot.add(ball);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), toonMaterial(C.rail));
    pivot.add(cap);

    const body = kinematic(x, pivotY, z,
      RAPIER.ColliderDesc.ball(1.5).setTranslation(0, -armLen, 0).setFriction(0.35));
    const q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 0, 1);
    animated.push((t) => {
      const angle = Math.sin(t * 1.15 + phase) * 0.95;
      q.setFromAxisAngle(axis, angle);
      body.setNextKinematicRotation(q);
      pivot.quaternion.copy(q);
    });
  }

  function addRoller(x, y, z, speed) {
    const length = 9.5, radius = 0.9;
    let visual = assets.getFitted('roller-log', { x: length }, { groundAlign: false });
    if (!visual) {
      const geo = new THREE.CylinderGeometry(radius, radius, length, 22);
      geo.rotateZ(Math.PI / 2);
      visual = new THREE.Mesh(geo, toonMaterial(C.roller, {}));
      visual.material.map = stripeTexture('#4fd1c5', '#ffffff', 16, [1, 8]);
      visual.castShadow = true;
    }
    visual.position.set(x, y, z);
    group.add(visual);

    const body = kinematic(x, y, z,
      RAPIER.ColliderDesc.cylinder(length / 2, radius)
        .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
        .setFriction(0.4));
    const q = new THREE.Quaternion(), axis = new THREE.Vector3(1, 0, 0);
    animated.push((t) => {
      q.setFromAxisAngle(axis, t * speed);
      body.setNextKinematicRotation(q);
      visual.quaternion.copy(q);
    });
  }

  function island(x, z, w, d) {
    const slab = roundedBox(w, 1.1, d, C.groundAlt, { radius: 0.5, map: dotTexture('#ffd2e6', '#f5a3c7', [4, 4]) });
    solid(slab, x, -0.55, z, w / 2, 0.55, d / 2);
    const glow = rimGlow(w, d); glow.position.set(x, 0.03, z); group.add(glow);
  }

  function addMovingPlatform(z, amplitude, phaseOffset, speed) {
    const w = 4.4, d = 4.4;
    let visual = assets.getFitted('platform-hex', { x: w, z: d }, { groundAlign: false });
    if (!visual) visual = roundedBox(w, 1.0, d, C.platform, { radius: 0.45, emissive: 0x2a1150 });
    visual.position.set(0, -0.5, z);
    group.add(visual);
    const glow = rimGlow(w, d, 0xd8b4fe, 0.06);
    group.add(glow);

    const body = kinematic(0, -0.5, z, RAPIER.ColliderDesc.cuboid(w / 2, 0.5, d / 2).setFriction(0.85));
    animated.push((t) => {
      const x = Math.sin(t * speed * Math.PI + phaseOffset) * amplitude;
      body.setNextKinematicTranslation({ x, y: -0.5, z });
      visual.position.x = x;
      glow.position.set(x, 0.06, z);
    });
  }

  /** Décor purement visuel, hors piste : donne de la profondeur et un sens de la vitesse. */
  /**
   * Décor hors piste. Sans contour et sans ombre portée : c'est de la profondeur,
   * pas du gameplay. Un arbre tous les 16 m suffit à donner la sensation de vitesse ;
   * en mettre quatre fois plus quadruplait le coût pour un gain visuel nul.
   */
  function dressScenery() {
    const spots = [];
    for (let z = 0; z > -122; z -= 16) {
      spots.push([-13.5 - ((z * 0.31) % 3), z]);
      spots.push([13.5 + ((z * 0.17) % 4), z - 8]);
    }
    spots.forEach(([x, z], i) => {
      const tree = assets.get('tree-candy', 4.2 + (i % 3) * 0.9, { outline: 0 });
      if (!tree) return;
      tree.position.set(x, -1.2, z);
      tree.rotation.y = i * 1.3;
      tree.traverse((c) => { if (c.isMesh) c.castShadow = false; });
      group.add(tree);
    });
    for (const [x, z, ry] of [[-19, -30, 0.5], [19, -62, -0.5], [-19, -100, 0.6]]) {
      const stand = assets.get('grandstand', 13, { outline: 0 });
      if (!stand) continue;
      stand.position.set(x, -1.5, z);
      stand.rotation.y = ry * Math.PI;
      stand.traverse((c) => { if (c.isMesh) c.castShadow = false; });
      group.add(stand);
    }
  }

  return {
    world, group, spawn, finishZ, killY: -9, checkpoints,
    update: (elapsed) => { for (const fn of animated) fn(elapsed); },
    checkpointFor(z) {
      let best = checkpoints[0];
      for (const cp of checkpoints) if (z <= cp.z + 1) best = cp;
      return best;
    },
  };
}
