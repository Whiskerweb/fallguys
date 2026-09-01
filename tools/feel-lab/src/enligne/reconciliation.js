/**
 * LA RÉCONCILIATION — quand le client et le serveur ne sont pas d'accord.
 *
 * Le client simule son propre personnage sans attendre le serveur : c'est ce qui rend le
 * jeu réactif malgré cinquante millisecondes d'aller-retour. Mais l'autorité est au
 * serveur, et les deux finissent toujours par diverger. Ce fichier décide quoi faire de
 * l'écart.
 *
 * ─── CE QU'ON NE FAIT PAS, ET POURQUOI ──────────────────────────────────────
 *
 * La méthode « complète » est le ROLLBACK : sauvegarder l'état du monde à chaque tick,
 * revenir au tick accusé par le serveur, replacer le personnage, puis rejouer toutes les
 * entrées non accusées en simulant à nouveau la physique.
 *
 * On ne le fait pas, et la spec l'avait tranché (section 2) : « prédiction client contre le
 * décor, autorité serveur sur les contacts ». La raison est concrète — rejouer la physique
 * ne rejoue pas seulement MON personnage, mais tout le monde Rapier : les obstacles qui
 * tournent, les dalles qui cèdent, les quinze autres capsules. Il faudrait sauvegarder et
 * restaurer le monde entier trente fois par seconde. C'est huit à quatorze semaines de
 * travail contre quatre à huit mois, et pour un party game le gain est invisible.
 *
 * ─── CE QU'ON FAIT ──────────────────────────────────────────────────────────
 *
 * Une correction de position, dosée selon l'écart :
 *
 *   < 5 cm     on ignore. La quantification du réseau vaut déjà un centimètre, et lutter
 *              contre ce bruit ferait vibrer le personnage en permanence.
 *   5 cm – 2 m on ABSORBE l'écart en 150 ms. Le joueur ne voit pas une correction, il voit
 *              son personnage suivre une trajectoire très légèrement différente.
 *   > 2 m      on RECALE d'un coup. À cette distance il ne s'agit plus d'un désaccord mais
 *              d'un événement : une chute, une réapparition, une bousculade encaissée. Les
 *              lisser sur 150 ms donnerait un personnage qui glisse à travers le décor.
 *
 * Le prix à payer, et il faut le connaître : une bousculade par un autre joueur est
 * ARBITRÉE par le serveur et arrive donc avec un aller-retour de retard. On la sent comme
 * une poussée légèrement molle plutôt qu'un contact net. C'est le compromis assumé.
 */

/** En dessous, c'est du bruit de quantification. */
const SEUIL_BRUIT = 0.05;

/** Au-dessus, ce n'est plus un désaccord mais un événement. */
const SEUIL_RECALAGE = 2.0;

/** Sur combien de temps on absorbe un écart ordinaire. */
const ABSORPTION = 0.150;

export function creerReconciliation() {
  // L'écart restant à absorber, en mètres, dans le repère du monde.
  let ex = 0;
  let ey = 0;
  let ez = 0;

  let recalages = 0;
  let corrections = 0;
  let ecartMax = 0;

  return {
    get statistiques() {
      return {
        recalages,
        corrections,
        ecartMax: +ecartMax.toFixed(2),
        enCours: +Math.hypot(ex, ey, ez).toFixed(3),
      };
    },

    /**
     * Le serveur a parlé.
     *
     * @param {object} perso le `Character` local
     * @param {{x:number,y:number,z:number}} autorite la position autoritative
     * @returns {'ignore'|'absorbe'|'recale'}
     */
    corriger(perso, autorite, reference = null) {
      /*
       * ON COMPARE AU MÊME INSTANT, jamais au présent.
       *
       * `reference` est l'endroit où le client se croyait à l'entrée que le serveur vient
       * d'arbitrer. C'est le seul point de comparaison honnête : la position ACTUELLE a
       * légitimement plusieurs dizaines de centimètres d'avance, puisque le client a
       * continué de simuler pendant que le paquet voyageait.
       *
       * Mesuré avant correction de ce défaut : 112 cm d'écart médian là où 45 ms de
       * latence à 7,6 m/s n'en justifiaient que 34. On tirait le joueur en arrière de son
       * avance — c'est-à-dire qu'on annulait la prédiction qu'on venait de faire.
       *
       * Sans référence (premiers instantanés, reconnexion), on retombe sur le présent :
       * mieux vaut une correction grossière que pas de correction du tout.
       */
      const base = reference ?? perso.body.translation();
      const dx = autorite.x - base.x;
      const dy = autorite.y - base.y;
      const dz = autorite.z - base.z;
      const ecart = Math.hypot(dx, dy, dz);
      ecartMax = Math.max(ecartMax, ecart);

      if (ecart < SEUIL_BRUIT) { ex = 0; ey = 0; ez = 0; return 'ignore'; }

      if (ecart > SEUIL_RECALAGE) {
        /*
         * RECALAGE SEC. On repose le personnage là où le serveur le voit, et on efface
         * l'écart en attente : le continuer par-dessus un recalage le ferait dériver une
         * seconde fois.
         *
         * On remet aussi la vitesse à zéro. Sans cela, un personnage recalé après une
         * chute garde les quinze mètres par seconde de sa chute et repart aussitôt dans le
         * décor — le client rejouerait sa mort au lieu de la corriger.
         */
        /*
         * On applique l'erreur à la position ACTUELLE, on ne saute pas sur la position
         * autoritative : celle-ci date de l'aller-retour, et y sauter ferait perdre au
         * joueur tout le déplacement qu'il a prédit depuis. On corrige l'écart, pas le
         * temps qui a passé.
         */
        const ici = perso.body.translation();
        perso.body.setTranslation({ x: ici.x + dx, y: ici.y + dy, z: ici.z + dz }, true);
        perso.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ex = 0; ey = 0; ez = 0;
        recalages++;
        return 'recale';
      }

      ex = dx; ey = dy; ez = dz;
      corrections++;
      return 'absorbe';
    },

    /**
     * Absorbe une fraction de l'écart. À appeler à chaque image, après la physique.
     *
     * On déplace le CORPS, pas seulement le visuel : le personnage local doit se cogner
     * aux mêmes murs que son homologue sur le serveur, sinon la prédiction diverge de plus
     * en plus au lieu de converger.
     */
    appliquer(perso, dt) {
      if (!ex && !ey && !ez) return;

      const part = Math.min(1, dt / ABSORPTION);
      const p = perso.body.translation();
      perso.body.setTranslation(
        { x: p.x + ex * part, y: p.y + ey * part, z: p.z + ez * part },
        true,
      );

      ex -= ex * part;
      ey -= ey * part;
      ez -= ez * part;

      // En dessous du bruit, on solde : traîner un écart infinitésimal ferait tourner ce
      // calcul indéfiniment pour un déplacement que personne ne voit.
      if (Math.hypot(ex, ey, ez) < 0.005) { ex = 0; ey = 0; ez = 0; }
    },

    /** Nouvelle manche : on repart sans dette. */
    reinitialiser() {
      ex = 0; ey = 0; ez = 0;
      recalages = 0; corrections = 0; ecartMax = 0;
    },
  };
}
