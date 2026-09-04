/**
 * LES AUTRES JOUEURS — avatars, et interpolation.
 *
 * Le serveur envoie des instantanés vingt fois par seconde ; l'écran en affiche soixante.
 * Poser bêtement chaque personnage à la dernière position reçue donnerait un mouvement
 * saccadé à 20 images par seconde au milieu d'un jeu qui en fait 60 — c'est immédiatement
 * visible, et c'est le défaut n°1 d'un premier jet de multijoueur.
 *
 * ─── ON AFFICHE LE PASSÉ ────────────────────────────────────────────────────
 *
 * La technique standard, et elle est contre-intuitive : on affiche les autres joueurs
 * **cent millisecondes en retard**. Ce délai garantit qu'on a presque toujours DEUX
 * instantanés encadrant l'instant qu'on veut montrer, donc qu'on peut interpoler entre eux
 * au lieu d'extrapoler dans le vide.
 *
 * Sans ce retard, il faudrait deviner où va un joueur, et se tromper à chaque changement
 * de direction — un personnage qui part en avant puis revient en arrière est bien plus
 * dérangeant qu'un personnage affiché un dixième de seconde trop tard, retard que personne
 * ne remarque.
 *
 * Cent millisecondes, c'est deux instantanés à 20 Hz : de quoi encaisser la perte d'un
 * paquet sans que l'interpolation s'arrête.
 *
 * ─── ON INTERPOLE SUR L'HEURE D'ARRIVÉE ─────────────────────────────────────
 *
 * Et non sur le tick du serveur. Le client n'a pas l'horloge du serveur, et tenter de la
 * synchroniser pour ce seul usage coûterait un protocole de plus. L'heure d'arrivée locale
 * suffit : elle porte la même régularité, à la gigue du réseau près — que le retard de
 * cent millisecondes absorbe précisément.
 */

import * as THREE from 'three';
import { createRiggedCharacter } from '../rig.js';
import { MODELS } from '../cosmetics.js';
import { TUNING } from '../tuning.js';

/** De combien on affiche le passé. Deux instantanés à 20 Hz. */
export const RETARD = 0.100;

/** Au-delà, un instantané ne sert plus à rien : on le jette pour ne pas gonfler la mémoire. */
const MEMOIRE = 1.5;

/** Taille du personnage, la même que le contrôleur local. */
const HAUTEUR = 1.60;
/** Distance du centre de la capsule au sol — la même constante que `character.js`. */
const PIED = 0.80;
const RAYON = 0.45;

export function creerFigurants({ scene, assets }) {
  /** Les avatars, par index de joueur. */
  const avatars = new Map();
  /** Les instantanés reçus, du plus ancien au plus récent. */
  const tampon = [];

  // Deux quaternions de travail, réutilisés : `update` tourne soixante fois par seconde
  // pour chaque figurant, et n'a aucune raison d'allouer.
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();

  let monIndex = -1;

  /**
   * L'APPARENCE D'UN ADVERSAIRE — celle qu'IL a choisie.
   *
   * Elle était déduite de son numéro de siège : `MODELS[index % MODELS.length]`. Comme
   * chaque joueur, lui, s'affiche avec le personnage qu'il a réellement choisi, les deux
   * écrans ne racontaient pas la même chose — vu en jouant à deux, le même joueur
   * apparaissait en Trump sur une machine et en Musk sur l'autre.
   *
   * Le serveur annonce désormais le personnage de chacun dans la composition de la manche.
   * On vérifie tout de même qu'il existe dans NOTRE catalogue : la chaîne vient d'un autre
   * client, et un identifiant inconnu — version différente, catalogue modifié, client
   * bricolé — ne doit pas laisser un joueur invisible. À défaut, on retombe sur l'ancien
   * choix par siège, qui a au moins le mérite d'être stable et de varier.
   */
  const modelePour = (id, index) =>
    MODELS.find((m) => m.id === id) ?? MODELS[index % MODELS.length] ?? MODELS[0];

  function creerAvatar(index, nom, idModele) {
    const modele = modelePour(idModele, index);
    const groupe = new THREE.Group();

    /*
     * UN PIVOT AU MILIEU DU CORPS.
     *
     * `groupe` est posé aux PIEDS — c'est là qu'un personnage se place. Mais un plongeon
     * ou une culbute font tourner le corps autour de son MILIEU, comme le fait la capsule
     * physique du joueur local. Faire tourner `groupe` ferait pivoter le personnage autour
     * de ses talons : il se coucherait en balayant le sol au lieu de basculer.
     *
     * D'où ce nœud intermédiaire, remonté de `PIED` et dont le contenu redescend d'autant.
     * Le modèle reste donc exactement où il était, mais toute rotation se fait maintenant
     * autour du centre de la capsule.
     */
    const pivot = new THREE.Group();
    pivot.position.y = PIED;
    groupe.add(pivot);

    const rigge = createRiggedCharacter(assets, HAUTEUR, modele.id);

    if (rigge) {
      // On RETRANCHE, on n'affecte pas : la fabrique a déjà posé le modèle sur ses pieds
      // (`model.position.y -= measureFloor`), et écraser cette valeur l'enfoncerait dans
      // le sol ou le ferait flotter selon le modèle.
      rigge.model.position.y -= PIED;
      pivot.add(rigge.model);
    } else {
      /*
       * Repli si les modèles ne sont pas chargés — le mode `noassets`, ou un chargement
       * qui n'a pas encore abouti. Une capsule vaut mieux qu'un joueur invisible : on doit
       * pouvoir jouer et déboguer sans attendre cent cinquante mégaoctets de GLB.
       */
      const corps = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.45, 0.7, 6, 12),
        new THREE.MeshToonMaterial({ color: modele.accent ?? 0xffffff }),
      );
      corps.position.y = HAUTEUR / 2 - PIED;
      pivot.add(corps);
    }

    /*
     * L'OMBRE DE CONTACT — ce qui rend un saut LISIBLE.
     *
     * Sans elle, un adversaire qui saute monte de deux mètres… et rien ne le dit. Le
     * personnage local en a une depuis toujours : elle reste au sol, s'estompe et grandit
     * à mesure qu'on s'élève. C'est ce décollement entre le personnage et son ombre qui
     * fait lire le saut — bien plus que la pose, qui ne change presque pas.
     *
     * Mesuré : le figurant montait bien de 2,06 m, exactement l'apex du saut local. La
     * position passait ; c'est la lecture qui manquait.
     */
    const ombre = new THREE.Mesh(
      new THREE.CircleGeometry(RAYON * 1.25, 20),
      new THREE.MeshBasicMaterial({ color: 0x1a2b45, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    ombre.rotation.x = -Math.PI / 2;
    scene.add(ombre);

    scene.add(groupe);
    return {
      index, nom, groupe, pivot, ombre,
      modele: modele.id,          // ce qu'on affiche vraiment, une fois le repli appliqué
      rig: rigge?.rig ?? null,
      cap: 0,
      solY: 0,              // dernière hauteur de sol connue, pour poser l'ombre
      auSol: true,          // pour détecter l'atterrissage
    };
  }

  return {
    get retard() { return RETARD; },
    get avatars() { return [...avatars.values()]; },

    /**
     * Où se trouvent les autres joueurs, à l'instant affiché.
     *
     * Sert à faire vivre le DÉCOR : c'est en passant ces positions à `arena.update` que
     * les portes qu'un adversaire enfonce s'ouvrent aussi sur notre écran, et que les
     * dalles qu'il use cèdent aussi chez nous. Sans elles, chacun voyait un monde intact
     * traversé par des fantômes.
     */
    positions() {
      return [...avatars.values()]
        .filter((a) => a.groupe.visible)
        /*
         * Le CENTRE de la capsule, pas les pieds.
         *
         * `groupe.position` porte le personnage posé au sol — on lui a retranché `PIED`
         * pour l'afficher. Mais les cartes attendent la position que le contrôleur leur
         * donne, qui est celle du CENTRE : c'est ce que le serveur leur passe, et c'est ce
         * que le joueur local leur passe.
         *
         * Quatre-vingts centimètres d'écart en hauteur, et une porte cède chez l'un sans
         * céder chez l'autre. Mesuré : un client voyait une porte brisée quinze secondes
         * avant celui qui la poussait.
         */
        .map((a) => ({ x: a.groupe.position.x, y: a.groupe.position.y + PIED, z: a.groupe.position.z }));
    },

    /**
     * Déclare qui joue cette manche.
     *
     * `monIndex` est celui du joueur local : son personnage est simulé et rendu par le
     * contrôleur habituel, pas ici. L'afficher deux fois donnerait un fantôme collé au
     * joueur, en retard de cent millisecondes — l'artefact le plus déroutant qui soit.
     */
    definir(joueurs, nomLocal) {
      this.vider();
      for (const j of joueurs) {
        if (j.nom === nomLocal) { monIndex = j.index; continue; }
        avatars.set(j.index, creerAvatar(j.index, j.nom, j.modele));
      }
      return avatars.size;
    },

    /** Un instantané arrive. On l'horodate à la réception. */
    encaisser(instantane, maintenant = performance.now() / 1000) {
      tampon.push({ t: maintenant, joueurs: instantane.joueurs });
      while (tampon.length > 2 && maintenant - tampon[0].t > MEMOIRE) tampon.shift();
    },

    /**
     * Place les avatars à l'instant `maintenant - RETARD`.
     *
     * @param {number} dt pour animer les rigs
     */
    update(dt, maintenant = performance.now() / 1000) {
      if (tampon.length < 2) return;

      const cible = maintenant - RETARD;

      // Les deux instantanés qui encadrent l'instant voulu.
      let avant = tampon[0];
      let apres = tampon[tampon.length - 1];
      for (let i = 0; i < tampon.length - 1; i++) {
        if (tampon[i].t <= cible && tampon[i + 1].t >= cible) {
          avant = tampon[i];
          apres = tampon[i + 1];
          break;
        }
      }

      /*
       * Si `cible` est APRÈS le dernier instantané reçu, on est en retard de réseau : on
       * fige sur le dernier connu plutôt que d'extrapoler. Un personnage figé une fraction
       * de seconde se lit comme un ralentissement ; un personnage extrapolé se lit comme
       * une téléportation quand la correction arrive.
       */
      const span = apres.t - avant.t;
      const u = span > 0.0001 ? Math.max(0, Math.min(1, (cible - avant.t) / span)) : 1;

      for (const a of avatars.values()) {
        const p0 = avant.joueurs.find((j) => j.index === a.index);
        const p1 = apres.joueurs.find((j) => j.index === a.index);
        if (!p0 || !p1) continue;

        const x = p0.x + (p1.x - p0.x) * u;
        const y = p0.y + (p1.y - p0.y) * u;
        const z = p0.z + (p1.z - p0.z) * u;

        // Le personnage repose sur ses pieds : la position réseau est celle du CENTRE de
        // la capsule, comme côté serveur.
        a.groupe.position.set(x, y - 0.80, z);

        /*
         * Le CAP vient du déplacement, pas du réseau.
         *
         * On pourrait envoyer l'orientation — deux octets de plus par joueur et par
         * instantané. Mais un personnage regarde là où il va : la déduire du mouvement
         * donne le même résultat pour rien, et reste juste même quand les paquets sautent.
         * On ne tourne qu'au-dessus d'un seuil, sinon un personnage à l'arrêt pivoterait
         * au gré du bruit de quantification.
         */
        const dx = p1.x - p0.x;
        const dz = p1.z - p0.z;
        const vitesse = Math.hypot(dx, dz) / Math.max(0.0001, span);
        if (vitesse > 0.3) a.cap = Math.atan2(dx, dz);

        /*
         * PLONGEON ET CULBUTE : la rotation vient du RÉSEAU, pas du déplacement.
         *
         * C'est la même bascule que celle du joueur local, qui bascule en `ragdoll` sur ces
         * deux poses (`character.js`) — et c'est elle qui rend le geste lisible. Le cap
         * déduit du mouvement ne dit rien d'un corps qui pique vers l'avant : sans ça, un
         * adversaire qui plonge glissait tout droit, bien debout. Rapporté en jouant :
         * « on voit les sauts, on ne voit pas les plongeons. »
         *
         * On interpole en SLERP, jamais composante par composante : un quaternion moyenné
         * bêtement se dénormalise, et le personnage s'écrase en traversant l'interpolation.
         */
        if (p1.pose === 'diving' || p1.pose === 'tumbling') {
          qa.set(p0.qx ?? 0, p0.qy ?? 0, p0.qz ?? 0, p0.qw ?? 1).normalize();
          qb.set(p1.qx ?? 0, p1.qy ?? 0, p1.qz ?? 0, p1.qw ?? 1).normalize();
          a.pivot.quaternion.slerpQuaternions(qa, qb, u);
        } else {
          // Debout : le cap suffit, et il ne coûte pas un octet.
          a.pivot.quaternion.identity();
          a.pivot.rotation.y = a.cap;
        }

        /*
         * LE REBOND DU RIG, qu'on jetait.
         *
         * `rig.update` REND un décalage vertical — le ballant de la course, l'écrasement à
         * l'atterrissage. Le personnage local l'applique à sa racine ; on l'ignorait ici,
         * et les figurants couraient donc raides comme des piquets.
         */
        const vy = (p1.y - p0.y) / Math.max(0.0001, span);
        const rebond = a.rig?.update(dt, vitesse, TUNING.maxSpeed, p1.pose, vy) ?? 0;
        a.groupe.position.y += rebond;

        /*
         * L'ombre reste au SOL et s'estompe avec la hauteur.
         *
         * On mémorise la hauteur du sol quand le personnage y est posé : c'est la seule
         * information dont on dispose, et elle suffit. Une ombre qui suivrait le
         * personnage en l'air ne raconterait rien.
         */
        if (p1.pose === 'grounded') a.solY = y - PIED;
        const hauteur = Math.max(0, y - PIED - a.solY);
        a.ombre.position.set(x, a.solY + 0.05, z);
        a.ombre.material.opacity = Math.max(0, 0.28 - hauteur * 0.05);
        a.ombre.scale.setScalar(1 + hauteur * 0.06);
        a.ombre.visible = p1.etat !== 'elimine';
        a.auSol = p1.pose === 'grounded';

        // Un joueur éliminé s'efface plutôt que de disparaître d'un coup : on comprend
        // qu'il vient de tomber au lieu de se demander où il est passé.
        a.groupe.visible = p1.etat !== 'elimine';
      }
    },

    /** Enlève tout — fin de manche, changement de carte. */
    /**
     * POSE CHAQUE AVATAR SUR SA PLACE DE DÉPART, avant le premier instantané.
     *
     * Un avatar naît à l'origine du monde et n'en bouge qu'une fois DEUX instantanés
     * reçus ET appliqués. Or `update` n'était appelé qu'après le décompte : pendant trois
     * secondes, l'adversaire se tenait en T-pose à (0, 0, 0) — sur La Course, douze mètres
     * devant le départ, au milieu du pont. Vu en jouant à deux. On lui donne donc sa place
     * tout de suite, calculée comme le serveur la calcule (`placement.js`), et l'ombre avec.
     *
     * @param {(index: number) => {x:number,y:number,z:number}} placeDe le CENTRE du corps
     */
    poser(placeDe) {
      for (const a of avatars.values()) {
        const p = placeDe(a.index);
        if (!p) continue;
        a.groupe.position.set(p.x, p.y - PIED, p.z);
        a.solY = p.y - PIED;
        a.ombre.position.set(p.x, a.solY + 0.05, p.z);
      }
    },

    vider() {
      for (const a of avatars.values()) {
        scene.remove(a.groupe);
        scene.remove(a.ombre);
        a.ombre.geometry.dispose();
        a.ombre.material.dispose();
        a.groupe.traverse((n) => {
          if (!n.isMesh || n.userData.partage) return;
          n.geometry?.dispose();
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          for (const m of mats) m?.dispose?.();
        });
      }
      avatars.clear();
      tampon.length = 0;
      monIndex = -1;
    },
  };
}
