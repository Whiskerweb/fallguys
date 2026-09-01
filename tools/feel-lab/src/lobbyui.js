import { cosmetics, MODELS, RARITY } from './cosmetics.js';
import { assets } from './assets.js';
import { sfx } from './audio.js';
import {
  MICROS, PALIERS, CONFIG,
  table, echelle, montant, facteur, ordinal, miseChoisie, choisirMise,
  progression, surChangement,
} from './economie.js';
import { portefeuille, caisse } from './caisse.js';
import { CONFIGURE, session, connecter, creerCompte, deconnecter, messageErreur } from './compte.js';

/**
 * Interface du lobby : la barre noire, le ticket d'entrée, la vitrine des personnages.
 *
 * Le lobby ne montre plus que ce qui existe. Les onglets Boutique et Collaborations
 * affichaient huit lignes écrites en dur sur lesquelles aucun clic n'était branché ;
 * un bouton qui promet une fonctionnalité inexistante coûte plus cher qu'un bouton
 * absent, surtout dans un jeu où l'on engage de l'argent. Restent donc : choisir son
 * personnage, choisir sa table, jouer.
 *
 * Aucun montant n'est écrit ici. Tout sort de `economie.js`, qui est le port du noyau de
 * règles C# — le ticket annonce exactement ce que le règlement paiera.
 */

const el = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** Personnage porté, ou le premier du catalogue si la mémoire pointe dans le vide. */
const modeleCourant = () => MODELS.find((m) => m.id === cosmetics.model) ?? MODELS[0];
const couleurRarete = (m) => (RARITY[m?.rarity] ?? RARITY.common).color;

/**
 * Icônes générées, avec repli sur le glyphe d'origine si le fichier manque.
 * Le repli n'est pas de la coquetterie : le dépôt doit rester jouable sans avoir lancé
 * `icon-pipeline/generate.mjs`, qui consomme des crédits.
 */
export async function applyIcons() {
  let names = [];
  try {
    const res = await fetch('/icons/manifest.json', { cache: 'no-store' });
    if (res.ok) names = await res.json();
  } catch { return 0; }

  const MAP = {
    'icon-skins': '#btn-perso .ico',
    'icon-settings': '#btn-settings',
  };
  let applied = 0;
  for (const [name, sel] of Object.entries(MAP)) {
    if (!names.includes(name)) continue;
    const node = document.querySelector(sel);
    if (!node) continue;
    node.innerHTML = `<img src="/icons/${name}.png" alt="">`;
    applied++;
  }
  console.log(`[icones] ${applied} icones personnalisees appliquees`);
  return applied;
}

// ---------- la barre noire ----------

/** Rafraîchit portrait, niveau, XP et solde. Appelée à chaque mouvement de l'économie. */
export function majBarre() {
  const m = modeleCourant();

  const port = el('profil-port');
  if (port) {
    port.src = `/icons/port-${m.id}.png`;
    port.onerror = () => { port.style.visibility = 'hidden'; };
  }
  el('profil')?.style.setProperty('--rar', couleurRarete(m));

  const { niveau, dans, pour } = progression.etat;
  el('profil-niveau').textContent = String(niveau);
  el('xp-fill').style.width = `${Math.min(100, (dans / pour) * 100)}%`;
  el('xp-num').textContent = `${dans} / ${pour}`;

  el('balance').textContent = montant(portefeuille.solde);
  const court = portefeuille.solde < miseChoisie();
  el('solde').classList.toggle('court', court);

  /*
   * TOP UP hors ligne, DEPOSIT en ligne — le meme bouton, deux gestes opposes.
   *
   * Hors ligne, il se redonne 25 USDC fictifs : c'est la dotation du prototype. En ligne,
   * il n'existe evidemment aucun bouton pour se donner de l'argent ; il montre l'adresse
   * ou envoyer de vrais USDC. Garder le libelle « TOP UP » sur un compte reel promettrait
   * exactement ce que le bouton ne fait pas.
   */
  const bouton = el('recharger');
  bouton.classList.toggle('hidden', !portefeuille.bloque);
  bouton.textContent = caisse.enLigne ? 'DEPOSIT' : 'TOP UP';
  bouton.title = caisse.enLigne
    ? 'Show your personal USDC deposit address'
    : 'Prototype: restores the starting balance';
}

// ---------- le ticket ----------

/** « 1st », « 5th–8th » — le rang tel qu'on le dit, pas tel qu'on l'indexe. */
function libelleRang(depuis, jusqu) {
  return depuis === jusqu ? ordinal(depuis) : `${ordinal(depuis)}–${ordinal(jusqu)}`;
}

const ICONE_RANG = { 1: 'icon-rank-1', 2: 'icon-rank-2', 3: 'icon-rank-3' };

/**
 * Construit le ticket : les trois tables, le pot, l'échelle des gains, le bouton.
 * `onJouer(miseMicros)` est appelé avec la mise engagée.
 */
export function buildTicket(onJouer) {
  const boiteMises = el('paliers');
  boiteMises.innerHTML = '';

  for (const usdc of PALIERS) {
    const b = document.createElement('button');
    b.className = 'palier';
    b.dataset.usdc = String(usdc);
    b.innerHTML = '<b></b><i>USDC</i>';
    b.querySelector('b').textContent = String(usdc);
    b.addEventListener('click', () => {
      if (b.classList.contains('mort')) return;
      choisirMise(usdc);
      sfx.click();
    });
    boiteMises.appendChild(b);
  }

  el('play').addEventListener('click', () => {
    const mise = miseChoisie();
    if (portefeuille.solde < mise) return;
    sfx.click();
    onJouer?.(mise);
  });

  el('recharger').addEventListener('click', async (e) => {
    e.stopPropagation();
    sfx.click();

    if (!caisse.enLigne) { portefeuille.recharger(); return; }

    /*
     * En ligne : on montre l'adresse de depot du joueur, et on la copie.
     *
     * Une adresse Solana ne se recopie pas a la main sans faute de frappe, et une faute de
     * frappe sur une adresse envoie les fonds dans le vide, definitivement. Le
     * presse-papiers n'est donc pas un confort : c'est la seule facon sure de transmettre
     * une adresse a un humain.
     */
    const note = el('play-note');
    const adresse = caisse.profil?.adresseDepot;
    if (!adresse) { note.textContent = 'Sign in to get a deposit address.'; return; }

    try { await navigator.clipboard.writeText(adresse); } catch { /* refus du navigateur */ }
    const mini = montant(caisse.profil.depotMinimum);
    note.textContent = `Send USDC (${caisse.profil.reseau}) to ${adresse} — copied. `
      + `Minimum ${mini} USDC.`;

    // On va voir tout de suite si quelque chose est deja arrive : le joueur qui vient de
    // deposer rouvre le lobby et veut son solde, pas un delai de guetteur.
    caisse.releverDepots().catch(() => {});
  });

  // Un seul chemin de rafraichissement : toute variation de solde, d'XP ou de mise
  // repasse par la, qu'elle vienne d'un clic ou de la fin d'une partie.
  surChangement(rafraichirTicket);
  rafraichirTicket();
}

/** Recalcule tout le ticket depuis la mise sélectionnée. Aucun chiffre n'est conservé. */
export function rafraichirTicket() {
  const mise = miseChoisie();
  const solde = portefeuille.solde;
  const { pot } = table(mise);

  for (const b of document.querySelectorAll('.palier')) {
    const usdc = Number(b.dataset.usdc);
    b.classList.toggle('on', usdc * MICROS === mise);
    // Une table hors de portée reste visible mais inerte : la masquer donnerait
    // l'impression que le jeu en propose moins qu'il n'en propose.
    b.classList.toggle('mort', usdc * MICROS > solde);
    b.title = usdc * MICROS > solde ? 'Not enough balance for this table' : `${usdc} USDC table`;
  }

  el('pot-val').innerHTML = `${montant(pot)}<small>USDC</small>`;
  el('pot-sub').textContent =
    `${CONFIG.joueurs} players · ${CONFIG.survivants.length} rounds · ${CONFIG.rakeBp / 100}% rake`;

  const boite = el('echelle');
  boite.innerHTML = '';
  for (const ligne of echelle(mise)) {
    const row = document.createElement('div');
    row.className = 'ech'
      + (ligne.gain === 0 ? ' rien' : '')
      + (ligne.rembourse ? ' rendu' : '')
      + (ligne.depuis === 1 ? ' or' : '');

    const ico = document.createElement('div');
    ico.className = 'ico';
    const nom = ligne.rembourse ? 'icon-refund' : ICONE_RANG[ligne.depuis];
    if (nom) {
      const img = document.createElement('img');
      img.src = `/icons/${nom}.png`;
      img.alt = '';
      // Sans le fichier, on retombe sur la pastille chiffrée plutôt que sur un vide.
      img.onerror = () => { img.remove(); ico.appendChild(pastille(ligne.depuis)); };
      ico.appendChild(img);
    } else {
      ico.appendChild(pastille(ligne.depuis));
    }

    const rang = document.createElement('div');
    rang.className = 'rang';
    rang.textContent = libelleRang(ligne.depuis, ligne.jusqu);

    const gain = document.createElement('div');
    gain.className = 'gain';
    gain.textContent = ligne.gain === 0 ? '—' : montant(ligne.gain);

    const fact = document.createElement('div');
    fact.className = 'fact';
    fact.textContent = ligne.gain === 0 ? 'nothing' : (ligne.rembourse ? 'stake back' : facteur(ligne.facteur));

    row.append(ico, rang, gain, fact);
    boite.appendChild(row);
  }

  const jouable = solde >= mise;
  el('play').disabled = !jouable;
  const note = el('play-note');
  note.classList.toggle('alerte', !jouable);
  // Ce que la note doit dire tient en un fait : l'argent part au lancement. Le montant
  // est deja sur la pastille et le seuil est deja dans l'echelle — les repeter ici
  // faisait deborder le ticket sans rien apprendre.
  note.textContent = jouable
    ? 'Your stake is committed at launch'
    : 'Not enough balance for this table';

  majBarre();
}

function pastille(n) {
  const u = document.createElement('u');
  u.textContent = String(n);
  return u;
}

// ---------- la vitrine des personnages ----------

/** Vignettes carrées à droite, fiche du personnage sélectionné à gauche. */
export function buildSkinsScreen(onChange) {
  const grid = el('skins-grid');
  grid.innerHTML = '';

  for (const m of MODELS) {
    const available = assets.has(m.id);
    const tile = document.createElement('div');
    const porte = m.id === cosmetics.model;
    tile.className = 'tile' + (porte ? ' on' : '') + (available ? '' : ' locked');
    tile.title = m.name;
    // La rareté teinte le cadre ET le halo : c'est ce qui sépare les personnages, et
    // cinq tuiles grises identiques ne le disaient pas.
    tile.style.setProperty('--rar', couleurRarete(m));

    // Vignette peinte si elle existe, sinon une pastille à la couleur du personnage :
    // une case vide serait moins lisible qu'un repère colorié.
    const img = document.createElement('img');
    img.src = `/icons/port-${m.id}.png`;
    img.alt = m.name;
    img.onerror = () => {
      img.remove();
      const fb = document.createElement('div');
      fb.className = 'fallback';
      fb.textContent = m.name.slice(0, 2).toUpperCase();
      fb.style.background = hex(m.accent ?? 0x888888);
      tile.appendChild(fb);
    };
    tile.appendChild(img);

    if (porte) {
      const badge = document.createElement('div');
      badge.className = 'porte';
      badge.textContent = 'EQUIPPED';
      tile.appendChild(badge);
    }

    if (!available) {
      const lock = document.createElement('div');
      lock.className = 'lock';
      lock.textContent = 'SOON';
      tile.appendChild(lock);
    }

    tile.addEventListener('mouseenter', () => showInfo(m, available));
    if (available) {
      tile.addEventListener('click', () => {
        cosmetics.setModel(m.id);
        sfx.click();
        buildSkinsScreen(onChange);
        showInfo(m, true);
        majBarre();
        onChange?.();
      });
    }
    grid.appendChild(tile);
  }

  const current = modeleCourant();
  showInfo(current, assets.has(current.id));
  // Construite au demarrage, la fiche ne doit apparaitre qu'une fois la vitrine ouverte.
  if (!el('screen-skins')?.classList.contains('on')) el('skin-info')?.classList.add('hidden');
}

/** Fiche descriptive, à gauche sous le personnage. */
function showInfo(m, available) {
  const box = el('skin-info');
  box.classList.remove('hidden');
  const r = RARITY[m.rarity] ?? RARITY.common;
  const rar = el('skin-rarity');
  rar.textContent = r.label;
  rar.style.background = r.color;
  el('skin-name').textContent = m.name;
  el('skin-desc').textContent = m.desc ?? '';
  el('skin-meta').textContent = m.season ?? '';

  const chips = el('skin-chips');
  chips.innerHTML = '';
  for (const label of [
    m.rigged ? 'Skeletal animation' : 'No animation',
    available ? (m.id === cosmetics.model ? 'Equipped' : 'Available') : 'Coming soon',
  ]) {
    const c = document.createElement('div');
    c.className = 'chip';
    c.textContent = label;
    chips.appendChild(c);
  }
}

export function hideSkinInfo() { el('skin-info')?.classList.add('hidden'); }

/**
 * Bascule entre les deux seuls écrans du lobby : le plateau de lancement et la vitrine.
 * Il n'y a plus de barre d'onglets — deux états ne demandent pas un menu.
 */
export function wireEcrans(onEcran, onChangePerso) {
  const vitrine = el('screen-skins');

  function montrer(nom) {
    const enVitrine = nom === 'skins';
    vitrine.classList.toggle('on', enVitrine);
    el('skin-info').classList.toggle('hidden', !enVitrine);
    for (const id of ['playzone', 'leftpanel']) {
      el(id).style.display = enVitrine ? 'none' : '';
    }
    onEcran?.(nom);
  }

  const ouvrir = () => { sfx.click(); buildSkinsScreen(onChangePerso); montrer('skins'); };
  el('btn-perso').addEventListener('click', ouvrir);
  el('profil').addEventListener('click', ouvrir);
  el('btn-retour').addEventListener('click', () => { sfx.click(); montrer('play'); });

  return { montrer };
}

// ---------- le panneau de compte ----------

/**
 * Connexion par e-mail et mot de passe.
 *
 * Le panneau n'existe QUE si Supabase est configure. Sans backend, le jeu tourne sur le
 * portefeuille local et un bouton SIGN IN ne promettrait rien — on le cache plutot que de
 * le laisser echouer.
 */
export function buildCompte(onChangement) {
  const bouton = el('btn-compte');
  if (!CONFIGURE) { bouton.classList.add('hidden'); return; }

  const fond = el('compte-fond');
  const mail = el('compte-mail');
  const mdp = el('compte-mdp');
  const msg = el('compte-msg');

  const dire = (texte, ok = false) => {
    msg.textContent = texte;
    msg.classList.toggle('ok', ok);
  };

  /** Bascule entre « connectez-vous » et « vous etes connecte ». */
  async function peindre() {
    const s = await session();
    const connecte = Boolean(s);
    el('compte-titre').textContent = connecte ? 'Your account' : 'Sign in';
    el('compte-note').textContent = connecte
      ? s.user.email
      : 'Your balance and winnings are tied to this account.';
    for (const id of ['compte-mail', 'compte-mdp', 'compte-actions']) {
      el(id).classList.toggle('hidden', connecte);
    }
    el('compte-connecte').classList.toggle('hidden', !connecte);
    bouton.textContent = connecte ? 'ACCOUNT' : 'SIGN IN';

    // L'adresse de depot est la seule chose que le panneau ait a montrer une fois
    // connecte : c'est par elle que l'argent entre.
    const adr = caisse.profil?.adresseDepot;
    el('compte-adresse').textContent = adr
      ? `Deposit address (${caisse.profil.reseau}):\n${adr}`
      : 'Deposit address unavailable — is the backend running?';
  }

  /*
   * Toute action desactive les boutons le temps de son aller-retour.
   *
   * Ce n'est pas de la cosmetique : sans cela, deux clics rapides sur CREATE ACCOUNT
   * envoient deux inscriptions, et Supabase rate-limite l'adresse pour les minutes qui
   * suivent. Le joueur se retrouve alors bloque par sa propre impatience.
   */
  const boutons = ['compte-entrer', 'compte-creer', 'compte-sortir'];
  async function pendant(travail) {
    for (const b of boutons) el(b).disabled = true;
    try { await travail(); } finally { for (const b of boutons) el(b).disabled = false; }
  }

  const apres = async () => { await caisse.rafraichir(); await peindre(); majBarre(); onChangement?.(); };

  el('compte-entrer').addEventListener('click', () => pendant(async () => {
    dire('Signing in…');
    try {
      await connecter(mail.value.trim(), mdp.value);
      dire('Signed in.', true);
      await apres();
    } catch (e) { dire(messageErreur(e)); }
  }));

  el('compte-creer').addEventListener('click', () => pendant(async () => {
    dire('Creating account…');
    try {
      const r = await creerCompte(mail.value.trim(), mdp.value);
      if (r.confirmationRequise) {
        // On ne dit PAS « bienvenue » : il n'y a pas de session, et le premier appel a
        // l'API serait rejete. Mieux vaut annoncer l'etape qui manque.
        dire(`Account created. Confirm ${r.email} from your inbox, then sign in.`, true);
        return;
      }
      dire('Account created.', true);
      await apres();
    } catch (e) { dire(messageErreur(e)); }
  }));

  el('compte-sortir').addEventListener('click', () => pendant(async () => {
    await deconnecter();
    dire('Signed out.');
    await apres();
  }));

  const ouvrir = async () => { dire(''); fond.classList.remove('hidden'); await peindre(); };
  const fermer = () => fond.classList.add('hidden');

  bouton.addEventListener('click', () => { sfx.click(); ouvrir(); });
  el('compte-fermer').addEventListener('click', () => { sfx.click(); fermer(); });
  fond.addEventListener('click', (e) => { if (e.target === fond) fermer(); });
  // Entree vaut SIGN IN : c'est le geste attendu quand on vient de taper un mot de passe.
  for (const champ of [mail, mdp]) {
    champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') el('compte-entrer').click(); });
  }

  peindre();
}

// ---------- le panneau EN LIGNE ----------

/** Mémorisés : on rejoue le plus souvent sur le même serveur, sous le même nom. */
const CLE_URL = 'tumble-serveur';
const CLE_NOM = 'tumble-pseudo';

/**
 * Se connecter à un serveur de jeu et entrer dans la file d'attente.
 *
 * L'adresse est SAISIE, et c'est volontaire pour l'instant : deux machines qui se testent
 * ne visent pas la même adresse (`127.0.0.1` pour l'une, l'IP du réseau local pour
 * l'autre), et coder l'adresse en dur rendrait justement impossible le seul essai qu'on
 * veuille faire aujourd'hui. Le jour où il y aura un serveur de production, elle viendra
 * de la configuration et ce champ deviendra un réglage avancé.
 */
export function buildEnLigne(jeu) {
  const bouton = el('btn-enligne');
  const fond = el('enligne-fond');
  const url = el('enligne-url');
  const pseudo = el('enligne-nom');
  const msg = el('enligne-msg');
  const salon = el('enligne-salon');
  const accepter = el('enligne-accepter');
  const hud = el('enligne-hud');

  url.value = localStorage.getItem(CLE_URL) ?? 'ws://127.0.0.1:8080';
  pseudo.value = localStorage.getItem(CLE_NOM) ?? '';

  let branche = null;

  const dire = (texte, ok = false) => { msg.textContent = texte; msg.classList.toggle('ok', ok); };

  const peindre = () => {
    const connecte = Boolean(branche);
    el('enligne-jouer').classList.toggle('hidden', connecte);
    el('enligne-quitter').classList.toggle('hidden', !connecte);
    bouton.classList.toggle('actif', connecte);
    bouton.textContent = connecte ? 'ONLINE ●' : 'ONLINE';
  };

  /** Le bandeau de partie : ce qu'un joueur veut voir sans ouvrir de panneau. */
  function majHud() {
    if (!branche || !jeu.enligne) { hud.classList.add('hidden'); return; }
    const s = jeu.enligne.statistiques;
    hud.classList.remove('hidden');
    hud.textContent = `${s.latence} ms · ${s.figurants + 1} joueurs`
      + (s.recalages ? ` · ${s.recalages} recalages` : '');
  }
  setInterval(majHud, 500);

  function evenement(quoi, data) {
    if (quoi === 'etat') {
      if (data.etat === 'ouvert') dire('Connected. Looking for a match…', true);
      else if (data.etat === 'connexion') dire('Connecting…');
      else dire('Disconnected — retrying…');
      return;
    }

    if (quoi === 'salon') {
      salon.classList.remove('hidden');
      const reste = data.resteAAttendre;
      salon.textContent = `${data.humains} / ${data.cible} players`
        + (reste > 0 ? ` — starting in ${Math.ceil(reste)} s` : '');

      /*
       * La proposition de partir à effectif réduit, et ce qu'elle doit dire.
       *
       * Le joueur accepte un POT PLUS PETIT que celui qu'on lui a montré : il faut donc
       * l'annoncer, pas seulement demander « on y va ? ». Sous le minimum, le serveur ne
       * propose rien — et le panneau doit alors expliquer pourquoi on attend, sinon
       * l'attente ressemble à une panne.
       */
      accepter.classList.toggle('hidden', !data.proposition);
      if (data.proposition) {
        accepter.textContent = `START NOW WITH ${data.proposition.joueurs} PLAYERS`
          + ` (${data.proposition.accords}/${data.proposition.attendus} agreed)`;
      }
      if (data.sousLeMinimum) {
        salon.textContent = `${data.humains} players — need at least ${data.minimum} to start.`;
      }
      return;
    }

    if (quoi === 'manche') {
      fond.classList.add('hidden');
      salon.classList.add('hidden');
      accepter.classList.add('hidden');
      if (data.spectateur) jeu.banner?.('SPECTATING', 3);
      return;
    }

    if (quoi === 'fin-partie') {
      salon.classList.add('hidden');
      hud.classList.add('hidden');
      dire('Match over. Find another one?', true);
      return;
    }

    if (quoi === 'refus') dire(`Refused: ${data.raison}`);
  }

  el('enligne-jouer').addEventListener('click', async () => {
    const adresse = url.value.trim();
    const nom = pseudo.value.trim();
    if (!adresse || !nom) { dire('Server address and name are both required.'); return; }

    localStorage.setItem(CLE_URL, adresse);
    localStorage.setItem(CLE_NOM, nom);
    sfx.click();
    dire('Connecting…');

    // Chargé à la demande : un joueur qui ne fait que du solo n'a pas à télécharger le
    // netcode, et surtout les quarante harnais de `diag/` ne doivent jamais l'exécuter.
    const { brancherEnLigne } = await import('./enligne/brancher.js');
    branche = brancherEnLigne(jeu, { url: adresse, nom, mise: 0, surEvenement: evenement });
    peindre();

    // On entre dans la file dès que la connexion est ouverte.
    const attendre = setInterval(() => {
      if (jeu.enligne?.etat === 'ouvert' || branche.session.etat === 'ouvert') {
        clearInterval(attendre);
        branche.rejoindre(0);
      }
    }, 100);
  });

  el('enligne-quitter').addEventListener('click', () => {
    sfx.click();
    branche?.debrancher();
    branche = null;
    salon.classList.add('hidden');
    accepter.classList.add('hidden');
    hud.classList.add('hidden');
    dire('Left the queue.');
    peindre();
  });

  accepter.addEventListener('click', () => { sfx.click(); branche?.accepter(); });

  bouton.addEventListener('click', () => { sfx.click(); fond.classList.remove('hidden'); peindre(); });
  el('enligne-fermer').addEventListener('click', () => { sfx.click(); fond.classList.add('hidden'); });
  fond.addEventListener('click', (e) => { if (e.target === fond) fond.classList.add('hidden'); });
  for (const champ of [url, pseudo]) {
    champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') el('enligne-jouer').click(); });
  }

  peindre();
}
