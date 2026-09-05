/**
 * L'adresse de depot d'un joueur, DERIVEE plutot que stockee.
 *
 * Chaque joueur recoit une adresse Robinhood Chain qui n'appartient qu'a lui. Il y envoie
 * ses USDC ; un guetteur voit l'arrivee et credite le grand livre. Les USDC y RESTENT :
 * c'est son wallet de jeu.
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
 *
 * Un wallet derive n'a JAMAIS d'ETH : il signe des autorisations (EIP-3009), la caisse
 * soumet et paie le gaz. Voir `chaine.js`.
 */

import { hkdfSync } from 'node:crypto';
import { Wallet } from 'ethers';
import { config } from '../config.js';

/**
 * Derive la paire de cles de depot d'un joueur.
 *
 * HKDF plutot qu'un simple hachage de la concatenation : c'est la fonction faite pour
 * cet usage — etendre un secret unique en plusieurs cles independantes. Le `info`
 * contient l'identifiant du joueur, donc deux joueurs ne peuvent pas tomber sur la meme
 * cle, et connaitre l'une n'aide en rien a retrouver la graine ni les autres.
 *
 * Les 32 octets obtenus sont une cle secp256k1 (ethers refuse les rares valeurs hors
 * de l'ordre de la courbe, ce qui n'arrive qu'avec une probabilite de 2^-128 : on
 * prefere une erreur franche a une adresse silencieusement differente).
 *
 * @param {string} userId identifiant Supabase du joueur
 * @returns {Wallet}
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
    // graine de tout autre usage qu'on pourrait lui donner un jour. Il nomme la chaine :
    // les adresses derivees pour une autre chaine ne peuvent pas se confondre avec celles-ci.
    Buffer.from('tumble/robinhood/depot/v1'),
    Buffer.from(userId, 'utf8'),
    32,
  );
  return new Wallet('0x' + Buffer.from(graine).toString('hex'));
}

/** L'adresse publique de depot d'un joueur (0x…, avec sa somme de controle) — la seule moitie qui sort d'ici. */
export function adresseDepot(userId) {
  return cleDepot(userId).address;
}
