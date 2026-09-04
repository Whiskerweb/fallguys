/**
 * UN TICK DE SIMULATION — la copie fidèle d'une image du client.
 *
 * Ce fichier existe pour une seule raison : si le serveur avance autrement que le
 * navigateur, la prédiction du client ne colle pas, et l'écart se manifeste comme un
 * personnage qui « saute » sans qu'on sache pourquoi. L'ordre des opérations ci-dessous
 * est donc recopié de `main.js`, pas réinventé, et chaque écart serait un bug.
 *
 * Ce que j'ai appris en le construisant, et qu'un lecteur pressé referait de travers :
 *
 *   1. `world.step()` avance de `world.timestep` — 1/60 s — QUOI QU'ON LUI PASSE. Le `dt`
 *      donné au personnage est un argument séparé. Dire 1/30 au contrôleur pendant que la
 *      physique avance de 1/60 désynchronise l'intégration : le personnage croit tomber
 *      deux fois plus vite qu'il ne tombe. Un tick serveur à 30 Hz vaut donc DEUX
 *      sous-pas de 1/60, et les constantes de `tuning.js` ont été mesurées à 1/60.
 *
 *   2. `limiterVitesse()` s'appelle APRÈS le pas, jamais avant : c'est le solveur qui
 *      produit les expulsions, donc c'est après lui qu'il faut les borner. Sans ce
 *      garde-fou, une capsule coincée part à une vitesse non bornée, puis en NaN — et un
 *      NaN rend toute comparaison fausse, donc déclenche à vide chaque zone de la carte.
 *      C'est exactement ce qui m'est arrivé au premier essai.
 *
 *   3. `glisse` et `surface` se posent APRÈS les sous-pas : ils servent au tick SUIVANT.
 *      Les poser avant ferait réagir le personnage à un sol qu'il n'a pas encore touché.
 */

/** Un tick serveur vaut deux sous-pas de physique. 30 Hz de décision, 60 Hz de solveur. */
export const SOUS_PAS = 2;

/**
 * Avance la simulation d'un tick.
 *
 * @param {object} monde       l'arène de `monde.js`
 * @param {Array}  acteurs     `[{ perso, entree }]` — l'entrée est consommée ici — ou
 *                             `[{ perso, entrees: [f0, f1] }]`, UNE image par sous-pas :
 *                             c'est la forme d'un joueur réseau, dont le tampon a rendu
 *                             exactement les pas que son client a joués
 * @param {number} elapsed     secondes écoulées depuis le début de la manche
 * @param {number} dt          durée du tick (1/30)
 * @param {boolean} enJeu      la manche a-t-elle commencé ? (faux pendant le décompte)
 * @param {{ apresSousPas?: (s: number) => void }} [options]  un rappel après chaque
 *                             sous-pas — le client sans navigateur y note sa position
 *                             pas par pas, comme `main.js` le fait dans sa boucle
 */
export function avancerTick(monde, acteurs, elapsed, dt, enJeu, { apresSousPas = null } = {}) {
  const arene = monde.arene;
  const world = arene.world;

  /*
   * L'arène d'abord, avec TOUTES les positions.
   *
   * Le contrat de scène acceptait une seule position — il a été écrit pour un joueur. Sur
   * Les Dalles, Les Portes et L'Hexagone, cela voudrait dire qu'un seul joueur use le
   * terrain pendant que les quinze autres marchent gratuitement. Les trois cartes
   * acceptent désormais une liste ; les deux autres n'utilisent `focus` que pour des
   * confettis, et prennent la première position sans y voir de différence.
   */
  // `sonde`, pas `position` : la même position, plus l'impact d'atterrissage que Les
  // Dalles lisent (une fausse dalle cède sans sursis sous qui s'y reçoit).
  const positions = acteurs.map((a) => a.perso.sonde);
  arene.update?.(elapsed, dt, positions, null, enJeu);

  for (let s = 0; s < SOUS_PAS; s++) {
    for (const a of acteurs) a.perso.update(world.timestep, a.entrees ? a.entrees[s] : a.entree, 0);
    world.step();
    for (const a of acteurs) a.perso.limiterVitesse();
    apresSousPas?.(s);

    /*
     * Les fronts — saut et plongeon — ne valent que pour UN sous-pas.
     *
     * Le client les efface de la même façon dans sa boucle d'accumulateur. Les laisser
     * actifs sur les deux sous-pas ferait déclencher deux sauts pour une pression, et le
     * personnage monterait plus haut sur le serveur que chez le joueur.
     *
     * On écrit bien dans `a.entree`, mais cet objet appartient au tick : l'instance en
     * fabrique une copie neuve à chaque appel, et les pilotes en rendent une neuve aussi.
     * Ça n'a pas toujours été le cas — on effaçait alors l'accumulateur du serveur, donc
     * l'appui suivant du joueur.
     */
    for (const a of acteurs) {
      if (!a.entree) continue;   // une image par sous-pas : chacune ne sert qu'une fois
      a.entree.jump = false; a.entree.dive = false;
    }
  }

  for (const a of acteurs) {
    const pos = a.perso.position;

    // La scène dit ce qu'on a sous les pieds : un coefficient de glisse, et la vitesse
    // d'une surface mobile. Le contrôleur ne connaît que ces deux nombres, ce qui laisse
    // chaque épreuve libre de dessiner ses zones sans rien changer au personnage.
    a.perso.glisse = arene.glisseAt?.(pos) ?? 0;
    a.perso.surface = arene.surfaceAt?.(pos) ?? null;

    if (a.perso.grounded) {
      for (const c of arene.conveyors ?? []) {
        if (pos.x >= c.minX && pos.x <= c.maxX && pos.z >= c.minZ && pos.z <= c.maxZ
            && Math.abs(pos.y - c.y) < 1.6) {
          const v = a.perso.body.linvel();
          a.perso.body.setLinvel({ x: v.x + c.vx * dt * 6, y: v.y, z: v.z + c.vz * dt * 6 }, true);
          break;
        }
      }
    }

    /*
     * Garde contre les positions non finies, recopiée du client — et elle n'y est pas par
     * excès de prudence : avec un NaN, TOUTE comparaison est fausse, donc aucun `continue`
     * ne s'exécute et chaque zone se déclenche à vide. Un seul NaN suffisait à faire tirer
     * un tremplin situé à cent mètres de là.
     */
    const valide = Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
    for (const t of (valide ? arene.tremplins ?? [] : [])) {
      if (pos.x < t.minX || pos.x > t.maxX || pos.z < t.minZ || pos.z > t.maxZ) continue;
      // Fenêtre asymétrique : large vers le haut, parce qu'on saute instinctivement sur un
      // tremplin ; serrée vers le bas, pour ne pas le déclencher depuis l'étage inférieur.
      if (pos.y - t.y > 3.4 || pos.y - t.y < -1.2) continue;
      const v = a.perso.body.linvel();
      a.perso.body.setLinvel({ x: v.x, y: t.force, z: v.z }, true);
      a.perso.state = 'airborne';
      break;
    }
  }
}
