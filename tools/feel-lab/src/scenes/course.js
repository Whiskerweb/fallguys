import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { toonMaterial } from '../world.js';
import { ConfettiField } from '../effects.js';
import { createTerrain } from '../terrain.js';
import { porteArrivee } from '../arrivee.js';
import {
  roundedBox, pill, banner, inflatableArch, balloon, ballMesh, bollard, bunting,
  updateFlags, bollardField,
} from '../props.js';
import {
  quiltedVinyl, softChecker, hazardStripes, polkaStagger, inflatedBands, conveyorArrows,
  floorMarkings, dashPattern, mazePattern, swoosh, iceRink, slideStreaks,
} from '../textures.js';
import { trackPath, buildTrack, buildRails } from '../track.js';

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
 *
 * LE SOL EST UN TRACÉ, PAS UNE PILE DE DALLES. Chaque tronçon était auparavant un
 * rectangle posé à la main : vus de dessus ils se chevauchaient dans les virages,
 * laissaient des encoches à leurs coins arrondis, et deux largeurs voisines ne se
 * raccordaient jamais. On décrit maintenant une LIGNE MOYENNE — points, largeur,
 * altitude — et `track.js` en extrude un ruban continu, ses virages circulaires, ses
 * rambardes d'un seul tenant et un collider trimesh bâti sur les mêmes sommets.
 * Conséquence directe : les obstacles ne sont plus placés en coordonnées du monde mais
 * SUR le tracé (une cote Z, un déport latéral), donc ils suivent la piste quand elle
 * tourne au lieu de rester alignés sur les axes.
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
  socle: 0xf3ecff,

  rail: 0xffe45c,
  railAlt: 0xff2d8f,
  railPost: 0xff8a1f,
  hazard: 0xff7a1f,
  glace: 0xd8f1ff,
  toboggan: 0x8fd4ff,
  bumper: 0xff2d8f,
  hammer: 0xff5a2d,
  platform: 0xff4fa3,
  finish: 0x3ee87a,
};

/** Interrupteurs de diagnostic : ?skip=doors,hammers,bumpers,rollers,spinners,pendulums,balls */
function skipped(kind) {
  const raw = new URLSearchParams(location.search).get('skip') ?? '';
  return raw.split(',').includes(kind);
}

/**
 * PRNG deterministe, seme par la GRAINE DE MANCHE. Deux parties ne se ressemblent pas,
 * mais a l'interieur d'une manche la suite est identique pour tout le monde — en
 * multijoueur, le serveur tire la graine et l'impose aux seize joueurs. C'est ce qui
 * permet d'avoir de l'aleatoire SANS que le hasard departage deux joueurs.
 */
function semer(graine) {
  let a = (graine >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Largeur du ruban au départ. `depart` en dérive : les deux ne peuvent pas diverger. */
const DEPART_W = 16;

export function buildCourse(RAPIER, assets, { seed = 1 } = {}) {
  const rnd = semer(seed);
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = 1 / 60;
  const group = new THREE.Group();
  const animated = [];
  const checkpoints = [];
  const conveyors = [];
  const plots = [];           // positions des plots de rambarde, instancies a la fin
  const ctx = { RAPIER, world, group };

  /**
   * Le terrain est LOIN sous la piste. Dans les references, le parcours est une passerelle
   * surelevee : on voit le paysage en contrebas, et c'est ce qui donne l'ampleur. Une piste
   * posee au sol enferme le regard et oblige a encombrer les bords pour meubler.
   */
  const GROUND_Y = -15;

  /** Hauteur du relief sous un point : renseignee des que le terrain est construit. */
  let terrainHeightAt = () => 0;

  const spawn = new THREE.Vector3(0, 2.4, 12);
  const finishZ = -196;

  // ─────────────────────────── matières du sol ───────────────────────────
  // Une texture par zone, GROSSE. Les UV du ruban sont en metres (une periode tous les
  // 8 m), donc les motifs gardent la meme echelle que la piste soit large ou etroite —
  // c'est ce qui manquait aux dalles, ou chaque rectangle etirait sa texture a sa guise.

  /**
   * Les deux tapis, chacun avec sa teinte ET ses chevrons. Ils poussent a l'oppose, vers
   * la couture qui les separe : sans un signe qui dise de quel cote, on ne l'apprend
   * qu'en se faisant chasser. Le second est le premier RETOURNE horizontalement.
   */
  const beltL = conveyorArrows({ base: '#2f6bff', arrow: '#e4edff', repeat: [1, 1] });
  const beltR = conveyorArrows({ base: '#8b2ff5', arrow: '#f4e6ff', repeat: [1, 1] });
  beltR.repeat.x = -1;

  const ZONES = {
    depart:    { color: C.cyan,   map: softChecker({ cells: 3, repeat: [1, 1] }) },
    entonnoir: { color: C.yellow, map: dashPattern({ count: 7, repeat: [1, 1] }) },
    montee:    { color: C.pink,   map: softChecker({ a: '#ffffff', b: '#e4e4e4', cells: 2, repeat: [1, 1] }) },
    plateau:   { color: C.blue,   map: swoosh({ repeat: [1, 1] }) },
    fourche:   { color: C.mint,   map: polkaStagger({ cells: 2, repeat: [1, 1] }) },
    gauche:    { color: C.yellow, map: mazePattern({ cells: 2, repeat: [1, 1] }) },
    droite:    { color: C.violet, map: quiltedVinyl({ cells: 3, repeat: [1, 1] }) },
    tapis:     { bands: [{ color: 0xffffff, map: beltL }, { color: 0xffffff, map: beltR }] },
    fusion:    { color: C.pink,   map: dashPattern({ count: 7, repeat: [1, 1] }) },
    ballons:   { color: C.cyan,   map: softChecker({ cells: 3, repeat: [1, 1] }) },
    haut:      { color: C.mint,   map: polkaStagger({ cells: 2, repeat: [1, 1] }) },
    ilot:      { color: C.pink,   map: dashPattern({ count: 7, repeat: [1, 1] }) },
    finale:    { color: C.cyan,   map: dashPattern({ count: 7, repeat: [1, 1] }) },
    patinoire: { color: C.glace, map: iceRink({ repeat: [1, 1] }) },
    toboggan:  { color: C.toboggan, map: slideStreaks({ repeat: [1, 2] }) },
    sprint:    { color: 0xffffff, map: hazardStripes({ a: '#ffd93b', b: '#ff2d8f', bands: 5, repeat: [1, 1] }) },
  };

  // ─────────────────────────── le tracé ───────────────────────────
  //
  // Sept zones, avec denivele et largeurs variables. Vu de dessus, la piste SERPENTE :
  // chaque tronçon est decale lateralement et relie par un virage circulaire, ce qui
  // oblige a corriger sa trajectoire en permanence. Un couloir droit se tient d'une
  // seule touche du depart a l'arrivee.
  //
  // Les rayons de virage sont volontairement grands (9 a 12 m). En dessous de la
  // demi-largeur de la piste, le bord interieur se replierait sur lui-meme : le module
  // de trace le signale en console plutot que de produire une geometrie retournee.

  const MAIN = trackPath([
    { x: 0,  z: 20,    y: 0, w: DEPART_W, zone: 'depart' },
    { x: 0,  z: -6,    y: 0, w: 15, zone: 'entonnoir' },
    { x: 7,  z: -20,   y: 0, w: 13, zone: 'entonnoir' },
    { x: 7,  z: -29,   y: 0, w: 12, zone: 'montee' },     // pied de la montee
    { x: 7,  z: -40,   y: 4, w: 12, zone: 'plateau' },    // sommet, dans le virage
    { x: -6, z: -50,   y: 4, w: 12, zone: 'plateau' },
    { x: -6, z: -61,   y: 4, w: 12, zone: 'fourche' },
    { x: -6, z: -68.6, y: 1, w: 12, zone: 'fourche' },
  ], { corner: 12 });

  // Les deux voies partent JOINTIVES du bord de la piste commune ([-12, 0] en X) et
  // s'ecartent ensuite : le vide entre elles se creuse progressivement, au lieu de
  // s'ouvrir d'un coup sous les pieds du joueur qui garde sa ligne.
  // Elles chevauchent la piste commune de 40 cm et passent 5 mm plus bas : la jonction
  // est ainsi couverte sans que les deux surfaces se disputent la profondeur.
  const GAUCHE = trackPath([
    { x: -8.8, z: -68.2, y: 0.995, w: 6.4, zone: 'gauche' },
    { x: -13,  z: -76,   y: 1,     w: 6.6, zone: 'gauche' },
    { x: -13,  z: -93,   y: 1,     w: 6.6, zone: 'gauche' },
    { x: -10,  z: -97.4, y: 0.995, w: 7,   zone: 'gauche' },
  ], { corner: 9 });

  const DROITE = trackPath([
    { x: -2.8, z: -68.2, y: 0.995, w: 5.6, zone: 'droite' },
    { x: 3,    z: -76,   y: 1,     w: 9.2, zone: 'tapis' },
    { x: 3,    z: -86,   y: 1,     w: 9.2, zone: 'droite' },
    { x: 3,    z: -93,   y: 1,     w: 8.5, zone: 'droite' },
    { x: 0,    z: -97.4, y: 0.995, w: 7,   zone: 'droite' },
  ], { corner: 9 });

  /**
   * LES DEUX VOIES NE SE REJOIGNENT PLUS EN POINTE.
   *
   * Elles convergeaient jusqu'a se frôler, et le ruban commun ne prenait le relais
   * qu'apres : il restait donc, sur les six derniers metres, une FENTE d'un a trois
   * metres entre les deux voies. Une fente n'est pas un vide — un vide se voit et se
   * contourne, une fente se lit comme du sol et se traverse par le fond. Les voies
   * gardent maintenant un ecart franc de trois metres jusqu'au bout, et le ruban commun
   * les recouvre toutes les deux d'un coup, sur toute leur largeur.
   *
   * La MONTEE AUX BALLONS fait desormais vingt-deux metres pour huit de denivele. Une
   * cote courte se franchit d'un elan : c'est la longueur qui oblige a lire la descente
   * des ballons et a choisir sa ligne, pas la pente.
   */
  const FUSION = trackPath([
    /*
     * PONT DE JONCTION. Les deux voies se rapprochent jusqu'a 3,5 m d'ecart a z = -95,
     * puis le vide entre elles SE ROUVRE a 7,5 m sur les deux derniers metres avant la
     * dalle commune — leurs rubans s'inclinent en fin de course, et une tranche a Z
     * constant les voit s'ecarter. Le joueur, lui, voit deux voies qui se rejoignent : il
     * derive vers le milieu au moment precis ou le trou s'elargit, et tombe.
     *
     * Mesure par grille de rayons (`diag/raccord.mjs`) — `continuite.mjs` ne pouvait pas
     * le voir, puisqu'il sonde chaque voie et que le trou n'appartient a aucune.
     *
     * La dalle commune demarre donc trois metres plus tot, assez large pour couvrir le
     * vide sur toute la zone de convergence. `rail: false` : une rambarde sur ce troncon
     * poserait un mur au beau milieu du couloir, entre les deux voies.
     */
    { x: -5, z: -94,  y: 1, w: 9,  zone: 'fusion', rail: false },
    { x: -5, z: -97,  y: 1, w: 17, zone: 'fusion' },
    { x: -5, z: -103, y: 1, w: 16, zone: 'ballons' },
    { x: -5, z: -125, y: 9, w: 15, zone: 'ballons' },
    { x: -5, z: -133, y: 9, w: 12, zone: 'haut' },
  ], { corner: 10 });

  // Ilot entre les deux plateformes mobiles : pas de rambarde, on doit pouvoir en
  // tomber — c'est tout l'interet du passage.
  const ILOT = trackPath([
    { x: 0, z: -139, y: 9, w: 6.5, zone: 'ilot', rail: false },
    { x: 0, z: -144, y: 9, w: 6.5, zone: 'ilot', rail: false },
  ]);

  /**
   * PATINOIRE puis TOBOGGAN. Le parcours ne se terminait que par une descente et un
   * sprint : les vingt derniers metres ne demandaient plus rien. La derniere ligne est
   * maintenant la plus retorse — une plaque de glace ou l'on ne freine plus, semee de
   * bumpers, puis une longue glissade de neuf metres de denivele.
   *
   * Les deux surfaces ANNONCENT leur nature : glace bleue rayee de traces de patins,
   * puis filets de vitesse dans le sens de la pente. Un sol glissant qui ressemble a un
   * sol normal n'est pas une difficulte, c'est une trahison.
   */
  const FINALE = trackPath([
    { x: 0,    z: -150.6, y: 9,   w: 10, zone: 'finale' },
    { x: 3.5,  z: -157,   y: 9,   w: 12, zone: 'patinoire' },
    { x: 3.5,  z: -169,   y: 9,   w: 12, zone: 'patinoire' },
    { x: -1,   z: -184,   y: 1.5, w: 13, zone: 'toboggan' },
    { x: -1,   z: -196,   y: 1.5, w: 13, zone: 'sprint' },
    { x: -1,   z: -203,   y: 1.5, w: 13, zone: 'sprint' },
  ], { corner: 11 });

  const PATHS = [MAIN, GAUCHE, DROITE, FUSION, ILOT, FINALE];
  for (const p of PATHS) buildTrack(ctx, p, { zones: ZONES, edge: C.edge, socle: C.socle });

  // Rambardes : un tube continu par cote et par ruban. Elles alternent de couleur d'un
  // troncon a l'autre — dans les references, deux sections voisines ne sont jamais de
  // la meme teinte.
  const RAIL_COLORS = [C.rail, C.railAlt, C.rail, C.railAlt, C.rail, C.railAlt];
  PATHS.forEach((p, i) => {
    if (p === ILOT) return;
    buildRails(ctx, p, { color: RAIL_COLORS[i % RAIL_COLORS.length], plots });
  });

  // Tapis roulants : Rapier n'a pas de surface mobile native. On enregistre la zone, et
  // la boucle de jeu ajoute la vitesse au joueur qui s'y trouve. Les deux bandes sont
  // maintenant DANS le ruban (deux matieres cote a cote), plus des dalles posees dessus :
  // il n'y a donc plus de marche a leur entree ni de couture a leur bord.
  const TAPIS_Z = [-86, -76.3];
  conveyors.push({ minX: -1.2, maxX: 3, minZ: TAPIS_Z[0], maxZ: TAPIS_Z[1], y: 1, vx: 2.2, vz: 0 });
  conveyors.push({ minX: 3, maxX: 7.2, minZ: TAPIS_Z[0], maxZ: TAPIS_Z[1], y: 1, vx: -2.2, vz: 0 });
  // Le motif defile DANS le sens de la poussee. Les deux decalages descendent : le
  // second tapis a deja sa repetition inversee, donc le meme signe le fait avancer
  // dans l'autre sens.
  animated.push((t) => {
    beltL.offset.x = -(t * 0.3) % 1;
    beltR.offset.x = -(t * 0.3) % 1;
  });

  /**
   * ZONES GLISSANTES. Enregistrees comme les tapis roulants : la scene decrit ce qu'il
   * y a sous les pieds, le personnage n'en connait qu'un chiffre.
   *
   * Testees SUR LE TRACE, pas dans une boite alignee sur les axes : la glissade descend
   * en biais, et une boite droite aurait laisse glisser au-dessus du vide tout en
   * gardant de l'adherence au bord interieur du virage.
   */
  const glissades = [];

  function glisseAt(p) {
    for (const g of glissades) {
      if (!(p.z <= g.zFrom && p.z >= g.zTo)) continue;
      const f = g.path.atZ(p.z);
      if (Math.abs(p.y - f.y) > 2.4) continue;
      const lat = (p.x - f.x) * f.nx + (p.z - f.z) * f.nz;
      if (Math.abs(lat) > f.w / 2 + 0.4) continue;
      return g.force;
    }
    return 0;
  }

  // ─────────────────────────── repères sur le tracé ───────────────────────────

  /**
   * Marque un modele Meshy comme PARTAGE. Son clone reutilise la geometrie de
   * l'original : la manche ne doit donc jamais la liberer (voir `dispose`).
   */
  function partager(m) {
    if (m) m.userData.partage = true;
    return m;
  }

  /** Repere du monde a `lat` metres a droite de l'axe, a la cote Z demandee. */
  function on(path, z, lat = 0) {
    const f = path.atZ(z);
    return { x: f.x + f.nx * lat, y: f.y, z: f.z + f.nz * lat, yaw: f.yaw, w: f.w };
  }

  function checkpoint(path, z) {
    const f = path.atZ(z);
    checkpoints.push(new THREE.Vector3(f.x, f.y + 2.4, f.z));
  }

  /** Refuse tot les dimensions invalides : un panic wasm ne dit pas d'ou il vient. */
  function checkDims(...dims) {
    for (const d of dims) {
      if (!Number.isFinite(d) || d <= 0) throw new Error(`dimension invalide: ${d}`);
    }
  }

  function kinematic(px, py, pz, colliderDesc) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(px, py, pz));
    world.createCollider(colliderDesc, body);
    return body;
  }

  const AX = new THREE.Vector3(1, 0, 0);
  const AY = new THREE.Vector3(0, 1, 0);
  const AZ = new THREE.Vector3(0, 0, 1);

  /**
   * Applique un marquage à plat, très légèrement au-dessus du sol.
   * depthWrite désactivé et polygonOffset évitent le combat de profondeur avec la dalle,
   * y compris en vue rasante où le marquage clignoterait sinon.
   */
  function decal(kind, f, size) {
    // La grille sert de fond de zone, pas de signal : elle doit rester en retrait.
    const alpha = kind === 'grid' ? 0.3 : 0.55;
    const mat = new THREE.MeshBasicMaterial({
      map: floorMarkings(kind, { alpha }), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    // Ordre YXZ : le marquage est d'abord couche a plat, puis tourne avec la piste.
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(-Math.PI / 2, f.yaw, 0);
    mesh.position.set(f.x, f.y + 0.045, f.z);
    group.add(mesh);
    return mesh;
  }

  // ─────────────────────────── obstacles ───────────────────────────

  /** Barreau rotatif. Visuel taillé exactement sur son collider. */
  function spinner(f, height, length, speed, phase) {
    if (skipped('spinners')) return;
    checkDims(length);
    const visual = roundedBox(length, 0.9, 0.9, 0xffffff, {
      radius: 0.42, map: hazardStripes({ a: '#ffb01f', b: '#ff6a2b', bands: 7, repeat: [7, 1] }),
    });
    const y = f.y + height;
    visual.position.set(f.x, y, f.z);
    group.add(visual);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 12), toonMaterial(0xff6a2b));
      cap.position.set(sx * (length / 2 - 0.1), 0, 0);
      cap.castShadow = true;
      visual.add(cap);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.6, 18), toonMaterial(C.rail));
    hub.position.set(f.x, y - 0.65, f.z);
    hub.castShadow = true;
    group.add(hub);

    const body = kinematic(f.x, y, f.z, RAPIER.ColliderDesc.cuboid(length / 2, 0.45, 0.45).setFriction(0.5));
    const q = new THREE.Quaternion();
    animated.push((t) => {
      q.setFromAxisAngle(AY, f.yaw + t * speed + phase);
      body.setNextKinematicRotation(q);
      visual.quaternion.copy(q);
    });
  }

  /** Pendule : boule Meshy sur un collider sphérique — les deux formes coïncident. */
  function pendulum(f, pivotY, phase, armLen = 4.2) {
    if (skipped('pendulums')) return;
    const pivot = new THREE.Group();
    const y = f.y + pivotY;
    pivot.position.set(f.x, y, f.z);
    group.add(pivot);

    const rope = pill(armLen, 0.11, 0x3d2d5c, { outline: false });
    rope.position.y = -armLen / 2;
    pivot.add(rope);

    const ball = partager(assets.get('wrecking-ball', 3.0, { groundAlign: false }))
      ?? new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 2), toonMaterial(0xff6a2b));
    ball.position.y = -armLen;
    pivot.add(ball);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), toonMaterial(C.rail));
    pivot.add(cap);

    const body = kinematic(f.x, y, f.z,
      RAPIER.ColliderDesc.ball(1.5).setTranslation(0, -armLen, 0).setFriction(0.35));
    // Le pendule balaye EN TRAVERS de la piste : son axe est donc la tangente du trace,
    // pas l'axe Z du monde. Sur un troncon en biais, l'ancienne version balayait de
    // travers et laissait un couloir libre le long d'un bord.
    const qYaw = new THREE.Quaternion().setFromAxisAngle(AY, f.yaw);
    const q = new THREE.Quaternion();
    animated.push((t) => {
      q.setFromAxisAngle(AZ, Math.sin(t * 1.15 + phase) * 0.95).premultiply(qYaw);
      body.setNextKinematicRotation(q);
      pivot.quaternion.copy(q);
    });
  }

  /** Rouleau balayeur. */
  function roller(f, height, speed, length = 9.5) {
    if (skipped('rollers')) return;
    checkDims(length);
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
    const y = f.y + height;
    visual.position.set(f.x, y, f.z);
    group.add(visual);

    const body = kinematic(f.x, y, f.z,
      RAPIER.ColliderDesc.cylinder(length / 2, radius)
        .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }).setFriction(0.4));
    const qYaw = new THREE.Quaternion().setFromAxisAngle(AY, f.yaw);
    const q = new THREE.Quaternion();
    animated.push((t) => {
      q.setFromAxisAngle(AX, t * speed).premultiply(qYaw);
      body.setNextKinematicRotation(q);
      visual.quaternion.copy(q);
    });
  }

  /**
   * Bumper gonflable : renvoie le joueur au lieu de le stopper.
   * La règle de combinaison Max est indispensable — le collider du joueur a une
   * restitution nulle, et la règle par défaut (moyenne) annulerait le rebond.
   */
  function bumper(f, radius = 0.92, height = 1.85) {
    if (skipped('bumpers')) return;
    const visual = bollard(height, radius, C.bumper);
    visual.position.set(f.x, f.y, f.z);
    group.add(visual);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(f.x, f.y + height / 2, f.z));
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
  function hammer(f, pivotY, phase, armLen = 3.4) {
    if (skipped('hammers')) return;
    const pivot = new THREE.Group();
    const y = f.y + pivotY;
    pivot.position.set(f.x, y, f.z);
    group.add(pivot);

    const shaft = pill(armLen, 0.2, 0x4a2f7a, { outline: false });
    shaft.position.y = -armLen / 2;
    pivot.add(shaft);

    const head = roundedBox(2.6, 1.5, 1.5, C.hammer, { radius: 0.5 });
    head.position.y = -armLen;
    pivot.add(head);

    const body = kinematic(f.x, y, f.z,
      RAPIER.ColliderDesc.cuboid(1.3, 0.75, 0.75).setTranslation(0, -armLen, 0).setFriction(0.4));
    const qYaw = new THREE.Quaternion().setFromAxisAngle(AY, f.yaw);
    const q = new THREE.Quaternion();
    animated.push((t) => {
      q.setFromAxisAngle(AX, Math.sin(t * 1.5 + phase) * 1.1).premultiply(qYaw);
      body.setNextKinematicRotation(q);
      pivot.quaternion.copy(q);
    });
  }

  /**
   * Gros ballons qui devalent une pente vers le joueur.
   *
   * ALEATOIRE, MAIS SEME. Voie et instant de lacher sont tires au sort — le couloir
   * appris par coeur ne vaut plus rien, et il faut LIRE la descente a chaque passage.
   * Le tirage vient toutefois du PRNG de la manche, pas de Math.random : la sequence
   * est identique pour les seize joueurs d'une meme manche, et reproductible d'un
   * bout a l'autre. Le hasard choisit le terrain, jamais le vainqueur — c'est cette
   * distinction qui autorise les mises.
   */
  function ballChute(path, zTop, zBottom, {
    nombre = 4, radius = 1.7, periode = 4.4, jeu = 0.9,
  } = {}) {
    if (skipped('balls')) return;
    const bas = path.atZ(zBottom);
    const haut = path.atZ(zTop);
    // Marge : un ballon lache au ras du bord roulerait dans le vide sans jamais menacer
    // personne. On garde son rayon plus une longueur d'epaule a l'interieur.
    const demi = Math.max(1, haut.w / 2 - radius - 1.4);
    const palette = [0xff4fa3, 0xffd93b, 0x6ee86e, 0x31c7f0, 0xb072ff, 0xff8a1f, 0x4fd1c5];

    /**
     * LACHER un ballon : il reparait au sommet et part vers le bas.
     *
     * `attente` compte : un ballon en attente est RETIRE de la simulation. Voir `parquer`.
     */
    const lacher = (b, t) => {
      b.lat = (rnd() * 2 - 1) * demi;
      b.prochain = t + periode * (1 - jeu / 2 + rnd() * jeu);
      if (b.attente) {
        b.attente = false;
        b.body.setEnabled(true);
        b.mesh.visible = true;
      }
      poser(b);
      b.body.setLinvel({ x: 0, y: 0, z: 3.2 }, true);
    };

    /**
     * PARQUER un ballon sorti de la cote, en attendant son prochain lacher.
     *
     * Il est RETIRE de la simulation, pas repose au sommet. L'ancienne version le reposait
     * la-haut avec une vitesse nulle — sur une pente : il repartait donc immediatement,
     * de lui-meme, sans attendre son horaire. Les quatre ballons devalaient en
     * permanence, la periode ne pilotait rien du tout, et la seule facon de desengorger
     * la cote etait d'en retirer. Mesure : passer la periode de 6,6 a 8,0 s ne changeait
     * la densite que de 2,95 a 2,87.
     *
     * Le corps desactive ne collisionne plus et ne tombe plus ; le calendrier des lachers
     * reste une fonction du temps et de la graine, donc identique pour les seize joueurs.
     */
    const parquer = (b) => {
      if (b.attente) return;
      b.attente = true;
      b.body.setEnabled(false);
      b.mesh.visible = false;
    };
    const poser = (b) => {
      const d = on(path, zTop, b.lat);
      b.body.setTranslation({ x: d.x, y: d.y + radius + 0.35, z: d.z }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    };

    const balles = [];
    for (let i = 0; i < nombre; i++) {
      const mesh = ballMesh(radius, palette[i % palette.length]);
      group.add(mesh);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(haut.x, haut.y + radius, haut.z).setCcdEnabled(true));
      world.createCollider(
        RAPIER.ColliderDesc.ball(radius).setFriction(0.35).setRestitution(0.35).setDensity(0.5), body);
      const b = { mesh, body, lat: 0, prochain: 0, attente: false };
      // Depart etale : sans decalage initial, les ballons partiraient de front et
      // laisseraient un couloir libre derriere eux pendant toute une periode.
      b.lat = (rnd() * 2 - 1) * demi;
      b.prochain = rnd() * periode * nombre * 0.55;
      poser(b);
      parquer(b);
      balles.push(b);
    }

    animated.push((t) => {
      for (const b of balles) {
        if (t >= b.prochain) lacher(b, t);
        if (b.attente) continue;
        const p = b.body.translation();
        // Ballon sorti de la cote : on le retire du jeu SANS toucher a son horaire ni
        // tirer de nouvelle voie. Le calendrier ne depend donc que du temps et de la
        // graine, jamais de la physique — deux joueurs voient la meme sequence meme si
        // leurs simulations divergent d'un cheveu.
        if (p.z > zBottom + 6 || p.y < bas.y - 16 || Math.abs(p.x - haut.x) > 26) {
          parquer(b);
          continue;
        }
        b.mesh.position.set(p.x, p.y, p.z);
        const r = b.body.rotation();
        b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    });
  }

  /**
   * Porte battante : panneau qui pivote autour d'un axe vertical.
   * `dir` (+1/-1) choisit de quel cote du gond part le panneau — surtout PAS une largeur
   * negative, qui donnerait une demi-dimension negative a Rapier et le ferait paniquer.
   */
  function swingDoor(f, width, phase, speed = 1.3, dir = 1) {
    if (skipped('doors')) return;
    if (width <= 0) throw new Error(`swingDoor: largeur invalide (${width})`);
    const side = Math.sign(dir) || 1;
    const panel = roundedBox(width, 2.6, 0.4, 0xffffff, {
      radius: 0.18, map: hazardStripes({ a: '#ffd83d', b: '#ff8a3d', bands: 4, repeat: [3, 2] }),
    });
    const holder = new THREE.Group();
    const y = f.y + 1.3;
    holder.position.set(f.x, y, f.z);
    panel.position.x = (side * width) / 2;
    holder.add(panel);
    group.add(holder);

    const body = kinematic(f.x, y, f.z,
      RAPIER.ColliderDesc.cuboid(width / 2, 1.3, 0.2)
        .setTranslation((side * width) / 2, 0, 0).setFriction(0.3));
    const q = new THREE.Quaternion();
    animated.push((t) => {
      q.setFromAxisAngle(AY, f.yaw + Math.sin(t * speed + phase) * 1.25);
      body.setNextKinematicRotation(q);
      holder.quaternion.copy(q);
    });
  }

  /** Plateforme mobile au-dessus du vide. `xc` est le centre de l'oscillation. */
  function movingPlatform(z, amplitude, phase, speed, y = 0, xc = 0) {
    const w = 4.6, d = 4.6;
    const visual = roundedBox(w, 1.0, d, C.platform, { radius: 0.45, emissive: 0x2a1150 });
    visual.position.set(xc, y - 0.5, z);
    group.add(visual);
    const body = kinematic(xc, y - 0.5, z, RAPIER.ColliderDesc.cuboid(w / 2, 0.5, d / 2).setFriction(0.9));
    animated.push((t) => {
      const x = xc + Math.sin(t * speed * Math.PI + phase) * amplitude;
      body.setNextKinematicTranslation({ x, y: y - 0.5, z });
      visual.position.x = x;
    });
  }

  // ─────────────────────────── mise en place ───────────────────────────

  // 1 — Départ, large et plat. Un barreau bas des les premiers metres : le depart doit
  // trier tout de suite, sinon les seize joueurs abordent le premier goulot en peloton.
  checkpoint(MAIN, 12);
  spinner(on(MAIN, 4), 1.05, 10, 0.85, 0);

  // 2 — Le premier virage, puis l'entonnoir a bumpers : premier goulot, premier chaos.
  checkpoint(MAIN, -21);
  for (const [z, lat] of [[-8, -3], [-10, 3], [-14, 0], [-18, -3.6], [-19, 3.6], [-23, -1.6], [-23, 1.8]]) {
    bumper(on(MAIN, z, lat));
  }
  swingDoor(on(MAIN, -24.5, -3.2), 3.0, 0, 1.3, 1);
  swingDoor(on(MAIN, -24.5, 3.2), 3.0, Math.PI, 1.3, -1);

  // 3 — Montee, virage en devers, puis le plateau des barreaux rotatifs.
  checkpoint(MAIN, -46);
  spinner(on(MAIN, -52), 1.05, 11, 1.0, 0);
  hammer(on(MAIN, -56, -3.6), 5.2, 0);
  hammer(on(MAIN, -56, 3.6), 5.2, Math.PI);
  spinner(on(MAIN, -60), 1.05, 11, -1.25, Math.PI / 2);
  // Rien entre -61 et la fourche : la descente doit rester LIBRE. Un obstacle place la
  // masque l'embranchement au moment precis ou le joueur doit choisir sa voie, et une
  // decision qu'on ne peut pas voir venir n'en est pas une.

  // 4 — EMBRANCHEMENT. Deux voies, deux paris : la gauche est courte mais balayee par
  // les pendules ; la droite est plus longue, et ses tapis roulants poussent de cote.
  // C'est la premiere decision du parcours.
  checkpoint(MAIN, -66);
  decal('arrow', on(MAIN, -65.5, -3.4), 4);
  decal('arrow', on(MAIN, -65.5, 3.4), 4);

  // Etrave de separation, plantee pile sur la ligne de partage des deux voies. Sans
  // elle, le joueur qui garde sa ligne au centre tombe dans le vide sans avoir rien vu
  // venir : une chute qu'on ne peut pas anticiper n'apprend rien et se lit comme un
  // piege. Ce bloc rend le choix physique.
  {
    const etrave = roundedBox(5.2, 1.7, 3.2, C.hazard, {
      radius: 0.5, map: hazardStripes({ a: '#ffd83d', b: '#ff7a1f', bands: 5, repeat: [4, 2] }),
    });
    const x = -5.6, z = -68.4, y = 1;
    etrave.rotation.y = Math.PI / 4;   // pointe tournee vers le joueur : elle devie au lieu d'arreter
    etrave.position.set(x, y + 0.85, z);
    group.add(etrave);
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + 0.85, z));
    const q = new THREE.Quaternion().setFromAxisAngle(AY, Math.PI / 4);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(2.6, 0.85, 1.6)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.4), b);
  }

  // Voie GAUCHE — pendules, plus courte
  pendulum(on(GAUCHE, -79), 6.0, 0);
  pendulum(on(GAUCHE, -85), 6.0, Math.PI * 0.6);
  pendulum(on(GAUCHE, -91), 6.0, Math.PI * 1.2);

  // Voie DROITE — tapis roulants et rouleaux
  roller(on(DROITE, -79.5), 0.9, 3.4, 8.6);
  roller(on(DROITE, -83.5), 0.9, -3.4, 8.6);

  // 5 — Fusion des deux voies, et la grande cote aux ballons.
  checkpoint(FUSION, -99);
  // Les deux voies debouchent ici en meme temps : quelques plots pour que la rencontre
  // se joue vraiment. C'est le seul endroit du parcours ou les deux groupes se croisent.
  for (const lat of [-5.4, 0, 5.4]) bumper(on(FUSION, -99.5, lat));

  // Cote remontante prise a contresens par les ballons : ils arrivent DE FACE, sur
  // vingt-deux metres. Trois plots au milieu de la pente : se faire renvoyer de cote
  // pendant qu'on lit la descente, c'est la ou la cote se gagne ou se perd.
  /*
   * DENSITE DES BALLONS. Chaque ballon a SA propre periode : le debit vaut donc
   * `nombre / periode`, et le nombre de ballons simultanement sur la pente vaut ce debit
   * multiplie par la duree de descente (environ 2,4 s sur vingt-deux metres).
   *
   * Sept ballons a 2,6 s donnaient 2,7 lachers par seconde, soit SEPT ballons sur la
   * pente en permanence : le pool etait sature, la cote devenait un rideau continu, et on
   * ne choisissait plus sa ligne, on encaissait. Allonger la seule periode n'y pouvait
   * pas grand-chose — c'est le nombre qui plafonnait.
   *
   * Reglage tenu par la MESURE, pas a l'oeil : un releve toutes les 0,25 s compte les
   * ballons reellement en descente, sur quinze secondes.
   *
   * Tant que les ballons ne s'arretaient jamais (voir `parquer`), la periode ne pilotait
   * rien : la passer de 6,6 a 8,0 s ne changeait la densite que de 2,95 a 2,87, et seul
   * le NOMBRE comptait. Une fois l'attente reelle, le debit vaut `nombre / periode` et la
   * descente dure 2,2 s :
   *
   *   7 / 2,6 s -> sept en permanence, pool sature : un rideau, pas une lecture
   *   4 / 8,0 s -> 1,1 de moyenne, la cote ne demande plus rien
   *   4 / 4,4 s -> deux de moyenne, des creux a zero
   *
   * C'est a ce niveau que les couloirs se rouvrent entre deux vagues et que la descente
   * redevient LISIBLE, ce que le mini-jeu demande de savoir faire. Les trois plots de la
   * pente gardent la cote dangereuse sans en faire un mur.
   */
  ballChute(FUSION, -124, -100, { nombre: 4, radius: 1.7, periode: 4.4 });
  bumper(on(FUSION, -108, -3.4));
  bumper(on(FUSION, -113, 3.1));
  bumper(on(FUSION, -118, -2.2));
  checkpoint(FUSION, -122);

  // 6 — Plateau haut, dernier filtre, puis les plateformes mobiles au-dessus du vide.
  checkpoint(FUSION, -129);
  swingDoor(on(FUSION, -130.5, -3.2), 3.0, Math.PI * 0.5, 1.5, 1);
  swingDoor(on(FUSION, -130.5, 3.2), 3.0, Math.PI * 1.5, 1.5, -1);
  movingPlatform(-136, 5.2, 2.2, 0.45, 9, -3);
  movingPlatform(-147, 5.2, -2.2, 0.62, 9, 1);

  // 7 — PATINOIRE. On n'y freine plus, et les plots sont la pour en profiter : un
  // rebond sur la glace ne se rattrape pas, il se subit jusqu'au bord.
  checkpoint(FINALE, -153);
  for (const [z, lat] of [[-159, -3.2], [-161.5, 2.6], [-164, -1.2], [-166, 3.6], [-167.5, -3.8]]) {
    bumper(on(FINALE, z, lat));
  }
  // Deux pendules au-dessus de la glace, decales : ils laissent une ligne, mais il faut
  // la tenir sans pouvoir corriger sa trajectoire.
  pendulum(on(FINALE, -160.5, -2), 7.0, 0);
  pendulum(on(FINALE, -166.5, 2), 7.0, Math.PI * 0.8);

  // 8 — TOBOGGAN puis sprint. Un barreau en bas de la glissade : on y arrive lance,
  // sans prise sur sa trajectoire — c'est le dernier filtre avant la ligne.
  spinner(on(FINALE, -188), 1.05, 12, 2.1, 0);
  checkpoint(FINALE, -190);

  // La glace ne tient plus du tout ; la glissade garde un fond d'adherence, sinon on
  // arrive en bas sans la moindre prise sur sa ligne et le barreau devient une loterie.
  glissades.push({ path: FINALE, zFrom: -156.5, zTo: -170.5, force: 1 });
  glissades.push({ path: FINALE, zFrom: -170.5, zTo: -185, force: 0.7 });

  // ── Portiques de zone ──
  // Ils donnent au parcours ce qui lui manquait le plus vu du sol : de la VERTICALITE.
  // Sans eux, tout tient dans une bande de deux metres de haut et le regard n'a aucun
  // repere de progression. Purement decoratifs — aucun collider, on passe dessous — et
  // orientes SUR le trace, donc de face quelle que soit la direction de la piste.
  function zonePortique(path, z, color) {
    const f = path.atZ(z);
    const arch = inflatableArch(f.w + 3.4, 8.2, 0.55, color);
    arch.position.set(f.x, f.y, f.z);
    arch.rotation.y = f.yaw;
    group.add(arch);
    // Guirlande tendue SOUS l'arche : elle souligne la traversee sans la recouper.
    const bt = bunting(f.w * 0.82, 9);
    bt.position.set(f.x, f.y + 6.2, f.z);
    bt.rotation.y = f.yaw;
    group.add(bt);
    return arch;
  }

  zonePortique(MAIN, -12, C.pink);
  zonePortique(MAIN, -27, C.mint);
  zonePortique(MAIN, -45, C.yellow);
  zonePortique(MAIN, -65, C.violet);
  zonePortique(GAUCHE, -74, C.rail);
  zonePortique(DROITE, -75, C.blue);
  zonePortique(FUSION, -99, C.cyan);
  zonePortique(FUSION, -114, C.pink);
  zonePortique(FUSION, -130, C.yellow);
  zonePortique(FINALE, -152, C.mint);
  zonePortique(FINALE, -170, C.blue);

  /**
   * Bornes le long de la grande cote. Sans repere vertical, vingt-deux metres de pente
   * se lisent comme un sol plat un peu penible : ce sont les mats qui defilent qui font
   * sentir qu'on MONTE, et de combien il reste.
   *
   * Volontairement SANS drapeau anime. Chaque drapeau flottant porte son propre shader
   * — donc son propre programme a compiler — et le prototype enchaine trois manches en
   * reconstruisant une arene a chaque fois. Six programmes de plus par construction
   * pour un detail qu'on croise a pleine vitesse ne valent pas leur prix.
   */
  for (const [z, cote, couleur] of [
    [-106, -1, C.pink], [-106, 1, C.cyan], [-113, -1, C.yellow], [-113, 1, C.mint],
    [-120, -1, C.violet], [-120, 1, C.pink],
  ]) {
    const f = on(FUSION, z, cote * (FUSION.atZ(z).w / 2 + 1.3));
    const mat = pill(6.2, 0.16, 0xffffff, { outline: false });
    mat.position.set(f.x, f.y - 0.6 + 3.1, f.z);
    group.add(mat);
    const fanion = roundedBox(1.9, 1.15, 0.14, couleur, { radius: 0.2, outline: 0.02 });
    fanion.position.set(f.x, f.y + 4.6, f.z);
    fanion.rotation.y = f.yaw;
    fanion.translateX(0.95);
    group.add(fanion);
    const boule = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), toonMaterial(C.rail));
    boule.position.set(f.x, f.y - 0.6 + 6.3, f.z);
    group.add(boule);
  }

  // ─────────────────────────── habillage ───────────────────────────

  // Marquages : ils jalonnent la piste et indiquent la direction. Poses sur le trace,
  // ils tournent avec lui — un chevron de travers en dit plus long qu'aucun chevron.
  decal('grid', on(MAIN, 12), 9);
  decal('arrow', on(MAIN, -13), 4.5);
  decal('rings', on(MAIN, -24), 6);
  decal('arrow', on(MAIN, -44), 4.5);
  decal('chevrons', on(MAIN, -55), 5);
  decal('chevrons', on(GAUCHE, -82), 4.5);
  decal('chevrons', on(DROITE, -90), 4.5);
  decal('rings', on(FUSION, -99), 5.5);
  decal('chevrons', on(FUSION, -119), 5);
  decal('arrow', on(FUSION, -131), 4.5);
  decal('grid', on(FINALE, -155), 9);
  decal('chevrons', on(FINALE, -177), 5.5);
  decal('grid', on(FINALE, -193), 9);

  // ── Effets d'ambiance ──
  const confetti = new ConfettiField(group, { count: 110, radius: 26, height: 22 });
  const cannons = [];

  dressStart();
  dressFinish();
  dressScenery();

  // Tous les plots relevés le long des rambardes, en un seul lot instancié.
  group.add(bollardField(plots, 1.3, 0.3, C.railPost));

  function dressStart() {
    const f = MAIN.atZ(2);
    for (const sx of [-1, 1]) {
      const post = pill(6.6, 0.44, C.finish);
      post.position.set(f.x + sx * (f.w / 2 + 0.6), f.y + 3.1, f.z);
      group.add(post);
    }
    const b = banner(f.w + 1.2, C.finish, true);
    b.position.set(f.x, f.y + 6.3, f.z);
    group.add(b);
    const flags = bunting(f.w - 1, 14);
    flags.position.set(f.x, f.y + 5.4, f.z - 3);
    group.add(flags);
  }

  /**
   * La porte d'arrivée (`arrivee.js`), posée sur la ligne et tournée avec la piste.
   * Les piliers sont 55 cm EN DEDANS du bord : la piste vole à dix-neuf mètres au-dessus
   * du relief, un pilier « à côté » n'aurait rien sous lui. Plus d'arche Meshy ni de
   * guirlande tendue en l'air à trois mètres derrière — c'était le « truc qui vole ».
   */
  function dressFinish() {
    const f = FINALE.atZ(finishZ);
    const porte = porteArrivee({ entraxe: f.w - 1.1, accent: C.pink, sol: { largeur: f.w - 0.2 } });
    porte.position.set(f.x, f.y, f.z);
    porte.rotation.y = f.yaw;
    group.add(porte);
  }

  /**
   * Décor volontairement MINIMAL.
   * La piste vole au-dessus du vide : ce qu'on regarde en courant, ce sont les montagnes,
   * les nuages et le ciel. Tout objet pose au sol encombre l'image sans etre jamais
   * regarde, et coute des triangles pour rien. On ne garde donc que ce qui compose
   * l'horizon, plus quelques arbres pour donner l'echelle du vide.
   */
  function dressScenery() {
    // Terrain en RELIEF : un seul maillage dont les cretes et falaises emergent.
    const terrain = createTerrain({ groundY: GROUND_Y, size: 1300, segments: 220 });
    group.add(terrain.mesh);
    terrainHeightAt = terrain.heightAt;

    /** Pose un modele genere : ni contour ni ombre, c'est du decor lointain. */
    function prop(name, size, x, z, { y = null, rot = 0, tint = null, shadow = false } = {}) {
      const m = partager(assets.get(name, size, { outline: 0 }));
      if (!m) return null;
      // Pose sur le relief : avec un sol ondule, une hauteur fixe fait flotter la moitie
      // des objets et enterre l'autre.
      m.position.set(x, y ?? (GROUND_Y + terrainHeightAt(x, z)), z);
      m.rotation.y = rot;
      m.traverse((c) => {
        if (!c.isMesh || c.userData.isOutline) return;
        c.castShadow = shadow;
        if (tint && c.material?.color) c.material.color.setHex(tint);
      });
      group.add(m);
      return m;
    }

    // Quelques arbres seulement, largement espaces : ils donnent l'echelle du vide
    // sans encombrer. Le terrain des references est presque nu.
    const treeSpots = [[-32, -8], [38, -34], [-42, -62], [35, -88], [-36, -118],
                       [40, -150], [-38, -178], [36, -198]];
    treeSpots.forEach(([tx, tz], i) => {
      const t = prop(i % 2 ? 'tree-round' : 'tree-pine', 8 + (i % 3) * 1.8, tx, tz,
        { rot: i * 1.7, tint: i % 2 ? 0x86e06a : 0x6ed49a });
      if (t) t.traverse((c) => { if (c.isMesh) c.castShadow = false; });
    });

    // Deux ballons tres loin, pour habiller l'espace entre sol et montagnes.
    for (const [bx, bz, r, color] of [[-46, -46, 4.2, 0xff5f7e], [50, -112, 4.6, 0x4fd1c5]]) {
      const b = balloon(r, color);
      b.position.set(bx, GROUND_Y + terrainHeightAt(bx, bz), bz);
      group.add(b);
    }

    // Trophee d'arrivee : le seul objet qui merite d'etre au sol, il marque le but.
    prop('giant-trophy', 11, -1, finishZ - 14, { shadow: true });

    // Dirigeable : le seul element mobile du ciel, il derive lentement.
    const blimp = prop('blimp', 24, -34, -76, { y: 30, rot: 0.3 });
    if (blimp) {
      animated.push((t) => {
        blimp.position.x = -34 + Math.sin(t * 0.045) * 30;
        blimp.position.y = 30 + Math.sin(t * 0.22) * 1.4;
        blimp.rotation.y = 0.3 + Math.sin(t * 0.045) * 0.25;
      });
    }
  }

  /**
   * Trajectoires jouables, pour les harnais de diagnostic : le trace se decrit lui-meme.
   * Chaque point porte aussi sa largeur et sa normale, ce qui permet de sonder les BORDS
   * et pas seulement l'axe — un collider trop etroit ne se verrait jamais au centre.
   */
  const trace = (path) => path.pts.map((p) => ({
    x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), w: +p.w.toFixed(3),
    nx: +p.nx.toFixed(4), nz: +p.nz.toFixed(4),
  }));
  const trajectoires = {
    'commun-depart': trace(MAIN),
    'voie-gauche': trace(GAUCHE),
    'voie-droite': trace(DROITE),
    'commun-fusion': trace(FUSION),
    'ilot': trace(ILOT),
    'commun-fin': trace(FINALE),
  };

  /**
   * Liberation de la manche. Les Portes et Block Dash le faisaient deja ; la Course,
   * non — et c'est elle qui pese le plus lourd : le ruban et son decor totalisent pres
   * d'un demi-million de triangles, plus un monde physique complet. Sans cette fonction,
   * chaque manche jouee laissait tout cela sur le GPU et en memoire wasm, et une partie
   * de trois manches finissait par ramer jusqu'a l'arret.
   */
  function dispose() {
    // On NE descend PAS dans les modeles Meshy. `assets.get()` renvoie un clone qui
    // PARTAGE sa geometrie avec l'original garde en cache : liberer celle d'un arbre
    // ici viderait l'arbre de toutes les manches suivantes. Ils sont marques a la pose
    // (voir `partager`) et simplement detaches.
    const liberer = (n) => {
      if (n.userData.partage) return;
      if (n.isMesh) {
        n.geometry?.dispose();
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of mats) m?.dispose?.();
      }
      for (const enfant of n.children) liberer(enfant);
    };
    liberer(group);
    group.clear();
    world.free();
  }

  return {
    world, group, spawn, finishZ, killY: -26, checkpoints, conveyors, trajectoires,
    /*
     * L'AIRE DE DÉPART — et cette carte n'en déclarait AUCUNE.
     *
     * Faute de champ, le monde retombait sur 20 m par défaut (`serveur/src/monde.js`) pour
     * un ruban qui en fait seize. Seize joueurs étalés sur vingt mètres débordaient donc
     * des deux côtés de la piste, silencieusement.
     *
     * Dérivé de `DEPART_W`, la constante qui dessine réellement le premier nœud du tracé :
     * élargir la piste élargit la déclaration, sans que personne ait à y penser.
     */
    depart: { largeur: DEPART_W - 2, profondeur: 6 },
    paths: { MAIN, GAUCHE, DROITE, FUSION, ILOT, FINALE },
    glisseAt, dispose,
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
