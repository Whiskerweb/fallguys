/**
 * LE PORTEFEUILLE DU JOUEUR — local, ou relie a de vrais USDC.
 *
 * Deux modes derriere la meme interface :
 *
 *   - HORS LIGNE (defaut) : le portefeuille du prototype, dans le `localStorage`, dote de
 *     25 USDC fictifs. C'est ce que le jeu a toujours fait, et ca reste le mode du palier
 *     gratuit, des quarante harnais de `diag/`, et de quiconque veut jouer sans compte.
 *
 *   - EN LIGNE : le solde vient du grand livre du backend. Le navigateur ne le CALCULE
 *     jamais et ne l'ecrit jamais — il l'affiche. Toute variation est decidee par le
 *     serveur, qui est le seul a tenir les comptes.
 *
 * Le mode se choisit tout seul : si Supabase n'est pas configure ou si personne n'est
 * connecte, on est hors ligne. Il n'y a pas de bascule a actionner.
 *
 * ---
 *
 * LE VRAI PIEGE DE CE FICHIER, et il est structurel : en ligne, l'argent devient
 * ASYNCHRONE. `portefeuille.debiter()` ne pouvait pas echouer ; `engager()` peut etre
 * refuse, expirer, ou partir deux fois si le joueur double-clique. C'est pourquoi :
 *
 *   - `solde` reste un accesseur SYNCHRONE sur une valeur en cache. L'interface continue
 *     de lire un nombre, comme avant, sans devenir asynchrone de bout en bout ;
 *   - `engager()` est verrouille contre les appels concurrents ici, en plus de l'etre
 *     dans la base. Deux barrieres, parce que celle du navigateur donne un retour
 *     immediat au joueur et celle du serveur est la seule qui protege reellement.
 */

import { MICROS, PALIERS, prevenir, lireEntier, table } from './economie.js';
import { CONFIGURE, appeler, session } from './compte.js';

const CLE_SOLDE = 'tumble-solde';

/** Dotation de depart du prototype. Hors ligne uniquement : rien a jouer sans elle. */
export const SOLDE_DEPART = 25 * MICROS;

let enLigne = false;
let soldeDistant = 0;
let profil = null;
let engagementEnCours = false;

export const caisse = {
  get enLigne() { return enLigne; },
  get profil() { return profil; },

  /**
   * Relit le profil et le solde depuis le backend.
   *
   * Un echec ne casse rien : on retombe hors ligne, sur le portefeuille local. Un jeu qui
   * refuse de demarrer parce que son API ne repond pas est un jeu qu'on ne peut plus
   * deboguer — et le joueur du palier gratuit n'a rien a faire de l'API.
   */
  async rafraichir() {
    if (!CONFIGURE || !(await session())) { enLigne = false; prevenir(); return null; }
    try {
      profil = await appeler('/moi');
      soldeDistant = profil.solde;
      enLigne = true;
    } catch {
      enLigne = false;
    }
    prevenir();
    return profil;
  },

  /**
   * Engage la mise d'une partie. Rend `true` si la partie peut commencer.
   *
   * Hors ligne, c'est l'ancien debit immediat. En ligne, c'est le backend qui debite et
   * qui rend le solde restant : le navigateur ne fait que le recopier.
   */
  async engager(matchId, mise) {
    if (engagementEnCours) return false;   // double-clic sur JOUER : le premier gagne.
    engagementEnCours = true;
    try {
      if (!enLigne) {
        if (portefeuille.solde < mise) return false;
        portefeuille.debiter(mise);
        return true;
      }
      const r = await appeler('/partie/engager', { matchId, mise });
      soldeDistant = r.solde;
      prevenir();
      return true;
    } catch (e) {
      console.warn('mise refusee :', e.code ?? e.message);
      return false;
    } finally {
      engagementEnCours = false;
    }
  },

  /**
   * Regle la partie et rend le gain du rang atteint.
   *
   * Le gain est calcule ICI pour l'afficher tout de suite, et confirme par le backend en
   * arriere-plan. Ce n'est pas un raccourci hasardeux : `backend/test/tout.mjs` compare
   * les deux tables rang par rang a chaque execution, et le jour ou elles divergeraient,
   * le test tombe avant que le joueur ne voie un chiffre faux.
   *
   * L'ecran de fin n'attend donc pas le reseau — mais l'argent, lui, ne bouge qu'au
   * serveur.
   */
  async regler(matchId, rang, mise) {
    const gain = table(mise).parRang[rang - 1] ?? 0;

    if (!enLigne) {
      if (gain > 0) portefeuille.crediter(gain);
      return gain;
    }

    try {
      const r = await appeler('/partie/regler', { matchId, rang, mise });
      soldeDistant = r.solde;
      prevenir();
    } catch (e) {
      /*
       * Un reglement qui n'aboutit pas n'est PAS perdu : la requete est idempotente et
       * clee par la partie, donc la rejouer plus tard credite exactement une fois. On ne
       * ment pas au joueur pour autant — le solde affiche restera celui d'avant jusqu'a
       * ce que le reglement passe.
       */
      console.warn('reglement differe :', e.code ?? e.message);
    }
    return gain;
  },

  /** Va voir si des USDC sont arrives sur l'adresse de depot du joueur. */
  async releverDepots() {
    if (!enLigne) return { nouveaux: [] };
    const r = await appeler('/depots/relever', {});
    soldeDistant = r.solde;
    prevenir();
    return r;
  },

  async retirer(montant) {
    const r = await appeler('/retrait', { montant });
    soldeDistant = r.solde;
    prevenir();
    return r;
  },
};

export const portefeuille = {
  /**
   * Le solde, en micros. SYNCHRONE, toujours — en ligne c'est la derniere valeur connue
   * du serveur, hors ligne c'est le `localStorage`. L'interface n'a pas a savoir lequel.
   */
  get solde() {
    return enLigne ? soldeDistant : lireEntier(CLE_SOLDE, SOLDE_DEPART);
  },

  /*
   * `debiter` et `crediter` n'existent QUE hors ligne.
   *
   * En ligne, ecrire le solde depuis le navigateur n'aurait aucun effet reel — le grand
   * livre est ailleurs — mais afficherait un chiffre qui n'existe pas. Un solde faux dans
   * un jeu ou l'on mise est pire qu'un solde absent, donc on refuse bruyamment.
   */
  debiter(micros) {
    if (enLigne) throw new Error('debiter : en ligne, seul le backend fait bouger un solde');
    const reste = Math.max(0, this.solde - micros);
    localStorage.setItem(CLE_SOLDE, String(reste));
    prevenir();
    return reste;
  },

  crediter(micros) {
    if (enLigne) throw new Error('crediter : en ligne, seul le backend fait bouger un solde');
    localStorage.setItem(CLE_SOLDE, String(this.solde + micros));
    prevenir();
  },

  /**
   * Recharge du prototype. HORS LIGNE UNIQUEMENT.
   *
   * En ligne, il n'y a pas de bouton pour se donner de l'argent : c'est tout l'objet du
   * depot. `lobbyui` remplace donc RECHARGER par DEPOSER des qu'une session existe.
   */
  recharger() {
    if (enLigne) return;
    localStorage.setItem(CLE_SOLDE, String(SOLDE_DEPART));
    prevenir();
  },

  /** La plus petite mise ouverte : en dessous, plus aucune table n'est jouable. */
  get bloque() { return this.solde < PALIERS[0] * MICROS; },
};
