/**
 * LE LIEN — la connexion du navigateur au serveur de jeu.
 *
 * Il ne connaît aucune règle : il ouvre une WebSocket, encode ce qu'on lui donne, décode
 * ce qui arrive, et prévient. Tout ce qui décide se trouve ailleurs — c'est ce qui permet
 * de le remplacer par WebTransport un jour sans toucher au reste.
 *
 * ─── L'HISTORIQUE DES ENTRÉES ───────────────────────────────────────────────
 *
 * Le lien garde les entrées envoyées et non encore accusées. C'est la matière première de
 * la réconciliation : quand le serveur dit « j'ai appliqué ton entrée n° 412 et tu étais
 * là », le client doit savoir ce qu'il a fait DEPUIS 412 pour comprendre l'écart. Sans cet
 * historique, il ne peut que subir la correction ; avec, il peut la comprendre.
 *
 * ─── LA RECONNEXION ─────────────────────────────────────────────────────────
 *
 * Une socket qui tombe ne perd pas la partie : le serveur garde la place du joueur et son
 * personnage passe en pilotage automatique. Le lien réessaie donc, avec un délai qui
 * double — 1 s, 2 s, 4 s, plafonné à 10 s. Réessayer sans attendre martèlerait un serveur
 * peut-être déjà en difficulté, ce qui est la meilleure façon de transformer une coupure
 * passagère en panne.
 */

import { encoderEntree, decoderInstantane, typeDe, TYPE, REDONDANCE } from './protocole.js';

const DELAI_MIN = 1000;
const DELAI_MAX = 10000;

/**
 * Plafond de l'historique d'entrées : deux secondes à 60 Hz.
 *
 * Exporté parce qu'il ne sert pas qu'ici : quand l'historique ATTEINT ce plafond, c'est
 * que le serveur n'accuse plus rien, et toute latence qu'on en déduirait serait fausse.
 * `session.js` s'en sert pour dire « je ne sais pas » plutôt que d'inventer un nombre.
 */
export const PLAFOND_HISTORIQUE = 120;

/**
 * @param {object} p
 * @param {string} p.url   `ws://127.0.0.1:8080`
 * @param {string} p.nom
 * @param {() => Promise<string|null>} [p.jeton] le jeton de session Supabase, demandé au
 *   moment de dire `bonjour` — jamais mémorisé ici, il expire et se renouvelle ailleurs.
 *   Sans lui, le serveur nous prend pour un invité : files gratuites seulement.
 */
export function creerLien({ url, nom, jeton = null }) {
  let ws = null;
  let seq = 0;
  let delai = DELAI_MIN;
  let ferme = false;
  let etat = 'ferme';                 // 'ferme' | 'connexion' | 'ouvert'

  /** Les entrées envoyées et pas encore accusées, de la plus ancienne à la plus récente. */
  const historique = [];
  /** Les trois dernières frames, pour la redondance. */
  const recentes = [];

  const ecouteurs = new Map();
  const emettre = (type, data) => { for (const fn of ecouteurs.get(type) ?? []) fn(data); };

  function brancher() {
    if (ferme) return;
    etat = 'connexion';
    emettre('etat', etat);

    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
      etat = 'ouvert';
      delai = DELAI_MIN;             // la connexion a tenu : on repart du délai court
      emettre('etat', etat);
      /*
       * LE JETON PART AVEC `bonjour`. C'est ce qui fait de nous un COMPTE et non un nom :
       * le serveur le vérifie auprès de Supabase avant de répondre `bienvenue`, et c'est ce
       * compte-là que le backend débitera et paiera. Un jeton illisible ou absent ne casse
       * rien — on est alors un invité, et le serveur le dit dans `bienvenue.compte`.
       */
      let j = null;
      try { j = await jeton?.(); } catch { j = null; }
      if (ws.readyState !== ws.OPEN) return;
      envoyerJson({ type: 'bonjour', nom, ...(j ? { jeton: j } : {}) });
    };

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        emettre(msg.type, msg);
        return;
      }
      const vue = new Uint8Array(e.data);
      if (typeDe(vue) !== TYPE.INSTANTANE) return;

      const instantane = decoderInstantane(vue);

      /*
       * On PURGE l'historique, mais jusqu'à l'accusé EXCLU : l'entrée accusée elle-même est gardée, parce
       * qu'elle porte la position de référence à laquelle comparer l'autorité. La jeter
       * ferait perdre le seul point de comparaison honnête.
       */
      while (historique.length > 1 && historique[0].seq < instantane.accuse) historique.shift();

      emettre('instantane', {
        ...instantane,
        enAttente: historique.slice(),
        // Où le client se croyait à l'instant que le serveur vient d'arbitrer.
        posAccusee: historique.find((h) => h.seq === instantane.accuse)?.pos ?? null,
      });
    };

    ws.onclose = () => {
      ws = null;
      etat = 'ferme';
      emettre('etat', etat);
      if (ferme) return;
      // Délai qui double, plafonné : marteler un serveur en difficulté transforme une
      // coupure passagère en panne.
      setTimeout(brancher, delai);
      delai = Math.min(DELAI_MAX, delai * 2);
    };

    ws.onerror = () => { /* `onclose` suivra et fera le nécessaire. */ };
  }

  function envoyerJson(o) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o));
  }

  return {
    get etat() { return etat; },
    get nom() { return nom; },
    /** Les entrées jouées mais pas encore accusées par le serveur. */
    get enAttente() { return historique.slice(); },

    /**
     * Oublie les entrées en attente.
     *
     * À appeler quand la partie se termine. Sans ça, l'historique de la manche écoulée
     * survit au retour au lobby : il reste plein, plus rien ne l'accuse jamais, et la
     * latence déduite se fige à sa valeur de saturation — 1983 ms, la même sur tous les
     * écrans du monde. Vu en jouant, sur deux machines, à la milliseconde près.
     */
    oublier() { historique.length = 0; },

    /** `sur('manche', fn)`, `sur('instantane', fn)`, `sur('etat', fn)`… */
    sur(type, fn) {
      if (!ecouteurs.has(type)) ecouteurs.set(type, new Set());
      ecouteurs.get(type).add(fn);
      return () => ecouteurs.get(type).delete(fn);
    },

    ouvrir() { ferme = false; brancher(); return this; },

    /**
     * Entre dans la file.
     *
     * `modele` est le personnage choisi. Il part AVEC l'inscription et non à part : c'est
     * ce qui permet au serveur de l'annoncer dans la composition de la manche, donc à
     * chaque client d'afficher les autres tels qu'ils se sont habillés.
     */
    rejoindre(mise = 0, modele = null, mode = 'arena') { envoyerJson({ type: 'rejoindre', mise, modele, mode }); },
    quitter() { envoyerJson({ type: 'quitter' }); },
    /** Accepte une suggestion : change de file d'un seul message, sous la même identité. */
    basculer(mise = 0, mode = 'arena') { envoyerJson({ type: 'basculer', mise, mode }); },

    /**
     * Envoie une entrée, et la garde en mémoire.
     *
     * @returns {number} le numéro de séquence attribué — le client s'en sert pour associer
     *   cette entrée à l'état qu'elle a produit chez lui.
     */
    envoyerEntree(entree) {
      seq++;
      const frame = {
        x: entree.x ?? 0,
        z: entree.z ?? 0,
        jump: Boolean(entree.jump),
        dive: Boolean(entree.dive),
      };

      recentes.push(frame);
      if (recentes.length > REDONDANCE) recentes.shift();

      historique.push({ seq, ...frame, pos: null });
      /*
       * Plafond de l'historique : deux secondes d'entrées à 60 Hz.
       *
       * Au-delà, c'est que le serveur n'accuse plus rien — coupure, ou surcharge. Laisser
       * l'historique grandir indéfiniment ferait gonfler la mémoire du navigateur pendant
       * qu'il essaie déjà de survivre à une mauvaise connexion.
       */
      if (historique.length > PLAFOND_HISTORIQUE) historique.shift();

      if (ws?.readyState === WebSocket.OPEN) ws.send(encoderEntree(seq, recentes));
      return seq;
    },

    /**
     * Note où le personnage s'est retrouvé APRÈS avoir joué l'entrée `seq`.
     *
     * C'est la moitié manquante de la réconciliation. Le serveur dit « j'ai appliqué ton
     * entrée 412 et tu étais là » ; sans savoir où le client se croyait À CE MOMENT-LÀ, on
     * ne peut comparer la position autoritative qu'à la position ACTUELLE — qui a
     * légitimement plusieurs dizaines de centimètres d'avance, puisque le client a
     * continué de simuler pendant que le paquet voyageait.
     *
     * Mesuré : comparer au présent donnait 112 cm d'écart médian là où la latence n'en
     * justifiait que 34. On corrigeait le client de son avance, c'est-à-dire qu'on
     * annulait la prédiction qu'on venait de faire.
     */
    noterPosition(seq, position) {
      for (let i = historique.length - 1; i >= 0; i--) {
        if (historique[i].seq === seq) { historique[i].pos = position; return true; }
        if (historique[i].seq < seq) break;
      }
      return false;
    },

    /** Où le client se croyait après avoir joué cette entrée, ou `null`. */
    positionA(seq) {
      return historique.find((h) => h.seq === seq)?.pos ?? null;
    },

    /**
     * Une correction vient d'être appliquée au personnage : on la répercute sur tout ce
     * qu'on avait noté APRÈS l'entrée accusée.
     *
     * Ces positions ont été calculées à partir d'un état qu'on vient de corriger ; la
     * trajectoire corrigée, c'est l'ancienne déplacée du même écart. Sans ce décalage,
     * chaque instantané suivant retrouvait une référence d'avant la correction, mesurait
     * le MÊME écart, et l'appliquait une fois de plus — autant de fois qu'il y a
     * d'entrées en vol. À 45 ms d'aller-retour c'était une fois de trop ; à 500 ms, dix,
     * et le personnage partait en spirale à plusieurs centaines de mètres. Mesuré au banc
     * `tools/test-harness/gigue.mjs`, avant ce décalage.
     */
    decaler(apresSeq, { dx = 0, dy = 0, dz = 0 }) {
      for (const h of historique) {
        if (h.seq <= apresSeq || !h.pos) continue;
        h.pos = { x: h.pos.x + dx, y: h.pos.y + dy, z: h.pos.z + dz };
      }
    },

    fermer() {
      ferme = true;
      try { ws?.close(); } catch { /* déjà fermée */ }
      ws = null;
      etat = 'ferme';
    },
  };
}
