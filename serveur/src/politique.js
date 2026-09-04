/**
 * LES POLITIQUES DE SALON — qui a le droit de jouer avec qui, et à partir de combien.
 *
 * Trois réglages nommés plutôt qu'une poignée de paramètres épars, pour une raison
 * précise : **enlever les bots doit être le choix d'une politique, pas une opération
 * chirurgicale**. Le jour où de vrais joueurs remplissent les salons, on cesse d'utiliser
 * `BANC` et il n'y a rien à démonter.
 *
 * Une politique répond à quatre questions :
 *
 *   `cible`          combien de joueurs on voudrait
 *   `minimum`        en dessous, on ne lance pas — jamais
 *   `attente`        secondes avant de considérer le salon comme figé
 *   `calme`          (par mode) secondes SANS NOUVELLE ARRIVÉE, au-dessus du minimum, avant
 *                    de partir à effectif réduit — voir `salon.js`
 *   `suggererApres`  secondes avant de SUGGÉRER une autre file où quelqu'un attend
 *   `bots`           qui peut les convoquer, et à quelle condition
 *   `dureeManche`    secondes au-delà desquelles une manche s'arrête d'elle-même
 *   `modes`          cible et minimum PAR MODE, quand la politique en ouvre plusieurs
 *
 * `dureeManche` n'est pas un détail de confort. Depuis que les parties tournent en TEMPS
 * RÉEL, une manche de trois minutes prend trois minutes : un harnais qui joue deux manches
 * attendrait six minutes, et personne ne lance une suite de tests qui dure six minutes.
 * Les politiques de test raccourcissent donc, sans rien changer aux règles.
 *
 * ─── POURQUOI 360 ET NON 180 ────────────────────────────────────────────────
 *
 * Parce que le chrono ne borne pas une manche : il la TRANCHE. À son expiration, tout le
 * monde est marqué éliminé puis repêché par progression décroissante — le plus avancé
 * gagne, même s'il n'a pas quitté la ligne de départ.
 *
 * À 180 s, ce n'était pas un cas limite mais l'ordinaire. Mesuré avec les bots forts :
 * course s'achève en 73 s, mais **rondin demande 316 s**, et doors comme dalles n'ont
 * jamais été terminées en 600 s (16 % et 46 %). Un joueur a vu « VICTORY » au MILIEU de
 * doors, et c'était exactement ça : trois minutes écoulées, personne arrivé, le mieux
 * placé couronné.
 *
 * 360 s laisse rondin s'achever et met doors à portée d'un humain — trois fois plus rapide
 * que nos bots sur cette carte. Ça ne supprime pas la règle du repêchage, choisie
 * délibérément : un joueur immobile pendant six minutes gagnerait encore. C'est un
 * arbitrage produit, assumé, et non un oubli.
 */

import { MODES } from './economie.js';

/**
 * `jamais` — aucun bot, quelles que soient les circonstances.
 * `si-gratuit` — des bots seulement si la mise est nulle.
 *
 * Il n'y a délibérément pas de `toujours` : une valeur qui autoriserait des bots dans une
 * partie payante n'a aucune raison d'exister, et son absence est une garantie de plus.
 */
export const BOTS = { JAMAIS: 'jamais', SI_GRATUIT: 'si-gratuit' };

export const POLITIQUES = {
  /**
   * Le public. Dix joueurs minimum.
   *
   * En dessous, une partie « à mises » n'en est pas une : le pot est maigre, le classement
   * n'a plus de sens, et un joueur qui découvre le jeu sur une partie à trois en repart
   * avec l'impression d'un jeu vide. C'est un choix produit avant d'être technique.
   */
  PRODUCTION: {
    nom: 'PRODUCTION',
    /*
     * L'IDENTITE EST REQUISE pour miser : sans jeton Supabase verifie, un joueur n'entre
     * dans aucune file payante. C'est son compte qui paie et qui touche ; un nom declare
     * ne designe personne. `facultative` n'existe que pour les bancs, qui n'ont pas de
     * backend et jouent avec un portefeuille imaginaire.
     */
    identite: 'requise',
    attente: 15,
    /*
     * Vingt secondes avant de suggérer une autre file. C'est le délai au bout duquel un
     * joueur seul dans une arène commence à croire que le jeu est vide — mesuré à rien,
     * choisi à l'oreille, et c'est un réglage produit, pas une constante technique. Plus
     * court, on déplacerait des joueurs qui allaient être rejoints ; plus long, on les
     * laisse partir. Voir `suggestions()` dans `matchmaking.js` pour ce qui est suggéré.
     */
    suggererApres: 20,
    bots: BOTS.JAMAIS,
    dureeManche: 360,
    /**
     * L'effectif dépend du MODE, et PRODUCTION n'en pose aucun à la racine — délibérément.
     *
     * Le minimum de dix a été posé pour l'arène et reste juste pour elle : une partie
     * « à mises » à trois sur seize places n'en est pas une. Mais il n'a aucun sens pour un
     * format à deux, où deux joueurs SONT l'effectif complet. Un minimum n'est pas un seuil
     * de dignité abstrait, c'est une fraction de la cible.
     *
     * S'il restait un `cible` à la racine EN PLUS de cette carte, il y aurait deux sources
     * pour un même chiffre, et `{ ...PRODUCTION, cible: 4 }` — la forme qu'emploient les
     * harnais — verrait son intention écrasée en silence par la carte. Une seule source,
     * donc : la carte ici, ou un effectif posé à la racine, jamais les deux.
     */
    /*
     * LA RÈGLE DE DÉPART, posée par le directeur produit le 2 septembre 2026 :
     *
     *   • le 1v1 part à deux, le squad à quatre — c'est-à-dire PLEINS, jamais réduits ;
     *   • l'arène part à seize tout de suite, ou à partir de TREIZE si trente-cinq
     *     secondes passent sans qu'un joueur de plus n'arrive. Une arrivée remet ce
     *     compte à zéro : on ne coupe pas une file qui se remplit encore.
     *
     * Le départ réduit n'est plus soumis à l'accord des présents. Ce qui le rend
     * défendable, c'est la DIVULGATION : le ticket annonce le pot en fourchette — de
     * treize à seize mises — avant que quiconque ne clique. Un joueur qui entre en arène
     * sait qu'elle peut partir à treize.
     */
    modes: {
      duel:  { cible: 2,  minimum: 2 },
      squad: { cible: 4,  minimum: 4 },
      arena: { cible: 16, minimum: 13, calme: 35 },
    },
  },

  /**
   * Deux machines, deux comptes, un vrai serveur.
   *
   * Le mode de mise au point. On joue le VRAI chemin de code — pas de bots, donc rien à
   * enlever ensuite, et rien qui masque un défaut de netcode derrière un adversaire
   * complaisant. Un duel n'a pas de table de gains (voir `configPour` : trois joueurs
   * minimum), donc ce mode est nécessairement gratuit.
   */
  DUEL_TEST: {
    nom: 'DUEL_TEST',
    identite: 'facultative',
    cible: 2,
    minimum: 2,
    attente: 5,
    suggererApres: 5,
    bots: BOTS.JAMAIS,
    dureeManche: 360,
  },

  /**
   * DEUX MACHINES, TROIS MODES — le réglage de mise au point du jeu EN LIGNE.
   *
   * EXPLICITEMENT (`POLITIQUE=DEV`), jamais par défaut : sous ce réglage une arène part à
   * deux, et c'est précisément ce qu'un directeur produit a pris pour un bug en jouant.
   * Le défaut de `npm start` est PRODUCTION.
   *
   * Depuis qu'il n'existe plus de partie hors ligne, tout se teste à travers le serveur,
   * et `DUEL_TEST` ne suffisait plus : avec un effectif de deux posé à la racine, ses trois
   * modes se confondaient — un squad y partait à deux, une arène aussi, et le matchmaking
   * n'avait jamais rien à SUGGÉRER puisque chaque file partait toute seule.
   *
   * Ici les CIBLES sont celles de la production et seuls les MINIMUMS descendent à deux :
   * une arène s'annonce toujours à seize, mais deux personnes la font partir après huit
   * secondes de calme (trente-cinq en production). Et un joueur seul dans cette arène se
   * voit suggérer, au bout de huit secondes, le duel où quelqu'un attend — exactement ce
   * que voit un vrai joueur en production, en huit secondes au lieu de vingt.
   */
  DEV: {
    nom: 'DEV',
    // Deux machines sans backend : le portefeuille de banc suffit. Avec `BACKEND_URL`,
    // le pont existe et le matchmaking exige quand meme un compte pour miser.
    identite: 'facultative',
    attente: 5,
    suggererApres: 8,
    bots: BOTS.JAMAIS,
    dureeManche: 360,
    modes: {
      duel:  { cible: 2,  minimum: 2 },
      squad: { cible: 4,  minimum: 2, calme: 8 },
      arena: { cible: 16, minimum: 2, calme: 8 },
    },
  },

  /**
   * Le banc d'essai — `tools/test-harness` UNIQUEMENT.
   *
   * Un seul humain suffit, les bots complètent. C'est la seule politique qui les convoque,
   * et elle n'a aucune raison d'apparaître ailleurs que dans un harnais.
   */
  BANC: {
    nom: 'BANC',
    identite: 'facultative',
    cible: 16,
    minimum: 1,
    attente: 0,
    suggererApres: 0,
    bots: BOTS.SI_GRATUIT,
    dureeManche: 360,
  },
};

/**
 * L'effectif d'un salon : la cible et le minimum, pour une politique ET un mode.
 *
 * UNE SEULE RÈGLE, ET DANS CET ORDRE : un effectif posé à la racine gagne toujours.
 *
 * Il vient d'un banc d'essai — `DUEL_TEST`, `BANC`, ou un `{ ...PRODUCTION, cible: 4 }`
 * écrit dans un harnais — et c'est une décision explicite. Laisser la carte des modes le
 * recouvrir rendrait cette copie silencieusement inopérante : le harnais demanderait des
 * salons de quatre et en obtiendrait de seize, sans un mot. C'est exactement la panne qu'on
 * ne voit pas passer.
 *
 * Une politique qui n'a ni effectif à la racine ni le mode demandé refuse au lieu
 * d'inventer : mieux vaut une erreur nommée qu'un salon dont personne ne connaît la taille.
 */
export function formatDe(regle, modeId = 'arena', mise = 0) {
  const f = regle.cible != null
    ? { cible: regle.cible, minimum: regle.minimum ?? regle.cible }
    : regle.modes?.[modeId];
  if (!f) {
    throw new Error(`la politique « ${regle.nom} » n'ouvre pas le mode « ${modeId} » `
      + `— attendu : ${Object.keys(regle.modes ?? {}).join(', ') || 'aucun'}`);
  }
  /*
   * AVEC UNE MISE, ON NE PART PAS RÉDUIT EN DESSOUS DE TROIS.
   *
   * Un salon parti incomplet se paie au barème de son effectif (`tableEffectif`), et ce
   * barème n'existe pas sous trois joueurs — les trois implémentations le refusent, C#,
   * backend et lobby. Une politique de mise au point qui laisse une arène partir à deux
   * (`DEV`) reste donc libre de le faire GRATUITEMENT ; dès qu'un pot existe, le minimum
   * monte à trois. Un duel n'est pas concerné : complet à deux, il se paie au barème du
   * mode, pas à celui d'un salon réduit. Voir `misePayable` pour le cas sans issue.
   */
  const plancher = Math.min(3, MODES[modeId]?.joueurs ?? 3);
  if (mise > 0 && f.minimum < plancher) return { ...f, minimum: plancher };
  return f;
}

/**
 * Les bots sont-ils convoquables ici ?
 *
 * Deux conditions, et il faut les DEUX. La politique peut les interdire ; et même quand
 * elle les autorise, une mise non nulle les interdit de toute façon.
 *
 * Ce second test est redondant avec `PRODUCTION.bots = 'jamais'` — délibérément. Toute la
 * qualification « compétition de skill » du spec (section 5) repose sur le fait qu'aucune
 * machine ne décide de l'issue ; payer un joueur selon son classement face à des
 * adversaires pilotés par le serveur est le point précis sur lequel un régulateur se
 * penche. Une garantie qui tient à un seul test tient à une seule faute de frappe.
 */
export function botsAutorises(politique, mise) {
  if (politique.bots === BOTS.JAMAIS) return false;
  return mise === 0;
}

/**
 * UNE MISE N'EST ACCEPTÉE QUE LÀ OÙ ELLE POURRA ÊTRE PAYÉE.
 *
 * Le client règle une partie de deux façons, et le backend fait pareil : au barème du
 * MODE quand le salon est parti complet (`table`), au barème de l'EFFECTIF quand il est
 * parti réduit (`tableEffectif`) — et ce second chemin refuse en dessous de trois joueurs.
 *
 * Or une politique de banc pose son effectif À LA RACINE, donc pour TOUS les modes :
 * `DUEL_TEST` ouvre des « arènes » de deux. Une mise engagée là n'a aucun barème — ni
 * celui de l'arène (seize mises attendues dans le pot), ni celui d'un salon réduit.
 *
 * Vécu en jouant : `npm start` sans `POLITIQUE=`, ticket resté sur ARENA à 2 USDC — la
 * valeur par défaut du lobby —, deux joueurs. La partie se jouait, puis le règlement
 * JETAIT dans le gestionnaire de fin du client : le vainqueur repartait au lobby sans
 * écran ni roue, le perdant restait en course. `diag/franchir-rondin.mjs` le rejoue.
 *
 * On refuse donc la mise à l'inscription, avec une raison nommée, plutôt que d'ouvrir une
 * partie qu'on ne saura pas payer. Une partie gratuite passe toujours : rien à régler.
 */
export function misePayable(regle, modeId, mise) {
  if (!mise) return true;
  // `formatDe` relève déjà le minimum à trois quand un pot existe ; un salon dont la cible
  // est SOUS ce minimum ne partira jamais — mieux vaut le dire à l'inscription.
  const f = formatDe(regle, modeId, mise);
  return f.minimum <= f.cible;
}

/** Retrouve une politique par son nom, et refuse clairement l'inconnue. */
export function politique(nom) {
  const p = POLITIQUES[nom];
  if (!p) {
    throw new Error(`politique inconnue « ${nom} » — attendu : ${Object.keys(POLITIQUES).join(', ')}`);
  }
  return p;
}

/**
 * Peut-on entrer dans cette file avec cette identite et ce pont vers l'argent ?
 *
 * Trois cas, dans l'ordre ou ils comptent :
 *   - une file gratuite est ouverte a tous, toujours ;
 *   - avec un PONT (un backend qui engage les mises), il faut un compte verifie : c'est
 *     lui que le backend debite, et un invite n'a pas de wallet ;
 *   - sans pont, une file payante n'existe que si la politique dit `facultative` — un
 *     banc, avec son portefeuille imaginaire. En production, elle est FERMEE : miser sans
 *     rien derriere, c'est exactement ce qu'on a retire du produit le 2 septembre 2026.
 *
 * @returns {null | string} `null` si c'est permis, sinon la raison du refus
 */
export function refusDEntree(regle, mise, { compte = null, pont = null } = {}) {
  if (!mise) return null;
  if (pont) return compte ? null : 'NON_AUTHENTIFIE';
  /*
   * Sans pont, seule une politique qui EXIGE l'identité ferme les files payantes :
   * PRODUCTION, et elle seule. Une politique de banc écrite à la main dans un harnais
   * (`{ nom: 'DUEL_TEST', cible: 2, … }`) ne dit rien de l'identité, et c'est un banc :
   * le portefeuille imaginaire du client suffit. `index.js` refuse de toute façon de
   * démarrer PRODUCTION sans pont — la porte est fermée des deux côtés.
   */
  return regle.identite === 'requise' ? 'ARGENT_INDISPONIBLE' : null;
}
