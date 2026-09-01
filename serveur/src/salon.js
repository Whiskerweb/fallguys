/**
 * LE SALON — qui attend qui, et quand on part.
 *
 * Trois issues possibles, et le salon en choisit une :
 *
 *   1. IL SE REMPLIT → on part tout de suite, personne n'attend pour rien.
 *   2. IL SE FIGE AU-DESSUS DU MINIMUM → passé un délai, on PROPOSE aux présents de
 *      partir à effectif réduit. Il faut leur accord à tous : un joueur qui n'a pas dit
 *      oui n'a pas accepté un pot plus petit que celui qu'on lui avait montré.
 *   3. IL SE FIGE SOUS LE MINIMUM → on ne part pas. Jamais. Une partie à deux ou trois
 *      n'est pas la promesse qu'on a faite, et le fait que les deux présents soient
 *      d'accord ne la rend pas défendable — ça la rend plus difficile à défendre.
 *
 * L'effectif réel décide ensuite du nombre de manches et de la table des gains :
 * `configPour(n)` côté argent, `manchesPour(n)` côté jeu. Un salon de huit joue trois
 * manches et se paie au barème de huit — pas à celui de seize.
 *
 * L'HORLOGE EST INJECTABLE. Sans cela, éprouver une attente de soixante secondes coûterait
 * soixante secondes par test, et personne ne lancerait la suite.
 */

import { creerBot, NIVEAUX } from './pilotes/bot.js';
import { POLITIQUES, botsAutorises, politique as trouverPolitique } from './politique.js';

/** La composition des bots, du plus fort au plus faible. */
export const MELANGE = ['fort', 'moyen', 'moyen', 'faible'];

/**
 * @param {object} p
 * @param {string|object} [p.politique] nom d'une politique, ou la politique elle-même
 * @param {number} [p.mise] mise en micro-USDC. Non nulle = aucun bot, quoi qu'il arrive.
 * @param {number} [p.graine]
 * @param {() => number} [p.horloge] source de temps, en millisecondes
 */
export function creerSalon({
  politique = POLITIQUES.PRODUCTION,
  mise = 0,
  graine = 1,
  horloge = Date.now,
} = {}) {
  const regle = typeof politique === 'string' ? trouverPolitique(politique) : politique;

  const humains = [];
  const accords = new Set();
  let ouvertDepuis = null;
  let lance = false;

  const ecoule = () => (ouvertDepuis === null ? 0 : (horloge() - ouvertDepuis) / 1000);
  const reste = (seuil) => (ouvertDepuis === null ? null : Math.max(0, seuil - ecoule()));

  const salon = {
    get politique() { return regle; },
    get mise() { return mise; },
    get cible() { return regle.cible; },
    get minimum() { return regle.minimum; },
    get dureeManche() { return regle.dureeManche ?? 180; },
    get humains() { return humains.slice(); },
    get lance() { return lance; },

    /** Les bots sont-ils convoquables ici ? Politique ET mise doivent l'autoriser. */
    botsAutorises: () => botsAutorises(regle, mise),

    /** Secondes avant que le salon soit considéré comme figé. `null` s'il est vide. */
    resteAAttendre: () => reste(regle.attente),

    /**
     * Un joueur entre.
     *
     * Le compte à rebours démarre au PREMIER, pas à chaque arrivée : sinon un flux régulier
     * de joueurs repousserait le départ indéfiniment, et le salon n'ouvrirait jamais.
     */
    rejoindre(joueur) {
      if (lance) return { accepte: false, raison: 'PARTIE_LANCEE' };
      if (humains.length >= regle.cible) return { accepte: false, raison: 'SALON_PLEIN' };
      humains.push(joueur);
      if (ouvertDepuis === null) ouvertDepuis = horloge();
      // Une arrivée change le pot : les accords donnés portaient sur une autre partie.
      accords.clear();
      return { accepte: true, place: humains.length, sur: regle.cible };
    },

    quitter(nom) {
      const i = humains.findIndex((h) => h.nom === nom);
      if (i < 0) return false;
      humains.splice(i, 1);
      accords.delete(nom);
      if (!humains.length) ouvertDepuis = null;   // salon vidé : l'attente repart de zéro
      return true;
    },

    /**
     * Y a-t-il une proposition de départ à effectif réduit ?
     *
     * `null` tant qu'il est trop tôt, que le salon est plein, ou qu'on est sous le minimum.
     * Ce dernier cas est le plus important : **on ne propose jamais l'impossible**. Un
     * joueur à qui l'on demande son accord pour une partie à trois comprend que c'est
     * permis, et il a raison de le comprendre.
     */
    proposition() {
      if (lance || ouvertDepuis === null) return null;
      if (humains.length >= regle.cible) return null;
      if (humains.length < regle.minimum) return null;
      if (ecoule() < regle.proposerApres) return null;

      return {
        joueurs: humains.length,
        cible: regle.cible,
        manques: regle.cible - humains.length,
        // Ce que le joueur doit comprendre avant de dire oui : le pot ne contiendra que
        // les mises des présents, et les manches s'ajustent à l'effectif.
        pot: mise * humains.length,
        accords: accords.size,
        attendus: humains.length,
      };
    },

    /** Un joueur accepte de partir à effectif réduit. */
    accepter(nom) {
      if (!this.proposition()) return { accepte: false, raison: 'AUCUNE_PROPOSITION' };
      if (!humains.some((h) => h.nom === nom)) return { accepte: false, raison: 'ABSENT' };
      accords.add(nom);
      return { accepte: true, accords: accords.size, attendus: humains.length };
    },

    /** Ce que l'interface doit montrer, en une lecture. */
    etat() {
      return {
        politique: regle.nom,
        humains: humains.length,
        cible: regle.cible,
        minimum: regle.minimum,
        resteAAttendre: this.resteAAttendre(),
        proposition: this.proposition(),
        sousLeMinimum: humains.length > 0 && humains.length < regle.minimum
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
      if (humains.length >= regle.cible) return true;

      // 2. Sous le minimum : jamais, quoi qu'il arrive et quoi qu'en disent les présents.
      if (humains.length < regle.minimum) return false;

      // 3. Complété par des bots : l'attente écoulée suffit, personne n'a son mot à dire
      //    sur des adversaires qui ne misent rien.
      if (this.botsAutorises() && this.resteAAttendre() === 0) return true;

      // 4. Sinon il faut l'accord de TOUS les présents. Un joueur qui n'a pas dit oui n'a
      //    pas accepté un pot plus petit que celui qu'on lui avait montré.
      if (!this.proposition()) return false;
      return accords.size >= humains.length;
    },

    /**
     * Compose la grille de départ, et dit franchement ce qui la compose.
     *
     * @returns {{inscrits: Array, humains: number, bots: number, complete: boolean}}
     */
    composer() {
      lance = true;

      const inscrits = humains.map((h) => ({ nom: h.nom, estBot: false, faire: h.faire }));
      const manquants = regle.cible - inscrits.length;

      if (manquants <= 0 || !this.botsAutorises()) {
        /*
         * On part À EFFECTIF RÉDUIT. C'est un vrai coût produit — la table des gains est
         * celle de l'effectif réel, donc un pot plus petit et des gains plus modestes —
         * mais l'alternative serait de faire décider une machine du gain d'un joueur, et
         * ce coût-là ne se paie pas en argent.
         */
        return {
          inscrits,
          humains: inscrits.length,
          bots: 0,
          complete: inscrits.length === regle.cible,
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

      return { inscrits, humains: humains.length, bots: manquants, complete: true };
    },
  };

  return salon;
}

export { NIVEAUX, POLITIQUES };
