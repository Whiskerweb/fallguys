// Sanité physique : rejoue exactement les appels Rapier utilises par le banc d'essai,
// sans three.js ni rendu. Detecte les erreurs de signature d'API avant que la page ne plante.
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -31, z: 0 });
world.timestep = 1 / 60;

// --- Sol fixe (comme Course.box sans kinematic) ---
const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
world.createCollider(RAPIER.ColliderDesc.cuboid(7, 0.5, 20).setFriction(0.6), ground);

// --- Bras rotatif (kinematic + setNextKinematicRotation) ---
const spinner = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.95, -6));
world.createCollider(RAPIER.ColliderDesc.cuboid(5.5, 0.425, 0.425).setFriction(0.6), spinner);

// --- Pendule (collider decale par rapport au corps) ---
const pendulum = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 6.2, -12));
world.createCollider(RAPIER.ColliderDesc.cuboid(1.3, 0.75, 1.3).setTranslation(0, -4.6, 0), pendulum);

// --- Rouleau (cylindre couche via setRotation) ---
const roller = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.75, -16));
const halfPi = Math.PI / 2;
world.createCollider(
  RAPIER.ColliderDesc.cylinder(4.75, 0.75)
    .setRotation({ x: 0, y: 0, z: Math.sin(halfPi / 2), w: Math.cos(halfPi / 2) })
    .setFriction(0.4),
  roller
);

// --- Personnage ---
const body = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 6, 0).setLinearDamping(0.05).setCcdEnabled(true)
);
body.setEnabledRotations(false, false, false, true);
const collider = world.createCollider(
  RAPIER.ColliderDesc.capsule(0.35, 0.45).setFriction(0.25).setRestitution(0).setDensity(1.4),
  body
);

const FOOT = 0.8;
function grounded() {
  const t = body.translation();
  const ray = new RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
  return world.castRay(ray, FOOT + 0.18, true, undefined, undefined, collider) !== null;
}

let landedAt = null;
const q = { x: 0, y: 0, z: 0, w: 1 };
for (let i = 0; i < 240; i++) {
  const t = i / 60;
  const a = t * 1.0;
  spinner.setNextKinematicRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
  const swing = Math.sin(t * 1.15) * 0.95;
  pendulum.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(swing / 2), w: Math.cos(swing / 2) });
  roller.setNextKinematicRotation({ x: Math.sin(a * 1.7), y: 0, z: 0, w: Math.cos(a * 1.7) });
  world.step();
  if (landedAt === null && grounded()) landedAt = t;
}

const p = body.translation();
const v = body.linvel();
const restY = p.y;

const checks = [
  ['la capsule a atterri', landedAt !== null, `t=${landedAt?.toFixed(2)}s`],
  ['elle ne traverse pas le sol', restY > 0.5, `y=${restY.toFixed(3)}`],
  ['elle repose au bon niveau (~0.8)', Math.abs(restY - 0.8) < 0.12, `y=${restY.toFixed(3)}`],
  ['elle est immobile a la fin', Math.abs(v.y) < 0.15, `vy=${v.y.toFixed(3)}`],
  ['detection de sol operationnelle', grounded() === true, ''],
];

let ok = true;
for (const [label, pass, info] of checks) {
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${label}${info ? '  (' + info + ')' : ''}`);
  if (!pass) ok = false;
}
console.log(ok ? '\nPHYSIQUE SAINE' : '\nPROBLEME PHYSIQUE');
process.exit(ok ? 0 : 1);
