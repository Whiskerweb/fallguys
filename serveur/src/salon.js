/**
 * LE SALON — qui attend qui, et quand on part.
 *
 * Trois issues possibles, et le salon en choisit une :
 *
 *   1. IL SE REMPLIT → on part tout de suite, personne n'attend pour rien.
 *   2. IL EST AU-DESSUS DU MINIMUM ET PLUS PERSONNE N'ARRIVE → passé `calme` secondes sans
 *      nouvelle arrivée, on part à effectif réduit. Une arrivée remet ce compte à zéro :
 *      on ne coupe pas une file qui se remplit encore. Personne n'a à dire oui — ce qui
 *      rend ce départ défendable, c'est que le ticket annonce le pot EN FOURCHETTE (de
 *      treize à seize mises pour l'arène) avant que quiconque ne clique.
 *   3. IL SE FIGE SOUS LE MINIMUM → on ne part pas. Jamais. Une partie à deux ou trois
 *      n'est pas la promesse qu'on a faite, et le fait que les deux présents soient
 *      d'accord ne la rend pas défendable — ça la rend plus difficile à défendre.
 *
 * L'ACCORD DE TOUS A ÉTÉ RETIRÉ le 2 septembre 2026, par décision produit. Il faisait
 * attendre treize personnes qu'une quatorzième daigne cliquer, et personne ne cliquait :
 * une arène à treize ne partait jamais. Un mode dont le minimum vaut la cible (1v1, squad)
 * n'a pas de départ réduit du tout.
 *
 * L'effectif réel décide ensuite du nombre de manches et de la table des gains :
 * `configPour(n)` côté argent, `manchesPour(n)` côté jeu. Un salon de huit joue trois
 * manches et se paie au barème de huit — pas à celui de seize.
 *
 * LE SALON N'A PLUS DE BARÈME À TIRER. Il portait la variante de roue, tirée à sa
 * création — avant la mise. Depuis le 2 septembre 2026 la roue tire à la FIN de la partie
 * (`instance.js`), et le salon n'annonce qu'un mode et une mise ; le ticket montre les dix
 * possibilités de chaque palier, pas une table certaine.
 */

import { creerBot, NIVEAUX } from './pilotes/bot.js';
import { POLITIQUES, botsAutorises, formatDe, politique as trouverPolitique } from './politique.js';
import { MODES, table } from './economie.js';

/** La composition des bots, du plus fort au plus faible. */
export const MELANGE = ['fort', 'moyen', 'moyen', 'faible'];

/**
 * @param {object} p
 * @param {string|object} [p.politique] nom d'une politique, ou la politique elle-même
 * @param {string} [p.mode] `duel` | `squad` | `arena`
 * @param {number} [p.mise] mise en micro-USDG. Non nulle = aucun bot, quoi qu'il arrive.
 * @param {number} [p.graine]
 * @param {() => number} [p.horloge] source de temps, en millisecondes
 */
export function creerSalon({
  politique = POLITIQUES.PRODUCTION,
  mode = 'arena',
  mise = 0,
  graine = 1,
  horloge = Date.now,
} = {}) {
  const regle = typeof politique === 'string' ? trouverPolitique(politique) : politique;
  // Avec une mise, le minimum de départ monte à trois : voir `formatDe`.
  const format = formatDe(regle, mode, mise);

  /*
   * LA ROUE TOURNE ICI, À LA CRÉATION DU SALON — c'est-à-dire AVANT que quiconque ait
   * engagé sa mise, et non à la fin de la partie.
   *
   * Ce n'est pas un choix d'ergonomie. Toute la qualification « compétition de skill » du
   * spec (§ 5) tient à ce qu'aucune machine ne décide de ce qu'un joueur gagne. Une roue
   * tournée après la partie déterminerait le montant du prix par le hasard : c'est le motif
   * exact qu'un régulateur cherche pour requalifier en jeu d'argent. Tournée ici, et
   * diffusée dans `etat()` pendant que le salon se remplit, ce n'est plus un tirage — c'est
   * un tournoi à barème publié, que le joueur lit avant de décider de jouer.
   *
   * Elle est tirée UNE FOIS et ne rebouge plus : un joueur qui arrive ne doit pas pouvoir
   * changer la table de ceux qui attendaient déjà. C'est aussi pourquoi elle dérive de la
   * graine du salon et non de son effectif.
   */
  /*
   * PLUS DE TIRAGE ICI. La roue tirait sa variante a la creation du salon — avant la mise,
   * c'etait la position juridique. Le directeur produit a choisi le 2 septembre 2026 que
   * la roue TIRE a la fin de la partie ; le tirage vit desormais dans `instance.js`, au
   * classement final, et le salon n'annonce plus qu'un mode et une mise. Voir l'amendement
   * du 2 septembre dans la spec.
   */

  const humains = [];
  let ouvertDepuis = null;
  /** L'instant de la DERNIÈRE arrivée : c'est lui que le calme mesure. */
  let derniereArrivee = null;
  let lance = false;

  const ecoule = () => (ouvertDepuis === null ? 0 : (horloge() - ouvertDepuis) / 1000);
  const reste = (seuil) => (ouvertDepuis === null ? null : Math.max(0, seuil - ecoule()));
  const calmeEcoule = () => (derniereArrivee === null ? 0 : (horloge() - derniereArrivee) / 1000);

  const salon = {
    get politique() { return regle; },
    get mode() { return mode; },
    get mise() { return mise; },
    get cible() { return format.cible; },
    get minimum() { return format.minimum; },
    /** Secondes de calme exigées avant un départ réduit ; `null` si ce mode part plein ou jamais. */
    get calme() { return format.calme ?? null; },
    get dureeManche() { return regle.dureeManche ?? 180; },
    get humains() { return humains.slice(); },
    get lance() { return lance; },

    /** Les bots sont-ils convoquables ici ? Politique ET mise doivent l'autoriser. */
    botsAutorises: () => botsAutorises(regle, mise),

    /** Secondes avant que le salon soit considéré comme figé. `null` s'il est vide. */
    resteAAttendre: () => reste(regle.attente),

    /**
     * Secondes écoulées depuis le PREMIER arrivant. Zéro pour un salon vide.
     *
     * C'est l'âge du salon, et il sert à deux choses en dehors d'ici : décider quand
     * SUGGÉRER une autre file à ses occupants (`matchmaking.js`), et départager deux salons
     * également remplis — le plus ancien attire, le plus récent se déplace.
     */
    attenteEcoulee: () => ecoule(),

    /**
     * Un joueur entre.
     *
     * Le compte à rebours démarre au PREMIER, pas à chaque arrivée : sinon un flux régulier
     * de joueurs repousserait le départ indéfiniment, et le salon n'ouvrirait jamais.
     */
    rejoindre(joueur) {
      if (lance) return { accepte: false, raison: 'PARTIE_LANCEE' };
      if (humains.length >= format.cible) return { accepte: false, raison: 'SALON_PLEIN' };
      humains.push(joueur);
      if (ouvertDepuis === null) ouvertDepuis = horloge();
      // Une arrivée remet le calme à zéro : on ne coupe pas une file qui se remplit.
      derniereArrivee = horloge();
      return { accepte: true, place: humains.length, sur: format.cible };
    },

    quitter(nom) {
      const i = humains.findIndex((h) => h.nom === nom);
      if (i < 0) return false;
      humains.splice(i, 1);
      if (!humains.length) { ouvertDepuis = null; derniereArrivee = null; }   // salon vidé : tout repart de zéro
      return true;
    },

    /**
     * Le DÉPART RÉDUIT en cours de décompte, ou `null`.
     *
     * Non nul quand le salon est au-dessus de son minimum, pas plein, et que ce mode
     * connaît un départ réduit (`calme`). Il dit dans combien de secondes on part si
     * personne n'arrive — et c'est ce que l'interface affiche : « Starting in 23 s with
     * 13 players unless someone joins ». Sous le minimum, `null` : **on n'annonce jamais
     * l'impossible**, un compte à rebours vers une partie à trois ferait croire qu'elle
     * est permise.
     */
    departReduit() {
      if (lance || ouvertDepuis === null || format.calme == null) return null;
      if (humains.length >= format.cible) return null;
      if (humains.length < format.minimum) return null;

      return {
        joueurs: humains.length,
        cible: format.cible,
        manques: format.cible - humains.length,
        // Ce que le joueur doit lire : le pot ne contiendra que les mises des présents,
        // et les manches s'ajustent à l'effectif.
        pot: mise * humains.length,
        dans: Math.max(0, Math.ceil(format.calme - calmeEcoule())),
        calme: format.calme,
      };
    },

    /**
     * Ce que l'interface doit montrer, en une lecture.
     *
     * `mode` et `mise` en font partie, et c'est le point : ils partent à chaque battement,
     * donc AVANT que la partie commence. Le joueur voit la table qu'on lui propose pendant
     * qu'il décide d'y rester ou non ; le client en déduit les dix possibilités de chaque
     * palier avec `economie.js`, qui est LE MÊME module que celui importé ici.
     */
    etat() {
      return {
        politique: regle.nom,
        mode,
        mise,
        // Le pot annoncé est celui de la table PLEINE. Un salon incomplet qui part fait
        // l'objet d'une proposition explicite, avec son propre pot — voir `proposition()`.
        pot: mise * format.cible,
        humains: humains.length,
        cible: format.cible,
        minimum: format.minimum,
        resteAAttendre: this.resteAAttendre(),
        // L'âge du salon, pour que l'interface montre depuis combien de temps on cherche
        // — depuis le premier arrivant, pas depuis notre propre entrée.
        attente: Math.round(ecoule()),
        departReduit: this.departReduit(),
        sousLeMinimum: humains.length > 0 && humains.length < format.minimum
          && ecoule() >= regle.attente,
        pretAPartir: this.pretAPartir(),
      };
    },

    /**
     * Peut-on partir ? Trois chemins, et un seul refus.
     */
    pretAPartir() {
      if (lance || !humains.length) return false;

      // 1. Plein : on part, sans attendre la fin du compte à rebours.
      if (humains.length >= format.cible) return true;

      // 2. Sous le minimum : jamais, quoi qu'il arrive et quoi qu'en disent les présents.
      if (humains.length < format.minimum) return false;

      // 3. Complété par des bots : l'attente écoulée suffit, personne n'a son mot à dire
      //    sur des adversaires qui ne misent rien.
      if (this.botsAutorises() && this.resteAAttendre() === 0) return true;

      // 4. Au-dessus du minimum, dans un mode qui connaît le départ réduit : on part quand
      //    plus personne n'arrive depuis `calme` secondes. Un mode sans `calme` — le 1v1,
      //    le squad — ne part que plein.
      if (format.calme == null) return false;
      return calmeEcoule() >= format.calme;
    },

    /**
     * Compose la grille de départ, et dit franchement ce qui la compose.
     *
     * @returns {{inscrits: Array, humains: number, bots: number, complete: boolean}}
     */
    composer() {
      lance = true;

      /*
       * `modele` FAIT PARTIE DE L'INSCRIT, au même titre que le nom.
       *
       * Cette projection ne recopiait que trois champs, et le personnage choisi mourait
       * ici — silencieusement, puisque tout le reste de la chaîne continuait de
       * fonctionner avec `null`. Le client retombait alors sur son ancien repli, qui
       * déduit l'apparence du NUMÉRO DE SIÈGE : chacun se voyait juste et voyait tous les
       * autres de travers. Vu en jouant à deux, le même joueur en Trump sur une machine et
       * en Musk sur l'autre.
       *
       * Les bots n'en ont pas besoin, et ce n'est pas un oubli : n'ayant aucune vue
       * d'eux-mêmes, ils sont affichés par le repli sur leur index — le même chez tout le
       * monde, donc déjà cohérent.
       */
      const inscrits = humains.map((h) => ({
        nom: h.nom, estBot: false, faire: h.faire, modele: h.modele ?? null,
        // Le COMPTE — l'identifiant verifie du joueur. C'est lui que le backend debite et
        // paie ; le nom n'est qu'une etiquette. `null` pour un invite d'une file gratuite.
        compte: h.compte ?? null,
      }));
      const manquants = format.cible - inscrits.length;

      if (manquants <= 0 || !this.botsAutorises()) {
        /*
         * On part À EFFECTIF RÉDUIT. C'est un vrai coût produit — la table des gains est
         * celle de l'effectif réel, donc un pot plus petit et des gains plus modestes,
         * annoncés en fourchette dans le ticket — mais l'alternative serait de faire
         * décider une machine du gain d'un joueur, et ce coût-là ne se paie pas en argent.
         */
        return {
          inscrits,
          mode,
          mise,
          humains: inscrits.length,
          bots: 0,
          complete: inscrits.length === format.cible,
          raison: manquants > 0 ? 'AUCUN_BOT_AUTORISE' : undefined,
        };
      }

      for (let i = 0; i < manquants; i++) {
        // La composition tourne : fort, moyen, moyen, faible. Déterministe comme le reste —
        // la même graine refait la même grille de départ.
        const niveau = MELANGE[(i + graine) % MELANGE.length];
        const index = inscrits.length;
        inscrits.push({
          nom: `${niveau}-${index}`,
          estBot: true,
          niveau,
          faire: (monde, perso, idx) => creerBot({ monde, perso, index: idx, graine, niveau }),
        });
      }

      return {
        inscrits, mode, mise,
        humains: humains.length, bots: manquants, complete: true,
      };
    },
  };

  return salon;
}

export { NIVEAUX, POLITIQUES };
