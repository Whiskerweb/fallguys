import { cosmetics, MODELS, RARITY } from './cosmetics.js';
import { assets } from './assets.js';
import { sfx } from './audio.js';
import {
  MICROS, PALIERS, CONFIG,
  table, echelle, montant, facteur, ordinal, miseChoisie, choisirMise,
  portefeuille, progression, surChangement,
} from './economie.js';

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
  el('recharger').classList.toggle('hidden', !portefeuille.bloque);
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

  el('recharger').addEventListener('click', (e) => {
    e.stopPropagation();
    portefeuille.recharger();
    sfx.click();
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
