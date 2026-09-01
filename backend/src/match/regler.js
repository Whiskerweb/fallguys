/**
 * Engager une mise, et regler une partie.
 *
 * Ce sont les deux seuls moments ou l'argent d'un joueur bouge a cause du JEU. Tout le
 * reste (depot, retrait) touche a la chaine.
 *
 * Principe repris de la spec section 6.3 — la separation jeu / argent :
 * le serveur de jeu ne connait aucun solde et ne declenche aucun paiement. Il produit un
 * resultat de partie ; c'est ce module, et lui seul, qui le convertit en mouvements.
 *
 *   ATTENTION, ET C'EST LA LIMITE ASSUMEE DU LOT DEVNET :
 *   tant que le serveur de jeu autoritatif n'existe pas, le classement est DECLARE par le
 *   navigateur. `regler()` verifie la coherence interne de ce qu'on lui donne — jamais sa
 *   veracite, qu'aucune verification ne peut etablir depuis ici. C'est sans consequence
 *   sur devnet, ou rien ne vaut rien. C'est redhibitoire en mainnet. Voir README.md.
 */

import { poster, compte, solde, verrouillerJoueur, mouvementExistant } from '../livre.js';
import { table, CONFIG } from '../gains.js';
import { micros } from '../argent.js';

/**
 * Engage la mise d'un joueur : elle quitte son solde et entre dans le pot.
 *
 * La mise est debitee AU LANCEMENT, pas a l'arrivee — c'est ce qui fait la difference
 * entre un bouton et un engagement, et c'est deja la regle du prototype
 * (`main.js: startEpisode`). Abandonner en cours de partie perd la mise.
 *
 * @returns {Promise<{tx: string, deja: boolean, solde: number}>}
 */
export async function engager(db, { matchId, userId, mise }) {
  const montant = micros(mise, 'mise');
  if (montant <= 0) throw new Error('engager : la mise doit etre strictement positive');

  return db.transaction(async (tx) => {
    /*
     * Verrou sur le joueur AVANT de lire son solde.
     *
     * Sans lui, deux requetes simultanees — un double-clic sur JOUER, une relance
     * reseau — lisent toutes les deux un solde suffisant, et toutes les deux debitent.
     * Le joueur mise alors deux fois ce qu'il possede. C'est le bug de concurrence le
     * plus banal du genre, et le seul de ce fichier qui coute reellement de l'argent.
     */
    await verrouillerJoueur(tx, userId);

    /*
     * IDEMPOTENCE AVANT VALIDATION.
     *
     * Un joueur n'engage qu'une fois par partie. Si le mouvement est deja pose, on repart
     * avec, sans rien verifier : son solde a DEJA ete debite, donc le controle « a-t-il de
     * quoi miser ? » echouerait sur une requete pourtant parfaitement legitime. C'est ce
     * qu'une simple relance reseau apres un debit reussi produit, et le joueur y verrait
     * un refus la ou tout s'est bien passe.
     */
    const deja = await mouvementExistant(tx, 'mise', `${matchId}:${userId}`);
    if (deja) {
      return { tx: deja, deja: true, solde: await solde(tx, compte.joueur(userId)) };
    }

    const disponible = await solde(tx, compte.joueur(userId));
    if (disponible < montant) {
      const e = new Error('solde insuffisant');
      e.code = 'SOLDE_INSUFFISANT';
      e.disponible = disponible;
      e.requis = montant;
      throw e;
    }

    const r = await poster(tx, {
      genre: 'mise',
      // Idempotence : un joueur n'engage qu'une fois par partie. Une relance de la meme
      // requete retrouve le mouvement et ne debite pas une seconde fois.
      ref: `${matchId}:${userId}`,
      metadata: { matchId, userId },
      lignes: [
        { compte: compte.joueur(userId), montant: -montant },
        { compte: compte.pot(matchId), montant: +montant },
      ],
    });

    return { tx: r.id, deja: r.deja, solde: disponible - montant };
  });
}

/**
 * Regle une partie : preleve le rake, verse les gains, solde le pot.
 *
 * @param {object} resultat
 * @param {string} resultat.matchId
 * @param {number} resultat.mise mise d'entree en micros
 * @param {Array<{userId: string, rang: number}>} resultat.classement
 */
export async function regler(db, { matchId, mise, classement }) {
  const montant = micros(mise, 'mise');
  const { pot, rake, parRang } = table(montant);

  /*
   * Coherence du classement, verifiee avant d'ecrire quoi que ce soit.
   *
   * On ne peut pas savoir d'ici si le classement est VRAI. On peut savoir s'il est
   * possible : des rangs distincts, dans les bornes, un joueur par rang. Un classement
   * incoherent est le signe d'un bug ou d'une falsification maladroite ; le refuser coute
   * trois lignes et evite d'ecrire dans le livre des gains qu'on ne saura pas defaire.
   */
  const rangs = new Set();
  for (const { userId, rang } of classement) {
    if (!userId) throw new Error('regler : joueur sans identifiant dans le classement');
    if (!Number.isInteger(rang) || rang < 1 || rang > CONFIG.joueurs) {
      throw new Error(`regler : rang ${rang} hors bornes (1..${CONFIG.joueurs})`);
    }
    if (rangs.has(rang)) throw new Error(`regler : rang ${rang} attribue deux fois`);
    rangs.add(rang);
  }

  return db.transaction(async (tx) => {
    // Idempotence en premier, ici aussi : sur une partie deja reglee le pot est solde,
    // et les lignes qu'on calculerait a partir de lui n'auraient aucun sens.
    const deja = await mouvementExistant(tx, 'gain', matchId);
    if (deja) return { tx: deja, deja: true, pot, rake, verse: 0 };

    const potReel = await solde(tx, compte.pot(matchId));

    const lignes = [];
    let verse = 0;

    for (const { userId, rang } of classement) {
      const gain = parRang[rang - 1] ?? 0;
      if (gain > 0) {
        lignes.push({ compte: compte.joueur(userId), montant: +gain });
        verse += gain;
      }
    }

    if (rake > 0) lignes.push({ compte: compte.rake, montant: +rake });

    /*
     * Le pot est debite de ce qui en sort REELLEMENT.
     *
     * Sur une partie complete a 16 joueurs, `verse + rake` vaut exactement le pot. Mais
     * une partie a effectif reduit — ce que le prototype solo produit aujourd'hui — laisse
     * un residu : le pot ne contient que la mise du joueur present, alors que la table
     * suppose seize mises. On solde donc le pot par ce qu'il contient, et on inscrit le
     * complement la ou il vient : la caisse.
     *
     * Sans cela, le pot resterait negatif et l'invariant « tout pot revient a zero »
     * cesserait de vouloir dire quelque chose — c'est-a-dire cesserait de detecter les
     * vraies parties mal reglees.
     */
    const sorties = verse + rake;
    lignes.push({ compte: compte.pot(matchId), montant: -potReel });
    if (sorties !== potReel) {
      lignes.push({ compte: compte.caisse, montant: potReel - sorties });
    }

    const r = await poster(tx, {
      genre: 'gain',
      ref: matchId,          // une partie ne se regle qu'une fois. La base le garantit.
      metadata: { matchId, mise: montant, pot, rake, classement },
      lignes,
    });

    if (!r.deja) {
      await tx.query(
        `insert into public.matches (id, mise_micros, pot_micros, rake_micros, classement, tx_id)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do nothing`,
        [matchId, montant, pot, rake, JSON.stringify(classement), r.id],
      );
    }

    return { tx: r.id, deja: r.deja, pot, rake, verse };
  });
}
