/**
 * Verdicts sur les retraits — la partie qui ne touche pas la chaine.
 *
 * On n'envoie rien sur la chaine ici : signer et diffuser demande une caisse approvisionnee
 * et un RPC, donc un environnement. Ce qui se teste sans reseau, c'est tout ce qui decide
 * si un retrait a le droit de partir — et c'est precisement la que se trouvent les regles
 * qui protegent la caisse : destination imposee, minimum, delai, reserve des fonds.
 *
 * Le chemin on-chain, lui, se verifie par `npm run cycle:local` (anvil) et le cycle testnet.
 *
 * Usage : node test/retraits.mjs
 */

import { banc, joueur, doter, dit, refuse, titre, bilan } from './aide.mjs';
import { solde, compte, verifierInvariant } from '../src/livre.js';
import { getAddress } from 'ethers';
import { demander } from '../src/robinhood/retraits.js';


import { MICROS, ecrire } from '../src/argent.js';
import { config } from '../src/config.js';

// Des adresses EVM valides (le retrait refuse tout autre format), sans valeur.
const ADRESSES = {
  WalletDEve: getAddress('0x' + '01'.repeat(20)),
  WalletDeFranck: getAddress('0x' + '02'.repeat(20)),
  WalletDuPauvre: getAddress('0x' + '03'.repeat(20)),
  WalletDuPetit: getAddress('0x' + '04'.repeat(20)),
  WalletDuPresse: getAddress('0x' + '05'.repeat(20)),
};

const { db, pglite } = await banc();

/** Lie un wallet a un joueur, en datant la liaison. */
async function lierWallet(db, userId, adresse, ilYAHeures = 48) {
  await db.query(
    `update public.profiles
        set wallet = $2, wallet_lie_le = now() - make_interval(hours => $3)
      where id = $1`,
    [userId, adresse, ilYAHeures],
  );
}

titre('Ce qui empeche un retrait de partir');
{
  const sansWallet = await joueur(db, 'sans-wallet');
  await doter(db, sansWallet, 100 * MICROS);
  await refuse(
    demander(db, { userId: sansWallet, montant: 30 * MICROS }),
    'sans wallet lie, aucun retrait n\'est possible',
  );

  const petit = await joueur(db, 'petit');
  await doter(db, petit, 100 * MICROS);
  await lierWallet(db, petit, ADRESSES.WalletDuPetit);
  await refuse(
    demander(db, { userId: petit, montant: 5 * MICROS }),
    `sous le minimum de ${ecrire(config.retraitMinimum)} USDC, le retrait est refuse`,
  );

  const pauvre = await joueur(db, 'pauvre');
  await doter(db, pauvre, 30 * MICROS);
  await lierWallet(db, pauvre, ADRESSES.WalletDuPauvre);
  await refuse(
    demander(db, { userId: pauvre, montant: 50 * MICROS }),
    'retirer plus que son solde est refuse',
  );

  // Le verrou anti-bot : compte tout neuf, wallet lie a l'instant.
  const presse = await joueur(db, 'presse');
  await doter(db, presse, 100 * MICROS);
  await lierWallet(db, presse, ADRESSES.WalletDuPresse, 0);
  await refuse(
    demander(db, { userId: presse, montant: 30 * MICROS }),
    `le premier retrait attend ${config.delaiPremierRetraitHeures} h apres la liaison du wallet`,
  );
}

titre('Un retrait recevable reserve les fonds');
{
  const eve = await joueur(db, 'eve');
  await doter(db, eve, 100 * MICROS);
  await lierWallet(db, eve, ADRESSES.WalletDEve);

  const r = await demander(db, { userId: eve, montant: 40 * MICROS });
  dit(r.destination === ADRESSES.WalletDEve,
    'la destination est le wallet LIE, jamais une adresse fournie par l\'appelant');

  const restant = await solde(db, compte.joueur(eve));
  dit(restant === 60 * MICROS,
    `les fonds sont reserves des la demande : ${ecrire(restant)} USDC restants sur 100.00`);
  dit(await solde(db, compte.sortie) === 40 * MICROS,
    'les 40.00 USDC attendent sur le compte de sortie, pas sur celui du joueur');

  /*
   * Le scenario que la reserve empeche : demander un retrait de tout son solde, puis
   * jouer pendant que la transaction se prepare. Sans reserve, la caisse paie deux fois.
   */
  await refuse(
    demander(db, { userId: eve, montant: 70 * MICROS }),
    'on ne peut pas redemander ce qui est deja reserve',
  );

  const inv = await verifierInvariant(db);
  dit(inv.total === 0, `l'invariant tient avec un retrait en attente : somme ${inv.total}`);

  const ligne = (await db.query('select statut, destination from public.withdrawals where id = $1', [r.id])).rows[0];
  dit(ligne.statut === 'demande', `le retrait est en attente d'envoi (statut « ${ligne.statut} »)`);
}

titre('Le deuxieme retrait n\'attend plus');
{
  const franck = await joueur(db, 'franck');
  await doter(db, franck, 200 * MICROS);
  await lierWallet(db, franck, ADRESSES.WalletDeFranck);

  const premier = await demander(db, { userId: franck, montant: 30 * MICROS });
  // On simule sa confirmation on-chain, sans passer par la chaine.
  await db.query(`update public.withdrawals set statut = 'confirme' where id = $1`, [premier.id]);

  // Le wallet vient d'etre relie a l'instant : le delai s'appliquerait a un premier
  // retrait, mais celui-ci n'en est plus un.
  await lierWallet(db, franck, ADRESSES.WalletDeFranck, 0);
  const second = await demander(db, { userId: franck, montant: 30 * MICROS });
  dit(!!second.id, 'un joueur qui a deja retire n\'attend plus le delai');
}

await pglite.close();
process.exit(bilan() === 0 ? 0 : 1);
