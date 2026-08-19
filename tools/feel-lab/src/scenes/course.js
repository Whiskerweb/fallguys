import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { toonMaterial, addOutline } from '../world.js';
import { ConfettiField, SmokeCannon } from '../effects.js';
import {
  roundedBox, pill, rimGlow, banner, inflatableArch, balloon, bollard, bunting,
  flagPole, pennant, updateFlags, slabMesh, stripedPeak,
} from '../props.js';
import {
  quiltedVinyl, softChecker, hazardStripes, polkaStagger, grassTufts, scales, inflatedBands,
  floorMarkings, dashPattern, mazePattern, swoosh,
} from '../textures.js';

/**
 * La Course — mini-jeu 1 du spec.
 *
 * CONTRAINTE LÉGALE : tous les obstacles suivent des cycles temporels FIXES, démarrés au
 * même instant pour tous. Aucun aléatoire ne décide du gagnant.
 *
 * RÈGLE D'ASSETS : Meshy sert au décor et au personnage, jamais aux obstacles. Un modèle
 * généré a une silhouette libre alors que son collider reste une primitive : le joueur se
 * ferait frapper par une forme qu'il ne voit pas. Dans un jeu où l'on mise, une hitbox qui
 * ne correspond pas au visuel est disqualifiante. Tout ce qui blesse ou porte est donc
 * construit en géométrie procédurale, taillée exactement sur son collider.
 */

/**
 * Palette relevee sur les references : des teintes FRANCHES, jamais pastel.
 * Le principe cle : le sol ne garde JAMAIS la meme couleur sur toute la longueur.
 * Il alterne par zone — c'est ce qui empeche l'ennui visuel, bien plus que la saturation.
 */
const C = {
  cyan: 0x2dd9d9,
  yellow: 0xffee7a,
  pink: 0xff4fa3,
  blue: 0x2e9bf5,
  mint: 0x6ee86e,
  violet: 0xb072ff,
  edge: 0xffffff,

  rail: 0xffe45c,
  railAlt: 0xff2d8f,
  railPost: 0xff8a1f,
  hazard: 0xff7a1f,
  bumper: 0xff2d8f,
  hammer: 0xff5a2d,
  roller: 0xffee7a,
  platform: 0xff4fa3,
  conveyor: 0xa855f7,
  finish: 0x3ee87a,
};

/** Interrupteurs de diagnostic : ?skip=ramps,doors,hammers,bumpers,conveyors,rollers,spinners,pendulums */
function skipped(kind) {
  const raw = new URLSearchParams(location.search).get('skip') ?? '';
  return raw.split(',').includes(kind);
}

export function buildCourse(RAPIER, assets) {
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = 1 / 60;
  const group = new THREE.Group();
  const animated = [];
  const checkpoints = [];
  const conveyors = [];
  const spawn = new THREE.Vector3(0, 2.4, 12);
  const finishZ = -140;

  // ─────────────────────────── briques ───────────────────────────

  /** Refuse tot les dimensions invalides : un panic wasm ne dit pas d'ou il vient. */
  function checkDims(...dims) {
    for (const d of dims) {
      if (!Number.isFinite(d) || d <= 0) throw new Error(`dimension invalide: ${d}`);
    }
  }

  function addBody(mesh, px, py, pz, colliderDesc) {
    mesh.position.set(px, py, pz);
    group.add(mesh);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz));
    world.createCollider(colliderDesc, body);
    return body;
  }

  function kinematic(px, py, pz, colliderDesc) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(px, py, pz));
    world.createCollider(colliderDesc, body);
    return body;
  }

  /** Dalle horizontale : sol jouable, avec liseré et bordures gonflables. */
  function slab(x, y, zFrom, zTo, width, { color = C.blue, map, rails = true, glow = true } = {}) {
    const len = Math.abs(zTo - zFrom);
    checkDims(width, len);
    const zc = (zFrom + zTo) / 2;
    const mesh = slabMesh(width, 1.2, len, color, C.edge, { radius: 0.5, map });
    addBody(mesh, x, y - 0.6, zc, RAPIER.ColliderDesc.cuboid(width / 2, 0.6, len / 2).setFriction(0.62));
    if (glow) {
      const g = rimGlow(width, len);
      g.position.set(x, y + 0.03, zc);
      group.add(g);
    }
    if (rails) addRails(x, y, zFrom, zTo, width);
    return mesh;
  }

  /**
   * Applique un marquage à plat, très légèrement au-dessus du sol.
   * depthWrite désactivé et polygonOffset évitent le combat de profondeur avec la dalle,
   * y compris en vue rasante où le marquage clignoterait sinon.
   */
  function decal(kind, x, y, z, size, rotation = 0) {
    // La grille sert de fond de zone, pas de signal : elle doit rester en retrait.
    const alpha = kind === 'grid' ? 0.3 : 0.55;
    const mat = new THREE.MeshBasicMaterial({
      map: floorMarkings(kind, { alpha }), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotation;
    mesh.position.set(x, y + 0.045, z);
    group.add(mesh);
    return mesh;
  }

  /** Bordures gonflables : elles guident l'œil autant qu'elles retiennent le joueur. */
  let railTurn = 0;
  function addRails(x, y, zFrom, zTo, width) {
    const len = Math.abs(zTo - zFrom);
    const zc = (zFrom + zTo) / 2;
    // Les bordures alternent d'une zone a l'autre : dans les references, deux troncons
    // voisins ne sont jamais de la meme couleur.
    const railColor = (railTurn++ % 2) ? C.railAlt : C.rail;
    for (const sx of [-1, 1]) {
      // 0,66 de rayon : la rambarde arrive au sommet du crane. Avant, tout ce qui
      // etait proche du joueur etait plus petit que lui — aucune echelle, aucun cadrage.
      const rail = pill(len, 0.66, railColor);
      rail.rotation.x = Math.PI / 2;
      addBody(rail, x + sx * (width / 2 + 0.2), y + 0.62, zc,
        RAPIER.ColliderDesc.cuboid(0.44, 1.0, len / 2).setFriction(0.3));
      for (let z = zFrom; z >= zTo; z -= 8) {
        const post = bollard(2.1, 0.42, C.railPost);
        post.position.set(x + sx * (width / 2 + 0.2), y - 0.5, z);
        group.add(post);
      }
    }
  }

  /** Rampe inclinée : permet le dénivelé, qui casse la monotonie du couloir plat. */
  function ramp(x, yFrom, yTo, zFrom, zTo, width, color = C.cyan) {
    if (skipped('ramps')) { slab(x, (yFrom + yTo) / 2, zFrom, zTo, width, { rails: false }); return null; }
    const dz = Math.abs(zTo - zFrom);
    const dy = yTo - yFrom;
    const len = Math.hypot(dz, dy);
    const angle = Math.atan2(dy, dz);
    const zc = (zFrom + zTo) / 2;
    const yc = (yFrom + yTo) / 2;

    const mesh = roundedBox(width, 1.2, len, color, {
      radius: 0.45, map: softChecker({ a: '#ffffff', b: '#e4e4e4', cells: 3, repeat: [3, 7] }), outline: 0.008,
    });
    mesh.rotation.x = angle;
    mesh.position.set(x, yc - 0.6, zc);
    group.add(mesh);

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, yc - 0.6, zc));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, 0.6, len / 2)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.7),
      body
    );
    return mesh;
  }

  // ─────────────────────────── obstacles ───────────────────────────

  /** Barreau rotatif. Visuel taillé exactement sur son collider. */
  function spinner(x, y, z, length, speed, phase) {
    if (skipped('spinners')) return;
    const visual = roundedBox(length, 0.9, 0.9, 0xffffff, {
      radius: 0.42, map: hazardStripes({ a: '#ffb01f', b: '#ff6a2b', bands: 7, repeat: [7, 1] }),
    });
    visual.position.set(x, y, z);
    group.add(visual);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 12), toonMaterial(0xff6a2b));
      cap.position.set(sx * (length / 2 - 0.1), 0, 0);
      cap.castShadow = true;
      visual.add(cap);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.6, 18), toonMaterial(C.rail));
    hub.position.set(x, y - 0.65, z);
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

  /** Pendule : boule Meshy sur un collider sphérique — les deux formes coïncident. */
  function pendulum(x, pivotY, z, phase, armLen = 4.2) {
    if (skipped('pendulums')) return;
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, z);
    group.add(pivot);

    const rope = pill(armLen, 0.11, 0x3d2d5c, { outline: false });
    rope.position.y = -armLen / 2;
    pivot.add(rope);

    const ball = assets.get('wrecking-ball', 3.0, { groundAlign: false })
      ?? new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 2), toonMaterial(0xff6a2b));
    ball.position.y = -armLen;
    pivot.add(ball);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), toonMaterial(C.rail));
    pivot.add(cap);

    const body = kinematic(x, pivotY, z,
      RAPIER.ColliderDesc.ball(1.5).setTranslation(0, -armLen, 0).setFriction(0.35));
    const q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 0, 1);
    animated.push((t) => {
      q.setFromAxisAngle(axis, Math.sin(t * 1.15 + phase) * 0.95);
      body.setNextKinematicRotation(q);
      pivot.quaternion.copy(q);
    });
  }

  /** Rouleau balayeur. */
  function roller(x, y, z, speed, length = 9.5) {
    if (skipped('rollers')) return;
    const radius = 0.9;
    const geo = new THREE.CylinderGeometry(radius, radius, length, 24);
    geo.rotateZ(Math.PI / 2);
    const visual = new THREE.Mesh(geo, toonMaterial(0xffffff));
    visual.material.map = inflatedBands({ a: '#1fc9b8', b: '#f2fffd', bands: 8, repeat: [1, 6] });
    visual.castShadow = true;
    visual.receiveShadow = true;
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.06, 16, 12), toonMaterial(0x14a394));
      cap.position.x = sx * length / 2;
      visual.add(cap);
    }
    visual.position.set(x, y, z);
    group.add(visual);

    const body = kinematic(x, y, z,
      RAPIER.ColliderDesc.cylinder(length / 2, radius)
        .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }).setFriction(0.4));
    const q = new THREE.Quaternion(), axis = new THREE.Vector3(1, 0, 0);
    animated.push((t) => {
      q.setFromAxisAngle(axis, t * speed);
      body.setNextKinematicRotation(q);
      visual.quaternion.copy(q);
    });
  }

  /**
   * Bumper gonflable : renvoie le joueur au lieu de le stopper.
   * La règle de combinaison Max est indispensable — le collider du joueur a une
   * restitution nulle, et la règle par défaut (moyenne) annulerait le rebond.
   */
  function bumper(x, y, z, radius = 0.92, height = 1.85) {
    if (skipped('bumpers')) return;
    const visual = bollard(height, radius, C.bumper);
    visual.position.set(x, y, z);
    group.add(visual);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + height / 2, z));
    world.createCollider(
      // Restitution PLAFONNEE A 1. Au-dela, chaque rebond cree de l'energie : les vitesses
      // divergent, finissent en NaN et font paniquer le moteur physique.
      RAPIER.ColliderDesc.cylinder(height / 2, radius)
        .setRestitution(0.92)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setFriction(0.1),
      body
    );
  }

  /** Marteau battant : pivote dans le plan vertical et balaye la piste. */
  function hammer(x, pivotY, z, phase, armLen = 3.4) {
    if (skipped('hammers')) return;
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, z);
    group.add(pivot);

    const shaft = pill(armLen, 0.2, 0x4a2f7a, { outline: false });
    shaft.position.y = -armLen / 2;
    pivot.add(shaft);

    const head = roundedBox(2.6, 1.5, 1.5, C.hammer, { radius: 0.5 });
    head.position.y = -armLen;
    pivot.add(head);

    const body = kinematic(x, pivotY, z,
      RAPIER.ColliderDesc.cuboid(1.3, 0.75, 0.75).setTranslation(0, -armLen, 0).setFriction(0.4));
    const q = new THREE.Quaternion(), axis = new THREE.Vector3(1, 0, 0);
    animated.push((t) => {
      q.setFromAxisAngle(axis, Math.sin(t * 1.5 + phase) * 1.1);
      body.setNextKinematicRotation(q);
      pivot.quaternion.copy(q);
    });
  }

  /**
   * Porte battante : panneau qui pivote autour d'un axe vertical.
   * `dir` (+1/-1) choisit de quel cote du gond part le panneau — surtout PAS une largeur
   * negative, qui donnerait une demi-dimension negative a Rapier et le ferait paniquer.
   */
  function swingDoor(x, y, z, width, phase, speed = 1.3, dir = 1) {
    if (skipped('doors')) return;
    if (width <= 0) throw new Error(`swingDoor: largeur invalide (${width})`);
    const side = Math.sign(dir) || 1;
    const panel = roundedBox(width, 2.6, 0.4, 0xffffff, {
      radius: 0.18, map: hazardStripes({ a: '#ffd83d', b: '#ff8a3d', bands: 4, repeat: [3, 2] }),
    });
    const holder = new THREE.Group();
    holder.position.set(x, y + 1.3, z);
    panel.position.x = (side * width) / 2;
    holder.add(panel);
    group.add(holder);

    const body = kinematic(x, y + 1.3, z,
      RAPIER.ColliderDesc.cuboid(width / 2, 1.3, 0.2)
        .setTranslation((side * width) / 2, 0, 0).setFriction(0.3));
    const q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 1, 0);
    animated.push((t) => {
      q.setFromAxisAngle(axis, Math.sin(t * speed + phase) * 1.25);
      body.setNextKinematicRotation(q);
      holder.quaternion.copy(q);
    });
  }

  /**
   * Tapis roulant : Rapier n'a pas de surface mobile native. On enregistre une zone,
   * et la boucle de jeu ajoute la vitesse au joueur qui s'y trouve — c'est plus stable
   * qu'un corps cinématique en translation infinie, et ça se lit bien avec la texture qui défile.
   */
  function conveyor(x, y, zFrom, zTo, width, vx, vz) {
    if (skipped('conveyors')) { slab(x, y, zFrom, zTo, width, { rails: false }); return null; }
    const len = Math.abs(zTo - zFrom);
    const zc = (zFrom + zTo) / 2;
    const map = inflatedBands({ a: '#5b8cff', b: '#c9dcff', bands: 7, repeat: [2, 6] });
    const mesh = slabMesh(width, 1.2, len, 0xffffff, C.conveyor, { radius: 0.3, map });
    addBody(mesh, x, y - 0.6, zc, RAPIER.ColliderDesc.cuboid(width / 2, 0.6, len / 2).setFriction(0.55));
    conveyors.push({ minX: x - width / 2, maxX: x + width / 2, minZ: Math.min(zFrom, zTo), maxZ: Math.max(zFrom, zTo), y, vx, vz });
    animated.push((t) => { map.offset.y = (t * 0.55) % 1; });
    return mesh;
  }

  /** Plateforme mobile au-dessus du vide. */
  function movingPlatform(z, amplitude, phase, speed, y = 0) {
    const w = 4.6, d = 4.6;
    const visual = roundedBox(w, 1.0, d, C.platform, { radius: 0.45, emissive: 0x2a1150 });
    visual.position.set(0, y - 0.5, z);
    group.add(visual);
    const glow = rimGlow(w, d, 0xd8b4fe, 0.06);
    group.add(glow);
    const body = kinematic(0, y - 0.5, z, RAPIER.ColliderDesc.cuboid(w / 2, 0.5, d / 2).setFriction(0.9));
    animated.push((t) => {
      const x = Math.sin(t * speed * Math.PI + phase) * amplitude;
      body.setNextKinematicTranslation({ x, y: y - 0.5, z });
      visual.position.x = x;
      glow.position.set(x, y + 0.06, z);
    });
  }

  // ─────────────────────────── tracé ───────────────────────────
  // Sept zones, avec dénivelé et largeurs variables : un couloir plat de bout en bout
  // se lit comme un test, pas comme un niveau.

  // Une texture différente par zone : le joueur sait où il est sans lire un panneau.
  // Un motif GROS par zone. Les references peignent de larges graphismes blancs, pas
  // des textures fines : a la vitesse de course, un motif fin disparait.
  const P = {
    dash: dashPattern({ count: 20, repeat: [3, 7] }),
    maze: mazePattern({ cells: 5, repeat: [2, 5] }),
    swoosh: swoosh({ repeat: [2, 5] }),
    check: softChecker({ cells: 3, repeat: [4, 8] }),
    quilt: quiltedVinyl({ cells: 4, repeat: [3, 7] }),
    polka: polkaStagger({ cells: 3, repeat: [5, 11] }),
  };

  // 1 — Départ, large et plat
  slab(0, 0, 20, -4, 16, { color: C.cyan, map: P.check });
  checkpoints.push(new THREE.Vector3(0, 2.4, 12));

  // 2 — Entonnoir à bumpers : premier goulot, premier chaos
  slab(0, 0, -4, -24, 13, { color: C.yellow, map: P.dash });
  checkpoints.push(new THREE.Vector3(0, 2.4, -6));
  for (const [bx, bz] of [[-3.4, -9], [3.4, -9], [0, -13], [-4.2, -17], [4.2, -17], [-1.8, -21], [1.8, -21]]) {
    bumper(bx, 0, bz);
  }
  swingDoor(-3.2, 0, -14.5, 3.0, 0, 1.3, 1);
  swingDoor(3.2, 0, -14.5, 3.0, Math.PI, 1.3, -1);

  // 3 — Montée puis plateau des barreaux rotatifs
  ramp(0, 0, 4, -24, -33, 12, C.pink);
  slab(0, 4, -33, -54, 12, { color: C.blue, map: P.swoosh });
  checkpoints.push(new THREE.Vector3(0, 6.4, -35));
  spinner(0, 5.05, -39, 11, 1.0, 0);
  spinner(0, 5.05, -47, 11, -1.25, Math.PI / 2);
  hammer(-3.6, 9.2, -52, 0);
  hammer(3.6, 9.2, -52, Math.PI);

  // 4 — Descente vers le pont étroit
  ramp(0, 4, 1, -54, -62, 11, C.violet);
  slab(0, 1, -62, -84, 7.5, { color: C.yellow, map: P.maze });
  checkpoints.push(new THREE.Vector3(0, 3.4, -64));
  pendulum(0, 7.0, -68, 0);
  pendulum(0, 7.0, -74, Math.PI * 0.6);
  pendulum(0, 7.0, -80, Math.PI * 1.2);

  // 5 — Tapis roulants qui poussent de côté, et rouleaux
  conveyor(-3, 1, -84, -96, 5.5, 2.6, 0);
  conveyor(3, 1, -84, -96, 5.5, -2.6, 0);
  addRails(0, 1, -84, -96, 11.5);
  checkpoints.push(new THREE.Vector3(0, 3.4, -86));
  roller(0, 1.9, -88, 3.4, 10.5);
  roller(0, 1.9, -93, -3.4, 10.5);

  // 6 — Plateformes mobiles au-dessus du vide
  slab(0, 1, -96, -101, 9, { color: C.mint, map: P.dash, rails: false });
  checkpoints.push(new THREE.Vector3(0, 3.4, -98));
  movingPlatform(-105, 5.6, 2.2, 0.45, 1);
  slab(0, 1, -110, -113, 6.5, { color: C.pink, map: P.dash, rails: false });
  movingPlatform(-117, 5.6, -2.2, 0.62, 1);
  slab(0, 1, -122, -127, 9, { color: C.cyan, map: P.dash, rails: false });

  // 7 — Dernière ligne : descente, barreau bas, sprint final
  checkpoints.push(new THREE.Vector3(0, 3.4, -124));
  ramp(0, 1, 0, -127, -132, 11, C.violet);
  slab(0, 0, -132, -148, 12, { map: hazardStripes({ a: '#ffd93b', b: '#ff2d8f', bands: 6, repeat: [4, 12] }), color: 0xffffff });
  spinner(0, 1.05, -137, 10, 2.1, 0);

  // ─────────────────────────── habillage ───────────────────────────

  // Marquages : ils jalonnent la piste et indiquent la direction.
  decal('grid', 0, 0, 12, 9);
  decal('arrow', 0, 0, -8, 4.5);
  decal('rings', 0, 0, -19, 6);
  decal('chevrons', 0, 4, -38, 5.5);
  decal('arrow', 0, 4, -50, 4.5);
  decal('rings', 0, 1, -66, 5);
  decal('chevrons', 0, 1, -78, 5);
  decal('arrow', 0, 1, -90, 4.5);
  decal('rings', 0, 1, -99, 5.5);
  decal('arrow', 0, 0, -136, 4.5);
  decal('grid', 0, 0, -145, 9);

  // ── Effets d'ambiance ──
  const confetti = new ConfettiField(group, { count: 110, radius: 26, height: 22 });
  const cannons = [];
  // Canons a fumee de part et d'autre, cycles FIXES et dephases : le decor respire
  // sans introduire d'aleatoire, ce que la qualification skill-game interdit.
  for (const [cx, cz, phase] of [
    [-11, -20, 0], [11, -20, 1.6], [-9.5, -58, 0.8], [9.5, -58, 2.4],
    [-11, -100, 0.4], [11, -100, 2.0], [-11, -140, 1.2], [11, -140, 2.8],
  ]) {
    // Orientes vers l'exterieur : la fumee habille les cotes sans masquer la piste.
    const dir = new THREE.Vector3(cx > 0 ? 0.75 : -0.75, 1, 0);
    const cannon = new SmokeCannon(group, new THREE.Vector3(cx, 1.2, cz), dir, { period: 3.4, phase });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.8, 14), toonMaterial(0xffb3d9));
    barrel.position.set(cx, 0.4, cz);
    barrel.rotation.z = cx > 0 ? 0.5 : -0.5;
    addOutline(barrel, 0.03);
    group.add(barrel);
    cannons.push(cannon);
  }

  dressStart();
  dressFinish();
  dressScenery();

  function dressStart() {
    for (const sx of [-1, 1]) {
      const post = pill(6.6, 0.44, C.finish);
      post.position.set(sx * 8.2, 3.1, 2);
      group.add(post);
    }
    const b = banner(16.4, C.finish, true);
    b.position.set(0, 6.3, 2);
    group.add(b);
    const flags = bunting(15, 14);
    flags.position.set(0, 5.4, -1);
    group.add(flags);
  }

  function dressFinish() {
    const arch = assets.getFitted('finish-arch', { x: 11.5, y: 5.4 });
    if (arch) { arch.position.set(0, 0, finishZ); group.add(arch); }
    else {
      const a = inflatableArch(12, 6, 0.6, C.finish);
      a.position.set(0, 0, finishZ);
      group.add(a);
    }
    const flags = bunting(13, 12);
    flags.position.set(0, 6.6, finishZ - 3);
    group.add(flags);
  }

  function dressScenery() {
    // Terrain : sans lui, gradins et décors flottent au-dessus du vide.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(340, 460), toonMaterial(0x8ede6d));
    ground.material.map = grassTufts({ repeat: [30, 40] });
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -3.2, -60);
    ground.receiveShadow = true;
    group.add(ground);

    // Montagnes hautes et striees : elles ferment l'horizon et donnent l'echelle.
    // Une colline unie de meme taille parait deux fois plus petite.
    for (const [hx, hz, r, h] of [
      [-86, -186, 40, 54], [70, -206, 48, 66], [12, -244, 58, 78],
      [-124, -120, 34, 44], [112, -78, 36, 48], [-136, -12, 30, 40],
      [100, -164, 32, 42], [-104, -228, 38, 50],
    ]) {
      const peak = stripedPeak(r, h, 0xffb3c8, 0xfff0f5, 5);
      peak.position.set(hx, -3.2, hz);
      group.add(peak);
    }

    // Collines vertes basses au premier plan : transition avec l'herbe.
    const mound = new THREE.SphereGeometry(1, 14, 10);
    for (const [hx, hz, r] of [[-52, -60, 22], [56, -110, 26], [-60, -160, 20], [48, -20, 18]]) {
      const m = new THREE.Mesh(mound, toonMaterial(0x7fd45e));
      m.position.set(hx, -3.2, hz);
      m.scale.set(r, r * 0.3, r);
      group.add(m);
    }

    // Arches gonflables au-dessus de la piste : jalonnent la progression sans texte.
    for (const [az, ay, color] of [[-24, 0, 0x4fd1c5], [-54, 4, 0xffd83d], [-96, 1, 0xff5f7e], [-127, 1, 0x8b7bff]]) {
      const a = inflatableArch(13, 6, 0.45, color);
      a.position.set(0, ay, az);
      group.add(a);
    }

    // Trois masses dominantes. Sans elles, tout le decor fait la meme taille et l'oeil
    // n'a nulle part ou se poser ; elles servent aussi de reperes de distance.
    const bigArch = inflatableArch(46, 26, 1.9, 0xff3d8b);
    bigArch.position.set(0, -3.2, -66);
    group.add(bigArch);

    /** Pose un modèle généré : pas de contour, pas d'ombre — c'est du décor, pas du gameplay. */
    function prop(name, size, x, z, { y = -3.2, rot = 0, tint = null, shadow = false } = {}) {
      const m = assets.get(name, size, { outline: 0 });
      if (!m) return null;
      m.position.set(x, y, z);
      m.rotation.y = rot;
      m.traverse((c) => {
        if (!c.isMesh || c.userData.isOutline) return;
        c.castShadow = shadow;
        if (tint && c.material?.color) c.material.color.setHex(tint);
      });
      group.add(m);
      return m;
    }

    // ── Formes gonflables plutot que vegetation ──
    // Les references n'ont AUCUN element naturaliste : ni ecorce, ni bois, ni pierre.
    // Nos arbres a tronc brun et notre stand en bois tiraient toute l'image vers le terne.
    const podColors = [0xff2d8f, 0x2dd9d9, 0xffe14d, 0xb072ff, 0x6ee86e, 0xff8a3d];
    let v = 0;
    for (let z = 6; z > -156; z -= 9) {
      for (const side of [-1, 1]) {
        const color = podColors[v % podColors.length];
        const kind = v % 3;
        let shape;
        if (kind === 0) {
          shape = bollard(3.4 + (v % 3) * 1.2, 1.1, color);
        } else if (kind === 1) {
          shape = new THREE.Mesh(new THREE.SphereGeometry(1.6 + (v % 3) * 0.4, 16, 12), toonMaterial(color));
          shape.position.y = 1.6;
          shape.scale.y = 1.25;
          addOutline(shape, 0.02);
        } else {
          shape = new THREE.Mesh(new THREE.CapsuleGeometry(0.95, 2.6, 6, 16), toonMaterial(color));
          shape.position.y = 2.3;
          addOutline(shape, 0.02);
        }
        const holder = new THREE.Group();
        holder.add(shape);
        holder.position.set(side * (15 + ((v * 3.7) % 5)), -3.2, z - (side > 0 ? 4 : 0));
        group.add(holder);
        v++;
      }
    }

    // ── Éléments de décor caractéristiques, un par zone ──
    prop('scoreboard', 11, -26, 8, { rot: 0.7 });
    prop('speaker-stack', 6, 17, 10, { rot: -0.5 });
    prop('speaker-stack', 6, -17, 10, { rot: 0.5 });
    prop('camera-tower', 7, -26, -40, { rot: 1.2 });
    prop('bounce-castle', 34, 46, -104, { rot: -0.9 });
    prop('camera-tower', 7, 26, -108, { rot: -1.2 });
    prop('camera-tower', 7, -24, -146, { rot: 1.4 });
    prop('giant-trophy', 9, 0, finishZ - 12, { y: -3.2, shadow: true });

    // ── Dirigeable : dérive lentement au-dessus du parcours ──
    const blimp = prop('blimp', 22, -30, -70, { y: 34, rot: 0.3 });
    if (blimp) {
      animated.push((t) => {
        blimp.position.x = -30 + Math.sin(t * 0.045) * 26;
        blimp.position.y = 34 + Math.sin(t * 0.22) * 1.4;
        blimp.rotation.y = 0.3 + Math.sin(t * 0.045) * 0.25;
      });
    }

    // ── Drapeaux : mâts alternés le long de la piste, oriflammes aux zones clés ──
    const flagColors = [0xff5f7e, 0x4fd1c5, 0xffd83d, 0x8b7bff, 0xff8a3d, 0x4ade80];
    let f = 0;
    for (let z = 4; z > -150; z -= 16) {
      for (const side of [-1, 1]) {
        const pole = flagPole(6.8 + (f % 3) * 0.7, 2.1, 1.15, 0xf0f0f5, flagColors[f % flagColors.length]);
        pole.position.set(side * 15.2, -3.2, z);
        // Tous les drapeaux flottent vers l'arrivee : un vent coherent, et ils ne
        // font plus face au joueur comme des panneaux publicitaires.
        pole.rotation.y = Math.PI / 2;
        group.add(pole);
        f++;
      }
    }
    for (const [x, z] of [[-13.5, -22], [13.5, -52], [-13.5, -84], [13.5, -114], [-13.5, -142]]) {
      const pen = pennant(8.8, 2.6, 0.9, 0xe8e8ef, flagColors[(f++) % flagColors.length]);
      pen.position.set(x, -3.2, z);
      group.add(pen);
    }

    // Ballons géants en bord de piste
    for (const [bx, bz, r, color] of [
      [-24, -12, 2.2, 0xff5f7e], [24, -40, 2.4, 0x4fd1c5], [-26, -70, 2.0, 0xffd83d],
      [26, -104, 2.3, 0x8b7bff], [-25, -134, 2.2, 0xff8a3d],
    ]) {
      const b = balloon(r, color);
      b.position.set(bx, -3.2, bz);
      group.add(b);
    }

    for (const [x, z, ry] of [[-22, -20, 0.5], [22, -46, -0.5], [-22, -78, 0.5], [22, -112, -0.5], [-22, -140, 0.5]]) {
      grandstand(x, z, ry * Math.PI);
    }
  }

  /**
   * Gradins procéduraux avec foule animée. Meshy ne produit pas de gradins lisibles
   * (il rend un bâtiment), et une foule qui bouge vaut bien plus qu'un décor figé pour
   * l'impression de plateau de jeu télévisé.
   */
  function grandstand(px, pz, rotY) {
    const stand = new THREE.Group();
    stand.position.set(px, -3.1, pz);
    stand.rotation.y = rotY;
    group.add(stand);

    const ROWS = 5;
    const spectators = [];
    const seatGeo = new THREE.SphereGeometry(0.42, 10, 8);
    const palette = [0xff5f7e, 0x4fd1c5, 0xffd83d, 0x8b7bff, 0xffa36b, 0x9ede6a, 0xff8bd0, 0x4fa8ff];

    for (let r = 0; r < ROWS; r++) {
      const h = 0.9 + r * 0.95;
      const step = roundedBox(13, h, 2.3, r % 2 ? 0x3fa9f5 : 0xffffff, { radius: 0.22, outline: 0.006 });
      step.position.set(0, h / 2 - 0.5, -r * 2.3);
      stand.add(step);
      for (let i = 0; i < 9; i++) {
        const seed = r * 9 + i;
        const m = new THREE.Mesh(seatGeo, toonMaterial(palette[seed % palette.length]));
        m.position.set(-5.4 + i * 1.35, h + 0.1, -r * 2.3 + 0.2);
        stand.add(m);
        spectators.push({ m, base: h + 0.1, phase: (seed * 0.7) % (Math.PI * 2), speed: 3 + (seed % 5) * 0.5 });
      }
    }
    const flags = bunting(12.4, 12);
    flags.position.set(0, 0.9 + ROWS * 0.95 + 1.1, -(ROWS - 1) * 2.3);
    stand.add(flags);

    animated.push((t) => {
      for (const s of spectators) s.m.position.y = s.base + Math.abs(Math.sin(t * s.speed + s.phase)) * 0.34;
    });
  }

  // Respiration des gonflables : 1,2 % d'amplitude suffit a faire vivre une scene entiere.
  const breathing = [];
  group.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline && o.geometry?.type === 'CapsuleGeometry') breathing.push(o);
  });
  animated.push((t) => {
    for (let i = 0; i < breathing.length; i++) {
      const k = 1 + Math.sin(t * 1.1 + i * 0.7) * 0.012;
      breathing[i].scale.set(k, breathing[i].scale.y, k);
    }
  });

  return {
    world, group, spawn, finishZ, killY: -12, checkpoints, conveyors,
    update: (elapsed, dt = 0.016, focus = null) => {
      updateFlags(elapsed);
      for (const fn of animated) fn(elapsed);
      for (const c of cannons) c.update(dt, elapsed);
      if (focus) confetti.update(dt, elapsed, focus);
    },
    checkpointFor(z) {
      let best = checkpoints[0];
      for (const cp of checkpoints) if (z <= cp.z + 1) best = cp;
      return best;
    },
  };
}
