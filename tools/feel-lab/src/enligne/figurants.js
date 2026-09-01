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

export function creerFigurants({ scene, assets }) {
  /** Les avatars, par index de joueur. */
  const avatars = new Map();
  /** Les instantanés reçus, du plus ancien au plus récent. */
  const tampon = [];

  let monIndex = -1;

  /** Le modèle d'un joueur : déterministe, pour qu'il ne change pas d'apparence en route. */
  const modelePour = (index) => MODELS[index % MODELS.length]?.id ?? MODELS[0].id;

  function creerAvatar(index, nom) {
    const groupe = new THREE.Group();
    const rigge = createRiggedCharacter(assets, HAUTEUR, modelePour(index));

    if (rigge) {
      groupe.add(rigge.model);
    } else {
      /*
       * Repli si les modèles ne sont pas chargés — le mode `noassets`, ou un chargement
       * qui n'a pas encore abouti. Une capsule vaut mieux qu'un joueur invisible : on doit
       * pouvoir jouer et déboguer sans attendre cent cinquante mégaoctets de GLB.
       */
      const corps = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.45, 0.7, 6, 12),
        new THREE.MeshToonMaterial({ color: MODELS[index % MODELS.length]?.accent ?? 0xffffff }),
      );
      corps.position.y = HAUTEUR / 2;
      groupe.add(corps);
    }

    scene.add(groupe);
    return { index, nom, groupe, rig: rigge?.rig ?? null, dernierY: 0, cap: 0 };
  }

  return {
    get retard() { return RETARD; },
    get avatars() { return [...avatars.values()]; },

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
        avatars.set(j.index, creerAvatar(j.index, j.nom));
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
        a.groupe.rotation.y = a.cap;

        // `pose` porte l'état du personnage : c'est ce qui distingue une course d'une chute.
        a.rig?.update(dt, vitesse, TUNING.maxSpeed, p1.pose, (p1.y - p0.y) / Math.max(0.0001, span));

        // Un joueur éliminé s'efface plutôt que de disparaître d'un coup : on comprend
        // qu'il vient de tomber au lieu de se demander où il est passé.
        a.groupe.visible = p1.etat !== 'elimine';
      }
    },

    /** Enlève tout — fin de manche, changement de carte. */
    vider() {
      for (const a of avatars.values()) {
        scene.remove(a.groupe);
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
