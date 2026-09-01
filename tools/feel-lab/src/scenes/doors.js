import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { toonMaterial } from '../world.js';
import { ConfettiField, PaperBurst } from '../effects.js';
import { createTerrain } from '../terrain.js';
import {
  pill, rimGlow, inflatableArch, balloon, bunting, updateFlags, slabMesh,
  paperPanel, dechirerPanneau, grandstand,
} from '../props.js';
import {
  weldedTubes, runwayLanes, foamPit, crowdTier,
  hazardStripes, floorMarkings, doorPanel, DOOR_CRESTS,
} from '../textures.js';

/**
 * Les Portes — mini-jeu 2.
 *
 * Un couloir en paliers descendants, barré par sept murs percés de portes en papier,
 * dont deux paires rapprochées et décalées.
 * Certaines cèdent, les autres sont condamnées. Il faut lire le mur en courant.
 *
 * ── LES PORTES NE SE DISTINGUENT PAS ────────────────────────────────────────────
 * Rien, absolument rien, ne permet de voir depuis l'avant si une porte cède. C'est le
 * choix retenu, et il structure tout ce fichier : couleur, emblème, bombement et
 * respiration dépendent de la POSITION de la porte, jamais de son état. Une version
 * antérieure marquait les portes condamnées d'une croix de renfort ; la distinction se
 * lisait à trente mètres et le mur cessait d'être un mur.
 *
 * Ce qu'il reste à jouer n'est donc pas une lecture, mais l'exploitation de ce que le
 * peloton révèle : celui qui passe devant ouvre une porte pour tous ceux qui suivent, et
 * savoir quand suivre plutôt que mener est une compétence à part entière.
 *
 * ── DÉTERMINISME ────────────────────────────────────────────────────────────────
 * La disposition dérive d'une graine passée en paramètre, jamais de Math.random(). Une
 * même graine donne exactement le même mur. En multijoueur, le serveur impose la graine
 * aux seize joueurs : tous affrontent la même donne, aux mêmes emplacements, au même
 * instant. C'est cette égalité stricte qui reste vérifiable et démontrable — aucun
 * joueur ne reçoit un parcours différent d'un autre.
 *
 * ── RÈGLE D'ASSETS ──────────────────────────────────────────────────────────────
 * Meshy ne sert qu'au décor posé hors piste. Tout ce qui bloque ou porte est en géométrie
 * procédurale, taillée exactement sur son collider : une hitbox qui ne suit pas le visuel
 * est disqualifiante quand de l'argent est en jeu.
 */

const C = {
  sol: 0x2e9bf5,
  solAlt: 0x2dd9d9,
  solFin: 0x6ee86e,
  mur: 0xff4fa3,
  montant: 0xb072ff,
  // Montants BLEU CIEL, comme la référence : sur un mur de portes vives, un montant
  // violet se lisait comme une porte de plus. Le bleu froid recule, la porte avance.
  montantPorte: 0x8fdcff,
  linteau: 0xffee7a,
  bord: 0xff8a1f,
  edge: 0xffffff,
  depart: 0x3ee87a,
  arrivee: 0x3ee87a,
};

/**
 * Bombement et respiration des panneaux, identiques sur TOUTES les portes.
 * Le papier tendu bat légèrement sous la ventilation du plateau : c'est ce qui empêche
 * le mur de paraître peint. Une valeur unique, jamais conditionnée à l'état de la porte.
 */
const SOUFFLE = 0.3;

/*
 * Les portes d'un MÊME MUR sont désormais rigoureusement identiques : même teinte, même
 * emblème, même motif. C'est la référence, et c'est surtout la garantie la plus forte
 * qu'on puisse donner sur ce mini-jeu — quand deux portes ne diffèrent en RIEN, aucune
 * observation ne peut trahir la donne, et il n'y a plus à démontrer que la variation
 * n'est pas corrélée à l'état.
 *
 * La variété passe donc d'un mur à l'autre : chaque mur a sa couleur et son emblème,
 * tirés sur sa position dans le parcours. On y gagne aussi un repère de progression —
 * « le mur orange » désigne un endroit du parcours, jamais une porte.
 *
 * Effet de bord appréciable : un mur entier ne coûte plus qu'UNE texture de panneau.
 */

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

/** Interrupteurs de diagnostic : ?skip=doors,scenery,crowd */
function skipped(kind) {
  const raw = new URLSearchParams(location.search).get('skip') ?? '';
  return raw.split(',').includes(kind);
}

export function buildDoors(RAPIER, assets, { seed = 1 } = {}) {
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = 1 / 60;
  const group = new THREE.Group();
  const animated = [];
  const checkpoints = [];
  const portes = [];          // les portes franchissables, pour la traversée
  const toutes = [];          // tous les panneaux : ils respirent tous, sans exception
  const murs = [];            // un groupe par mur, pour le masquage caméra
  const rand = prng(seed);

  // 21 m, pas 26. Mesure au banc : a 26 m de large, le mur debordait de l'ecran des deux
  // cotes, les murets et les tribunes n'apparaissaient jamais, et le couloir se lisait
  // comme un tunnel plat. A 21 m on voit les bords, donc on voit la profondeur.
  const LARGEUR = 21;
  const GROUND_Y = -22;
  let terrainHeightAt = () => 0;

  const spawn = new THREE.Vector3(0, 9.6, 14);
  const finishZ = -148;

  // ─────────────────────────── briques ───────────────────────────

  function checkDims(...dims) {
    for (const d of dims) {
      if (!Number.isFinite(d) || d <= 0) throw new Error(`dimension invalide: ${d}`);
    }
  }

  function addBody(mesh, px, py, pz, colliderDesc, parent = group) {
    mesh.position.set(px, py, pz);
    parent.add(mesh);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz));
    const col = world.createCollider(colliderDesc, body);
    return { body, col };
  }

  /** Palier plat : le sol jouable, avec son liseré. */
  function palier(zFrom, zTo, y, { color = C.sol, map = null } = {}) {
    const len = Math.abs(zTo - zFrom);
    checkDims(LARGEUR, len);
    const zc = (zFrom + zTo) / 2;
    const mesh = slabMesh(LARGEUR, 1.2, len, color, C.edge, { radius: 0.5, map });
    addBody(mesh, 0, y - 0.6, zc,
      RAPIER.ColliderDesc.cuboid(LARGEUR / 2, 0.6, len / 2).setFriction(0.62));
    const g = rimGlow(LARGEUR, len);
    g.position.set(0, y + 0.03, zc);
    group.add(g);
    murets(zFrom, zTo, y);
    return mesh;
  }

  /**
   * Rampe reliant deux paliers.
   * La piste DESCEND vers l'arrivée, et ce n'est pas un détail d'habillage : depuis le
   * haut d'un palier, le joueur voit le mur suivant en contrebas et peut le lire pendant
   * qu'il court. Un couloir plat cacherait chaque mur derrière le précédent.
   */
  function rampe(zFrom, zTo, yFrom, yTo, { color = C.solAlt } = {}) {
    const dz = Math.abs(zTo - zFrom), dy = yTo - yFrom;
    const len = Math.hypot(dz, dy);
    checkDims(LARGEUR, len);
    // atan2(dy, dz), pas atan2(dy, -dz) : le second retourne la dalle de cent quatre-vingts
    // degres. Le collider n'en montrait rien, une boite etant symetrique, mais le maillage
    // presentait sa FACE INFERIEURE — blanche — et remplissait le bas de l'ecran.
    const pente = Math.atan2(dy, dz);
    const zc = (zFrom + zTo) / 2, yc = (yFrom + yTo) / 2;
    // Materiau BLANC sous une texture de SIGNAL. hazardStripes porte deja ses couleurs :
    // multipliee par le cyan du sol, elle virait au vert olive et la rampe ne se lisait
    // plus comme une zone de danger. textures.js pose la regle, elle vaut ici aussi.
    const mesh = slabMesh(LARGEUR, 1.2, len, 0xffffff, C.edge, { radius: 0.5, map: hazardStripes({ repeat: [5, 2] }) });
    mesh.rotation.x = pente;
    mesh.position.set(0, yc - 0.6, zc);
    group.add(mesh);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pente);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, yc - 0.6, zc));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(LARGEUR / 2, 0.6, len / 2)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.62), body);
    murets(zFrom, zTo, yc + 0.4);
    return mesh;
  }

  /**
   * Murets latéraux, sur toute la longueur.
   * Ce mini-jeu n'a PAS de vide : la tension vient de la lecture des portes et de la
   * bousculade, pas du risque de chute. Ouvrir les côtés ajouterait une punition qui ne
   * récompense aucune adresse — on tomberait en étant poussé, pas en se trompant.
   */
  function murets(zFrom, zTo, y) {
    const len = Math.abs(zTo - zFrom);
    const zc = (zFrom + zTo) / 2;
    for (const sx of [-1, 1]) {
      const x = sx * (LARGEUR / 2 + 0.45);
      // 2,6 m : au-dessus des 2,15 m de saut du personnage (TUNING.jumpHeight), donc
      // infranchissable, mais assez bas pour laisser voir les tribunes. A 3,4 m il
      // masquait tout le public et le couloir se lisait comme une tranchee.
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 2.6, len),
        toonMaterial(C.bord, {}));
      // MOTIF quasi blanc, pas inflatedBands : cette derniere porte ses propres teintes
      // turquoise et salissait l'orange du muret.
      mesh.material.map = weldedTubes({ repeat: [1, Math.max(2, Math.round(len / 4))] });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      addBody(mesh, x, y + 1.3, zc, RAPIER.ColliderDesc.cuboid(0.45, 1.3, len / 2).setFriction(0.25));
      const cap = pill(len, 0.34, C.linteau);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(x, y + 2.7, zc);
      group.add(cap);
    }
  }

  /** Marquage peint, posé à plat juste au-dessus du sol. */
  function decal(kind, x, y, z, size, rot = 0) {
    const tex = floorMarkings(kind);
    if (!tex) return;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    m.position.set(x, y + 0.05, z);
    m.renderOrder = 2;
    group.add(m);
  }

  // ─────────────────────────── le mur de portes ───────────────────────────

  const HAUTEUR_PORTE = 4.2;
  const HAUTEUR_MUR = 5.6;
  const EP_MONTANT = 0.42;

  /**
   * Construit un mur percé de `cases` portes, dont `vraies` sont franchissables.
   *
   * Le choix des portes franchissables passe par le PRNG SEEDÉ, jamais par Math.random :
   * c'est ce qui garantit que les seize joueurs d'une manche affrontent le même mur.
   * `decalage` fait glisser la grille d'une demi-case, pour qu'un mur doublé ne se
   * franchisse pas tout droit.
   */
  function murDePortes(z, y, cases, vraies, { decalage = 0, teinte = C.mur } = {}) {
    if (skipped('doors')) return;
    // Le mur entier vit dans un groupe : c'est ce qui permet de l'effacer d'un bloc
    // quand la caméra le traverse (voir masquerMurs).
    const mur = new THREE.Group();
    group.add(mur);
    const infos = { z, y, mur, xOuvertes: [], xCondamnees: [] };
    murs.push(infos);
    const pas = LARGEUR / cases;
    const bordG = -LARGEUR / 2, bordD = LARGEUR / 2;

    /*
     * Découpage des cases, ROGNÉ sur la largeur du couloir.
     *
     * Une première version ignorait purement les cases qui débordaient. Sur un mur
     * décalé d'une demi-case, cela laissait un couloir libre de 1,75 m le long du bord :
     * il suffisait de longer le muret pour traverser sans rien lire, et trois manches
     * sur cinq se franchissaient ainsi. Un mur DOIT fermer toute la largeur.
     *
     * Une case rognée devient forcément condamnée : une demi-porte franchissable collée
     * au muret serait invisible depuis l'axe de course, donc impossible à lire.
     */
    const grille = [];
    for (let i = -1; i <= cases; i++) {
      const centre = bordG + (i + 0.5) * pas + decalage * pas;
      const g = Math.max(bordG, centre - pas / 2 + EP_MONTANT / 2);
      const d = Math.min(bordD, centre + pas / 2 - EP_MONTANT / 2);
      const largeur = d - g;
      if (largeur < 0.3) continue;
      grille.push({ x: (g + d) / 2, largeur, pleine: largeur > pas - EP_MONTANT - 0.05 });
    }

    // Tirage sans remise, parmi les seules cases pleines.
    const candidates = grille.map((c, i) => i).filter((i) => grille[i].pleine);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const ouvertes = new Set(candidates.slice(0, Math.min(vraies, candidates.length)));

    // Montants : un à chaque frontière de case, plus les deux jambages aux bords exacts
    // du couloir. Ils encadrent les portes et restent solides quoi qu'il arrive.
    const frontieres = [bordG, bordD];
    for (const c of grille) {
      frontieres.push(c.x - c.largeur / 2 - EP_MONTANT / 2, c.x + c.largeur / 2 + EP_MONTANT / 2);
    }
    const poses = [];
    for (const x of frontieres.sort((a, b) => a - b)) {
      if (x < bordG - 0.01 || x > bordD + 0.01) continue;
      if (poses.some((p) => Math.abs(p - x) < 0.12)) continue;   // frontières confondues
      poses.push(x);
      // Le collider reste individuel — c'est lui qui arrête le joueur —, mais le visuel
      // part dans un lot instancié : huit montants par mur coûtaient huit appels de
      // dessin pour huit boîtes rigoureusement identiques.
      const corps = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + HAUTEUR_MUR / 2, z));
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(EP_MONTANT / 2, HAUTEUR_MUR / 2, 0.45), corps);
    }

    // Un lot par MUR, et non un lot global : c'est ce qui permet d'effacer un mur entier
    // quand la caméra le traverse (voir masquerMurs).
    const montants = new THREE.InstancedMesh(
      new THREE.BoxGeometry(EP_MONTANT, HAUTEUR_MUR, 0.9),
      toonMaterial(C.montantPorte), poses.length);
    montants.material.map = weldedTubes({ repeat: [1, 2] });
    montants.castShadow = true;
    const repere = new THREE.Object3D();
    poses.forEach((x, i) => {
      repere.position.set(x, y + HAUTEUR_MUR / 2, z);
      repere.updateMatrix();
      montants.setMatrixAt(i, repere.matrix);
    });
    montants.instanceMatrix.needsUpdate = true;
    mur.add(montants);

    // Linteau : le bandeau au-dessus des portes. Il ferme le mur par le haut, sinon un
    // saut bien placé franchirait n'importe quelle porte condamnée.
    const linteau = new THREE.Mesh(
      new THREE.BoxGeometry(LARGEUR + 1.6, HAUTEUR_MUR - HAUTEUR_PORTE, 1.1),
      toonMaterial(C.linteau));
    linteau.material.color.setHex(0xffffff);   // SIGNAL : la texture porte les couleurs
    linteau.material.map = hazardStripes({ repeat: [10, 1] });
    linteau.castShadow = true;
    addBody(linteau, 0, y + (HAUTEUR_MUR + HAUTEUR_PORTE) / 2, z,
      RAPIER.ColliderDesc.cuboid((LARGEUR + 1.6) / 2, (HAUTEUR_MUR - HAUTEUR_PORTE) / 2, 0.55), mur);

    // Corniche : le bandeau de couleur qui donne sa masse au mur.
    // Elle coiffe le linteau et ne descend JAMAIS au niveau des portes. Une première
    // version la posait au sol sur toute la largeur : mesuré au banc, elle formait un
    // seuil de cinquante centimètres en travers des portes, et une porte correctement
    // lue bloquait quand même le joueur. Elle n'a pas non plus de collider — rien
    // au-dessus du linteau ne peut être touché.
    const corniche = new THREE.Mesh(
      new THREE.BoxGeometry(LARGEUR + 2.4, 0.7, 1.5),
      toonMaterial(teinte));
    corniche.position.set(0, y + HAUTEUR_MUR + 0.35, z);
    corniche.castShadow = true;
    mur.add(corniche);



    /*
     * IDENTITÉ DU MUR : une couleur et un emblème, tirés sur sa position dans le
     * parcours. Toutes ses portes les partagent — voir le commentaire en tête de fichier.
     */
    const teinteCss = '#' + teinte.toString(16).padStart(6, '0');
    const embleme = DOOR_CRESTS[murs.length % DOOR_CRESTS.length];

    for (let i = 0; i < grille.length; i++) {
      const { x, largeur: largeurPorte, pleine } = grille[i];
      const yc = y + HAUTEUR_PORTE / 2;

      /*
       * CASE ROGNÉE = JAMBAGE PLEIN, plus jamais une demi-porte.
       *
       * Sur un mur décalé d'une demi-case, les deux cases de bord sont amputées par le
       * muret : elles donnaient une porte étroite d'un mètre et demi, collée au bord,
       * qu'on ne peut ni lire de face ni franchir proprement — et qui, condamnée par
       * construction, ajoutait au mur une pièce dont l'état était le seul à être
       * DEVINABLE. On y met désormais un jambage plein, de la même matière que les
       * montants : le mur reste fermé sur toute sa largeur, et tout ce qui ressemble à
       * une porte en est une.
       */
      if (!pleine) {
        const jambage = new THREE.Mesh(
          new THREE.BoxGeometry(largeurPorte + EP_MONTANT, HAUTEUR_PORTE, 0.9),
          toonMaterial(C.montantPorte));
        jambage.material.map = weldedTubes({ repeat: [1, 2] });
        jambage.castShadow = true;
        addBody(jambage, x, yc, z,
          RAPIER.ColliderDesc.cuboid((largeurPorte + EP_MONTANT) / 2, HAUTEUR_PORTE / 2, 0.45), mur);
        continue;
      }

      const pan = new THREE.Group();
      pan.position.set(x, yc, z);
      mur.add(pan);

      /*
       * Aspect strictement identique pour les deux états — c'est la règle qui structure
       * tout ce fichier. Rien ici ne lit `ouverte` : ni la teinte, ni l'emblème, ni le
       * bombement, ni la phase de respiration.
       *
       * Le motif est peint DANS la texture du panneau : un seul maillage, un seul appel
       * de dessin. En plan séparé, l'emblème en coûtait un de plus par porte.
       */
      const feuille = paperPanel(largeurPorte, HAUTEUR_PORTE, 0xffffff, {
        // SIGNAL : la texture porte ses couleurs, le matériau reste blanc.
        map: doorPanel(embleme, { teinte: teinteCss, aspect: largeurPorte / HAUTEUR_PORTE }),
        bulge: 0.16 + 0.2 * SOUFFLE,
      });
      feuille.position.z = 0.12;
      pan.add(feuille);

      const ouverte = ouvertes.has(i);

      // Collider du panneau, dans les deux cas. Sur une porte franchissable il est
      // retiré à l'approche : sans lui, un joueur qui la longe sans la viser passerait
      // au travers d'un mur qui devrait le contenir.
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, yc, z));
      const col = world.createCollider(
        RAPIER.ColliderDesc.cuboid(largeurPorte / 2, HAUTEUR_PORTE / 2, 0.12), body);
      // Le corps est conservé : briser une porte n'enlève que son collider, et le remettre
      // en place doit réutiliser ce corps-là. En recréer un à chaque manche rejouée
      // laisserait derrière soi un corps vide de plus à chaque fois.

      (ouverte ? infos.xOuvertes : infos.xCondamnees).push(x);

      // La phase de respiration vient de la POSITION, pas du PRNG de la donne : deux
      // manches successives font battre le mur exactement pareil, et le mouvement ne
      // peut donc rien trahir de la disposition tirée.
      const panneau = {
        x, y: yc, z, demiL: largeurPorte / 2, demiH: HAUTEUR_PORTE / 2,
        pan, feuille, col, body, ouverte, brisee: false, t: 0, choc: 0,
        mur: infos, teinte,
        phase: (x * 0.7 + z * 0.31) % (Math.PI * 2),
      };
      toutes.push(panneau);
      if (ouverte) portes.push(panneau);
    }
  }

  // ─────────────────────────── le tracé ───────────────────────────

  const runway = runwayLanes({ repeat: [3, 10] });

  /*
   * Teinte de corniche propre à chaque zone : elle jalonne la progression et évite six
   * murs identiques. Elle ne touche QUE le décor du mur — jamais les panneaux. La couleur
   * d'une porte est un signal de jeu : la faire varier obligerait le joueur à réapprendre
   * la lecture à chaque mur, et détruirait l'adresse qu'on cherche justement à récompenser.
   */
  palier(18, 2, 8, { color: C.sol, map: runway });
  rampe(2, -4, 8, 6.4);
  palier(-4, -24, 6.4, { color: C.solAlt, map: runway });
  murDePortes(-12, 6.4, 7, 3, { teinte: C.mur });                                  // apprentissage : large
  rampe(-24, -30, 6.4, 4.8);
  palier(-30, -52, 4.8, { color: C.sol, map: runway });
  murDePortes(-40, 4.8, 7, 2, { teinte: C.montant });
  rampe(-52, -58, 4.8, 3.2);
  palier(-58, -86, 3.2, { color: C.solAlt, map: runway });
  // Mur doublé : la grille du second glisse d'une demi-case, donc franchir le premier
  // ne donne jamais la bonne ligne pour le second. C'est là que le peloton s'entasse.
  murDePortes(-66, 3.2, 6, 2, { teinte: C.solAlt });
  murDePortes(-74, 3.2, 6, 2, { decalage: 0.5, teinte: C.solAlt });
  rampe(-86, -92, 3.2, 1.6);
  palier(-92, -114, 1.6, { color: C.sol, map: runway });
  murDePortes(-102, 1.6, 7, 2, { teinte: C.bord });
  rampe(-114, -120, 1.6, 0);
  palier(-120, -156, 0, { color: C.solFin, map: foamPit({ repeat: [4, 6] }) });
  /*
   * Goulot final : deux murs resserrés, et c'est le passage le plus dur du parcours.
   *
   * Le second a d'abord été posé à huit mètres du premier avec UNE seule ouverture. Une
   * manche sur trois devenait alors infranchissable : quand cette ouverture tombait à
   * l'opposé de celle qu'on venait de prendre, dix mètres de déplacement latéral
   * restaient à faire en huit mètres de course, et on percutait le mur quoi qu'on fasse.
   * Un obstacle doit rester franchissable pour QUELQU'UN qui joue bien — sinon ce n'est
   * plus une difficulté, c'est une impasse. D'où douze mètres d'écart et deux ouvertures.
   */
  murDePortes(-126, 0, 6, 2, { teinte: C.solFin });
  murDePortes(-138, 0, 6, 2, { decalage: 0.5, teinte: C.solFin });

  checkpoints.push(
    new THREE.Vector3(0, 10.2, 14),
    new THREE.Vector3(0, 8.6, -6),
    new THREE.Vector3(0, 7.0, -34),
    new THREE.Vector3(0, 5.4, -60),
    new THREE.Vector3(0, 3.8, -80),
    new THREE.Vector3(0, 2.2, -96),
    new THREE.Vector3(0, 0.6, -122),
  );

  decal('grid', 0, 8, 12, 10);
  decal('arrow', 0, 6.4, -6, 5);
  decal('chevrons', 0, 4.8, -33, 5);
  decal('chevrons', 0, 3.2, -60, 5);
  decal('arrow', 0, 1.6, -95, 5);
  decal('rings', 0, 0, -142, 7);

  // ─────────────────────────── habillage ───────────────────────────

  const confetti = new ConfettiField(group, { count: 90, radius: 24, height: 20 });
  // Réserve commune à toutes les portes : une porte qui cède emprunte quelques éclats
  // et les rend. Un système par porte, c'était quarante-sept lots dormants pour une
  // poignée de ruptures par manche.
  const papier = new PaperBurst(group, { count: 72 });

  dressStart();
  dressFinish();
  dressScenery();

  function dressStart() {
    // Elargi et recule : cale sur la largeur du couloir, ses colonnes se dressaient juste
    // devant la camera au depart et mangeaient les deux tiers de l'ecran.
    const marquee = assets.getFitted('door-marquee-arch', { x: LARGEUR + 16, y: 12 });
    if (marquee) { marquee.position.set(0, 8, 18.5); group.add(marquee); }
    else {
      const a = inflatableArch(LARGEUR + 4, 8, 0.6, C.depart);
      a.position.set(0, 8, 16);
      group.add(a);
    }
    // Pas de bandeau en travers : pendant les trois secondes de décompte, tout le monde
    // est immobile et c'est LE moment où le joueur lit le premier mur. Une bannière
    // tendue devant lui le priverait de la seule information gratuite du parcours. Le
    // portique porte déjà l'identité de l'épreuve ; la guirlande est montée assez haut
    // pour habiller le ciel sans couper la ligne de vue.
    const flags = bunting(LARGEUR, 16);
    flags.position.set(0, 13.4, 12);
    group.add(flags);
  }

  function dressFinish() {
    // Sur la ligne : une arche qu'on FRANCHIT. Le château gonflable y avait d'abord été
    // posé, et mesuré au banc il remplissait tout l'écran d'un aplat rose dès vingt
    // mètres — on ne voyait plus ni la ligne, ni son propre personnage. Un objet massif
    // se place derrière l'arrivée, jamais dessus.
    const arche = assets.getFitted('finish-arch', { x: LARGEUR * 0.75, y: 8 });
    if (arche) { arche.position.set(0, 0, finishZ); group.add(arche); }
    else {
      const a = inflatableArch(LARGEUR * 0.7, 7, 0.6, C.arrivee);
      a.position.set(0, 0, finishZ);
      group.add(a);
    }
    const flags = bunting(LARGEUR * 0.7, 14);
    flags.position.set(0, 8.6, finishZ + 2);
    group.add(flags);

    // Décor de fond, bien au-delà de la ligne : il donne un but à viser de loin.
    const castle = assets.getFitted('finish-line-bouncy-castle', { x: 34, y: 15 });
    if (castle) { castle.position.set(0, 0, finishZ - 26); group.add(castle); }
    const trophee = assets.get('giant-trophy', 9);
    if (trophee) { trophee.position.set(-16, 0, finishZ - 14); group.add(trophee); }
  }

  /**
   * Décor : un PLATEAU DE TÉLÉVISION, pas un paysage.
   * Ce mini-jeu se joue dans un couloir fermé ; ce qui donne son ampleur à l'image, c'est
   * ce qui déborde par-dessus les murets — tribunes, projecteurs, grue. Le paysage
   * lointain n'est là que pour fermer l'horizon.
   */
  function dressScenery() {
    if (skipped('scenery')) return;
    const terrain = createTerrain({ groundY: GROUND_Y, size: 1200, segments: 180 });
    group.add(terrain.mesh);
    terrainHeightAt = terrain.heightAt;

    function prop(name, size, x, y, z, { rot = 0, shadow = false } = {}) {
      const m = assets.get(name, size, { outline: 0 });
      if (!m) return null;
      m.position.set(x, y, z);
      m.rotation.y = rot;
      m.traverse((c) => { if (c.isMesh && !c.userData.isOutline) c.castShadow = shadow; });
      group.add(m);
      return m;
    }

    // Tribunes des deux côtés, sur toute la longueur : c'est le public qui fait le
    // plateau. Elles sont surélevées, comme dans un stade — posées au niveau de la
    // piste, elles disparaissaient entièrement derrière les murets.
    if (!skipped('crowd')) {
      const bancs = [[6, 8], [-16, 6.4], [-42, 4.8], [-70, 3.2], [-100, 1.6], [-130, 0]];
      bancs.forEach(([z, y], i) => {
        for (const sx of [-1, 1]) {
          const t = grandstand(26, { seed: i * 7 + (sx > 0 ? 3 : 11) });
          t.group.position.set(sx * (LARGEUR / 2 + 3.6), y - 0.4, z);
          t.group.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
          group.add(t.group);
          animated.push((elapsed) => t.update(elapsed));
        }
      });
    }

    // Second rideau de public, LOINTAIN : une simple texture sur un plan. À cette
    // distance la géométrie ne se lit plus, et elle coûterait douze mille instances de
    // plus pour un résultat identique à l'image. On ferme donc le stade au moindre prix.
    if (!skipped('crowd')) {
      for (const sx of [-1, 1]) {
        // 10 m de haut, pas 16 : plus haut, le rideau de public devient un mur qui
        // supprime le ciel et les montagnes des deux cotes. Le stade doit se fermer,
        // pas s'enfermer — c'est la bande de ciel au-dessus qui donne l'echelle.
        const mur = new THREE.Mesh(
          new THREE.PlaneGeometry(190, 10),
          new THREE.MeshBasicMaterial({ map: crowdTier({ repeat: [14, 1] }), toneMapped: false }));
        mur.position.set(sx * (LARGEUR / 2 + 36), 4.5, -64);
        mur.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
        group.add(mur);
      }
    }

    // Mâts de projecteurs, alternés, entre les tribunes et la piste.
    const mats = [[6, 8], [-24, 6.4], [-52, 4.8], [-86, 3.2], [-114, 1.6], [-140, 0]];
    mats.forEach(([z, y], i) => {
      const sx = i % 2 ? 1 : -1;
      const m = prop('spotlight-mast', 16, sx * (LARGEUR / 2 + 3.2), y, z, { rot: sx > 0 ? -1.3 : 1.3 });
      if (!m) {
        const p = pill(11, 0.34, C.edge);
        p.position.set(sx * (LARGEUR / 2 + 4.5), y + 5.5, z);
        group.add(p);
      }
    });

    // Main géante : elle donne l'échelle et pointe la direction, juste avant le goulot.
    prop('giant-foam-hand', 9, -(LARGEUR / 2 + 8), 1.2, -130, { rot: 0.5 });

    // Grue caméra : le seul élément mobile du décor. Elle balaie lentement le couloir.
    const grue = prop('camera-crane-boom', 14, LARGEUR / 2 + 9, 3.4, -70, { rot: -1.5 });
    if (grue) animated.push((t) => { grue.rotation.y = -1.5 + Math.sin(t * 0.16) * 0.42; });

    // Dirigeable et ballons : ils occupent le ciel au-dessus des murets.
    const blimp = prop('blimp', 22, -30, 34, -70, { rot: 0.3 });
    if (blimp) animated.push((t) => {
      blimp.position.x = -30 + Math.sin(t * 0.04) * 26;
      blimp.position.y = 34 + Math.sin(t * 0.2) * 1.2;
    });
    for (const [bx, bz, r, color] of [[-44, -30, 4, 0xff5f7e], [46, -108, 4.4, 0x4fd1c5]]) {
      const b = balloon(r, color);
      b.position.set(bx, GROUND_Y + terrainHeightAt(bx, bz) + 12, bz);
      group.add(b);
    }
  }

  // ─────────────────────────── vie de la scène ───────────────────────────

  /**
   * Rupture d'une porte.
   * Le collider part AVANT le contact (voir DIST_RUPTURE) : le joueur ne doit jamais
   * sentir un ralentissement en franchissant une porte qu'il a correctement lue. Une
   * porte qui freine se lirait comme une erreur de lecture.
   */
  const DIST_RUPTURE = 1.25;

  /** Durée de vol d'un morceau de papier. */
  const VOL = 0.95;

  function briser(p) {
    p.brisee = true;
    p.t = 0;
    world.removeCollider(p.col, true);
    // Les morceaux naissent ICI, pas avant : la plupart des portes ne cèdent jamais.
    p.quartiers = dechirerPanneau(p.feuille, { vers: -1 });

    /*
     * Bouffée de papier à l'endroit exact de la rupture.
     *
     * Neuf morceaux qui s'envolent, c'est la déchirure ; ce qui manquait, c'est
     * l'IMPACT. Une gerbe de confettis teintée comme la porte occupe le cadre pendant
     * les deux dixièmes de seconde où le joueur traverse, et le franchissement cesse
     * d'être un simple effacement.
     */
    papier.emit(new THREE.Vector3(p.x, p.y, p.z - 0.3), {
      count: 18, vers: -1, taille: 0.3, life: 0.9,
      // Les éclats portent les couleurs DE CETTE PORTE : blanc des chevrons, teinte du
      // mur. Une gerbe blanche uniforme se lisait comme de la fumée.
      couleurs: [0xffffff, p.teinte, 0xffffff, p.teinte, 0xfff3fb],
    });

    /*
     * Onde de choc sur les portes VOISINES du même mur : elles frémissent une demi-
     * seconde. C'est ce qui fait du mur une structure et non une collection de plans —
     * et ça ne trahit rien, puisque la porte franchie vient déjà de se révéler.
     */
    for (const q of toutes) {
      if (q === p || q.mur !== p.mur || q.brisee) continue;
      q.choc = Math.max(q.choc, 1 / (1 + Math.abs(q.x - p.x) * 0.6));
    }
  }

  /**
   * Efface le mur que la CAMÉRA traverse.
   *
   * La caméra suit le joueur à huit mètres derrière lui : chaque fois qu'il franchit un
   * mur, elle passe dedans une demi-seconde plus tard. Mesuré au banc, un panneau se
   * retrouvait alors à vingt-neuf centimètres de l'objectif et remplissait la moitié
   * basse de l'écran, juste au moment où le joueur doit lire le mur SUIVANT. On efface
   * donc le mur traversé, et lui seul : les autres restent visibles si le joueur pivote
   * la caméra pour regarder en arrière.
   */
  function masquerMurs(camera) {
    if (!camera) return;
    // 3,2 m et non 1,9 : un mur est plus épais que son plan de portes — corniche et
    // linteau débordent de part et d'autre. Avec la marge trop courte, la caméra sortait
    // du plan des portes tout en restant dans la corniche, qui remplissait alors l'écran
    // d'un aplat magenta. Cette marge ne coûte rien : quand la caméra frôle un mur, le
    // joueur est déjà dix mètres plus loin et ce mur ne lui apprend plus rien.
    const cz = camera.position.z;
    for (const m of murs) m.mur.visible = Math.abs(cz - m.z) > 3.2;
  }

  function update(elapsed, dt = 0.016, focus = null, camera = null) {
    updateFlags(elapsed);
    for (const fn of animated) fn(elapsed);
    if (focus) confetti.update(dt, elapsed, Array.isArray(focus) ? focus[0] : focus);
    masquerMurs(camera);

    // Respiration : TOUTES les feuilles battent, franchissables ou non. N'animer que les
    // premières les désignait aussi sûrement qu'une flèche, le mouvement étant ce que
    // l'œil repère en premier dans une image chargée.
    papier.update(dt);

    for (const p of toutes) {
      if (!p.brisee) {
        // Le choc d'une porte voisine qui cède s'ajoute à la respiration, puis s'éteint.
        p.choc = Math.max(0, p.choc - dt * 2.2);
        const ampleur = SOUFFLE * (1 + p.choc * 2.4);
        p.feuille.scale.z = 1 + Math.sin(elapsed * (2.6 + p.choc * 16) + p.phase) * ampleur;
        // `p.ouverte` est INDISPENSABLE ici. Cette boucle parcourt tous les panneaux,
        // depuis que la respiration s'applique aussi aux portes condamnées ; sans ce
        // test, chacune cédait a l'approche et le mur entier devenait franchissable.
        // `focus` accepte une position ou une LISTE : seize joueurs doivent tous pouvoir
        // enfoncer une porte, pas seulement le personnage local. Le client passe toujours
        // un `Vector3` et ne voit aucune difference.
        if (p.ouverte && focus && (Array.isArray(focus) ? focus : [focus]).some((f) => f
            && Math.abs(f.x - p.x) < p.demiL + 0.35
            && Math.abs(f.y - p.y) < p.demiH + 0.6
            && Math.abs(f.z - p.z) < DIST_RUPTURE)) {
          briser(p);
        }
        continue;
      }
      p.t += dt;
      // Le fondu ne commence qu'aux deux tiers du vol : un papier à demi transparent
      // avant d'avoir quitté le cadre, c'est une porte qui s'efface, pas une porte qui
      // casse. Les morceaux partagent un matériau, le fondu ne se calcule donc qu'une fois.
      const reste = Math.max(0, 1 - p.t / VOL);
      const fondu = Math.min(1, reste / 0.34);
      if (p.quartiers?.length) p.quartiers[0].material.opacity = fondu;
      for (const q of p.quartiers ?? []) {
        if (!q.userData.vitesse) continue;
        q.position.addScaledVector(q.userData.vitesse, dt);
        q.userData.vitesse.y -= 13 * dt;
        // Le papier freine : sans traînée, les morceaux filent en ligne droite comme des
        // éclats de pierre. Un papier perd sa vitesse presque aussitôt.
        q.userData.vitesse.multiplyScalar(1 - Math.min(0.9, dt * 2.4));
        q.rotation.x += q.userData.spin.x * dt;
        q.rotation.y += q.userData.spin.y * dt;
        q.rotation.z += q.userData.spin.z * dt;
      }
      if (p.t > VOL && p.quartiers) {
        // Les quartiers ont fini de tomber : on les retire plutôt que de les laisser
        // invisibles dans la scène, où ils continueraient d'être parcourus.
        p.quartiers[0].material.dispose();       // matériau partagé : une seule libération
        for (const q of p.quartiers) { q.removeFromParent(); q.geometry.dispose(); }
        p.quartiers = null;
      }
    }
  }

  /** Remet toutes les portes en place : appelé quand la manche redémarre sans reconstruction. */
  function reset() {
    for (const p of portes) {
      if (!p.brisee) continue;
      p.brisee = false;
      p.t = 0;
      // Le panneau entier reparaît ; les quartiers, eux, sont jetés.
      if (p.quartiers?.length) p.quartiers[0].material.dispose();
      for (const q of p.quartiers ?? []) { q.removeFromParent(); q.geometry.dispose(); }
      p.quartiers = null;
      p.choc = 0;
      p.feuille.visible = true;
      p.feuille.material.opacity = 1;
      // On réutilise le corps rigide d'origine. En créer un nouveau à chaque remise en
      // place accumulait un corps vide par manche rejouée dans le monde physique.
      p.col = world.createCollider(
        RAPIER.ColliderDesc.cuboid(p.demiL, p.demiH, 0.12), p.body);
    }
  }

  /** Libère le monde physique et les géométries : une arène quittée ne doit rien retenir. */
  function dispose() {
    group.traverse((c) => {
      if (c.isMesh) {
        c.geometry?.dispose();
        // Les textures viennent d'un cache PARTAGÉ entre les scènes : les libérer ici
        // laisserait la scène suivante avec des matériaux noirs.
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) m?.dispose?.();
      }
    });
    group.clear();
    world.free();
  }

  return {
    world, group, spawn, finishZ, killY: -24, checkpoints, conveyors: [], seed,
    // Un peu plus haut et plus loin que le reglage par defaut : il faut voir le mur EN
    // ENTIER une seconde avant de l'atteindre, sinon l'indice arrive trop tard pour etre
    // exploitable et le mini-jeu redevient un tirage.
    camBias: { height: 1.5, distance: 2.2, lookHeight: 0.7, fov: 2 },
    update, reset, dispose,
    checkpointFor(z) {
      let best = checkpoints[0];
      for (const cp of checkpoints) if (z <= cp.z + 1) best = cp;
      return best;
    },
    /** Sonde de diagnostic : état de chaque porte franchissable. */
    __portes: () => portes.map((p) => ({ x: p.x, z: p.z, brisee: p.brisee })),
    /** Nombre de morceaux en vol pour une porte donnee : sonde de l'eclatement. */
    __eclats: (x, z) => toutes.find((p) => Math.abs(p.x - x) < 0.2 && Math.abs(p.z - z) < 0.2)
      ?.quartiers?.length ?? 0,
    /**
     * Sonde de diagnostic : géométrie réelle de chaque mur.
     * Le harnais la LIT au lieu de recalculer les positions de son côté — une première
     * version codait la largeur du couloir en dur et a signalé une fausse anomalie le
     * jour où cette largeur a changé.
     */
    __murs: () => murs.map((m) => ({ z: m.z, y: m.y, xOuvertes: m.xOuvertes, xCondamnees: m.xCondamnees })),
    /**
     * Sonde de diagnostic : signature visuelle de chaque panneau.
     * Elle sert a prouver l'invariant central de ce mini-jeu — l'apparence depend de la
     * POSITION seule. Deux donnes differentes doivent donner exactement les memes
     * signatures aux memes emplacements, alors que les etats, eux, changent.
     */
    __apparences: () => toutes.map((p) => {
      const f = p.feuille;
      return {
        x: +p.x.toFixed(2), z: p.z, ouverte: p.ouverte,
        couleur: f.material.color.getHexString(),
        embleme: f.material.map?.image?.dataset?.cle ?? 'aucun',
        bombement: +f.geometry.attributes.position.getZ(Math.floor(f.geometry.attributes.position.count / 2)).toFixed(4),
        phase: +p.phase.toFixed(4),
      };
    }),
    largeur: LARGEUR,
  };
}
