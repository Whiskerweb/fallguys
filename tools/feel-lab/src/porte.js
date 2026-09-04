/**
 * LA PORTE — l'écran de connexion, plein page, avant le lobby.
 *
 * Jusqu'ici le compte se prenait dans un petit panneau au coin de la barre, facultatif :
 * le jeu tournait sur un portefeuille imaginaire et personne n'avait besoin de se
 * connecter. Depuis que l'argent est réel, un joueur SANS compte ne peut rien faire dans le
 * lobby — solde à zéro, PLAY fermé — et le lui laisser découvrir bouton par bouton est un
 * parcours d'inscription raté. La porte dit d'entrée de jeu ce qu'est le jeu, et demande
 * un compte AVANT de montrer quoi que ce soit d'autre.
 *
 * ─── QUAND ELLE SE FERME, ET QUAND ELLE NE S'OUVRE PAS ────────────────────
 *
 *   - elle s'ouvre quand le serveur de jeu a dit qu'il y a DE L'ARGENT derrière lui
 *     (`bienvenue.argent`) et qu'aucune session n'existe ;
 *   - elle se ferme dès qu'une session s'ouvre, et se rouvre à la déconnexion ;
 *   - elle ne s'ouvre JAMAIS sur un banc (serveur sans backend, harnais) : un banc joue
 *     avec un portefeuille imaginaire, et une porte devant lui bloquerait quarante harnais
 *     qui ne savent pas se connecter. C'est le SERVEUR qui décide, pas une URL.
 *
 * Elle pose le lobby derrière elle, flouté : on voit qu'il y a un jeu, on comprend qu'il
 * faut entrer. Rien ici ne touche à l'argent — `caisse.js` relit le solde à la session.
 */

import { sfx } from './audio.js';
import { caisse } from './caisse.js';
import { CONFIGURE, session, connecter, creerCompte, connecterAvecWallet, motDePasseOublie, messageErreur, surSession } from './compte.js';
import { renommerJoueur, majBarre } from './lobbyui.js';

const el = (id) => document.getElementById(id);

let construite = false;
let onglet = 'entrer';
/**
 * Y a-t-il une session ? Tenu À JOUR par `surSession`, jamais relu avec `getSession()` :
 * supabase-js tient un verrou pendant qu'il prévient ses auditeurs, et un `getSession()`
 * attendu à ce moment-là ne répond jamais. La porte restait ouverte après une connexion
 * réussie — le nom et le solde étaient là, la porte aussi.
 */
let sessionOuverte = false;

/** Montre ou cache la porte selon l'état du moment. À appeler quand le serveur ou la session change. */
export function evaluerPorte() {
  const porte = el('porte');
  if (!porte) return;
  if (!CONFIGURE) { porte.classList.add('hidden'); return; }
  const ouverte = caisse.argent && !sessionOuverte;
  porte.classList.toggle('hidden', !ouverte);
  document.body.classList.toggle('porte-ouverte', ouverte);
  if (ouverte) setTimeout(() => el('porte-mail')?.focus(), 50);
}

export function buildPorte() {
  const porte = el('porte');
  if (!porte || construite) return;
  construite = true;
  if (!CONFIGURE) { porte.classList.add('hidden'); return; }

  const msg = el('porte-msg');
  const dire = (texte, ok = false) => { msg.textContent = texte; msg.classList.toggle('ok', ok); };

  /** Bascule SIGN IN / CREATE ACCOUNT : le même formulaire, un champ et un bouton de plus. */
  function choisir(quel) {
    onglet = quel;
    for (const b of porte.querySelectorAll('.porte-onglet')) b.classList.toggle('on', b.dataset.onglet === quel);
    el('porte-nom').classList.toggle('hidden', quel !== 'creer');
    el('porte-bouton').textContent = quel === 'creer' ? 'CREATE ACCOUNT' : 'SIGN IN';
    el('porte-oublie').classList.toggle('hidden', quel !== 'entrer');
    el('porte-mdp').autocomplete = quel === 'creer' ? 'new-password' : 'current-password';
    dire('');
  }
  for (const b of porte.querySelectorAll('.porte-onglet')) {
    b.addEventListener('click', () => { sfx.click(); choisir(b.dataset.onglet); });
  }

  const boutons = ['porte-bouton', 'porte-oublie', 'porte-wallet'];
  async function pendant(travail) {
    for (const b of boutons) el(b).disabled = true;
    porte.classList.add('occupee');
    try { await travail(); } finally { for (const b of boutons) el(b).disabled = false; porte.classList.remove('occupee'); }
  }

  /** Après une session ouverte : le nom du compte devient celui du lobby, le solde se relit. */
  async function entre(s, nom = null) {
    sessionOuverte = Boolean(s);
    const nomCompte = nom ?? s?.user?.user_metadata?.name ?? null;
    if (nomCompte) renommerJoueur(nomCompte);
    evaluerPorte();
    await caisse.rafraichir();
    majBarre();
  }

  async function valider() {
    const email = el('porte-mail').value.trim();
    const mdp = el('porte-mdp').value;
    const nom = el('porte-nom-champ').value.trim().slice(0, 24);
    if (!email || !mdp) { dire('Email and password are required.'); return; }
    if (onglet === 'creer' && !nom) { dire('Pick a player name — it is what opponents will see.'); return; }
    if (onglet === 'creer' && mdp.length < 8) { dire('Use at least 8 characters for your password.'); return; }

    await pendant(async () => {
      try {
        if (onglet === 'creer') {
          dire('Creating your account…');
          const r = await creerCompte(email, mdp, nom);
          if (r.confirmationRequise) {
            dire(`Check ${r.email} and click the confirmation link, then sign in.`, true);
            choisir('entrer');
            return;
          }
          dire('Welcome! Entering the lobby…', true);
          sfx.checkpoint?.();
          await entre(r.session, nom);
        } else {
          dire('Signing in…');
          const s = await connecter(email, mdp);
          dire('Signed in.', true);
          await entre(s);
        }
      } catch (e) {
        dire(messageErreur(e));
      }
    });
  }

  el('porte-bouton').addEventListener('click', () => { sfx.click(); valider(); });

  /*
   * LE WALLET, sur les deux onglets. Le meme bouton inscrit et connecte : c'est le wallet
   * qui est le compte. Sur l'onglet CREATE, le nom saisi devient le nom de joueur ; sur
   * SIGN IN, un premier venu recoit son adresse raccourcie — il pourra se renommer dans
   * le lobby (`renommerJoueur`). Aucune transaction : la fenetre du wallet ne demande
   * qu'une signature, et la phrase qu'elle affiche le dit.
   */
  el('porte-wallet').addEventListener('click', () => pendant(async () => {
    sfx.click();
    const nom = onglet === 'creer' ? el('porte-nom-champ').value.trim().slice(0, 24) : null;
    dire('Open your wallet and sign the message…');
    try {
      const s = await connecterAvecWallet(nom || null);
      dire('Signed in with your wallet.', true);
      sfx.checkpoint?.();
      await entre(s, nom || null);
    } catch (e) {
      dire(messageErreur(e));
    }
  }));
  el('porte-oublie').addEventListener('click', () => pendant(async () => {
    sfx.click();
    const email = el('porte-mail').value.trim();
    if (!email) { dire('Type your email first, then click « Forgot password ».'); return; }
    try {
      await motDePasseOublie(email);
      dire(`If an account exists for ${email}, a reset link is on its way.`, true);
    } catch (e) { dire(messageErreur(e)); }
  }));

  // Entrée valide ; les touches n'atteignent pas le jeu, qui écoute le clavier lui aussi.
  for (const id of ['porte-mail', 'porte-mdp', 'porte-nom-champ']) {
    const champ = el(id);
    champ.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') valider(); });
    champ.addEventListener('keyup', (e) => e.stopPropagation());
  }
  el('porte-voir').addEventListener('click', () => {
    const c = el('porte-mdp');
    c.type = c.type === 'password' ? 'text' : 'password';
    el('porte-voir').textContent = c.type === 'password' ? 'SHOW' : 'HIDE';
  });

  choisir('entrer');
  surSession((s) => { sessionOuverte = Boolean(s); evaluerPorte(); });
  // L'état initial, lu UNE fois, hors de tout auditeur.
  session().then((s) => { sessionOuverte = Boolean(s); evaluerPorte(); });
  evaluerPorte();
}
