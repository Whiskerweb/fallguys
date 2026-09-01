/**
 * LE MATCHMAKING — des files, des salons, et des parties en parallèle.
 *
 * Rien d'exceptionnel ici, et c'est voulu : c'est la topologie que tout jeu en ligne
 * utilise depuis vingt ans.
 *
 *   file par PALIER DE MISE
 *      └── plusieurs SALONS ouverts en même temps
 *             └── un salon qui part devient une INSTANCE, et un salon neuf le remplace
 *
 * Cent joueurs connectés ne font donc pas un salon de cent ni une file d'attente de
 * quatre-vingt-quatre : ils font six parties qui tournent en parallèle et un septième
 * salon en train de se remplir. Chaque instance a son propre monde Rapier et sa propre
 * horloge ; elles ne se connaissent pas.
 *
 * ─── POURQUOI DES SALONS SÉPARÉS PAR PALIER ─────────────────────────────────
 *
 * On ne mélange pas les mises. Un joueur qui engage 5 USDC ne peut pas se retrouver dans
 * le pot d'un joueur qui en a engagé 1 : le pot serait indéterminé et la table des gains
 * ne voudrait plus rien dire. Une file par palier, et c'est tout.
 *
 * ─── COMBIEN D'INSTANCES DANS UN PROCESSUS ──────────────────────────────────
 *
 * Mesuré en phase 1 : une partie de seize joueurs coûte 0,147 ms par tick, soit 0,4 % d'un
 * cœur à 30 Hz. Deux cents parties simultanées tiennent donc sur un cœur, côté physique.
 * Ce n'est pas la physique qui limitera mais la sérialisation et les sockets — et le jour
 * où ça limitera, on lancera plusieurs processus derrière la même file. Ce n'est pas le
 * problème d'aujourd'hui, mais ça n'en sera un que d'un coup.
 */

import { randomUUID } from 'node:crypto';
import { creerSalon } from './salon.js';
import { creerInstance } from './instance.js';
import { POLITIQUES } from './politique.js';

/** mulberry32 — le générateur de graines du jeu. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} p
 * @param {string|object} [p.politique]
 * @param {(nom: string, message: object|ArrayBuffer) => void} p.envoyer
 * @param {number} [p.graine] graine de la SESSION — chaque partie en dérive la sienne
 * @param {() => number} [p.horloge]
 */
export function creerMatchmaking({
  politique = POLITIQUES.PRODUCTION,
  envoyer,
  graine = 1,
  horloge = Date.now,
} = {}) {
  /** Les salons qui se remplissent, par palier de mise (en micro-USDC). */
  const salonsOuverts = new Map();     // mise -> [salon]
  /** Les parties en cours. */
  const instances = new Map();         // id -> instance
  /** Où se trouve chaque joueur : dans quel salon, ou dans quelle partie. */
  const ou = new Map();                // nom -> { salon } | { instance }

  const alea = mulberry32(graine >>> 0);

  function fileDe(mise) {
    if (!salonsOuverts.has(mise)) salonsOuverts.set(mise, []);
    return salonsOuverts.get(mise);
  }

  /**
   * Le salon où placer un nouvel arrivant.
   *
   * Le PREMIER qui a de la place, pas le plus vide : on veut qu'un salon se remplisse et
   * parte, pas que dix salons stagnent à moitié pleins. C'est la différence entre une file
   * qui produit des parties et une file qui en promet.
   */
  function salonPour(mise) {
    const file = fileDe(mise);
    const libre = file.find((s) => !s.lance && s.humains.length < s.cible);
    if (libre) return libre;

    const neuf = creerSalon({ politique, mise, graine: Math.floor(alea() * 0xffffffff), horloge });
    file.push(neuf);
    return neuf;
  }

  /** Prévient tous les occupants d'un salon de son état. */
  function annoncerSalon(salon) {
    const etat = salon.etat();
    for (const h of salon.humains) envoyer(h.nom, { type: 'salon', ...etat });
  }

  function lancer(salon, mise) {
    const grille = salon.composer();
    const id = randomUUID().slice(0, 8);
    const graineePartie = Math.floor(alea() * 0xffffffff);

    const instance = creerInstance({
      id,
      graine: graineePartie,
      inscrits: grille.inscrits,
      dureeMax: salon.dureeManche,
      envoyer,
      horloge,
      surFin: (resultat) => {
        instances.delete(id);
        for (const j of grille.inscrits) if (!j.estBot) ou.delete(j.nom);
        /*
         * ICI se branchera le règlement.
         *
         * Le serveur de jeu ne connaît aucun solde et ne déclenche aucun paiement (spec
         * § 6.3) : il produira un `MatchResult` SIGNÉ que `backend/` vérifiera avant de
         * créditer. Tant que la signature n'existe pas, on ne transmet rien — un backend
         * qui croirait un résultat non signé serait exactement le trou qu'on veut fermer.
         */
        surPartieFinie?.({ id, mise, resultat, humains: grille.humains });
      },
    });

    instances.set(id, instance);
    for (const j of grille.inscrits) if (!j.estBot) ou.set(j.nom, { instance });

    // Le salon quitte la file : un salon parti ne prend plus personne, et un neuf le
    // remplacera au prochain arrivant.
    const file = fileDe(mise);
    const i = file.indexOf(salon);
    if (i >= 0) file.splice(i, 1);

    instance.demarrer();
    return instance;
  }

  let surPartieFinie = null;

  return {
    get instances() { return [...instances.values()]; },
    get salons() { return [...salonsOuverts.values()].flat(); },

    /** Prévenu quand une partie se termine — c'est là que le règlement se branchera. */
    surFin(fn) { surPartieFinie = fn; },

    /**
     * Un joueur entre dans la file.
     *
     * @param {{nom: string, faire?: Function}} joueur
     * @param {number} mise en micro-USDC
     */
    rejoindre(joueur, mise = 0) {
      if (ou.has(joueur.nom)) return { accepte: false, raison: 'DEJA_EN_FILE' };

      const salon = salonPour(mise);
      const r = salon.rejoindre(joueur);
      if (!r.accepte) return r;

      ou.set(joueur.nom, { salon });
      annoncerSalon(salon);
      return { ...r, salon: true };
    },

    /** Un joueur quitte la file, ou se déconnecte en pleine partie. */
    quitter(nom) {
      const place = ou.get(nom);
      if (!place) return false;

      if (place.instance) {
        // En partie : on ne libère pas sa place, son personnage passe en pilotage
        // automatique. Figer quinze joueurs parce qu'un seul a fermé son onglet serait
        // punir les quatorze autres pour la décision d'une personne.
        place.instance.deconnecter(nom);
        return true;
      }

      place.salon.quitter(nom);
      ou.delete(nom);
      annoncerSalon(place.salon);
      return true;
    },

    /** Un joueur accepte de partir à effectif réduit. */
    accepter(nom) {
      const place = ou.get(nom);
      if (!place?.salon) return { accepte: false, raison: 'PAS_EN_SALON' };
      const r = place.salon.accepter(nom);
      annoncerSalon(place.salon);
      return r;
    },

    /** L'instance où joue ce joueur, ou `null`. */
    instanceDe(nom) { return ou.get(nom)?.instance ?? null; },

    /**
     * UN BATTEMENT — à appeler régulièrement (une fois par seconde suffit).
     *
     * On y fait deux choses : lancer les salons prêts, et rafraîchir l'affichage des
     * autres. C'est volontairement séparé de l'horloge des parties : le matchmaking n'a
     * pas besoin de 30 Hz, et le mélanger à la simulation ferait dépendre le départ d'un
     * salon de la charge d'une partie voisine.
     */
    battre() {
      const partis = [];
      for (const [mise, file] of salonsOuverts) {
        for (const salon of [...file]) {
          if (salon.pretAPartir()) partis.push(lancer(salon, mise));
          else annoncerSalon(salon);
        }
      }
      return partis;
    },

    /** Ce qu'un tableau de bord doit montrer. */
    etat() {
      return {
        politique: (typeof politique === 'string' ? politique : politique.nom),
        salons: [...salonsOuverts].map(([mise, file]) => ({
          mise,
          ouverts: file.length,
          joueurs: file.reduce((n, s) => n + s.humains.length, 0),
        })),
        parties: instances.size,
        joueursEnPartie: [...instances.values()].reduce((n, i) => n + i.connectes.length, 0),
      };
    },

    /** Arrête tout — le serveur s'éteint. */
    arreter() {
      for (const i of instances.values()) i.arreter();
      instances.clear();
      salonsOuverts.clear();
      ou.clear();
    },
  };
}
