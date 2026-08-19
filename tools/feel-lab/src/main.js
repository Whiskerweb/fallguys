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
import { cosmetics, SKINS } from './cosmetics.js';
import { sfx, unlockAudio, audio } from './audio.js';
import { RIG, RIG_RANGES } from './rig.js';

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
  keys.add(e.code);
  if (e.code === 'Space') { jumpEdge = true; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') diveEdge = true;
  if (e.code === 'Enter' && game?.mode === 'lobby') game.startRace();
  if (e.code === 'Escape' && game?.mode !== 'lobby') game.returnToLobby();
  if (e.code === 'KeyR' && game?.mode === 'racing') game.restart();
  if (e.code === 'KeyH') gui.show(gui._hidden);
  if (e.code === 'KeyP') el('perf').classList.toggle('hidden');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousedown', (e) => { unlockAudio(); if (e.button === 0 && game?.mode === 'racing') diveEdge = true; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('blur', () => keys.clear());

function pollInput(dt) {
  const fwd = keys.has('KeyW') || keys.has('ArrowUp');
  const back = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  input.x = (right ? 1 : 0) - (left ? 1 : 0);
  input.z = (back ? 1 : 0) - (fwd ? 1 : 0);
  input.jump = jumpEdge;
  input.dive = diveEdge;
  if (keys.has('KeyQ')) camYaw += 1.9 * dt;
  if (keys.has('KeyE')) camYaw -= 1.9 * dt;
}

// ---------- réglages ----------
let gui;
function buildGui(getWorld) {
  gui = new GUI({ title: 'Game feel — H pour masquer' });
  const groups = {
    'Déplacement': ['maxSpeed', 'groundAccel', 'airAccel', 'groundFriction', 'turnSpeed'],
    'Saut': ['gravity', 'jumpHeight', 'coyoteTime', 'jumpBuffer', 'fallMultiplier'],
    'Plongeon': ['diveForward', 'diveUp', 'diveRecovery'],
    'Culbute': ['tumbleTrigger', 'tumbleRecovery', 'getUpDuration'],
    'Squash & stretch': ['squashOnLand', 'stretchOnJump', 'squashSpring', 'squashDamping'],
    'Caméra': ['camDistance', 'camHeight', 'camLag', 'camLookAhead', 'camFov'],
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

// ---------- garde-robe ----------
function buildWardrobe() {
  const panel = el('wardrobe');
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
  el('btn-wardrobe').addEventListener('click', () => panel.classList.toggle('hidden'));
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
    this.view.camera.lookAt(this.lobby.cameraLook);
    if (showResult) {
      el('result-card').classList.add('show');
      clearTimeout(this._resultTimer);
      this._resultTimer = setTimeout(() => el('result-card').classList.remove('show'), 4200);
    }
  }

  startRace() {
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
    this.camTarget.set(p.x, p.y + TUNING.camHeight, p.z + TUNING.camDistance);
    this.view.camera.fov = TUNING.camFov;
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

    if (this.mode === 'lobby') return;

    this.course.update(elapsed);
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

  updateCamera(dt, pos) {
    const v = this.character.body.linvel();
    const offX = Math.sin(camYaw) * TUNING.camDistance;
    const offZ = Math.cos(camYaw) * TUNING.camDistance;
    this.desired.set(pos.x * 0.5 + offX, pos.y + TUNING.camHeight, pos.z + offZ);
    this.camTarget.lerp(this.desired, 1 - Math.exp(-TUNING.camLag * dt));
    this.view.camera.position.copy(this.camTarget);
    this.camLook.set(pos.x * 0.7 + v.x * TUNING.camLookAhead * 0.08, pos.y + 0.9, pos.z + v.z * TUNING.camLookAhead * 0.08);
    this.view.camera.lookAt(this.camLook);

    const speed = Math.hypot(v.x, v.z);
    const targetFov = TUNING.camFov + Math.min(9, speed * 0.85);
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

boot().catch(fatal);
