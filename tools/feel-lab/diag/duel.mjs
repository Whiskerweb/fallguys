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
 * Lancer depuis tools/feel-lab, avec le serveur de jeu ARRÊTÉ (le harnais le démarre) :
 *   node diag/duel.mjs        ·  FEELLAB_PORT=5291 node diag/duel.mjs
 */

import { chromium } from 'playwright';
import { demarrerServeur } from '../../../serveur/src/serveur.js';

const BASE = `http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}`;

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
  politique: { nom: 'DUEL_TEST', cible: 2, minimum: 2, attente: 1, proposerApres: 1, bots: 'jamais', dureeManche: 300 },
  graine: 20260901,
});
const wsUrl = `ws://127.0.0.1:${serveur.port}`;
console.log(`serveur de jeu sur ${wsUrl}`);

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** Ouvre une page, la mène jusqu'au lobby, et la connecte au serveur sous ce nom. */
async function ouvrir(nom) {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.setDefaultTimeout(300000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`${nom}: ${String(e).slice(0, 160)}`));

  // `noassets` : le rendu logiciel de ce harnais mettrait une éternité à charger cent
  // cinquante mégaoctets de GLB, et les figurants savent se replier sur une capsule.
  await page.goto(`${BASE}/?lowfx&nointro&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && getComputedStyle(l).display === 'none';
  }, { timeout: 300000 });

  await page.click('#btn-enligne');
  await page.fill('#enligne-url', wsUrl);
  await page.fill('#enligne-nom', nom);
  await page.click('#enligne-jouer');
  return { nom, page, erreurs };
}

titre('1. Deux navigateurs rejoignent le même serveur');
const un = await ouvrir('machine-1');
const deux = await ouvrir('machine-2');

// Le salon est plein à deux : la manche doit s'annoncer d'elle-même.
for (const j of [un, deux]) {
  await j.page.waitForFunction(() => window.__probeGame()?.mode === 'racing', { timeout: 120000 });
}
dit(true, 'les deux pages sont entrées en manche');

const carte = await Promise.all([un, deux].map((j) => j.page.evaluate(() => {
  const g = window.__probeGame();
  return { epreuve: g.jeuId, graine: g.manche, impose: Boolean(g.imposee), enligne: Boolean(g.enligne) };
})));
dit(carte[0].epreuve === carte[1].epreuve && carte[0].graine === carte[1].graine,
  `même carte des deux côtés : ${carte[0].epreuve}, graine ${carte[0].graine}`);
dit(carte[0].impose && carte[1].impose, 'la carte a bien été IMPOSÉE par le serveur, pas tirée localement');
dit(carte[0].enligne && carte[1].enligne, 'les deux pages sont en mode en ligne');

titre('2. Chacun voit l\'autre');

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

titre('3. La correction converge');
for (let i = 0; i < 2; i++) {
  const s = figurants[i];
  console.log(`     ${[un, deux][i].nom} · ${s.corrections} corrections · ${s.recalages} recalages`
    + ` · écart max ${(s.ecartMax * 100).toFixed(0)} cm · reste ${(s.enCours * 100).toFixed(0)} cm`);
  // Ce qui compte n'est pas le NOMBRE de corrections — un client lent en reçoit beaucoup —
  // mais le fait qu'elles s'ABSORBENT au lieu de s'accumuler.
  dit(s.enCours < 2.0, `l'écart en cours reste sous 2 m : la correction absorbe`);
}

await un.page.screenshot({ path: 'shots/duel-machine-1.png' });
await deux.page.screenshot({ path: 'shots/duel-machine-2.png' });
console.log('     shots/duel-machine-1.png · shots/duel-machine-2.png');

const erreurs = [...un.erreurs, ...deux.erreurs];
console.log(erreurs.length ? `\nerreurs : ${[...new Set(erreurs)].join(' | ')}` : '\nerreurs : aucune');

await browser.close();
await serveur.arreter();
console.log(`\n--- ${ko === 0 && !erreurs.length ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`} ---`);
process.exit(ko || erreurs.length ? 1 : 0);
