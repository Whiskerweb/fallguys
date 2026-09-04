/**
 * CE QUE LE SERVEUR ANNONCE AUX JOUEURS — l'identité, l'apparence, l'élimination.
 *
 * Ce fichier existe à cause d'une régression d'une seule ligne, et il vaut mieux le
 * raconter que de le résumer.
 *
 * Le personnage choisi par un joueur voyage du navigateur jusqu'à l'annonce de manche.
 * Toute la chaîne était correcte SAUF `salon.js`, qui recomposait chaque inscrit à partir
 * de trois champs et laissait tomber le quatrième. Rien ne cassait : le champ arrivait
 * `null`, et le client retombait poliment sur son ancien repli — l'apparence déduite du
 * numéro de siège. Chacun se voyait donc juste et voyait tous les autres de travers.
 *
 * Le duel à deux navigateurs, lui, VALIDAIT ce comportement quelques heures plus tôt. Un
 * test de bout en bout prouve que ça marche un jour ; il ne protège pas d'une ligne
 * changée le lendemain, parce qu'on ne le lance pas à chaque édition. D'où ce fichier :
 * les mêmes garanties, en quelques secondes, **en passant par le salon** — car c'est là
 * que le champ mourait, et un test qui fabriquerait les inscrits à la main ne verrait
 * rien.
 *
 * Usage : node annonce.mjs
 */

import { preparer } from '../../serveur/src/monde.js';
import { creerSalon } from '../../serveur/src/salon.js';
import { creerInstance } from '../../serveur/src/instance.js';
import { POLITIQUES } from '../../serveur/src/politique.js';
import { creerManche } from '../../serveur/src/manche.js';
import { creerBot } from '../../serveur/src/pilotes/bot.js';
import { HZ as HZ_MANCHE } from '../../serveur/src/manche.js';
import { HZ as HZ_PROTOCOLE } from '../feel-lab/src/enligne/protocole.js';

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const t0 = Date.now();
await preparer();

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const inerte = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });

// ===========================================================================
titre('1. Le personnage choisi survit à la composition du salon');
// ===========================================================================
{
  /*
   * On passe par `creerSalon().composer()` et non par un tableau d'inscrits écrit à la
   * main : c'est exactement le maillon où le champ se perdait.
   */
  const salon = creerSalon({ politique: POLITIQUES.DUEL_TEST, mode: 'duel', mise: 0, graine: 7 });
  salon.rejoindre({ nom: 'alice', modele: 'char-babytrump', faire: inerte });
  salon.rejoindre({ nom: 'bob', modele: 'char-techtitan', faire: inerte });

  const grille = salon.composer();
  const par = new Map(grille.inscrits.map((i) => [i.nom, i.modele]));
  console.log(`     composition : ${grille.inscrits.map((i) => `${i.nom}=${i.modele}`).join(' · ')}`);

  dit(par.get('alice') === 'char-babytrump' && par.get('bob') === 'char-techtitan',
    'chaque inscrit porte le personnage qu\'il a choisi (le salon ne le jette plus)');
}

// ===========================================================================
titre('2. …et il arrive jusqu\'à l\'annonce de manche');
// ===========================================================================
{
  const salon = creerSalon({ politique: POLITIQUES.DUEL_TEST, mode: 'duel', mise: 0, graine: 7 });
  salon.rejoindre({ nom: 'alice', modele: 'char-babytrump', faire: inerte });
  salon.rejoindre({ nom: 'bob', modele: 'char-techtitan', faire: inerte });
  const grille = salon.composer();

  // On capte ce que le serveur ENVOIE vraiment : c'est la seule chose que le client verra.
  const annonces = [];
  const inst = creerInstance({
    id: 'ANNONCE', graine: 4242, inscrits: grille.inscrits, dureeMax: 60,
    envoyer: (nom, msg) => { if (msg?.type === 'manche') annonces.push(msg); },
  });
  inst.demarrer();
  await dormir(300);
  inst.arreter();

  const roster = annonces[0]?.joueurs ?? [];
  console.log(`     annonce : ${roster.map((j) => `${j.nom}=${j.modele}`).join(' · ')}`);
  dit(roster.length === 2, 'la composition est annoncée aux deux joueurs');
  dit(roster.find((j) => j.nom === 'alice')?.modele === 'char-babytrump'
    && roster.find((j) => j.nom === 'bob')?.modele === 'char-techtitan',
    'l\'annonce porte le personnage de CHACUN — sans quoi le client déduit l\'apparence du siège');
}

// ===========================================================================
titre('3. Un joueur éliminé s\'ARRÊTE');
// ===========================================================================
{
  /*
   * Le défaut rapporté en jouant : « sur THE HEX, quand un des deux tombe, il n'est pas
   * éliminé, il tombe à l'infini ».
   *
   * Le serveur l'éliminait pourtant correctement dès `killY`. Mais un coureur qui a fini
   * n'est plus passé à `avancerTick` — donc plus borné par `limiterVitesse()` — pendant
   * que son corps rigide, lui, restait soumis à la gravité. Mesuré avant correctif :
   * −31 m à l'élimination, −802 m deux cents ticks plus tard. Et comme les instantanés
   * publient aussi les éliminés, le joueur recevait sa propre chute et la correction l'y
   * suivait.
   *
   * On avance la manche TICK PAR TICK, sans horloge : c'est déterministe et instantané.
   */
  const inerte2 = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });
  const m = creerManche({
    epreuve: 'hexagone', graine: 4242, qualifies: 1, dureeMax: 90,
    inscrits: [
      { nom: 'a', estBot: false, faire: inerte2 },
      { nom: 'b', estBot: false, faire: inerte2 },
    ],
  });

  const vu = new Map();   // nom -> { premier, dernier }
  for (let t = 0; t < 3000; t++) {
    const fini = m.avancer();
    for (const c of m.etatCoureurs()) {
      if (c.etat !== 'elimine') continue;
      if (!vu.has(c.nom)) vu.set(c.nom, { premier: c.y, dernier: c.y, tick: t });
      vu.get(c.nom).dernier = c.y;
    }
    if (fini) break;
  }

  let pire = 0;
  for (const [nom, e] of vu) {
    const derive = Math.abs(e.dernier - e.premier);
    pire = Math.max(pire, derive);
    console.log(`     ${nom} éliminé au tick ${e.tick} à y=${e.premier.toFixed(2)}`
      + ` · dernier relevé y=${e.dernier.toFixed(2)} · dérive ${derive.toFixed(2)} m`);
  }
  dit(vu.size > 0, 'des joueurs sont bien éliminés en tombant sur Les Hexagones');
  // Un mètre de tolérance : le tick de l'élimination lui-même peut encore bouger un peu.
  dit(pire < 1, `un corps éliminé ne tombe plus — dérive maximale ${pire.toFixed(2)} m (avant : 800 m)`);
}

// ===========================================================================
titre('4. L\'élimination est annoncée PENDANT la manche');
// ===========================================================================
{
  /*
   * Le seul événement de manche était `fin-manche`, envoyé quand la manche entière
   * s'achève. Un joueur sorti en cours de route n'apprenait donc rien.
   *
   * Il faut deux joueurs qui tombent à des MOMENTS DIFFÉRENTS : quand les deux tombent au
   * même tick, la manche se clôt dans la foulée et il n'y a plus rien à annoncer.
   */
  const inerte2 = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });
  const bon = (monde, perso, idx) => creerBot({ monde, perso, index: idx, graine: 4, niveau: 'fort' });

  const recues = [];
  const inst = creerInstance({
    id: 'SORTI', graine: 4, dureeMax: 90,        // graine 4 → Les Hexagones
    inscrits: [
      { nom: 'survivant', estBot: false, modele: 'char-babytrump', faire: bon },
      { nom: 'immobile', estBot: false, modele: 'char-techtitan', faire: inerte2 },
    ],
    envoyer: (nom, msg) => { if (msg?.type === 'sorti' && nom === 'survivant') recues.push(msg); },
  });
  inst.demarrer();
  await dormir(25000);
  inst.arreter();

  console.log(`     annonces reçues : ${recues.map((r) => `${r.nom}=${r.etat}`).join(' · ') || '(aucune)'}`);
  dit(recues.some((r) => r.nom === 'immobile' && r.etat === 'elimine'),
    'les joueurs encore en course apprennent qu\'un adversaire est sorti');
}

// ===========================================================================
titre('5. Le chrono de manche laisse le temps de finir');
// ===========================================================================
{
  /*
   * Un joueur a vu « VICTORY » au MILIEU de THE DOORS. Cause : à l'expiration du chrono,
   * tout le monde est éliminé puis repêché par progression — le plus avancé gagne, même
   * loin de l'arrivée. À 180 s ce n'était pas un cas limite : mesuré avec les bots forts,
   * rondin demande 316 s, et doors comme dalles ne sont jamais terminées.
   *
   * On garde délibérément la règle du repêchage — c'est un arbitrage produit. On donne
   * simplement à une manche le temps d'aller à son terme.
   */
  for (const nom of ['PRODUCTION', 'DUEL_TEST', 'BANC']) {
    const d = POLITIQUES[nom].dureeManche;
    dit(d >= 360, `${nom} laisse ${d} s à une manche — rondin en demande 316`);
  }
}

// ===========================================================================
titre('6. Le client et le serveur comptent le temps à la même cadence');
// ===========================================================================
{
  /*
   * Le décor s'anime en fonction du temps écoulé, et cette animation déplace de VRAIS
   * colliders : sur Le Rondin, `angleA(elapsed) = phase + omega * elapsed` fixe à la fois
   * le visuel du tronc et sa rotation physique.
   *
   * Le client comptait ce temps depuis l'ouverture de la page, le serveur depuis le début
   * de la manche. Les troncs n'étaient donc pas au même angle : « je me prends des
   * obstacles invisibles ». Le client convertit désormais le tick autoritaire en secondes
   * — encore faut-il que les deux côtés s'accordent sur la cadence.
   *
   * Deux constantes qui doivent être égales ne le restent que si un test le dit. C'est le
   * même traitement que la table des gains, pour la même raison.
   */
  console.log(`     manche.js : ${HZ_MANCHE} Hz · protocole.js : ${HZ_PROTOCOLE} Hz`);
  dit(HZ_MANCHE === HZ_PROTOCOLE,
    'la cadence déclarée par le protocole est celle que le serveur joue vraiment');
}

// ===========================================================================
titre('7. En SURVIE, le dernier debout gagne tout de suite');
// ===========================================================================
{
  /*
   * Rapporté deux fois en jouant, et le diagnostic du directeur produit était le bon :
   *
   *   « tous les jeux ont un système de ligne d'arrivée. Alors que là, il y a un système
   *     de mort. Le sol, c'est comme de la lave. C'est un système inversé. »
   *
   * La condition de fin de manche disait `places >= qualifies` — la règle d'une COURSE, où
   * l'on gagne en franchissant quelque chose. En survie, on gagne parce que les autres sont
   * tombés, et `places` reste à zéro. Le duel continuait donc après la chute du premier :
   * le survivant jouait seul jusqu'à tomber à son tour, et les deux finissaient éliminés à
   * l'écran, sans vainqueur apparent.
   */
  const inerte2 = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });
  const bon = (monde, perso, idx) => creerBot({ monde, perso, index: idx, graine: 4, niveau: 'fort' });

  const m = creerManche({
    epreuve: 'hexagone', graine: 4242, qualifies: 1, dureeMax: 90,
    inscrits: [
      { nom: 'survivant', estBot: false, faire: bon },
      { nom: 'tombe', estBot: false, faire: inerte2 },
    ],
  });

  const sorties = [];
  let tick = 0;
  let fini = false;
  while (tick < 3000 && !fini) {
    fini = m.avancer();
    tick++;
    for (const c of m.etatCoureurs()) {
      if (c.etat !== 'court' && !sorties.some((s) => s.nom === c.nom)) {
        sorties.push({ nom: c.nom, etat: c.etat, tick });
      }
    }
  }

  const chute = sorties.find((s) => s.nom === 'tombe');
  const debout = sorties.find((s) => s.nom === 'survivant');
  const classement = m.resultat.classement;

  console.log(`     manche close à ${(tick / 30).toFixed(1)} s · ${sorties.map((s) => `${s.nom}=${s.etat}`).join(' · ')}`);

  dit(chute?.etat === 'elimine', 'celui qui touche le sol est éliminé');
  /*
   * Le cœur du correctif : la manche s'arrête dans la foulée. La durée de survie est de
   * 75 s ; sans ça, le survivant jouait seul pendant une minute pour rien.
   */
  dit(debout?.etat === 'qualifie' && Math.abs(debout.tick - chute.tick) < 30,
    'le dernier debout est QUALIFIÉ dans la seconde, pas éliminé puis repêché');
  dit(tick / 30 < 30, `la manche s'arrête aussitôt (${(tick / 30).toFixed(1)} s, pas 75)`);
  dit(classement[0]?.nom === 'survivant' && classement[0]?.etat === 'qualifie',
    'et le classement lui donne la première place');
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s ---`);
process.exit(ko === 0 ? 0 : 1);
