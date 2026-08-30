import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';
import { TUNING, TUNING_RANGES } from './tuning.js';
import { createWorld, GRADE } from './world.js';
import { assets } from './assets.js';
import { loadExternalTextures } from './textures.js';
import { MINIGAMES, minigame, graineDeManche, tirerParcours } from './scenes/index.js';
import { buildLobbyScreen, LOBBY, SHOWCASE_POS, SHOWCASE_LOOK } from './scenes/lobby.js';
import { Character } from './character.js';
import { cosmetics, SKINS, MODELS } from './cosmetics.js';
import { sfx, unlockAudio, audio } from './audio.js';
import { RIG, RIG_RANGES } from './rig.js';
import { settings, ACTIONS, CAMERA_RANGES, CAMERA_LABELS, keyName } from './settings.js';
import { applyIcons, buildSkinsScreen, buildCollabsScreen, buildShopScreen, wireTabs } from './lobbyui.js';

const el = (id) => document.getElementById(id);

/**
 * Manches par partie. Trois, comme la reference : assez pour qu'une mauvaise manche ne
 * condamne pas, assez peu pour qu'une partie tienne dans une pause. La derniere est
 * annoncee comme FINALE — c'est elle qui donne la couronne.
 */
const NB_MANCHES = 3;

function fatal(err) {
  console.error(err);
  const box = el('loading');
  box.style.display = 'grid';
  box.style.padding = '40px';
  box.style.textAlign = 'center';
  box.textContent = 'Erreur : ' + (err?.message ?? err);
}

// ---------- entrées ----------
const keys = new Set();
const input = { x: 0, z: 0, jump: false, dive: false };
let jumpEdge = false, diveEdge = false, camYaw = 0;

addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.repeat) return;
  // Capture d'une touche en cours de remappage : elle est absorbee entierement.
  if (listeningFor) {
    e.preventDefault();
    if (e.code !== 'Escape') settings.bind(listeningFor, e.code);
    listeningFor = null;
    buildKeybinds();
    return;
  }

  keys.add(e.code);
  if (settings.matches(e.code, 'jump')) { jumpEdge = true; e.preventDefault(); }
  if (settings.matches(e.code, 'dive')) diveEdge = true;

  if (e.code === 'Escape' && settingsOpen) { closeSettings(); return; }
  if (e.code === 'KeyO') { settingsOpen ? closeSettings() : openSettings(); return; }
  if (settingsOpen) return;

  // Echap en course ouvre le menu de pause plutot que de quitter d'un coup :
  // abandonner une partie ne doit jamais tenir a une frappe involontaire.
  if (e.code === 'Escape') {
    if (game?.mode === 'lobby') return;
    paused ? closePause() : openPause();
    return;
  }
  if (paused) return;

  if (e.code === 'Enter' && game?.mode === 'lobby') game.startRace();
  if (settings.matches(e.code, 'restart') && game?.mode === 'racing') game.restart();
  if (e.code === 'KeyH') gui.show(gui._hidden);
  if (e.code === 'KeyP') el('perf').classList.toggle('hidden');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousedown', (e) => { unlockAudio(); if (e.button === 0 && game?.mode === 'racing') diveEdge = true; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('blur', () => keys.clear());

function pollInput(dt) {
  // Panneau ouvert : le jeu ne doit pas repondre, sinon remapper une touche la declenche.
  if (settingsOpen) { input.x = 0; input.z = 0; input.jump = false; input.dive = false; return; }
  const fwd = settings.isDown(keys, 'forward');
  const back = settings.isDown(keys, 'back');
  const left = settings.isDown(keys, 'left');
  const right = settings.isDown(keys, 'right');
  input.x = (right ? 1 : 0) - (left ? 1 : 0);
  input.z = (back ? 1 : 0) - (fwd ? 1 : 0);
  input.jump = jumpEdge;
  input.dive = diveEdge;
  if (settings.isDown(keys, 'camLeft')) camYaw += 1.9 * dt;
  if (settings.isDown(keys, 'camRight')) camYaw -= 1.9 * dt;
}

// ---------- réglages ----------
let gui;
function buildGui(getWorld) {
  gui = new GUI({ title: 'Game feel — H pour masquer' });
  const groups = {
    'Déplacement': ['maxSpeed', 'groundAccel', 'airAccel', 'groundFriction', 'turnSpeed'],
    'Saut': ['gravity', 'jumpHeight', 'coyoteTime', 'jumpBuffer', 'fallMultiplier'],
    'Plongeon': ['diveForward', 'diveUp', 'diveRecovery'],
    'Culbute': ['tumbleJolt', 'tumbleRecovery', 'getUpDuration'],
    'Squash & stretch': ['squashOnLand', 'stretchOnJump', 'squashSpring', 'squashDamping'],
    'Caméra': ['camLookAhead'],   // le reste appartient au panneau Parametres
  };
  for (const [name, list] of Object.entries(groups)) {
    const folder = gui.addFolder(name);
    for (const k of list) {
      const [min, max] = TUNING_RANGES[k];
      folder.add(TUNING, k, min, max, (max - min) / 200).onChange(() => {
        if (k === 'gravity') getWorld().gravity = { x: 0, y: -TUNING.gravity, z: 0 };
      });
    }
    if (name !== 'Déplacement' && name !== 'Saut') folder.close();
  }
  // Placé en premier et ouvert : c'est le réglage le plus subjectif, donc celui
  // qui doit être sous la main quand on juge le rendu.
  const gradeFolder = gui.addFolder('Image');
  gradeFolder.add(GRADE, 'saturation', 0.6, 2.0, 0.01).name('saturation');
  gradeFolder.add(GRADE, 'brightness', 0.7, 1.6, 0.01).name('luminosite');
  gradeFolder.add(GRADE, 'lift', 0, 0.25, 0.005).name('noirs releves');
  gradeFolder.add(GRADE, 'contrast', 0.7, 1.5, 0.01).name('contraste');
  gradeFolder.add(GRADE, 'warmth', -0.08, 0.12, 0.005).name('chaleur');

  const rigFolder = gui.addFolder('Animation');
  for (const [k, [min, max]] of Object.entries(RIG_RANGES)) {
    rigFolder.add(RIG, k, min, max, (max - min) / 200);
  }
  rigFolder.close();

  const audioFolder = gui.addFolder('Son');
  audioFolder.add(audio, 'enabled').name('sons actifs');
  audioFolder.close();

  const lobbyFolder = gui.addFolder('Lobby');
  lobbyFolder.add(LOBBY, 'avatarYaw', -Math.PI, Math.PI, 0.01).name('orientation avatar');
  lobbyFolder.add(LOBBY, 'cameraFov', 25, 70, 1).name('zoom camera').onChange(() => {
    if (game?.mode === 'lobby') { game.view.camera.fov = LOBBY.cameraFov; game.view.camera.updateProjectionMatrix(); }
  });
  lobbyFolder.close();

  gui.add({ copier: () => {
    const json = JSON.stringify(TUNING, null, 2);
    navigator.clipboard?.writeText(json);
    console.log('--- Constantes a transposer dans Unity ---\n' + json);
  } }, 'copier').name('Copier les réglages');
  gui.close();
}

// ---------- menu de pause ----------
let paused = false;

function openPause() {
  if (!game || game.mode === 'lobby') return;
  paused = true;
  keys.clear();                 // sinon une touche restee enfoncee reprend a la reprise
  el('pause').classList.remove('hidden');
}

function closePause() {
  paused = false;
  el('pause').classList.add('hidden');
}

function wirePause() {
  el('pause-resume').addEventListener('click', () => { sfx.click(); closePause(); });
  el('pause-settings').addEventListener('click', () => { sfx.click(); openSettings(); });
  el('pause-quit').addEventListener('click', () => {
    sfx.click();
    closePause();
    game.returnToLobby();
  });
}

// ---------- panneau Paramètres ----------
let settingsOpen = false;
let listeningFor = null;

function buildKeybinds() {
  const box = el('keybinds');
  box.innerHTML = '';
  for (const action of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'srow';
    const label = document.createElement('label');
    label.textContent = action.label;
    const btn = document.createElement('button');
    btn.className = 'keybtn' + (listeningFor === action.id ? ' listening' : '');
    btn.textContent = listeningFor === action.id
      ? 'appuie…'
      : (settings.keys[action.id] ?? []).map(keyName).join(' / ');
    btn.addEventListener('click', () => { listeningFor = action.id; buildKeybinds(); });
    row.append(label, btn);
    box.appendChild(row);
  }
}

function buildCamSettings() {
  const box = el('camsettings');
  box.innerHTML = '';
  for (const [key, [min, max, step]] of Object.entries(CAMERA_RANGES)) {
    const row = document.createElement('div');
    row.className = 'srow';
    const label = document.createElement('label');
    label.textContent = CAMERA_LABELS[key];
    const range = document.createElement('input');
    range.type = 'range';
    range.min = min; range.max = max; range.step = step;
    range.value = settings.camera[key];
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = Number(settings.camera[key]).toFixed(step < 1 ? 1 : 0);
    range.addEventListener('input', () => {
      const v = Number(range.value);
      settings.setCamera(key, v);
      val.textContent = v.toFixed(step < 1 ? 1 : 0);
      // Effet immediat : regler une camera sans voir le resultat n'a aucun sens.
      if (game) game.applyCameraSettings();
    });
    row.append(label, range, val);
    box.appendChild(row);
  }
}

function openSettings() {
  settingsOpen = true;
  listeningFor = null;
  buildKeybinds();
  buildCamSettings();
  el('settings').classList.remove('hidden');
  keys.clear();
}

function closeSettings() {
  settingsOpen = false;
  listeningFor = null;
  el('settings').classList.add('hidden');
}

/** Reconstruit avatar et personnage apres un changement dans l'ecran Personnages. */
function onCosmeticChange() {
  game?.lobby?.rebuildAvatar?.();
  if (game && game.mode !== 'lobby' && game.character) {
    const at = game.character.position.clone();
    game.character.dispose();
    game.character = new Character(RAPIER, game.arena.world, game.view.scene, at);
  }
}

function wireWardrobeButton() {
  // La barre flottante de garde-robe est remplacee par l'ecran Personnages, plus complet.
  el('wardrobe').classList.add('hidden');
}

function wireSettings() {
  el('btn-settings').addEventListener('click', openSettings);
  el('settings-close').addEventListener('click', closeSettings);
  el('settings-ok').addEventListener('click', closeSettings);
  el('reset-keys').addEventListener('click', () => { settings.resetKeys(); buildKeybinds(); });
  el('reset-cam').addEventListener('click', () => {
    settings.resetCamera();
    buildCamSettings();
    if (game) game.applyCameraSettings();
  });
  el('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });
}

// ---------- garde-robe ----------
function buildWardrobe() {
  const panel = el('wardrobe');
  panel.innerHTML = '';

  // Choix du modele. On n'affiche que les personnages REELLEMENT charges : la galerie
  // se remplit au fur et a mesure des generations, sans qu'un bouton mort n'apparaisse.
  for (const m of MODELS.filter((m) => assets.has(m.id))) {
    const b = document.createElement('button');
    b.className = 'modelbtn' + (m.id === cosmetics.model ? ' on' : '');
    b.textContent = m.name + (m.rigged ? '' : ' (figé)');
    b.title = m.rigged ? 'Personnage animé par squelette' : 'Sans squelette : animé par le corps entier';
    b.addEventListener('click', () => {
      cosmetics.setModel(m.id);
      sfx.click();
      buildWardrobe();
      // Le lobby est la vitrine des cosmetiques : il doit montrer ce qu'on selectionne.
      game?.lobby?.rebuildAvatar?.();
      // En course, le personnage est recree sur place.
      if (game?.mode !== 'lobby' && game?.character) {
        const at = game.character.position.clone();
        game.character.dispose();
        game.character = new Character(RAPIER, game.arena.world, game.view.scene, at);
      }
    });
    panel.appendChild(b);
  }
  const sep = document.createElement('div');
  sep.style.cssText = 'width:2px;background:rgba(255,255,255,.18);margin:0 4px;border-radius:1px';
  panel.appendChild(sep);
  for (const skin of SKINS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (skin.hex === cosmetics.hex ? ' on' : '');
    b.style.background = '#' + skin.hex.toString(16).padStart(6, '0');
    b.title = skin.name;
    b.addEventListener('click', () => {
      cosmetics.set(skin.hex);
      sfx.click();
      for (const other of panel.children) other.classList.remove('on');
      b.classList.add('on');
    });
    panel.appendChild(b);
  }
}

// ---------- jeu ----------
class Game {
  constructor(view, lobby) {
    this.view = view;
    this.lobby = lobby;
    // L'arene est construite au depart de la manche et liberee a la fin : garder les
    // mini-jeux en memoire ferait tourner plusieurs mondes physiques et ferait payer a
    // chaque joueur le cout des maps qu'il ne joue pas.
    this.arena = null;
    // Une PARTIE est une suite de manches tirees au sort. `partie` vaut null au lobby.
    this.partie = null;
    this.mode = 'lobby';
    this.character = null;
    this.runTime = 0;
    this.falls = 0;
    this.crowns = Number(localStorage.getItem('tumble-crowns')) || 0;
    this.best = null;   // charge par mini-jeu au depart de la manche
    this.finishTimer = 0;
    this.accumulator = 0;
    this.countdown = 0;
    this.camTarget = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.desired = new THREE.Vector3();

    view.scene.add(lobby.group);
    this.buildPartieInfo();
    el('play').addEventListener('click', () => { sfx.click(); this.startEpisode(); });
    this.enterLobby(false);
  }

  /** Les scripts de diagnostic adressent l'arene courante sous son ancien nom. */
  get course() { return this.arena; }

  /**
   * Annonce le parcours de la prochaine partie dans le lobby.
   * Les epreuves sont tirees au DEPART de la partie, pas ici : afficher a l'avance ce
   * qui va tomber donnerait au joueur le temps de renoncer a une epreuve qu'il n'aime
   * pas, ce qui est exactement ce que la structure cherche a empecher.
   */
  buildPartieInfo() {
    const box = el('partie-info');
    if (!box) return;
    box.innerHTML = '';
    for (let i = 0; i < NB_MANCHES; i++) {
      const pastille = document.createElement('div');
      pastille.className = 'manche-pastille' + (i === NB_MANCHES - 1 ? ' finale' : '');
      pastille.textContent = i === NB_MANCHES - 1 ? 'FINALE' : `MANCHE ${i + 1}`;
      box.appendChild(pastille);
    }
  }

  /** Detruit l'arene courante : monde physique, geometries, et retrait de la scene. */
  releaseArena() {
    if (!this.arena) return;
    this.view.scene.remove(this.arena.group);
    this.arena.dispose?.();
    this.arena = null;
  }

  /** Recadre le lobby : centre, ou decale a gauche quand la vitrine est ouverte. */
  /** Choisit le point de vue du lobby : vue d'accueil, ou vitrine quand l'onglet
   *  Personnage est ouvert. Deux cadrages complets, jamais des decalages empiles. */
  applyLobbyFraming() {
    const pos = LOBBY.showcase ? SHOWCASE_POS : this.lobby.cameraPos;
    const look = LOBBY.showcase ? SHOWCASE_LOOK : this.lobby.cameraLook;
    this.view.camera.position.copy(pos);
    this.view.camera.lookAt(look);
    // La vitrine se regarde de plus pres : un champ plus etroit evite la deformation
    // des bords, tres visible sur un visage.
    this.view.camera.fov = LOBBY.showcase ? 34 : LOBBY.cameraFov;
    this.view.camera.updateProjectionMatrix();
    this.lobby.setShowcase?.(LOBBY.showcase);
  }

  enterLobby(showResult) {
    this.mode = 'lobby';
    this.character?.dispose();
    this.character = null;
    // Ordre imperatif : le personnage detient un corps dans le monde physique de
    // l'arene. Liberer le monde avant lui laisserait un pointeur wasm mort.
    this.releaseArena();
    this.lobby.group.visible = true;
    // Le fond du lobby remplace le ciel : garder les deux ferait apparaitre l'horizon derriere.
    this.view.sky.visible = false;
    this.view.clouds.visible = false;
    this.view.scene.fog = null;
    el('lobby-ui').classList.remove('hidden');
    el('race-ui').classList.add('hidden');
    el('crowns').textContent = String(this.crowns);
    this.view.camera.position.copy(this.lobby.cameraPos);
    this.view.camera.fov = LOBBY.cameraFov;
    this.view.camera.updateProjectionMatrix();
    this.applyLobbyFraming();
    if (showResult) {
      el('result-card').classList.add('show');
      clearTimeout(this._resultTimer);
      this._resultTimer = setTimeout(() => el('result-card').classList.remove('show'), 4200);
    }
  }

  /**
   * Lance une PARTIE : une suite de manches tirees au sort, jouees d'affilee.
   * Le joueur ne choisit pas son terrain — c'est le principe de la structure.
   */
  startEpisode() {
    this.partie = { parcours: tirerParcours(NB_MANCHES), index: 0, temps: [], chutes: 0 };
    this.crownsGagnees = 0;
    this.startRace();
  }

  /** Enchaine sur la manche suivante, ou termine la partie si c'etait la finale. */
  mancheSuivante() {
    if (!this.partie) { this.returnToLobby(); return; }
    this.partie.index++;
    if (this.partie.index >= this.partie.parcours.length) { this.gagnerPartie(); return; }
    this.startRace();
  }

  startRace() {
    closePause();
    const jeu = this.partie ? this.partie.parcours[this.partie.index] : MINIGAMES[0];
    this.jeuId = jeu.id;
    // Graine TIREE AU SORT a chaque manche : deux parties ne se ressemblent pas, et un
    // parcours appris par coeur ne vaut plus rien. Une seule graine par manche, pas une
    // par joueur — en multijoueur le serveur la tire et l'impose aux seize.
    // `?graine=N` impose la graine : c'est le seul moyen de PROUVER qu'une meme donne
    // redonne la meme carte, et c'est exactement ce que fera le serveur en multijoueur —
    // le harnais emprunte donc le vrai chemin de code, pas une porte derobee.
    const forcee = Number(new URLSearchParams(location.search).get('graine'));
    this.manche = Number.isFinite(forcee) && forcee > 0 ? forcee >>> 0 : graineDeManche();
    // Ordre imperatif, le meme que dans enterLobby : le personnage detient un corps dans
    // le monde physique de l'arene sortante. Liberer ce monde avant lui laisserait
    // `character.dispose()` retirer un corps d'un monde deja detruit — un pointeur wasm
    // mort, que rien ne signale avant le plantage.
    this.character?.dispose();
    this.character = null;
    this.releaseArena();
    this.arena = jeu.build(RAPIER, assets, { seed: this.manche });
    this.bestKey = `feel-lab-best-${this.jeuId}`;
    this.best = Number(localStorage.getItem(this.bestKey)) || null;
    this.view.scene.add(this.arena.group);
    this.mode = 'racing';
    this.runTime = 0;
    this.falls = 0;
    this.accumulator = 0;
    camYaw = 0;
    this.lobby.group.visible = false;
    this.arena.group.visible = true;
    el('race-title').textContent = jeu.name;
    const n = (this.partie?.index ?? 0) + 1, total = this.partie?.parcours.length ?? 1;
    el('race-manche').textContent = n === total ? 'FINALE' : `MANCHE ${n} / ${total}`;
    el('race-manche').classList.toggle('finale', n === total);
    // Ambiance : chaque epreuve impose son ciel. Une map spatiale gardee sous le ciel
    // bleu du parcours perdrait tout ce qui fait son atmosphere.
    this.applyAmbiance(this.arena.ambiance ?? 'jour');
    el('lobby-ui').classList.add('hidden');
    el('wardrobe').classList.add('hidden');
    el('result-card').classList.remove('show');
    el('race-ui').classList.remove('hidden');
    el('verdict').className = 'hidden';
    this.character = new Character(RAPIER, this.arena.world, this.view.scene, this.arena.spawn);
    const p = this.arena.spawn;
    this.camTarget.set(p.x, p.y + settings.camera.height, p.z + settings.camera.distance);
    this.ySlow = undefined;
    this.view.camera.fov = settings.camera.fov;
    // Depart bloque : en multijoueur, les 16 joueurs doivent partir au meme instant.
    // Le prototype respecte deja cette contrainte pour que le feel soit representatif.
    this.countdown = 3.99;
    el('countdown').classList.remove('hidden');
  }

  restart() {
    this.runTime = 0;
    this.falls = 0;
    // Sans cela, les portes deja franchies resteraient ouvertes : la manche rejouee
    // n'aurait plus rien a lire.
    this.arena.reset?.();
    this.cacherVerdict();
    this.countdown = 3.99;
    el('countdown').classList.remove('hidden');
    this.character.respawn(this.arena.spawn);
    el('banner').classList.remove('show');
  }

  /**
   * Bandeau de fin de manche.
   *
   * Les animations CSS ne rejouent pas si les classes sont deja posees : on remet donc
   * l'element a zero et on force un reflow avant de les reappliquer. Sans cela, la
   * deuxieme manche d'affilee afficherait un bandeau fige, deja en place.
   */
  verdict(texte, sous, type = 'ok') {
    const box = el('verdict');
    clearTimeout(this._verdictTimer);
    box.className = 'hidden';
    void box.offsetWidth;                     // force le reflow : relance les animations
    el('verdict-texte').textContent = texte;
    el('verdict-sous').textContent = sous ?? '';
    box.className = `show ${type}`;
  }

  cacherVerdict() {
    const box = el('verdict');
    if (box.classList.contains('hidden')) return;
    box.className = `sortie ${box.classList.contains('ko') ? 'ko' : 'ok'}`;
    clearTimeout(this._verdictTimer);
    this._verdictTimer = setTimeout(() => { box.className = 'hidden'; }, 320);
  }

  banner(text, hideAfter) {
    el('banner-text').textContent = text;
    el('banner').classList.add('show');
    clearTimeout(this._bannerTimer);
    if (hideAfter) this._bannerTimer = setTimeout(() => el('banner').classList.remove('show'), hideAfter);
  }

  /**
   * Ciel et brouillard de l'epreuve courante.
   * `nuit` sert aux maps spatiales : on eteint le ciel et les nuages, et le fond devient
   * le noir de la scene. Laisser le ciel bleu derriere une piste neon ruinerait le seul
   * effet qui compte sur ce genre de map — l'impression de flotter dans le vide.
   */
  applyAmbiance(nom) {
    const nuit = nom === 'nuit';
    this.view.sky.visible = !nuit;
    this.view.clouds.visible = !nuit;
    this.view.scene.fog = nuit ? this.view.fogNuit ?? null : this.view.fog;
    this.view.renderer.setClearColor(nuit ? 0x0a0620 : 0x89d7ff, 1);
  }

  /** Fin de partie : la finale est passee. */
  gagnerPartie() {
    this.mode = 'finished';
    this.finishTimer = 0;
    this.crowns++;
    localStorage.setItem('tumble-crowns', String(this.crowns));
    sfx.finish();
    const total = this.partie.temps.reduce((a, b) => a + b, 0);
    this.verdict('VICTOIRE', `${this.partie.parcours.length} manches · ${total.toFixed(2)} s · +1 👑`, 'win');
    el('result-title').textContent = 'PARTIE GAGNÉE';
    el('result-time').textContent = `${total.toFixed(2)} s`;
    el('result-line').textContent =
      `${this.partie.parcours.map((m) => m.name).join(' · ')} · +1 👑`;
    this.partie = null;
    this._finDePartie = true;
  }

  /** Fin d'une MANCHE : le joueur est qualifie pour la suivante. */
  finishRace() {
    this.mode = 'finished';
    this.finishTimer = 0;
    const record = !this.best || this.runTime < this.best;
    if (record) { this.best = this.runTime; localStorage.setItem(this.bestKey, String(this.runTime)); }
    sfx.finish();
    if (this.partie) {
      this.partie.temps.push(this.runTime);
      this.partie.chutes += this.falls;
      // Franchir la ligne de la FINALE, c'est gagner. Annoncer d'abord « qualifié » puis
      // « victoire » trois secondes plus tard faisait deux annonces pour un seul
      // evenement, et la premiere volait la vedette a la seconde.
      if (this.partie.index >= this.partie.parcours.length - 1) { this.gagnerPartie(); return; }
    }
    // « QUALIFIÉ » et non « ARRIVÉE » : c'est le vocabulaire de la structure — on ne
    // termine pas une course, on passe au tour suivant. La couronne ne tombe qu'a la
    // fin de la PARTIE, pas a chaque manche : sinon elle ne recompense plus rien.
    const chutes = this.falls ? `${this.falls} chute${this.falls > 1 ? 's' : ''} · ` : '';
    this.verdict('QUALIFIÉ',
      `${chutes}${this.runTime.toFixed(2)} s${record ? ' · NOUVEAU RECORD' : ''}`
      + (this.partie ? ' · manche suivante…' : ''), 'ok');
    el('result-title').textContent = record ? 'NOUVEAU RECORD' : 'MANCHE TERMINÉE';
    el('result-time').textContent = `${this.runTime.toFixed(2)} s`;
    el('result-line').textContent =
      `${this.falls} chute${this.falls > 1 ? 's' : ''} · record ${this.best.toFixed(2)} s`;
  }

  returnToLobby() {
    this.partie = null;
    this._finDePartie = false;
    this.cacherVerdict();
    el('banner').classList.remove('show');
    el('countdown').classList.add('hidden');
    this.countdown = 0;
    this.enterLobby(this.mode === 'finished');
  }

  update(dt, elapsed) {
    this.lobby.update(elapsed, dt);
    this.view.animateSky(elapsed, dt);

    if (this.mode === 'lobby') return;

    // En pause : le decor continue de vivre mais la simulation est figee, sinon le
    // chronometre avance et le personnage glisse pendant que le joueur lit le menu.
    this.arena.update(elapsed, paused ? 0 : dt, this.character?.position ?? null, this.view.camera);
    if (paused) { this.updateCamera(dt, this.character.position.clone()); return; }
    pollInput(dt);

    // Pendant le decompte, la physique tourne (le personnage se pose) mais il ne repond pas.
    if (this.countdown > 0) {
      this.countdown -= dt;
      input.x = 0; input.z = 0; input.jump = false; input.dive = false;
      jumpEdge = false; diveEdge = false;
      if (this.countdown > 0) {
        const n = Math.ceil(this.countdown - 0.99);
        if (n !== this._lastBeep) { this._lastBeep = n; if (n > 0) sfx.beep(); }
        el('countdown-text').textContent = String(n || 'GO !');
      } else {
        el('countdown').classList.add('hidden');
        this._lastBeep = null;
        sfx.go();
        this.banner('GO !', 800);
      }
    }

    const world = this.arena.world;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= world.timestep && steps < 3) {
      this.character.update(world.timestep, input, camYaw);
      world.step();
      this.accumulator -= world.timestep;
      steps++;
      if (input.jump) { input.jump = false; jumpEdge = false; }
      if (input.dive) { input.dive = false; diveEdge = false; }
    }

    const pos = this.character.position.clone();

    // Tapis roulants : Rapier n'a pas de surface mobile native. On pousse le joueur
    // tant qu'il repose sur la zone — plus stable qu'un corps cinematique en translation
    // infinie, et le decalage de texture rend le mouvement lisible.
    // Surfaces glissantes : c'est la scene qui dit ce qu'on a sous les pieds. Le
    // personnage ne connait qu'un chiffre, ce qui laisse chaque epreuve libre de
    // dessiner ses propres zones sans rien changer au controleur.
    this.character.glisse = this.arena.glisseAt?.(pos) ?? 0;
    // Surfaces MOBILES : meme principe, mais c'est une vitesse et non un coefficient.
    // Un tapis roulant se decrit par une boite alignee sur les axes ; un rondin qui
    // tourne, non — sa vitesse tangentielle depend de l'endroit ou l'on se tient sur
    // sa circonference. La scene renvoie donc directement la vitesse sous les pieds,
    // et le controleur s'en sert comme repere plutot que d'encaisser une poussee.
    this.character.surface = this.arena.surfaceAt?.(pos) ?? null;

    if (this.character.grounded) {
      for (const c of this.arena.conveyors) {
        if (pos.x >= c.minX && pos.x <= c.maxX && pos.z >= c.minZ && pos.z <= c.maxZ
            && Math.abs(pos.y - c.y) < 1.6) {
          const v = this.character.body.linvel();
          this.character.body.setLinvel(
            { x: v.x + c.vx * dt * 6, y: v.y, z: v.z + c.vz * dt * 6 }, true);
          break;
        }
      }
    }

    /*
     * TREMPLINS : le niveau prend la main sur la trajectoire.
     *
     * Meme mecanisme que les tapis roulants — l'arene declare des zones, la boucle de
     * jeu applique l'effet. Un tremplin ne peut pas etre un simple collider : il faut
     * imposer une vitesse verticale au personnage, ce que seul le controleur sait faire.
     *
     * L'impulsion REMPLACE la vitesse verticale au lieu de s'y ajouter : sinon un joueur
     * qui arrive en chute rapide serait a peine relance, et deux joueurs identiques
     * n'iraient pas a la meme hauteur selon leur approche. Un tremplin doit envoyer
     * tout le monde au meme endroit — c'est ce qui le rend lisible.
     */
    // Garde contre les positions non finies : avec un NaN, TOUTE comparaison est fausse,
    // donc aucun `continue` ne s'exécute et chaque zone se déclenche à vide. Un seul
    // NaN suffisait ainsi à faire tirer un tremplin situé à cent mètres de là.
    const posValide = Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
    for (const t of (posValide ? this.arena.tremplins ?? [] : [])) {
      if (pos.x < t.minX || pos.x > t.maxX || pos.z < t.minZ || pos.z > t.maxZ) continue;
      /*
       * Fenetre ASYMETRIQUE. Un joueur saute instinctivement sur un tremplin : il y
       * arrive donc jusqu'a 2,15 m au-dessus du tapis. Une tolerance symetrique de
       * 1,8 m le laissait traverser la zone sans etre propulse — il franchissait le
       * vide au sol, et tombait des qu'il sautait. Large vers le haut, serre vers le
       * bas pour ne pas declencher depuis l'etage inferieur.
       */
      if (pos.y - t.y > 3.4 || pos.y - t.y < -1.2) continue;
      const v = this.character.body.linvel();
      this.character.body.setLinvel({ x: v.x, y: t.force, z: v.z }, true);
      this.character.state = 'airborne';
      sfx.jump();
      break;
    }

    if (pos.y < this.arena.killY) {
      if (this.mode === 'racing') this.falls++;
      this.character.respawn(this.arena.checkpointFor(pos.z));
      this.ySlow = undefined;
    }

    if (this.mode === 'racing' && this.countdown <= 0) {
      this.runTime += dt;
      if (pos.z <= this.arena.finishZ) this.finishRace();
    } else if (this.mode === 'finished') {
      this.finishTimer += dt;
      // 3,2 s : le temps que le bandeau s'installe et se lise. En dessous, la manche
      // suivante demarre avant qu'on ait su ce qui venait de se passer.
      if (this.finishTimer > 3.2) {
        if (this._finDePartie) { this._finDePartie = false; this.returnToLobby(); }
        else this.mancheSuivante();
        // Sortie immediate : la suite de cette fonction lit `this.arena.spawn` pour la
        // barre de progression, et l'arene vient d'etre liberee ou remplacee. Sans ce
        // retour, chaque fin de partie levait une TypeError sur un pointeur mort.
        return;
      }
    }

    el('timer').textContent = this.runTime.toFixed(2);
    el('falls').textContent = String(this.falls);
    el('best').textContent = this.best ? this.best.toFixed(2) + ' s' : '—';

    // Progression : sans reperage, 120 m de piste se vivent comme un couloir sans fin.
    const total = this.arena.spawn.z - this.arena.finishZ;
    const done = Math.max(0, Math.min(1, (this.arena.spawn.z - pos.z) / total));
    el('progress-fill').style.width = (done * 100).toFixed(1) + '%';
    el('dist-text').textContent = Math.max(0, Math.round(total * (1 - done))) + ' m';
    this.updateCamera(dt, pos);
  }

  /** Répercute les réglages joueur sur la caméra, immédiatement. */
  applyCameraSettings() {
    if (this.mode !== 'lobby') {
      this.view.camera.fov = settings.camera.fov;
      this.view.camera.updateProjectionMatrix();
    }
  }

  updateCamera(dt, pos) {
    // Gel utilise par les scripts de diagnostic pour cadrer librement le parcours.
    if (this.freezeCamera) return;
    // Chaque epreuve a besoin d'un champ different : sur un parcours etroit on veut etre
    // pres du personnage, devant un mur de portes il faut le voir EN ENTIER assez tot pour
    // le lire. L'arene propose donc un ecart, ADDITIF : les reglages du joueur restent
    // maitres, on ne fait que decaler son cadrage.
    const base = settings.camera;
    const b = this.arena?.camBias ?? null;
    const cam = b ? {
      height: base.height + (b.height ?? 0),
      distance: base.distance + (b.distance ?? 0),
      lookHeight: base.lookHeight + (b.lookHeight ?? 0),
      fov: base.fov + (b.fov ?? 0),
      smoothing: base.smoothing,
    } : base;
    const v = this.character.body.linvel();
    const offX = Math.sin(camYaw) * cam.distance;
    const offZ = Math.cos(camYaw) * cam.distance;
    // Elevation dans les cotes : sans elle, la pente qui monte devant le joueur remplit
    // la moitie haute de l'ecran et masque ce qui arrive. On compare l'altitude a une
    // version lissee d'elle-meme — une pente reguliere ne se voit pas dans la vitesse
    // verticale, qui reste proche de zero quand le joueur epouse le sol.
    this.ySlow = this.ySlow === undefined ? pos.y : this.ySlow + (pos.y - this.ySlow) * Math.min(1, dt * 0.8);
    const montee = Math.max(0, pos.y - this.ySlow);

    // Suivi PLEIN en X. Le facteur 0,5 datait du couloir centre sur x = 0 : il gardait
    // la camera a mi-chemin de l'axe. Sur un trace qui serpente jusqu'a x = -13, le
    // joueur se retrouvait colle au bord de l'ecran, puis hors champ.
    this.desired.set(pos.x + offX, pos.y + cam.height + montee * 1.5, pos.z + offZ);
    // Pose immediate : les scripts de diagnostic teleportent le joueur d'une etape a
    // l'autre, et une camera lissee met plusieurs secondes a le rattraper. Sans ce
    // raccourci, les captures montrent la camera EN VOYAGE, souvent au milieu d'un mur.
    if (this.snapCamera) { this.camTarget.copy(this.desired); this.snapCamera = false; }
    else this.camTarget.lerp(this.desired, 1 - Math.exp(-cam.smoothing * dt));
    this.view.camera.position.copy(this.camTarget);
    // La cible est NETTEMENT au-dessus du joueur : sinon une camera haute plonge et
    // l'horizon disparait. Or c'est le fond — montagnes, nuages — qu'on regarde en courant.
    this.camLook.set(pos.x + v.x * TUNING.camLookAhead * 0.08, pos.y + cam.lookHeight + montee * 0.8, pos.z + v.z * TUNING.camLookAhead * 0.08);
    this.view.camera.lookAt(this.camLook);

    const speed = Math.hypot(v.x, v.z);
    const targetFov = cam.fov + Math.min(9, speed * 0.85);
    this.view.camera.fov += (targetFov - this.view.camera.fov) * Math.min(1, dt * 5);
    this.view.camera.updateProjectionMatrix();
    this.view.followShadow(pos);
  }
}

let game;

async function boot() {
  el('loading').textContent = 'Initialisation de la physique…';
  await RAPIER.init();

  el('loading').textContent = 'Chargement des textures…';
  await loadExternalTextures((d, t) => { el('loading').textContent = `Textures… ${d}/${t}`; });

  el('loading').textContent = 'Chargement des décors…';
  const count = await assets.load((done, total) => {
    el('loading').textContent = `Chargement des décors… ${done}/${total}`;
  });
  console.log(`[boot] ${count} modeles Meshy disponibles`);

  const view = createWorld();
  const lobby = buildLobbyScreen(assets);
  buildGui(() => game?.arena?.world ?? null);
  buildWardrobe();
  wireWardrobeButton();
  wireSettings();
  await applyIcons();
  buildSkinsScreen(onCosmeticChange);
  buildCollabsScreen();
  buildShopScreen();
  const tabs = wireTabs((tab) => {
    if (tab === 'skins-changed') { onCosmeticChange(); return; }
    LOBBY.showcase = tab === 'skins';
    if (game?.mode === 'lobby') game.applyLobbyFraming();
  });
  // Quitter un onglet revient toujours a Jouer : le lobby ne doit jamais rester
  // bloque sur un ecran secondaire quand une course demarre.
  el('play').addEventListener('click', () => tabs.show('play'));
  wirePause();
  game = new Game(view, lobby);
  el('loading').style.display = 'none';

  const clock = new THREE.Clock();
  let elapsed = 0, frames = 0, fpsAccum = 0;
  view.renderer.info.autoReset = false;
  function frame() {
    requestAnimationFrame(frame);
    view.renderer.info.reset();
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    elapsed += dt;
    game.update(dt, elapsed);
    view.applyGrade();
    view.composer.render();

    // On accumule le temps REEL, pas le delta plafonne : sinon un jeu a 2 fps
    // afficherait quand meme 20 fps, puisque chaque frame compterait pour 0,05 s.
    frames++; fpsAccum += rawDt;
    // renderer.info se remet a zero a chaque passe : sans autoReset=false, on ne lirait
    // que la derniere passe de post-processing (un quad), pas la scene entiere.
    if (fpsAccum >= 0.5) {
      const info = view.renderer.info.render;
      el('perf').textContent = `${Math.round(frames / fpsAccum)} fps · ${info.triangles.toLocaleString('fr')} tris · ${info.calls} draws`;
      window.__fps = Math.round(frames / fpsAccum);
      window.__tris = info.triangles;
      window.__draws = info.calls;
      window.__objects = view.scene.children.length;
      frames = 0; fpsAccum = 0;
    }
  }
  frame();
}

// Sonde de test : expose le personnage courant au harnais d'animation. Sans effet en jeu.
window.__probeCharacter = () => game?.character ?? null;
window.__probeGame = () => game ?? null;
window.__RAPIER = RAPIER;   // sondes de diagnostic (continuite du sol)
window.__THREE = THREE;     // sondes de diagnostic (raycast sur le rendu)
// Le parcours d'une partie est tire au sort : sans cette liste, un script de diagnostic
// ne peut pas cibler l'epreuve qu'il veut tester.
window.__MINIGAMES = MINIGAMES;
window.__probeLobbyAvatar = () => game?.lobby?.avatarHandle?.() ?? null;

boot().catch(fatal);
