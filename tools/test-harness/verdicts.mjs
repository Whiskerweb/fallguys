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
import { jouerPartie, creerPartie, survivants } from '../../serveur/src/partie.js';
import { creerSalon } from '../../serveur/src/salon.js';
import { creerMatchmaking } from '../../serveur/src/matchmaking.js';
import { creerInstance } from '../../serveur/src/instance.js';
import { MODES, ORDRE_MODES, ISSUES, PALIERS, tirerIssue } from '../../serveur/src/economie.js';
import { POLITIQUES, botsAutorises, formatDe, misePayable, BOTS } from '../../serveur/src/politique.js';
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
titre('2. L\'attente, et le départ à effectif réduit après un temps de calme');
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

  /*
   * LA RÈGLE DE DÉPART DE L'ARÈNE (décision produit du 2 septembre 2026) : seize, tout de
   * suite ; ou treize et plus, quand trente-cinq secondes passent sans nouvelle arrivée.
   * Douze ne partent jamais. Personne n'a rien à accepter — le ticket a annoncé le pot en
   * fourchette avant le clic. Les valeurs attendues sont posées à la main.
   */
  // ── le cas PRODUCTION : douze joueurs, figés — JAMAIS ────────────────────────
  maintenant = 2_000_000;
  const prod = creerSalon({ politique: 'PRODUCTION', mise: 1_000_000, graine: 3, horloge });
  for (let i = 0; i < 12; i++) prod.rejoindre(joueur(`j${i}`));
  dit(prod.resteAAttendre() === 15, 'le compte à rebours démarre au PREMIER joueur');
  dit(prod.departReduit() === null, 'à douze, aucun départ réduit n\'est annoncé');
  maintenant += 600_000;                       // dix minutes : largement au-delà de tout délai
  dit(!prod.pretAPartir(), 'douze joueurs, dix minutes : on ne part toujours pas (minimum 13)');

  // ── treize : le calme fait partir ──────────────────────────────────────────
  prod.rejoindre(joueur('j12'));
  const annonce = prod.departReduit();
  dit(annonce !== null && annonce.joueurs === 13 && annonce.manques === 3 && annonce.dans === 35,
    `à treize, le départ réduit est annoncé : ${annonce?.joueurs} joueurs, dans ${annonce?.dans} s`);
  dit(annonce?.pot === 13_000_000, `le pot annoncé est celui des présents : ${annonce?.pot / 1e6} USDG`);
  dit(!prod.pretAPartir(), 'mais on ne part pas tout de suite');
  maintenant += 20_000;
  dit(!prod.pretAPartir(), 'ni à 20 s de calme');
  prod.rejoindre(joueur('j13'));               // une arrivée remet le calme à zéro
  maintenant += 20_000;
  dit(!prod.pretAPartir() && prod.departReduit()?.dans === 15,
    'une arrivée REMET LE CALME À ZÉRO : 20 s plus tard il en reste 15');
  maintenant += 15_000;
  dit(prod.pretAPartir(), '35 s sans arrivée depuis le quatorzième : on part à quatorze');

  const compo = prod.composer();
  dit(compo.humains === 14 && compo.bots === 0 && !compo.complete,
    `14 humains, 0 bot, salon réduit — c'est une partie payante au barème de 14`);

  // ── seize : on part sans attendre le calme ─────────────────────────────────
  maintenant = 2_500_000;
  const plein = creerSalon({ politique: 'PRODUCTION', mise: 1_000_000, graine: 3, horloge });
  for (let i = 0; i < 16; i++) plein.rejoindre(joueur(`p${i}`));
  dit(plein.pretAPartir() && plein.departReduit() === null, 'à seize, on part tout de suite');

  // ── le squad et le 1v1 ne partent que PLEINS ────────────────────────────────
  const squad = creerSalon({ politique: 'PRODUCTION', mode: 'squad', mise: 1_000_000, graine: 3, horloge });
  for (let i = 0; i < 3; i++) squad.rejoindre(joueur(`s${i}`));
  maintenant += 600_000;
  dit(!squad.pretAPartir() && squad.departReduit() === null && squad.calme === null,
    'un squad à trois ne part jamais : le minimum EST la cible, aucun départ réduit');
  squad.rejoindre(joueur('s3'));
  dit(squad.pretAPartir(), 'à quatre, il part');

  // ── SOUS le minimum : rien n'est annoncé, et on ne part jamais ──────────────
  maintenant = 3_000_000;
  const maigre = creerSalon({ politique: 'PRODUCTION', mise: 1_000_000, graine: 3, horloge });
  maigre.rejoindre(joueur('a'));
  maigre.rejoindre(joueur('b'));
  maintenant += 600_000;
  dit(maigre.departReduit() === null,
    'sous le minimum, AUCUN départ annoncé — on n\'annonce jamais l\'impossible');
  dit(!maigre.pretAPartir(),
    `2 joueurs pour un minimum de ${formatDe(POLITIQUES.PRODUCTION, 'arena').minimum} : on ne part pas, quoi qu'ils en disent`);
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

  // LES CINQ CARTES, pas deux. Le repêchage est le chemin par lequel `doors` et `dalles`
  // sortent TOUJOURS — nos bots ne les ont jamais terminées — donc c'est sur elles qu'un
  // classement incomplet passerait inaperçu le plus longtemps.
  for (const id of ['course', 'doors', 'rondin', 'dalles', 'hexagone']) {
    const r = jouerManche({ epreuve: id, graine: 5, inscrits, qualifies: 4, dureeMax: 20 });
    const q = r.classement.filter((c) => c.etat === 'qualifie').length;
    dit(q === 4, `${id.padEnd(9)} : 4 qualifiés même quand PERSONNE ne finit (repêchage)`);
    dit(r.classement.length === 8, `${id.padEnd(9)} : les 8 joueurs sont classés`);
    const rangs = r.classement.map((c) => c.rang).sort((a, b) => a - b);
    dit(rangs.join(',') === '1,2,3,4,5,6,7,8', `${id.padEnd(9)} : les rangs vont de 1 à 8, sans trou ni doublon`);
  }
}

// ===========================================================================
titre('5 bis. Une place est une PLACE : jamais deux couronnes');
// ===========================================================================
/*
 * `places >= qualifies` arrête la manche, mais n'a jamais tronqué la liste des qualifiés.
 *
 * En survie, `t` est l'horloge de la MANCHE, la même pour tout le monde : au tick où elle
 * atteint la durée, TOUS les survivants étaient qualifiés d'un coup. En finale d'arène —
 * quatre joueurs, une place — Hexagone rendait donc jusqu'à quatre vainqueurs, que le
 * classement départageait ensuite par leur temps, identique, c'est-à-dire par rien.
 *
 * Dans une partie à mises, c'est la couronne et l'argent qui vont au mauvais joueur.
 */
{
  // Des pilotes INERTES sur Hexagone tiennent la durée entière sans consommer une seule
  // dalle : c'est exactement le cas qui produisait quatre vainqueurs.
  const inertes = Array.from({ length: 4 }, (_, i) => ({
    nom: `f${i}`,
    faire: () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) }),
  }));

  const r = jouerManche({ epreuve: 'hexagone', graine: 7, inscrits: inertes, qualifies: 1, dureeMax: 120 });
  const q = r.classement.filter((c) => c.etat === 'qualifie');
  dit(q.length === 1, `hexagone en finale : ${q.length} qualifié pour 1 place`);
  dit(r.qualifies.length === 1, `la liste des qualifiés en contient ${r.qualifies.length}, pas quatre`);
  dit(r.classement.length === 4 && r.classement[0].rang === 1,
    'les quatre joueurs sont classés, le vainqueur en tête');

  /*
   * ET IL EST DÉPARTAGÉ PAR UNE MESURE DE JEU, pas par l'ordre du tableau.
   *
   * Tous ont tenu la même durée : c'est l'ALTITUDE qui tranche, et sur une tour qui
   * s'effondre le plus haut a consommé le moins de dalles. Pour le prouver il faut que
   * l'altitude et l'ordre d'inscription se CONTREDISENT : on inscrit donc EN PREMIER un
   * joueur qui marche — il use ses dalles et descend d'un étage — et on garde trois
   * immobiles derrière lui.
   *
   * Avant le correctif, les quatre étaient qualifiés au même tick avec le même temps, le
   * comparateur rendait zéro, et le vainqueur était le premier du tableau : le marcheur.
   * Il doit maintenant perdre.
   *
   * (On ne peut pas inverser l'ordre d'inscription pour sonder la même chose : la grille
   * de départ dérive de l'index, donc l'inverser déplace les joueurs sur la tour et change
   * la physique. Ce serait une autre manche, pas la même dans un autre ordre.)
   */
  const marcheur = {
    nom: 'marcheur',
    faire: () => ({ entree: () => ({ x: 0, z: -1, jump: false, dive: false }) }),
  };
  const melange = [marcheur, ...inertes.slice(0, 3)];
  const r3 = jouerManche({ epreuve: 'hexagone', graine: 7, inscrits: melange, qualifies: 1, dureeMax: 120 });
  dit(r3.classement[0].nom !== 'marcheur',
    `celui qui a usé ses dalles ne gagne pas, même inscrit en premier `
    + `(vainqueur : ${r3.classement[0].nom})`);
  dit(r3.classement.filter((c) => c.etat === 'qualifie').length === 1,
    'et il n\'y a toujours qu\'une seule couronne');
}

// ===========================================================================
titre('5 ter. Les survivants gardent l\'ordre de la manche');
// ===========================================================================
/*
 * `encaisser()` ne faisait que FILTRER `enLice` : son ordre restait celui de la grille de
 * départ. Or le classement final se construit par `[...enLice, ...elimines.reverse()]` —
 * le rang 1 revenait donc à qui s'était inscrit le premier au salon.
 */
{
  // Des niveaux MELANGES : si l'ordre venait de l'inscription, un faible inscrit en
  // premier ressortirait devant un fort. C'est exactement ce qu'on veut voir echouer.
  const niveaux = ['faible', 'fort', 'faible', 'fort', 'moyen', 'fort', 'faible', 'moyen'];
  const seize = niveaux.map((niveau, i) => ({
    nom: `g${i}`,
    faire: (monde, perso, index) => creerBot({ monde, perso, index, graine: 11, niveau }),
  }));
  const partie = creerPartie({ graine: 11, inscrits: seize, dureeMax: 40 });
  partie.demarrer();

  let manche1 = null;
  for (let i = 0; i < 60 * 30 && !manche1; i++) {
    const e = partie.avancer();
    if (e.finManche) manche1 = e.finManche;
  }

  const ordreClassement = manche1.classement
    .filter((c) => c.etat === 'qualifie').map((c) => c.nom);
  const ordreEnLice = partie.enLice.map((i) => i.nom);
  dit(String(ordreEnLice) === String(ordreClassement),
    `les survivants sont dans l'ordre de la manche : ${ordreEnLice.join(' ')}`);
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

// ===========================================================================
titre('9. Trois modes, trois paliers, neuf files qui ne se melangent pas');
// ===========================================================================
/*
 * Un joueur qui engage 5 USDG en duel ne doit jamais se retrouver dans le pot d'un joueur
 * qui en a engage 2 en arene. Le pot serait indetermine et la table des gains ne voudrait
 * plus rien dire — c'est la meme raison qui separait deja les paliers, en plus fort : deux
 * modes n'ont ni le meme effectif, ni le meme nombre de manches, ni le meme bareme.
 */
{
  // La forme des files de PRODUCTION, sans backend : un banc doit dire que l'identité y
  // est facultative, sinon les files payantes sont fermées — et c'est voulu en production.
  const mm = creerMatchmaking({ politique: { ...POLITIQUES.PRODUCTION, identite: 'facultative' }, envoyer: () => {}, graine: 4242 });

  let n = 0;
  for (const mode of ORDRE_MODES) {
    for (const usdg of PALIERS) {
      mm.rejoindre({ nom: `j${n++}` }, usdg * 1_000_000, mode);
    }
  }
  const etat = mm.etat();
  dit(etat.salons.length === 9,
    `${n} joueurs, un par combinaison → ${etat.salons.length} files distinctes (attendu 9)`);
  dit(etat.salons.every((f) => f.joueurs === 1),
    'aucune file n\'en a ramasse deux : rien ne se melange');

  // Un mode invente ne doit pas ouvrir une file fantome que rien ne viderait jamais.
  const r = mm.rejoindre({ nom: 'tricheur' }, 2_000_000, 'jackpot');
  dit(r.accepte === false && r.raison === 'MODE_INCONNU',
    `un mode hors catalogue est refuse : ${r.raison}`);
  dit(mm.etat().salons.length === 9, 'et il n\'a laisse aucune file derriere lui');

  mm.arreter();
}

// ===========================================================================
/*
 * UNE MISE N'EST PRISE QUE LA OU UN BAREME LA PAIE.
 *
 * Le client regle un salon complet au bareme du MODE, un salon reduit au bareme de son
 * EFFECTIF — et ce second bareme n'existe pas sous trois joueurs. Une politique de banc
 * a effectif deux (`DUEL_TEST`) ouvre pourtant des « arenes » de deux : la partie se
 * jouait, puis le reglement jetait dans le gestionnaire de fin du client — vainqueur
 * renvoye au lobby sans ecran, perdant toujours en course. Vu en jouant, ticket reste sur
 * sa valeur par defaut (ARENA, 2 USDG), serveur lance sans `POLITIQUE=`.
 *
 * Les valeurs attendues sont posees a la main, mode par mode.
 */
{
  const M = 1_000_000;
  // Gratuit : tout passe, il n'y a rien a regler.
  dit(misePayable(POLITIQUES.DUEL_TEST, 'arena', 0) === true, 'DUEL_TEST, arene GRATUITE : acceptee');
  // DUEL_TEST a effectif deux : seul le duel se paie — complet a deux, au bareme du mode.
  dit(misePayable(POLITIQUES.DUEL_TEST, 'duel', 2 * M) === true, 'DUEL_TEST, duel a 2 USDG : accepte');
  dit(misePayable(POLITIQUES.DUEL_TEST, 'arena', 2 * M) === false, 'DUEL_TEST, arene a 2 USDG : REFUSEE — aucun bareme pour une arene de deux');
  dit(misePayable(POLITIQUES.DUEL_TEST, 'squad', 2 * M) === false, 'DUEL_TEST, squad a 2 USDG : REFUSE');
  // PRODUCTION : les trois modes se paient, sans que le format bouge.
  for (const mode of ORDRE_MODES) {
    dit(misePayable(POLITIQUES.PRODUCTION, mode, 10 * M) === true, `PRODUCTION, ${mode} a 10 USDG : accepte`);
  }
  dit(formatDe(POLITIQUES.PRODUCTION, 'arena', 10 * M).minimum === 13, 'PRODUCTION arene : le minimum reste 13 avec une mise');
  dit(formatDe(POLITIQUES.PRODUCTION, 'duel', 10 * M).minimum === 2, 'PRODUCTION duel : le minimum reste 2 — complet a deux, pas un salon reduit');
  // Une politique qui laisse partir a deux GRATUITEMENT exige trois des qu'un pot existe.
  const dev = { nom: 'X', modes: { arena: { cible: 16, minimum: 2 } } };
  dit(formatDe(dev, 'arena', 0).minimum === 2, 'arene a minimum 2, gratuite : part a deux');
  dit(formatDe(dev, 'arena', 2 * M).minimum === 3, 'la meme avec une mise : minimum releve a 3 — le plus petit effectif que `tableEffectif` paie');
  dit(misePayable(dev, 'arena', 2 * M) === true, 'et la mise y est acceptee : le salon peut atteindre trois');

  // Vu du matchmaking : refus nomme, aucune file ouverte derriere.
  const mm = creerMatchmaking({ politique: 'DUEL_TEST', envoyer: () => {}, graine: 7 });
  const r = mm.rejoindre({ nom: 'defaut' }, 2 * M, 'arena');
  dit(r.accepte === false && r.raison === 'MISE_IMPAYABLE', `le matchmaking refuse : ${r.raison}`);
  dit(mm.etat().salons.length === 0, 'et n\'ouvre aucune file');
  const d = mm.rejoindre({ nom: 'duelliste' }, 2 * M, 'duel');
  dit(d.accepte === true, 'le duel a 2 USDG, lui, entre en file');
  mm.arreter();
}

// ===========================================================================
titre('10. La roue tire A LA FIN, sur le serveur, et le salon ne promet plus rien');
// ===========================================================================
/*
 * Ceci a change de sens le 2 septembre 2026, par decision du directeur produit : la roue
 * tirait au salon (avant la mise, position juridique du § 5), elle tire desormais au
 * classement final. Ce bloc prouve trois choses :
 *
 *   1. le salon n'annonce PLUS de variante — un ticket qui promettrait une table certaine
 *      mentirait, puisque la ligne n'est tiree qu'a la fin ;
 *   2. la graine de roue arrive avec `fin-partie`, tient sur 32 bits, et le meme
 *      `tirerIssue` des deux cotes en derive la meme ligne ;
 *   3. deux parties n'ont pas la meme graine — elle vient du hasard cryptographique, pas
 *      de la graine de partie, qui est publiee des la manche 1.
 */
{
  const salon = creerSalon({ politique: 'PRODUCTION', mode: 'arena', mise: 2_000_000, graine: 25 });
  const premier = salon.etat();
  dit(premier.variante === undefined, 'le salon n\'annonce aucune variante : rien n\'est tire avant la partie');
  dit(premier.pot === 32_000_000 && premier.mode === 'arena',
    `il annonce le mode et le pot de la table pleine : ${premier.pot / 1e6} USDG`);
  dit(ORDRE_MODES.every((id) => ISSUES[id].length === 10), 'dix issues par mode, duel compris');

  // La graine de roue, vue du fil : deux duels en parallele, deux graines. Les instances
  // tournent en temps reel (manche de deux secondes, tranchee au chrono) : on attend leur
  // fin, pas une duree.
  const inerte = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });
  const lancerDuel = (k) => new Promise((resolve) => {
    const messages = [];
    const salonDuel = creerSalon({ politique: 'DUEL_TEST', mode: 'duel', mise: 2_000_000, graine: 4242 + k });
    salonDuel.rejoindre({ nom: 'a', faire: inerte });
    salonDuel.rejoindre({ nom: 'b', faire: inerte });
    const grille = salonDuel.composer();
    const instance = creerInstance({
      id: `roue-${k}`, graine: 99 + k, inscrits: grille.inscrits, dureeMax: 2,
      envoyer: (nom, m) => { if (nom === 'a' && !(m instanceof ArrayBuffer)) messages.push(m); },
      surFin: (resultat) => resolve({ messages, resultat }),
    });
    instance.demarrer();
  });
  const duels = await Promise.all([lancerDuel(0), lancerDuel(1)]);
  const graines = [];
  for (const { messages, resultat } of duels) {
    const fin = messages.find((m) => m.type === 'fin-partie');
    dit(Boolean(fin?.roue) && Number.isInteger(fin.roue.graine) && fin.roue.graine >= 0 && fin.roue.graine <= 0xFFFFFFFF,
      `fin-partie porte une graine de roue de 32 bits (${fin?.roue?.graine})`);
    dit(resultat?.roue?.graine === fin?.roue?.graine,
      'et le resultat garde la meme graine : ce que le backend recevra est ce que le client a vu');
    graines.push(fin?.roue?.graine);
  }
  dit(graines[0] !== graines[1], `deux parties, deux graines (${graines[0]} et ${graines[1]}) : le hasard n'est pas la graine de partie`);
  dit(tirerIssue('duel', 1).id === 'standard' && tirerIssue('arena', 25).id === 'royale' && tirerIssue('squad', 0).id === 'plat',
    'le serveur derive la meme ligne que le lobby et le backend : graine 1 → STANDARD, 25 → ROYALE, 0 → FLAT');

  // La pyramide d'elimination JOUEE est celle du mode PAYE. Une partie qui se joue en deux
  // manches et se paie en trois serait la pire panne possible : silencieuse, et sur l'argent.
  for (const id of ORDRE_MODES) {
    dit(String(survivants(MODES[id].joueurs)) === String(MODES[id].survivants),
      `${id} : le serveur joue ${MODES[id].survivants.join('→')} et se paie sur ${MODES[id].survivants.join('→')}`);
  }
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s ---`);
process.exit(ko === 0 ? 0 : 1);
