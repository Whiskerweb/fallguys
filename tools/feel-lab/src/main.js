import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';
import { TUNING, TUNING_RANGES } from './tuning.js';
import { createWorld, GRADE } from './world.js';
import { assets } from './assets.js';
import { loadExternalTextures } from './textures.js';
import { MINIGAMES, minigame, graineDeManche, tirerParcours } from './scenes/index.js';
import { construireSurvol, SURVOL_DUREE } from './survol.js';
import { buildLobbyScreen, LOBBY, SHOWCASE_POS, SHOWCASE_LOOK } from './scenes/lobby.js';
import { Character } from './character.js';
import { cosmetics, MODELS } from './cosmetics.js';
import { sfx, unlockAudio, audio } from './audio.js';
import { RIG, RIG_RANGES } from './rig.js';
import { settings, ACTIONS, CAMERA_RANGES, CAMERA_LABELS, keyName } from './settings.js';
import { applyIcons, buildSkinsScreen, buildTicket, majBarre, wireEcrans } from './lobbyui.js';
import { table, portefeuille, progression, miseChoisie, ordinal, XP_MANCHE, XP_VICTOIRE, montant } from './economie.js';

const el = (id) => document.getElementById(id);


/**
 * Manches par partie. Trois, comme la reference : assez pour qu'une mauvaise manche ne
 * condamne pas, assez peu pour qu'une partie tienne dans une pause. La derniere est
 * annoncee comme FINALE — c'est elle qui donne la couronne.
 */
const NB_MANCHES = 3;

/**
 * SURVIVANTS PAR MANCHE, repris de `MatchConfiguration.Default` (src/Fallguys.Rules).
 *
 * Seize joueurs, puis huit, puis quatre, puis un. Le HUD affiche « Qualifies n/8 » et non
 * un nombre decoratif : le compteur de la reference dit combien de places restent, et
 * c'est cette information-la qui rend la course tendue. En solo il passe simplement de
 * 0/8 a 1/8 — le chiffre est juste, il n'y a personne d'autre pour le faire monter.
 */
const SURVIVANTS = [8, 4, 1];

/**
 * DUREES DE L'ENTREE EN MANCHE, relevees au chronometre sur la reference.
 *
 * L'enchainement compte autant que chaque etape : carrousel, volet, survol, puis coupe
 * FRANCHE sur la ligne de depart. La coupe est le seul moment sans transition de toute la
 * sequence, et c'est ce qui la rend nette — apres sept secondes de mouvement continu,
 * l'arret sec dit « maintenant c'est a toi ».
 */
const CARROUSEL_DUREE = 3.0;
const IRIS_DUREE = 0.5;
/** Duree d'un chiffre du decompte. Trois chiffres, puis GO. */
const DECOMPTE_PAS = 0.9;
const GO_DUREE = 1100;

/** Chronometre au format MM:SS:CC, comme la reference. */
function formaterChrono(t) {
  const cs = Math.max(0, Math.floor(t * 100));
  const deux = (n) => String(n).padStart(2, '0');
  return `${deux(Math.floor(cs / 6000))}:${deux(Math.floor(cs / 100) % 60)}:${deux(cs % 100)}`;
}

function fatal(err) {
  console.error(err);
  const box = el('loading');
  box.style.display = 'grid';
  box.style.padding = '40px';
  box.style.textAlign = 'center';
  box.textContent = 'Error: ' + (err?.message ?? err);
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

  // La sequence d'entree se saute. Elle dure sept secondes ; a la dixieme partie d'affilee
  // c'est du peage. La sauter ne change rien a ce qui va etre joue — l'epreuve et la
  // graine sont tirees avant qu'elle ne commence.
  if (game?.intro) { game.sauterIntro(); return; }

  // Entree fait exactement ce que fait le bouton : une PARTIE. Elle appelait
  // `startRace()`, qui laisse `partie` a null et ne joue donc qu'une seule manche —
  // deux chemins pour la meme action, l'un des deux se trompant de jeu.
  if (e.code === 'Enter' && game?.mode === 'lobby') game.startEpisode();
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
  gui = new GUI({ title: 'Game feel — H to hide' });
  const groups = {
    'Movement': ['maxSpeed', 'groundAccel', 'airAccel', 'groundFriction', 'turnSpeed'],
    'Jump': ['gravity', 'jumpHeight', 'coyoteTime', 'jumpBuffer', 'fallMultiplier'],
    'Dive': ['diveForward', 'diveUp', 'diveRecovery'],
    'Tumble': ['tumbleJolt', 'tumbleRecovery', 'getUpDuration'],
    'Squash & stretch': ['squashOnLand', 'stretchOnJump', 'squashSpring', 'squashDamping'],
    'Camera': ['camLookAhead'],   // le reste appartient au panneau Parametres
  };
  for (const [name, list] of Object.entries(groups)) {
    const folder = gui.addFolder(name);
    for (const k of list) {
      const [min, max] = TUNING_RANGES[k];
      folder.add(TUNING, k, min, max, (max - min) / 200).onChange(() => {
        if (k === 'gravity') getWorld().gravity = { x: 0, y: -TUNING.gravity, z: 0 };
      });
    }
    if (name !== 'Movement' && name !== 'Jump') folder.close();
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

  const audioFolder = gui.addFolder('Sound');
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
  } }, 'copier').name('Copy settings');
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
    /* Mise engagee sur la partie en cours, en micro-USDC. Fixee au lancement. */
    this.mise = 0;
    this.best = null;   // charge par mini-jeu au depart de la manche
    this.finishTimer = 0;
    this.accumulator = 0;
    this.countdown = 0;
    this.camTarget = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.desired = new THREE.Vector3();

    view.scene.add(lobby.group);
    // Le bouton JOUER est câblé par `buildTicket()`, qui seul connaît la mise choisie.
    this.enterLobby(false);
  }

  /** Les scripts de diagnostic adressent l'arene courante sous son ancien nom. */
  get course() { return this.arena; }

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
    // Une partie peut etre quittee en pleine sequence d'entree : sans cela le carrousel
    // resterait affiche par-dessus le lobby, et il couvre tout l'ecran.
    this.intro = null;
    this.survol = null;
    el('nextup').classList.add('hidden');
    el('iris').className = 'hidden';
    el('titlecard').className = 'hidden';
    el('race-ui').classList.remove('presentation');
    majBarre();
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
  startEpisode(mise = null) {
    /*
     * La mise est DEBITEE au lancement, pas a l'arrivee.
     *
     * C'est ce qui fait la difference entre un bouton et un engagement : l'argent quitte
     * le portefeuille avant la premiere manche, et abandonner en cours de partie le perd.
     * Le gain, lui, est credite a la fin selon le rang atteint.
     */
    const engagee = mise ?? miseChoisie();
    if (portefeuille.solde < engagee) return;
    portefeuille.debiter(engagee);
    this.mise = engagee;
    this.partie = { parcours: tirerParcours(NB_MANCHES), index: 0, temps: [], chutes: 0 };
    this.startRace();
  }

  /**
   * Credite le gain du rang atteint et fait avancer la progression.
   *
   * Le rang vient de la partie, pas d'une constante : le prototype est solo, donc il n'y
   * a personne pour prendre la premiere place et le joueur qui va au bout finit toujours
   * 1er. Le CALCUL, lui, est celui du noyau de regles — le jour ou quinze adversaires
   * arrivent, seul le rang passe change.
   */
  reglerPartie(rang) {
    if (!this.mise) return 0;
    const gain = table(this.mise).parRang[rang - 1] ?? 0;
    if (gain > 0) portefeuille.crediter(gain);
    this.mise = 0;
    return gain;
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
    el('race-manche').textContent = n === total ? 'FINAL' : `ROUND ${n} / ${total}`;
    el('race-manche').classList.toggle('finale', n === total);
    // Ambiance : chaque epreuve impose son ciel. Une map spatiale gardee sous le ciel
    // bleu du parcours perdrait tout ce qui fait son atmosphere.
    this.applyAmbiance(this.arena.ambiance ?? 'jour');
    el('lobby-ui').classList.add('hidden');
    // Accès FACULTATIF. Le panneau de garde-robe a été retiré du lobby ; l'appel restait,
    // et `startRace` levait donc une TypeError avant même de construire l'arène — plus une
    // seule manche ne démarrait. Un élément d'interface qu'une refonte peut supprimer se
    // lit au conditionnel : la boucle de jeu ne doit pas dépendre de la présence d'un
    // panneau décoratif.
    el('wardrobe')?.classList.add('hidden');
    el('result-card').classList.remove('show');
    el('race-ui').classList.remove('hidden');
    el('verdict').className = 'hidden';
    this.character = new Character(RAPIER, this.arena.world, this.view.scene, this.arena.spawn);
    const p = this.arena.spawn;
    this.camTarget.set(p.x, p.y + settings.camera.height, p.z + settings.camera.distance);
    this.ySlow = undefined;
    this.view.camera.fov = settings.camera.fov;

    // HUD : l'objectif vient de l'epreuve, le compteur de places de nos propres regles.
    const manche = this.partie?.index ?? 0;
    // L'arene peut imposer son objectif ; sinon celui du registre fait foi. Les deux
    // existent parce qu'une carte a parfois besoin de nuancer la phrase du catalogue.
    el('hud-objectif').textContent = this.arena.objectif ?? jeu.objectif ?? 'COURIR À L’ARRIVÉE !';
    this.survivants = SURVIVANTS[Math.min(manche, SURVIVANTS.length - 1)];
    el('hud-qualifies').textContent = `0/${this.survivants}`;
    el('timer').textContent = formaterChrono(0);

    this.demarrerIntro(jeu);
  }

  /**
   * ENTREE EN MANCHE : carrousel, volet iris, survol, puis coupe franche.
   *
   * L'arene est DEJA construite quand la sequence demarre, et l'epreuve DEJA tiree. La
   * sequence ne decide de rien : elle raconte une decision prise. C'est ce qui permet de
   * la sauter d'une touche sans changer d'un iota ce qui va etre joue — et c'est aussi ce
   * qui la rend honnete, puisqu'un carrousel qui tirerait au sort a l'affichage serait un
   * generateur aleatoire de plus, exactement ce que la spec interdit.
   */
  demarrerIntro(jeu) {
    // `?nointro` : les harnais n'ont pas a subir sept secondes de presentation avant chaque
    // mesure, et certains enchainent des dizaines de manches. Le drapeau ne change rien a
    // ce qui est joue — l'epreuve et la graine sont deja tirees — donc une mesure faite
    // sans intro reste une mesure du vrai jeu.
    if (new URLSearchParams(location.search).has('nointro')) {
      this.intro = null;
      this.survol = null;
      el('nextup').classList.add('hidden');
      el('iris').className = 'hidden';
      el('titlecard').className = 'hidden';
      el('race-ui').classList.remove('presentation');
      this.snapCamera = true;
      this.countdown = 3 * DECOMPTE_PAS;
      el('countdown').classList.remove('hidden');
      return;
    }
    this.survol = construireSurvol(this.arena);
    this.intro = { phase: 'carrousel', t: 0, jeu };
    this.countdown = 0;
    el('countdown').classList.add('hidden');
    el('titlecard-nom').textContent = jeu.name.toUpperCase();
    el('titlecard-obj').textContent = this.arena.objectif ?? jeu.objectif ?? 'COURIR À L’ARRIVÉE !';
    el('titlecard').className = 'hidden';
    el('race-ui').classList.add('presentation');
    this.batirCarrousel(jeu);
    el('nextup').classList.remove('hidden');
    el('iris').className = 'hidden';
  }

  /**
   * Remplit le carrousel et lance son defilement.
   *
   * Les cartes sont posees dans l'ordre du catalogue, repete assez de fois pour que le
   * defilement ait de quoi durer, et on s'arrete sur l'occurrence de l'epreuve tiree dans
   * le DERNIER tour. Repeter le catalogue plutot que de tirer des cartes au hasard evite
   * qu'une carte n'apparaisse deux fois cote a cote, ce qui trahirait immediatement que le
   * ruban est fabrique pour l'occasion.
   */
  batirCarrousel(jeu) {
    const piste = el('nextup-cartes');
    piste.innerHTML = '';
    piste.style.transition = 'none';
    piste.style.transform = 'translateX(0)';

    const TOURS = 3;
    const suite = [];
    for (let t = 0; t < TOURS; t++) suite.push(...MINIGAMES);
    const cible = (TOURS - 1) * MINIGAMES.length + MINIGAMES.findIndex((m) => m.id === jeu.id);

    const cartes = suite.map((m, i) => {
      const c = document.createElement('div');
      c.className = 'carte';
      const v = document.createElement('div');
      v.className = 'vignette';
      // Vignette peinte si elle existe, degrade bati sur l'accent de l'epreuve sinon. Le
      // meme contrat de repli gracieux que les icones du lobby : un fichier absent ne doit
      // jamais laisser un trou blanc a l'ecran.
      v.style.background = `linear-gradient(150deg, ${m.accent}, #2a1b45)`;
      v.style.backgroundSize = 'cover';
      const img = new Image();
      img.onload = () => { v.style.background = `url(${img.src}) center/cover`; };
      img.src = `/icons/map-${m.id}.png`;
      const n = document.createElement('div');
      n.className = 'nom';
      n.textContent = m.name;
      c.append(v, n);
      piste.appendChild(c);
      if (i === cible) c.dataset.cible = '1';
      return c;
    });

    // Le decalage se mesure APRES la pose, sur les elements reels : les cartes sont
    // dimensionnees en vw et leur largeur n'est pas connue avant le calcul de mise en page.
    requestAnimationFrame(() => {
      const carte = cartes[cible];
      if (!carte) return;
      const piste2 = el('nextup-piste');
      const dx = carte.offsetLeft + carte.offsetWidth / 2 - piste2.clientWidth / 2;
      // Deceleration : c'est elle qui fait le tirage. Un defilement lineaire qui s'arrete
      // net se lit comme un chargement qui se termine, pas comme une roue qui s'immobilise.
      piste.style.transition = `transform ${CARROUSEL_DUREE * 0.92}s cubic-bezier(.12,.72,.16,1)`;
      piste.style.transform = `translateX(${-dx}px)`;
      setTimeout(() => carte.classList.add('gagnante'), CARROUSEL_DUREE * 780);
    });
  }

  /**
   * Fait avancer la sequence d'entree. Renvoie true tant qu'elle tient la main.
   *
   * Pendant toute la sequence la simulation est ARRETEE : on ne fait pas tourner un monde
   * physique pendant sept secondes pour le jeter ensuite, et surtout le personnage ne doit
   * pas avoir bouge d'un centimetre quand la coupe tombe sur la ligne de depart.
   */
  avancerIntro(dt) {
    const it = this.intro;
    if (!it) return false;
    it.t += dt;

    if (it.phase === 'carrousel') {
      if (it.t >= CARROUSEL_DUREE) {
        it.phase = 'iris'; it.t = 0;
        el('iris').className = 'ouvre';
        el('nextup').classList.add('hidden');
        el('titlecard').className = '';
      }
      return true;
    }

    if (it.phase === 'iris') {
      // Le survol commence DERRIERE le volet qui s'ouvre : decouvrir une image figee puis
      // la voir demarrer ferait deux temps la ou il n'y en a qu'un.
      this.cadrerSurvol(0);
      if (it.t >= IRIS_DUREE) {
        it.phase = 'survol'; it.t = 0;
        el('iris').className = 'hidden';
      }
      return true;
    }

    this.cadrerSurvol(it.t / SURVOL_DUREE);
    if (it.t >= SURVOL_DUREE) {
      // COUPE FRANCHE. Aucun fondu, aucun raccord : la camera saute a sa place derriere le
      // personnage et le decompte part. C'est la rupture qui fait comprendre que la
      // presentation est finie.
      this.intro = null;
      this.survol = null;
      el('race-ui').classList.remove('presentation');
      el('titlecard').className = 'sortie';
      setTimeout(() => el('titlecard').className = 'hidden', 400);
      this.snapCamera = true;
      // Depart bloque : en multijoueur, les 16 joueurs doivent partir au meme instant.
      // Le prototype respecte deja cette contrainte pour que le feel soit representatif.
      this.countdown = 3 * DECOMPTE_PAS;
      el('countdown').classList.remove('hidden');
    }
    return true;
  }

  /** Pose la camera sur le rail du survol. */
  cadrerSurvol(t) {
    if (!this.survol) return;
    const { pos, look } = this.survol.echantillon(t);
    this.view.camera.position.copy(pos);
    this.view.camera.lookAt(look);
    this.view.camera.fov = settings.camera.fov + 6;
    this.view.camera.updateProjectionMatrix();
    this.view.followShadow?.(look);
  }

  /** Coupe la sequence d'entree et passe directement au decompte. */
  sauterIntro() {
    if (!this.intro) return;
    this.intro.phase = 'survol';
    this.intro.t = SURVOL_DUREE;
    el('nextup').classList.add('hidden');
    el('iris').className = 'hidden';
    this.avancerIntro(0);
  }

  restart() {
    this.runTime = 0;
    this.falls = 0;
    // Sans cela, les portes deja franchies resteraient ouvertes : la manche rejouee
    // n'aurait plus rien a lire.
    this.arena.reset?.();
    this.cacherVerdict();
    // Pas de survol sur un simple « recommencer » : on vient de voir le parcours, et le
    // revoir a chaque tentative transformerait la sequence en peage.
    this.countdown = 3 * DECOMPTE_PAS;
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
    // Le sous-titre accepte une chaine OU une pilule { etiquette, valeur }. La pilule est
    // la forme de la reference : le temps y est une VALEUR encadree, pas une legende — on
    // le lit d'un coup d'oeil au moment ou l'on cherche justement a savoir combien on a mis.
    const sousBox = el('verdict-sous');
    if (sous && typeof sous === 'object') {
      sousBox.innerHTML = '';
      const e = document.createElement('div');
      e.className = 'etiquette';
      e.textContent = sous.etiquette;
      const v = document.createElement('div');
      v.className = 'valeur';
      v.textContent = sous.valeur;
      sousBox.append(e, v);
    } else {
      sousBox.textContent = sous ?? '';
    }
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
    sfx.finish();
    const total = this.partie.temps.reduce((a, b) => a + b, 0);
    const gain = this.reglerPartie(1);
    progression.gagner(XP_VICTOIRE);
    this.verdict('VICTORY!',
      { etiquette: `1st place · +${montant(gain)} USDC`, valeur: formaterChrono(total) },
      'win');
    el('result-title').textContent = 'MATCH WON';
    el('result-time').textContent = `+${montant(gain)} USDC`;
    el('result-line').textContent =
      `${this.partie.parcours.map((m) => m.name).join(' · ')} · ${total.toFixed(2)} s`;
    this.partie = null;
    this._finDePartie = true;
  }

  /** Fin d'une MANCHE : le joueur est qualifie pour la suivante. */
  finishRace() {
    this.mode = 'finished';
    this.finishTimer = 0;
    /*
     * Le SENS du record vient de l'epreuve, pas d'une liste d'identifiants.
     *
     * Sur une course, le meilleur temps est le plus court. Sur une survie, c'est le plus
     * LONG : le chronometre n'y mesure pas une traversee mais une resistance. Comparer dans
     * le mauvais sens ne donnerait pas un record faux, il donnerait un record qui ne bouge
     * plus jamais apres la premiere manche.
     *
     * La cle `feel-lab-best-<id>` ne change pas de forme, et une carte de survie a
     * forcement un identifiant inedit : aucun record deja pose ne change de sens sous les
     * pieds du joueur. Pour les quatre cartes existantes, `long` vaut false et l'expression
     * est strictement celle d'avant.
     */
    const long = !!this.arena.survie;
    const record = !this.best || (long ? this.runTime > this.best : this.runTime < this.best);
    if (record) { this.best = this.runTime; localStorage.setItem(this.bestKey, String(this.runTime)); }
    sfx.finish();
    if (this.partie) {
      this.partie.temps.push(this.runTime);
      this.partie.chutes += this.falls;
      progression.gagner(XP_MANCHE);
      // Franchir la ligne de la FINALE, c'est gagner. Annoncer d'abord « qualifié » puis
      // « victoire » trois secondes plus tard faisait deux annonces pour un seul
      // evenement, et la premiere volait la vedette a la seconde.
      if (this.partie.index >= this.partie.parcours.length - 1) { this.gagnerPartie(); return; }
    }
    // « QUALIFIÉ » et non « ARRIVÉE » : c'est le vocabulaire de la structure — on ne
    // termine pas une course, on passe au tour suivant. La couronne ne tombe qu'a la
    // fin de la PARTIE, pas a chaque manche : sinon elle ne recompense plus rien.
    // Une place de prise sur celles de la manche. Sans adversaires le compteur ne montera
    // pas plus haut, mais le chiffre est le VRAI : huit qualifies en manche 1, comme le
    // pose MatchConfiguration. Un compteur decoratif aurait menti sur la structure.
    el('hud-qualifies').textContent = `1/${this.survivants ?? SURVIVANTS[0]}`;
    this.verdict('QUALIFIED!',
      { etiquette: record ? 'NEW BEST' : 'Your time', valeur: formaterChrono(this.runTime) },
      'ok');
    el('result-title').textContent = record ? 'NEW BEST' : 'ROUND COMPLETE';
    el('result-time').textContent = `${this.runTime.toFixed(2)} s`;
    el('result-line').textContent =
      `${this.falls} fall${this.falls > 1 ? 's' : ''} · best ${this.best.toFixed(2)} s`;
  }

  /**
   * Fin d'une manche PERDUE : le joueur est elimine, et la partie s'arrete la.
   *
   * Symetrique de `gagnerPartie` et non de `finishRace` : une elimination ne mene pas a la
   * manche suivante, elle termine la partie. C'est exactement ce qui donne son poids a la
   * boue rose — la seule chose que le joueur risque vraiment.
   *
   * ── LE RANG EST LE SEUL CHIFFRE QUI SORT D'ICI ──────────────────────────────────────
   * `reglerPartie` PREND DEJA un rang ; il n'etait jamais appele qu'avec 1, faute d'une
   * facon de perdre. On lui donne enfin l'autre moitie de son travail.
   *
   * Elimine dans une manche ou `survivants` places restaient, on finit juste derriere la
   * derniere : rang `survivants + 1`. Seul, cela vaut 9, 5 ou 2 selon la manche, et la
   * table des gains paie deja ces trois lignes sans qu'on y touche — rien en manche 1 (le
   * seuil de remboursement est justement la fin de la premiere manche), la mise en manche 2,
   * la mise et une part en finale.
   *
   * C'est aussi la couture du multijoueur : le jour ou seize joueurs s'affrontent, le
   * serveur passera le vrai rang et cette methode ne bougera pas d'une ligne. C'est
   * precisement pour cela qu'elle prend un rang plutot que de constater « perdu ».
   */
  perdreManche(rang = (this.survivants ?? SURVIVANTS[0]) + 1) {
    this.mode = 'finished';
    this.finishTimer = 0;
    // Un record de survie se bat aussi quand on PERD. Tenir 42 s puis tomber reste la
    // meilleure resistance du joueur ; sans cette ligne, le HUD n'aurait rien a afficher
    // tant qu'on n'a pas tenu la duree complete au moins une fois — c'est-a-dire tant
    // qu'on n'a pas gagne, ce qui vide le mot « record » de son sens.
    if (this.arena?.survie && (!this.best || this.runTime > this.best)) {
      this.best = this.runTime;
      localStorage.setItem(this.bestKey, String(this.runTime));
    }
    // Pas de son dedie : `tumble` EST deja le bruit du personnage qui part au tapis. En
    // inventer un second pour le meme evenement les ferait se marcher dessus.
    sfx.tumble();
    const gain = this.reglerPartie(rang);
    // L'XP est acquise : la manche a ete JOUEE. C'est le seul retour d'une partie perdue,
    // et c'est ce que suppose la courbe de niveaux — sans elle, tomber en manche 1 ne
    // rendrait strictement rien, ni argent ni progression.
    progression.gagner(XP_MANCHE);
    this.verdict('ELIMINATED!',
      { etiquette: gain > 0 ? `${ordinal(rang)} place · +${montant(gain)} USDC` : `${ordinal(rang)} place`,
        valeur: formaterChrono(this.runTime) },
      'ko');
    el('result-title').textContent = 'ELIMINATED';
    el('result-time').textContent = gain > 0 ? `+${montant(gain)} USDC` : formaterChrono(this.runTime);
    el('result-line').textContent = this.arena?.survie
      ? `Held ${this.runTime.toFixed(2)} s out of ${this.arena.survie.duree} s`
      : `${this.falls} fall${this.falls > 1 ? 's' : ''}`;
    this.partie = null;
    // Comme la victoire : 3,2 s plus tard on rentre au lobby, on n'enchaine pas.
    this._finDePartie = true;
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
    /*
     * ARMEMENT DE LA MANCHE — cinquieme argument, purement additif.
     *
     * `arena.update` tourne DEJA bien avant que le joueur ait la main : on passe ici avant
     * le `return` de l'intro (quelques lignes plus bas), donc pendant les sept secondes de
     * presentation, puis pendant les 2,7 s de decompte ou `world.step()` tourne pour que le
     * personnage se pose. Sur une carte qui s'effondre au CONTACT, cela ferait une dizaine
     * de secondes d'erosion sous un joueur qui ne peut pas encore bouger : la dalle de
     * depart aurait disparu avant le GO.
     *
     * Les Dalles echappent au probleme par la GEOMETRIE — leur depart est pose sur un palier
     * plein — et non par une garde. Une carte dont l'aire de depart cede ne peut pas
     * emprunter cette esquive : c'est donc a la boucle de jeu de dire quand la manche est
     * reellement commencee, puisqu'elle seule connait l'intro et le decompte.
     *
     * Le sens de l'erreur est le bon : `countdown` n'est decremente qu'apres ce point, donc
     * a l'image ou il croise zero la garde tient encore. Elle se relache une image trop
     * tard, jamais trop tot.
     *
     * Les quatre epreuves existantes declarent quatre parametres et ignorent donc ce
     * cinquieme en silence : la modification leur est litteralement invisible.
     */
    const enJeu = this.mode === 'racing' && !this.intro && this.countdown <= 0;
    this.arena.update(elapsed, paused ? 0 : dt, this.character?.position ?? null, this.view.camera, enJeu);
    if (paused) { this.updateCamera(dt, this.character.position.clone()); return; }

    // Sequence d'entree : le decor vit deja (les barils roulent, les drapeaux battent) mais
    // la simulation du joueur est arretee et la camera est sur son rail.
    if (this.avancerIntro(dt)) return;

    pollInput(dt);

    // Pendant le decompte, la physique tourne (le personnage se pose) mais il ne repond pas.
    if (this.countdown > 0) {
      this.countdown -= dt;
      input.x = 0; input.z = 0; input.jump = false; input.dive = false;
      jumpEdge = false; diveEdge = false;
      if (this.countdown > 0) {
        // Un chiffre par PAS, et non par seconde : 0,9 s est la cadence relevee sur la
        // reference. Rapportee a la seconde, l'annonce trainait juste assez pour que le
        // depart se lise comme une formalite plutot que comme un compte a rebours.
        const n = Math.ceil(this.countdown / DECOMPTE_PAS);
        if (n !== this._lastBeep) { this._lastBeep = n; if (n > 0) sfx.beep(); }
        el('countdown-text').textContent = String(n);
      } else {
        el('countdown').classList.add('hidden');
        this._lastBeep = null;
        sfx.go();
        this.banner('GO !', GO_DUREE);
      }
    }

    const world = this.arena.world;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= world.timestep && steps < 3) {
      this.character.update(world.timestep, input, camYaw);
      world.step();
      // Garde-fou APRES le pas : c'est le solveur qui produit les expulsions, donc c'est
      // apres lui qu'il faut les borner. Pose avant, la limite serait ecrasee par le pas.
      this.character.limiterVitesse();
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

    /*
     * Passer sous `killY` n'a pas le meme sens partout.
     *
     * En course, c'est un trou dans le sol : on paie une chute et on repart du dernier
     * point de reprise. En SURVIE, c'est l'elimination — et c'est tout le sujet de
     * l'epreuve : si tomber ne coutait qu'une reapparition, il n'y aurait plus rien a
     * tenir, donc plus rien a jouer. La consequence technique suit la consequence de jeu :
     * une carte de survie n'a pas de points de reprise, donc `checkpointFor` n'y existe
     * pas, et l'appeler planterait avant meme d'etre un contresens.
     *
     * `countdown <= 0` : on ne peut pas etre elimine avant d'avoir eu la main. La physique
     * tourne pendant le decompte, et sans cette garde un depart mal pose tuerait le joueur
     * avant le GO.
     */
    if (pos.y < this.arena.killY) {
      if (this.arena.survie) {
        if (this.mode === 'racing' && this.countdown <= 0) this.perdreManche();
      } else {
        if (this.mode === 'racing') this.falls++;
        this.character.respawn(this.arena.checkpointFor(pos.z));
        this.ySlow = undefined;
      }
    }

    if (this.mode === 'racing' && this.countdown <= 0) {
      this.runTime += dt;
      // Deux facons de gagner une manche, une ligne chacune : ARRIVER quelque part, ou
      // TENIR assez longtemps. La duree annoncee n'est pas une invention destinee a
      // masquer l'absence d'adversaires — la reference elle-meme s'arrete au bout d'un
      // delai, et tous les survivants prennent alors la couronne. On garde la regle, on
      // raccourcit l'horloge.
      if (this.arena.survie) {
        if (this.runTime >= this.arena.survie.duree) this.finishRace();
      } else if (pos.z <= this.arena.finishZ) this.finishRace();
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

    el('timer').textContent = formaterChrono(this.runTime);
    el('falls').textContent = String(this.falls);
    el('best').textContent = this.best ? this.best.toFixed(2) + ' s' : '—';

    /*
     * Progression : sans reperage, 120 m de piste se vivent comme un couloir sans fin.
     *
     * Sur une tour il n'y a pas de piste. Une barre en Z y mesurerait un deplacement de
     * quelques metres et resterait collee a zero toute la manche. Ce qu'on parcourt dans
     * une survie, c'est le TEMPS : la barre mesure donc la meme chose — la part du chemin
     * deja faite — sur un autre axe, et le compteur annonce les secondes qui restent a
     * tenir au lieu des metres a couvrir. La barre se remplit dans le meme sens dans les
     * deux cas : le geste de lecture ne change pas d'une epreuve a l'autre.
     */
    let done;
    if (this.arena.survie) {
      done = Math.max(0, Math.min(1, this.runTime / this.arena.survie.duree));
      // `ceil` et non `round` : annoncer « 0 s » alors qu'il reste quatre dixiemes a tenir
      // serait un mensonge a l'instant precis ou il coute le plus cher.
      el('dist-text').textContent =
        Math.max(0, Math.ceil(this.arena.survie.duree - this.runTime)) + ' s';
    } else {
      const total = this.arena.spawn.z - this.arena.finishZ;
      done = Math.max(0, Math.min(1, (this.arena.spawn.z - pos.z) / total));
      el('dist-text').textContent = Math.max(0, Math.round(total * (1 - done))) + ' m';
    }
    el('progress-fill').style.width = (done * 100).toFixed(1) + '%';
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
  el('loading').textContent = 'Starting the physics…';
  await RAPIER.init();

  el('loading').textContent = 'Loading textures…';
  await loadExternalTextures((d, t) => { el('loading').textContent = `Textures… ${d}/${t}`; });

  el('loading').textContent = 'Loading the sets…';
  const count = await assets.load((done, total) => {
    el('loading').textContent = `Loading the sets… ${done}/${total}`;
  });
  console.log(`[boot] ${count} modeles Meshy disponibles`);

  const view = createWorld();
  const lobby = buildLobbyScreen(assets);
  buildGui(() => game?.arena?.world ?? null);
  wireSettings();
  await applyIcons();
  buildSkinsScreen(onCosmeticChange);
  const ecrans = wireEcrans((nom) => {
    // La vitrine recadre la camera sur le buste ; le plateau la remet en vue d'accueil.
    LOBBY.showcase = nom === 'skins';
    if (game?.mode === 'lobby') game.applyLobbyFraming();
  }, onCosmeticChange);
  wirePause();
  game = new Game(view, lobby);
  // Le ticket detient la mise : c'est lui qui declenche la partie, avec le montant choisi.
  buildTicket((mise) => { ecrans.montrer('play'); game.startEpisode(mise); });
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
      el('perf').textContent = `${Math.round(frames / fpsAccum)} fps · ${info.triangles.toLocaleString('en')} tris · ${info.calls} draws`;
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
// Les constantes de game feel, telles que le jeu les applique VRAIMENT. Un harnais
// qui les recopierait de son cote mesurerait un reglage imaginaire des qu'une valeur
// bouge — et c'est precisement quand elle bouge qu'on a besoin de le mesurer.
window.__TUNING = TUNING;
window.__THREE = THREE;     // sondes de diagnostic (raycast sur le rendu)
// Le parcours d'une partie est tire au sort : sans cette liste, un script de diagnostic
// ne peut pas cibler l'epreuve qu'il veut tester.
window.__MINIGAMES = MINIGAMES;
window.__probeLobbyAvatar = () => game?.lobby?.avatarHandle?.() ?? null;

boot().catch(fatal);
