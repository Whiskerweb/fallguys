/**
 * LE NOM DU DOLLAR — et comment l'interface le change sans se réécrire.
 *
 * Le jeu est écrit en « USDC » : deux cents fois, dans le HTML, dans les textes peints
 * par le lobby, dans des fichiers que plusieurs mains éditent. Sur le testnet de Robinhood
 * Chain, c'est vrai : le dollar d'essai est le nôtre et s'appelle USDC. Sur le MAINNET, le
 * dollar natif est l'USDG de Paxos (« Global Dollar »), et faire miser des USDG à
 * quelqu'un en lui écrivant USDC serait un mensonge sur de l'argent réel.
 *
 * Plutôt que deux cents littéraux à convertir — et à reconvertir à chaque fichier ajouté
 * par une autre session —, UN mécanisme : le serveur de jeu dit le nom du dollar
 * (`/etat` → `chaine.stable`, appris du backend), et ce module renomme chaque nœud de
 * texte qui dit « USDC », ceux qui existent et ceux qui apparaîtront (MutationObserver).
 * Il ne fait RIEN tant que le nom est USDC : sur le testnet, l'observateur n'est même
 * pas posé. Les identifiants (`data-usdc`, `.palier[data-usdc]`) ne sont pas des textes
 * et ne bougent pas : ce sont des clés, pas des mots.
 */

let symbole = 'USDC';
let observateur = null;
const auditeurs = new Set();

/** Le symbole courant : « USDC », ou ce que la chaîne a dit. */
export const devise = () => symbole;

/** Prévenu quand le nom change. */
export function surDevise(fn) { auditeurs.add(fn); return () => auditeurs.delete(fn); }

const MOT = /USDC/g;

function renommer(noeud) {
  if (noeud.nodeType === Node.TEXT_NODE) {
    if (MOT.test(noeud.nodeValue)) noeud.nodeValue = noeud.nodeValue.replace(MOT, symbole);
    MOT.lastIndex = 0;
    return;
  }
  if (noeud.nodeType !== Node.ELEMENT_NODE) return;
  // Les champs de saisie et les scripts gardent leur texte.
  if (/^(SCRIPT|STYLE|INPUT|TEXTAREA)$/.test(noeud.tagName)) return;
  for (const attr of ['placeholder', 'title']) {
    const v = noeud.getAttribute?.(attr);
    if (v && v.includes('USDC')) noeud.setAttribute(attr, v.replace(MOT, symbole));
  }
  const marche = document.createTreeWalker(noeud, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = marche.nextNode())) {
    if (/^(SCRIPT|STYLE|TEXTAREA)$/.test(t.parentNode?.tagName ?? '')) continue;
    if (MOT.test(t.nodeValue)) t.nodeValue = t.nodeValue.replace(MOT, symbole);
    MOT.lastIndex = 0;
  }
}

/**
 * Pose le nom du dollar. Appelé par `matchmaking.js` dès que `/etat` répond — avant la
 * porte, avant le solde, avant tout ce qui s'écrit ensuite.
 */
export function poserDevise(nom) {
  const propre = typeof nom === 'string' && /^[A-Z]{3,6}$/.test(nom) ? nom : 'USDC';
  if (propre === symbole) return;
  symbole = propre;
  for (const fn of auditeurs) fn(symbole);
  if (typeof document === 'undefined') return;
  if (symbole === 'USDC') { observateur?.disconnect(); observateur = null; return; }
  renommer(document.body);
  if (!observateur) {
    observateur = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') renommer(m.target);
        for (const n of m.addedNodes) renommer(n);
      }
    });
    observateur.observe(document.body, { childList: true, characterData: true, subtree: true });
  }
}

/** Le pied de la porte : « TESTNET · TEST USDC » sur le testnet, le nom de la chaîne et du dollar sur mainnet. */
export function poserReseau(chaine) {
  const badge = document.querySelector('#porte-pied span.testnet');
  if (!badge || !chaine?.reseau) return;
  const texte = chaine.reseau === 'mainnet'
    ? `ROBINHOOD CHAIN · ${chaine.stable ?? 'USDG'}`
    : `ROBINHOOD CHAIN ${String(chaine.reseau).toUpperCase()} · TEST ${chaine.stable ?? 'USDC'}`;
  const img = badge.querySelector('img');
  badge.textContent = texte;
  if (img) badge.prepend(img);
}
