/**
 * UNE CHAINE EN MEMOIRE — la doublure de `chaine.js` pour les tests.
 *
 * Meme interface, meme journal en base, memes classes d'erreur ; seuls les jetons sont
 * imaginaires. Ce n'est pas une simplification de complaisance : tout ce que `mises.js`,
 * `regler.js` et `brulage.js` decident — quoi ecrire au grand livre AVANT de toucher la
 * chaine, quoi defaire quand elle refuse, quoi laisser en suspens quand elle ne repond
 * pas — s'exerce ici a l'identique, sans SOL et sans reseau.
 *
 * `panne(operation)` permet de faire echouer une operation choisie, pour verifier que le
 * grand livre est bien rendu a l'etat d'avant. `incertaine(operation)` simule le reseau
 * qui coupe pendant la diffusion : la ligne reste en `signe`, et c'est `reprendre()` —
 * avec `verdicts` — qui tranchera.
 */

import { randomUUID } from 'node:crypto';
import { trier, marquer, ChaineEchouee, ChaineIncertaine, DECIMALES } from './chaine.js';

export function creerChaineFactice({ db, panne = null, incertaine = null, surEvenement = null } = {}) {
  /** `proprietaire|mint` -> micros */
  const soldes = new Map();
  const offres = { bg: 1_000_000_000 * 10 ** DECIMALES.bg, usdc: 0 };
  /** Signatures laissees en suspens par `incertaine`, avec leur sort une fois reprises. */
  const suspens = new Map();

  const cle = (p, m) => `${typeof p === 'string' ? p : p.publicKey.toBase58()}|${m ?? 'usdc'}`;
  const lire = (p, m) => soldes.get(cle(p, m)) ?? 0;
  const ecrire = (p, m, v) => soldes.set(cle(p, m), v);

  return {
    reelle: false,
    reseau: 'factice',
    soldes,

    solde: async (proprietaire, quoi = 'usdc') => lire(proprietaire, quoi),
    offre: async (quoi) => ({ offre: offres[quoi], decimales: DECIMALES[quoi], autoriteFrappe: null }),

    /** Pour poser une situation de depart : des jetons qui tombent du ciel. Tests seulement. */
    doter(proprietaire, quoi, micros) { ecrire(proprietaire, quoi, lire(proprietaire, quoi) + micros); },

    async executer({ operations }) {
      const { lignes, restantes } = await trier(db, operations);
      if (!restantes.length) return { signature: lignes[0].signature, deja: true };
      operations = restantes;
      const ids = lignes.filter((l) => l.statut !== 'confirme').map((l) => l.id);
      const signature = `factice-${randomUUID()}`;
      await marquer(db, ids, 'signe', { signature, blockhash: 'factice' });

      /*
       * La transaction est ATOMIQUE : on la rejoue sur une COPIE des soldes, instruction
       * par instruction — une fermeture de compte voit donc le solde APRES les virements
       * qui la precedent, comme sur la vraie chaine — et on ne garde la copie que si tout
       * a passe.
       */
      const essai = new Map(soldes);
      const lireE = (p, m) => essai.get(cle(p, m)) ?? 0;
      const ecrireE = (p, m, v) => essai.set(cle(p, m), v);
      let brulesBg = 0;
      for (const op of operations) {
        if (panne?.(op)) {
          await marquer(db, ids, 'echoue', { raison: 'panne simulee' });
          throw new ChaineEchouee('panne simulee', { signature });
        }
        const de = op.de ?? op.proprietaire;
        if (op.type === 'virement' || op.type === 'brulage') {
          if (lireE(de, op.mint) < op.montant) {
            await marquer(db, ids, 'echoue', { raison: 'solde insuffisant sur la chaine' });
            throw new ChaineEchouee(`solde insuffisant : ${lireE(de, op.mint)} < ${op.montant}`, { signature });
          }
          ecrireE(de, op.mint, lireE(de, op.mint) - op.montant);
          if (op.type === 'virement') ecrireE(op.vers, op.mint, lireE(op.vers, op.mint) + op.montant);
          else brulesBg += op.montant;
        } else if (op.type === 'fermer_ata') {
          if (lireE(de, op.mint) !== 0) {
            await marquer(db, ids, 'echoue', { raison: 'compte non vide' });
            throw new ChaineEchouee('un compte de jetons ne se ferme que vide', { signature });
          }
        } else {
          throw new Error(`operation inconnue « ${op.type} »`);
        }
      }
      if (incertaine?.(operations)) {
        suspens.set(signature, { operations, ids });
        throw new ChaineIncertaine('reseau coupe (simule)', { signature });
      }
      for (const [k, v] of essai) soldes.set(k, v);
      offres.bg -= brulesBg;
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
            const de = op.de ?? op.proprietaire;
            if (op.type === 'virement') { ecrire(de, op.mint, lire(de, op.mint) - op.montant); ecrire(op.vers, op.mint, lire(op.vers, op.mint) + op.montant); }
          }
          await marquer(db, ids, 'confirme');
          bilan.confirmees += ids.length;
          for (const l of lignes) await gestionnaires.confirme?.(l);
        } else {
          await marquer(db, ids, 'echoue', { raison: 'jamais vue (simule)' });
          bilan.echouees += ids.length;
          for (const l of lignes) await gestionnaires.echoue?.(l);
        }
      }
      return bilan;
    },
  };
}
