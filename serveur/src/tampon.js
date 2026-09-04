/**
 * LE TAMPON D'ENTRÉES — une file par joueur, consommée UNE IMAGE PAR SOUS-PAS.
 *
 * ─── LE DÉFAUT QU'IL CORRIGE ────────────────────────────────────────────────
 *
 * Avant lui, le serveur ne gardait que la DERNIÈRE entrée reçue et la rejouait à chaque
 * tick, que quelque chose soit arrivé ou non, en accusant toujours le même numéro. Sa
 * position « à l'entrée N » avançait donc pendant que celle que le client avait notée à
 * l'entrée N restait figée : l'écart valait la vitesse multipliée par l'ALLER-RETOUR
 * COMPLET — 34 cm à 45 ms sur un réseau local, ce qu'on tolérait sans le comprendre ;
 * 2,1 m à 300 ms, ce qui dépasse le seuil de recalage sec. Vu par le directeur produit
 * depuis les Canaries, sur une vidéo du 4 septembre 2026 : 153 recalages en une manche,
 * le personnage téléporté d'un bout à l'autre de la carte, la caméra qui suit.
 *
 * Le tort n'était pas au client : aucune comparaison n'est honnête quand le serveur ne
 * simule pas les MÊMES entrées, dans le MÊME ordre, en MÊME nombre.
 *
 * ─── CE QU'IL FAIT ──────────────────────────────────────────────────────────
 *
 * Le client numérote désormais UNE entrée PAR PAS DE PHYSIQUE (1/60 s), pas par image
 * rendue. Le serveur les range ici dans l'ordre, et chaque sous-pas de son tick en tire
 * exactement une. Après l'entrée N, les deux simulations ont joué les mêmes pas : la
 * position accusée se compare à celle que le client a notée, et l'écart ne porte plus la
 * latence — seulement les vrais désaccords (une bousculade, un obstacle qui a bougé).
 *
 * Quand la file est vide — le paquet est en route, ou coincé derrière une perte TCP — on
 * EXTRAPOLE : les derniers axes, aucun bouton. C'est la meilleure supposition possible,
 * et l'accusé ne bouge pas : le client saura qu'il n'y a rien de neuf à comparer. On
 * appelle cela une FAMINE, et on la compte.
 *
 * ─── APRÈS UNE COUPURE, ON SAUTE CE QU'ON A EXTRAPOLÉ ──────────────────────
 *
 * Chaque pas extrapolé est un pas que le personnage du serveur a joué EN PLUS de ceux
 * du client. Si, quand le retard se débloque, on rejouait toutes les images en attente,
 * le serveur aurait joué la coupure deux fois : une fois en devinant, une fois pour de
 * vrai — 2,2 m d'avance pour 300 ms à pleine vitesse, et un joueur propulsé. On tient
 * donc une DETTE : le nombre de pas extrapolés, et à la reprise on saute autant d'images
 * en attente, en reportant leurs boutons sur la première qu'on garde — un saut demandé
 * pendant la coupure n'est pas perdu. Les pas sautés correspondent aux pas extrapolés :
 * si le joueur courait tout droit, l'erreur est nulle, et elle ne dépasse jamais ce que
 * ses touches ont changé pendant la coupure. La dette reste ouverte trois ticks après la
 * reprise — une rafale arrive parfois en deux morceaux — puis ce qui n'a pas pu être
 * sauté est remis : cela vient d'un client qui envoie moins de soixante images par
 * seconde, pas du réseau, et le sauter plus tard décalerait un flux qui n'a rien demandé.
 *
 * ─── LA RÉSERVE SE CONSTITUE QUAND ELLE NE COÛTE RIEN ────────────────────────
 *
 * Quelques images d'avance en file — la CIBLE — absorbent le battement des horloges et
 * les petits retards sans famine. Mais on ne peut les accumuler qu'en laissant le serveur
 * extrapoler pendant qu'elles arrivent, et cela coûte de l'erreur si le joueur bouge. On
 * ne les accumule donc que quand il est IMMOBILE : au décompte, où tout le monde attend
 * posé sur sa place, et chaque fois qu'il s'arrête. Un joueur qui court ne paie jamais
 * d'attente ; un joueur qui s'arrête offre au serveur de quoi encaisser la prochaine
 * secousse. La cible vaut deux images sur un réseau propre — 33 ms —, monte de deux à
 * chaque coupure que sa rafale de reprise confirme, jusqu'à douze (200 ms), et redescend
 * d'une image toutes les dix secondes de calme. Une famine qui se résout image par image
 * n'est pas une coupure : c'est un client trop lent pour produire soixante images par
 * seconde, et lui donner de l'avance ne l'aiderait pas — la reconstitution à l'arrêt
 * abandonne d'ailleurs après `cible` ticks, pour la même raison.
 */

/**
 * Images d'avance sur un réseau propre : deux, soit 33 ms.
 *
 * Pas une : le client envoie soixante images par seconde et le tick en consomme deux, mais
 * les deux horloges ne sont pas en phase — un tick en voit arriver une, le suivant trois.
 * Avec une seule image d'avance, ce battement suffisait à créer des famines sur un
 * réseau local, et la cible montait toute seule à trois.
 */
export const CIBLE_MIN = 2;

/** Plafond de la cible : au-delà, on préfère des erreurs de prédiction à de la latence. */
export const CIBLE_MAX = 12;

/** Au-delà de `cible + MARGE` images de réserve, on saute les plus vieilles jusqu'à `cible`. */
export const MARGE = 6;

/** Ticks de calme (à 30 Hz) avant de rendre une image de cible. */
const CALME = 300;

/** Au-delà, un client qui inonde le serveur se fait tailler dès la réception. */
const PLAFOND_FILE = 300;

/** Ticks pendant lesquels une dette reste remboursable après la reprise. */
const GRACE = 3;

/**
 * @param {{ sousPas?: number }} [options]  images consommées par tick — `SOUS_PAS` de `tick.js`
 * @returns {{
 *   deposer(seq: number, frames: Array<{tick:number,x:number,z:number,jump:boolean,dive:boolean}>): boolean,
 *   tirer(n: number, tick?: number): Array<{seq:number|null,x:number,z:number,jump:boolean,dive:boolean,extrapole:boolean}>,
 *   accuse: number, profondeur: number, cible: number,
 *   statistiques: {famines:number, extrapoles:number, sautes:number, cible:number, profondeur:number},
 * }}
 */
export function creerTampon({ sousPas = 2 } = {}) {
  /** Les images reçues et pas encore jouées, par `seq` croissant. */
  const file = [];
  let dernierSeq = 0;          // le plus grand numéro déposé
  let applique = 0;            // le dernier numéro JOUÉ — c'est l'accusé
  let axes = { x: 0, z: 0 };   // les derniers axes joués, pour extrapoler
  let cible = CIBLE_MIN;
  /** Au début : on attend `cible + sousPas` images avant la première consommation. */
  let attente = true;
  /** Pas extrapolés depuis la dernière image jouée — à sauter à la reprise. */
  let dette = 0;
  /** Ticks de reprise déjà passés à rembourser : au-delà de `GRACE`, le reste est remis. */
  let remboursement = 0;
  /** Vrai entre la première image extrapolée d'un épisode et la première image rejouée. */
  let enFamine = false;
  /** Ticks consécutifs passés à reconstituer la réserve d'un joueur immobile. */
  let tenue = 0;
  let derniereFamine = 0;

  let famines = 0;
  let extrapoles = 0;
  let sautes = 0;

  /**
   * Au-delà de `cible + sousPas + MARGE` images en file, saute les plus vieilles pour n'en
   * garder que `cible + sousPas` — la cible, une fois le tick servi —, boutons reportés.
   * On retombe sur la cible et non sur la marge : garder la marge laisserait le retard
   * d'une coupure en latence permanente.
   *
   * Appelée au TIRAGE, pas à la réception : une rafale arrive paquet par paquet, et
   * tailler à chaque paquet coupait au seuil puis laissait la fin de la rafale rebâtir
   * une réserve de la taille de la marge — 150 ms de latence gardés pour rien. C'est le
   * garde-fou de la DÉRIVE (un client qui envoie un peu plus de soixante images par
   * seconde) ; la coupure, elle, se règle par la dette.
   */
  function tailler() {
    if (file.length <= cible + sousPas + MARGE) return;
    sauter(file.length - (cible + sousPas));
  }

  /** Saute les `k` plus vieilles images, en reportant leurs boutons sur la suivante. */
  function sauter(k) {
    let jump = false;
    let dive = false;
    for (let i = 0; i < k; i++) {
      const f = file[i];
      jump = jump || f.jump;
      dive = dive || f.dive;
    }
    file.splice(0, k);
    sautes += k;
    dette = Math.max(0, dette - k);   // une image sautée, quelle qu'en soit la raison, rembourse
    file[0].jump = file[0].jump || jump;
    file[0].dive = file[0].dive || dive;
  }

  return {
    get accuse() { return applique; },
    get profondeur() { return file.length; },
    get cible() { return cible; },
    get statistiques() {
      return { famines, extrapoles, sautes, cible, profondeur: file.length, dette };
    },

    /**
     * Un paquet est arrivé : `seq` est son numéro, `frames` les dernières images (la
     * redondance du protocole), de la plus ancienne à la plus récente. On ne garde que
     * celles qu'on n'a pas encore : un paquet en retard sur un autre est ignoré en bloc.
     */
    deposer(seq, frames) {
      if (seq <= dernierSeq) return false;
      for (const f of frames) {
        if (f.tick <= dernierSeq) continue;
        file.push({ seq: f.tick, x: f.x, z: f.z, jump: Boolean(f.jump), dive: Boolean(f.dive) });
      }
      dernierSeq = seq;
      if (file.length > PLAFOND_FILE) tailler();
      return true;
    },

    /**
     * `n` images pour le tick qui commence — une par sous-pas. Celles qui manquent sont
     * extrapolées et marquées `extrapole`, sans faire avancer l'accusé. Une image
     * extrapolée pendant que le joueur BOUGE est une famine, et elle est due.
     *
     * @param {number} n     sous-pas du tick
     * @param {number} tick  compteur de ticks de l'instance, pour la décrue de la cible
     */
    tirer(n, tick = 0) {
      const sortie = [];
      // Le départ : on attend de quoi servir CE tick et garder la cible derrière lui.
      if (attente && file.length >= cible + sousPas) attente = false;

      // La reprise après une coupure : on saute ce qu'on a joué en devinant. Une rafale
      // arrive parfois en deux morceaux, un tick entre les deux : la dette reste ouverte
      // quelques ticks de reprise, puis ce qui n'a pas pu être remboursé est remis.
      if (!attente && dette > 0 && file.length) {
        const sautables = Math.min(dette, Math.max(0, file.length - n));
        if (sautables > 0) {
          sauter(sautables);
          // Une RAFALE est arrivée : c'était le réseau, et on gardera plus d'avance. Une
          // famine qui se résout image par image vient d'un client trop lent pour en
          // produire soixante par seconde — plus d'avance ne l'aiderait pas, et le
          // ferait attendre pour rien.
          cible = Math.min(CIBLE_MAX, cible + 2);
          derniereFamine = tick;
        }
        if (dette > 0 && ++remboursement >= GRACE) dette = 0;
        if (dette === 0) remboursement = 0;
      }
      // La dérive, APRÈS la dette : ce qu'on taille ici ne doit rien.
      tailler();

      const immobile = axes.x === 0 && axes.z === 0;
      // Joueur immobile et réserve entamée : on la reconstitue, ça ne coûte rien — mais
      // pas indéfiniment. Un client sain la remplit en `cible / 2` ticks ; passé `cible`
      // ticks, c'est qu'il n'envoie pas assez d'images, et le faire attendre encore ne
      // remplirait rien : on joue ce qu'on a.
      const reconstitue = !attente && immobile && file.length < cible + n && tenue < cible;
      if (reconstitue) tenue++;
      for (let i = 0; i < n; i++) {
        if (!attente && file.length && !reconstitue) {
          const f = file.shift();
          applique = f.seq;
          axes = { x: f.x, z: f.z };
          enFamine = false;
          tenue = 0;
          sortie.push({ ...f, extrapole: false });
          continue;
        }
        // Rien à jouer : on rejoue les axes, jamais un bouton — un saut ne se devine pas.
        sortie.push({ seq: null, x: axes.x, z: axes.z, jump: false, dive: false, extrapole: true });
        extrapoles++;
        if (attente || reconstitue) continue;   // voulu, et gratuit : le joueur ne bouge pas
        // Famine : le personnage bouge et l'image n'est pas là. On la doit.
        if (!enFamine) { enFamine = true; famines++; }
        dette++;
      }

      // Décrue : dix secondes sans famine rendent une image de latence au joueur.
      if (cible > CIBLE_MIN && tick - derniereFamine >= CALME) {
        cible--;
        derniereFamine = tick;
      }
      return sortie;
    },
  };
}

/**
 * Le résumé d'un tick, pour ce qui regarde une entrée PAR TICK : les axes de la dernière
 * image, et les boutons de toutes. C'est la forme que les espions des tests lisent ; la
 * simulation, elle, joue `pas` image par image.
 */
export function resumer(pas) {
  const derniere = pas[pas.length - 1] ?? { x: 0, z: 0 };
  return {
    x: derniere.x,
    z: derniere.z,
    jump: pas.some((f) => f.jump),
    dive: pas.some((f) => f.dive),
    pas,
  };
}
