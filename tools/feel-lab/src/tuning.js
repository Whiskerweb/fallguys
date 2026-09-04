// Toutes les constantes de game feel. Ce fichier est la seule source de vérité :
// les valeurs validées ici seront transposées telles quelles dans Unity.
export const TUNING = {
  // --- Déplacement ---
  maxSpeed: 7.6,          // m/s en course
  groundAccel: 62,        // m/s^2 — nervosité au démarrage
  airAccel: 20,           // m/s^2 — contrôle en l'air (Fall Guys en donne peu)
  groundFriction: 46,     // m/s^2 — décélération quand on lâche les touches
  turnSpeed: 13,          // rad/s — vitesse d'orientation du personnage

  // --- Saut ---
  gravity: 31,            // m/s^2 — élevé : évite le flottement lunaire
  jumpHeight: 2.15,       // m
  coyoteTime: 0.12,       // s de tolérance après avoir quitté le sol
  jumpBuffer: 0.12,       // s de tolérance si on appuie trop tôt
  fallMultiplier: 1.35,   // gravité amplifiée à la descente (feel punchy)

  /*
   * FATIGUE DE SAUT — sauter en rafale coûte de la hauteur.
   *
   * Sans elle, la touche de saut n'a aucun coût : la marteler est toujours au moins aussi
   * bon que la doser, et un joueur qui saute en continu franchit tout ce qu'un joueur
   * mesuré franchit. La fatigue redonne au saut le statut de RESSOURCE — on le dépense,
   * on attend qu'il revienne.
   *
   * Elle ne touche QUE la hauteur. La portée suit d'elle-même, puisqu'un saut plus bas
   * dure moins longtemps : à 55 % de hauteur il reste 74 % de portée. C'est la seule
   * façon cohérente de faire « moins haut ET moins loin » — brider la vitesse horizontale
   * en l'air aurait donné un personnage qui freine en vol, ce qui ne se lit pas comme de
   * la fatigue mais comme un bug.
   *
   * La récupération ne court QU'AU SOL. En l'air, on ne se repose pas : sinon les trois
   * quarts de seconde de vol d'un saut plein en effaceraient les deux tiers du coût, et
   * la rafale ne coûterait plus rien — c'est-à-dire que la mécanique n'existerait pas.
   */
  jumpFatigue: 0.34,      // fatigue ajoutée par saut (1 = épuisé, soit 4 sauts d'affilée)
  /*
   * PLANCHER — la valeur la plus délicate du lot, et elle se DÉDUIT.
   *
   * Le saut épuisé doit encore franchir tout ce que les cartes DEMANDENT de franchir.
   * L'obstacle sautable le plus haut du jeu est l'arête basse du Rondin, à 1,05 m ; le
   * plus long vide à couvrir est son trou de 3,40 m. À 0,70, l'apex épuisé tombe à 1,51 m
   * et la portée à 4,33 m : 45 cm de marge sur l'un, 93 cm sur l'autre.
   *
   * Un plancher plus bas serait plus spectaculaire et faussement gratuit. À 0,55, l'apex
   * n'est plus qu'à 1,18 m — treize centimètres au-dessus de l'arête. Un joueur qui a
   * sauté trois fois se retrouverait bloqué devant un obstacle qu'il franchit d'habitude,
   * sans qu'aucune image ne lui dise pourquoi. C'est précisément le genre de panne que ce
   * projet refuse. `diag/fatigue.mjs` remesure ces deux marges à chaque exécution.
   */
  jumpFatigueFloor: 0.70, // hauteur minimale, en fraction de jumpHeight
  jumpRecovery: 1.15,     // s au sol pour effacer une fatigue pleine
  /*
   * RÉCEPTION — après un vrai atterrissage, un quart de seconde au sol avant de resauter.
   *
   * La fatigue rend la rafale de sauts plus BASSE ; elle ne l'empêche pas. Or sur Les
   * Dalles, un joueur qui enchaîne les sauts ne pèse jamais sur une dalle : il y touche
   * une seule image — celle où son saut suivant part, tamponné — et la dalle piégée
   * lâche dans son dos. Le damier entier se traversait en ligne droite, sans chercher le
   * chemin. Le directeur produit l'a vu et l'a dit (4 septembre 2026).
   *
   * Aucun réglage de la dalle ne pouvait y répondre : une dalle qui cède à l'instant du
   * contact cède APRÈS l'image où le saut est reparti. Il fallait que le saut lui-même
   * ait un temps de réception, pendant lequel le corps pèse sur ce qu'il a touché. Un
   * quart de seconde, c'est le temps pour la scène de voir l'atterrissage, de retirer le
   * collider, et pour le coyote time (0,12 s) de s'éteindre avant que le saut ne soit
   * de nouveau permis. Une réception plus courte laissait une fenêtre où le joueur
   * sautait depuis une dalle déjà tombée.
   *
   * Ne compte QUE pour un vrai atterrissage — une chute d'au moins IMPACT_MIN, dans
   * `character.js` — jamais pour les micro-sauts qu'une lèvre de planche ou un tronc qui
   * tourne produisent sous les pieds. Sinon on ne pourrait plus sauter du Rondin.
   */
  jumpLanding: 0.25,      // s au sol après un atterrissage avant de pouvoir resauter

  // --- Plongeon ---
  diveForward: 11.5,      // m/s vers l'avant
  diveUp: 4.2,            // m/s vers le haut
  diveRecovery: 0.95,     // s avant de pouvoir se relever

  // --- Culbute (quand un obstacle t'envoie valser) ---
  tumbleJolt: 5.2,        // variation de vitesse (m/s en un pas) qui envoie en vrille
  tumbleRecovery: 1.15,   // s au sol avant de se relever
  getUpDuration: 0.35,    // s d'animation de relevé

  // --- Squash & stretch ---
  squashOnLand: 0.48,     // facteur d'écrasement à l'atterrissage
  stretchOnJump: 1.38,    // facteur d'étirement au saut
  squashSpring: 230,      // raideur du retour élastique
  squashDamping: 15,      // amortissement

  // --- Caméra ---
  // Seule l'anticipation reste ici. Hauteur, recul, inclinaison, champ de vision et
  // souplesse appartiennent au JOUEUR : ils vivent dans settings.js et se reglent depuis
  // le panneau Parametres. Les garder en double faisait mentir le panneau Game feel
  // (4 curseurs sur 5 ne pilotaient rien) et exportait vers Unity des constantes de
  // camera qui n'etaient pas celles du jeu.
  camLookAhead: 1.5,
};

export const TUNING_RANGES = {
  maxSpeed: [3, 16], groundAccel: [10, 140], airAccel: [0, 60], groundFriction: [5, 120],
  turnSpeed: [2, 30], gravity: [10, 60], jumpHeight: [0.8, 5], coyoteTime: [0, 0.4],
  jumpBuffer: [0, 0.4], fallMultiplier: [1, 3],
  jumpFatigue: [0, 1], jumpFatigueFloor: [0.2, 1], jumpRecovery: [0.1, 5], jumpLanding: [0, 0.6], diveForward: [3, 25], diveUp: [0, 12],
  diveRecovery: [0.2, 3], tumbleJolt: [1.5, 14], tumbleRecovery: [0.2, 3],
  getUpDuration: [0.1, 1.2], squashOnLand: [0.3, 1], stretchOnJump: [1, 1.8],
  squashSpring: [40, 400], squashDamping: [4, 40], camLookAhead: [0, 5],
};
