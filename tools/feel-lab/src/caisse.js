/**
 * LE PORTEFEUILLE DU JOUEUR — ce que le grand livre dit qu'il a.
 *
 * Depuis le 2 septembre 2026, IL N'Y A PLUS DE RECHARGE. Le prototype se donnait 25 USDC
 * fictifs et un bouton TOP UP les remettait ; c'était un portefeuille sans rien derrière,
 * et le directeur produit a demandé qu'il disparaisse du jeu. Le solde est désormais celui
 * du backend — la somme des lignes du grand livre, adossée à un vrai wallet Robinhood
 * Chain par joueur — ou ZÉRO quand personne n'est connecté. Il entre par un dépôt, il sort par un
 * retrait, et il bouge par les parties. Rien d'autre.
 *
 * ─── L'ARGENT NE PASSE PLUS PAR ICI ─────────────────────────────────────────
 *
 * Ce module ENGAGEAIT la mise et RÉGLAIT la partie en appelant le backend, en déclarant
 * un rang. C'est fini : c'est le SERVEUR DE JEU qui fait engager les mises avant le départ
 * et régler la partie à la fin, avec un résultat signé. Le navigateur ne parle plus de
 * partie au backend. Il apprend son gain par le message `reglement` du serveur, et relit
 * son solde. `engager()` et `regler()` survivent pour le BANC (voir plus bas) et rendent
 * la main tout de suite en ligne.
 *
 * ─── LE BANC ────────────────────────────────────────────────────────────────
 *
 * Les harnais de `diag/` pilotent le jeu contre un serveur SANS backend (politiques
 * `DUEL_TEST`, `DEV`, `BANC`). Ce serveur le dit dans `bienvenue` : pas d'argent derrière,
 * identité facultative. Alors, et seulement alors, un portefeuille de banc de 25 USDC
 * imaginaires existe dans le navigateur — parce qu'un duel payant doit pouvoir se mesurer
 * sans chaîne. Ce n'est PAS un mode de jeu : un serveur de production ne l'active jamais,
 * et il n'existe aucun bouton pour l'activer soi-même.
 *
 * `solde` reste un accesseur SYNCHRONE sur une valeur en cache : l'interface lit un
 * nombre, comme avant, sans devenir asynchrone de bout en bout.
 */

import { MICROS, PALIERS, MODES, prevenir, lireEntier, table, tableEffectif, tirerIssue } from './economie.js';
import { CONFIGURE, appeler, session, deconnecter } from './compte.js';
import { poserServeur } from './boutique.js';

const CLE_SOLDE = 'tumble-solde-banc';

/** Dotation du BANC. Jamais celle d'un joueur. */
export const SOLDE_DEPART = 25 * MICROS;

let enLigne = false;
let soldeDistant = 0;
let profil = null;
let banc = false;
/** Ce que le serveur de jeu a dit de nous à `bienvenue`. */
let serveur = { compte: null, argent: false, identite: 'requise' };

export const caisse = {
  get enLigne() { return enLigne; },
  get profil() { return profil; },
  /** Vrai quand le serveur de jeu est un banc sans backend : portefeuille imaginaire. */
  get banc() { return banc; },
  /** Le compte que le serveur de jeu nous reconnaît (identifiant Supabase), ou `null`. */
  get compte() { return serveur.compte; },
  /** Y a-t-il de l'argent derrière ce serveur ? */
  get argent() { return serveur.argent; },

  /**
   * Le serveur de jeu vient de dire `bienvenue`.
   *
   * C'est LUI qui décide si un portefeuille de banc existe : pas d'argent derrière, et
   * identité facultative. Tout autre serveur laisse le solde à ce que le backend dit.
   */
  definirServeur({ compte = null, argent = false, identite = 'requise' } = {}) {
    serveur = { compte, argent: Boolean(argent), identite };
    banc = !argent && identite === 'facultative';
    // La boutique doit savoir s'il y a de l'argent : un skin payant ne se porte sur la
    // foi de la mémoire locale que sur un banc.
    poserServeur({ argent: Boolean(argent) });
    prevenir();
  },

  /**
   * Relit le profil et le solde depuis le backend.
   *
   * Un échec ne casse rien : le solde retombe à zéro, et l'interface le dit. Un jeu qui
   * refuse de démarrer parce que son API ne répond pas est un jeu qu'on ne peut plus
   * déboguer — mais il ne montre pas non plus un chiffre qu'il n'a pas.
   */
  async rafraichir() {
    if (!CONFIGURE) { enLigne = false; profil = null; prevenir(); return null; }
    if (!(await session())) {
      enLigne = false; profil = null;
      /*
       * PAS DE SESSION = DÉCONNECTÉ, et on le DIT à la porte. Quand un rafraîchissement
       * de jeton échoue, supabase-js rend `null` ici sans toujours prévenir ses
       * auditeurs : la porte, qui tient son état de l'auditeur, restait fermée sur un
       * lobby que le backend refusait, et l'ancien panneau montrait le formulaire sans
       * SIGN OUT — « je ne vois aucun bouton pour me déconnecter » (directeur produit,
       * 4 septembre 2026).
       *
       * PAS PAR `deconnecter()` : `signOut` émet SIGNED_OUT, `main.js` relit la caisse
       * à chaque événement de session, et la caisse sans session se déconnectait à
       * nouveau — une boucle sans fin qui plantait la page de tout visiteur SANS
       * session, dix minutes durant sur le site publié. Un événement à part, que seule
       * la porte écoute, et que rien ne renvoie ici.
       */
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('tumble-session', { detail: { ouverte: false } }));
      }
      prevenir();
      return null;
    }
    try {
      profil = await appeler('/moi');
      soldeDistant = profil.solde;
      enLigne = true;
      // Ce qu'on possède vient du backend, jamais du navigateur.
      poserServeur({ possessions: profil.possessions ?? [] });
    } catch (e) {
      enLigne = false;
      /*
       * UN JETON REFUSÉ EST UNE SESSION MORTE, pas une panne passagère. Le backend répond
       * JETON_INVALIDE quand Supabase ne reconnaît plus la session (compte supprimé,
       * rafraîchissement périmé). La garder ferait vivre un lobby « connecté » que tout
       * refuse : solde à zéro, nom par défaut, TOP UP qui dit SIGN IN. On la ferme ici,
       * localement, et la porte se rouvre d'elle-même (`surSession`).
       */
      if (e?.code === 'JETON_INVALIDE') { profil = null; await deconnecter(); }
    }
    prevenir();
    return profil;
  },

  /**
   * Engage une mise. BANC SEULEMENT : en ligne, c'est le serveur de jeu qui fait engager
   * la mise avant le départ, et il n'y a rien à faire ici — on rend `true`.
   */
  async engager(matchId, mise) {
    if (enLigne || !banc) return enLigne || !mise;
    if (portefeuille.solde < mise) return false;
    portefeuille.debiter(mise);
    return true;
  },

  /**
   * Le gain du rang atteint, pour l'AFFICHER. Le versement, lui, est fait par le backend
   * sur ordre signé du serveur de jeu ; ce module n'y touche pas. Sur le banc, le
   * portefeuille imaginaire est crédité.
   */
  async regler(matchId, rang, mise, mode = 'arena', graineRoue = 0, effectif = null) {
    const joueurs = MODES[mode]?.joueurs ?? 16;
    const complet = (effectif ?? joueurs) === joueurs;
    const bareme = complet ? table(mise, mode, tirerIssue(mode, graineRoue).id) : tableEffectif(mise, effectif);
    const gain = bareme.parRang[rang - 1] ?? 0;
    if (banc && !enLigne && gain > 0) portefeuille.crediter(gain);
    return gain;
  },

  /** Le serveur de jeu a dit `reglement` : le solde a bougé au backend, on le relit. */
  async surReglement() {
    if (!enLigne) return null;
    return this.rafraichir();
  },

  /** Va voir si des USDC sont arrivés sur le wallet du joueur. */
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

  /**
   * Achète un skin. Le navigateur dit l'ARTICLE ; le prix est celui du backend, qui
   * débite le wallet de jeu vers les frais (donc vers le brûlage) et dit ce qu'on possède.
   */
  async acheter(article) {
    const r = await appeler('/boutique/acheter', { article });
    soldeDistant = r.solde;
    poserServeur({ possessions: r.possessions ?? [] });
    prevenir();
    return r;
  },

  /** Le robinet d'USDC d'essai (testnet seulement) : le backend frappe, puis crédite. */
  async robinet() {
    const r = await appeler('/robinet', {});
    soldeDistant = r.solde;
    prevenir();
    return r;
  },

  historique: () => appeler('/historique'),
  retraits: () => appeler('/retraits'),
};

export const portefeuille = {
  /**
   * Le solde, en micros. SYNCHRONE, toujours : en ligne la dernière valeur connue du
   * serveur, sur le banc le portefeuille imaginaire, sinon ZÉRO. Il n'y a pas de quatrième
   * cas, et « zéro » n'est pas une panne : c'est un joueur qui n'a rien déposé.
   */
  get solde() {
    if (enLigne) return soldeDistant;
    if (banc) return lireEntier(CLE_SOLDE, SOLDE_DEPART);
    return 0;
  },

  /*
   * `debiter`, `crediter` et `recharger` n'existent QUE sur le banc.
   *
   * En ligne, écrire le solde depuis le navigateur n'aurait aucun effet réel — le grand
   * livre est ailleurs — mais afficherait un chiffre qui n'existe pas. Un solde faux dans
   * un jeu où l'on mise est pire qu'un solde absent, donc on refuse bruyamment.
   */
  debiter(micros) {
    if (!banc || enLigne) throw new Error('debiter : seul le backend fait bouger un solde');
    const reste = Math.max(0, this.solde - micros);
    localStorage.setItem(CLE_SOLDE, String(reste));
    prevenir();
    return reste;
  },

  crediter(micros) {
    if (!banc || enLigne) throw new Error('crediter : seul le backend fait bouger un solde');
    localStorage.setItem(CLE_SOLDE, String(this.solde + micros));
    prevenir();
  },

  /** Remet la dotation du BANC. Sans effet partout ailleurs — il n'y a plus de recharge. */
  recharger() {
    if (!banc || enLigne) return;
    localStorage.setItem(CLE_SOLDE, String(SOLDE_DEPART));
    prevenir();
  },

  /** La plus petite mise ouverte : en dessous, plus aucune table n'est jouable. */
  get bloque() { return this.solde < PALIERS[0] * MICROS; },
};
