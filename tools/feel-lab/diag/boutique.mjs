/**
 * Verdict sur la BOUTIQUE — le second diagnostic du dossier qui n'ouvre pas de navigateur,
 * parce qu'il ne juge pas une image mais une règle de possession.
 *
 * Ce qu'il tient, et pourquoi chacun compte :
 *
 *   - la boutique n'a QU'UN article, et c'est BabyTrump. Une deuxième ligne apparue par
 *     erreur mettrait un cadenas sur un personnage que personne n'a demandé à retirer ;
 *   - un personnage HORS boutique reste portable. Le verrou retient, il n'autorise pas :
 *     le jour où il autoriserait, tout le catalogue se fermerait d'un coup ;
 *   - le post part avec le texte, les hashtags, et RIEN d'autre tant que le DNS n'existe
 *     pas. Un `url=` vide dans l'intention enverrait les curieux sur une page morte ;
 *   - la réclamation refuse pour TROIS raisons distinctes, et une seule se répare en
 *     attendant. Un « non » unique ne dirait pas au joueur laquelle ;
 *   - le catalogue ne peut pas équiper un personnage non possédé, et son DÉFAUT n'est
 *     jamais celui-là. C'est le point qui casse le plus silencieusement : `MODELS[0]` est
 *     BabyTrump, et un défaut posé dessus aurait affiché « EQUIPPED » sous un cadenas ;
 *   - le dossier de banc rouvre la porte aux harnais, sinon les deux navigateurs de
 *     `duel.mjs` porteraient le même personnage sans que rien ne le signale.
 *
 * Les valeurs attendues sont posées à la main. Un test qui rejoue le calcul du code testé
 * ne teste rien.
 *
 * Usage : node diag/boutique.mjs
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// `boutique.js` et `cosmetics.js` lisent la memoire du navigateur des leur chargement.
// Sous Node elle n'existe pas : on leur en donne une, plutot que d'eclater les modules
// en deux pour les besoins du test. Elle est VIDE au depart — c'est l'etat d'un joueur
// qui ouvre le jeu pour la premiere fois, et c'est celui qu'on veut juger.
const memoire = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
  setItem: (k, v) => memoire.set(k, String(v)),
  removeItem: (k) => memoire.delete(k),
};

const src = (f) => pathToFileURL(path.resolve('src', f)).href;
const B = await import(src('boutique.js'));
// IMPORTE APRES, et volontairement : le catalogue calcule son defaut au chargement, donc
// il doit le calculer alors que BabyTrump est encore verrouille. L'importer avant aurait
// mesure une situation qui n'arrive jamais chez un joueur.
const { cosmetics, MODELS } = await import(src('cosmetics.js'));

let echecs = 0;
const dit = (ok, texte) => {
  if (!ok) echecs++;
  console.log(`${ok ? 'OK  ' : 'ECHEC'} ${texte}`);
};

console.log('\n\x1b[1mLe catalogue de la boutique\x1b[0m');
dit(B.ARTICLES.length === 1, `un seul article en vente : ${B.ARTICLES.length}`);
dit(B.ARTICLES[0].id === 'char-babytrump', `et c'est ${B.ARTICLES[0].id}`);
dit(B.ARTICLES[0].prix === 'FREE', 'il ne coute pas d\'argent — il coute un post');
dit(B.articleDe('char-babytrump') !== null && B.articleDe('char-techtitan') === null,
  'BabyTrump est en boutique, BabyMusk non');
dit(MODELS[0].id === 'char-babytrump',
  'BabyTrump reste en tete du catalogue : c\'est la tete de gondole, cadenas compris');

console.log('\n\x1b[1mLe verrou retient, il n\'autorise pas\x1b[0m');
dit(B.estDebloque('char-babytrump') === false, 'BabyTrump : verrouille au premier lancement');
for (const id of ['char-techtitan', 'char-grenouille', 'char-diplomate', 'char-captainleeky']) {
  dit(B.estDebloque(id) === true, `${id} : libre, il n'a jamais ete en boutique`);
}
dit(B.estDebloque('char-inconnu-relaye-par-le-serveur') === true,
  'un identifiant inconnu passe : le verrou porte sur ce que J\'EQUIPE, pas sur ce qu\'un adversaire affiche');
dit(String(B.verrouilles()) === 'char-babytrump', `il reste 1 article a prendre : ${B.verrouilles().join(', ')}`);

console.log('\n\x1b[1mLe defaut du catalogue evite le cadenas\x1b[0m');
dit(cosmetics.model === 'char-techtitan',
  `sans choix memorise, on porte ${cosmetics.model} — le premier PORTABLE, pas le premier tout court`);
dit(cosmetics.setModel('char-babytrump') === false, 'equiper un personnage non possede : refuse');
dit(cosmetics.model === 'char-techtitan', 'et le refus ne change rien a ce qu\'on porte');
dit(cosmetics.setModel('char-grenouille') === true && cosmetics.model === 'char-grenouille',
  'equiper un personnage libre : accepte');

console.log('\n\x1b[1mLe post\x1b[0m');
{
  const lien = new URL(B.lienDePost());
  const p = lien.searchParams;
  dit(lien.origin + lien.pathname === 'https://x.com/intent/post',
    `intention : ${lien.origin}${lien.pathname}`);
  dit(p.get('text').includes('Baby Guys'), 'le texte nomme le jeu tel qu\'il est peint sur le logo');
  dit(p.get('text').includes('BabyTrump'), 'et dit ce que la personne vient de debloquer');
  dit(p.get('hashtags') === 'BabyGuys,BabyTrump', `hashtags : ${p.get('hashtags')}`);
  // Le domaine existe depuis le 4 septembre 2026 : le post porte le lien du jeu, et
  // seulement lui — aucun compte X n'est ouvert, donc pas de `via=`.
  dit(p.get('url') === 'https://play.babyguy.dev' && B.LIEN === p.get('url'),
    `le post porte le lien PUBLIE du jeu : ${p.get('url')}`);
  dit(!p.has('via') && B.COMPTE_X === '',
    'et aucun compte X tant qu\'il n\'en existe pas — a renseigner dans COMPTE_X le jour venu');
  dit(p.get('text').length < 280, `le texte tient dans un post : ${p.get('text').length} caracteres`);
  dit(B.apercuDuPost().includes('#BabyGuys'),
    'l\'apercu montre les hashtags, que l\'intention transporte a part');
}

console.log('\n\x1b[1mLa reclamation, et ses trois refus\x1b[0m');
{
  const T = 1_000_000;   // un instant arbitraire : le module ne lit jamais l'horloge lui-meme
  dit(B.reclamer('char-techtitan', T).raison === 'inconnu',
    'reclamer un personnage qui n\'est pas en boutique : inconnu');
  dit(B.reclamer('char-babytrump', T).raison === 'jamais-envoye',
    'reclamer sans etre passe par X : jamais-envoye');
  dit(B.attenteRestante('char-babytrump', T) === B.DELAI_MS,
    `avant tout depart, l'attente vaut le delai entier : ${B.DELAI_MS} ms`);
  dit(B.enAttente('char-babytrump') === false, 'et rien n\'est en attente');

  dit(B.marquerEnvoi('char-babytrump', T) === true, 'depart vers X note');
  dit(B.enAttente('char-babytrump') === true, 'l\'article passe en attente de reclamation');
  const tot = B.reclamer('char-babytrump', T + 3000);
  dit(tot.ok === false && tot.raison === 'trop-tot' && tot.reste === 5000,
    `reclamer 3 s apres : trop-tot, encore ${tot.reste} ms — le seul refus qui se repare en attendant`);
  dit(B.estDebloque('char-babytrump') === false, 'et le refus n\'a rien debloque');

  dit(B.attenteRestante('char-babytrump', T + 8000) === 0, 'a 8 s pile, l\'attente est finie');
  const ok = B.reclamer('char-babytrump', T + 8000);
  dit(ok.ok === true && !ok.deja, 'reclamer a 8 s : accepte');
  dit(B.estDebloque('char-babytrump') === true, 'BabyTrump est debloque');
  dit(B.enAttente('char-babytrump') === false, 'et il n\'est plus en attente : le depart est consomme');
  dit(B.reclamer('char-babytrump', T + 9000).deja === true,
    'reclamer une seconde fois : deja possede, et ce n\'est pas une erreur');
  dit(String(B.verrouilles()) === '', 'plus rien a prendre : la pastille du bouton SHOP s\'efface');
}

console.log('\n\x1b[1mCe qui change une fois possede\x1b[0m');
dit(cosmetics.setModel('char-babytrump') === true && cosmetics.model === 'char-babytrump',
  'le catalogue accepte maintenant de l\'equiper');
dit(B.marquerEnvoi('char-babytrump') === false,
  'et un nouveau depart vers X est sans objet : on ne repaie pas ce qu\'on a');

console.log('\n\x1b[1mLa memoire, et le banc\x1b[0m');
{
  const ecrit = JSON.parse(localStorage.getItem('tumble-boutique'));
  dit(String(ecrit.debloques) === 'char-babytrump' && Object.keys(ecrit.envois).length === 0,
    'la possession est ecrite en memoire locale, le depart consomme n\'y est plus');

  const d = B.dossierDeBanc();
  dit(d.cle === 'tumble-boutique', `le banc ecrit sous la meme cle : ${d.cle}`);
  dit(String(JSON.parse(d.valeur).debloques) === 'char-babytrump',
    'et son dossier possede tout le catalogue de la boutique');

  B.reinitialiser();
  dit(B.estDebloque('char-babytrump') === false, 'reinitialiser : la campagne se rejoue');
  dit(localStorage.getItem('tumble-boutique') === '{"debloques":[],"envois":{}}',
    'et la memoire locale le dit aussi');
}

console.log(`\n--- ${echecs === 0 ? 'la boutique ne donne que ce qui a ete gagne' : `${echecs} ecart(s)`} ---`);
process.exit(echecs === 0 ? 0 : 1);
