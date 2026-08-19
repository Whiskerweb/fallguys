import * as THREE from 'three';

/**
 * Effets visuels du parcours.
 *
 * Tout passe par des pools pré-alloués : créer et détruire des objets par frame produit
 * des à-coups de ramasse-miettes, exactement au moment où le jeu doit être fluide.
 * Chaque système expose emit() et update(dt) ; rien n'alloue après l'initialisation.
 */

/** Bouffées de poussière : course, atterrissage, impacts. */
export class PuffSystem {
  constructor(parent, { count = 90, color = 0xffffff } = {}) {
    this.pool = [];
    this.cursor = 0;
    const geo = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.pool.push({ mesh, life: 0, max: 1, vel: new THREE.Vector3(), spin: 0 });
    }
  }

  emit(pos, { count = 4, spread = 1.4, rise = 1.6, size = 0.26, life = 0.5 } = {}) {
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.pool.length;
      const a = (i / count) * Math.PI * 2 + Math.random();
      p.mesh.position.copy(pos);
      p.mesh.visible = true;
      p.mesh.scale.setScalar(size * (0.7 + Math.random() * 0.6));
      p.vel.set(Math.cos(a) * spread * (0.5 + Math.random()), rise * (0.6 + Math.random() * 0.7), Math.sin(a) * spread * (0.5 + Math.random()));
      p.spin = (Math.random() - 0.5) * 4;
      p.life = p.max = life * (0.8 + Math.random() * 0.4);
    }
  }

  /** Libere geometrie et materiaux : sans cela chaque course laisse 70 materiaux en VRAM. */
  dispose() {
    for (const p of this.pool) {
      p.mesh.removeFromParent();
      p.mesh.material.dispose();
    }
    this.pool[0]?.mesh.geometry.dispose();
    this.pool.length = 0;
  }

  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= 2.2 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.z += p.spin * dt;
      const t = p.life / p.max;
      p.mesh.material.opacity = Math.min(1, t * 1.8);
      p.mesh.scale.multiplyScalar(1 + dt * 1.5);
    }
  }
}

/**
 * Confettis qui tombent en continu autour du joueur.
 * Ils suivent la caméra plutôt que de couvrir les 152 mètres : cent confettis autour du
 * joueur donnent la même impression qu'un millier répartis sur toute la piste, pour un
 * centième du coût.
 */
export class ConfettiField {
  constructor(parent, { count = 110, radius = 26, height = 22 } = {}) {
    this.radius = radius;
    this.height = height;
    this.items = [];
    const geo = new THREE.PlaneGeometry(0.16, 0.28);
    const colors = [0xff2d8f, 0x2dd9d9, 0xffe14d, 0xb072ff, 0x6ee86e, 0xff8a3d, 0xffffff];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], side: THREE.DoubleSide,
      }));
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.items.push({
        mesh,
        fall: 1.6 + Math.random() * 2.2,
        spinX: (Math.random() - 0.5) * 5,
        spinZ: (Math.random() - 0.5) * 5,
        sway: Math.random() * Math.PI * 2,
        offset: new THREE.Vector3(
          (Math.random() - 0.5) * radius * 2,
          Math.random() * height,
          (Math.random() - 0.5) * radius * 2
        ),
      });
    }
  }

  update(dt, elapsed, center) {
    for (const c of this.items) {
      c.offset.y -= c.fall * dt;
      if (c.offset.y < -4) {
        c.offset.y = this.height;
        c.offset.x = (Math.random() - 0.5) * this.radius * 2;
        c.offset.z = (Math.random() - 0.5) * this.radius * 2;
      }
      c.mesh.position.set(
        center.x + c.offset.x + Math.sin(elapsed * 0.8 + c.sway) * 0.6,
        center.y + c.offset.y,
        center.z + c.offset.z
      );
      c.mesh.rotation.x += c.spinX * dt;
      c.mesh.rotation.z += c.spinZ * dt;
    }
  }
}

/**
 * Canon à fumée : bouffées roses expulsées en rythme, comme les canons à barbe à papa
 * des références. Cycle FIXE — un décor animé au hasard ne serait pas reproductible,
 * et le spec interdit tout aléatoire qui touche au déroulé d'une partie.
 */
export class SmokeCannon {
  constructor(parent, position, direction, { period = 3.2, phase = 0, color = 0xffb3d9 } = {}) {
    this.position = position.clone();
    this.direction = direction.clone().normalize();
    this.period = period;
    this.phase = phase;
    this.lastFire = -999;
    this.puffs = [];
    const geo = new THREE.SphereGeometry(1, 9, 7);
    for (let i = 0; i < 26; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.puffs.push({ mesh, life: 0, max: 1, vel: new THREE.Vector3() });
    }
    this.cursor = 0;
  }

  fire() {
    for (let i = 0; i < 7; i++) {
      const p = this.puffs[this.cursor];
      this.cursor = (this.cursor + 1) % this.puffs.length;
      p.mesh.position.copy(this.position);
      p.mesh.visible = true;
      p.mesh.scale.setScalar(0.34 + Math.random() * 0.22);
      p.vel.copy(this.direction).multiplyScalar(4 + Math.random() * 3);
      p.vel.x += (Math.random() - 0.5) * 1.6;
      p.vel.z += (Math.random() - 0.5) * 1.6;
      p.life = p.max = 0.9 + Math.random() * 0.4;
    }
  }

  update(dt, elapsed) {
    const t = (elapsed + this.phase) % this.period;
    if (t < this.lastFire) this.fire();
    this.lastFire = t;
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.multiplyScalar(1 - dt * 0.9);
      p.vel.y += 0.6 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      p.mesh.material.opacity = Math.min(0.7, k * 1.2);
      p.mesh.scale.multiplyScalar(1 + dt * 0.85);
    }
  }
}

/** Éclats d'étoiles à l'impact : ponctue une culbute au lieu de la laisser passer inaperçue. */
export class SparkBurst {
  constructor(parent, { count = 40 } = {}) {
    this.pool = [];
    this.cursor = 0;
    const geo = new THREE.TetrahedronGeometry(0.16, 0);
    const colors = [0xffe14d, 0xffffff, 0xff8a3d];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], transparent: true,
      }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.pool.push({ mesh, life: 0, max: 1, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
  }

  emit(pos, strength = 1) {
    for (let i = 0; i < 12; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.pool.length;
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 0.9;
      p.mesh.position.copy(pos);
      p.mesh.visible = true;
      p.mesh.scale.setScalar(0.8 + Math.random() * 0.7);
      p.vel.set(Math.cos(a) * 4 * strength, up * 6 * strength, Math.sin(a) * 4 * strength);
      p.spin.set(Math.random() * 9, Math.random() * 9, Math.random() * 9);
      p.life = p.max = 0.55 + Math.random() * 0.3;
    }
  }

  dispose() {
    for (const p of this.pool) {
      p.mesh.removeFromParent();
      p.mesh.material.dispose();
    }
    this.pool[0]?.mesh.geometry.dispose();
    this.pool.length = 0;
  }

  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      p.mesh.material.opacity = Math.min(1, (p.life / p.max) * 2);
    }
  }
}
