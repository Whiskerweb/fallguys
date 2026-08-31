import * as THREE from 'three';
import { TUNING } from './tuning.js';
import { toonMaterial, addOutline } from './world.js';
import { assets } from './assets.js';
import { cosmetics, MODELS } from './cosmetics.js';
import { sfx } from './audio.js';
import { PuffSystem, SparkBurst } from './effects.js';
import { createRiggedCharacter } from './rig.js';

const RADIUS = 0.45;
const HALF_HEIGHT = 0.35;          // hauteur totale = 2*HALF_HEIGHT + 2*RADIUS = 1.6 m
const FOOT = HALF_HEIGHT + RADIUS;
/**
 * Plafonds du garde-fou de vitesse (voir `limiterVitesse`). Dérivés du réglage, pas
 * choisis à l'œil : 2,2 fois la vitesse de course laisse passer le plongeon (11,5 m/s) et
 * tout élan pris sur une surface qui défile, mais coupe net les expulsions du solveur.
 */
const MAX_HORIZ = TUNING.maxSpeed * 2.2;
const MAX_MONTEE = 18;
const MAX_CHUTE = 55;
const MAX_ROT = 14;
/** Frottement du collider en adherence normale. Sert aussi de base a la glisse. */
const FRICTION = 0.25;

export const State = { Grounded: 'grounded', Airborne: 'airborne', Diving: 'diving', Tumbling: 'tumbling', GettingUp: 'gettingUp' };

/** Bouffée de poussière à l'atterrissage — bon marché, et ça vend beaucoup l'impact. */
class Dust {
  constructor(parent) {
    this.parent = parent;
    this.pool = [];
    const geo = new THREE.SphereGeometry(0.17, 7, 6);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      m.visible = false;
      parent.add(m);
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
      .setFriction(FRICTION)
      .setRestitution(0.0)
      .setDensity(1.4);
    this.collider = world.createCollider(colDesc, this.body);

    // --- Visuel ---
    // Tout vit sous un conteneur unique : changer de scene revient a le detacher.
    this.container = new THREE.Group();
    scene.add(this.container);
    this.root = new THREE.Group();
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    this.container.add(this.root);

    // Tache d'ombre sous les pieds : une ombre portee douce ne suffit pas a ancrer un
    // personnage au sol, et sans ancrage il a l'air de flotter.
    this.contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(RADIUS * 1.25, 20),
      new THREE.MeshBasicMaterial({ color: 0x1a2b45, transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.container.add(this.contactShadow);
    this.lastGroundY = spawn.y - FOOT;

    // Le personnage rigge est prefere : c'est le seul qui puisse etre anime.
    // Le blob statique reste en repli, et la capsule en dernier recours.
    const HEIGHT = HALF_HEIGHT * 2 + RADIUS * 2;
    // Modèle choisi dans la garde-robe. Le riggé passe par la fabrique (mise à
    // l'échelle depuis les os) ; un modèle sans squelette est simplement ajusté à la
    // hauteur de la capsule et animé par le corps entier.
    const wanted = cosmetics.model;
    // La fabrique doit recevoir le NOM du modele choisi. Elle n'etait appelee que pour
    // 'player-rigged' : tous les autres personnages tombaient dans le repli, qui mesure
    // avec une boite englobante — fausse sur un maillage anime — d'ou des tailles
    // aberrantes, et qui ne construit aucun squelette, d'ou l'absence d'animation.
    const meta = MODELS.find((m) => m.id === wanted);
    const rigged = meta?.rigged !== false ? createRiggedCharacter(assets, HEIGHT, wanted) : null;
    let model = null;
    if (rigged) {
      model = rigged.model;
      this.rig = rigged.rig;
      model.position.y -= FOOT;          // pieds au bas de la capsule
    } else {
      model = assets.getFitted(wanted, { y: HEIGHT }, { groundAlign: true, outline: 0.03 })
           ?? assets.getFitted('player-blob', { y: HEIGHT }, { groundAlign: true, outline: 0.02 });
      if (model) model.position.y -= FOOT;
    }
    this.pupils = [];
    if (model) {
      // Aucune teinte appliquee : les personnages sont fixes et portent leur propre
      // texture. Repeindre un skin de collaboration trahirait la marque du partenaire.
      this.visual.add(model);
      this.bodyMesh = model;
    } else {
      const bodyMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(RADIUS, HALF_HEIGHT * 2, 6, 20),
        toonMaterial(cosmetics.hex)
      );
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      addOutline(bodyMesh, 0.06);
      this.visual.add(bodyMesh);
      this.bodyMesh = bodyMesh;

      // L'avant du personnage est +Z local (yaw = 0 donne la direction (0,0,1)).
      this.eyes = new THREE.Group();
      const whiteGeo = new THREE.SphereGeometry(0.155, 14, 12);
      const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const pupilGeo = new THREE.SphereGeometry(0.075, 10, 8);
      const pupilMat = new THREE.MeshBasicMaterial({ color: 0x14203a });
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(whiteGeo, white);
        e.position.set(sx * 0.185, 0.30, RADIUS * 0.86);
        const p = new THREE.Mesh(pupilGeo, pupilMat);
        p.position.set(0, 0, 0.098);
        e.add(p);
        this.pupils.push(p);
        this.eyes.add(e);
      }
      this.visual.add(this.eyes);
    }

    this.dust = new Dust(this.container);
    // Poussiere de course et eclats d'impact : dans les references, un personnage qui
    // court souleve en permanence de petits nuages. C'est ce qui donne le poids.
    this.puffs = new PuffSystem(this.container, { count: 70 });
    this.sparks = new SparkBurst(this.container, { count: 40 });
    this.stepAccum = 0;

    // --- État ---
    this.state = State.Airborne;
    this.yaw = 0;
    this.squash = 1;
    this.squashVel = 0;
    this.coyote = 0;
    this.bufferedJump = 0;
    /** Fatigue de saut, 0 (frais) a 1 (epuise). Voir TUNING.jumpFatigue. */
    this.fatigue = 0;
    this.stateTimer = 0;
    this.grounded = false;
    this.wasGrounded = false;
    this.runCycle = 0;
    this._down = new THREE.Vector3(0, -1, 0);
    this._tmp = new THREE.Vector3();
  }

  /** Detache le personnage de la scene : appele au changement de monde physique. */
  dispose() {
    this.container.removeFromParent();
    // Retirer le corps du monde physique. Sans ca, changer de modele en course cree une
    // seconde capsule a la meme position que la premiere, toujours presente : les deux
    // s'interpenetrent et le personnage est ejecte. Et chaque course laissait un corps
    // fantome qui tombait indefiniment en alourdissant chaque pas de simulation.
    this.world.removeRigidBody(this.body);
    this.dust.dispose();
    this.puffs.dispose();
    this.sparks.dispose();
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
    // Une teleportation produit une variation de vitesse enorme : on oublie l'historique,
    // sinon le respawn declencherait immediatement une culbute.
    this.prevVx = undefined;
    this.landGrace = 0;
    this.prevVz = undefined;
    // Adherence de la surface sous les pieds, renseignee par la scene a chaque image.
    this.glisse = 0;
    this._glisseAppliquee = 0;
    // Vitesse de la surface sous les pieds ({vx, vz}), ou null si elle est immobile.
    this.surface = null;
    // Un joueur remis en jeu repart FRAIS. Le contraire punirait la chute deux fois : par
    // le temps perdu, puis par un premier saut mou dont il ne comprendrait pas la cause.
    this.fatigue = 0;
  }

  /**
   * Y a-t-il un sol sous les pieds ?
   *
   * Le rayon part du centre de la capsule et descend. Sa portée etait FIXE, ce qui revient
   * a supposer un sol HORIZONTAL : sur une surface inclinee, la chute verticale du centre
   * jusqu'a la paroi grandit avec la pente, et le rayon finit par ne plus l'atteindre.
   * Mesure sur le rondin : passe 33 degres d'inclinaison, le personnage etait declare en
   * l'air alors qu'il avait les pieds sur le tronc — il ne pouvait plus sauter et passait
   * en acceleration aerienne. La bande jouable d'un tronc de 5,5 m s'en trouvait bridee a
   * 20 degres, pour une raison qui n'avait rien a voir avec le terrain.
   *
   * On tire donc plus loin, puis on ramene la distance a la NORMALE de la surface. Sur un
   * sol horizontal la normale est verticale, le facteur vaut 1, et la regle est exactement
   * celle d'avant : les autres epreuves ne changent pas d'un pouce.
   */
  checkGround() {
    const t = this.body.translation();
    const ray = new this.RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(
      ray, FOOT + 0.9, true, undefined, undefined, this.collider);
    if (!hit) return false;
    // Composante verticale de la normale = cosinus de l'inclinaison. Une paroi presque
    // verticale n'est pas un sol : on ne s'y tient pas, on la longe.
    const cos = Math.abs(hit.normal.y);
    if (cos < 0.30) return false;
    return hit.timeOfImpact * cos <= FOOT + 0.18;
  }

  /**
   * La glisse doit passer par le CONTACT, pas seulement par le controleur.
   *
   * Reduire la seule acceleration ne suffisait pas : le frottement du collider s'oppose
   * a la vitesse qu'on impose, et avec 31 m/s2 de gravite il pese a lui seul 13 m/s2 de
   * freinage — davantage que l'acceleration deja divisee d'une patinoire. Resultat, la
   * glace ne rendait pas glissant, elle rendait IMMOBILE : touche enfoncee, le
   * personnage ne demarrait pas du tout.
   *
   * On bascule donc aussi le contact. Regle Min des qu'il y a de la glisse — la surface
   * la plus lisse l'emporte, ce qui est le comportement attendu d'une plaque de glace.
   * En adherence normale on revient a la moyenne, pour ne rien changer au reglage
   * historique du personnage sur tout le reste du parcours.
   */
  appliquerGlisse() {
    if (this.glisse === this._glisseAppliquee) return;
    this._glisseAppliquee = this.glisse;
    const R = this.RAPIER.CoefficientCombineRule;
    this.collider.setFrictionCombineRule(this.glisse > 0.01 ? R.Min : R.Average);
    this.collider.setFriction(FRICTION * (1 - this.glisse));
  }

  bump(amount) {
    this.squashVel += amount;
  }

  /**
   * Garde-fou de vitesse, appliqué APRÈS chaque pas de simulation.
   *
   * Un corps cinématique qui recouvre un corps dynamique est séparé par le solveur en une
   * seule image, et la vitesse d'expulsion est proportionnelle à la profondeur du
   * recouvrement — elle n'a aucune borne. En pratique le joueur qui touchait un baril ou
   * se coinçait contre une arête partait à plusieurs dizaines de mètres par seconde,
   * franchissait le décor et atterrissait après la ligne d'arrivée. C'est le pire bug
   * qu'on ait eu : il ne casse pas la manche, il la GAGNE.
   *
   * On traite les causes ailleurs — les colliders des barils ne tournent plus, ils
   * apparaissent hors de la zone jouable — mais aucune de ces corrections ne peut prouver
   * qu'il ne reste pas un cas. Ce plafond, lui, le prouve : il porte sur la vitesse
   * elle-même, donc il vaut quelle que soit la géométrie qui l'a produite.
   *
   * Les plafonds sont assez hauts pour ne jamais gêner un jeu normal — 2,2 fois la vitesse
   * de course à plat, et de quoi encaisser une longue chute. Un plafond serré aurait bridé
   * le plongeon et les fins de descente.
   */
  limiterVitesse() {
    const v = this.body.linvel();
    const plat = Math.hypot(v.x, v.z);
    let vx = v.x, vy = v.y, vz = v.z, corrige = false;
    if (plat > MAX_HORIZ) {
      const k = MAX_HORIZ / plat;
      vx *= k; vz *= k; corrige = true;
    }
    if (vy > MAX_MONTEE) { vy = MAX_MONTEE; corrige = true; }
    if (vy < -MAX_CHUTE) { vy = -MAX_CHUTE; corrige = true; }
    if (corrige) this.body.setLinvel({ x: vx, y: vy, z: vz }, true);

    // Une expulsion violente met aussi le corps en rotation folle : la culbute qui suit ne
    // se termine plus, parce que le personnage n'arrive jamais à se relever.
    const w = this.body.angvel();
    const norme = Math.hypot(w.x, w.y, w.z);
    if (norme > MAX_ROT) {
      const k = MAX_ROT / norme;
      this.body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
    }
    return corrige;
  }

  update(dt, input, camYaw) {
    const T = TUNING;
    const v = this.body.linvel();
    const vx0 = v.x, vz0 = v.z;   // vitesse AVANT nos corrections, pour mesurer la secousse
    this.wasGrounded = this.grounded;
    this.grounded = this.checkGround();
    this.appliquerGlisse();

    const speedH = Math.hypot(v.x, v.z);
    const controllable = this.state === State.Grounded || this.state === State.Airborne;

    /**
     * REPERE DE SURFACE.
     *
     * Au sol, la reference n'est pas le monde mais ce qu'on a sous les pieds. Sur un
     * rondin qui tourne, rester immobile PAR RAPPORT AU RONDIN n'est pas avoir une
     * vitesse nulle dans le monde. Sans cette correction, le freinage au sol ramenerait
     * le personnage vers le zero du monde : la surface se contenterait de defiler sous
     * lui, et la rotation ne se sentirait pas — elle ne ferait que gener.
     *
     * En l'air, la reference redevient le monde : on garde l'elan pris sur la surface.
     * C'est ce qui rend un saut depuis un rondin qui tourne satisfaisant plutot que
     * frustrant, et c'est aussi la seule facon de franchir un trou en travers.
     *
     * Renseigne par la scene a chaque image (`surfaceAt`), exactement comme la glisse :
     * c'est la SURFACE qui decide, pas le personnage.
     */
    const sx = this.grounded && this.surface ? this.surface.vx : 0;
    const sz = this.grounded && this.surface ? this.surface.vz : 0;

    // --- Détection de culbute : un obstacle vient de nous expédier ---
    /**
     * Detection de culbute par CHANGEMENT BRUTAL de vitesse.
     *
     * L'ancienne regle testait une vitesse absolue superieure a 1,55 fois la vitesse de
     * course. Mesure faite : aucun obstacle du jeu ne projette aussi fort — le joueur
     * plafonnait a 7,6 m/s pour un seuil a 11,8, et ne culbutait donc JAMAIS.
     * Un impact ne se reconnait pas a une vitesse elevee mais a une variation soudaine :
     * se faire faucher inverse ou devie brutalement la trajectoire, meme sans gain de
     * vitesse. On compare donc la vitesse a celle du pas precedent.
     */
    // Un atterrissage est lui aussi une secousse : au contact, le solveur corrige d'un
    // coup la vitesse horizontale, ce qui depassait le seuil. Resultat mesure : TOUT
    // saut se terminait en culbute. On neutralise donc la detection le temps que le
    // contact se stabilise, et on repart d'un historique vierge.
    if (this.grounded && !this.wasGrounded) {
      this.landGrace = 0.18;
      this.prevVx = undefined;
    }
    if (this.landGrace > 0) this.landGrace -= dt;

    if (this.prevVx !== undefined && controllable && this.landGrace <= 0) {
      // Mesuree dans le repere de surface : poser le pied sur un rondin qui defile a
      // 1,4 m/s produit sinon un saut de vitesse qui ressemble a un impact, et chaque
      // atterrissage finirait en culbute.
      const dvx = (vx0 - sx) - this.prevVx, dvz = (vz0 - sz) - this.prevVz;
      const jolt = Math.hypot(dvx, dvz);
      // La secousse doit venir de l'exterieur : on soustrait ce que le joueur pouvait
      // produire lui-meme en un pas, sinon un simple demi-tour declencherait la culbute.
      const selfMax = T.groundAccel * dt * 1.35;
      if (jolt > Math.max(T.tumbleJolt, selfMax)) this.enterTumble();
    }
    this.prevVx = vx0 - sx;
    this.prevVz = vz0 - sz;

    // --- Atterrissage ---
    if (this.grounded && !this.wasGrounded) {
      const impact = Math.min(1.6, Math.abs(v.y) / 12);
      this.squash = Math.min(this.squash, T.squashOnLand + (1 - T.squashOnLand) * (1 - impact));
      this.squashVel -= impact * 5;
      this.dust.burst(this.position.clone().setY(this.position.y - FOOT), 0.5 + impact);
      sfx.land(0.4 + impact);
      this.puffs.emit(this.position.clone().setY(this.position.y - FOOT),
        { count: 6, spread: 2.2, rise: 1.4, size: 0.3, life: 0.55 });
      if (this.state === State.Airborne) this.state = State.Grounded;
    }
    if (!this.grounded && this.state === State.Grounded) this.state = State.Airborne;

    // --- Coyote time et buffer de saut ---
    this.coyote = this.grounded ? T.coyoteTime : Math.max(0, this.coyote - dt);
    this.bufferedJump = input.jump ? T.jumpBuffer : Math.max(0, this.bufferedJump - dt);
    // La fatigue ne se dissipe qu'AU SOL : voir TUNING.jumpRecovery.
    if (this.grounded) this.fatigue = Math.max(0, this.fatigue - dt / T.jumpRecovery);

    let vx = v.x, vy = v.y, vz = v.z;

    if (controllable) {
      // Direction voulue, exprimée dans le repère de la caméra
      const cos = Math.cos(camYaw), sin = Math.sin(camYaw);
      const wishX = input.x * cos - input.z * sin;
      const wishZ = input.x * sin + input.z * cos;
      const wishLen = Math.hypot(wishX, wishZ);

      /**
       * GLISSE. 0 = adherence normale, 1 = patinoire.
       *
       * Elle divise l'acceleration au sol ET le freinage, jamais la vitesse maximale :
       * sur la glace on met du temps a se lancer, et bien plus a s'arreter, mais on
       * finit par aller aussi vite qu'ailleurs. Baisser la vitesse maximale aurait
       * donne une zone lente, pas une zone glissante — et le joueur aurait subi la
       * difference sans jamais la reconnaitre.
       *
       * Reglee par la scene a chaque image (voir `glisseAt` du parcours) : c'est la
       * SURFACE qui decide, pas le personnage.
       */
      const prise = this.grounded ? 1 - this.glisse * 0.84 : 1;
      const accel = (this.grounded ? T.groundAccel : T.airAccel) * prise;
      if (wishLen > 0.01) {
        const nx = wishX / wishLen, nz = wishZ / wishLen;
        const targetX = sx + nx * T.maxSpeed, targetZ = sz + nz * T.maxSpeed;
        vx += Math.max(-accel * dt, Math.min(accel * dt, targetX - vx));
        vz += Math.max(-accel * dt, Math.min(accel * dt, targetZ - vz));
        this.yaw = this.approachAngle(this.yaw, Math.atan2(nx, nz), T.turnSpeed * dt);
      } else if (this.grounded) {
        const drop = T.groundFriction * dt * (1 - this.glisse * 0.94);
        // On freine vers la vitesse de la SURFACE, pas vers celle du monde.
        const rx = vx - sx, rz = vz - sz;
        const sp = Math.hypot(rx, rz);
        if (sp <= drop) { vx = sx; vz = sz; }
        else { const k = (sp - drop) / sp; vx = sx + rx * k; vz = sz + rz * k; }
      }

      // Saut
      if (this.bufferedJump > 0 && this.coyote > 0) {
        /*
         * La fatigue COURANTE decide de ce saut-ci ; le cout ne s'ajoute qu'apres. Le
         * premier saut est donc toujours plein, et c'est ce qui rend la mecanique lisible :
         * ce n'est jamais le saut qu'on demande qui est ampute, c'est le suivant.
         */
        const puissance = 1 - this.fatigue * (1 - T.jumpFatigueFloor);
        vy = Math.sqrt(2 * T.gravity * T.jumpHeight * puissance);
        this.fatigue = Math.min(1, this.fatigue + T.jumpFatigue);
        this.coyote = 0;
        this.bufferedJump = 0;
        /*
         * L'ETIREMENT ET LA POUSSIERE SUIVENT LA PUISSANCE.
         *
         * Une mecanique qui change la portee sans rien montrer est inacceptable dans un
         * jeu ou l'on mise : le joueur raterait un saut sans jamais savoir pourquoi. Un
         * saut fatigue s'etire donc moins et souleve moins de poussiere — le signal est
         * dans le geste, la ou le joueur regarde deja, et non dans une jauge a surveiller.
         */
        this.squash = 1 + (T.stretchOnJump - 1) * puissance;
        this.squashVel += 5 * puissance;
        this.state = State.Airborne;
        this.dust.burst(this.position.clone().setY(this.position.y - FOOT), 0.6 * puissance);
        sfx.jump();
      }

      // Plongeon
      if (input.dive) {
        vx = Math.sin(this.yaw) * T.diveForward;
        vz = Math.cos(this.yaw) * T.diveForward;
        vy = T.diveUp;
        this.enterState(State.Diving);
        sfx.dive();
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
    this.sparks.emit(this.position, 1.2);
    this.puffs.emit(this.position, { count: 8, spread: 2.6, rise: 2.2, size: 0.34, life: 0.7 });
    sfx.tumble();
  }

  updateStateTimers(dt, speedH) {
    this.stateTimer += dt;
    const T = TUNING;
    if (this.state === State.Diving && this.stateTimer > T.diveRecovery && this.grounded) {
      this.beginGetUp();
    } else if (this.state === State.Tumbling && this.stateTimer > T.tumbleRecovery && this.grounded
               && (speedH < 3.5 || this.stateTimer > T.tumbleRecovery * 2)) {
      /*
       * On se releve TOUJOURS, meme si l'on glisse encore vite.
       *
       * La condition « vitesse inferieure a 3,5 m/s » vise le joueur qui vole encore
       * apres l'impact — il ne doit pas se relever en plein vol. Mais un obstacle qui
       * POUSSE en continu maintient cette vitesse indefiniment : mesure sur Block Dash,
       * un personnage cueilli par un portique a 4,4 m/s est reste couche six secondes,
       * bulldoze sur trente metres jusqu'a tomber du pont, sans jamais pouvoir agir.
       * Passe le double du delai de relevage, on se releve donc quoi qu'il arrive :
       * subir un obstacle doit couter du temps, jamais la main.
       */
      this.beginGetUp();
    } else if (this.state === State.GettingUp && this.stateTimer > T.getUpDuration) {
      this.state = this.grounded ? State.Grounded : State.Airborne;
      this.squash = 0.82;
      this.squashVel += 3;
    }
  }

  beginGetUp() {
    this.enterState(State.GettingUp);
    sfx.getUp();
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
      // Inclinaison avant proportionnelle a la vitesse, plus un roulis dans les virages :
      // un personnage qui tourne a plat parait glisser sur des rails.
      const lean = Math.min(0.4, (speedH / T.maxSpeed) * 0.38);
      let dYaw = this.yaw - (this.prevYaw ?? this.yaw);
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      this.bank = (this.bank ?? 0) + (Math.max(-0.45, Math.min(0.45, dYaw * 9)) - (this.bank ?? 0)) * Math.min(1, dt * 8);
      this.prevYaw = this.yaw;

      this.visual.rotation.set(0, 0, 0);
      this.visual.rotateY(this.yaw);
      this.visual.rotateX(lean);
      this.visual.rotateZ(-this.bank * (speedH / T.maxSpeed));
      // Sans squelette, un balancement du corps entier tient lieu de course.
      if (!this.rig && this.grounded && speedH > 0.6) {
        this.runCycle += dt * (5 + speedH * 1.5);
        this.visual.rotateZ(Math.sin(this.runCycle) * 0.11);
        this.root.position.y += Math.abs(Math.sin(this.runCycle)) * 0.045;
      }
    }

    // Une seule lecture de la vitesse : wasm-bindgen refuse les emprunts imbriques.
    const v = this.body.linvel();

    // Animation du squelette : la cadence suit la vitesse reelle du personnage.
    if (this.rig) {
      const bounce = this.rig.update(dt, speedH, TUNING.maxSpeed, this.state, v.y);
      if (!ragdoll) this.root.position.y += bounce;
    }

    // Les pupilles regardent dans la direction du mouvement
    const look = Math.min(0.05, Math.hypot(v.x, v.z) * 0.006);
    for (const p of this.pupils) p.position.set(0, -look * 0.4, 0.098 + look);

    // L'ombre reste au sol et s'estompe avec la hauteur de saut.
    if (this.grounded) this.lastGroundY = t.y - FOOT;
    const groundY = this.lastGroundY;
    this.contactShadow.position.set(t.x, groundY + 0.05, t.z);
    const airHeight = Math.max(0, t.y - FOOT - groundY);
    this.contactShadow.material.opacity = Math.max(0, 0.3 - airHeight * 0.05);
    this.contactShadow.scale.setScalar(1 + airHeight * 0.06);

    // Une bouffee tous les 1,4 m parcourus au sol : la cadence suit la vitesse reelle.
    if (this.grounded && speedH > 2) {
      this.stepAccum += speedH * dt;
      if (this.stepAccum > 1.4) {
        this.stepAccum = 0;
        this.puffs.emit(this.position.clone().setY(this.position.y - FOOT),
          { count: 2, spread: 0.7, rise: 0.8, size: 0.19, life: 0.42 });
      }
    }

    this.puffs.update(dt);
    this.sparks.update(dt);
    this.dust.update(dt);
  }
}
