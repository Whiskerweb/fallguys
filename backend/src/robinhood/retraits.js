/**
 * LES RETRAITS — le seul endroit du systeme ou un bug se solde par un double paiement.
 *
 * Tout le reste se rattrape : un depot manque se relit, un classement faux se corrige, un
 * pot mal solde se voit dans l'invariant. Un virement envoye deux fois, non. Ce fichier
 * est donc ecrit pour cette seule crainte.
 *
 * Trois regles, dans l'ordre ou elles comptent :
 *
 *   1. ON DEBITE AVANT D'ENVOYER. Si l'on envoyait d'abord, un arret entre l'envoi et le
 *      debit laisserait le joueur paye ET credite. Dans l'autre sens, un arret laisse
 *      l'argent immobilise mais jamais perdu — et une reprise le retrouve.
 *
 *   2. ON ENREGISTRE LE HACHE AVANT DE DIFFUSER. Le hache d'une transaction est connu des
 *      qu'elle est signee, avant meme d'etre envoyee. On l'ecrit donc en base d'abord.
 *      Sans cela, un arret au mauvais moment laisse une transaction peut-etre partie, dont
 *      on ne connait pas le nom — et rien ne permet plus de savoir si elle a abouti.
 *
 *   3. ON NE RE-SIGNE JAMAIS SANS AVOIR RELU LA CHAINE. Et pas seulement « la transaction
 *      a-t-elle un recu ? » : sans recu, elle peut encore etre minee tant que son nonce
 *      n'est pas consomme. C'est `chaine.js:reprendre` qui tranche, et lui seul.
 */

import { randomUUID } from 'node:crypto';
import { isAddress } from 'ethers';
import { poster, compte, solde, verrouillerJoueur, mouvementExistant } from '../livre.js';
import { config } from '../config.js';
import { tresorerie } from './tresorerie.js';
import { ChaineEchouee, ChaineIncertaine } from './chaine.js';
import { ecrire } from '../argent.js';

/**
 * Enregistre une demande de retrait, et RESERVE les fonds immediatement.
 *
 * Le debit a lieu ici, pas a l'envoi : entre la demande et la diffusion, le joueur ne doit
 * plus pouvoir miser cet argent. Sans cette reserve, il demande un retrait de tout son
 * solde, joue une partie pendant que la transaction se prepare, et la caisse paie deux fois.
 */
export async function demander(db, { userId, montant }) {
  return db.transaction(async (tx) => {
    await verrouillerJoueur(tx, userId);

    const p = (await tx.query(
      `select wallet, wallet_lie_le from public.profiles where id = $1`, [userId],
    )).rows[0];
    if (!p) throw refus('COMPTE_INCONNU', 'compte introuvable');

    /*
     * La destination est TOUJOURS le wallet lie, jamais une adresse fournie par
     * l'appelant. C'est la protection la plus efficace du fichier : un compte vole ne
     * peut pas rediriger les fonds, parce qu'il n'y a aucun parametre a detourner.
     */
    if (!p.wallet) throw refus('WALLET_ABSENT', 'aucun wallet lie a ce compte');
    if (!isAddress(p.wallet)) throw refus('WALLET_INVALIDE', 'le wallet lie n\'est pas une adresse Robinhood Chain');

    if (montant < config.retraitMinimum) {
      throw refus('SOUS_LE_MINIMUM',
        `retrait minimum ${ecrire(config.retraitMinimum)} USDG`);
    }

    /*
     * Delai sur le PREMIER retrait, compte depuis la liaison du wallet.
     *
     * Ancre sur la liaison et non sur la creation du compte, ce qui donne au passage une
     * seconde propriete : changer d'adresse de paiement fait repartir le delai. Un compte
     * vole dont l'attaquant relie son propre wallet doit donc attendre un jour avant de
     * pouvoir sortir quoi que ce soit — le temps que le proprietaire s'en apercoive.
     */
    const dejaRetire = (await tx.query(
      `select 1 from public.withdrawals where user_id = $1 and statut = 'confirme' limit 1`,
      [userId],
    )).rows.length > 0;

    if (!dejaRetire) {
      const pret = (await tx.query(
        `select ($1::timestamptz + make_interval(hours => $2)) <= now() as pret`,
        [p.wallet_lie_le, config.delaiPremierRetraitHeures],
      )).rows[0]?.pret;
      if (!pret) {
        throw refus('DELAI_PREMIER_RETRAIT',
          `le premier retrait s'ouvre ${config.delaiPremierRetraitHeures} h apres la liaison du wallet`);
      }
    }

    const disponible = await solde(tx, compte.joueur(userId));
    if (disponible < montant) {
      throw refus('SOLDE_INSUFFISANT',
        `solde ${ecrire(disponible)} USDG, demande ${ecrire(montant)} USDG`);
    }

    const id = randomUUID();
    const mvt = await poster(tx, {
      genre: 'retrait',
      ref: id,
      metadata: { userId, destination: p.wallet, reseau: config.reseau },
      lignes: [
        { compte: compte.joueur(userId), montant: -montant },
        { compte: compte.sortie, montant: +montant },
      ],
    });

    await tx.query(
      `insert into public.withdrawals (id, user_id, amount_micros, destination, statut, tx_id)
       values ($1, $2, $3, $4, 'demande', $5)`,
      [id, userId, montant, p.wallet, mvt.id],
    );

    return { id, montant, destination: p.wallet, solde: disponible - montant };
  });
}

/**
 * Envoie un retrait demande, DEPUIS LE WALLET DU JOUEUR.
 *
 * Les USDG d'un joueur sont sur son propre wallet derive, pas sur la caisse : c'est donc
 * sa cle — recalculee a la demande — qui signe l'autorisation de sortie, et la caisse ne
 * fait que soumettre et payer le gaz. Sur l'explorateur, le retrait se lit « du wallet de
 * jeu du joueur vers le wallet qu'il a lie », ce qui est exactement ce qui se passe.
 *
 * Tout le reste — hache ecrit avant diffusion, reprise sans re-signature, echec definitif
 * contre echec ambigu — est tenu par `chaine.js`, pour tous les objets et pas seulement
 * les retraits. Ce fichier ne garde que ce qui lui est propre : la machine a etats de
 * `withdrawals`, et le remboursement.
 *
 * @returns {Promise<{id: string, statut: string, signature?: string}>}
 */
export async function executer(db, chaine, id) {
  const r = (await db.query('select * from public.withdrawals where id = $1', [id])).rows[0];
  if (!r) throw refus('RETRAIT_INCONNU', 'retrait introuvable');
  if (r.statut === 'confirme') return { id, statut: 'confirme', signature: r.signature };
  if (r.statut === 'echoue') return { id, statut: 'echoue' };

  const joueur = tresorerie.joueur(r.user_id);
  try {
    const res = await chaine.executer({
      operations: [{
        type: 'virement', de: joueur, vers: r.destination, mint: 'usdg', montant: Number(r.amount_micros),
        objet: 'retrait', ref: id, userId: r.user_id,
      }],
    });
    await db.query(
      `update public.withdrawals set statut = 'confirme', signature = $2, soumis_le = coalesce(soumis_le, now()), clos_le = now() where id = $1`,
      [id, res.signature],
    );
    return { id, statut: 'confirme', signature: res.signature };
  } catch (e) {
    if (e instanceof ChaineEchouee) {
      // Rien n'est parti, c'est certain : on rend au joueur.
      await rembourserRetrait(db, id, `transaction refusee : ${e.message}`);
      return { id, statut: 'echoue' };
    }
    if (e instanceof ChaineIncertaine) {
      /*
       * Peut-etre partie. On ne rembourse PAS : le retrait reste « soumis », et c'est
       * `rattraperChaine` qui tranchera en relisant la chaine. Rembourser sur un doute,
       * c'est payer deux fois.
       */
      await db.query(
        `update public.withdrawals set statut = 'soumis', signature = $2, soumis_le = coalesce(soumis_le, now()) where id = $1`,
        [id, e.signature ?? null],
      );
      return { id, statut: 'soumis', signature: e.signature, erreur: e.message };
    }
    throw e;
  }
}

export async function clore(db, id, statut) {
  await db.query(
    `update public.withdrawals set statut = $2, clos_le = now() where id = $1 and statut <> $2`, [id, statut],
  );
}

/** Annule un retrait et rend l'argent : le mouvement inverse, jamais une suppression. */
export async function rembourserRetrait(db, id, raison) {
  const r = (await db.query('select * from public.withdrawals where id = $1', [id])).rows[0];
  if (!r || r.statut === 'confirme') return;
  await db.transaction(async (tx) => {
    if (await mouvementExistant(tx, 'retrait_echoue', r.id)) return;
    await poster(tx, {
      genre: 'retrait_echoue',
      ref: r.id,
      metadata: { raison, signature: r.signature },
      lignes: [
        { compte: compte.sortie, montant: -Number(r.amount_micros) },
        { compte: compte.joueur(r.user_id), montant: +Number(r.amount_micros) },
      ],
    });
    await tx.query(
      `update public.withdrawals set statut = 'echoue', raison_echec = $2, clos_le = now() where id = $1`,
      [r.id, raison],
    );
  });
}

function refus(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
