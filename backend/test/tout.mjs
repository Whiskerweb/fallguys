/**
 * Les verdicts du backend. `npm test` depuis backend/.
 *
 * Aucun de ces tests ne juge une capture d'ecran : ce sont des nombres, des contraintes
 * et des refus. Ils tournent sur un vrai Postgres (PGlite) monte en memoire, donc partout
 * et sans installation.
 *
 * Quatre choses a prouver, dans cet ordre d'importance :
 *   1. RLS interdit au navigateur de toucher au grand livre.
 *   2. L'argent ne se cree ni ne se perd.
 *   3. Rejouer un mouvement ne paie pas deux fois.
 *   4. Les gains payes sont ceux que le lobby annonce.
 */

import { banc, joueur, doter, dit, refuse, titre, bilan } from './aide.mjs';
import { poster, compte, solde, verifierInvariant } from '../src/livre.js';
import { engager, regler } from '../src/match/regler.js';
import { table, PALIERS, CONFIG } from '../src/gains.js';
import { MICROS, ecrire } from '../src/argent.js';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const { db, pglite } = await banc();

// ===========================================================================
titre('1. RLS — le navigateur ne touche pas au grand livre');
// ===========================================================================
/*
 * Le scenario reel : quelqu'un ouvre la console du navigateur, recupere la cle `anon`
 * dans le bundle, et essaie. Sous le role `authenticated`, avec les memes droits de table
 * que Supabase accorde par defaut, RLS est la seule barriere. On la met a l'epreuve.
 */
{
  const alice = await joueur(db, 'alice');
  const bob = await joueur(db, 'bob');
  await doter(db, alice, 20 * MICROS);
  await doter(db, bob, 20 * MICROS);

  // Chaque tentative dans sa propre transaction : un refus de Postgres avorte la
  // transaction en cours, et les suivantes echoueraient pour cette raison-la plutot
  // que pour la bonne. Un test qui passe pour le mauvais motif ne prouve rien.
  const enTantQue = (id, travail) => db.transaction(async (tx) => {
    await tx.query(`set local role authenticated`);
    await tx.query(`set local request.jwt.claim.sub = '${id}'`);
    return travail(tx);
  });

  await refuse(
    enTantQue(alice, (tx) => tx.query('select * from public.ledger_entries')
      .then((r) => { if (r.rows.length === 0) throw new Error('vide'); return r; })),
    'lire le grand livre est impossible (aucune ligne ne remonte)',
  );

  await refuse(
    enTantQue(alice, (tx) => tx.query(
      `insert into public.ledger_entries (tx_id, compte, amount_micros)
       values (gen_random_uuid(), 'user:' || $1, 999000000)`, [alice])),
    's\'ecrire un solde dans le grand livre est refuse',
  );

  await refuse(
    enTantQue(alice, (tx) => tx.query(
      `insert into public.ledger_tx (id, genre, ref) values (gen_random_uuid(), 'depot', 'faux')`)),
    'ouvrir un mouvement soi-meme est refuse',
  );

  await refuse(
    enTantQue(alice, (tx) => tx.query(
      `update public.profiles set wallet = 'AdresseDuVoleur' where id = $1`, [alice])
      .then((r) => { if (r.affectedRows === 0 && r.rowCount === 0) throw new Error('aucune ligne'); return r; })),
    'changer son propre wallet depuis le navigateur est refuse',
  );

  const vuDeAlice = await enTantQue(alice, (tx) => tx.query('select id from public.profiles'));
  dit(vuDeAlice.rows.length === 1 && vuDeAlice.rows[0].id === alice,
    'un joueur ne voit que son propre profil, jamais celui des autres');

  const soldeAlice = await enTantQue(alice, (tx) => tx.query('select public.mon_solde() as s'));
  dit(Number(soldeAlice.rows[0].s) === 20 * MICROS,
    `un joueur lit SON solde par la fonction dediee : ${ecrire(Number(soldeAlice.rows[0].s))} USDC`);

  const soldeBob = await enTantQue(bob, (tx) => tx.query('select public.mon_solde() as s'));
  dit(Number(soldeBob.rows[0].s) === 20 * MICROS,
    'la fonction rend bien le solde de l\'APPELANT, pas un solde fixe');

  // La fonction n'a aucun parametre : il n'y a litteralement pas de moyen de demander
  // le solde d'un autre. C'est la propriete qu'on veut, et elle est structurelle.
  await refuse(
    enTantQue(alice, (tx) => tx.query(`select public.mon_solde($1)`, [bob])),
    'demander le solde d\'un autre joueur est impossible (la fonction ne prend rien)',
  );
}

// ===========================================================================
titre('2. Partie double — l\'argent ne se cree ni ne se perd');
// ===========================================================================
{
  await refuse(
    db.transaction((tx) => poster(tx, {
      genre: 'depot', ref: 'desequilibre',
      lignes: [
        { compte: compte.entree, montant: -1000 },
        { compte: 'user:x', montant: +9999 },
      ],
    })),
    'un mouvement desequilibre est refuse',
  );

  // Et si quelqu'un contourne `poster()` pour ecrire directement, la CONTRAINTE tient.
  await refuse(
    db.transaction(async (tx) => {
      const id = randomUUID();
      await tx.query(`insert into public.ledger_tx (id, genre, ref) values ($1, 'depot', 'brut')`, [id]);
      await tx.query(
        `insert into public.ledger_entries (tx_id, compte, amount_micros) values ($1, 'user:x', 500)`, [id]);
    }),
    'ecrire une ligne seule EN CONTOURNANT le module est refuse par la base elle-meme',
  );
}

// ===========================================================================
titre('3. Idempotence — rejouer ne paie pas deux fois');
// ===========================================================================
{
  const carol = await joueur(db, 'carol');
  const signature = '5xFakeSolanaSignature' + randomUUID();

  const depot = () => db.transaction((tx) => poster(tx, {
    genre: 'depot', ref: signature,
    metadata: { signature },
    lignes: [
      { compte: compte.entree, montant: -20 * MICROS },
      { compte: compte.joueur(carol), montant: +20 * MICROS },
    ],
  }));

  const un = await depot();
  const deux = await depot();
  const trois = await depot();

  dit(un.deja === false && deux.deja === true && trois.deja === true,
    'le meme depot rejoue trois fois est reconnu comme deja pose');
  dit(un.id === deux.id && deux.id === trois.id,
    'les trois tentatives designent le meme mouvement');

  const s = await solde(db, compte.joueur(carol));
  dit(s === 20 * MICROS, `credite une seule fois : ${ecrire(s)} USDC et non ${ecrire(60 * MICROS)}`);
}

// ===========================================================================
titre('4. Solde insuffisant, et double-clic sur JOUER');
// ===========================================================================
{
  const dan = await joueur(db, 'dan');
  await doter(db, dan, 1 * MICROS);

  await refuse(
    engager(db, { matchId: 'M-pauvre', userId: dan, mise: 5 * MICROS }),
    'miser plus que son solde est refuse',
  );

  const m = 'M-doubleclic';
  const a = await engager(db, { matchId: m, userId: dan, mise: 1 * MICROS });
  const b = await engager(db, { matchId: m, userId: dan, mise: 1 * MICROS });
  dit(a.deja === false && b.deja === true, 'engager deux fois la meme partie ne debite qu\'une fois');
  dit(await solde(db, compte.joueur(dan)) === 0, 'le solde est bien tombe a zero, pas en negatif');
}

// ===========================================================================
titre('5. Cent parties completes a seize joueurs');
// ===========================================================================
/*
 * Le test central. Cent parties reelles, mises engagees et gains verses, puis
 * l'invariant global. C'est ici qu'apparaitraient les erreurs d'arrondi que la
 * comparaison rang par rang laisse passer : la table peut etre juste ligne a ligne et
 * perdre un micro a chaque partie.
 */
{
  const seize = [];
  for (let i = 0; i < CONFIG.joueurs; i++) seize.push(await joueur(db, `p${i}`));
  for (const p of seize) await doter(db, p, 500 * MICROS);

  const avant = seize.length * 500 * MICROS;
  let miseeTotale = 0;

  for (let n = 0; n < 100; n++) {
    const mise = PALIERS[n % PALIERS.length] * MICROS;
    const matchId = `M${n}`;
    for (const p of seize) {
      await engager(db, { matchId, userId: p, mise });
      miseeTotale += mise;
    }
    // Classement tournant : chaque joueur passe par toutes les places.
    const classement = seize.map((userId, i) => ({ userId, rang: ((i + n) % CONFIG.joueurs) + 1 }));
    await regler(db, { matchId, mise, classement });
  }

  const inv = await verifierInvariant(db);
  dit(inv.total === 0, `invariant global : la somme du livre vaut ${inv.total}`);
  dit(inv.desequilibres.length === 0, `aucun mouvement desequilibre (${inv.desequilibres.length} trouve(s))`);
  dit(inv.potsNonSoldes.length === 0, `les 100 pots regles sont soldes (${inv.potsNonSoldes.length} en reste)`);

  // Le pot de `M-doubleclic`, engage au test 4 et jamais regle, doit rester GARNI : c'est
  // une partie en cours. L'invariant ne doit pas le confondre avec une erreur comptable.
  dit(await solde(db, compte.pot('M-doubleclic')) === 1 * MICROS,
    'une partie en cours garde son pot, sans declencher de faux verdict');

  const rake = await solde(db, compte.rake);
  const attenduRake = Array.from({ length: 100 }, (_, n) => table(PALIERS[n % PALIERS.length] * MICROS).rake)
    .reduce((a, b) => a + b, 0);
  dit(rake === attenduRake, `tresorerie : ${ecrire(rake)} USDC de rake preleves (attendu ${ecrire(attenduRake)})`);
  dit(rake === Math.floor(miseeTotale / 10), `le rake vaut exactement 10 % des ${ecrire(miseeTotale)} USDC engages`);

  let apres = 0;
  for (const p of seize) apres += await solde(db, compte.joueur(p));
  dit(apres + rake === avant,
    `les joueurs ont ${ecrire(apres)} + ${ecrire(rake)} de rake = ${ecrire(avant)} au depart`);

  // Une partie deja reglee ne se regle pas une seconde fois.
  const rejeu = await regler(db, {
    matchId: 'M0', mise: PALIERS[0] * MICROS,
    classement: seize.map((userId, i) => ({ userId, rang: i + 1 })),
  });
  dit(rejeu.deja === true, 'regler une partie deja reglee ne verse rien de plus');
  const invApres = await verifierInvariant(db);
  dit(invApres.total === 0, 'l\'invariant tient apres la tentative de rejeu');
}

// ===========================================================================
titre('6. Le backend paie ce que le lobby annonce');
// ===========================================================================
/*
 * `src/gains.js` (qui paie) et `tools/feel-lab/src/economie.js` (qui annonce) sont deux
 * implementations de la meme regle. Deux implementations derivent toujours l'une de
 * l'autre : on les compare donc rang par rang, pour de vrai, au lieu de le supposer.
 */
{
  globalThis.localStorage = {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
  const chemin = path.resolve('../tools/feel-lab/src/economie.js');
  const lobby = await import(pathToFileURL(chemin).href);

  dit(lobby.CONFIG.rakeBp === CONFIG.rakeBp,
    `meme rake des deux cotes : ${CONFIG.rakeBp / 100} %`);
  dit(String(lobby.CONFIG.poidsFinalistes) === String(CONFIG.poidsFinalistes),
    `memes poids de bonus : ${CONFIG.poidsFinalistes.join(' / ')}`);

  let ecarts = 0;
  for (const usdc of PALIERS) {
    const ici = table(usdc * MICROS);
    const la = lobby.table(usdc * MICROS);
    if (ici.pot !== la.pot || ici.rake !== la.rake) ecarts++;
    for (let r = 0; r < CONFIG.joueurs; r++) if (ici.parRang[r] !== la.parRang[r]) ecarts++;
  }
  dit(ecarts === 0, `les 3 tables x 16 rangs sont identiques des deux cotes (${ecarts} ecart)`);

  const t = table(1 * MICROS);
  dit(t.rake === 1_600_000 && t.parRang[0] === 5_000_000 && t.parRang[1] === 2_500_000
    && t.parRang[2] === 1_700_000 && t.parRang[3] === 1_200_000,
    `table a 1 USDC : rake ${ecrire(t.rake)} · ${t.parRang.slice(0, 4).map(ecrire).join(' / ')}`);
}

await pglite.close();
process.exit(bilan() === 0 ? 0 : 1);
