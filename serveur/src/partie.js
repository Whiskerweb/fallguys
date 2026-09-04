/**
 * UNE PARTIE — trois manches, une couronne.
 *
 * La pyramide d'élimination de la spec (section 3) : 16 → 8 → 4 → 1. Chaque manche est
 * une carte tirée par la graine, et les éliminés d'une manche gardent le rang qu'ils y ont
 * atteint. C'est ce classement final que le backend paie.
 *
 * L'effectif n'est PAS figé à seize. `MatchConfiguration` accepte déjà d'autres tailles
 * (les tests C# couvrent 12 et 24), et le démarrage à froid imposera des salons plus
 * petits avant d'en imposer de grands. Les survivants de chaque manche se déduisent donc
 * de l'effectif, ils ne sont pas écrits en dur.
 */

import { creerManche, HZ } from './manche.js';
import { epreuves, economie } from './monde.js';

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
 * Combien de joueurs survivent à chaque manche, pour un effectif donné.
 *
 * La règle vient de `economie.js` — LA MÊME que celle qui calcule les gains, et que le
 * noyau C# `MatchConfiguration.ForPlayers`. En écrire une version « serveur » ferait
 * diverger la partie JOUÉE de la partie PAYÉE : un joueur verrait trois manches annoncées
 * et en disputerait deux, ou serait remboursé pour une place que la manche n'a pas
 * ouverte. Une seule règle, trois implémentations verrouillées entre elles par les tests.
 *
 * En dessous de trois joueurs, `configPour` refuse — et il a raison : il DÉRIVE une
 * pyramide d'un effectif, par moitiés successives, et il lui faut deux manches. On retombe
 * alors sur UNE manche, ce qui est la bonne forme d'un duel : une finale, et rien d'autre.
 *
 * Ce repli n'est plus un cas limite : c'est exactement `MODES.duel.survivants`. Les trois
 * modes ouverts au public tombent d'ailleurs tous les trois sur leur propre pyramide —
 * 2 → [1], 4 → [2,1], 16 → [8,4,1] — et `verdicts.mjs` § 10 le vérifie mode par mode.
 * La partie JOUÉE et la partie PAYÉE ont donc la même forme sans qu'on ait eu à l'imposer.
 */
export function survivants(effectif) {
  if (effectif < 3) return [1];
  return economie().configPour(effectif).survivants;
}

/** Combien de manches se jouent à cet effectif. Deux joueurs → une finale, et c'est tout. */
export function manchesPour(effectif) {
  return survivants(effectif).length;
}

/**
 * Tire le parcours : une épreuve par manche, toutes différentes.
 *
 * Tiré de la graine de partie, jamais de `Math.random` — deux serveurs qui rejouent la
 * même partie doivent tirer les mêmes cartes, sans quoi un replay ne reproduit rien.
 */
export function tirerParcours(graine, manches = 3) {
  const alea = mulberry32(graine >>> 0);
  const restantes = epreuves().map((e) => e.id);
  const out = [];
  for (let i = 0; i < manches && restantes.length; i++) {
    out.push(restantes.splice(Math.floor(alea() * restantes.length), 1)[0]);
  }
  return out;
}

/**
 * Crée une partie prête à être avancée — trois manches, une couronne.
 *
 * Même raison d'être que `creerManche` : un serveur doit avancer d'un tick et rendre la
 * main. La partie enchaîne les manches, tient la comptabilité des éliminés et produit le
 * classement final ; elle ne décide de rien d'autre.
 *
 * @param {object} p
 * @param {number} p.graine
 * @param {Array}  p.inscrits   la grille de départ, telle que `salon.composer()` la rend
 * @param {number} [p.manches]  forcé, sinon déduit de l'effectif
 */
export function creerPartie({ graine, inscrits, manches = null, dureeMax = 180 }) {
  /*
   * LE NOMBRE DE MANCHES SUIT L'EFFECTIF.
   *
   * Deux joueurs disputent une finale ; trois ou quatre, une demie puis une finale ; à
   * partir de cinq, les trois manches. C'est ce qui permet d'ouvrir de petits salons
   * pendant le démarrage à froid sans jouer une pyramide qui n'a plus de marches.
   */
  const paliers = survivants(inscrits.length);
  const nb = manches ?? paliers.length;
  const parcours = tirerParcours(graine, nb);

  let enLice = inscrits.slice();
  const elimines = [];          // du dernier éliminé au premier : l'ordre inverse du rang
  const details = [];

  let index = -1;               // index de la manche en cours
  let manche = null;
  let finie = false;
  let resultat = null;

  /** Ouvre la manche suivante, ou clôt la partie s'il n'y en a plus. */
  function suivante() {
    manche?.liberer();
    manche = null;
    index++;

    if (index >= parcours.length || enLice.length <= 1) { clore(); return; }

    // Une graine par manche, dérivée de celle de la partie : deux manches de la même
    // partie ne se ressemblent pas, et la partie entière reste reproductible.
    const graineManche = (graine ^ ((index + 1) * 0x85EBCA6B)) >>> 0;
    manche = creerManche({
      epreuve: parcours[index],
      graine: graineManche,
      inscrits: enLice,
      qualifies: Math.min(paliers[index], enLice.length - 1),
      dureeMax,
    });
  }

  /** Encaisse le résultat d'une manche terminée et prépare la suivante. */
  function encaisser() {
    const r = manche.resultat;
    const passent = new Set(r.qualifies);

    // Les éliminés sont empilés du MOINS bon au meilleur : à la fin on dépile, et ceux qui
    // sont allés le plus loin ressortent devant.
    for (const c of r.classement.filter((c) => !passent.has(c.nom)).reverse()) {
      elimines.push(c.nom);
    }
    /*
     * ET ON LES REMET DANS L'ORDRE DE LA MANCHE.
     *
     * `filter` ne fait que retirer : l'ordre restait celui de la GRILLE DE DÉPART. Or
     * `clore()` construit le classement final par `[...enLice, ...elimines.reverse()]` —
     * le rang 1 revenait donc à qui s'était inscrit le premier au salon, pas à qui avait
     * gagné la dernière manche.
     *
     * Le cas se voyait dès qu'une manche rendait plusieurs qualifiés au même rang de
     * mérite ; il ne se voit plus depuis que les places sont plafonnées (`manche.js`), mais
     * un classement qui ne dépend pas de l'ordre d'inscription doit tenir par
     * construction, pas par l'absence du cas qui le révèle.
     */
    const rangDeLaManche = new Map(r.classement.map((c, i) => [c.nom, i]));
    enLice = enLice.filter((i) => passent.has(i.nom))
      .sort((a, b) => (rangDeLaManche.get(a.nom) ?? 0) - (rangDeLaManche.get(b.nom) ?? 0));
    details.push({ manche: index + 1, ...r });
    return r;
  }

  function clore() {
    if (finie) return;
    finie = true;
    manche?.liberer();
    manche = null;

    /*
     * Les survivants en tête — dans l'ordre de la dernière manche —, puis les éliminés du
     * plus récent au plus ancien. Aller loin dans la partie vaut mieux que tomber tôt,
     * ce qui est la seule chose que le joueur attend d'un classement.
     */
    const ordre = [...enLice.map((i) => i.nom), ...elimines.reverse()];
    resultat = {
      graine,
      parcours,
      paliers,
      classement: ordre.map((nom, i) => {
        const inscrit = inscrits.find((x) => x.nom === nom);
        return { nom, rang: i + 1, estBot: Boolean(inscrit?.estBot), niveau: inscrit?.niveau ?? null };
      }),
      manches: details,
    };
  }

  return {
    graine,
    parcours,
    paliers,
    get finie() { return finie; },
    get resultat() { return resultat; },
    get manche() { return manche; },
    get numeroManche() { return index + 1; },
    get enLice() { return enLice.slice(); },

    /** Ouvre la première manche. À appeler une fois. */
    demarrer() { if (index < 0) suivante(); return manche; },

    /**
     * Avance d'un tick.
     *
     * @param {Map<string, object>} [entrees] les entrées reçues du réseau
     * @returns {{finManche?: object, finPartie?: object}} ce qui vient de se produire —
     *   la boucle appelante s'en sert pour prévenir les joueurs.
     */
    avancer(entrees) {
      if (finie) return { finPartie: resultat };
      if (!manche) { suivante(); if (finie) return { finPartie: resultat }; }

      if (!manche.avancer(entrees)) return {};

      const r = encaisser();
      suivante();
      return finie ? { finManche: r, finPartie: resultat } : { finManche: r };
    },

    /**
     * Un joueur quitte la partie : éliminé de la manche en cours, donc absent des suivantes
     * — `encaisser` ne le retrouvera pas parmi les qualifiés. Rend `true` s'il jouait encore.
     */
    abandonner(nom) { return Boolean(manche?.abandonner(nom)); },

    /** Termine la partie avant l'heure — plus personne au bout du fil, serveur qui s'arrête. */
    interrompre() {
      if (manche && !manche.fini) { manche.interrompre(); encaisser(); }
      clore();
    },
  };
}

/**
 * Joue une partie entière, d'un trait.
 *
 * L'enveloppe que le harnais et les tests utilisent : elle boucle sur `avancer()` aussi
 * vite que la machine le permet. Même suite de ticks qu'un serveur sur son horloge.
 */
export function jouerPartie({ graine, inscrits, manches = null, surManche, dureeMax = 180 }) {
  const partie = creerPartie({ graine, inscrits, manches, dureeMax });
  partie.demarrer();

  // Garde-fou : `avancer()` s'arrête tout seul, cette borne n'est là que pour qu'aucune
  // boucle ne puisse être infinie.
  const plafond = (dureeMax + 10) * HZ * (partie.paliers.length + 1);
  for (let i = 0; i < plafond && !partie.finie; i++) {
    const e = partie.avancer();
    if (e.finManche) surManche?.(partie.numeroManche - 1, e.finManche, partie.enLice);
  }
  partie.interrompre();
  return partie.resultat;
}
