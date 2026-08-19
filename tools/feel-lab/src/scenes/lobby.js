import * as THREE from 'three';
import { toonMaterial, addOutline } from '../world.js';

/**
 * Écran de lobby : ce n'est pas une zone jouable mais un menu.
 * Le personnage pose sur son piédestal pendant que l'UI HTML l'entoure.
 * C'est la vitrine des cosmétiques — donc le lieu où les skins de collab se vendront.
 * Aucune physique ici : une scène de présentation coûte quelques milliers de triangles.
 */

/** Reglages du lobby, exposes dans le panneau pour ajustement en direct. */
export const LOBBY = { avatarYaw: 0, avatarHeight: 2.0, cameraFov: 42 };

const CAMERA_POS = new THREE.Vector3(1.1, 2.35, 6.6);
const CAMERA_LOOK = new THREE.Vector3(1.1, 1.75, 0);

export function buildLobbyScreen(assets) {
  const group = new THREE.Group();
  const animated = [];

  // ---------- fond : anneaux concentriques animés ----------
  const bgMat = new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      inner: { value: new THREE.Color(0xffc93c) },
      outer: { value: new THREE.Color(0xf08b1e) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time; uniform vec3 inner; uniform vec3 outer;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * vec2(1.75, 1.0);
        float d = length(p);
        float rings = sin(d * 34.0 - time * 0.55);
        float band = smoothstep(-0.12, 0.12, rings);
        vec3 col = mix(inner, outer, band * 0.42 + d * 0.55);
        col *= 1.0 - smoothstep(0.32, 0.92, d) * 0.28;   // vignette douce
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(150, 90), bgMat);
  bg.position.set(1.1, 3, -26);
  group.add(bg);
  animated.push((t) => { bgMat.uniforms.time.value = t; });

  // ---------- piédestal ----------
  const pedestal = new THREE.Group();
  pedestal.position.set(1.1, 0, 0);
  group.add(pedestal);

  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.36, 0.62, 40, 1, false), toonMaterial(0xff3d8b));
  cushion.position.y = 0.95;
  cushion.castShadow = true;
  cushion.receiveShadow = true;
  addOutline(cushion, 0.022);
  pedestal.add(cushion);

  const lip = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.16, 12, 40), toonMaterial(0xd62b73));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 1.24;
  pedestal.add(lip);

  const column = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.22, 0.75, 36), toonMaterial(0x9b6bd8));
  column.position.y = 0.3;
  column.castShadow = true;
  addOutline(column, 0.018);
  pedestal.add(column);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.62, 0.22, 36), toonMaterial(0x6d3bd6));
  base.position.y = -0.1;
  base.receiveShadow = true;
  pedestal.add(base);

  // Halo au sol : détache le piédestal du fond.
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 40),
    new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.22 })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.2;
  pedestal.add(halo);

  // ---------- personnage exposé ----------
  const stage = new THREE.Group();
  stage.position.y = 1.28;
  pedestal.add(stage);

  let avatar = assets.getFitted('player-blob', { y: 2.0 }, { groundAlign: true, outline: 0.018 });
  if (!avatar) {
    avatar = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.56, 0.9, 8, 24), toonMaterial(0xff5f7e));
    body.position.y = 1.0;
    body.castShadow = true;
    addOutline(body, 0.05);
    avatar.add(body);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      eye.position.set(sx * 0.22, 1.38, 0.48);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0x14203a }));
      pupil.position.z = 0.12;
      eye.add(pupil);
      avatar.add(eye);
    }
  }
  avatar.traverse((c) => { if (c.isMesh && !c.userData.isOutline) c.castShadow = true; });
  stage.add(avatar);

  // Pose d'attente : rotation lente et respiration. Un personnage figé donne un menu mort.
  // L'avant du personnage est +Z, la camera est en +Z : rotation nulle = il nous regarde.
  // LOBBY.avatarYaw rattrape une orientation native differente sur le modele genere.
  animated.push((t) => {
    stage.rotation.y = Math.sin(t * 0.32) * 0.85 + LOBBY.avatarYaw;
    const breathe = 1 + Math.sin(t * 1.6) * 0.022;
    avatar.scale.set(2 - breathe, breathe, 2 - breathe).multiplyScalar(avatar.userData.baseScale ?? 1);
    stage.position.y = 1.28 + Math.sin(t * 1.6) * 0.035;
  });
  avatar.userData.baseScale = avatar.scale.x || 1;

  // ---------- éclairage de studio ----------
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(4.5, 6.5, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1; key.shadow.camera.far = 24;
  key.shadow.camera.left = -6; key.shadow.camera.right = 6;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0015;
  key.target = pedestal;
  group.add(key);

  const fill = new THREE.PointLight(0x8fd8ff, 26, 22);
  fill.position.set(-4.5, 3.2, 5);
  group.add(fill);

  const rim = new THREE.PointLight(0xffd6a0, 30, 20);
  rim.position.set(1.1, 4.2, -4.5);
  group.add(rim);

  // ---------- confettis d'ambiance ----------
  const confetti = [];
  const confettiGeo = new THREE.PlaneGeometry(0.12, 0.2);
  for (let i = 0; i < 44; i++) {
    const color = [0xff3d8b, 0x31c7f0, 0xffe066, 0x9b6bd8, 0x4ade80][i % 5];
    const m = new THREE.Mesh(confettiGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(-9 + (i * 0.43) % 20, 9 * ((i * 37 % 100) / 100), -3 - ((i * 13) % 9));
    group.add(m);
    confetti.push({ m, speed: 0.55 + ((i * 17) % 60) / 100, spin: 0.7 + ((i * 7) % 40) / 30, seed: i });
  }
  animated.push((t, dt) => {
    for (const c of confetti) {
      c.m.position.y -= c.speed * dt;
      c.m.position.x += Math.sin(t * 0.8 + c.seed) * dt * 0.35;
      c.m.rotation.z += c.spin * dt;
      c.m.rotation.y += c.spin * dt * 1.5;
      if (c.m.position.y < -1.5) c.m.position.y = 9.5;
    }
  });

  return {
    group,
    cameraPos: CAMERA_POS,
    cameraLook: CAMERA_LOOK,
    avatar,
    update: (elapsed, dt) => { for (const fn of animated) fn(elapsed, dt); },
    /** Change la couleur du blob exposé — préfigure la garde-robe. */
    setColor(hex) {
      avatar.traverse((c) => {
        if (c.isMesh && !c.userData.isOutline && c.material?.color && !c.material.map) {
          c.material.color.setHex(hex);
        }
      });
    },
  };
}
