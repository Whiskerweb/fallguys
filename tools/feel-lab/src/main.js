import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';
import { TUNING, TUNING_RANGES } from './tuning.js';
import { createWorld, GRADE } from './world.js';
import { assets } from './assets.js';
import { loadExternalTextures } from './textures.js';
import { MINIGAMES, minigame, graineDeManche, tirerParcours } from './scenes/index.js';
import { construireSurvol, SURVOL_DUREE } from './survol.js';
import { buildLobbyScreen, LOBBY, SHOWCASE_POS, SHOWCASE_LOOK, PODIUM_POS, PODIUM_LOOK } from './scenes/lobby.js';
import { Character } from './character.js';
import { cosmetics, MODELS } from './cosmetics.js';
import { placer, graineCulbute } from './placement.js';
import { sfx, unlockAudio, audio } from './audio.js';
import { RIG, RIG_RANGES, createRiggedCharacter } from './rig.js';
import { settings, ACTIONS, CAMERA_RANGES, CAMERA_LABELS, keyName } from './settings.js';
import { applyIcons, buildSkinsScreen, buildBoutique, buildTicket, buildCompte, buildPortefeuille, majBarre, wireEcrans } from './lobbyui.js';
import { brancherMatchmaking } from './matchmaking.js';
import { table, tableEffectif, tirerIssue, progression, miseChoisie, modeChoisi, MODES, ordinal, XP_MANCHE, XP_VICTOIRE, montant } from './economie.js';
import { creerRoue } from './roue.js';
import { caisse } from './caisse.js';
import { surSession } from './compte.js';
import { buildPorte } from './porte.js';
import { buildCadeau, evaluerCadeau } from './cadeau.js';
import { buildDepot, ouvrirDepot } from './depot.js';

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
    if (game?.mode === 'lobby' || game?.mode === 'podium') return;
    paused ? closePause() : openPause();
    return;
  }
  if (paused) return;

  // La sequence d'entree se saute. Elle dure sept secondes ; a la dixieme partie d'affilee
  // c'est du peage. La sauter ne change rien a ce qui va etre joue — l'epreuve et la
  // graine sont tirees avant qu'elle ne commence.
  if (game?.intro) { game.sauterIntro(); return; }

  // Entree fait exactement ce que fait le bouton : chercher une PARTIE EN LIGNE — ou
  // sortir de la file si l'on y est. `jouer` est pose par `matchmaking.js` ; il n'existe
  // plus de chemin hors ligne derriere cette touche.
  if (e.code === 'Enter' && game?.mode === 'lobby') game.jouer?.();
  if (settings.matches(e.code, 'restart') && game?.mode === 'racing') game.restart();
  if (e.code === 'KeyH' && gui) gui.show(gui._hidden);
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
  if (!game || game.mode === 'lobby' || game.mode === 'podium') return;
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
/** Entree neutre : ce qu'on donne a un personnage que le joueur ne pilote plus. */
const INERTE = Object.freeze({ x: 0, z: 0, jump: false, dive: false });

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

    /*
     * LE FORMAT DE PARTIE — `duel` | `squad` | `arena` — et la variante de roue sous
     * laquelle elle se paie.
     *
     * Il s'appelle `format` et non `mode` parce que `this.mode` est DEJA pris par l'etat de
     * la boucle de jeu (`lobby` / `racing` / `finished`), que `__probeGame()` publie et que
     * les deux harnais navigateur attendent. Les confondre a suffi a figer `diag/duel.mjs`
     * sur une attente qui n'arrivait jamais : le serveur jouait, la page disait « duel ».
     */
    this.format = 'arena';
    this.variante = 'standard';
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
    // Ceinture et bretelles : on peut rentrer au lobby par le menu de pause, qui ne passe
    // pas par `quitterEcranDeFin`.
    this.cacherEcranDeFin();
    // Le plateau rend son avatar au joueur : le podium du vainqueur est fini.
    this.lobby.quitterPodium?.();
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
    /*
     * `showResult` VAUT DESORMAIS TOUJOURS FAUX, et ce n'est pas un oubli.
     *
     * `#result-card` etait la carte de fin de partie : elle s'ouvrait au retour au lobby et
     * se refermait seule 4,2 s plus tard. L'ecran de fin — la roue et son panneau — l'a
     * remplacee, et l'afficher par-dessus ferait deux annonces du meme resultat.
     *
     * Le parametre reste, et les trois `#result-*` continuent d'etre REMPLIS par
     * `finishRace` : `diag/hexagone.mjs` y lit le titre de fin de manche. Ce sont des
     * champs de texte que le harnais interroge, plus un panneau qu'on montre.
     */
    if (showResult) {
      el('result-card').classList.add('show');
      clearTimeout(this._resultTimer);
      this._resultTimer = setTimeout(() => el('result-card').classList.remove('show'), 4200);
    }
  }

  /**
   * Lance une PARTIE SOLO : une suite de manches tirees au sort, jouees d'affilee.
   *
   * BANC UNIQUEMENT. Il n'existe plus de partie hors ligne pour le joueur : ni PLAY, ni
   * Entree, ni aucun bouton n'arrive ici. Cette methode ne survit que pour les harnais
   * qui mesurent une CARTE sans serveur — `diag/partie.mjs` et les mesures de traversee —
   * et ils l'appellent par `__probeGame().startEpisode()`. Le jour ou ces bancs passent
   * par le serveur, elle part avec `finishRace`, `perdreManche` et `mancheSuivante`.
   */
  /*
   * La mise est DEBITEE au lancement, pas a l'arrivee.
   *
   * C'est ce qui fait la difference entre un bouton et un engagement : l'argent quitte le
   * portefeuille avant la premiere manche, et abandonner en cours de partie le perd. Le
   * gain, lui, est credite a la fin selon le rang atteint.
   *
   * ASYNCHRONE DEPUIS QUE L'ARGENT EST REEL. Le debit local ne pouvait pas echouer ; un
   * debit distant peut etre refuse, expirer, ou partir deux fois sur un double-clic. On
   * n'entre donc en partie qu'apres CONFIRMATION que la mise est engagee — jamais en
   * pariant qu'elle passera. `caisse.engager` se verrouille contre les appels
   * concurrents, et la base derriere lui aussi.
   */
  async startEpisode(mise = null) {
    const engagee = mise ?? miseChoisie();

    // Un identifiant par partie : c'est la cle d'idempotence du backend. Rejouer la meme
    // requete ne debite qu'une fois, et le reglement s'y raccroche a la fin.
    const matchId = (crypto.randomUUID?.() ?? String(Date.now())) + '';

    if (!(await caisse.engager(matchId, engagee))) return;

    this.matchId = matchId;
    this.mise = engagee;
    /*
     * LE SOLO SE PAIE AU BAREME DE REFERENCE, et la roue n'y tourne pas.
     *
     * Ce n'est pas un oubli : la roue tire la forme d'un bareme entre plusieurs joueurs, et
     * il n'y en a qu'un ici. Un solo qui tirerait sa propre variante serait la seule partie
     * du jeu ou une machine deciderait du gain d'un joueur sans adversaire — exactement ce
     * que la section 5 du spec interdit.
     */
    this.format = modeChoisi();
    this.variante = 'standard';
    // Autant de manches que le mode en compte : un duel se joue en une, une arene en trois.
    // Sans cela, le ticket annoncerait une forme de partie et le jeu en jouerait une autre.
    const manches = MODES[this.format]?.survivants.length ?? NB_MANCHES;
    this.partie = { parcours: tirerParcours(manches), index: 0, temps: [], chutes: 0 };
    this.startRace();
  }

  /**
   * Engage la mise d'une partie EN LIGNE.
   *
   * Meme geste que `startEpisode`, moins tout ce qui construit la partie : en ligne, c'est
   * le serveur qui impose la carte, la graine et le depart. Il ne reste donc que l'argent.
   *
   * APPELE AU LANCEMENT DE LA MANCHE 1, jamais a l'entree en file. C'est ce que le ticket
   * promet — « ta mise part au lancement » — et c'est la seule position defendable : un
   * joueur qui attend dans un salon qui ne part pas ne doit rien avoir paye.
   *
   * Le MODE et la VARIANTE viennent du SERVEUR, comme la carte et la graine. Le client ne
   * choisit pas le bareme selon lequel il sera paye ; il l'a lu dans le lobby avant de
   * rester, et c'est tout.
   */
  async engagerEnLigne({ mise = 0, mode = 'arena' } = {}) {
    this.format = mode;

    if (!mise) { this.mise = 0; return true; }

    const matchId = (crypto.randomUUID?.() ?? String(Date.now())) + '';
    if (!(await caisse.engager(matchId, mise))) return false;

    this.matchId = matchId;
    this.mise = mise;
    return true;
  }

  /**
   * Credite le gain du rang atteint et fait avancer la progression.
   *
   * Le rang vient de la partie, pas d'une constante : le prototype est solo, donc il n'y
   * a personne pour prendre la premiere place et le joueur qui va au bout finit toujours
   * 1er. Le CALCUL, lui, est celui du noyau de regles — le jour ou quinze adversaires
   * arrivent, seul le rang passe change.
   */
  reglerPartie(rang, effectif = null, graineRoue = 0) {
    if (!this.mise) return 0;
    if (rang > (MODES[this.format ?? 'arena']?.joueurs ?? 16)) return 0;
    const mise = this.mise;
    this.mise = 0;

    /*
     * Le gain est calcule ICI pour l'afficher tout de suite ; le versement, lui, part au
     * backend SANS ETRE ATTENDU.
     *
     * L'ecran de fin ne doit pas dependre du reseau — un joueur qui vient de gagner ne
     * regarde pas une roue tourner. Ce n'est pas un pari : `backend/test/tout.mjs` compare
     * les deux tables des gains rang par rang a chaque execution, donc le chiffre affiche
     * ici EST celui qui sera paye. Et la requete etant idempotente, un reseau coupe ne
     * perd rien : elle repassera.
     */
    const mode = this.format ?? 'arena';
    /*
     * UN SALON PARTI INCOMPLET NE SE PAIE PAS AU BAREME DE LA TABLE PLEINE.
     *
     * L'ecart n'est pas cosmetique : une arene partie a douze n'a que douze mises dans son
     * pot, et la payer au bareme de seize ferait combler la difference par la caisse a
     * chaque partie — la maison paierait des gains que personne n'a finances. Le joueur, de
     * son cote, a explicitement accepte ce pot plus petit avant le depart.
     *
     * Un salon reduit n'a pas de variante non plus : la roue tire la forme d'un bareme
     * annonce d'avance, et celui-la ne l'a pas ete.
     */
    /*
     * LA LIGNE DU TABLEAU EST DERIVEE DE LA GRAINE, jamais declaree. Le serveur de jeu l'a
     * tiree au classement final ; ici comme au backend on refait le meme tirage. Un salon
     * reduit n'a pas de roue : sa table est calculee, sans graine.
     */
    const joueurs = MODES[mode]?.joueurs ?? 16;
    const complet = (effectif ?? joueurs) === joueurs;
    const bareme = complet ? table(mise, mode, tirerIssue(mode, graineRoue).id) : tableEffectif(mise, effectif);
    const gain = bareme.parRang[rang - 1] ?? 0;
    caisse.regler(this.matchId, rang, mise, mode, graineRoue, effectif);
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
    /*
     * EN LIGNE, LE CLIENT NE TIRE PLUS RIEN.
     *
     * `this.imposee` est renseignee par le serveur : epreuve et graine. Les seize joueurs
     * construisent alors exactement le meme monde, ce qui est la condition de la
     * prediction — deux mondes differents ne se corrigent pas, ils divergent.
     */
    const jeu = this.imposee
      ? (MINIGAMES.find((m) => m.id === this.imposee.epreuve) ?? MINIGAMES[0])
      : (this.partie ? this.partie.parcours[this.partie.index] : MINIGAMES[0]);
    this.jeuId = jeu.id;
    // Graine TIREE AU SORT a chaque manche : deux parties ne se ressemblent pas, et un
    // parcours appris par coeur ne vaut plus rien. Une seule graine par manche, pas une
    // par joueur — en multijoueur le serveur la tire et l'impose aux seize.
    // `?graine=N` impose la graine : c'est le seul moyen de PROUVER qu'une meme donne
    // redonne la meme carte, et c'est exactement ce que fera le serveur en multijoueur —
    // le harnais emprunte donc le vrai chemin de code, pas une porte derobee.
    const forcee = Number(new URLSearchParams(location.search).get('graine'));
    this.manche = this.imposee
      ? this.imposee.graine >>> 0
      : (Number.isFinite(forcee) && forcee > 0 ? forcee >>> 0 : graineDeManche());
    // Ordre imperatif, le meme que dans enterLobby : le personnage detient un corps dans
    // le monde physique de l'arene sortante. Liberer ce monde avant lui laisserait
    // `character.dispose()` retirer un corps d'un monde deja detruit — un pointeur wasm
    // mort, que rien ne signale avant le plantage.
    this.character?.dispose();
    this.character = null;
    this.releaseArena();
    this.arena = jeu.build(RAPIER, assets, { seed: this.manche });
    // Une manche qui commence pendant que le plateau montre encore un vainqueur (REJOUER
    // sans repasser par le lobby) : on lui rend le joueur.
    this.lobby.quitterPodium?.();
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
    const n = this.imposee ? this.imposee.numero : (this.partie?.index ?? 0) + 1;
    const total = this.imposee ? this.imposee.sur : (this.partie?.parcours.length ?? 1);
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
    // Et la roue s'en va. Elle n'appartient qu'à la fin d'une partie ; la laisser vivre
    // dans une manche neuve en ferait un élément permanent du décor.
    this.cacherEcranDeFin();
    /*
     * SA PLACE, pas le milieu de la carte.
     *
     * Le personnage naissait sur `arena.spawn` brut : les seize joueurs se créaient tous au
     * MEME point, et la correction les repoussait ensuite vers la place que le serveur leur
     * avait attribuee — une teleportation des le premier instantane, a chaque manche.
     *
     * `monIndex` et l'effectif sont poses par la session AVANT que l'annonce ne remonte
     * jusqu'ici : les deux sont donc renseignes a temps. On LIT deux nombres et on APPELLE
     * le meme calcul que le serveur ; aucun netcode n'entre dans ce fichier.
     *
     * La graine de culbute suit le meme chemin. Elle valait ZERO ici — quatre arguments au
     * lieu de cinq — alors que le serveur en derive une par joueur : les deux ne
     * culbutaient donc pas pareil, et l'ecart passait pour un defaut de prediction.
     */
    const siege = this.enligne?.monIndex ?? 0;
    const effectif = this.enligne?.manche?.joueurs?.length ?? 1;
    const place = placer(this.arena, siege, effectif);
    this.depart = new THREE.Vector3(place.x, place.y, place.z);

    this.character = new Character(
      RAPIER, this.arena.world, this.view.scene,
      this.depart, graineCulbute(this.manche, siege),
    );
    // La session recoit le personnage local et la scene : c'est ici que naissent les
    // figurants des autres joueurs, pas avant (il faut une scene) ni apres (les premiers
    // instantanes arriveraient sans personne a animer).
    // `placeDe` : la place de chaque siège, LE MÊME calcul que le nôtre et que le serveur.
    // Sans elle, un adversaire naît à l'origine du monde et y reste tout le décompte.
    this.enligne?.attacher({
      personnage: this.character, scene: this.view.scene, assets,
      placeDe: (index) => placer(this.arena, index, effectif),
    });
    const p = this.depart;   // la camera cadre LE JOUEUR, pas le milieu de la carte
    this.camTarget.set(p.x, p.y + settings.camera.height, p.z + settings.camera.distance);
    this.ySlow = undefined;
    this.view.camera.fov = settings.camera.fov;

    // HUD : l'objectif vient de l'epreuve, le compteur de places de nos propres regles.
    const manche = this.partie?.index ?? 0;
    // L'arene peut imposer son objectif ; sinon celui du registre fait foi. Les deux
    // existent parce qu'une carte a parfois besoin de nuancer la phrase du catalogue.
    el('hud-objectif').textContent = this.arena.objectif ?? jeu.objectif ?? 'COURIR À L’ARRIVÉE !';
    // En ligne, le nombre de places vient du SERVEUR : il connaît l'effectif réel, et un
    // salon de deux ne met pas huit places en jeu.
    this.survivants = this.imposee?.qualifies
      ?? SURVIVANTS[Math.min(manche, SURVIVANTS.length - 1)];
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
    /*
     * EN LIGNE, PAS DE SURVOL.
     *
     * Le serveur ne compte que trois secondes ; le survol du client en dure sept. Les
     * garder ferait demarrer la manche pendant que le joueur regarde encore le decor —
     * quatre secondes de retard sur seize adversaires, ce qui est perdu d'avance.
     *
     * On aligne donc le client sur le decompte que le serveur annonce, et le survol
     * reviendra le jour ou le serveur attendra qu'il soit fini. C'est un raccord a faire,
     * pas une renonciation.
     */
    if (this.enligne || new URLSearchParams(location.search).has('nointro')) {
      this.intro = null;
      this.survol = null;
      el('nextup').classList.add('hidden');
      el('iris').className = 'hidden';
      el('titlecard').className = 'hidden';
      el('race-ui').classList.remove('presentation');
      this.snapCamera = true;
      // Le decompte du serveur fait foi quand il y en a un : c'est lui qui decide quand la
      // manche commence reellement, et le client ne fait que l'afficher.
      this.countdown = (this.imposee?.decompte ?? 3) * DECOMPTE_PAS;
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
    this.character.respawn(this.depart);
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
      sousBox.append(e);
      // Pas de valeur, pas de pilule vide : l'ecran de fin ne montre que le rang.
      if (sous.valeur) {
        const v = document.createElement('div');
        v.className = 'valeur';
        v.textContent = sous.valeur;
        sousBox.append(v);
      }
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
    // La mise AVANT `reglerPartie`, qui la remet a zero : la roue en a besoin pour
    // construire ses quartiers, et elle ne se construit qu'apres le reglement.
    const mise = this.mise;
    const parcours = this.partie.parcours.map((m) => m.name).join(' · ');
    // En solo, personne ne tire pour nous : la graine de roue vient du navigateur. C'est le
    // prototype ; en ligne elle vient du serveur, avec le classement.
    const graineRoue = crypto.getRandomValues(new Uint32Array(1))[0];
    const gain = this.reglerPartie(1, null, graineRoue);
    progression.gagner(XP_VICTOIRE);
    this.partie = null;
    this._finDePartie = true;
    this._rejouer = () => this.startEpisode();
    this.ecranDeFin({
      titre: 'MATCH WON', banniere: 'VICTORY!', type: 'win',
      vainqueur: { modele: cosmetics.model },
      rang: 1, total: MODES[this.format ?? 'arena']?.joueurs ?? 16,
      gain, mise, mode: this.format ?? 'arena', graineRoue,
      podium: `${parcours} · ${formaterChrono(total)}`,
    });
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
    // Meme raison qu'a la victoire : la roue lit la mise, `reglerPartie` l'efface.
    const mise = this.mise;
    const graineRoue = crypto.getRandomValues(new Uint32Array(1))[0];
    const gain = this.reglerPartie(rang, null, graineRoue);
    // L'XP est acquise : la manche a ete JOUEE. C'est le seul retour d'une partie perdue,
    // et c'est ce que suppose la courbe de niveaux — sans elle, tomber en manche 1 ne
    // rendrait strictement rien, ni argent ni progression.
    progression.gagner(XP_MANCHE);
    const detail = this.arena?.survie
      ? `Held ${this.runTime.toFixed(2)} s out of ${this.arena.survie.duree} s`
      : `${this.falls} fall${this.falls > 1 ? 's' : ''}`;
    this.partie = null;
    // Comme la victoire : le bandeau se lit, puis la roue monte. On n'enchaine pas.
    this._finDePartie = true;
    this._rejouer = () => this.startEpisode();
    this.ecranDeFin({
      titre: 'ELIMINATED', banniere: 'ELIMINATED!', type: 'ko',
      rang, total: MODES[this.format ?? 'arena']?.joueurs ?? 16,
      gain, mise, mode: this.format ?? 'arena', graineRoue,
      podium: detail,
    });
  }

  returnToLobby() {
    // Une partie EN LIGNE quittee en route : on le dit au serveur avant de ranger la
    // scene. Le point d'accroche est pose par `matchmaking.js` ; aucun netcode ici.
    if (this.enligne) this.surAbandon?.();
    this.partie = null;
    this._finDePartie = false;
    this.cacherVerdict();
    el('banner').classList.remove('show');
    el('countdown').classList.add('hidden');
    this.countdown = 0;
    // Plus de `#result-card` : l'écran de fin l'a remplacée, et l'afficher par-dessus
    // ferait deux annonces du même résultat.
    this.enterLobby(false);
  }

  /*
   * ═══ L'ÉCRAN DE FIN ═══════════════════════════════════════════════════════════
   *
   * RIEN NE SE FERME TOUT SEUL. Le joueur vient de gagner ou de perdre de l'argent réel ;
   * lui reprendre l'écran au bout de quatre secondes était une décision qu'on prenait à sa
   * place. Il lance la roue quand il veut, il la regarde autant qu'il veut, et il choisit
   * entre LOBBY et REJOUER.
   *
   * LA ROUE NE TIRE RIEN. Le barème a été tiré dans le lobby, avant l'engagement de la
   * mise ; elle s'arrête sur le palier que le classement a donné. Voir `roue.js`.
   */

  /** La roue, construite à la demande : une page qui ne joue jamais n'en fabrique aucune. */
  get laRoue() {
    if (!this._roue) {
      this._roue = creerRoue({
        hote: el('roue-scene'),          // les classes d'état et les gestes
        montage: el('roue-disque-hote'), // le point de montage du SVG, vidé à chaque partie
        voile: el('roue-voile'),
      });
      this.brancherLancer();
    }
    return this._roue;
  }

  /**
   * Les trois façons de la lancer : le clic, l'espace, et le vrai geste.
   *
   * La force du geste change le nombre de tours et la durée — JAMAIS l'endroit où elle
   * s'arrête. La destination vient du classement ; le poignet ne décide de rien.
   */
  brancherLancer() {
    const scene = el('roue-scene');
    let depart = null;

    const lancer = (force) => {
      if (!this._roue?.armee || this._roue.lancee) return;
      // `lance` cache l'invite au clic ; `calee` — pose seulement au calage, dans
      // `poserLeGain` — sort les boutons. Les confondre laissait partir le joueur en
      // pleine rotation, avant d'avoir vu son montant.
      el('fin-panneau').classList.add('lance');
      this._roue.tourner(force, this._sansRecit).then((r) => this.poserLeGain(r));
    };

    scene.addEventListener('pointerdown', (e) => {
      depart = { x: e.clientX, y: e.clientY, t: performance.now() };
      scene.setPointerCapture?.(e.pointerId);
    });
    scene.addEventListener('pointerup', (e) => {
      if (!depart) return;
      const d = Math.hypot(e.clientX - depart.x, e.clientY - depart.y);
      const dt = Math.max(60, performance.now() - depart.t);
      depart = null;
      // Un clic net vaut un lancer moyen ; un grand geste rapide, un lancer appuyé.
      lancer(d < 12 ? 0.5 : Math.min(1, (d / dt) * 0.9));
    });
    this._lancerAuClavier = (e) => {
      if (e.code !== 'Space' || !this._roue?.armee || this._roue.lancee) return;
      e.preventDefault();
      lancer(0.5);
    };
    addEventListener('keydown', this._lancerAuClavier);

    el('fin-lobby').addEventListener('click', () => { sfx.click(); this.quitterEcranDeFin(); });
    el('fin-rejouer').addEventListener('click', () => {
      sfx.click();
      const rejouer = this._rejouer;
      this.quitterEcranDeFin();
      rejouer?.();
    });
  }

  /**
   * Ouvre l'écran de fin.
   *
   * Le bandeau de verdict d'abord — il dit ce qui vient de se passer —, puis la roue monte.
   * Les deux temps sont voulus : une roue qui apparaîtrait sur le même souffle que le
   * verdict ferait lire les deux en même temps, donc aucun des deux.
   */
  ecranDeFin({ titre, banniere, type, rang, total, gain, mise, mode, graineRoue = 0, podium, sous, vainqueur = null }) {
    this._sansRecit = new URLSearchParams(location.search).has('nointro');
    this._fin = { titre, rang, total, gain, mise, mode, graineRoue, podium, sous };
    // LA COUPURE. Avant tout texte : la partie est finie, on ne la regarde plus.
    if (vainqueur) this.montrerLePodium(vainqueur);
    /*
     * LE BANDEAU ET LE PANNEAU NE DISENT PAS LA MEME CHOSE, et c'est voulu.
     *
     * Le bandeau CRIE — « VICTORY! » —, c'est le cri du jeu au moment ou l'on gagne. Le
     * panneau CONSTATE — « MATCH WON », un rang, un montant. Les fondre en un seul texte
     * faisait perdre le cri : le verdict annoncait sobrement « MATCH WON » et la fin de
     * partie n'avait plus de pic.
     */
    /*
     * LE MONTANT NE SE LIT PAS AVANT LA ROUE. Le bandeau dit le rang, et rien d'autre :
     * il affichait « +3.60 USDC » ici, avant que le joueur ait lance quoi que ce soit, et
     * la roue ne revelait plus rien. Le chiffre n'apparait que dans `poserLeGain`, quand
     * elle s'est calee. Demande du directeur produit, et c'est tout l'interet du geste.
     */
    this.verdict(banniere ?? titre, { etiquette: `${ordinal(rang)} of ${total}`, valeur: '' }, type);
    clearTimeout(this._roueTimer);
    // Sans récit (harnais, `?nointro`), la roue est là tout de suite : un drapeau saute la
    // MISE EN SCÈNE, jamais le RÉSULTAT.
    this._roueTimer = setTimeout(() => this.montrerLaRoue(), this._sansRecit ? 0 : 1700);
  }

  /**
   * ═══ LE PODIUM ═════════════════════════════════════════════════════════════
   *
   * La partie est finie : on la COUPE. Plus d'arene, plus de chrono, plus d'objectif,
   * plus de nom de carte — les deux joueurs regardaient encore leur point de vue de
   * course derriere le verdict, et rien ne distinguait le gagnant du perdant sinon un
   * texte. Demande du directeur produit, 2 septembre 2026, et c'est la reference : le
   * vainqueur se teleporte sur un plateau, vu de face, et danse.
   *
   * Le plateau est celui du lobby — la meme scene, le meme socle, les memes projecteurs :
   * c'est deja la vitrine d'un personnage, et un second decor de podium ne ferait que
   * diverger du premier. Ce qui change : le personnage est celui du VAINQUEUR (chez le
   * perdant aussi), il regarde la camera, et il danse. `body.podium` masque le HUD de
   * course et pousse le panneau de fin et la roue vers la droite, ou ils ne le couvrent
   * pas.
   *
   * `mode` vaut `podium` : la boucle de jeu ne simule plus rien, le menu de pause ne
   * s'ouvre plus, et les harnais qui attendent « pas racing » le lisent tel quel.
   */
  montrerLePodium({ modele = null } = {}) {
    this.mode = 'podium';
    this.intro = null;
    this.survol = null;
    // Ordre imperatif, le meme qu'au lobby : le personnage detient un corps dans le monde
    // physique de l'arene ; liberer le monde avant lui laisserait un pointeur wasm mort.
    this.character?.dispose();
    this.character = null;
    this.releaseArena();

    this.lobby.group.visible = true;
    this.view.sky.visible = false;
    this.view.clouds.visible = false;
    this.view.scene.fog = null;
    this.view.renderer.setClearColor(0x0a0620, 1);
    this.view.camera.position.copy(PODIUM_POS);
    this.view.camera.lookAt(PODIUM_LOOK);
    this.view.camera.fov = LOBBY.cameraFov;
    this.view.camera.updateProjectionMatrix();
    this.lobby.setShowcase?.(false);

    el('countdown').classList.add('hidden');
    el('nextup').classList.add('hidden');
    el('iris').className = 'hidden';
    el('titlecard').className = 'hidden';
    el('race-ui').classList.remove('presentation');
    el('race-ui').classList.remove('hidden');   // le verdict et le panneau de fin y vivent
    document.body.classList.add('podium');

    const dessus = modele ?? cosmetics.model;
    this.lobby.montrerVainqueur?.(MODELS.some((m) => m.id === dessus) ? dessus : cosmetics.model);
  }

  montrerLaRoue() {
    const f = this._fin;
    if (!f) return;
    const panneau = el('fin-panneau');

    /*
     * PAS DE ROUE QUAND IL N'Y A RIEN EN JEU.
     *
     * Une partie gratuite ne paie aucun rang : `echelle()` regroupe alors les seize rangs
     * en UN quartier de 360°, et la roue devient un disque uni qu'on fait tourner pour
     * apprendre qu'on ne gagne rien. C'est pire qu'une absence — ça ressemble à une panne.
     *
     * On montre donc directement le résultat et les deux boutons. La roue est la cérémonie
     * d'un gain ; sans gain, il n'y a pas de cérémonie.
     */
    /*
     * ET PAS DE ROUE NON PLUS POUR UN SALON REDUIT : le tableau a dix lignes est ecrit
     * pour l'effectif du mode, et une arene partie a treize se paie au bareme calcule,
     * sans graine. Le resultat s'affiche directement, montant compris.
     */
    const complet = f.total === (MODES[f.mode]?.joueurs ?? f.total);
    if (!f.mise || !complet) {
      el('fin-titre').textContent = f.titre;
      el('fin-gain').textContent = f.gain > 0 ? `+${montant(f.gain)} USDC` : '—';
      el('fin-sous').textContent = f.sous ?? `${ordinal(f.rang)} of ${f.total} · ${f.mise ? 'reduced room' : 'free match'}`;
      el('fin-podium').textContent = f.podium ?? '';
      panneau.classList.remove('lance', 'rien');
      delete panneau.dataset.grade;
      panneau.classList.add('show', 'calee');
      this.cacherVerdict();
      return;
    }

    /*
     * LA ROUE DE CE JOUEUR : la colonne de son rang, dix cases. Elle s'arretera sur la
     * ligne que la graine du serveur designe — `tirerIssue` est le meme calcul que celui
     * du reglement, donc la case ou elle se cale EST ce qui a ete paye.
     */
    const issue = tirerIssue(f.mode, f.graineRoue);
    const xp = table(f.mise, f.mode, issue.id).xp[f.rang - 1] ?? 0;
    this.laRoue.preparer({ mode: f.mode, rang: f.rang, mise: f.mise });
    this.laRoue.montrer();
    this.laRoue.armer(issue.id, f.gain, xp);

    el('fin-titre').textContent = f.titre;
    el('fin-gain').textContent = '—';
    el('fin-sous').textContent = f.sous ?? `${ordinal(f.rang)} of ${f.total}`;
    el('fin-podium').textContent = f.podium ?? '';
    panneau.classList.remove('calee', 'lance', 'rien');
    delete panneau.dataset.grade;
    panneau.classList.add('show');
    this.cacherVerdict();

    /*
     * `?nointro` NE LANCE PAS LA ROUE A LA PLACE DU JOUEUR.
     *
     * Le drapeau saute le RECIT — l'attente avant qu'elle monte, et la rotation elle-meme
     * (`tourner(force, instantane)`) —, jamais le GESTE. Un harnais qui n'aurait rien a
     * cliquer ne prouverait pas que le clic marche, et c'est precisement le chemin que le
     * joueur empruntera a chaque partie.
     */
  }

  /**
   * La roue s'est calée : on écrit le montant, en USDC.
   *
   * Il monte de zéro jusqu'à sa valeur. C'est le seul endroit du jeu où un chiffre s'anime,
   * et il le mérite : c'est celui que le joueur est venu chercher.
   */
  poserLeGain(r) {
    const panneau = el('fin-panneau');
    const cible = el('fin-gain');
    panneau.classList.add('calee');
    if (r.gemme) panneau.dataset.grade = r.gemme;
    panneau.classList.toggle('rien', r.gain === 0 && !r.xp);
    // Le rang, sans le nom du palier : « DIAMOND » à côté d'un montant en USDC disait
    // deux fois la même chose dans deux vocabulaires (retiré avec les gemmes du ticket).
    el('fin-sous').textContent = `${ordinal(r.rang)} of ${this._fin?.total ?? '—'}`
      + (r.gain === 0 && !r.xp ? ' · no payout' : '');

    /*
     * UN BRONZE GAGNE DE L'XP, et c'est la roue qui le lui donne — pas une constante. Le
     * montant d'XP est celui de la case ou elle s'est calee ; il s'ajoute a l'XP de manche
     * deja acquise. Credite ICI, a l'arret, pour la meme raison que l'argent ne s'affiche
     * qu'a l'arret : avant, le joueur ne l'a pas encore vu.
     */
    if (r.gain === 0 && r.xp > 0) {
      progression.gagner(r.xp);
      cible.textContent = `+${r.xp} XP`;
      return;
    }
    if (r.gain === 0 || this._sansRecit) { cible.textContent = r.gain === 0 ? '—' : `+${r.montant} USDC`; return; }
    const t0 = performance.now();
    const monter = (t) => {
      const u = Math.min(1, (t - t0) / 900);
      cible.textContent = `+${montant(Math.round(r.gain * (1 - (1 - u) ** 3)))} USDC`;
      if (u < 1) requestAnimationFrame(monter);
    };
    requestAnimationFrame(monter);
  }

  /**
   * RANGE L'ÉCRAN DE FIN. Appelé de partout où une partie commence ou se quitte.
   *
   * La roue est un MOMENT, pas un décor. Elle n'existe qu'entre le dernier classement et
   * le choix du joueur ; partout ailleurs elle n'est pas là. Sans ce rangement, la roue
   * d'une partie restait en bas de l'écran pendant la suivante — on la voyait « tout le
   * temps », ce qui est exactement ce qu'elle ne doit pas être.
   */
  cacherEcranDeFin() {
    clearTimeout(this._roueTimer);
    this._fin = null;
    this._ecranFin = false;
    document.body.classList.remove('podium');
    this._roue?.cacher();
    el('fin-panneau').classList.remove('show', 'calee', 'lance', 'rien');
    delete el('fin-panneau').dataset.grade;
  }

  /** Ferme l'écran de fin et rend la main au lobby. */
  quitterEcranDeFin() {
    this.cacherEcranDeFin();
    this.returnToLobby();
  }

  update(dt, elapsed) {
    this.lobby.update(elapsed, dt);
    this.view.animateSky(elapsed, dt);

    // Lobby et podium : le decor du plateau vit (ligne au-dessus), rien d'autre ne tourne.
    if (this.mode === 'lobby' || this.mode === 'podium') return;

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
    /*
     * LE DECOR REAGIT A TOUT LE MONDE, PAS SEULEMENT A NOUS.
     *
     * En solo il n'y a qu'une position ; en ligne il en faut autant qu'il y a de joueurs.
     * Sans cela, chacun voyait un monde intact traverse par des fantomes : une porte
     * enfoncee par un adversaire restait fermee sur notre ecran, et on le voyait passer au
     * travers. Le serveur, lui, passait deja toutes les positions.
     *
     * Les cartes acceptent une position OU une liste — Les Dalles, Les Portes et
     * L'Hexagone sont les trois qui en tiennent compte.
     */
    // `sonde` et non `position` : la position, plus l'impact d'atterrissage — Les Dalles
    // font ceder une fausse dalle sans sursis sous un joueur qui s'y recoit. Le serveur
    // passe la meme chose (`tick.js`), sans quoi le client predirait une dalle qui tient.
    const focus = this.enligne
      ? this.enligne.positions(this.character?.sonde ?? null)
      : (this.character?.sonde ?? null);
    /*
     * L'HORLOGE DU DECOR VIENT DU SERVEUR, pas de la page.
     *
     * `elapsed` compte depuis l'ouverture de l'onglet — plusieurs minutes en general. Le
     * serveur, lui, repart de zero a chaque manche. Or le decor s'anime en fonction de ce
     * nombre, et cette animation deplace de VRAIS colliders : sur Le Rondin, l'angle d'un
     * tronc en est une fonction pure, et il fixe le visuel comme la physique.
     *
     * Les troncs n'etaient donc pas au meme angle des deux cotes. Rapporte en jouant :
     * « je me prends des obstacles invisibles ». Et chaque page ayant son propre decalage,
     * les deux joueurs ne voyaient meme pas le meme monde.
     *
     * En solo, rien ne change : il n'y a pas d'autre horloge que la sienne.
     */
    const horlogeDecor = this.enligne ? this.enligne.tempsMonde : elapsed;
    this.arena.update(horlogeDecor, paused ? 0 : dt, focus, this.view.camera, enJeu);
    if (paused) { this.updateCamera(dt, this.character.position.clone()); return; }

    // Sequence d'entree : le decor vit deja (les barils roulent, les drapeaux battent) mais
    // la simulation du joueur est arretee et la camera est sur son rail.
    if (this.avancerIntro(dt)) return;

    pollInput(dt);

    // Pendant le decompte, la physique tourne (le personnage se pose) mais il ne repond pas.
    if (this.countdown > 0) {
      this.countdown -= dt;
      // Les AUTRES joueurs vivent déjà : leurs instantanés arrivent pendant le décompte,
      // et ne pas les appliquer les laissait figés en T-pose là où ils étaient nés.
      this.enligne?.avancer(dt);
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

    /*
     * EN LIGNE : on envoie l'entree AVANT CHAQUE PAS de physique, et on note la position
     * APRES — dans la boucle ci-dessous, pas ici.
     *
     * Le numero attribue identifie le pas que le serveur jouera et accusera, et c'est lui
     * qui permettra de comparer sa reponse a l'endroit ou l'on se croyait AU MEME PAS.
     * Une entree par IMAGE — ce que faisait ce code — ne correspondait a rien : un ecran a
     * 120 Hz en envoyait deux par pas, une page a 30 images par seconde une pour deux pas,
     * et le serveur ne pouvait pas jouer les memes pas que nous.
     */

    const world = this.arena.world;
    this.accumulator += dt;
    let steps = 0;
    /*
     * UN ELIMINE NE PILOTE PLUS.
     *
     * Le serveur a cesse de simuler ce personnage et a fige son corps. Continuer a lui
     * donner les touches le ferait courir sur notre seul ecran, contre une position
     * autoritaire immobile : la correction le rappellerait a chaque image, et le joueur
     * verrait un tremblement au lieu d'un arret net.
     *
     * On lit un drapeau, on n'installe pas de logique reseau ici : la decision appartient
     * au serveur, ce fichier ne fait qu'en tenir compte.
     */
    /*
     * ON NE PILOTE PLUS NON PLUS PENDANT L'ECRAN DE FIN.
     *
     * En ligne, `jeu.mode` reste `racing` apres le dernier classement : la manche n'a pas
     * de fin cote client, c'est le serveur qui l'annonce. Sans cette garde, le personnage
     * continuait de courir derriere la roue pendant que le joueur lisait son gain.
     *
     * `estSorti` et non `estElimine` : le serveur fige aussi le corps d'un QUALIFIE, et
     * pousser un corps sans gravite que la correction rappelle a chaque image tremble.
     */
    const pilotable = !this._fin && !this.enligne?.estSorti;
    while (this.accumulator >= world.timestep && steps < 3) {
      this.enligne?.envoyer(input);
      this.character.update(world.timestep, pilotable ? input : INERTE, camYaw);
      world.step();
      // Garde-fou APRES le pas : c'est le solveur qui produit les expulsions, donc c'est
      // apres lui qu'il faut les borner. Pose avant, la limite serait ecrasee par le pas.
      this.character.limiterVitesse();
      this.enligne?.noterPas();
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
    // Et si la carte refuse la culbute (L'Hexagone : rien n'y destabilise, voir la scene).
    this.character.culbute = this.arena.culbute !== false;

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
    /*
     * EN LIGNE, LE CLIENT NE DECIDE PLUS DE RIEN.
     *
     * Ni la chute, ni la reapparition, ni la qualification : c'est le serveur qui arbitre
     * et qui l'annonce. Laisser le client conclure produirait deux verdicts differents
     * pour la meme manche — et c'est precisement le trou que le serveur autoritatif est la
     * pour fermer. Il continue de PREDIRE son deplacement ; il n'en tire aucune
     * consequence de jeu.
     */
    /*
     * DEUX GARDES ICI AUSSI, et il en manquait un.
     *
     * `enligne` couvre la manche en cours. `_fin` couvre l'INSTANT D'APRES : `brancher.js`
     * annule `jeu.enligne` avant d'ouvrir l'ecran de fin, et sans cette seconde garde la
     * boucle retombe dans les regles hors ligne a l'image suivante.
     *
     * Le meme trou avait deja ete bouche plus bas, sur la branche de la LIGNE D'ARRIVEE,
     * ou il frappait le vainqueur d'une course. Ici c'est la branche du SEUIL DE MORT, et
     * elle frappe le vainqueur d'une SURVIE — car sur Les Hexagones il finit lui aussi
     * sous le seuil : il a tenu plus longtemps que l'autre, pas indefiniment.
     *
     * Ce qui se passait : le serveur le sacrait premier, `brancher.js` affichait
     * « MATCH WON », puis a l'image suivante `perdreManche()` ecrasait tout par
     * « ELIMINATED · 2nd of 16 · Held 3.93 s out of 75 s ». Le joueur voyait une defaite
     * apres avoir gagne — et le « of 16 » venait de la table par defaut de cette voie
     * hors ligne, pas de l'effectif reel de sa partie.
     */
    /*
     * SAUF LA REAPPARITION D'UNE COURSE, QUI EST DU DEPLACEMENT, PAS UNE CONCLUSION.
     *
     * Le serveur repose un joueur tombe sur son dernier point de passage (`manche.js`),
     * avec le meme `checkpointFor` et le meme `respawn` que nous. Ne pas le predire
     * laissait le personnage tomber pendant tout l'aller-retour, puis la correction le
     * reposait la ou il etait tombe PLUS la chute faite entre-temps — sous la plate-forme,
     * d'ou il retombait ; et ainsi de suite, un instantane apres l'autre, le personnage
     * ballotte sous la carte et la camera avec lui. Vu sur la video du 4 septembre 2026.
     *
     * On predit donc la reapparition comme on predit un pas : sans compter une chute pour
     * le classement (le serveur la compte), sans conclure quoi que ce soit. En SURVIE,
     * tomber est une elimination — une conclusion — et elle reste au serveur.
     */
    if (!this._fin && pos.y < this.arena.killY) {
      if (this.arena.survie) {
        if (!this.enligne && this.mode === 'racing' && this.countdown <= 0) this.perdreManche();
      } else if (!this.enligne?.estSorti) {
        if (this.mode === 'racing') this.falls++;
        this.character.respawn(this.arena.checkpointFor(pos.z));
        this.ySlow = undefined;
        // Une reapparition est un SAUT : la camera saute avec, elle ne voyage pas. Lissee,
        // elle mettait plusieurs secondes a rejoindre le point de passage en traversant
        // la carte — c'est ce que le directeur produit a filme comme « teleporte partout ».
        this.snapCamera = true;
        /*
         * ET ELLE SAUTE VERS LA NOUVELLE POSITION, pas vers le fond du trou. `pos` a ete
         * clone AVANT la reapparition : la camera se posait a 5 m au-dessus de `killY`,
         * l'altitude lissee `ySlow` s'y initialisait, et a l'image suivante la logique
         * d'elevation dans les cotes lisait une « montee » de 13 m — la camera partait
         * a 20 m au-dessus du personnage et mettait plusieurs secondes a redescendre.
         * « Quand on tombe dans le vide, la camera est mise en haut » (directeur produit,
         * 4 septembre 2026). Trace au banc : camY −6,6 puis 15,3 puis 20,2 apres une
         * reapparition a y = 1,6.
         */
        pos.copy(this.character.position);
      }
    }
    // Une fin de partie vient de COUPER la course (podium) : l'arene n'existe plus, et la
    // suite de cette fonction la lit. On sort — la scene du plateau n'a rien a mesurer.
    if (!this.arena) return;

    if (this.mode === 'racing' && this.countdown <= 0) {
      this.runTime += dt;
      if (this.enligne) { this.enligne.avancer(dt); this.enligne.mesurerLatence(60); }
      // Deux facons de gagner une manche, une ligne chacune : ARRIVER quelque part, ou
      // TENIR assez longtemps. La duree annoncee n'est pas une invention destinee a
      // masquer l'absence d'adversaires — la reference elle-meme s'arrete au bout d'un
      // delai, et tous les survivants prennent alors la couronne. On garde la regle, on
      // raccourcit l'horloge.
      /*
       * DEUX GARDES, ET IL EN FAUT DEUX.
       *
       * `enligne` couvre la manche en cours : le serveur tranche, le client n'a rien a
       * decider. `_fin` couvre l'instant d'apres — `brancher.js` annule `jeu.enligne`
       * avant d'ouvrir l'ecran de fin, et sans cette seconde garde la boucle retombait
       * dans les regles HORS LIGNE a l'image suivante.
       *
       * Ce qui se passait alors, et c'est le bug qu'on repare ici : le vainqueur est
       * encore pose au-dela de la ligne, donc `pos.z <= finishZ` est vrai, donc
       * `finishRace()` partait et ecrasait le verdict « VICTORY! · +3.60 USDC » par un
       * « QUALIFIED! », puis renvoyait au lobby 3,2 s plus tard en detruisant la roue.
       * L'argent avait bien ete verse ; le joueur ne le voyait jamais.
       *
       * Le bug ne frappait QUE celui qui avait franchi la ligne — donc le vainqueur, et
       * seulement sur les cartes qu'on peut finir. D'ou le motif « certaines cartes
       * comptent, d'autres non », alors que le chemin de l'argent ne lit jamais quelle
       * epreuve a ete jouee.
       */
      if (this.enligne || this._fin) {
        // Rien : le serveur a tranche, ou la partie est DEJA finie et l'ecran de fin a la main.
      } else if (this.arena.survie) {
        if (this.runTime >= this.arena.survie.duree) this.finishRace();
      } else if (pos.z <= this.arena.finishZ) this.finishRace();
      // La finale franchie ouvre le podium et libere l'arene : plus rien a lire ici.
      if (!this.arena) return;
    } else if (this.mode === 'finished') {
      this.finishTimer += dt;
      // 3,2 s : le temps que le bandeau s'installe et se lise. En dessous, la manche
      // suivante demarre avant qu'on ait su ce qui venait de se passer.
      if (this.finishTimer > 3.2 && !this._ecranFin) {
        /*
         * FIN DE PARTIE : on ne rentre plus au lobby tout seul. L'écran de fin prend la
         * main et n'en sort que sur LOBBY ou REJOUER — voir `ecranDeFin`. Entre deux
         * MANCHES, en revanche, l'enchaînement automatique reste : là, le joueur n'a rien
         * à décider, il a juste besoin de trois secondes pour lire son verdict.
         */
        if (this._finDePartie) { this._finDePartie = false; this._ecranFin = true; return; }
        this.mancheSuivante();
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
    // La camera suit ce qui s'AFFICHE, pas le corps : en ligne, une correction reseau
    // deplace le corps d'un coup et laisse le visuel rattraper (`character.js`,
    // `positionVisuelle`). Suivre le corps ferait sauter la camera a chaque correction —
    // c'etait le « bug de camera » vu depuis les Canaries, le 4 septembre 2026.
    const dv = this.character?.decalageVisuel;
    if (dv && (dv.x || dv.y || dv.z)) pos = pos.clone().add(new THREE.Vector3(dv.x, dv.y, dv.z));
    /*
     * DANS LE VIDE, LA CAMERA NE BOUGE PLUS.
     *
     * Une chute hors du parcours durait une demi-seconde pendant laquelle la camera,
     * lissee, descendait moins vite que le personnage : elle finissait tres au-dessus de
     * lui, a le regarder tomber en plongee, puis sautait au point de passage. « Quand on
     * tombe dans le vide, la camera est mise en haut » (directeur produit, 4 septembre
     * 2026). Elle reste donc la ou elle etait — position et regard — des que le
     * personnage est en l'air plus de CHUTE_LIBRE sous son dernier sol, et la
     * reapparition la pose d'un coup (`snapCamera`). Un saut culmine a 2,15 m et aucune
     * marche du jeu ne descend de 3,5 m : seule une vraie chute franchit ce seuil.
     * Seulement sur une COURSE : en survie, tomber d'un etage est le jeu, et la camera
     * doit suivre a l'etage du dessous.
     */
    const CHUTE_LIBRE = 3.5;
    const perso = this.character;
    if (!this.snapCamera && !this.arena?.survie && perso && !perso.grounded
        && pos.y < perso.lastGroundY - CHUTE_LIBRE) {
      this.view.followShadow(pos);
      return;
    }
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
    // Une pose immediate repart d'une altitude lissee NEUVE : sinon la difference entre
    // l'ancienne et la nouvelle se lit comme une cote a gravir, et la camera s'envole.
    if (this.snapCamera) this.ySlow = pos.y;
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
  // Le panneau de reglages « Game feel » est un outil de banc : il n'apparait qu'avec
  // `?gui` dans l'adresse. Le directeur produit l'a vu en haut a droite du lobby et l'a
  // fait retirer (5 septembre 2026) — un joueur n'a rien a y regler.
  if (new URLSearchParams(location.search).has('gui')) buildGui(() => game?.arena?.world ?? null);
  wireSettings();
  await applyIcons();
  buildSkinsScreen(onCosmeticChange);
  // La boutique : quatre articles, un post ou des USDC ; toute la regle est dans
  // `boutique.js`, tout le dessin dans `lobbyui.js`. Le second crochet PREVISUALISE un
  // skin sur le personnage du plateau — `null` remet celui qu'on porte.
  buildBoutique(onCosmeticChange, (id) => game?.lobby?.rebuildAvatar?.(id ?? cosmetics.model));
  const ecrans = wireEcrans((nom) => {
    // La vitrine ET la boutique recadrent la camera sur le buste ; le plateau la remet en
    // vue d'accueil. La boutique montre le personnage qu'on porte pendant qu'on regarde
    // celui qu'on n'a pas — et c'est justement la comparaison qu'on veut lui donner.
    LOBBY.showcase = nom !== 'play';
    if (game?.mode === 'lobby') game.applyLobbyFraming();
  }, onCosmeticChange);
  wirePause();
  game = new Game(view, lobby);
  // Le ticket detient la mise et le mode ; PLAY entre en file — ou en sort. Il n'y a plus
  // de partie hors ligne derriere ce bouton : `jouer` est pose par `matchmaking.js`.
  buildTicket(() => { ecrans.montrer('play'); game.jouer?.(); });

  /*
   * On demande son solde au backend, SANS BLOQUER LE DEMARRAGE.
   *
   * Volontairement apres l'affichage du jeu et sans `await` : si le backend est absent,
   * lent, ou si personne n'est connecte, la caisse retombe sur le portefeuille local et le
   * jeu demarre comme avant. Un jeu qui refuse de se lancer parce que son API ne repond
   * pas est un jeu qu'on ne peut plus deboguer — et c'est ce qui ferait tomber d'un coup
   * les quarante harnais de `diag/`, qui n'ont jamais eu de backend.
   */
  buildCompte();
  // Le portefeuille : déposer, retirer, relire l'historique on-chain. Connecté seulement.
  buildPortefeuille(() => majBarre());
  /*
   * L'ARRIVÉE (5 septembre 2026) : une session ouverte, de l'argent derrière le serveur →
   * le CADEAU (une boîte, un clic, BabyVlad équipé) → sans clic, le GUIDE DE DÉPÔT.
   *
   * POUR TOUT LE MONDE, y compris les joueurs inscrits AVANT que ce parcours existe
   * (directeur produit, 5 septembre 2026) : un ancien compte qui revient voit la boîte
   * comme un nouveau, et le guide ensuite — même avec un solde, le guide le dit alors et
   * se ferme en un clic. Ce qui distingue « déjà vu » de « jamais vu » n'est pas la date
   * d'inscription, c'est la boîte ouverte dans ce navigateur. `?cadeau` force les deux,
   * pour les harnais.
   */
  buildDepot(() => majBarre());
  buildCadeau({
    peutMontrer: () => game?.mode === 'lobby',
    onEquipe: onCosmeticChange,
    onFin: () => {
      const force = new URLSearchParams(location.search).has('cadeau');
      if (force || caisse.enLigne) ouvrirDepot({ raison: 'bienvenue' });
    },
  });
  // La porte : connexion plein page, avant le lobby, dès que le serveur dit qu'il y a de
  // l'argent derrière lui et qu'aucune session n'existe (porte.js).
  buildPorte();
  // Le lobby en ligne : il trouve le serveur, s'y connecte, et pose `game.jouer`. Sans
  // `await` : un serveur absent ne doit pas empecher la page de s'afficher.
  brancherMatchmaking(game).catch((e) => console.error('matchmaking :', e));
  /*
   * Le cadeau a un second déclencheur, en plus de la porte : le backend vient de
   * reconnaître la session. Une session déjà ouverte au chargement (un joueur qui
   * revient) ne fait pas « fermer » la porte, et l'ordre entre `bienvenue` (le serveur
   * dit l'argent) et la session (le compte) n'est pas garanti ; les deux chemins
   * appellent `evaluerCadeau`, qui ne montre la boîte qu'une fois et seulement au lobby.
   */
  const apresCompte = () => { majBarre(); if (caisse.enLigne && caisse.argent) evaluerCadeau(); };
  caisse.rafraichir().then(apresCompte);
  surSession(() => caisse.rafraichir().then(apresCompte));

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
/*
 * FABRIQUE DE FIGURANTS — un personnage RIGGE de plus, hors du monde physique.
 *
 * Le jeu ne connait qu'un personnage a la fois : c'est le bon choix pour un prototype
 * solo, mais aucune capture ne peut alors montrer ce que sera une manche a seize. Cette
 * sonde rend un modele anime, sans corps ni collider, que le harnais cinema deplace
 * lui-meme. Elle n'ajoute rien au jeu : personne ne l'appelle en partie.
 */
window.__probeFigurant = (nom, hauteur = 1.6) => createRiggedCharacter(assets, hauteur, nom);
/*
 * La bibliotheque d'assets, pour charger un glTF que le jeu n'embarque pas.
 *
 * Le harnais cinema greffe des animations de DANSE sur les personnages : elles vivent
 * dans des fichiers a part, qui n'ont rien a faire dans le manifeste puisque le jeu ne
 * les joue jamais. Passer par le meme chargeur que le reste evite d'en instancier un
 * second, avec ses propres reglages de couleur et de textures.
 */
window.__probeAssets = assets;

boot().catch(fatal);
