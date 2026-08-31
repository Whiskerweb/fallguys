/**
 * Fabrique les vignettes du carrousel A PARTIR DES EPREUVES ELLES-MEMES.
 *
 * Elles avaient d'abord ete dessinees par un generateur d'images : jolies, mais elles ne
 * montraient pas l'epreuve qu'on va jouer. Celle du Rondin figurait une piste rayee rouge
 * et bleu au milieu d'un lagon — rien a voir avec les troncs. Or le carrousel sert
 * precisement a annoncer le terrain : une vignette qui ment sur ce qui arrive est pire
 * qu'une vignette absente, puisqu'elle est crue.
 *
 * Rendre la scene garantit que la carte et l'epreuve sont la meme chose, et qu'une vignette
 * ne peut plus dater d'une version anterieure de la map. C'est le meme raisonnement que
 * `portrait.mjs` pour les personnages, et il vaut ici pour la meme raison.
 *
 * A RELANCER apres toute modification visible d'une epreuve.
 *
 * Usage : node diag/cartes.mjs [id ...]      (defaut : toutes)
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

const PORT = process.env.FEELLAB_PORT ?? '5273';
const OUT = 'public/icons';
/**
 * 640 x 440, soit le 16/11 de la carte du carrousel. Cadrer au format final evite que le
 * CSS ne recadre l'image differemment selon la largeur de la fenetre — la composition
 * serait alors livree au hasard.
 */
const L = 640, H = 440;

/**
 * Ou placer la camera sur le rail du survol, de 0 (depart) a 1 (arrivee).
 *
 * Le survol est deja construit pour montrer un parcours : on lui emprunte son cadrage
 * plutot que d'en inventer un second qui divergerait. La fraction differe d'une epreuve a
 * l'autre parce que ce qui les caracterise n'est pas au meme endroit — les portes se lisent
 * de face des le premier mur, le rondin demande d'etre pris de plus loin pour qu'on voie
 * les troncs s'enchainer.
 */
const CADRAGE = { course: 0.16, doors: 0.10, rondin: 0.22, dalles: 0.12 };

await fs.mkdir(OUT, { recursive: true });
browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: L, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));

// PAS de `lowfx` : la vignette est une image de presentation, elle doit montrer le jeu tel
// qu'il s'affiche chez le joueur — bloom et ombres compris.
//
// PAS de `nointro` non plus, et c'est voulu : c'est la sequence d'entree qui CONSTRUIT le
// rail de survol, et c'est ce rail qu'on emprunte pour cadrer. Le carrousel qu'elle affiche
// par-dessus la scene est masque avec le reste de l'interface.
await page.goto(`http://127.0.0.1:${PORT}/?graine=7777`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 300000 });

const demandes = process.argv.slice(2);
const ids = await page.evaluate(() => window.__MINIGAMES.map((m) => m.id));
const cibles = demandes.length ? ids.filter((i) => demandes.includes(i)) : ids;

for (const id of cibles) {
  await page.evaluate((id) => {
    const g = window.__probeGame();
    const jeu = window.__MINIGAMES.find((m) => m.id === id);
    g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
    g.startRace();
  }, id);
  // On attend le RAIL, pas le chronometre : pendant la sequence d'entree la course n'a pas
  // encore demarre, et `runTime` reste a zero.
  await page.waitForFunction(() => !!window.__probeGame?.()?.survol, { timeout: 240000 });

  // Le personnage n'a rien a faire sur une vignette de TERRAIN : il y serait minuscule, et
  // au depart il est de dos, immobile, a contre-jour. On le masque.
  await page.evaluate((t) => {
    const g = window.__probeGame();
    document.querySelectorAll('body > div').forEach((e) => { e.style.visibility = 'hidden'; });
    g.freezeCamera = true;
    if (g.character?.visual) g.character.visual.visible = false;
    const { pos, look } = g.survol
      ? g.survol.echantillon(t)
      : { pos: g.view.camera.position, look: g.arena.spawn };
    g.view.camera.position.copy(pos);
    g.view.camera.lookAt(look);
    g.view.camera.updateProjectionMatrix();
  }, CADRAGE[id] ?? 0.16);

  // Le rendu logiciel avec post-traitement demande plusieurs images avant de se stabiliser.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/map-${id}.png` });
  console.log(`OK  map-${id}.png`);
}

console.log(erreurs.length ? `\nerreurs : ${erreurs[0]}` : `\n${cibles.length} vignettes rendues depuis les epreuves`);
await browser.close();
