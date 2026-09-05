/**
 * LA TRESORERIE — tous les wallets que le service signe, et d'ou vient chacun.
 *
 * L'argent d'une partie bouge SUR LA CHAINE. Il faut donc savoir, a chaque instant, qui
 * detient quoi :
 *
 *   - CHAQUE JOUEUR a son wallet, derive de la graine maitresse et de son identifiant
 *     (`adresses.js`). C'est son adresse de depot ET son compte de jeu : ses USDC y
 *     restent, ses mises en partent, ses gains y reviennent, ses retraits en sortent. On
 *     ne balaie pas vers une caisse commune — un solde qu'on peut relire sur un
 *     explorateur vaut mieux qu'un solde qu'on doit croire ;
 *   - CHAQUE PARTIE a son wallet de POT, derive lui aussi. Les mises y entrent au depart,
 *     le reglement le vide vers les gagnants et vers les frais. Un pot par partie, c'est
 *     un pot qu'on peut montrer : « voila les seize mises, voila ou elles sont allees » ;
 *   - la CAISSE paie le gaz de tout le monde. Un wallet de joueur n'a pas d'ETH et n'en
 *     aura jamais : il SIGNE une autorisation (EIP-3009), la caisse la soumet ;
 *   - les FRAIS recoivent le rake, et le POOL tient la liquidite BG/USDC du brulage.
 *
 * LES CLES DERIVEES NE SONT STOCKEES NULLE PART : elles se recalculent. Les trois cles
 * de tresorerie, elles, vivent dans l'environnement — et dans `wallets/<reseau>.json`,
 * que `outils/tresorerie.mjs` ecrit et que git ignore.
 */

import { hkdfSync } from 'node:crypto';
import { Wallet } from 'ethers';
import { config } from '../config.js';
import { cleDepot } from './adresses.js';

/** Un wallet depuis sa cle secrete en hexadecimal (0x + 64 caracteres). */
export function paireDepuisHex(nom, valeur) {
  if (!valeur) throw new Error(`${nom} absente : lancez « node outils/tresorerie.mjs » puis renseignez le .env`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(valeur)) throw new Error(`${nom} : attendu 0x suivi de 64 caracteres hexadecimaux`);
  return new Wallet(valeur);
}

let _caisse = null;
let _frais = null;
let _pool = null;

export const tresorerie = {
  /** Le payeur de gaz, et le proprietaire des contrats. */
  caisse() { return (_caisse ??= paireDepuisHex('CAISSE_CLE', config.caisseCle)); },
  /** Le receveur du rake. */
  frais() { return (_frais ??= paireDepuisHex('FRAIS_CLE', config.fraisCle)); },
  /** La liquidite BG/USDC. */
  pool() { return (_pool ??= paireDepuisHex('POOL_CLE', config.poolCle)); },

  /** Le wallet d'un joueur — son adresse de depot, son compte de jeu. */
  joueur(userId) { return cleDepot(userId); },

  /**
   * Le wallet du POT d'une partie, derive de la graine maitresse et de l'identifiant de
   * la partie. Le sel differe de celui des joueurs : les deux espaces ne se croisent pas,
   * et connaitre l'un n'apprend rien sur l'autre.
   */
  pot(partie) {
    if (!config.graineDepots) throw new Error('GRAINE_DEPOTS absente : impossible de deriver un pot');
    if (!partie) throw new Error('pot : identifiant de partie manquant');
    const graine = hkdfSync(
      'sha256',
      Buffer.from(config.graineDepots, 'utf8'),
      Buffer.from('tumble/robinhood/pot/v1'),
      Buffer.from(String(partie), 'utf8'),
      32,
    );
    return new Wallet('0x' + Buffer.from(graine).toString('hex'));
  },

  /** Les adresses publiques, pour la page de suivi et les journaux. Jamais une secrete. */
  adresses() {
    const sur = (f) => { try { return f().address; } catch { return null; } };
    return { caisse: sur(this.caisse), frais: sur(this.frais), pool: sur(this.pool) };
  },
};
