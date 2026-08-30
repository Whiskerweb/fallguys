import { buildCourse } from './course.js';
import { buildDoors } from './doors.js';
import { buildRondin } from './rondin.js';

/**
 * Registre des épreuves et déroulement d'une PARTIE.
 *
 * Une partie n'est pas une épreuve : c'est une SUITE d'épreuves tirées au sort, jouées
 * l'une après l'autre jusqu'à la finale. C'est la structure de la référence, et elle
 * change tout — on ne choisit pas son terrain, on encaisse celui qui tombe. Un joueur
 * fort à la course mais faible aux portes ne peut pas éviter les portes.
 *
 * `build(RAPIER, assets, { seed })` doit renvoyer :
 *   world, group, spawn, finishZ, killY, checkpoints, conveyors,
 *   update(elapsed, dt, focus, camera), checkpointFor(z), et de préférence reset(),
 *   dispose(), camBias et ambiance.
 */
export const MINIGAMES = [
  {
    id: 'course',
    name: 'La Course',
    tagline: 'Le parcours d’obstacles. Serpente, bifurque, esquive.',
    duree: '≈ 90 s',
    accent: '#2dd9d9',
    build: buildCourse,
  },
  {
    id: 'doors',
    name: 'Les Portes',
    tagline: 'Sept murs, des portes qui cèdent et des portes qui mentent.',
    duree: '≈ 45 s',
    accent: '#ff4fa3',
    build: buildDoors,
  },
  {
    id: 'rondin',
    name: 'Le Rondin',
    tagline: 'Quatre troncs qui tournent au-dessus du lagon. Reste en haut.',
    duree: '≈ 50 s',
    accent: '#c98a4b',
    build: buildRondin,
  },
];

export function minigame(id) {
  return MINIGAMES.find((m) => m.id === id) ?? MINIGAMES[0];
}

/**
 * Graine d'une manche.
 *
 * Tirée au sort : deux parties ne se ressemblent pas, et un parcours appris par cœur ne
 * vaut plus rien. Le point important est qu'il n'y a qu'UNE graine par manche, et non
 * une par joueur : en multijoueur, le serveur la tire et l'impose aux seize joueurs, qui
 * affrontent alors exactement la même disposition, aux mêmes emplacements, au même
 * instant. C'est cette unicité qui rend la manche équitable — le hasard décide du
 * terrain, jamais du vainqueur.
 */
export function graineDeManche() {
  return (Math.random() * 0xffffffff) >>> 0;
}

/**
 * Tire la suite d'épreuves d'une partie.
 *
 * Sans répétition tant qu'il reste des épreuves inédites : enchaîner deux fois la même
 * dans une partie de trois manches donne l'impression d'un catalogue vide, alors même
 * que la disposition, elle, aurait change.
 */
export function tirerParcours(nbManches = 3) {
  const restantes = [...MINIGAMES];
  const suite = [];
  for (let i = 0; i < nbManches; i++) {
    if (!restantes.length) restantes.push(...MINIGAMES);
    // On evite aussi de rejouer l'epreuve qui vient de passer quand le catalogue se
    // recharge : deux manches identiques a la suite se lisent comme un bug.
    let choix = Math.floor(Math.random() * restantes.length);
    if (restantes.length > 1 && restantes[choix].id === suite[suite.length - 1]?.id) {
      choix = (choix + 1) % restantes.length;
    }
    suite.push(restantes.splice(choix, 1)[0]);
  }
  return suite;
}
