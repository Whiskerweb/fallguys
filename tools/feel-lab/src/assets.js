import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toonMaterial, addOutline } from './world.js';

/**
 * Charge les modèles générés par Meshy et les harmonise avec la direction artistique.
 * Les matériaux PBR livrés par Meshy sont convertis en toon EN CONSERVANT leur texture :
 * on garde le détail peint, on impose l'ombrage en aplats du reste du jeu.
 * Si un modèle manque (génération en cours ou échouée), on renvoie null et l'appelant
 * retombe sur sa forme procédurale — le jeu n'est jamais bloqué par un asset absent.
 */
export class AssetLibrary {
  constructor() {
    this.loader = new GLTFLoader();
    this.models = new Map();
    this.loaded = false;
  }

  async load(onProgress = () => {}) {
    // Filet de securite : ?noassets desactive les modeles generes et fait retomber
    // toute la scene sur ses formes procedurales, pour isoler un probleme d'asset.
    if (new URLSearchParams(location.search).has('noassets')) {
      console.warn('[assets] modeles Meshy desactives (?noassets)');
      this.loaded = true;
      return 0;
    }
    let names = [];
    try {
      const res = await fetch('/models/manifest.json', { cache: 'no-store' });
      if (res.ok) names = await res.json();
    } catch { /* pas de manifest : on tourne en tout procédural */ }

    let done = 0;
    await Promise.all(names.map(async (name) => {
      try {
        const gltf = await this.loader.loadAsync(`/models/${name}.glb`);
        this.models.set(name, this.prepare(gltf.scene));
      } catch (err) {
        console.warn(`[assets] ${name} illisible :`, err.message);
      } finally {
        onProgress(++done, names.length);
      }
    }));
    this.loaded = true;
    console.log(`[assets] ${this.models.size}/${names.length} modeles Meshy charges`);
    return this.models.size;
  }

  prepare(root) {
    root.traverse((child) => {
      if (!child.isMesh || child.userData.isOutline) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const src = child.material;
      const toon = toonMaterial(src.color ? src.color.getHex() : 0xffffff);
      if (src.map) { toon.map = src.map; toon.map.colorSpace = THREE.SRGBColorSpace; }
      if (src.emissive) toon.emissive = src.emissive;
      toon.side = THREE.FrontSide;
      child.material = toon;
      // Meshy livre normal + roughness/metalness que l'ombrage toon n'exploite pas :
      // les garder couterait de la VRAM pour rien (3 textures 2K par modele).
      for (const unused of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (src[unused] && src[unused] !== src.map) src[unused].dispose();
      }
      src.dispose();
    });
    return root;
  }

  has(name) { return this.models.has(name); }

  /**
   * Renvoie une copie du modèle, recentrée et mise à l'échelle pour tenir
   * dans `targetSize` (mètres, sur l'axe dominant). null si absent.
   */
  get(name, targetSize = null, { outline = 0.012, groundAlign = true } = {}) {
    const src = this.models.get(name);
    if (!src) return null;

    const model = src.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    model.position.sub(center);
    if (groundAlign) model.position.y += size.y / 2;

    const holder = new THREE.Group();
    holder.add(model);

    if (targetSize) {
      const largest = Math.max(size.x, size.y, size.z) || 1;
      holder.scale.setScalar(targetSize / largest);
    }

    if (outline) {
      // On collecte AVANT d'ajouter : addOutline insere un mesh enfant, et le traverser
      // pendant le parcours produit une recursion infinie (pile saturee au chargement).
      const meshes = [];
      model.traverse((c) => { if (c.isMesh && !c.userData.isOutline) meshes.push(c); });
      for (const m of meshes) addOutline(m, outline, 0x2a1b45);
    }
    holder.userData.nativeSize = size;
    return holder;
  }

  /** Variante calée sur une dimension précise plutôt que sur l'axe dominant. */
  getFitted(name, target = {}, opts = {}) {
    const holder = this.get(name, null, opts);
    if (!holder) return null;
    const s = holder.userData.nativeSize;
    const factors = [];
    if (target.x) factors.push(target.x / s.x);
    if (target.y) factors.push(target.y / s.y);
    if (target.z) factors.push(target.z / s.z);
    holder.scale.setScalar(factors.length ? Math.min(...factors) : 1);
    return holder;
  }
}

export const assets = new AssetLibrary();
