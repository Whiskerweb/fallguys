/**
 * LES BOTS — de quoi remplir une partie pour la tester.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  AVERTISSEMENT, ET IL N'EST PAS DÉCORATIF
 *
 *  Ces bots ne doivent JAMAIS entrer dans une partie payante. Toute la
 *  qualification « compétition de skill » de la spec (section 5) repose sur un
 *  fait : aucune machine ne décide de l'issue. Un joueur dont le gain dépend
 *  d'adversaires pilotés par le serveur ne dispute plus une compétition — et
 *  c'est exactement la distinction sur laquelle un régulateur se penche.
 *
 *  `salon.js` refuse de les convoquer dès que la mise est non nulle, et un
 *  verdict du harnais le vérifie. C'est une barrière de code, pas une consigne.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * DÉTERMINISME. Aucun `Math.random`, jamais. Tout ce qui « varie » — erreur de visée,
 * sauts manqués, délai de réaction — est une fonction de la graine de manche, du numéro
 * du bot et du tick. La règle du projet l'exige (spec section 5), et sans elle un replay
 * ne reproduit rien : un bot indéterministe est un bot qu'on ne peut pas déboguer.
 *
 * ─── D'OÙ VIENT CE PILOTE ───────────────────────────────────────────────────
 *
 * Le noyau de navigation n'est PAS inventé ici : il est repris de
 * `tools/feel-lab/diag/traversee.mjs`, qui traverse déjà La Course depuis des mois. Mes
 * premiers essais, écrits de zéro, mouraient au premier trou. Les trois leçons que ce
 * pilote-là portait déjà, et qui coûtent cher à retrouver :
 *
 *   1. ON NE BRAQUE PAS EN APPROCHE DE FOSSE, NI EN VOL. La vitesse est un budget partagé
 *      entre X et Z : sauter en diagonale ramène la portée de 5,3 m à 3,9 m, et la fosse
 *      devient infranchissable sans que rien ne l'indique.
 *   2. L'ORIGINE DU RAYON EST DEVANT LE CORPS. Un rayon parti du centre touche la propre
 *      capsule du personnage à distance zéro et signale un mur en permanence.
 *   3. LE SAUT A UN TEMPS DE RECHARGE. Sans lui le pilote saute sans arrêt et arrive aux
 *      fosses pendant sa récupération.
 */

import { moteur } from '../monde.js';

/**
 * Les trois niveaux.
 *
 * Ils ne diffèrent QUE par des dégradations du même pilote : le fort est la référence, les
 * deux autres sont lui, en moins bien. Trois pilotes écrits séparément divergeraient, et
 * on ne saurait plus si un écart de résultat vient du niveau ou du code.
 *
 *   `reaction`  ticks de retard avant d'agir sur ce qu'il voit
 *   `erreur`    amplitude de l'erreur de visée, en mètres sur la colonne choisie
 *   `sautRate`  un saut sur N est manqué (0 = aucun)
 *   `vitesse`   fraction de la vitesse demandée
 *   `plonge`    sait-il allonger un saut par un plongeon ?
 */
export const NIVEAUX = {
  fort: { reaction: 0, erreur: 0.0, sautRate: 0, vitesse: 1.00, plonge: true },
  moyen: { reaction: 2, erreur: 0.8, sautRate: 7, vitesse: 0.95, plonge: false },
  faible: { reaction: 5, erreur: 2.0, sautRate: 3, vitesse: 0.85, plonge: false },
};

/** mulberry32 — le générateur du jeu. Un état de 32 bits, une suite reproductible. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function creerBot({ monde, perso, index, graine, niveau = 'moyen' }) {
  const { RAPIER } = moteur();
  const reglage = NIVEAUX[niveau];
  if (!reglage) throw new Error(`bot : niveau inconnu « ${niveau} »`);

  const alea = mulberry32((graine ^ (index * 0x9E3779B1)) >>> 0);
  const voie = alea();          // sa préférence latérale, stable sur toute la manche
  const phase = alea() * Math.PI * 2;

  const world = monde.arene.world;
  const bas = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const horiz = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  /**
   * Hauteur du sol sous (x, z), ou `null`.
   *
   * Les bornes ne sont pas décoratives : au-dessus de `yRef + 1.1` c'est un plafond, en
   * dessous de `yRef - 9` c'est le vide. Les deux doivent se lire « pas de sol », sans
   * quoi le pilote vise un plafond ou se jette dans un gouffre en croyant y trouver pied.
   */
  function solA(x, z, yRef) {
    bas.origin = { x, y: yRef + 1.2, z };
    const c = world.castRay(bas, 26, true, undefined, undefined, undefined, perso.body);
    if (!c) return null;
    const h = yRef + 1.2 - c.timeOfImpact;
    return (h > yRef + 1.1 || h < yRef - 9) ? null : h;
  }

  /** Distance à l'obstacle devant, ou `-1`. L'origine est DEVANT le corps, jamais dedans. */
  function obstacle(x, y, z, dx, dz, portee) {
    horiz.origin = { x, y, z };
    horiz.dir = { x: dx, y: 0, z: dz };
    const c = world.castRay(horiz, portee, true, undefined, undefined, undefined, perso.body);
    return c ? c.timeOfImpact : -1;
  }

  let cible = 0;                // la colonne visée, en X
  let rechargeSaut = 0;
  let compteurSauts = 0;
  let depuisSaut = 999;
  let bloqueDepuis = 0;
  let dernierZ = Infinity;
  const fileSauts = [];         // pour rendre au bot ce qu'il a vu, avec `reaction` ticks de retard

  /**
   * Choix de la COLONNE, sur une carte de course.
   *
   * On note chaque abscisse à deux profondeurs, et les termes de la note comptent tous :
   * la marge latérale évite de longer une arête, la pénalité d'obstacle évite de pousser
   * contre un pilier qui tombe dans l'angle mort des sondes de sol, et l'hystérèse
   * empêche de zigzaguer entre deux colonnes équivalentes.
   */
  function choisirColonne(p) {
    let meilleur = cible;
    let note = -1e9;
    for (let dx = -8; dx <= 8; dx += 1) {
      const x = p.x + dx;
      if (Math.abs(x) > monde.largeur) continue;
      const proche = solA(x, p.z - 3.0, p.y);
      const loin = solA(x, p.z - 7.0, p.y);
      let n = (proche !== null ? 3 : 0) + (loin !== null ? 2 : 0);
      // Personne ne court sur vingt centimètres de bord : une colonne dont les voisines
      // portent vaut mieux qu'une colonne isolée.
      if (solA(x - 1.6, p.z - 3.0, p.y) !== null) n += 0.9;
      if (solA(x + 1.6, p.z - 3.0, p.y) !== null) n += 0.9;
      /*
       * Pénalité d'obstacle — SUSPENDUE quand le bot est bloqué depuis longtemps.
       *
       * Sur Les Portes, tout le mur est un obstacle : la moitié des panneaux cèdent au
       * contact, l'autre non, et rien ne les distingue à la sonde. Un bot qui fuit tout
       * obstacle reste planté devant le mur, ce qu'il faisait au premier essai. Passé un
       * certain temps sans progresser, il pousse donc — c'est exactement ce que fait un
       * joueur qui essaie les portes une par une.
       */
      if (bloqueDepuis < 45 && obstacle(x, p.y + 0.2, p.z, 0, -1, 4.5) >= 0) n -= 5;
      n -= Math.abs(dx) * 0.12;                 // ne pas zigzaguer pour rien
      n -= Math.abs(x - cible) * 0.30;          // hystérèse : tenir sa ligne
      if (n > note) { note = n; meilleur = x; }
    }
    return meilleur;
  }

  /**
   * Sur une carte de SURVIE, il n'y a pas d'arrivée : on tourne.
   *
   * C'est la stratégie connue d'Hex-A-Gone — décrire un cercle consomme des tuiles
   * fraîches sans jamais se piéger dans le trou qu'on vient de creuser. Chaque bot a son
   * rayon, donc ils ne se marchent pas dessus et aucun ne squatte le centre.
   */
  function viserSurvie(p, tick) {
    const t = tick / 30;
    /*
     * SPIRALE, et non cercle — c'est la correction qui change tout.
     *
     * Au premier essai les bots décrivaient un cercle de rayon constant. À 0,55 rad/s, un
     * tour complet dure 11,4 s : ils revenaient donc exactement dans le trou qu'ils
     * venaient de creuser, et tombaient tous entre 15 et 24 s d'une manche qui en dure 75.
     * Le rayon s'ouvre maintenant avec le temps, si bien que la trajectoire ne se recoupe
     * jamais. Les étages s'élargissant vers le bas, descendre laisse d'ailleurs plus de
     * place — la spirale suit la forme de la tour.
     */
    const r = 2.5 + voie * 2 + t * 0.22;
    const angle = phase + t * 0.55;
    const vx = Math.cos(angle) * r - p.x;
    const vz = Math.sin(angle) * r - p.z;
    const n = Math.hypot(vx, vz) || 1;
    return { x: vx / n, z: vz / n };
  }

  return {
    nom: `${niveau}-${index}`,
    niveau,
    estBot: true,

    /** Une entrée par tick, même forme que le clavier : `{ x, z, jump, dive }`. */
    entree(tick) {
      const p = perso.position;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
        return { x: 0, z: 0, jump: false, dive: false };
      }

      const auSol = perso.state === 'grounded';
      const enVol = perso.state === 'airborne';

      // Progresse-t-on ? En survie, « avancer » n'a pas de sens en Z : on mesure le
      // déplacement tout court.
      const reference = monde.survie ? -Math.hypot(p.x, p.z) : p.z;
      if (Math.abs(reference - dernierZ) < 0.03) bloqueDepuis++; else bloqueDepuis = 0;
      dernierZ = reference;

      let dir;
      let fosse = false;
      let grandeFosse = false;

      if (monde.survie) {
        dir = viserSurvie(p, tick);
        const devant = solA(p.x + dir.x * 1.4, p.z + dir.z * 1.4, p.y);
        fosse = devant === null;
      } else {
        cible = choisirColonne(p);

        /*
         * PAS DE LIGNE PARFAITE QUAND ON EST BLOQUÉ.
         *
         * Sur Les Portes, le bot fort restait planté à onze mètres du départ : il tenait
         * une ligne impeccable droit dans une porte pleine, et rien ne l'en délogeait. Le
         * bot moyen, lui, passait — grâce à son erreur de visée, qui le faisait dériver
         * vers un panneau qui cède. Une trajectoire parfaite n'est pas une bonne
         * trajectoire quand la carte demande d'essayer.
         *
         * Bloqué, le bot balaie donc latéralement, d'un côté puis de l'autre. C'est
         * exactement ce que fait un joueur devant un mur de portes.
         */
        const balayage = bloqueDepuis > 30
          ? Math.sin(bloqueDepuis * 0.06) * 3.5
          : 0;

        // Erreur de visée : une oscillation lente, déphasée par bot. Déterministe, et elle
        // ressemble à une main qui tremble plutôt qu'à un bruit blanc.
        const vise = cible + balayage
          + (reglage.erreur ? Math.sin(phase + tick * 0.04) * reglage.erreur : 0);

        /*
         * ON NE BRAQUE PAS EN APPROCHE DE FOSSE, NI EN VOL. La leçon n°1 : la vitesse est
         * un budget partagé entre X et Z, et corriger sa ligne au-dessus du vide raccourcit
         * le saut d'un mètre. Un joueur s'aligne d'instinct avant un saut long.
         */
        const fosseDevant = solA(p.x, p.z - 4.5, p.y) === null && solA(p.x, p.z - 9.0, p.y) !== null;
        const fige = fosseDevant || enVol;
        const ecart = vise - p.x;
        const vx = fige ? 0 : Math.max(-1, Math.min(1, ecart / 1.5));
        dir = { x: vx, z: -1 };

        const solProche = solA(p.x, p.z - 1.4, p.y);
        const solApres = solA(p.x, p.z - 6.5, p.y);
        fosse = solProche === null && solApres !== null;
        grandeFosse = fosse && solA(p.x, p.z - 4.0, p.y) === null;

        /*
         * BARRIÈRE : un obstacle bas qu'on peut franchir d'un saut, par opposition à un mur
         * qui monte jusqu'au ciel. On sonde à deux hauteurs : bas touché, haut libre.
         */
        const plat = solProche !== null && Math.abs(solProche - (p.y - 0.8)) < 0.9;
        const murBas = obstacle(p.x, p.y - 0.35, p.z - 0.9, 0, -1, 2.2);
        const murHaut = obstacle(p.x, p.y + 1.25, p.z - 0.9, 0, -1, 2.2);
        const barriere = plat && murBas >= 0 && murBas < 1.9 && (murHaut < 0 || murHaut > 2.1);
        if (barriere) fosse = true;
      }

      // Débloquer : bloqué longtemps, on saute — c'est ce qui sort d'un coin ou d'une porte.
      if (bloqueDepuis > 20 && bloqueDepuis % 15 === 0) fosse = true;

      /*
       * Le saut passe par une file d'attente : c'est ce qui donne au bot moyen et au bot
       * faible leur temps de réaction. Le bot fort a une file vide et réagit à l'instant.
       */
      fileSauts.push(fosse);
      const vu = fileSauts.length > reglage.reaction ? fileSauts.shift() : false;

      rechargeSaut = Math.max(0, rechargeSaut - 1);
      depuisSaut++;

      let saute = false;
      if (vu && auSol && rechargeSaut === 0) {
        compteurSauts++;
        // Un saut manqué n'est pas tiré au sort : c'est un COMPTEUR. Le bot faible rate un
        // saut sur trois, exactement, et toujours les mêmes — donc la manche est
        // reproductible, donc déboguable.
        const rate = reglage.sautRate && compteurSauts % reglage.sautRate === 0;
        if (!rate) { saute = true; rechargeSaut = 10; depuisSaut = 0; }
      }

      /*
       * LE PLONGEON allonge un saut, il ne rattrape pas une chute.
       *
       * La condition « grande fosse ET pas au sol » reste vraie pendant toute la chute :
       * au premier essai le bot plongeait à chaque tick en tombant, et mourait au premier
       * trou au lieu de le franchir. On exige donc un décollage récent ET une vitesse
       * verticale montante — c'est-à-dire le moment précis où il allonge son saut.
       */
      const monte = perso.body.linvel().y > 0.5;
      const plonge = reglage.plonge && grandeFosse && enVol && monte && depuisSaut <= 4;

      return {
        x: dir.x * reglage.vitesse,
        z: dir.z * reglage.vitesse,
        jump: saute,
        dive: plonge,
      };
    },
  };
}
