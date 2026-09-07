/**
 * LE GRAND LIVRE — ecriture en partie double.
 *
 * C'est le seul module autorise a faire bouger de l'argent. Tout le reste du backend
 * (guetteur de depots, signataire de retraits, reglement de partie) construit un
 * mouvement et le lui donne a poster.
 *
 * Deux garanties, et elles sont tenues par la BASE plutot que par ce fichier :
 *
 *   1. EQUILIBRE — la somme des lignes d'un mouvement vaut zero. Verifiee par une
 *      contrainte differee (`001_grand_livre.sql`), donc au commit, donc meme si
 *      quelqu'un ecrit un jour par un autre chemin que celui-ci.
 *   2. IDEMPOTENCE — un mouvement porte une cle `(genre, ref)` unique. Rejouer le meme
 *      depot ou le meme reglement de partie ne credite pas deux fois ; la seconde
 *      tentative retrouve le mouvement existant et repart avec, sans erreur.
 *
 * Le point 2 est le plus important du fichier. Un guetteur de chaine redemarre, relit
 * des blocs deja vus, et rejoue. Ce n'est pas un cas limite : c'est le fonctionnement
 * NORMAL. Si l'idempotence est une precaution du code appelant plutot qu'une contrainte
 * de la base, elle finit toujours par manquer quelque part.
 */

import { randomUUID } from 'node:crypto';
import { micros } from './argent.js';

/** Comptes du livre. Un compte n'est qu'une chaine : la base n'en tient pas la liste. */
export const compte = {
  joueur: (userId) => `user:${userId}`,
  pot: (matchId) => `pot:${matchId}`,
  /** Les 10 % preleves sur chaque pot. Destines au rachat-et-brulage, pas encore executes. */
  rake: 'treasury:rake',
  /** La caisse : la contrepartie en livre de ce que le wallet maison detient sur la chaine. */
  caisse: 'treasury:hot',
  /**
   * Le pool BG/USDG : les USDG que le brulage y a deposes en achetant des BG. Sur le testnet
   * c'est notre propre reserve ; sur mainnet, l'argent part vers un marche et ce compte
   * disparait au profit de `chain:out`.
   */
  pool: 'treasury:pool',
  /** Frontiere avec la chaine. Ce qui entre par un depot, ce qui sort par un retrait. */
  entree: 'chain:in',
  sortie: 'chain:out',
};

/**
 * Poste un mouvement.
 *
 * @param {{query: (sql: string, params?: unknown[]) => Promise<{rows: any[]}>}} tx
 *   client DEJA dans une transaction. Ce n'est pas un detail de confort : la contrainte
 *   d'equilibre est differee au commit, donc poster hors transaction ferait echouer la
 *   toute premiere ligne, qui est forcement desequilibree a elle seule.
 * @param {object} mouvement
 * @param {string} mouvement.genre 'depot' | 'mise' | 'rake' | 'gain' | 'retrait' | ...
 * @param {string|null} [mouvement.ref] cle d'idempotence (hache de transaction, id de partie)
 * @param {object} [mouvement.metadata]
 * @param {Array<{compte: string, montant: number}>} mouvement.lignes
 * @returns {Promise<{id: string, deja: boolean}>} `deja` vaut true si le mouvement existait
 */
export async function poster(tx, { genre, ref = null, metadata = {}, lignes }) {
  if (!genre) throw new Error('poster : genre manquant');
  if (!Array.isArray(lignes) || lignes.length < 2) {
    throw new Error('poster : un mouvement compte au moins deux lignes (partie double)');
  }

  /*
   * On verifie l'equilibre AVANT d'ecrire, en plus de la contrainte en base.
   *
   * Redondant, et volontairement : la contrainte protege les donnees, cette verification
   * protege le developpeur. Elle echoue a l'endroit du code qui a construit le mouvement
   * fautif, avec ses lignes sous les yeux, au lieu d'un `raise exception` au commit, a
   * des dizaines d'appels de distance de la cause.
   */
  let somme = 0;
  for (const l of lignes) {
    if (!l.compte) throw new Error('poster : ligne sans compte');
    somme += micros(l.montant, `ligne ${l.compte}`);
  }
  if (somme !== 0) {
    const detail = lignes.map((l) => `${l.compte} ${l.montant > 0 ? '+' : ''}${l.montant}`).join(', ');
    throw new Error(`poster : mouvement « ${genre} » desequilibre de ${somme} micros — ${detail}`);
  }

  /*
   * IDEMPOTENCE. `on conflict do nothing` puis relecture : si la ligne existait deja,
   * `insert ... returning` ne rend rien, et on retrouve le mouvement d'origine.
   *
   * L'alternative — verifier l'existence puis inserer — a une fenetre entre les deux ou
   * un second processus insere. La contrainte d'unicite, elle, n'a pas de fenetre.
   */
  const id = randomUUID();
  const insere = await tx.query(
    `insert into public.ledger_tx (id, genre, ref, metadata)
     values ($1, $2, $3, $4)
     on conflict (genre, ref) do nothing
     returning id`,
    [id, genre, ref, JSON.stringify(metadata)],
  );

  if (insere.rows.length === 0) {
    const existant = await tx.query(
      `select id from public.ledger_tx where genre = $1 and ref is not distinct from $2`,
      [genre, ref],
    );
    if (existant.rows.length === 0) {
      throw new Error(`poster : conflit sur (${genre}, ${ref}) sans mouvement retrouvable`);
    }
    return { id: existant.rows[0].id, deja: true };
  }

  for (const l of lignes) {
    await tx.query(
      `insert into public.ledger_entries (tx_id, compte, amount_micros) values ($1, $2, $3)`,
      [id, l.compte, l.montant],
    );
  }

  return { id, deja: false };
}

/**
 * Retrouve un mouvement deja pose, ou `null`.
 *
 * A appeler AVANT toute validation metier. L'ordre n'est pas indifferent : verifier
 * d'abord qu'un joueur a de quoi miser, puis constater que la mise etait deja posee,
 * conduit a refuser pour « solde insuffisant » une requete simplement rejouee — alors
 * que l'argent est deja parti. Une relance reseau suffit a declencher ce scenario, et
 * le joueur y voit un refus la ou tout s'est bien passe.
 *
 * L'idempotence se verifie donc en premier, toujours.
 */
export async function mouvementExistant(tx, genre, ref) {
  const r = await tx.query(
    `select id from public.ledger_tx where genre = $1 and ref is not distinct from $2`,
    [genre, ref],
  );
  return r.rows[0]?.id ?? null;
}

/**
 * Solde d'un compte : la SOMME de ses lignes, jamais une colonne memorisee.
 *
 * Un solde stocke finit toujours par diverger de son historique — il suffit d'un chemin
 * d'ecriture qui oublie de le mettre a jour. Une somme ne le peut pas.
 */
export async function solde(db, nomCompte) {
  const r = await db.query(
    `select coalesce(sum(amount_micros), 0)::text as solde
       from public.ledger_entries where compte = $1`,
    [nomCompte],
  );
  return micros(r.rows[0].solde, `solde de ${nomCompte}`);
}

/**
 * Debite un joueur en s'assurant qu'il a de quoi.
 *
 * Le controle et l'ecriture sont dans la MEME transaction, et la ligne de profil est
 * verrouillee : deux parties lancees simultanement par le meme joueur ne peuvent pas
 * lire toutes les deux un solde suffisant avant que l'une ait debite. Sans ce verrou,
 * un double-clic sur JOUER suffit a miser deux fois 1 USDG avec 1 USDG en poche.
 */
export async function verrouillerJoueur(tx, userId) {
  await tx.query('select id from public.profiles where id = $1 for update', [userId]);
}

/**
 * L'INVARIANT du systeme, en une requete.
 *
 * `total` doit valoir 0 : l'argent ne se cree ni ne se perd, il ne fait que changer de
 * compte. `desequilibres` doit etre vide. N'importe qui peut lancer cette verification
 * sans rien connaitre du code, et c'est bien l'interet.
 */
export async function verifierInvariant(db) {
  const global = await db.query(
    `select coalesce(sum(amount_micros), 0)::text as total from public.ledger_entries`,
  );
  const parMouvement = await db.query(
    `select tx_id, sum(amount_micros)::text as ecart
       from public.ledger_entries group by tx_id having sum(amount_micros) <> 0`,
  );
  /*
   * Pots non soldes — mais SEULEMENT ceux des parties deja reglees.
   *
   * Un pot qui contient encore de l'argent alors que sa partie n'est pas terminee est
   * parfaitement normal : c'est une partie EN COURS (statut « engagee »), mises engagees
   * et gains pas encore verses. Signaler ceux-la ferait du verdict un bruit permanent, et un verdict qui
   * clignote tout le temps finit par ne plus etre lu.
   *
   * Ce qu'on cherche est autre chose : une partie reglee dont le pot ne revient pas a
   * zero. Celle-la est une erreur comptable, et la jointure sur `matches` est ce qui
   * distingue les deux.
   */
  const pots = await db.query(
    `select e.compte, sum(e.amount_micros)::text as reste
       from public.ledger_entries e
       join public.matches m on ('pot:' || m.id) = e.compte
      where e.compte like 'pot:%'
        and m.statut <> 'engagee'
      group by e.compte having sum(e.amount_micros) <> 0`,
  );
  return {
    total: micros(global.rows[0].total, 'total du livre'),
    desequilibres: parMouvement.rows,
    /*
     * Un pot non solde est une partie mal reglee : l'argent des mises y est entre et n'en
     * est pas ressorti en entier. Le detecter ici evite d'avoir a le chercher.
     */
    potsNonSoldes: pots.rows,
  };
}
