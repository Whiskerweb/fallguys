import * as THREE from 'three';
import { toonMaterial, addOutline } from '../world.js';
import { cosmetics, MODELS } from '../cosmetics.js';
import { createRiggedCharacter } from '../rig.js';

/**
 * Écran de lobby : ce n'est pas une zone jouable mais un menu.
 * Le personnage pose sur son piédestal pendant que l'UI HTML l'entoure.
 * C'est la vitrine des cosmétiques — donc le lieu où les skins de collab se vendront.
 * Aucune physique ici : une scène de présentation coûte quelques milliers de triangles.
 */

/** Reglages du lobby, exposes dans le panneau pour ajustement en direct. */
export const LOBBY = { avatarYaw: 0, avatarHeight: 2.0, cameraFov: 42, showcase: false };

/*
 * Deux cadrages NOMMES, position et cible completes.
 *
 * L'ancienne version partait d'un cadrage unique auquel on ajoutait des decalages. Chaque
 * retouche devait alors compenser les precedentes, et la vitrine avait fini par cadrer le
 * podium plutot que le personnage : celui-ci occupait le coin superieur gauche pendant que
 * le socle mangeait le bas de l'ecran. Deux points de vue independants se reglent
 * chacun pour ce qu'il doit montrer.
 */
const CAMERA_POS = new THREE.Vector3(1.1, 2.5, 5.4);
const CAMERA_LOOK = new THREE.Vector3(1.1, 1.95, 0);

// Vitrine : plus PRES et vise le buste, pas le socle. Le personnage se pose alors dans
// le tiers gauche, a hauteur de regard, au-dessus de sa fiche descriptive.
// Camera BASSE, presque a hauteur du socle. C'est l'angle qui decide de tout ici : vue
// de dessus, la plate-forme s'ouvre en large ellipse, occupe le quart de l'image et passe
// derriere le nom du personnage. Rasante, elle se referme en un trait fin — le personnage
// se lit alors comme suspendu, et la fiche reste lisible.
// Recule et vise plus haut : les personnages importes sont plus grands que le blob
// d'origine, et l'ancien cadrage leur coupait la tete — canne levee comprise.
export const SHOWCASE_POS = new THREE.Vector3(3.9, 2.6, 6.3);
export const SHOWCASE_LOOK = new THREE.Vector3(2.5, 2.25, -0.4);

export function buildLobbyScreen(assets) {
  const group = new THREE.Group();
  const animated = [];

  /* ---------- fond : MUR D'ÉCRANS d'un plateau de télévision ----------
   *
   * L'ancien fond était un dégradé traversé d'anneaux flous. Joli, mais sans identité :
   * il aurait pu appartenir à n'importe quel jeu. Or ce lobby a un sujet — seize joueurs
   * vont s'affronter devant un public pour de l'argent — et rien à l'écran ne le disait.
   *
   * Le mur est fait de VRAIES DALLES instanciées, et non d'un shader plein écran.
   * La première version calculait la grille pixel par pixel : mesuré au banc, elle
   * coûtait 1,8 seconde par image, soit dix fois toute la scène réunie. Un fond
   * décoratif ne peut pas être le poste le plus lourd du jeu. En géométrie, les cinq
   * cents dalles tiennent en un seul appel de dessin et ne coûtent plus rien par pixel.
   */
  const COLS = 30, RANGS = 16;
  const dalleW = 5.2, dalleH = 5.4, jeu = 0.55;
  const mur = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(dalleW - jeu, dalleH - jeu),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    COLS * RANGS);
  const repereMur = new THREE.Object3D();
  const cases = [];
  for (let r = 0; r < RANGS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const x = (c - (COLS - 1) / 2) * dalleW;
      const y = (r - (RANGS - 1) / 2) * dalleH;
      repereMur.position.set(x, y, 0);
      repereMur.updateMatrix();
      mur.setMatrixAt(i, repereMur.matrix);
      // La distance au centre décide de la teinte : rose au milieu, bleu sur les bords.
      const d = Math.hypot(x / (COLS * dalleW * 0.5), y / (RANGS * dalleH * 0.5));
      cases.push({ c, r, d: Math.min(1, d) });
    }
  }
  mur.instanceMatrix.needsUpdate = true;
  const fondGroupe = new THREE.Group();
  fondGroupe.add(mur);
  fondGroupe.position.set(1.1, 3, -26);
  group.add(fondGroupe);

  // Panneau noir derrière les dalles : il bouche le vide entre elles et donne au mur
  // sa masse. Sans lui, on verrait le fond de la scène par les joints.
  const fondPlein = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * dalleW + 60, RANGS * dalleH + 40),
    new THREE.MeshBasicMaterial({ color: 0x0a0620, toneMapped: false }));
  fondPlein.position.z = -0.4;
  fondGroupe.add(fondPlein);

  const chaud = new THREE.Color(0xff2d8f), froid = new THREE.Color(0x2b6bff);
  const teinteDalle = new THREE.Color();
  animated.push((t) => {
    for (let i = 0; i < cases.length; i++) {
      const { c, r, d } = cases[i];
      // Deux ondes croisées : une seule donnerait un balayage mécanique.
      const v1 = Math.sin((c + r) * 0.42 - t * 1.15);
      const v2 = Math.sin((c * 0.7 - r * 1.3) * 0.3 + t * 0.6);
      // Seuils hauts : seule une minorité de dalles brille à un instant donné. Toutes
      // allumées, la grille redevient un aplat et perd sa lisibilité.
      const allume = Math.max(
        Math.max(0, (v1 - 0.72) / 0.27),
        Math.max(0, (v2 - 0.86) / 0.14) * 0.8);
      teinteDalle.copy(chaud).lerp(froid, Math.min(1, d * 0.85));
      // Les bords s'éteignent : le regard revient au centre.
      const bord = 1 - Math.min(1, Math.max(0, (d - 0.25) / 0.8)) * 0.72;
      teinteDalle.multiplyScalar((0.045 + allume * 0.95) * bord);
      mur.setColorAt(i, teinteDalle);
    }
    if (mur.instanceColor) mur.instanceColor.needsUpdate = true;
  });

  /*
   * FAISCEAUX DE PROJECTEURS.
   *
   * Deux cônes lumineux tombent des cintres et convergent sur le personnage. C'est
   * l'élément qui transforme un fond en SCÈNE : il désigne le personnage comme le sujet
   * de l'image, là où le dégradé le laissait flotter n'importe où.
   *
   * Rendus en additif, sans écriture de profondeur : ils traversent le décor comme de
   * la lumière et ne découpent jamais de silhouette dure.
   */
  const faisceaux = [];
  for (const [sx, teinte] of [[-1, 0xff4fa3], [1, 0x36d7ff]]) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 13, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: teinte, transparent: true, opacity: 0.09,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        toneMapped: false,
      }));
    cone.position.set(1.1 + sx * 4.4, 7.6, -1.2);
    cone.rotation.z = sx * 0.3;
    cone.rotation.x = 0.12;
    group.add(cone);
    faisceaux.push({ cone, sx });
  }
  // Balayage lent et désynchronisé : deux projecteurs qui bougent à l'identique se
  // lisent comme un seul objet dupliqué.
  animated.push((t) => {
    for (const { cone, sx } of faisceaux) {
      cone.rotation.z = sx * 0.3 + Math.sin(t * 0.34 + (sx > 0 ? 1.7 : 0)) * 0.09;
      cone.material.opacity = 0.075 + Math.sin(t * 0.9 + sx) * 0.02;
    }
  });

  // ---------- piédestal ----------
  const pedestal = new THREE.Group();
  pedestal.position.set(1.1, 0, 0);
  group.add(pedestal);

  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 0.97, 0.4, 40, 1, false), toonMaterial(0xff3d8b));
  cushion.position.y = 1.06;
  cushion.castShadow = true;
  cushion.receiveShadow = true;
  addOutline(cushion, 0.022);

  const lip = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 12, 40), toonMaterial(0xd62b73));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 1.24;

  /*
   * Le socle FLOTTE : ni colonne, ni embase posée au sol.
   *
   * La version précédente empilait un pied conique sur une semelle, et l'ensemble se
   * lisait comme un objet posé par terre — un gâteau sur une table, pas une vitrine. Or
   * il n'y a pas de sol ici : le fond est un dégradé, et poser quelque chose dessus
   * invente un plancher qui n'existe pas. Un disque en lévitation, lui, ne pose aucune
   * question et concentre le regard sur le personnage.
   */
  const dessous = new THREE.Mesh(
    new THREE.CylinderGeometry(0.97, 0.6, 0.36, 40, 1, false), toonMaterial(0x9b6bd8));
  dessous.position.y = 0.68;

  // Ombre portée : une ellipse douce, seule chose qui ancre le socle dans l'espace.
  // Sans elle, un objet flottant paraît collé à l'image plutôt que présent dans la scène.
  const ombre = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 40),
    new THREE.MeshBasicMaterial({ color: 0x08040f, transparent: true, opacity: 0.45, depthWrite: false }));
  ombre.rotation.x = -Math.PI / 2;
  ombre.position.y = -0.1;
  ombre.scale.set(1, 1, 0.42);
  pedestal.add(ombre);

  // Un halo LATERAL, pas un cercle au sol : il cerne le socle par l'arriere et le
  // detache du fond, sans jamais dessiner d'anneau sous lui. Superpose a l'ombre, un
  // disque horizontal redonnait aussitot l'impression d'un plancher.
  // Halo ADDITIF : il ajoute de la lumière au lieu d'en poser une couche. Sur le fond
  // clair d'origine, un voile translucide passait inaperçu ; devant le mur d'écrans
  // sombre, il formait un grand disque gris qui masquait tout le centre de l'image.
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 44),
    new THREE.MeshBasicMaterial({
      color: 0x7f6bff, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
  halo.position.set(0, 1.0, -1.6);
  pedestal.add(halo);

  /*
   * La PLATE-FORME est un bloc a part, qu'on efface en vitrine.
   *
   * Vue de pres, elle occupe le quart de l'image et passe derriere le nom du personnage.
   * Or la vitrine sert a montrer un personnage, pas son socle : on n'y garde qu'un cercle
   * de lumiere sous ses pieds, et la fiche redevient lisible. La plate-forme reste
   * entiere sur l'ecran d'accueil, ou elle est cadree pour elle-meme.
   */
  const plateforme = new THREE.Group();
  plateforme.add(cushion, lip, dessous);
  pedestal.add(plateforme);

  // Cercle de lumiere sous les pieds : le seul appui visible en vitrine.
  // Additif, comme le halo : devant le mur d'écrans sombre, un disque translucide posé
  // par-dessus tournait à l'ovale doré opaque au lieu de se lire comme de la lumière.
  const disque = new THREE.Mesh(
    new THREE.CircleGeometry(1.05, 44),
    new THREE.MeshBasicMaterial({
      color: 0x9d7bff, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
  disque.rotation.x = -Math.PI / 2;
  disque.position.y = 1.2;
  disque.visible = false;
  pedestal.add(disque);

  /*
   * ANNEAU DE SCÈNE lumineux.
   *
   * Le socle restait un aplat rose : une forme, pas un objet éclairé. Sur un plateau, ce
   * qui donne sa matière à une scène, c'est le rebord lumineux qui la cerne — il tient
   * lieu de rampe et sépare le personnage du fond bien mieux qu'un simple contour.
   * Il pulse lentement, au rythme des projecteurs.
   */
  const rampe = new THREE.Mesh(
    new THREE.TorusGeometry(1.06, 0.055, 8, 56),
    new THREE.MeshBasicMaterial({ color: 0x8be9ff, toneMapped: false }));
  rampe.rotation.x = Math.PI / 2;
  rampe.position.y = 1.27;
  plateforme.add(rampe);

  // Douze spots encastrés dans la tranche, comme les ampoules d'un plateau de jeu.
  const spots = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.048, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8, toneMapped: false }), 12);
  const repere = new THREE.Object3D();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    repere.position.set(Math.cos(a) * 1.03, 1.06, Math.sin(a) * 1.03);
    repere.updateMatrix();
    spots.setMatrixAt(i, repere.matrix);
  }
  spots.instanceMatrix.needsUpdate = true;
  plateforme.add(spots);

  animated.push((t) => {
    const pulse = 0.55 + Math.sin(t * 1.6) * 0.45;
    rampe.material.color.setHSL(0.52, 0.9, 0.55 + pulse * 0.2);
    spots.material.color.setHSL(0.12, 0.95, 0.6 + pulse * 0.25);
  });

  // Lévitation lente du socle entier : c'est le mouvement qui vend la flottaison.
  animated.push((t) => {
    pedestal.position.y = Math.sin(t * 0.9) * 0.07;
    ombre.material.opacity = 0.3 - Math.sin(t * 0.9) * 0.05;
    ombre.scale.set(1 - Math.sin(t * 0.9) * 0.04, 1, 0.42 * (1 - Math.sin(t * 0.9) * 0.04));
  });

  // ---------- personnage exposé ----------
  const stage = new THREE.Group();
  stage.position.y = 1.26;
  pedestal.add(stage);

  let avatarRig = null;
  const riggedAvatar = (MODELS.find((m) => m.id === cosmetics.model)?.rigged !== false)
    ? createRiggedCharacter(assets, LOBBY.avatarHeight, cosmetics.model) : null;
  let avatar = riggedAvatar?.model ?? null;
  avatarRig = riggedAvatar?.rig ?? null;
  if (!avatar) avatar = assets.getFitted(cosmetics.model, { y: LOBBY.avatarHeight }, { groundAlign: true, outline: 0.025 })
    ?? assets.getFitted('player-blob', { y: LOBBY.avatarHeight }, { groundAlign: true, outline: 0.018 });
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
  // Releve AVANT l'enregistrement de l'animation : celle-ci multiplie par baseScale, et
  // s'il vaut encore undefined au premier passage le repli ramene l'echelle a 1. Avec
  // les personnages rigges, dont l'echelle avoisine 118, cela les rend invisibles.
  avatar.userData.baseScale = avatar.scale.x || 1;
  stage.add(avatar);

  // Pose d'attente : rotation lente et respiration. Un personnage figé donne un menu mort.
  // L'avant du personnage est +Z, la camera est en +Z : rotation nulle = il nous regarde.
  // LOBBY.avatarYaw rattrape une orientation native differente sur le modele genere.
  animated.push((t, dt) => {
    // Pose d'attente : le rig tourne a vitesse nulle, donc uniquement la respiration.
    // `vitrine` le dit au lecteur de clips, qui sinon figerait la marche sur un appui et
    // poserait une statue au milieu de la boutique.
    if (avatarRig) {
      avatarRig.vitrine = true;
      avatarRig.update(dt ?? 0.016, 0, 8, 'grounded', 0);
    }
    stage.rotation.y = Math.sin(t * 0.32) * 0.85 + LOBBY.avatarYaw;
    const breathe = 1 + Math.sin(t * 1.6) * 0.022;
    const base = avatar.userData.baseScale ?? avatar.scale.x ?? 1;
    avatar.scale.set((2 - breathe) * base, breathe * base, (2 - breathe) * base);
    stage.position.y = 1.26 + Math.sin(t * 1.6) * 0.035;
  });

  // ---------- éclairage de studio ----------
  // Ces lumieres S'AJOUTENT aux lumieres globales de la scene, qui ne sont jamais
  // masquees en lobby. Calibrees en consequence : a pleine puissance l'avatar recevait
  // le double de la cible et ecretait vers le blanc.
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
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

  // Plus de teinte : chaque personnage garde sa texture d'origine.
  const applySkin = () => {};

  /** Reconstruit l'avatar : changer de modele doit se voir dans la vitrine. */
  function rebuildAvatar() {
    avatar?.removeFromParent();
    const r = (MODELS.find((m) => m.id === cosmetics.model)?.rigged !== false)
      ? createRiggedCharacter(assets, LOBBY.avatarHeight, cosmetics.model) : null;
    avatar = r?.model
      ?? assets.getFitted(cosmetics.model, { y: LOBBY.avatarHeight }, { groundAlign: true, outline: 0.025 })
      ?? assets.getFitted('player-blob', { y: LOBBY.avatarHeight }, { groundAlign: true, outline: 0.018 });
    if (!avatar) return;
    avatarRig = r?.rig ?? null;
    avatar.traverse((c) => { if (c.isMesh && !c.userData.isOutline) c.castShadow = true; });
    avatar.userData.baseScale = avatar.scale.x || 1;
    stage.add(avatar);
    applySkin(cosmetics.hex);
  }

  /**
   * Bascule vitrine : cadrage décalé à gauche (le catalogue occupe la moitié droite) et
   * plate-forme escamotée au profit d'un simple cercle de lumière sous les pieds.
   */
  function setShowcase(on) {
    LOBBY.showcase = on;
    plateforme.visible = !on;
    halo.visible = !on;
    ombre.visible = !on;
    disque.visible = on;
  }

  return {
    group,
    rebuildAvatar,
    avatarHandle: () => ({ model: avatar, rig: avatarRig }),
    setShowcase,
    cameraPos: CAMERA_POS,
    cameraLook: CAMERA_LOOK,
    avatar,
    update: (elapsed, dt) => { for (const fn of animated) fn(elapsed, dt); },
    setColor: applySkin,
  };
}
