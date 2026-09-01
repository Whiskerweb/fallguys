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
 *   `proposerApres`  secondes avant de proposer un départ à effectif réduit
 *   `bots`           qui peut les convoquer, et à quelle condition
 *   `dureeManche`    secondes au-delà desquelles une manche s'arrête d'elle-même
 *
 * `dureeManche` n'est pas un détail de confort. Depuis que les parties tournent en TEMPS
 * RÉEL, une manche de trois minutes prend trois minutes : un harnais qui joue deux manches
 * attendrait six minutes, et personne ne lance une suite de tests qui dure six minutes.
 * Les politiques de test raccourcissent donc, sans rien changer aux règles.
 */

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
    cible: 16,
    minimum: 10,
    attente: 15,
    proposerApres: 60,
    bots: BOTS.JAMAIS,
    dureeManche: 180,
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
    cible: 2,
    minimum: 2,
    attente: 5,
    proposerApres: 5,
    bots: BOTS.JAMAIS,
    dureeManche: 180,
  },

  /**
   * Le banc d'essai — `tools/test-harness` UNIQUEMENT.
   *
   * Un seul humain suffit, les bots complètent. C'est la seule politique qui les convoque,
   * et elle n'a aucune raison d'apparaître ailleurs que dans un harnais.
   */
  BANC: {
    nom: 'BANC',
    cible: 16,
    minimum: 1,
    attente: 0,
    proposerApres: 0,
    bots: BOTS.SI_GRATUIT,
    dureeManche: 180,
  },
};

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

/** Retrouve une politique par son nom, et refuse clairement l'inconnue. */
export function politique(nom) {
  const p = POLITIQUES[nom];
  if (!p) {
    throw new Error(`politique inconnue « ${nom} » — attendu : ${Object.keys(POLITIQUES).join(', ')}`);
  }
  return p;
}
