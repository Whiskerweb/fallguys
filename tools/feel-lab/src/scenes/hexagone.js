import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { toonMaterial } from '../world.js';
import { PuffSystem } from '../effects.js';
import { pill, bunting, updateFlags, banner, stripedPeak } from '../props.js';
import {
  hexFaceChevron, hexFaceZigzag, hexFacePois, slimePink, candyHills, skyTriangles,
} from '../textures.js';

/**
 * L'Hexagone — mini-jeu 5, et la première épreuve du jeu qui ne soit pas une course.
 *
 * Une tour de dalles hexagonales au-dessus d'une boue rose. Chaque hexagone que l'on
 * touche s'enfonce, remonte, blanchit, puis disparaît pour toujours. On ne va nulle part :
 * on tient.
 *
 * ── CE QUI SE JOUE ──────────────────────────────────────────────────────────────
 * Le sol est une RESSOURCE, et le joueur la dépense simplement en étant là. Il n'y a pas
 * de bonne trajectoire à trouver comme sur Les Dalles — tous les hexagones sont
 * identiques et tous cèdent. Ce qui se joue est la gestion d'un budget qui se consume,
 * et le vrai adversaire est le trou qu'on vient soi-même de creuser derrière soi.
 *
 * Rester immobile ne sauve pas : un hexagone touché part, qu'on bouge ou non. C'est cette
 * règle-là qui fait le jeu — sans elle il suffirait de se poser dans un coin et
 * d'attendre.
 *
 * ── TOUTE LA CAPSULE PAIE ───────────────────────────────────────────────────────
 * Un hexagone cède dès que le CORPS le recouvre, pas seulement celui qui se trouve sous
 * le centre. Passer une arête coûte donc deux hexagones, passer un sommet en coûte trois.
 *
 * Ce n'est pas un raffinement, c'est la seule règle cohérente. Le personnage détecte le
 * sol par un unique rayon vertical tiré de son centre : ne facturer que l'hexagone du
 * centre laisserait une capsule à cheval reposer réellement sur deux hexagones dont un
 * seul aurait été payé — et le joueur se retrouverait debout sur un sol qu'il n'a jamais
 * touché. « Creuser son propre trou » EST le jeu ; il faut donc que creuser coûte.
 *
 * ── LES ÉTAGES S'ÉLARGISSENT VERS LE BAS ────────────────────────────────────────
 * Comme dans la référence, et c'est ce qui rend la descente intéressante : tomber d'un
 * étage n'est pas une punition mais un choix, puisqu'on atterrit sur plus de sol qu'on
 * n'en avait. On perd de la hauteur, on gagne du temps. Un joueur qui descend tôt joue
 * une autre partie que celui qui s'accroche en haut, et aucune des deux n'est bête.
 *
 * On ne remonte JAMAIS : 3,20 m entre deux étages contre un apex mesuré à 2,10 m, et
 * 2,39 m même en enchaînant un plongeon au sommet du saut. La tour est à sens unique, et
 * `diag/hexagone.mjs` le revérifie à chaque exécution.
 *
 * ── LE SURSIS, ET SON REBOND ────────────────────────────────────────────────────
 * La référence enfonce la tuile touchée, la fait REMONTER, puis l'évapore — et c'est ce
 * rebond que les bons joueurs lisent pour minuter leur saut. On le reproduit tel quel, en
 * une seule étape : pas de dégradation progressive, qui est la confusion classique avec
 * la tuile de glace de Thin Ice (celle-là supporte trois passages).
 *
 * Le collider SUIT l'enfoncement — la hitbox ne décolle jamais du visuel. En revanche le
 * rebond ne dépasse pas la cote de repos : un collider cinématique qui remonte dans un
 * corps dynamique se fait séparer par le solveur à une vitesse sans borne, et c'est le
 * pire bug qu'ait connu ce projet.
 *
 * ── DÉTERMINISME, ET POURQUOI IL N'Y A PRESQUE RIEN À TIRER ─────────────────────
 * Chaque étage est une grille pleine, identique d'une manche à l'autre — c'est fidèle,
 * et c'est assumé. La rejouabilité de ce mini-jeu ne vient pas du terrain mais de ce que
 * le joueur en fait : deux manches sur la même tour ne se ressemblent pas parce que les
 * trous, eux, sont de lui. La graine ne décide que d'une chose, l'hexagone au-dessus
 * duquel se pose le socle de départ, ce qui suffit à donner une ouverture différente à
 * chaque fois. Aucun Math.random, aucun dt accumulé.
 *
 * ── RÈGLE D'ASSETS ──────────────────────────────────────────────────────────────
 * Ici elle est confortable : un prisme hexagonal est CONVEXE, donc son collider est
 * l'enveloppe convexe des douze sommets du maillage visible. La hitbox n'approche pas le
 * visuel, elle EST le visuel. Dans un jeu où l'on mise et où le joueur juge du bord d'une
 * dalle à dix centimètres près, c'est la seule construction acceptable.
 */

const C = {
  jaune: 0xffd23f,
  cyan: 0x4fc9f0,
  violet: 0xb44ce0,
  socle: 0x8e3fd6,      // le socle de départ, violet comme les tuiles de départ de la référence
  blanchi: 0xffffff,    // la teinte que prend un hexagone condamné
  boue: 0xffffff,       // SIGNAL : la texture porte le rose
  colline: 0xffffff,    // SIGNAL
  ciel: 0xffffff,       // SIGNAL
  poteauHaut: 0xff8a1f,
  poteauBas: 0x6a4bd6,
  barre: 0xff4fa3,
  moulinet: 0xff4fa3,
  montagneA: 0xffb3d9,
  montagneB: 0xffffff,
};

/** PRNG déterministe (mulberry32) : même graine, même tour, sur toutes les machines. */
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

/* ── COTES ─────────────────────────────────────────────────────────────────────────────
 *
 * Toutes déduites du personnage et des deux portées que la référence impose. Aucune n'est
 * réglée à l'œil, et `RAYON` en particulier n'est pas un chiffre rond : il a été choisi
 * pour que les deux règles ci-dessous tombent juste.
 */
const PERSO_LARGE = 0.90;
const PERSO_RAYON = 0.45;
const VOL = Math.sqrt(2 * TUNING.jumpHeight / TUNING.gravity)
          + Math.sqrt(2 * TUNING.jumpHeight / (TUNING.gravity * TUNING.fallMultiplier));
const PORTEE = TUNING.maxSpeed * VOL;

/**
 * RAYON CIRCONSCRIT de 1,80 m — la cote qui décide de tout.
 *
 * Un hexagone flat-top de rayon R a une largeur entre plats de R·√3, et deux voisins se
 * touchent par une arête : le pas entre centres VAUT cette largeur, soit 3,12 m — trois
 * largeurs et demie de corps. Une dalle porte donc largement, et se lit de loin.
 *
 * ── CE QUE CETTE COTE A COÛTÉ, ET IL FAUT LE SAVOIR ─────────────────────────────
 * La carte a d'abord été construite à R = 1,20 m, choisi pour que les deux portées de la
 * référence tombent juste : un saut simple franchissait UN hexagone manquant (4,16 m sous
 * les 4,46 m d'une portée épuisée), un saut-plongeon en franchissait deux. À 1,80 m, un
 * trou d'un seul hexagone mesure 6,24 m — au-delà des 5,27 m d'un saut plein et frais.
 *
 * **Un trou ne se franchit donc plus au saut. Seul le plongeon (≈ 7,4 m) le passe.** C'est
 * un vrai changement de jeu, décidé en connaissance de cause pour la lisibilité : le
 * plongeon devient l'outil du franchissement, et le saut ne sert plus qu'à se déplacer.
 * `diag/hexagone.mjs` mesure les deux portées à chaque exécution et dira si un jour on
 * revient en arrière.
 */
const RAYON = 1.80;
/*
 * Apothème = R·√3/2, et le pas entre deux centres voisins vaut DEUX apothèmes — quelle que
 * soit l'orientation, deux hexagones adjacents se touchent par une arête et leurs centres
 * sont donc séparés de la largeur entre plats. C'est 2,078 m ici.
 */
const APOTHEME = (RAYON * Math.sqrt(3)) / 2;
const PAS = APOTHEME * 2;
const EP = 0.75;

/**
 * ÉCART ENTRE ÉTAGES de 14 m — quatre fois et demie l'écart d'origine.
 *
 * La toute première version tenait ses étages à 3,20 m, juste assez pour qu'on ne puisse
 * pas remonter (apex 2,10 m, 2,39 m en enchaînant un plongeon). C'était suffisant pour la
 * règle et insuffisant pour l'ŒIL : avec 2,70 m de hauteur libre, la caméra se retrouvait
 * coincée entre deux dalles et le joueur ne voyait ni l'étage du dessous, ni ce qui
 * l'attendait en tombant. Une carte dont on ne peut pas lire la profondeur ne se joue pas,
 * elle se subit. 10,50 m ont corrigé le pire ; 14 m dégagent franchement la vue.
 *
 * 13,25 m de hauteur libre, donc — huit fois la taille du personnage. La chute coûte 0,82 s
 * et arrive à 34,2 m/s, encore loin du plafond de 55 m/s du garde-fou de vitesse, et la
 * détection de culbute ne mesure que l'horizontal. `diag/hexagone.mjs` revérifie les deux.
 *
 * La contrainte qui borne cette cote par le haut n'est pas la physique mais le CIEL : la
 * couche de nuages du jeu flotte entre 42 et 72 m, et une tour qui la traverse fait passer
 * des paquets blancs devant le terrain de jeu. C'est pourquoi le sommet est posé à 30 m et
 * que la tour descend au lieu de monter.
 */
const ETAGE_H = 14.00;

/**
 * SURSIS de 1,00 s — la valeur de la référence, après un détour par 0,85.
 *
 * J'avais d'abord raccourci le sursis en me disant que, seul, sans quinze adversaires pour
 * dévorer le sol à votre place, un sursis plein rendrait la tour interminable. La mesure a
 * dit exactement l'inverse : trois pilotes tenaient 7, 26 et 44 secondes contre 75 à
 * atteindre — la tour était trop DURE, pas trop facile. Le raisonnement était juste sur le
 * papier et faux dans le jeu, parce qu'il oubliait qu'un joueur seul creuse aussi son propre
 * trou, et qu'il n'a personne pour lui ouvrir un passage.
 *
 * On revient donc à la seconde de la référence, faute d'avoir la moindre raison mesurée de
 * s'en écarter. Le rebond occupe la seconde moitié du sursis : il faut qu'il soit vu, sinon
 * le joueur n'a aucun signal pour minuter son départ.
 */
const SURSIS = 1.00;
const ENFONCE = 0.12;         // profondeur de l'enfoncement, en mètres
const EVAPORATION = 0.22;     // durée de la disparition, une fois le collider retiré

/**
 * LA TOUR — cinq étages aux anneaux croissants VERS LE BAS.
 *
 * La référence en compte huit ou neuf pour 1 634 tuiles. On en met cinq pour 485, et ce
 * n'est pas de la paresse : huit étages de 3,20 m font une tour de 26 m que ni le survol
 * ni la caméra de jeu ne savent cadrer, et surtout, SEUL, on n'épuise jamais 1 634 tuiles.
 * 485 est un budget qu'un joueur seul ne franchit pas en jouant mal — et c'est le harnais,
 * pas une intuition, qui a le dernier mot sur ce chiffre.
 */
const ETAGES = [
  { anneaux: 3, couleur: C.jaune,  motif: 'chevron' },
  { anneaux: 4, couleur: C.cyan,   motif: 'zigzag' },
  { anneaux: 5, couleur: C.violet, motif: 'pois' },
  { anneaux: 6, couleur: C.jaune,  motif: 'chevron' },
  { anneaux: 7, couleur: C.cyan,   motif: 'zigzag' },
];

/*
 * COTE DU SOMMET — 30 m, posée et non dérivée.
 *
 * Elle valait `ETAGES.length * ETAGE_H`, ce qui allait de soi tant qu'un étage faisait
 * 3,20 m. À 10,50 m, la tour montait à 57 m et traversait la COUCHE DE NUAGES du jeu, qui
 * flotte entre 42 et 72 m : de gros paquets blancs passaient devant les deux étages du
 * haut, c'est-à-dire devant le terrain de jeu. On ne masque pas les nuages pour autant —
 * la référence en a, et ils donnent l'échelle. On pose la tour SOUS eux, ce qui est
 * d'ailleurs là qu'elle se trouve dans la référence.
 *
 * Le sommet à 30 m laisse le socle à 34,50 et le haut de l'ossature à 37,50 : sept mètres
 * et demi de marge sous le premier nuage.
 */
const HAUT = 30;
/* La boue, six mètres sous l'étage le plus bas : assez pour que la chute se voie, pas au
 * point d'en faire un puits. */
const BOUE_Y = HAUT - (ETAGES.length - 1) * ETAGE_H - 6;
/*
 * Le corps porte 0,80 m sous son centre : a cette cote, les PIEDS touchent la boue. Pas
 * plus haut — on serait elimine en survolant la boue —, pas plus bas — on la traverserait
 * a l'ecran avant de mourir, et l'image mentirait sur la regle.
 */
const KILL_Y = BOUE_Y + 0.80;
/*
 * La tuile de départ ne suit PAS l'écart des étages : à 10,50 m au-dessus du sommet, elle
 * lancerait la manche par une chute d'une seconde avant le premier choix. 4,50 m suffit
 * largement à interdire le retour (apex 2,39 m au mieux) et laisse la tour se découvrir.
 */
const SOCLE_Y = HAUT + 4.50;

/**
 * DURÉE À TENIR — 75 s, et cette fois le chiffre est MESURÉ.
 *
 * La forme de la règle vient de la référence, qui s'arrête elle aussi au bout d'un délai et
 * donne alors la couronne à tous les survivants. Le chiffre, lui, sort de la fenêtre que
 * `diag/hexagone.mjs` relève à chaque exécution, avec le plafond temporairement relevé :
 *
 *   rester immobile ................  10 s
 *   courir sans se ménager .........  46 s
 *   économiser son sol ............. 116 s
 *
 * 75 s tombe au milieu : une fois et demie ce qu'obtient un jeu grossier, deux tiers de ce
 * qu'obtient un jeu appliqué. La manche se perd en paniquant et se gagne en se tenant.
 *
 * Note pour la suite : à l'échelle précédente — dalles d'un tiers plus petites — le harnais
 * n'arrivait PAS à produire cette mesure, faute de pouvoir se tenir à moins de 60 cm d'un
 * centre à dix images par seconde. En agrandissant la dalle pour la lisibilité, on a rendu
 * la carte mesurable par la même occasion.
 */
const DUREE = 75;

/**
 * Coordonnées axiales d'un disque hexagonal de `n` anneaux — 3n²+3n+1 cases.
 *
 * Repère axial classique (q, r) pour une grille FLAT-TOP : les colonnes s'alignent en x,
 * les rangées se décalent d'un demi-pas. C'est l'orientation de la référence, vérifiée sur
 * ses captures : arête plate en haut et en bas, sommets à gauche et à droite.
 */
function disque(n) {
  const out = [];
  for (let q = -n; q <= n; q++) {
    for (let r = Math.max(-n, -q - n); r <= Math.min(n, -q + n); r++) out.push([q, r]);
  }
  return out;
}

/**
 * Axial → monde, grille FLAT-TOP.
 *
 * Les six voisins d'un hexagone se trouvent dans la direction de ses six NORMALES d'arête,
 * soit 30°, 90°, 150°… en flat-top. La base axiale est donc `q → (PAS·√3/2, PAS/2)` et
 * `r → (0, PAS)`, ce qui se simplifie en les deux lignes ci-dessous.
 */
function versMonde(q, r) {
  return {
    x: RAYON * 1.5 * q,
    z: RAYON * Math.sqrt(3) * (q / 2 + r),
  };
}

/**
 * Monde → axial, puis arrondi CUBIQUE.
 *
 * L'arrondi cubique n'est pas un raffinement : arrondir q et r séparément désigne la
 * mauvaise case sur les bords, là où trois hexagones se rencontrent — précisément
 * l'endroit où un joueur se tient quand il est à cheval, c'est-à-dire le cas qui compte.
 * On passe donc par les trois coordonnées cubiques, on arrondit les trois, et on répare
 * celle qui a le plus dérivé.
 */
function versAxial(x, z) {
  const q = ((2 / 3) * x) / RAYON;
  const r = (-x / 3 + (Math.sqrt(3) / 3) * z) / RAYON;
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

/**
 * Le corps recouvre-t-il cet hexagone ?
 *
 * Distance d'un point au polygone, exacte et sans boucle : un hexagone régulier flat-top
 * est l'intersection de trois bandes, une par paire d'arêtes opposées. Le point est à
 * l'intérieur du polygone dilaté de `marge` si sa projection sur chacune des trois
 * normales reste sous `APOTHEME + marge`. Trois produits scalaires, aucun cas particulier.
 */
const NORMALES = [0, 1, 2].map((i) => {
  const a = Math.PI / 6 + (i * Math.PI) / 3;
  return [Math.cos(a), Math.sin(a)];
});
function recouvre(dx, dz, marge) {
  const lim = APOTHEME + marge;
  for (const [nx, nz] of NORMALES) if (Math.abs(dx * nx + dz * nz) > lim) return false;
  return true;
}

export function buildHexagone(RAPIER, assets, { seed = 1 } = {}) {
  const rand = prng(seed);
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  const group = new THREE.Group();
  const poussiere = new PuffSystem(group, { count: 160, color: 0xffffff });

  /* ── Le prisme hexagonal : un seul objet pour le visuel ET le collider ────────────────
   *
   * Une CylinderGeometry à six segments radiaux EST un prisme hexagonal. On lit ses douze
   * sommets une fois pour toutes et on en fait l'enveloppe convexe Rapier : il n'y a donc
   * pas d'écart possible entre ce qu'on voit et ce qui porte, puisque les deux sont
   * construits à partir des mêmes nombres.
   */
  /*
   * `thetaStart = π/2` place un SOMMET sur +X, donc des arêtes plates perpendiculaires à Z :
   * vu de dessus, l'hexagone a une arête plate en haut et en bas et des pointes à gauche et
   * à droite. C'est l'orientation FLAT-TOP de la référence, vérifiée sur ses captures — et
   * c'est aussi celle que suppose `versMonde`. Sans ce quart de tour, Three.js pose son
   * premier sommet sur +Z et toute la grille se retrouve tournée de 30° par rapport aux
   * normales du test de recouvrement.
   */
  const geoHexa = new THREE.CylinderGeometry(RAYON, RAYON, EP, 6, 1, false, Math.PI / 2);
  /*
   * Le collider est l'enveloppe convexe des sommets DU MAILLAGE, relus dans la géométrie
   * qui vient d'être construite — pas d'une seconde formule qui dirait la même chose. Deux
   * expressions du même hexagone finiraient un jour par diverger d'un cheveu ; celle-ci ne
   * le peut pas, puisqu'il n'y en a qu'une. Rapier réduit les doublons d'UV tout seul.
   */
  const sommets = new Float32Array(geoHexa.attributes.position.array);

  const motifs = {
    chevron: hexFaceChevron(),
    zigzag: hexFaceZigzag(),
    pois: hexFacePois(),
  };

  const etages = [];   // la TOUR, telle que la lisent la caméra et les sondes
  const tous = [];     // + la tuile de départ : tout ce qui cède, pour les boucles internes
  const enMouvement = new Set();
  const dummy = new THREE.Object3D();
  const teinte = new THREE.Color();
  const BLANC = new THREE.Color(C.blanchi);

  /**
   * Construit un étage : ses hexagones, leurs colliders, son InstancedMesh.
   *
   * Un seul corps fixe porte tous les colliders de l'étage. Un hexagone qui cède voit son
   * collider retiré individuellement ; le corps, lui, ne bouge jamais.
   */
  function batirEtage(indice, def, force = null) {
    const y = force?.y ?? HAUT - indice * ETAGE_H;
    const cases = force?.cases ?? disque(def.anneaux);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    /*
     * Materiau BLANC, couleur portee par instance.
     *
     * La reference fait blanchir la tuile touchee avant qu'elle ne s'evapore : c'est, avec
     * l'enfoncement, la moitie du signal qui dit au joueur combien de temps il lui reste.
     * Une seule teinte pour tout l'etage ne pourrait pas l'exprimer — il faudrait un
     * materiau par hexagone, donc un appel de dessin par hexagone. `instanceColor` le donne
     * gratuitement : le motif reste un MOTIF quasi blanc, et c'est la teinte d'instance qui
     * porte a la fois la couleur de l'etage et son extinction.
     */
    /*
     * TROIS materiaux, un par groupe de la geometrie : flanc, dessus, dessous.
     *
     * `CylinderGeometry` decoupe ses faces en trois groupes, et un `InstancedMesh` accepte
     * un tableau de materiaux comme n'importe quel maillage. Sans cela le motif de la face
     * s'etalait aussi sur les six flancs du prisme, ou ses UV le distordent : vu de biais,
     * la dalle etait barbouillee de chevrons etires et son epaisseur ne se lisait plus. Le
     * flanc est donc un aplat un peu plus sombre — c'est lui qui donne au damier son
     * relief quand on le regarde de profil, et c'est de profil qu'on lit un trou.
     */
    const flanc = toonMaterial(0xb4b4b4);
    const dessus = toonMaterial(0xffffff);
    dessus.map = motifs[def.motif];
    const dessous = toonMaterial(0x8f8f8f);
    const mesh = new THREE.InstancedMesh(geoHexa, [flanc, dessus, dessous], cases.length);
    // Les instances bougent (enfoncement, rebond, évaporation) : le volume englobant
    // calculé au départ ne vaut plus rien et le culling ferait clignoter des étages
    // entiers.
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);

    const s = {
      indice, y, cols: def.anneaux, couleur: def.couleur, mesh, body,
      teinteBase: new THREE.Color(def.couleur), hexas: [], parCle: new Map(),
    };

    const teinteBase = new THREE.Color(def.couleur);
    cases.forEach(([q, r], i) => {
      const { x, z } = versMonde(q, r);
      const h = {
        i, q, r, x, z, etage: tous.length, etat: 'posee', t: 0, dy: 0, echelle: 1,
        sursisReel: null, collider: null,
      };
      h.collider = world.createCollider(
        RAPIER.ColliderDesc.convexHull(sommets)
          .setTranslation(x, y - EP / 2, z)
          .setFriction(0.62),
        body);
      s.hexas.push(h);
      s.parCle.set(`${q},${r}`, h);
      poserMatrice(s, h);
      mesh.setColorAt(i, teinteBase);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    tous.push(s);
    if (!force) etages.push(s);
    return s;
  }

  function poserMatrice(s, h) {
    dummy.position.set(h.x, s.y - EP / 2 + h.dy, h.z);
    dummy.scale.setScalar(h.echelle);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    s.mesh.setMatrixAt(h.i, dummy.matrix);
  }

  ETAGES.forEach((def, i) => batirEtage(i, def));

  /* ── La tuile de départ ───────────────────────────────────────────────────────────────
   *
   * Un hexagone SEUL, un étage au-dessus du sommet de la tour — les tuiles de départ
   * violettes et isolées de la référence, une par joueur, au-dessus de la première couche
   * pleine.
   *
   * Elle CÈDE comme les autres, et c'est le point important : une tuile de départ
   * indestructible serait un abri permanent, donc une façon de gagner la manche en ne
   * jouant pas. Le harnais l'a d'ailleurs trouvée toute seule — un pilote qui ne faisait
   * rien tenait la durée entière sans consommer un seul hexagone. Sur une carte de survie,
   * le moindre mètre carré éternel annule l'épreuve.
   *
   * Ce qui la rend sûre pendant le décompte n'est donc pas sa matière mais `enJeu` : la
   * boucle de jeu ne désarme la sonde qu'une fois la présentation finie et le décompte
   * écoulé. C'est la même garde pour toute la tour, et elle se vérifie.
   *
   * Elle forme un étage à part entière — même sursis, même blanchiment, même remise à
   * zéro — mais reste hors de `__etages()`, qui décrit la TOUR : un étage d'un seul
   * hexagone fausserait toute lecture de la carte.
   */
  const sommetCases = disque(ETAGES[0].anneaux);
  const depart = sommetCases[Math.floor(rand() * sommetCases.length)];
  const departXZ = versMonde(depart[0], depart[1]);
  batirEtage(etages.length, {
    anneaux: 0, couleur: C.socle, motif: 'pois',
  }, { y: SOCLE_Y, cases: [[depart[0], depart[1]]] });

  const spawn = new THREE.Vector3(departXZ.x, SOCLE_Y + 1.2, departXZ.z);

  /* ── La boue ──────────────────────────────────────────────────────────────────────────
   *
   * Pas de collider : on n'y atterrit jamais, on la TOUCHE et la manche s'arrête. Un
   * collider ne servirait qu'à faire rebondir un cadavre.
   */
  const RAYON_BOUE = 150;
  {
    const mat = toonMaterial(C.boue);
    mat.map = slimePink({ repeat: [14, 14] });
    const boue = new THREE.Mesh(new THREE.CircleGeometry(RAYON_BOUE, 48), mat);
    boue.rotation.x = -Math.PI / 2;
    boue.position.y = BOUE_Y;
    boue.receiveShadow = true;
    group.add(boue);
  }

  /* ── L'ossature ───────────────────────────────────────────────────────────────────────
   *
   * Six poteaux d'angle et des garde-corps horizontaux, en dégradé orange en haut vers
   * bleu-violet en bas, avec les petits moulinets roses de la référence.
   *
   * AUCUN COLLIDER. L'ossature se tient au-delà du plus large des étages : on tombe bien
   * avant de pouvoir la toucher. Un collider qu'aucun joueur ne peut atteindre est une
   * hitbox qui ne correspond à rien — exactement ce que ce projet refuse.
   */
  const RAYON_CAGE = (ETAGES[ETAGES.length - 1].anneaux + 1.6) * PAS;
  const moulinets = [];
  if (!skipped('scenery')) {
    const cage = new THREE.Group();
    const nuance = new THREE.Color();
    const HAUT_CAGE = SOCLE_Y + 3;
    /*
     * `pill()` construit sa capsule le long de Y : un poteau se pose donc SANS rotation, et
     * c'est une barre horizontale qu'il faut coucher. La première version faisait
     * exactement l'inverse — les six poteaux gisaient à plat en travers du paysage comme
     * des poutres orange de trente mètres, et les garde-corps se dressaient à la verticale.
     * On oriente donc par QUATERNION, d'un vecteur vers l'autre : une rotation d'Euler à
     * deux axes dépend de l'ordre d'application, et c'est exactement le genre de détail
     * qu'on croit avoir en tête et qu'on n'a pas.
     */
    const HAUT_Y = new THREE.Vector3(0, 1, 0);
    const coucher = (mesh, de, vers) => {
      mesh.quaternion.setFromUnitVectors(HAUT_Y, vers.clone().sub(de).normalize());
      mesh.position.copy(de).add(vers).multiplyScalar(0.5);
    };
    const sommet = (i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      return new THREE.Vector3(Math.cos(a) * RAYON_CAGE, 0, Math.sin(a) * RAYON_CAGE);
    };

    for (let i = 0; i < 6; i++) {
      const p0 = sommet(i);
      // Poteau : vertical, et en DEGRADE sur sa hauteur — orange en haut, bleu-violet en
      // bas, comme la référence. Un seul segment ne pourrait pas porter un dégradé, on en
      // empile donc quelques-uns.
      const N = 10, htot = HAUT_CAGE - BOUE_Y;
      for (let k = 0; k < N; k++) {
        nuance.set(C.poteauBas).lerp(new THREE.Color(C.poteauHaut), k / (N - 1));
        const seg = pill(htot / N + 0.4, 0.85, nuance.getHex());
        seg.position.set(p0.x, BOUE_Y + (k + 0.5) * (htot / N), p0.z);
        cage.add(seg);
      }

      // Garde-corps horizontaux, un par étage : ils donnent l'échelle de la tour et
      // rappellent, de loin, combien il reste à descendre.
      const p1 = sommet(i + 1);
      for (let e = 0; e <= ETAGES.length; e++) {
        const y = HAUT - e * ETAGE_H;
        const barre = pill(RAYON_CAGE + 0.4, 0.30, C.barre);
        coucher(barre, p0.clone().setY(y), p1.clone().setY(y));
        cage.add(barre);
      }

      /*
       * Moulinet rose accroché en haut du poteau, tourné dans `update`.
       *
       * C'est le seul mouvement permanent de toute la carte, et il n'est pas décoratif :
       * une tour dont RIEN ne bouge tant que le joueur ne bouge pas se lit comme une image
       * figée. Les moulinets tournent à des vitesses légèrement différentes — un ensemble
       * parfaitement synchrone se lirait comme une seule pièce mécanique.
       */
      const moulinet = new THREE.Group();
      for (let b = 0; b < 4; b++) {
        const pale = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 1.15, 0.06),
          toonMaterial(b % 2 ? C.moulinet : 0xffffff));
        pale.position.y = 0.62;
        const pivot = new THREE.Group();
        pivot.rotation.z = (Math.PI / 2) * b;
        pivot.add(pale);
        moulinet.add(pivot);
      }
      moulinet.position.set(p0.x * 0.95, HAUT_CAGE - 1.2, p0.z * 0.95);
      moulinet.rotation.y = -Math.atan2(p0.z, p0.x);
      moulinet.userData.tourne = 1.6 + i * 0.31;
      cage.add(moulinet);
      moulinets.push(moulinet);
    }
    group.add(cage);

    // Panneaux-bannières accrochés à la structure, comme dans la référence.
    for (const [i, y] of [[0, HAUT - 1.2], [2, HAUT - ETAGE_H * 2], [4, HAUT - ETAGE_H * 3.6]]) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const p = banner(7.5, C.barre, 'HEX');
      p.position.set(Math.cos(a) * (RAYON_CAGE - 0.6), y, Math.sin(a) * (RAYON_CAGE - 0.6));
      p.rotation.y = -a + Math.PI / 2;
      group.add(p);
    }

    const fanions = bunting(RAYON_CAGE * 1.7, 26);
    fanions.position.set(0, SOCLE_Y + 2.2, 0);
    group.add(fanions);
  }

  /* ── Le paysage ───────────────────────────────────────────────────────────────────────
   *
   * Collines vertes à lignes de niveau, montagnes roses et blanches, ciel pâle à
   * triangles. Tout est loin, tout est SIGNAL, rien ne porte de collider.
   */
  if (!skipped('scenery')) {
    const collines = new THREE.Mesh(
      new THREE.RingGeometry(RAYON_CAGE + 6, 380, 64),
      (() => { const m = toonMaterial(C.colline); m.map = candyHills({ repeat: [26, 26] }); return m; })());
    collines.rotation.x = -Math.PI / 2;
    collines.position.y = BOUE_Y + 0.12;
    group.add(collines);

    /*
     * BANDE D'HORIZON, et non une sphère de ciel.
     *
     * Le jeu possède déjà son ciel et ses nuages, posés par l'ambiance ; en refermer un
     * second par-dessus masquerait les deux. Ce qui manque à la référence n'est pas le
     * ciel mais l'ARRIÈRE-PLAN à triangles qui ferme le fond de l'arène derrière les
     * collines. C'est un cylindre ouvert, non éclairé — un fond ne reçoit pas d'ombre, et
     * un matériau toon le ferait basculer avec le soleil.
     */
    const fond = new THREE.Mesh(
      new THREE.CylinderGeometry(420, 420, 300, 40, 1, true),
      new THREE.MeshBasicMaterial({
        map: skyTriangles({ repeat: [10, 2] }),
        color: C.ciel,
        side: THREE.BackSide,
        fog: false,
      }));
    fond.position.y = BOUE_Y + 120;
    group.add(fond);

    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      const d = 210 + (i % 3) * 55;
      const p = stripedPeak(40 + (i % 4) * 11, 70 + (i % 5) * 24, C.montagneA, C.montagneB);
      p.position.set(Math.cos(a) * d, BOUE_Y, Math.sin(a) * d);
      group.add(p);
    }

    /*
     * PAS DE BUISSONS, et c'est un choix, pas un oubli.
     *
     * `berry-bush-pink` a été généré, regardé, et écarté. Vu seul dans la visionneuse c'est
     * un buisson vert tout à fait correct ; posé sur les collines à trente mètres, il se
     * réduit à une tache sombre et mouchetée qui se lit comme une plaque de terre — même
     * agrandi et le contour affiné. Le modèle reste au dépôt, il resservira de près.
     *
     * C'est la même règle qui avait fait retirer cinq textures générées du Rondin : un
     * asset qui jure avec le reste ne se garde pas au motif qu'il a coûté des crédits. Les
     * collines nues se lisent mieux que les collines sales.
     */
    // Montagnes bonbon du fond. Les `stripedPeak()` procéduraux tiennent déjà l'horizon ;
    // celles-ci s'intercalent plus près pour casser la régularité de leur anneau.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 1.9;
      const m = assets?.get?.('candy-peak-pink', 74 + (i % 3) * 18, { outline: 0.002 });
      if (!m) break;
      m.position.set(Math.cos(a) * 205, BOUE_Y, Math.sin(a) * 205);
      group.add(m);
    }
  }

  /* ── LA SONDE ─────────────────────────────────────────────────────────────────────────
   *
   * Tout hexagone que le corps recouvre passe en sursis. On ne teste que l'étage dont la
   * cote correspond à la position verticale du joueur — sans cela, un joueur en chute
   * libre déclencherait au passage tous les étages qu'il traverse, et arriverait en bas
   * sur une tour déjà vidée.
   *
   * La fenêtre est asymétrique : large vers le haut (on peut être debout, accroupi, en
   * plein saut au-dessus d'un hexagone qu'on va retoucher), serrée vers le bas (on ne
   * déclenche pas l'étage du dessous en marchant au-dessus de lui).
   */
  function sonder(p) {
    for (const s of tous) {
      const dy = p.y - s.y;
      if (dy < 0.35 || dy > 1.55) continue;
      // Les cases voisines suffisent : on part de l'axiale la plus proche et on regarde
      // autour. Balayer les 169 hexagones d'un étage à chaque image serait du gâchis.
      const [q0, r0] = versAxial(p.x, p.z);
      for (let dq = -1; dq <= 1; dq++) {
        for (let dr = -1; dr <= 1; dr++) {
          const h = s.parCle.get(`${q0 + dq},${r0 + dr}`);
          if (!h || h.etat !== 'posee') continue;
          if (!recouvre(p.x - h.x, p.z - h.z, PERSO_RAYON)) continue;
          h.etat = 'sursis';
          h.t = 0;
          enMouvement.add(h);
        }
      }
      return;
    }
  }

  let consommes = 0;

  /**
   * Boucle des hexagones condamnés.
   *
   * Trois états et rien de plus, comme la référence : `sursis` (il s'enfonce puis remonte,
   * et il PORTE toujours), `evapore` (le collider est parti, le maillage rétrécit),
   * `disparu`. Pas de dégradation par paliers — c'est la tuile de glace de Thin Ice qui
   * supporte trois passages, pas celle-ci.
   */
  function avancerHexas(dt) {
    if (!enMouvement.size) return;
    const finis = [];
    const touches = new Set();
    for (const h of enMouvement) {
      const s = tous[h.etage];
      touches.add(s);
      if (h.etat === 'sursis') {
        h.t += dt;
        const u = Math.min(1, h.t / SURSIS);
        /*
         * Enfoncement puis REBOND — le signal de timing de la référence.
         *
         * Une demi-sinusoïde : l'hexagone descend jusqu'à mi-parcours puis remonte
         * exactement à sa cote de repos. Il ne la DÉPASSE pas, et ce n'est pas une
         * approximation par paresse : un collider cinématique qui remonte dans un corps
         * dynamique se fait séparer par le solveur à une vitesse sans borne, et c'est
         * précisément le bug qui envoyait autrefois le joueur par-dessus le décor.
         */
        h.dy = -ENFONCE * Math.sin(u * Math.PI);
        // Le blanchiment court sur tout le sursis, l'enfoncement fait un aller-retour : les
        // deux signaux ne disent donc pas la meme chose. A mi-course l'hexagone est remonte
        // mais deja a moitie blanc — c'est la seule facon de distinguer « il vient d'etre
        // touche » de « il part maintenant », que le seul enfoncement confondrait.
        teinte.copy(s.teinteBase).lerp(BLANC, u * 0.85);
        s.mesh.setColorAt(h.i, teinte);
        if (h.collider) h.collider.setTranslation({ x: h.x, y: s.y - EP / 2 + h.dy, z: h.z });
        if (h.t >= SURSIS) {
          h.etat = 'evapore';
          // La scène mesure son PROPRE sursis. Le chronométrer depuis Node donnerait le
          // temps de la boucle de mesure, pas celui de la dalle — la leçon des Dalles,
          // où le décalage constant de +0,55 s était l'instrument et non la carte.
          h.sursisReel = h.t;
          h.t = 0;
          world.removeCollider(h.collider, true);
          h.collider = null;
          consommes++;
          poussiere.emit(new THREE.Vector3(h.x, s.y, h.z),
            { count: 5, spread: 1.1, rise: 1.0, size: 0.22, life: 0.45 });
        }
      } else if (h.etat === 'evapore') {
        h.t += dt;
        const u = Math.min(1, h.t / EVAPORATION);
        h.echelle = 1 - u;
        h.dy = -ENFONCE - u * 0.5;
        if (u >= 1) { h.etat = 'disparu'; h.echelle = 0; finis.push(h); }
      }
      poserMatrice(s, h);
    }
    for (const s of touches) {
      s.mesh.instanceMatrix.needsUpdate = true;
      s.mesh.instanceColor.needsUpdate = true;
    }
    for (const h of finis) enMouvement.delete(h);
  }


  /**
   * @param {boolean} enJeu la manche a-t-elle réellement commencé ?
   *
   * Cinquième argument, fourni par la boucle de jeu. Sans lui, la tour s'éroderait pendant
   * les sept secondes de présentation et les trois de décompte — une dizaine de secondes
   * sous un joueur qui ne peut pas encore bouger. Les animations de décor, elles, tournent
   * quand même : une tour figée pendant sa propre présentation serait une carte morte.
   */
  function update(elapsed, dt, focus, camera, enJeu = true) {
    updateFlags(elapsed);
    for (const m of moulinets) m.rotation.z = elapsed * m.userData.tourne;
    if (enJeu && focus) sonder(focus);
    // Les hexagones déjà condamnés continuent leur course même hors jeu : sinon la tour se
    // figerait en plein effondrement pendant les 3,2 s du verdict.
    avancerHexas(dt);
    poussiere.update(dt);
  }

  function reset() {
    for (const s of tous) {
      for (const h of s.hexas) {
        if (h.etat === 'posee') continue;
        h.etat = 'posee'; h.t = 0; h.dy = 0; h.echelle = 1; h.sursisReel = null;
        if (!h.collider) {
          h.collider = world.createCollider(
            RAPIER.ColliderDesc.convexHull(sommets)
              .setTranslation(h.x, s.y - EP / 2, h.z)
              .setFriction(0.62),
            s.body);
        } else {
          h.collider.setTranslation({ x: h.x, y: s.y - EP / 2, z: h.z });
        }
        poserMatrice(s, h);
        s.mesh.setColorAt(h.i, s.teinteBase);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
      s.mesh.instanceColor.needsUpdate = true;
    }
    enMouvement.clear();
    consommes = 0;
  }

  /** Libère le monde physique et les géométries : une arène quittée ne doit rien retenir. */
  function dispose() {
    poussiere.dispose?.();
    group.traverse((c) => {
      if (c.isMesh) {
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
    world, group, spawn, seed,
    /*
     * MODE SURVIE. La présence de ce champ déclare le mode : la boucle de jeu ne connaît
     * aucune liste d'identifiants, et une carte de survie de plus n'aura rien à y ajouter.
     */
    survie: { duree: DUREE },
    objectif: 'STAY ABOVE THE SLIME!',
    killY: KILL_Y,
    /*
     * `finishZ` n'est plus lu par aucun chemin de survie — mais il l'est encore par
     * plusieurs harnais, et un `undefined` y devient un NaN silencieux qui envoie la
     * caméra nulle part. On le pose donc à la cote du départ : sans effet, et sans piège.
     */
    finishZ: spawn.z,
    // `conveyors` est parcouru sans garde par la boucle de jeu, à chaque contact au sol :
    // l'omettre lèverait une TypeError au premier pas.
    conveyors: [],
    checkpoints: [{ x: spawn.x, y: spawn.y, z: spawn.z }],
    checkpointFor() { return { x: spawn.x, y: spawn.y, z: spawn.z }; },
    /*
     * SURVOL — la caméra remonte de la boue jusqu'au socle de départ, comme la référence.
     *
     * Fourni à la main parce que le survol générique échantillonne une ligne de départ à
     * arrivée en Z : sur une tour, ces deux cotes sont confondues et il n'y aurait rien à
     * échantillonner. Tout le rail reste au-dessus de `killY`.
     */
    survol: (() => {
      const R = RAYON_CAGE + 16;
      const cles = [];
      const N = 5;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const a = 0.6 + u * 2.1;
        const y = BOUE_Y + 1.5 + u * (SOCLE_Y - BOUE_Y + 4);
        cles.push({
          pos: [Math.cos(a) * R, y, Math.sin(a) * R],
          look: [0, BOUE_Y + 2 + u * (SOCLE_Y - BOUE_Y), 0],
        });
      }
      return cles;
    })(),
    /*
     * Caméra HAUTE et bien reculée. Ce qu'il faut lire ici n'est pas le personnage mais les
     * TROUS autour de lui — et l'étage du dessous, qui est la sortie de secours. Au ras du
     * sol, une tour n'est qu'un mur de dalles.
     *
     * Le recul a suivi l'agrandissement des dalles : à 3,12 m de pas, un cadrage réglé pour
     * des dalles de 2,08 m ne montre plus qu'une poignée de cases autour des pieds, et le
     * joueur décide sans voir le terrain sur lequel il décide.
     */
    camBias: { height: 5.5, distance: 4.5, lookHeight: -1.6, fov: 6 },
    update, reset, dispose,
    largeur: (ETAGES[ETAGES.length - 1].anneaux * 2 + 1) * PAS,
    /** Sondes de diagnostic. */
    __cotes: () => ({
      RAYON, APOTHEME, PAS, EP, ETAGE_H, HAUT, SOCLE_Y, BOUE_Y, KILL_Y,
      SURSIS, ENFONCE, EVAPORATION, DUREE,
      PORTEE, VOL, PERSO_LARGE, PERSO_RAYON,
      TROU_1: 2 * PAS, TROU_2: 3 * PAS,
      TOTAL: etages.reduce((n, s) => n + s.hexas.length, 0),
      DEPART_Y: SOCLE_Y,
    }),
    __etages: () => etages.map((s) => ({
      indice: s.indice, y: s.y, anneaux: s.cols, total: s.hexas.length,
      restants: s.hexas.filter((h) => h.etat === 'posee').length,
      rayon: (s.cols + 0.5) * PAS,
    })),
    __hexas: (indice) => etages[indice].hexas.map((h) => ({
      q: h.q, r: h.r, x: h.x, z: h.z, etat: h.etat, sursisReel: h.sursisReel,
    })),
    __etats: () => etages.flatMap((s) => s.hexas
      .filter((h) => h.etat !== 'posee')
      .map((h) => ({ e: s.indice, q: h.q, r: h.r, etat: h.etat, sursisReel: h.sursisReel }))),
    __consommes: () => consommes,
    /*
     * Sonde NON DESTRUCTIVE : quels hexagones un corps place ici recouvrirait-il ?
     *
     * Exactement la regle de `sonder`, sans l'appliquer. Elle sert a deux choses, et les
     * deux comptent : verifier la regle « toute la capsule paie » sans que le solveur s'en
     * mele — une capsule posee pile sur un sommet ou trois hexagones se rencontrent en est
     * expulsee, et la mesure decrivait cette derive plutot que la regle —, et permettre a
     * un pilote de diagnostic de REGARDER ou il met les pieds, comme le fait un joueur.
     */
    __sonde: (x, y, z) => {
      const out = [];
      for (const s of tous) {
        const dy = y - s.y;
        if (dy < 0.35 || dy > 1.55) continue;
        const [q0, r0] = versAxial(x, z);
        for (let dq = -1; dq <= 1; dq++) {
          for (let dr = -1; dr <= 1; dr++) {
            const h = s.parCle.get(`${q0 + dq},${r0 + dr}`);
            if (!h) continue;
            if (!recouvre(x - h.x, z - h.z, PERSO_RAYON)) continue;
            // `u` est l'avancement du sursis, de 0 a 1 — la meme information que
            // l'enfoncement et le blanchiment donnent a l'oeil du joueur. Un pilote de
            // diagnostic doit pouvoir lire ce que la carte MONTRE, sinon il joue en
            // aveugle et ne mesure que sa propre cecite.
            out.push({
              e: s.indice, q: h.q, r: h.r, x: h.x, z: h.z, etat: h.etat,
              u: h.etat === 'sursis' ? Math.min(1, h.t / SURSIS) : (h.etat === 'posee' ? 0 : 1),
            });
          }
        }
        return out;
      }
      return out;
    },
    /** L'hexagone sous ce point, sur l'etage donne, est-il encore intact ? */
    __intact: (x, z, indice) => {
      const s = etages[indice];
      if (!s) return false;
      const [q0, r0] = versAxial(x, z);
      const h = s.parCle.get(`${q0},${r0}`);
      return !!h && h.etat === 'posee';
    },
    __depart: () => ({ q: depart[0], r: depart[1], x: departXZ.x, z: departXZ.z }),
    __ray: (ox, oy, oz, dx, dy, dz, max = 60) => {
      const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
      const hit = world.castRay(ray, max, true);
      return hit ? hit.timeOfImpact : null;
    },
  };
}
