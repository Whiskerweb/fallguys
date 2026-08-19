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

  // --- Plongeon ---
  diveForward: 11.5,      // m/s vers l'avant
  diveUp: 4.2,            // m/s vers le haut
  diveRecovery: 0.95,     // s avant de pouvoir se relever

  // --- Culbute (quand un obstacle t'envoie valser) ---
  tumbleTrigger: 1.55,    // multiple de maxSpeed au-delà duquel on part en vrille
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
  jumpBuffer: [0, 0.4], fallMultiplier: [1, 3], diveForward: [3, 25], diveUp: [0, 12],
  diveRecovery: [0.2, 3], tumbleTrigger: [1.05, 4], tumbleRecovery: [0.2, 3],
  getUpDuration: [0.1, 1.2], squashOnLand: [0.3, 1], stretchOnJump: [1, 1.8],
  squashSpring: [40, 400], squashDamping: [4, 40], camLookAhead: [0, 5],
};
