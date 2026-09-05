/**
 * LE PONT VERS L'ARGENT — ce que le serveur de jeu dit au backend, et comment il le prouve.
 *
 * Le serveur de jeu ne connait aucun solde et ne signe aucune transaction sur la chaine
 * (spec § 6.3). Mais il est le SEUL a savoir qui a pris le depart et qui a fini ou. Il le dit
 * donc au backend, en trois moments :
 *
 *   1. AVANT le depart : « voici les joueurs de ce salon, engagez leurs mises ». Le
 *      backend les fait partir sur la chaine et repond qui est engage — ou que la partie
 *      est annulee parce qu'une mise n'est pas partie. Sans cette reponse, la partie NE
 *      DEMARRE PAS : personne ne joue pour rien ;
 *   2. A LA FIN : le classement, le mode, la mise, l'effectif et la graine de roue. Le
 *      backend en derive la ligne du tableau, paie, et rend ce que chacun a touche ;
 *   3. avant d'accepter quelqu'un en file payante : « a-t-il de quoi ? ».
 *
 * CHAQUE MESSAGE EST SIGNE avec `SERVEUR_CLE` (Ed25519). Le backend n'accepte rien d'autre.
 * C'est ce qui ferme le trou n° 1 de la liste d'avant-mainnet : le navigateur ne peut plus
 * declarer un rang, et un message intercepte ne se rejoue pas (horodatage signe).
 *
 * SANS `BACKEND_URL`, le pont est ABSENT et il n'y a pas d'argent : les files payantes
 * sont fermees par `politique.js`. Un banc n'a pas de backend et n'en a pas besoin.
 */

import { sceller } from './signature.js';

const URL_BACKEND = process.env.BACKEND_URL ?? '';
const CLE = process.env.SERVEUR_CLE ?? '';

export class RefusBackend extends Error {
  constructor(code, message, statut) { super(message); this.code = code; this.statut = statut; }
}

/**
 * @returns {null | {engager: Function, regler: Function, annuler: Function, soldes: Function, ping: Function, url: string}}
 */
export function creerPont({ url = URL_BACKEND, cle = CLE, fetchFn = fetch } = {}) {
  if (!url) return null;
  if (!cle) throw new Error('BACKEND_URL est renseignee mais SERVEUR_CLE manque : le backend refusera tout');
  const base = url.replace(/\/$/, '');

  async function appeler(chemin, corps, { delai = 60_000 } = {}) {
    const message = sceller(corps, cle);
    let r;
    try {
      r = await fetchFn(`${base}${chemin}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(delai),
      });
    } catch (e) {
      throw new RefusBackend('BACKEND_INJOIGNABLE', `backend injoignable : ${e.message}`, 0);
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new RefusBackend(data.erreur ?? 'BACKEND_ERREUR', data.message ?? r.statusText, r.status);
    return data;
  }

  return {
    url: base,
    /** Verifie au demarrage que la cle du serveur est bien celle que le backend attend. */
    ping: () => appeler('/interne/ping', { quoi: 'ping' }, { delai: 8000 }),
    soldes: (userIds) => appeler('/interne/soldes', { quoi: 'soldes', userIds }, { delai: 8000 }),
    /**
     * @param {{partie: string, mode: string, mise: number, joueurs: Array<{userId: string, nom: string}>}} p
     * @returns {Promise<{annulee: boolean, engages: string[], refuses: Array<{userId: string, nom: string, raison: string}>}>}
     */
    engager: (p) => appeler('/interne/partie/engager', { quoi: 'engager', ...p }, { delai: 90_000 }),
    /**
     * @param {{partie: string, mode: string, mise: number, effectif: number, graineRoue: number, classement: Array<{userId: string, nom: string, rang: number}>}} p
     * @returns {Promise<{gains: Record<string, number>, xp: Record<string, number>, issue: string|null, signatures: string[]}>}
     */
    regler: (p) => appeler('/interne/partie/regler', { quoi: 'regler', ...p }, { delai: 120_000 }),
    annuler: (partie, raison) => appeler('/interne/partie/annuler', { quoi: 'annuler', partie, raison }),
  };
}
