/**
 * LA BOUTIQUE — des skins contre des USDG, et chaque USDG part au brulage.
 *
 * Decision produit du 5 septembre 2026 : Pepe est le personnage de depart, BabyTrump se
 * gagne toujours en publiant un post (une regle du navigateur, `tools/feel-lab/src/
 * boutique.js`, qui ne touche pas a l'argent), et trois skins s'ACHETENT, entre 10 et
 * 15 USDG. « Tous les revenus lies serviront a buy and burn le token » : un achat est
 * donc un VIREMENT du wallet de jeu du joueur vers le wallet FRAIS — le meme que le rake —
 * et le brulage l'y trouve au tour suivant. Rien de special a ecrire pour tenir la
 * promesse : elle est dans la destination du virement, et la page de suivi le montre.
 *
 * Le catalogue des PRIX est ici, cote argent, et recopie dans le navigateur pour
 * l'affichage ; `diag/boutique.mjs` verifie que les deux disent la meme chose. C'est
 * CE fichier qui fait foi : le navigateur ne dit jamais un prix au backend, il dit un
 * article, et le backend le fait payer a son prix.
 *
 * Le chemin est celui d'une mise : le livre d'abord (debit du joueur, credit des frais,
 * et la ligne `purchases` dans la meme transaction), la chaine ensuite, et si la chaine
 * refuse, le mouvement inverse. Une possession n'existe qu'une fois payee au livre.
 */

import { randomUUID } from 'node:crypto';
import { poster, compte, solde, verrouillerJoueur, mouvementExistant } from './livre.js';
import { MICROS, ecrire } from './argent.js';
import { config } from './config.js';
import { tresorerie } from './robinhood/tresorerie.js';
import { ChaineEchouee, ChaineIncertaine } from './robinhood/chaine.js';

/** Les articles PAYANTS, avec leur prix en micros. Les identifiants sont ceux du catalogue du jeu. */
export const ARTICLES = {
  'char-techtitan': { prix: 15 * MICROS },
  'char-diplomate': { prix: 12 * MICROS },
  'char-captainleeky': { prix: 10 * MICROS },
};

export const LIEN_SUIVI = 'https://play.babyguy.dev/api/suivi';

/** Le catalogue tel que le lobby le lit : identifiant et prix, rien d'autre. */
export function catalogue() {
  return Object.entries(ARTICLES).map(([id, a]) => ({ id, prix: a.prix }));
}

/** Ce que le joueur possede — tout article paye au livre, chaine confirmee ou en suspens. */
export async function possessions(db, userId) {
  const r = await db.query(
    `select article from public.purchases where user_id = $1 and statut in ('paye', 'soumis', 'confirme') order by cree_le`, [userId],
  );
  return r.rows.map((x) => x.article);
}

const refus = (code, message) => Object.assign(new Error(message), { code });

/**
 * Achete un skin : le livre, puis la chaine.
 *
 * @returns {Promise<{article: string, prix: number, deja: boolean, statut: string, signature?: string, solde: number}>}
 */
export async function acheter(db, chaine, { userId, article }) {
  const a = ARTICLES[article];
  if (!a) throw refus('ARTICLE_INCONNU', `« ${article} » n'est pas en vente`);
  const prix = a.prix;
  /*
   * UNE TENTATIVE, UNE CLE. Un achat refuse par la chaine est rembourse au livre ; le
   * retenter avec la meme cle d'idempotence retrouverait le mouvement d'origine (deja
   * pose) sans debiter a nouveau, et la chaine paierait quand meme : l'ecart exact que
   * `test/boutique.mjs` a attrape. La cle porte donc l'identifiant de la tentative, et
   * `purchases.ref` le garde pour la reprise.
   */
  const id = randomUUID();
  const ref = `${userId}:${article}:${id}`;

  // 1. LE LIVRE. Verrou sur le joueur : deux clics ne paient pas deux fois, et le
  //    controle « a-t-il de quoi ? » lit un solde que personne d'autre ne debite.
  const livre = await db.transaction(async (tx) => {
    await verrouillerJoueur(tx, userId);
    const existante = (await tx.query(`select statut from public.purchases where user_id = $1 and article = $2`, [userId, article])).rows[0];
    if (existante && existante.statut !== 'echoue') return { deja: true, statut: existante.statut };
    const disponible = await solde(tx, compte.joueur(userId));
    if (disponible < prix) throw refus('SOLDE_INSUFFISANT', `solde ${ecrire(disponible)} USDG, prix ${ecrire(prix)} USDG`);
    const mvt = await poster(tx, {
      genre: 'achat', ref,
      metadata: { userId, article, prix, reseau: config.reseau },
      lignes: [
        { compte: compte.joueur(userId), montant: -prix },
        { compte: compte.rake, montant: +prix },
      ],
    });
    await tx.query(
      `insert into public.purchases (id, user_id, article, prix_micros, statut, tx_id, ref)
       values ($1, $2, $3, $4, 'paye', $5, $6)
       on conflict (user_id, article) do update set id = excluded.id, ref = excluded.ref, statut = 'paye', prix_micros = excluded.prix_micros, tx_id = excluded.tx_id, signature = null, raison_echec = null, cree_le = now()`,
      [id, userId, article, prix, mvt.id, ref],
    );
    return { deja: false, statut: 'paye' };
  });
  if (livre.deja) return { article, prix, deja: true, statut: livre.statut, solde: await solde(db, compte.joueur(userId)) };

  // 2. LA CHAINE : du wallet du joueur vers les FRAIS, la ou le brulage puise.
  if (!chaine) return { article, prix, deja: false, statut: 'paye', solde: await solde(db, compte.joueur(userId)) };
  try {
    const r = await chaine.executer({
      operations: [{
        type: 'virement', de: tresorerie.joueur(userId), vers: tresorerie.frais().address, mint: 'usdg', montant: prix,
        objet: 'achat', ref, userId,
      }],
    });
    await confirmerAchat(db, { ref, signature: r.signature });
    return { article, prix, deja: false, statut: 'confirme', signature: r.signature, solde: await solde(db, compte.joueur(userId)) };
  } catch (e) {
    if (e instanceof ChaineEchouee) {
      await annulerAchat(db, { ref, raison: `chaine : ${e.message}` });
      throw refus('CHAINE_REFUS', `le paiement a ete refuse par la chaine : ${e.message}`);
    }
    if (e instanceof ChaineIncertaine) {
      // Peut-etre parti : la possession reste, la reprise tranchera.
      await db.query(`update public.purchases set statut = 'soumis', signature = $2 where ref = $1`, [ref, e.signature ?? null]);
      return { article, prix, deja: false, statut: 'soumis', signature: e.signature, solde: await solde(db, compte.joueur(userId)) };
    }
    throw e;
  }
}

/** Defait un achat dont la chaine dit qu'il n'a jamais eu lieu : le mouvement inverse, et la possession retiree. */
export async function annulerAchat(db, { ref, raison }) {
  await db.transaction(async (tx) => {
    const mvt = (await tx.query(`select metadata from public.ledger_tx where genre = 'achat' and ref = $1`, [ref])).rows[0];
    if (!mvt || await mouvementExistant(tx, 'achat_echoue', ref)) return;
    const { userId, article, prix } = mvt.metadata;
    await poster(tx, {
      genre: 'achat_echoue', ref, metadata: { userId, article, raison },
      lignes: [
        { compte: compte.rake, montant: -Number(prix) },
        { compte: compte.joueur(userId), montant: +Number(prix) },
      ],
    });
    await tx.query(`update public.purchases set statut = 'echoue', raison_echec = $2 where ref = $1`, [ref, raison]);
  });
}

/** Un achat dont la chaine dit qu'il est mine : la possession est confirmee. */
export async function confirmerAchat(db, { ref, signature }) {
  await db.query(`update public.purchases set statut = 'confirme', signature = coalesce($2, signature) where ref = $1 and statut <> 'echoue'`, [ref, signature ?? null]);
}

/** Ce que la page de suivi montre : combien de skins vendus, pour combien — tout parti au brulage. */
export async function bilanBoutique(db) {
  const r = (await db.query(
    `select count(*)::int as n, coalesce(sum(prix_micros), 0)::text as total from public.purchases where statut in ('paye', 'soumis', 'confirme')`,
  )).rows[0];
  return { ventes: r.n, total: Number(r.total) };
}
