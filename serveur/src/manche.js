/**
 * UNE MANCHE, arbitrée par le serveur.
 *
 * C'est ici que le classement se décide. Aujourd'hui le navigateur le déclare et le
 * backend le croit sur parole — c'est la condition n°1 du verrou mainnet
 * (`backend/README.md`). Ce fichier est ce qui la lève.
 *
 * Le tick est FIXE à 30 Hz, et c'est une règle, pas un réglage : la physique doit avancer
 * du même pas partout, sinon deux serveurs de puissance différente ne produisent pas la
 * même partie. En test, on avance aussi vite que la machine le permet ; en production, on
 * dort entre les pas. La simulation ne voit pas la différence — c'est tout l'intérêt.
 *
 * Deux règles de fin, et la scène est la seule à savoir laquelle s'applique :
 *
 *   - COURSE   : on est qualifié en franchissant `finishZ`. Tomber sous `killY` fait
 *                RÉAPPARAÎTRE au dernier point de passage, ça n'élimine pas.
 *   - SURVIE   : on est qualifié en tenant `survie.duree`. Tomber sous `killY` ÉLIMINE,
 *                définitivement, sans réapparition.
 *
 * Cette asymétrie n'est pas une subtilité : l'inverser rendrait Les Hexagones ingagnables
 * et La Course interminable.
 */

import { construire, creerPerso, liberer, moteur } from './monde.js';
import { avancerTick } from './tick.js';

/** 30 Hz. La même valeur que la spec fixe pour le tick de simulation (section 6.2). */
export const HZ = 30;
export const DT = 1 / HZ;

/** Décompte avant le départ, en secondes. Le jeu en affiche trois. */
export const DECOMPTE = 3;

/**
 * Joue une manche entière.
 *
 * @param {object} p
 * @param {string} p.epreuve            identifiant de carte
 * @param {number} p.graine
 * @param {Array}  p.inscrits           `[{ nom, faire(monde, perso, index) -> pilote }]`
 * @param {number} p.qualifies          combien passent au tour suivant
 * @param {number} [p.dureeMax]         garde-fou en secondes
 * @param {function} [p.surTick]        appelé à chaque tick, pour observer
 */
export function jouerManche({ epreuve, graine, inscrits, qualifies, dureeMax = 240, surTick }) {
  const monde = construire(epreuve, graine);
  const { TUNING } = moteur();

  const coureurs = inscrits.map((inscrit, i) => {
    const perso = creerPerso(monde, i, inscrits.length);
    return {
      nom: inscrit.nom,
      index: i,
      perso,
      pilote: inscrit.faire(monde, perso, i),
      etat: 'court',          // 'court' | 'qualifie' | 'elimine'
      temps: null,            // secondes écoulées à la qualification ou à l'élimination
      progres: 0,             // mètres parcourus vers l'arrivée, ou secondes tenues
      chutes: 0,
    };
  });

  const departZ = monde.spawn.z;
  const distanceTotale = Math.max(1, departZ - monde.finishZ);

  let tick = 0;
  let places = 0;             // combien de places de qualifié sont déjà prises

  /*
   * LE DÉCOMPTE, et le piège qu'il cache.
   *
   * Pendant les trois secondes, la physique TOURNE — les personnages se posent — mais
   * aucune entrée n'est lue. C'est déjà le comportement du jeu, et il faut le reproduire
   * exactement : sur Les Hexagones, un sol qui céderait pendant le décompte perdrait la
   * manche avant qu'elle commence. La carte s'en protège avec un socle plein ; encore
   * faut-il que le serveur laisse bien tourner la physique ici.
   */
  const inerte = () => ({ x: 0, z: 0, jump: false, dive: false });
  const ticksDecompte = DECOMPTE * HZ;
  for (let i = 0; i < ticksDecompte; i++) {
    // `enJeu = false` : le décor vit, le terrain ne cède pas encore.
    avancerTick(monde, coureurs.map((c) => ({ perso: c.perso, entree: inerte() })), i / HZ, DT, false);
  }

  const maxTicks = dureeMax * HZ;

  while (tick < maxTicks) {
    const t = tick / HZ;
    const enCourse = coureurs.filter((c) => c.etat === 'court');
    if (!enCourse.length || places >= qualifies) break;

    // `enJeu = true` : le terrain ne cède que pendant la manche, comme sur le client.
    avancerTick(
      monde,
      enCourse.map((c) => ({ perso: c.perso, entree: c.pilote.entree(tick, c.perso, monde) })),
      t, DT, true,
    );

    for (const c of enCourse) {
      const p = c.perso.body.translation();

      if (monde.survie) {
        c.progres = t;
        if (p.y < monde.killY) { finir(c, 'elimine', t); continue; }
        if (t >= monde.duree) { finir(c, 'qualifie', t); continue; }
      } else {
        c.progres = Math.max(c.progres, Math.min(1, (departZ - p.z) / distanceTotale));
        if (p.y < monde.killY) {
          /*
           * En course, tomber ne tue pas : on réapparaît au dernier point de passage.
           * On compte la chute — c'est ce qui départage deux joueurs éliminés au même
           * endroit, et c'est déjà la statistique que le jeu affiche.
           */
          c.chutes++;
          c.perso.respawn(monde.arene.checkpointFor?.(p.z) ?? monde.spawn);
          continue;
        }
        if (p.z <= monde.finishZ) { finir(c, 'qualifie', t); continue; }
      }
    }

    surTick?.(tick, coureurs, monde);
    tick++;
  }

  /*
   * FIN DU TEMPS IMPARTI — et les places de qualifié qui restent vacantes.
   *
   * On classe ce qui reste sur la piste du plus avancé au moins avancé : un joueur qui a
   * fait 90 % du parcours ne finit pas au même rang que celui qui n'a pas quitté la ligne
   * de départ.
   *
   * Puis on COMBLE les places non pourvues. Si huit joueurs devaient passer et que trois
   * seulement ont franchi la ligne, les cinq plus avancés passent aussi. Ce n'est pas une
   * faveur : la table des gains promet « passe la première manche, tu récupères ta mise »
   * à huit joueurs, et laisser cinq places vides transformerait cette promesse en piège.
   * Le seuil de non-perte est la seule chose du modèle économique que le joueur retient —
   * il doit valoir ce qu'il annonce, y compris les jours où personne ne finit.
   */
  const durent = coureurs.filter((c) => c.etat === 'court');
  durent.sort((a, b) => b.progres - a.progres || a.chutes - b.chutes);
  for (const c of durent) finir(c, 'elimine', tick / HZ);

  /*
   * On repêche jusqu'à ce que les places soient pourvues.
   *
   * Deux situations, et la règle est la même dans les deux :
   *
   *   - en COURSE, le temps expire et personne n'a franchi la ligne. Les plus avancés
   *     passent : sans cela, une manche difficile éliminerait tout le monde et priverait
   *     de leur remboursement huit joueurs à qui on l'avait promis ;
   *   - en SURVIE, tout le monde tombe avant la fin. C'est la règle d'Hex-A-Gone : si
   *     personne ne tient la durée, LE DERNIER TOMBÉ gagne. Ne couronner personne serait
   *     un contresens — une manche a toujours un vainqueur.
   *
   * Le tri est celui de `progres`, qui vaut la distance parcourue en course et le temps
   * tenu en survie. Dans les deux cas, le plus grand est le meilleur.
   */
  const repeches = coureurs.filter((c) => c.etat === 'elimine')
    .sort((a, b) => b.progres - a.progres || a.chutes - b.chutes);
  for (const c of repeches) {
    if (places >= qualifies) break;
    c.etat = 'qualifie';
    places++;
  }

  function finir(c, etat, t) {
    c.etat = etat;
    c.temps = t;
    if (etat === 'qualifie') places++;
  }

  /*
   * LE CLASSEMENT DE LA MANCHE.
   *
   * Les qualifiés d'abord, dans l'ordre où ils ont fini — en course le plus RAPIDE
   * devance, en survie le plus ENDURANT. Puis les éliminés, du plus avancé au moins
   * avancé. Le rang qui en sort est celui que le backend paiera : il ne doit dépendre
   * que de ce qui s'est passé sur la piste.
   */
  const qualifiesListe = coureurs.filter((c) => c.etat === 'qualifie')
    .sort((a, b) => {
      // Un repêché a pu ne jamais « finir » : on retombe alors sur son avancement, qui
      // est la seule mesure disponible. Comparer des `null` produirait des NaN, et un
      // comparateur qui rend NaN laisse le tableau dans un ordre arbitraire.
      if (a.temps === null || b.temps === null) return b.progres - a.progres;
      return monde.survie ? b.temps - a.temps : a.temps - b.temps;
    });
  const eliminesListe = coureurs.filter((c) => c.etat === 'elimine')
    .sort((a, b) => b.progres - a.progres || a.chutes - b.chutes);

  const classement = [...qualifiesListe, ...eliminesListe].map((c, i) => ({
    nom: c.nom,
    rang: i + 1,
    etat: c.etat,
    temps: c.temps === null ? null : +c.temps.toFixed(2),
    progres: +c.progres.toFixed(3),
    chutes: c.chutes,
  }));

  for (const c of coureurs) c.perso.dispose?.();
  liberer(monde);

  return {
    epreuve,
    graine,
    survie: Boolean(monde.survie),
    ticks: tick,
    duree: +(tick / HZ).toFixed(2),
    classement,
    qualifies: classement.filter((c) => c.etat === 'qualifie').map((c) => c.nom),
  };
}
