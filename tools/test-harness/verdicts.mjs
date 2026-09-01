/**
 * LES VERDICTS DU SERVEUR DE JEU.
 *
 * Aucun navigateur, aucun réseau, aucune installation : la simulation entière tourne dans
 * ce processus. C'est ce qui rend une partie de seize joueurs vérifiable — personne ne
 * peut en tester une à la main, et c'est pour cela que la spec range ce harnais en
 * « priorité n°1, livrable de première semaine » (section 6.6).
 *
 * Quatre choses à prouver, par ordre d'importance :
 *
 *   1. AUCUN BOT DANS UNE PARTIE PAYANTE. C'est une règle juridique avant d'être une
 *      règle de jeu, et c'est le seul verdict de ce fichier dont l'échec interdirait de
 *      livrer.
 *   2. LE DÉTERMINISME. Même graine, même classement. Sans lui, aucun replay ne reproduit
 *      rien et aucun litige n'est arbitrable.
 *   3. LE SERVEUR JOUE VRAIMENT LES CINQ CARTES, avec le code du client.
 *   4. UNE PARTIE PRODUIT UN CLASSEMENT VALIDE : chaque joueur une fois, rangs 1..N.
 *
 * Usage : node verdicts.mjs
 */

import { preparer, construire, creerPerso, epreuves, liberer } from '../../serveur/src/monde.js';
import { avancerTick } from '../../serveur/src/tick.js';
import { jouerManche } from '../../serveur/src/manche.js';
import { jouerPartie, survivants } from '../../serveur/src/partie.js';
import { creerSalon } from '../../serveur/src/salon.js';
import { creerBot } from '../../serveur/src/pilotes/bot.js';

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const t0 = Date.now();
await preparer();

// ===========================================================================
titre('1. Aucun bot dans une partie payante');
// ===========================================================================
/*
 * Le verdict le plus important du fichier. Toute la qualification « compétition de
 * skill » repose sur le fait qu'aucune machine ne décide de l'issue ; payer un joueur
 * selon son classement face à des bots serait précisément ce qu'un régulateur regarde.
 */
{
  const gratuit = creerSalon({ taille: 16, attente: 0, mise: 0, graine: 1 });
  gratuit.rejoindre({ nom: 'seul', faire: () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) }) });
  const g = gratuit.composer();
  dit(g.bots === 15 && g.complete,
    `partie GRATUITE : 1 humain complété par ${g.bots} bots`);

  for (const mise of [1_000_000, 250_000, 1]) {
    const paye = creerSalon({ taille: 16, attente: 0, mise, graine: 1 });
    paye.rejoindre({ nom: 'joueur', faire: () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) }) });
    const r = paye.composer();
    dit(r.bots === 0 && !r.complete && r.raison === 'MISE_NON_NULLE_AUCUN_BOT',
      `mise de ${mise} micros : AUCUN bot convoqué, la partie part à ${r.humains}`);
  }

  const paye = creerSalon({ mise: 1_000_000 });
  dit(paye.botsAutorises() === false, 'un salon payant se déclare lui-même interdit aux bots');
}

// ===========================================================================
titre('2. L\'attente de quinze secondes');
// ===========================================================================
{
  // Horloge factice : sans elle, éprouver quinze secondes d'attente coûterait quinze
  // secondes, et personne ne lancerait cette suite.
  let maintenant = 1_000_000;
  const horloge = () => maintenant;
  const salon = creerSalon({ taille: 16, attente: 15, mise: 0, graine: 7, horloge });

  dit(salon.resteAAttendre() === null, 'un salon vide n\'attend rien : le compte à rebours n\'a pas commencé');

  salon.rejoindre({ nom: 'premier', faire: () => ({ entree: () => ({}) }) });
  dit(salon.resteAAttendre() === 15, 'le compte à rebours démarre au PREMIER joueur');
  dit(!salon.pretAPartir(), 'on ne part pas tant que l\'attente court');

  maintenant += 8000;
  salon.rejoindre({ nom: 'second', faire: () => ({ entree: () => ({}) }) });
  dit(Math.round(salon.resteAAttendre()) === 7,
    'une arrivée en cours de route NE REPOUSSE PAS le départ (sinon le salon n\'ouvrirait jamais)');

  maintenant += 7000;
  dit(salon.resteAAttendre() === 0 && salon.pretAPartir(), 'à quinze secondes, on part');

  const r = salon.composer();
  dit(r.humains === 2 && r.bots === 14 && r.complete,
    `2 humains + ${r.bots} bots = ${r.humains + r.bots} joueurs`);

  // Un salon plein part tout de suite : personne n'attend pour rien.
  const plein = creerSalon({ taille: 2, attente: 15, mise: 0, horloge });
  plein.rejoindre({ nom: 'a', faire: () => ({}) });
  plein.rejoindre({ nom: 'b', faire: () => ({}) });
  dit(plein.pretAPartir(), 'un salon PLEIN part sans attendre la fin du compte à rebours');
}

// ===========================================================================
titre('3. Le serveur joue les cinq cartes, avec le code du client');
// ===========================================================================
{
  for (const e of epreuves()) {
    const monde = construire(e.id, 4242);
    const persos = Array.from({ length: 16 }, (_, i) => creerPerso(monde, i, 16));
    const acteurs = persos.map((perso) => ({ perso, entree: { x: 0, z: 0, jump: false, dive: false } }));

    // Le décompte pose les personnages. C'est aussi ce qui construit la structure
    // d'accélération de Rapier : avant le premier pas, un rayon ne touche RIEN.
    for (let i = 0; i < 90; i++) avancerTick(monde, acteurs, i / 30, 1 / 30, false);

    const poses = persos.filter((p) => Number.isFinite(p.position.y) && p.position.y > monde.killY).length;
    dit(poses === 16, `${e.id.padEnd(9)} : 16 personnages posés et finis (aucun NaN, aucun tombé)`);
    for (const p of persos) p.dispose?.();
    liberer(monde);
  }
}

// ===========================================================================
titre('4. Déterminisme : même graine, même classement');
// ===========================================================================
{
  const NIV = ['fort', 'moyen', 'faible', 'fort', 'moyen', 'faible', 'fort', 'moyen'];
  const inscrits = (g) => NIV.map((niveau, i) => ({
    nom: `${niveau}-${i}`,
    faire: (monde, perso, index) => creerBot({ monde, perso, index, graine: g, niveau }),
  }));
  const cle = (r) => r.classement.map((x) => `${x.nom}:${x.rang}:${x.progres}`).join('|');

  for (const id of epreuves().map((e) => e.id)) {
    const a = jouerManche({ epreuve: id, graine: 2024, inscrits: inscrits(2024), qualifies: 4, dureeMax: 60 });
    const b = jouerManche({ epreuve: id, graine: 2024, inscrits: inscrits(2024), qualifies: 4, dureeMax: 60 });
    dit(cle(a) === cle(b), `${id.padEnd(9)} : deux manches de même graine sont identiques`);
  }

  const x = jouerManche({ epreuve: 'course', graine: 111, inscrits: inscrits(111), qualifies: 4, dureeMax: 60 });
  const y = jouerManche({ epreuve: 'course', graine: 222, inscrits: inscrits(222), qualifies: 4, dureeMax: 60 });
  dit(cle(x) !== cle(y), 'deux graines différentes donnent deux manches différentes');
}

// ===========================================================================
titre('5. Une manche pourvoit toujours ses places');
// ===========================================================================
{
  const inscrits = Array.from({ length: 8 }, (_, i) => ({
    nom: `p${i}`,
    // Des pilotes INERTES : personne ne franchit la ligne, personne ne tient la durée.
    // C'est le cas limite qui compte — il doit quand même sortir un classement complet.
    faire: () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) }),
  }));

  for (const id of ['course', 'hexagone']) {
    const r = jouerManche({ epreuve: id, graine: 5, inscrits, qualifies: 4, dureeMax: 20 });
    const q = r.classement.filter((c) => c.etat === 'qualifie').length;
    dit(q === 4, `${id.padEnd(9)} : 4 qualifiés même quand PERSONNE ne finit (repêchage)`);
    dit(r.classement.length === 8, `${id.padEnd(9)} : les 8 joueurs sont classés`);
    const rangs = r.classement.map((c) => c.rang).sort((a, b) => a - b);
    dit(rangs.join(',') === '1,2,3,4,5,6,7,8', `${id.padEnd(9)} : les rangs vont de 1 à 8, sans trou ni doublon`);
  }
}

// ===========================================================================
titre('6. Une partie complète : trois manches, une couronne');
// ===========================================================================
{
  dit(survivants(16).join(',') === '8,4,1', `16 joueurs → ${survivants(16).join(' → ')}`);
  dit(survivants(8).join(',') === '4,2,1', `8 joueurs → ${survivants(8).join(' → ')}`);

  /*
   * La VRAIE propriété, celle que `MatchConfiguration.Validate()` exige côté C# : une
   * suite strictement décroissante, qui finit sur un vainqueur unique et qui élimine dès
   * la première manche. On la vérifie sur tous les effectifs plausibles plutôt que sur
   * trois cas écrits à la main — c'est elle qui fera tenir les salons réduits du
   * démarrage à froid.
   */
  let suitesValides = true;
  const details = [];
  for (let n = 4; n <= 24; n++) {
    const s = survivants(n);
    const decroit = s.every((v, i) => i === 0 || v < s[i - 1]);
    const finit = s[s.length - 1] === 1;
    const elimine = s[0] < n;
    if (!(decroit && finit && elimine)) { suitesValides = false; details.push(`${n} → ${s.join(',')}`); }
  }
  dit(suitesValides, `de 4 à 24 joueurs, la pyramide décroît strictement et finit sur un vainqueur`
    + (details.length ? ` — fautives : ${details.join(' · ')}` : ''));

  const salon = creerSalon({ taille: 16, attente: 0, mise: 0, graine: 4242 });
  salon.rejoindre({ nom: 'humain', faire: () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) }) });
  const grille = salon.composer();

  const r = jouerPartie({ graine: 4242, inscrits: grille.inscrits, dureeMax: 120 });
  dit(r.manches.length === 3, `${r.manches.length} manches jouées : ${r.parcours.join(' → ')}`);
  dit(new Set(r.parcours).size === 3, 'les trois épreuves sont différentes');
  dit(r.classement.length === 16, 'les 16 joueurs figurent au classement final');
  dit(new Set(r.classement.map((c) => c.nom)).size === 16, 'chacun n\'y figure qu\'une fois');
  dit(r.classement[0].rang === 1 && r.classement[15].rang === 16, 'les rangs vont de 1 à 16');
}

// ===========================================================================
titre('7. Les trois niveaux de bot — mesure, sans verdict');
// ===========================================================================
/*
 * PAS DE VERDICT ICI, ET C'EST DÉLIBÉRÉ.
 *
 * L'ordre fort > moyen > faible tient sur La Course — la carte dont le pilote est issu —
 * et pas encore sur les quatre autres. Poser un verdict qui échoue quatre fois sur cinq
 * n'apprendrait rien à personne et finirait par être ignoré ; poser un verdict mou
 * (« l'ordre tient au moins une fois ») serait pire, parce qu'il donnerait l'illusion
 * d'une garantie.
 *
 * On MESURE donc, on affiche, et on laisse le chiffre dire où en est le pilote. Le jour
 * où l'ordre tiendra partout, ce bloc deviendra un verdict.
 */
{
  const NIV = ['fort', 'fort', 'fort', 'fort', 'fort',
    'moyen', 'moyen', 'moyen', 'moyen', 'moyen', 'moyen',
    'faible', 'faible', 'faible', 'faible', 'faible'];
  for (const id of epreuves().map((e) => e.id)) {
    const inscrits = NIV.map((niveau, i) => ({
      nom: `${niveau}-${i}`,
      faire: (monde, perso, index) => creerBot({ monde, perso, index, graine: 777, niveau }),
    }));
    const r = jouerManche({ epreuve: id, graine: 777, inscrits, qualifies: 8, dureeMax: 100 });
    const moy = {};
    for (const c of r.classement) (moy[c.nom.split('-')[0]] ??= []).push(c.rang);
    const m = (n) => (moy[n].reduce((a, b) => a + b, 0) / moy[n].length).toFixed(1);
    const ordonne = Number(m('fort')) < Number(m('moyen')) && Number(m('moyen')) < Number(m('faible'));
    console.log(`     ${id.padEnd(9)} rang moyen · fort ${m('fort').padStart(4)}`
      + ` · moyen ${m('moyen').padStart(4)} · faible ${m('faible').padStart(4)}`
      + `   ${ordonne ? '\x1b[32mordre respecté\x1b[0m' : '\x1b[33mordre non respecté\x1b[0m'}`);
  }
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s ---`);
process.exit(ko === 0 ? 0 : 1);
