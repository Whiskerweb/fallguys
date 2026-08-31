import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { toonMaterial } from '../world.js';
import { ConfettiField, PuffSystem } from '../effects.js';
import { buildEchine, ECHINE_CRETE_TH } from '../rondin.js';
import {
  pill, roundedBox, bunting, updateFlags, banner,
  areteEcorce, baril, pierreDeGue, pontDeCordes,
} from '../props.js';
import { createRivage } from '../terrain.js';
import {
  lagoonWater,
  boisLisse, sentierBois, anneauxBois, plankBridge, riverStone, finishChecker,
} from '../textures.js';

/**
 * Le Rondin — mini-jeu 3.
 *
 * Une chaîne d'échines de troncs géants au-dessus d'un lagon, reliées par des ponts de
 * cordes, un gué de pierres et une plaine à chicanes.
 *
 * ── CE QUI SE JOUE ──────────────────────────────────────────────────────────────
 * L'échine est LARGE et BOMBÉE. Le sommet est presque plat, donc on y court sans y
 * penser ; les flancs, eux, se dérobent de plus en plus. La difficulté n'est plus de
 * corriger une rotation, elle est de ne pas se laisser pousser vers la pente — par un
 * baril, par une arête qu'on contourne, ou simplement par son propre élan en sortie de
 * saut. Le tronc ne fait rien contre le joueur : il attend que le joueur se déporte.
 *
 * Quatre réponses, quatre obstacles :
 *   ARÊTE BASSE — un bourrelet d'écorce en travers de la crête. Il fait toute la largeur
 *                 utile, donc on ne le contourne pas : il se SAUTE. Il impose le rythme.
 *   ARÊTE HAUTE — le même bourrelet, trop haut pour être sauté, et posé sur une PORTION
 *                 seulement de la crête. Il se CONTOURNE, donc il oblige à quitter le
 *                 plat et à accepter la pente. C'est le seul obstacle qui demande de
 *                 renoncer volontairement au terrain sûr.
 *   BARIL       — un rondin qui dévale l'échine dans une voie fixe. Il ne se contourne
 *                 pas au dernier moment : il se lit de loin, et se règle au pas.
 *   TROU        — un percement qui traverse l'échine. Il ne se lit qu'à l'avance : quand
 *                 il arrive sous les pieds, il est trop tard.
 *
 * ── CE QUI A CHANGÉ DEPUIS LA VERSION PRÉCÉDENTE ────────────────────────────────
 * L'ancienne version faisait tourner un cylindre étroit (R = 5,5 m) jusqu'à 0,55 rad/s :
 * la rotation portait TOUT le mini-jeu. La référence ne joue pas cela, et la refonte a
 * été demandée sur cette base. Le tronc s'élargit à 12 m, sa rotation devient un ROULIS
 * BORNÉ de quelques degrés, et la pression temporelle passe aux barils.
 *
 * Le roulis n'est pas décoratif pour autant : c'est lui qui fait respirer le sentier de
 * terre battue, donc qui rend l'inclinaison du tronc lisible. Sans lui l'écorce est
 * uniforme et le joueur ne dispose plus d'aucun repère pour juger de quel côté il penche.
 * Il ne peut pas non plus être un tour continu : la coque n'ouvre que 140°, et un
 * demi-tour emporterait le sol sous le lagon (voir `rondin.js`).
 *
 * ── LA PENTE EST LE VRAI DANGER ─────────────────────────────────────────────────
 * `glisseAt` monte avec l'inclinaison du terrain sous le joueur, pas avec sa position :
 * ce n'est pas une zone peinte au sol, c'est la géométrie elle-même qui décide. Sur le
 * plat on ne glisse pas ; passé 22° l'adhérence s'en va ; à 50° on ne remonte plus. Le
 * joueur peut donc mordre sur le flanc — et même y gagner du terrain en contournant une
 * arête — tant qu'il ne s'y attarde pas.
 *
 * ── DÉTERMINISME ────────────────────────────────────────────────────────────────
 * La spec l'exige sans exception : aucun aléa dans le monde du jeu. Les positions
 * d'obstacles sont tirées de la graine de manche AU MOMENT DE LA CONSTRUCTION ; la
 * trajectoire des barils est une fonction pure du temps écoulé. Aucun appel à un
 * générateur pendant la partie, jamais de `dt` accumulé — la scène reçoit `dt = 0` en
 * pause. Les seize joueurs d'une manche voient le même baril au même endroit au même
 * instant.
 *
 * ── RÈGLE D'ASSETS ──────────────────────────────────────────────────────────────
 * Meshy ne sert qu'au décor posé hors trajectoire. Les échines, les arêtes, les barils,
 * le tablier du pont et les pierres du gué sont en géométrie procédurale taillée
 * exactement sur leur collider : une hitbox qui ne suit pas le visuel est disqualifiante
 * quand de l'argent est en jeu.
 */

const C = {
  ecorce: 0xd88b4a,
  chemin: 0xffffff,     // SIGNAL : la texture porte ses couleurs
  // Les arêtes n'ont PAS de texture : un aplat rouge ou bleu, et le toon shading fait le
  // reste. C'est ce que montre la référence, et c'est aussi trois mégaoctets de moins.
  areteA: 0xd93a2b,
  areteB: 0x2e6fd0,
  baril: 0xf08a45,
  // Un gris de cuirasse pour les flancs et un vert sombre pour le dessus donnaient un
  // disque moisi — et c'est la PREMIÈRE chose que voit le joueur, il naît dessus. Le
  // dessus prend la texture de sentier, qui porte ses propres couleurs : d'où le blanc.
  ilot: 0xd8b98a,
  ilotHaut: 0xffffff,
  // Le MÊME sable que la plage du rivage. Une plaine orange à côté d'une plage crème se
  // lit comme deux matières différentes, et le joueur cherche pourquoi.
  sable: 0xf7dfa8,
  depart: 0x2dd9d9,
  arrivee: 0x6ee86e,
  eau: 0xffffff,        // SIGNAL
  pierre: 0xffffff,     // SIGNAL
  planche: 0xffffff,    // SIGNAL
  // Les blocs de chicane REPRENNENT les teintes des arêtes. En vert, ils étaient la seule
  // chose verte de tout le parcours : des dalles posées là, d'un vocabulaire étranger au
  // reste. Un obstacle doit se reconnaître comme un obstacle de CETTE carte.
  bloc: 0xd93a2b,
  blocB: 0x2e6fd0,
  corde: 0xf0c75a,      // le cordage doré qui ceint chaque arête
};

/** PRNG déterministe (mulberry32) : même graine, même parcours, sur toutes les machines. */
function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Interrupteurs de diagnostic : ?skip=scenery,aretes,trous,barils */
function skipped(kind) {
  const raw = new URLSearchParams(location.search).get('skip') ?? '';
  return raw.split(',').includes(kind);
}

/**
 * COTES, toutes dérivées du personnage — aucune n'est réglée à l'œil.
 *
 * Corps de 0,90 m de large et 1,60 m de haut. Le saut culmine à 2,15 m ; sa durée de vol
 * tient compte de la gravité renforcée à la descente, sinon la portée est surestimée d'un
 * quart et tous les écartements sont faux.
 */
const PERSO_LARGE = 0.90;
const VOL = Math.sqrt(2 * TUNING.jumpHeight / TUNING.gravity)
          + Math.sqrt(2 * TUNING.jumpHeight / (TUNING.gravity * TUNING.fallMultiplier));
const PORTEE = TUNING.maxSpeed * VOL;

/**
 * RAYON DE L'ÉCHINE. 12 m contre 5,5 m auparavant.
 *
 * Ce n'est pas un réglage esthétique, c'est ce qui change le mini-jeu. À R = 5,5 m la
 * moindre dérive latérale sortait de la bande jouable en une seconde ; la crête offre ici
 * 7,1 m de terrain quasi plat, soit HUIT largeurs de corps — de la place pour manœuvrer,
 * esquiver et se tromper. La pente ne devient sévère qu'ensuite.
 *
 * 9,5 m et non 12. À 12 m le tronc mesurait vingt-quatre largeurs de corps d'un bord à
 * l'autre : à l'écran le personnage devenait un point, on ne lisait plus sa position sur
 * la courbure, et le tronc cessait d'être un rondin pour devenir une route. L'échelle se
 * juge sur le PERSONNAGE, pas sur le plan.
 */
const R = 9.5;
const CY = -9.5;            // axe sous l'eau : la crête tombe donc pile à 0
const CRETE = CY + R;       // = 0

/** Inclinaison, en radians, aux trois seuils de lecture du terrain. */
const PENTE_SURE = THREE.MathUtils.degToRad(22);   // en deçà : adhérence pleine
const PENTE_PERDUE = THREE.MathUtils.degToRad(50); // au-delà : on ne remonte plus
/** Demi-largeur de crête réellement praticable, en mètres : R·sin(22°) = 4,5 m. */
const DEMI_CRETE = R * Math.sin(PENTE_SURE);

const ARETE_BASSE = 1.05;   // franchement sous le saut de 2,15 m
const ARETE_HAUTE = 3.30;   // franchement au-dessus : elle ne se saute pas
const ARETE_EP = 0.68;

/**
 * TROU. 3,8 largeurs de corps en travers, et 3,4 m de long — soit 65 % de la portée de
 * saut. On ne le franchit donc pas d'un pas de côté : il faut le voir, et sauter.
 */
const TROU_M = 3.4;
const EAU_Y = -6.5;
const ILOT_R = 7.5;

const BARIL_R = 0.9;
const BARIL_L = 3.2;
/**
 * VITESSE DU BARIL. 8 m/s, soit un peu plus que la course (7,6 m/s).
 *
 * Il remonte l'échine à la rencontre du joueur : la vitesse de rapprochement est donc de
 * 15,6 m/s, et un baril lâché à 50 m est sur le joueur en trois secondes. C'est court,
 * mais la voie est FIXE et le tronc est dégagé : on le voit arriver dès qu'il paraît. Un
 * baril plus lent se laissait doubler par simple course, ce qui n'était plus un obstacle.
 */
const BARIL_V = 5.6;
/**
 * MARGE D'ENTRÉE du baril, en mètres.
 *
 * Il naît au-delà du bout de la section et parcourt cette distance avant d'entrer dans la
 * zone jouable. Sans elle il apparaissait PILE sur le sol praticable : un joueur qui s'y
 * trouvait était recouvert d'un coup par un collider de 0,9 m de rayon, et le solveur le
 * séparait en une image — c'est-à-dire l'expédiait à l'autre bout de la carte.
 */
const BARIL_ENTREE = 7;

/**
 * OUVERTURE D'UNE ARÊTE HAUTE.
 *
 * Elle doit se CONTOURNER. Il faut donc qu'il reste, d'un côté au moins, de quoi passer :
 * on exige 1,2 largeur de corps de terrain libre à l'intérieur de la crête praticable.
 * Une arête qui barrerait toute la crête n'imposerait pas un détour mais une chute, et un
 * obstacle sans issue dans une course n'est pas un obstacle, c'est une panne.
 */
const PASSAGE_MIN = 1.2 * PERSO_LARGE;
const ARETE_OUVERTURE = 2 * Math.asin(Math.max(0.05, Math.sin(PENTE_SURE) - PASSAGE_MIN / R));

export function buildRondin(RAPIER, assets, { seed = 1 } = {}) {
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = 1 / 60;
  const group = new THREE.Group();
  const animated = [];
  const checkpoints = [];
  const echines = [];
  const barils = [];
  const trajectoires = [];
  const rand = prng(seed);

  const matEcorce = toonMaterial(C.ecorce);
  matEcorce.map = boisLisse({ repeat: [1, 1] });
  matEcorce.side = THREE.DoubleSide;   // la paroi est une coque : on la voit de l'intérieur
  const matChemin = toonMaterial(C.chemin);
  matChemin.map = sentierBois({ repeat: [1, 1] });
  matChemin.side = THREE.DoubleSide;
  const matAnneaux = new THREE.MeshBasicMaterial({
    map: anneauxBois(), toneMapped: false, side: THREE.DoubleSide });

  const mapPlanche = plankBridge({ repeat: [1, 1] });
  const mapPierre = riverStone({ repeat: [1, 1] });

  // ── Plan de découpe ────────────────────────────────────────────────────────────────
  // Le parcours ALTERNE échine et liaison. C'est la structure de la référence, et elle est
  // délibérée : après une échine qui dérobe, il faut un segment où l'on court droit. Un
  // palier entre deux montées de difficulté n'est pas une faveur — sans lui, la difficulté
  // croissante se lit comme une seule longue punition et le joueur n'a jamais l'occasion
  // de constater qu'il a progressé.
  //
  // Toutes les sections EMPIÈTENT de 2 m sur leur voisine. Se toucher au bord ne suffit
  // pas : le lagon est deux mètres plus bas, et la moindre imprécision de raccord y verse
  // le joueur sans qu'aucun obstacle ne soit en cause.
  /**
   * LES SECTIONS SE TOUCHENT, ELLES NE SE CHEVAUCHENT PLUS.
   *
   * Chaque section empiétait de 2 m sur sa voisine, pour qu'aucun vide ne s'ouvre au
   * raccord. Entre deux surfaces plates c'était sans conséquence ; contre un CYLINDRE,
   * c'était un défaut visible : le tablier du pont, posé à la hauteur de la crête,
   * s'enfonçait de deux mètres dans le tronc et en ressortait par le flanc. Les pierres du
   * gué se retrouvaient carrément POSÉES sur le rondin.
   *
   * Les sections sont donc bord à bord, et la continuité est assurée autrement : par un
   * SEUIL posé à cheval sur chaque jonction, quelques centimètres au-dessus de la crête
   * (voir `poserSeuil`). Une planche de seuil se lit comme une pièce de charpente, alors
   * qu'un tablier à demi enfoncé se lit comme un bug.
   */
  const DEPART_Z = 16;
  let z = DEPART_Z - 6;
  const plan = [];
  function poser(type, longueur, extra = {}) {
    const s = { type, z0: z, z1: z - longueur, ...extra };
    plan.push(s);
    z -= longueur;
    return s;
  }
  // Trois échines de difficulté croissante, chacune précédée ou suivie d'une respiration.
  // ROTATION CONTINUE, et de sens alterné. Les vitesses sont relevées pour compenser le
  // rayon réduit : c'est l'ENTRAÎNEMENT AU SOL (ω·R) que le joueur ressent, pas ω. À
  // R = 9,5 m, 0,13 / 0,18 / 0,23 rad/s donnent 1,24 / 1,71 / 2,19 m/s — soit les mêmes
  // sensations qu'à R = 12 m, jusqu'à 29 % de la vitesse de course.
  //
  // Le SENS alterne parce que c'est lui qui coûte le plus au joueur : le geste appris au
  // tronçon précédent devient exactement le mauvais. Monter la seule vitesse aurait donné
  // trois fois la même épreuve, en plus dur.
  poser('pont', 12);
  poser('echine', 45, { omega: 0.13, rang: 0 });
  poser('gue', 14);
  poser('echine', 50, { omega: -0.18, rang: 1 });
  poser('pont', 14);
  poser('echine', 50, { omega: 0.23, rang: 2 });
  poser('plaine', 30);
  const ARRIVEE_Z = z - 4;
  const finishZ = ARRIVEE_Z + 2;

  /**
   * LE RIVAGE : lagon, plage, colline. Construit AVANT les sections, parce que les
   * propulseurs doivent pouvoir se poser dessus — ils étaient jusqu'ici plantés sur pilotis
   * au milieu de l'eau, où ils se lisaient comme des tables abandonnées.
   *
   * Deux tentatives ont échoué avant celle-ci, et pour la même raison : je jugeais le décor
   * sur des vues cadrées à la main, loin et haut, où l'on voit la géométrie. Le joueur, lui,
   * est à un mètre soixante au ras du tronc. À cette hauteur la version précédente ne
   * montrait QUE de l'eau jusqu'à l'horizon — toute la terre avait été repoussée hors du
   * champ pour que le relief ait la place de monter.
   *
   * D'où le principe retenu : la vue se ferme PRÈS. Une colline à quatre-vingts mètres
   * arrête le regard mieux qu'une chaîne de montagnes à quatre cents, elle coûte moins
   * cher, et elle dispense de meubler tout ce qu'il y aurait entre les deux. Le lagon est
   * resserré à vingt-quatre mètres de part et d'autre du tronc — deux largeurs et demie de
   * rondin, la proportion de la référence.
   */
  const rivage = createRivage({
    zDebut: DEPART_Z, zFin: ARRIVEE_Z, eauY: EAU_Y,
    fond: -13, lagon: 24, pente: 40, plage: 56, colline: 108, hauteur: 24, seed: 3,
  });
  const solAt = (x, z) => rivage.hauteurAt(x, z);

  const spawn = new THREE.Vector3(0, CRETE + 1.6, DEPART_Z - 3);
  checkpoints.push(spawn.clone());

  // ── Outillage commun ───────────────────────────────────────────────────────────────
  /**
   * Pose les colliders publiés par une pièce de `props.js`.
   *
   * Chaque pièce déclare ses demi-dimensions exactes dans `userData.colliders` : la scène
   * n'a donc jamais à redeviner le visuel pour placer sa boîte. C'est ce qui garantit que
   * la hitbox suit le dessin même quand la pièce évolue — si la forme change, le collider
   * change avec elle, dans le même fichier.
   */
  function poserColliders(piece, body, origine, quaternion = null) {
    const q = quaternion ?? new THREE.Quaternion();
    const v = new THREE.Vector3();
    for (const c of piece.userData.colliders ?? []) {
      v.set(c.x, c.y, c.z).applyQuaternion(q).add(origine);
      let desc;
      if (c.type === 'cuboid') desc = RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      else if (c.type === 'cylinder') desc = RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius);
      else if (c.type === 'cylinderX') {
        // Rapier n'a que le cylindre sur Y : on le couche d'un quart de tour autour de Z.
        desc = RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius);
        const qx = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).premultiply(q);
        desc.setRotation({ x: qx.x, y: qx.y, z: qx.z, w: qx.w });
      } else continue;
      if (c.type !== 'cylinderX') desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      world.createCollider(desc.setTranslation(v.x, v.y, v.z).setFriction(0.62), body);
    }
  }

  /**
   * Un disque de pierre. Le collider est un TRIMESH bâti sur les sommets du cylindre
   * affiché — pas une primitive cylindre qui n'approcherait le contour qu'à 1 cm près.
   * Sur un jeu à mises, c'est la même exigence que pour l'échine elle-même.
   */
  function plateforme(zc, couleurHaut, rayon = ILOT_R, map = null) {
    const g = new THREE.CylinderGeometry(rayon, rayon, 3, 48, 1);
    const matHaut = toonMaterial(couleurHaut);
    if (map) matHaut.map = map;
    const m = new THREE.Mesh(g, [toonMaterial(C.ilot), matHaut, toonMaterial(C.ilot)]);
    m.position.set(0, CRETE - 1.5, zc);
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, CRETE - 1.5, zc));
    const p = g.attributes.position.array;
    const idx = g.index ? Array.from(g.index.array) : [...Array(p.length / 3).keys()];
    const F = RAPIER.TriMeshFlags;
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(p), new Uint32Array(idx),
        F ? F.MERGE_DUPLICATE_VERTICES | F.FIX_INTERNAL_EDGES : undefined)
        .setFriction(0.62),
      body);
    return m;
  }

  /**
   * SEUIL de jonction : une planche à cheval sur la limite entre deux sections.
   *
   * Elle est posée 8 cm AU-DESSUS de la crête, jamais à son niveau. Deux surfaces
   * exactement coplanaires produisent un z-fighting et, si l'une des deux est courbe, une
   * interpénétration franche. Huit centimètres suffisent à s'en affranchir : le personnage
   * mesure 1,60 m, il ne sent pas une marche de cette taille, et l'œil lit une pièce de
   * charpente posée sur le rondin — ce qu'elle est.
   *
   * C'est le seuil, et lui seul, qui garantit qu'aucun vide ne s'ouvre au raccord.
   */
  function poserSeuil(zJonction) {
    const LARGE = 5.4, LONG = 3.0, EP = 0.16;
    const y = CRETE + 0.08 - EP / 2;
    const planche = roundedBox(LARGE, EP, LONG, C.planche, {
      radius: 0.06, map: mapPlanche, outline: 0.006,
    });
    planche.position.set(0, y, zJonction);
    group.add(planche);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(LARGE / 2, EP / 2, LONG / 2)
        .setTranslation(0, y, zJonction).setFriction(0.62),
      body);
  }

  // ── Arêtes d'écorce ────────────────────────────────────────────────────────────────
  /**
   * Une ARÊTE est un bourrelet segmenté posé sur une portion de la circonférence.
   *
   * Les segments suivent la COURBURE : chacun est placé à son propre angle, avec son
   * propre collider. Une barre droite en travers d'un tronc de 12 m de rayon aurait ses
   * extrémités à plus d'un mètre au-dessus de la paroi — le joueur passerait dessous par
   * les côtés, là même où le dessin lui dit qu'il est bloqué.
   *
   * Elles sont dessinées en InstancedMesh. Une arête fait jusqu'à huit segments ; posées
   * une à une, les vingt arêtes de la carte coûteraient à elles seules plus de cent appels
   * de dessin, soit un tiers du budget de la scène.
   */
  function poseArete(tr, zLocal, thCentre, ouverture, hauteur, teinte) {
    // Un segment vise 2,4 m de corde. Un anneau complet en compte donc vingt-trois, dont
    // la flèche par rapport au cercle vaut 9 cm : le bourrelet se lit comme rond, et le
    // collider suit exactement le visuel puisque les deux sont le MÊME polygone. Plus fin,
    // on paierait quarante colliders par anneau pour une différence invisible.
    const n = Math.max(2, Math.round((ouverture * R) / 2.4));
    const r = R + hauteur / 2;
    const larg = 2 * r * Math.sin(ouverture / (2 * n));
    const segments = [];
    for (let k = 0; k < n; k++) {
      const th = thCentre - ouverture / 2 + ((k + 0.5) / n) * ouverture;
      segments.push({ th, r, larg, z: zLocal });
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 0, 1), th - Math.PI / 2);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(larg * 0.5, hauteur / 2, ARETE_EP / 2)
          .setTranslation(r * Math.cos(th), r * Math.sin(th), zLocal)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.5),
        tr.body);
    }
    tr.aretes = tr.aretes ?? [];
    tr.aretes.push({ segments, hauteur, teinte, thCentre, ouverture, zLocal });
  }

  /**
   * Dessine TOUTES les arêtes d'une échine, une instance par (hauteur, teinte).
   *
   * On regroupe par gabarit et non par arête : deux arêtes basses rouges partagent
   * exactement la même géométrie de segment, donc le même InstancedMesh. Grouper par
   * arête aurait produit une instance par obstacle, c'est-à-dire le contraire du but.
   */
  function dessinerAretes(tr) {
    if (!tr.aretes?.length) return;
    const axeZ = new THREE.Vector3(0, 0, 1);
    const dummy = new THREE.Object3D();
    const lots = new Map();
    for (const a of tr.aretes) {
      const cle = `${a.hauteur.toFixed(2)}|${a.teinte}|${a.segments[0].larg.toFixed(3)}`;
      if (!lots.has(cle)) lots.set(cle, { hauteur: a.hauteur, teinte: a.teinte, segments: [] });
      lots.get(cle).segments.push(...a.segments);
    }
    for (const lot of lots.values()) {
      const s0 = lot.segments[0];
      const gabarit = roundedBox(s0.larg - 0.04, lot.hauteur, ARETE_EP, 0xffffff, {
        // Arrondi poussé au maximum : c'est lui, et non la texture, qui donne à l'arête
        // son aspect de bourrelet. La référence n'a aucun motif sur ses arêtes.
        radius: Math.min(ARETE_EP, lot.hauteur) * 0.46,
        // UNE seule subdivision, et aucun contour. Ce gabarit est instancié vingt-trois
        // fois par anneau et une dizaine d'anneaux garnissent la carte : chaque triangle
        // s'y paie au centuple. À trois subdivisions les seules arêtes pesaient 150 000
        // triangles, soit un tiers de la scène pour des bourrelets vus de loin.
        segments: 1, outline: false,
      });
      const mat = toonMaterial(lot.teinte);    // aplat : aucune texture, comme la référence
      const inst = new THREE.InstancedMesh(gabarit.geometry, mat, lot.segments.length);
      inst.castShadow = true;

      // CORDAGE. C'est la signature visuelle de la référence : chaque bourrelet est ceinturé
      // d'une corde dorée qui fait tout le tour du tronc. Sans elle, l'arête n'est qu'un
      // muret de couleur, et la map perd le détail qui la rend reconnaissable. Une seconde
      // instance suffit — un tore par segment aurait coûté un appel de dessin par obstacle.
      const geoCorde = new THREE.BoxGeometry(s0.larg, 0.20, ARETE_EP + 0.10);
      const corde = new THREE.InstancedMesh(geoCorde, toonMaterial(C.corde), lot.segments.length);
      corde.castShadow = true;

      lot.segments.forEach((s, i) => {
        dummy.position.set(s.r * Math.cos(s.th), s.r * Math.sin(s.th), s.z);
        dummy.quaternion.setFromAxisAngle(axeZ, s.th - Math.PI / 2);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        // La corde ceint le bourrelet au tiers bas : posée au milieu elle le coupe en deux
        // et l'arête se lit comme deux obstacles empilés.
        dummy.translateY(-lot.hauteur * 0.22);
        dummy.updateMatrix();
        corde.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      corde.instanceMatrix.needsUpdate = true;
      tr.visuel.add(inst, corde);
    }
  }

  // ── Barils, leurs propulseurs et leur rupture ──────────────────────────────────────
  /**
   * UN BARIL DOIT AVOIR UNE ORIGINE ET UNE FIN.
   *
   * La première version les faisait simplement apparaître et disparaître au milieu du
   * tronc. On ne savait ni d'où ils venaient ni pourquoi ils s'arrêtaient, et un obstacle
   * dont on ne comprend pas la provenance ne s'anticipe pas : il se subit. Trois temps,
   * désormais, et tous les trois VISIBLES :
   *
   *   1. LE PROPULSEUR. Une machine de bois plantée sur la berge, au bout lointain du
   *      tronçon, avec un bras qui bascule. Le joueur la voit de loin, il voit le bras
   *      partir, et il sait qu'un baril arrive avant même de l'avoir vu voler.
   *   2. LE VOL. Une parabole du propulseur jusqu'à la voie sur laquelle le baril va
   *      rouler. C'est ce vol qui annonce la voie — donc qui rend l'esquive préparable.
   *   3. LA RUPTURE. Au bout de sa course, le baril éclate contre le seuil du tronçon en
   *      une gerbe de bûchettes. Disparaître d'un coup se lisait comme un bug.
   *
   * Tout reste une fonction pure du temps écoulé : le vol, le roulé et l'éclatement sont
   * trois intervalles d'un même compte à rebours, et les éclats partent dans des directions
   * lues dans une table. Aucun appel à un générateur pendant la partie.
   */
  /**
   * VOIES de roulement, en mètres depuis la crête.
   *
   * Une table FIXE, indexée par le numéro de lâcher : c'est ce qui remplace le tirage au
   * sort que la spec interdit dans le monde du jeu. Les valeurs restent dans la crête
   * praticable (±3,56 m à R = 9,5 m) — un baril posé sur le flanc dévalerait hors de
   * portée sans jamais menacer personne.
   */
  const VOIES = [-2.6, 1.5, -0.5, 2.8, -1.7, 0.7, 2.1, -3.1];

  const T_VOL = 1.15;      // durée du vol, en secondes
  const T_CASSE = 0.85;    // durée de l'éclatement
  const N_ECLATS = 7;
  /** Directions des éclats : une table fixe, pour que la gerbe soit reproductible. */
  const ECLATS = [
    [0.9, 1.5, 0.4], [-0.8, 1.7, 0.5], [0.3, 1.2, -0.9], [-0.4, 1.9, -0.7],
    [1.2, 0.9, -0.2], [-1.1, 1.1, 0.8], [0.1, 2.1, 0.1],
  ];

  /**
   * Le propulseur, planté sur la berge. Décor pur, aucun collider : il est hors de la
   * trajectoire, et la règle d'assets n'autorise un visuel sans collider que là.
   */
  function poserPropulseur(cote, zc) {
    // SUR LA PLAGE, et non sur pilotis au milieu du lagon. Une machine posée sur l'eau
    // sans rien dessous se lit comme un meuble oublié ; posée sur le sable, elle se lit
    // comme une installation — et le baril qu'elle lance vient visiblement de la berge.
    const x = cote * 46;
    const g = new THREE.Group();
    g.position.set(x, solAt(x, zc) + 1.1, zc);
    g.rotation.y = cote > 0 ? -0.52 : 0.52;

    // Les cotes sont calees sur le BARIL (0,9 m de rayon) : la machine doit visiblement
    // pouvoir en contenir un, sinon elle se lit comme une caisse et non comme un lanceur.
    const socle = roundedBox(5.0, 2.2, 4.6, 0xb5763f, { radius: 0.3, segments: 1, outline: false });
    g.add(socle);
    // Deux pieds courts, enfoncés dans le sable : ils calent la machine sur une plage dont
    // la hauteur ondule un peu, sans jamais la faire flotter.
    for (const sx of [-1, 1]) {
      const pied = pill(3.4, 0.4, 0xa8672f, { outline: false });
      pied.position.set(sx * 2.0, -1.9, 0);
      g.add(pied);
    }
    // La goulotte pointe vers le tronc : c'est elle qui dit la direction du tir. Ouverte
    // sur le dessus, avec deux joues hautes, elle montre le chemin que prend le baril.
    const goulotte = roundedBox(2.9, 1.5, 5.2, 0xd79a5c, { radius: 0.28, segments: 1, outline: false });
    goulotte.position.set(-cote * 0.9, 1.9, 0);
    goulotte.rotation.x = -0.30;
    g.add(goulotte);
    // Un bandeau doré : c'est le seul accent de couleur, et il suffit à faire repérer la
    // machine de l'autre bout du tronçon.
    const bandeau = roundedBox(5.2, 0.4, 0.6, C.corde, { radius: 0.16, segments: 1, outline: false });
    bandeau.position.set(0, 0.9, 2.1);
    g.add(bandeau);
    // Le bras : c'est la seule pièce qui bouge, et c'est elle qui annonce le tir.
    const pivot = new THREE.Group();
    pivot.position.set(-cote * 0.9, 1.9, 2.5);
    const bras = roundedBox(2.3, 0.42, 3.6, C.corde, { radius: 0.18, segments: 1, outline: false });
    bras.position.z = -1.7;
    pivot.add(bras);
    g.add(pivot);

    group.add(g);
    return pivot;
  }

  function poseBaril(section, indice, periode, phase, cote) {
    const piece = baril(BARIL_R, BARIL_L, C.baril, { mapAnneaux: anneauxBois() });
    piece.visible = false;
    group.add(piece);

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    poserColliders(piece, body, new THREE.Vector3(0, 0, 0));
    body.setEnabled(false);

    // Les éclats : sept bûchettes réutilisées d'un éclatement à l'autre, en UNE instance.
    // Les créer à chaque rupture ferait un ramassage de mémoire par baril et par période ;
    // les poser en sept objets distincts coûtait sept appels de dessin par baril au moment
    // précis où deux ou trois éclatent ensemble — c'est-à-dire quand l'image compte le plus.
    const eclats = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.34, 0.5), toonMaterial(C.baril), N_ECLATS);
    eclats.visible = false;
    eclats.castShadow = true;
    eclats.frustumCulled = false;
    group.add(eclats);

    const zDepart = section.z1 + 2;               // où le baril touche le tronc
    const zFin = section.z0 - 0.5;                 // où il éclate, contre le seuil
    const rouleDuree = (zFin - zDepart) / BARIL_V;
    const pivot = poserPropulseur(cote, section.z1 - 3.5);
    const muzzle = new THREE.Vector3(cote * 43, EAU_Y + 2.6, section.z1 - 3.5);

    barils.push({
      piece, body, eclats, pivot, muzzle, section, indice, periode, phase, cote,
      zDepart, zFin, rouleDuree, actif: false, casse: false,
      duree: T_VOL + rouleDuree + T_CASSE,
    });
  }

  /** Objet de pose réutilisé pour les matrices d'instance : n'en allouer qu'un. */
  const poseEclat = new THREE.Object3D();

  function majBarils(elapsed) {
    for (const b of barils) {
      const t = elapsed - b.phase;
      const u = t < 0 ? -1 : t - Math.floor(t / b.periode) * b.periode;

      // Le bras du propulseur bascule juste avant le tir, puis revient. Il est animé même
      // quand le baril n'est plus visible : c'est l'annonce, elle doit précéder.
      const avant = (b.periode - 0.28);
      b.pivot.rotation.x = u >= avant ? -1.15 * ((u - avant) / 0.28)
        : u < 0.42 ? -1.15 * (1 - u / 0.42) : 0;

      // La VOIE, tirée d'une table indexée par le numéro de lâcher : pas un seul appel à un
      // générateur pendant la partie (voir l'en-tête du fichier).
      const k = Math.floor(t / b.periode);
      const voie = VOIES[(((b.indice * 7 + k) % VOIES.length) + VOIES.length) % VOIES.length];
      const th = ECHINE_CRETE_TH + voie / R;
      const rr = R + BARIL_R;
      const xVoie = rr * Math.cos(th);
      const yVoie = CY + rr * Math.sin(th);

      const montrer = (v) => { if (b.piece.visible !== v) b.piece.visible = v; };
      const activer = (v) => { if (b.actif !== v) { b.actif = v; b.body.setEnabled(v); } };
      const cacherEclats = () => {
        if (!b.casse) return;
        b.casse = false;
        b.eclats.visible = false;
      };

      if (u < 0 || u > b.duree) {
        montrer(false); activer(false); cacherEclats();
        // Position posee malgre l'invisibilite. Laissee telle quelle, elle gardait la
        // valeur du dernier appel — donc elle dependait de l'ORDRE des mises a jour, et le
        // baril cessait d'etre une fonction pure du temps. Un objet cache a quand meme un
        // etat, et cet etat doit etre reproductible.
        b.piece.position.copy(b.muzzle);
        continue;
      }

      if (u < T_VOL) {
        // ── VOL ── Parabole du propulseur jusqu'à la voie. Le collider reste ÉTEINT : un
        // baril en l'air qui bouscule est illisible, et c'est précisément le genre de
        // recouvrement soudain qui expédiait le joueur à l'autre bout de la carte.
        cacherEclats();
        const f = u / T_VOL;
        const x = b.muzzle.x + (xVoie - b.muzzle.x) * f;
        const z = b.muzzle.z + (b.zDepart - b.muzzle.z) * f;
        const yLigne = b.muzzle.y + (yVoie - b.muzzle.y) * f;
        const y = yLigne + Math.sin(Math.PI * f) * 3.4;   // la cloche du lob
        b.piece.position.set(x, y, z);
        b.piece.rotation.set(-f * 6.2, 0, f * 0.5);
        montrer(true);
        activer(false);
        continue;
      }

      if (u < T_VOL + b.rouleDuree) {
        // ── ROULÉ ── Le seul temps où le baril bouscule.
        cacherEclats();
        const parcouru = (u - T_VOL) * BARIL_V;
        const z = b.zDepart + parcouru;
        b.piece.position.set(xVoie, yVoie, z);
        // Il roule : l'angle suit la distance parcourue divisée par le rayon. Sans cela le
        // baril glisse au lieu de rouler, et on ne voit plus qu'il avance.
        b.piece.rotation.set(-parcouru / BARIL_R, 0, 0);
        montrer(true);
        activer(true);
        b.body.setNextKinematicTranslation({ x: xVoie, y: yVoie, z });
        // LE COLLIDER NE TOURNE PAS. Un cylindre est invariant par rotation autour de son
        // axe : la faire subir au collider ne change rien à sa forme, mais donne au solveur
        // une vitesse de surface qu'il transmet intégralement à qui la touche. C'est ce qui
        // expédiait le joueur à l'autre bout de la carte. Seul le MESH tourne — le roulé se
        // voit, et ne pousse plus.
        continue;
      }

      // ── RUPTURE ── Le baril s'efface, les bûchettes partent.
      montrer(false);
      activer(false);
      b.piece.position.set(xVoie, yVoie, b.zFin);   // etat defini, meme cache
      b.casse = true;
      b.eclats.visible = true;
      const f = (u - T_VOL - b.rouleDuree) / T_CASSE;
      // Ils rapetissent au lieu de s'effacer : une opacité demanderait un matériau
      // transparent par éclat, donc autant d'appels de dessin supplémentaires.
      const k2 = Math.max(0.001, 1 - f * f);
      for (let m = 0; m < N_ECLATS; m++) {
        const d = ECLATS[m];
        // Chute libre depuis le point de rupture. La gravité est celle du jeu : des éclats
        // qui retombent plus lentement que le personnage se lisent comme du papier.
        poseEclat.position.set(
          xVoie + d[0] * f * 5.5,
          yVoie + d[1] * f * 5.5 - 0.5 * TUNING.gravity * (f * T_CASSE) ** 2,
          b.zFin + d[2] * f * 5.5,
        );
        poseEclat.rotation.set(d[0] * f * 9, d[1] * f * 7, d[2] * f * 11);
        poseEclat.scale.setScalar(k2);
        poseEclat.updateMatrix();
        b.eclats.setMatrixAt(m, poseEclat.matrix);
      }
      b.eclats.instanceMatrix.needsUpdate = true;
    }
  }


  /**
   * Un obstacle ne doit jamais tomber SUR un trou.
   *
   * Arêtes et trous sont placés indépendamment ; en densifiant les deux, le chevauchement
   * devient probable. Une arête au droit d'un percement flotte au-dessus du vide : le
   * joueur lit une barrière là où il n'y a plus de sol, et se fait punir pour avoir sauté
   * correctement. On écarte donc, sans jamais sortir de la section.
   */
  function ecarterDesTrous(zl, trous, demiLong) {
    const marge = TROU_M / 2 + 1.9;
    for (let passe = 0; passe < 3; passe++) {
      for (const t of trous) {
        const d = zl - t.z;
        if (Math.abs(d) < marge) zl = t.z + (d >= 0 ? marge : -marge);
      }
    }
    return Math.max(-demiLong + 3, Math.min(demiLong - 3, zl));
  }

  // ── Construction des sections ──────────────────────────────────────────────────────
  /**
   * La difficulté monte sur trois leviers à la fois, et jamais un seul : la densité
   * d'arêtes, le nombre de trous, et l'arrivée puis le resserrement des barils. Monter un
   * seul levier aurait donné trois fois la même épreuve, en plus dur.
   */
  const PROGRAMME = [
    { anneaux: 3, arcs: 3, trous: 2, barils: 0 },   // la dérive, et le rythme du saut
    { anneaux: 3, arcs: 4, trous: 3, barils: 2 },   // les barils entrent
    { anneaux: 4, arcs: 5, trous: 4, barils: 3 },   // tout ensemble, resserré
  ];

  function construireEchine(section) {
    const prog = PROGRAMME[section.rang];
    const L = section.z0 - section.z1;

    // Trous : répartis sur la longueur, à un angle tiré sur la graine mais CONTENU dans la
    // crête praticable. Un trou sur le flanc à 60° serait sous la lèvre immergée : on
    // paierait sa géométrie sans que personne ne puisse jamais le rencontrer.
    const trous = [];
    if (!skipped('trous')) {
      for (let k = 0; k < prog.trous; k++) {
        trous.push({
          z: -L / 2 + L * ((k + 1) / (prog.trous + 1)),
          // Angle libre sur toute la circonférence : le tronc tourne, donc un trou placé
          // n'importe où finit par passer sous les pieds. C'est l'angle qui décide de
          // l'INSTANT du passage — c'est lui qui fait qu'une même carte ne se joue pas
          // deux fois pareil, sans jamais changer sa géométrie.
          angle: rand() * Math.PI * 2,
          arc: TROU_M / R,
          long: TROU_M,
        });
      }
    }

    const phase = rand() * Math.PI * 2;
    const tr = buildEchine({ RAPIER, world, group }, {
      z0: section.z0, z1: section.z1, radius: R, centerY: CY,
      omega: section.omega, phase,
      // Le sentier est calé pour être EN HAUT au départ de la manche. Sinon la phase tirée
      // au sort le place n'importe où, et le joueur découvre son repère de rotation au
      // hasard — parfois sous le tronc, c'est-à-dire jamais.
      angleChemin: ECHINE_CRETE_TH - phase,
      trous, matEcorce, matChemin, matAnneaux,
    });
    tr.section = section;
    echines.push(tr);

    if (!skipped('aretes')) {
      /**
       * LES OBSTACLES FONT LE TOUR DU TRONC.
       *
       * C'est le défaut le plus grave qu'avait cette scène. Les arêtes étaient posées
       * autour de la crête, dans le repère LOCAL du tronçon — donc elles tournaient avec
       * lui. Passé un quart de tour, elles se retrouvaient sur le flanc puis sous le
       * rondin, et il ne restait plus rien du tout à franchir sur le dessus. Le mini-jeu
       * se vidait tout seul au bout de quelques secondes.
       *
       * Deux formes, et chacune répond au problème à sa façon :
       *
       *   ANNEAU — un bourrelet qui fait le TOUR COMPLET. Quelle que soit la rotation, il
       *            y en a toujours une partie au sommet : c'est lui qui garantit qu'il y a
       *            toujours quelque chose à sauter. Il donne le rythme, et il ne se
       *            contourne pas.
       *
       *   ARC    — un bourrelet haut sur une portion seulement, et les arcs d'un tronçon
       *            sont RÉPARTIS SUR TOUTE LA CIRCONFÉRENCE. La rotation les fait défiler
       *            au sommet l'un après l'autre : celui qu'on voit arriver n'est pas celui
       *            qu'on devra contourner. C'est la rotation qui devient lisible, et le
       *            joueur qui doit anticiper.
       */
      const n = prog.anneaux + prog.arcs;
      // Anneaux et arcs sont ENTRELACÉS sur la longueur, pas groupés : deux anneaux de
      // suite se négocient au même geste, un anneau puis un arc obligent à changer de
      // réponse — et c'est ce changement qui fait la difficulté.
      const ordre = [];
      for (let k = 0; k < n; k++) ordre.push(k < prog.anneaux ? 'anneau' : 'arc');
      for (let k = ordre.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1));
        [ordre[k], ordre[j]] = [ordre[j], ordre[k]];
      }
      // Un decalage UNIQUE pour tout le troncon, tire une seule fois. Decaler chaque arc
      // separement rompait l'equidistance et rouvrait des secteurs vides de 145°, ce que
      // le harnais de couverture a rattrape.
      const decalageArcs = rand() * Math.PI * 2;
      let iArc = 0;
      ordre.forEach((quoi, k) => {
        const brut = -L / 2 + L * ((k + 0.6) / (n + 0.2));
        const zl = ecarterDesTrous(brut, trous, L / 2);
        const teinte = k % 2 ? C.areteB : C.areteA;
        if (quoi === 'anneau') {
          poseArete(tr, zl, 0, Math.PI * 2, ARETE_BASSE, teinte);
        } else {
          // Les arcs sont espacés régulièrement autour de l'axe, puis décalés par la
          // graine. Régulièrement, pour qu'aucun secteur ne reste vide quelle que soit la
          // rotation ; décalés, pour que deux manches ne présentent pas la même figure.
          const angle = decalageArcs + (iArc / Math.max(1, prog.arcs)) * Math.PI * 2;
          poseArete(tr, zl, angle, ARETE_OUVERTURE, ARETE_HAUTE, teinte);
          iArc++;
        }
      });
      dessinerAretes(tr);
    }

    if (prog.barils && !skipped('barils')) {
      // Périodes VOLONTAIREMENT non commensurables entre elles : des périodes égales
      // referaient sans cesse la même figure, et le joueur apprendrait un instant plutôt
      // qu'une lecture. Décalées, elles se recomposent longuement — ce qui reste un cycle
      // fixe, donc mémorisable, donc de la compétence et non du hasard.
      // Une période doit contenir le cycle ENTIER — vol, roulé et rupture — sinon le même
      // baril devrait être à deux endroits à la fois. Sur un tronçon de 50 m le roulé dure
      // déjà 8,5 s, d'où des périodes de l'ordre de 13 s. Ce sont les PHASES, décalées, qui
      // font qu'un baril part toutes les quatre secondes environ, et non la période.
      const periodes = [12.7, 14.3, 15.9];
      for (let i = 0; i < prog.barils; i++) {
        poseBaril(section, i, periodes[i % periodes.length],
          -(i * 4.4) - section.rang * 1.3,
          // Les propulseurs alternent de rive : deux tirs de suite du même côté et le
          // joueur cesse de surveiller l'autre.
          i % 2 ? 1 : -1);
      }
    }

    trajectoires.push({ z0: section.z0, z1: section.z1, x: 0, y: CRETE });
  }

  function construirePont(section) {
    const L = section.z0 - section.z1;
    const LARGE = 4.4;
    const piece = pontDeCordes(L, LARGE, {
      map: mapPlanche, couleur: C.planche, fleche: 0.55,
    });
    const zc = (section.z0 + section.z1) / 2;
    // Le tablier est centré sur son épaisseur : on descend le groupe d'une demi-planche
    // pour que sa FACE SUPÉRIEURE arrive au niveau de la crête, et non son axe. Le pont ne
    // déborde plus sur les tronçons voisins — c'est le seuil qui fait la jonction.
    const origine = new THREE.Vector3(0, CRETE - 0.11, zc);
    piece.position.copy(origine);
    group.add(piece);

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    poserColliders(piece, body, origine);
    trajectoires.push({ z0: section.z0, z1: section.z1, x: 0, y: CRETE });
  }

  function construireGue(section) {
    const L = section.z0 - section.z1;
    // Des pierres alternées de part et d'autre de l'axe. L'écart d'une pierre à la suivante
    // reste sous 60 % de la portée de saut : le gué se franchit en courant, il ne demande
    // pas un saut calculé. Ce n'est pas la section qui doit punir, c'est l'échine.
    // Les pierres sont RENTREES d'un rayon a chaque bout : posees jusqu'au bord, la
    // premiere et la derniere debordaient sur le tronçon voisin et se retrouvaient a
    // moitie plantees dans le cylindre.
    const MARGE = 3.0;
    const utile = L - 2 * MARGE;
    const n = Math.max(3, Math.round(utile / 3.4));
    const pas = utile / n;
    for (let i = 0; i < n; i++) {
      const zz = section.z0 - MARGE - pas * (i + 0.5);
      const cote = i % 2 ? 1 : -1;
      // Le decalage lateral reste INFERIEUR au rayon : chaque pierre couvre donc l'axe, et
      // la suite forme un chemin continu qu'on parcourt en louvoyant. Laisse libre, la
      // combinaison d'un fort decalage et d'un petit rayon produisait deux pierres d'affilee
      // qui manquaient l'axe — un vide d'un metre au-dessus du lagon, invisible a la
      // lecture du code et trouve par le harnais de continuite.
      const rayon = 2.4 + rand() * 0.5;
      const x = cote * (0.6 + rand() * 0.9);
      const piece = pierreDeGue(rayon, 2.6, C.pierre, { map: mapPierre });
      const origine = new THREE.Vector3(x, CRETE - 1.3, zz);
      piece.position.copy(origine);
      group.add(piece);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
      poserColliders(piece, body, origine);
    }
    trajectoires.push({ z0: section.z0, z1: section.z1, x: 0, y: CRETE });
  }

  function construirePlaine(section) {
    const L = section.z0 - section.z1;
    const LARGE = 22;
    const zc = (section.z0 + section.z1) / 2;

    const sol = roundedBox(LARGE, 3, L, C.sable, { radius: 0.5, outline: 0 });
    sol.position.set(0, CRETE - 1.5, zc);
    group.add(sol);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(LARGE / 2, 1.5, L / 2)
        .setTranslation(0, CRETE - 1.5, zc).setFriction(0.62),
      body);

    // CHICANES : des blocs qui laissent une ouverture, alternée d'une rangée à l'autre. La
    // plaine est plate et sans danger de chute — sa difficulté est donc entièrement de
    // trajectoire, et c'est ce qui en fait la bonne dernière section : on finit en courant
    // vite, pas en craignant de tomber.
    const rangees = 4;
    for (let i = 0; i < rangees; i++) {
      const zz = section.z0 - (L * (i + 0.7)) / (rangees + 0.4);
      const cote = i % 2 ? 1 : -1;
      const ouverture = 3.2;                       // 3,5 largeurs de corps
      /**
       * Une barrière est faite de PLOTS, pas d'une dalle.
       *
       * Un seul bloc large de huit mètres remplissait l'écran d'un aplat de couleur : à
       * hauteur de joueur on ne voyait plus la plaine, seulement une carte posée en travers.
       * Découpée en plots de deux mètres, la même barrière laisse voir ce qu'il y a derrière,
       * donne une échelle — on compte les plots — et se lit comme un parcours plutôt que
       * comme un mur. Chaque plot porte son cordage, comme les arêtes du tronc : c'est ce
       * qui rattache l'obstacle au vocabulaire de la carte.
       */
      const H = 2.3, PROF = 2.6, PLOT = 2.0;
      for (const s of [-1, 1]) {
        // Le côté « ouvert » est court, l'autre barre le reste de la plaine.
        const proche = s === cote;
        const larg = proche ? 4.4 : LARGE / 2 - ouverture;
        if (larg <= 0.4) continue;
        const n = Math.max(1, Math.round(larg / PLOT));
        const pas = larg / n;
        const x0 = s * (ouverture + larg) * (proche ? 0.55 : 1);
        for (let k = 0; k < n; k++) {
          const cx = x0 - s * (pas * (k + 0.5));
          const teinte = (i + k) % 2 ? C.blocB : C.bloc;
          // Arrondi MODÉRÉ. Poussé au maximum comme sur les arêtes du tronc, un volume
          // presque cubique devient un œuf : les arêtes du tronc sont longues et minces, un
          // plot est trapu, et le même rayon ne produit pas du tout la même lecture.
          //
          // Pas de cordage ici : posé au tiers bas d'un plot, il disparaît sous l'arrondi.
          // Vingt-quatre mailles pour un détail invisible, c'est vingt-quatre de trop.
          const plot = roundedBox(pas - 0.12, H, PROF, teinte,
            // Sans contour : vingt-quatre plots en portaient un, soit vingt-quatre mailles
            // pour un liseré que la couleur pleine rend déjà lisible à cette distance.
            { radius: Math.min(PROF, H) * 0.20, outline: false });
          plot.position.set(cx, CRETE + H / 2, zz);
          group.add(plot);
          world.createCollider(
            RAPIER.ColliderDesc.cuboid(pas / 2, H / 2, PROF / 2)
              .setTranslation(cx, CRETE + H / 2, zz).setFriction(0.5),
            body);
        }
      }
      // Un rondin bas devant la chicane : il se saute, et il oblige à choisir son côté
      // AVANT d'être dans l'ouverture plutôt qu'en la longeant.
      const rondin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, LARGE * 0.8, 12),
        toonMaterial(C.baril));
      rondin.rotation.z = Math.PI / 2;
      rondin.position.set(0, CRETE + 0.55, zz + 3.4);
      rondin.castShadow = true;
      group.add(rondin);
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      world.createCollider(
        RAPIER.ColliderDesc.cylinder(LARGE * 0.4, 0.55)
          .setTranslation(0, CRETE + 0.55, zz + 3.4)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.5),
        body);
    }
    trajectoires.push({ z0: section.z0, z1: section.z1, x: 0, y: CRETE });
  }

  // Départ : une plage large, sans avantage de position. La spec l'impose — le couloir doit
  // être assez large et la distance au premier obstacle identique pour tous, faute de quoi
  // il faudrait tirer les places au sort, ce que la même spec interdit.
  plateforme(DEPART_Z - 2, C.ilotHaut, 11, sentierBois({ repeat: [3, 3] }));

  for (const section of plan) {
    if (section.type === 'echine') construireEchine(section);
    else if (section.type === 'pont') construirePont(section);
    else if (section.type === 'gue') construireGue(section);
    else if (section.type === 'plaine') construirePlaine(section);
    // Un seuil à l'entrée de chaque section : c'est lui qui ferme le raccord, maintenant
    // que les sections ne se chevauchent plus.
    poserSeuil(section.z0);
    // Un point de reprise à l'entrée de chaque section : retomber au début de la manche
    // après quarante secondes de course est une punition sans rapport avec la faute.
    checkpoints.push(new THREE.Vector3(0, CRETE + 1.6, section.z0 - 1));
  }

  poserSeuil(plan[plan.length - 1].z1);
  plateforme(ARRIVEE_Z, C.ilotHaut, 9, sentierBois({ repeat: [3, 3] }));
  checkpoints.push(new THREE.Vector3(0, CRETE + 1.6, ARRIVEE_Z + 2));

  // ── Ligne d'arrivée ────────────────────────────────────────────────────────────────
  // Un damier posé à plat, juste avant le portique. C'est le seul repère qui dit « c'est
  // ici que ça s'arrête » : sans lui le joueur ralentit en approchant du portique, faute
  // de savoir où exactement la manche se termine.
  {
    const damier = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 2.4),
      new THREE.MeshBasicMaterial({ map: finishChecker({ repeat: [8, 1.2] }), toneMapped: false }));
    damier.rotation.x = -Math.PI / 2;
    damier.position.set(0, CRETE + 0.03, finishZ);
    group.add(damier);
  }

  // ── Le lagon et ses berges ─────────────────────────────────────────────────────────
  function dressScenery() {
    if (skipped('scenery')) return;
    const zFin = ARRIVEE_Z;
    const zMilieu = (DEPART_Z + zFin) / 2;

    const eau = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshBasicMaterial({ map: lagoonWater({ repeat: [9, 9] }), toneMapped: false }));
    eau.rotation.x = -Math.PI / 2;
    eau.position.set(0, EAU_Y, zMilieu);
    group.add(eau);

    group.add(rivage.mesh);

    // Plus de rideau de jungle en panneau texturé : c'était l'élément le plus laid du
    // décor. Un plan de 46 m de haut au sommet parfaitement horizontal se lit exactement
    // pour ce qu'il est. Le relief et la chaîne pastel ferment désormais l'horizon.



    function prop(name, size, x, y, z, { rot = 0, shadow = false } = {}) {
      const m = assets.get(name, size, { outline: 0 });
      if (!m) return null;
      m.position.set(x, y, z);
      m.rotation.y = rot;
      m.traverse((c) => { if (c.isMesh && !c.userData.isOutline) c.castShadow = shadow; });
      group.add(m);
      return m;
    }

    // Végétation sur les berges. Les positions viennent du PRNG de manche, donc elles sont
    // les mêmes pour les seize joueurs — le décor ne doit pas être le seul élément de la
    // scène à diverger d'un client à l'autre.
    const especes = [
      ['palm-jungle', 13], ['fern-cluster-jungle', 5], ['canopy-tree-tall', 15],
      ['bamboo-clump', 9], ['jungle-rock-plateau', 7], ['hanging-vines', 6],
    ];
    for (let i = 0; i < 9; i++) {
      const [nom, taille] = especes[i % especes.length];
      const sx = i % 2 ? 1 : -1;
      // Au-delà du rivage, qui se situe vers x = 34 : planter dans l'eau se verrait.
      const x = sx * (44 + rand() * 52);
      const zz = DEPART_Z - rand() * (DEPART_Z - zFin + 40);
      // POSÉ SUR LE RELIEF, et non à une hauteur fixe. Avec un sol ondulé, une cote unique
      // fait flotter la moitié des arbres et enterre l'autre — c'est la première chose
      // qu'on voit quand on remplace un sol plat par un terrain.
      if (!prop(nom, taille * (0.75 + rand() * 0.5), x, solAt(x, zz) - 0.4, zz, { rot: rand() * 6.28 })) {
        const p = pill(7, 0.5, 0x3fbf3f);
        p.position.set(x, EAU_Y + 8, zz);
        group.add(p);
      }
    }

    // Nénuphars posés sur l'eau, entre les berges et l'échine : ils meublent la surface et
    // rendent la chute lisible — on voit à quelle hauteur est l'eau avant d'y tomber.
    for (let i = 0; i < 5; i++) {
      const sx = i % 2 ? 1 : -1;
      prop('lily-pads-lotus', 4 + rand() * 3,
        sx * (17 + rand() * 15), EAU_Y + 0.25, DEPART_Z - rand() * (DEPART_Z - zFin),
        { rot: rand() * 6.28 });
    }

        // Totems de part et d'autre de la ligne d'arrivée, et guirlandes au départ.
    for (const sx of [-1, 1]) {
      prop('jungle-totem', 9, sx * 7.5, CRETE, finishZ + 0.5);
    }
    if (!prop('jungle-finish-gate', 18, 0, CRETE, ARRIVEE_Z + 1)) {
      const b = banner(12, C.arrivee, null);
      b.position.set(0, CRETE + 5, ARRIVEE_Z + 1);
      group.add(b);
    }
    const g = bunting(18, 9, [0xd93a2b, 0x2e6fd0, 0xf0c75a]);
    g.position.set(0, CRETE + 5.5, DEPART_Z - 2);
    group.add(g);

    // Montants du pont, en décor : le collider du pont est déjà posé par la pièce.
    for (const section of plan) {
      if (section.type !== 'pont') continue;
      for (const bout of [section.z0, section.z1]) {
        for (const sx of [-1, 1]) prop('rope-bridge-post', 3.4, sx * 2.5, CRETE - 0.6, bout);
      }
    }
  }
  dressScenery();

  // ── Effets ─────────────────────────────────────────────────────────────────────────
  const confetti = new ConfettiField(group, { count: 90, radius: 26, height: 22 });
  const poussiere = new PuffSystem(group, { count: 24 });

  // ── Boucle ─────────────────────────────────────────────────────────────────────────
  function update(elapsed, dt, focus) {
    for (const tr of echines) tr.setAngle(elapsed);
    majBarils(elapsed);
    updateFlags(elapsed);
    for (const fn of animated) fn(elapsed, dt);
    confetti.update(dt, elapsed, focus ?? spawn);
    poussiere.update(dt);
  }

  /**
   * Vitesse de la surface sous le joueur.
   *
   * On interroge chaque échine : celle qui reconnaît le point répond, les autres renvoient
   * null. Sur un pont, un gué ou la plaine, personne ne répond — la surface est immobile,
   * et le contrôleur retrouve son comportement habituel sans cas particulier.
   */
  function surfaceAt(p) {
    for (const tr of echines) {
      const v = tr.surfaceAt(p);
      if (v) return v;
    }
    return null;
  }

  /**
   * Adhérence perdue sous le joueur, de 0 à 1.
   *
   * C'est la GÉOMÉTRIE qui décide, pas une zone peinte : on lit l'inclinaison réelle du
   * terrain sous les pieds. En deçà de 22° on court normalement ; au-delà l'adhérence part
   * progressivement, et à 50° elle a disparu. Le joueur peut donc mordre sur le flanc pour
   * contourner une arête, et même y gagner du terrain — tant qu'il n'y reste pas.
   *
   * Le seuil bas n'est pas nul par prudence : à 22° exactement, un plafond franc ferait
   * basculer l'adhérence d'un pas à l'autre et le joueur lirait un bug. La rampe rend la
   * perte progressive, donc rattrapable.
   */
  function glisseAt(p) {
    let pire = 0;
    for (const tr of echines) {
      const pente = tr.penteAt(p);
      if (pente === null) continue;
      const t = (pente - PENTE_SURE) / (PENTE_PERDUE - PENTE_SURE);
      const g = Math.max(0, Math.min(1, t));
      if (g > pire) pire = g;
    }
    return pire * 0.85;
  }

  function reset() {
    for (const tr of echines) tr.setAngle(0);
    majBarils(0);
  }

  /** Libère le monde physique et les géométries : une arène quittée ne doit rien retenir. */
  function dispose() {
    confetti.dispose?.();
    poussiere.dispose?.();
    group.traverse((c) => {
      if (c.isMesh) {
        // Les modèles Meshy partagent leur géométrie entre les clones : la libérer ici
        // laisserait la scène suivante avec des modèles vides.
        if (!c.userData.partage) c.geometry?.dispose();
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        // Les textures viennent d'un cache PARTAGÉ entre les scènes : ne pas les libérer.
        for (const m of mats) m?.dispose?.();
      }
    });
    group.clear();
    world.free();
  }

  return {
    world, group, spawn, finishZ, killY: EAU_Y - 5, checkpoints, conveyors: [], seed,
    objectif: 'COURIR À L’ARRIVÉE !',
    // Un cran plus haut et plus reculé que le réglage par défaut : sur une échine large,
    // c'est la COURBURE qu'il faut voir, et les barils doivent se lire de loin. Au ras de
    // la crête la paroi se lit comme un sol plat, et on ne comprend pas pourquoi on glisse.
    // Plus PRÈS qu'avant, et à peine plus haut. Le réglage précédent reculait la caméra
    // pour embrasser un tronc de 24 m de large ; le personnage y devenait un point et on
    // ne lisait plus sa position sur la courbure. C'est le personnage qui doit rester
    // lisible — la largeur du tronc se devine, sa propre inclinaison non.
    camBias: { height: 1.9, distance: 0.4, lookHeight: 0.8, fov: 3 },
    update, reset, dispose, surfaceAt, glisseAt,
    checkpointFor(z) {
      let best = checkpoints[0];
      for (const cp of checkpoints) if (z <= cp.z + 1) best = cp;
      return best;
    },
    largeur: 2 * DEMI_CRETE,
    trajectoires,
    /** Sondes de diagnostic. */
    __echines: () => echines.map((tr) => ({
      z0: tr.z0, z1: tr.z1, R: tr.R, centerY: tr.centerY, omega: tr.omega,
      angle: tr.angleCourant(),
      trous: tr.trous.map((t) => ({ z: t.z, angle: t.angle, arc: t.arc, long: t.long })),
    })),
    __sections: () => plan.map((s) => ({ type: s.type, z0: s.z0, z1: s.z1 })),
    /** Arêtes d'un tronçon, avec leur couverture angulaire : de quoi vérifier qu'il reste
     *  toujours quelque chose au sommet, quelle que soit la rotation. */
    __aretes: () => echines.map((tr) => (tr.aretes ?? []).map((a) => ({
      thCentre: a.thCentre, ouverture: a.ouverture, hauteur: a.hauteur, zLocal: a.zLocal,
    }))),
    __jonctions: () => plan.map((s) => s.z0).concat([plan[plan.length - 1].z1]),
    __barils: () => barils.map((b) => ({
      indice: b.indice, periode: b.periode, phase: b.phase, duree: b.duree,
      zDepart: b.zDepart, zFin: b.zFin, rouleDuree: b.rouleDuree,
      actif: b.actif, casse: b.casse, z: b.piece.position.z, x: b.piece.position.x,
    })),
    __angle: (i, elapsed) => echines[i].angleA(elapsed),
    __cotes: () => ({
      R, CRETE, CY, DEMI_CRETE, ARETE_BASSE, ARETE_HAUTE, TROU_M, PORTEE, VOL, PERSO_LARGE,
      PENTE_SURE, PENTE_PERDUE, ARETE_OUVERTURE, PASSAGE_MIN, BARIL_R, BARIL_V, EAU_Y,
      // Terrain libre restant a l'interieur de la crete praticable quand une arete haute
      // est posee au centre. Doit rester superieur a PASSAGE_MIN.
      passageResiduel: R * (Math.sin(PENTE_SURE) - Math.sin(ARETE_OUVERTURE / 2)),
      // Entrainement lateral a la crete, en m/s : omega * R pour chaque troncon. C'est la
      // grandeur que le joueur ressent, et la seule qui dise si la rotation « se voit ».
      entrainement: echines.map((e) => +(Math.abs(e.omega) * R).toFixed(2)),
    }),
    __ray: (ox, oy, oz, dx, dy, dz, max = 40) => {
      const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
      const hit = world.castRay(ray, max, true);
      return hit ? hit.timeOfImpact : null;
    },
  };
}
