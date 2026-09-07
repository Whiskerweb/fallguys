/**
 * Verdicts sur LA BOUTIQUE — un skin s'achete au livre puis sur la chaine, et chaque USDG
 * finit aux FRAIS, la ou le brulage puise.
 *
 * Usage : node test/boutique.mjs
 */
import { banc, joueur, doter, dit, refuse, titre, bilan } from './aide.mjs';
import { solde, compte, verifierInvariant } from '../src/livre.js';
import { creerChaineFactice } from '../src/robinhood/factice.js';
import { tresorerie } from '../src/robinhood/tresorerie.js';
import { verifierChaine } from '../src/robinhood/reconciliation.js';
import { rattraperChaine } from '../src/match/regler.js';
import { acheter, possessions, catalogue, ARTICLES, bilanBoutique, LIEN_SUIVI } from '../src/boutique.js';
import { MICROS } from '../src/argent.js';

const { db, pglite } = await banc();
const adresse = (userId) => tresorerie.joueur(userId).address;
const frais = tresorerie.frais().address;
let panne = null;
let couper = null;
const chaine = creerChaineFactice({ db, panne: (op) => Boolean(panne?.(op)), incertaine: (ops) => Boolean(couper) && ops.some((o) => o.ref === couper) });

titre('1. Le catalogue');
{
  const c = catalogue();
  dit(c.length === 3 && c.every((a) => a.prix >= 10 * MICROS && a.prix <= 15 * MICROS), `trois skins, entre 10 et 15 USDG : ${c.map((a) => `${a.id} ${a.prix / MICROS}`).join(', ')}`);
  dit(ARTICLES['char-techtitan'].prix === 15 * MICROS && ARTICLES['char-diplomate'].prix === 12 * MICROS && ARTICLES['char-captainleeky'].prix === 10 * MICROS, 'Elon 15, Netanyahu 12, CyberLeek 10');
  dit(!('char-grenouille' in ARTICLES) && !('char-babytrump' in ARTICLES), 'Pepe (de depart) et BabyTrump (un post) ne sont pas a vendre');
  dit(LIEN_SUIVI === 'https://play.babyguy.dev/api/suivi', `le lien du suivi en direct : ${LIEN_SUIVI}`);
}

titre('2. Un achat : du wallet du joueur aux frais');
const alice = await joueur(db, 'bt-alice');
await doter(db, alice, 30 * MICROS); chaine.doter(adresse(alice), 'usdg', 30 * MICROS);
{
  const r = await acheter(db, chaine, { userId: alice, article: 'char-captainleeky' });
  dit(r.statut === 'confirme' && r.prix === 10 * MICROS && r.deja === false, 'CyberLeek achete 10.00, chaine confirmee');
  dit(await solde(db, compte.joueur(alice)) === 20 * MICROS && await chaine.solde(adresse(alice)) === 20 * MICROS, 'alice a 20.00 au livre ET sur la chaine');
  dit(await solde(db, compte.rake) === 10 * MICROS && await chaine.solde(frais) === 10 * MICROS, 'les 10.00 sont aux FRAIS, au livre et sur la chaine : ils bruleront du BG');
  dit(String(await possessions(db, alice)) === 'char-captainleeky', 'alice possede CyberLeek');
  const bis = await acheter(db, chaine, { userId: alice, article: 'char-captainleeky' });
  dit(bis.deja === true && await solde(db, compte.joueur(alice)) === 20 * MICROS, 'racheter le meme skin ne paie rien');
  await refuse(acheter(db, chaine, { userId: alice, article: 'char-inconnu' }), 'un article inconnu est refuse');
  const bob = await joueur(db, 'bt-bob');
  await doter(db, bob, 5 * MICROS); chaine.doter(adresse(bob), 'usdg', 5 * MICROS);
  await refuse(acheter(db, chaine, { userId: bob, article: 'char-diplomate' }), 'sans 12.00 USDG, pas de BabyNetan');
  dit(String(await possessions(db, bob)) === '' && await solde(db, compte.joueur(bob)) === 5 * MICROS, 'et bob n\'a rien perdu ni rien recu');
  const b = await bilanBoutique(db);
  dit(b.ventes === 1 && b.total === 10 * MICROS, 'le suivi compte 1 skin vendu, 10.00 USDG');
  const v = await verifierChaine(db, chaine);
  dit(v.ok, `livre ↔ chaine apres l'achat : ${v.ecarts.length} ecart`);
}

titre('3. La chaine refuse : rembourse, pas de skin');
{
  panne = (op) => op.objet === 'achat';
  await refuse(acheter(db, chaine, { userId: alice, article: 'char-techtitan' }), 'le paiement refuse par la chaine est un refus');
  panne = null;
  dit(await solde(db, compte.joueur(alice)) === 20 * MICROS && await solde(db, compte.rake) === 10 * MICROS, 'le livre est rendu : alice garde ses 20.00');
  dit(String(await possessions(db, alice)) === 'char-captainleeky', 'et BabyMusk n\'est pas possede');
  const r = await acheter(db, chaine, { userId: alice, article: 'char-techtitan' });
  dit(r.statut === 'confirme' && await solde(db, compte.joueur(alice)) === 5 * MICROS, 'reessayer apres un refus marche : achete 15.00');
}

titre('4. Le reseau coupe : la possession attend la reprise');
{
  const carl = await joueur(db, 'bt-carl');
  await doter(db, carl, 20 * MICROS); chaine.doter(adresse(carl), 'usdg', 20 * MICROS);
  couper = null;
  // La cle porte la tentative : on coupe sur TOUT achat de carl, quelle que soit la cle.
  const chaineCoupee = { ...chaine, executer: (p) => { couper = p.operations[0].ref; return chaine.executer(p); } };
  const r = await acheter(db, chaineCoupee, { userId: carl, article: 'char-diplomate' });
  couper = null;
  dit(r.statut === 'soumis' && String(await possessions(db, carl)) === 'char-diplomate', 'achat incertain : le skin est possede en attendant, on ne rend rien sur un doute');
  const sig = (await db.query(`select signature from public.chain_tx where objet = 'achat' and ref like $1`, [`${carl}:char-diplomate:%`])).rows[0].signature;
  await rattraperChaine(db, { ...chaine, reprendre: (g) => chaine.reprendre(g, { [sig]: 'echoue' }) });
  dit(String(await possessions(db, carl)) === '' && await solde(db, compte.joueur(carl)) === 20 * MICROS, 'jamais minee : rembourse, et le skin retire');
  const inv = await verifierInvariant(db);
  dit(inv.total === 0, 'l\'invariant tient');
  const v = await verifierChaine(db, chaine);
  dit(v.ok, `livre ↔ chaine a la fin : ${v.ecarts.length} ecart ${v.ok ? '' : JSON.stringify(v.ecarts)}`);
}

await pglite.close();
process.exit(bilan() === 0 ? 0 : 1);
