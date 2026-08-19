import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';
import { TUNING, TUNING_RANGES } from './tuning.js';
import { createWorld, GRADE } from './world.js';
import { assets } from './assets.js';
import { loadExternalTextures } from './textures.js';
import { buildCourse } from './scenes/course.js';
import { buildLobbyScreen, LOBBY } from './scenes/lobby.js';
import { Character } from './character.js';
import { cosmetics, SKINS, MODELS } from './cosmetics.js';
import { sfx, unlockAudio, audio } from './audio.js';
import { RIG, RIG_RANGES } from './rig.js';
import { settings, ACTIONS, CAMERA_RANGES, CAMERA_LABELS, keyName } from './settings.js';
import { applyIcons, buildSkinsScreen, buildCollabsScreen, buildShopScreen, wireTabs } from './lobbyui.js';

const el = (id) => document.getElementById(id);

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
    game.character = new Character(RAPIER, game.course.world, game.view.scene, at);
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
        game.character = new Character(RAPIER, game.course.world, game.view.scene, at);
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
  constructor(view, lobby, course) {
    this.view = view;
    this.lobby = lobby;
    this.course = course;
    this.mode = 'lobby';
    this.character = null;
    this.runTime = 0;
    this.falls = 0;
    this.crowns = Number(localStorage.getItem('tumble-crowns')) || 0;
    this.best = Number(localStorage.getItem('feel-lab-best')) || null;
    this.finishTimer = 0;
    this.accumulator = 0;
    this.countdown = 0;
    this.camTarget = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.desired = new THREE.Vector3();

    view.scene.add(lobby.group);
    view.scene.add(course.group);
    el('play').addEventListener('click', () => { sfx.click(); this.startRace(); });
    this.enterLobby(false);
  }

  /** Recadre le lobby : centre, ou decale a gauche quand la vitrine est ouverte. */
  applyLobbyFraming() {
    // Decalage POSITIF : pour qu'un objet apparaisse a gauche de l'ecran, la camera
    // doit viser a sa droite. Le signe inverse le faisait sortir du champ.
    const shift = LOBBY.showcase ? 4.6 : 0;
    this.view.camera.position.set(
      this.lobby.cameraPos.x + shift, this.lobby.cameraPos.y, this.lobby.cameraPos.z);
    this.view.camera.lookAt(
      this.lobby.cameraLook.x + shift, this.lobby.cameraLook.y, this.lobby.cameraLook.z);
  }

  enterLobby(showResult) {
    this.mode = 'lobby';
    this.character?.dispose();
    this.character = null;
    this.lobby.group.visible = true;
    this.course.group.visible = false;
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

  startRace() {
    closePause();
    this.mode = 'racing';
    this.runTime = 0;
    this.falls = 0;
    this.accumulator = 0;
    camYaw = 0;
    this.lobby.group.visible = false;
    this.course.group.visible = true;
    this.view.sky.visible = true;
    this.view.clouds.visible = true;
    this.view.scene.fog = this.view.fog;
    el('lobby-ui').classList.add('hidden');
    el('wardrobe').classList.add('hidden');
    el('result-card').classList.remove('show');
    el('race-ui').classList.remove('hidden');
    this.character?.dispose();
    this.character = new Character(RAPIER, this.course.world, this.view.scene, this.course.spawn);
    const p = this.course.spawn;
    this.camTarget.set(p.x, p.y + settings.camera.height, p.z + settings.camera.distance);
    this.view.camera.fov = settings.camera.fov;
    // Depart bloque : en multijoueur, les 16 joueurs doivent partir au meme instant.
    // Le prototype respecte deja cette contrainte pour que le feel soit representatif.
    this.countdown = 3.99;
    el('countdown').classList.remove('hidden');
  }

  restart() {
    this.runTime = 0;
    this.falls = 0;
    this.countdown = 3.99;
    el('countdown').classList.remove('hidden');
    this.character.respawn(this.course.spawn);
    el('banner').classList.remove('show');
  }

  banner(text, hideAfter) {
    el('banner-text').textContent = text;
    el('banner').classList.add('show');
    clearTimeout(this._bannerTimer);
    if (hideAfter) this._bannerTimer = setTimeout(() => el('banner').classList.remove('show'), hideAfter);
  }

  finishRace() {
    this.mode = 'finished';
    this.finishTimer = 0;
    const record = !this.best || this.runTime < this.best;
    if (record) { this.best = this.runTime; localStorage.setItem('feel-lab-best', String(this.runTime)); }
    this.crowns++;
    localStorage.setItem('tumble-crowns', String(this.crowns));
    sfx.finish();
    this.banner(record ? 'RECORD !' : 'ARRIVÉE !');
    el('result-title').textContent = record ? 'NOUVEAU RECORD' : 'COURSE TERMINÉE';
    el('result-time').textContent = `${this.runTime.toFixed(2)} s`;
    el('result-line').textContent =
      `${this.falls} chute${this.falls > 1 ? 's' : ''} · record ${this.best.toFixed(2)} s · +1 👑`;
  }

  returnToLobby() {
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
    this.course.update(elapsed, paused ? 0 : dt, this.character?.position ?? null);
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

    const world = this.course.world;
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
    if (this.character.grounded) {
      for (const c of this.course.conveyors) {
        if (pos.x >= c.minX && pos.x <= c.maxX && pos.z >= c.minZ && pos.z <= c.maxZ
            && Math.abs(pos.y - c.y) < 1.6) {
          const v = this.character.body.linvel();
          this.character.body.setLinvel(
            { x: v.x + c.vx * dt * 6, y: v.y, z: v.z + c.vz * dt * 6 }, true);
          break;
        }
      }
    }

    if (pos.y < this.course.killY) {
      if (this.mode === 'racing') this.falls++;
      this.character.respawn(this.course.checkpointFor(pos.z));
    }

    if (this.mode === 'racing' && this.countdown <= 0) {
      this.runTime += dt;
      if (pos.z <= this.course.finishZ) this.finishRace();
    } else if (this.mode === 'finished') {
      this.finishTimer += dt;
      if (this.finishTimer > 3.0) this.returnToLobby();
    }

    el('timer').textContent = this.runTime.toFixed(2);
    el('falls').textContent = String(this.falls);
    el('best').textContent = this.best ? this.best.toFixed(2) + ' s' : '—';

    // Progression : sans reperage, 120 m de piste se vivent comme un couloir sans fin.
    const total = this.course.spawn.z - this.course.finishZ;
    const done = Math.max(0, Math.min(1, (this.course.spawn.z - pos.z) / total));
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
    const cam = settings.camera;
    const v = this.character.body.linvel();
    const offX = Math.sin(camYaw) * cam.distance;
    const offZ = Math.cos(camYaw) * cam.distance;
    this.desired.set(pos.x * 0.5 + offX, pos.y + cam.height, pos.z + offZ);
    this.camTarget.lerp(this.desired, 1 - Math.exp(-cam.smoothing * dt));
    this.view.camera.position.copy(this.camTarget);
    // La cible est NETTEMENT au-dessus du joueur : sinon une camera haute plonge et
    // l'horizon disparait. Or c'est le fond — montagnes, nuages — qu'on regarde en courant.
    this.camLook.set(pos.x * 0.7 + v.x * TUNING.camLookAhead * 0.08, pos.y + cam.lookHeight, pos.z + v.z * TUNING.camLookAhead * 0.08);
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
  const course = buildCourse(RAPIER, assets);
  buildGui(() => course.world);
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
  game = new Game(view, lobby, course);
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

boot().catch(fatal);
