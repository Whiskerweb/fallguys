/**
 * La VIGNETTE de L'Hexagone pour le carrousel d'entrée en manche.
 *
 * `main.js` charge `/icons/map-<id>.png` pour chaque épreuve du carrousel, avec un repli en
 * dégradé sur l'accent de l'épreuve quand le fichier manque. Le repli fonctionne — rien ne
 * casse — mais une carte sans vignette au milieu de quatre cartes illustrées se lit comme
 * un trou, pas comme un choix.
 *
 * Ce n'est pas une image d'illustration : c'est une PRISE DE VUE du jeu, comme les quatre
 * autres. Une vignette peinte à côté de captures réelles mentirait sur ce qu'on va jouer, et
 * c'est exactement le genre de promesse qu'un jeu à mises n'a pas le droit de faire.
 *
 * 640 x 440, le format des vignettes existantes. Le fichier est écrit dans `public/icons/`
 * et recopié dans `tools/icon-pipeline/raw/`, où vivent les sources des autres.
 *
 * Lancer depuis tools/feel-lab, serveur actif :
 *   node diag/hexacarte.mjs        ·  FEELLAB_PORT=5274 node diag/hexacarte.mjs
 */
import { chromium } from 'playwright';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const BASE = `http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}`;
const SORTIE = 'public/icons/map-hexagone.png';
const BRUT = '../icon-pipeline/raw/map-hexagone.png';

let browser;
process.on('exit', () => { try { browser?.close(); } catch {} });

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 440 } });
page.setDefaultTimeout(600000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 160)));

// Décor COMPLET : c'est une vignette, pas une mesure. Pas de `noassets`, pas de `skip`.
await page.goto(`${BASE}/?lowfx&nointro&graine=4242`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 600000 });
await page.evaluate(() => {
  const g = window.__probeGame();
  g.partie = { parcours: [window.__MINIGAMES.find((m) => m.id === 'hexagone')], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => window.__probeGame().arena?.__cotes, { timeout: 600000 });
await page.waitForFunction(() => window.__probeGame().countdown <= 0, { timeout: 600000 });
await page.waitForTimeout(1500);

/*
 * On CREUSE les deux étages du haut avant de photographier.
 *
 * Une tour intacte ne dit pas ce qu'on vient y faire — elle ressemble à un gâteau. Ce sont
 * les trous qui racontent le mini-jeu, et la vignette doit annoncer le jeu, pas le décor.
 * On garde les étages du bas pleins : le contraste entre le haut rongé et le bas intact
 * dit d'un coup d'œil dans quel sens ça se passe.
 */
await page.evaluate(async () => {
  const g = window.__probeGame(), a = g.arena, c = g.character;
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const e of [0, 1]) {
    const et = a.__etages()[e];
    const hexas = a.__hexas(e);
    for (let i = 0; i < hexas.length; i += (e === 0 ? 3 : 4)) {
      const h = hexas[i];
      c.body.setTranslation({ x: h.x, y: et.y + 0.85, z: h.z }, true);
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      await attendre(22);
    }
  }
  // Le personnage sort du champ : la vignette montre le TERRAIN. Les quatre autres cartes
  // ne montrent pas non plus de joueur, et un bonhomme minuscule au milieu d'une tour ne
  // ferait qu'attirer l'œil loin de ce qu'il faut comprendre.
  c.body.setTranslation({ x: 900, y: 40, z: 0 }, true);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
});
await page.waitForTimeout(500);

await page.evaluate(() => {
  window.__probeGame().freezeCamera = true;
  document.querySelectorAll('body > div').forEach((e) => { e.style.visibility = 'hidden'; });
});

/*
 * CADRAGE. Trois quarts, légèrement en plongée, la tour occupant la hauteur du cadre.
 *
 * Les cotes sont lues dans la scène : la hauteur d'étage a triplé deux fois pendant la
 * mise au point de cette carte, et un cadrage écrit en dur aurait photographié le ciel
 * sans que rien ne le signale.
 */
const cadre = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  const c = a.__cotes();
  const bas = a.__etages()[a.__etages().length - 1];
  const R = bas.rayon;
  const milieu = (c.HAUT + bas.y) / 2;
  return {
    /*
     * TELEOBJECTIF, et de loin. Ce ne sont pas les etages qui debordaient du cadre mais les
     * POTEAUX D'ANGLE : a 84 m de la tour, ceux du premier plan n'etaient qu'a 46 m, donc
     * presque deux fois plus grands a l'ecran, et ils remplissaient l'image a eux seuls.
     * Reculer en resserrant le champ ecrase cet ecart — a 165 m, le rapport tombe a 1,3 et
     * l'ossature redevient un cadre au lieu d'un sujet.
     *
     * L'azimut a 45 degres vise ENTRE deux poteaux (ils sont a 30 et 90 degres), pour ne pas
     * planter une barre orange au milieu de la vignette.
     */
    dist: (c.SOCLE_Y - c.BOUE_Y) * 2.4,
    hauteur: c.HAUT + 10,
    look: [0, milieu - 3, 0],
    R, HAUT: c.HAUT, basY: bas.y, socle: c.SOCLE_Y, boue: c.BOUE_Y, milieu,
  };
});
const d = cadre.dist / Math.SQRT2;
const pos = [d, cadre.hauteur, d];
const { look } = cadre;
console.log(`tour : sommet ${cadre.HAUT} · bas ${cadre.basY} · socle ${cadre.socle} · boue ${cadre.boue}`);
console.log(`rayon bas ${cadre.R.toFixed(1)} · camera ${pos.map((n) => n.toFixed(1))} · vise ${look.map((n) => n.toFixed(1))}`);
console.log(`distance camera->cible : ${Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]).toFixed(1)} m`
  + ` · hauteur a cadrer : ${(cadre.socle - cadre.boue).toFixed(1)} m`);
await page.evaluate(([p, l]) => {
  const v = window.__probeGame().view;
  /*
   * On REPOUSSE le brouillard le temps de la photo.
   *
   * Il est reglé pour une caméra de jeu, qui se tient a une dizaine de mètres du
   * personnage. A 165 m, il délavait toute la tour en un gris laiteux — les quatre autres
   * vignettes, prises de bien plus près, ne rencontrent jamais ce problème. Le brouillard
   * appartient au rendu du jeu, pas à la description de la carte.
   */
  const f = v.scene.fog;
  if (f) {
    if ('far' in f) { f.near = 900; f.far = 2400; }
    if ('density' in f) f.density = 0.00002;
  }
  const cam = v.camera;
  cam.up.set(0, 1, 0);
  cam.fov = 25;
  cam.position.set(p[0], p[1], p[2]);
  cam.lookAt(l[0], l[1], l[2]);
  cam.updateProjectionMatrix();
}, [pos, look]);
await page.waitForTimeout(400);

await page.screenshot({ path: SORTIE });
if (!existsSync('../icon-pipeline/raw')) mkdirSync('../icon-pipeline/raw', { recursive: true });
copyFileSync(SORTIE, BRUT);
console.log(`${SORTIE}  (640 x 440)`);
console.log(`${BRUT}`);
console.log(erreurs.length ? `erreurs : ${[...new Set(erreurs)].join(' | ')}` : 'erreurs : aucune');
await browser.close();
