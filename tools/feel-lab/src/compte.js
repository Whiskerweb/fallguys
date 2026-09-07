/**
 * Le COMPTE du joueur : connexion Supabase, et liaison d'un wallet Robinhood Chain.
 *
 * Deux identites, qu'il ne faut pas confondre :
 *
 *   - QUI EST LE JOUEUR — un compte Supabase, ouvert par e-mail et mot de passe, OU par
 *     la signature d'un wallet EVM — MetaMask, Rabby, Robinhood Wallet… tout ce qui
 *     injecte `window.ethereum` (`connecterAvecWallet`, fournisseur Web3 « Ethereum »
 *     du projet Supabase). C'est lui qui porte le solde, la progression, l'historique.
 *     Discord et Google viendront plus tard : ils s'ajouteront a cote sans rien
 *     deplacer, puisque tout le reste du jeu ne connait que `session()` et `jeton()` ;
 *   - OU VA L'ARGENT — une adresse Robinhood Chain (0x…), LIEE au compte par une
 *     signature. Elle n'est pas necessaire pour jouer : elle l'est pour retirer, et
 *     pour deposer depuis son propre wallet en un clic.
 *
 * Les separer n'est pas une complication gratuite. Un compte social se recupere quand on
 * le perd ; un wallet non. Et exiger un wallet pour entrer fermerait la porte au palier
 * gratuit, qui est le vivier dont le jeu a besoin pour remplir ses lobbies.
 *
 * SANS CONFIGURATION, TOUT CE MODULE S'EFFACE. Si `VITE_SUPABASE_URL` est absente, le jeu
 * tourne exactement comme avant, sur le portefeuille local du prototype. C'est ce qui
 * permet aux quarante harnais de `diag/` de continuer a piloter le jeu sans backend, et de
 * jouer hors ligne — un jeu qui exige un serveur pour demarrer est un jeu qu'on ne peut
 * plus deboguer.
 */

import { createClient } from '@supabase/supabase-js';

const URL_SUPABASE = import.meta.env?.VITE_SUPABASE_URL ?? '';
const CLE_ANON = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '';
/**
 * OÙ EST LE BACKEND. Par défaut `/api` : la page vient du serveur de jeu, qui relaie
 * `/api/…` au backend — une seule adresse pour le navigateur, aucun CORS, rien à
 * configurer. `VITE_API_URL` ne sert qu'à viser un backend ailleurs (le serveur de
 * développement de Vite, par exemple, ne relaie rien).
 */
export const API = import.meta.env?.VITE_API_URL || '/api';

/** `true` quand le jeu est relie a un vrai compte. Sinon : prototype local. */
export const CONFIGURE = Boolean(URL_SUPABASE && CLE_ANON);

export const supabase = CONFIGURE ? createClient(URL_SUPABASE, CLE_ANON) : null;

/** Session courante, ou `null`. */
export async function session() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

/** Le jeton a presenter a l'API. `null` si personne n'est connecte. */
export async function jeton() {
  return (await session())?.access_token ?? null;
}

/**
 * Ouvre une session par e-mail et mot de passe.
 *
 * Le plus simple qui existe, et c'est voulu pour l'instant : rien a configurer dans le
 * dashboard, aucune redirection, aucun fournisseur tiers. Discord et Google viendront
 * plus tard — `signInWithOAuth` s'ajoutera a cote sans rien deplacer, puisque tout le
 * reste du jeu ne connait que `session()` et `jeton()`.
 */
export async function connecter(email, motDePasse) {
  if (!supabase) throw new Error('comptes non configures');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw error;
  return data.session;
}

/**
 * Cree un compte.
 *
 * Rend `{ session }` si le projet accepte les comptes sans confirmation, et
 * `{ confirmationRequise: true }` sinon — c'est le reglage par defaut de Supabase, et il
 * change tout pour le joueur : sans le distinguer, l'interface annoncerait « bienvenue »
 * a quelqu'un qui n'a pas de session et que le premier appel a l'API rejettera.
 *
 * On le detecte sur l'ABSENCE DE SESSION dans la reponse, jamais sur un reglage devine :
 * c'est le serveur qui decide, et il peut changer d'avis sans que ce code le sache.
 */
export async function creerCompte(email, motDePasse, nom = null) {
  if (!supabase) throw new Error('comptes non configures');
  // Le nom de joueur part dans les metadonnees du compte : le backend le lit comme pseudo,
  // et une autre machine le retrouve a la connexion. Le nom local du lobby suit.
  const { data, error } = await supabase.auth.signUp({
    email, password: motDePasse, ...(nom ? { options: { data: { name: nom } } } : {}),
  });
  if (error) throw error;
  if (!data.session) return { confirmationRequise: true, email };
  return { session: data.session };
}

/**
 * Ouvre une session — ou cree le compte — avec un WALLET EVM, par signature.
 *
 * C'est « Sign in with Ethereum » (EIP-4361) : le wallet signe un message qui nomme le
 * domaine, l'URI, la chaine et l'instant, Supabase le verifie et rend une session comme
 * pour un e-mail. Aucune transaction, aucun frais, aucune cle ne quitte le wallet — une
 * signature, c'est tout, et la phrase `statement` le dit au joueur dans la fenetre du
 * wallet (sans retour a la ligne : le format l'interdit). Le meme geste sert a s'inscrire
 * et a se connecter : Supabase cree le compte a la premiere signature d'une adresse, et
 * le retrouve ensuite. La chaine sur laquelle le wallet se trouve n'a pas d'importance
 * pour SIGNER : on ne demande pas au joueur de changer de reseau pour entrer.
 *
 * Le compte n'a pas d'e-mail. Le nom de joueur vient du formulaire quand il est rempli
 * (onglet CREATE), sinon de l'adresse raccourcie — un joueur a toujours un nom qu'un
 * adversaire peut lire. Il est ecrit dans les metadonnees, la ou le backend et l'autre
 * machine le lisent, seulement s'il n'y en a pas deja un : se reconnecter ne renomme
 * pas.
 *
 * Se connecter par wallet ne LIE pas ce wallet aux retraits. Ce sont deux preuves pour
 * deux choses — qui je suis, ou va l'argent — et la seconde passe par le backend
 * (`lierWallet`), qui n'a aucune raison de croire une session pour ca.
 */
export async function connecterAvecWallet(nom = null) {
  if (!supabase) throw new Error('comptes non configures');
  const w = walletNavigateur();
  if (!w) throw Object.assign(new Error('aucun wallet EVM dans ce navigateur'), { code: 'WALLET_ABSENT' });
  const { data, error } = await supabase.auth.signInWithWeb3({
    chain: 'ethereum',
    wallet: w,
    statement: 'Sign in to Baby Guys. No transaction, no fee: a signature only.',
  });
  if (error) throw error;
  const s = data.session;
  if (s?.user && !s.user.user_metadata?.name) {
    const defaut = nom || adresseCourte(adresseWallet(s.user)) || 'Baby Guy';
    const { error: e2 } = await supabase.auth.updateUser({ data: { name: defaut } });
    if (!e2) s.user.user_metadata = { ...(s.user.user_metadata ?? {}), name: defaut };
  }
  return s;
}

/** L'adresse (0x…) d'un compte ouvert par wallet, ou `null` pour un compte e-mail. */
export function adresseWallet(user) {
  if (!user) return null;
  const idn = (user.identities ?? []).find((i) => i.provider === 'web3' || i.identity_data?.address);
  return user.user_metadata?.custom_claims?.address
    ?? idn?.identity_data?.address
    ?? user.user_metadata?.address
    ?? null;
}

/** « 0x7f3a…9fQ2 » : ce qu'on montre d'une adresse quand on n'a pas la place de la lire. */
export function adresseCourte(adresse) {
  if (!adresse) return null;
  return adresse.length > 12 ? `${adresse.slice(0, 6)}…${adresse.slice(-4)}` : adresse;
}

/**
 * Traduit les erreurs de Supabase, qui arrivent en anglais technique.
 *
 * « Invalid login credentials » couvre a la fois le mauvais mot de passe ET le compte
 * jamais confirme : c'est deliberé de leur part — distinguer les deux dirait a un inconnu
 * quelles adresses sont inscrites. On garde donc l'ambiguite, mais on mentionne la piste
 * de la confirmation, parce que c'est la cause la plus frequente sur un projet neuf.
 */
export function messageErreur(e) {
  const m = String(e?.message ?? e);
  if (/Invalid login credentials/i.test(m)) return 'Wrong password — or the email is not confirmed yet.';
  if (/Email not confirmed/i.test(m)) return 'Check your inbox: this email is not confirmed yet.';
  if (/User already registered/i.test(m)) return 'This email already has an account. Sign in instead.';
  if (/Password should be/i.test(m)) return 'Password must be at least 6 characters.';
  if (/is invalid/i.test(m)) return 'Supabase rejected this email address. Try another domain.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute.';
  if (/URI which is not allowed|signed for another app/i.test(m)) return 'Wallet sign-in is not allowed for this site yet: play.babyguy.dev must be listed in the Supabase URL configuration.';
  if (e?.code === 'WALLET_ABSENT') return 'No wallet found in this browser. Install MetaMask, Rabby or Robinhood Wallet, then try again.';
  if (/Maximum call stack/i.test(m)) return 'Two wallet extensions are fighting over this page. Pick one wallet in the list, or disable the other extension and reload.';
  if (e?.code === 4001 || e?.code === 'ACTION_REJECTED') return 'Refused in the wallet. Nothing was sent.';
  if (/user rejected|rejected the request|User declined/i.test(m)) return 'Signature refused in the wallet. Nothing was sent.';
  if (/web3.*(disabled|not enabled)|provider is not enabled/i.test(m)) return 'Wallet sign-in is not enabled on the server yet.';
  return m;
}

/**
 * Mot de passe oublie : Supabase envoie un lien de reinitialisation. On ne dit pas si
 * l'adresse existe — c'est Supabase qui garde ce secret, et c'est bien.
 */
export async function motDePasseOublie(email) {
  if (!supabase) throw new Error('comptes non configures');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  if (error) throw error;
}

/**
 * Ferme la session — et la ferme TOUJOURS localement.
 *
 * `signOut()` demande d'abord au serveur de revoquer la session. Quand celle-ci n'existe
 * plus pour lui — compte supprime, jeton de rafraichissement perime, projet reconfigure
 * —, il repond une erreur et supabase-js gardait la session fantome dans le navigateur.
 * Le joueur voyait alors un lobby qui le croyait connecte (porte fermee) pendant que le
 * backend le refusait (solde a zero, nom par defaut, TOP UP qui dit SIGN IN), et SIGN OUT
 * ne faisait rien : « impossible de me deconnecter » (directeur produit, 4 septembre
 * 2026). Le repli `scope: 'local'` efface ce que le navigateur tient, quoi que dise le
 * serveur ; la porte se rouvre.
 */
export async function deconnecter() {
  if (!supabase) return;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}

/** Prevenu a chaque ouverture ou fermeture de session. */
export function surSession(fn) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, s) => fn(s));
  return () => data.subscription.unsubscribe();
}

// ---------- appels a l'API ----------

/**
 * Appelle le backend en presentant le jeton.
 *
 * Aucune route ne prend d'identifiant de joueur : le joueur est celui du jeton, jamais
 * celui de la requete. Il n'y a donc rien a passer ici, et rien a falsifier.
 */
export async function appeler(chemin, corps = null) {
  const t = await jeton();
  if (!t) throw Object.assign(new Error('non connecte'), { code: 'NON_AUTHENTIFIE' });

  const r = await fetch(`${API}${chemin}`, {
    method: corps ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${t}`,
      ...(corps ? { 'content-type': 'application/json' } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.message ?? r.statusText), { code: data.erreur });
  return data;
}

// ---------- le wallet ----------

/*
 * LES WALLETS ANNONCES — EIP-6963 — ET POURQUOI ON NE PREND PLUS `window.ethereum`.
 *
 * Quand deux extensions sont installees (MetaMask et Phantom, Rabby et Coinbase…),
 * chacune pose `window.ethereum` et le redirige vers l'autre : la premiere demande
 * tombe sur l'une, la seconde sur l'autre, et parfois les deux se renvoient la balle
 * jusqu'a « Maximum call stack size exceeded ». Vu par le directeur produit le
 * 5 septembre 2026 : « je me trompe de wallet, je refais, et j'ai ce message ».
 *
 * EIP-6963 est la reponse standard : chaque wallet S'ANNONCE (nom, icone, identifiant
 * inverse `rdns`, et SON objet `provider`), sans toucher a celui des autres. On garde la
 * liste, la porte la montre quand il y en a plus d'un, et tout le jeu — signature,
 * depot, swap — parle au provider CHOISI, jamais a l'objet dispute. Le choix est
 * memorise par `rdns` : au retour, le meme wallet, sans redemander.
 *
 * `window.ethereum` reste le repli : un seul wallet, ancien, qui ne s'annonce pas.
 */
const annonces = new Map();
const CLE_WALLET = 'tumble-wallet';
let choisi = null;
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = e.detail;
    if (d?.info?.uuid && d.provider && typeof d.provider.request === 'function') annonces.set(d.info.uuid, d);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** La fiche d'un wallet annonce, telle que le jeu la lit : `{ uuid, nom, icone, rdns }`. */
const fiche = (d) => ({ uuid: d.info.uuid, nom: d.info.name, icone: d.info.icon, rdns: d.info.rdns });

/** Les wallets qui se sont annonces, dans l'ordre d'annonce. */
export function walletsAnnonces() {
  return [...annonces.values()].map(fiche);
}

/** Retient le wallet a employer partout. Rend son provider, ou `null` si l'annonce n'existe pas. */
export function choisirWallet(uuid) {
  const d = annonces.get(uuid);
  if (!d) return null;
  choisi = d;
  try { localStorage.setItem(CLE_WALLET, d.info.rdns); } catch { /* memoire indisponible : le choix vaut pour la page */ }
  return d.provider;
}

/** Le wallet retenu — celui de la page, ou celui memorise s'il est de nouveau annonce. */
export function walletChoisi() {
  if (choisi) return fiche(choisi);
  let rdns = null;
  try { rdns = localStorage.getItem(CLE_WALLET); } catch { /* rien */ }
  const d = rdns ? [...annonces.values()].find((x) => x.info.rdns === rdns) : null;
  if (d) choisi = d;
  return d ? fiche(d) : null;
}

/**
 * Le wallet EVM a employer : le CHOISI, sinon le seul annonce, sinon `window.ethereum`
 * (MetaMask, Rabby, Robinhood Wallet…), sinon `null`.
 */
export function walletNavigateur() {
  if (walletChoisi()) return choisi.provider;
  if (annonces.size === 1) return [...annonces.values()][0].provider;
  const w = window.ethereum;
  return w && typeof w.request === 'function' ? w : null;
}

const hexUtf8 = (texte) => '0x' + Array.from(new TextEncoder().encode(texte), (b) => b.toString(16).padStart(2, '0')).join('');
const hexNombre = (n) => '0x' + BigInt(n).toString(16);
const mot = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

/** Le compte que le wallet accepte de montrer, en demandant la connexion s'il le faut. */
async function compteDuWallet(w) {
  const comptes = await w.request({ method: 'eth_requestAccounts' });
  if (!comptes?.length) throw new Error('le wallet n\'a donne aucun compte');
  return comptes[0];
}

/**
 * Lie un wallet Robinhood Chain au compte, par preuve de signature.
 *
 * Le message signe porte l'identifiant du compte ET l'instant. L'identifiant empeche de
 * presenter devant un autre compte une signature obtenue ailleurs ; l'horodatage empeche
 * de rejouer indefiniment la meme. Une signature valide mais recyclee est le piege
 * classique de ce genre de liaison, et le backend refuse les deux cas.
 *
 * Le joueur ne tape JAMAIS son adresse : elle vient du wallet, et la signature prouve
 * qu'il en detient la cle (`personal_sign`, verifiee par le backend). Une adresse saisie
 * au clavier serait une adresse qu'on peut se tromper — ou se faire dicter.
 */
export async function lierWallet(userId) {
  const w = walletNavigateur();
  if (!w) throw Object.assign(new Error('aucun wallet EVM detecte dans ce navigateur'), { code: 'WALLET_ABSENT' });

  const adresse = await compteDuWallet(w);
  const message = `Baby Guys — link this wallet to account ${userId}\n${new Date().toISOString()}`;
  // `personal_sign` prend le message en hexadecimal et l'adresse qui signe.
  const signature = await w.request({ method: 'personal_sign', params: [hexUtf8(message), adresse] });
  return appeler('/wallet/lier', { adresse, message, signature });
}

/**
 * Met le wallet du joueur sur Robinhood Chain — en l'ajoutant s'il ne la connait pas.
 *
 * `chaine` vient du backend (`/moi`) : nom, chainId, RPC, explorateur, monnaie. Une seule
 * source pour le jeu et le wallet, sinon les deux finiraient sur deux reseaux. Le wallet
 * demande confirmation au joueur pour l'ajout, et pour le changement.
 */
export async function passerSurLaChaine(w, chaine) {
  const chainId = hexNombre(chaine.chainId);
  const courant = await w.request({ method: 'eth_chainId' }).catch(() => null);
  if (courant && BigInt(courant) === BigInt(chainId)) return;
  try {
    await w.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e) {
    // 4902 : le wallet ne connait pas ce reseau. On le lui apprend, puis on y passe.
    if (e?.code !== 4902 && !/unrecognized chain|not added|4902/i.test(String(e?.message ?? ''))) throw e;
    await w.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId, chainName: chaine.nom, rpcUrls: [chaine.rpc],
        nativeCurrency: { name: chaine.monnaie?.nom ?? 'Ether', symbol: chaine.monnaie?.symbole ?? 'ETH', decimals: chaine.monnaie?.decimales ?? 18 },
        ...(chaine.explorateur ? { blockExplorerUrls: [chaine.explorateur] } : {}),
      }],
    });
  }
}

/**
 * Depose des USDG DEPUIS le wallet du joueur vers son wallet de jeu : un `transfer` ERC-20
 * que le wallet signe et envoie lui-meme (le joueur paie ce gaz-la, quelques centimes).
 *
 * C'est le parcours court demande par le directeur produit : pas d'adresse a recopier.
 * Le contrat et l'adresse de depot viennent du backend ; le montant du joueur. Rend le
 * hache : le guetteur creditera le depot des qu'il le verra.
 */
export async function deposerDepuisWallet({ chaine, adresseDepot, micros }) {
  const w = walletNavigateur();
  if (!w) throw Object.assign(new Error('aucun wallet EVM detecte dans ce navigateur'), { code: 'WALLET_ABSENT' });
  if (!chaine?.usdg) throw new Error('le contrat USDG n\'est pas connu');
  const de = await compteDuWallet(w);
  await passerSurLaChaine(w, chaine);
  // transfer(address,uint256) : selecteur a9059cbb, puis les deux arguments sur 32 octets.
  const data = '0xa9059cbb' + mot(adresseDepot) + mot(hexNombre(micros));
  return w.request({ method: 'eth_sendTransaction', params: [{ from: de, to: chaine.usdg, data }] });
}

// ---------- les autres portes d'entree : USDG, et l'ETH du wallet (5 septembre 2026) ----------

/*
 * LE GRAND LIVRE NE CONNAIT QUE L'USDG, et il ne changera pas pour ca. Un joueur qui n'a
 * que des USDG ou que de l'ETH dans son wallet CHANGE dans son propre wallet, avant que
 * l'argent n'arrive : on appelle un routeur de DEX (interface Uniswap V2, la plus
 * repandue sur les chaines Orbit) avec l'ADRESSE DE DEPOT comme destination du swap. Le
 * wallet de jeu recoit donc des USDG ordinaires, le guetteur les credite comme n'importe
 * quel depot, et le backend n'a rien de nouveau a savoir. Une seule signature pour l'ETH
 * (le swap est payable), deux pour l'USDG (une approbation, puis le swap).
 *
 * Le joueur raisonne en USDG — « je veux 10 USDG sur ma table » — jamais en ETH : on
 * lui DEMANDE la sortie et on calcule l'entree (`getAmountsIn`), puis on swappe « pour
 * exactement N USDG » avec une marge d'un pour cent que le routeur rembourse. Il n'a pas
 * a comprendre un cours pour deposer.
 *
 * Les adresses (routeur, WETH, USDG) viennent du backend (`/moi` → `chaine`), jamais
 * d'ici : sur le testnet elles sont nulles, et le guide ne propose pas ces chemins.
 */

/** Selecteurs des fonctions du routeur V2 et des jetons, calcules une fois pour toutes. */
const SEL = {
  balanceOf: '0x70a08231',
  approve: '0x095ea7b3',
  allowance: '0xdd62ed3e',
  getAmountsIn: '0x1f00ca74',
  swapETHForExactTokens: '0xfb3bdb41',
  swapTokensForExactTokens: '0x8803dbee',
};

/** Encode une tete de mots suivie d'UN tableau dynamique d'adresses, place a `positionTableau`. */
function encoderAvecTableau(selecteur, tete, positionTableau, adresses) {
  // Le mot a `positionTableau` est un decalage vers la queue : la longueur de la tete.
  const mots = tete.map((m, i) => (i === positionTableau ? mot(hexNombre(tete.length * 32)) : m));
  const queue = [mot(hexNombre(adresses.length)), ...adresses.map(mot)];
  return selecteur + mots.join('') + queue.join('');
}

/** Un appel JSON-RPC en lecture, sur le RPC public de la chaine — sans passer par le wallet. */
async function lireSurLaChaine(chaine, method, params) {
  if (!chaine?.rpc) throw new Error('aucun RPC pour cette chaine');
  const r = await fetch(chaine.rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? 'rpc');
  return j.result;
}

/** Les comptes que le wallet montre DEJA, sans rien demander au joueur (aucune fenetre). */
export async function comptesConnus() {
  const w = walletNavigateur();
  if (!w) return [];
  try { return (await w.request({ method: 'eth_accounts' })) ?? []; } catch { return []; }
}

/** Demande au wallet de se connecter : la fenetre du wallet s'ouvre. Rend l'adresse. */
export async function connecterLeWallet() {
  const w = walletNavigateur();
  if (!w) throw Object.assign(new Error('aucun wallet EVM detecte dans ce navigateur'), { code: 'WALLET_ABSENT' });
  return compteDuWallet(w);
}

/**
 * Ce que le wallet du joueur detient SUR ROBINHOOD CHAIN : ETH, USDG (en unites
 * natives, BigInt ; `null` pour un jeton que la chaine n'a pas). C'est ce qui permet au
 * guide de depot de pre-choisir le bon chemin et de pre-remplir un montant, au lieu de
 * demander au joueur ce qu'il a. Lu sur le RPC public : le wallet peut etre sur une autre
 * chaine a ce moment-la, ca ne change rien.
 */
export async function soldesDuWallet(chaine, adresse) {
  const solde = async (jeton) => {
    if (!jeton) return null;
    const r = await lireSurLaChaine(chaine, 'eth_call', [{ to: jeton, data: SEL.balanceOf + mot(adresse) }, 'latest']);
    return BigInt(r === '0x' ? 0 : r);
  };
  const [eth, usdg] = await Promise.all([
    lireSurLaChaine(chaine, 'eth_getBalance', [adresse, 'latest']).then(BigInt),
    solde(chaine.usdg),
  ]);
  return { eth, usdg };
}

/** Le chemin de swap pour une entree donnee, ou `null` si la chaine ne l'offre pas. */
function cheminDeSwap(chaine, entree) {
  if (!chaine?.swap?.routeur || !chaine?.usdg) return null;
  // Un seul dollar, l'USDG : le seul change possible est ETH → USDG.
  if (entree === 'eth') return chaine.swap.weth ? [chaine.swap.weth, chaine.usdg] : null;
  return null;
}

/**
 * Combien d'ETH (ou d'USDG) il faut pour recevoir `microsSortie` USDG — le devis, lu sur
 * le routeur. Rend l'entree en unites natives (BigInt). Jette si le marche n'existe pas.
 */
export async function devisDeSwap(chaine, entree, microsSortie) {
  const chemin = cheminDeSwap(chaine, entree);
  if (!chemin) throw Object.assign(new Error(`pas de marche ${entree}/USDG sur cette chaine`), { code: 'SWAP_ABSENT' });
  const data = encoderAvecTableau(SEL.getAmountsIn, [mot(hexNombre(microsSortie)), ''], 1, chemin);
  const r = await lireSurLaChaine(chaine, 'eth_call', [{ to: chaine.swap.routeur, data }, 'latest']);
  // uint256[] : decalage, longueur, puis les montants ; le PREMIER est l'entree.
  const brut = r.replace(/^0x/, '');
  return BigInt('0x' + brut.slice(128, 192));
}

/**
 * Depose `microsSortie` USDG sur le wallet de jeu en partant de l'ETH ou des USDG du
 * wallet du joueur : le swap livre DIRECTEMENT a l'adresse de depot. Rend le hache de la
 * transaction de swap ; le guetteur credite l'USDG qui en sort comme un depot.
 *
 * `entreeMax` est le devis majore d'un pour cent : la marge que le cours peut bouger
 * entre le devis et le bloc. Ce que le swap n'utilise pas est rendu au joueur par le
 * routeur lui-meme.
 */
export async function deposerParSwap({ chaine, adresseDepot, entree, microsSortie, entreeMax }) {
  const w = walletNavigateur();
  if (!w) throw Object.assign(new Error('aucun wallet EVM detecte dans ce navigateur'), { code: 'WALLET_ABSENT' });
  const chemin = cheminDeSwap(chaine, entree);
  if (!chemin) throw Object.assign(new Error(`pas de marche ${entree}/USDG sur cette chaine`), { code: 'SWAP_ABSENT' });
  const de = await compteDuWallet(w);
  await passerSurLaChaine(w, chaine);
  const routeur = chaine.swap.routeur;
  const echeance = hexNombre(Math.floor(Date.now() / 1000) + 600);

  if (entree === 'eth') {
    // swapETHForExactTokens(amountOut, path, to, deadline), l'ETH en `value`.
    const data = encoderAvecTableau(SEL.swapETHForExactTokens,
      [mot(hexNombre(microsSortie)), '', mot(adresseDepot), mot(echeance)], 1, chemin);
    return w.request({ method: 'eth_sendTransaction', params: [{ from: de, to: routeur, data, value: hexNombre(entreeMax) }] });
  }

  // USDG : le routeur doit etre autorise a prelever, puis swapTokensForExactTokens.
  const autorise = await lireSurLaChaine(chaine, 'eth_call', [{ to: chaine.usdg, data: SEL.allowance + mot(de) + mot(routeur) }, 'latest']);
  if (BigInt(autorise === '0x' ? 0 : autorise) < entreeMax) {
    await w.request({ method: 'eth_sendTransaction', params: [{ from: de, to: chaine.usdg, data: SEL.approve + mot(routeur) + mot(hexNombre(entreeMax)) }] });
  }
  const data = encoderAvecTableau(SEL.swapTokensForExactTokens,
    [mot(hexNombre(microsSortie)), mot(hexNombre(entreeMax)), '', mot(adresseDepot), mot(echeance)], 2, chemin);
  return w.request({ method: 'eth_sendTransaction', params: [{ from: de, to: routeur, data }] });
}
