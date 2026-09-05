/**
 * LE CYCLE COMPLET, SUR UNE VRAIE CHAINE : depot → mise → partie → gain → brulage → retrait.
 *
 *   node outils/cycle.mjs --local     # contre anvil (Foundry), lance par ce script : les
 *                                     # trois contrats sont deployes a la volee
 *   node outils/cycle.mjs             # contre le reseau du .env (testnet) : la caisse doit
 *                                     # avoir de l'ETH, les contrats etre deployes
 *
 * Ce n'est PAS un test unitaire : c'est la preuve que les transactions que `chaine.js`
 * construit passent sur une chaine EVM — autorisations EIP-3009 signees par des wallets
 * sans ETH, lots atomiques, brulage. Le grand livre tourne sur PGlite (en memoire), la
 * chaine est REELLE. Chaque hache est imprime avec son lien d'explorateur.
 *
 * Sur le testnet, l'ETH de la caisse vient de https://faucet.testnet.chain.robinhood.com
 * — un geste humain, que ce script ne peut pas faire. L'USDC, lui, est le notre : le
 * script en frappe pour les joueurs d'essai et le pool.
 */

import { spawn } from 'node:child_process';

const local = process.argv.includes('--local');
/*
 * Le retrait de demonstration porte quelques USDC, pas les 25 du minimum produit : la regle
 * du minimum est prouvee par `test/retraits.mjs`, ce script prouve que la TRANSACTION passe.
 * Ces deux variables ne touchent que ce processus.
 */
process.env.RETRAIT_MINIMUM_MICROS = '1000000';
process.env.DELAI_PREMIER_RETRAIT_HEURES = '0';
let anvil = null;
if (local) {
  process.env.ROBINHOOD_RESEAU = 'local';
  process.env.ROBINHOOD_RPC = 'http://127.0.0.1:8545';
  process.env.ROBINHOOD_CHAIN_ID = '31337';
  // Sur anvil, rien n'existe encore : les contrats sont deployes plus bas, et les
  // variables doivent etre posees AVANT que `config.js` ne soit lu.
  process.env.USDC_ADRESSE = ''; process.env.BG_ADRESSE = ''; process.env.LOT_ADRESSE = '';
  // Une tresorerie DE BANC, deterministe et sans valeur : jamais les cles du .env sur anvil.
  const cleDeTest = (octet) => '0x' + Buffer.alloc(32, octet).toString('hex');
  process.env.CAISSE_CLE = cleDeTest(0x11); process.env.FRAIS_CLE = cleDeTest(0x22); process.env.POOL_CLE = cleDeTest(0x33);
  process.env.GRAINE_DEPOTS ||= 'graine-de-banc-anvil';
  anvil = spawn('anvil', ['--port', '8545', '--chain-id', '31337', '--silent'], { stdio: 'ignore' });
  process.on('exit', () => anvil?.kill());
  await new Promise((r) => setTimeout(r, 1200));
}

import { JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';

/*
 * L'ORDRE DES IMPORTS EST LE POINT. `config.js` lit l'environnement une fois, a l'import ;
 * `test/aide.mjs` pose des cles DE TEST pour tout ce qui manque. On veut ici les VRAIES
 * cles du .env (chargees par config.js) et nos reglages locaux : donc config d'abord, le
 * banc ensuite — en imports dynamiques, parce qu'un import statique serait hisse avant
 * les lignes qui precedent.
 */
const { config } = await import('../src/config.js');
const { banc, joueur, doter } = await import('../test/aide.mjs');
const { tresorerie } = await import('../src/robinhood/tresorerie.js');
const chaineMod = await import('../src/robinhood/chaine.js');
const { deployerContrats } = await import('../src/robinhood/contrats.js');
const { engagerPartie, regler } = await import('../src/match/regler.js');
const { racheterEtBruler, etatMarche } = await import('../src/robinhood/brulage.js');
const { verifierChaine } = await import('../src/robinhood/reconciliation.js');
const { demander, executer } = await import('../src/robinhood/retraits.js');
const { releverDepots } = await import('../src/robinhood/guetteur.js');
const { solde, compte, poster, verifierInvariant } = await import('../src/livre.js');
const { MICROS, ecrire } = await import('../src/argent.js');
const { table } = await import('../src/gains.js');

const co = new JsonRpcProvider(config.rpc, config.chainId, { staticNetwork: true, cacheTimeout: -1 });
const caisse = tresorerie.caisse();
const frais = tresorerie.frais();
const pool = tresorerie.pool();
const lien = (s) => chaineMod.lienExplorateur(s) ?? s;
const dit = (t) => console.log(`  ${t}`);
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const fin = (code) => { anvil?.kill(); process.exit(code); };

titre(`Cycle sur ${config.reseau} (${config.rpc}, chainId ${config.chainId})`);
dit(`caisse ${caisse.address}`);
dit(`frais  ${frais.address}`);
dit(`pool   ${pool.address}`);

// ---------------------------------------------------------------- l'ETH
if (local) await co.send('anvil_setBalance', [caisse.address, '0x' + parseEther('10').toString(16)]);
const eth = Number(formatEther(await co.getBalance(caisse.address)));
dit(`ETH de la caisse : ${eth.toFixed(5)}`);
if (eth < 0.001) {
  console.error('\n  La caisse manque d\'ETH. Testnet : https://faucet.testnet.chain.robinhood.com → ' + caisse.address);
  fin(1);
}

// ---------------------------------------------------------------- les contrats
if (local) {
  const r = await deployerContrats({ connexion: co, caisse, pool: pool.address, usdcEssai: true });
  config.lotAdresse = r.lot; config.usdcAdresse = r.usdc; config.bgAdresse = r.bg;
  dit(`Lot ${r.lot} · USDC d'essai ${r.usdc} · BG ${r.bg} (1 000 000 000 au pool, sans frappe)`);
}
if (!config.bgAdresse || !config.lotAdresse || !config.usdcAdresse) { console.error('\n  contrats absents : node outils/contrats.mjs'); fin(1); }

const { db, pglite } = await banc();
const evenements = [];
const chaine = chaineMod.creerChaine({ db, surEvenement: (e) => evenements.push(e) });

// ---------------------------------------------------------------- les joueurs
/*
 * Les deux joueurs d'essai ont des identifiants FIXES : leurs wallets derives ne changent
 * donc pas d'une execution a l'autre, et l'USDC frappe dessus sert aux suivantes.
 */
const alice = await joueur(db, 'alice', '00000000-0000-4000-8000-00000000a11c');
const bob = await joueur(db, 'bob', '00000000-0000-4000-8000-0000000000b0');
const wallet = (id) => tresorerie.joueur(id).address;

titre('1. Depots : le robinet frappe des USDC d\'essai, le guetteur les credite');
for (const [nom, id] of [['alice', alice], ['bob', bob]]) {
  const avant = await chaine.solde(wallet(id));
  if (avant < 10 * MICROS) {
    const r = await chaine.executer({ operations: [{ type: 'frappe', vers: wallet(id), mint: 'usdc', montant: 10 * MICROS, objet: 'robinet', ref: `${id}:${Date.now()}` }] });
    dit(`frappe 10.00 USDC pour ${nom} → ${lien(r.signature)}`);
  }
  const vus = await releverDepots(db, { userId: id, adresse: wallet(id) });
  const sur = await chaine.solde(wallet(id));
  // Le guetteur ne voit que ce qui est sur la chaine dans sa fenetre ; le solde anterieur
  // (executions precedentes sur le testnet) est dote au livre comme un depot ancien.
  const credite = await solde(db, compte.joueur(id));
  if (credite < sur) await doter(db, id, sur - credite);
  dit(`${nom} ${wallet(id)} · ${ecrire(sur)} USDC sur la chaine (${vus.length} depot(s) vus par le guetteur), credites au livre`);
}
let poolUsdc = await chaine.solde(pool.address, 'usdc');
if (poolUsdc < 100 * MICROS) {
  const r = await chaine.executer({ operations: [{ type: 'frappe', vers: pool.address, mint: 'usdc', montant: 100 * MICROS, objet: 'robinet', ref: `pool:${Date.now()}` }] });
  dit(`frappe 100.00 USDC pour le pool → ${lien(r.signature)}`);
  poolUsdc = await chaine.solde(pool.address, 'usdc');
}
await db.transaction((tx) => poster(tx, { genre: 'dotation', ref: `pool:${Date.now()}`, lignes: [{ compte: compte.entree, montant: -poolUsdc }, { compte: compte.pool, montant: poolUsdc }] }));
dit(`pool : ${ecrire(poolUsdc)} USDC · ${((await chaine.solde(pool.address, 'bg')) / MICROS).toLocaleString('en-US')} BG`);

titre('2. Un duel a 2 USDC : les deux mises partent vers le pot, en UNE transaction');
const partie = `cycle-${Date.now().toString(36)}`;
const eng = await engagerPartie(db, chaine, { partie, mode: 'duel', mise: 2 * MICROS, joueurs: [{ userId: alice, nom: 'alice' }, { userId: bob, nom: 'bob' }] });
if (eng.annulee) { console.error('  ANNULEE :', JSON.stringify(eng.refuses)); fin(1); }
dit(`pot ${eng.adressePot} · ${ecrire(await chaine.solde(eng.adressePot))} USDC`);
dit(`mises → ${lien(eng.signatures[alice])}`);

titre('3. Le reglement : le pot est vide vers le vainqueur et les frais');
const graineRoue = Math.floor(Math.random() * 0x1_0000_0000);
const r = await regler(db, { matchId: partie, mise: 2 * MICROS, mode: 'duel', graineRoue, effectif: 2, classement: [{ userId: alice, rang: 1 }, { userId: bob, rang: 2 }] }, chaine);
const bareme = table(2 * MICROS, 'duel', r.issue);
dit(`ligne ${r.issue} (graine ${graineRoue}) · alice touche ${ecrire(bareme.parRang[0])}, bob ${ecrire(bareme.parRang[1])}, frais ${ecrire(bareme.rake)}`);
for (const sig of r.signatures) dit(`reglement → ${lien(sig)}`);
dit(`alice sur la chaine : ${ecrire(await chaine.solde(wallet(alice)))} · au livre : ${ecrire(await solde(db, compte.joueur(alice)))}`);
dit(`pot sur la chaine : ${ecrire(await chaine.solde(eng.adressePot))} · frais : ${ecrire(await chaine.solde(frais.address))}`);

titre('4. Livre ↔ chaine');
const v = await verifierChaine(db, chaine);
dit(`${v.verifies} comptes verifies · ${v.ecarts.length} ecart ${v.ok ? '' : JSON.stringify(v.ecarts)}`);
const inv = await verifierInvariant(db);
dit(`invariant du livre : ${inv.total} (attendu 0)`);

titre('5. Le brulage : les frais achetent des BG au pool, brules depuis le pool');
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
const externe = Wallet.createRandom().address;
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
fin(v.ok && v2.ok ? 0 : 1);
