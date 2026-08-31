import { ClipRig } from './cliprig.js';
import * as THREE from 'three';

/**
 * Animation procédurale du personnage riggé.
 *
 * Pourquoi ne pas utiliser le clip de marche fourni par Meshy : c'est une marche humaine
 * réaliste à cadence fixe. Ici il faut un mouvement cartoon exagéré, dont la cadence suit
 * la vitesse réelle du personnage et qui bascule instantanément entre course, envol, chute,
 * culbute et relevé. Piloter les os directement donne ce contrôle, ne coûte aucun fichier
 * supplémentaire, et met les réglages dans le même panneau que le reste du game feel.
 *
 * Le rig est livré en pose T : toutes les poses partent de là, en amenant d'abord les bras
 * le long du corps (REST), puis en ajoutant le mouvement.
 */

export const RIG = {
  armSwing: 1.35,     // amplitude du balancement des bras en course
  legSwing: 1.45,     // amplitude du balancement des jambes
  cadence: 1.55,      // pas par mètre parcouru
  torsoLean: 0.34,    // inclinaison du buste à pleine vitesse
  bounce: 0.15,       // rebond vertical du bassin par foulée
  armRest: 1.28,      // angle qui ramène les bras de la pose T au corps
  headBob: 0.2,
  blend: 14,          // vitesse de transition entre poses
};

const BONES = [
  'Hips', 'Spine', 'Spine01', 'Spine02', 'neck', 'Head', 'head_end',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export class CharacterRig {
  constructor(root) {
    this.bones = new Map();
    this.rest = new Map();
    root.traverse((o) => {
      if (o.isBone && BONES.includes(o.name)) {
        this.bones.set(o.name, o);
        this.rest.set(o.name, o.quaternion.clone());
      }
    });
    this.ok = this.bones.size >= 12;
    this.phase = 0;
    this.hipsBase = this.bones.get('Hips')?.position.y ?? 0;
    if (!this.ok) console.warn(`[rig] squelette incomplet (${this.bones.size} os trouves)`);
  }

  /**
   * Hauteur réelle du personnage, mesurée sur le squelette.
   * Indispensable : Box3.setFromObject() est faux sur un SkinnedMesh — il mesure la
   * géométrie en pose de liaison sans appliquer les transformations d'os, et le modèle
   * Meshy porte une échelle sur son armature. La boîte annonçait 2 cm au lieu de 1,7 m.
   */
  /**
   * Hauteur réelle du personnage.
   *
   * On mesure avec Box3.setFromObject, c'est-à-dire AVEC LE MÊME OUTIL QUE LE RENDU.
   * Les deux alternatives essayées échouent chacune sur une partie des modèles :
   *  - l'écart vertical entre os ignore le maillage, et certains rigs sont bien plus
   *    compacts que le personnage qu'ils déforment (0,30 mesuré pour 1,9 réel) ;
   *  - parcourir les sommets bruts ignore le skinning, et donne 0,017 là où le rendu
   *    affiche 2,0 — d'où des personnages mis à l'échelle cent fois trop grand.
   * Box3 est la seule mesure qui coïncide avec ce que le joueur voit.
   */
  measureHeight(root) { return this.measureBox(root)?.height ?? 0; }

  /** Position verticale du bas du modèle, dans le même repère. */
  measureFloor(root) { return this.measureBox(root)?.floor ?? 0; }

  /**
   * Boîte du modèle, calculée comme le rendu la calcule.
   *
   * Le point délicat : sur un SkinnedMesh, three.js ne tient compte du squelette que si
   * la boîte du mesh a déjà été calculée. À la construction elle ne l'est pas, et la
   * mesure porte alors sur la géométrie brute — cent fois plus petite que le personnage
   * affiché, d'où des avatars mis à l'échelle cent fois trop grand. On force donc le
   * calcul avant de mesurer.
   */
  measureBox(root) {
    root.updateWorldMatrix(true, true);
    // Sur un SkinnedMesh, le skinning s'exprime dans l'espace de LIAISON : la matrice
    // propre du mesh n'entre pas dans le calcul comme pour un mesh ordinaire. Il faut
    // donc laisser Box3.setFromObject faire le travail, apres avoir force le calcul de
    // la boite du mesh — sans quoi elle porte sur la geometrie brute, cent fois plus
    // petite que le personnage affiche.
    root.traverse((o) => { if (o.isSkinnedMesh) o.computeBoundingBox?.(); });
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return null;
    return { height: box.max.y - box.min.y, floor: box.min.y };
  }


  /** Applique une rotation locale (radians) par-dessus la pose de repos du bone. */
  set(name, x, y, z, weight = 1) {
    const bone = this.bones.get(name);
    if (!bone) return;
    const rest = this.rest.get(name);
    _q.setFromEuler(_e.set(x, y, z));
    _q.premultiply(rest);
    bone.quaternion.slerp(_q, weight);
  }

  reset() {
    for (const [name, bone] of this.bones) bone.quaternion.copy(this.rest.get(name));
  }

  /**
   * @param dt        delta temps
   * @param speed     vitesse horizontale (m/s)
   * @param maxSpeed  vitesse de course de référence
   * @param state     'grounded' | 'airborne' | 'diving' | 'tumbling' | 'gettingUp'
   * @param vy        vitesse verticale
   */
  update(dt, speed, maxSpeed, state, vy) {
    if (!this.ok) return 0;
    // Gel : permet de figer une pose imposee de l'exterieur (vitrine, diagnostic) sans
    // que la boucle d'animation ne la reecrive a la frame suivante.
    if (this.frozen) return 0;
    const R = RIG;
    const w = Math.min(1, dt * R.blend);
    const run = Math.min(1, speed / Math.max(0.5, maxSpeed));

    // La cadence suit la distance parcourue : le personnage ne moulinera jamais sur place.
    this.phase += speed * R.cadence * dt;
    const s = Math.sin(this.phase * Math.PI * 2);
    const c = Math.cos(this.phase * Math.PI * 2);

    let bounce = 0;

    if (state === 'tumbling' || state === 'diving') {
      // Membres relâchés, bras écartés : une chute doit avoir l'air subie.
      this.set('LeftArm', 0.2, 0, R.armRest * 0.35, w);
      this.set('RightArm', 0.2, 0, -R.armRest * 0.35, w);
      this.set('LeftForeArm', -0.7, 0, 0, w);
      this.set('RightForeArm', -0.7, 0, 0, w);
      this.set('LeftUpLeg', -0.55, 0, 0.12, w);
      this.set('RightUpLeg', -0.35, 0, -0.12, w);
      this.set('LeftLeg', 0.9, 0, 0, w);
      this.set('RightLeg', 0.65, 0, 0, w);
      this.set('Spine01', -0.22, 0, 0, w);
      this.set('Head', -0.3, 0, 0, w);
    } else if (state === 'airborne') {
      // En l'air : bras levés, jambes repliées si on monte, écartées si on tombe.
      const rising = vy > 0 ? 1 : 0;
      const tuck = rising ? 1 : 0.35;
      this.set('LeftArm', -0.5 * rising, 0, R.armRest * 0.55, w);
      this.set('RightArm', -0.5 * rising, 0, -R.armRest * 0.55, w);
      this.set('LeftForeArm', -0.5, 0, 0, w);
      this.set('RightForeArm', -0.5, 0, 0, w);
      this.set('LeftUpLeg', -0.6 * tuck, 0, 0.1, w);
      this.set('RightUpLeg', -0.6 * tuck, 0, -0.1, w);
      this.set('LeftLeg', 1.0 * tuck, 0, 0, w);
      this.set('RightLeg', 1.0 * tuck, 0, 0, w);
      this.set('Spine01', -0.1, 0, 0, w);
    } else if (state === 'gettingUp') {
      this.set('LeftArm', -0.2, 0, R.armRest * 0.8, w);
      this.set('RightArm', -0.2, 0, -R.armRest * 0.8, w);
      this.set('LeftUpLeg', -0.3, 0, 0.08, w);
      this.set('RightUpLeg', -0.3, 0, -0.08, w);
      this.set('LeftLeg', 0.6, 0, 0, w);
      this.set('RightLeg', 0.6, 0, 0, w);
      this.set('Spine01', 0.32, 0, 0, w);
    } else {
      // Au sol : cycle de course dont l'amplitude croît avec la vitesse. À l'arrêt il
      // reste une respiration, pour qu'un personnage immobile ne soit pas une statue.
      const idle = 1 - run;
      const breathe = Math.sin(this.phase * 1.6 + performance.now() * 0.0016) * 0.03 * idle;

      this.set('LeftArm', s * R.armSwing * run, 0, R.armRest - 0.1 * run, w);
      this.set('RightArm', -s * R.armSwing * run, 0, -R.armRest + 0.1 * run, w);
      this.set('LeftForeArm', -0.35 - 0.45 * run + s * 0.25 * run, 0, 0, w);
      this.set('RightForeArm', -0.35 - 0.45 * run - s * 0.25 * run, 0, 0, w);

      this.set('LeftUpLeg', -s * R.legSwing * run, 0, 0.06, w);
      this.set('RightUpLeg', s * R.legSwing * run, 0, -0.06, w);
      this.set('LeftLeg', Math.max(0, s) * 1.55 * run, 0, 0, w);
      this.set('RightLeg', Math.max(0, -s) * 1.55 * run, 0, 0, w);
      this.set('LeftFoot', -0.38 * run, 0, 0, w);
      this.set('RightFoot', -0.38 * run, 0, 0, w);

      this.set('Spine01', R.torsoLean * run + breathe, 0, 0, w);
      this.set('Spine02', 0.05 * run, -s * 0.16 * run, c * 0.12 * run, w);
      this.set('Head', -R.torsoLean * 0.7 * run + R.headBob * c * run * 0.3, s * 0.08 * run, 0, w);

      bounce = Math.abs(c) * R.bounce * run;
    }

    return bounce;
  }
}

/**
 * Crée un personnage riggé à la bonne échelle, pieds à l'origine.
 * Centralisé ici parce que la mise à l'échelle d'un SkinnedMesh ne peut pas passer par
 * la boîte englobante (voir measureHeight) : dupliquer cette logique, c'est garantir
 * qu'un des deux appels finira mal réglé.
 */
/**
 * Contour cartoon sur un personnage anime.
 * Un contour classique (copie agrandie par scale) ne marche pas sur un SkinnedMesh : le
 * skinning ecrase la mise a l'echelle. On decale donc les sommets le long de leur normale
 * DANS le vertex shader, avant que le squelette ne s'applique.
 * Sans lui, un skin de la meme couleur que le sol rend le personnage invisible — et le
 * joueur doit pouvoir choisir n'importe quelle couleur sans disparaitre.
 */
/**
 * Plafond de densité pour le contour.
 *
 * Le contour DUPLIQUE la géométrie : il coûte exactement autant de triangles que le
 * maillage qu'il souligne. Sur un personnage importé à 239 000 triangles, il en ajoutait
 * autant — un demi-million pour un seul avatar, davantage que la scène entière. Au-delà
 * de ce seuil on préfère un personnage sans liseré à un jeu qui rame, et on le dit.
 */
const OUTLINE_MAX_TRIS = 60000;

/**
 * Ajoute un emissif tire de la texture du modele, pour qu'il ne tombe pas au noir.
 * `force` de 0 (aucun effet) a 1 (le modele s'auto-eclaire entierement).
 */
export function eclaircirPersonnage(root, force = 0.3) {
  root.traverse((c) => {
    if (!c.isMesh || c.userData.isOutline) return;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    for (const m of mats) {
      if (!m || m.userData?.eclairci) continue;
      if (m.map) { m.emissiveMap = m.map; m.emissive = new THREE.Color(0xffffff); }
      else { m.emissive = new THREE.Color(m.color?.getHex?.() ?? 0xffffff); }
      m.emissiveIntensity = force;
      m.userData.eclairci = true;
      m.needsUpdate = true;
    }
  });
}

export function addSkinnedOutline(root, thickness = 0.022, color = 0x14203a) {
  const targets = [];
  root.traverse((c) => { if (c.isSkinnedMesh && !c.userData.isOutline) targets.push(c); });
  const total = targets.reduce((n, m) =>
    n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
  if (total > OUTLINE_MAX_TRIS) {
    console.warn(`[rig] contour ignore : ${Math.round(total)} triangles, au-dela de ${OUTLINE_MAX_TRIS}. `
      + `Passer le modele par tools/meshy-pipeline/decimate.py.`);
    return;
  }
  for (const src of targets) {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uThick = { value: thickness };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uThick;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normal * uThick;');
    };
    const outline = new THREE.SkinnedMesh(src.geometry, mat);
    outline.userData.isOutline = true;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.frustumCulled = false;
    src.parent.add(outline);
    outline.bind(src.skeleton, src.bindMatrix);
  }
}

export function createRiggedCharacter(assets, targetHeight, name = 'char-babytrump') {
  const model = assets.get(name, null, { groundAlign: false, outline: 0 });
  if (!model) return null;

  /*
   * Deux façons d'animer, choisies ici une fois pour toutes.
   *
   * Un modèle livré AVEC ses clips est joué tel quel : ses mouvements ont été conçus
   * pour lui, et une animation procédurale plaquée par-dessus les écraserait pour un
   * résultat moins bon. Les autres passent par le rig procédural, qui n'a besoin que
   * d'un squelette reconnaissable.
   *
   * Les deux exposent la même interface : le reste du jeu ignore lequel tourne.
   */
  /*
   * Attention : la PRESENCE de clips ne suffit pas.
   *
   * Tous les personnages rigges par Meshy embarquent un clip unique — une pose de
   * liaison nommee « Armature|clip0|baselayer ». Basculer sur ClipRig des qu'un clip
   * existe privait donc chaque personnage du catalogue de son animation : le lecteur
   * refusait ce clip inutilisable, et le personnage repartait sans aucun rig.
   * On exige un clip de LOCOMOTION, seul capable de porter le mouvement.
   */
  const clips = assets.clipsOf?.(name) ?? [];
  const jouables = clips.some((c) => c.name === 'running' || c.name === 'walking');
  const rig = jouables ? new ClipRig(model, clips) : new CharacterRig(model);
  if (!rig.ok) return null;

  /**
   * Mise a l'echelle par CORRECTION ITERATIVE.
   *
   * Une mesure unique ne suffit pas : sur un SkinnedMesh, la boite renvoyee avant tout
   * rendu porte sur la geometrie brute et peut etre cent fois plus petite que le
   * personnage reellement affiche. Plutot que de chercher a predire ce facteur — qui
   * varie selon la maniere dont chaque modele a ete rigge — on mesure, on corrige, on
   * remesure. Trois passes suffisent a converger a moins de 1 %.
   */
  // La mesure appartient a CharacterRig ; un ClipRig emprunte le meme outil, qui ne
  // depend que de la geometrie et pas de la facon d'animer.
  const toise = rig.measureHeight ? rig : new CharacterRig(model);
  model.scale.setScalar(1);
  for (let pass = 0; pass < 4; pass++) {
    model.updateWorldMatrix(true, true);
    const h = toise.measureHeight(model);
    if (!(h > 0.00001)) break;
    const ratio = targetHeight / h;
    if (Math.abs(ratio - 1) < 0.01) break;          // deja a la bonne taille
    model.scale.multiplyScalar(ratio);
  }
  model.updateWorldMatrix(true, true);

  /*
   * Remontee des zones sombres du PERSONNAGE, et de lui seul.
   *
   * L'eclairage du jeu est volontairement plus doux que celui d'un visualiseur : les
   * decors sont clairs et satures, ils n'en demandent pas plus. Un personnage en costume
   * bleu nuit, lui, y tombe au noir — mesure en jeu, il devenait une silhouette sans
   * detail, et carrement invisible sur une map spatiale.
   *
   * On reinjecte donc sa propre texture en emissif, a faible dose : les zones sombres
   * remontent, les claires ne bougent presque pas, et aucune couleur n'est inventee
   * puisque la lumiere ajoutee EST celle du modele.
   */
  // 0,18 et non 0,34 : a forte dose l'emissif crame les zones deja claires — les gants
  // blancs et les dents partaient en aplat sans relief. On remonte les ombres, on ne
  // repeint pas les lumieres.
  eclaircirPersonnage(model, 0.18);

  /*
   * Epaisseur du contour corrigee par l'ECHELLE du modele.
   *
   * L'extrusion se fait en espace local, avant la mise a l'echelle : un personnage
   * agrandi voyait son liserE grandir d'autant, et sur un modele texture detaille cela
   * donnait des paquets noirs autour des mains et du visage. En divisant par l'echelle,
   * le trait garde la meme epaisseur A L'ECRAN quel que soit le modele.
   */
  const echelle = model.scale.x || 1;
  addSkinnedOutline(model, 0.012 / echelle);

  // Recalage : le bas du modele vient sur y=0, mesure avec le meme outil que la hauteur.
  model.position.y -= toise.measureFloor(model);

  return { model, rig };
}

export const RIG_RANGES = {
  armSwing: [0, 2], legSwing: [0, 2], cadence: [0.4, 3], torsoLean: [0, 1],
  bounce: [0, 0.35], armRest: [0, 1.8], headBob: [0, 0.5], blend: [3, 30],
};
