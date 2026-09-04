/**
 * LE CYCLE COMPLET, SUR UNE VRAIE CHAINE : depot → mise → partie → gain → brulage → retrait.
 *
 *   node outils/cycle.mjs --local     # contre un validateur local (solana-test-validator),
 *                                     # avec un USDC d'essai et un jeton BG crees a la volee
 *   node outils/cycle.mjs             # contre le reseau du .env (devnet) : la caisse doit
 *                                     # avoir du SOL, et les deux joueurs d'essai des USDC
 *
 * Ce n'est PAS un test unitaire : c'est la preuve que les transactions que `chaine.js`
 * construit passent sur Solana — Token-2022, fermeture de compte, lots de virements,
 * brulage atomique. Le grand livre tourne sur PGlite (en memoire), la chaine est REELLE.
 * Chaque signature est imprimee avec son lien d'explorateur.
 *
 * Sur devnet, le SOL vient de https://faucet.solana.com et l'USDC de
 * https://faucet.circle.com (Solana Devnet) : deux gestes humains, que ce script ne peut
 * pas faire. Il dit quoi approvisionner, et attend.
 */

const local = process.argv.includes('--local');
/*
 * Le retrait de demonstration porte quelques USDC, pas les 25 du minimum produit : la regle
 * du minimum est prouvee par `test/retraits.mjs`, ce script prouve que la TRANSACTION passe.
 * Ces deux variables ne touchent que ce processus.
 */
process.env.RETRAIT_MINIMUM_MICROS = '1000000';
process.env.DELAI_PREMIER_RETRAIT_HEURES = '0';
if (local) {
  process.env.SOLANA_RPC = 'http://127.0.0.1:8899';
  process.env.SOLANA_RESEAU = 'local';
  // Sur un validateur local, USDC et BG n'existent pas encore : on les cree plus bas, et
  // les variables doivent etre posees AVANT que `config.js` ne soit lu.
  process.env.USDC_MINT = process.env.USDC_MINT_LOCAL ?? '11111111111111111111111111111111';
  process.env.BG_MINT = process.env.BG_MINT_LOCAL ?? '11111111111111111111111111111111';
}

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createMint, mintTo, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';

/*
 * L'ORDRE DES IMPORTS EST LE POINT. `config.js` lit l'environnement une fois, a l'import ;
 * `test/aide.mjs` pose des cles DE TEST pour tout ce qui manque. On veut ici les VRAIES
 * cles du .env (chargees par config.js) et nos reglages locaux : donc config d'abord, le
 * banc ensuite — en imports dynamiques, parce qu'un import statique serait hisse avant
 * les lignes qui precedent.
 */
const { config } = await import('../src/config.js');
const { banc, joueur, doter } = await import('../test/aide.mjs');
const { tresorerie } = await import('../src/solana/tresorerie.js');
const chaineMod = await import('../src/solana/chaine.js');
const { creerJeton } = await import('../src/solana/jeton.js');
const { engagerPartie, regler } = await import('../src/match/regler.js');
const { racheterEtBruler, etatMarche } = await import('../src/solana/brulage.js');
const { verifierChaine } = await import('../src/solana/reconciliation.js');
const { demander, executer } = await import('../src/solana/retraits.js');
const { solde, compte, poster, verifierInvariant } = await import('../src/livre.js');
const { MICROS, ecrire } = await import('../src/argent.js');
const { table } = await import('../src/gains.js');

const co = new Connection(config.rpc, 'confirmed');
const caisse = tresorerie.caisse();
const frais = tresorerie.frais();
const pool = tresorerie.pool();
const lien = (s) => chaineMod.lienExplorateur(s);
const dit = (t) => console.log(`  ${t}`);
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

titre(`Cycle sur ${config.reseau} (${config.rpc})`);
dit(`caisse ${caisse.publicKey.toBase58()}`);
dit(`frais  ${frais.publicKey.toBase58()}`);
dit(`pool   ${pool.publicKey.toBase58()}`);

// ---------------------------------------------------------------- le SOL
let sol = await co.getBalance(caisse.publicKey);
if (local && sol < 2 * LAMPORTS_PER_SOL) {
  const sig = await co.requestAirdrop(caisse.publicKey, 5 * LAMPORTS_PER_SOL);
  await co.confirmTransaction(sig, 'confirmed');
  sol = await co.getBalance(caisse.publicKey);
}
dit(`SOL de la caisse : ${(sol / LAMPORTS_PER_SOL).toFixed(4)}`);
if (sol < 0.05 * LAMPORTS_PER_SOL) {
  console.error('\n  La caisse manque de SOL. devnet : https://faucet.solana.com → ' + caisse.publicKey.toBase58());
  process.exit(1);
}

// ---------------------------------------------------------------- USDC et BG
if (local) {
  // Un « USDC » d'essai : six decimales, la caisse en est l'autorite. Le mint est
  // configurable precisement pour cela.
  const mintUsdc = await createMint(co, caisse, caisse.publicKey, null, 6, undefined, { commitment: 'confirmed' }, TOKEN_PROGRAM_ID);
  config.mintUsdc = mintUsdc.toBase58();
  dit(`USDC d'essai cree : ${config.mintUsdc}`);
  const { mint } = await creerJeton({ connexion: co, caisse, pool });
  config.mintBg = mint;
  dit(`BG cree : ${mint} (1 000 000 000, frappe revoquee)`);
}
if (!config.mintBg) { console.error('\n  BG_MINT absent : node outils/jeton.mjs'); process.exit(1); }

const { db, pglite } = await banc();
const evenements = [];
const chaine = chaineMod.creerChaine({ db, surEvenement: (e) => evenements.push(e) });

// ---------------------------------------------------------------- les joueurs
/*
 * Sur devnet, les deux joueurs d'essai ont des identifiants FIXES : leurs wallets derives
 * ne changent donc pas d'une execution a l'autre, et l'USDC qu'on y envoie (faucet Circle)
 * sert a toutes les suivantes. En local, peu importe.
 */
const alice = await joueur(db, 'alice', local ? undefined : '00000000-0000-4000-8000-00000000a11c');
const bob = await joueur(db, 'bob', local ? undefined : '00000000-0000-4000-8000-0000000000b0');
const wallet = (id) => tresorerie.joueur(id).publicKey.toBase58();

async function approvisionner(proprietaire, usdc) {
  if (local) {
    const ata = await getOrCreateAssociatedTokenAccount(co, caisse, new PublicKey(config.mintUsdc), new PublicKey(proprietaire), true, 'confirmed', undefined, TOKEN_PROGRAM_ID);
    await mintTo(co, caisse, new PublicKey(config.mintUsdc), ata.address, caisse, usdc * MICROS, [], { commitment: 'confirmed' }, TOKEN_PROGRAM_ID);
  }
  return chaine.solde(proprietaire, 'usdc');
}

titre('1. Depots');
const manques = [];
for (const [nom, id] of [['alice', alice], ['bob', bob]]) {
  const sur = await approvisionner(wallet(id), 10);
  if (sur < 2 * MICROS) { manques.push(`${nom.padEnd(6)} ${wallet(id)}  (${ecrire(sur)} USDC, il en faut 2)`); continue; }
  // Le livre suit la chaine : ce que le guetteur ferait en voyant le depot.
  await doter(db, id, sur);
  dit(`${nom} ${wallet(id)} · ${ecrire(sur)} USDC sur la chaine, credites au livre`);
}
const poolUsdc = await approvisionner(pool.publicKey.toBase58(), 100);
if (poolUsdc <= 0) manques.push(`pool   ${pool.publicKey.toBase58()}  (0 USDC : sans USDC le pool n'a pas de prix et ne brule rien)`);
if (manques.length) {
  console.error('\n  Il manque des USDC. Sur devnet : https://faucet.circle.com (Solana Devnet), vers :');
  for (const m of manques) console.error(`    ${m}`);
  console.error('');
  process.exit(1);
}
if (poolUsdc > 0) {
  await db.transaction((tx) => poster(tx, { genre: 'dotation', ref: `pool:${Date.now()}`, lignes: [{ compte: compte.entree, montant: -poolUsdc }, { compte: compte.pool, montant: poolUsdc }] }));
}
dit(`pool : ${ecrire(poolUsdc)} USDC · ${((await chaine.solde(pool.publicKey.toBase58(), 'bg')) / MICROS).toLocaleString('en-US')} BG`);

titre('2. Un duel a 2 USDC : les mises partent vers le pot');
const partie = `cycle-${Date.now().toString(36)}`;
const eng = await engagerPartie(db, chaine, { partie, mode: 'duel', mise: 2 * MICROS, joueurs: [{ userId: alice, nom: 'alice' }, { userId: bob, nom: 'bob' }] });
if (eng.annulee) { console.error('  ANNULEE :', JSON.stringify(eng.refuses)); process.exit(1); }
dit(`pot ${eng.adressePot} · ${ecrire(await chaine.solde(eng.adressePot))} USDC`);
for (const [id, sig] of Object.entries(eng.signatures)) dit(`mise ${id === alice ? 'alice' : 'bob'} → ${lien(sig)}`);

titre('3. Le reglement : le pot est vide vers le vainqueur et les frais, puis ferme');
const graineRoue = Math.floor(Math.random() * 0x1_0000_0000);
const r = await regler(db, { matchId: partie, mise: 2 * MICROS, mode: 'duel', graineRoue, effectif: 2, classement: [{ userId: alice, rang: 1 }, { userId: bob, rang: 2 }] }, chaine);
const bareme = table(2 * MICROS, 'duel', r.issue);
dit(`ligne ${r.issue} (graine ${graineRoue}) · alice touche ${ecrire(bareme.parRang[0])}, bob ${ecrire(bareme.parRang[1])}, frais ${ecrire(bareme.rake)}`);
for (const sig of r.signatures) dit(`reglement → ${lien(sig)}`);
dit(`alice sur la chaine : ${ecrire(await chaine.solde(wallet(alice)))} · au livre : ${ecrire(await solde(db, compte.joueur(alice)))}`);
dit(`pot sur la chaine : ${ecrire(await chaine.solde(eng.adressePot))} · frais : ${ecrire(await chaine.solde(frais.publicKey.toBase58()))}`);

titre('4. Livre ↔ chaine');
const v = await verifierChaine(db, chaine);
dit(`${v.verifies} comptes verifies · ${v.ecarts.length} ecart ${v.ok ? '' : JSON.stringify(v.ecarts)}`);
const inv = await verifierInvariant(db);
dit(`invariant du livre : ${inv.total} (attendu 0)`);

titre('5. Le brulage : les frais achetent des BG au pool et les brulent');
const marcheAvant = await etatMarche(chaine);
const b = await racheterEtBruler(db, chaine, { seuil: 1 });
if (!b || b.statut !== 'brule') { dit(`pas de brulage : ${JSON.stringify(b)}`); }
else {
  dit(`${ecrire(b.usdc)} USDC → ${(b.bg / MICROS).toFixed(6)} BG achetes et brules → ${lien(b.signature)}`);
  const marche = await etatMarche(chaine);
  dit(`offre : ${(marcheAvant.offre / MICROS).toLocaleString('en-US')} → ${(marche.offre / MICROS).toLocaleString('en-US')} BG`);
  dit(`prix : 1 USDC achete ${(marcheAvant.bgParUsdc / MICROS).toLocaleString('en-US')} → ${(marche.bgParUsdc / MICROS).toLocaleString('en-US')} BG`);
}

titre('6. Un retrait : du wallet de jeu d\'alice vers un wallet externe');
const externe = Keypair.generate().publicKey.toBase58();
await db.query(`update public.profiles set wallet = $2, wallet_lie_le = now() - interval '2 days' where id = $1`, [alice, externe]);
const dem = await demander(db, { userId: alice, montant: Math.min(await solde(db, compte.joueur(alice)), 5 * MICROS) });
const ex = await executer(db, chaine, dem.id);
dit(`${ecrire(dem.montant)} USDC → ${externe} · ${ex.statut} → ${ex.signature ? lien(ex.signature) : '—'}`);
dit(`externe sur la chaine : ${ecrire(await chaine.solde(externe))}`);

titre('7. Livre ↔ chaine, a la fin');
const v2 = await verifierChaine(db, chaine);
dit(`${v2.verifies} comptes verifies · ${v2.ecarts.length} ecart ${v2.ok ? '' : JSON.stringify(v2.ecarts)}`);
dit(`${evenements.length} transactions confirmees pendant le cycle`);

await pglite.close();
console.log(`\n${v.ok && v2.ok && inv.total === 0 ? 'CYCLE COMPLET' : 'CYCLE AVEC ECARTS'}\n`);
process.exit(v.ok && v2.ok ? 0 : 1);
