/**
 * Le COMPTE du joueur : connexion Supabase, et liaison d'un wallet Solana.
 *
 * Deux identites, qu'il ne faut pas confondre :
 *
 *   - QUI EST LE JOUEUR — un compte Supabase, ouvert par e-mail et mot de passe, OU par
 *     la signature d'un wallet Solana (`connecterAvecWallet`, fournisseur Web3 active
 *     dans le projet Supabase par le directeur produit le 4 septembre 2026). C'est lui
 *     qui porte le solde, la progression, l'historique. Discord et Google viendront plus
 *     tard : ils s'ajouteront a cote sans rien deplacer, puisque tout le reste du jeu ne
 *     connait que `session()` et `jeton()` ;
 *   - OU VA L'ARGENT — une adresse Solana, LIEE au compte par une signature. Elle n'est
 *     pas necessaire pour jouer : elle l'est pour deposer et pour retirer.
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
 * Ouvre une session — ou cree le compte — avec un WALLET SOLANA, par signature.
 *
 * C'est « Sign in with Solana » : le wallet signe un message qui nomme le domaine, l'URI
 * et l'instant, Supabase le verifie et rend une session comme pour un e-mail. Aucune
 * transaction, aucun frais, aucune cle ne quitte le wallet — une signature, c'est tout,
 * et la phrase `statement` le dit au joueur dans la fenetre du wallet (Phantom EXIGE une
 * phrase). Le meme geste sert a s'inscrire et a se connecter : Supabase cree le compte a
 * la premiere signature d'une adresse, et le retrouve ensuite.
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
  if (!w) throw Object.assign(new Error('aucun wallet Solana dans ce navigateur'), { code: 'WALLET_ABSENT' });
  const { data, error } = await supabase.auth.signInWithWeb3({
    chain: 'solana',
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

/** L'adresse Solana d'un compte ouvert par wallet, ou `null` pour un compte e-mail. */
export function adresseWallet(user) {
  if (!user) return null;
  const idn = (user.identities ?? []).find((i) => i.provider === 'web3' || i.identity_data?.address);
  return user.user_metadata?.custom_claims?.address
    ?? idn?.identity_data?.address
    ?? user.user_metadata?.address
    ?? null;
}

/** « 7xKp…9fQ2 » : ce qu'on montre d'une adresse quand on n'a pas la place de la lire. */
export function adresseCourte(adresse) {
  if (!adresse) return null;
  return adresse.length > 12 ? `${adresse.slice(0, 4)}…${adresse.slice(-4)}` : adresse;
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
  if (e?.code === 'WALLET_ABSENT') return 'No Solana wallet found in this browser. Install Phantom or Solflare, then try again.';
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

export async function deconnecter() {
  await supabase?.auth.signOut();
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

/** Le portefeuille Solana injecte dans la page (Phantom, Solflare…), ou `null`. */
export function walletNavigateur() {
  return window.phantom?.solana ?? window.solflare ?? window.solana ?? null;
}

/**
 * Lie un wallet Solana au compte, par preuve de signature.
 *
 * Le message signe porte l'identifiant du compte ET l'instant. L'identifiant empeche de
 * presenter devant un autre compte une signature obtenue ailleurs ; l'horodatage empeche
 * de rejouer indefiniment la meme. Une signature valide mais recyclee est le piege
 * classique de ce genre de liaison, et le backend refuse les deux cas.
 *
 * Le joueur ne tape JAMAIS son adresse : elle vient du wallet, et la signature prouve
 * qu'il en detient la cle. Une adresse saisie au clavier serait une adresse qu'on peut se
 * tromper — ou se faire dicter.
 */
export async function lierWallet(userId) {
  const w = walletNavigateur();
  if (!w) throw new Error('aucun wallet Solana detecte dans ce navigateur');

  await w.connect();
  const adresse = w.publicKey.toBase58();
  const message = `Tumble — lier ce wallet au compte ${userId}\n${new Date().toISOString()}`;

  const { signature } = await w.signMessage(new TextEncoder().encode(message), 'utf8');

  // La signature revient en octets ; le backend l'attend en base58, comme l'adresse.
  const { default: bs58 } = await import('bs58');
  return appeler('/wallet/lier', { adresse, message, signature: bs58.encode(signature) });
}
