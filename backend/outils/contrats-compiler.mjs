/**
 * Recopie l'ABI et le bytecode compiles par Foundry dans `src/robinhood/artefacts.js`.
 *
 *   cd backend/contrats && forge build && cd .. && node outils/contrats-compiler.mjs
 *
 * Le backend n'a pas besoin de Foundry pour tourner : il charge ce fichier, versionne.
 * Ne le modifier qu'en recompilant — un bytecode edite a la main ne correspond plus a la
 * source, et c'est la source qu'on lit pour savoir ce que le contrat fait.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ICI, '..', 'contrats', 'out');
const CIBLE = path.join(ICI, '..', 'src', 'robinhood', 'artefacts.js');

const lire = (fichier, nom) => {
  const j = JSON.parse(readFileSync(path.join(OUT, fichier, `${nom}.json`), 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object };
};
const artefacts = {
  USDCTest: lire('Jetons.sol', 'USDCTest'),
  BabyGuy: lire('Jetons.sol', 'BabyGuy'),
  Lot: lire('Lot.sol', 'Lot'),
};
writeFileSync(CIBLE,
  `/**\n * GENERE par outils/contrats-compiler.mjs depuis contrats/src — ne pas editer a la main.\n * ABI et bytecode des trois contrats du jeu (USDC d'essai, BG, Lot), compiles par Foundry.\n */\nexport const ARTEFACTS = ${JSON.stringify(artefacts, null, 1)};\n`);
for (const [n, a] of Object.entries(artefacts)) console.log(`${n.padEnd(9)} ${a.abi.length} entrees d'ABI · ${(a.bytecode.length - 2) / 2} octets`);
