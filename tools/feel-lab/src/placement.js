/**
 * OÙ CHAQUE JOUEUR APPARAÎT — le même calcul des deux côtés du fil.
 *
 * Ce fichier vit dans le jeu et le serveur l'IMPORTE, comme `moteur.js` et `economie.js`.
 * Deux copies divergeraient au premier réglage, et ce jour-là chaque joueur démarrerait
 * ailleurs que là où le serveur l'a mis : la correction le téléporterait dès le premier
 * instantané, ce qui est exactement le défaut que ce module ferme.
 *
 * ─── AUCUN TIRAGE, JAMAIS ───────────────────────────────────────────────────
 *
 * Les places sont RANGÉES, pas distribuées au sort. La spec l'impose (§ 5) : attribuer
 * une place au hasard introduirait du hasard machine dans une compétition qui doit rester
 * de pure compétence, et c'est la qualification juridique du jeu qui en dépend, pas une
 * préférence de style. Tout ici est une fonction de l'index et de l'effectif.
 *
 * Ce commentaire vivait dans `serveur/src/monde.js` ; il a suivi le calcul.
 *
 * ─── AUCUN IMPORT ───────────────────────────────────────────────────────────
 *
 * Ni `three`, ni Rapier, ni rien du DOM. C'est ce qui permet au serveur de l'appeler sans
 * navigateur, et à un test de le vérifier sans monde physique.
 */

/** Diamètre de la capsule d'un personnage — `character.js`, `RADIUS = 0.45`. */
export const DIAMETRE = 0.90;

/**
 * Écart latéral minimal, et écart visé quand la place le permet.
 *
 * Le minimum est au-dessus du diamètre, et pas de peu : deux capsules qui
 * s'interpénètrent au départ sont expulsées par le solveur, et les joueurs partent en
 * glissade avant même le décompte. Mesuré sur Le Rondin, où l'ancien calcul tombait à
 * 0,81 m pour des corps de 0,90 m.
 */
export const ECART_MIN = 1.20;
export const ECART_CIBLE = 1.80;

/** Profondeur d'un rang. Les rangs reculent vers +z, DANS LE DOS du départ. */
export const PROFONDEUR_RANG = 1.60;

/** Huit de front suffisent à seize : deux rangs, jamais trois. */
export const PAR_RANG_MAX = 8;

/** L'effectif maximal d'une manche. Une scène à emplacements explicites en fournit autant. */
export const MAX_JOUEURS = 16;

/**
 * La place de départ d'un joueur.
 *
 * ─── SEIZE PLACES, TOUJOURS, ET UNE PAR SIÈGE ───────────────────────────────
 *
 * La grille ne dépend PLUS de l'effectif : chaque carte a seize places fixes, rangées, et
 * le siège n dit laquelle est la sienne — un duel occupe les deux premières, une arène
 * les seize. Avant, la grille se recalculait sur l'effectif et se resserrait autour du
 * centre : deux joueurs se retrouvaient épaule contre épaule sur le même point, et c'est
 * ce qu'a vu le directeur produit (« ils spawnent tous au même endroit »). Des places
 * FIXES ont deux vertus : on les voit — `departvisuel.js` dessine un plot par place —, et
 * le siège 3 est au même endroit qu'on soit deux ou seize. `total` reste accepté pour ne
 * casser aucun appelant, mais ne sert plus qu'à borner l'index.
 *
 * @param {object} arene   l'arène construite par la scène — on y lit `spawn` et `depart`
 * @param {number} index   le siège, tel que le serveur l'a attribué
 * @param {number} total   l'effectif de la manche (ne change plus la grille)
 * @returns {{x:number, y:number, z:number}} un objet nu, jamais un `Vector3`
 */
export function placer(arene, index, total = MAX_JOUEURS) {
  const d = arene?.depart;
  if (!d) {
    /*
     * ON ÉCHOUE AU LIEU DE MENTIR.
     *
     * Le repli naturel serait `arene.largeur` — et c'est précisément le chiffre qui ment.
     * Il décrit la largeur de JEU : 46,8 m sur Les Hexagones, dont le départ tient sur une
     * tuile de 3,1 m. S'en servir plaçait quatorze joueurs sur seize dans le vide, sans
     * qu'aucun test ne s'en aperçoive. Une scène qui ne déclare pas son départ doit casser
     * un verdict, pas une partie.
     */
    throw new Error('placement : la scène ne déclare aucune aire de départ (`depart`)');
  }

  const n = MAX_JOUEURS;
  // Un spectateur porte l'index −1 ; on le borne ici, en un seul endroit, plutôt que chez
  // chacun des deux appelants. `total` ne borne plus rien : le siège dit la place.
  const i = Math.min(Math.max(0, index | 0), n - 1);

  // (a) LA SCÈNE DIT OÙ. Les seize socles des Hexagones, chacun sur sa parcelle.
  if (d.places) {
    const p = d.places[i % d.places.length];
    return { x: p.x, y: p.y, z: p.z };
  }

  // (b) LA SCÈNE DIT COMBIEN DE PLACE. On range la grille dedans.
  //
  // Un demi-corps de marge de chaque bord : personne ne démarre le pied dans le vide.
  const utile = Math.max(0, d.largeur - DIAMETRE);
  const colMax = Math.max(1, Math.floor(utile / ECART_MIN) + 1);
  const colonnes = Math.min(n, PAR_RANG_MAX, colMax);
  const rangees = Math.ceil(n / colonnes);

  if ((rangees - 1) * PROFONDEUR_RANG > d.profondeur) {
    throw new Error(`placement : ${rangees} rangs ne tiennent pas dans ${d.profondeur} m de profondeur`);
  }

  /*
   * Le pas est le plus petit des deux : ce qu'on VISE, et ce que la carte PERMET. Un
   * départ étroit obtient donc moins de colonnes — jamais des joueurs qui se chevauchent.
   */
  const pas = colonnes > 1 ? Math.min(ECART_CIBLE, utile / (colonnes - 1)) : 0;
  /*
   * LES PREMIERS SIÈGES AU MILIEU DU PREMIER RANG, pas au bord.
   *
   * Un duel occupe les sièges 0 et 1 : rangés de gauche à droite, les deux joueurs
   * partiraient collés au bord gauche d'une ligne de huit vide. On remplit chaque rang
   * depuis son centre, en alternant droite et gauche — 0 au milieu, 1 à sa droite, 2 à sa
   * gauche… Deux joueurs sont alors côte à côte au centre, et seize remplissent tout.
   */
  const colonne = depuisLeCentre(i % colonnes, colonnes);
  const rang = Math.floor(i / colonnes);

  return {
    x: arene.spawn.x + (colonne - (colonnes - 1) / 2) * pas,
    y: arene.spawn.y,
    z: arene.spawn.z + rang * PROFONDEUR_RANG,
  };
}

/** La colonne du k-ième arrivant d'un rang de `colonnes` places, en partant du centre. */
function depuisLeCentre(k, colonnes) {
  const milieu = (colonnes - 1) / 2;
  const pair = colonnes % 2 === 0;
  // Pour 8 colonnes : k=0 → 3, 1 → 4, 2 → 2, 3 → 5, 4 → 1, 5 → 6, 6 → 0, 7 → 7.
  const ecart = pair ? Math.floor(k / 2) + 0.5 : Math.ceil(k / 2);
  const droite = pair ? k % 2 === 1 : k % 2 === 1;
  return Math.round(milieu + (droite ? ecart : -ecart));
}

/** Les seize places d'une arène, dans l'ordre des sièges — pour les dessiner. */
export function places(arene) {
  return Array.from({ length: MAX_JOUEURS }, (_, i) => placer(arene, i, MAX_JOUEURS));
}

/**
 * La graine de culbute d'un joueur.
 *
 * Elle dérive de la graine de MANCHE et du siège. Le client doit la calculer de la même
 * façon : c'est ce qui fait que deux culbutes, l'une simulée sur le serveur et l'autre
 * prédite dans le navigateur, tombent au même endroit. Le client passait jusqu'ici quatre
 * arguments à `Character`, donc une graine nulle — les deux ne culbutaient pas pareil.
 */
export function graineCulbute(graine, index) {
  return ((graine | 0) ^ ((index + 1) * 0x9E3779B1)) >>> 0;
}
