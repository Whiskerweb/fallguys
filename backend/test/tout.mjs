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
import {
  table, tableEffectif, PALIERS, CONFIG, configPour,
  MODES, ORDRE_MODES, ISSUES, hachage32, tirerIssue, verifierRoue, roueDe, esperance, grade,
} from '../src/gains.js';
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
    `un joueur lit SON solde par la fonction dediee : ${ecrire(Number(soldeAlice.rows[0].s))} USDG`);

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
  const signature = '0x' + randomUUID().replace(/-/g, '').padEnd(64, 'f') + '#0';

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
  dit(s === 20 * MICROS, `credite une seule fois : ${ecrire(s)} USDG et non ${ecrire(60 * MICROS)}`);
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
  // Cent parties aux paliers 2 / 5 / 10 engagent 563 USDG par joueur. La dotation doit
  // couvrir cela AVEC de la marge : un joueur a court en cours de route ferait echouer le
  // test sur un `SOLDE_INSUFFISANT`, ce qui ne dirait rien de la comptabilite.
  const DOTATION = 2000 * MICROS;
  const seize = [];
  for (let i = 0; i < CONFIG.joueurs; i++) seize.push(await joueur(db, `p${i}`));
  for (const p of seize) await doter(db, p, DOTATION);

  const avant = seize.length * DOTATION;
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
  // Ces cent parties ont ete reglees sans graine de roue (zero) : la ligne FLAT, dont le
  // rake vaut 13,75 % en arene. Le rake d'une partie est celui de SA ligne.
  const attenduRake = Array.from({ length: 100 }, (_, n) => table(PALIERS[n % PALIERS.length] * MICROS, 'arena', tirerIssue('arena', 0).id).rake)
    .reduce((a, b) => a + b, 0);
  dit(rake === attenduRake, `tresorerie : ${ecrire(rake)} USDG de rake preleves (attendu ${ecrire(attenduRake)})`);
  dit(rake >= 0 && rake * 10 <= miseeTotale * 3, `le rake reste entre 0 et 30 % des ${ecrire(miseeTotale)} USDG engages — 10 % en moyenne, prouve en section 6`);

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
 * l'autre : on les compare donc pour de vrai, au lieu de le supposer.
 *
 * Depuis la roue, il y a QUATRE choses a tenir alignees :
 *   le catalogue des modes, les dix issues de chaque mode, le TIRAGE, et la roue de
 *   chaque rang. Un melangeur qui differerait d'un bit ferait afficher a l'ecran de fin
 *   une case que le service de reglement ne paierait pas — l'ecart le plus cher qu'on
 *   puisse produire ici.
 */
{
  globalThis.localStorage = {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
  const chemin = path.resolve('../tools/feel-lab/src/economie.js');
  const lobby = await import(pathToFileURL(chemin).href);

  // ---- les catalogues ----
  dit(String(lobby.ORDRE_MODES) === String(ORDRE_MODES),
    `memes modes des deux cotes : ${ORDRE_MODES.join(' / ')}`);
  dit(String(lobby.PALIERS) === String(PALIERS),
    `memes tables ouvertes : ${PALIERS.join(' / ')} USDG`);

  let formes = 0;
  for (const id of ORDRE_MODES) {
    if (MODES[id].joueurs !== lobby.MODES[id].joueurs) formes++;
    if (String(MODES[id].survivants) !== String(lobby.MODES[id].survivants)) formes++;
    if (MODES[id].rakeBp !== lobby.MODES[id].rakeBp) formes++;
  }
  dit(formes === 0, `memes pyramides : duel ${MODES.duel.survivants} · squad ${MODES.squad.survivants} · arena ${MODES.arena.survivants}`);

  let payables = 0;
  for (const id of ORDRE_MODES) {
    try { verifierRoue(id); lobby.verifierRoue(id); payables++; } catch (e) { console.error(e.message); }
  }
  dit(payables === 3, `les 3 catalogues sont payables des deux cotes (${payables}/3)`);
  dit(ORDRE_MODES.every((id) => ISSUES[id].length === 10 && lobby.ISSUES[id].length === 10),
    'dix issues par mode, des deux cotes');

  // ---- le melangeur, et le tirage qu'il produit ----
  dit(hachage32(1) === 1_753_845_952 && hachage32(42) === 388_445_122
    && hachage32(20260901) === 3_676_312_043,
    'le melangeur rend les entiers poses a la main (memes valeurs qu\'en C#)');

  let melange = 0;
  let tirages = 0;
  for (let g = 0; g < 2000; g++) {
    if (hachage32(g) !== lobby.hachage32(g)) melange++;
    for (const id of ORDRE_MODES) {
      if (tirerIssue(id, g).id !== lobby.tirerIssue(id, g).id) tirages++;
    }
  }
  dit(melange === 0 && tirages === 0,
    `2000 graines x 3 modes : le meme tirage des deux cotes (${melange + tirages} ecart)`);
  // Graines posees a la main, calculees par un script Python independant.
  const TIRAGES = { 0: 'plat', 1: 'standard', 2: 'partage', 3: 'equilibre', 4: 'podium', 7: 'couronne', 25: 'royale', 42: 'standard' };
  dit(Object.entries(TIRAGES).every(([g, v]) => tirerIssue('arena', Number(g)).id === v),
    '8 graines posees a la main donnent les lignes attendues');

  // Les poids annonces sont ceux qui tombent.
  const compte6 = {};
  for (let g = 0; g < 100_000; g++) {
    const id = tirerIssue('arena', g).id;
    compte6[id] = (compte6[id] ?? 0) + 1;
  }
  const menteuses = ISSUES.arena.filter(
    (v) => Math.abs((compte6[v.id] ?? 0) / 10 - v.poids) >= 50);
  dit(menteuses.length === 0,
    `sur 100 000 graines, chaque ligne tombe a son poids annonce (${menteuses.map((v) => v.id).join(', ') || 'aucun ecart'})`);

  // ---- les trente lignes, issue par issue, rang par rang ----
  let ecarts = 0;
  let conservation = 0;
  let comptees = 0;
  for (const id of ORDRE_MODES) {
    for (const v of ISSUES[id]) {
      for (const usdg of PALIERS) {
        const ici = table(usdg * MICROS, id, v.id);
        const la = lobby.table(usdg * MICROS, id, v.id);
        comptees++;
        if (ici.pot !== la.pot || ici.rake !== la.rake) ecarts++;
        for (let r = 0; r < MODES[id].joueurs; r++) {
          if (ici.parRang[r] !== la.parRang[r]) ecarts++;
          if (ici.xp[r] !== la.xp[r]) ecarts++;
        }
        if (ici.parRang.reduce((a, b) => a + b, 0) + ici.rake !== ici.pot) conservation++;
        // Le rake varie avec la ligne — jamais negatif, jamais plus de 30 %.
        if (ici.rake < 0 || ici.rake * 10 > ici.pot * 3) conservation++;
      }
    }
  }
  dit(ecarts === 0, `${comptees} tables (mode x issue x mise) identiques des deux cotes, XP compris (${ecarts} ecart)`);
  dit(conservation === 0, `le pot boucle et la maison ne paie jamais dans les ${comptees} tables (${conservation} rupture)`);
  // ET 10 % EN MOYENNE, exactement : la somme ponderee des rakes vaut le dixieme du pot.
  let moyennes = 0;
  for (const id of ORDRE_MODES) {
    for (const usdg of PALIERS) {
      const pot = usdg * MICROS * MODES[id].joueurs;
      let rake = 0;
      for (const v of ISSUES[id]) rake += table(usdg * MICROS, id, v.id).rake * v.poids;
      if (rake !== pot * 1000) moyennes++;
    }
  }
  dit(moyennes === 0, 'le rake vaut exactement 10 % du pot EN MOYENNE, dans les 9 tables ouvertes');

  // ---- les roues, rang par rang ----
  let roues = 0;
  let cases = 0;
  for (const id of ORDRE_MODES) {
    for (let r = 1; r <= MODES[id].joueurs; r++) {
      const a = roueDe(id, r, 2 * MICROS);
      const b = lobby.roueDe(id, r, 2 * MICROS);
      roues++;
      if (a.grade !== b.grade || grade(id, r) !== lobby.grade(id, r)) cases++;
      for (let i = 0; i < 10; i++) {
        if (a.cases[i].issue !== b.cases[i].issue || a.cases[i].gain !== b.cases[i].gain
          || a.cases[i].xp !== b.cases[i].xp || a.cases[i].poids !== b.cases[i].poids) cases++;
      }
    }
  }
  dit(cases === 0, `${roues} roues (une par rang et par mode) identiques des deux cotes, case par case`);
  const e1 = esperance(2 * MICROS, 'arena');
  const e2 = lobby.esperance(2 * MICROS, 'arena');
  dit(String(e1.parRang) === String(e2.parRang) && e1.parRang[0] === 9_349_000,
    `meme esperance des deux cotes : ${ecrire(e1.parRang[0])} au 1er en arene a 2 USDG`);

  // ---- les montants, poses a la main ----
  const t1 = table(1 * MICROS, 'arena', 'standard');
  dit(t1.rake === 1_600_000 && t1.parRang[0] === 5_000_000 && t1.parRang[1] === 2_500_000
    && t1.parRang[2] === 1_700_000 && t1.parRang[3] === 1_200_000 && t1.parRang[7] === 1_000_000,
    `STANDARD en arene EST la table de reference : ${t1.parRang.slice(0, 4).map(ecrire).join(' / ')}`);

  const ARENE_2 = {   // [1er..4e], bronze a qui la mise est rendue
    plat:      [[5_000_000, 4_400_000, 3_800_000, 3_000_000], 15],
    standard:  [[10_000_000, 5_000_000, 3_400_000, 2_400_000], 0],
    podium:    [[10_200_000, 3_900_000, 2_600_000, 2_300_000], 9],
    royale:    [[13_100_000, 2_600_000, 2_200_000, 2_200_000], 16],
    jackpot:   [[15_800_000, 2_200_000, 2_000_000, 2_000_000], 0],
  };
  let faux = 0;
  for (const [id, [attendu, rembourse]] of Object.entries(ARENE_2)) {
    const t = table(2 * MICROS, 'arena', id);
    for (let r = 0; r < 4; r++) if (t.parRang[r] !== attendu[r]) faux++;
    // La bande 5e-8e vaut AU MOINS la mise sur toutes les lignes : la regle fondatrice.
    for (let r = 4; r < 8; r++) if (t.parRang[r] < 2 * MICROS) faux++;
    for (let r = 8; r < 16; r++) if (t.parRang[r] !== (r + 1 === rembourse ? 2 * MICROS : 0)) faux++;
  }
  dit(faux === 0, `5 lignes d'arene a 2 USDG posees a la main : de ${ecrire(5_000_000)} (FLAT) a ${ecrire(15_800_000)} (JACKPOT) au vainqueur`);

  const duel = table(10 * MICROS, 'duel', 'standard');
  dit(duel.pot === 20_000_000 && duel.rake === 2_000_000
    && duel.parRang[0] === 18_000_000 && duel.parRang[1] === 0,
    `le duel a 10 USDG sur STANDARD : ${ecrire(duel.parRang[0])} au vainqueur (x1,8), rien au perdant`);
  const plat = table(10 * MICROS, 'duel', 'plat');
  dit(plat.parRang[0] === 13_000_000 && plat.parRang[1] === 3_500_000 && plat.rake === 3_500_000,
    `et sur FLAT : ${ecrire(plat.parRang[0])} au vainqueur, ${ecrire(plat.parRang[1])} rendus au perdant, ${ecrire(plat.rake)} a la maison`);
  const jackpot = table(10 * MICROS, 'duel', 'jackpot');
  dit(jackpot.parRang[0] === 20_000_000 && jackpot.rake === 0,
    `et sur JACKPOT : ${ecrire(jackpot.parRang[0])} au vainqueur — tout le pot, rake zero sur cette ligne`);

  // ---- les salons reduits : l'ancienne echelle, intacte ----
  let ecartsN = 0;
  let conservationN = 0;
  for (let n = 3; n <= 24; n++) {
    for (const usdg of PALIERS) {
      const ici = tableEffectif(usdg * MICROS, n);
      const la = lobby.tableEffectif(usdg * MICROS, n);
      if (ici.pot !== la.pot || ici.rake !== la.rake) ecartsN++;
      for (let r = 0; r < n; r++) if (ici.parRang[r] !== la.parRang[r]) ecartsN++;
      if (ici.parRang.reduce((a, b) => a + b, 0) + ici.rake !== ici.pot) conservationN++;
    }
    const c1 = configPour(n);
    const c2 = lobby.configPour(n);
    if (String(c1.survivants) !== String(c2.survivants)) ecartsN++;
  }
  dit(ecartsN === 0, `salons reduits, de 3 a 24 joueurs : 66 tables identiques des deux cotes (${ecartsN} ecart)`);
  dit(conservationN === 0, `l'argent est conserve a tout effectif (${conservationN} rupture)`);

  const parEffectif = tableEffectif(2 * MICROS, 16);
  const parMode = table(2 * MICROS, 'arena', 'standard');
  dit(String(parEffectif.parRang) === String(parMode.parRang),
    'les deux chemins de calcul se rejoignent sur STANDARD a seize');

  let refuse = 0;
  for (const n of [0, 1, 2]) {
    try { configPour(n); } catch { refuse++; }
    try { lobby.configPour(n); } catch { refuse++; }
  }
  dit(refuse === 6, 'un salon reduit a moins de 3 joueurs reste refuse des deux cotes');

  let inconnus = 0;
  for (const essai of [() => table(MICROS, 'squads'), () => table(MICROS, 'squad', 'bonus'),
    () => lobby.table(MICROS, 'squads'), () => lobby.table(MICROS, 'squad', 'bonus')]) {
    try { essai(); } catch { inconnus++; }
  }
  dit(inconnus === 4, 'un mode ou une issue hors catalogue est refuse des deux cotes');
}

// ===========================================================================
titre('7. Les trois modes passent par le grand livre');
// ===========================================================================
/*
 * La section 5 prouve la comptabilite a seize. Celle-ci prouve qu'elle tient aux DEUX
 * autres formes, et surtout au cas qui ne s'invente pas : un salon parti INCOMPLET.
 *
 * Une arene qui part a douze n'a que douze mises dans son pot. La payer au bareme de seize
 * ferait combler l'ecart par la caisse a chaque partie — la maison paierait des gains que
 * personne n'a finances. C'est le trou que le raccordement de l'argent au jeu en ligne
 * rendait atteignable, et ce verdict est la pour qu'il le reste ferme.
 */
{
  /*
   * La GRAINE de roue remplace la variante declaree : graine 1 → STANDARD, graine 7 →
   * COURONNE, graine 25 → ROYALE (calculees a part). Le backend en DERIVE la ligne.
   */
  const table7 = [
    { mode: 'duel',  graineRoue: 1,  issue: 'standard', joueurs: 2,  mise: 2 * MICROS },
    { mode: 'squad', graineRoue: 7,  issue: 'couronne', joueurs: 4,  mise: 5 * MICROS },
    { mode: 'arena', graineRoue: 25, issue: 'royale',   joueurs: 16, mise: 10 * MICROS },
  ];

  for (const cas of table7) {
    const gens = [];
    for (let i = 0; i < cas.joueurs; i++) gens.push(await joueur(db, `${cas.mode}-${i}`));
    for (const g of gens) await doter(db, g, 100 * MICROS);
    const avant = gens.length * 100 * MICROS;
    const rakeAvant = await solde(db, compte.rake);

    const matchId = `mode-${cas.mode}`;
    for (const g of gens) await engager(db, { matchId, userId: g, mise: cas.mise });

    const classement = gens.map((userId, i) => ({ userId, rang: i + 1 }));
    const r = await regler(db, {
      matchId, mise: cas.mise, mode: cas.mode, graineRoue: cas.graineRoue, classement,
    });

    let apres = 0;
    for (const g of gens) apres += await solde(db, compte.joueur(g));
    const rake = (await solde(db, compte.rake)) - rakeAvant;

    dit(apres + rake === avant,
      `${cas.mode} a ${ecrire(cas.mise)} · ${ecrire(apres)} aux joueurs + ${ecrire(rake)} de rake = ${ecrire(avant)}`);
    // Le rake est celui de la LIGNE tiree : ce que le pot n'a pas distribue.
    dit(rake === r.rake && rake === r.pot - r.verse && rake >= 0,
      `${cas.mode} · le rake de la ligne ${cas.issue} vaut ${ecrire(rake)} — ce que le pot n'a pas distribue`);
    dit(await solde(db, compte.pot(matchId)) === 0, `${cas.mode} · le pot est solde a zero`);
    dit(r.pot === cas.mise * cas.joueurs, `${cas.mode} · pot ${ecrire(r.pot)}`);

    if (cas.mode === 'arena') {
      // Le vainqueur d'une ROYALE a 10 USDG touche 65.50 : x6,55 — le 16e a eu sa mise rendue.
      dit(await solde(db, compte.joueur(gens[0])) === 100 * MICROS - 10 * MICROS + 65_500_000,
        `le vainqueur de ROYALE a 10 USDG touche ${ecrire(65_500_000)}`);
      dit(await solde(db, compte.joueur(gens[15])) === 100 * MICROS,
        'et le 16e retrouve sa mise : la ligne ROYALE la lui rend');
    }
  }

  // La graine 25 tombe sur ROYALE : le grand livre garde la graine ET la ligne derivee.
  const champion = (await db.query(
    "select metadata from public.ledger_tx where genre = 'gain' and ref = 'mode-arena'",
  )).rows[0].metadata;
  dit(champion.issue === 'royale' && champion.graineRoue === 25 && champion.effectif === 16,
    `le grand livre garde la trace du tirage : ${champion.mode}/${champion.issue} (graine ${champion.graineRoue}) a ${champion.effectif}`);


  /*
   * UN SALON PARTI INCOMPLET. Douze joueurs sur seize places, avec l'accord de tous : le
   * pot vaut douze mises, et le bareme est celui de douze — pas celui de seize, et sans
   * variante, parce que la roue n'a rien annonce pour cette forme-la.
   */
  {
    const douze = [];
    for (let i = 0; i < 12; i++) douze.push(await joueur(db, `reduit-${i}`));
    for (const g of douze) await doter(db, g, 50 * MICROS);
    const avant = douze.length * 50 * MICROS;
    const rakeAvant = await solde(db, compte.rake);
    const caisseAvant = await solde(db, compte.caisse);

    const matchId = 'arena-reduite';
    for (const g of douze) await engager(db, { matchId, userId: g, mise: 2 * MICROS });
    await regler(db, {
      matchId, mise: 2 * MICROS, mode: 'arena', graineRoue: 25, effectif: 12,
      classement: douze.map((userId, i) => ({ userId, rang: i + 1 })),
    });

    let apres = 0;
    for (const g of douze) apres += await solde(db, compte.joueur(g));
    const rake = (await solde(db, compte.rake)) - rakeAvant;
    dit(apres + rake === avant,
      `arene partie a 12 · ${ecrire(apres)} aux joueurs + ${ecrire(rake)} de rake = ${ecrire(avant)}`);
    dit(rake === 2_400_000, `arene partie a 12 · rake ${ecrire(rake)} = 10 % de 12 mises, pas de 16`);
    // LA VERIFICATION QUI COMPTE : la caisse n'a rien avance. Au bareme de seize, elle
    // aurait comble la difference entre un pot de 24 et des gains calcules sur 32.
    dit((await solde(db, compte.caisse)) === caisseAvant,
      "la caisse n'avance rien : le salon reduit est paye a SON effectif");
    // Rang 1 sur douze au bareme calcule : 4,096775 x 2 = 8,19355 USDG.
    dit(await solde(db, compte.joueur(douze[0])) === 50 * MICROS - 2 * MICROS + 8_193_550,
      `le premier de douze touche ${ecrire(8_193_550)} — le bareme de douze, pose a la main`);
  }

  // Ce que le reglement doit refuser.
  const refus7 = [];
  for (const essai of [
    { mode: 'squad', graineRoue: -1, effectif: 4 },          // graine hors de 32 bits
    { mode: 'nawak', graineRoue: 1, effectif: 4 },           // mode inconnu
    { mode: 'squad', graineRoue: 1, effectif: 9 },           // plus de joueurs que de places
    { mode: 'squad', graineRoue: 1, effectif: 2 },           // salon reduit sous trois
  ]) {
    try {
      await regler(db, {
        matchId: `refus-${refus7.length}`, mise: 2 * MICROS, ...essai,
        classement: [{ userId: 'x', rang: 1 }],
      });
    } catch { refus7.push(essai); }
  }
  dit(refus7.length === 4, `le reglement refuse les 4 combinaisons impossibles (${refus7.length}/4)`);

  const inv7 = await verifierInvariant(db);
  dit(inv7.total === 0, `invariant global apres les trois modes : ${inv7.total}`);
  dit(inv7.desequilibres.length === 0, 'aucun mouvement desequilibre');
}

await pglite.close();
process.exit(bilan() === 0 ? 0 : 1);
