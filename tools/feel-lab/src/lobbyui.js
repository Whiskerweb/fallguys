import { cosmetics, MODELS, RARITY } from './cosmetics.js';
import { assets } from './assets.js';
import { sfx } from './audio.js';
import {
  MICROS, PALIERS, MODES, ORDRE_MODES, VARIANTES,
  table, tableEffectif, echelle, roueDe, montant,
  miseChoisie, choisirMise, modeChoisi, choisirMode,
  progression, surChangement,
} from './economie.js';
/*
 * Ce fichier ne connaît PAS le réseau. Il dessine le ticket, et trois fonctions lui disent
 * ce que le serveur sait : `definirSalon` (le barème tiré), `definirLiaison` (connecté ou
 * non, en file ou non) et `majFiles` (qui attend où). Tout ce qui parle au serveur vit
 * dans `matchmaking.js`.
 */
import { apercu } from './roue.js';
import { portefeuille, caisse } from './caisse.js';
import {
  ARTICLES, JEU, apercuDuPost, lienDePost, marquerEnvoi,
  estDebloque, enAttente, attenteRestante, reclamer, verrouilles,
} from './boutique.js';
import { CONFIGURE, API, session, connecter, creerCompte, deconnecter, messageErreur, lierWallet } from './compte.js';

/**
 * Interface du lobby : la barre noire, le ticket d'entrée, la vitrine des personnages.
 *
 * Le lobby ne montre plus que ce qui existe. Les onglets Boutique et Collaborations
 * affichaient huit lignes écrites en dur sur lesquelles aucun clic n'était branché ;
 * un bouton qui promet une fonctionnalité inexistante coûte plus cher qu'un bouton
 * absent, surtout dans un jeu où l'on engage de l'argent. Restent donc : choisir son
 * personnage, choisir sa table, jouer.
 *
 * ET « JOUER » VEUT DIRE EN LIGNE. Il n'y a plus de partie hors ligne : PLAY entre dans
 * une file du serveur, et le ticket est aussi le tableau des files — combien attendent
 * dans chaque mode et à chaque table, tout de suite, avant de choisir.
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
    'icon-shop': '#btn-boutique .ico',
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

  // Le nom, sans quoi la barre affiche éternellement l'étiquette de maquette du HTML.
  const nom = el('pname');
  if (nom) nom.textContent = nomJoueur();

  const { niveau, dans, pour } = progression.etat;
  el('profil-niveau').textContent = String(niveau);
  el('xp-fill').style.width = `${Math.min(100, (dans / pour) * 100)}%`;
  el('xp-num').textContent = `${dans} / ${pour}`;

  el('balance').textContent = montant(portefeuille.solde);
  const court = portefeuille.solde < miseChoisie();
  el('solde').classList.toggle('court', court);

  /*
   * IL N'Y A PLUS DE « TOP UP ». Le même bouton fait trois choses selon qui l'on est :
   *
   *   - connecté : WALLET — déposer, retirer, relire son historique on-chain ;
   *   - pas connecté : SIGN IN — parce qu'un solde sans compte n'existe pas ;
   *   - sur un BANC (serveur sans backend, harnais) : TOP UP, la dotation imaginaire,
   *     seulement quand elle est épuisée. Un serveur de production ne montre jamais ça.
   */
  const bouton = el('recharger');
  if (caisse.banc && !caisse.enLigne) {
    bouton.classList.toggle('hidden', !portefeuille.bloque);
    bouton.textContent = 'TOP UP';
    bouton.title = 'Test bench only: restores the imaginary starting balance';
  } else {
    bouton.classList.remove('hidden');
    bouton.textContent = caisse.enLigne ? 'WALLET' : 'SIGN IN';
    bouton.title = caisse.enLigne ? 'Deposit, withdraw, history' : 'Sign in to deposit USDC and play';
  }
}

// ---------- le ticket ----------

/**
 * L'état du salon en cours, ou `null` hors salon.
 *
 * Il ne sert qu'à UNE chose : savoir quelle variante la roue a tirée pour la partie qu'on
 * s'apprête à jouer. Hors salon, le ticket montre le CATALOGUE — ce qui peut tomber ;
 * dans un salon, il montre ce qui EST tombé, et l'échelle se recalcule dessus.
 *
 * C'est cette distinction qui fait la promesse tenue : le joueur voit le barème exact de
 * sa partie avant que sa mise ne parte, et non après.
 */
let salonCourant = null;

/**
 * Construit le ticket : les trois modes, les trois tables, le gain en fourchette, la
 * roue en aperçu, le bouton.
 * `onJouer(miseMicros)` est appelé avec la mise engagée.
 */
export function buildTicket(onJouer) {
  /*
   * Le sélecteur de mode, au-dessus des paliers.
   *
   * Deux choix au même endroit et dans le même geste : la FORME de la partie, puis la
   * somme qu'on y met. Le mode d'abord, parce que c'est lui qui décide de tout le reste —
   * l'effectif, le nombre de manches, le nombre de places payées et la roue.
   */
  const boiteModes = el('modes');
  boiteModes.innerHTML = '';
  for (const id of ORDRE_MODES) {
    const m = MODES[id];
    const b = document.createElement('button');
    b.className = 'mode';
    b.dataset.mode = id;
    // `.attente` est la pastille de présence — « 3 waiting » — remplie par `majFiles`.
    b.innerHTML = '<b></b><i></i><em class="attente hidden"></em>';
    b.querySelector('b').textContent = m.nom.split(' ')[0];
    b.querySelector('i').textContent = `${m.joueurs} PLAYERS`;
    b.addEventListener('click', () => { choisirMode(id); sfx.click(); });
    boiteModes.appendChild(b);
  }

  const boiteMises = el('paliers');
  boiteMises.innerHTML = '';

  for (const usdc of PALIERS) {
    const b = document.createElement('button');
    b.className = 'palier';
    b.dataset.usdc = String(usdc);
    b.innerHTML = '<b></b><i>USDC</i><em class="attente hidden"></em>';
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
    // En file, le même bouton en SORT : on ne conditionne pas une sortie au solde.
    if (!liaison.enFile && portefeuille.solde < mise) return;
    sfx.click();
    onJouer?.(mise);
  });

  el('recharger').addEventListener('click', async (e) => {
    e.stopPropagation();
    sfx.click();

    if (caisse.banc && !caisse.enLigne) { portefeuille.recharger(); return; }
    if (!caisse.enLigne) { el('btn-compte')?.click(); return; }
    ouvrirPortefeuille();
  });

  // Un seul chemin de rafraichissement : toute variation de solde, d'XP ou de mise
  // repasse par la, qu'elle vienne d'un clic ou de la fin d'une partie.
  surChangement(rafraichirTicket);
  rafraichirTicket();
}

/**
 * L'aperçu de la roue dans le ticket — LE MÊME disque que celui qu'on lancera à la fin.
 *
 * Il n'y a plus de bande plate : elle disait les cotes honnêtement mais ne ressemblait à
 * rien, et un joueur ne reconnaissait pas dans le ticket l'objet qu'il verrait tourner.
 * Un seul composant, deux tailles — c'est ce qui garantit qu'aucune seconde
 * représentation ne dérivera de la première.
 *
 * AUCUN MULTIPLICATEUR ICI, ni nulle part ailleurs devant le joueur. Il mise des USDC et
 * il gagne des USDC ; le facteur est notre outil de calcul, pas son unité de compte.
 */
function dessinerRoue(modeId, tiree, mise) {
  const dit = el('roue-dit');
  const bloc = el('roue');
  const catalogue = VARIANTES[modeId];
  const variante = tiree ?? 'standard';

  apercu(el('roue-mini'), { mode: modeId, variante, mise });

  /*
   * LE DUEL N'A PAS DE ROUE, et le dire vaut mieux que montrer un disque à deux parts :
   * une seule place est payée, il n'y a rien à redistribuer. C'est aussi le mode le plus
   * simple à défendre — un barème entièrement fixe, connu d'avance.
   */
  if (catalogue.length < 2) {
    bloc.classList.add('fige');
    el('roue-titre').textContent = 'FIXED PAYOUT';
    const gain = echelle(mise, modeId, variante)[0].gain;
    dit.innerHTML = `<b>WINNER TAKES ${montant(gain)} USDC</b>`
      + 'No wheel — one paying place, nothing to redistribute.';
    return;
  }

  bloc.classList.toggle('fige', Boolean(tiree));
  el('roue-titre').textContent = 'THE WHEEL';

  if (tiree) {
    const v = catalogue.find((x) => x.id === tiree) ?? catalogue[0];
    const haut = echelle(mise, modeId, tiree)[0].gain;
    dit.innerHTML = `<b>${v.nom} ${'★'.repeat(v.etoiles)}</b>`
      + `This table pays ${montant(haut)} USDC to the winner · ${v.rareteBp / 100}% of tables`;
  } else {
    // Dix lignes, UNE tirée à la fin : le ticket montre l'espérance, jamais une certitude.
    dit.innerHTML = `<b>${catalogue.length} POSSIBLE OUTCOMES</b>`
      + 'Your wheel spins when the match ends.';
  }
}

/** Recalcule tout le ticket depuis le mode et la mise sélectionnés. Rien n'est conservé. */
export function rafraichirTicket() {
  const mode = modeChoisi();
  const config = MODES[mode];
  const mise = miseChoisie();
  const solde = portefeuille.solde;

  /*
   * La variante du salon en cours, s'il y en a un — et seulement s'il joue LE MÊME mode
   * que celui affiché. Un joueur qui change de mode pendant qu'un salon l'attend doit voir
   * le catalogue de ce nouveau mode, pas la variante d'un salon qu'il vient de quitter des
   * yeux : `standard` y serait un chiffre faux présenté comme sûr.
   */
  const tiree = (salonCourant && salonCourant.mode === mode)
    ? salonCourant.variante?.id ?? null
    : null;
  const variante = tiree ?? 'standard';

  const { pot } = table(mise, mode, variante);

  for (const b of document.querySelectorAll('.mode')) {
    b.classList.toggle('on', b.dataset.mode === mode);
  }

  dessinerRoue(mode, tiree, mise);

  for (const b of document.querySelectorAll('.palier')) {
    const usdc = Number(b.dataset.usdc);
    b.classList.toggle('on', usdc * MICROS === mise);
    // Une table hors de portée reste visible mais inerte : la masquer donnerait
    // l'impression que le jeu en propose moins qu'il n'en propose.
    b.classList.toggle('mort', usdc * MICROS > solde);
    b.title = usdc * MICROS > solde ? 'Not enough balance for this table' : `${usdc} USDC table`;
  }

  /*
   * LE GAIN EN FOURCHETTE — « 1ST PLACE WINS 2.60–4.00 USDC ».
   *
   * Le ticket disait le pot, le rake, et un barème rang par rang avec ses gemmes. Le
   * directeur produit a demandé une chose simple (4 septembre 2026) : ce qu'on gagne, du
   * minimum au maximum. Les deux bornes sont lues sur LA ROUE du vainqueur (`roueDe`), dix
   * cases, une par ligne du tableau : le ticket ne peut donc pas annoncer un montant que
   * la roue ne paierait pas. Aucun multiplicateur, aucun pot : le joueur mise des USDC et
   * lit des USDC.
   *
   * Quand le mode peut partir RÉDUIT — l'arène part dès treize quand plus personne
   * n'arrive (`salon.js`) — la borne basse descend jusqu'au gain du vainqueur d'une table
   * au minimum d'effectif, et le sous-titre annonce l'effectif en fourchette. Le joueur
   * n'a pas à consentir à ce départ réduit ; ce qui le rend défendable, c'est qu'il l'a
   * lu ici avant de cliquer. Le minimum vient du SERVEUR, par la présence (`majFiles`) ;
   * sans présence encore reçue, on affiche la table pleine.
   */
  const fichier = dernieresFiles.find((f) => f.mode === mode && f.mise === mise);
  const minimum = fichier?.minimum ?? config.joueurs;
  const reduit = minimum >= 3 && minimum < config.joueurs;
  const gains = roueDe(mode, 1, mise).cases.map((c) => c.gain);
  if (reduit) gains.push(tableEffectif(mise, minimum).parRang[0]);
  const payes = table(mise, mode, variante).parRang.filter((g) => g > 0).length;
  el('pot-val').innerHTML = `${montant(Math.min(...gains))}–${montant(Math.max(...gains))}<small>USDC</small>`;
  el('pot-sub').textContent =
    `${reduit ? `${minimum}–${config.joueurs}` : config.joueurs} players · `
    + (payes === 1 ? 'winner takes all' : `top ${payes} paid`);

  /*
   * LE BOUTON DIT OÙ L'ON EN EST, et il n'a qu'un état à la fois.
   *
   * En file, il en sort. Sans serveur, il ne promet rien. En cours de connexion, il
   * attend. Sinon, il joue — si le solde le permet. Ce que la note doit dire tient en un
   * fait : l'argent part au lancement. Le montant est déjà sur la pastille et le seuil
   * déjà dans l'échelle — les répéter ici faisait déborder le ticket sans rien apprendre.
   */
  const jouable = solde >= mise;
  // Une table payante demande un compte — sauf sur un banc, qui joue avec un portefeuille
  // imaginaire et le dit. Sans compte, le solde vaut zéro et la note dit pourquoi.
  const doitSeConnecter = mise > 0 && !caisse.enLigne && !caisse.banc;
  const play = el('play');
  const txt = el('play-txt');
  const note = el('play-note');
  play.classList.toggle('quitte', liaison.enFile && !liaison.engagement);
  if (liaison.engagement) {
    // Les mises partent sur la chaîne : on ne quitte plus, on attend le départ.
    play.disabled = true;
    txt.textContent = 'STAKING…';
    note.classList.remove('alerte');
    note.textContent = 'Committing every stake on-chain — the match starts right after';
  } else if (liaison.enFile) {
    play.disabled = false;
    txt.textContent = 'LEAVE QUEUE';
    note.classList.remove('alerte');
    note.textContent = 'Searching — your stake is committed only at launch';
  } else if (liaison.etat === 'absent') {
    play.disabled = true;
    txt.textContent = 'PLAY';
    note.classList.add('alerte');
    note.textContent = 'No game server — open the game from its server';
  } else if (liaison.etat !== 'ouvert') {
    play.disabled = true;
    txt.textContent = 'PLAY';
    note.classList.remove('alerte');
    note.textContent = liaison.etat === 'connexion' ? 'Connecting to the game server…' : 'Disconnected — reconnecting…';
  } else if (doitSeConnecter) {
    play.disabled = true;
    txt.textContent = 'PLAY';
    note.classList.add('alerte');
    note.textContent = CONFIGURE ? 'Sign in to play for USDC' : 'No account backend — paid tables are closed';
  } else {
    play.disabled = !jouable;
    txt.textContent = 'PLAY';
    note.classList.toggle('alerte', !jouable);
    note.textContent = jouable
      ? 'Your stake is committed on-chain at launch'
      : (caisse.enLigne ? 'Not enough balance — deposit USDC from WALLET' : 'Not enough balance for this table');
  }

  // Les pastilles de présence suivent le mode : celles des tables changent avec lui.
  majFiles(dernieresFiles);
  majBarre();
}

// ---------- la vitrine des personnages ----------

/** Vignettes carrées à droite, fiche du personnage sélectionné à gauche. */
export function buildSkinsScreen(onChange) {
  const grid = el('skins-grid');
  grid.innerHTML = '';

  for (const m of MODELS) {
    /*
     * DEUX verrous, et ils ne disent pas la meme chose.
     *
     * `available` : le fichier .glb est-il la ? C'est une question de livraison, elle se
     * repare en generant l'asset — d'ou « SOON ».
     * `ouvert`    : la boutique le retient-elle ? C'est une question de possession, elle
     * se repare en publiant un post — d'ou « SHOP », et un clic qui MENE a la boutique
     * au lieu de ne rien faire. Les confondre sous un seul cadenas gris laisserait le
     * joueur devant le seul personnage qu'il peut obtenir aujourd'hui sans lui dire
     * comment.
     */
    const available = assets.has(m.id);
    const ouvert = estDebloque(m.id);
    const tile = document.createElement('div');
    const porte = m.id === cosmetics.model;
    tile.className = 'tile' + (porte ? ' on' : '') + (available && ouvert ? '' : ' locked');
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

    if (!ouvert || !available) {
      const lock = document.createElement('div');
      lock.className = 'lock';
      lock.textContent = ouvert ? 'SOON' : 'SHOP';
      tile.appendChild(lock);
    }

    tile.addEventListener('mouseenter', () => showInfo(m, available));
    if (available && ouvert) {
      tile.addEventListener('click', () => {
        cosmetics.setModel(m.id);
        sfx.click();
        buildSkinsScreen(onChange);
        showInfo(m, true);
        majBarre();
        onChange?.();
      });
    } else if (!ouvert) {
      // Le cadenas est une PORTE. Cliquer un personnage de boutique depuis la garde-robe
      // ouvre la boutique sur lui — c'est le seul endroit ou il s'obtient, et laisser la
      // tuile inerte obligerait a deviner qu'un autre bouton existe.
      tile.addEventListener('click', () => { sfx.click(); allerA?.('boutique'); });
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
  const etat = !estDebloque(m.id) ? 'In the shop'
    : !available ? 'Coming soon'
      : m.id === cosmetics.model ? 'Equipped' : 'Available';
  for (const label of [
    m.rigged ? 'Skeletal animation' : 'No animation',
    etat,
  ]) {
    const c = document.createElement('div');
    c.className = 'chip';
    c.textContent = label;
    chips.appendChild(c);
  }
}

export function hideSkinInfo() { el('skin-info')?.classList.add('hidden'); }

/**
 * Bascule entre les trois écrans du lobby : le plateau de lancement, la vitrine, la
 * boutique. Il n'y a toujours pas de barre d'onglets — on entre par un bouton, on sort
 * par BACK, et les deux panneaux occupent la même moitié d'écran, donc jamais ensemble.
 */
export function wireEcrans(onEcran, onChangePerso) {
  function montrer(nom) {
    el('screen-skins').classList.toggle('on', nom === 'skins');
    el('screen-boutique').classList.toggle('on', nom === 'boutique');
    // La fiche du personnage est posée SOUS le modèle 3D, à gauche : elle appartient à la
    // vitrine seule, et la laisser sous la boutique décrirait un personnage qu'on ne
    // regarde plus.
    el('skin-info').classList.toggle('hidden', nom !== 'skins');
    for (const id of ['playzone', 'leftpanel']) {
      el(id).style.display = nom === 'play' ? '' : 'none';
    }
    onEcran?.(nom);
  }
  // La garde-robe a besoin d'ouvrir la boutique quand on clique un personnage cadenassé,
  // et elle est construite avant que ce câblage existe. C'est la seule raison de ce
  // renvoi posé de côté : `buildSkinsScreen` ne prend pas le lobby en paramètre.
  allerA = montrer;

  const ouvrir = () => { sfx.click(); buildSkinsScreen(onChangePerso); montrer('skins'); };
  el('btn-perso').addEventListener('click', ouvrir);
  el('profil').addEventListener('click', ouvrir);
  el('btn-retour').addEventListener('click', () => { sfx.click(); montrer('play'); });

  el('btn-boutique').addEventListener('click', () => {
    sfx.click();
    majBoutique(onChangePerso);
    montrer('boutique');
  });
  el('btn-retour-boutique').addEventListener('click', () => { sfx.click(); montrer('play'); });

  return { montrer };
}

// ---------- la boutique ----------

/**
 * Un seul article, donc UNE carte et pas une grille.
 *
 * `boutique.js` tient la règle et l'état ; ce bloc ne fait que peindre ce qu'elle dit et
 * lui renvoyer les deux gestes du joueur — partir publier, réclamer. Le nom, la rareté et
 * le portrait viennent du catalogue de `cosmetics.js` : la boutique ne redécrit jamais un
 * personnage, sinon la fiche de la garde-robe et celle de la boutique finiraient par ne
 * plus parler du même.
 */
const ARTICLE = ARTICLES[0] ?? null;

/** Le compte à rebours de la réclamation. Un seul, réarmé à chaque rendu. */
let horlogeBoutique = null;

/** Où aller quand une tuile cadenassée est cliquée. Posé par `wireEcrans`. */
let allerA = null;

/** Construit la carte une fois pour toutes. Seul l'état change ensuite. */
export function buildBoutique(onChange) {
  if (!ARTICLE) return;   // pas de campagne en cours : la carte reste telle quelle
  const m = MODELS.find((x) => x.id === ARTICLE.id);
  const r = RARITY[m?.rarity] ?? RARITY.common;

  const img = el('shop-port-img');
  img.src = `/icons/port-${ARTICLE.id}.png`;
  img.alt = m?.name ?? ARTICLE.id;
  img.onerror = () => { img.style.visibility = 'hidden'; };

  el('shop-carte').style.setProperty('--rar', couleurRarete(m));
  el('shop-rarity').textContent = r.label;
  el('shop-rarity').style.background = r.color;
  el('shop-prix').textContent = ARTICLE.prix;
  el('shop-nom').textContent = m?.name ?? ARTICLE.id;
  el('shop-accroche').textContent = ARTICLE.accroche;
  el('shop-detail').textContent = ARTICLE.detail;
  // Le post est montré AVANT le clic, mot pour mot. On demande à quelqu'un de publier
  // sous son propre nom : lui cacher le texte est la meilleure façon qu'il ne publie rien.
  el('shop-post').textContent = apercuDuPost(ARTICLE, JEU);

  el('shop-action').addEventListener('click', () => agirBoutique(onChange));
  majBoutique(onChange);
}

/** Le bouton unique de la carte. Il change de rôle avec l'état, jamais de place. */
function agirBoutique(onChange) {
  if (!ARTICLE) return;

  if (estDebloque(ARTICLE.id)) {
    if (!cosmetics.setModel(ARTICLE.id)) return;
    sfx.click();
  } else if (enAttente(ARTICLE.id) && attenteRestante(ARTICLE.id) === 0) {
    const verdict = reclamer(ARTICLE.id);
    if (!verdict.ok) { majBoutique(onChange); return; }
    /*
     * Le paiement du geste, et il est immédiat : on équipe. Le modèle 3D du lobby, à
     * gauche, DEVIENT BabyTrump sous les yeux du joueur — c'est la récompense elle-même.
     * Le renvoyer dans la garde-robe pour un clic de plus étalerait sur deux écrans le
     * seul moment que cette campagne avait à offrir.
     */
    cosmetics.setModel(ARTICLE.id);
    sfx.jackpot();
  } else {
    partirPublier(onChange);
    return;
  }

  majBarre();
  buildSkinsScreen(onChange);
  onChange?.();
  majBoutique(onChange);
}

/** Ouvre X, post déjà écrit, et note le départ. */
function partirPublier(onChange) {
  /*
   * `window.open` DOIT rester dans le gestionnaire de clic — appelée un tick plus tard,
   * elle passe pour une fenêtre non sollicitée et le navigateur la bloque.
   *
   * Et SANS l'option 'noopener' : elle fait rendre `null` à `window.open` dans la plupart
   * des navigateurs, ce qui rend une fenêtre ouverte indistinguable d'une fenêtre bloquée
   * — or c'est exactement ce qu'on a besoin de savoir pour proposer le lien de secours.
   * On coupe donc le lien vers l'ouvreur à la main, juste après.
   */
  const fenetre = window.open(lienDePost(ARTICLE, JEU), '_blank');
  if (fenetre) fenetre.opener = null;
  // Marqué dans les deux cas : bloquée ou non, le joueur a exprimé le geste, et le lien
  // de secours le mènera au même endroit. Un bloqueur de pop-ups ne doit pas fermer à
  // jamais le seul chemin d'acquisition du jeu.
  marquerEnvoi(ARTICLE.id);
  sfx.click();
  majBoutique(onChange, { bloquee: !fenetre });
}

/**
 * Repeint la carte selon l'état. Trois états, trois boutons, trois phrases.
 *
 * Le compte à rebours se réarme lui-même tant qu'il court : c'est la seule chose animée
 * de l'écran, et sans elle le bouton resterait grisé sans dire jusqu'à quand.
 */
export function majBoutique(onChange, { bloquee = false } = {}) {
  clearTimeout(horlogeBoutique);
  if (!ARTICLE) return;

  const bouton = el('shop-action');
  const note = el('shop-note');
  const lien = el('shop-lien');
  if (!bouton) return;

  bouton.classList.remove('reclamer', 'porte');
  note.classList.remove('ok', 'alerte');
  lien.href = lienDePost(ARTICLE, JEU);

  if (estDebloque(ARTICLE.id)) {
    const porte = ARTICLE.id === cosmetics.model;
    bouton.classList.add('porte');
    bouton.disabled = porte;
    bouton.textContent = porte ? 'EQUIPPED' : 'EQUIP';
    note.classList.add('ok');
    note.textContent = 'Unlocked for good. Thanks for the post — see you on the course.';
    lien.classList.add('hidden');
  } else if (enAttente(ARTICLE.id)) {
    const reste = attenteRestante(ARTICLE.id);
    bouton.classList.add('reclamer');
    bouton.disabled = reste > 0;
    bouton.textContent = reste > 0
      ? `I POSTED IT — ${Math.ceil(reste / 1000)}s`
      : 'I POSTED IT — UNLOCK';
    if (bloquee) note.classList.add('alerte');
    note.textContent = bloquee
      ? 'Your browser blocked the window. Use the link below, publish, then come back here.'
      : 'X is open in another tab. Publish the post, come back, and claim your skin.';
    lien.textContent = 'Open X again →';
    lien.classList.remove('hidden');
    // Le lien de secours compte lui aussi comme un départ : c'est le même geste.
    lien.onclick = () => { marquerEnvoi(ARTICLE.id); majBoutique(onChange); };
    if (reste > 0) horlogeBoutique = setTimeout(() => majBoutique(onChange), Math.min(reste, 200));
  } else {
    bouton.disabled = false;
    bouton.textContent = 'UNLOCK WITH A POST';
    note.textContent = 'Costs nothing. We open X with the post already written.';
    lien.classList.add('hidden');
  }

  majBadgeBoutique();
}

/** La pastille du bouton SHOP : ce qui reste à prendre, et rien quand il ne reste rien. */
function majBadgeBoutique() {
  const badge = el('shop-neuf');
  if (!badge) return;
  const reste = verrouilles().length;
  badge.textContent = String(reste);
  badge.classList.toggle('hidden', reste === 0);
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

// ---------- le portefeuille ----------

let ouvrirPortefeuille = () => {};

/**
 * LE PORTEFEUILLE : déposer, retirer, relire — la seule porte de l'argent dans le jeu.
 *
 * Trois sections, et chacune dit d'où vient ce qu'elle montre :
 *
 *   - DÉPÔT : l'adresse du wallet de jeu du joueur, dérivée par le backend, avec son lien
 *     vers l'explorateur. Une adresse Solana ne se recopie pas à la main sans faute de
 *     frappe, et une faute envoie les fonds dans le vide : le bouton COPY n'est pas un
 *     confort, c'est la seule façon sûre de la transmettre ;
 *   - RETRAIT : vers le wallet LIÉ uniquement, prouvé par signature (Phantom, Solflare).
 *     Le montant est le seul paramètre ; la destination n'en est jamais un ;
 *   - HISTORIQUE : chaque ligne du grand livre avec, quand elle existe, la transaction
 *     Solana qui la prouve. Un gain sans signature est un gain en cours de paiement.
 *
 * Le panneau n'existe QUE connecté : sans compte, il n'y a rien à montrer.
 */
export function buildPortefeuille(onChangement) {
  const fond = el('wallet-fond');
  if (!fond) return;
  const msg = el('wallet-msg');
  const dire = (texte, ok = false) => { msg.textContent = texte; msg.classList.toggle('ok', ok); };
  const explorateur = (p) => `https://explorer.solana.com/address/${p}${caisse.profil?.reseau && caisse.profil.reseau !== 'mainnet' ? `?cluster=${caisse.profil.reseau}` : ''}`;

  const GENRES = {
    depot: 'Deposit', mise: 'Stake', gain: 'Payout', mise_rendue: 'Stake returned',
    retrait: 'Withdrawal', retrait_echoue: 'Withdrawal refunded',
  };
  // Une icône par nature de mouvement : l'œil trie le grand livre avant de le lire.
  const GLYPHES = { depot: '↓', mise: '−', gain: '★', mise_rendue: '↩', retrait: '↑', retrait_echoue: '↺' };

  async function peindre() {
    const p = caisse.profil;
    if (!p) { dire('Sign in first.'); return; }
    el('wallet-solde-val').innerHTML = `${montant(portefeuille.solde)}<small>USDC</small>`;
    el('wallet-solde').textContent = 'Available to play'
      + (p.retraitsEnAttente ? ` · ${montant(p.retraitsEnAttente)} USDC on its way out` : '');
    el('wallet-adresse').textContent = p.adresseDepot ?? '—';
    el('wallet-adresse').href = p.adresseDepot ? explorateur(p.adresseDepot) : '#';
    el('wallet-depot-note').textContent =
      `Send USDC on Solana ${p.reseau} to this address. Minimum ${montant(p.depotMinimum)} USDC. `
      + 'It is your own game wallet: stakes leave it, winnings come back to it.';

    const lie = el('wallet-lie');
    if (p.wallet) {
      lie.innerHTML = `Withdrawals go to <a class="mono" target="_blank" rel="noopener" href="${explorateur(p.wallet)}">${p.wallet}</a> `
        + '<button id="wallet-relier" class="mini">CHANGE</button>';
    } else {
      lie.innerHTML = 'No wallet linked yet. <button id="wallet-relier" class="mini primaire">LINK PHANTOM / SOLFLARE</button>';
    }
    el('wallet-relier').addEventListener('click', () => pendant(async () => {
      dire('Sign the message in your wallet…');
      try {
        await lierWallet(p.userId);
        dire(`Wallet linked. First withdrawal opens ${p.delaiPremierRetraitHeures} h after linking.`, true);
        await caisse.rafraichir();
        await peindre();
      } catch (e) { dire(e.message ?? String(e)); }
    }));
    el('wallet-retrait-note').textContent =
      `Minimum ${montant(p.retraitMinimum)} USDC · first withdrawal ${p.delaiPremierRetraitHeures} h after linking a wallet · sent from your game wallet.`;

    el('wallet-stats').href = `${API}/suivi`;

    const h = el('wallet-historique');
    h.innerHTML = '<div class="wallet-note">Loading…</div>';
    try {
      const { lignes } = await caisse.historique();
      h.innerHTML = lignes.length ? lignes.slice(0, 25).map((l) => {
        const signe = l.montant > 0 ? '+' : '';
        const quoi = GENRES[l.genre] ?? l.genre;
        const detail = l.partie ? `<em>${l.mode ?? ''}${l.issue ? ` · ${l.issue}` : ''}</em>` : '';
        const preuve = l.lien ? `<a class="wl-tx" target="_blank" rel="noopener" href="${l.lien}">TX ↗</a>` : '<i>PENDING</i>';
        return `<div class="wallet-ligne-h ${l.montant > 0 ? 'plus' : 'moins'}">`
          + `<i class="wl-ico">${GLYPHES[l.genre] ?? '·'}</i><span class="wl-quoi">${quoi}${detail}</span>`
          + `<b>${signe}${montant(l.montant)}</b>${preuve}</div>`;
      }).join('') : '<div class="wallet-note">No movement yet.</div>';
    } catch { h.innerHTML = '<div class="wallet-note">History unavailable.</div>'; }
  }

  const boutons = ['wallet-copier', 'wallet-relever', 'wallet-retirer'];
  async function pendant(travail) {
    for (const b of boutons) { const e = el(b); if (e) e.disabled = true; }
    try { await travail(); } finally { for (const b of boutons) { const e = el(b); if (e) e.disabled = false; } }
  }

  el('wallet-copier').addEventListener('click', async () => {
    sfx.click();
    const a = caisse.profil?.adresseDepot;
    if (!a) return;
    try { await navigator.clipboard.writeText(a); dire('Address copied.', true); } catch { dire('Copy refused by the browser — select the address instead.'); }
  });
  el('wallet-relever').addEventListener('click', () => pendant(async () => {
    sfx.click();
    dire('Checking the chain…');
    try {
      const r = await caisse.releverDepots();
      dire(r.nouveaux.length ? `${r.nouveaux.length} deposit${r.nouveaux.length > 1 ? 's' : ''} credited.` : 'No new deposit yet.', true);
      await caisse.rafraichir();
      await peindre();
      majBarre();
      onChangement?.();
    } catch (e) { dire(e.message); }
  }));
  el('wallet-retirer').addEventListener('click', () => pendant(async () => {
    sfx.click();
    const usdc = Number(el('wallet-montant').value);
    if (!(usdc > 0)) { dire('Enter an amount in USDC.'); return; }
    dire('Requesting…');
    try {
      const r = await caisse.retirer(Math.round(usdc * MICROS));
      dire(`Withdrawal of ${montant(r.montant)} USDC queued — it leaves your game wallet within a minute.`, true);
      el('wallet-montant').value = '';
      await caisse.rafraichir();
      await peindre();
      majBarre();
      onChangement?.();
    } catch (e) {
      const RAISONS = {
        WALLET_ABSENT: 'Link a wallet first.',
        SOUS_LE_MINIMUM: `Minimum withdrawal is ${montant(caisse.profil?.retraitMinimum ?? 0)} USDC.`,
        DELAI_PREMIER_RETRAIT: `Your first withdrawal opens ${caisse.profil?.delaiPremierRetraitHeures} h after linking your wallet.`,
        SOLDE_INSUFFISANT: 'Not enough balance.',
      };
      dire(RAISONS[e.code] ?? e.message);
    }
  }));
  el('wallet-montant').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') el('wallet-retirer').click(); });
  el('wallet-montant').addEventListener('keyup', (e) => e.stopPropagation());

  const fermer = () => fond.classList.add('hidden');
  ouvrirPortefeuille = async () => { dire(''); fond.classList.remove('hidden'); await caisse.rafraichir(); await peindre(); };
  el('wallet-fermer').addEventListener('click', () => { sfx.click(); fermer(); });
  fond.addEventListener('click', (e) => { if (e.target === fond) fermer(); });
}

// ---------- le joueur, et le lobby vu du serveur ----------

/** Mémorisé : on rejoue le plus souvent sous le même nom. */
const CLE_NOM = 'tumble-pseudo';

/**
 * LE NOM DU JOUEUR — celui que les autres verront.
 *
 * La barre du haut affichait « Baby #2005 », écrit en dur dans `index.html` et que rien
 * n'a jamais remplacé. Deux machines côte à côte montraient donc le même joueur, même
 * portrait, même niveau — impossible de savoir qui est qui, dans un jeu où l'on mise.
 *
 * Le nom vit ici, dans le stockage du navigateur, et c'est LE MÊME que celui envoyé au
 * serveur : la barre ne peut donc pas mentir sur l'identité qui court la partie. Il se
 * change en cliquant dessus (`matchmaking.js`), pas dans un panneau à part.
 *
 * Le tirage n'a rien à voir avec la règle « aucun aléatoire dans le monde du jeu » : il ne
 * touche ni la physique, ni la carte, ni le classement. C'est une étiquette, tirée une
 * seule fois par navigateur puis mémorisée.
 */
export function nomJoueur() {
  const garde = localStorage.getItem(CLE_NOM)?.trim();
  if (garde) return garde;
  const tirage = new Uint16Array(1);
  crypto.getRandomValues(tirage);
  const nom = `Baby #${1000 + (tirage[0] % 9000)}`;
  localStorage.setItem(CLE_NOM, nom);
  return nom;
}

/** Change le nom. Il vaudra à la prochaine connexion — c'est `bonjour` qui le porte. */
export function renommerJoueur(nom) {
  const propre = String(nom ?? '').trim().slice(0, 24);
  if (!propre) return nomJoueur();
  localStorage.setItem(CLE_NOM, propre);
  return propre;
}

/**
 * LE SALON EN COURS, dit par le serveur — ou `null` quand on n'attend nulle part.
 *
 * C'est par ici que la VARIANTE arrive, pendant que le salon se remplit et avant que la
 * mise ne parte. Le ticket se recalcule dessus : le joueur lit le barème EXACT de la
 * partie qu'on lui propose, et décide de rester ou de partir. Si un jour cette
 * information n'arrivait qu'à la fin, la roue cesserait d'être un barème annoncé pour
 * devenir un tirage — et c'est la qualification « compétition de skill » du spec (§ 5)
 * qui tomberait avec.
 */
export function definirSalon(data) {
  salonCourant = data;
  rafraichirTicket();
}

/**
 * L'ÉTAT DE LA LIAISON — connecté ou non, en file ou non — tel que `matchmaking.js` le
 * tient. C'est lui qui décide de ce que dit le bouton PLAY. Avant que le réseau ait
 * parlé, on est « en connexion » : le bouton attend, il ne promet pas une partie qu'on ne
 * sait pas encore servir.
 */
let liaison = { etat: 'connexion', enFile: false, joueurs: 0, engagement: false };
export function definirLiaison(l) {
  liaison = { ...liaison, ...l };
  rafraichirTicket();
}

/**
 * LA PRÉSENCE — combien attendent dans chaque file, en pastille sur les boutons.
 *
 * Sur un MODE, la somme de ses trois tables : « 3 waiting » sur l'arène dit qu'il y a du
 * monde, avant de choisir combien miser. Sur une TABLE, le compte de la seule file du
 * mode choisi : c'est celle qu'on rejoindrait en cliquant. Deux lectures, deux niveaux,
 * et aucune des deux n'est un chiffre décoratif — c'est ce que le serveur voit.
 */
let dernieresFiles = [];
export function majFiles(files) {
  const premiere = !dernieresFiles.length && (files?.length ?? 0) > 0;
  dernieresFiles = files ?? [];
  const mode = modeChoisi();
  // La PREMIÈRE présence apporte le minimum du serveur : le pot passe en fourchette.
  if (premiere) { rafraichirTicket(); return; }

  const parMode = new Map();
  for (const f of dernieresFiles) parMode.set(f.mode, (parMode.get(f.mode) ?? 0) + f.joueurs);

  const poser = (bouton, n) => {
    const badge = bouton.querySelector('.attente');
    if (!badge) return;
    badge.textContent = n ? `${n} waiting` : '';
    badge.classList.toggle('hidden', !n);
  };
  for (const b of document.querySelectorAll('.mode')) poser(b, parMode.get(b.dataset.mode) ?? 0);
  for (const b of document.querySelectorAll('.palier')) {
    const mise = Number(b.dataset.usdc) * MICROS;
    poser(b, dernieresFiles.find((f) => f.mode === mode && f.mise === mise)?.joueurs ?? 0);
  }
}
