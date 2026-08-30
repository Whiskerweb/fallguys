import * as THREE from 'three';

/**
 * Animation par CLIPS, pour les personnages livrés avec leurs propres mouvements.
 *
 * Expose exactement la même interface que `CharacterRig` — `ok`, `frozen`,
 * `update(dt, speed, maxSpeed, state, vy)` renvoyant un rebond — pour que le reste du
 * jeu n'ait pas à savoir lequel des deux anime le personnage. Le choix se fait au
 * chargement, selon que le modèle porte des clips ou non.
 *
 * ── CE QUE LES CLIPS NE COUVRENT PAS ────────────────────────────────────────────
 * Le personnage fourni n'a que trois états : une pose fixe, la marche et la course. Le
 * jeu, lui, en connaît six — il saute, il chute, il culbute, il se relève. Plutôt que
 * d'inventer des animations manquantes, on FIGE le clip de course à un instant choisi :
 * celui où les jambes sont le plus écartées donne une silhouette de saut convaincante,
 * et le personnage garde le style de ses vraies animations. Un mouvement inventé à la
 * main jurerait à côté des deux autres.
 */

/** Instants remarquables du cycle de course, en fraction de clip. */
const POSE_SAUT = 0.12;      // jambes écartées, bras haut : lit comme une détente
const POSE_CHUTE = 0.62;     // jambes groupées, corps ramassé

export class ClipRig {
  constructor(root, clips) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    this.bones = new Map();
    root.traverse((o) => { if (o.isBone) this.bones.set(o.name, o); });

    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(clip.name, { action, duree: clip.duration });
    }
    this.marche = this.actions.get('walking') ?? null;
    this.course = this.actions.get('running') ?? null;
    this.repos = this.actions.get('idle') ?? null;

    /*
     * Repli quand aucun clip de repos n'est livre.
     *
     * Meshy ne fournit pas toujours d'idle : certains personnages n'arrivent qu'avec
     * marche et course. Sans repos, le personnage immobile retombe sur sa pose de
     * liaison — bras en croix, jambes ecartees — soit exactement la T-pose qu'on cherche
     * a ne jamais montrer. On fige alors la MARCHE sur son premier appui, qui est une
     * pose debout credible, plutot que d'inventer une animation.
     */
    this.reposFige = !this.repos && !!this.marche;

    // Un clip de course est indispensable : c'est lui qui sert aussi de source aux poses
    // figées du saut et de la chute.
    this.ok = !!this.course && this.bones.size > 0;
    this.poids = new Map([...this.actions.keys()].map((k) => [k, 0]));
    this.fige = null;
    if (!this.ok) console.warn(`[cliprig] clips insuffisants (${[...this.actions.keys()].join(', ') || 'aucun'})`);
  }

  /**
   * Pousse les poids vers leur cible, sans à-coup.
   *
   * SAUF au tout premier appel, où ils sont posés d'un coup. En partant de zéro, le
   * personnage traverse pendant une demi-seconde des poses hybrides entre sa pose de
   * liaison et son animation — bras levés, corps tordu. C'est exactement l'instant où on
   * le découvre dans le lobby, et ce qu'on y voit n'est alors aucune des deux poses.
   */
  _viser(cibles, dt) {
    if (!this.demarre) {
      this.demarre = true;
      for (const [nom, { action }] of this.actions) {
        const c = cibles[nom] ?? 0;
        this.poids.set(nom, c);
        action.setEffectiveWeight(c);
      }
      return;
    }
    const w = Math.min(1, dt * 9);
    for (const [nom, { action }] of this.actions) {
      const cible = cibles[nom] ?? 0;
      const actuel = this.poids.get(nom) + (cible - this.poids.get(nom)) * w;
      this.poids.set(nom, actuel);
      action.setEffectiveWeight(actuel);
    }
  }

  update(dt, speed, maxSpeed, state, vy) {
    if (!this.ok || this.frozen) return 0;

    const auSol = state === 'grounded';
    const rapide = Math.min(1, speed / Math.max(0.5, maxSpeed));

    if (!auSol && state !== 'gettingUp') {
      /*
       * En l'air : on FIGE le clip de course sur une pose.
       *
       * Laisser le cycle tourner donnerait un personnage qui pédale dans le vide — le
       * défaut le plus visible qu'on puisse offrir, parce que les jambes bougent alors
       * que rien ne les porte. Une pose tenue se lit comme une intention.
       */
      const monte = (vy ?? 0) > 0.5;
      this._figerCourse(monte ? POSE_SAUT : POSE_CHUTE);
      this._viser({ running: 1 }, dt * 3);
      return 0;
    }

    this.fige = null;

    if (state === 'tumbling' || state === 'gettingUp') {
      // Culbute : le jeu fait déjà rouler le personnage entier. On le laisse mou, sur
      // sa pose de repos, plutôt que de le faire courir pendant qu'il roule au sol.
      this._viser(this.repos ? { idle: 1 } : { walking: 1 }, dt);
      this.mixer.update(dt * 0.4);
      return 0;
    }

    // Au sol : marche et course se mélangent selon la vitesse. Le fondu commence tôt —
    // passer brutalement de l'une à l'autre à mi-vitesse se voit immédiatement.
    const partCourse = Math.min(1, Math.max(0, (rapide - 0.25) / 0.45));
    const bouge = Math.min(1, speed / 1.2);

    // Personnage sans clip de repos : à l'arrêt, on tient la marche sur un appui.
    if (this.reposFige && bouge < 0.05) {
      this._viser({ walking: 1 }, dt);
      const { action, duree } = this.marche;
      action.time = duree * 0.02;
      this.mixer.timeScale = 0;
      this.mixer.update(0);
      return 0;
    }
    this._viser({
      idle: (1 - bouge),
      walking: bouge * (1 - partCourse),
      running: bouge * partCourse,
    }, dt);

    /*
     * La cadence suit la VITESSE RÉELLE, pas l'horloge.
     *
     * Un clip joué à sa vitesse nominale fait glisser les pieds dès que le personnage
     * va plus vite ou moins vite que l'acteur d'origine. En calant la lecture sur la
     * distance parcourue, les appuis restent posés au sol — c'est ce qui distingue une
     * course d'un personnage qui patine.
     */
    const cadence = bouge < 0.02 ? 1 : Math.max(0.35, speed / (partCourse > 0.5 ? 4.6 : 1.8));
    this.mixer.timeScale = cadence;
    this.mixer.update(dt);
    return 0;
  }

  /** Immobilise le clip de course sur une fraction précise de son cycle. */
  _figerCourse(fraction) {
    const { action, duree } = this.course;
    if (this.fige !== fraction) {
      this.fige = fraction;
      action.time = duree * fraction;
    }
    this.mixer.timeScale = 0;
    this.mixer.update(0);
  }

  /** Pose imposée de l'extérieur (vitrine, diagnostic). */
  poser(nom, fraction = 0) {
    const entree = this.actions.get(nom);
    if (!entree) return false;
    for (const [, { action }] of this.actions) action.setEffectiveWeight(0);
    entree.action.setEffectiveWeight(1);
    entree.action.time = entree.duree * fraction;
    this.mixer.timeScale = 0;
    this.mixer.update(0);
    return true;
  }

  /** Sonde de diagnostic : poids courant de chaque clip. */
  __poids() { return Object.fromEntries(this.poids); }
}
