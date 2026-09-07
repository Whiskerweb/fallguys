/**
 * LES CONTRATS — leur deploiement, en une fonction, pour que l'outil et le banc fassent pareil.
 *
 * Trois contrats, dans cet ordre, parce que chacun connait le precedent :
 *
 *   1. `Lot`      — l'executeur atomique, dont le proprietaire est la CAISSE ;
 *   2. `USDGTest` — l'USDG d'essai (testnet et anvil SEULEMENT), dont le proprietaire
 *                   est le LOT : la caisse frappe en passant par lui, comme tout le reste ;
 *   3. `BabyGuy`  — un milliard de BG frappes au constructeur vers le POOL. Le contrat
 *                   n'a aucune fonction de frappe : il n'existe aucun instant ou le jeton
 *                   est frappable, et l'offre ne pourra plus jamais que baisser.
 *
 * Reproductible sur mainnet tel quel pour `Lot` et `BabyGuy` : memes octets, seul le RPC
 * change. `USDGTest` n'y est jamais deploye — `USDG_ADRESSE` designe alors le vrai jeton.
 * Il faut un peu d'ETH sur la caisse (quelques centiemes de dollar de gaz au total).
 */

import { ContractFactory } from 'ethers';
import { ARTEFACTS } from './artefacts.js';

export const JETON = {
  nom: 'Baby Guy',
  symbole: 'BG',
  decimales: 6,
  offre: 1_000_000_000,
};

async function deployer(nom, signataire, args) {
  const { abi, bytecode } = ARTEFACTS[nom];
  const fabrique = new ContractFactory(abi, bytecode, signataire);
  const contrat = await fabrique.deploy(...args);
  const recu = await contrat.deploymentTransaction().wait(1);
  return { adresse: await contrat.getAddress(), hache: recu.hash };
}

/**
 * @param {object} p
 * @param {import('ethers').Provider} p.connexion
 * @param {import('ethers').Wallet} p.caisse paie le gaz, devient proprietaire du Lot
 * @param {string} p.pool l'adresse qui recoit toute l'offre de BG
 * @param {{lot?: string, usdg?: string, bg?: string}} [p.existants] ce qui est deja deploye, a ne pas refaire
 * @param {boolean} [p.usdgEssai] deployer l'USDG d'essai (jamais sur mainnet)
 * @returns {Promise<{lot: string, usdg: string|null, bg: string|null, haches: string[]}>}
 * @param {boolean} [p.bg] deployer BabyGuy (faux quand le jeton est cree ailleurs)
 */
export async function deployerContrats({ connexion, caisse, pool, existants = {}, usdgEssai = true, bg: deployerBg = true }) {
  const signataire = caisse.connect(connexion);
  const haches = [];
  let lot = existants.lot ?? null;
  if (!lot) { const r = await deployer('Lot', signataire, [caisse.address]); lot = r.adresse; haches.push(r.hache); }
  let usdg = existants.usdg ?? null;
  if (!usdg && usdgEssai) { const r = await deployer('USDGTest', signataire, [lot]); usdg = r.adresse; haches.push(r.hache); }
  let bg = existants.bg ?? null;
  if (!bg && deployerBg) { const r = await deployer('BabyGuy', signataire, [pool]); bg = r.adresse; haches.push(r.hache); }
  return { lot, usdg, bg, haches };
}
