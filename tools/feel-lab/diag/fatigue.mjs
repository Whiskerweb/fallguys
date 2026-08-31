/**
 * La FATIGUE DE SAUT tient-elle, et ne casse-t-elle aucune carte ?
 *
 * Sauter en rafale coûte de la hauteur (voir `TUNING.jumpFatigue`). C'est une
 * modification du CONTROLEUR : elle s'applique aux quatre épreuves à la fois, et elle
 * raccourcit une portée sur laquelle toutes les fosses du jeu ont été dimensionnées. Il
 * y a donc deux questions, et la seconde compte davantage que la première :
 *
 *  1. La fatigue existe-t-elle vraiment ? Cinq sauts enchaînés doivent monter de moins en
 *     moins haut, et la hauteur doit REVENIR après un temps d'arrêt. Une mécanique qui
 *     s'installe sans se lever serait une punition, pas une ressource.
 *  2. Une carte est-elle devenue infranchissable ? On confronte le saut le plus épuisé aux
 *     deux cotes qui le contraignent : l'obstacle sautable le plus haut du jeu, et le plus
 *     long vide à couvrir. Sinon un joueur qui a sauté trois fois se retrouve devant un
 *     obstacle qu'il franchit d'habitude, sans qu'aucune image ne lui dise pourquoi.
 *
 * Ces deux cotes sont LUES DANS LA SCENE, jamais recopiées ici : les recopier reviendrait
 * à valider une carte imaginaire dès que quelqu'un déplace un obstacle de dix centimètres.
 *
 * Lancer depuis tools/feel-lab, serveur actif :
 *   node diag/fatigue.mjs        ·  FEELLAB_PORT=5274 node diag/fatigue.mjs
 */
import { chromium } from 'playwright';

const BASE = `http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}`;
let browser;
process.on('exit', () => { try { browser?.close(); } catch {} });

const verdicts = [];
const dire = (ok, titre, detail) => {
  verdicts.push(ok);
  console.log(`${ok ? '  OK ' : 'ECHEC'} ${titre}${detail ? ' — ' + detail : ''}`);
};

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 360, height: 240 } });
page.setDefaultTimeout(600000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 160)));

await page.goto(`${BASE}/?lowfx&nointro&noassets&skip=scenery`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 600000 });
await page.evaluate(() => {
  const g = window.__probeGame();
  g.partie = { parcours: [window.__MINIGAMES.find((m) => m.id === 'course')], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 600000 });

// ── 1 : le reglage ────────────────────────────────────────────────────────────────────
const T = await page.evaluate(() => ({ ...window.__TUNING }));
const plancherTheorique = Math.sqrt(T.jumpFatigueFloor);
dire(T.jumpFatigueFloor >= 0.4 && T.jumpFatigueFloor <= 0.8,
  'le saut fatigue garde de quoi jouer',
  `plancher a ${(T.jumpFatigueFloor * 100).toFixed(0)} % de hauteur, `
  + `soit ${(plancherTheorique * 100).toFixed(0)} % de portee`);
dire(T.jumpRecovery <= 2.5, 'la fatigue se rattrape en restant au sol',
  `${T.jumpRecovery} s d'arret pour repartir a neuf`);

/**
 * APEX — la mesure primitive.
 *
 * La fatigue agit sur la HAUTEUR ; la portée n'en est qu'une conséquence. On mesure donc
 * la hauteur d'abord, à l'arrêt, où rien d'autre ne peut la faire varier : une portée
 * dépend aussi de la vitesse au décollage, jamais deux fois la même, et une première
 * version de ce harnais a lu 5,17 puis 4,56 puis 5,13 m sur des sauts tous à fatigue
 * nulle. Le bruit ressemblait exactement à la mécanique qu'on cherchait.
 *
 * On saute DES QU'ON RETOUCHE LE SOL. C'est ce que veut dire « plusieurs fois d'affilée » :
 * la même version attendait d'être relancée à 7 m/s entre deux sauts, ce qui laissait plus
 * d'une seconde au sol — assez pour tout récupérer. Elle mesurait un joueur reposé et
 * concluait que la fatigue n'existait pas.
 */
const apex = await page.evaluate(({ repos, n }) => new Promise((resolve) => {
  const g = window.__probeGame(), c = g.character;
  const k = (code, bas) => dispatchEvent(new KeyboardEvent(bas ? 'keydown' : 'keyup', { code, bubbles: true }));
  const sauts = [];
  let phase = 'attend', sol = 0, haut = -1e9, fatigueAuSaut = 0, attente = 0;
  const tick = () => {
    const p = c.body.translation();
    if (phase === 'attend') {
      if (c.state === 'grounded') {
        sol = p.y; haut = p.y; fatigueAuSaut = c.fatigue;
        k('Space', true); setTimeout(() => k('Space', false), 80);
        phase = 'monte';
      }
    } else if (phase === 'monte') {
      haut = Math.max(haut, p.y);
      if (c.state === 'grounded' && haut > sol + 0.2) {
        sauts.push({ h: +(haut - sol).toFixed(2), fatigue: +fatigueAuSaut.toFixed(2) });
        if (sauts.length === n) { phase = 'repos'; attente = repos; }
        else if (sauts.length > n) return resolve(sauts);
        else phase = 'attend';
      }
    } else if (phase === 'repos') {
      attente -= 1 / 60;
      if (attente <= 0) phase = 'attend';
    }
    requestAnimationFrame(tick);
  };
  // Sur place, sur la plateforme de depart : pas de pente, pas de surface mobile, rien
  // qui puisse expliquer une variation de hauteur autrement que par la fatigue.
  c.respawn({ x: g.arena.spawn.x, y: g.arena.spawn.y, z: g.arena.spawn.z });
  setTimeout(() => requestAnimationFrame(tick), 600);
  setTimeout(() => resolve(sauts), 120000);
}), { repos: 2.2, n: 5 });

const hauteurs = apex.slice(0, 5).map((m) => m.h);
const apresRepos = apex[5]?.h ?? null;
console.log(`apex : ${apex.map((m) => `${m.h} m (fatigue ${m.fatigue})`).join(' · ')}`);

dire(hauteurs.length === 5 && hauteurs[0] > hauteurs[4] * 1.15,
  'sauter en rafale monte de moins en moins haut',
  `${hauteurs[0]} m au premier saut, ${hauteurs[4]} m au cinquieme`);
dire(hauteurs.every((h, i) => i === 0 || h <= hauteurs[i - 1] + 0.04),
  'la hauteur ne remonte jamais au milieu de la rafale', hauteurs.join(' > ') + ' m');
dire(apresRepos !== null && apresRepos > hauteurs[4] * 1.15,
  'la hauteur REVIENT apres un temps d\'arret',
  `${apresRepos} m apres 2,2 s au sol, contre ${hauteurs[4]} m en fin de rafale`);

const apexEpuise = Math.min(...hauteurs);
const porteeEpuisee = T.maxSpeed * (Math.sqrt(2 * apexEpuise / T.gravity)
  + Math.sqrt(2 * apexEpuise / (T.gravity * T.fallMultiplier)));

// ── 2 : une carte est-elle devenue infranchissable ? ──────────────────────────────────
/*
 * LA VRAIE QUESTION.
 *
 * La fatigue est une modification du CONTROLEUR : elle s'applique aux quatre épreuves, et
 * elle raccourcit la portée sur laquelle toutes leurs cotes ont été dimensionnées. On
 * relit donc ces cotes DANS LA SCENE — l'obstacle sautable le plus haut, le vide le plus
 * long — et on les confronte au saut épuisé. Les recopier ici reviendrait à valider une
 * carte imaginaire dès que quelqu'un déplace un obstacle de dix centimètres.
 */
await page.evaluate(() => {
  const g = window.__probeGame();
  g.partie = { parcours: [window.__MINIGAMES.find((m) => m.id === 'rondin')], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => window.__probeGame().arena?.__cotes, { timeout: 600000 });
await page.waitForTimeout(900);
const rondin = await page.evaluate(() => window.__probeGame().arena.__cotes());
const obstacle = rondin.ARETE_BASSE ?? rondin.FAGOT_HAUT ?? rondin.FAGOT_H;

dire(apexEpuise > obstacle + 0.30,
  'meme epuise, on franchit l\'obstacle sautable le plus haut du jeu',
  `apex ${apexEpuise.toFixed(2)} m contre un obstacle de ${obstacle} m `
  + `(marge ${(apexEpuise - obstacle).toFixed(2)} m)`);
dire(porteeEpuisee > rondin.TROU_M + 0.50,
  'meme epuise, on franchit le plus long vide du jeu',
  `portee ${porteeEpuisee.toFixed(2)} m contre un trou de ${rondin.TROU_M} m `
  + `(marge ${(porteeEpuisee - rondin.TROU_M).toFixed(2)} m)`);

console.log(erreurs.length ? `\nerreurs page : ${[...new Set(erreurs)].join(' | ')}` : '\nerreurs page : aucune');
const ok = verdicts.filter(Boolean).length;
console.log(`\n${ok}/${verdicts.length} verdicts au vert`);
await browser.close();
process.exit(ok === verdicts.length ? 0 : 1);
