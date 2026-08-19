import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { TUNING } from './tuning.js';

/** Rampe de 4 niveaux : donne l'aplat franc du toon shading plutôt qu'un dégradé lisse. */
export function toonGradient() {
  const data = new Uint8Array([90, 150, 215, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const GRADIENT = toonGradient();

export function toonMaterial(color, { emissive = 0x000000 } = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT, emissive });
}

/** Contour cartoon : une copie du mesh rendue à l'envers, légèrement grossie. */
export function addOutline(mesh, thickness = 0.055, color = 0x1a2b45) {
  const outline = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color, side: THREE.BackSide })
  );
  outline.scale.multiplyScalar(1 + thickness);
  outline.castShadow = false;
  outline.receiveShadow = false;
  mesh.add(outline);
  return outline;
}

function buildSky() {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3aa6ef) },
      midColor: { value: new THREE.Color(0x9fe0ff) },
      botColor: { value: new THREE.Color(0xffe9b8) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 c = mix(botColor, midColor, smoothstep(-0.25, 0.18, h));
        c = mix(c, topColor, smoothstep(0.15, 0.75, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

/** Nuages en boules aplaties : lisibles, cohérents avec la DA cartoon, quasi gratuits. */
function buildClouds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const rand = mulberry32(1337);
  for (let i = 0; i < 26; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const r = 2.4 + rand() * 2.6;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
      puff.position.set((p - puffs / 2) * 3.1 + rand() * 1.4, rand() * 1.1, rand() * 1.8);
      puff.scale.y = 0.62;
      cloud.add(puff);
    }
    cloud.position.set(-90 + rand() * 300, 34 + rand() * 26, -130 + rand() * 260);
    group.add(cloud);
  }
  return group;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbfe8ff, 90, 260);
  const sky = buildSky();
  const clouds = buildClouds();
  scene.add(sky);
  scene.add(clouds);

  const camera = new THREE.PerspectiveCamera(TUNING.camFov, innerWidth / innerHeight, 0.1, 600);
  camera.position.set(0, 8, 14);

  scene.add(new THREE.HemisphereLight(0xcfefff, 0xe8b98a, 1.05));

  const sun = new THREE.DirectionalLight(0xfff3d6, 2.35);
  sun.position.set(26, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 150;
  const s = 46;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.75, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  /** La shadow camera suit le joueur : sans ça, les ombres se dégradent sur une piste longue. */
  function followShadow(target) {
    sun.position.set(target.x + 26, target.y + 42, target.z + 18);
    sun.target.position.copy(target);
    sun.target.updateMatrixWorld();
  }

  return { renderer, scene, camera, composer, followShadow, sky, clouds, fog: scene.fog };
}
