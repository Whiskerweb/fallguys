/**
 * GENERE LA TRESORERIE — les wallets que le service signe — et les NOTE.
 *
 *   node outils/tresorerie.mjs            # montre ce qui existe, genere ce qui manque
 *   node outils/tresorerie.mjs --ecrire   # et ajoute les cles manquantes au .env de la racine
 *
 * Quatre cles :
 *   CAISSE_CLE       le payeur de frais, l'autorite de creation du jeton
 *   FRAIS_CLE        recoit le rake de chaque partie
 *   POOL_CLE         la liquidite BG/USDC du brulage
 *   SERVEUR_CLE      la cle Ed25519 avec laquelle le serveur de jeu SIGNE les resultats
 *   SERVEUR_PUBLIQUE sa moitie publique, que le backend verifie
 *
 * Les cles existantes dans le .env sont GARDEES : relancer l'outil ne remplace jamais une
 * cle qui detient peut-etre des fonds. Tout est ecrit dans `wallets/<reseau>.json`, que
 * git ignore — c'est la note demandee, avec les secrets, hors du depot.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
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
const reseau = env.SOLANA_RESEAU || 'devnet';
const ecrire = process.argv.includes('--ecrire');

const nouvelles = {};
const wallets = {};

function solana(nomEnv, role) {
  let secrete = env[nomEnv];
  let paire;
  if (secrete) {
    const o = bs58.decode(secrete);
    paire = o.length === 64 ? Keypair.fromSecretKey(o) : Keypair.fromSeed(o);
  } else {
    paire = Keypair.generate();
    secrete = bs58.encode(paire.secretKey);
    nouvelles[nomEnv] = secrete;
  }
  wallets[nomEnv.replace('_CLE', '').toLowerCase()] = {
    role, variable: nomEnv, publique: paire.publicKey.toBase58(), secrete,
    neuve: Boolean(nouvelles[nomEnv]),
  };
}

solana('CAISSE_CLE', 'Caisse : paie les frais et la rente de toutes les transactions ; autorite de creation du jeton BG.');
solana('FRAIS_CLE', 'Frais : recoit le rake (10 % en moyenne) de chaque partie, sur la chaine.');
solana('POOL_CLE', 'Pool : la liquidite BG/USDC. Les frais y achetent des BG, qui sont brules.');

{
  let secrete = env.SERVEUR_CLE;
  let publique;
  if (secrete) publique = publiqueDe(secrete);
  else ({ secrete, publique } = genererCle());
  if (!env.SERVEUR_CLE) { nouvelles.SERVEUR_CLE = secrete; }
  if (env.SERVEUR_PUBLIQUE !== publique) nouvelles.SERVEUR_PUBLIQUE = publique;
  wallets.serveur = {
    role: 'Serveur de jeu : signe les resultats de partie (Ed25519). Pas un wallet Solana, pas de fonds.',
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

const manquantes = Object.entries(nouvelles);
if (manquantes.length) {
  if (ecrire) {
    let bloc = `\n# ---- Tresorerie ${reseau}, generee le ${new Date().toISOString().slice(0, 10)} par backend/outils/tresorerie.mjs ----\n`;
    const contenu = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
    for (const [k, v] of manquantes) {
      if (new RegExp(`^${k}=`, 'm').test(contenu)) {
        // La variable existe mais vide : on la remplit sur place.
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
