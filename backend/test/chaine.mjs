/**
 * Verdicts sur LA CHAINE — ce que Robinhood Chain fera, prouve ici sans ETH ni reseau.
 *
 * `factice.js` offre la meme interface que la vraie chaine (journal en base compris), et
 * les modules du domaine — `regler.js`, `brulage.js`, `retraits.js` — ne savent pas
 * laquelle des deux ils tiennent. Ce qu'on prouve ici, c'est donc bien le CHEMIN qu'ils
 * prennent : livre d'abord, chaine ensuite, et ce qu'ils defont quand elle refuse.
 *
 * Usage : node test/chaine.mjs
 */

import { Wallet } from 'ethers';
import { banc, joueur, doter, dit, refuse, titre, bilan } from './aide.mjs';
import { solde, compte, verifierInvariant } from '../src/livre.js';
import { engagerPartie, regler, payerSurChaine, annulerPartie, rattraperChaine } from '../src/match/regler.js';
import { creerChaineFactice } from '../src/robinhood/factice.js';
import { tresorerie } from '../src/robinhood/tresorerie.js';
import { verifierChaine } from '../src/robinhood/reconciliation.js';
import { racheterEtBruler, prixAchat, etatMarche } from '../src/robinhood/brulage.js';
import { demander, executer } from '../src/robinhood/retraits.js';
import { nonceDe, raisonDe } from '../src/robinhood/chaine.js';
import { genererCle, sceller, ouvrir, canonique, signer, verifier } from '../src/signature.js';
import { table } from '../src/gains.js';
import { MICROS, ecrire } from '../src/argent.js';

const { db, pglite } = await banc();
const adresse = (userId) => tresorerie.joueur(userId).address;
const frais = tresorerie.frais().address;
const pool = tresorerie.pool().address;

/** Un joueur dote au livre ET sur la chaine, comme apres un vrai depot. */
async function joueurDote(chaine, nom, usdg) {
  const id = await joueur(db, nom);
  await doter(db, id, usdg * MICROS);
  chaine.doter(adresse(id), 'usdg', usdg * MICROS);
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

  // Le nonce d'une autorisation EIP-3009 est la cle du journal, hachee : le contrat
  // refuse donc de lui-meme la meme operation presentee deux fois.
  dit(nonceDe('mise', 'p1:a') === nonceDe('mise', 'p1:a') && nonceDe('mise', 'p1:a') !== nonceDe('mise', 'p1:b'), 'le nonce d\'une autorisation derive de (objet, ref), et de rien d\'autre');
  dit(/^0x[0-9a-f]{64}$/.test(nonceDe('gain', 'p1:a')), 'et tient sur 32 octets, comme le contrat l\'attend');
  dit(raisonDe('0x08c379a0' + '0000000000000000000000000000000000000000000000000000000000000020' + '0000000000000000000000000000000000000000000000000000000000000011' + Buffer.from('solde insuffisant').toString('hex').padEnd(64, '0')) === 'solde insuffisant',
    'la raison d\'un revert Error(string) se lit en clair');
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
  dit(new Set(Object.values(r.signatures)).size === 1 && Object.keys(r.signatures).length === 4, 'les quatre mises tiennent dans UNE transaction : un lot, un hache');
  const potAdr = tresorerie.pot(partie).address;
  dit(await chaine.solde(potAdr) === 8 * MICROS, `le pot detient ${ecrire(8 * MICROS)} USDG sur la chaine`);
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
  const lignes = (await db.query(`select objet, statut from public.chain_tx where partie = $1 and statut = 'confirme'`, [partie])).rows;
  dit(lignes.filter((l) => l.objet === 'gain').length === 2 && lignes.filter((l) => l.objet === 'rake').length === 1, 'le journal porte deux gains et un rake confirmes pour cette partie');
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
titre('3. Une mise qui ne part pas annule la partie — et aucune autre ne part');
// ===========================================================================
{
  // 3a. Le LIVRE refuse (rien a miser) : la chaine n'est meme pas sollicitee.
  const a = await joueurDote(chaine, 'an-a', 10);
  const b = await joueurDote(chaine, 'an-b', 10);
  const c = await joueurDote(chaine, 'an-c', 10);
  const d = await joueur(db, 'an-d');

  const partie = 'squad-annulee';
  const r = await engagerPartie(db, chaine, { partie, mode: 'squad', mise: 5 * MICROS, joueurs: [a, b, c, d].map((userId) => ({ userId, nom: userId.slice(0, 4) })) });
  dit(r.annulee === true, 'la partie est annulee');
  dit(r.refuses.length === 1 && r.refuses[0].userId === d && r.refuses[0].raison === 'SOLDE_INSUFFISANT', 'celui qui n\'a rien est refuse par le livre, et lui seul');
  const journal = (await db.query(`select count(*)::int as n from public.chain_tx where partie = $1`, [partie])).rows[0].n;
  dit(journal === 0, 'aucune transaction n\'a ete tentee : inutile de faire partir des mises pour les rendre');
  for (const [nom, id] of [['a', a], ['b', b], ['c', c]]) {
    dit(await solde(db, compte.joueur(id)) === 10 * MICROS && await chaine.solde(adresse(id)) === 10 * MICROS, `${nom} retrouve ses 10.00 au livre et sur la chaine`);
  }
  dit(await chaine.solde(tresorerie.pot(partie).address) === 0 && await solde(db, compte.pot(partie)) === 0, 'le pot est vide des deux cotes');
  const m = (await db.query(`select statut from public.matches where id = $1`, [partie])).rows[0];
  dit(m.statut === 'annulee', 'la partie est « annulee »');
  await refuse(regler(db, { matchId: partie, mise: 5 * MICROS, mode: 'squad', graineRoue: 1, classement: [{ userId: a, rang: 1 }, { userId: b, rang: 2 }, { userId: c, rang: 3 }, { userId: d, rang: 4 }] }, chaine),
    'une partie annulee ne se regle pas');
  await refuse(engagerPartie(db, chaine, { partie, mode: 'squad', mise: 5 * MICROS, joueurs: [a, b].map((userId) => ({ userId, nom: 'x' })) }),
    'et ne se reengage pas sous le meme identifiant');

  // 3b. La CHAINE refuse le virement de c (compte gele, contrat qui rejette…) : le lot
  // entier est annule, et l'index de l'appel fautif designe c.
  const partie2 = 'squad-refusee';
  panne = (op) => op.ref === `${partie2}:${c}`;
  const r2 = await engagerPartie(db, chaine, { partie: partie2, mode: 'squad', mise: 5 * MICROS, joueurs: [a, b, c].map((userId) => ({ userId, nom: userId.slice(0, 4) })) });
  panne = null;
  dit(r2.annulee === true && r2.refuses.length === 1 && r2.refuses[0].userId === c && r2.refuses[0].raison === 'CHAINE_REFUS',
    'le lot est refuse par la chaine : c est designe comme fautif, a et b ne sont pas refuses');
  for (const [nom, id] of [['a', a], ['b', b], ['c', c]]) {
    dit(await solde(db, compte.joueur(id)) === 10 * MICROS && await chaine.solde(adresse(id)) === 10 * MICROS, `${nom} n'a rien perdu : le lot est tout ou rien`);
  }
  const echouees = (await db.query(`select count(*)::int as n from public.chain_tx where partie = $1 and statut = 'echoue'`, [partie2])).rows[0].n;
  dit(echouees === 3, 'les trois lignes du journal sont « echoue » — aucune n\'est partie seule');
  const inv = await verifierInvariant(db);
  dit(inv.total === 0 && inv.potsNonSoldes.length === 0, 'l\'invariant tient apres une annulation');
  const v = await verifierChaine(db, chaine);
  dit(v.ok, `livre ↔ chaine apres annulation : ${v.ecarts.length} ecart ${v.ok ? '' : JSON.stringify(v.ecarts)}`);
}

// ===========================================================================
titre('4. Le reseau coupe pendant les mises');
// ===========================================================================
{
  const chaineFragile = chaine;
  const a = await joueurDote(chaineFragile, 'inc-a', 10);
  const b = await joueurDote(chaineFragile, 'inc-b', 10);
  const partie = 'duel-incertain';
  couper = `${partie}:${b}`;
  const r = await engagerPartie(db, chaineFragile, { partie, mode: 'duel', mise: 2 * MICROS, joueurs: [{ userId: a, nom: 'a' }, { userId: b, nom: 'b' }] });
  dit(r.annulee === true && r.refuses.every((x) => x.raison === 'CHAINE_INCERTAINE') && r.refuses.length === 2, 'un lot dont on ne sait pas s\'il est parti annule la partie, pour les deux');
  dit(await solde(db, compte.joueur(a)) === 8 * MICROS && await solde(db, compte.joueur(b)) === 8 * MICROS, 'les deux mises restent engagees au livre : on ne rend pas sur un doute');

  const signature = (await db.query(`select signature from public.chain_tx where objet = 'mise' and ref = $1`, [couper])).rows[0].signature;
  // Verdict de la chaine : elle n'est jamais passee.
  const bilan1 = await rattraperChaine(db, { ...chaineFragile, reprendre: (g) => chaineFragile.reprendre(g, { [signature]: 'echoue' }) });
  dit(bilan1.reprise.echouees === 2 && await solde(db, compte.joueur(a)) === 10 * MICROS && await solde(db, compte.joueur(b)) === 10 * MICROS,
    'quand la chaine dit « jamais minee », les deux mises sont rendues au livre');
  dit(await chaineFragile.solde(adresse(a)) === 10 * MICROS && await chaineFragile.solde(adresse(b)) === 10 * MICROS, 'et les wallets n\'ont pas bouge');

  // L'autre verdict : elle EST passee, dans le pot d'une partie annulee entre-temps.
  const c = await joueurDote(chaineFragile, 'inc-c', 10);
  const d = await joueurDote(chaineFragile, 'inc-d', 10);
  const partie2 = 'duel-incertain-2';
  couper = `${partie2}:${d}`;
  await engagerPartie(db, chaineFragile, { partie: partie2, mode: 'duel', mise: 2 * MICROS, joueurs: [{ userId: c, nom: 'c' }, { userId: d, nom: 'd' }] });
  const sig2 = (await db.query(`select signature from public.chain_tx where objet = 'mise' and ref = $1`, [couper])).rows[0].signature;
  couper = null;
  const bilan2 = await rattraperChaine(db, { ...chaineFragile, reprendre: (g) => chaineFragile.reprendre(g, { [sig2]: 'confirme' }) });
  dit(bilan2.reprise.confirmees === 2, 'la chaine finit par dire « minee »');
  dit(await solde(db, compte.joueur(c)) === 10 * MICROS && await chaineFragile.solde(adresse(c)) === 10 * MICROS
    && await solde(db, compte.joueur(d)) === 10 * MICROS && await chaineFragile.solde(adresse(d)) === 10 * MICROS,
  'les mises arrivees dans un pot annule reviennent aux joueurs, au livre et sur la chaine');
  const v = await verifierChaine(db, chaineFragile);
  dit(v.ok, `livre ↔ chaine apres les deux reprises : ${v.ecarts.length} ecart ${v.ok ? '' : JSON.stringify(v.ecarts)}`);
}

// ===========================================================================
titre('4b. Une partie engagee et oubliee par le serveur de jeu est annulee par le tour de fond');
// ===========================================================================
{
  const e = await joueurDote(chaine, 'oub-e', 10);
  const f = await joueurDote(chaine, 'oub-f', 10);
  const partie = 'duel-oublie';
  const r = await engagerPartie(db, chaine, { partie, mode: 'duel', mise: 2 * MICROS, joueurs: [{ userId: e, nom: 'e' }, { userId: f, nom: 'f' }] });
  dit(r.annulee === false && await chaine.solde(tresorerie.pot(partie).address) === 4 * MICROS, 'les deux mises sont dans le pot');
  const rien = await rattraperChaine(db, chaine);
  dit(rien.annulees === 0 && await solde(db, compte.joueur(e)) === 8 * MICROS, 'quelques secondes apres le depart, le tour de fond ne touche a rien');
  await db.query(`update public.matches set engagee_le = now() - interval '46 minutes' where id = $1`, [partie]);
  const bilanOubli = await rattraperChaine(db, chaine);
  dit(bilanOubli.annulees === 1, 'passe 45 minutes sans reglement, la partie est annulee');
  dit(await solde(db, compte.joueur(e)) === 10 * MICROS && await chaine.solde(adresse(e)) === 10 * MICROS
    && await solde(db, compte.joueur(f)) === 10 * MICROS && await chaine.solde(adresse(f)) === 10 * MICROS,
  'et chaque mise est revenue, au livre et sur la chaine');
  dit((await db.query(`select statut from public.matches where id = $1`, [partie])).rows[0].statut === 'annulee', 'la partie est « annulee »');
}

// ===========================================================================
titre('5. Le brulage : les frais achetent des BG, qui sont detruits');
// ===========================================================================
{
  dit(prixAchat(1_000_000_000, 1_000_000_000_000_000, 1_000_000) === 999_000_999_000,
    'produit constant : 1 USDG dans un pool de 1 000 USDG / 1 000 000 000 BG donne 999 000.999 BG');
  dit(prixAchat(0, 1_000_000_000_000_000, 1_000_000) === 1_000_000_000_000_000 - 1_000_000_000_000_000 * 0 && prixAchat(0, 100, 0) === 0,
    'sans USDG en entree, rien ne sort');

  chaine.doter(pool, 'bg', 1_000_000_000 * MICROS);
  const fraisAvant = await chaine.solde(frais);
  // Un pool qui a des BG mais pas d'USDG n'a pas de prix : on ne vend RIEN, surtout pas tout.
  const nonAmorce = await racheterEtBruler(db, chaine, { seuil: 1 });
  dit(nonAmorce?.statut === 'pool_non_amorce' && await chaine.solde(pool, 'bg') === 1_000_000_000 * MICROS && await chaine.solde(frais) === fraisAvant,
    'un pool sans USDG ne vend rien — le produit constant y donnerait tout le pool pour un centime');
  chaine.doter(pool, 'usdg', 1_000 * MICROS);
  const offreAvant = (await chaine.offre('bg')).offre;
  const attenduBg = prixAchat(1_000 * MICROS, 1_000_000_000 * MICROS, fraisAvant);

  const rien = await racheterEtBruler(db, chaine, { seuil: fraisAvant + 1 });
  dit(rien === null, `sous le seuil, on ne brule pas (frais : ${ecrire(fraisAvant)} USDG)`);

  const b = await racheterEtBruler(db, chaine, { seuil: fraisAvant });
  dit(b?.statut === 'brule' && b.usdg === fraisAvant && b.bg === attenduBg,
    `au seuil : ${ecrire(b.usdg)} USDG achetent ${(b.bg / MICROS).toFixed(6)} BG, brules`);
  dit(await chaine.solde(frais) === 0 && await solde(db, compte.rake) === 0, 'les frais sont a zero, au livre et sur la chaine');
  dit(await chaine.solde(pool, 'usdg') === 1_000 * MICROS + fraisAvant && await solde(db, compte.pool) === fraisAvant,
    'le pool a recu les USDG ; le livre le sait');
  dit(await chaine.solde(pool, 'bg') === 1_000_000_000 * MICROS - attenduBg && await chaine.solde(frais, 'bg') === 0,
    'les BG achetes sont sortis du pool et brules dans la meme transaction : aucun BG ne transite par les frais');
  dit((await chaine.offre('bg')).offre === offreAvant - attenduBg, `l'offre de BG a baisse de ${(attenduBg / MICROS).toFixed(6)}`);
  const ligne = (await db.query(`select * from public.burns`)).rows;
  dit(ligne.length === 1 && Number(ligne[0].bg_micros) === attenduBg && ligne[0].signature === b.signature, 'le rachat est consigne, avec son hache');
  const marche = await etatMarche(chaine);
  dit(marche.bgParUsdg > 0 && marche.offre === offreAvant - attenduBg, `le marche se lit sur la chaine : ${(marche.bgParUsdg / MICROS).toFixed(2)} BG pour 1 USDG`);

  // La chaine refuse : rien n'est brule, les frais retrouvent leurs USDG au livre.
  const chainePanne = chaine;
  chaine.doter(frais, 'usdg', 3 * MICROS);
  panne = (op) => op.type === 'brulage';
  await db.transaction(async (tx) => {
    const { poster } = await import('../src/livre.js');
    await poster(tx, { genre: 'depot', ref: 'frais-test', lignes: [{ compte: compte.entree, montant: -3 * MICROS }, { compte: compte.rake, montant: 3 * MICROS }] });
  });
  const rate = await racheterEtBruler(db, chainePanne, { seuil: 1 * MICROS });
  panne = null;
  dit(rate.statut === 'echoue' && await solde(db, compte.rake) === 3 * MICROS && await chainePanne.solde(frais) === 3 * MICROS,
    'si la chaine refuse le brulage, le virement des USDG est annule avec lui : le livre est rendu, les frais n\'ont pas bouge');
  const inv = await verifierInvariant(db);
  dit(inv.total === 0, 'l\'invariant tient a travers les rachats');
}

// ===========================================================================
titre('6. Un retrait part du wallet du joueur');
// ===========================================================================
{
  const eve = await joueurDote(chaine, 'ret-eve', 100);
  const externe = Wallet.createRandom().address;
  await db.query(`update public.profiles set wallet = $2, wallet_lie_le = now() - interval '48 hours' where id = $1`, [eve, externe]);
  const r = await demander(db, { userId: eve, montant: 40 * MICROS });
  dit(await solde(db, compte.joueur(eve)) === 60 * MICROS && await chaine.solde(adresse(eve)) === 100 * MICROS,
    'a la demande, le livre reserve ; la chaine n\'a pas encore bouge');
  const v1 = await verifierChaine(db, chaine);
  dit(v1.ok, `et la reconciliation le sait : un retrait en attente n'est pas un ecart ${v1.ok ? '' : JSON.stringify(v1.ecarts)}`);

  const ex = await executer(db, chaine, r.id);
  dit(ex.statut === 'confirme' && ex.signature, 'le retrait est confirme avec un hache');
  dit(await chaine.solde(adresse(eve)) === 60 * MICROS && await chaine.solde(externe) === 40 * MICROS,
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

// ===========================================================================
titre('7. Le robinet d\'essai frappe des USDG que le guetteur voit comme un depot');
// ===========================================================================
{
  const fred = await joueur(db, 'rob-fred');
  const r = await chaine.executer({ operations: [{ type: 'frappe', vers: adresse(fred), mint: 'usdg', montant: 20 * MICROS, objet: 'robinet', ref: `${fred}:1` }] });
  dit(r.deja === false && await chaine.solde(adresse(fred)) === 20 * MICROS, 'la frappe depose 20.00 USDG sur le wallet de jeu');
  const ligne = (await db.query(`select user_id, statut from public.chain_tx where objet = 'robinet'`)).rows[0];
  dit(ligne.statut === 'confirme' && ligne.user_id === null, 'elle est journalisee SANS joueur : pour le guetteur, c\'est un depot comme un autre');
  const bis = await chaine.executer({ operations: [{ type: 'frappe', vers: adresse(fred), mint: 'usdg', montant: 20 * MICROS, objet: 'robinet', ref: `${fred}:1` }] });
  dit(bis.deja === true && await chaine.solde(adresse(fred)) === 20 * MICROS, 'rejouer la meme ref ne frappe pas deux fois');
}

await pglite.close();
process.exit(bilan() === 0 ? 0 : 1);
