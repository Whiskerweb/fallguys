import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { toonMaterial } from '../world.js';
import { ConfettiField, PuffSystem } from '../effects.js';
import { pill, bunting, updateFlags, pennant, banner } from '../props.js';
import { tileFace, skyMeadow, cloudBank } from '../textures.js';

/**
 * Les Dalles — mini-jeu 4.
 *
 * Un damier de dalles jetées au-dessus du vide. Un seul chemin le traverse ; toutes les
 * autres dalles cèdent sous le pied.
 *
 * ── CE QUI SE JOUE ──────────────────────────────────────────────────────────────
 * Ce mini-jeu ne se gagne pas à la course, il se gagne à la LECTURE. Rien, dans une
 * dalle, ne dit si elle porte : la seule façon de le savoir est de poser le pied dessus,
 * c'est-à-dire de payer. Ce que le joueur exploite ensuite n'est pas une observation du
 * terrain mais la MÉMOIRE des dalles déjà tombées — les trous derrière lui sont la
 * carte, et ils s'accumulent.
 *
 * C'est exactement la dynamique des Portes, transposée d'un mur à un plan : celui qui
 * mène défriche pour tous ceux qui suivent, et savoir quand suivre plutôt que mener est
 * une compétence à part entière. La différence tient au coût — une porte qui cède est
 * gratuite, une dalle qui cède fait tomber.
 *
 * ── LE SURSIS ───────────────────────────────────────────────────────────────────
 * Une dalle piégée ne disparaît pas à l'instant du contact : elle TREMBLE d'abord, puis
 * lâche. Ce délai est ce qui transforme le mini-jeu en jeu d'adresse plutôt qu'en pur
 * tirage — il autorise le pas de sonde, où l'on avance d'une dalle et où l'on se retire
 * avant qu'elle ne parte. Il se raccourcit de section en section (0,36 s → 0,16 s) : la
 * lecture reste la même, c'est le droit à l'erreur qui s'éteint.
 *
 * Une dalle qui a commencé à trembler est PERDUE, même si on se retire. Sans cela, le
 * pas de sonde deviendrait gratuit et le damier ne se dévoilerait jamais.
 *
 * ── AUCUN INDICE, JAMAIS ────────────────────────────────────────────────────────
 * L'invariant central, et il structure tout ce fichier : l'apparence d'une dalle dépend
 * de sa POSITION, jamais de son état. Même teinte, même face, même altitude, même
 * absence d'animation. Les dalles ne respirent pas non plus — sur les Portes, la
 * respiration devait être universelle pour ne rien trahir ; ici, la solution honnête est
 * plus simple encore, puisqu'un damier immobile se lit mieux qu'un damier qui ondule.
 *
 * ── DÉTERMINISME ────────────────────────────────────────────────────────────────
 * La spec l'exige sans exception : aucun aléa dans le monde du jeu. Le chemin dérive
 * d'une graine passée en paramètre, jamais de Math.random. En multijoueur le serveur
 * impose la graine aux seize joueurs, qui affrontent alors le même damier, aux mêmes
 * emplacements. C'est cette égalité stricte qui rend le sacrifice du premier utile aux
 * autres — s'ils jouaient des chemins différents, l'information ne circulerait pas.
 *
 * ── RÈGLE D'ASSETS ──────────────────────────────────────────────────────────────
 * Meshy ne sert qu'au décor posé hors trajectoire. Les dalles et les plateformes sont
 * des boîtes procédurales dont le collider est le cuboïde EXACT du visuel : une hitbox
 * qui ne suit pas le visuel est disqualifiante quand de l'argent est en jeu — et sur ce
 * mini-jeu-ci elle serait pire qu'ailleurs, puisque le joueur juge du bord d'une dalle
 * à dix centimètres près.
 */

const C = {
  dalle: 0xe8a81e,      // le corps de la dalle : l'or foncé, c'est lui qui dessine le joint
  face: 0xffd24a,       // MOTIF teinté : la face du dessus
  bordure: 0xff8a1f,
  pierre: 0x9a8570,
  herbe: 0xffffff,      // SIGNAL
  depart: 0x2dd9d9,
  /*
   * PALIER : DE L'HERBE, PAS DE L'OR.
   *
   * Le jaune d'origine était à trois points du jaune des dalles. Vu de la piste, le
   * palier se lisait comme une grande dalle de plus — c'est-à-dire comme un piège
   * potentiel — alors qu'il est précisément le seul endroit du parcours où l'on ne risque
   * rien. Le repos doit se voir de loin, sinon il ne repose pas.
   */
  palier: 0xffffff,             // SIGNAL : la texture d'herbe porte la couleur
  arrivee: 0x6ee86e,
  nuage: 0xffffff,      // SIGNAL
  fanionA: 0x2e9bf5,
  fanionB: 0xff8a1f,
};

/** PRNG déterministe (mulberry32) : même graine, même damier, sur toutes les machines. */
function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Interrupteurs de diagnostic : ?skip=scenery */
function skipped(kind) {
  const raw = new URLSearchParams(location.search).get('skip') ?? '';
  return raw.split(',').includes(kind);
}

/**
 * COTES, toutes dérivées du personnage — aucune n'est réglée à l'œil.
 *
 * Corps de 0,90 m de large. Le saut culmine à 2,15 m ; sa durée de vol tient compte de la
 * gravité renforcée à la descente, sinon la portée est surestimée d'un quart.
 */
const PERSO_LARGE = 0.90;
const VOL = Math.sqrt(2 * TUNING.jumpHeight / TUNING.gravity)
          + Math.sqrt(2 * TUNING.jumpHeight / (TUNING.gravity * TUNING.fallMultiplier));
const PORTEE = TUNING.maxSpeed * VOL;

/**
 * DALLE de 2,4 m — 2,7 largeurs de corps.
 *
 * C'est la cote qui décide de tout le mini-jeu. Plus petite, on ne tient plus dessus sans
 * déborder sur les voisines et le pas de sonde devient impossible ; plus grande, deux
 * dalles ne se distinguent plus à la course et le damier cesse d'être une grille de
 * décisions. Le jeu de 16 cm entre deux dalles est là pour être VU : sans lui les dalles
 * se soudent en un plancher continu et l'unité de choix disparaît.
 */
const DALLE = 2.4;
const JEU = 0.16;
const PAS = DALLE + JEU;
const EP = 0.9;               // épaisseur : assez pour lire un trou de profil
/**
 * AFFAISSEMENT du tremblement. La dalle — visuel ET collider — descend de cette hauteur
 * pendant son sursis. Elle doit rester très inférieure à la marge de sol du contrôleur,
 * sinon le joueur décrocherait avant que la dalle ne lâche et le sursis ne servirait plus
 * à rien : il serait tombé sans avoir eu le temps de se retirer.
 */
const AFFAISSEMENT = 0.07;
const SOL = 0;                // altitude du dessus des dalles
const KILL_Y = SOL - 16;

/**
 * Un pas de côté fait un PAS de 2,56 m, une diagonale 3,62 m — les deux très en dessous
 * de la portée de saut. C'est voulu : ce mini-jeu n'est pas un jeu de saut, et un écart
 * qui obligerait à sauter transformerait chaque sonde en engagement irréversible.
 */
const DIAGONALE = PAS * Math.SQRT2;

/** Trois sections, séparées par des paliers de pierre qui sont autant de points de reprise. */
const SECTIONS = [
  // La première apprend la règle : damier étroit, chemin peu tortueux, sursis long.
  { cols: 9, rangs: 12, ecart: 1, sursis: 0.36 },
  // La deuxième élargit le damier — il y a plus de mauvaises réponses par rang.
  { cols: 11, rangs: 15, ecart: 1, sursis: 0.24 },
  // La troisième ajoute l'écart de deux colonnes et retire le droit à l'erreur.
  { cols: 13, rangs: 17, ecart: 2, sursis: 0.16 },
];

const PLATEAU = 9;            // profondeur d'un palier
const DEPART_Z = 14;

/**
 * Trace le chemin sûr d'une section.
 *
 * Le chemin est une marche qui, à chaque rang, se décale latéralement puis avance d'un
 * rang. Les dalles TRAVERSÉES par le décalage sont sûres elles aussi : sans elles le
 * chemin serait relié en diagonale, deux dalles ne se touchant alors que par un coin. Le
 * joueur devrait franchir ce coin en aveugle, et le rayon de sol du contrôleur, qui part
 * du centre du corps, pourrait ne rien trouver pendant une image. On garantit donc une
 * connexité par les ARÊTES : d'une dalle sûre, il existe toujours une voisine sûre
 * partageant un côté entier.
 *
 * Effet de bord voulu : un décalage large laisse un rang à deux ou trois dalles sûres,
 * c'est-à-dire un palier de repos à l'intérieur de la section. Ils sont rares, et ils
 * arrivent là où le chemin vire — donc exactement là où le joueur a besoin de temps.
 */
function tracerChemin(cols, rangs, ecart, rand, colDepart) {
  const sur = [];
  let c = Math.max(0, Math.min(cols - 1, colDepart));
  let droit = 0;
  for (let r = 0; r < rangs; r++) {
    let d;
    if (droit >= 3) {
      // Quatre rangs de suite en ligne droite et le chemin se devine de loin : le joueur
      // n'a plus qu'à courir tout droit. On impose le virage plutôt que d'espérer.
      d = rand() < 0.5 ? -1 : 1;
    } else {
      const u = rand();
      d = u < 0.30 ? 0
        : u < 0.85 ? (rand() < 0.5 ? -1 : 1)
        : (rand() < 0.5 ? -ecart : ecart);
    }
    let c2 = c + d;
    // Rebond sur le bord : on repart de l'autre côté plutôt que de coller à la paroi.
    // Un chemin qui longe un bord pendant trois rangs se devine aussi sûrement qu'une
    // ligne droite, le bord divisant par deux le nombre de mauvaises réponses.
    if (c2 < 0 || c2 > cols - 1) c2 = c - d;
    c2 = Math.max(0, Math.min(cols - 1, c2));
    const rang = new Set();
    for (let k = Math.min(c, c2); k <= Math.max(c, c2); k++) rang.add(k);
    sur.push(rang);
    droit = c2 === c ? droit + 1 : 0;
    c = c2;
  }
  return { sur, colSortie: c };
}

export function buildDalles(RAPIER, assets, { seed = 1 } = {}) {
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = 1 / 60;
  const group = new THREE.Group();
  const checkpoints = [];
  const sections = [];
  const rand = prng(seed);

  const spawn = new THREE.Vector3(0, SOL + 1.2, DEPART_Z);

  // ── Plateformes pleines ────────────────────────────────────────────────────────────
  /**
   * Un palier de pierre coiffé d'herbe.
   *
   * Le collider est un cuboïde, et un cuboïde est la forme EXACTE d'une boîte : ici la
   * fidélité visuel/hitbox est acquise par construction, contrairement au disque de
   * pierre du Rondin qui exigeait un trimesh pour ne pas mentir de un centimètre.
   */
  function palier(zc, largeur, teinte, { profondeur = PLATEAU } = {}) {
    const H = 3.2;
    const g = new THREE.BoxGeometry(largeur, H, profondeur);
    const dessus = toonMaterial(teinte);
    // Un palier intermédiaire porte l'herbe ; le départ et l'arrivée gardent leur teinte
    // pleine, qui les désigne comme les deux bouts du parcours.
    if (teinte === C.palier) {
      dessus.map = skyMeadow({ repeat: [Math.round(largeur / 5), Math.round(profondeur / 5)] });
    }
    const m = new THREE.Mesh(g, [
      toonMaterial(C.pierre), toonMaterial(C.pierre),
      dessus, toonMaterial(C.pierre),
      toonMaterial(C.pierre), toonMaterial(C.pierre),
    ]);
    // Le dessus affleure exactement le dessus des dalles : un ressaut, même de deux
    // centimètres, accroche le pied à pleine vitesse et se lit comme un bug.
    m.position.set(0, SOL - H / 2, zc);
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, SOL - H / 2, zc));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(largeur / 2, H / 2, profondeur / 2).setFriction(0.62), body);

    // Bordure d'herbe sur le pourtour du dessus : elle donne au palier une épaisseur
    // lisible depuis la caméra, qui le voit presque de dessus.
    // Débordement en X seulement. En Z, le palier touche le damier bord à bord : une
    // marge de 15 cm y ferait entrer le bandeau dans le volume de la première dalle.
    const herbe = new THREE.Mesh(
      new THREE.BoxGeometry(largeur + 0.3, 0.28, profondeur), toonMaterial(C.herbe));
    herbe.material.map = skyMeadow({ repeat: [Math.round(largeur / 6), Math.round(profondeur / 6)] });
    herbe.position.set(0, SOL - 0.42, zc);
    group.add(herbe);
    return m;
  }

  // ── Le damier ──────────────────────────────────────────────────────────────────────
  const matCorps = toonMaterial(C.dalle);
  const matFace = toonMaterial(C.face);
  matFace.map = tileFace();

  const geoCorps = new THREE.BoxGeometry(DALLE, EP, DALLE);
  // La face est un simple quad posé 12 mm au-dessus du corps : une dalle coûte ainsi
  // deux triangles de plus, pas une boîte de plus. Elle est plus PETITE que le corps,
  // jamais plus grande — la silhouette visible reste celle du collider, à la dalle près.
  const geoFace = new THREE.PlaneGeometry(DALLE * 0.94, DALLE * 0.94);
  geoFace.rotateX(-Math.PI / 2);

  const dummy = new THREE.Object3D();

  /**
   * Construit une section : ses dalles, ses colliders, ses deux InstancedMesh.
   *
   * DEUX APPELS DE DESSIN POUR TOUT UN DAMIER. Six cents dalles posées une à une
   * coûteraient plus de mille appels — quatre fois le budget entier du jeu. C'est la
   * seule raison d'être de l'InstancedMesh ici, et elle impose sa contrainte : une dalle
   * qui tombe n'est pas un objet qu'on déplace, c'est une matrice qu'on réécrit.
   *
   * Tous les colliders d'une section pendent d'UN SEUL corps fixe. Rapier n'a rien à
   * simuler pour un corps fixe ; en créer six cents ne servirait qu'à alourdir le monde
   * et sa libération.
   */
  function batirSection(spec, zAvant, colDepart, indice) {
    const { cols, rangs, ecart, sursis } = spec;
    const { sur, colSortie } = tracerChemin(cols, rangs, ecart, rand, colDepart);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const dalles = [];
    const parCase = new Map();

    for (let r = 0; r < rangs; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * PAS;
        const z = zAvant - PAS / 2 - r * PAS;
        const d = {
          x, z, col: c, rang: r,
          sure: sur[r].has(c),
          etat: 'posee', t: 0, vy: 0, tilt: 0,
          i: dalles.length, collider: null,
        };
        d.collider = world.createCollider(
          RAPIER.ColliderDesc.cuboid(DALLE / 2, EP / 2, DALLE / 2)
            .setTranslation(x, SOL - EP / 2, z)
            .setFriction(0.62),
          body);
        dalles.push(d);
        parCase.set(r * cols + c, d);
      }
    }

    const corps = new THREE.InstancedMesh(geoCorps, matCorps, dalles.length);
    const faces = new THREE.InstancedMesh(geoFace, matFace, dalles.length);
    corps.castShadow = true;
    corps.receiveShadow = true;
    // Les dalles bougent : sans cela three.js les élimine sur la boîte englobante
    // calculée à la construction, et une dalle qui tombe disparaît d'un coup à l'écran.
    corps.frustumCulled = false;
    faces.frustumCulled = false;
    const s = { spec, cols, rangs, sursis, zAvant, zArriere: zAvant - rangs * PAS,
      dalles, parCase, corps, faces, body, colSortie, indice };
    for (const d of dalles) poserMatrice(s, d);
    corps.instanceMatrix.needsUpdate = true;
    faces.instanceMatrix.needsUpdate = true;
    group.add(corps);
    group.add(faces);
    sections.push(s);
    return s;
  }

  /** Écrit la matrice d'une dalle dans les deux instances, selon son état courant. */
  function poserMatrice(s, d) {
    if (d.etat === 'disparue') {
      dummy.position.set(d.x, SOL, d.z);
      dummy.quaternion.identity();
      dummy.scale.setScalar(0);       // une dalle tombée n'est pas cachée, elle est nulle
      dummy.updateMatrix();
      s.corps.setMatrixAt(d.i, dummy.matrix);
      s.faces.setMatrixAt(d.i, dummy.matrix);
      dummy.scale.setScalar(1);
      return;
    }
    let dx = 0, dz = 0, dy = 0;
    if (d.etat === 'tremble') {
      // Tremblement : 11 Hz, un centimètre et demi d'amplitude, plus un affaissement
      // progressif. Il faut que ce soit VU sans ambiguïté — c'est le seul avertissement
      // que le joueur recevra, et il n'a qu'une fraction de seconde pour l'exploiter.
      const a = 0.015 + 0.008 * (d.t / s.sursis);
      dx = Math.sin(d.t * 70) * a;
      dz = Math.cos(d.t * 61) * a;
      dy = -AFFAISSEMENT * (d.t / s.sursis);
    }
    dummy.position.set(d.x + dx, SOL + dy + (d.etat === 'chute' ? d.dy : 0), d.z + dz);
    dummy.quaternion.setFromEuler(new THREE.Euler(d.tilt * 0.7, 0, d.tilt));
    dummy.position.y -= EP / 2;
    dummy.updateMatrix();
    s.corps.setMatrixAt(d.i, dummy.matrix);
    // La face suit le corps, remontée d'une demi-épaisseur plus 12 mm.
    dummy.position.y += EP / 2 + 0.012;
    dummy.updateMatrix();
    s.faces.setMatrixAt(d.i, dummy.matrix);
  }

  // ── Disposition ────────────────────────────────────────────────────────────────────
  // Départ, puis trois sections séparées de paliers, puis l'arrivée. Chaque palier est un
  // point de reprise : une chute renvoie au début de la SECTION, pas au début du
  // parcours. Sans cela, une erreur au dernier rang coûterait cent mètres — et comme les
  // dalles tombées le restent, le joueur rejouerait un damier déjà résolu, c'est-à-dire
  // une marche sans jeu.
  const LARGE_MAX = SECTIONS[SECTIONS.length - 1].cols * PAS;
  // Le damier commence EXACTEMENT au bord arrière du palier de départ. Les deux dessus
  // étant à la même altitude, un chevauchement ferait battre deux surfaces coplanaires à
  // l'écran, et un écart ouvrirait un trou au premier pas.
  const DEPART_PROF = 14;
  palier(DEPART_Z + 1, SECTIONS[0].cols * PAS, C.depart, { profondeur: DEPART_PROF });
  let z = DEPART_Z + 1 - DEPART_PROF / 2;
  checkpoints.push(new THREE.Vector3(0, SOL + 1.2, DEPART_Z));

  let col = Math.floor(SECTIONS[0].cols / 2);
  SECTIONS.forEach((spec, i) => {
    const s = batirSection(spec, z, col, i);
    z = s.zArriere;
    // La colonne d'entrée de la section suivante est celle par laquelle on est SORTI de
    // la précédente, recentrée sur le nouveau damier. Le joueur reprend donc là où il
    // est, et non téléporté au milieu.
    const suivante = SECTIONS[i + 1];
    if (suivante) {
      col = Math.round((s.colSortie - (spec.cols - 1) / 2) + (suivante.cols - 1) / 2);
      palier(z - PLATEAU / 2, suivante.cols * PAS, C.palier);
      checkpoints.push(new THREE.Vector3(0, SOL + 1.2, z - PLATEAU / 2));
      z -= PLATEAU;
    }
  });

  /*
   * L'arrivée se cale sur SA PROPRE profondeur, pas sur celle d'un palier courant.
   *
   * Elle fait 12 m et non 9 : la centrer à `z - PLATEAU / 2` la faisait remonter de 1,5 m
   * dans le dernier rang de dalles. Deux dessus à la même altitude se chevauchaient — ils
   * battaient à l'écran — et surtout le dernier rang devenait porteur sur toute sa
   * largeur : la dernière décision du parcours était offerte. Mesuré par le harnais, qui
   * a trouvé du sol au milieu d'un jeu entre deux dalles.
   */
  const ARRIVEE_PROF = 12;
  const ARRIVEE_Z = z - ARRIVEE_PROF / 2;
  palier(ARRIVEE_Z, LARGE_MAX, C.arrivee, { profondeur: ARRIVEE_PROF });
  checkpoints.push(new THREE.Vector3(0, SOL + 1.2, ARRIVEE_Z));
  const finishZ = ARRIVEE_Z - 2;

  // ── Effets ─────────────────────────────────────────────────────────────────────────
  const confetti = new ConfettiField(group, { count: 90, radius: 26, height: 22 });
  const poussiere = new PuffSystem(group, { count: 40, color: 0xffe6a8 });

  // ── Décor : un ciel, pas un sol ────────────────────────────────────────────────────
  function dressScenery() {
    if (skipped('scenery')) return;

    // Banc de nuages sous le damier. C'est lui qui donne le vertige : sans plan de
    // référence sous les pieds, une chute de seize mètres se lit comme une chute de deux,
    // et le damier cesse d'être dangereux.
    const nuages = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshBasicMaterial({ map: cloudBank({ repeat: [16, 16] }), toneMapped: false }));
    nuages.rotation.x = -Math.PI / 2;
    nuages.position.set(0, KILL_Y - 12, (DEPART_Z + ARRIVEE_Z) / 2);
    group.add(nuages);

    function prop(name, size, x, y, zz, { rot = 0 } = {}) {
      const m = assets.get(name, size, { outline: 0 });
      if (!m) return null;
      m.position.set(x, y, zz);
      m.rotation.y = rot;
      group.add(m);
      return m;
    }

    /*
     * Îlots volants de part et d'autre du damier, avec leurs sapins.
     *
     * Ils ont une fonction, et ce n'est pas de meubler : ce sont les seuls repères FIXES
     * de la scène. Le damier est un motif régulier, sans début ni fin visible ; entre
     * deux îlots, le joueur sait de combien il a avancé. Leurs positions viennent du PRNG
     * de manche, donc les seize joueurs voient le même ciel.
     */
    for (let i = 0; i < 22; i++) {
      const sx = i % 2 ? 1 : -1;
      const x = sx * (LARGE_MAX / 2 + 12 + rand() * 46);
      const zz = DEPART_Z + 12 - rand() * (DEPART_Z - ARRIVEE_Z + 60);
      const y = SOL - 3 - rand() * 22;
      const taille = 9 + rand() * 12;
      const ilot = prop('sky-island-grass', taille, x, y, zz, { rot: rand() * 6.28 });
      if (!ilot) {
        const p = pill(taille * 0.5, taille * 0.24, 0x9a8570);
        p.rotation.z = Math.PI / 2;
        p.position.set(x, y, zz);
        group.add(p);
      }
      // Un sapin sur un îlot sur deux : posés sur tous, ils forment une haie et le motif
      // redevient régulier, ce qui annule le repérage qu'on vient de gagner.
      if (i % 2 === 0) {
        /*
         * SUR l'herbe, pas dedans.
         *
         * `assets.get` pose la BASE du modèle à la cote demandée, et l'îlot est haut comme
         * il est large : son tapis d'herbe est aux sept dixièmes de sa hauteur. Une
         * première version plantait les arbres à 0,24 — c'est-à-dire au milieu du rocher,
         * où ils étaient entièrement enterrés. Sur les captures, les îlots paraissaient
         * simplement pelés, et rien ne signalait que vingt-deux modèles étaient chargés
         * pour n'être jamais vus.
         */
        prop(i % 4 === 0 ? 'tree-pine' : 'tree-round', taille * 0.5,
          x + (rand() - 0.5) * taille * 0.3, y + taille * 0.68, zz + (rand() - 0.5) * taille * 0.3,
          { rot: rand() * 6.28 });
      }
    }

    // Mâts à fanions le long des paliers : ils bordent le couloir et rappellent, à chaque
    // reprise, où commence la section suivante.
    const zPaliers = [DEPART_Z + 1, ARRIVEE_Z];
    for (const s of sections) if (s.indice < sections.length - 1) zPaliers.push(s.zArriere - PLATEAU / 2);
    for (const zp of zPaliers) {
      for (const sx of [-1, 1]) {
        const m = pennant(6.5, 2.2, 1.4, 0xf2f5f7, sx > 0 ? C.fanionA : C.fanionB);
        m.position.set(sx * (LARGE_MAX / 2 + 2.4), SOL, zp);
        group.add(m);
      }
    }

    const g = bunting(SECTIONS[0].cols * PAS, 12, [C.fanionA, C.fanionB, C.palier]);
    g.position.set(0, SOL + 5.2, DEPART_Z - 4);
    group.add(g);

    if (!prop('finish-arch', 14, 0, SOL, ARRIVEE_Z - 4)) {
      const b = banner(12, C.arrivee, null);
      b.position.set(0, SOL + 5, ARRIVEE_Z - 4);
      group.add(b);
    }
  }
  dressScenery();

  // ── La chute d'une dalle ───────────────────────────────────────────────────────────
  const G_DALLE = 26;
  const enMouvement = new Set();

  /**
   * Le joueur pose le pied : quelle dalle est sous son CENTRE ?
   *
   * On teste le centre du corps, et non son emprise. Le joueur chevauche presque toujours
   * deux dalles — sa capsule fait 0,90 m pour un jeu de 0,16 m — et déclencher tout ce
   * qu'elle touche ferait tomber la dalle sûre d'à côté aussi souvent que la mauvaise.
   * « Celle sur laquelle je me tiens » est la seule règle que le joueur puisse anticiper.
   */
  function sonder(p) {
    // Le personnage repose FOOT (0,80 m) au-dessus du sol. La fenêtre est large vers le
    // haut pour capter un atterrissage encore en train de s'amortir, mais serrée vers le
    // bas : sans cela une dalle se déclencherait depuis le vide en la frôlant en chute.
    if (p.y < SOL + 0.45 || p.y > SOL + 1.75) return;
    for (const s of sections) {
      if (p.z > s.zAvant || p.z < s.zArriere) continue;
      const c = Math.round(p.x / PAS + (s.cols - 1) / 2);
      const r = Math.round((s.zAvant - PAS / 2 - p.z) / PAS);
      if (c < 0 || c >= s.cols || r < 0 || r >= s.rangs) return;
      const d = s.parCase.get(r * s.cols + c);
      if (!d || d.sure || d.etat !== 'posee') return;
      d.etat = 'tremble';
      d.t = 0;
      enMouvement.add(d);
      return;
    }
  }

  function avancer(dt) {
    if (!enMouvement.size) return;
    const finies = [];
    for (const d of enMouvement) {
      const s = sections[d.section];
      if (d.etat === 'tremble') {
        d.t += dt;
        /*
         * Le collider descend AVEC le visuel.
         *
         * Le tremblement fait s'affaisser la dalle de sept centimètres. Laisser sa hitbox
         * en place pendant ce temps mettrait le joueur sept centimètres au-dessus du
         * dessus visible — un décalage que ce projet s'interdit, et qui priverait en
         * prime le tremblement de ce qui le rend vraiment lisible : on le SENT sous les
         * pieds avant de le voir. Rapier ne pousse pas latéralement depuis un collider
         * fixe qu'on déplace, donc le frémissement horizontal reste sans effet sur le
         * joueur ; seul l'affaissement se transmet, et c'est exactement ce qu'on veut.
         */
        if (d.collider) {
          d.collider.setTranslation({
            x: d.x, y: SOL - EP / 2 - AFFAISSEMENT * Math.min(1, d.t / s.sursis), z: d.z });
        }
        if (d.t >= s.sursis) {
          d.etat = 'chute';
          // Le sursis RÉELLEMENT écoulé, en temps de jeu. C'est la scène qui le relève,
          // parce que personne d'autre ne le peut : un harnais qui l'observe de
          // l'extérieur ne le voit qu'à la fréquence d'image du navigateur, et en
          // headless chargé cela ajoutait une demi-seconde constante à chaque mesure.
          d.sursisReel = d.t;
          d.dy = 0; d.vy = 0;
          // Le collider part À L'INSTANT où la dalle lâche, pas au bout de sa chute :
          // une dalle qui descend en gardant sa hitbox porte encore le joueur, qui la
          // suit vers le bas sans jamais tomber. Le trou doit s'ouvrir tout de suite.
          world.removeCollider(d.collider, true);
          d.collider = null;
          poussiere.emit(new THREE.Vector3(d.x, SOL, d.z),
            { count: 5, spread: 1.1, rise: 0.9, size: 0.3, life: 0.55 });
        }
      } else if (d.etat === 'chute') {
        d.vy -= G_DALLE * dt;
        d.dy += d.vy * dt;
        // Bascule : une dalle qui tomberait à plat se lit comme un ascenseur. Le
        // basculement dit « elle est lâchée », et il se voit encore du dessus.
        d.tilt += dt * 1.6;
        if (SOL + d.dy < KILL_Y - 10) { d.etat = 'disparue'; finies.push(d); }
      }
      poserMatrice(s, d);
      s.corps.instanceMatrix.needsUpdate = true;
      s.faces.instanceMatrix.needsUpdate = true;
    }
    for (const d of finies) enMouvement.delete(d);
  }

  // Chaque dalle sait à quelle section elle appartient : `avancer` parcourt un ensemble
  // mêlant les trois, et retrouver la section par recherche à chaque image serait payer
  // trois comparaisons pour une information qu'on connaît à la construction.
  sections.forEach((s, i) => { for (const d of s.dalles) d.section = i; });

  function update(elapsed, dt, focus) {
    updateFlags(elapsed);
    if (focus && dt > 0) sonder(focus);
    avancer(dt);
    confetti.update(dt, elapsed, focus ?? spawn);
    poussiere.update(dt);
  }

  /** Remet tout le damier en place : appelé quand la manche redémarre sans reconstruction. */
  function reset() {
    for (const s of sections) {
      for (const d of s.dalles) {
        if (d.etat === 'posee') continue;
        d.etat = 'posee'; d.t = 0; d.vy = 0; d.dy = 0; d.tilt = 0; d.sursisReel = undefined;
        if (d.collider) {
          // Une dalle qui tremblait encore garde une hitbox affaissée : on la relève.
          d.collider.setTranslation({ x: d.x, y: SOL - EP / 2, z: d.z });
        } else {
          d.collider = world.createCollider(
            RAPIER.ColliderDesc.cuboid(DALLE / 2, EP / 2, DALLE / 2)
              .setTranslation(d.x, SOL - EP / 2, d.z)
              .setFriction(0.62),
            s.body);
        }
        poserMatrice(s, d);
      }
      s.corps.instanceMatrix.needsUpdate = true;
      s.faces.instanceMatrix.needsUpdate = true;
    }
    enMouvement.clear();
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
    world, group, spawn, finishZ, killY: KILL_Y, checkpoints, conveyors: [], seed,
    /*
     * Caméra haute et reculée, le regard bas.
     *
     * Ce qu'il faut voir sur ce mini-jeu n'est pas le personnage, c'est le DAMIER — et
     * surtout les trous laissés par les dalles déjà tombées, qui sont toute l'information
     * disponible. Au ras du sol ils se confondent avec les joints et le joueur avance en
     * aveugle sur un terrain qu'il a pourtant déjà payé.
     */
    camBias: { height: 2.4, distance: 1.6, lookHeight: -0.2, fov: 4 },
    update, reset, dispose,
    checkpointFor(z) {
      let best = checkpoints[0];
      for (const cp of checkpoints) if (z <= cp.z + 1) best = cp;
      return best;
    },
    largeur: LARGE_MAX,
    /** Sondes de diagnostic. */
    __cotes: () => ({ DALLE, JEU, PAS, EP, SOL, KILL_Y, PORTEE, VOL, DIAGONALE, PERSO_LARGE,
      AFFAISSEMENT }),
    __sections: () => sections.map((s) => ({
      indice: s.indice, cols: s.cols, rangs: s.rangs, sursis: s.sursis,
      zAvant: s.zAvant, zArriere: s.zArriere, colSortie: s.colSortie,
      chemin: s.dalles.filter((d) => d.sure).map((d) => ({ r: d.rang, c: d.col, x: d.x, z: d.z })),
    })),
    __etats: () => sections.flatMap((s) => s.dalles
      .filter((d) => d.etat !== 'posee')
      .map((d) => ({ s: s.indice, r: d.rang, c: d.col, etat: d.etat,
        sursisReel: d.sursisReel ?? null, sursis: s.sursis }))),
    __ray: (ox, oy, oz, dx, dy, dz, max = 40) => {
      const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
      const hit = world.castRay(ray, max, true);
      return hit ? hit.timeOfImpact : null;
    },
  };
}
