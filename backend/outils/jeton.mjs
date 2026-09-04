import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getMint, getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { creerJeton, JETON } from '../src/solana/jeton.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.resolve(ICI, '..', '..', '.env');

function env() {
  const v = {};
  for (const l of readFileSync(ENV, 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) v[m[1]] = m[2]; }
  return v;
}
const e = env();
const rpc = process.env.SOLANA_RPC || e.SOLANA_RPC || 'https://api.devnet.solana.com';
const reseau = process.env.SOLANA_RESEAU || e.SOLANA_RESEAU || 'devnet';
const co = new Connection(rpc, 'confirmed');

const paire = (s) => { const o = bs58.decode(s); return o.length === 64 ? Keypair.fromSecretKey(o) : Keypair.fromSeed(o); };
const caisse = paire(process.env.CAISSE_CLE || e.CAISSE_CLE);
const pool = paire(process.env.POOL_CLE || e.POOL_CLE);

async function etat(mint) {
  const m = await getMint(co, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  console.log(`  mint      ${mint.toBase58()}`);
  console.log(`  offre     ${(Number(m.supply) / 10 ** m.decimals).toLocaleString('en-US')} ${JETON.symbole}`);
  console.log(`  frappe    ${m.mintAuthority ? m.mintAuthority.toBase58() + ' (NON revoquee)' : 'revoquee — l\'offre ne peut que baisser'}`);
  const ata = getAssociatedTokenAddressSync(mint, pool.publicKey, true, TOKEN_2022_PROGRAM_ID);
  try {
    const c = await getAccount(co, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
    console.log(`  pool      ${pool.publicKey.toBase58()} detient ${(Number(c.amount) / 10 ** m.decimals).toLocaleString('en-US')} ${JETON.symbole}`);
  } catch { console.log('  pool      aucun compte BG'); }
}

const existant = process.env.BG_MINT || e.BG_MINT;
if (process.argv.includes('--etat') || existant) {
  if (!existant) { console.log('BG_MINT absent : rien a montrer.'); process.exit(0); }
  console.log(`\nJeton ${JETON.nom} sur ${reseau}`);
  await etat(new PublicKey(existant));
  if (!process.argv.includes('--forcer')) {
    console.log('\n  BG_MINT existe deja : on ne cree pas un second jeton. (--forcer pour passer outre)\n');
    process.exit(0);
  }
}

const sol = await co.getBalance(caisse.publicKey);
if (sol < 0.01e9) {
  console.error(`La caisse ${caisse.publicKey.toBase58()} n'a que ${sol / 1e9} SOL ; il en faut ~0,01 pour creer le jeton.`);
  console.error('  devnet : https://faucet.solana.com  ·  ou « solana airdrop 1 <adresse> --url devnet »');
  process.exit(1);
}

console.log(`\nCreation du jeton ${JETON.nom} (${JETON.symbole}) sur ${reseau}…`);
const { mint: adresseMint, signatures } = await creerJeton({ connexion: co, caisse, pool });
const mint = { publicKey: new PublicKey(adresseMint) };
console.log(`  mint cree      ${adresseMint}  (${signatures[0]})`);
console.log(`  1 000 000 000 ${JETON.symbole} frappes au pool, frappe revoquee  (${signatures[1]})`);

const contenu = readFileSync(ENV, 'utf8');
writeFileSync(ENV, /^BG_MINT=.*$/m.test(contenu)
  ? contenu.replace(/^BG_MINT=.*$/m, `BG_MINT=${mint.publicKey.toBase58()}`)
  : contenu + `\n# Le jeton BG, cree le ${new Date().toISOString().slice(0, 10)} par backend/outils/jeton.mjs\nBG_MINT=${mint.publicKey.toBase58()}\n`);
console.log('  BG_MINT ecrit dans le .env\n');
await etat(mint.publicKey);
console.log('');
