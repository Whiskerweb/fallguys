/**
 * Verdicts sur LA CHAINE — ce que devnet fera, prouve ici sans SOL ni reseau.
 *
 * `factice.js` offre la meme interface que la vraie chaine (journal en base compris), et
 * les modules du domaine — `regler.js`, `brulage.js`, `retraits.js` — ne savent pas
 * laquelle des deux ils tiennent. Ce qu'on prouve ici, c'est donc bien le CHEMIN qu'ils
 * prennent : livre d'abord, chaine ensuite, et ce qu'ils defont quand elle refuse.
 *
 * Usage : node test/chaine.mjs
 */

import { banc, joueur, doter, dit, refuse, titre, bilan } from './aide.mjs';
import { solde, compte, verifierInvariant } from '../src/livre.js';
import { engagerPartie, regler, payerSurChaine, annulerPartie, rattraperChaine } from '../src/match/regler.js';
import { creerChaineFactice } from '../src/solana/factice.js';
import { tresorerie } from '../src/solana/tresorerie.js';
import { verifierChaine } from '../src/solana/reconciliation.js';
import { racheterEtBruler, prixAchat, etatMarche } from '../src/solana/brulage.js';
import { demander, executer } from '../src/solana/retraits.js';
import { genererCle, sceller, ouvrir, canonique, signer, verifier } from '../src/signature.js';
import { table } from '../src/gains.js';
import { MICROS, ecrire } from '../src/argent.js';

const { db, pglite } = await banc();
const adresse = (userId) => tresorerie.joueur(userId).publicKey.toBase58();
const frais = tresorerie.frais().publicKey.toBase58();
const pool = tresorerie.pool().publicKey.toBase58();

/** Un joueur dote au livre ET sur la chaine, comme apres un vrai depot. */
async function joueurDote(chaine, nom, usdc) {
  const id = await joueur(db, nom);
  await doter(db, id, usdc * MICROS);
  chaine.doter(adresse(id), 'usdc', usdc * MICROS);
  return id;
}

// ===========================================================================
titre('1. Un resultat non signe ne vaut rien');
// ===========================================================================
{
  const serveur = genererCle();
  const autre = genererCle();
  dit(serveur.publique.length >= 43 && serveur.secrete !== serveur.publique, 'une paire Ed25519 se genere sans dependance');

  const corps = { quoi: 'regler', partie: 'p1', mode: 'duel', mise: 2 * MICROS, graineRoue: 7, classement: [{ userId: 'a', rang: 1 }, { userId: 'b', rang: 2 }] };
  const scelle = sceller(corps, serveur.secrete);
  dit(ouvrir(scelle, serveur.publique).ok === true, 'un message scelle par le serveur s\'ouvre avec sa cle publique');
  dit(ouvrir(scelle, autre.publique).ok === false, 'et pas avec une autre cle');

  const trafique = { ...scelle, corps: { ...scelle.corps, graineRoue: 8 } };
  dit(ouvrir(trafique, serveur.publique).raison === 'SIGNATURE_INVALIDE', 'changer la graine de roue apres signature invalide le message');
  const rang = { ...scelle, corps: { ...scelle.corps, classement: [{ userId: 'b', rang: 1 }, { userId: 'a', rang: 2 }] } };
  dit(ouvrir(rang, serveur.publique).raison === 'SIGNATURE_INVALIDE', 'inverser le classement aussi');

  const vieux = sceller(corps, serveur.secrete);
  vieux.corps.horodatage = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  vieux.signature = signer(vieux.corps, serveur.secrete);
  dit(ouvrir(vieux, serveur.publique).raison === 'MESSAGE_PERIME', 'un message de six minutes est perime : on ne rejoue pas un reglement');

  dit(canonique({ b: 1, a: [3, { d: 1, c: 2 }] }) === '{"a":[3,{"c":2,"d":1}],"b":1}', 'la forme canonique trie les cles a tous les niveaux');
  dit(verifier({ a: 1, b: 2 }, signer({ b: 2, a: 1 }, serveur.secrete), serveur.publique), 'l\'ordre des proprietes ne change pas la signature');
  dit(ouvrir({ corps: 'x', signature: 5 }, serveur.publique).ok === false, 'un message illisible est refuse sans jeter');
}

// ===========================================================================
titre('2. Une partie complete, sur la chaine');
// ===========================================================================
/*
 * UNE SEULE chaine pour tout le fichier — la reconciliation compare TOUS les comptes du
 * livre a la chaine, donc deux chaines en memoire se contrediraient. Les pannes et les
 * coupures se declenchent par ces deux crochets, poses et retires par chaque section.
 */
let couper = null;
let panne = null;
const chaine = creerChaineFactice({
  db,
  incertaine: (ops) => Boolean(couper) && ops.some((o) => o.ref === couper),
  panne: (op) => Boolean(panne?.(op)),
});
{
  const gens = [];
  for (let i = 0; i < 4; i++) gens.push(await joueurDote(chaine, `sq${i}`, 20));
  const partie = 'squad-0001';
  const r = await engagerPartie(db, chaine, { partie, mode: 'squad', mise: 2 * MICROS, joueurs: gens.map((userId, i) => ({ userId, nom: `sq${i}` })) });
  dit(r.annulee === false && r.engages.length === 4, 'quatre mises engagees, partie confirmee');
  dit(Object.keys(r.signatures).length === 4, 'une transaction par joueur, une signature chacune');
  const potAdr = tresorerie.pot(partie).publicKey.toBase58();
  dit(await chaine.solde(potAdr) === 8 * MICROS, `le pot detient ${ecrire(8 * MICROS)} USDC sur la chaine`);
  dit(await chaine.solde(adresse(gens[0])) === 18 * MICROS && await solde(db, compte.joueur(gens[0])) === 18 * MICROS,
    'chaque joueur a 18.00 au livre ET sur la chaine');
  const m = (await db.query(`select statut, adresse_pot, effectif from public.matches where id = $1`, [partie])).rows[0];
  dit(m.statut === 'engagee' && m.adresse_pot === potAdr && m.effectif === 4, 'la partie est « engagee », son pot connu');

  const inv = await verifierInvariant(db);
  dit(inv.total === 0 && inv.potsNonSoldes.length === 0, 'une partie engagee ne passe pas pour un pot mal solde');

  const graineRoue = 7;   // COURONNE en squad
  const reglee = await regler(db, {
    matchId: partie, mise: 2 * MICROS, mode: 'squad', graineRoue, effectif: 4,
    classement: gens.map((userId, i) => ({ userId, rang: i + 1 })),
  }, chaine);
  const bareme = table(2 * MICROS, 'squad', 'couronne');
  dit(reglee.deja === false && reglee.soldee === true, 'la partie est reglee et payee sur la chaine');
  dit(reglee.signatures.length === 1, 'les virements du reglement tiennent dans UNE transaction');
  dit(await chaine.solde(potAdr) === 0, 'le pot est vide sur la chaine');
  dit(await chaine.solde(adresse(gens[0])) === 18 * MICROS + bareme.parRang[0], `le vainqueur a recu ${ecrire(bareme.parRang[0])} sur son wallet`);
  dit(await chaine.solde(adresse(gens[1])) === 18 * MICROS + bareme.parRang[1], `le second ${ecrire(bareme.parRang[1])}`);
  dit(await chaine.solde(frais) === bareme.rake && await solde(db, compte.rake) === bareme.rake,
    `les frais detiennent le rake de la ligne COURONNE : ${ecrire(bareme.rake)}, au livre comme sur la chaine`);
  const cloture = (await db.query(`select statut from public.chain_tx where objet = 'cloture_pot' and ref = $1`, [partie])).rows[0];
  dit(cloture?.statut === 'confirme', 'le compte du pot est ferme (rente rendue a la caisse)');
  const m2 = (await db.query(`select statut, issue, paye_sur_chaine_le from public.matches where id = $1`, [partie])).rows[0];
  dit(m2.statut === 'reglee' && m2.issue === 'couronne' && m2.paye_sur_chaine_le, 'la partie est « reglee », ligne COURONNE, chaine payee');

  const v = await verifierChaine(db, chaine);
  dit(v.ok && v.verifies >= 6, `livre ↔ chaine : ${v.verifies} comptes verifies, ${v.ecarts.length} ecart ${v.ok ? '' : JSON.stringify(v.ecarts)}`);

  const bis = await regler(db, {
    matchId: partie, mise: 2 * MICROS, mode: 'squad', graineRoue, effectif: 4,
    classement: gens.map((userId, i) => ({ userId, rang: i + 1 })),
  }, chaine);
  dit(bis.deja === true && await chaine.solde(adresse(gens[0])) === 18 * MICROS + bareme.parRang[0], 'regler une seconde fois ne paie rien de plus');
  const rejeu = await payerSurChaine(db, chaine, partie);
  dit(rejeu.deja === true, 'rejouer le paiement sur la chaine ne fait rien');
}

// ===========================================================================
titre('3. Une mise qui ne part pas annule la partie');
// ===========================================================================
{
  const a = await joueurDote(chaine, 'an-a', 10);
  const b = await joueurDote(chaine, 'an-b', 10);
  // Il a de quoi, mais la chaine refusera SON virement (compte gele, RPC qui rejette…).
  const c = await joueurDote(chaine, 'an-c', 10);
  // Et lui n'a rien du tout.
  const d = await joueur(db, 'an-d');

  const partie = 'squad-annulee';
  panne = (op) => op.ref === `${partie}:${c}`;
  const r = await engagerPartie(db, chaine, { partie, mode: 'squad', mise: 5 * MICROS, joueurs: [a, b, c, d].map((userId) => ({ userId, nom: userId.slice(0, 4) })) });
  dit(r.annulee === true, 'la partie est annulee');
  panne = null;
  dit(r.refuses.find((x) => x.userId === c)?.raison === 'CHAINE_REFUS', 'celui dont le virement est refuse par la chaine est refuse');
  dit(r.refuses.find((x) => x.userId === d)?.raison === 'SOLDE_INSUFFISANT', 'celui qui n\'a rien est refuse par le livre');
  dit(await solde(db, compte.joueur(a)) === 10 * MICROS && await chaine.solde(adresse(a)) === 10 * MICROS, 'a retrouve ses 10.00 au livre et sur la chaine');
  dit(await solde(db, compte.joueur(b)) === 10 * MICROS && await chaine.solde(adresse(b)) === 10 * MICROS, 'b aussi');
  dit(await solde(db, compte.joueur(c)) === 10 * MICROS && await chaine.solde(adresse(c)) === 10 * MICROS, 'c retrouve son solde au livre (sa mise n\'etait jamais partie)');
  dit(await chaine.solde(tresorerie.pot(partie).publicKey.toBase58()) === 0 && await solde(db, compte.pot(partie)) === 0, 'le pot est vide des deux cotes');
  const m = (await db.query(`select statut from public.matches where id = $1`, [partie])).rows[0];
  dit(m.statut === 'annulee', 'la partie est « annulee »');
  await refuse(regler(db, { matchId: partie, mise: 5 * MICROS, mode: 'squad', graineRoue: 1, classement: [{ userId: a, rang: 1 }, { userId: b, rang: 2 }, { userId: c, rang: 3 }, { userId: d, rang: 4 }] }, chaine),
    'une partie annulee ne se regle pas');
  await refuse(engagerPartie(db, chaine, { partie, mode: 'squad', mise: 5 * MICROS, joueurs: [a, b].map((userId) => ({ userId, nom: 'x' })) }),
    'et ne se reengage pas sous le meme identifiant');
  const inv = await verifierInvariant(db);
  dit(inv.total === 0 && inv.potsNonSoldes.length === 0, 'l\'invariant tient apres une annulation');
  const v = await verifierChaine(db, chaine);
  dit(v.ok, `livre ↔ chaine apres annulation : ${v.ecarts.length} ecart ${v.ok ? '' : JSON.stringify(v.ecarts)}`);
}

// ===========================================================================
titre('4. Le reseau coupe pendant une mise');
// ===========================================================================
{
  const chaineFragile = chaine;
  const a = await joueurDote(chaineFragile, 'inc-a', 10);
  const b = await joueurDote(chaineFragile, 'inc-b', 10);
  const partie = 'duel-incertain';
  couper = `${partie}:${b}`;
  const r = await engagerPartie(db, chaineFragile, { partie, mode: 'duel', mise: 2 * MICROS, joueurs: [{ userId: a, nom: 'a' }, { userId: b, nom: 'b' }] });
  dit(r.annulee === true && r.refuses[0]?.raison === 'CHAINE_INCERTAINE', 'une mise dont on ne sait pas si elle est partie annule la partie');
  dit(await solde(db, compte.joueur(b)) === 8 * MICROS, 'sa mise reste engagee au livre : on ne rend pas sur un doute');
  dit(await solde(db, compte.joueur(a)) === 10 * MICROS && await chaineFragile.solde(adresse(a)) === 10 * MICROS, 'l\'autre joueur est deja rembourse');

  const signature = (await db.query(`select signature from public.chain_tx where objet = 'mise' and ref = $1`, [couper])).rows[0].signature;
  // Verdict de la chaine : elle n'est jamais passee.
  const bilan1 = await rattraperChaine(db, { ...chaineFragile, reprendre: (g) => chaineFragile.reprendre(g, { [signature]: 'echoue' }) });
  dit(bilan1.reprise.echouees === 1 && await solde(db, compte.joueur(b)) === 10 * MICROS, 'quand la chaine dit « jamais passee », la mise est rendue au livre');
  dit(await chaineFragile.solde(adresse(b)) === 10 * MICROS, 'et le wallet n\'a pas bouge');

  // L'autre verdict : elle EST passee, dans le pot d'une partie annulee entre-temps.
  const c = await joueurDote(chaineFragile, 'inc-c', 10);
  const d = await joueurDote(chaineFragile, 'inc-d', 10);
  const partie2 = 'duel-incertain-2';
  couper = `${partie2}:${d}`;
  await engagerPartie(db, chaineFragile, { partie: partie2, mode: 'duel', mise: 2 * MICROS, joueurs: [{ userId: c, nom: 'c' }, { userId: d, nom: 'd' }] });
  const sig2 = (await db.query(`select signature from public.chain_tx where objet = 'mise' and ref = $1`, [couper])).rows[0].signature;
  couper = null;
  const bilan2 = await rattraperChaine(db, { ...chaineFragile, reprendre: (g) => chaineFragile.reprendre(g, { [sig2]: 'confirme' }) });
  dit(bilan2.reprise.confirmees === 1, 'la chaine finit par dire « passee »');
  dit(await solde(db, compte.joueur(d)) === 10 * MICROS && await chaineFragile.solde(adresse(d)) === 10 * MICROS,
    'la mise arrivee dans un pot annule revient au joueur, au livre et sur la chaine');
  const v = await verifierChaine(db, chaineFragile);
  dit(v.ok, `livre ↔ chaine apres les deux reprises : ${v.ecarts.length} ecart ${v.ok ? '' : JSON.stringify(v.ecarts)}`);
}

// ===========================================================================
titre('5. Le brulage : les frais achetent des BG, qui sont detruits');
// ===========================================================================
{
  dit(prixAchat(1_000_000_000, 1_000_000_000_000_000, 1_000_000) === 999_000_999_000,
    'produit constant : 1 USDC dans un pool de 1 000 USDC / 1 000 000 000 BG donne 999 000.999 BG');
  dit(prixAchat(0, 1_000_000_000_000_000, 1_000_000) === 1_000_000_000_000_000 - 1_000_000_000_000_000 * 0 && prixAchat(0, 100, 0) === 0,
    'sans USDC en entree, rien ne sort');

  chaine.doter(pool, 'bg', 1_000_000_000 * MICROS);
  const fraisAvant = await chaine.solde(frais);
  // Un pool qui a des BG mais pas d'USDC n'a pas de prix : on ne vend RIEN, surtout pas tout.
  const nonAmorce = await racheterEtBruler(db, chaine, { seuil: 1 });
  dit(nonAmorce?.statut === 'pool_non_amorce' && await chaine.solde(pool, 'bg') === 1_000_000_000 * MICROS && await chaine.solde(frais) === fraisAvant,
    'un pool sans USDC ne vend rien — le produit constant y donnerait tout le pool pour un centime');
  chaine.doter(pool, 'usdc', 1_000 * MICROS);
  const offreAvant = (await chaine.offre('bg')).offre;
  const attenduBg = prixAchat(1_000 * MICROS, 1_000_000_000 * MICROS, fraisAvant);

  const rien = await racheterEtBruler(db, chaine, { seuil: fraisAvant + 1 });
  dit(rien === null, `sous le seuil, on ne brule pas (frais : ${ecrire(fraisAvant)} USDC)`);

  const b = await racheterEtBruler(db, chaine, { seuil: fraisAvant });
  dit(b?.statut === 'brule' && b.usdc === fraisAvant && b.bg === attenduBg,
    `au seuil : ${ecrire(b.usdc)} USDC achetent ${(b.bg / MICROS).toFixed(6)} BG, brules`);
  dit(await chaine.solde(frais) === 0 && await solde(db, compte.rake) === 0, 'les frais sont a zero, au livre et sur la chaine');
  dit(await chaine.solde(pool, 'usdc') === 1_000 * MICROS + fraisAvant && await solde(db, compte.pool) === fraisAvant,
    'le pool a recu les USDC ; le livre le sait');
  dit(await chaine.solde(frais, 'bg') === 0, 'aucun BG ne reste sur les frais : achetes et brules dans la meme transaction');
  dit((await chaine.offre('bg')).offre === offreAvant - attenduBg, `l'offre de BG a baisse de ${(attenduBg / MICROS).toFixed(6)}`);
  const ligne = (await db.query(`select * from public.burns`)).rows;
  dit(ligne.length === 1 && Number(ligne[0].bg_micros) === attenduBg && ligne[0].signature === b.signature, 'le rachat est consigne, avec sa signature');
  const marche = await etatMarche(chaine);
  dit(marche.bgParUsdc > 0 && marche.offre === offreAvant - attenduBg, `le marche se lit sur la chaine : ${(marche.bgParUsdc / MICROS).toFixed(2)} BG pour 1 USDC`);

  // La chaine refuse : rien n'est brule, les frais retrouvent leurs USDC au livre.
  const chainePanne = chaine;
  chaine.doter(frais, 'usdc', 3 * MICROS);
  panne = (op) => op.type === 'brulage';
  await db.transaction(async (tx) => {
    const { poster } = await import('../src/livre.js');
    await poster(tx, { genre: 'depot', ref: 'frais-test', lignes: [{ compte: compte.entree, montant: -3 * MICROS }, { compte: compte.rake, montant: 3 * MICROS }] });
  });
  const rate = await racheterEtBruler(db, chainePanne, { seuil: 1 * MICROS });
  panne = null;
  dit(rate.statut === 'echoue' && await solde(db, compte.rake) === 3 * MICROS && await chainePanne.solde(frais) === 3 * MICROS,
    'si la chaine refuse, le livre est rendu et les frais n\'ont pas bouge');
  const inv = await verifierInvariant(db);
  dit(inv.total === 0, 'l\'invariant tient a travers les rachats');
}

// ===========================================================================
titre('6. Un retrait part du wallet du joueur');
// ===========================================================================
{
  const eve = await joueurDote(chaine, 'ret-eve', 100);
  await db.query(`update public.profiles set wallet = $2, wallet_lie_le = now() - interval '48 hours' where id = $1`, [eve, 'WalletExterneDEve1111111111111111111111111']);
  const r = await demander(db, { userId: eve, montant: 40 * MICROS });
  dit(await solde(db, compte.joueur(eve)) === 60 * MICROS && await chaine.solde(adresse(eve)) === 100 * MICROS,
    'a la demande, le livre reserve ; la chaine n\'a pas encore bouge');
  const v1 = await verifierChaine(db, chaine);
  dit(v1.ok, `et la reconciliation le sait : un retrait en attente n'est pas un ecart ${v1.ok ? '' : JSON.stringify(v1.ecarts)}`);

  const ex = await executer(db, chaine, r.id);
  dit(ex.statut === 'confirme' && ex.signature, 'le retrait est confirme avec une signature');
  dit(await chaine.solde(adresse(eve)) === 60 * MICROS && await chaine.solde('WalletExterneDEve1111111111111111111111111') === 40 * MICROS,
    'les 40.00 sont partis DU WALLET DU JOUEUR vers le wallet lie');
  const bis = await executer(db, chaine, r.id);
  dit(bis.statut === 'confirme' && bis.signature === ex.signature, 'relancer le meme retrait ne renvoie rien');

  // La chaine refuse (wallet de jeu vide, par exemple) : rembourse.
  panne = (op) => op.objet === 'retrait';
  const r2 = await demander(db, { userId: eve, montant: 30 * MICROS });
  const ex2 = await executer(db, chaine, r2.id);
  panne = null;
  dit(ex2.statut === 'echoue' && await solde(db, compte.joueur(eve)) === 60 * MICROS, 'un retrait refuse par la chaine est rembourse au livre');
  const v2 = await verifierChaine(db, chaine);
  dit(v2.ok, `livre ↔ chaine apres les retraits : ${v2.ecarts.length} ecart ${v2.ok ? '' : JSON.stringify(v2.ecarts)}`);
}

await pglite.close();
process.exit(bilan() === 0 ? 0 : 1);
