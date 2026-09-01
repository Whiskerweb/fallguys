/**
 * LE SALON — qui attend qui, et quand on part.
 *
 * La règle demandée : on attend quinze secondes ; si personne d'autre n'arrive, on
 * complète avec des bots et on lance. C'est le contournement du « démarrage à froid »,
 * risque n°1 de la spec — il faut seize joueurs vivants, prêts à miser le même montant,
 * au même instant, et au premier jour il n'y en a aucun.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  LA BARRIÈRE, ET ELLE EST EN DUR
 *
 *  Un salon dont la mise est NON NULLE ne convoque jamais de bot. Jamais.
 *
 *  Toute la qualification « compétition de skill » de la spec (section 5) repose
 *  sur un fait : aucune machine ne décide de l'issue. Payer un joueur en fonction
 *  de son classement face à des adversaires pilotés par le serveur, ce n'est plus
 *  une compétition — et c'est le point précis sur lequel un régulateur se penche.
 *
 *  La règle est donc écrite ici, en code, et un verdict du harnais la vérifie.
 *  Elle ne dépend pas de quelqu'un qui se souviendrait de la respecter.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * L'HORLOGE EST INJECTABLE. Sans cela, éprouver l'attente de quinze secondes coûterait
 * quinze secondes par test, et personne ne lancerait la suite. Les tests avancent une
 * horloge factice ; en production on branche `Date.now`.
 */

import { creerBot, NIVEAUX } from './pilotes/bot.js';

/** La composition des bots, du plus fort au plus faible. */
export const MELANGE = ['fort', 'moyen', 'moyen', 'faible'];

/** Combien de secondes on attend avant de compléter. */
export const ATTENTE = 15;

/**
 * @param {object} p
 * @param {number} [p.taille]   effectif visé
 * @param {number} [p.attente]  secondes avant de compléter
 * @param {number} [p.mise]     mise en micro-USDC. NON NULLE = aucun bot, jamais.
 * @param {number} [p.graine]
 * @param {() => number} [p.horloge] source de temps, en millisecondes
 */
export function creerSalon({
  taille = 16,
  attente = ATTENTE,
  mise = 0,
  graine = 1,
  horloge = Date.now,
} = {}) {
  const humains = [];
  let ouvertDepuis = null;
  let lance = false;

  /** Les bots sont-ils autorisés dans ce salon ? La réponse tient en un test. */
  const botsAutorises = () => mise === 0;

  return {
    get mise() { return mise; },
    get taille() { return taille; },
    get humains() { return humains.slice(); },
    get lance() { return lance; },
    botsAutorises,

    /** Combien de secondes il reste à attendre, ou `null` si le salon est vide. */
    resteAAttendre() {
      if (ouvertDepuis === null) return null;
      return Math.max(0, attente - (horloge() - ouvertDepuis) / 1000);
    },

    /**
     * Un joueur entre. Le compte à rebours démarre au PREMIER, pas à chaque arrivée :
     * sinon un flux régulier de joueurs repousserait le départ indéfiniment, et le salon
     * n'ouvrirait jamais.
     */
    rejoindre(joueur) {
      if (lance) return { accepte: false, raison: 'PARTIE_LANCEE' };
      if (humains.length >= taille) return { accepte: false, raison: 'SALON_PLEIN' };
      humains.push(joueur);
      if (ouvertDepuis === null) ouvertDepuis = horloge();
      return { accepte: true, place: humains.length, sur: taille };
    },

    quitter(nom) {
      const i = humains.findIndex((h) => h.nom === nom);
      if (i >= 0) humains.splice(i, 1);
      if (!humains.length) ouvertDepuis = null;   // salon vidé : l'attente repart de zéro
      return i >= 0;
    },

    /**
     * Peut-on partir ?
     *
     * Deux chemins : le salon est plein — on part tout de suite, personne n'attend pour
     * rien —, ou l'attente est écoulée et il y a de quoi jouer.
     */
    pretAPartir() {
      if (lance || !humains.length) return false;
      if (humains.length >= taille) return true;
      return this.resteAAttendre() === 0;
    },

    /**
     * Compose la grille de départ, et dit franchement ce qui la compose.
     *
     * @returns {{inscrits: Array, humains: number, bots: number, complete: boolean}}
     */
    composer() {
      lance = true;

      const inscrits = humains.map((h) => ({
        nom: h.nom,
        estBot: false,
        faire: h.faire,
      }));

      const manquants = taille - inscrits.length;

      if (manquants > 0 && !botsAutorises()) {
        /*
         * Mise non nulle et salon incomplet : on part À EFFECTIF RÉDUIT.
         *
         * C'est un vrai coût produit — la table des gains suppose seize joueurs, donc un
         * pot incomplet fait payer la différence à la maison (voir `backend/README.md`).
         * Mais l'alternative serait de faire décider une machine du gain d'un joueur, et
         * ce coût-là ne se paie pas en argent.
         */
        return {
          inscrits,
          humains: inscrits.length,
          bots: 0,
          complete: false,
          raison: 'MISE_NON_NULLE_AUCUN_BOT',
        };
      }

      for (let i = 0; i < manquants; i++) {
        // La composition tourne : fort, moyen, moyen, faible. Déterministe, comme tout le
        // reste — la même graine refait la même grille de départ.
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
        inscrits,
        humains: humains.length,
        bots: manquants > 0 ? manquants : 0,
        complete: inscrits.length === taille,
      };
    },
  };
}

export { NIVEAUX };
