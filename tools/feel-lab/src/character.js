import * as THREE from 'three';
import { TUNING } from './tuning.js';
import { toonMaterial, addOutline } from './world.js';

const RADIUS = 0.45;
const HALF_HEIGHT = 0.35;          // hauteur totale = 2*HALF_HEIGHT + 2*RADIUS = 1.6 m
const FOOT = HALF_HEIGHT + RADIUS;

export const State = { Grounded: 'grounded', Airborne: 'airborne', Diving: 'diving', Tumbling: 'tumbling', GettingUp: 'gettingUp' };

/** Bouffée de poussière à l'atterrissage — bon marché, et ça vend beaucoup l'impact. */
class Dust {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    const geo = new THREE.SphereGeometry(0.17, 7, 6);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      m.visible = false;
      scene.add(m);
      this.pool.push({ mesh: m, life: 0, vel: new THREE.Vector3() });
    }
    this.cursor = 0;
  }
  burst(pos, strength = 1) {
    const count = Math.min(14, Math.round(5 + strength * 9));
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.pool.length;
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      p.mesh.position.copy(pos);
      p.mesh.position.y += 0.08;
      p.mesh.visible = true;
      p.mesh.scale.setScalar(0.6 + Math.random() * 0.7 * strength);
      p.vel.set(Math.cos(a) * (2.2 + Math.random() * 2) * strength, 1.1 + Math.random() * 1.4, Math.sin(a) * (2.2 + Math.random() * 2) * strength);
      p.life = 0.42 + Math.random() * 0.2;
    }
  }
  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= 7 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.material.opacity = Math.max(0, p.life * 1.6);
      p.mesh.scale.multiplyScalar(1 + dt * 1.1);
    }
  }
}

export class Character {
  constructor(RAPIER, world, scene, spawn) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.spawn = spawn.clone();

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(0.05)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bodyDesc);
    this.body.setEnabledRotations(false, false, false, true);

    const colDesc = RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS)
      .setFriction(0.25)
      .setRestitution(0.0)
      .setDensity(1.4);
    this.collider = world.createCollider(colDesc, this.body);

    // --- Visuel ---
    this.root = new THREE.Group();
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    scene.add(this.root);

    const bodyMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(RADIUS, HALF_HEIGHT * 2, 6, 20),
      toonMaterial(0xff5f7e)
    );
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    addOutline(bodyMesh, 0.06);
    this.visual.add(bodyMesh);
    this.bodyMesh = bodyMesh;

    this.eyes = new THREE.Group();
    const whiteGeo = new THREE.SphereGeometry(0.155, 14, 12);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilGeo = new THREE.SphereGeometry(0.075, 10, 8);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x14203a });
    this.pupils = [];
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(whiteGeo, white);
      e.position.set(sx * 0.185, 0.30, -RADIUS * 0.86);
      const p = new THREE.Mesh(pupilGeo, pupilMat);
      p.position.set(0, 0, -0.098);
      e.add(p);
      this.pupils.push(p);
      this.eyes.add(e);
    }
    this.visual.add(this.eyes);

    this.dust = new Dust(scene);

    // --- État ---
    this.state = State.Airborne;
    this.yaw = 0;
    this.squash = 1;
    this.squashVel = 0;
    this.coyote = 0;
    this.bufferedJump = 0;
    this.stateTimer = 0;
    this.grounded = false;
    this.wasGrounded = false;
    this.runCycle = 0;
    this._down = new THREE.Vector3(0, -1, 0);
    this._tmp = new THREE.Vector3();
  }

  get position() {
    const t = this.body.translation();
    return this._tmp.set(t.x, t.y, t.z);
  }

  respawn(at) {
    this.body.setTranslation({ x: at.x, y: at.y, z: at.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setEnabledRotations(false, false, false, true);
    this.state = State.Airborne;
    this.stateTimer = 0;
    this.squash = 1;
    this.squashVel = 0;
  }

  checkGround() {
    const t = this.body.translation();
    const ray = new this.RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, FOOT + 0.18, true, undefined, undefined, this.collider);
    return hit !== null;
  }

  bump(amount) {
    this.squashVel += amount;
  }

  update(dt, input, camYaw) {
    const T = TUNING;
    const v = this.body.linvel();
    this.wasGrounded = this.grounded;
    this.grounded = this.checkGround();

    const speedH = Math.hypot(v.x, v.z);
    const controllable = this.state === State.Grounded || this.state === State.Airborne;

    // --- Détection de culbute : un obstacle vient de nous expédier ---
    if (controllable && speedH > T.maxSpeed * T.tumbleTrigger) {
      this.enterTumble();
    }

    // --- Atterrissage ---
    if (this.grounded && !this.wasGrounded) {
      const impact = Math.min(1.6, Math.abs(v.y) / 12);
      this.squash = Math.min(this.squash, T.squashOnLand + (1 - T.squashOnLand) * (1 - impact));
      this.squashVel -= impact * 5;
      this.dust.burst(this.position.clone().setY(this.position.y - FOOT), 0.5 + impact);
      if (this.state === State.Airborne) this.state = State.Grounded;
    }
    if (!this.grounded && this.state === State.Grounded) this.state = State.Airborne;

    // --- Coyote time et buffer de saut ---
    this.coyote = this.grounded ? T.coyoteTime : Math.max(0, this.coyote - dt);
    this.bufferedJump = input.jump ? T.jumpBuffer : Math.max(0, this.bufferedJump - dt);

    let vx = v.x, vy = v.y, vz = v.z;

    if (controllable) {
      // Direction voulue, exprimée dans le repère de la caméra
      const cos = Math.cos(camYaw), sin = Math.sin(camYaw);
      const wishX = input.x * cos - input.z * sin;
      const wishZ = input.x * sin + input.z * cos;
      const wishLen = Math.hypot(wishX, wishZ);

      const accel = this.grounded ? T.groundAccel : T.airAccel;
      if (wishLen > 0.01) {
        const nx = wishX / wishLen, nz = wishZ / wishLen;
        const targetX = nx * T.maxSpeed, targetZ = nz * T.maxSpeed;
        vx += Math.max(-accel * dt, Math.min(accel * dt, targetX - vx));
        vz += Math.max(-accel * dt, Math.min(accel * dt, targetZ - vz));
        this.yaw = this.approachAngle(this.yaw, Math.atan2(nx, nz), T.turnSpeed * dt);
      } else if (this.grounded) {
        const drop = T.groundFriction * dt;
        const sp = Math.hypot(vx, vz);
        if (sp <= drop) { vx = 0; vz = 0; }
        else { const k = (sp - drop) / sp; vx *= k; vz *= k; }
      }

      // Saut
      if (this.bufferedJump > 0 && this.coyote > 0) {
        vy = Math.sqrt(2 * T.gravity * T.jumpHeight);
        this.coyote = 0;
        this.bufferedJump = 0;
        this.squash = T.stretchOnJump;
        this.squashVel += 5;
        this.state = State.Airborne;
        this.dust.burst(this.position.clone().setY(this.position.y - FOOT), 0.6);
      }

      // Plongeon
      if (input.dive) {
        vx = Math.sin(this.yaw) * T.diveForward;
        vz = Math.cos(this.yaw) * T.diveForward;
        vy = T.diveUp;
        this.enterState(State.Diving);
        this.body.setEnabledRotations(true, true, true, true);
        this.body.setAngvel({ x: Math.cos(this.yaw) * 6, y: 0, z: -Math.sin(this.yaw) * 6 }, true);
      }
    }

    // Gravité renforcée à la descente : évite le saut lunaire
    if (vy < 0) vy -= T.gravity * (T.fallMultiplier - 1) * dt;

    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);

    this.updateStateTimers(dt, speedH);
    this.updateVisual(dt, speedH);
  }

  enterState(s) { this.state = s; this.stateTimer = 0; }

  enterTumble() {
    this.enterState(State.Tumbling);
    this.body.setEnabledRotations(true, true, true, true);
    const spin = 7 + Math.random() * 6;
    this.body.setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin }, true);
    this.squashVel -= 9;
    this.dust.burst(this.position, 1.2);
  }

  updateStateTimers(dt, speedH) {
    this.stateTimer += dt;
    const T = TUNING;
    if (this.state === State.Diving && this.stateTimer > T.diveRecovery && this.grounded) {
      this.beginGetUp();
    } else if (this.state === State.Tumbling && this.stateTimer > T.tumbleRecovery && this.grounded && speedH < 3.5) {
      this.beginGetUp();
    } else if (this.state === State.GettingUp && this.stateTimer > T.getUpDuration) {
      this.state = this.grounded ? State.Grounded : State.Airborne;
      this.squash = 0.82;
      this.squashVel += 3;
    }
  }

  beginGetUp() {
    this.enterState(State.GettingUp);
    this.body.setEnabledRotations(false, false, false, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  }

  approachAngle(current, target, maxDelta) {
    let d = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return current + Math.max(-maxDelta, Math.min(maxDelta, d));
  }

  updateVisual(dt, speedH) {
    const T = TUNING;
    const t = this.body.translation();
    this.root.position.set(t.x, t.y, t.z);

    // Ressort de squash & stretch, à volume conservé
    const accel = (1 - this.squash) * T.squashSpring - this.squashVel * T.squashDamping;
    this.squashVel += accel * dt;
    this.squash += this.squashVel * dt;
    this.squash = Math.max(0.45, Math.min(1.7, this.squash));
    const lateral = 1 / Math.sqrt(this.squash);
    this.visual.scale.set(lateral, this.squash, lateral);

    const ragdoll = this.state === State.Tumbling || this.state === State.Diving;
    if (ragdoll) {
      const r = this.body.rotation();
      this.visual.quaternion.set(r.x, r.y, r.z, r.w);
    } else {
      // Orientation + inclinaison avant proportionnelle à la vitesse : lit la course d'un coup d'œil
      const lean = Math.min(0.32, (speedH / T.maxSpeed) * 0.3);
      this.visual.rotation.set(0, 0, 0);
      this.visual.rotateY(this.yaw);
      this.visual.rotateX(lean);
      // Balancement de course
      if (this.grounded && speedH > 0.6) {
        this.runCycle += dt * (5 + speedH * 1.5);
        this.visual.rotateZ(Math.sin(this.runCycle) * 0.11);
        this.root.position.y += Math.abs(Math.sin(this.runCycle)) * 0.045;
      }
    }

    // Les pupilles regardent dans la direction du mouvement
    const v = this.body.linvel();
    const look = Math.min(0.05, Math.hypot(v.x, v.z) * 0.006);
    for (const p of this.pupils) p.position.set(0, -look * 0.4, -0.098 - look);

    this.dust.update(dt);
  }
}
