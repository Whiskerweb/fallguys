/**
 * LE JETON BG — sa creation, en une fonction, pour que l'outil et le banc fassent pareil.
 *
 * Token-2022, metadonnees SUR LE MINT (nom, symbole, adresse d'image), six decimales
 * comme USDC, un milliard d'unites frappees d'un coup au wallet du POOL, puis l'autorite
 * de frappe REVOQUEE dans la meme transaction : il n'existe aucun instant ou le jeton est
 * frappe mais encore frappable, et l'offre ne pourra plus jamais que baisser.
 *
 * Reproductible sur mainnet tel quel : meme programme, memes instructions, seul le RPC
 * change. Il faut ~0,01 SOL sur la caisse (la rente du mint et du compte du pool).
 */

import {
  Keypair, SystemProgram, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, ExtensionType, getMintLen, LENGTH_SIZE, TYPE_SIZE,
  createInitializeMetadataPointerInstruction, createInitializeMintInstruction,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
  createMintToCheckedInstruction, createSetAuthorityInstruction, AuthorityType,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';

export const JETON = {
  nom: 'Baby Guy',
  symbole: 'BG',
  decimales: 6,
  offre: 1_000_000_000,
  uri: 'https://raw.githubusercontent.com/tumble-game/bg/main/bg.json',
};

/**
 * @param {object} p
 * @param {import('@solana/web3.js').Connection} p.connexion
 * @param {Keypair} p.caisse paie la rente, devient (brievement) l'autorite de frappe
 * @param {Keypair|import('@solana/web3.js').PublicKey} p.pool recoit toute l'offre
 * @returns {Promise<{mint: string, signatures: string[]}>}
 */
export async function creerJeton({ connexion: co, caisse, pool }) {
  const poolPk = pool.publicKey ?? pool;
  const mint = Keypair.generate();
  const metadonnees = {
    mint: mint.publicKey, name: JETON.nom, symbol: JETON.symbole, uri: JETON.uri,
    additionalMetadata: [['jeu', 'Tumble'], ['role', 'rachete avec les frais de chaque partie, puis brule']],
  };
  const tailleMint = getMintLen([ExtensionType.MetadataPointer]);
  const tailleMeta = TYPE_SIZE + LENGTH_SIZE + pack(metadonnees).length;
  const rente = await co.getMinimumBalanceForRentExemption(tailleMint + tailleMeta);

  const tx1 = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: caisse.publicKey, newAccountPubkey: mint.publicKey, space: tailleMint, lamports: rente, programId: TOKEN_2022_PROGRAM_ID,
    }),
    // Le pointeur de metadonnees designe le mint lui-meme : tout tient dans un compte.
    createInitializeMetadataPointerInstruction(mint.publicKey, caisse.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, JETON.decimales, caisse.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID, mint: mint.publicKey, metadata: mint.publicKey,
      name: JETON.nom, symbol: JETON.symbole, uri: JETON.uri,
      mintAuthority: caisse.publicKey, updateAuthority: caisse.publicKey,
    }),
  );
  const s1 = await sendAndConfirmTransaction(co, tx1, [caisse, mint], { commitment: 'confirmed' });

  const ataPool = getAssociatedTokenAddressSync(mint.publicKey, poolPk, true, TOKEN_2022_PROGRAM_ID);
  const offre = BigInt(JETON.offre) * BigInt(10 ** JETON.decimales);
  const tx2 = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(caisse.publicKey, ataPool, poolPk, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createMintToCheckedInstruction(mint.publicKey, ataPool, caisse.publicKey, offre, JETON.decimales, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint.publicKey, caisse.publicKey, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
  );
  const s2 = await sendAndConfirmTransaction(co, tx2, [caisse], { commitment: 'confirmed' });

  return { mint: mint.publicKey.toBase58(), signatures: [s1, s2] };
}
