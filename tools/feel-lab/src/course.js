import * as THREE from 'three';
import { toonMaterial, addOutline } from './world.js';

/**
 * La Course — mini-jeu 1 du spec.
 * CONTRAINTE LÉGALE : tous les obstacles tournent sur des cycles temporels FIXES,
 * démarrés au même instant pour tous. Aucun aléatoire ne décide du gagnant :
 * mémoriser un rythme est un apprentissage, donc du skill démontrable.
 */

const C = {
  floor: 0xf5a3c7,
  floorAlt: 0xffd2e6,
  rail: 0x7b4bd1,
  hazard: 0xffc93c,
  hazardAlt: 0xff8a3d,
  roller: 0x4fd1c5,
  platform: 0xa78bfa,
  finish: 0x4ade80,
};

export class Course {
  constructor(RAPIER, world, scene) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.animated = [];
    this.checkpoints = [];
    this.spawn = new THREE.Vector3(0, 2.2, 4);
    this.finishZ = -118;
    this.killY = -9;
    this.build();
  }

  box(px, py, pz, sx, sy, sz, color, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), toonMaterial(color));
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (opts.outline !== false) addOutline(mesh, opts.outline ?? 0.02, 0x2a1b45);
    this.scene.add(mesh);

    const RAPIER = this.RAPIER;
    let desc;
    if (opts.kinematic) desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(px, py, pz);
    else desc = RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz);
    const body = this.world.createRigidBody(desc);

    let col = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setFriction(opts.friction ?? 0.6);
    if (opts.colliderOffset) col = col.setTranslation(...opts.colliderOffset);
    this.world.createCollider(col, body);

    return { mesh, body };
  }

  cylinder(px, py, pz, radius, length, color) {
    const geo = new THREE.CylinderGeometry(radius, radius, length, 18);
    geo.rotateZ(Math.PI / 2); // axe le long de X
    const mesh = new THREE.Mesh(geo, toonMaterial(color));
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    this.scene.add(mesh);

    const RAPIER = this.RAPIER;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(px, py, pz)
    );
    const col = RAPIER.ColliderDesc.cylinder(length / 2, radius)
      .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)))
      .setFriction(0.4);
    this.world.createCollider(col, body);
    return { mesh, body };
  }

  /** Sol + garde-corps d'un segment de piste. */
  segment(zStart, zEnd, width, y = 0, color = C.floor) {
    const len = Math.abs(zEnd - zStart);
    const zc = (zStart + zEnd) / 2;
    this.box(0, y - 0.5, zc, width, 1, len, color, { outline: 0.01 });
    for (const sx of [-1, 1]) {
      this.box(sx * (width / 2 + 0.3), y + 0.35, zc, 0.6, 1.7, len, C.rail, { outline: 0.012 });
    }
  }

  build() {
    // --- Départ : large, ligne de départ symétrique (la position latérale n'a aucune valeur) ---
    this.segment(8, -16, 14);
    this.checkpoints.push(new THREE.Vector3(0, 2.2, 4));

    const startBanner = this.box(0, 3.4, 6, 15, 0.5, 0.4, C.finish, { outline: 0.02 });
    startBanner.mesh.material.emissive = new THREE.Color(0x1a5c2e);

    // --- Zone 1 : bras rotatifs, cycles fixes de 4 s ---
    this.segment(-16, -38, 12);
    this.checkpoints.push(new THREE.Vector3(0, 2.2, -17));
    this.addSpinner(0, 0.95, -23, 11, 1.0, 0);
    this.addSpinner(0, 0.95, -33, 11, -1.25, Math.PI / 2);

    // --- Zone 2 : pendules, déphasés pour créer un rythme lisible ---
    this.segment(-38, -58, 10);
    this.checkpoints.push(new THREE.Vector3(0, 2.2, -39));
    this.addPendulum(0, 6.2, -43, 0);
    this.addPendulum(0, 6.2, -49, Math.PI * 0.6);
    this.addPendulum(0, 6.2, -55, Math.PI * 1.2);

    // --- Zone 3 : rouleaux qui balaient latéralement ---
    this.segment(-58, -74, 10);
    this.checkpoints.push(new THREE.Vector3(0, 2.2, -59));
    this.addRoller(0, 0.75, -63, 3.4);
    this.addRoller(0, 0.75, -67, -3.4);
    this.addRoller(0, 0.75, -71, 3.4);

    // --- Zone 4 : plateformes mobiles au-dessus du vide ---
    this.checkpoints.push(new THREE.Vector3(0, 2.2, -75));
    this.box(0, -0.5, -76, 9, 1, 5, C.floorAlt, { outline: 0.012 });
    this.addMovingPlatform(-79, 5.5, 2.2, 0.45);
    this.box(0, -0.5, -84, 6, 1, 3.4, C.floorAlt, { outline: 0.012 });
    this.addMovingPlatform(-88, 5.5, -2.2, 0.62);
    this.box(0, -0.5, -93, 9, 1, 5, C.floorAlt, { outline: 0.012 });

    // --- Zone 5 : rampe puis dernier bras ---
    this.checkpoints.push(new THREE.Vector3(0, 2.2, -94));
    this.segment(-96, -120, 11);
    this.addSpinner(0, 0.95, -104, 10, 1.6, 0);
    this.addSpinner(0, 2.35, -112, 9, -2.1, Math.PI / 3);

    // --- Portique d'arrivée ---
    for (const sx of [-1, 1]) this.box(sx * 5.2, 2.2, this.finishZ, 0.8, 5.4, 0.8, C.finish);
    const banner = this.box(0, 4.6, this.finishZ, 11.2, 1.5, 0.5, C.finish);
    banner.mesh.material.emissive = new THREE.Color(0x1f7a3d);
  }

  addSpinner(x, y, z, length, speed, phase) {
    const arm = this.box(x, y, z, length, 0.85, 0.85, C.hazard, { kinematic: true });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.9, 14), toonMaterial(C.rail));
    hub.position.set(x, y - 0.2, z);
    hub.castShadow = true;
    this.scene.add(hub);
    const q = new THREE.Quaternion();
    this.animated.push((t) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * speed + phase);
      arm.body.setNextKinematicRotation(q);
      arm.mesh.quaternion.copy(q);
    });
  }

  addPendulum(x, pivotY, z, phase) {
    const armLen = 4.6;
    // Le corps est au pivot, le collider pend en dessous : c'est ce décalage qui fait le balancier.
    const bob = this.box(x, pivotY, z, 2.6, 1.5, 2.6, C.hazardAlt, {
      kinematic: true,
      colliderOffset: [0, -armLen, 0],
    });
    bob.mesh.geometry.translate(0, -armLen, 0);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, armLen, 8), toonMaterial(0x3d2d5c));
    rope.position.set(0, -armLen / 2, 0);
    bob.mesh.add(rope);
    const q = new THREE.Quaternion();
    this.animated.push((t) => {
      const angle = Math.sin(t * 1.15 + phase) * 0.95;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      bob.body.setNextKinematicRotation(q);
      bob.mesh.quaternion.copy(q);
    });
  }

  addRoller(x, y, z, speed) {
    const roller = this.cylinder(x, y, z, 0.75, 9.5, C.roller);
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3(1, 0, 0);
    this.animated.push((t) => {
      q.setFromAxisAngle(axis, t * speed);
      roller.body.setNextKinematicRotation(q);
      roller.mesh.quaternion.copy(q);
    });
  }

  addMovingPlatform(z, amplitude, phaseOffset, speed) {
    const plat = this.box(0, -0.5, z, 4.2, 1, 4.2, C.platform, { kinematic: true });
    this.animated.push((t) => {
      const x = Math.sin(t * speed * Math.PI + phaseOffset) * amplitude;
      plat.body.setNextKinematicTranslation({ x, y: -0.5, z });
      plat.mesh.position.x = x;
    });
  }

  update(elapsed) {
    for (const fn of this.animated) fn(elapsed);
  }

  /** Dernier checkpoint franchi, pour le respawn après une chute. */
  checkpointFor(z) {
    let best = this.checkpoints[0];
    for (const cp of this.checkpoints) if (z <= cp.z + 1) best = cp;
    return best;
  }
}
