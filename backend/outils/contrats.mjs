/**
 * DEPLOIE LES CONTRATS sur le reseau du .env, et note leurs adresses dans le .env.
 *
 *   node outils/contrats.mjs            # montre ce qui existe, deploie ce qui manque
 *   node outils/contrats.mjs --etat     # montre seulement
 *   node outils/contrats.mjs --compiler # recompile d'abord (forge build), puis pareil
 *
 * Trois contrats : Lot (l'executeur atomique), USDGTest (testnet et anvil seulement —
 * sur mainnet, USDG_ADRESSE est le vrai jeton et n'est jamais deploye d'ici), BabyGuy (un
 * milliard, frappe au pool, sans fonction de frappe). Il faut de l'ETH sur la caisse :
 * sur le testnet, https://faucet.testnet.chain.robinhood.com — un geste humain.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Contract, formatEther } from 'ethers';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.resolve(ICI, '..', '..', '.env');

if (process.argv.includes('--compiler')) {
  execFileSync('forge', ['build'], { cwd: path.join(ICI, '..', 'contrats'), stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(ICI, 'contrats-compiler.mjs')], { stdio: 'inherit' });
}

const { config } = await import('../src/config.js');
const { tresorerie } = await import('../src/robinhood/tresorerie.js');
const { RESEAUX } = await import('../src/robinhood/reseaux.js');
const { deployerContrats, JETON } = await import('../src/robinhood/contrats.js');
const { ABI_JETON, ABI_LOT } = await import('../src/robinhood/chaine.js');

const reseau = RESEAUX[config.reseau];
const co = new JsonRpcProvider(config.rpc, config.chainId, { staticNetwork: true, cacheTimeout: -1 });
const caisse = tresorerie.caisse();
const pool = tresorerie.pool();

async function etat() {
  const existe = async (a) => (a ? (await co.getCode(a)) !== '0x' : false);
  console.log(`\nContrats sur ${reseau?.nom ?? config.reseau} (chainId ${config.chainId})`);
  for (const [nom, adresse] of [['Lot', config.lotAdresse], ['USDG', config.usdgAdresse], ['BG', config.bgAdresse]]) {
    console.log(`  ${nom.padEnd(5)} ${adresse ?? '—'}  ${adresse ? ((await existe(adresse)) ? 'deploye' : 'ABSENT SUR LA CHAINE') : 'a deployer'}`);
  }
  if (config.bgAdresse && await existe(config.bgAdresse)) {
    const bg = new Contract(config.bgAdresse, ABI_JETON, co);
    const offre = Number(await bg.totalSupply()) / 10 ** JETON.decimales;
    const auPool = Number(await bg.balanceOf(pool.address)) / 10 ** JETON.decimales;
    console.log(`  offre ${offre.toLocaleString('en-US')} ${JETON.symbole} · pool ${pool.address} detient ${auPool.toLocaleString('en-US')} · aucune fonction de frappe`);
  }
  if (config.lotAdresse && await existe(config.lotAdresse)) {
    const lot = new Contract(config.lotAdresse, ABI_LOT, co);
    console.log(`  Lot   proprietaire ${await lot.proprietaire()} ${(await lot.proprietaire()).toLowerCase() === caisse.address.toLowerCase() ? '(la caisse)' : '(PAS LA CAISSE)'}`);
  }
}

await etat();
if (process.argv.includes('--etat')) process.exit(0);

/*
 * `--sans-bg` : on ne deploie PAS BabyGuy. Decision du directeur produit (7 septembre 2026) :
 * le jeton BG sera cree ailleurs (un lanceur de jetons), et BG_ADRESSE sera renseignee
 * apres coup. Sans BG, le brulage attend et les frais s'accumulent sur le wallet FRAIS.
 */
const sansBg = process.argv.includes('--sans-bg');
const manque = !config.lotAdresse || (!config.bgAdresse && !sansBg) || (!config.usdgAdresse && config.reseau !== 'mainnet');
if (!manque) { console.log('\n  Tout est deploye : rien a faire.\n'); process.exit(0); }
if (config.reseau === 'mainnet' && !config.usdgAdresse) {
  console.error('\n  Sur mainnet, USDG_ADRESSE doit designer le vrai jeton : on ne deploie pas d\'USDG d\'essai.');
  process.exit(1);
}

const eth = Number(formatEther(await co.getBalance(caisse.address)));
console.log(`\n  caisse ${caisse.address} · ${eth.toFixed(5)} ETH`);
if (eth < 0.001) {
  console.error(`  La caisse manque d'ETH pour deployer.${reseau?.faucet ? ` Testnet : ${reseau.faucet} → ${caisse.address}` : ''}`);
  process.exit(1);
}

console.log('  deploiement…');
const r = await deployerContrats({
  connexion: co, caisse, pool: pool.address,
  existants: { lot: config.lotAdresse, usdg: config.usdgAdresse, bg: config.bgAdresse },
  usdgEssai: config.reseau !== 'mainnet', bg: !sansBg,
});
for (const h of r.haches) console.log(`  tx ${h}`);

let contenu = readFileSync(ENV, 'utf8');
const poser = (k, v) => {
  if (!v) return;
  contenu = new RegExp(`^${k}=.*$`, 'm').test(contenu) ? contenu.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : contenu + `\n${k}=${v}`;
};
if (!/# ---- Contrats/.test(contenu)) contenu += `\n# ---- Contrats ${config.reseau}, deployes le ${new Date().toISOString().slice(0, 10)} par backend/outils/contrats.mjs ----\n`;
poser('LOT_ADRESSE', r.lot); poser('USDG_ADRESSE', r.usdg); poser('BG_ADRESSE', r.bg);
writeFileSync(ENV, contenu);
config.lotAdresse = r.lot; config.usdgAdresse = r.usdg; config.bgAdresse = r.bg;
console.log('  LOT_ADRESSE, USDG_ADRESSE, BG_ADRESSE ecrites dans le .env');
await etat();
console.log('');
