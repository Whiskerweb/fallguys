/**
 * LA BOUTIQUE — quatre skins, deux façons de les obtenir, et chaque USDG part au brûlage.
 *
 * Décision produit du 5 septembre 2026, qui agrandit celle du 2 : on commence avec PEPE,
 * gratuit ; BabyTrump se GAGNE toujours en publiant un post sur X ; BabyMusk (Elon),
 * BabyNetan (Netanyahou) et CyberLeek s'ACHÈTENT, entre 10 et 15 USDG. « Tous les revenus
 * liés serviront à buy and burn le token » : le prix va du wallet de jeu du joueur au
 * wallet des FRAIS, le même que le rake, et le brûlage l'y trouve. La page de suivi en
 * direct (`LIEN_SUIVI`) le montre, et la boutique y renvoie.
 *
 * CE MODULE NE TOUCHE NI AU DOM NI AU RÉSEAU. Il tient l'état (qui possède quoi, qui a
 * ouvert X et quand), fabrique le lien d'intention, et tranche la réclamation du post.
 * Le dessin est dans `lobbyui.js`, exactement comme `economie.js` ne dessine pas le
 * ticket. C'est aussi ce qui permet à `diag/boutique.mjs` de le juger sans navigateur.
 *
 * ── DEUX RÈGLES DE POSSESSION, ET ELLES NE SE RESSEMBLENT PAS ────────────────────
 *
 * Le POST est déclaratif : rien ici ne PROUVE qu'il existe. Le joueur ouvre X, revient,
 * et affirme l'avoir publié. Une vraie vérification demande l'API X, donc un compte X
 * applicatif — elle devra vivre dans `backend/`. Ce qui rend l'attente tenable, c'est
 * l'ENJEU : un cosmétique, aucun centime.
 *
 * L'ACHAT, lui, vaut de l'argent, et la porte est fermée AVANT : le navigateur ne dit
 * jamais un prix, il dit un article ; le backend le fait payer (`POST /boutique/
 * acheter`), et c'est LUI qui dit ce qu'on possède (`/moi` → `possessions`, posé ici par
 * `poserServeur`). La mémoire locale ne fait foi pour un skin payant QUE sur un banc —
 * un serveur sans argent derrière lui — pour que les harnais puissent l'habiller. Sur le
 * serveur de production, elle ne vaut rien.
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

/** Où l'on voit les revenus partir au brûlage, en direct. Demande du directeur produit. */
export const LIEN_SUIVI = 'https://play.babyguy.dev/api/suivi';

/** Ce que la boutique dit de l'argent, sous chaque prix. */
export const NOTE_REVENUS = '100% of skin revenue buys and burns BG, the Baby Guy token.';

/** 1 USDG en micros — la même échelle que le backend, sans importer `economie.js`. */
const MICROS = 1_000_000;

/**
 * Les articles, dans l'ordre de la vitrine.
 *
 * `id` est celui du catalogue de `cosmetics.js` : la boutique ne redécrit pas le
 * personnage (nom, rareté, portrait, description vivent là-bas et nulle part ailleurs),
 * elle dit seulement à quelle condition il s'obtient. C'est aussi pour cela que ce module
 * n'importe PAS `cosmetics.js` : le catalogue lit la boutique pour savoir ce qui est
 * verrouillé, et deux modules qui s'importent l'un l'autre finissent par se charger dans
 * le mauvais ordre.
 *
 * Les PRIX sont ceux de `backend/src/boutique.js`, recopiés pour l'affichage ; c'est le
 * backend qui fait foi et qui encaisse. `diag/boutique.mjs` vérifie que les deux disent
 * la même chose.
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
      `I'm playing ${jeu} — the browser party game where the obstacle course pays out in real USDG.`,
      '',
      '5 courses, up to 16 babies, and a wheel that spins at the finish line.',
      '',
      'Just unlocked my BabyTrump skin. 👶',
    ].join('\n'),
    tags: ['BabyGuys', 'BabyTrump'],
  },
  {
    id: 'char-techtitan', condition: 'achat', prixMicros: 15 * MICROS, prix: '15 USDG',
    accroche: 'Orbital ambitions, matching diaper.',
    detail: 'Paid from your game wallet. Every USDG goes to the fee wallet and burns BG.',
  },
  {
    id: 'char-diplomate', condition: 'achat', prixMicros: 12 * MICROS, prix: '12 USDG',
    accroche: 'He negotiates at a sprint.',
    detail: 'Paid from your game wallet. Every USDG goes to the fee wallet and burns BG.',
  },
  {
    id: 'char-captainleeky', condition: 'achat', prixMicros: 10 * MICROS, prix: '10 USDG',
    accroche: 'Three leaves, one mission.',
    detail: 'Paid from your game wallet. Every USDG goes to the fee wallet and burns BG.',
  },
  /*
   * LE CADEAU DE BIENVENUE — BabyVlad (`char-tinytrader`), decision du directeur produit
   * du 5 septembre 2026 : « quand il arrive, il ait un cadeau qui s'affiche, il doit
   * cliquer pour l'ouvrir et quand il ouvre il unlock le skin babyvlad ».
   *
   * Il ne s'achete pas et ne se gagne pas : il s'OUVRE. A la premiere arrivee dans le
   * lobby, une boite cadeau plein ecran attend un clic (`cadeau.js`) ; l'ouvrir donne le
   * skin et l'equipe. C'est le premier geste du joueur dans le jeu, et il est fait pour
   * qu'il GAGNE quelque chose avant qu'on lui parle d'argent — l'ecran d'apres est celui
   * du depot. Declaratif et local, comme le post : un cosmetique, aucun centime, donc la
   * memoire du navigateur suffit. Un nouveau navigateur rouvre le cadeau : ce n'est pas
   * une faille, c'est un skin gratuit.
   *
   * Il avait ete mis en vente a 10 USDG quelques minutes plus tot par une autre session,
   * qui l'ecrivait « decision produit » ; celle-ci est la vraie, et elle l'emporte.
   * Sans cette ligne il serait gratuit d'office (`estDebloque` rend `true` pour ce qui
   * n'est pas en boutique) — mais sans cadeau non plus : c'est la ligne qui fait qu'on
   * l'OFFRE au lieu de le laisser trainer dans la garde-robe.
   *
   * En boutique, sa carte dit « OPEN YOUR GIFT » tant que la boite n'est pas ouverte, et
   * la rouvre. Dernier de la vitrine : on n'y vend rien, on y rappelle qu'on l'a recu.
   */
  {
    id: 'char-tinytrader', condition: 'cadeau', prix: 'GIFT',
    accroche: 'Your welcome gift.',
    detail: 'Every new player gets him. Open the box and he is yours for good.',
  },
];

/** L'article offert a l'arrivee. `cadeau.js` et la boutique le nomment par ici, jamais en dur. */
export const CADEAU = 'char-tinytrader';

/** Les articles qui coûtent des USDG — ceux que le backend encaisse et dont il dit la possession. */
export const PAYANTS = ARTICLES.filter((a) => a.condition === 'achat').map((a) => a.id);

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

/*
 * CE QUE LE SERVEUR DIT. `argent` : y a-t-il de l'argent derrière le serveur de jeu ? Tant
 * qu'il n'a rien dit — ou qu'il dit non, un banc —, la mémoire locale vaut pour les skins
 * payants aussi : c'est ce qui laisse les harnais s'habiller. Dès qu'il dit oui,
 * `possessions` (le backend, par `/moi`) est la seule vérité pour un achat.
 */
let serveur = { argent: false, possessions: [] };

/** Posé par la caisse : à `bienvenue` (argent), et à chaque relecture du profil (possessions). */
export function poserServeur({ argent, possessions } = {}) {
  if (argent !== undefined) serveur.argent = Boolean(argent);
  if (Array.isArray(possessions)) serveur.possessions = possessions.filter((x) => typeof x === 'string');
  for (const fn of auditeurs) fn(etat);
}

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
  const a = articleDe(id);
  if (!a) return true;
  if (a.condition === 'achat') {
    if (serveur.possessions.includes(id)) return true;
    return !serveur.argent && etat.debloques.includes(id);
  }
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
  if (articleDe(id)?.condition !== 'post' || estDebloque(id)) return false;
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
  if (!article || article.condition !== 'post') return { ok: false, raison: 'inconnu' };
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
 * Reçoit le cadeau de bienvenue. Rend `{ ok }`, `{ ok, deja }`, ou `{ ok: false, raison }`.
 *
 * Le seul chemin par lequel un article `cadeau` se débloque : l'écran de la boîte
 * (`cadeau.js`) l'appelle à l'ouverture. Pas de délai, pas de preuve — il n'y a rien à
 * prouver, on OFFRE.
 */
export function recevoirCadeau(id = CADEAU) {
  const article = articleDe(id);
  if (!article || article.condition !== 'cadeau') return { ok: false, raison: 'inconnu' };
  if (estDebloque(id)) return { ok: true, deja: true };
  etat.debloques.push(id);
  enregistrer();
  return { ok: true };
}

/** Le cadeau attend-il encore d'être ouvert ? */
export const cadeauEnAttente = (id = CADEAU) => Boolean(articleDe(id)) && !estDebloque(id);

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
  serveur = { argent: false, possessions: [] };
  enregistrer();
}
