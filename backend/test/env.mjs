/**
 * L'environnement des tests — pose AVANT que `config.js` ne soit lu.
 *
 * `config.js` lit l'environnement a l'import, et les imports s'evaluent dans l'ordre :
 * ce module est donc le PREMIER import de `aide.mjs`, et rien de ce qu'il pose n'est un
 * secret. Une graine sans valeur, trois wallets deterministes qui ne detiennent rien, un
 * mint BG imaginaire — de quoi deriver des adresses et faire tourner le brulage factice.
 */
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

process.env.GRAINE_DEPOTS ??= 'graine-de-test-sans-valeur';
process.env.SOLANA_RESEAU ??= 'factice';
const cleDeTest = (octet) => bs58.encode(Keypair.fromSeed(Buffer.alloc(32, octet)).secretKey);
process.env.CAISSE_CLE ??= cleDeTest(1);
process.env.FRAIS_CLE ??= cleDeTest(2);
process.env.POOL_CLE ??= cleDeTest(3);
process.env.BG_MINT ??= 'FacticeBG11111111111111111111111111111111111';
