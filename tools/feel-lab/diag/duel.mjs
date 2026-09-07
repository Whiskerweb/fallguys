/**
 * DEUX NAVIGATEURS, UN SERVEUR, UNE PARTIE.
 *
 * C'est le seul harnais qui prouve ce que le projet cherche depuis le début : deux
 * personnes, sur deux machines, jouant l'une contre l'autre dans un navigateur, sans rien
 * installer.
 *
 * Les autres harnais éprouvent des morceaux — `tools/test-harness/reseau.mjs` la cadence
 * du serveur, `client.mjs` la prédiction. Celui-ci lance le VRAI jeu, deux fois, et
 * regarde ce qui s'affiche.
 *
 * Ce qu'il vérifie, et qu'aucun test sans navigateur ne peut voir :
 *
 *   - les deux pages construisent la MÊME carte, celle que le serveur a imposée ;
 *   - chacune affiche l'AUTRE joueur, et cet autre bouge ;
 *   - le personnage local avance, donc le joueur a la main ;
 *   - la latence affichée est plausible.
 *
 * Aucun serveur à lancer d'avance : le harnais démarre le sien, qui sert aussi la page.
 * Il faut en revanche que le jeu soit compilé.
 *
 *   cd tools/feel-lab && npm run build && node diag/duel.mjs
 */

import { chromium } from 'playwright';
import { dossierDeBanc } from '../src/boutique.js';
import { demarrerServeur } from '../../../serveur/src/serveur.js';
import { SEUIL_RECALAGE } from '../src/enligne/reconciliation.js';

/*
 * PAS DE SERVEUR DE DEVELOPPEMENT ICI.
 *
 * Le serveur de jeu sert lui-même le jeu compilé, et c'est exactement le chemin qu'un
 * joueur empruntera : une seule adresse, une seule origine, la WebSocket qui part vers le
 * même hôte. Tester à travers Vite testerait un montage que personne n'utilisera.
 *
 * Il faut donc que `tools/feel-lab/dist` soit à jour : `npm run build`.
 */
let BASE = null;

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ko && !ok) ko++; else if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

let browser;
let serveur;
process.on('exit', () => { try { browser?.close(); } catch {} });

/*
 * Un serveur de jeu à DEUX PLACES, et une manche LONGUE.
 *
 * `DUEL_TEST` sans bot : c'est exactement le mode dans lequel deux machines se testent.
 *
 * Trois cents secondes de manche, et ce n'est pas de la prudence. Ces navigateurs tournent
 * en rendu logiciel à une dizaine de pour cent de la vitesse réelle, pendant que le
 * serveur, lui, tourne en TEMPS RÉEL. Avec une manche de vingt-cinq secondes, le serveur
 * l'avait close et renvoyé tout le monde au lobby avant même que le décompte de trois
 * secondes ait fini de s'afficher côté client — et le harnais trouvait `character` à null
 * sans comprendre pourquoi.
 *
 * C'est une asymétrie réelle du produit, pas seulement du banc : un client lent ne ralentit
 * pas la partie des autres. Ici on lui laisse simplement le temps d'exister.
 */
serveur = await demarrerServeur({
  port: 0,
  // `identite: 'facultative'` : c'est un BANC, sans argent derrière — le portefeuille de
  // banc de 25 USDG n'existe que si le serveur le dit (voir `caisse.js`).
  politique: { nom: 'DUEL_TEST', cible: 2, minimum: 2, attente: 1, proposerApres: 1, bots: 'jamais', dureeManche: 300, identite: 'facultative' },
  graine: 20260901,
});
BASE = `http://127.0.0.1:${serveur.port}`;
console.log(`serveur de jeu et page sur ${BASE}`);

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** Ouvre une page, la mène jusqu'au lobby, et la connecte au serveur sous ce nom. */
async function ouvrir(nom, base = BASE, modele = null) {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.setDefaultTimeout(300000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`${nom}: ${String(e).slice(0, 160)}`));

  /*
   * Le personnage se choisit AVANT le chargement : `cosmetics` lit la mémoire locale à
   * l'initialisation du module. Deux joueurs différents doivent porter deux personnages
   * différents, sinon le verdict qui suit ne prouverait rien.
   */
  if (modele) await page.addInitScript((id) => localStorage.setItem('tumble-model', id), modele);
  // BabyTrump est en BOUTIQUE depuis le 2 septembre 2026 : sans ce dossier de possession,
  // le catalogue refuse de l'equiper et la machine repart avec le personnage suivant, sans
  // un mot. La forme du dossier vient de `src/boutique.js`, jamais recopiee ici.
  await page.addInitScript(({ cle, valeur }) => localStorage.setItem(cle, valeur), dossierDeBanc());

  /*
   * LE MODE ET LA MISE, AVANT LE CHARGEMENT — pour la même raison que le personnage.
   *
   * Le duel n'est plus seulement une politique de mise au point : c'est un MODE ouvert au
   * public, à deux joueurs, une manche, ×1,8 au vainqueur. Ce harnais joue donc le vrai
   * chemin payant. Les poser explicitement évite qu'une mémoire héritée d'une session
   * précédente fasse jouer ce banc en arène à 10 USDG — et son verdict ne dirait plus rien.
   */
  await page.addInitScript(() => {
    localStorage.setItem('tumble-mode', 'duel');
    localStorage.setItem('tumble-mise', '2');
  });
  // Le nom se pose AVANT le chargement, comme le personnage : c'est `bonjour` qui le porte.
  await page.addInitScript((n) => localStorage.setItem('tumble-pseudo', n), nom);

  // `noassets` : le rendu logiciel de ce harnais mettrait une éternité à charger cent
  // cinquante mégaoctets de GLB, et les figurants savent se replier sur une capsule.
  await page.goto(`${base}/?lowfx&nointro&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && getComputedStyle(l).display === 'none';
  }, { timeout: 300000 });

  // Plus de panneau ONLINE : la page se connecte toute seule au serveur qui l'a servie, et
  // le nom est parti avec `bonjour` (posé avant le chargement). On attend la liaison, puis
  // PLAY entre en file — c'est exactement le geste du joueur, et c'est ce qu'on vérifie.
  await page.waitForFunction(() => window.__probeGame()?.file?.etat === 'ouvert', { timeout: 20000 });
  await page.click('#play');
  return { nom, page, erreurs };
}

titre('1. Deux navigateurs rejoignent le même serveur');
const [MODELE_UN, MODELE_DEUX] = ['char-babytrump', 'char-techtitan'];
const un = await ouvrir('machine-1', BASE, MODELE_UN);
dit(true, 'la page s\'est connectée toute seule au serveur qui l\'a servie — rien à saisir, rien à ouvrir');

/*
 * LE BARÈME EST AFFICHÉ AVANT LE DÉPART, et c'est le verdict le plus important de ce
 * fichier après celui des bots.
 *
 * Toute la qualification « compétition de skill » du spec (§ 5) tient à ce qu'aucune
 * machine ne décide de ce qu'un joueur gagne. Si ce ×1.8 apparaissait après la partie au
 * lieu d'avant, le montant du prix serait déterminé une fois la mise engagée — et aucun
 * autre test ne le dirait.
 */
{
  const dit_ = await un.page.textContent('#roue-dit');
  const parts = await un.page.evaluate(() => document.querySelectorAll('#roue-mini svg path').length);
  /*
   * DEPUIS LE 2 SEPTEMBRE 2026, LA ROUE TIRE À LA FIN. Le ticket ne promet donc plus une
   * table certaine : il annonce dix issues possibles et dit que la roue tourne au
   * classement final. Un ticket qui écrirait encore « WINNER TAKES 3.60 USDG » mentirait —
   * le vainqueur d'un duel touche 2,40 à 3,60 selon la ligne tirée.
   */
  dit(/10 POSSIBLE OUTCOMES/.test(dit_),
    `le ticket annonce dix issues possibles, pas une table certaine : « ${dit_.trim().slice(0, 60)} »`);
  dit(!dit_.includes('×'), 'et il ne parle jamais en multiplicateur');
  dit(/spins when the match ends/i.test(dit_),
    'il dit que la roue tourne à la FIN de la partie : rien n\'est promis avant');
  dit(parts >= 10, `l'aperçu du disque est dessiné dans le ticket, dix cases (${parts} chemins SVG)`);
}
const deux = await ouvrir('machine-2', BASE, MODELE_DEUX);

// Le salon est plein à deux : la manche doit s'annoncer d'elle-même.
for (const j of [un, deux]) {
  await j.page.waitForFunction(() => window.__probeGame()?.mode === 'racing', { timeout: 120000 });
}
dit(true, 'les deux pages sont entrées en manche');

/*
 * LE COMPTEUR DE PASSAGES DIT LA RÈGLE DU JEU.
 *
 * On ne compte pas les secondes : on compte les joueurs qui franchissent l'arrivée, et la
 * manche s'arrête quand les places sont prises. « 0/1 » en duel — une place, personne
 * encore passé — et le 1 vient du SERVEUR, pas du barème hors ligne qui en poserait huit.
 */
{
  const compteur = (await un.page.textContent('#hud-qualifies')).trim();
  dit(compteur === '0/1',
    `le compteur annonce les places du serveur : « ${compteur} » (0/1 attendu en duel)`);
}

const carte = await Promise.all([un, deux].map((j) => j.page.evaluate(() => {
  const g = window.__probeGame();
  return { epreuve: g.jeuId, graine: g.manche, impose: Boolean(g.imposee), enligne: Boolean(g.enligne) };
})));
dit(carte[0].epreuve === carte[1].epreuve && carte[0].graine === carte[1].graine,
  `même carte des deux côtés : ${carte[0].epreuve}, graine ${carte[0].graine}`);
dit(carte[0].impose && carte[1].impose, 'la carte a bien été IMPOSÉE par le serveur, pas tirée localement');
dit(carte[0].enligne && carte[1].enligne, 'les deux pages sont en mode en ligne');

titre('2. La barre du haut dit QUI joue');
/*
 * Trouvé sur une capture d'écran, pas par un test : deux machines côte à côte affichaient
 * toutes les deux « Baby #2005 », même portrait, même niveau. L'étiquette était écrite en
 * dur dans `index.html` et rien ne l'a jamais remplacée.
 *
 * Dans un jeu où l'on mise, savoir qui est en face n'est pas un détail d'affichage. Et le
 * nom montré doit être CELUI QUI COURT — pas un second nom qui pourrait diverger.
 */
{
  const affiche = (j) => j.page.evaluate(() => document.getElementById('pname')?.textContent?.trim());
  const noms = await Promise.all([un, deux].map(affiche));
  console.log(`     ${un.nom} affiche « ${noms[0]} »  ·  ${deux.nom} affiche « ${noms[1]} »`);
  dit(noms[0] === un.nom && noms[1] === deux.nom,
    'chaque barre affiche le nom sous lequel ce joueur est entré en partie');
  dit(noms[0] !== noms[1], 'deux joueurs ne portent pas le même nom');
}

titre('3. Chacun voit l\'AUTRE tel qu\'il s\'est habillé');
/*
 * Trouvé sur une capture, en jouant à deux : le même joueur apparaissait en Trump sur une
 * machine et en Musk sur l'autre.
 *
 * L'apparence d'un adversaire se déduisait de son NUMÉRO DE SIÈGE — `MODELS[index % n]` —
 * alors que chacun s'affiche, lui, avec le personnage qu'il a réellement choisi. Les deux
 * écrans ne pouvaient donc pas s'accorder, et aucun test ne le voyait puisque les deux
 * navigateurs du banc portaient jusqu'ici le même personnage par défaut.
 *
 * Le verdict n'a de valeur que parce que les deux machines choisissent maintenant des
 * personnages DIFFÉRENTS : c'est ce qui rend le désaccord visible.
 */
{
  const vu = (j) => j.page.evaluate(() =>
    window.__probeGame().enligne?.figurants?.avatars?.[0]?.modele ?? null);
  const [parUn, parDeux] = await Promise.all([vu(un), vu(deux)]);
  console.log(`     ${un.nom} a choisi ${MODELE_UN} et voit son adversaire en ${parUn}`);
  console.log(`     ${deux.nom} a choisi ${MODELE_DEUX} et voit son adversaire en ${parDeux}`);
  dit(parUn === MODELE_DEUX, `${un.nom} voit ${deux.nom} avec le personnage que ${deux.nom} a choisi`);
  dit(parDeux === MODELE_UN, `${deux.nom} voit ${un.nom} avec le personnage que ${un.nom} a choisi`);
}

titre('4. Les deux joueurs partagent l\'horloge du DÉCOR');
/*
 * Le défaut le plus vicieux de la série, rapporté ainsi : « sur la map bûche, je me prends
 * des obstacles invisibles ».
 *
 * Le décor s'anime en fonction du temps écoulé, et cette animation déplace de vrais
 * colliders — sur Le Rondin, l'angle d'un tronc est une fonction pure de ce nombre, et il
 * fixe le visuel COMME la physique. Or le client le comptait depuis l'ouverture de la
 * page, le serveur depuis le début de la manche. Les troncs n'étaient donc pas au même
 * angle, et chaque page ayant son propre décalage, les deux joueurs ne partageaient même
 * pas le même monde.
 *
 * On vérifie deux choses, et il faut les deux : que les deux clients s'accordent, et que
 * ce nombre n'est PAS l'âge de la page — sans quoi deux onglets ouverts ensemble
 * passeraient le test en étant tous les deux faux.
 */
{
  const horloge = (j) => j.page.evaluate(() => ({
    monde: window.__probeGame().enligne?.tempsMonde ?? null,
    page: performance.now() / 1000,
  }));
  const [a, b] = await Promise.all([horloge(un), horloge(deux)]);
  const ecart = (a.monde === null || b.monde === null) ? null : Math.abs(a.monde - b.monde);

  console.log(`     ${un.nom} : décor à ${a.monde?.toFixed(2)} s (page ouverte depuis ${a.page.toFixed(0)} s)`);
  console.log(`     ${deux.nom} : décor à ${b.monde?.toFixed(2)} s (page ouverte depuis ${b.page.toFixed(0)} s)`);

  dit(ecart !== null && ecart < 0.5,
    `les deux clients animent le décor au même instant — écart ${ecart?.toFixed(2)} s`);
  dit(a.monde !== null && a.monde < a.page - 5,
    'l\'horloge du décor est celle de la MANCHE, pas l\'âge de la page');
}

titre('5. Chacun démarre à SA place');
/*
 * Rapporté en jouant : « on spawn toujours au même endroit sur la même parcelle ».
 *
 * Le serveur écartait pourtant déjà les joueurs. C'est le client qui créait son personnage
 * sur le spawn brut de la carte, sans regarder le siège que le serveur lui avait attribué :
 * tout le monde naissait au centre, puis la correction repoussait chacun vers sa vraie
 * place. Une téléportation au premier instantané, à chaque manche.
 *
 * ─── ON MESURE PENDANT LE DÉCOMPTE ──────────────────────────────────────────
 *
 * C'est la seule fenêtre qui parle. Personne n'a encore bougé, donc le seul écart possible
 * entre le client et l'autorité est la place de départ elle-même. Dès que les personnages
 * courent, ces navigateurs en rendu logiciel accumulent des corrections légitimes et le
 * chiffre ne dit plus rien du départ.
 *
 * Et c'est bien l'ABSENCE de recalage qu'on exige : la téléportation doit DISPARAÎTRE, pas
 * être rattrapée proprement par une correction.
 */
{
  const sieges = await Promise.all([un, deux].map((j) =>
    j.page.evaluate(() => window.__probeGame().enligne?.monIndex ?? -1)));
  dit(sieges[0] !== sieges[1] && sieges.every((s) => s >= 0),
    `le serveur a donné deux sièges distincts : ${sieges.join(' et ')}`);

  const ou = (j) => j.page.evaluate(() => {
    const p = window.__probeGame().character?.body.translation();
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  });
  const [a, b] = await Promise.all([ou(un), ou(deux)]);
  const d = (a && b) ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
  console.log(`     ${un.nom} siège ${sieges[0]} · ${deux.nom} siège ${sieges[1]} · séparés de ${d.toFixed(2)} m`);
  dit(d > 0.90, `les deux personnages sont séparés de plus d'un diamètre (${d.toFixed(2)} m)`);
  dit(d < 8, `…et restent côte à côte, pas dispersés (${d.toFixed(2)} m)`);

  const stats = await Promise.all([un, deux].map((j) =>
    j.page.evaluate(() => window.__probeGame().enligne?.statistiques ?? null)));
  for (let i = 0; i < 2; i++) {
    const s = stats[i];
    console.log(`     ${[un, deux][i].nom} : ${s?.recalages ?? '?'} recalages · écart max ${((s?.ecartMax ?? 0) * 100).toFixed(0)} cm`);
    dit((s?.recalages ?? 99) === 0,
      `${[un, deux][i].nom} : aucun recalage — il démarre là où le serveur l'a mis`);
  }
}

titre('6. Chacun voit l\'autre');

/*
 * UNE CONTRAINTE DU HARNAIS, PAS DU JEU.
 *
 * Ces deux navigateurs tournent en rendu LOGICIEL (SwiftShader) : mesuré, ils avancent à
 * une dizaine de pour cent de la vitesse réelle. Un décompte de trois secondes met donc
 * une vingtaine de secondes de temps de mur à s'écouler.
 *
 * On ne mesure donc RIEN en secondes d'horloge ici — ce serait mesurer la machine et non
 * le jeu, l'erreur que ce dépôt s'interdit depuis le début. On attend des ÉTATS, et on
 * juge des propriétés qui ne dépendent pas de la cadence.
 *
 * Ce que cette lenteur révèle au passage, et qui est vrai en production : un client sur
 * une machine faible prend du retard sur le serveur et se fait corriger en permanence.
 * C'est exactement ce que l'autorité serveur est là pour absorber.
 */
for (const j of [un, deux]) {
  await j.page.waitForFunction(() => window.__probeGame().countdown <= 0, { timeout: 180000 });
}
dit(true, 'le décompte est écoulé des deux côtés — la manche a commencé');

for (const j of [un, deux]) {
  await j.page.evaluate(() => {
    const touche = (code, bas) => dispatchEvent(new KeyboardEvent(bas ? 'keydown' : 'keyup', { code, bubbles: true }));
    touche('ArrowUp', true);
  });
}

const avance = (j) => j.page.evaluate(() => {
  const g = window.__probeGame();
  // Tolérante : si la manche s'est close entre deux mesures, on veut un diagnostic lisible
  // et non un `TypeError` sur `null.body` à cinquante lignes de la cause.
  if (!g.character || !g.arena) return null;
  const p = g.character.body.translation();
  return { z: p.z, depart: g.arena.spawn.z, mode: g.mode };
});

const depart = await Promise.all([avance(un), avance(deux)]);
dit(depart.every(Boolean), 'les deux personnages existent au départ de la mesure');
if (!depart.every(Boolean)) {
  console.log('     la manche s\'est close trop tôt — allonger `dureeManche`');
  process.exit(1);
}
// On attend un DÉPLACEMENT, pas une durée : la cadence de ces pages n'a rien à voir avec
// celle d'un vrai navigateur, et attendre « six secondes » ne voudrait rien dire.
for (const j of [un, deux]) {
  await j.page.waitForFunction(
    (z0) => window.__probeGame().character.body.translation().z < z0 - 2.5,
    depart[0].depart, { timeout: 180000 },
  ).catch(() => {});
}
const arrivee = await Promise.all([avance(un), avance(deux)]);
dit(arrivee.every(Boolean), 'les deux personnages existent encore à l\'arrivée');

for (let i = 0; i < 2; i++) {
  if (!arrivee[i]) { dit(false, `${[un, deux][i].nom} a perdu son personnage en route`); continue; }
  const d = depart[i].z - arrivee[i].z;
  dit(d > 2, `${[un, deux][i].nom} a avancé de ${d.toFixed(1)} m — le joueur a la main`);
}

const figurants = await Promise.all([un, deux].map((j) => j.page.evaluate(() => {
  const s = window.__probeGame().enligne;
  return s ? s.statistiques : null;
})));
for (let i = 0; i < 2; i++) {
  dit(figurants[i]?.figurants === 1,
    `${[un, deux][i].nom} affiche ${figurants[i]?.figurants} figurant — son adversaire`);
}

titre('7. Un saut se VOIT à travers le réseau');
/*
 * Le verdict qui manquait le jour où le jeu est devenu injouable.
 *
 * Le joueur pressait Espace, son personnage sautait à l'écran — la prédiction locale —
 * mais le serveur, lui, n'avait jamais reçu l'appui : il en perdait 38 %. Le personnage
 * retombait donc sans franchir l'obstacle, et l'adversaire ne le voyait jamais décoller.
 *
 * On mesure ici les deux bouts d'un coup : `un` saute, et c'est l'écran de `deux` qui doit
 * le montrer. Rien entre les deux n'est simulé — un vrai serveur, un vrai fil, deux vrais
 * navigateurs.
 */
{
  const hauteurVue = () => deux.page.evaluate(() => {
    const f = window.__probeGame().enligne?.figurants;
    const a = f?.avatars?.[0];
    return a ? a.groupe.position.y : null;
  });

  const sauter = () => un.page.evaluate(() => {
    const touche = (bas) => dispatchEvent(
      new KeyboardEvent(bas ? 'keydown' : 'keyup', { code: 'Space', bubbles: true }),
    );
    touche(true);
    setTimeout(() => touche(false), 80);
  });

  const sol = await hauteurVue();
  let plafond = sol ?? -Infinity;

  // Six appuis espacés : de quoi laisser le personnage retomber entre deux, et de quoi
  // survivre à un instantané perdu sans que le verdict devienne capricieux.
  for (let i = 0; i < 6; i++) {
    await sauter();
    for (let k = 0; k < 12; k++) {
      const y = await hauteurVue();
      if (y !== null) plafond = Math.max(plafond, y);
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  const montee = sol === null ? 0 : plafond - sol;
  console.log(`     ${deux.nom} a vu ${un.nom} monter de ${montee.toFixed(2)} m`);
  dit(sol !== null, `${deux.nom} suit bien un figurant`);
  dit(montee > 0.8,
    `le saut de ${un.nom} traverse le serveur et s'affiche chez ${deux.nom} — ${montee.toFixed(2)} m`);
}

titre('8. Un plongeon se VOIT à travers le réseau');
/*
 * Le pendant du saut, et il tombait pour une autre raison.
 *
 * Un plongeon n'est pas un déplacement : c'est une bascule du corps. Le joueur qui plonge
 * passe en ragdoll et prend la rotation de sa capsule ; le squelette, lui, ne fait
 * qu'écarter les membres — invisible à dix mètres. L'instantané ne portait que la
 * position, donc l'adversaire voyait un personnage glisser vers l'avant, bien droit.
 *
 * On mesure la BASCULE telle qu'elle arrive sur l'écran d'en face, pas la pose annoncée :
 * c'est ce que l'œil du joueur reçoit.
 */
{
  const inclinaison = () => deux.page.evaluate(() => {
    const a = window.__probeGame().enligne?.figurants?.avatars?.[0];
    if (!a?.pivot) return null;
    /*
     * L'écart à la verticale : 0 debout, 1 couché.
     *
     * On fait tourner l'axe Y par le quaternion et on regarde ce qu'il reste de vertical.
     * On lit le PIVOT, pas le groupe : c'est lui qui porte la bascule, le groupe ne porte
     * que la position.
     */
    const q = a.pivot.quaternion;
    const vy = 1 - 2 * (q.x * q.x + q.z * q.z);
    return 1 - Math.abs(vy);
  });

  /*
   * ON RELÂCHE LA COURSE AVANT DE PLONGER.
   *
   * Ce verdict a échoué à 2 % alors qu'une sonde dédiée mesurait 30 à 64 % dans les mêmes
   * conditions de code. La différence : ici le personnage SPRINTE, flèche maintenue depuis
   * la section précédente, et percute les portes. Il touche le sol dans la foulée, se
   * relève (`diveRecovery`), et la bascule n'existe plus qu'une poignée d'images.
   *
   * Ce qu'on veut prouver, c'est qu'un plongeon TRAVERSE LE RÉSEAU et s'affiche — pas
   * qu'il reste lisible en pleine course contre un obstacle. On rend donc la main au
   * personnage avant de mesurer, sinon le verdict raconte la carte et non le netcode.
   */
  await un.page.evaluate(() => {
    dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 500));

  const plonger = () => un.page.evaluate(() => {
    const touche = (bas) => dispatchEvent(
      new KeyboardEvent(bas ? 'keydown' : 'keyup', { code: 'ShiftLeft', bubbles: true }),
    );
    touche(true);
    setTimeout(() => touche(false), 80);
  });

  let bascule = 0;
  // Ce que machine-1 fait CHEZ ELLE, en parallele : si elle ne plonge pas localement, le
  // fil n'y est pour rien ; si elle plonge et que machine-2 ne voit rien, c'est le fil.
  const etatsLocaux = new Set();
  const seqAvant = await un.page.evaluate(() => window.__probeGame().enligne?.lien?.enAttente?.at(-1)?.seq ?? 0);
  for (let i = 0; i < 6; i++) {
    await plonger();
    for (let k = 0; k < 12; k++) {
      const v = await inclinaison();
      if (v !== null) bascule = Math.max(bascule, v);
      etatsLocaux.add(await un.page.evaluate(() => window.__probeCharacter()?.state ?? '?'));
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  const seqApres = await un.page.evaluate(() => window.__probeGame().enligne?.lien?.enAttente?.at(-1)?.seq ?? 0);
  const statsSession = await un.page.evaluate(() => JSON.stringify(window.__probeGame().enligne?.statistiques ?? null));
  const reseau = serveur.matchmaking.instances[0]?.reseau ?? {};

  console.log(`     ${deux.nom} a vu ${un.nom} basculer de ${(bascule * 100).toFixed(0)} %`);
  console.log(`     ${un.nom} chez elle : etats ${[...etatsLocaux].join('/')} · ${seqApres - seqAvant} entrees envoyees pendant la mesure`);
  console.log(`     session ${statsSession} · tampon serveur ${JSON.stringify(reseau[un.nom] ?? null)}`);
  dit(bascule > 0.15,
    `le plongeon de ${un.nom} bascule le corps chez ${deux.nom} — sans quoi il glisserait tout droit`);
}

titre('9. La correction converge');
for (let i = 0; i < 2; i++) {
  const s = figurants[i];
  console.log(`     ${[un, deux][i].nom} · ${s.corrections} corrections · ${s.recalages} recalages`
    + ` · écart max ${(s.ecartMax * 100).toFixed(0)} cm · reste ${(s.enCours * 100).toFixed(0)} cm`);
  // Ce qui compte n'est pas le NOMBRE de corrections — un client lent en reçoit beaucoup —
  // mais le fait qu'elles s'ABSORBENT au lieu de s'accumuler.
  // `enCours` est ce que le VISUEL doit encore rattraper : par construction, un écart
  // absorbé est sous le seuil de recalage (3 m) — au-delà, le corps ET le visuel sautent.
  dit(s.enCours < SEUIL_RECALAGE, `l'écart en cours reste sous ${SEUIL_RECALAGE} m : la correction absorbe`);
}

await un.page.screenshot({ path: 'shots/duel-machine-1.png' });
await deux.page.screenshot({ path: 'shots/duel-machine-2.png' });
console.log('     shots/duel-machine-1.png · shots/duel-machine-2.png');

/*
 * ON FERME LES DEUX PREMIERES PAGES AVANT LA SUITE.
 *
 * La section suivante en ouvre deux autres. Les laisser toutes vivre ferait tourner
 * QUATRE mondes physiques wasm dans un seul navigateur en rendu logiciel — une charge que
 * personne ne rencontrera jamais, et qui a produit une fois un `RuntimeError: unreachable`
 * dans Rapier que je n'ai pas su reproduire en jeu normal (200 s à deux pages, avec chutes
 * et recalages : rien).
 *
 * Un harnais qui fabrique ses propres pannes cesse de dire quoi que ce soit sur le jeu.
 */
const erreurs123 = [...un.erreurs, ...deux.erreurs];
await un.page.close();
await deux.page.close();

// ===========================================================================
titre('10. La fin de partie se VOIT');
// ===========================================================================
/*
 * Sans cet écran, une partie en ligne se terminait par un retour au lobby sans que le
 * joueur sache s'il avait gagné. Le solo affiche un verdict depuis toujours : il n'y a
 * aucune raison que la version qui compte soit la plus muette des deux.
 *
 * On monte un second serveur à manche COURTE. Ces navigateurs tournant au dixième de la
 * vitesse réelle, ils seront encore dans leur décompte quand le serveur clôturera — et
 * c'est très bien : ce qu'on veut vérifier, c'est que le message de fin arrive et
 * s'affiche, quel que soit l'état du client.
 */
{
  const court = await demarrerServeur({
    port: 0,
    politique: { nom: 'DUEL_TEST', cible: 2, minimum: 2, attente: 1, proposerApres: 1, bots: 'jamais', dureeManche: 12, identite: 'facultative' },
    graine: 4242,
  });
  const baseCourt = `http://127.0.0.1:${court.port}`;

  const a = await ouvrir('fin-1', baseCourt);
  const b = await ouvrir('fin-2', baseCourt);

  for (const j of [a, b]) {
    await j.page.waitForFunction(() => window.__probeGame()?.mode === 'racing', { timeout: 120000 });
  }
  dit(true, 'la partie courte a démarré');

  /*
   * ON POSE LE CORPS DU GAGNANT AU-DELÀ DE LA LIGNE — et c'est tout l'objet de ce test.
   *
   * Ce harnais passait en validant le seul cas qui n'était pas cassé. Avec une manche de
   * douze secondes, personne n'arrive : la manche est TRANCHÉE au chrono, le vainqueur est
   * repêché, et son corps est resté au milieu du parcours. Or le bug ne frappait QUE celui
   * qui avait franchi la ligne.
   *
   * Le déclencheur est la position LOCALE au moment du `fin-partie` : `brancher.js` annule
   * `jeu.enligne`, et à l'image suivante `main.js` retombait dans ses règles hors ligne,
   * voyait `pos.z <= finishZ`, et lançait `finishRace()` — écrasant « VICTORY! · +3.60
   * USDG » par « QUALIFIED! » puis renvoyant au lobby, roue comprise.
   *
   * On maintient donc le corps là où le serveur met un vainqueur, image après image : la
   * réconciliation le rappellerait en cent millisecondes et le déclencheur ne serait pas
   * armé à l'instant qui compte. Ce n'est pas une porte dérobée — le raccourci reproduit
   * exactement l'état du gagnant, et la manche, elle, se conclut toujours côté serveur.
   */
  await a.page.evaluate(() => {
    const g = window.__probeGame();
    const tenir = () => {
      const perso = window.__probeCharacter?.();
      if (!g.arena || !perso) return;
      if (g.arena.survie) g.runTime = g.arena.survie.duree + 1;
      else perso.body.setTranslation({ x: 0, y: 3, z: g.arena.finishZ - 1 }, true);
      requestAnimationFrame(tenir);
    };
    tenir();
  });

  // On attend le verdict — pas une durée : la cadence de ces pages n'a rien à voir avec
  // celle d'un vrai navigateur.
  await a.page.waitForFunction(() => {
    const v = document.getElementById('verdict');
    return v && !v.classList.contains('hidden');
  }, { timeout: 180000 });

  const vu = await a.page.evaluate(() => ({
    verdict: document.getElementById('verdict-texte')?.textContent,
    etiquette: document.querySelector('#verdict-sous .etiquette')?.textContent,
    valeur: document.querySelector('#verdict-sous .valeur')?.textContent,
  }));
  console.log(`     verdict « ${vu.verdict} » · ${vu.etiquette} · ${vu.valeur}`);

  dit(Boolean(vu.verdict), 'un verdict s\'affiche à la fin de la partie');
  dit(/of \d+$/.test(vu.etiquette ?? ''), `le rang est annoncé : « ${vu.etiquette} »`);

  /*
   * LA ROUE MONTE, ET ELLE ATTEND LE JOUEUR.
   *
   * C'est le cœur de l'écran de fin : elle ne tire rien — le barème a été tiré dans le
   * lobby, avant que la mise ne parte — mais elle ne se lance pas non plus toute seule.
   * `?nointro` rend la rotation instantanée ; il ne clique pas à la place du joueur.
   */
  await a.page.waitForFunction(
    () => document.getElementById('roue-scene')?.classList.contains('armee'),
    { timeout: 60000 },
  );
  const avant = await a.page.evaluate(() => ({
    panneau: document.getElementById('fin-panneau').classList.contains('show'),
    calee: document.getElementById('roue-scene').classList.contains('calee'),
    boutons: getComputedStyle(document.getElementById('fin-boutons')).display,
    quartiers: document.querySelectorAll('#roue-disque-hote .roue-q').length,
    titre: document.getElementById('fin-titre').textContent,
    podium: document.getElementById('fin-podium').textContent,
    texte: document.getElementById('fin-panneau').textContent,
  }));
  console.log(`     roue armée · ${avant.quartiers} quartiers · ${avant.titre} · podium ${avant.podium}`);

  dit(avant.panneau === true, 'le panneau de fin est affiché');
  // Dix cases, dans tous les modes : la roue est celle du RANG du joueur, une case par
  // ligne du tableau. C'est la promesse produit du 2 septembre 2026.
  dit(avant.quartiers === 10, `la roue du vainqueur a ${avant.quartiers} cases (dix attendues)`);
  dit(/\d\. /.test(avant.podium ?? ''), `le podium est affiché : « ${avant.podium} »`);
  dit(avant.calee === false && avant.boutons === 'none',
    'tant que la roue n\'a pas été lancée, aucun bouton : on ne peut pas partir sans son gain');

  /*
   * AUCUN MULTIPLICATEUR. Le joueur mise des USDG et gagne des USDG ; le facteur est notre
   * outil de calcul interne et ne doit apparaître nulle part devant lui.
   */
  dit(!avant.texte.includes('×'), 'aucun « × » sur l\'écran de fin');
  const ticketPropre = await a.page.evaluate(() => !document.getElementById('ticket').textContent.includes('×'));
  dit(ticketPropre, 'aucun « × » dans le ticket du lobby non plus');

  // On la lance — au clavier, le chemin que n'importe qui peut rejouer à la main.
  await a.page.keyboard.press('Space');
  await a.page.waitForFunction(
    () => document.getElementById('roue-scene')?.classList.contains('calee'),
    { timeout: 60000 },
  );
  const apres = await a.page.evaluate(() => ({
    ...window.__probeGame()._roue.resultat(),
    gain: document.getElementById('fin-gain').textContent,
    sous: document.getElementById('fin-sous').textContent,
    boutons: getComputedStyle(document.getElementById('fin-boutons')).display,
    grade: document.getElementById('fin-panneau').dataset.grade,
  }));
  console.log(`     calée sur le rang ${apres.rang} · ${apres.grade ?? '—'} · ${apres.gain}`);

  dit(apres.calee === true, 'la roue s\'immobilise après le lancer');
  dit(apres.rang >= 1 && apres.rang <= 2, `elle s'arrête sur le rang du joueur (${apres.rang})`);
  dit(/USDG|—/.test(apres.gain), `le gain s'affiche en USDG : « ${apres.gain.trim()} »`);
  dit(apres.boutons === 'flex', 'les boutons LOBBY et REJOUER apparaissent une fois la roue calée');

  // La capture se prend MAINTENANT, roue calée : après le retour au lobby elle
  // photographierait le lobby, ce qui ne prouve rien.
  await a.page.screenshot({ path: 'shots/duel-fin.png' });
  console.log('     shots/duel-fin.png');

  /*
   * ON NE RENTRE PAS AU LOBBY TOUT SEUL, et c'est le point.
   *
   * Le joueur vient de gagner ou de perdre de l'argent réel. Lui reprendre l'écran au bout
   * de quatre secondes était une décision qu'on prenait à sa place. On vérifie donc qu'on
   * est TOUJOURS là, puis qu'on part quand il le demande.
   */
  await a.page.waitForTimeout(6000);
  const tenu = await a.page.evaluate(() => ({
    panneau: document.getElementById('fin-panneau').classList.contains('show'),
    mode: window.__probeGame().mode,
    verdict: document.getElementById('verdict-texte').textContent,
  }));
  dit(tenu.panneau === true,
    'six secondes plus tard on est toujours sur l\'écran de fin : rien ne se ferme tout seul');
  /*
   * ET LE CORPS EST TOUJOURS AU-DELÀ DE LA LIGNE. C'est la régression qu'on garde : sans
   * la garde `_fin` de `main.js`, le chemin hors ligne aurait tiré ici, remis `mode` à
   * `finished`, écrasé le verdict et détruit la roue.
   */
  // `podium` : la partie est COUPEE et le plateau montre le vainqueur. Ce qu'on garde de
  // la regression d'origine, c'est que la boucle ne retombe pas en `finished` hors ligne.
  dit(tenu.mode === 'podium',
    `la boucle ne rejoue pas la fin de manche hors ligne (mode « ${tenu.mode} »)`);
  dit(tenu.verdict !== 'QUALIFIED!',
    `le verdict de fin de partie n'est pas écrasé par celui d'une manche (« ${tenu.verdict} »)`);

  /*
   * ET L'AUTRE JOUEUR AUSSI, à la même seconde.
   *
   * Une partie se termine POUR TOUT LE MONDE : le serveur diffuse `fin-partie` à tous ses
   * humains, pas au seul vainqueur. Le harnais ne regardait que la page du gagnant — donc
   * un perdant resté en course, ou renvoyé au lobby sans écran, serait passé inaperçu.
   * C'est exactement ce qui a été rapporté en jouant : « l'un est renvoyé au lobby sans
   * rien, l'autre est encore en partie comme si de rien n'était ».
   */
  const cote = await b.page.evaluate(() => ({
    panneau: document.getElementById('fin-panneau').classList.contains('show'),
    titre: document.getElementById('fin-titre').textContent,
    sous: document.getElementById('fin-sous').textContent,
    enligne: Boolean(window.__probeGame().enligne),
  }));
  console.log(`     ${b.nom} : ${cote.titre} · ${cote.sous}`);
  dit(cote.panneau === true, 'le PERDANT a lui aussi son écran de fin');
  dit(cote.enligne === false, 'et sa session est détachée : il n\'est plus en partie');
  dit(/of \d+$/.test(cote.sous.trim()) || cote.sous.includes('·'),
    `son rang lui est annoncé : « ${cote.sous.trim()} »`);

  await a.page.click('#fin-lobby');
  await a.page.waitForFunction(() => window.__probeGame().mode === 'lobby', { timeout: 30000 });
  dit(true, 'LOBBY ramène au lobby, quand le joueur le décide');

  erreurs123.push(...a.erreurs, ...b.erreurs);
  await a.page.close(); await b.page.close();
  await court.arreter();
}

const erreurs = erreurs123;
console.log(erreurs.length ? `\nerreurs : ${[...new Set(erreurs)].join(' | ')}` : '\nerreurs : aucune');

await browser.close();
await serveur.arreter();
console.log(`\n--- ${ko === 0 && !erreurs.length ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`} ---`);
process.exit(ko || erreurs.length ? 1 : 0);
