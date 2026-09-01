/**
 * L'adresse de depot d'un joueur, DERIVEE plutot que stockee.
 *
 * Chaque joueur recoit une adresse Solana qui n'appartient qu'a lui. Il y envoie ses
 * USDC ; un guetteur voit l'arrivee, credite le grand livre, puis balaie vers la caisse.
 *
 * Pourquoi une adresse par joueur, et pas les deux autres solutions evidentes :
 *
 *   - « une adresse commune + un memo » : les joueurs oublient le memo. Un depot non
 *     attribuable dans un jeu a mises est un litige garanti, et il arrive des le premier
 *     jour ;
 *   - « on credite selon l'expediteur » : un depot venu d'un exchange a l'exchange pour
 *     expediteur, donc personne. Or c'est exactement de la que viennent les premiers
 *     USDC d'un joueur.
 *
 * L'adresse dediee attribue a coup sur, quelle que soit la provenance.
 *
 * LA CLE PRIVEE N'EST JAMAIS STOCKEE. Elle se recalcule a la demande depuis la graine
 * maitresse et l'identifiant du joueur : il n'y a donc pas de table de cles a proteger,
 * a sauvegarder, ni a fuiter. En contrepartie, `GRAINE_DEPOTS` se garde comme la cle de
 * la caisse — la perdre, c'est perdre l'acces a tous les depots en transit.
 */

import { hkdfSync } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { config } from '../config.js';

/**
 * Derive la paire de cles de depot d'un joueur.
 *
 * HKDF plutot qu'un simple hachage de la concatenation : c'est la fonction faite pour
 * cet usage — etendre un secret unique en plusieurs cles independantes. Le `info`
 * contient l'identifiant du joueur, donc deux joueurs ne peuvent pas tomber sur la meme
 * cle, et connaitre l'une n'aide en rien a retrouver la graine ni les autres.
 *
 * @param {string} userId identifiant Supabase du joueur
 * @returns {Keypair}
 */
export function cleDepot(userId) {
  if (!config.graineDepots) {
    throw new Error('GRAINE_DEPOTS absente : impossible de deriver une adresse de depot');
  }
  if (!userId) throw new Error('cleDepot : identifiant de joueur manquant');

  const graine = hkdfSync(
    'sha256',
    Buffer.from(config.graineDepots, 'utf8'),
    // Le sel est fixe et public : il ne sert pas a cacher, mais a separer cet usage de la
    // graine de tout autre usage qu'on pourrait lui donner un jour.
    Buffer.from('fallguys/depot/v1'),
    Buffer.from(userId, 'utf8'),
    32,
  );
  return Keypair.fromSeed(new Uint8Array(graine));
}

/** L'adresse publique de depot d'un joueur, en base58 — la seule moitie qui sort d'ici. */
export function adresseDepot(userId) {
  return cleDepot(userId).publicKey.toBase58();
}
