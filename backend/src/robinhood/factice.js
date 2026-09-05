/**
 * UNE CHAINE EN MEMOIRE — la doublure de `chaine.js` pour les tests.
 *
 * Meme interface, meme journal en base, memes classes d'erreur ; seuls les jetons sont
 * imaginaires. Ce n'est pas une simplification de complaisance : tout ce que `regler.js`,
 * `brulage.js` et `retraits.js` decident — quoi ecrire au grand livre AVANT de toucher la
 * chaine, quoi defaire quand elle refuse, quoi laisser en suspens quand elle ne repond
 * pas — s'exerce ici a l'identique, sans ETH et sans reseau.
 *
 * `panne(operation)` fait echouer un lot qui contient l'operation choisie — comme le
 * contrat Lot, qui annule TOUT si un appel echoue, et dit lequel (`index`). `incertaine(
 * operations)` simule le reseau qui coupe pendant la diffusion : la ligne reste en
 * `signe`, et c'est `reprendre()` — avec `verdicts` — qui tranchera.
 */

import { randomUUID } from 'node:crypto';
import { trier, marquer, ChaineEchouee, ChaineIncertaine, DECIMALES } from './chaine.js';

export function creerChaineFactice({ db, panne = null, incertaine = null, surEvenement = null } = {}) {
  /** `proprietaire|mint` -> micros */
  const soldes = new Map();
  const offres = { bg: 1_000_000_000 * 10 ** DECIMALES.bg, usdc: 0 };
  /** Haches laisses en suspens par `incertaine`, avec leur sort une fois repris. */
  const suspens = new Map();

  const cle = (p, m) => `${(typeof p === 'string' ? p : p.address).toLowerCase()}|${m ?? 'usdc'}`;
  const lire = (p, m) => soldes.get(cle(p, m)) ?? 0;
  const ecrire = (p, m, v) => soldes.set(cle(p, m), v);

  return {
    reelle: false,
    reseau: 'factice',
    soldes,

    solde: async (proprietaire, quoi = 'usdc') => lire(proprietaire, quoi),
    offre: async (quoi) => ({ offre: offres[quoi], decimales: DECIMALES[quoi], frappable: quoi === 'usdc' }),

    /** Pour poser une situation de depart : des jetons qui tombent du ciel. Tests seulement. */
    doter(proprietaire, quoi, micros) { ecrire(proprietaire, quoi, lire(proprietaire, quoi) + micros); if (quoi === 'usdc') offres.usdc += micros; },

    async executer({ operations }) {
      const { lignes, restantes } = await trier(db, operations);
      if (!restantes.length) return { signature: lignes[0].signature, deja: true };
      operations = restantes;
      const ids = lignes.filter((l) => l.statut !== 'confirme').map((l) => l.id);
      const signature = `0xfactice${randomUUID().replace(/-/g, '')}`;

      /*
       * Le LOT est ATOMIQUE : on le rejoue sur une COPIE des soldes, appel par appel, et on
       * ne garde la copie que si tout a passe. Une panne ou un solde insuffisant annulent
       * le lot ENTIER avant qu'il soit signe — c'est ce que fait la simulation sur la
       * vraie chaine — et l'index de l'appel fautif est rendu.
       */
      const essai = new Map(soldes);
      const lireE = (p, m) => essai.get(cle(p, m)) ?? 0;
      const ecrireE = (p, m, v) => essai.set(cle(p, m), v);
      let brulesBg = 0;
      let frappesUsdc = 0;
      for (let index = 0; index < operations.length; index++) {
        const op = operations[index];
        if (panne?.(op)) {
          await marquer(db, ids, 'echoue', { raison: `appel ${index} refuse : panne simulee` });
          throw new ChaineEchouee(`appel ${index} refuse : panne simulee`, { index });
        }
        const de = op.de;
        if (op.type === 'virement' || op.type === 'brulage') {
          if (lireE(de, op.mint) < op.montant) {
            await marquer(db, ids, 'echoue', { raison: `appel ${index} refuse : solde insuffisant` });
            throw new ChaineEchouee(`appel ${index} refuse : solde insuffisant (${lireE(de, op.mint)} < ${op.montant})`, { index });
          }
          ecrireE(de, op.mint, lireE(de, op.mint) - op.montant);
          if (op.type === 'virement') ecrireE(op.vers, op.mint, lireE(op.vers, op.mint) + op.montant);
          else brulesBg += op.montant;
        } else if (op.type === 'frappe') {
          ecrireE(op.vers, 'usdc', lireE(op.vers, 'usdc') + op.montant);
          frappesUsdc += op.montant;
        } else {
          throw new Error(`operation inconnue « ${op.type} »`);
        }
      }
      await marquer(db, ids, 'signe', { signature, nonce: suspens.size + soldes.size });
      if (incertaine?.(operations)) {
        suspens.set(signature, { operations, ids });
        throw new ChaineIncertaine('reseau coupe (simule)', { signature });
      }
      for (const [k, v] of essai) soldes.set(k, v);
      offres.bg -= brulesBg;
      offres.usdc += frappesUsdc;
      await marquer(db, ids, 'confirme');
      surEvenement?.({ signature, operations: operations.map((o) => ({ objet: o.objet, ref: o.ref, montant: o.montant, mint: o.mint ?? 'usdc' })) });
      return { signature, deja: false };
    },

    /**
     * Les transactions laissees en suspens sont tranchees par `verdicts[signature]` :
     * `'confirme'` (elle etait passee) ou `'echoue'` (elle ne passera jamais).
     */
    async reprendre(gestionnaires = {}, verdicts = {}) {
      const bilan = { confirmees: 0, echouees: 0, enAttente: 0 };
      for (const [signature, { operations, ids }] of [...suspens]) {
        const sort = verdicts[signature];
        if (!sort) { bilan.enAttente += ids.length; continue; }
        suspens.delete(signature);
        const lignes = (await db.query(`select * from public.chain_tx where id = any($1::uuid[])`, [ids])).rows;
        if (sort === 'confirme') {
          for (const op of operations) {
            const de = op.de;
            if (op.type === 'virement') { ecrire(de, op.mint, lire(de, op.mint) - op.montant); ecrire(op.vers, op.mint, lire(op.vers, op.mint) + op.montant); }
            if (op.type === 'brulage') { ecrire(de, op.mint, lire(de, op.mint) - op.montant); offres.bg -= op.montant; }
          }
          await marquer(db, ids, 'confirme');
          bilan.confirmees += ids.length;
          for (const l of lignes) await gestionnaires.confirme?.(l);
        } else {
          await marquer(db, ids, 'echoue', { raison: 'jamais minee (simule)' });
          bilan.echouees += ids.length;
          for (const l of lignes) await gestionnaires.echoue?.(l);
        }
      }
      return bilan;
    },
  };
}
