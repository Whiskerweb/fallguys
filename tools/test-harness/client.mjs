/**
 * LA BOUCLE COMPLÈTE — vrais modules client, vrai serveur, vraie WebSocket.
 *
 * `reseau.mjs` prouve que le serveur tient sa cadence, avec des clients factices qui ne
 * simulent rien. Ce harnais-ci va plus loin : il fait tourner `session.js`, `lien.js`,
 * `reconciliation.js` — le code que le navigateur exécutera — et il PRÉDIT localement,
 * exactement comme un joueur.
 *
 * Ce qu'on cherche à mesurer, et qui ne se voit nulle part ailleurs : **l'écart entre ce
 * que le client prédit et ce que le serveur arbitre**. C'est le seul chiffre qui dit si la
 * prédiction vaut quelque chose. Un écart qui reste sous quelques centimètres signifie que
 * le joueur voit son personnage au bon endroit sans attendre le réseau ; un écart qui
 * croît signifie que les deux simulations divergent, et qu'il faudra corriger sans arrêt.
 *
 * Le client tourne ici sans navigateur, avec les mêmes doublures que le serveur. C'est
 * possible pour une raison précise : la prédiction n'est QUE de la simulation, et la
 * simulation ne rend rien à l'écran.
 *
 * Usage : node client.mjs
 */

import { poserDoublures } from '../../serveur/src/navigateur-absent.js';

// Avant tout import du jeu : les modules du client touchent au canvas et au localStorage.
poserDoublures();

const { demarrerServeur } = await import('../../serveur/src/serveur.js');
const { preparer, construire, creerPerso, liberer } = await import('../../serveur/src/monde.js');
const { avancerTick } = await import('../../serveur/src/tick.js');
const { creerSession } = await import('../../tools/feel-lab/src/enligne/session.js');

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

await preparer();
const t0 = Date.now();

/**
 * Un joueur complet : il se connecte, construit le monde annoncé, prédit, et se corrige.
 *
 * C'est le navigateur, moins le rendu. Les 60 Hz sont ceux d'un écran ordinaire.
 */
function creerJoueur(url, nom, strategie) {
  const session = creerSession({ url, nom });
  const j = {
    nom,
    session,
    monde: null,
    perso: null,
    minuteur: null,
    ecarts: [],                 // position actuelle vs autorité — porte la latence
    erreurs: [],                // autorité vs position AU MEME INSTANT — la vraie erreur
    effets: { ignore: 0, absorbe: 0, recale: 0 },
    instantanes: 0,             // tout ce que le serveur envoie, corrigé ou non
    manches: 0,
    spectateur: false,
    fini: null,
  };

  session.sur('manche', (msg) => {
    if (j.monde) { j.perso = null; liberer(j.monde); j.monde = null; }

    /*
     * ÉLIMINÉ = SPECTATEUR. On reçoit quand même l'annonce — c'est ce qui permet de
     * regarder la suite — mais on ne construit aucun personnage : le serveur n'en simule
     * plus pour nous.
     */
    const moi = msg.joueurs.find((p) => p.nom === nom);
    if (!moi) { j.spectateur = true; return; }

    // Le serveur annonce l'épreuve ET la graine : on construit exactement le même monde.
    j.monde = construire(msg.epreuve, msg.graine);
    j.perso = creerPerso(j.monde, moi.index, msg.joueurs.length);
    j.manches++;
    // Pas de scène THREE ici : on ne rend rien, donc pas de figurants. C'est la seule
    // chose que ce harnais ne peut pas éprouver — elle se juge à l'œil, dans un navigateur.
    session.attacher({ personnage: j.perso, scene: null, assets: null });
  });

  session.sur('correction', ({ effet, moi, reference }) => {
    j.effets[effet]++;
    if (!j.perso) return;

    /*
     * DEUX MESURES, et les confondre m'a coûté une heure.
     *
     * L'écart APPARENT compare la position actuelle du client à celle que le serveur vient
     * d'arbitrer. Il n'est PAS une erreur : le client a légitimement une centaine de
     * millisecondes d'avance, et à 7,6 m/s cela fait déjà trois quarts de mètre. Le voir
     * grand ne veut rien dire de mauvais.
     *
     * L'ERREUR RÉELLE compare l'autorité à l'endroit où le client se croyait AU MÊME
     * INSTANT. C'est elle qui dit si les deux simulations divergent, et c'est la seule
     * qu'il faut chercher à réduire.
     */
    const p = j.perso.body.translation();
    j.ecarts.push(Math.hypot(moi.x - p.x, moi.y - p.y, moi.z - p.z));
    if (reference) {
      j.erreurs.push(Math.hypot(moi.x - reference.x, moi.y - reference.y, moi.z - reference.z));
    }
  });

  session.sur('fin-partie', (msg) => { j.fini = msg; });
  session.lien.sur('instantane', () => { j.instantanes++; });

  j.jouer = () => {
    /*
     * DEUX CADENCES, ET IL FAUT LES DEUX.
     *
     * On envoie à 60 Hz — la cadence d'un écran, et celle à laquelle un joueur produit
     * réellement des touches. Mais on SIMULE à 30 Hz, exactement comme le serveur.
     *
     * Confondre les deux est le piège qui m'a coûté le plus de temps : `avancerTick`
     * avance de DEUX sous-pas de 1/60 s, soit 1/30 s de physique. L'appeler soixante fois
     * par seconde faisait parcourir au client deux secondes de jeu par seconde réelle. Il
     * arrivait donc systématiquement en avance sur le serveur, et l'« erreur » mesurée
     * n'était pas une divergence : c'était le client qui courait deux fois trop vite.
     *
     * Un client qui ne tique pas à la cadence du serveur ne peut pas prédire — il peut
     * seulement se tromper de plus en plus vite.
     */
    let reste = 0;
    let precedent = Date.now();

    j.minuteur = setInterval(() => {
      if (!j.perso || !j.monde) return;

      const maintenant = Date.now();
      reste += (maintenant - precedent) / 1000;
      precedent = maintenant;

      // Pendant le décompte on ne pilote pas — comme le vrai client, qui met l'entrée à
      // zéro tant que le compte n'est pas écoulé. Le serveur, lui, ne consomme rien.
      const entree = session.enDecompte ? { x: 0, z: 0, jump: false, dive: false } : strategie(j);

      // On simule au pas du serveur, pas plus vite. Plafonné à trois ticks : rattraper
      // un gros retard d'un coup ferait bondir le personnage.
      let pas = 0;
      while (reste >= 1 / 30 && pas < 3) {
        reste -= 1 / 30;
        pas++;
        // UNE entrée PAR SOUS-PAS, comme `main.js` : le numéro identifie le pas que le
        // serveur jouera. Un tick en fait deux ; on les envoie avant, on note après chacun.
        const seqs = [session.envoyer(entree), session.envoyer(entree)];
        // L'horloge du décor est celle du SERVEUR (`tempsMonde`), comme dans le vrai
        // client : à zéro, une plate-forme qui bouge n'est pas là où le serveur la voit.
        avancerTick(
          j.monde,
          [{ perso: j.perso, entrees: [{ ...entree }, { ...entree }] }],
          session.tempsMonde, 1 / 30, true,
          { apresSousPas: (s) => session.noterPas(seqs[s]) },
        );
      }

      session.avancer(1 / 60);
      session.mesurerLatence(60);
    }, 1000 / 60);
  };

  j.arreter = () => {
    clearInterval(j.minuteur);
    session.fermer();
    if (j.monde) { liberer(j.monde); j.monde = null; }
  };

  return j;
}

/** Attend qu'une condition devienne vraie, ou abandonne. */
async function jusqua(condition, ms = 20000, quoi = 'condition') {
  const debut = Date.now();
  while (!condition()) {
    if (Date.now() - debut > ms) throw new Error(`${quoi} jamais atteinte`);
    await patienter(25);
  }
}

// ===========================================================================
titre('1. Deux joueurs prédisent, le serveur arbitre');
// ===========================================================================
{
  const s = await demarrerServeur({ port: 0, politique: 'DUEL_TEST', graine: 20260901 });
  const url = `ws://127.0.0.1:${s.port}`;

  // Deux stratégies différentes, pour que les deux simulations ne soient pas jumelles par
  // accident : si les deux joueurs faisaient exactement la même chose, un bug de
  // correspondance index → joueur passerait inaperçu.
  const a = creerJoueur(url, 'alice', () => ({ x: 0, z: -1, jump: false, dive: false }));
  // Une stratégie DÉTERMINISTE, comme partout ailleurs dans ce dépôt : un harnais qui
  // tire au sort ne reproduit pas ses propres échecs.
  let pas = 0;
  const b = creerJoueur(url, 'bob', (j) => {
    pas++;
    return { x: 0.4, z: -1, jump: j.perso.state === 'grounded' && pas % 50 === 0, dive: false };
  });

  a.session.connecter();
  b.session.connecter();
  await jusqua(() => a.session.etat === 'ouvert' && b.session.etat === 'ouvert', 5000, 'connexion');
  dit(true, 'les deux sessions sont ouvertes');

  a.session.rejoindre(0);
  b.session.rejoindre(0);
  await jusqua(() => a.monde && b.monde, 20000, 'annonce de manche');
  dit(a.session.manche.graine === b.session.manche.graine,
    `les deux clients construisent le MÊME monde : ${a.session.manche.epreuve}, graine ${a.session.manche.graine}`);
  dit(a.session.monIndex !== b.session.monIndex,
    `chacun sait quel personnage est le sien (${a.session.monIndex} et ${b.session.monIndex})`);

  a.jouer(); b.jouer();

  // On laisse passer le décompte, puis on mesure sur cinq secondes de jeu réel.
  await patienter(a.session.manche.decompte * 1000 + 500);
  a.ecarts.length = 0; a.erreurs.length = 0;
  b.ecarts.length = 0; b.erreurs.length = 0;
  a.effets.ignore = a.effets.absorbe = a.effets.recale = 0;
  await patienter(5000);

  dit(a.ecarts.length > 60, `${a.ecarts.length} corrections reçues en 5 s (≈20 Hz)`);

  const mediane = (t) => { const s = [...t].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
  const median = mediane(a.ecarts);
  const medianErreur = mediane(a.erreurs);

  console.log(`     écart apparent (porte la latence) — médian ${(median * 100).toFixed(0)} cm`
    + ` · max ${(Math.max(...a.ecarts) * 100).toFixed(0)} cm`);
  console.log(`     ERREUR RÉELLE (même instant)      — médiane ${(medianErreur * 100).toFixed(1)} cm`
    + ` · max ${(Math.max(...a.erreurs) * 100).toFixed(0)} cm`);
  console.log(`     effets : ${a.effets.ignore} ignorés · ${a.effets.absorbe} absorbés`
    + ` · ${a.effets.recale} recalages · latence estimée ${Math.round(a.session.latence)} ms`);

  /*
   * LE VERDICT QUI COMPTE.
   *
   * Un écart médian de quelques dizaines de centimètres est normal : le client a une
   * cinquantaine de millisecondes d'avance sur le serveur, et à 7,6 m/s cela fait déjà
   * 38 cm. Ce qu'on refuse, c'est un écart qui CROÎT — signe que les deux simulations
   * divergent au lieu de se suivre.
   */
  dit(a.erreurs.length > 50, `${a.erreurs.length} erreurs mesurées au même instant`);
  // Seuil serré volontairement. Mesuré a 5 cm : un verdict a 30 cm ne detecterait plus
  // rien, et c'est exactement ce qui a laisse passer le client qui tiquait deux fois trop
  // vite. Un test doit se casser quand la qualite baisse, pas quand elle s'effondre.
  dit(medianErreur < 0.15,
    `erreur réelle médiane sous 15 cm : les deux simulations se suivent`);

  const debut = a.erreurs.slice(0, 20).reduce((x, y) => x + y, 0) / 20;
  const fin = a.erreurs.slice(-20).reduce((x, y) => x + y, 0) / 20;
  dit(fin < debut * 3 + 0.3,
    `l'erreur ne dérive pas : ${(debut * 100).toFixed(0)} cm au début, ${(fin * 100).toFixed(0)} cm à la fin`);

  dit(a.effets.recale < a.ecarts.length * 0.25,
    `${a.effets.recale} recalages secs sur ${a.ecarts.length} corrections — la plupart s'absorbent`);

  a.arreter(); b.arreter();
  await s.arreter();
}

// ===========================================================================
titre('2. Une partie complète, du salon au classement');
// ===========================================================================
/*
 * Le parcours du joueur, de bout en bout : il rejoint, la manche s'annonce, il joue, la
 * manche se termine, la suivante s'annonce, et il reçoit un classement. C'est ce qu'un
 * navigateur vivra, et c'est ce qui casse en premier quand une transition est mal câblée.
 */
{
  // `dureeManche` court : depuis que les parties tournent en TEMPS REEL, deux manches de
  // trois minutes prendraient six minutes de test. Vingt secondes suffisent a voir une
  // manche s'ouvrir, se jouer, se clore et laisser la place a la suivante.
  const petite = { nom: 'TEST_3', cible: 3, minimum: 3, attente: 1, proposerApres: 1,
    bots: 'jamais', dureeManche: 20 };
  const s = await demarrerServeur({ port: 0, politique: petite, graine: 555 });
  const url = `ws://127.0.0.1:${s.port}`;

  const joueurs = ['un', 'deux', 'trois'].map((n) =>
    creerJoueur(url, n, () => ({ x: 0, z: -1, jump: false, dive: false })));

  for (const j of joueurs) j.session.connecter();
  await jusqua(() => joueurs.every((j) => j.session.etat === 'ouvert'), 5000, 'connexions');
  for (const j of joueurs) j.session.rejoindre(0);

  await jusqua(() => joueurs.every((j) => j.monde), 20000, 'première manche');
  dit(true, `trois joueurs, ${joueurs[0].session.manche.sur} manches annoncées`);
  for (const j of joueurs) j.jouer();

  // Une partie à trois joue deux manches. On attend le classement final.
  await jusqua(() => joueurs.every((j) => j.fini), 120000, 'fin de partie');

  const classement = joueurs[0].fini.classement;
  dit(classement.length === 3, `classement final de ${classement.length} joueurs`);
  dit(new Set(classement.map((c) => c.rang)).size === 3, 'les rangs sont distincts');
  // Un joueur éliminé en manche 1 n'a construit qu'UN monde, et il est devenu spectateur.
  const survivants = joueurs.filter((j) => !j.spectateur);
  dit(joueurs.some((j) => j.spectateur), `${joueurs.filter((j) => j.spectateur).length} éliminé(s) sont passés spectateurs`);
  dit(survivants.every((j) => j.manches >= 1), `les survivants ont construit ${survivants[0].manches} monde(s)`);
  dit(joueurs.every((j) => JSON.stringify(j.fini.classement) === JSON.stringify(classement)),
    'les trois clients reçoivent le MÊME classement');
  console.log(`     ${classement.map((c) => `${c.rang}. ${c.nom}`).join(' · ')}`);

  for (const j of joueurs) j.arreter();
  await s.arreter();
}

// ===========================================================================
titre('3. Le client survit à une coupure');
// ===========================================================================
{
  // À TROIS, pas à deux : depuis que quitter vaut élimination, un duel dont l'autre part
  // est GAGNÉ sur-le-champ — la partie se clôt, plus aucun instantané ne part, et ce
  // verdict mesurait zéro en accusant le lien. À trois, la manche continue pour les deux
  // qui restent, et c'est bien leur lien qu'on éprouve.
  const petite = { nom: 'TEST_3', cible: 3, minimum: 3, attente: 1, proposerApres: 1,
    bots: 'jamais', dureeManche: 30 };
  const s = await demarrerServeur({ port: 0, politique: petite, graine: 31337 });
  const url = `ws://127.0.0.1:${s.port}`;

  const a = creerJoueur(url, 'resistant', () => ({ x: 0, z: -1, jump: false, dive: false }));
  const b = creerJoueur(url, 'partant', () => ({ x: 0, z: -1, jump: false, dive: false }));
  const c = creerJoueur(url, 'temoin', () => ({ x: 0.3, z: -1, jump: false, dive: false }));
  for (const j of [a, b, c]) j.session.connecter();
  await jusqua(() => [a, b, c].every((j) => j.session.etat === 'ouvert'), 5000, 'connexion');
  for (const j of [a, b, c]) j.session.rejoindre(0);
  await jusqua(() => a.monde && b.monde && c.monde, 20000, 'manche');
  for (const j of [a, b, c]) j.jouer();

  await patienter(a.session.manche.decompte * 1000 + 800);
  const avant = a.instantanes;

  b.arreter();                                   // l'autre ferme son onglet
  await patienter(2500);

  // On compte les INSTANTANÉS, pas les corrections : le départ de b clôt la manche (deux
  // restants pour deux places), la suivante s'ouvre sur un décompte, et pendant un
  // décompte le client ne corrige rien. Le lien, lui, doit continuer de parler.
  dit(a.instantanes > avant + 30,
    `le joueur restant continue de recevoir (${a.instantanes - avant} instantanés depuis la coupure)`);
  dit(a.session.etat === 'ouvert', 'sa propre session est intacte');

  a.arreter(); c.arreter();
  await s.arreter();
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s ---`);
process.exit(ko === 0 ? 0 : 1);
