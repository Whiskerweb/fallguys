import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { toonMaterial } from '../world.js';
import { pill, updateFlags, slabMesh, neonArch } from '../props.js';
import { neonGrid, starfield, floorMarkings } from '../textures.js';

/**
 * Block Dash — un PARCOURS, pas une file d'obstacles.
 *
 * ── CE QUI MANQUAIT AUX DEUX VERSIONS PRÉCÉDENTES ───────────────────────────────
 * Elles alignaient des obstacles sur une passerelle droite et plate. Le joueur franchissait
 * un mur, puis le suivant, sans que rien ne relie les deux : pas de dénivelé, pas de
 * virage, pas d'élan à conserver, pas de choix à faire. Un parcours qui ne raconte rien.
 *
 * ── LES CINQ ACTES ──────────────────────────────────────────────────────────────
 *  1. LANCEMENT    — descente et tremplin, sans obstacle. On installe la vitesse.
 *  2. LE GANTELET  — slalom serré à enchaîner sans s'arrêter.
 *  3. L'EMBRANCHEMENT — route haute courte et exposée, ou route basse longue et sûre.
 *  4. LA DESCENTE  — la piste tourne et plonge, obstacles placés dans les virages.
 *  5. LE FINAL     — le sol se dérobe derrière soi ; s'arrêter, c'est tomber.
 *
 * Chaque acte a une SENSATION propre : accélérer, enchaîner, choisir, tourner, fuir.
 * C'est cette succession qui fait un parcours, là où quinze murs identiques n'en font pas.
 *
 * ── LES COTES VIENNENT DU PERSONNAGE ────────────────────────────────────────────
 * 0,90 m de large, 1,60 m de haut, 7,6 m/s, saut de 2,15 m culminant en 0,74 s de vol,
 * soit 5,66 m de portée. Toutes les hauteurs, largeurs et fossés en découlent.
 */

const C = {
  bord: 0x22e8ff,
  barriere: 0xffc83d,
  pilier: 0xff2ed2,
  balayeuse: 0x8b5cf6,
  tremplin: 0x3ee87a,
  tapis: 0x22e8ff,
  fuyante: 0xff6b9d,
  arrivee: 0x3ee87a,
  edge: 0x6b5cff,
  preavis: 0xffd84d,
};

/* ── Cotes dérivées du personnage ─────────────────────────────────────────────── */
const PERSO_LARGE = 0.90;
const SAUT = TUNING.jumpHeight;
/*
 * Temps de vol REEL. La descente subit fallMultiplier (1,35) : le personnage retombe
 * plus vite qu'il ne monte, un classique du game feel qui rend le saut punchy. La
 * formule symetrique 2·sqrt(2h/g) l'ignorait et surestimait la portee de 40 cm — assez
 * pour qu'un fosse calibre dessus soit infranchissable. Controle mesure : 5,32 m sur
 * piste plate (diag/portee.mjs) contre 5,27 m predits ici.
 */
const VOL = Math.sqrt(2 * SAUT / TUNING.gravity)
  + Math.sqrt(2 * SAUT / (TUNING.gravity * TUNING.fallMultiplier));
const PORTEE = TUNING.maxSpeed * VOL;                      // 5,66 m

const H_BARRIERE = 1.05;
const H_PILIER = 2.9;
const H_BALAYEUSE = 0.75;
const PASSAGE_LARGE = PERSO_LARGE * 2.4;                   // 2,16 m
const PASSAGE_SERRE = PERSO_LARGE * 1.6;                   // 1,44 m
/*
 * PORTEE suppose la vitesse MAXIMALE au décollage. Un joueur qui sort d'un virage, se
 * relève d'une culbute ou saute au jugé décolle plus lentement : sa portée réelle est
 * mesurée est de 5,32 m (diag/portee.mjs), proche de la théorie. Le vrai coût est
 * ailleurs : un joueur ne saute pas au centimètre près. Il déclenche environ 1,5 m avant
 * le bord et doit retomber au moins 0,5 m après — soit 2 m à réserver. Le fossé
 * réellement jouable plafonne donc vers 3,3 m, pas 4,4. Calibrés à 0,55 et 0,78, les
 * fossés se rataient de 30 cm après un saut pourtant bien déclenché : ce n'est pas de la
 * difficulté, c'est une punition arbitraire. La difficulté vient de la densité des
 * obstacles et de l'étroitesse des voies, jamais d'un fossé à la limite du possible.
 */
const FOSSE_FACILE = PORTEE * 0.40;                        // 2,3 m
const FOSSE_DUR = PORTEE * 0.55;                           // 3,1 m

function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function skipped(kind) {
  const raw = new URLSearchParams(location.search).get('skip') ?? '';
  return raw.split(',').includes(kind);
}

export function buildBlockDash(RAPIER, assets, { seed = 1 } = {}) {
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = 1 / 60;
  const group = new THREE.Group();
  const animated = [];
  const checkpoints = [];
  const conveyors = [];
  const tremplins = [];
  const fuyantes = [];
  const obstacles = [];
  const rand = prng(seed);

  /*
   * Le spawn est A 1,8 M AU-DESSUS de la piste, pas posé dessus.
   *
   * Placé à 0,4 m du sol, le personnage naissait ENCASTRÉ : sa capsule descend de 0,8 m
   * sous son centre, donc ses pieds traversaient la dalle. Le solveur l'expulsait alors
   * violemment et sa position partait en NaN — après quoi toutes les comparaisons de
   * zones du moteur devenaient fausses, ce qui déclenchait le tremplin à vide. Un seul
   * chiffre mal choisi rendait la map entièrement injouable, sans lever la moindre erreur.
   */
  const spawn = new THREE.Vector3(0, 15.8, 22);
  const finishZ = -204;   // sur la piste solide, apres les dalles fuyantes
  const grille = neonGrid({ repeat: [3, 16] });

  function addBody(mesh, px, py, pz, colliderDesc, parent = group) {
    mesh.position.set(px, py, pz);
    parent.add(mesh);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz));
    world.createCollider(colliderDesc, body);
    return body;
  }

  // ─────────────────────────── briques de piste ───────────────────────────

  /** Segment horizontal. */
  function piste(xc, zFrom, zTo, largeur, y) {
    const len = Math.abs(zTo - zFrom);
    if (len < 0.1) return;
    const zc = (zFrom + zTo) / 2;
    const mesh = slabMesh(largeur, 1.1, len, 0xffffff, C.edge, { radius: 0.35, map: grille });
    addBody(mesh, xc, y - 0.55, zc,
      RAPIER.ColliderDesc.cuboid(largeur / 2, 0.55, len / 2).setFriction(0.6));
    bordures(xc, zc, largeur, len, y, 0);
  }

  /**
   * Segment INCLINÉ. C'est lui qui donne son relief au parcours.
   * L'angle est atan2(dy, dz) : avec atan2(dy, -dz) la dalle sort retournée, face
   * inférieure vers le ciel — l'erreur ne se voit pas sur le collider, qui est
   * symétrique, seulement sur le maillage.
   */
  function rampe(xc, zFrom, zTo, yFrom, yTo, largeur) {
    const dz = Math.abs(zTo - zFrom), dy = yTo - yFrom;
    const len = Math.hypot(dz, dy);
    const pente = Math.atan2(dy, dz);
    const zc = (zFrom + zTo) / 2, yc = (yFrom + yTo) / 2;
    const mesh = slabMesh(largeur, 1.1, len, 0xffffff, C.edge, { radius: 0.35, map: grille });
    mesh.rotation.x = pente;
    mesh.position.set(xc, yc - 0.55, zc);
    group.add(mesh);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pente);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(xc, yc - 0.55, zc));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(largeur / 2, 0.55, len / 2)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.6), body);
    bordures(xc, zc, largeur, len, yc, pente);
  }

  /**
   * Segment en DIAGONALE : la piste change de direction.
   * Sans lui le parcours ne peut être qu'un couloir aligné sur Z, et le joueur ne tourne
   * jamais la tête.
   */
  function pisteDiagonale(x1, z1, x2, z2, largeur, y1, y2 = y1) {
    const dx = x2 - x1, dz = z2 - z1, dy = y2 - y1;
    const lenH = Math.hypot(dx, dz);                  // longueur au sol
    const len = Math.hypot(lenH, dy);                 // longueur réelle de la dalle
    const yaw = Math.atan2(-dx, -dz);
    const pente = Math.atan2(dy, lenH);
    const xc = (x1 + x2) / 2, zc = (z1 + z2) / 2, yc = (y1 + y2) / 2;
    const mesh = slabMesh(largeur, 1.1, len, 0xffffff, C.edge, { radius: 0.35, map: grille });
    mesh.rotation.set(pente, yaw, 0, 'YXZ');          // le lacet d'abord, l'inclinaison ensuite
    mesh.position.set(xc, yc - 0.55, zc);
    group.add(mesh);
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pente));
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(xc, yc - 0.55, zc));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(largeur / 2, 0.55, len / 2)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.6), body);
    // Tubes de bord orientés le long de la diagonale, pente comprise.
    for (const sx of [-1, 1]) {
      const nx = Math.cos(yaw), nz = -Math.sin(yaw);
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, len, 8),
        new THREE.MeshBasicMaterial({ color: C.bord, toneMapped: false }));
      tube.rotation.set(Math.PI / 2 + pente, yaw, 0, 'YXZ');
      tube.position.set(xc + sx * nx * (largeur / 2 + 0.1), yc + 0.12, zc + sx * nz * (largeur / 2 + 0.1));
      group.add(tube);
    }
  }

  function bordures(xc, zc, largeur, len, y, pente) {
    for (const sx of [-1, 1]) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, len, 8),
        new THREE.MeshBasicMaterial({ color: C.bord, toneMapped: false }));
      tube.rotation.x = Math.PI / 2 + pente;
      tube.position.set(xc + sx * (largeur / 2 + 0.1), y + 0.12, zc);
      group.add(tube);
    }
  }

  // ─────────────────────────── éléments actifs ───────────────────────────

  /** TREMPLIN — le niveau prend la main : il projette, on corrige en vol. */
  /*
   * La HAUTEUR de la piste est un paramètre, pas une constante.
   *
   * Le tremplin était posé à y = 0,3 sur une piste située à y = 2 : le moteur ignore les
   * zones dont le joueur s'écarte de plus de 1,8 m en hauteur, donc il ne s'est jamais
   * déclenché. Le joueur arrivait au bord du vide sans être propulsé et tombait — sans
   * la moindre erreur pour le signaler. Toute zone d'effet doit connaître son sol.
   */
  function tremplin(xc, z, largeur, force, y = 0) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(largeur, 0.5, 3.2),
      new THREE.MeshBasicMaterial({ color: C.tremplin, toneMapped: false }));
    mesh.position.set(xc, y + 0.3, z);
    group.add(mesh);
    const chevrons = new THREE.Mesh(
      new THREE.PlaneGeometry(largeur * 0.8, 2.6),
      new THREE.MeshBasicMaterial({
        map: floorMarkings('chevrons', { color: '#ffffff', alpha: 0.9 }),
        transparent: true, depthWrite: false, toneMapped: false }));
    chevrons.rotation.x = -Math.PI / 2;
    chevrons.position.set(xc, y + 0.56, z);
    group.add(chevrons);
    // Fenêtre verticale large : le joueur arrive en courant, parfois en léger vol.
    tremplins.push({
      minX: xc - largeur / 2, maxX: xc + largeur / 2,
      minZ: z - 1.8, maxZ: z + 1.8, y: y + 1.0, force,
    });
    obstacles.push({ type: 'tremplin', z, force, y });
  }

  /** TAPIS — accélère ou freine. Le moteur applique déjà les zones `conveyors`. */
  function tapis(xc, zFrom, zTo, largeur, y, vz) {
    const len = Math.abs(zTo - zFrom), zc = (zFrom + zTo) / 2;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(largeur, len),
      new THREE.MeshBasicMaterial({
        map: floorMarkings('chevrons', { color: '#7cf6ff', alpha: 0.85 }),
        transparent: true, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(xc, y + 0.06, zc);
    group.add(mesh);
    conveyors.push({
      minX: xc - largeur / 2, maxX: xc + largeur / 2,
      minZ: Math.min(zFrom, zTo), maxZ: Math.max(zFrom, zTo), y: y + 0.8, vx: 0, vz,
    });
    obstacles.push({ type: 'tapis', z: zc, vz });
  }

  /*
   * La barriere doit connaitre la HAUTEUR de sa piste.
   *
   * Elle n'avait aucun parametre y et se posait toujours a 0. Sur les pistes a y=2 elle
   * etait donc entierement enterree — invisible et sans effet ; dans l'acte 4, sur une
   * piste a y=-4, elle flottait quatre metres en l'air. Aucune des cinq barrieres du
   * parcours ne barrait quoi que ce soit, ce qui vidait l'obstacle le plus lisible du
   * jeu de sa substance sans provoquer la moindre erreur.
   */
  function barriere(xc, z, largeur, { trous = [], y = 0 } = {}) {
    if (skipped('obstacles')) return;
    const segments = [];
    let debut = xc - largeur / 2;
    for (const [tx, tw] of trous.slice().sort((a, b) => a - b)) {
      if (tx - tw / 2 > debut) segments.push([debut, tx - tw / 2]);
      debut = tx + tw / 2;
    }
    if (debut < xc + largeur / 2) segments.push([debut, xc + largeur / 2]);
    for (const [g, d] of segments) {
      const w = d - g;
      if (w < 0.2) continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, H_BARRIERE, 0.9), toonMaterial(C.barriere));
      mesh.castShadow = true;
      addBody(mesh, (g + d) / 2, y + H_BARRIERE / 2, z,
        RAPIER.ColliderDesc.cuboid(w / 2, H_BARRIERE / 2, 0.45));
      const arete = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.14, 0.96),
        new THREE.MeshBasicMaterial({ color: 0x1b1030, toneMapped: false }));
      arete.position.set((g + d) / 2, y + H_BARRIERE, z);
      group.add(arete);
    }
    obstacles.push({ type: 'barriere', z, trous, y });
  }

  function piliers(z, positions, { largeurPassage = PASSAGE_LARGE, mobile = false, periode = 3, y = 0 } = {}) {
    if (skipped('obstacles')) return;
    const corps = [];
    for (const [i, x] of positions.entries()) {
      const w = largeurPassage * 0.62;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, H_PILIER, 1.1), toonMaterial(C.pilier));
      mesh.castShadow = true;
      mesh.position.set(x, y + H_PILIER / 2, z);
      group.add(mesh);
      const body = world.createRigidBody(
        (mobile ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed())
          .setTranslation(x, y + H_PILIER / 2, z));
      world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, H_PILIER / 2, 0.55), body);
      const bande = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.55, H_PILIER * 0.8),
        new THREE.MeshBasicMaterial({ color: 0xffa8ee, toneMapped: false }));
      bande.position.z = 0.56;
      mesh.add(bande);
      if (mobile) corps.push({ body, mesh, x, y: y + H_PILIER / 2, phase: (i / positions.length) * Math.PI * 2 + rand() });
    }
    if (mobile) {
      const amplitude = largeurPassage * 0.5;
      animated.push((t) => {
        for (const c of corps) {
          const nx = c.x + Math.sin(t * (Math.PI * 2 / periode) + c.phase) * amplitude;
          c.mesh.position.x = nx;
          c.body.setNextKinematicTranslation({ x: nx, y: c.y, z });
        }
      });
    }
    obstacles.push({ type: 'piliers', z, positions, mobile });
  }

  function balayeuse(xc, z, largeur, { vitesse = 5, retard = 0, y = 0 } = {}) {
    if (skipped('obstacles')) return;
    const longueur = largeur * 0.42;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(longueur, H_BALAYEUSE, 0.75), toonMaterial(C.balayeuse));
    mesh.castShadow = true;
    group.add(mesh);
    const bande = new THREE.Mesh(
      new THREE.BoxGeometry(longueur, 0.1, 0.8),
      new THREE.MeshBasicMaterial({ color: 0xd6c2ff, toneMapped: false }));
    bande.position.y = H_BALAYEUSE / 2;
    mesh.add(bande);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(xc, y + H_BALAYEUSE / 2, z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(longueur / 2, H_BALAYEUSE / 2, 0.375), body);
    const course = largeur + longueur;
    animated.push((t) => {
      const u = (((t - retard) * vitesse) % course + course) % course;
      const x = xc - course / 2 + u;
      mesh.position.set(x, y + H_BALAYEUSE / 2, z);
      body.setNextKinematicTranslation({ x, y: y + H_BALAYEUSE / 2, z });
    });
    obstacles.push({ type: 'balayeuse', z, vitesse });
  }

  /**
   * DALLE FUYANTE — elle tombe peu après le passage du joueur.
   *
   * C'est le seul obstacle qui interdit de s'arrêter. Tous les autres se négocient à
   * l'arrêt ; celui-ci retire le sol sous les pieds de qui hésite, et transforme la
   * dernière ligne droite en course contre soi-même.
   */
  function dalleFuyante(xc, z, largeur, longueur, y) {
    const mesh = slabMesh(largeur, 0.9, longueur, 0xffffff, C.fuyante, { radius: 0.3, map: grille });
    mesh.position.set(xc, y - 0.45, z);
    group.add(mesh);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(xc, y - 0.45, z));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(largeur / 2, 0.45, longueur / 2).setFriction(0.6), body);
    fuyantes.push({ mesh, body, x: xc, z, y: y - 0.45, chute: -1, tombee: 0 });
  }

  function decal(kind, xc, z, size, y = 0) {
    const tex = floorMarkings(kind, { color: '#7cf6ff', alpha: 0.7 });
    if (!tex) return;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75,
        depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(xc, y + 0.05, z);
    group.add(m);
  }

  function liseréVide(xc, z, largeur) {
    const bord = new THREE.Mesh(
      new THREE.PlaneGeometry(largeur, 0.7),
      new THREE.MeshBasicMaterial({ color: C.preavis, transparent: true, opacity: 0.75,
        depthWrite: false, toneMapped: false }));
    bord.rotation.x = -Math.PI / 2;
    bord.position.set(xc, 0.06, z);
    group.add(bord);
  }

  // ═══════════════════════ ACTE 1 — LANCEMENT ═══════════════════════
  // Aucune obstacle : une descente et un tremplin. On installe la vitesse et le vide
  // avant de demander quoi que ce soit. Un parcours qui attaque par un obstacle ne
  // laisse pas le temps de comprendre où l'on est.
  piste(0, 26, 14, 18, 14);
  tapis(0, 24, 15, 14, 14, -11);                     // lance le joueur dans la descente
  rampe(0, 14, -2, 14, 2, 18);
  piste(0, -2, -14, 18, 2);
  /*
   * Le tremplin est dimensionné, pas deviné. Vol = 2·force/g, portée = vitesse·vol.
   * Avec force 21 et g=31 : 1,35 s en l'air, 10,3 m parcourus à pleine vitesse. Posé à
   * z=-11,5 il dépose donc à z≈-21,8, soit 1,8 m après le bord opposé (-20).
   * Placé à -8 avec force 15 il ne portait que 7,3 m : le joueur retombait DANS le vide.
   */
  tremplin(0, -11.5, 12, 21, 2);
  liseréVide(0, -14, 18);
  decal('chevrons', 0, 6, 6, 14);

  const ACTES = Number(new URLSearchParams(location.search).get('actes') || 5);

  if (ACTES >= 2) {
  // ═══════════════════════ ACTE 2 — LE GANTELET ═══════════════════════
  // Slalom serré, à enchaîner sans s'arrêter. Le tremplin de l'acte 1 y dépose le joueur
  // lancé : c'est le premier endroit où l'élan compte.
  piste(0, -20, -58, 16, 2);
  piliers(-24, [-5.5, 0.5, 6], { y: 2 });
  piliers(-30, [-8, -2.5, 3, 8.5], { y: 2 });
  piliers(-36, [-6, 1], { largeurPassage: PASSAGE_SERRE, y: 2 });
  barriere(0, -42, 16, { trous: [[-5, PASSAGE_LARGE], [5, PASSAGE_LARGE]], y: 2 });
  piliers(-48, [-4, 4], { mobile: true, periode: 3.4, y: 2 });
  barriere(0, -54, 16, { trous: [[0, PASSAGE_LARGE]], y: 2 });
  decal('rings', 0, -57, 6, 2);

  }
  if (ACTES >= 3) {
  // ═══════════════════════ ACTE 3 — L'EMBRANCHEMENT ═══════════════════════
  /*
   * Deux routes, deux paris, et elles sont SUPERPOSÉES : la haute passe au-dessus de la
   * basse. Le joueur voit donc l'autre route sous ses pieds, ce qui rend le choix
   * tangible — un embranchement où l'on ne voit pas l'option écartée n'est qu'un couloir.
   *
   *  · HAUTE : rampe raide, piste étroite (7 m), balayeuses, mais 20 m plus courte.
   *  · BASSE : reste au niveau, large (16 m), fossés à franchir, plus longue.
   */
  /*
   * PALIER D'AIGUILLAGE, pleine largeur.
   *
   * Sans lui, la rampe (x=-5,5) et la voie basse (x=5) laissaient une fente de 2,5 m
   * exactement dans l'axe du joueur : l'acte 2 débouche centré sur x=0, donc quiconque
   * courait droit tombait ENTRE les deux routes. Un embranchement doit se choisir, pas
   * se subir — le joueur pose d'abord les pieds sur un sol continu, voit les deux
   * options, puis s'engage. Les deux routes se recouvrent ensuite de 50 cm à la
   * séparation : aucun interstice où glisser.
   */
  piste(1, -58, -66, 20, 2);

  // Route HAUTE — étroite et exposée. Pas de bordure haute : tomber est le prix.
  rampe(-5.5, -66, -78, 2, 11, 8);
  piste(-5.5, -78, -104, 7, 11);
  balayeuse(-5.5, -84, 7, { vitesse: 5.5, y: 11 });
  balayeuse(-5.5, -92, 7, { vitesse: -6, retard: 0.7, y: 11 });
  barriere(-5.5, -94, 7, { trous: [[-5.5, PASSAGE_SERRE]], y: 11 });
  balayeuse(-5.5, -100, 7, { vitesse: 6.5, retard: 1.4, y: 11 });
  rampe(-5.5, -104, -114, 11, 2, 7);

  /*
   * Route BASSE — large, mais il faut sauter. Trois fossés, dont un exigeant.
   *
   * ESPACE DE RELANCE avant chaque saut. La barrière se trouvait 4 m avant le fossé
   * dur : on en sortait sans élan et la portée tombait à 3,7 m au lieu de 5,3 — le
   * fossé devenait infranchissable pour une raison invisible, située ailleurs que là
   * où le joueur meurt. Chaque fossé a maintenant au moins 7 m de piste libre en amont.
   */
  piste(5, -66, -74, 12, 2);
  liseréVide(5, -74, 12);
  piste(5, -74 - FOSSE_FACILE, -86, 12, 2);
  barriere(5, -79, 12, { trous: [[2, PASSAGE_LARGE]], y: 2 });   // 7 m de relance avant -86
  liseréVide(5, -86, 12);
  piste(5, -86 - FOSSE_DUR, -100, 12, 2);
  piliers(-92, [2, 8], { y: 2 });                          // 8 m de relance avant -100
  liseréVide(5, -100, 12);
  piste(5, -100 - FOSSE_FACILE, -114, 12, 2);

  // Fusion des deux routes.
  pisteDiagonale(-5.5, -114, 0, -122, 10, 2);
  pisteDiagonale(5, -114, 0, -122, 12, 2);
  decal('grid', 0, -120, 7, 2);

  }
  if (ACTES >= 4) {
  // ═══════════════════════ ACTE 4 — LA DESCENTE ═══════════════════════
  // La piste tourne ET plonge. Les obstacles sont posés DANS les virages : on ne peut
  // plus tracer tout droit, il faut lire la courbe et l'obstacle ensemble.
  /*
   * Les diagonales DESCENDENT au lieu de sauter d'un palier à l'autre. Elles étaient
   * plates : à chaque jonction le sol perdait 2 m d'un coup, et le joueur tombait d'une
   * marche invisible au lieu de dévaler une pente. Chaque obstacle est calé à mi-pente,
   * là où il se trouve réellement.
   */
  piste(0, -122, -130, 14, 2);
  pisteDiagonale(0, -130, -11, -142, 12, 2, 0);
  piliers(-136, [-9, -4], { largeurPassage: PASSAGE_SERRE, y: 1 });
  pisteDiagonale(-11, -142, 0, -154, 12, 0, -2);
  balayeuse(-5, -148, 14, { vitesse: -5.5, y: -1 });
  pisteDiagonale(0, -154, 10, -164, 12, -2, -4);
  barriere(5, -159, 12, { trous: [[8, PASSAGE_LARGE]], y: -3 });
  rampe(10, -164, -172, -4, -6, 12);

  }
  if (ACTES >= 5) {
  // ═══════════════════════ ACTE 5 — LE FINAL ═══════════════════════
  /*
   * Le sol se dérobe derrière le joueur. C'est le seul moment du parcours où s'arrêter
   * est fatal : les quatre actes précédents se négocient à l'arrêt, celui-ci non.
   * La ligne d'arrivée est en vue dès l'entrée — on voit ce qu'on peut perdre.
   */
  piste(10, -172, -178, 12, -6);
  const dalleL = 4.4;
  const NB_DALLES = 4;
  for (let i = 0; i < NB_DALLES; i++) {
    dalleFuyante(10, -178 - i * dalleL, 12, dalleL - 0.3, -6);
  }
  /*
   * SOL SOLIDE avant la ligne. La version precedente ecrivait
   * piste(10, -200, -178 - 5 * dalleL, ...), soit piste(10, -200, -200) : une piste de
   * longueur NULLE. Il n'existait donc aucun sol apres les dalles, et la ligne
   * d'arrivee elle-meme reposait sur la derniere dalle fuyante — franchir se jouait
   * a la seconde pres, sans que rien ne l'annonce. On termine sur du dur.
   */
  const finDalles = -178 - NB_DALLES * dalleL;       // -195,6
  piste(10, finDalles, -212, 12, -6);
  tapis(10, -184, finDalles, 10, -6, -6);            // le tapis pousse vers l'arrivée

  }

  checkpoints.push(
    // Chaque relance place aussi le personnage AU-DESSUS du sol, jamais dedans.
    new THREE.Vector3(0, 15.8, 22),
    new THREE.Vector3(0, 3.8, -20),
    new THREE.Vector3(0, 3.8, -56),
    new THREE.Vector3(2, 3.8, -118),
    new THREE.Vector3(0, 3.8, -126),
    new THREE.Vector3(8, -4.2, -170),
  );

  // ─────────────────────────── décor ───────────────────────────

  dressScenery();

  function dressScenery() {
    if (skipped('scenery')) return;
    const ciel = new THREE.Mesh(
      new THREE.SphereGeometry(460, 28, 18),
      new THREE.MeshBasicMaterial({
        map: starfield({ repeat: [11, 5] }), side: THREE.BackSide, toneMapped: false, fog: false }));
    group.add(ciel);

    function prop(name, size, x, y, z) {
      const m = assets.get(name, size, { outline: 0 });
      if (!m) return null;
      m.position.set(x, y, z);
      m.traverse((c) => { if (c.isMesh) c.castShadow = false; });
      group.add(m);
      return m;
    }

    const arche = neonArch(10, 0.32);
    arche.position.set(0, 14.2, 24);
    group.add(arche);
    const archeFin = neonArch(8, 0.32);
    archeFin.position.set(10, -5.8, finishZ);
    group.add(archeFin);
    const ligne = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 1.2),
      new THREE.MeshBasicMaterial({ color: C.arrivee, transparent: true, opacity: 0.85, toneMapped: false }));
    ligne.rotation.x = -Math.PI / 2;
    ligne.position.set(10, -5.95, finishZ);
    group.add(ligne);

    // Pylônes le long du tracé, en suivant ses virages.
    for (const [x, y, z] of [[-12, 12, 16], [12, 0, -30], [-14, 9, -84], [14, 0, -90],
                             [-18, 0, -140], [16, -4, -166], [20, -6, -190]]) {
      if (!prop('neon-pylon', 8, x, y, z)) {
        const p = pill(6, 0.2, C.bord);
        p.position.set(x, y + 3, z);
        group.add(p);
      }
    }
    for (const [dx, dy, dz] of [[-13, 18, -10], [14, 14, -80], [-15, 6, -150]]) {
      const d = prop('neon-drone', 3.6, dx, dy, dz);
      if (d) animated.push((t) => { d.position.y = dy + Math.sin(t * 0.7 + dx) * 0.8; });
    }
  }

  // ─────────────────────────── vie de la scène ───────────────────────────

  /**
   * Les dalles fuyantes s'effondrent APRÈS le passage, jamais devant.
   * Le déclencheur est le passage du joueur, pas une horloge : une dalle qui tombe avant
   * qu'il n'arrive punirait une hésitation qu'il n'a pas eue, et la section deviendrait
   * une loterie de tempo.
   */
  function majFuyantes(dt, focus) {
    for (const f of fuyantes) {
      if (f.chute < 0) {
        if (focus && focus.z < f.z + 1.2 && Math.abs(focus.x - f.x) < 7) f.chute = 0.35;
        continue;
      }
      if (f.chute > 0) { f.chute -= dt; continue; }
      f.tombee += dt;
      const y = f.y - f.tombee * f.tombee * 9;
      f.mesh.position.y = y;
      f.body.setNextKinematicTranslation({ x: f.x, y, z: f.z });
      f.mesh.rotation.z = f.tombee * 0.5;
    }
  }

  function update(elapsed, dt = 0.016, focus = null) {
    updateFlags(elapsed);
    for (const fn of animated) fn(elapsed, dt || 0.016);
    majFuyantes(dt || 0.016, focus);
  }

  /** Remet les dalles fuyantes en place quand la manche redémarre. */
  function reset() {
    for (const f of fuyantes) {
      f.chute = -1; f.tombee = 0;
      f.mesh.position.set(f.x, f.y, f.z);
      f.mesh.rotation.z = 0;
      f.body.setNextKinematicTranslation({ x: f.x, y: f.y, z: f.z });
    }
  }

  function dispose() {
    group.traverse((c) => {
      if (c.isMesh) {
        c.geometry?.dispose();
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) m?.dispose?.();
      }
    });
    group.clear();
    world.free();
  }

  return {
    world, group, spawn, finishZ, killY: -30, checkpoints, conveyors, tremplins, seed,
    ambiance: 'nuit',
    camBias: { height: 1.4, distance: 3.0, lookHeight: 0.6, fov: 3 },
    update, reset, dispose,
    checkpointFor(z) {
      let best = checkpoints[0];
      for (const cp of checkpoints) if (z <= cp.z + 1) best = cp;
      return best;
    },
    __obstacles: () => obstacles.map((o) => ({ ...o })),
    __cotes: () => ({
      persoLarge: PERSO_LARGE, saut: SAUT, portee: PORTEE,
      hBarriere: H_BARRIERE, hPilier: H_PILIER, hBalayeuse: H_BALAYEUSE,
      passageLarge: PASSAGE_LARGE, passageSerre: PASSAGE_SERRE,
      fosseFacile: FOSSE_FACILE, fosseDur: FOSSE_DUR,
    }),
    __fuyantes: () => fuyantes.map((f) => ({ z: f.z, tombee: f.tombee, declenchee: f.chute >= 0 })),
    // Sonde de rayon : distance jusqu'au premier solide, ou -1. Sert au pilote de test —
    // il doit trouver le sol par lui-meme au lieu qu'on lui donne la liste des obstacles,
    // sinon on ne mesure que la justesse de la liste.
    __ray: (ox, oy, oz, dx, dy, dz, max = 40) => {
      const h = world.castRay(
        new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }), max, true);
      return h ? h.timeOfImpact : -1;
    },
    largeur: 16,
  };
}
