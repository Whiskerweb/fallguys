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
import { POLITIQUES, botsAutorises, BOTS } from '../../serveur/src/politique.js';
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
 *
 * La garantie tient à DEUX tests indépendants — la politique, et la mise —, et c'est
 * délibéré : une garantie qui tient à un seul test tient à une seule faute de frappe.
 */
{
  const pilote = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });
  const joueur = (nom) => ({ nom, faire: pilote });

  const banc = creerSalon({ politique: 'BANC', mise: 0, graine: 1 });
  banc.rejoindre(joueur('seul'));
  const g = banc.composer();
  dit(g.bots === 15 && g.complete, `BANC, partie gratuite : 1 humain complété par ${g.bots} bots`);

  // 1er test : la POLITIQUE interdit.
  for (const nom of ['PRODUCTION', 'DUEL_TEST']) {
    dit(POLITIQUES[nom].bots === BOTS.JAMAIS, `${nom} : les bots sont interdits par la politique`);
    dit(botsAutorises(POLITIQUES[nom], 0) === false,
      `${nom} : même en partie GRATUITE, aucun bot`);
  }

  // 2e test : la MISE interdit, même sous une politique qui les autoriserait.
  for (const mise of [1_000_000, 250_000, 1]) {
    dit(botsAutorises(POLITIQUES.BANC, mise) === false,
      `mise de ${mise} micros : aucun bot, même sous BANC`);
    const paye = creerSalon({ politique: 'BANC', mise, graine: 1 });
    paye.rejoindre(joueur('joueur'));
    const r = paye.composer();
    dit(r.bots === 0 && r.raison === 'AUCUN_BOT_AUTORISE',
      `  → le salon part à ${r.humains} joueur(s), sans bot`);
  }

  // Aucune politique ne doit pouvoir dire « toujours » : la valeur n'existe pas.
  dit(!Object.values(BOTS).includes('toujours'),
    'il n\'existe aucune valeur autorisant les bots inconditionnellement');
}

// ===========================================================================
titre('2. L\'attente, et la proposition de partir à effectif réduit');
// ===========================================================================
{
  const pilote = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });
  const joueur = (nom) => ({ nom, faire: pilote });

  // Horloge factice : sans elle, éprouver soixante secondes d'attente coûterait soixante
  // secondes, et personne ne lancerait cette suite.
  let maintenant = 1_000_000;
  const horloge = () => maintenant;

  const banc = creerSalon({ politique: 'BANC', mise: 0, graine: 7, horloge });
  dit(banc.resteAAttendre() === null, 'un salon vide n\'attend rien : le compte à rebours n\'a pas commencé');

  // ── le cas PRODUCTION : douze joueurs, figés ────────────────────────────────
  maintenant = 2_000_000;
  const prod = creerSalon({ politique: 'PRODUCTION', mise: 1_000_000, graine: 3, horloge });
  for (let i = 0; i < 12; i++) prod.rejoindre(joueur(`j${i}`));
  dit(prod.resteAAttendre() === 15, 'le compte à rebours démarre au PREMIER joueur');
  dit(prod.proposition() === null, 'aucune proposition tant que le délai n\'est pas écoulé');
  dit(!prod.pretAPartir(), 'on ne part pas pendant l\'attente');

  maintenant += 60_000;
  const offre = prod.proposition();
  dit(offre !== null && offre.joueurs === 12 && offre.manques === 4,
    `à 60 s, on propose de partir à ${offre?.joueurs} au lieu de ${offre?.cible}`);
  dit(offre?.pot === 12_000_000, `le pot annoncé est celui des présents : ${offre?.pot / 1e6} USDC`);

  dit(!prod.pretAPartir(), 'la proposition seule ne suffit pas : il faut l\'accord de tous');
  for (let i = 0; i < 11; i++) prod.accepter(`j${i}`);
  dit(!prod.pretAPartir(), '11 accords sur 12 ne suffisent pas non plus');
  prod.accepter('j11');
  dit(prod.pretAPartir(), 'les 12 accords obtenus, on part');

  const compo = prod.composer();
  dit(compo.humains === 12 && compo.bots === 0, `12 humains, 0 bot — c'est une partie payante`);

  // ── SOUS le minimum : on ne propose rien, et on ne part jamais ──────────────
  maintenant = 3_000_000;
  const maigre = creerSalon({ politique: 'PRODUCTION', mise: 1_000_000, graine: 3, horloge });
  maigre.rejoindre(joueur('a'));
  maigre.rejoindre(joueur('b'));
  maintenant += 600_000;                       // dix minutes : largement au-delà de tout délai
  dit(maigre.proposition() === null,
    'sous le minimum, AUCUNE proposition — on ne propose jamais l\'impossible');
  dit(!maigre.pretAPartir(),
    `2 joueurs pour un minimum de ${POLITIQUES.PRODUCTION.minimum} : on ne part pas, quoi qu'ils en disent`);
  dit(maigre.etat().sousLeMinimum === true, 'le salon le dit clairement à l\'interface');

  // ── DUEL_TEST : deux machines, deux comptes, et ça part ─────────────────────
  maintenant = 4_000_000;
  const duel = creerSalon({ politique: 'DUEL_TEST', mise: 0, graine: 3, horloge });
  duel.rejoindre(joueur('machine-1'));
  dit(!duel.pretAPartir(), 'un duel à un seul joueur n\'est pas un duel');
  duel.rejoindre(joueur('machine-2'));
  dit(duel.pretAPartir(), 'DUEL_TEST : à deux, le salon est PLEIN et part sans attendre');
  const d = duel.composer();
  dit(d.humains === 2 && d.bots === 0, 'un duel se joue à deux vrais joueurs, sans aucun bot');

  // ── une arrivée en cours de route ──────────────────────────────────────────
  maintenant = 5_000_000;
  const flux = creerSalon({ politique: 'PRODUCTION', mise: 0, graine: 3, horloge });
  flux.rejoindre(joueur('x'));
  maintenant += 8000;
  flux.rejoindre(joueur('y'));
  dit(Math.round(flux.resteAAttendre()) === 7,
    'une arrivée NE REPOUSSE PAS le départ (sinon le salon n\'ouvrirait jamais)');
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

  const salon = creerSalon({ politique: 'BANC', mise: 0, graine: 4242 });
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
titre('7. Les petits effectifs se jouent vraiment');
// ===========================================================================
/*
 * Le cas d'usage réel du moment : deux machines, deux comptes, et ça doit marcher.
 *
 * On ne complète PAS avec des bots — c'est tout l'intérêt. Un duel joue le vrai chemin de
 * code, avec deux vrais pilotes, et il n'y aura rien à démonter le jour où les bots
 * disparaissent. La partie s'adapte à l'effectif : deux joueurs disputent une finale,
 * quatre disputent une demie puis une finale.
 */
{
  const pilote = () => ({
    // Un pilote minimal qui avance : de quoi produire un classement, pas de quoi gagner.
    entree: () => ({ x: 0, z: -1, jump: false, dive: false }),
  });

  for (const [effectif, manchesAttendues] of [[2, 1], [3, 2], [4, 2], [6, 3]]) {
    const inscrits = Array.from({ length: effectif }, (_, i) => ({ nom: `j${i}`, faire: pilote }));
    const r = jouerPartie({ graine: 31337, inscrits, dureeMax: 25 });

    dit(r.manches.length === manchesAttendues,
      `${effectif} joueurs → ${r.manches.length} manche(s) : ${r.parcours.join(' → ')}`);
    dit(r.classement.length === effectif, `  les ${effectif} joueurs sont classés`);
    dit(r.classement[0].rang === 1 && r.classement[effectif - 1].rang === effectif,
      `  les rangs vont de 1 à ${effectif}`);
    dit(new Set(r.classement.map((c) => c.nom)).size === effectif, '  chacun une seule fois');
    dit(r.classement.every((c) => !c.estBot), '  aucun bot dans la partie');
  }
}

// ===========================================================================
titre('8. Les trois niveaux de bot — mesure, sans verdict');
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
