/**
 * LE MATCHMAKING — des files, des salons, et des parties en parallèle.
 *
 * Rien d'exceptionnel ici, et c'est voulu : c'est la topologie que tout jeu en ligne
 * utilise depuis vingt ans.
 *
 *   file par MODE × PALIER DE MISE
 *      └── plusieurs SALONS ouverts en même temps
 *             └── un salon qui part devient une INSTANCE, et un salon neuf le remplace
 *
 * Cent joueurs connectés ne font donc pas un salon de cent ni une file d'attente de
 * quatre-vingt-quatre : ils font six parties qui tournent en parallèle et un septième
 * salon en train de se remplir. Chaque instance a son propre monde Rapier et sa propre
 * horloge ; elles ne se connaissent pas.
 *
 * ─── POURQUOI DES SALONS SÉPARÉS PAR MODE ET PAR PALIER ─────────────────────
 *
 * On ne mélange pas les mises. Un joueur qui engage 5 USDG ne peut pas se retrouver dans
 * le pot d'un joueur qui en a engagé 2 : le pot serait indéterminé et la table des gains
 * ne voudrait plus rien dire. Le mode sépare pour la même raison, en plus fort : un duel et
 * une arène n'ont ni le même effectif, ni le même nombre de manches, ni le même barème.
 *
 * TROIS MODES × TROIS PALIERS FONT NEUF FILES, et c'est le vrai coût de ce catalogue :
 * chacune se remplit trois fois plus lentement qu'une file unique. C'est assumé, et c'est
 * même l'argument des petits modes — un duel part à deux et un squad à quatre, donc ils
 * partent quand l'arène ne part pas. L'arène, elle, devient plus dure à lancer, et il
 * faudra sans doute n'en ouvrir qu'un seul palier au lancement.
 *
 * ─── COMBIEN D'INSTANCES DANS UN PROCESSUS ──────────────────────────────────
 *
 * Mesuré en phase 1 : une partie de seize joueurs coûte 0,147 ms par tick, soit 0,4 % d'un
 * cœur à 30 Hz. Deux cents parties simultanées tiennent donc sur un cœur, côté physique.
 * Ce n'est pas la physique qui limitera mais la sérialisation et les sockets — et le jour
 * où ça limitera, on lancera plusieurs processus derrière la même file. Ce n'est pas le
 * problème d'aujourd'hui, mais ça n'en sera un que d'un coup.
 *
 * ─── DEPUIS QU'IL N'Y A PLUS DE PARTIE HORS LIGNE ───────────────────────────
 *
 * Le matchmaking n'est plus une pièce qu'on ouvre depuis un panneau : c'est le lobby
 * lui-même. Deux choses de plus lui incombent, et elles sont la réponse au démarrage à
 * froid (risque n°1 du spec) vu du côté du joueur qui attend :
 *
 *   1. LA PRÉSENCE. À chaque battement, l'état des neuf files part à TOUS les connectés —
 *      même ceux qui n'ont rien choisi. Le ticket montre « 3 waiting » sur l'arène avant
 *      qu'on y entre : un lobby qui ne dit pas où sont les gens est un lobby qu'on croit
 *      vide. Voir `presence()`.
 *
 *   2. LES SUGGESTIONS DE BASCULE. Un joueur seul dans une arène à seize pendant que
 *      quelqu'un attend en duel n'a aucun moyen de le savoir, et les deux repartent. Passé
 *      `suggererApres`, le serveur lui propose l'autre file — seulement si sa partie y
 *      DÉMARRERAIT (ou y deviendrait proposable), jamais pour une mise plus haute, et sans
 *      jamais faire se croiser deux joueurs qui se seraient suggérés l'un l'autre. Voir
 *      `suggestions()`, qui est la seule fonction de ce fichier qui mérite d'être lue deux
 *      fois.
 */

import { randomUUID } from 'node:crypto';
import { creerSalon } from './salon.js';
import { creerInstance } from './instance.js';
import { POLITIQUES, formatDe, misePayable, refusDEntree, politique as trouverPolitique } from './politique.js';
import { MODES, ORDRE_MODES, PALIERS, MICROS } from './economie.js';

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
 * @param {(message: object) => void} [p.diffuser] à TOUS les connectés, en file ou non —
 *   c'est par là que part la présence. Absent, personne ne voit les files se remplir,
 *   ce qui est acceptable pour un banc et pour rien d'autre.
 * @param {number} [p.graine] graine de la SESSION — chaque partie en dérive la sienne
 * @param {() => number} [p.horloge]
 * @param {object|null} [p.pont] le pont vers l'argent (`argent.js`). Avec lui, un salon
 *   payant fait ENGAGER les mises avant de partir et REGLER la partie à la fin ; sans lui,
 *   les files payantes sont fermées, sauf pour un banc (`politique.identite`).
 */
export function creerMatchmaking({
  politique = POLITIQUES.PRODUCTION,
  envoyer,
  diffuser = null,
  graine = 1,
  horloge = Date.now,
  pont = null,
} = {}) {
  const regle = typeof politique === 'string' ? trouverPolitique(politique) : politique;

  /** Les salons qui se remplissent, par mode ET palier de mise. */
  const salonsOuverts = new Map();     // "mode:mise" -> [salon]
  /** Les parties en cours. */
  const instances = new Map();         // id -> instance
  /** Les parties dont les MISES SONT PARTIES et qui ne sont pas encore réglées : id -> { mise, mode }. */
  const engagees = new Map();
  /** Où se trouve chaque joueur : dans quel salon (et sous quelle identité), ou dans quelle partie. */
  const ou = new Map();                // nom -> { salon, joueur } | { instance }
  /** La dernière suggestion envoyée à chacun, pour ne renvoyer que ce qui change. */
  const dernieresSuggestions = new Map();   // nom -> clé

  const alea = mulberry32(graine >>> 0);

  /** La clé d'une file. Le mode d'abord : c'est lui qui change la forme de la partie. */
  const cleDe = (mode, mise) => `${mode}:${mise}`;

  function fileDe(mode, mise) {
    const cle = cleDe(mode, mise);
    if (!salonsOuverts.has(cle)) salonsOuverts.set(cle, []);
    return salonsOuverts.get(cle);
  }

  /**
   * Le salon où placer un nouvel arrivant.
   *
   * Le PREMIER qui a de la place, pas le plus vide : on veut qu'un salon se remplisse et
   * parte, pas que dix salons stagnent à moitié pleins. C'est la différence entre une file
   * qui produit des parties et une file qui en promet.
   */
  function salonPour(mode, mise) {
    const file = fileDe(mode, mise);
    const libre = file.find((s) => !s.lance && s.humains.length < s.cible);
    if (libre) return libre;

    // La graine du salon ne sert plus qu'à la composition ; la roue, elle, tire à la fin
    // de la partie, dans `instance.js`.
    const neuf = creerSalon({
      politique, mode, mise, graine: Math.floor(alea() * 0xffffffff), horloge,
    });
    file.push(neuf);
    return neuf;
  }

  /** Prévient tous les occupants d'un salon de son état. */
  function annoncerSalon(salon) {
    const etat = salon.etat();
    for (const h of salon.humains) envoyer(h.nom, { type: 'salon', ...etat });
  }

  /** Les salons encore ouverts et non vides — la matière des suggestions. */
  const salonsVivants = () => [...salonsOuverts.values()].flat()
    .filter((s) => !s.lance && s.humains.length > 0);

  /**
   * LA PRÉSENCE — ce que chaque connecté doit savoir des files, en une lecture.
   *
   * Les neuf cases du catalogue y sont TOUJOURS, même à zéro : le ticket dessine une grille
   * et doit pouvoir écrire « 0 » dans une case plutôt que de la laisser muette, ce qu'un
   * joueur lirait comme une panne. Une file ouverte hors catalogue — un banc à mise nulle —
   * s'y ajoute derrière, pour que rien de ce qui existe ne soit caché.
   *
   * Ce qu'on annonce est le nombre de joueurs QUI ATTENDENT, pas le nombre de salons : un
   * joueur veut savoir s'il y a quelqu'un, pas comment on range les gens.
   */
  function presence() {
    const files = [];
    const vues = new Set();
    const decrire = (mode, mise, cle) => {
      let format;
      try { format = formatDe(regle, mode, mise); } catch { return; }   // la politique n'ouvre pas ce mode
      const file = (salonsOuverts.get(cle) ?? []).filter((s) => !s.lance);
      vues.add(cle);
      files.push({
        mode, mise,
        joueurs: file.reduce((n, s) => n + s.humains.length, 0),
        cible: format.cible,
        minimum: format.minimum,
        // Depuis combien de temps le plus ancien attend : c'est ce qui dit si une file est
        // vivante ou si quelqu'un y est oublié.
        attente: Math.round(Math.max(0, ...file.map((s) => s.attenteEcoulee()))),
      });
    };
    for (const mode of ORDRE_MODES) {
      for (const usdg of PALIERS) decrire(mode, usdg * MICROS, cleDe(mode, usdg * MICROS));
    }
    for (const cle of salonsOuverts.keys()) {
      if (vues.has(cle)) continue;
      const [mode, mise] = cle.split(':');
      decrire(mode, Number(mise), cle);
    }
    return {
      type: 'files',
      files,
      parties: instances.size,
      enPartie: [...instances.values()].reduce((n, i) => n + i.connectes.length, 0),
    };
  }

  const publierPresence = () => { diffuser?.(presence()); };

  /**
   * LES SUGGESTIONS DE BASCULE — à qui proposer quelle autre file.
   *
   * Un joueur en attente dans un salon SOURCE se voit proposer un salon CIBLE quand quatre
   * conditions tiennent, et il les faut toutes :
   *
   *   • il attend depuis `suggererApres` secondes et son salon n'est pas prêt à partir —
   *     on ne dérange pas quelqu'un dont la partie va commencer ;
   *   • la cible NE MISE PAS PLUS que lui. Il a montré qu'il pouvait engager sa mise,
   *     jamais davantage ; lui proposer une table plus chère serait lui vendre quelque
   *     chose, pas l'aider à jouer ;
   *   • son arrivée y DÉMARRE la partie (priorité 1 : le salon se remplit), ou au moins la
   *     rend PROPOSABLE (priorité 2 : le minimum est atteint, un départ réduit devient
   *     possible). On ne suggère jamais « il y a plus de monde là-bas » quand là-bas ne
   *     part pas non plus — ce serait déplacer l'attente, pas la finir ;
   *   • la cible est AU MOINS AUSSI PLEINE que la source. On rapproche les gens du salon le
   *     plus avancé, jamais l'inverse ; à remplissage égal et sans départ immédiat, le
   *     salon le plus ancien attire et le plus récent se déplace.
   *
   * ─── PERSONNE NE SE CROISE ──────────────────────────────────────────────────
   *
   * Sans garde, deux joueurs seuls dans deux files se seraient suggérés l'un l'autre, et
   * deux clics plus tard chacun attendrait seul dans la file de l'autre. Les candidats
   * sont donc triés (priorité, même mise d'abord, cible la plus remplie, mode le plus
   * court) puis AFFECTÉS : un salon qui attire quelqu'un ne se vide pas, un salon qui se
   * vide n'attire personne. Le résultat est une fonction pure de l'état — deux battements
   * sans changement produisent deux fois la même chose, et c'est ce qui permet de n'envoyer
   * que ce qui change.
   *
   * @returns {Map<object, {cible: object, priorite: number}>} par salon source
   */
  function suggestions() {
    const delai = regle.suggererApres;
    const parSource = new Map();
    if (delai == null) return parSource;

    const vivants = salonsVivants();
    const candidats = [];
    for (const source of vivants) {
      if (source.pretAPartir() || source.attenteEcoulee() < delai) continue;
      for (const cible of vivants) {
        if (cible === source || cible.mise > source.mise) continue;
        if (cible.humains.length >= cible.cible) continue;
        if (cible.humains.length < source.humains.length) continue;

        const apres = cible.humains.length + 1;
        let priorite;
        if (apres >= cible.cible) priorite = 1;
        else if (apres >= cible.minimum) priorite = 2;
        else continue;

        if (priorite === 2 && cible.humains.length === source.humains.length
            && cible.attenteEcoulee() < source.attenteEcoulee()) continue;

        candidats.push({ source, cible, priorite });
      }
    }

    candidats.sort((a, b) => a.priorite - b.priorite
      || Number(b.cible.mise === b.source.mise) - Number(a.cible.mise === a.source.mise)
      || b.cible.humains.length - a.cible.humains.length
      || ORDRE_MODES.indexOf(a.cible.mode) - ORDRE_MODES.indexOf(b.cible.mode));

    const attire = new Set();
    const seVide = new Set();
    for (const c of candidats) {
      if (parSource.has(c.source) || attire.has(c.source) || seVide.has(c.cible)) continue;
      parSource.set(c.source, { cible: c.cible, priorite: c.priorite });
      attire.add(c.cible);
      seVide.add(c.source);
    }
    return parSource;
  }

  /**
   * Envoie à chaque joueur en attente sa suggestion — SEULEMENT si elle a changé.
   *
   * Un battement par seconde renverrait la même proposition soixante fois par minute, et
   * l'interface la ferait clignoter autant. On mémorise ce qu'on a dit à chacun ; quand
   * la suggestion disparaît, on le dit aussi (`aucune`), sinon le joueur garderait à
   * l'écran une invitation vers un salon qui est déjà parti.
   */
  function envoyerSuggestions() {
    const parSource = suggestions();
    for (const salon of salonsVivants()) {
      const s = parSource.get(salon);
      const message = s ? {
        type: 'suggestion',
        mode: s.cible.mode,
        mise: s.cible.mise,
        joueurs: s.cible.humains.length,
        cible: s.cible.cible,
        minimum: s.cible.minimum,
        demarre: s.priorite === 1,
        // Plus de variante à annoncer : la roue tire à la fin de la partie, pas au salon.
        // Le mode et la mise disent tout ce que le joueur a besoin de savoir pour basculer.
        depuis: Math.round(salon.attenteEcoulee()),
      } : { type: 'suggestion', aucune: true };
      const cle = s ? `${s.cible.mode}:${s.cible.mise}:${s.priorite}:${s.cible.humains.length}` : '';
      for (const h of salon.humains) {
        const avant = dernieresSuggestions.get(h.nom) ?? '';
        if (avant === cle) continue;
        dernieresSuggestions.set(h.nom, cle);
        // Rien à dire à qui n'avait rien : `aucune` ne sert qu'à RETIRER une invitation.
        if (s || avant) envoyer(h.nom, message);
      }
    }
  }

  /** Un joueur qui n'attend plus n'a plus rien à se voir suggérer. */
  function oublierSuggestion(nom) {
    if (dernieresSuggestions.get(nom)) envoyer(nom, { type: 'suggestion', aucune: true });
    dernieresSuggestions.delete(nom);
  }

  function lancer(salon) {
    const grille = salon.composer();
    const { mode, mise } = salon;
    const id = randomUUID().slice(0, 8);

    // Le salon quitte la file : un salon parti ne prend plus personne, et un neuf le
    // remplacera au prochain arrivant.
    const file = fileDe(mode, mise);
    const i = file.indexOf(salon);
    if (i >= 0) file.splice(i, 1);

    /*
     * AVEC DE L'ARGENT, LES MISES PARTENT AVANT LA PARTIE — et la partie ne démarre que si
     * TOUTES sont parties. Le pont répond en une ou deux secondes (UNE transaction sur
     * Robinhood Chain pour toutes les mises du salon, tout ou rien) ; pendant ce temps le client affiche « Staking… ».
     */
    if (pont && mise > 0) return engagerPuisDemarrer(salon, grille, id);
    return demarrer(salon, grille, id);
  }

  /**
   * Fait engager les mises par le backend, puis démarre — ou renvoie tout le monde.
   *
   * Si UNE mise ne part pas, personne ne joue : ceux que ça concerne reçoivent la raison
   * (solde insuffisant, refus de la chaîne), les autres repartent en file dans un salon
   * neuf, sans avoir à recliquer. Le backend a déjà rendu les mises qui étaient parties.
   */
  async function engagerPuisDemarrer(salon, grille, id) {
    const { mode, mise } = salon;
    const humains = grille.inscrits.filter((j) => !j.estBot);
    for (const h of humains) envoyer(h.nom, { type: 'engagement', partie: id, mode, mise, joueurs: humains.length });

    let r;
    try {
      r = await pont.engager({
        partie: id, mode, mise,
        joueurs: humains.map((h) => ({ userId: h.compte, nom: h.nom })),
      });
    } catch (e) {
      console.error(`[${id}] engagement impossible : ${e.code ?? ''} ${e.message}`);
      r = { annulee: true, refuses: [], raison: e.code ?? 'BACKEND_ERREUR' };
    }

    if (r.annulee) {
      const raisons = new Map((r.refuses ?? []).map((x) => [x.userId, x.raison]));
      for (const h of humains) {
        if (ou.get(h.nom)?.salon !== salon) continue;    // parti entre-temps : rien à faire
        ou.delete(h.nom);
        const raison = raisons.get(h.compte);
        if (raison) {
          envoyer(h.nom, { type: 'refus', raison: raison === 'SOLDE_INSUFFISANT' ? raison : 'MISE_REFUSEE', detail: raison });
          continue;
        }
        // Lui n'y est pour rien : il repart en file, et le dit.
        envoyer(h.nom, { type: 'refus', raison: 'PARTIE_ANNULEE', detail: r.raison ?? 'MISE_REFUSEE' });
        entrer(h, mise, mode);
      }
      publierPresence();
      return null;
    }
    return demarrer(salon, grille, id);
  }

  function demarrer(salon, grille, id) {
    const { mode, mise } = salon;
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
        engagees.delete(id);
        // Seulement ceux qui sont ENCORE dans cette partie : un joueur qui l'a quittée en
        // route est peut-être déjà dans une nouvelle file, et l'en sortir ici le ferait
        // disparaître d'un salon qui l'attend.
        for (const j of grille.inscrits) {
          if (!j.estBot && ou.get(j.nom)?.instance === instance) ou.delete(j.nom);
        }
        surPartieFinie?.({ id, mode, roue: resultat.roue, mise, resultat, humains: grille.humains });
        /*
         * LE RÈGLEMENT. Le serveur de jeu ne connaît aucun solde : il envoie au backend un
         * résultat SIGNÉ — classement, mode, mise, effectif, graine de roue — et le
         * backend en dérive la ligne du tableau, paie sur la chaîne, et rend ce que chacun
         * a touché. C'est ce message-là que le client attend pour rafraîchir son solde.
         */
        if (pont && mise > 0) reglerSurLePont(id, mode, mise, grille, resultat);
      },
    });

    instances.set(id, instance);
    if (pont && mise > 0) engagees.set(id, { mise, mode });
    for (const j of grille.inscrits) if (!j.estBot) { ou.set(j.nom, { instance }); oublierSuggestion(j.nom); }

    instance.demarrer();
    publierPresence();
    return instance;
  }

  async function reglerSurLePont(id, mode, mise, grille, resultat) {
    const humains = grille.inscrits.filter((j) => !j.estBot);
    const compteDe = new Map(humains.map((h) => [h.nom, h.compte]));
    const classement = (resultat.classement ?? [])
      .filter((c) => compteDe.has(c.nom))
      .map((c) => ({ userId: compteDe.get(c.nom), nom: c.nom, rang: c.rang }));
    try {
      const r = await pont.regler({
        partie: id, mode, mise, effectif: humains.length,
        graineRoue: resultat.roue?.graine ?? 0, classement,
      });
      for (const h of humains) {
        envoyer(h.nom, {
          type: 'reglement', partie: id,
          gain: r.gains?.[h.compte] ?? 0, xp: r.xp?.[h.compte] ?? 0,
          issue: r.issue ?? null, signatures: r.signatures ?? [],
        });
      }
    } catch (e) {
      // L'argent est engagé et le backend rejouera le règlement à son rythme (il est
      // idempotent) ; le joueur, lui, doit savoir que son solde n'est pas encore à jour.
      console.error(`[${id}] règlement refusé : ${e.code ?? ''} ${e.message}`);
      for (const h of humains) envoyer(h.nom, { type: 'reglement', partie: id, erreur: e.code ?? 'BACKEND_ERREUR' });
    }
  }

  let surPartieFinie = null;

  /** Le cœur de `rejoindre`, partagé avec `basculer`. */
  function entrer(joueur, mise, mode) {
    if (ou.has(joueur.nom)) return { accepte: false, raison: 'DEJA_EN_FILE' };
    if (!MODES[mode]) return { accepte: false, raison: 'MODE_INCONNU' };
    /*
     * UNE MISE QU'ON NE SAURA PAS PAYER EST REFUSÉE ICI, pas découverte à la fin.
     *
     * Une politique de banc à effectif deux (`DUEL_TEST`) ouvre des « arènes » de deux, et
     * aucun barème ne paie ça. Le client s'en apercevait au règlement, par une exception
     * dans son gestionnaire de fin — d'où « renvoyé au lobby sans rien » d'un côté et
     * « encore en partie » de l'autre. Voir `misePayable` dans `politique.js`.
     */
    if (!misePayable(regle, mode, mise)) return { accepte: false, raison: 'MISE_IMPAYABLE' };
    /*
     * UNE FILE PAYANTE DEMANDE UN COMPTE. Sans pont vers l'argent, elle n'existe qu'en
     * banc. C'est la porte que « plus de recharge sans rien derrière » a fermée.
     */
    const refus = refusDEntree(regle, mise, { compte: joueur.compte ?? null, pont });
    if (refus) return { accepte: false, raison: refus };

    const salon = salonPour(mode, mise);
    const r = salon.rejoindre(joueur);
    if (!r.accepte) return r;

    ou.set(joueur.nom, { salon, joueur });
    annoncerSalon(salon);
    publierPresence();

    /*
     * A-T-IL DE QUOI ? On le demande au backend SANS attendre : l'entrée en file doit
     * rester instantanée. S'il n'a pas de quoi, il ressort du salon avec la raison —
     * mieux vaut le savoir maintenant qu'au moment où seize personnes attendent que sa
     * mise parte.
     */
    if (pont && mise > 0) {
      pont.soldes([joueur.compte]).then(({ soldes }) => {
        if ((soldes?.[joueur.compte] ?? 0) >= mise) return;
        if (ou.get(joueur.nom)?.salon !== salon) return;   // il a bougé entre-temps
        salon.quitter(joueur.nom);
        ou.delete(joueur.nom);
        dernieresSuggestions.delete(joueur.nom);
        annoncerSalon(salon);
        publierPresence();
        envoyer(joueur.nom, { type: 'refus', raison: 'SOLDE_INSUFFISANT' });
      }).catch((e) => console.warn(`solde de ${joueur.nom} : ${e.message}`));
    }
    return { ...r, salon: true };
  }

  return {
    get instances() { return [...instances.values()]; },
    get salons() { return [...salonsOuverts.values()].flat(); },

    /** Prévenu quand une partie se termine — c'est là que le règlement se branchera. */
    surFin(fn) { surPartieFinie = fn; },

    /**
     * Un joueur entre dans la file.
     *
     * Le mode vient du client et n'est donc pas digne de confiance : on le confronte au
     * catalogue avant d'ouvrir quoi que ce soit. Un mode inventé créerait une file que rien
     * ne viderait jamais, et un salon dont personne ne connaîtrait la forme.
     *
     * @param {{nom: string, faire?: Function}} joueur
     * @param {number} mise en micro-USDG
     * @param {string} [mode] `duel` | `squad` | `arena`
     */
    rejoindre(joueur, mise = 0, mode = 'arena') { return entrer(joueur, mise, mode); },

    /**
     * Un joueur accepte une suggestion : il change de file d'un seul geste.
     *
     * C'est `quitter` puis `rejoindre`, mais en UN message et sous la même identité — le
     * client n'a pas à renvoyer son personnage, et il n'existe aucun instant où il n'est
     * nulle part. Le mode et la mise sont ceux que le joueur a vus dans la suggestion ;
     * ils repassent par la même vérification que n'importe quelle entrée en file.
     */
    basculer(nom, mise = 0, mode = 'arena') {
      const place = ou.get(nom);
      if (!place?.salon) return { accepte: false, raison: 'PAS_EN_SALON' };
      if (!MODES[mode]) return { accepte: false, raison: 'MODE_INCONNU' };

      const ancien = place.salon;
      ancien.quitter(nom);
      ou.delete(nom);
      dernieresSuggestions.delete(nom);
      annoncerSalon(ancien);

      const r = entrer(place.joueur, mise, mode);
      if (!r.accepte) publierPresence();
      return r;
    },

    /** Un joueur quitte la file, ou se déconnecte en pleine partie. */
    quitter(nom) {
      const place = ou.get(nom);
      if (!place) return false;

      if (place.instance) {
        // En partie : c'est un ABANDON. Il est éliminé de la manche en cours, la partie
        // continue sans lui — et dans un duel, l'autre gagne aussitôt.
        place.instance.deconnecter(nom);
        // Mais LUI est libre : sa mise est engagée et sa partie continue sans lui, et il
        // peut se remettre en file tout de suite. Le retenir jusqu'à la fin d'une partie
        // qu'il a quittée serait une punition de plus, sans rien protéger.
        ou.delete(nom);
        return true;
      }

      place.salon.quitter(nom);
      ou.delete(nom);
      dernieresSuggestions.delete(nom);
      annoncerSalon(place.salon);
      publierPresence();
      return true;
    },

    /** L'instance où joue ce joueur, ou `null`. */
    instanceDe(nom) { return ou.get(nom)?.instance ?? null; },

    /** Le salon où attend ce joueur, ou `null`. */
    salonDe(nom) { return ou.get(nom)?.salon ?? null; },

    /** La présence, telle qu'elle part à tous les connectés. */
    presence,

    /** Les suggestions du moment, par salon source — pour les bancs, et rien d'autre. */
    suggestions,

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
      for (const file of salonsOuverts.values()) {
        for (const salon of [...file]) {
          if (salon.pretAPartir()) partis.push(lancer(salon));
          else annoncerSalon(salon);
        }
      }
      // Les suggestions APRÈS les départs : un salon qui vient de partir n'attire plus
      // personne, et ses joueurs n'ont plus rien à se voir proposer.
      envoyerSuggestions();
      publierPresence();
      return partis;
    },

    /** Ce qu'un tableau de bord doit montrer. */
    etat() {
      return {
        politique: regle.nom,
        modes: ORDRE_MODES,
        files: presence().files,
        salons: [...salonsOuverts].map(([cle, file]) => {
          const [mode, mise] = cle.split(':');
          return {
            mode,
            mise: Number(mise),
            ouverts: file.length,
            joueurs: file.reduce((n, s) => n + s.humains.length, 0),
          };
        }),
        parties: instances.size,
        joueursEnPartie: [...instances.values()].reduce((n, i) => n + i.connectes.length, 0),
      };
    },

    /**
     * Arrête tout — le serveur s'éteint.
     *
     * LES PARTIES PAYANTES EN COURS SONT ANNULÉES AVANT, et leurs mises rendues. Le
     * serveur garde les parties en mémoire : un redéploiement en pleine partie les
     * faisait disparaître sans règlement ni annulation, et les mises restaient dans le
     * pot — vécu le 7 septembre 2026, sur mainnet, deux joueurs, 4 USDG bloqués. On
     * demande donc au backend d'annuler chacune (le message est signé), en parallèle,
     * sans attendre plus de quinze secondes : Fly ne laisse que `kill_timeout` avant de
     * tuer le processus. Le backend a de son côté un filet : une partie engagée sans
     * règlement depuis 45 minutes est annulée par son tour de fond.
     */
    async arreter() {
      if (pont && engagees.size) {
        const raison = 'serveur de jeu arrete pendant la partie : mises rendues';
        await Promise.allSettled([...engagees.keys()].map((id) =>
          Promise.race([pont.annuler(id, raison), new Promise((r) => setTimeout(r, 15_000))])
            .then(() => console.log(`  partie ${id} annulee : mises rendues`))
            .catch((e) => console.error(`  partie ${id} : annulation echouee (${e.message}) — le backend la rattrapera`))));
        engagees.clear();
      }
      for (const i of instances.values()) i.arreter();
      instances.clear();
      salonsOuverts.clear();
      ou.clear();
      dernieresSuggestions.clear();
    },
  };
}
