import { cosmetics, SKINS, MODELS } from './cosmetics.js';
import { assets } from './assets.js';
import { sfx } from './audio.js';

/**
 * Écrans du lobby : personnages, collaborations, boutique.
 *
 * Un onglet qui n'affiche rien vaut moins qu'un onglet absent — il promet une
 * fonctionnalité inexistante. Chacun montre donc un contenu réel : la grille de
 * personnages est branchée sur ce qui est effectivement chargé, et les deux autres
 * exposent le modèle économique du spec (collaborations en édition limitée,
 * cosmétiques qui réduisent la commission) plutôt que du remplissage.
 */

const el = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** Icônes générées, avec repli sur le glyphe d'origine si le fichier manque. */
export async function applyIcons() {
  let names = [];
  try {
    const res = await fetch('/icons/manifest.json', { cache: 'no-store' });
    if (res.ok) names = await res.json();
  } catch { return 0; }

  const MAP = {
    'icon-play': '[data-tab="play"]',
    'icon-skins': '[data-tab="skins"]',
    'icon-collabs': '[data-tab="collabs"]',
    'icon-shop': '[data-tab="shop"]',
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
  for (const [name, id] of [['icon-crown', 'ic-crown'], ['icon-coin', 'ic-coin']]) {
    if (!names.includes(name)) continue;
    const node = el(id);
    if (node) { node.innerHTML = `<img src="/icons/${name}.png" alt="">`; applied++; }
  }
  console.log(`[icones] ${applied} icones personnalisees appliquees`);
  return applied;
}

/** Grille de personnages : ceux qui sont chargés sont équipables, les autres verrouillés. */
export function buildSkinsScreen(onChange) {
  const grid = el('skins-grid');
  grid.innerHTML = '';
  for (const m of MODELS) {
    const available = assets.has(m.id);
    const card = document.createElement('div');
    card.className = 'card' + (m.id === cosmetics.model ? ' on' : '') + (available ? '' : ' locked');

    const badge = document.createElement('div');
    if (m.id === cosmetics.model) { badge.className = 'badge equipped'; badge.textContent = 'ÉQUIPÉ'; }
    else if (!available) { badge.className = 'badge locked'; badge.textContent = 'BIENTÔT'; }
    if (badge.className) card.appendChild(badge);

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const blob = document.createElement('div');
    blob.className = 'blob';
    blob.style.background = hex(cosmetics.hex);
    thumb.appendChild(blob);

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = m.name;
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = m.rigged ? 'ANIMÉ' : 'STATIQUE';

    card.append(thumb, name, tag);
    if (available) {
      card.addEventListener('click', () => {
        cosmetics.setModel(m.id);
        sfx.click();
        buildSkinsScreen(onChange);
        onChange?.();
      });
    }
    grid.appendChild(card);
  }

  const colors = el('colors-grid');
  colors.innerHTML = '';
  for (const skin of SKINS) {
    const card = document.createElement('div');
    card.className = 'card' + (skin.hex === cosmetics.hex ? ' on' : '');
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.style.background = hex(skin.hex);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = skin.name;
    card.append(thumb, name);
    card.addEventListener('click', () => {
      cosmetics.set(skin.hex);
      sfx.click();
      buildSkinsScreen(onChange);
      onChange?.();
    });
    colors.appendChild(card);
  }
}

const COLLABS = [
  { icon: '🐧', color: '#4fa8ff', title: 'Pingouin — Édition Glacier', desc: 'Skin exclusif, 3 000 exemplaires. Retiré définitivement à la fin de la saison.', state: 'Actif' },
  { icon: '🐕', color: '#ffa63d', title: 'Shiba — Édition Meme', desc: 'Skin + traînée de course dorée. Ouvert aux détenteurs du partenaire.', state: 'Bientôt' },
  { icon: '🐸', color: '#6ee86e', title: 'Grenouille — Édition Marais', desc: 'Skin + émote de victoire. Annonce conjointe prévue.', state: 'Bientôt' },
  { icon: '🤝', color: '#b072ff', title: 'Proposer une collaboration', desc: 'Votre communauté rejoint le jeu, votre mascotte devient jouable.', state: 'Nous écrire' },
];

const SHOP = [
  { icon: '💠', color: '#31c7f0', title: 'Pass Saison 1', desc: 'Commission réduite de 3 % sur tous vos gains, toute la saison.', price: '4,99 $' },
  { icon: '✨', color: '#ffd83d', title: 'Traînée Confettis', desc: 'Effet de course permanent. Commission réduite de 1 %.', price: '1,99 $' },
  { icon: '👑', color: '#ff8a3d', title: 'Couronne du Champion', desc: 'Accessoire de tête. Commission réduite de 2 %.', price: '3,49 $' },
  { icon: '🎨', color: '#ff4fa3', title: 'Pack 8 couleurs', desc: 'Débloque toutes les teintes de la garde-robe.', price: '0,99 $' },
];

function buildList(target, items, priceKey, stateKey) {
  const box = el(target);
  box.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'row';
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.style.background = it.color;
    icon.textContent = it.icon;
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = `<div class="title"></div><div class="desc"></div>`;
    body.querySelector('.title').textContent = it.title;
    body.querySelector('.desc').textContent = it.desc;
    const price = document.createElement('div');
    const label = it[priceKey] ?? it[stateKey];
    price.className = 'price' + (label === 'Bientôt' ? ' soon' : '');
    price.textContent = label;
    row.append(icon, body, price);
    box.appendChild(row);
  }
}

export function buildCollabsScreen() { buildList('collabs-list', COLLABS, null, 'state'); }
export function buildShopScreen() { buildList('shop-list', SHOP, 'price', null); }

/** Bascule d'onglet : un seul écran visible, la scène 3D ne s'affiche que sur « Jouer ». */
export function wireTabs(onTab) {
  const buttons = [...document.querySelectorAll('.navbtn[data-tab]')];
  const screens = { skins: el('screen-skins'), collabs: el('screen-collabs'), shop: el('screen-shop') };

  function show(tab) {
    for (const b of buttons) b.classList.toggle('active', b.dataset.tab === tab);
    for (const [name, node] of Object.entries(screens)) node.classList.toggle('on', name === tab);
    // Les panneaux du bas n'ont de sens que sur l'onglet Jouer.
    for (const id of ['playzone', 'entry-badge', 'leftpanel', 'playername']) {
      const n = el(id);
      if (n) n.style.display = tab === 'play' ? '' : 'none';
    }
    onTab?.(tab);
  }

  for (const b of buttons) {
    b.addEventListener('click', () => {
      sfx.click();
      const tab = b.dataset.tab;
      if (tab === 'skins') buildSkinsScreen(onTab && (() => onTab('skins-changed')));
      if (tab === 'collabs') buildCollabsScreen();
      if (tab === 'shop') buildShopScreen();
      show(tab);
    });
  }
  return { show };
}
