/**
 * Le lien avec Solana : connexion, caisse, comptes de jetons.
 *
 * Rien de metier ici — seulement ce qu'il faut pour parler a la chaine, isole pour que
 * le guetteur de depots et le signataire de retraits n'aient pas chacun leur version.
 */

import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { config, exiger } from '../config.js';

/** USDC a six decimales — la meme echelle que nos micros. La coincidence est heureuse. */
export const DECIMALES_USDC = 6;

let _connexion = null;
export function connexion() {
  if (!_connexion) _connexion = new Connection(config.rpc, 'confirmed');
  return _connexion;
}

export function mint() {
  return new PublicKey(config.mintUsdc);
}

/**
 * La caisse : le wallet maison.
 *
 * Elle detient les USDC de tous les joueurs, paie les retraits, et sert de PAYEUR DE
 * FRAIS pour les balayages de depots. Ce dernier role n'est pas anecdotique : un compte
 * de depot frais n'a pas de SOL, donc ne peut pas payer sa propre transaction. Solana
 * permet qu'un autre compte paie ; sans cela il faudrait approvisionner en SOL chaque
 * adresse de depot avant de pouvoir en sortir quoi que ce soit.
 */
export function caisse() {
  exiger('caisseCle');
  return Keypair.fromSecretKey(bs58.decode(config.caisseCle));
}

/** Le compte de jetons associe (ATA) d'un proprietaire pour l'USDC. */
export function compteJetons(proprietaire) {
  return getAssociatedTokenAddress(mint(), new PublicKey(proprietaire), true);
}

/**
 * Solde USDC d'un compte de jetons, en micros. `0` si le compte n'existe pas encore.
 *
 * Un compte inexistant n'est pas une erreur : c'est l'etat normal d'un joueur qui n'a
 * jamais rien recu.
 */
export async function soldeJetons(adresseAta) {
  try {
    const c = await getAccount(connexion(), new PublicKey(adresseAta));
    return Number(c.amount);
  } catch {
    return 0;
  }
}

/**
 * Envoie des USDC, en creant au besoin le compte de jetons du destinataire.
 *
 * `createTransferChecked` plutot que `createTransfer` : la version « checked » verifie le
 * mint et le nombre de decimales au niveau du programme. Ce n'est pas une precaution
 * theorique — c'est ce qui empeche d'envoyer 25 unites d'un jeton a 9 decimales en
 * croyant en envoyer 25 d'un jeton a 6.
 *
 * @param {object} p
 * @param {Keypair} p.payeur signe et paie les frais
 * @param {Keypair} p.proprietaire signe la sortie des jetons (souvent le meme)
 * @param {string} p.vers adresse du proprietaire destinataire
 * @param {number} p.micros montant en micro-USDC
 * @returns {Promise<string>} signature
 */
export async function envoyer({ payeur, proprietaire, vers, micros }) {
  const co = connexion();
  const m = mint();
  const source = await getAssociatedTokenAddress(m, proprietaire.publicKey, true);
  const destinataire = new PublicKey(vers);
  const cible = await getAssociatedTokenAddress(m, destinataire, true);

  const tx = new Transaction();

  // Le compte de jetons du destinataire n'existe peut-etre pas. Sa creation coute une
  // rente (~0,002 SOL) que le payeur avance ; c'est un cout reel du premier retrait vers
  // un wallet neuf, et l'une des raisons pour lesquelles un retrait minimum a un sens.
  try {
    await getAccount(co, cible);
  } catch {
    tx.add(createAssociatedTokenAccountInstruction(payeur.publicKey, cible, destinataire, m));
  }

  tx.add(createTransferCheckedInstruction(
    source, m, cible, proprietaire.publicKey, micros, DECIMALES_USDC, [], TOKEN_PROGRAM_ID,
  ));

  const signataires = proprietaire.publicKey.equals(payeur.publicKey)
    ? [payeur]
    : [payeur, proprietaire];

  return sendAndConfirmTransaction(co, tx, signataires, {
    commitment: 'confirmed',
    maxRetries: 5,
  });
}
