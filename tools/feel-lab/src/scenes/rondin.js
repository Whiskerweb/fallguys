import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { toonMaterial } from '../world.js';
import { ConfettiField, PuffSystem } from '../effects.js';
import { buildTroncon } from '../rondin.js';
import { pill, roundedBox, bunting, updateFlags, banner } from '../props.js';
import { logBark, logPath, lagoonWater, jungleCanopy, mossTurf, logRings } from '../textures.js';

/**
 * Le Rondin — mini-jeu 3.
 *
 * Quatre troncs géants alignés au-dessus d'un lagon, qui TOURNENT. On court dessus.
 *
 * ── CE QUI SE JOUE ──────────────────────────────────────────────────────────────
 * Un rondin qui tourne emporte le joueur sur le côté. Rester en haut n'est donc pas un
 * état, c'est une correction permanente : on court en biais contre la rotation. Toute la
 * difficulté du mini-jeu vient de là, et les obstacles ne font que la révéler — un fagot
 * se saute facilement quand on est centré, beaucoup moins quand on dérive déjà vers le
 * flanc.
 *
 * Trois réponses, trois obstacles :
 *   FAGOT   — un anneau complet de bâtons sanglés autour du tronc. Il fait le tour, donc
 *             on ne le contourne pas : il se SAUTE. Il impose le rythme.
 *   MUR     — une palissade haute sur une portion seulement de la circonférence. Trop
 *             haute pour être sautée, elle se CONTOURNE. Elle impose la trajectoire, et
 *             oblige à quitter la crête, c'est-à-dire à accepter la pente.
 *   TROU    — un percement qui traverse le tronc de part en part. Il ne se lit qu'à
 *             l'avance : quand il arrive sous les pieds, il est trop tard.
 *
 * ── LE SENTIER DIT L'ANGLE ──────────────────────────────────────────────────────
 * La bande de terre battue est peinte à un angle FIXE du tronc, donc elle tourne avec
 * lui. Voir le sentier dériver, c'est voir de combien le rondin a tourné, et de quel
 * côté. Sans ce repère, l'écorce est uniforme et la rotation ne se lit plus qu'aux
 * obstacles — trop tard, et seulement par intermittence.
 *
 * ── DÉTERMINISME ────────────────────────────────────────────────────────────────
 * La spec l'exige sans exception : aucun aléa dans le monde du jeu. La rotation est une
 * fonction pure du temps écoulé et d'une phase tirée de la graine de manche ; les
 * positions d'obstacles aussi. Jamais de Math.random, jamais de `dt` accumulé — la scène
 * reçoit `dt = 0` en pause, et deux clients qui divergeraient d'une image finiraient par
 * voir deux rondins différents. Les seize joueurs d'une manche voient le même tronc au
 * même angle au même instant.
 *
 * ── RÈGLE D'ASSETS ──────────────────────────────────────────────────────────────
 * Meshy ne sert qu'au décor posé hors trajectoire. Le rondin, les fagots, les murs et les
 * îlots sont en géométrie procédurale taillée exactement sur leur collider : une hitbox
 * qui ne suit pas le visuel est disqualifiante quand de l'argent est en jeu.
 */

const C = {
  ecorce: 0xc98a4b,
  chemin: 0xffffff,     // SIGNAL : la texture porte ses couleurs
  fagotA: 0xe0483c,     // rouge — le fagot qui se saute
  fagotB: 0x3f7fd6,     // bleu — même objet, autre teinte, pour rythmer le parcours
  corde: 0xebd9a8,
  mur: 0x9d5bd0,        // violet — la seule famille d'obstacle qui ne se saute pas
  murBord: 0xffc93c,
  ilot: 0x8e9aa6,
  ilotHaut: 0xb4bec7,
  depart: 0x2dd9d9,
  arrivee: 0x6ee86e,
  eau: 0xffffff,        // SIGNAL
  berge: 0xffffff,      // SIGNAL
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

/** Interrupteurs de diagnostic : ?skip=scenery,fagots,trous */
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

const R = 5.5;              // rayon du rondin
const CY = 0;               // hauteur de l'axe — la crête est donc à +5,5
const CRETE = CY + R;
const FAGOT_H = 1.05;       // franchement sous le saut de 2,15 m
/** Fagot haut : toujours sautable, mais il ne pardonne plus un saut mou. */
const FAGOT_HAUT = 1.58;
const MUR_H = 3.30;         // franchement au-dessus : il ne se saute pas
/**
 * TROU. 3,8 largeurs de corps en travers, et 3,4 m de long — soit 65 % de la portée de
 * saut. On ne le franchit donc plus d'un pas de côté : il faut le voir, et sauter.
 */
const TROU_M = 3.4;
const EAU_Y = -6.5;
const ILOT_R = 6.5;

/**
 * BANDE JOUABLE — MESURÉE, pas estimée.
 *
 * `diag/rondin.mjs` place le personnage à des inclinaisons croissantes et regarde d'où il
 * remonte encore : il tient jusqu'à 55°, et tombe à 60°. On retient 45°, avec dix degrés
 * de marge, parce que la mesure est faite touche tenue et sans obstacle.
 *
 * La première version supposait 40° et n'en mesurait aucun. La mesure a d'ailleurs
 * commencé par donner 20° — parce que le contrôleur, et non le terrain, décrochait à 33°
 * (voir `checkGround` dans `character.js`). C'est en corrigeant cela que la bande a
 * doublé, et que les palissades ont pu s'élargir.
 */
const BANDE = 0.785;

/**
 * OUVERTURE D'UNE PALISSADE.
 *
 * Une palissade doit se CONTOURNER. Il faut donc qu'il reste, d'un côté au moins, de quoi
 * passer : on exige 1,2 largeur de corps de terrain libre à l'intérieur de la bande
 * jouable. Une première version ouvrait à 1,15 rad, soit 66° — plus large que la bande
 * entière. Quand elle passait par la crête elle ne se contournait plus, elle barrait, et
 * le joueur n'avait d'autre choix que d'attendre que le tronc tourne. Un obstacle qui
 * impose l'attente dans une course n'est pas un obstacle, c'est une panne.
 */
const PASSAGE_MIN = 1.2 * PERSO_LARGE;
const MUR_OUVERTURE = 2 * Math.asin(Math.sin(BANDE) - PASSAGE_MIN / R) - 0.06;

export function buildRondin(RAPIER, assets, { seed = 1 } = {}) {
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = 1 / 60;
  const group = new THREE.Group();
  const animated = [];
  const checkpoints = [];
  const troncons = [];
  const rand = prng(seed);

  const matEcorce = toonMaterial(C.ecorce);
  matEcorce.map = logBark({ repeat: [1, 1] });
  matEcorce.side = THREE.DoubleSide;   // la paroi est une coque : on la voit de l'intérieur
  const matChemin = toonMaterial(C.chemin);
  matChemin.map = logPath({ repeat: [1, 1] });
  matChemin.side = THREE.DoubleSide;

  // ── Plan de découpe ────────────────────────────────────────────────────────────────
  // Quatre tronçons de 45 m séparés par des îlots de pierre. Un palier entre deux montées
  // de difficulté n'est pas une faveur : sans lui, la difficulté croissante se lit comme
  // une seule longue punition, et le joueur n'a jamais l'occasion de constater qu'il a
  // progressé.
  const LONG = 45, ILOT = 9;
  const DEPART_Z = 16;
  const plan = [];
  // Le premier tronçon EMPIÈTE sur la plateforme de départ. Une plateforme circulaire
  // s'amincit jusqu'à un point à son extrémité : la faire seulement se toucher au bord
  // laissait un trou de quatre mètres au-dessus du lagon, franchissable mais absurde —
  // le joueur tombait avant d'avoir vu un seul obstacle. Les îlots empiètent de la même
  // façon des deux côtés.
  let z = 10;
  // Deux fois plus vite qu'a la premiere version, ou l'on tenait la crete sans y penser.
  // A 0,55 rad/s le dernier troncon defile a 3,0 m/s sous les pieds, soit 40 % de la
  // vitesse de course : ne rien faire coute la largeur de la bande jouable en une seconde.
  const OMEGAS = [0.18, -0.30, 0.42, -0.55];
  for (let i = 0; i < 4; i++) {
    plan.push({ z0: z, z1: z - LONG, omega: OMEGAS[i], rang: i });
    z -= LONG + ILOT;
  }
  const ARRIVEE_Z = z + ILOT - 4;
  const finishZ = ARRIVEE_Z - 6;

  const spawn = new THREE.Vector3(0, CRETE + 1.6, DEPART_Z - 3);
  checkpoints.push(spawn.clone());

  // ── Plateformes fixes : départ, îlots, arrivée ─────────────────────────────────────
  /**
   * Un disque de pierre. Le collider est un TRIMESH bâti sur les sommets du cylindre
   * affiché — pas une primitive cylindre qui n'approcherait le contour qu'à 1 cm près.
   * Sur un jeu à mises, c'est la même exigence que pour le rondin lui-même.
   */
  function plateforme(zc, couleurHaut, rayon = ILOT_R) {
    const g = new THREE.CylinderGeometry(rayon, rayon, 3, 64, 1);
    const m = new THREE.Mesh(g, [
      toonMaterial(C.ilot),
      toonMaterial(couleurHaut),
      toonMaterial(C.ilot),
    ]);
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

  plateforme(DEPART_Z - 2, C.depart, 8);
  plateforme(ARRIVEE_Z, C.arrivee, 8);

  // ── Fagots et murs ─────────────────────────────────────────────────────────────────
  /**
   * Un FAGOT est un anneau de bâtons droits sanglés autour du tronc.
   *
   * Les bâtons sont droits, donc l'anneau est un polygone — et c'est juste : de vrais
   * bâtons liés autour d'un tronc ne se courbent pas. Chaque bâton porte SA capsule de
   * collision, aux mêmes cotes que la capsule affichée : le visuel EST la hitbox, il n'y
   * a rien à faire coïncider.
   *
   * Ils sont dessinés en InstancedMesh. Un anneau fait 24 bâtons ; posés un par un, les
   * neuf fagots de la carte coûteraient à eux seuls plus de deux cents appels de dessin,
   * soit le budget entier de la scène.
   */
  const BATON_R = 0.26;
  function poseFagot(tr, zLocal, teinte,
    { arcDebut = 0, arcFin = Math.PI * 2, parBague = 12, hauteur = FAGOT_H } = {}) {
    // Autant de couches que la hauteur voulue en contient. Chacune ajoute 0,53 m.
    const couches = [];
    for (let h = BATON_R; h + BATON_R <= hauteur + 0.03; h += 0.53) couches.push(h);
    const sticks = [];
    for (const h of couches) {
      const r = R + h;
      const n = Math.max(2, Math.round(parBague * (arcFin - arcDebut) / (Math.PI * 2)));
      for (let k = 0; k < n; k++) {
        const th = arcDebut + ((k + 0.5) / n) * (arcFin - arcDebut);
        // Longueur de la corde qui sous-tend le secteur : les bouts des batons se touchent.
        const len = 2 * r * Math.sin((arcFin - arcDebut) / (2 * n));
        sticks.push({ th, r, len, z: zLocal });
      }
    }
    instancier(tr, sticks, teinte);
    return sticks;
  }

  /**
   * Un MUR est une palissade haute posée sur une PORTION de la circonférence.
   *
   * Trop haut pour se sauter, il faut donc en sortir latéralement — c'est-à-dire quitter
   * la crête et accepter la pente pendant qu'on le longe. C'est le seul obstacle du
   * mini-jeu qui demande de renoncer volontairement au terrain sûr.
   */
  const PLANCHES = 6, MUR_EP = 0.34;
  function poseMur(tr, zLocal, thCentre, ouverture) {
    const axeZ = new THREE.Vector3(0, 0, 1);
    const larg = 2 * (R + MUR_H / 2) * Math.sin(ouverture / (2 * PLANCHES));
    const r = R + MUR_H / 2;
    const planches = [], lisses = [];
    for (let k = 0; k < PLANCHES; k++) {
      const th = thCentre - ouverture / 2 + ((k + 0.5) / PLANCHES) * ouverture;
      planches.push({ th, r, larg });
      const rl = R + MUR_H + 0.1;
      lisses.push({ th, r: rl, len: 2 * rl * Math.sin(ouverture / (2 * PLANCHES)) });
      const q = new THREE.Quaternion().setFromAxisAngle(axeZ, th - Math.PI / 2);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(larg * 0.47, MUR_H / 2, MUR_EP / 2)
          .setTranslation(r * Math.cos(th), r * Math.sin(th), zLocal)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.5),
        tr.body);
    }
    tr.murs = tr.murs ?? [];
    tr.murs.push({ zLocal, planches, lisses });
  }

  /**
   * Dessine TOUS les murs d'un tronçon en deux instances.
   *
   * Une palissade fait six planches et six lisses : posées une à une, les cinq murs de la
   * carte coûtaient soixante appels de dessin, un cinquième du budget de la scène pour un
   * objet qu'on croise cinq fois. Le collider, lui, reste une planche par planche : il ne
   * coûte rien à l'affichage et c'est lui qui doit rester fidèle.
   */
  function dessinerMurs(tr) {
    if (!tr.murs?.length) return;
    const axeZ = new THREE.Vector3(0, 0, 1);
    const dummy = new THREE.Object3D();
    const toutes = tr.murs.flatMap((m) => m.planches.map((p) => ({ ...p, z: m.zLocal })));
    const rails = tr.murs.flatMap((m) => m.lisses.map((l) => ({ ...l, z: m.zLocal })));

    const gp = roundedBox(toutes[0].larg * 0.94, MUR_H, MUR_EP, C.mur, { radius: 0.12 }).geometry;
    const ip = new THREE.InstancedMesh(gp, toonMaterial(C.mur), toutes.length);
    ip.castShadow = true;
    toutes.forEach((p, i) => {
      dummy.position.set(p.r * Math.cos(p.th), p.r * Math.sin(p.th), p.z);
      dummy.quaternion.setFromAxisAngle(axeZ, p.th - Math.PI / 2);
      dummy.updateMatrix();
      ip.setMatrixAt(i, dummy.matrix);
    });
    ip.instanceMatrix.needsUpdate = true;
    tr.visuel.add(ip);

    // Lisse haute : elle relie les planches et donne au mur une arête franche. Sans elle,
    // le sommet se perd sur le fond et on ne juge pas sa hauteur avant d'être dessus.
    const gl = new THREE.CapsuleGeometry(0.16, rails[0].len, 3, 8);
    const il = new THREE.InstancedMesh(gl, toonMaterial(C.murBord), rails.length);
    rails.forEach((l, i) => {
      dummy.position.set(l.r * Math.cos(l.th), l.r * Math.sin(l.th), l.z);
      dummy.quaternion.setFromAxisAngle(axeZ, l.th);
      dummy.updateMatrix();
      il.setMatrixAt(i, dummy.matrix);
    });
    il.instanceMatrix.needsUpdate = true;
    tr.visuel.add(il);
  }

  /**
   * Dessine un paquet de bâtons, et pose leurs capsules.
   *
   * UNE INSTANCE PAR LONGUEUR. Les deux couches d'un fagot ne sont pas au même rayon,
   * donc leurs bâtons n'ont pas la même corde : une instance unique bâtie sur la plus
   * longue affichait la couche intérieure trop longue de dix centimètres, alors que son
   * collider gardait la bonne cote. Un visuel plus large que sa hitbox est précisément
   * ce que ce projet s'interdit — et le harnais de géométrie ne l'aurait jamais vu,
   * puisqu'il écarte les fagots pour mesurer la paroi.
   */
  function instancier(tr, sticks, teinte) {
    const parLongueur = new Map();
    for (const s of sticks) {
      const k = s.len.toFixed(4);
      if (!parLongueur.has(k)) parLongueur.set(k, []);
      parLongueur.get(k).push(s);
    }
    const mat = toonMaterial(teinte);
    for (const lot of parLongueur.values()) instancierLot(tr, lot, mat);
  }

  function instancierLot(tr, sticks, mat) {
    const geo = new THREE.CapsuleGeometry(BATON_R, sticks[0].len, 3, 8);
    const inst = new THREE.InstancedMesh(geo, mat, sticks.length);
    inst.castShadow = true;
    const dummy = new THREE.Object3D();
    const axeZ = new THREE.Vector3(0, 0, 1);
    sticks.forEach((s, i) => {
      // La capsule de three est sur Y ; tournée de `th` autour de Z, elle devient
      // tangente au cercle. Rapier utilise la même convention, donc le même quaternion
      // sert au visuel et au collider.
      dummy.position.set(s.r * Math.cos(s.th), s.r * Math.sin(s.th), s.z);
      dummy.quaternion.setFromAxisAngle(axeZ, s.th);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);

      const q = dummy.quaternion;
      world.createCollider(
        RAPIER.ColliderDesc.capsule(s.len / 2, BATON_R)
          .setTranslation(dummy.position.x, dummy.position.y, dummy.position.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.5),
        tr.body);
    });
    inst.instanceMatrix.needsUpdate = true;
    tr.visuel.add(inst);
  }

  // ── Les quatre tronçons ────────────────────────────────────────────────────────────
  /**
   * La difficulté monte sur trois leviers à la fois, et jamais un seul : la vitesse de
   * rotation, le SENS (qui force à réapprendre le geste), et la densité d'obstacles.
   * Monter la seule vitesse aurait donné quatre fois la même épreuve, en plus dur.
   */
  const PROGRAMME = [
    { fagots: 2, murs: 1, trous: 0 },   // la dérive, et une palissade pour l'apprendre
    { fagots: 3, murs: 2, trous: 1 },   // le sens s'inverse, le premier trou apparaît
    { fagots: 3, murs: 2, trous: 3 },   // les trous deviennent la règle
    { fagots: 4, murs: 3, trous: 4 },   // tout ensemble, resserré
  ];

  /**
   * Un obstacle ne doit jamais tomber SUR un trou.
   *
   * Fagots et trous sont placés indépendamment ; en densifiant les deux, le
   * chevauchement devient probable. Un anneau de bâtons au droit d'un percement flotte
   * au-dessus du vide : le joueur lit une barrière là où il n'y a plus de sol, et se fait
   * punir pour avoir sauté correctement. On écarte donc, sans jamais sortir du tronçon.
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

  plan.forEach((p, i) => {
    const prog = PROGRAMME[i];
    const L = p.z0 - p.z1;

    // Trous : répartis sur la longueur, à un angle tiré sur la graine. L'angle décide de
    // l'INSTANT où le trou passe sous la crête — c'est lui qui fait qu'une même carte ne
    // se joue pas deux fois pareil, sans jamais changer sa géométrie.
    const trous = [];
    if (!skipped('trous')) {
      for (let k = 0; k < prog.trous; k++) {
        trous.push({
          z: -L / 2 + L * ((k + 1) / (prog.trous + 1)),
          angle: rand() * Math.PI * 2,
          arc: TROU_M / R,
          long: TROU_M,
        });
      }
    }

    const phase = rand() * Math.PI * 2;
    const tr = buildTroncon({ RAPIER, world, group }, {
      z0: p.z0, z1: p.z1, radius: R, centerY: CY,
      omega: p.omega, phase,
      // Le sentier est cale pour etre EN HAUT au depart de la manche. Sinon la phase
      // tiree au sort le place n'importe ou, et le joueur decouvre son repere de
      // rotation au hasard — parfois sous le tronc, c'est-a-dire jamais.
      angleChemin: Math.PI / 2 - phase,
      trous, matEcorce, matChemin,
    });
    troncons.push(tr);

    if (!skipped('fagots')) {
      const n = prog.fagots + prog.murs;
      // Fagots et palissades sont ENTRELACES sur la longueur, pas groupés : deux fagots
      // de suite se négocient au même geste, un fagot puis une palissade obligent à
      // changer de réponse — et c'est ce changement qui fait la difficulté.
      const ordre = [];
      for (let k = 0; k < n; k++) ordre.push(k < prog.fagots ? 'fagot' : 'mur');
      for (let k = ordre.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1));
        [ordre[k], ordre[j]] = [ordre[j], ordre[k]];
      }
      let iFagot = 0;
      ordre.forEach((quoi, k) => {
        const brut = -L / 2 + L * ((k + 0.6) / (n + 0.2));
        const zl = ecarterDesTrous(brut, trous, L / 2);
        if (quoi === 'fagot') {
          // Une hauteur sur trois est doublée : elle se saute encore, mais plus en
          // trainant les pieds. Un obstacle toujours identique cesse d'etre lu.
          const haut = iFagot % 3 === 2;
          poseFagot(tr, zl, iFagot % 2 ? C.fagotB : C.fagotA,
            { hauteur: haut ? FAGOT_HAUT : FAGOT_H });
          iFagot++;
        } else {
          poseMur(tr, zl, rand() * Math.PI * 2, MUR_OUVERTURE);
        }
      });
      dessinerMurs(tr);
    }

    // Îlot de reprise après chaque tronçon, sauf le dernier qui débouche sur l'arrivée.
    if (i < 3) {
      const zc = p.z1 - ILOT / 2;
      plateforme(zc, C.ilotHaut);
      checkpoints.push(new THREE.Vector3(0, CRETE + 1.6, zc));
    }
  });
  checkpoints.push(new THREE.Vector3(0, CRETE + 1.6, ARRIVEE_Z + 2));

  // ── Le lagon et ses berges ─────────────────────────────────────────────────────────
  function dressScenery() {
    if (skipped('scenery')) return;

    const eau = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshBasicMaterial({ map: lagoonWater({ repeat: [14, 14] }), toneMapped: false }));
    eau.rotation.x = -Math.PI / 2;
    eau.position.set(0, EAU_Y, -90);
    group.add(eau);

    // Berges : deux longues masses vertes de part et d'autre. Elles cadrent le lagon et
    // donnent au rondin son échelle — sans elles, on court au-dessus d'un plan infini et
    // la hauteur ne se sent plus.
    for (const sx of [-1, 1]) {
      const berge = new THREE.Mesh(
        new THREE.BoxGeometry(120, 7, 460),
        toonMaterial(C.berge));
      berge.material.map = mossTurf({ repeat: [10, 38] });
      berge.position.set(sx * 92, EAU_Y + 2, -90);
      berge.receiveShadow = true;
      group.add(berge);
    }

    // Rideau de jungle au loin : une texture sur un plan. À cette distance la géométrie
    // ne se lit plus et coûterait des milliers d'instances pour un résultat identique.
    for (const sx of [-1, 1]) {
      const mur = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 46),
        new THREE.MeshBasicMaterial({ map: jungleCanopy({ repeat: [11, 1] }), toneMapped: false }));
      mur.position.set(sx * 168, 16, -90);
      mur.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(mur);
    }
    const fond = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 46),
      new THREE.MeshBasicMaterial({ map: jungleCanopy({ repeat: [8, 1] }), toneMapped: false }));
    fond.position.set(0, 16, -330);
    group.add(fond);

    function prop(name, size, x, y, z, { rot = 0, shadow = false } = {}) {
      const m = assets.get(name, size, { outline: 0 });
      if (!m) return null;
      m.position.set(x, y, z);
      m.rotation.y = rot;
      m.traverse((c) => { if (c.isMesh && !c.userData.isOutline) c.castShadow = shadow; });
      group.add(m);
      return m;
    }

    // Végétation sur les berges. Les positions viennent du PRNG de manche, donc elles
    // sont les mêmes pour les seize joueurs — le décor ne doit pas être le seul élément
    // de la scène à diverger d'un client à l'autre.
    const especes = [
      ['palm-jungle', 13], ['fern-cluster-jungle', 5],
      ['bamboo-clump', 9], ['jungle-rock-plateau', 7],
    ];
    for (let i = 0; i < 26; i++) {
      const [nom, taille] = especes[i % especes.length];
      const sx = i % 2 ? 1 : -1;
      const x = sx * (34 + rand() * 60);
      const zz = 20 - rand() * 400;
      if (!prop(nom, taille * (0.75 + rand() * 0.5), x, EAU_Y + 5.4, zz, { rot: rand() * 6.28 })) {
        const p = pill(7, 0.5, 0x3fbf3f);
        p.position.set(x, EAU_Y + 8, zz);
        group.add(p);
      }
    }

    // Nénuphars posés sur l'eau, entre les berges et le rondin : ils meublent la surface
    // et rendent la chute lisible — on voit à quelle hauteur est l'eau avant d'y tomber.
    for (let i = 0; i < 18; i++) {
      const sx = i % 2 ? 1 : -1;
      prop('lily-pads-lotus', 4 + rand() * 3,
        sx * (14 + rand() * 16), EAU_Y + 0.25, 16 - rand() * 400, { rot: rand() * 6.28 });
    }

    // Portique d'arrivée, et guirlandes au départ.
    if (!prop('jungle-finish-gate', 16, 0, CRETE, ARRIVEE_Z - 3)) {
      const b = banner(12, C.arrivee, null);
      b.position.set(0, CRETE + 5, ARRIVEE_Z - 3);
      group.add(b);
    }
    const g = bunting(16, 9, [C.fagotA, C.fagotB, C.murBord]);
    g.position.set(0, CRETE + 5.5, DEPART_Z - 2);
    group.add(g);

    // Les tranches des deux bouts de chaque tronçon : des cernes de bois. Sans elles, le
    // tronc se termine sur une couronne plate qui trahit la coque.
    const matCerne = new THREE.MeshBasicMaterial({
      map: logRings(), toneMapped: false, side: THREE.DoubleSide });
    const disques = troncons.flatMap((tr) => [tr.z0 + 0.03, tr.z1 - 0.03]);
    const cernes = new THREE.InstancedMesh(
      new THREE.CircleGeometry(R - 0.02, 48), matCerne, disques.length);
    const d = new THREE.Object3D();
    disques.forEach((zz, i) => {
      d.position.set(0, CY, zz); d.updateMatrix(); cernes.setMatrixAt(i, d.matrix);
    });
    cernes.instanceMatrix.needsUpdate = true;
    group.add(cernes);
  }
  dressScenery();

  // ── Effets ─────────────────────────────────────────────────────────────────────────
  const confetti = new ConfettiField(group, { count: 90, radius: 26, height: 22 });
  const poussiere = new PuffSystem(group, { count: 24 });

  // ── Boucle ─────────────────────────────────────────────────────────────────────────
  function update(elapsed, dt, focus) {
    for (const tr of troncons) tr.setAngle(elapsed);
    updateFlags(elapsed);
    for (const fn of animated) fn(elapsed, dt);
    confetti.update(dt, elapsed, focus ?? spawn);
    poussiere.update(dt);
  }

  /**
   * Vitesse de la surface sous le joueur.
   *
   * On interroge chaque tronçon : celui qui reconnaît le point répond, les autres
   * renvoient null. Sur un îlot ou une plateforme, personne ne répond — la surface est
   * immobile, et le contrôleur retrouve son comportement habituel sans cas particulier.
   */
  function surfaceAt(p) {
    for (const tr of troncons) {
      const v = tr.surfaceAt(p);
      if (v) return v;
    }
    return null;
  }

  function reset() {
    for (const tr of troncons) tr.setAngle(0);
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
    // Un cran plus haut que le réglage par défaut : sur un tronc, c'est la COURBURE qu'il
    // faut voir. Au ras de la crête, la paroi se lit comme un sol plat et le joueur ne
    // comprend pas pourquoi il glisse sur le côté.
    camBias: { height: 1.8, distance: 1.2, lookHeight: 0.9, fov: 4 },
    update, reset, dispose, surfaceAt,
    checkpointFor(z) {
      let best = checkpoints[0];
      for (const cp of checkpoints) if (z <= cp.z + 1) best = cp;
      return best;
    },
    largeur: 2 * R,
    /** Sondes de diagnostic. */
    __troncons: () => troncons.map((tr) => ({
      z0: tr.z0, z1: tr.z1, R: tr.R, centerY: tr.centerY, omega: tr.omega,
      angle: tr.angleCourant(),
      trous: tr.trous.map((t) => ({ z: t.z, angle: t.angle, arc: t.arc, long: t.long })),
    })),
    __angle: (i, elapsed) => troncons[i].angleA(elapsed),
    __cotes: () => ({ R, CRETE, FAGOT_H, FAGOT_HAUT, MUR_H, TROU_M, PORTEE, VOL, PERSO_LARGE,
      BANDE, MUR_OUVERTURE, PASSAGE_MIN,
      // Terrain libre restant a l'interieur de la bande jouable quand une palissade
      // passe exactement par la crete. Doit rester superieur a PASSAGE_MIN.
      passageResiduel: R * (Math.sin(BANDE) - Math.sin(MUR_OUVERTURE / 2)) }),
    __ray: (ox, oy, oz, dx, dy, dz, max = 40) => {
      const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
      const hit = world.castRay(ray, max, true);
      return hit ? hit.timeOfImpact : null;
    },
  };
}
