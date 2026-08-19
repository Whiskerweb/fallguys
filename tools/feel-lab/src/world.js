import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { TUNING } from './tuning.js';

/**
 * Rampe d'ombrage. Elle démarre HAUT (0,59 et non 0,30) : dans un rendu cartoon, une
 * face à l'ombre doit rester lumineuse. Une rampe basse donne des ombres profondes qui
 * font paraître toutes les couleurs sales et éteintes — c'était la cause principale du
 * rendu terne. Les quatre paliers restent francs, donc l'aplat est conservé.
 */
export function toonGradient() {
  // Rampe COLOREE, pas en niveaux de gris. Une rampe grise desature par construction
  // tout ce qu'elle ombre — c'est ce qui salissait les teintes. Ici la face ombree vire
  // au bleu-lavande et CONSERVE sa saturation. Deux texels sur quatre a 1,0 : la pleine
  // lumiere doit couvrir la moitie de la rampe, sinon le jaune vire au moutarde.
  const data = new Uint8Array([
    198, 192, 224, 255,   // #C6C0E0 — ombre lavande, valeur 0,78
    226, 222, 242, 255,   // #E2DEF2 — penombre, 0,89
    255, 255, 255, 255,
    255, 255, 255, 255,
  ]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
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
  outline.userData.isOutline = true;
  mesh.add(outline);
  return outline;
}

function buildSky() {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x00c3eb) },
      midColor: { value: new THREE.Color(0x6fd8f5) },
      botColor: { value: new THREE.Color(0xd4f5f8) },
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

/**
 * Nuage cotonneux : amas de sphères, volumineux et opaque, pas un voile.
 * Défini ici et non dans props.js : ce module importe déjà world.js, et l'import
 * inverse créerait un cycle qui casserait l'initialisation.
 */
function puffyCloud(scale = 1, seed = 0) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const geo = new THREE.SphereGeometry(1, 12, 10);
  let a = seed * 9301 + 49297;
  const rnd = () => { a = (a * 9301 + 49297) % 233280; return a / 233280; };
  const puffs = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < puffs; i++) {
    const r = (1.6 + rnd() * 1.5) * scale;
    const puff = new THREE.Mesh(geo, mat);
    puff.position.set((i - puffs / 2) * 1.9 * scale + rnd() * scale, rnd() * 0.9 * scale, rnd() * 1.6 * scale);
    puff.scale.set(r, r * 0.74, r);
    group.add(puff);
  }
  return group;
}

function buildClouds() {
  const group = new THREE.Group();
  for (let i = 0; i < 22; i++) {
    const seed = i * 37 + 11;
    const cloud = puffyCloud(1.6 + ((seed % 7) / 7) * 1.4, seed);
    cloud.position.set(
      -140 + ((seed * 13) % 300),
      42 + ((seed * 7) % 30),
      -180 + ((seed * 23) % 320)
    );
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

/**
 * Correction colorimétrique finale. C'est elle qui donne le « plastique neuf » du genre :
 * saturation poussée, noirs relevés (rien n'est jamais vraiment noir), et une pointe de
 * chaleur. Réglable en direct dans le panneau — c'est un jugement d'œil, pas de calcul.
 */
export const GRADE = { saturation: 1.14, brightness: 1.0, lift: 0.02, contrast: 1.0, warmth: 0.0 };

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: GRADE.saturation }, uBright: { value: GRADE.brightness },
    uLift: { value: GRADE.lift }, uContrast: { value: GRADE.contrast }, uWarm: { value: GRADE.warmth },
  },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSat; uniform float uBright; uniform float uLift; uniform float uContrast; uniform float uWarm;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      c = (c - 0.5) * uContrast + 0.5;                 // contraste autour du gris moyen
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));  // luminance perçue
      c = mix(vec3(l), c, uSat);                       // saturation
      c = c * (1.0 - uLift) + uLift;                   // noirs relevés : plus de trous noirs
      c *= uBright;
      c.r += uWarm; c.b -= uWarm * 0.6;                // légère chaleur
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }`,
};

export function createWorld() {
  // ?lowfx desactive bloom et ombres. Indispensable pour l'inspection automatisee :
  // le navigateur headless rend sans GPU, et les passes plein ecran y coutent
  // cent fois leur prix reel. Ne change rien au jeu tel que le joueur le voit.
  const lowFx = new URLSearchParams(location.search).has('lowfx');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !lowFx;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // ACESFilmic desature et lave les aplats : un rendu cartoon veut des couleurs franches.
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd4f5f8, 120, 380);
  const sky = buildSky();
  const clouds = buildClouds();
  scene.add(sky);
  scene.add(clouds);

  const camera = new THREE.PerspectiveCamera(TUNING.camFov, innerWidth / innerHeight, 0.1, 600);
  camera.position.set(0, 8, 14);

  // INTENSITES CALIBREES SUR MESURE DE PIXELS. Depuis three.js r155 l'eclairage est
  // physiquement correct : le BRDF lambertien divise l'irradiance par PI. Une somme
  // d'intensites de 1,2 ne rendait donc que ~38 % de la couleur — le sol turquoise
  // #2DD9D9 sortait a #0F898A. La somme doit approcher PI (~3,14) pour rendre la
  // couleur pleine sur une face eclairee.
  scene.add(new THREE.AmbientLight(0xbfe9ff, 0.90));
  scene.add(new THREE.HemisphereLight(0x9fe4ff, 0xffe8b0, 0.70));

  // Somme des intensites volontairement sous 1.15 : l'ombrage toon ne compresse pas les
// hautes lumieres, et au-dela toute teinte claire ecrete vers le blanc. Le personnage
// violet apparaissait entierement blanc a 1.7.
  const sun = new THREE.DirectionalLight(0xfff6e0, 1.60);
  sun.position.set(26, 42, 18);
  sun.castShadow = !lowFx;
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
  if (!lowFx) {
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.26, 0.7, 0.9));
  }
  // ORDRE CRITIQUE : OutputPass convertit d'abord en sRGB, la correction vient ensuite.
  // Corriger avant la conversion revient a travailler sur des valeurs lineaires, ou 0,5
  // correspond a un gris deja tres clair — le contraste y ecrase tous les tons moyens.
  composer.addPass(new OutputPass());
  const gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  /**
   * Le decor bouge en permanence. Un decor fige lit "diorama", pas "monde", quel que
   * soit le soin apporte aux materiaux. C'est le meilleur rapport lignes/impact du lot.
   */
  function animateSky(elapsed, dt) {
    clouds.position.x += 0.35 * dt;
    if (clouds.position.x > 120) clouds.position.x = -120;
    clouds.position.y = Math.sin(elapsed * 0.3) * 0.6;
  }

  /** La shadow camera suit le joueur : sans ça, les ombres se dégradent sur une piste longue. */
  function followShadow(target) {
    sun.position.set(target.x + 26, target.y + 42, target.z + 18);
    sun.target.position.copy(target);
    sun.target.updateMatrixWorld();
  }

  /** Répercute les réglages du panneau sur l'étage de correction. */
  function applyGrade() {
    const u = gradePass.uniforms;
    u.uSat.value = GRADE.saturation;
    u.uBright.value = GRADE.brightness;
    u.uLift.value = GRADE.lift;
    u.uContrast.value = GRADE.contrast;
    u.uWarm.value = GRADE.warmth;
  }

  return { renderer, scene, camera, composer, followShadow, animateSky, sky, clouds, fog: scene.fog, applyGrade };
}
