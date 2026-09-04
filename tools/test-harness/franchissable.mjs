/**
 * CHAQUE CARTE SE TERMINE-T-ELLE ? Et en combien de temps ?
 *
 * Ce fichier existe parce que les chiffres qui décrivent nos cartes vivaient dans un
 * COMMENTAIRE. `politique.js` dit « course s'achève en 73 s, rondin demande 316 s, doors
 * et dalles n'ont jamais été terminées en 600 s » — et c'est sur cette phrase que repose le
 * choix d'une manche à 360 secondes. Une phrase ne se vérifie pas ; une commande, si.
 *
 * ─── POURQUOI ÇA COMPTE ─────────────────────────────────────────────────────
 *
 * Une manche de course ne produit un vrai vainqueur que si quelqu'un FRANCHIT la ligne.
 * Sinon le chrono la tranche, tout le monde est éliminé puis repêché par avancement, et le
 * mieux placé est couronné — même s'il n'a pas quitté la ligne de départ. C'est un
 * arbitrage assumé (voir `politique.js`), mais il ne doit pas devenir l'ordinaire : une
 * carte qu'on ne finit jamais n'est plus une compétition, c'est une mesure de patience.
 *
 * ─── POURQUOI SANS NAVIGATEUR ───────────────────────────────────────────────
 *
 * Les chiffres de `politique.js` ont été relevés avec LES BOTS, pas avec le pilote au radar
 * de `diag/traversee.mjs`. On refait donc la même mesure, par le même chemin : `jouerManche`
 * exécute la vraie physique aussi vite que la machine le permet, là où un navigateur en
 * rendu logiciel avancerait dix fois moins vite pour dire la même chose.
 *
 * Et `__ray`, dont le pilote au radar dépend, n'existe que sur trois des cinq cartes.
 *
 * ─── CE QUE CE FICHIER N'EST PAS ────────────────────────────────────────────
 *
 * Ce n'est pas une suite de verdicts : il ne fait pas échouer `npm test`. Un bot n'est pas
 * un humain — `politique.js` note qu'un joueur va trois fois plus vite que lui sur `doors`
 * — donc un seuil posé ici mesurerait la force de nos bots, pas la longueur de nos cartes.
 * Il RAPPORTE, et c'est au directeur produit de lire le tableau.
 *
 * Usage : node franchissable.mjs [duree]      (défaut : 400 s, soit un peu plus que le
 *                                              plafond de 360 s d'une manche réelle)
 */

import { preparer, epreuves, construire, liberer } from '../../serveur/src/monde.js';
import { jouerManche } from '../../serveur/src/manche.js';
import { creerBot } from '../../serveur/src/pilotes/bot.js';

const DUREE = Number(process.argv[2] ?? 400);
const PLAFOND_REEL = 360;     // `politique.js` : ce que dure vraiment une manche en ligne
const JOUEURS = 4;

await preparer();

/*
 * La durée qu'une carte de SURVIE demande de tenir — nulle pour une course.
 *
 * Elle n'est pas dans le registre : une scène la déclare en exposant `survie: { duree }`,
 * et c'est `construire()` qui la remonte. On passe donc par le vrai chemin du serveur
 * plutôt que d'appeler `build` à la main, qui demanderait RAPIER et les assets.
 */
const dureesSurvie = new Map();
const duree = (e) => dureesSurvie.get(e.id) ?? 0;
for (const e of epreuves()) {
  const m = construire(e.id, 1);
  dureesSurvie.set(e.id, m.duree ?? 0);
  liberer(m);
}

console.log(`\n\x1b[1mChaque carte se termine-t-elle ?\x1b[0m`);
console.log(`${JOUEURS} bots FORTS · ${DUREE} s au plus · plafond réel d'une manche : ${PLAFOND_REEL} s\n`);
console.log('  carte      annoncé    vainqueur   temps      ce qui s\'est passé');
console.log('  ─────────  ─────────  légitime ?  ─────────  ──────────────────');

const lignes = [];
for (const e of epreuves()) {
  const inscrits = Array.from({ length: JOUEURS }, (_, i) => ({
    nom: `fort-${i}`,
    // Le niveau le plus haut : on mesure ce que la carte oppose à quelqu'un qui sait
    // jouer, pas ce qu'elle oppose à un débutant.
    faire: (monde, perso, index) => creerBot({ monde, perso, index, graine: 4242, niveau: 'fort' }),
  }));

  const t0 = Date.now();
  /*
   * `qualifies: 1` — on cherche le PREMIER arrivé, pas le peloton. C'est la question que
   * pose une finale, et c'est la seule qui décide si la carte sait produire un vainqueur.
   */
  const r = jouerManche({ epreuve: e.id, graine: 4242, inscrits, qualifies: 1, dureeMax: DUREE });
  const mur = ((Date.now() - t0) / 1000).toFixed(0);

  /*
   * QUI A VRAIMENT FINI — et le `temps` ne suffit pas à le dire.
   *
   * Un repêché en porte un lui aussi : `clore()` marque d'abord tout le monde éliminé, ce
   * qui pose `temps`, PUIS repromeut les mieux placés. Se fier à sa présence faisait donc
   * annoncer `doors` « franchie en 400 s » avec 16 % du parcours parcouru — un tableau qui
   * ment est pire que pas de tableau.
   *
   * La seule marque d'une vraie arrivée est l'AVANCEMENT : `progres` vaut exactement 1
   * quand on atteint `finishZ`, et rien d'autre ne l'y porte. En survie, avoir tenu se lit
   * sur le temps comparé à la durée annoncée.
   */
  const survie = r.survie;
  const meilleur = Math.max(...r.classement.map((c) => c.progres));
  const arrive = survie
    ? (r.classement.find((c) => c.etat === 'qualifie' && c.temps >= duree(e)) ?? null)
    : (r.classement.find((c) => c.progres >= 1) ?? null);

  lignes.push({ id: e.id, nom: e.name, annonce: e.duree, arrive, meilleur, survie, duree: r.duree, mur });

  /*
   * UNE SURVIE DÉSIGNE TOUJOURS UN VAINQUEUR, et c'est la règle, pas un repli.
   *
   * « Le dernier tombé gagne » est la règle d'Hex-A-Gone, écrite dans `manche.js`. Tenir la
   * durée entière n'est qu'un des deux chemins. Afficher « non » parce que personne n'a
   * tenu les 75 s ferait passer pour un défaut ce qui est le fonctionnement voulu.
   *
   * Une COURSE, elle, n'a qu'un chemin : franchir la ligne. Si personne ne la franchit, le
   * vainqueur sort du repêchage — c'est-à-dire de la patience, pas du skill.
   */
  const legitime = survie || Boolean(arrive);
  const franchie = legitime ? '\x1b[32moui\x1b[0m       ' : '\x1b[31mnon\x1b[0m       ';
  const temps = arrive ? `${arrive.temps.toFixed(0)} s`.padEnd(9)
    : `\x1b[2m(${r.duree.toFixed(0)} s)\x1b[0m`.padEnd(17);
  const fait = survie
    ? (arrive ? `la durée de ${duree(e)} s a été tenue`
      : `vidée en ${r.duree.toFixed(0)} s — le dernier tombé gagne`)
    : `${Math.round(meilleur * 100)} % du parcours`;
  console.log(`  ${e.id.padEnd(9)}  ${String(e.duree).padEnd(9)}  ${franchie}  ${temps}  ${fait}`
    + `   \x1b[2m(${mur} s de calcul)\x1b[0m`);
}

/*
 * CE QUE LE TABLEAU DOIT DIRE, en une phrase.
 *
 * Une carte franchie sous le plafond produit de vrais vainqueurs. Une carte franchie
 * au-dessus du plafond n'en produira jamais en ligne. Une carte jamais franchie ne se
 * gagne que par repêchage, c'est-à-dire par patience.
 */
console.log('');
const jamais = lignes.filter((l) => !l.survie && !l.arrive);
const tardives = lignes.filter((l) => l.arrive && l.arrive.temps > PLAFOND_REEL);
const bonnes = lignes.filter((l) => l.survie || (l.arrive && l.arrive.temps <= PLAFOND_REEL));

console.log(`\x1b[1m${bonnes.length}/${lignes.length}\x1b[0m carte(s) désignent un vainqueur LÉGITIME sous le plafond`
  + ` : ${bonnes.map((l) => l.id).join(', ') || 'aucune'}`);
if (tardives.length) {
  console.log(`\x1b[33m${tardives.length}\x1b[0m franchie(s) APRÈS le plafond de ${PLAFOND_REEL} s`
    + ` : ${tardives.map((l) => `${l.id} (${l.arrive.temps.toFixed(0)} s)`).join(', ')}`);
}
if (jamais.length) {
  console.log(`\x1b[31m${jamais.length}\x1b[0m JAMAIS franchie(s) en ${DUREE} s`
    + ` : ${jamais.map((l) => `${l.id} (${Math.round(l.meilleur * 100)} %)`).join(', ')}`
    + '\n     — elles ne se gagnent que par repêchage, donc au chrono.');
}

// Et l'écart avec ce que le catalogue promet au joueur.
console.log('');
for (const l of lignes) {
  if (l.survie) continue;
  const dit = Number(String(l.annonce).replace(/\D/g, ''));
  const vrai = l.arrive ? l.arrive.temps : null;
  if (vrai === null) console.log(`  \x1b[2m${l.nom} annonce « ${l.annonce} » et n'a pas été terminée.\x1b[0m`);
  else if (vrai > dit * 2) console.log(`  \x1b[2m${l.nom} annonce « ${l.annonce} », mesurée à ${vrai.toFixed(0)} s.\x1b[0m`);
}
console.log('');
