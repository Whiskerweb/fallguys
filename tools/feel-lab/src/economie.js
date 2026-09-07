/**
 * Économie d'une partie : modes, mise, roue, pot, gains par rang, progression.
 *
 * Le portefeuille, lui, vit dans `caisse.js` — voir plus bas pourquoi.
 *
 * PORT FIDÈLE de `src/Fallguys.Rules` (C#). Les mêmes chiffres doivent sortir des deux
 * côtés : le lobby annonce au joueur ce que le serveur de règlement paiera réellement, et
 * un écart entre les deux serait un mensonge affiché à l'écran dans un jeu où l'on mise
 * de l'argent. `diag/economie.mjs` vérifie la table ligne à ligne.
 *
 * DEUX CHEMINS DE CALCUL, ET ILS NE SERVENT PAS À LA MÊME CHOSE :
 *
 *   `table(mise, mode, issue)`     — les trois modes ouverts au public. Dix issues posées
 *                                    à la main, UNE tirée par la roue à la fin de la partie.
 *   `tableEffectif(mise, joueurs)` — les salons réduits, un lobby qui part à effectif
 *                                    incomplet. La forme est calculée depuis l'effectif.
 *
 * Le second est l'ancienne `table()` sous son vrai nom. Les deux doivent boucler : le pot
 * vaut toujours le distribué plus le rake.
 *
 * Comme `Money.cs`, tout est en MICRO-UNITÉS ENTIÈRES — jamais de flottant. 0,1 + 0,2 ne
 * fait pas 0,3 en binaire, et un centième d'USDG perdu par arrondi à chaque partie est un
 * bug comptable qu'on ne retrouve plus six mois plus tard.
 */

export const MICROS = 1_000_000;

/** Les trois tables ouvertes, en USDG. Doublé à l'identique dans `MatchMode.StakeTiers`. */
export const PALIERS = [2, 5, 10];

// ---------------------------------------------------------------- les modes

/**
 * Les trois formes de partie ouvertes au public — port de `MatchMode.cs`.
 *
 * UN MODE EST DÉCLARÉ, JAMAIS DÉRIVÉ D'UN EFFECTIF. C'est toute la différence avec
 * `configPour()` plus bas, qui calcule une pyramide pour un salon de seize qui part à
 * douze. Les deux coexistent :
 *
 *   • un MODE — le joueur l'a choisi dans le lobby, sa forme est posée à la main ici ;
 *   • un SALON RÉDUIT — personne ne l'a choisi, sa forme est calculée par moitiés.
 *
 * Les mélanger coûterait cher : l'échelle de 3 à 24 joueurs de `configPour` est comparée
 * rang par rang, à chaque exécution des tests, contre `backend/src/gains.js` et le noyau
 * C#. Y faire entrer trois formes choisies à la main déplacerait 66 tables verrouillées.
 *
 * Le duel et le squad sont la réponse au démarrage à froid (risque n°1 du spec) : remplir
 * seize places demande seize personnes vivantes prêtes à miser le même montant au même
 * instant. Deux, on les trouve.
 */
export const MODES = {
  /**
   * Le duel. Une manche, un vainqueur, ×1,8 — le reste est le rake.
   *
   * Le seul survivant de la manche 1 récupère sa mise puis prend tout le bonus : la règle
   * fondatrice y dégénère correctement, et rien n'a été ajouté pour le payer.
   *
   * C'est aussi le mode le plus propre juridiquement : une seule place payée, donc rien à
   * faire tourner sur la roue, donc un barème entièrement fixe et affiché d'avance.
   */
  duel: {
    id: 'duel', nom: '1v1', joueurs: 2,
    survivants: [1], rakeBp: 1000, poidsFinalistes: [1],
  },
  /** Quatre joueurs, deux manches, deux places payées. Assez court pour enchaîner. */
  squad: {
    id: 'squad', nom: 'SQUAD 4', joueurs: 4,
    survivants: [2, 1], rakeBp: 1000, poidsFinalistes: [40, 15, 7, 2],
  },
  /**
   * Le format de référence du spec : seize joueurs, trois manches, huit remboursés.
   *
   * Les poids valent [40, 15, 7, 2] et non [35, 15, 5, 1] : ces derniers tombaient sur des
   * chiffres ronds A 15 % DE RAKE. A 10 %, la meme formule paie 2,714285 au deuxieme — un
   * montant qu'on ne peut ni afficher ni defendre dans un jeu ou l'on engage de l'argent.
   * Le rake et les poids forment un couple ; reviser l'un sans l'autre donne des gains
   * justes au centieme et illisibles a l'ecran.
   */
  arena: {
    id: 'arena', nom: 'ARENA 16', joueurs: 16,
    survivants: [8, 4, 1], rakeBp: 1000, poidsFinalistes: [40, 15, 7, 2],
  },
};

/** L'ordre du sélecteur du lobby : du plus court au plus long. Il est affiché tel quel. */
export const ORDRE_MODES = ['duel', 'squad', 'arena'];

/** Retrouve un mode par son identifiant, et refuse clairement l'inconnu. */
export function mode(id) {
  const m = MODES[id];
  if (!m) throw new Error(`mode inconnu « ${id} » — attendu : ${ORDRE_MODES.join(', ')}`);
  return m;
}

/**
 * La configuration de référence, pour tout ce qui n'a pas encore de mode à la main.
 * C'est `MODES.arena` LUI-MÊME, pas une copie : un réglage ne peut pas s'appliquer à l'un
 * sans l'autre.
 */
export const CONFIG = MODES.arena;

/** Rang au-delà duquel le joueur ne récupère plus sa mise (`RefundThreshold`). */
export const SEUIL_REMBOURSEMENT = CONFIG.survivants[0];
/** Nombre de joueurs qui entrent dans la dernière manche (`FinalistCount`). */
export const NB_FINALISTES = CONFIG.survivants[CONFIG.survivants.length - 2];

// ------------------------------------------------------------------ la roue

/**
 * LA ROUE TIRE, APRÈS LA PARTIE — décision du directeur produit, 2 septembre 2026.
 *
 * Elle tirait avant, dans le lobby, et c'était une position juridique (spec § 5 : aucune
 * machine ne décide de l'issue une fois la mise engagée). Le directeur produit a été
 * prévenu, a écarté la variante « tirée avant, scellée, révélée après », et a choisi le
 * tirage après. C'est SA décision, consignée dans l'amendement du 2 septembre de la spec ;
 * aucun code d'ici ne la tranche, et la validation juridique reste en tête de la liste
 * d'avant-mainnet.
 *
 * ─── UN TABLEAU À DIX LIGNES, ET C'EST TOUT LE MÉCANISME ─────────────────────
 *
 * Chaque mode a dix ISSUES. Une issue donne, rang par rang, le gain en VINGTIÈMES DE LA
 * MISE. La roue d'un joueur, c'est la COLONNE de son rang : dix cases, une par issue, de
 * tailles proportionnelles aux poids. À la fin de la partie le serveur tire UNE ligne pour
 * tout le monde ; chaque joueur voit sa roue s'arrêter sur la case de cette ligne.
 *
 * ─── LE RAKE VARIE D'UNE LIGNE À L'AUTRE, ET VAUT 10 % EN MOYENNE ────────────
 *
 * Une ligne distribue entre 70 % et 100 % du pot — jamais plus : la maison ne sort jamais
 * un centime. Ce qu'elle garde sur une ligne est le rake de CETTE partie, de 0 % (JACKPOT
 * en duel, tout le pot au vainqueur) à 17,5 % (FLAT en duel). Pondérées par leurs poids,
 * les dix lignes distribuent EXACTEMENT 90 % du pot : le rake vaut 10 % en moyenne, au
 * micro près, et `verifierRoue` l'exige.
 *
 * Pourquoi pas 10 % à chaque partie, comme avant : à 2 USDG en duel, le pot fait 4,00 et
 * 90 % en laissent 3,60 ; en dixièmes de mise il n'existe que sept valeurs entre 2,40 et
 * 3,60, et le directeur produit a vu trois fois « 3.60 » sur la roue. Il veut de petites
 * variations et des cases au-dessus de la moyenne (4,00). Les deux exigent que la part de
 * la maison bouge avec la ligne. C'est un choix produit du 2 septembre 2026.
 *
 * POURQUOI DES VINGTIÈMES : des pas de 0,10 USDG à 2 USDG, assez fins pour dix cases
 * distinctes. Toute mise du catalogue est divisible par vingt en micro-unités ; une mise
 * qui ne le serait pas laisse son reste de division à la maison, jamais l'inverse.
 *
 * ─── LES PALIERS ────────────────────────────────────────────────────────────
 *
 * Diamant pour le 1er, or pour le podium, argent pour la bande remboursée, bronze pour
 * ceux qui ont perdu leur mise. Un bronze gagne de l'XP — et, sur une case, sa mise.
 *
 * L'ORDRE DES ISSUES EST PORTANT : le tirage parcourt les poids cumulés dans cet ordre.
 * Réordonner une liste change la ligne que rend chaque graine — donc ce que des parties
 * déjà réglées auraient payé.
 */

/** Étale une issue d'arène : les huit payés, puis zéro partout, puis la mise rendue à `rembourse`. */
const etaler = (joueurs, payes, rembourse = null, montant = 20) => {
  const d = Array.from({ length: joueurs }, (_, i) => (i < payes.length ? payes[i] : 0));
  if (rembourse) d[rembourse - 1] = montant;
  return d;
};

/** L'XP des rangs qui ne touchent rien : zéro là où il y a de l'argent, la valeur ailleurs. */
const xpDe = (vingtiemes, seuil, valeurs) => vingtiemes.map((d, i) => (
  i < seuil || d > 0 ? 0 : (valeurs[i - seuil] ?? 0)
));

const issue = (id, nom, poids, vingtiemes, seuil, xp) => ({ id, nom, poids, vingtiemes, xp: xpDe(vingtiemes, seuil, xp) });

export const ISSUES = {
  /**
   * Le duel. Dix montants distincts pour le vainqueur, de ×1,3 à ×2,0 — à 2 USDG, de 2,60
   * à 4,00, la case 4,00 étant le pot entier. Le perdant récupère un peu de sa mise sur les
   * trois lignes basses (0,70 à 0,80 USDG à 2 USDG), de l'XP sur les autres.
   */
  duel: [
    issue('plat',      'FLAT',     600, [26, 7], 1, [0]),
    issue('doux',      'SOFT',     900, [28, 8], 1, [0]),
    issue('partage',   'SHARE',   1200, [30, 8], 1, [0]),
    issue('equilibre', 'BALANCE', 1400, [35, 0], 1, [40]),
    issue('standard',  'STANDARD',2200, [36, 0], 1, [20]),
    issue('podium',    'PODIUM',  1400, [37, 0], 1, [30]),
    issue('pointu',    'SHARP',   1000, [32, 0], 1, [25]),
    issue('couronne',  'CROWN',    700, [38, 0], 1, [60]),
    issue('royale',    'ROYAL',    400, [39, 0], 1, [80]),
    issue('jackpot',   'JACKPOT',  200, [40, 0], 1, [150]),
  ],
  /**
   * Quatre joueurs, deux places payées, dix montants distincts pour chacune. Le vainqueur
   * va de ×1,5 à ×3,0 — JACKPOT lui donne les trois quarts du pot, le deuxième garde sa
   * mise. Deux lignes rendent leur mise à un bronze (13 vingtièmes : 0,65 à 1 USDG de mise).
   */
  squad: [
    issue('plat',      'FLAT',     600, [30, 24, 0, 13], 2, [40, 30]),
    issue('doux',      'SOFT',     900, [33, 21, 13, 0], 2, [50, 45]),
    issue('partage',   'SHARE',   1200, [37, 33, 0, 0],  2, [30, 25]),
    issue('equilibre', 'BALANCE', 1400, [41, 31, 0, 0],  2, [60, 50]),
    issue('standard',  'STANDARD',2200, [50, 22, 0, 0],  2, [25, 20]),
    issue('podium',    'PODIUM',  1400, [45, 27, 0, 0],  2, [45, 35]),
    issue('pointu',    'SHARP',   1000, [48, 26, 0, 0],  2, [35, 25]),
    issue('couronne',  'CROWN',    700, [52, 25, 0, 0],  2, [80, 60]),
    issue('royale',    'ROYAL',    400, [56, 23, 0, 0],  2, [100, 70]),
    issue('jackpot',   'JACKPOT',  200, [60, 20, 0, 0],  2, [150, 100]),
  ],
  /**
   * L'arène : 320 vingtièmes de pot, 288 en moyenne. STANDARD reste, au centime près, la
   * table historique du dépôt (×5,0 / ×2,5 / ×1,7 / ×1,2, la mise rendue jusqu'au 8e), et
   * tombe plus d'une fois sur cinq. Les quatre premiers ont dix montants distincts ; la
   * bande 5-8 varie entre ×1,0 et ×1,3. Huit lignes sur dix rendent sa mise à UN bronze,
   * du 9e (14 %) au 16e (4 %) — le plus proche de la bande payée a la meilleure chance.
   * JACKPOT paie ×7,9 au vainqueur : au-delà de l'ancien plafond de ×7,4, parce que la
   * maison ne garde que 6 % sur cette ligne.
   */
  arena: [
    issue('plat',      'FLAT',     600, etaler(16, [50, 44, 38, 30, 26, 24, 23, 21], 15),   8, [60, 55, 50, 45, 40, 35, 30, 25]),
    issue('doux',      'SOFT',     900, etaler(16, [62, 45, 35, 27, 25, 23, 22, 21], 13),   8, [80, 70, 60, 50, 45, 40, 35, 30]),
    issue('partage',   'SHARE',   1200, etaler(16, [70, 51, 31, 26, 23, 22, 21, 20], 11),   8, [50, 45, 40, 35, 30, 25, 20, 15]),
    issue('equilibre', 'BALANCE', 1400, etaler(16, [82, 47, 29, 25, 22, 21, 20, 20], 10),   8, [100, 90, 80, 70, 60, 50, 40, 30]),
    issue('standard',  'STANDARD',2200, etaler(16, [100, 50, 34, 24, 20, 20, 20, 20]),      8, [40, 35, 30, 25, 20, 20, 15, 15]),
    issue('podium',    'PODIUM',  1400, etaler(16, [102, 39, 26, 23, 20, 20, 20, 20], 9),   8, [70, 60, 50, 45, 40, 35, 30, 25]),
    issue('pointu',    'SHARP',   1000, etaler(16, [116, 33, 24, 21, 20, 20, 20, 20], 12),  8, [45, 40, 35, 30, 25, 20, 20, 15]),
    issue('couronne',  'CROWN',    700, etaler(16, [125, 28, 23, 20, 20, 20, 20, 20], 14),  8, [120, 100, 80, 70, 60, 50, 40, 30]),
    issue('royale',    'ROYAL',    400, etaler(16, [131, 26, 22, 22, 20, 20, 20, 20], 16),  8, [90, 80, 70, 60, 50, 40, 30, 20]),
    issue('jackpot',   'JACKPOT',  200, etaler(16, [158, 22, 20, 20, 20, 20, 20, 20]),      8, [150, 130, 110, 90, 70, 50, 30, 20]),
  ],
};

/** Dix cases par roue : ce chiffre est une promesse produit, `verifierRoue` l'exige. */
export const CASES_PAR_ROUE = 10;

/** Une mise se découpe en vingtièmes : un gain s'écrit `mise × vingtièmes / 20`. */
export const VINGTIEMES = 20;

/**
 * Ancien nom du catalogue, gardé pour le ticket du lobby, qui est écrit par une autre
 * main. Même objet : rien à faire diverger.
 */
export const VARIANTES = ISSUES;

/** Retrouve une issue par son identifiant, et refuse l'inconnue. */
export function issueDe(modeId, id) {
  const v = ISSUES[mode(modeId).id].find((x) => x.id === id);
  if (!v) throw new Error(`issue inconnue « ${id} » pour le mode « ${modeId} ».`);
  return v;
}

/**
 * Le PALIER d'un rang : diamant, or, argent ou bronze. C'est la hiérarchie, elle ne bouge
 * pas d'une issue à l'autre ; les montants, eux, bougent.
 *
 * Arène : ◆ 1 · ★ 2-4 · ● 5-8 · ○ 9-16. Squad : ◆ 1 · ★ 2 · ○ 3-4. Duel : ◆ 1 · ○ 2.
 * La règle est la même partout : le premier ; puis la moitié haute de la bande payée ;
 * puis le reste de la bande payée ; puis ceux qui ont perdu leur mise.
 */
export function grade(modeId, rang) {
  const seuil = mode(modeId).survivants[0];
  if (rang === 1) return 'diamant';
  if (rang > seuil) return 'bronze';
  return rang <= Math.max(2, seuil / 2) ? 'or' : 'argent';
}

/**
 * Mélangeur d'entier 32 bits (finaliseur « lowbias32 ») — port de `PrizeWheel.Hash32`.
 *
 * Sans état, cinq opérations, et le même entier en C#, ici et dans `gains.js`. La même
 * graine DOIT donner la même issue dans les trois implémentations, sinon l'écran de fin
 * annonce un montant que le service de règlement ne paiera pas.
 *
 * `Math.imul` et non `*` : au-delà de 2^53 la multiplication flottante de JavaScript perd
 * les bits de poids faible, qui sont précisément ceux qu'on mélange.
 */
export function hachage32(graine) {
  let x = graine >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}

/**
 * L'issue d'une partie, tirée de sa graine de roue.
 *
 * La graine vient du SERVEUR, tirée au hasard cryptographique au classement final, et
 * voyage dans `fin-partie` puis jusqu'au grand livre. Déterministe à partir de là :
 * connaissant la graine, n'importe qui refait ce calcul et vérifie ce qui a été payé.
 */
export function tirerIssue(modeId, graine) {
  const catalogue = ISSUES[mode(modeId).id];
  const tirage = hachage32(graine) % 10_000;
  let cumul = 0;
  for (const v of catalogue) {
    cumul += v.poids;
    if (tirage < cumul) return v;
  }
  return catalogue[catalogue.length - 1]; // inatteignable : les poids font 10 000.
}

/**
 * Vérifie qu'un catalogue est payable. Appelée par les tests des trois implémentations —
 * ce n'est pas une précaution décorative : une ligne qui dépasserait le pot d'un seul
 * vingtième ferait sortir de l'argent de la caisse, et une moyenne qui dériverait d'un
 * vingtième changerait le rake sans que personne l'ait décidé.
 */
export function verifierRoue(modeId) {
  const m = mode(modeId);
  const seuil = m.survivants[0];
  const pot = VINGTIEMES * m.joueurs;             // 100 % du pot, en vingtièmes de mise
  const catalogue = ISSUES[m.id];
  if (catalogue.length !== CASES_PAR_ROUE) {
    throw new Error(`« ${m.id} » a ${catalogue.length} issues : une roue en a ${CASES_PAR_ROUE}.`);
  }
  let poids = 0;
  let pondere = 0;
  for (const v of catalogue) {
    if (v.vingtiemes.length !== m.joueurs || v.xp.length !== m.joueurs) {
      throw new Error(`« ${v.id} » donne ${v.vingtiemes.length} rangs pour ${m.joueurs} joueurs.`);
    }
    const somme = v.vingtiemes.reduce((s, d) => s + d, 0);
    // Jamais plus que le pot : la maison ne sort jamais un centime. Jamais moins de 70 % :
    // une ligne qui garderait davantage ne serait plus un rake, ce serait une confiscation.
    if (somme > pot) throw new Error(`« ${v.id} » distribue ${somme} vingtièmes pour un pot de ${pot} : la maison paierait.`);
    if (somme * 10 < pot * 7) throw new Error(`« ${v.id} » ne distribue que ${somme} vingtièmes sur ${pot} : sous 70 % du pot.`);
    if (v.vingtiemes.some((d) => d < 0)) throw new Error(`« ${v.id} » porte un gain négatif.`);
    // La règle fondatrice : qui survit à la manche 1 récupère au moins sa mise.
    for (let rang = 1; rang <= seuil; rang++) {
      if (v.vingtiemes[rang - 1] < VINGTIEMES) {
        throw new Error(`« ${v.id} » paie le rang ${rang} sous sa mise alors qu'il a passé la manche 1.`);
      }
    }
    // Une pyramide dans la bande payée, jamais un escalier qui remonte.
    for (let i = 1; i < seuil; i++) {
      if (v.vingtiemes[i] > v.vingtiemes[i - 1]) {
        throw new Error(`« ${v.id} » paie le rang ${i + 1} plus que le rang ${i}.`);
      }
    }
    // Au-delà : la mise rendue au plus — un bronze ne gagne jamais plus qu'il n'a misé.
    for (let i = seuil; i < m.joueurs; i++) {
      if (v.vingtiemes[i] > VINGTIEMES) throw new Error(`« ${v.id} » paie le rang ${i + 1} plus que sa mise sans l'avoir gagnée.`);
      if ((v.vingtiemes[i] === 0) !== (v.xp[i] > 0)) {
        throw new Error(`« ${v.id} » : le rang ${i + 1} doit gagner de l'XP exactement quand il ne gagne pas d'argent.`);
      }
    }
    if (v.xp.slice(0, seuil).some((x) => x !== 0)) throw new Error(`« ${v.id} » donne de l'XP de roue à un rang payé.`);
    poids += v.poids;
    pondere += v.poids * somme;
  }
  if (poids !== 10_000) {
    throw new Error(`les poids de « ${m.id} » font ${poids} points de base au lieu de 10000.`);
  }
  // LE RAKE VAUT 10 % EN MOYENNE, EXACTEMENT : Σ poids × somme = 10 000 × 90 % du pot.
  const attendu = 10_000 * (pot - Math.floor((pot * m.rakeBp) / 10_000));
  if (pondere !== attendu) {
    throw new Error(`« ${m.id} » distribue ${pondere / 10_000} vingtièmes en moyenne au lieu de ${attendu / 10_000} : le rake moyen n'est pas ${m.rakeBp / 100} %.`);
  }
}

// --------------------------------------------------------- la table des gains

/**
 * Table des gains d'un MODE et d'une ISSUE — port de `PayoutPolicy.Compute(…, variant)`.
 *
 * L'issue donne directement le gain de chaque rang en vingtièmes de mise. LE RAKE EST CE
 * QUI RESTE : le pot moins ce que la ligne distribue — entre 0 % et 30 % selon la ligne,
 * 10 % en moyenne (`verifierRoue`). Jamais négatif : aucune ligne ne dépasse le pot.
 *
 * @param {number} mise mise d'entrée en micro-USDG
 * @param {string} [modeId] `duel` | `squad` | `arena`
 * @param {string} [issueId] la ligne tirée par la roue pour CETTE partie
 * @returns {{pot: number, rake: number, parRang: number[], xp: number[]}} argent en micro-USDG
 */
export function table(mise, modeId = 'arena', issueId = 'standard') {
  const m = mode(modeId);
  const v = issueDe(modeId, issueId);

  const pot = mise * m.joueurs;
  // Exact pour toute mise du catalogue ; un reste de division va à la maison, jamais l'inverse.
  const parRang = v.vingtiemes.map((d) => Math.floor((mise * d) / VINGTIEMES));
  const distribue = parRang.reduce((s, g) => s + g, 0);
  const rake = pot - distribue;

  return { pot, rake, parRang, xp: v.xp.slice() };
}

/**
 * LA ROUE D'UN JOUEUR : la colonne de son rang, dix cases.
 *
 * Chaque case porte le gain de ce rang dans une issue, l'XP si l'issue ne lui donne pas
 * d'argent, et le poids de l'issue — qui est la TAILLE de la case. Deux cases peuvent
 * porter le même montant : elles restent deux cases, parce que ce sont deux lignes du
 * tableau, et fondre l'une dans l'autre mentirait sur la forme du tirage.
 *
 *  * Ce module ne dessine rien ; `roue.js` dessine ceci, et ne recalcule rien.
 */
export function roueDe(modeId, rang, mise) {
  const m = mode(modeId);
  if (!Number.isInteger(rang) || rang < 1 || rang > m.joueurs) {
    throw new Error(`rang ${rang} hors bornes (1..${m.joueurs}) en ${m.id}`);
  }
  const cases = ISSUES[m.id].map((v) => {
    const { parRang, xp } = table(mise, modeId, v.id);
    return { issue: v.id, nom: v.nom, poids: v.poids, gain: parRang[rang - 1], xp: xp[rang - 1] };
  });
  return { grade: grade(modeId, rang), rang, cases };
}

/**
 * L'ESPÉRANCE par rang : la moyenne des dix lignes, pondérée par leurs poids — ce que
 * le ticket annonce quand rien n'est encore tiré. Le rake rendu est le rake MOYEN, 10 %
 * du pot. On rend aussi le meilleur cas de chaque rang.
 *
 * Arrondie au micro par défaut : c'est une annonce, pas un versement.
 */
export function esperance(mise, modeId = 'arena') {
  const m = mode(modeId);
  const pot = mise * m.joueurs;
  const parRang = new Array(m.joueurs).fill(0);
  const max = new Array(m.joueurs).fill(0);
  const xp = new Array(m.joueurs).fill(0);
  let rake = 0;
  for (const v of ISSUES[m.id]) {
    const t = table(mise, modeId, v.id);
    rake += (t.rake * v.poids) / 10_000;
    for (let i = 0; i < m.joueurs; i++) {
      parRang[i] += (t.parRang[i] * v.poids) / 10_000;
      max[i] = Math.max(max[i], t.parRang[i]);
      xp[i] += (t.xp[i] * v.poids) / 10_000;
    }
  }
  return {
    pot,
    rake: Math.round(rake),
    parRang: parRang.map((x) => Math.floor(x)),
    max,
    xp: xp.map((x) => Math.round(x)),
  };
}

/**
 * Combien de manches pour un effectif donné.
 *
 * Chaque manche élimine environ la moitié, jusqu'au vainqueur. Plafonné à trois : au-delà
 * une partie s'allonge sans devenir plus intéressante, et le spec en retient trois.
 */
export function manchesPour(joueurs) {
  return Math.min(3, Math.max(1, Math.ceil(Math.log2(Math.max(2, joueurs)))));
}

/**
 * La configuration d'un SALON RÉDUIT à N joueurs — port de `MatchConfiguration.ForPlayers`.
 *
 * Le démarrage à froid impose d'ouvrir des salons plus petits que leur cible : il faut
 * seize joueurs vivants, prêts à miser le même montant, au même instant. Un salon réduit
 * doit donc être payé selon SON effectif — le payer au barème de seize promettrait un pot
 * qui n'existe pas.
 *
 * DEUX JOUEURS SONT REFUSÉS ICI, et la raison a changé : ce n'est plus « un duel est
 * impossible » — `MODES.duel` existe et paie ×1,8 — c'est que cette fonction DÉRIVE une
 * pyramide d'un effectif, par moitiés successives, et qu'il lui faut deux manches. Un duel
 * n'est pas un salon réduit : c'est un mode déclaré, dont la forme est posée à la main.
 *
 * La séparation est portante : l'échelle produite ici est comparée rang par rang au noyau
 * C# et à `backend/src/gains.js` de 3 à 24 joueurs, à chaque exécution des tests.
 */
export function configPour(joueurs, rakeBp = 1000) {
  if (!Number.isInteger(joueurs) || joueurs < 3) {
    throw new Error(`un salon réduit demande au moins 3 joueurs ; ${joueurs} demandé(s). `
      + "Un duel n'est pas un salon réduit : voir MODES.duel.");
  }
  const manches = Math.max(2, manchesPour(joueurs));
  const survivants = new Array(manches);
  for (let i = 1; i < manches; i++) {
    // Le plancher `manches - i + 1` garantit qu'il reste toujours assez de joueurs pour
    // tenir les manches suivantes ; sans lui, un petit effectif produirait une suite non
    // strictement décroissante, qu'aucun des deux noyaux n'accepte.
    survivants[i - 1] = Math.max(manches - i + 1, joueurs >> i);
  }
  survivants[manches - 1] = 1;

  const finalistes = survivants[manches - 2];
  const REFERENCE = [40, 15, 7, 2];
  const poidsFinalistes = Array.from(
    { length: Math.max(finalistes, REFERENCE.length) },
    (_, i) => (i < REFERENCE.length ? REFERENCE[i] : 1),
  );
  return { joueurs, survivants, rakeBp, poidsFinalistes };
}

/**
 * Table des gains d'un SALON RÉDUIT — `PayoutPolicy.Compute(config, stake)`, à poids.
 *
 * C'est l'autre chemin, et il ne sert pas à la même chose que `table()` : ici personne n'a
 * choisi la forme de la partie, elle est calculée depuis l'effectif réel. Aucune roue n'a
 * tourné, il n'y a pas de variante à annoncer.
 *
 * Règle unique : les survivants de la manche 1 récupèrent leur mise, et ce qui reste après
 * le rake est réparti en bonus entre les finalistes.
 *
 * @param {number} mise mise d'entrée en micro-USDG
 * @param {number} [joueurs] effectif réel de la partie
 * @returns {{pot: number, rake: number, parRang: number[]}} tout en micro-USDG
 */
export function tableEffectif(mise, joueurs = CONFIG.joueurs) {
  const c = joueurs === CONFIG.joueurs ? CONFIG : configPour(joueurs, CONFIG.rakeBp);
  const seuil = c.survivants[0];
  const nbFinalistes = c.survivants[c.survivants.length - 2];

  const pot = mise * c.joueurs;
  const rake = Math.floor((pot * c.rakeBp) / 10_000);
  const distribuable = pot - rake;

  const parRang = new Array(c.joueurs).fill(0);

  // 1. Remboursement de la mise aux survivants de la manche 1.
  for (let rang = 1; rang <= seuil; rang++) parRang[rang - 1] = mise;
  const bonus = distribuable - mise * seuil;

  // 2. Répartition du bonus entre finalistes, au prorata des poids.
  const poids = c.poidsFinalistes.slice(0, nbFinalistes);
  const sommePoids = poids.reduce((s, p) => s + p, 0);
  let alloue = 0;
  for (let i = 0; i < nbFinalistes; i++) {
    const part = Math.floor((bonus * poids[i]) / sommePoids);
    parRang[i] += part;
    alloue += part;
  }

  // 3. Le reste de division entière revient au vainqueur : aucune unité ne se perd.
  parRang[0] += bonus - alloue;

  return { pot, rake, parRang };
}

/**
 * L'échelle affichée dans le ticket : une ligne par PALIER.
 *
 * Sans issue (`issueId` nul) : ce que le ticket annonce AVANT la partie — l'espérance et
 * le meilleur cas de chaque palier, puisque la ligne n'est tirée qu'à la fin. Avec une
 * issue : les montants exacts de cette ligne, pour relire ce qu'une partie a payé.
 *
 * `gain` est celui du PREMIER rang de la ligne, `max` son plafond. `gemme` porte le nom du
 * palier : le ticket est écrit par une autre main et lit ce champ-là.
 */
export function echelle(mise, modeId = 'arena', issueId = null) {
  const m = mode(modeId);
  const src = issueId ? table(mise, modeId, issueId) : esperance(mise, modeId);
  const lignes = [];
  for (let i = 0; i < m.joueurs; i++) {
    const g = grade(modeId, i + 1);
    const derniere = lignes[lignes.length - 1];
    if (derniere && derniere.gemme === g) {
      derniere.jusqu = i + 1;
      derniere.min = Math.min(derniere.min, src.parRang[i]);
      continue;
    }
    lignes.push({
      depuis: i + 1, jusqu: i + 1, gemme: g,
      gain: src.parRang[i], min: src.parRang[i],
      max: issueId ? src.parRang[i] : src.max[i],
      xp: src.xp[i],
    });
  }
  return lignes.map((l) => ({
    ...l,
    // La bande remboursée : elle récupère sa mise, et un peu plus parfois.
    rembourse: l.gemme === 'argent',
    // Le multiplicateur est ce avec quoi NOUS raisonnons — jamais affiché.
    facteur: mise > 0 ? l.gain / mise : 0,
  }));
}

/**
 * « 16.00 » — deux décimales, POINT décimal, jamais d'arrondi flottant.
 *
 * Point et non virgule : l'interface est en anglais, et l'USDG se cote au point partout.
 * Un « 16,00 » dans une interface anglaise se lit comme un séparateur de milliers, donc
 * comme mille six cents — l'ambiguïté la plus chère qu'on puisse afficher sur un pot.
 */
export function montant(micros) {
  const negatif = micros < 0;
  const abs = Math.abs(micros);
  const unites = Math.floor(abs / MICROS);
  const cents = Math.round((abs % MICROS) / 10_000);
  return `${negatif ? '-' : ''}${unites}.${String(cents).padStart(2, '0')}`;
}

/**
 * Ordinal anglais : 1st, 2nd, 3rd, 4th…
 *
 * Onze, douze et treize prennent « th » malgré leur dernier chiffre — la règle du dernier
 * chiffre seul écrirait « 11st », et c'est la faute que fait tout le monde. Défini ici
 * parce que le ticket et l'écran de fin l'écrivent tous les deux, et qu'une deuxième
 * implémentation finit toujours par diverger de la première.
 */
export function ordinal(n) {
  const d = n % 10, c = n % 100;
  if (c >= 11 && c <= 13) return `${n}th`;
  return `${n}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`;
}

/**
 * « ×4.5 » — une décimale, et pas de décimale quand elle vaut zéro.
 *
 * PLUS AUCUN APPELANT DANS L'INTERFACE, et ce n'est pas un oubli.
 *
 * Le joueur mise des USDG et gagne des USDG : lui afficher un multiplicateur lui demande
 * de calculer de tête ce que la colonne d'à côté lui donne déjà. Le facteur est resté
 * l'outil avec lequel NOUS raisonnons — les tables de `roue.js`, la calibration des
 * variantes, les commentaires du noyau de règles — et `diag/economie.mjs` continue de
 * vérifier son format.
 *
 * Il ne doit pas être supprimé comme code mort. Il est vivant du côté où l'on conçoit,
 * absent du côté où l'on joue, et c'est exactement la répartition voulue.
 */
export function facteur(x) {
  return `×${Math.round(x * 10) / 10}`;
}

/**
 * Table choisie par le joueur, en micro-USDG.
 *
 * Memorisee : on rejoue le plus souvent a la meme table, et repartir a 1 USDG a chaque
 * lancement du jeu obligerait a la rechoisir sans arret. Une valeur memorisee qui ne
 * figure plus au catalogue retombe sur la plus basse plutot que de bloquer le lobby.
 */
const CLE_MISE = 'tumble-mise';

export function miseChoisie() {
  const memo = Number(localStorage.getItem(CLE_MISE));
  return (PALIERS.includes(memo) ? memo : PALIERS[0]) * MICROS;
}

export function choisirMise(usdg) {
  if (!PALIERS.includes(usdg)) return;
  localStorage.setItem(CLE_MISE, String(usdg));
  prevenir();
}

/**
 * Mode choisi par le joueur. Memorise pour la meme raison que la mise : on rejoue au meme
 * format, et le rechoisir a chaque lancement serait une friction pour rien.
 *
 * Le repli sur `arena` couvre aussi la mise a jour : une memoire ecrite avant l'existence
 * des modes ne contient rien, et une valeur retiree du catalogue ne doit pas bloquer le
 * lobby.
 */
const CLE_MODE = 'tumble-mode';

export function modeChoisi() {
  const memo = localStorage.getItem(CLE_MODE);
  return ORDRE_MODES.includes(memo) ? memo : 'arena';
}

export function choisirMode(id) {
  if (!ORDRE_MODES.includes(id)) return;
  localStorage.setItem(CLE_MODE, id);
  prevenir();
}

// ---------- notifications ----------

/*
 * Le portefeuille a demenage dans `caisse.js`.
 *
 * Tant qu'il n'etait qu'une cle de `localStorage`, sa place etait ici, aux cotes de la
 * table des gains. Il tient desormais deux choses tres differentes — un solde local de
 * prototype et un solde distant tenu par le grand livre du backend — et l'une d'elles est
 * ASYNCHRONE. Les melanger a un module de calcul pur, importe jusque dans un test qui
 * tourne sous Node, ne tenait plus.
 *
 * Ce fichier ne garde que ce qui se CALCULE : la table, l'echelle, les formats, la mise
 * choisie et la progression. Rien qui touche a de l'argent reel.
 */

const auditeurs = new Set();

/**
 * Previent tout ce qui affiche de l'argent, de l'XP ou une mise.
 *
 * Exporte parce que `caisse.js` doit pouvoir le declencher : le solde a demenage la-bas
 * quand il a cesse d'etre une simple cle de `localStorage`, mais il n'existe toujours
 * qu'UN SEUL chemin de rafraichissement de l'interface. Deux en feraient diverger.
 */
export const prevenir = () => { for (const fn of auditeurs) fn(); };

/*
 * Absence et zero ne sont pas la meme chose.
 *
 * `Number(null)` vaut 0, pas NaN : une cle jamais ecrite se lisait donc comme un solde
 * nul, et le joueur arrivait dans un lobby ou aucune table n'etait jouable, bouton
 * RECHARGER affiche des la premiere seconde. On teste l'absence AVANT de convertir.
 */
export function lireEntier(cle, defaut) {
  const brut = localStorage.getItem(cle);
  if (brut === null || brut === '') return defaut;
  const n = Number(brut);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaut;
}

// ---------- progression ----------

const CLE_XP = 'tumble-xp';

/**
 * Coût du passage au niveau suivant. Croissance linéaire douce : les premiers niveaux
 * tombent vite — c'est le seul retour que le joueur a d'une partie perdue — et l'écart
 * se creuse ensuite sans jamais devenir un mur.
 */
const coutNiveau = (n) => 240 + (n - 1) * 80;

export const XP_MANCHE = 45;   // par manche qualifiée
export const XP_VICTOIRE = 160; // en plus, pour la couronne

export const progression = {
  get xp() { return lireEntier(CLE_XP, 0); },

  /** Décompose l'XP totale en niveau courant et avancement dans ce niveau. */
  get etat() {
    let reste = this.xp;
    let niveau = 1;
    while (reste >= coutNiveau(niveau)) { reste -= coutNiveau(niveau); niveau++; }
    return { niveau, dans: reste, pour: coutNiveau(niveau) };
  },

  gagner(n) {
    localStorage.setItem(CLE_XP, String(this.xp + n));
    prevenir();
  },
};

/** S'abonne aux mouvements du portefeuille et de la progression. */
export function surChangement(fn) { auditeurs.add(fn); return () => auditeurs.delete(fn); }
