/**
 * Le COMPTE du joueur : connexion Supabase, et liaison d'un wallet Solana.
 *
 * Deux identites, qu'il ne faut pas confondre :
 *
 *   - QUI EST LE JOUEUR — un compte Supabase, ouvert par e-mail et mot de passe. C'est lui
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
export const API = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:8787';

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
export async function creerCompte(email, motDePasse) {
  if (!supabase) throw new Error('comptes non configures');
  const { data, error } = await supabase.auth.signUp({ email, password: motDePasse });
  if (error) throw error;
  if (!data.session) return { confirmationRequise: true, email };
  return { session: data.session };
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
  return m;
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
