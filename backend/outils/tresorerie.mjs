/**
 * GENERE LA TRESORERIE — les wallets que le service signe — et les NOTE.
 *
 *   node outils/tresorerie.mjs            # montre ce qui existe, genere ce qui manque
 *   node outils/tresorerie.mjs --ecrire   # et ajoute les cles manquantes au .env de la racine
 *   node outils/tresorerie.mjs --reseau mainnet --nouvelles
 *                                         # une tresorerie NEUVE pour un autre reseau, notee dans
 *                                         # wallets/mainnet.json et NULLE PART AILLEURS : les cles du
 *                                         # testnet ne servent jamais sur mainnet, et le .env ne
 *                                         # bascule que le jour du passage (README, « Passer en mainnet »)
 *
 * Quatre cles :
 *   CAISSE_CLE       le payeur de gaz, le proprietaire des contrats (Lot, USDC d'essai)
 *   FRAIS_CLE        recoit le rake de chaque partie
 *   POOL_CLE         la liquidite BG/USDC du brulage — recoit toute l'offre de BG
 *   SERVEUR_CLE      la cle Ed25519 avec laquelle le serveur de jeu SIGNE les resultats
 *   SERVEUR_PUBLIQUE sa moitie publique, que le backend verifie
 *
 * Les trois premieres sont des cles secp256k1 (0x + 64 hexadecimaux), les memes que
 * n'importe quel wallet EVM. Les cles existantes dans le .env sont GARDEES : relancer
 * l'outil ne remplace jamais une cle qui detient peut-etre des fonds. Tout est ecrit dans
 * `wallets/<reseau>.json`, que git ignore — c'est la note demandee, avec les secrets,
 * hors du depot.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';
import { genererCle, publiqueDe } from '../src/signature.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..', '..');
const ENV = path.join(RACINE, '.env');
const DOSSIER = path.join(ICI, '..', 'wallets');

/** Lit le .env sans l'exporter : on ne veut que les valeurs, pas un shell. */
function lireEnv() {
  const valeurs = {};
  if (!existsSync(ENV)) return valeurs;
  for (const ligne of readFileSync(ENV, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(ligne.trim());
    if (m) valeurs[m[1]] = m[2];
  }
  return valeurs;
}

const env = lireEnv();
const argReseau = process.argv.indexOf('--reseau');
const reseau = argReseau >= 0 ? process.argv[argReseau + 1] : (env.ROBINHOOD_RESEAU || 'testnet');
const nouvelles_ = process.argv.includes('--nouvelles');
const ecrire = process.argv.includes('--ecrire') && !nouvelles_;
if (nouvelles_ && argReseau < 0) { console.error('--nouvelles demande --reseau <nom> : on ne regenere pas la tresorerie du reseau courant par accident'); process.exit(1); }

const nouvelles = {};
const wallets = {};

function evm(nomEnv, role) {
  let secrete = nouvelles_ ? null : env[nomEnv];
  let w;
  if (secrete && /^0x[0-9a-fA-F]{64}$/.test(secrete)) {
    w = new Wallet(secrete);
  } else {
    // Absente, ou d'un autre format (une cle de l'ancienne chaine) : on en genere une neuve.
    w = Wallet.createRandom();
    secrete = w.privateKey;
    nouvelles[nomEnv] = secrete;
  }
  wallets[nomEnv.replace('_CLE', '').toLowerCase()] = {
    role, variable: nomEnv, publique: w.address, secrete,
    neuve: Boolean(nouvelles[nomEnv]),
  };
}

evm('CAISSE_CLE', 'Caisse : paie le gaz de toutes les transactions ; proprietaire du Lot et de l\'USDC d\'essai. A alimenter en ETH.');
evm('FRAIS_CLE', 'Frais : recoit le rake (10 % en moyenne) de chaque partie, sur la chaine.');
evm('POOL_CLE', 'Pool : la liquidite BG/USDC. Recoit le milliard de BG ; les frais y achetent des BG, qui sont brules.');

{
  // La cle du serveur de jeu ne detient rien : elle reste la meme d'un reseau a l'autre.
  let secrete = env.SERVEUR_CLE;
  let publique;
  if (secrete) publique = publiqueDe(secrete);
  else ({ secrete, publique } = genererCle());
  if (!env.SERVEUR_CLE) { nouvelles.SERVEUR_CLE = secrete; }
  if (env.SERVEUR_PUBLIQUE !== publique) nouvelles.SERVEUR_PUBLIQUE = publique;
  wallets.serveur = {
    role: 'Serveur de jeu : signe les resultats de partie (Ed25519). Pas un wallet, pas de fonds.',
    variable: 'SERVEUR_CLE', publique, secrete, neuve: !env.SERVEUR_CLE,
  };
}

mkdirSync(DOSSIER, { recursive: true });
const fichier = path.join(DOSSIER, `${reseau}.json`);
const note = {
  reseau,
  avertissement: 'CLES SECRETES. Ce fichier est ignore par git. Sur mainnet, ces cles vont dans un KMS, pas ici.',
  ecrit_le: new Date().toISOString(),
  graine_depots: env.GRAINE_DEPOTS ? '(dans le .env : GRAINE_DEPOTS — les wallets des joueurs et des pots en derivent)' : '(ABSENTE du .env)',
  wallets,
};
writeFileSync(fichier, JSON.stringify(note, null, 2));

console.log(`\nTresorerie ${reseau}\n`);
for (const [nom, w] of Object.entries(wallets)) {
  console.log(`  ${nom.padEnd(8)} ${w.publique}  ${w.neuve ? '(NEUVE)' : '(existante)'}`);
  console.log(`           ${w.role}`);
}
console.log(`\n  Note complete (avec les secrets) : ${path.relative(RACINE, fichier)}`);
if (nouvelles_) {
  console.log(`\n  Tresorerie ${reseau} NEUVE, notee dans ${path.relative(RACINE, fichier)} seulement. Le .env n'a pas bouge :`);
  console.log(`  au jour du passage, recopier CAISSE_CLE, FRAIS_CLE, POOL_CLE depuis ce fichier (README, « Passer en mainnet »).\n`);
  process.exit(0);
}

const manquantes = Object.entries(nouvelles);
if (manquantes.length) {
  if (ecrire) {
    let bloc = `\n# ---- Tresorerie ${reseau}, generee le ${new Date().toISOString().slice(0, 10)} par backend/outils/tresorerie.mjs ----\n`;
    const contenu = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
    for (const [k, v] of manquantes) {
      if (new RegExp(`^${k}=`, 'm').test(contenu)) {
        // La variable existe (vide, ou d'un autre format) : on la remplace sur place.
        writeFileSync(ENV, readFileSync(ENV, 'utf8').replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`));
      } else {
        bloc += `${k}=${v}\n`;
      }
    }
    if (bloc.split('\n').length > 2) writeFileSync(ENV, readFileSync(ENV, 'utf8') + bloc);
    console.log(`  Ecrit dans .env : ${manquantes.map(([k]) => k).join(', ')}`);
  } else {
    console.log(`\n  Variables a ajouter au .env (ou relancer avec --ecrire) : ${manquantes.map(([k]) => k).join(', ')}`);
  }
} else {
  console.log('  Le .env est complet.');
}
console.log('');
