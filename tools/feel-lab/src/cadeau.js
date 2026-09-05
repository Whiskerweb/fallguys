/**
 * LE CADEAU DE BIENVENUE — une boîte plein écran à la première arrivée, un clic, BabyVlad.
 *
 * Décision du directeur produit du 5 septembre 2026 : « quand il arrive, il ait un cadeau
 * qui s'affiche, il doit cliquer pour l'ouvrir et quand il ouvre il unlock le skin
 * babyvlad ». Puis, « sans cliquer sur rien », l'écran du dépôt.
 *
 * Pourquoi un cadeau AVANT l'argent : le joueur vient de créer un compte et n'a rien. Le
 * lobby lui montre un solde à zéro et un PLAY fermé ; le premier geste qu'on lui demande
 * est de payer. La boîte inverse l'ordre — il REÇOIT d'abord, un skin qu'il voit
 * immédiatement sur le plateau du lobby derrière l'écran — et c'est seulement ensuite
 * qu'on lui parle de déposer, avec quelque chose à défendre.
 *
 * ─── QUAND ELLE S'OUVRE ────────────────────────────────────────────────────
 *
 *   - quand la PORTE vient de se fermer sur une session ouverte et que le serveur dit
 *     qu'il y a de l'argent derrière lui (`tumble-porte`, envoyé par `porte.js`) — donc
 *     jamais sur un banc, où quarante harnais ne sauraient pas cliquer une boîte ;
 *   - une seule fois : tant que l'article n'est pas reçu (`boutique.js:cadeauEnAttente`).
 *     Une fois ouvert, il l'est pour de bon, dans la mémoire du navigateur ;
 *   - `?cadeau` dans l'adresse la force, banc compris : c'est le levier des harnais
 *     (`diag/cadeau-ecran.mjs`), et de celui qui veut la revoir ;
 *   - depuis la BOUTIQUE, la carte « OPEN YOUR GIFT » la rouvre (`tumble-cadeau-ouvrir`).
 *
 * ─── CE QUE CE MODULE FAIT, ET NE FAIT PAS ─────────────────────────────────
 *
 * Il dessine et anime. La RÈGLE (qui possède quoi) est dans `boutique.js`, comme pour le
 * post ; l'équipement passe par `cosmetics.setModel`, la porte que tout le monde emprunte.
 * Rien ici ne touche à l'argent. Les éclats de l'ouverture sont posés par une suite
 * DÉTERMINISTE (angle d'or) : aucun `Math.random` dans ce dépôt, même pour des confettis —
 * la règle est simple à tenir quand on ne l'assouplit jamais.
 *
 * La suite est un ENCHAÎNEMENT sans clic : la boîte s'ouvre, le personnage se révèle,
 * une barre annonce « Next: fund your wallet » pendant deux secondes et demie, puis
 * `onFin()` — `main.js` y ouvre le guide de dépôt. Le joueur peut couper court
 * (« Open later », Échap) : la boîte reviendra à la prochaine visite, pas le guide.
 */

import { sfx } from './audio.js';
import { cosmetics, MODELS, RARITY } from './cosmetics.js';
import { CADEAU, cadeauEnAttente, recevoirCadeau, estDebloque } from './boutique.js';
import { caisse } from './caisse.js';
import { majBarre, buildSkinsScreen } from './lobbyui.js';

const el = (id) => document.getElementById(id);

/** Le temps laissé au personnage révélé avant d'enchaîner sur le dépôt. */
export const DUREE_REVELATION_MS = 2600;
/** Combien d'éclats partent de la boîte à l'ouverture. */
const ECLATS = 28;
const COULEURS = ['#ff3d8b', '#31c7f0', '#ffc93c', '#fff6e6', '#46e08a', '#a855f7'];

let construit = false;
let visible = false;
let ouvert = false;
let chrono = null;
let options = {};

/** L'écran est-il affiché ? (harnais) */
export const cadeauVisible = () => visible;

/**
 * Construit l'écran et l'abonne à ce qui le déclenche.
 *
 * @param {object} o
 * @param {() => boolean} [o.peutMontrer] la boucle est-elle au lobby ? (jamais en partie)
 * @param {() => void} [o.onEquipe] après l'équipement : reconstruire l'avatar du plateau
 * @param {() => void} [o.onFin] après la révélation, sans clic : ouvrir le guide de dépôt
 */
export function buildCadeau(o = {}) {
  options = o;
  const scene = el('cadeau');
  if (!scene || construit) return;
  construit = true;

  // Les éclats existent dès la construction, inertes : l'ouverture ne fait que lancer
  // l'animation. Créer vingt-huit nœuds au clic ferait hoqueter la première image.
  const nid = el('cadeau-eclats');
  for (let i = 0; i < ECLATS; i++) {
    const e = document.createElement('i');
    const angle = (i * 137.508) % 360;                 // angle d'or : réparti, jamais aligné
    const portee = 150 + ((i * 53) % 170);
    e.style.setProperty('--a', `${angle}deg`);
    e.style.setProperty('--d', `${portee}px`);
    e.style.setProperty('--r', `${(i * 97) % 360}deg`);
    e.style.setProperty('--t', `${(i * 7) % 9 * 22}ms`);
    e.style.setProperty('--c', COULEURS[i % COULEURS.length]);
    if (i % 4 === 0) e.classList.add('rond');
    nid.appendChild(e);
  }

  el('cadeau-boite').addEventListener('click', () => ouvrir());
  el('cadeau-plus-tard').addEventListener('click', () => { sfx.click(); fermer(false); });
  // Entrée ou Espace ouvrent, Échap remet à plus tard ; et rien n'atteint le jeu, qui
  // écoute le clavier lui aussi.
  scene.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { fermer(false); return; }
    if ((e.key === 'Enter' || e.key === ' ') && !ouvert) { e.preventDefault(); ouvrir(); }
  });
  scene.addEventListener('keyup', (e) => e.stopPropagation());

  // La porte vient de se fermer sur une session : c'est l'arrivée dans le jeu.
  document.addEventListener('tumble-porte', (e) => {
    const d = e.detail ?? {};
    if (d.ouverte || !d.session || !caisse.argent) return;
    evaluerCadeau();
  });
  // La boutique demande à la rouvrir.
  document.addEventListener('tumble-cadeau-ouvrir', () => montrer());

  // `?cadeau` : la boîte tout de suite, banc compris.
  if (new URLSearchParams(location.search).has('cadeau')) {
    // Après le chargement — l'écran doit passer PAR-DESSUS un lobby déjà là.
    setTimeout(() => montrer(), 0);
  }
}

/** Montre la boîte si elle attend encore d'être ouverte et que la boucle est au lobby. */
export function evaluerCadeau() {
  // Déjà à l'écran — peut-être en train de s'ouvrir : un second appel (le serveur qui
  // parle pendant le clic) ne doit pas la refermer ni la remettre à zéro.
  if (visible) return true;
  if (!cadeauEnAttente()) return false;
  if (options.peutMontrer && !options.peutMontrer()) return false;
  montrer();
  return true;
}

/** Affiche l'écran, fermé, prêt à être cliqué. */
export function montrer() {
  const scene = el('cadeau');
  if (!scene) return;
  clearTimeout(chrono);
  const m = MODELS.find((x) => x.id === CADEAU);
  const r = RARITY[m?.rarity] ?? RARITY.common;
  el('cadeau-port').src = `/icons/port-${CADEAU}.png`;
  el('cadeau-port').alt = m?.name ?? '';
  el('cadeau-nom').textContent = (m?.name ?? CADEAU).toUpperCase();
  el('cadeau-rarity').textContent = r.label;
  el('cadeau-rarity').style.background = r.color;
  scene.style.setProperty('--rar', r.color);

  // Déjà reçu (rouvert depuis la boutique) : la boîte s'ouvre quand même — on la montre
  // fermée, elle s'ouvrira au clic, et la révélation dit « déjà à toi ».
  ouvert = false;
  scene.classList.remove('ouvert', 'revele', 'sortie');
  el('cadeau-etat').textContent = estDebloque(CADEAU) ? 'ALREADY YOURS' : 'SKIN UNLOCKED · EQUIPPED';
  el('cadeau-suite').classList.add('hidden');
  scene.classList.remove('hidden');
  document.body.classList.add('cadeau-ouvert');
  visible = true;
  el('cadeau-boite').focus({ preventScroll: true });
}

/**
 * L'OUVERTURE. La boîte tremble, le couvercle part, la lumière sort, les éclats volent,
 * le personnage monte — et il est déjà équipé quand il apparaît. Puis, sans clic, la
 * suite.
 */
export function ouvrir() {
  if (ouvert) return;
  ouvert = true;
  const scene = el('cadeau');
  scene.classList.add('ouvert');
  sfx.lancer?.();

  // La règle d'abord, le dessin ensuite : si `recevoirCadeau` refusait, on ne
  // montrerait pas un personnage qu'on n'a pas donné.
  const verdict = recevoirCadeau(CADEAU);
  const equipe = verdict.ok && cosmetics.setModel(CADEAU);

  // La révélation, après que le couvercle a quitté l'image (voir `@keyframes cd-couvercle`).
  chrono = setTimeout(() => {
    scene.classList.add('revele');
    sfx.jackpot?.();
    if (equipe) {
      majBarre();
      buildSkinsScreen(options.onEquipe);
      options.onEquipe?.();
    }
    // La suite s'annonce, puis s'enchaîne : le joueur lit ce qui vient avant que ça vienne.
    el('cadeau-suite').classList.remove('hidden');
    chrono = setTimeout(() => fermer(true), DUREE_REVELATION_MS);
  }, 900);
}

/** Referme l'écran. `suite` : enchaîner sur ce que `main.js` a prévu après. */
export function fermer(suite) {
  clearTimeout(chrono);
  const scene = el('cadeau');
  if (!scene || !visible) return;
  scene.classList.add('sortie');
  visible = false;
  setTimeout(() => {
    scene.classList.add('hidden');
    scene.classList.remove('sortie', 'ouvert', 'revele');
    document.body.classList.remove('cadeau-ouvert');
    if (suite) options.onFin?.();
  }, 380);
}
