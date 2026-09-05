/**
 * Verdict sur la BOUTIQUE — le diagnostic du dossier qui n'ouvre pas de navigateur, parce
 * qu'il ne juge pas une image mais une règle de possession.
 *
 * Ce qu'il tient, et pourquoi chacun compte :
 *
 *   - la boutique a QUATRE articles : BabyTrump contre un post, trois skins contre des
 *     USDC entre 10 et 15. Pepe, le personnage de départ, n'y est pas : on l'a en arrivant ;
 *   - les PRIX du navigateur sont ceux du backend, mot pour mot. Le backend encaisse, le
 *     navigateur affiche : deux catalogues qui divergent feraient payer un prix et en
 *     annoncer un autre ;
 *   - un personnage HORS boutique reste portable. Le verrou retient, il n'autorise pas ;
 *   - un skin PAYANT ne se porte que si le BACKEND le dit — sauf sur un banc, où la
 *     mémoire locale suffit pour que les harnais s'habillent. Une mémoire bricolée sur le
 *     serveur de production ne vaut rien ;
 *   - le post part avec le texte, les hashtags et le lien publié du jeu ;
 *   - la réclamation refuse pour TROIS raisons distinctes, et une seule se répare en
 *     attendant ;
 *   - le catalogue ne peut pas équiper un personnage non possédé, et son DÉFAUT est Pepe ;
 *   - le dossier de banc rouvre la porte aux harnais, sinon les deux navigateurs de
 *     `duel.mjs` porteraient le même personnage sans que rien ne le signale.
 *
 * Les valeurs attendues sont posées à la main. Un test qui rejoue le calcul du code testé
 * ne teste rien.
 *
 * Usage : node diag/boutique.mjs
 */
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const memoire = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
  setItem: (k, v) => memoire.set(k, String(v)),
  removeItem: (k) => memoire.delete(k),
};

const src = (f) => pathToFileURL(path.resolve('src', f)).href;
const B = await import(src('boutique.js'));
// IMPORTE APRES, et volontairement : le catalogue calcule son defaut au chargement, donc
// il doit le calculer alors que tout est encore verrouille.
const { cosmetics, MODELS } = await import(src('cosmetics.js'));

let echecs = 0;
const dit = (ok, texte) => {
  if (!ok) echecs++;
  console.log(`${ok ? 'OK  ' : 'ECHEC'} ${texte}`);
};

console.log('\n\x1b[1mLe catalogue de la boutique\x1b[0m');
dit(B.ARTICLES.length === 5, `cinq articles : ${B.ARTICLES.map((a) => a.id).join(', ')}`);
dit(B.ARTICLES[0].id === 'char-babytrump' && B.ARTICLES[0].condition === 'post' && B.ARTICLES[0].prix === 'FREE',
  'BabyTrump en tete, contre un post, sans prix');
const payants = B.ARTICLES.filter((a) => a.condition === 'achat');
dit(payants.length === 3 && payants.every((a) => a.prixMicros >= 10_000_000 && a.prixMicros <= 15_000_000),
  `trois skins payants entre 10 et 15 USDC : ${payants.map((a) => `${a.id} ${a.prix}`).join(', ')}`);
dit(String(B.PAYANTS) === 'char-techtitan,char-diplomate,char-captainleeky', `les payants, pour le serveur : ${B.PAYANTS.join(', ')}`);
// LE CADEAU DE BIENVENUE (5 septembre 2026) : BabyVlad ne se vend pas, il s'ouvre.
dit(B.CADEAU === 'char-tinytrader' && B.articleDe(B.CADEAU)?.condition === 'cadeau' && B.articleDe(B.CADEAU)?.prix === 'GIFT',
  `BabyVlad est le cadeau de bienvenue : ${B.CADEAU}, GIFT, pas un prix`);
dit(B.ARTICLES[B.ARTICLES.length - 1].id === B.CADEAU, 'et il ferme la vitrine : on n\'y vend rien, on y rappelle qu\'on l\'a recu');
dit(MODELS.find((m) => m.id === B.CADEAU)?.name === 'BabyVlad' && MODELS.find((m) => m.id === B.CADEAU)?.rarity === 'epic',
  'au catalogue il s\'appelle BabyVlad, et il est EPIC — un cadeau « common » n\'en est pas un');
dit(B.articleDe('char-grenouille') === null, 'Pepe n\'est pas en boutique : on l\'a en arrivant');
dit(MODELS[0].id === 'char-grenouille' && MODELS[0].name === 'Pepe', 'Pepe ouvre le catalogue');
dit(MODELS.find((m) => m.id === 'char-captainleeky')?.name === 'CyberLeek', 'Captain Leeky s\'appelle desormais CyberLeek');
dit(B.LIEN_SUIVI === 'https://play.babyguy.dev/api/suivi', `le lien du suivi en direct : ${B.LIEN_SUIVI}`);
dit(/buys and burns BG/.test(B.NOTE_REVENUS), `la promesse est ecrite : « ${B.NOTE_REVENUS} »`);

console.log('\n\x1b[1mLes prix sont ceux du backend\x1b[0m');
{
  // Le backend est la source ; on lit son fichier tel quel plutot que de l'importer, parce
  // que son import charge la configuration et la chaine.
  const source = readFileSync(path.resolve('..', '..', 'backend', 'src', 'boutique.js'), 'utf8');
  for (const a of payants) {
    const m = new RegExp(`'${a.id}':\\s*\\{\\s*prix:\\s*(\\d+)\\s*\\*\\s*MICROS`).exec(source);
    dit(m && Number(m[1]) * 1_000_000 === a.prixMicros, `${a.id} : ${a.prix} des deux cotes`);
  }
}

console.log('\n\x1b[1mLe verrou retient, il n\'autorise pas\x1b[0m');
dit(B.estDebloque('char-babytrump') === false, 'BabyTrump : verrouille au premier lancement');
for (const id of B.PAYANTS) dit(B.estDebloque(id) === false, `${id} : verrouille, il coute des USDC`);
dit(B.estDebloque('char-grenouille') === true, 'Pepe : libre, il n\'a jamais ete en boutique');
dit(B.estDebloque('char-inconnu-relaye-par-le-serveur') === true,
  'un identifiant inconnu passe : le verrou porte sur ce que J\'EQUIPE, pas sur ce qu\'un adversaire affiche');
dit(B.verrouilles().length === 5, `il reste 5 articles a prendre : ${B.verrouilles().join(', ')}`);

console.log('\n\x1b[1mLe cadeau : une boite, un clic, et il est a lui\x1b[0m');
{
  dit(B.cadeauEnAttente() === true && B.estDebloque(B.CADEAU) === false, 'au premier lancement, la boite attend d\'etre ouverte');
  dit(cosmetics.setModel(B.CADEAU) === false, 'et le catalogue refuse de l\'equiper avant');
  dit(B.recevoirCadeau('char-techtitan').ok === false, 'recevoir un skin PAYANT en cadeau : refuse, ce n\'est pas un cadeau');
  const r = B.recevoirCadeau();
  dit(r.ok === true && r.deja === undefined && B.estDebloque(B.CADEAU) === true, 'ouvrir la boite : recu, tout de suite, sans delai ni preuve');
  dit(B.recevoirCadeau().deja === true, 'l\'ouvrir a nouveau : deja recu');
  dit(B.cadeauEnAttente() === false, 'la boite n\'attend plus');
  dit(cosmetics.setModel(B.CADEAU) === true && cosmetics.model === B.CADEAU, 'le catalogue accepte maintenant BabyVlad');
  dit(B.verrouilles().length === 4, `il reste 4 articles : ${B.verrouilles().join(', ')}`);
  cosmetics.setModel('char-grenouille');
}

console.log('\n\x1b[1mLe defaut du catalogue est Pepe\x1b[0m');
dit(cosmetics.model === 'char-grenouille', `sans choix memorise, on porte ${cosmetics.model}`);
dit(cosmetics.setModel('char-babytrump') === false && cosmetics.setModel('char-techtitan') === false, 'equiper un personnage non possede : refuse');
dit(cosmetics.model === 'char-grenouille', 'et le refus ne change rien a ce qu\'on porte');

console.log('\n\x1b[1mUn skin payant : le backend dit, le banc tolere\x1b[0m');
{
  B.poserServeur({ argent: true, possessions: [] });
  dit(B.estDebloque('char-techtitan') === false, 'avec de l\'argent derriere le serveur et rien d\'achete : verrouille');
  B.poserServeur({ possessions: ['char-techtitan'] });
  dit(B.estDebloque('char-techtitan') === true && B.estDebloque('char-diplomate') === false,
    'le backend dit « BabyMusk possede » : lui seul s\'ouvre');
  dit(cosmetics.setModel('char-techtitan') === true && cosmetics.model === 'char-techtitan', 'et il s\'equipe');
  B.poserServeur({ possessions: [] });
  dit(cosmetics.model === 'char-grenouille', 'si le backend le retire, ce qu\'on porte retombe sur Pepe tout seul');
  // Le banc : un dossier local, et un serveur sans argent.
  B.reinitialiser();
  localStorage.setItem(B.dossierDeBanc().cle, B.dossierDeBanc().valeur);
  const B2 = await import(src('boutique.js') + '?banc');
  dit(B2.estDebloque('char-techtitan') === true && B2.estDebloque('char-babytrump') === true,
    'sur un banc (serveur muet sur l\'argent), le dossier local habille tout');
  B2.poserServeur({ argent: true });
  dit(B2.estDebloque('char-techtitan') === false && B2.estDebloque('char-babytrump') === true,
    'des que le serveur dit qu\'il y a de l\'argent, le dossier local ne vaut plus pour un skin payant — le post, si');
  B.reinitialiser();
}

console.log('\n\x1b[1mLe post\x1b[0m');
{
  const lien = new URL(B.lienDePost());
  const p = lien.searchParams;
  dit(lien.origin + lien.pathname === 'https://x.com/intent/post', `intention : ${lien.origin}${lien.pathname}`);
  dit(p.get('text').includes('Baby Guys') && p.get('text').includes('BabyTrump'), 'le texte nomme le jeu et le skin');
  dit(p.get('hashtags') === 'BabyGuys,BabyTrump', `hashtags : ${p.get('hashtags')}`);
  dit(p.get('url') === 'https://play.babyguy.dev' && !p.has('via'), `le post porte le lien PUBLIE du jeu, sans compte X : ${p.get('url')}`);
  dit(p.get('text').length < 280, `le texte tient dans un post : ${p.get('text').length} caracteres`);
}

console.log('\n\x1b[1mLa reclamation, et ses trois refus\x1b[0m');
{
  const T = 1_000_000;
  dit(B.reclamer('char-techtitan', T).raison === 'inconnu', 'reclamer un skin PAYANT par le chemin du post : inconnu');
  dit(B.marquerEnvoi('char-techtitan', T) === false, 'et partir sur X pour un skin payant est sans objet');
  dit(B.reclamer('char-babytrump', T).raison === 'jamais-envoye', 'reclamer sans etre passe par X : jamais-envoye');
  dit(B.marquerEnvoi('char-babytrump', T) === true && B.enAttente('char-babytrump') === true, 'depart vers X note');
  const tot = B.reclamer('char-babytrump', T + 3000);
  dit(tot.ok === false && tot.raison === 'trop-tot' && tot.reste === 5000, `reclamer 3 s apres : trop-tot, encore ${tot.reste} ms`);
  const ok = B.reclamer('char-babytrump', T + 8000);
  dit(ok.ok === true && B.estDebloque('char-babytrump') === true, 'reclamer a 8 s : accepte, BabyTrump debloque');
  dit(B.reclamer('char-babytrump', T + 9000).deja === true, 'reclamer une seconde fois : deja possede');
  // La memoire a ete remise a neuf plus haut : le cadeau attend a nouveau, avec les trois payants.
  dit(B.verrouilles().length === 4, `il reste les trois skins payants et le cadeau : ${B.verrouilles().join(', ')}`);
  dit(cosmetics.setModel('char-babytrump') === true && cosmetics.model === 'char-babytrump', 'le catalogue accepte maintenant de l\'equiper');
}

console.log('\n\x1b[1mLa memoire, et le banc\x1b[0m');
{
  const d = B.dossierDeBanc();
  dit(d.cle === 'tumble-boutique' && JSON.parse(d.valeur).debloques.length === 5, 'le dossier de banc possede les cinq articles');
  B.reinitialiser();
  dit(B.estDebloque('char-babytrump') === false && localStorage.getItem('tumble-boutique') === '{"debloques":[],"envois":{}}',
    'reinitialiser : la campagne se rejoue, la memoire locale le dit');
}

console.log(`\n--- ${echecs === 0 ? 'la boutique ne donne que ce qui a ete gagne ou paye' : `${echecs} ecart(s)`} ---`);
process.exit(echecs === 0 ? 0 : 1);
