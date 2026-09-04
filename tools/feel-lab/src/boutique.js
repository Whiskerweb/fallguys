/**
 * LA BOUTIQUE — un seul article, et il ne coûte pas d'argent : il coûte un post.
 *
 * Décision produit du 2 septembre 2026 : le premier objet cosmétique du jeu ne s'achète
 * pas, il se GAGNE en parlant du jeu. BabyTrump sort du catalogue de départ et entre dans
 * la boutique ; pour le porter, le joueur publie un post sur X. C'est le seul canal
 * d'acquisition prévu pour l'instant — d'où « nul autre personnage que BabyTrump » : la
 * boutique n'a qu'une ligne, et une boutique qui montre des cases vides promet ce qu'elle
 * n'a pas.
 *
 * CE MODULE NE TOUCHE NI AU DOM NI AU RÉSEAU. Il tient l'état (qui possède quoi, qui a
 * ouvert X et quand), fabrique le lien d'intention, et tranche la réclamation. Le dessin
 * est dans `lobbyui.js`, exactement comme `economie.js` ne dessine pas le ticket. C'est
 * aussi ce qui permet à `diag/boutique.mjs` de le juger sans navigateur.
 *
 * ── CE QUI EST DÉCLARATIF, ET POURQUOI ON L'ASSUME ────────────────────────────────
 *
 * Rien ici ne PROUVE que le post existe. Le joueur ouvre X, revient, et affirme l'avoir
 * publié. Une vraie vérification demande l'API X (OAuth 2.0, portée `tweet.read`, puis
 * recherche des posts récents de l'auteur), donc un compte X applicatif, un domaine de
 * redirection — et le DNS n'existe pas encore. Elle devra vivre dans `backend/`, pas ici :
 * un client qui se déclare propriétaire de quelque chose n'est jamais une preuve.
 *
 * Ce qui rend l'attente tenable, c'est l'ENJEU : un cosmétique, aucun centime. Rien de ce
 * fichier ne touche au grand livre, à la mise ni au gain. Le jour où un objet de boutique
 * vaudra de l'argent, cette porte devra être fermée AVANT — et ce jour-là c'est
 * `reclamer()` qui appellera le backend, sans que le reste du jeu bouge.
 */

/**
 * Le nom du jeu tel que le joueur le lit sur le logo, pas celui de la spec.
 *
 * Le dépôt s'appelle « Tumble » et l'écran affiche « Baby Guys ». Un post est du
 * marketing : il doit nommer ce qui est peint sur la porte. Le jour où l'un des deux
 * l'emporte, c'est cette ligne qui change, et elle seule.
 */
export const JEU = 'Baby Guys';

/**
 * Le lien du jeu, et le compte X du jeu.
 *
 * `LIEN` est l'adresse PUBLIÉE du jeu, `https://play.babyguy.dev`, depuis que le domaine
 * pointe dessus (4 septembre 2026, certificat émis, `deploy/fly/deployer.sh`). Il est
 * resté vide tant qu'aucun DNS n'existait — demande explicite du directeur produit : une
 * URL bidon aurait envoyé les premiers curieux sur une page morte, et c'est le seul clic
 * qu'ils feront. `lienDePost()` ajoute `url=` d'elle-même, et X raccourcit le lien à ~23
 * caractères dans son compte de 280.
 *
 * `COMPTE_X` reste VIDE : aucun compte X du jeu n'est ouvert. Le jour où il l'est, le
 * renseigner suffit, `via=` suit.
 */
export const LIEN = 'https://play.babyguy.dev';
export const COMPTE_X = '';

/**
 * Le délai minimal entre l'ouverture de X et la réclamation.
 *
 * Ce n'est pas une preuve — rien ici n'en est une — c'est une friction. Sans elle,
 * « UNLOCK » puis « I POSTED IT » s'enchaînent en deux clics sans que l'onglet X ait eu
 * le temps de s'afficher, et le geste entier devient décoratif. Huit secondes, c'est le
 * temps de lire le post et d'appuyer sur Publier ; au-delà on punirait quelqu'un qui l'a
 * vraiment fait.
 */
export const DELAI_MS = 8000;

/**
 * Les articles. UN SEUL, et c'est le sujet de la campagne.
 *
 * `id` est celui du catalogue de `cosmetics.js` : la boutique ne redécrit pas le
 * personnage (nom, rareté, portrait, description vivent là-bas et nulle part ailleurs),
 * elle dit seulement à quelle condition il s'obtient. C'est aussi pour cela que ce module
 * n'importe PAS `cosmetics.js` : le catalogue lit la boutique pour savoir ce qui est
 * verrouillé, et deux modules qui s'importent l'un l'autre finissent par se charger dans
 * le mauvais ordre.
 */
export const ARTICLES = [
  {
    id: 'char-babytrump',
    condition: 'post',
    prix: 'FREE',
    accroche: 'One post on X. One skin.',
    // Ce que la carte explique avant le clic : le joueur doit savoir qu'un onglet va
    // s'ouvrir et que le texte est déjà écrit, sinon « UNLOCK » ressemble à un achat.
    detail: 'We open X with the post already written. Publish it, come back, and BabyTrump is yours.',
    /*
     * Le texte du post. Trois lignes, dans cet ordre : ce qu'est le jeu, ce qui s'y
     * joue, et ce que la personne vient de faire — c'est cette dernière qui donne au
     * lecteur une raison de cliquer plutôt qu'un communiqué.
     *
     * Pas d'URL ici : le lien passe par le paramètre `url` de l'intention, que X place et
     * raccourcit lui-même. Écrit dans le texte, il serait compté en entier.
     */
    texte: (jeu) => [
      `I'm playing ${jeu} — the browser party game where the obstacle course pays out in real USDC.`,
      '',
      '5 courses, up to 16 babies, and a wheel that spins at the finish line.',
      '',
      'Just unlocked my BabyTrump skin. 👶',
    ].join('\n'),
    tags: ['BabyGuys', 'BabyTrump'],
  },
];

/** L'article correspondant à un personnage, ou `null` s'il n'est pas en boutique. */
export const articleDe = (id) => ARTICLES.find((a) => a.id === id) ?? null;

// ---------- ce que le joueur possède ----------

const CLE = 'tumble-boutique';

/*
 * L'état tient en deux champs et il est PERSISTANT.
 *
 *   - `debloques` : ce qui est acquis, pour toujours ;
 *   - `envois`    : quand X a été ouvert pour tel article. Il survit au rechargement
 *     exprès — un joueur qui publie son post depuis l'onglet X, ferme le jeu par erreur
 *     et revient doit pouvoir réclamer. Sans ça, le seul chemin d'acquisition du jeu se
 *     perdrait sur un F5, et il n'y a personne pour le lui redonner.
 *
 * En mémoire locale, donc PAR NAVIGATEUR. C'est la limite assumée de l'étape : le jour où
 * les comptes portent les cosmétiques, `charger`/`enregistrer` deviendront deux appels au
 * backend et rien d'autre ne bougera.
 */
function charger() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) ?? '{}');
    return {
      debloques: Array.isArray(brut.debloques) ? brut.debloques.filter((x) => typeof x === 'string') : [],
      envois: (brut.envois && typeof brut.envois === 'object') ? brut.envois : {},
    };
  } catch {
    // Une mémoire locale illisible (quota, navigation privée, valeur corrompue par une
    // version précédente) ne doit pas empêcher le lobby de s'ouvrir : on repart à vide.
    return { debloques: [], envois: {} };
  }
}

let etat = charger();
const auditeurs = new Set();

function enregistrer() {
  try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch { /* rien à faire de plus */ }
  for (const fn of auditeurs) fn(etat);
}

/** Prévenu à chaque déblocage et à chaque départ vers X. Rend de quoi se désabonner. */
export function surChangement(fn) { auditeurs.add(fn); return () => auditeurs.delete(fn); }

/**
 * Un personnage est-il portable ?
 *
 * TOUT CE QUI N'EST PAS EN BOUTIQUE EST DÉBLOQUÉ. C'est le sens de la règle, et l'ordre
 * des tests le dit : la boutique retient, elle n'autorise pas. Un identifiant inconnu —
 * un personnage retiré du catalogue, un modèle relayé par le serveur — passe donc, et
 * c'est voulu : le verrou porte sur CE QUE MOI je peux équiper, jamais sur ce qu'un autre
 * joueur affiche à l'écran. Un adversaire qui a débloqué BabyTrump doit s'afficher en
 * BabyTrump chez tout le monde.
 */
export function estDebloque(id) {
  if (!articleDe(id)) return true;
  return etat.debloques.includes(id);
}

/** Les articles encore verrouillés, dans l'ordre de la boutique. */
export const verrouilles = () => ARTICLES.filter((a) => !estDebloque(a.id)).map((a) => a.id);

// ---------- le post ----------

/**
 * L'adresse d'intention de X, texte déjà rempli.
 *
 * `x.com/intent/post` est la forme actuelle ; `twitter.com/intent/tweet` y redirige encore
 * mais fait un saut de domaine de plus, et un saut de plus est un endroit de plus où un
 * bloqueur intervient. Les hashtags voyagent dans `hashtags`, le lien dans `url`, le
 * compte dans `via` : X sait les placer et les compter, un texte qui les contiendrait déjà
 * les ferait apparaître deux fois le jour où ces constantes seront renseignées.
 */
export function lienDePost(article = ARTICLES[0], jeu = JEU) {
  const p = new URLSearchParams({ text: article.texte(jeu) });
  if (article.tags?.length) p.set('hashtags', article.tags.join(','));
  if (LIEN) p.set('url', LIEN);
  if (COMPTE_X) p.set('via', COMPTE_X.replace(/^@/, ''));
  return `https://x.com/intent/post?${p.toString()}`;
}

/** Le texte tel qu'il apparaîtra, hashtags compris — pour le montrer avant le clic. */
export function apercuDuPost(article = ARTICLES[0], jeu = JEU) {
  const tags = (article.tags ?? []).map((t) => `#${t}`).join(' ');
  return [article.texte(jeu), tags, LIEN].filter(Boolean).join('\n');
}

/**
 * Note que le joueur est parti publier. C'est ce qui ouvre la fenêtre de réclamation.
 *
 * Appelée par les DEUX chemins — la fenêtre ouverte par le jeu et le lien de secours que
 * le joueur clique lui-même quand son navigateur a bloqué la fenêtre. Un joueur dont le
 * bloqueur de pop-ups est actif publie exactement comme les autres ; il ne doit pas se
 * retrouver devant un bouton de réclamation qui refuse à jamais.
 */
export function marquerEnvoi(id, maintenant = Date.now()) {
  if (!articleDe(id) || estDebloque(id)) return false;
  etat.envois[id] = maintenant;
  enregistrer();
  return true;
}

/** Millisecondes restantes avant que la réclamation soit ouverte. 0 = c'est ouvert. */
export function attenteRestante(id, maintenant = Date.now()) {
  const parti = etat.envois[id];
  if (!parti) return DELAI_MS;
  return Math.max(0, DELAI_MS - (maintenant - parti));
}

/** Le joueur est-il déjà parti publier pour cet article ? */
export const enAttente = (id) => Boolean(etat.envois[id]) && !estDebloque(id);

/**
 * La réclamation. Rend `{ ok }` ou `{ ok: false, raison }` — jamais une exception.
 *
 * Trois refus possibles, et ils disent trois choses différentes au joueur : cet article
 * n'existe pas, tu n'es pas passé par X, tu n'as pas laissé le temps au post de partir.
 * Un seul « non » les confondrait, et le troisième est le seul qui se répare en attendant.
 */
export function reclamer(id, maintenant = Date.now()) {
  const article = articleDe(id);
  if (!article) return { ok: false, raison: 'inconnu' };
  if (estDebloque(id)) return { ok: true, deja: true };
  if (!etat.envois[id]) return { ok: false, raison: 'jamais-envoye' };
  const reste = attenteRestante(id, maintenant);
  if (reste > 0) return { ok: false, raison: 'trop-tot', reste };

  etat.debloques.push(id);
  delete etat.envois[id];
  enregistrer();
  return { ok: true };
}

/**
 * LE DOSSIER DE POSSESSION D'UN BANC, prêt à poser dans la mémoire d'un navigateur.
 *
 * Une dizaine de harnais réclament un personnage précis en écrivant `tumble-model` AVANT
 * le chargement, et six d'entre eux réclament BabyTrump. Depuis qu'il est en boutique, le
 * catalogue refuse de l'équiper et la machine repart avec le suivant — SANS un mot. Les
 * deux navigateurs de `duel.mjs` porteraient alors le même personnage, et le verdict
 * d'apparence, qui existe précisément parce que « deux valeurs identiques ne peuvent pas
 * être en désaccord », ne prouverait plus rien.
 *
 * Le banc pose donc la possession en même temps que le choix. La forme du dossier sort
 * d'ici et de nulle part ailleurs : recopiée dans dix harnais, elle se serait tue le jour
 * où elle aurait changé.
 */
export function dossierDeBanc(ids = ARTICLES.map((a) => a.id)) {
  return { cle: CLE, valeur: JSON.stringify({ debloques: [...ids], envois: {} }) };
}

/**
 * Remet la boutique à neuf. Pour le banc, et pour rejouer la campagne d'une machine.
 *
 * Rien ne l'appelle dans le jeu : un joueur ne rend pas un cosmétique. Elle existe parce
 * que le seul moyen de revoir l'écran de déblocage, une fois débloqué, serait sinon de
 * vider la mémoire du navigateur à la main.
 */
export function reinitialiser() {
  etat = { debloques: [], envois: {} };
  enregistrer();
}
