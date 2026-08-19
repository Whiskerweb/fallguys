import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';
import { TUNING, TUNING_RANGES } from './tuning.js';
import { createWorld } from './world.js';
import { Course } from './course.js';
import { Character } from './character.js';

const el = (id) => document.getElementById(id);

function fatal(err) {
  console.error(err);
  const box = el('loading');
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.padding = '40px';
  box.style.textAlign = 'center';
  box.textContent = 'Erreur : ' + (err?.message ?? err);
}

// --- Entrées clavier. Les codes sont physiques : KeyW/KeyA couvrent WASD et ZQSD. ---
const keys = new Set();
const input = { x: 0, z: 0, jump: false, dive: false };
let jumpEdge = false, diveEdge = false, started = false;

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') { jumpEdge = true; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') diveEdge = true;
  if (e.code === 'KeyR') resetRun();
  if (e.code === 'KeyH') gui.show(gui._hidden);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousedown', (e) => { if (e.button === 0) diveEdge = true; });
addEventListener('blur', () => keys.clear());

function pollInput() {
  const fwd = keys.has('KeyW') || keys.has('ArrowUp');
  const back = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  input.x = (right ? 1 : 0) - (left ? 1 : 0);
  input.z = (back ? 1 : 0) - (fwd ? 1 : 0);
  input.jump = jumpEdge;
  input.dive = diveEdge;
  if (!started && (input.x || input.z || input.jump || input.dive)) started = true;
}

// --- Chrono ---
let runTime = 0, falls = 0, finished = false;
const best = { value: Number(localStorage.getItem('feel-lab-best')) || null };

function resetRun() {
  runTime = 0; falls = 0; finished = false; started = false;
  character.respawn(course.spawn);
  el('banner').classList.remove('show');
  updateHud();
}

function updateHud() {
  el('timer').textContent = runTime.toFixed(2);
  el('falls').textContent = String(falls);
  el('best').textContent = best.value ? best.value.toFixed(2) + ' s' : '—';
}

// --- Panneau de réglages : c'est ici que le feel se règle, en direct ---
let gui;
function buildGui(world) {
  gui = new GUI({ title: 'Game feel — H pour masquer' });
  const groups = {
    'Déplacement': ['maxSpeed', 'groundAccel', 'airAccel', 'groundFriction', 'turnSpeed'],
    'Saut': ['gravity', 'jumpHeight', 'coyoteTime', 'jumpBuffer', 'fallMultiplier'],
    'Plongeon': ['diveForward', 'diveUp', 'diveRecovery'],
    'Culbute': ['tumbleTrigger', 'tumbleRecovery', 'getUpDuration'],
    'Squash & stretch': ['squashOnLand', 'stretchOnJump', 'squashSpring', 'squashDamping'],
    'Caméra': ['camDistance', 'camHeight', 'camLag', 'camLookAhead', 'camFov'],
  };
  for (const [name, keysList] of Object.entries(groups)) {
    const folder = gui.addFolder(name);
    for (const k of keysList) {
      const [min, max] = TUNING_RANGES[k];
      folder.add(TUNING, k, min, max, (max - min) / 200).onChange(() => {
        if (k === 'gravity') world.gravity = { x: 0, y: -TUNING.gravity, z: 0 };
      });
    }
    if (name !== 'Déplacement' && name !== 'Saut') folder.close();
  }
  gui.add({ exporter: () => {
    const json = JSON.stringify(TUNING, null, 2);
    navigator.clipboard?.writeText(json);
    console.log('--- Constantes à transposer dans Unity ---\n' + json);
  } }, 'exporter').name('Copier les réglages');
  gui.add({ reset: resetRun }, 'reset').name('Recommencer (R)');
}

let character, course, view;

async function boot() {
  await RAPIER.init();

  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = 1 / 60;

  view = createWorld();
  course = new Course(RAPIER, world, view.scene);
  character = new Character(RAPIER, world, view.scene, course.spawn);
  buildGui(world);
  updateHud();
  el('loading').style.display = 'none';

  const clock = new THREE.Clock();
  let elapsed = 0, accumulator = 0;
  const camTarget = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const desired = new THREE.Vector3();

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    pollInput();

    course.update(elapsed);

    // Pas de temps fixe : la physique reste identique quel que soit le framerate.
    accumulator += dt;
    let steps = 0;
    while (accumulator >= world.timestep && steps < 3) {
      character.update(world.timestep, input, 0);
      world.step();
      accumulator -= world.timestep;
      steps++;
      // L'appui n'est consomme qu'une fois reellement traite par la simulation.
      if (input.jump) { input.jump = false; jumpEdge = false; }
      if (input.dive) { input.dive = false; diveEdge = false; }
    }

    const pos = character.position.clone();

    if (pos.y < course.killY) {
      falls++;
      character.respawn(course.checkpointFor(pos.z));
    }

    if (!finished && pos.z <= course.finishZ) {
      finished = true;
      el('banner-text').textContent = 'ARRIVÉE !';
      el('banner').classList.add('show');
      if (!best.value || runTime < best.value) {
        best.value = runTime;
        localStorage.setItem('feel-lab-best', String(runTime));
      }
    }

    if (started && !finished) runTime += dt;
    updateHud();

    // --- Caméra : derrière, amortie, avec anticipation sur la vélocité ---
    const v = character.body.linvel();
    desired.set(pos.x * 0.5, pos.y + TUNING.camHeight, pos.z + TUNING.camDistance);
    camTarget.lerp(desired, 1 - Math.exp(-TUNING.camLag * dt));
    view.camera.position.copy(camTarget);
    camLook.set(pos.x * 0.7 + v.x * TUNING.camLookAhead * 0.08, pos.y + 0.9, pos.z + v.z * TUNING.camLookAhead * 0.08);
    view.camera.lookAt(camLook);

    // Le FOV s'ouvre avec la vitesse : vend la sensation de course sans rien coûter.
    const speed = Math.hypot(v.x, v.z);
    const targetFov = TUNING.camFov + Math.min(9, speed * 0.85);
    view.camera.fov += (targetFov - view.camera.fov) * Math.min(1, dt * 5);
    view.camera.updateProjectionMatrix();

    view.followShadow(pos);
    view.composer.render();
  }

  camTarget.set(0, TUNING.camHeight, course.spawn.z + TUNING.camDistance);
  frame();
}

boot().catch(fatal);
