/**
 * LES WALLETS ANNONCES (EIP-6963), sans navigateur : deux extensions installees, et le jeu
 * parle a celle qu'on a CHOISIE — jamais a `window.ethereum`, l'objet qu'elles se
 * disputent jusqu'a « Maximum call stack size exceeded » (directeur produit, 5 septembre
 * 2026 : « je me trompe de wallet, je refais, et j'ai ce message »).
 *
 * Usage : node diag/wallets.mjs
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Un `window` minimal : les evenements EIP-6963, une memoire, et un `window.ethereum`
// piege qui explose si quelqu'un l'appelle — c'est exactement ce qu'on ne veut plus.
const cible = new EventTarget();
const memoire = new Map();
globalThis.localStorage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, String(v)), removeItem: (k) => memoire.delete(k) };
globalThis.window = Object.assign(cible, {
  ethereum: { request: () => { throw new RangeError('Maximum call stack size exceeded'); } },
});
globalThis.Event = globalThis.Event ?? class Event { constructor(type) { this.type = type; } };

const annonce = (uuid, name, rdns, reponse) => window.dispatchEvent(Object.assign(new Event('eip6963:announceProvider'), {
  detail: { info: { uuid, name, rdns, icon: 'data:image/svg+xml,' }, provider: { request: async ({ method }) => (method === 'eth_requestAccounts' ? [reponse] : null) } },
}));
// Les wallets repondent a `requestProvider` : ils s'annoncent quand le module le demande.
window.addEventListener('eip6963:requestProvider', () => {
  annonce('u-mm', 'MetaMask', 'io.metamask', '0xMETAMASK');
  annonce('u-ph', 'Phantom', 'app.phantom', '0xPHANTOM');
});

const C = await import(pathToFileURL(path.resolve('src', 'compte.js')).href);

let echecs = 0;
const dit = (ok, t) => { if (!ok) echecs++; console.log(`${ok ? 'OK  ' : 'ECHEC'} ${t}`); };

console.log('\n\x1b[1mDeux wallets installes\x1b[0m');
const liste = C.walletsAnnonces();
dit(liste.length === 2 && liste.map((w) => w.nom).join(',') === 'MetaMask,Phantom', `deux wallets annonces : ${liste.map((w) => w.nom).join(', ')}`);
dit(C.walletChoisi() === null, 'aucun n\'est encore choisi');
const w0 = C.walletNavigateur();
dit(w0 === window.ethereum, 'sans choix et avec deux annonces, on retombe sur window.ethereum — c\'est la porte qui doit faire choisir');

console.log('\n\x1b[1mLe choix\x1b[0m');
const p = C.choisirWallet('u-ph');
dit(p && (await p.request({ method: 'eth_requestAccounts' }))[0] === '0xPHANTOM', 'choisir Phantom rend SON provider');
dit(C.walletChoisi()?.nom === 'Phantom', 'et c\'est lui le wallet choisi');
dit(C.walletNavigateur() === p && C.walletNavigateur() !== window.ethereum, 'le jeu parle desormais a Phantom, jamais a window.ethereum');
dit(memoire.get('tumble-wallet') === 'app.phantom', `le choix est memorise par rdns : ${memoire.get('tumble-wallet')}`);
dit(C.choisirWallet('u-inconnu') === null, 'un identifiant inconnu ne choisit rien');

console.log('\n\x1b[1mSe tromper, et refaire\x1b[0m');
const m = C.choisirWallet('u-mm');
dit(m && C.walletNavigateur() === m && C.walletChoisi().nom === 'MetaMask', 'choisir MetaMask apres Phantom : c\'est MetaMask, sans recharger');
dit(/Two wallet extensions/.test(C.messageErreur(new RangeError('Maximum call stack size exceeded'))),
  `l'erreur des extensions qui se battent est traduite : « ${C.messageErreur(new RangeError('Maximum call stack size exceeded')).slice(0, 50)}… »`);

console.log(`\n--- ${echecs ? `${echecs} ecart(s)` : 'le jeu parle au wallet choisi, pas a celui qu\'on se dispute'} ---`);
process.exit(echecs ? 1 : 0);
