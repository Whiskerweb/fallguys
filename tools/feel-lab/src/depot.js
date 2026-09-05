/**
 * LE GUIDE DE DÉPÔT — « ADD FUNDS » : ce qu'on a dans son wallet, combien on veut sur sa
 * table, un bouton. Trois étapes affichées, une seule décision réelle.
 *
 * Demande du directeur produit du 5 septembre 2026 : après le cadeau, « sans cliquer sur
 * rien, il arrive sur la page pour top up » ; accepter « les USDC et USDG, les deux » ;
 * « un mécanisme de swap intégré pour qu'il puisse swap ses ETH de son wallet en USDC » ;
 * « déposé ses sous en quelques clics seulement, super rapidement, et surtout bien guidé ».
 *
 * Jusqu'ici, un nouveau joueur trouvait un lobby à zéro, devinait que WALLET était le
 * bouton, tombait sur un panneau à six boutons (copier, vérifier, déposer, robinet,
 * lier, retirer) et devait savoir seul qu'il lui fallait des USDC sur Robinhood Chain.
 * Ce guide ne montre QUE le chemin d'entrée, et il choisit pour lui ce qui peut l'être :
 *
 *   - PAY WITH : USDC, USDG ou ETH — ce que le wallet du joueur DÉTIENT est lu sur la
 *     chaîne et pré-sélectionné (le plus gros solde gagne), avec le solde écrit sous
 *     chaque option. Il n'a pas à savoir ce qu'il a ;
 *   - HOW MUCH : trois montants et un champ libre, 10 USDC par défaut — la table du
 *     milieu ;
 *   - un bouton qui dit exactement ce qui va se passer (« DEPOSIT 10 USDC »,
 *     « PAY ≈ 0.0031 ETH → 10 USDC »), et une ligne dessous qui dit combien de fois le
 *     wallet demandera confirmation.
 *
 * ─── LE CHANGE SE FAIT DANS LE WALLET DU JOUEUR, JAMAIS CHEZ NOUS ──────────────
 *
 * Le grand livre est en USDC et le wallet de jeu doit en détenir pour que la mise parte.
 * USDG et ETH passent donc par un routeur de DEX, appelé depuis le navigateur, avec
 * l'ADRESSE DE DÉPÔT comme destination : l'USDC sort du swap directement sur le wallet
 * de jeu, et le guetteur le crédite comme n'importe quel dépôt (`compte.js:
 * deposerParSwap`). Le backend n'a rien de nouveau à croire ni à tenir. Les adresses du
 * routeur et de l'USDG viennent de `/moi` ; quand le réseau ne les a pas — le testnet —,
 * l'option est montrée GRISÉE avec la raison, une fois, plutôt qu'un bouton qui échoue.
 *
 * Sur le testnet, le vrai chemin est le ROBINET (des USDC d'essai, gratuits) : il est
 * alors le bouton principal, parce que personne n'a d'USDC de test dans MetaMask.
 *
 * ─── APRÈS LA SIGNATURE, ON ATTEND AVEC LUI ───────────────────────────────────
 *
 * Un transfert signé n'est pas un solde crédité : il faut que le guetteur voie le bloc.
 * Le guide reste ouvert, interroge le backend toutes les quatre secondes
 * (`caisse.releverDepots`) et bascule sur « Credited! » avec le solde — puis PLAY. Le
 * joueur n'a jamais à cliquer CHECK DEPOSITS ni à deviner si c'est passé.
 *
 * Ce module dessine et enchaîne. L'argent bouge dans `compte.js` (les transactions) et
 * dans `caisse.js` (le solde relu) ; ici, aucun montant n'est inventé.
 */

import { sfx } from './audio.js';
import { MICROS, montant } from './economie.js';
import { portefeuille, caisse } from './caisse.js';
import {
  walletNavigateur, walletChoisi, comptesConnus, connecterLeWallet, soldesDuWallet, devisDeSwap,
  deposerDepuisWallet, deposerParSwap, messageErreur,
} from './compte.js';

const el = (id) => document.getElementById(id);

/** Les montants proposés, en USDC — les trois tables du jeu. */
export const MONTANTS = [5, 10, 20];
/** Ce qu'on propose sans rien savoir du joueur : la table du milieu. */
export const MONTANT_DEFAUT = 10;
/** Marge sur le devis d'un swap : le cours peut bouger d'ici au bloc ; l'excédent revient. */
const MARGE_SWAP_BP = 100n;
/** Le guetteur est interrogé à ce rythme après une transaction, pendant au plus ce temps. */
const POLL_MS = 4000;
const POLL_MAX_MS = 4 * 60_000;

const JETONS = {
  usdc: { nom: 'USDC', decimales: 6, sous: 'Straight to your game wallet' },
  usdg: { nom: 'USDG', decimales: 6, sous: 'Swapped to USDC on the way' },
  eth: { nom: 'ETH', decimales: 18, sous: 'Swapped to USDC on the way' },
};

let construit = false;
let onChangement = () => {};
let etat = null;
/** Numéro du dernier devis demandé : un devis en retard ne doit pas écraser le courant. */
let devisNo = 0;
let pollChrono = null;

/** Les millièmes d'unité native → texte court (ETH à 4 décimales, dollars à 2). */
function formater(natif, decimales) {
  if (natif === null || natif === undefined) return '—';
  const d = decimales === 18 ? 4 : 2;
  const base = 10n ** BigInt(decimales);
  const entier = natif / base;
  const frac = (natif % base) * 10n ** BigInt(d) / base;
  return `${entier}.${String(frac).padStart(d, '0')}`;
}

/** Les chemins que CE réseau et CE navigateur permettent, et pourquoi pas sinon. */
function chemins(p) {
  const wallet = Boolean(walletNavigateur());
  const c = p?.chaine ?? {};
  const testnet = p?.reseau && p.reseau !== 'mainnet';
  return {
    wallet,
    usdc: { ok: wallet && Boolean(c.usdc), raison: !wallet ? 'No wallet in this browser' : 'USDC contract unknown' },
    usdg: {
      ok: wallet && Boolean(c.usdg && c.swap),
      raison: !wallet ? 'No wallet in this browser' : testnet ? 'Mainnet only — no USDG on the testnet' : 'No USDG market on this network',
    },
    eth: {
      ok: wallet && Boolean(c.swap?.weth),
      raison: !wallet ? 'No wallet in this browser' : testnet ? 'Mainnet only — no ETH/USDC market on the testnet' : 'No ETH/USDC market on this network',
    },
    robinet: Boolean(c.robinet),
  };
}

export function buildDepot(surChangement = () => {}) {
  onChangement = surChangement;
  const fond = el('depot');
  if (!fond || construit) return;
  construit = true;

  // Les jetons et les montants : construits une fois, repeints à chaque état.
  const jetons = el('depot-jetons');
  for (const [id, j] of Object.entries(JETONS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dp-jeton';
    b.dataset.jeton = id;
    b.innerHTML = `<b>${j.nom}</b><span class="dp-jeton-solde">—</span><small>${j.sous}</small>`;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      sfx.click();
      etat.jeton = id;
      peindre();
      devis();
    });
    jetons.appendChild(b);
  }
  const montants = el('depot-montants');
  for (const usdc of MONTANTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dp-montant';
    b.dataset.usdc = String(usdc);
    b.innerHTML = `<b>${usdc}</b><small>USDC</small>`;
    b.addEventListener('click', () => { sfx.click(); poserMontant(usdc * MICROS); });
    montants.insertBefore(b, montants.querySelector('label'));
  }
  const champ = el('depot-montant');
  champ.addEventListener('input', () => {
    const v = Number(champ.value);
    if (v > 0) { etat.micros = Math.round(v * MICROS); peindre(false); devis(); }
  });
  for (const type of ['keydown', 'keyup']) {
    champ.addEventListener(type, (e) => { e.stopPropagation(); if (type === 'keydown' && e.key === 'Enter') el('depot-go').click(); });
  }

  el('depot-go').addEventListener('click', () => lancer());
  el('depot-robinet').addEventListener('click', () => robinet());
  el('depot-adresse-btn').addEventListener('click', () => {
    sfx.click();
    el('depot-adresse-bloc').classList.toggle('hidden');
  });
  el('depot-copier').addEventListener('click', async () => {
    sfx.click();
    try { await navigator.clipboard.writeText(etat?.profil?.adresseDepot ?? ''); dire('Address copied.', true); } catch { dire('Copy refused by the browser — select the address instead.'); }
  });
  el('depot-2-retour').addEventListener('click', () => { sfx.click(); allerA(1); });
  el('depot-jouer').addEventListener('click', () => {
    sfx.click();
    fermer();
    // La suite naturelle : PLAY, s'il est ouvert. Sinon le lobby dit pourquoi.
    const play = el('play');
    if (play && !play.disabled) play.click();
  });
  el('depot-connexion').addEventListener('click', () => { sfx.click(); fermer(); el('btn-compte')?.click(); });

  const fermerSi = (e) => { if (e.target === fond) fermer(); };
  fond.addEventListener('click', fermerSi);
  el('depot-fermer').addEventListener('click', () => { sfx.click(); fermer(); });
  fond.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') fermer(); });
  fond.addEventListener('keyup', (e) => e.stopPropagation());

  // Les deux portes vers ce guide, en dehors de l'enchaînement d'arrivée : le panneau
  // WALLET, et la note sous PLAY quand le solde ne couvre pas la table.
  document.addEventListener('tumble-depot-ouvrir', (e) => ouvrirDepot(e.detail ?? {}));
  el('play-note')?.addEventListener('click', () => {
    if (el('play-note').dataset.action === 'depot') ouvrirDepot({ raison: 'solde' });
  });

  // Pour les harnais : ouvrir avec un profil imposé, lire l'état.
  window.__probeDepot = { ouvrir: ouvrirDepot, fermer, etat: () => etat && ({ ...etat, profil: undefined }) };
}

const dire = (texte, ok = false) => {
  const m = el('depot-msg');
  m.textContent = texte;
  m.classList.toggle('ok', ok);
};

/**
 * Ouvre le guide. `profil` imposé : les harnais, qui n'ont pas de backend, s'en servent
 * pour montrer le formulaire du mainnet (USDG, ETH). Sinon, celui de la caisse.
 */
export async function ouvrirDepot({ raison = 'bienvenue', profil = null } = {}) {
  const fond = el('depot');
  if (!fond) return;
  dire('');
  fond.classList.remove('hidden');
  document.body.classList.add('depot-ouvert');

  let p = profil ?? caisse.profil;
  if (!p && !profil) p = await caisse.rafraichir();
  etat = {
    etape: 1, raison, profil: p, chemins: chemins(p),
    jeton: 'usdc', micros: MONTANT_DEFAUT * MICROS,
    compte: null, soldes: null, devis: null, devisErreur: null, hache: null,
    soldeAvant: portefeuille.solde,
  };
  if (raison === 'bienvenue' && portefeuille.solde > 0) {
    // Un joueur qui revient avec un solde : le guide le dit, et n'insiste pas.
    el('depot-titre').textContent = 'Your game wallet';
    el('depot-sous').textContent = `You already have ${montant(portefeuille.solde)} USDC on your table. Add more here, or close this and play.`;
  } else if (raison === 'bienvenue') {
    el('depot-titre').textContent = 'Now, fund your game wallet';
    el('depot-sous').textContent = 'Your first table costs 2 USDC. Pick what you have — we handle the network, the swap and the credit.';
  } else {
    el('depot-titre').textContent = 'Add funds';
    el('depot-sous').textContent = 'Pick what you have in your wallet. One confirmation, and it lands on your game wallet.';
  }
  allerA(1);
  peindre();

  if (!p) return;
  // Ce que le wallet montre DÉJÀ, sans fenêtre : de quoi choisir à sa place.
  if (etat.chemins.wallet) {
    const [compte] = await comptesConnus();
    if (compte) await lireWallet(compte);
  }
  devis();
}

export function fermer() {
  clearTimeout(pollChrono);
  el('depot')?.classList.add('hidden');
  document.body.classList.remove('depot-ouvert');
}

/** Lit les soldes du wallet sur la chaîne, et pré-choisit le jeton le mieux garni. */
async function lireWallet(compte) {
  etat.compte = compte;
  peindre();
  try {
    etat.soldes = await soldesDuWallet(etat.profil.chaine, compte);
  } catch {
    etat.soldes = null;
    return;
  }
  /*
   * LE CHOIX PAR DÉFAUT : ce qu'il a le plus, parmi ce que le réseau accepte. Les
   * dollars se comparent entre eux ; l'ETH ne l'emporte que si les deux stables sont
   * à zéro — on ne connaît pas son cours ici, et un swap n'est jamais le chemin le
   * plus court quand un stable existe.
   */
  const s = etat.soldes;
  const c = etat.chemins;
  const candidats = [
    c.usdc.ok && s.usdc ? ['usdc', s.usdc] : null,
    c.usdg.ok && s.usdg ? ['usdg', s.usdg] : null,
  ].filter(Boolean).sort((a, b) => (a[1] > b[1] ? -1 : 1));
  if (candidats.length) etat.jeton = candidats[0][0];
  else if (c.eth.ok && s.eth > 0n) etat.jeton = 'eth';
  // Et un montant qu'il PEUT payer : la table du milieu, ou ce qu'il a s'il a moins.
  if (etat.jeton !== 'eth') {
    const dispo = Number(s[etat.jeton] ?? 0n);
    if (dispo > 0 && dispo < etat.micros) etat.micros = Math.max(etat.profil.depotMinimum ?? MICROS, Math.floor(dispo / 10_000) * 10_000);
  }
  peindre();
  devis();
}

function poserMontant(micros) {
  etat.micros = micros;
  el('depot-montant').value = '';
  peindre();
  devis();
}

/** Le devis d'un swap, pour le montant courant. Silencieux pour l'USDC : rien à changer. */
async function devis() {
  if (!etat?.profil) return;
  etat.devis = null; etat.devisErreur = null;
  if (etat.jeton === 'usdc') { peindre(false); return; }
  const no = ++devisNo;
  peindre(false);
  try {
    const entree = await devisDeSwap(etat.profil.chaine, etat.jeton, etat.micros);
    if (no !== devisNo) return;
    etat.devis = entree;
  } catch (e) {
    if (no !== devisNo) return;
    etat.devisErreur = e?.code === 'SWAP_ABSENT' ? 'No market for this on this network.' : 'No quote — the market did not answer. Try again in a moment.';
  }
  peindre(false);
}

function allerA(n) {
  etat.etape = n;
  for (const s of el('depot').querySelectorAll('.dp-etape')) s.classList.toggle('on', Number(s.dataset.n) <= n);
  for (const i of [1, 2, 3]) el(`depot-${i}`).classList.toggle('hidden', i !== n);
  el('depot-fermer').classList.toggle('hidden', n === 2 && etat.hache === null && etat.enCours);
}

/** Repeint l'étape 1 depuis l'état. `jetonsAussi` : les cartes de jetons changent rarement. */
function peindre(jetonsAussi = true) {
  if (!etat) return;
  const p = etat.profil;
  const c = etat.chemins;
  const sansCompte = !p;
  el('depot-sans-compte').classList.toggle('hidden', !sansCompte);
  el('depot-formulaire').classList.toggle('hidden', sansCompte);
  if (sansCompte) return;

  const testnet = p.reseau !== 'mainnet';
  if (jetonsAussi) {
    for (const b of el('depot-jetons').querySelectorAll('.dp-jeton')) {
      const id = b.dataset.jeton;
      const ch = c[id];
      b.disabled = !ch.ok;
      b.classList.toggle('on', etat.jeton === id);
      b.title = ch.ok ? '' : ch.raison;
      const solde = b.querySelector('.dp-jeton-solde');
      if (!ch.ok) solde.textContent = ch.raison;
      else if (!etat.compte) solde.textContent = 'Connect to see your balance';
      else if (!etat.soldes) solde.textContent = 'Reading your balance…';
      else solde.textContent = `You have ${formater(etat.soldes[id], JETONS[id].decimales)} ${JETONS[id].nom}`;
    }
    // Sans wallet dans le navigateur, le choix du jeton n'a pas de sens : on cache la
    // rangée et on montre les deux chemins qui restent (robinet, adresse).
    el('depot-jetons').classList.toggle('hidden', !c.wallet);
    el('depot-wallet-etat').textContent = !c.wallet
      ? 'No wallet found in this browser — install MetaMask, Rabby or Robinhood Wallet, or send from an exchange below.'
      : etat.compte ? `${walletChoisi()?.nom ?? 'Wallet'} ${etat.compte.slice(0, 6)}…${etat.compte.slice(-4)}` : '';
    // Le testnet en tête : c'est LE chemin quand on y est. Sur mainnet, le bloc n'existe pas.
    el('depot-testnet').classList.toggle('hidden', !c.robinet);
    if (c.robinet) el('depot-robinet').textContent = `GET ${montant(p.chaine.robinetMicros)} TEST USDC · FREE`;
    el('depot-adresse').textContent = p.adresseDepot ?? '—';
    el('depot-adresse').href = p.liens?.explorateur && p.adresseDepot ? `${p.liens.explorateur}/address/${p.adresseDepot}` : '#';
    el('depot-adresse-note').textContent = `USDC on ${p.chaine?.nom ?? p.reseau} only. Minimum ${montant(p.depotMinimum)} USDC. This is your own game wallet: stakes leave it, winnings come back to it.`;
    // Sans wallet, l'adresse est LE chemin : elle est déjà dépliée.
    if (!c.wallet) el('depot-adresse-bloc').classList.remove('hidden');
  }

  for (const b of el('depot-montants').querySelectorAll('.dp-montant')) {
    b.classList.toggle('on', Number(b.dataset.usdc) * MICROS === etat.micros);
  }
  const champ = el('depot-montant');
  if (!MONTANTS.some((m) => m * MICROS === etat.micros) && document.activeElement !== champ) champ.value = String(etat.micros / MICROS);

  const go = el('depot-go');
  const note = el('depot-note');
  const recu = el('depot-recu');
  const j = JETONS[etat.jeton];
  const usdc = montant(etat.micros);
  const sousMinimum = etat.micros < (p.depotMinimum ?? 0);
  note.classList.remove('alerte');
  go.classList.toggle('hidden', !c.wallet);

  if (!c.wallet) {
    recu.textContent = '';
    note.textContent = '';
  } else if (!etat.compte) {
    go.disabled = false;
    go.textContent = 'CONNECT WALLET';
    recu.textContent = `${usdc} USDC will land on your game wallet.`;
    note.textContent = 'Your wallet will ask once to connect. No transaction yet.';
  } else if (sousMinimum) {
    go.disabled = true;
    go.textContent = `DEPOSIT ${usdc} USDC`;
    recu.textContent = '';
    note.classList.add('alerte');
    note.textContent = `Minimum deposit is ${montant(p.depotMinimum)} USDC.`;
  } else if (etat.jeton === 'usdc') {
    const assez = !etat.soldes || etat.soldes.usdc === null || Number(etat.soldes.usdc) >= etat.micros;
    go.disabled = !assez;
    go.textContent = `DEPOSIT ${usdc} USDC`;
    recu.textContent = `${usdc} USDC leaves your wallet and lands on your game wallet.`;
    note.classList.toggle('alerte', !assez);
    note.textContent = assez
      ? 'One confirmation in your wallet. You pay the network fee — a few cents.'
      : `Not enough USDC in your wallet — ${etat.soldes ? formater(etat.soldes.usdc, 6) : '0.00'} available. Pick another way to pay.`;
  } else {
    const d = etat.devis;
    if (etat.devisErreur) {
      go.disabled = true;
      go.textContent = `PAY WITH ${j.nom}`;
      recu.textContent = '';
      note.classList.add('alerte');
      note.textContent = etat.devisErreur;
    } else if (d === null) {
      go.disabled = true;
      go.textContent = 'GETTING A QUOTE…';
      recu.textContent = `${usdc} USDC will land on your game wallet.`;
      note.textContent = 'Reading the market price…';
    } else {
      const max = d + d * MARGE_SWAP_BP / 10_000n;
      const assez = !etat.soldes || etat.soldes[etat.jeton] === null || etat.soldes[etat.jeton] >= max;
      go.disabled = !assez;
      go.textContent = `PAY ≈ ${formater(d, j.decimales)} ${j.nom} → ${usdc} USDC`;
      recu.textContent = `Swapped in your wallet, ${usdc} USDC lands straight on your game wallet. Up to ${formater(max, j.decimales)} ${j.nom} reserved — the unused part comes back.`;
      note.classList.toggle('alerte', !assez);
      note.textContent = !assez
        ? `Not enough ${j.nom} in your wallet — ${etat.soldes ? formater(etat.soldes[etat.jeton], j.decimales) : '0'} available.`
        : etat.jeton === 'eth'
          ? 'One confirmation in your wallet. The swap and the deposit are the same transaction.'
          : 'Two confirmations: allow the swap, then confirm it. The USDC goes straight to your game wallet.';
    }
  }
  // Le pied de la note rappelle le réseau d'essai : de l'argent qui n'en est pas.
  if (testnet && c.wallet && etat.compte) note.textContent += ' Test network — nothing here is real money.';
}

/** Le bouton principal : connecter, ou signer. */
async function lancer() {
  if (!etat?.profil) return;
  sfx.click();
  const p = etat.profil;

  if (!etat.compte) {
    dire('');
    try {
      const compte = await connecterLeWallet();
      await lireWallet(compte);
    } catch (e) { dire(messageErreur(e)); }
    return;
  }

  const j = JETONS[etat.jeton];
  etat.enCours = true;
  etat.hache = null;
  el('depot-2-titre').textContent = 'Confirm in your wallet';
  el('depot-2-sous').textContent = etat.jeton === 'usdc'
    ? `Switch to ${p.chaine?.nom ?? 'Robinhood Chain'} if asked, then confirm the ${montant(etat.micros)} USDC transfer.`
    : etat.jeton === 'eth'
      ? `Switch to ${p.chaine?.nom ?? 'Robinhood Chain'} if asked, then confirm the swap — ${montant(etat.micros)} USDC arrives on your game wallet.`
      : `Switch network if asked, allow the swap, then confirm it — ${montant(etat.micros)} USDC arrives on your game wallet.`;
  el('depot-2-liste').innerHTML = [
    `Your wallet opens on ${p.chaine?.nom ?? 'Robinhood Chain'}`,
    etat.jeton === 'usdg' ? `Allow, then confirm the ${j.nom} → USDC swap` : etat.jeton === 'eth' ? 'Confirm the ETH → USDC swap' : 'Confirm the USDC transfer',
    'We watch the chain and credit your table',
  ].map((t, i) => `<li${i === 0 ? ' class="on"' : ''}>${t}</li>`).join('');
  allerA(2);
  dire('');

  try {
    let hache;
    if (etat.jeton === 'usdc') {
      hache = await deposerDepuisWallet({ chaine: p.chaine, adresseDepot: p.adresseDepot, micros: etat.micros });
    } else {
      const entreeMax = etat.devis + etat.devis * MARGE_SWAP_BP / 10_000n;
      hache = await deposerParSwap({ chaine: p.chaine, adresseDepot: p.adresseDepot, entree: etat.jeton, microsSortie: etat.micros, entreeMax });
    }
    etat.hache = hache;
  } catch (e) {
    etat.enCours = false;
    allerA(1);
    dire(messageErreur(e));
    return;
  }
  etat.enCours = false;
  attendreCredit();
}

/** Le robinet du testnet : le backend frappe et crédite tout de suite. */
async function robinet() {
  if (!etat?.profil) return;
  sfx.click();
  el('depot-2-titre').textContent = 'Asking the faucet…';
  el('depot-2-sous').textContent = 'Test USDC are minted straight onto your game wallet. No wallet needed.';
  el('depot-2-liste').innerHTML = '<li class="on">The backend mints test USDC</li><li>Your table is credited</li>';
  allerA(2);
  dire('');
  try {
    const r = await caisse.robinet();
    await caisse.rafraichir();
    reussi(r.montant);
  } catch (e) {
    allerA(1);
    dire(e?.code === 'ROBINET_TROP_TOT' ? e.message.replace('le robinet rouvre dans', 'The faucet reopens in') : messageErreur(e));
  }
}

/**
 * La transaction est partie : on demande au guetteur, à intervalle, jusqu'à ce que le
 * solde ait bougé. Le joueur voit le temps passer et ce qu'on attend ; il peut fermer,
 * le crédit arrivera quand même.
 */
function attendreCredit() {
  const debut = Date.now();
  const soldeAvant = etat.soldeAvant;
  el('depot-2-titre').textContent = 'Sent! Waiting for the chain…';
  // Tout de suite, pas au premier tour : une ligne qui dit encore « confirm » sous un
  // titre qui dit « sent » se lit comme une contradiction.
  el('depot-2-sous').textContent = `Transaction ${etat.hache?.slice(0, 10)}… is on its way. Checking the chain.`;
  el('depot-2-liste').querySelectorAll('li').forEach((li, i, all) => li.classList.toggle('on', i === all.length - 1));
  el('depot-2-retour').textContent = 'Close — it will be credited anyway';
  const tour = async () => {
    const s = Math.round((Date.now() - debut) / 1000);
    el('depot-2-sous').textContent = `Transaction ${etat.hache?.slice(0, 10)}… is on its way. Checking the chain (${s} s).`;
    try {
      await caisse.releverDepots();
      await caisse.rafraichir();
    } catch { /* le prochain tour réessaie */ }
    if (portefeuille.solde > soldeAvant) { reussi(portefeuille.solde - soldeAvant); return; }
    if (Date.now() - debut > POLL_MAX_MS) {
      el('depot-2-titre').textContent = 'Still not confirmed';
      el('depot-2-sous').textContent = 'The chain is slow right now. Your deposit will be credited as soon as it is confirmed — check WALLET later.';
      return;
    }
    pollChrono = setTimeout(tour, POLL_MS);
  };
  pollChrono = setTimeout(tour, 1500);
}

function reussi(micros) {
  clearTimeout(pollChrono);
  sfx.checkpoint?.();
  el('depot-3-titre').textContent = 'Credited!';
  el('depot-3-montant').innerHTML = `+${montant(micros)}<small>USDC</small>`;
  el('depot-3-sous').textContent = `Your table now holds ${montant(portefeuille.solde)} USDC. Stakes leave it at launch, winnings come back on-chain.`;
  allerA(3);
  onChangement();
}
