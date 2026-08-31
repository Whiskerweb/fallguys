/**
 * SURVOL — la sequence d'entree tourne-t-elle sur TOUTES les epreuves ?
 *
 * Le survol est genere depuis le trace de l'arene, pas ecrit a la main. C'est ce qui le
 * rend robuste, et c'est aussi ce qui rend ce harnais necessaire : une carte dont les
 * `trajectoires` ont une autre forme, ou n'en a pas du tout, doit quand meme produire un
 * rail exploitable. Un survol qui pointe vers l'origine du monde ou qui renvoie des NaN
 * ne se voit pas dans le code — il se voit ici.
 *
 * Trois verdicts par epreuve :
 *   1. aucune position ni cible NaN sur toute la duree ;
 *   2. la camera reste au-dessus du plan de mort — un rail qui passe sous l'eau montre
 *      le dessous du decor, et le joueur croit a un bug d'affichage ;
 *   3. le rail PROGRESSE du depart vers l'arrivee, au lieu de rester sur place.
 *
 * Usage : node diag/survol.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

const PORT = process.env.FEELLAB_PORT ?? '5273';
const OUT = 'shots/survol';
await fs.mkdir(OUT, { recursive: true });

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.setDefaultTimeout(180000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)); });

// Sans `nointro` : c'est justement la sequence complete qu'on veut voir tourner.
await page.goto(`http://127.0.0.1:${PORT}/?lowfx&graine=12345`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 240000 });

const ids = await page.evaluate(() => window.__MINIGAMES.map((m) => m.id));
let echecs = 0;
const dit = (ok, texte) => { if (!ok) echecs++; console.log(`${ok ? 'OK  ' : 'ECHEC'} ${texte}`); };

for (const id of ids) {
  const r = await page.evaluate((id) => {
    const g = window.__probeGame();
    const jeu = window.__MINIGAMES.find((m) => m.id === id);
    g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
    g.startRace();
    if (!g.survol) return { erreur: 'aucun survol construit' };

    const a = g.arena;
    const pas = [];
    for (let i = 0; i <= 24; i++) {
      const { pos, look } = g.survol.echantillon(i / 24);
      pas.push({ p: [pos.x, pos.y, pos.z], l: [look.x, look.y, look.z] });
    }
    const fini = (v) => v.every((n) => Number.isFinite(n));
    return {
      nom: jeu.name,
      duree: g.survol.duree,
      sains: pas.every((k) => fini(k.p) && fini(k.l)),
      plusBas: Math.min(...pas.map((k) => k.p[1])),
      killY: a.killY,
      zDebut: pas[0].p[2],
      zFin: pas[pas.length - 1].p[2],
      xDebut: pas[0].p[0],
      xFin: pas[pas.length - 1].p[0],
      spawnZ: a.spawn.z,
      finishZ: a.finishZ,
      // Le carrousel doit s'etre arrete sur l'epreuve reellement tiree.
      carteVisee: document.querySelector('#nextup .carte[data-cible]')?.querySelector('.nom')?.textContent ?? null,
    };
  }, id);

  if (r.erreur) { dit(false, `${id} : ${r.erreur}`); continue; }

  // Une epreuve d'ARENE n'avance pas en Z : son survol tourne autour du terrain au lieu de
  // le longer. On exige alors que la camera se DEPLACE reellement, sans lui imposer un sens
  // — c'est le mouvement qui compte, et un travelling n'aurait ici aucun sens a suivre.
  const arene = Math.abs(r.finishZ - r.spawnZ) < 12;
  const sens = Math.sign(r.finishZ - r.spawnZ);
  const progresse = arene
    ? Math.hypot(r.zFin - r.zDebut, r.xFin - r.xDebut) > 20
    : Math.abs(r.zFin - r.zDebut) > Math.abs(r.finishZ - r.spawnZ) * 0.5
      && Math.sign(r.zFin - r.zDebut) === sens;

  dit(r.sains, `${r.nom} — aucune coordonnee NaN sur 25 echantillons`);
  dit(r.plusBas > r.killY, `${r.nom} — le rail reste au-dessus du plan de mort `
    + `(${r.plusBas.toFixed(1)} m > ${r.killY} m)`);
  dit(progresse, `${r.nom} — ${arene ? 'le rail fait le tour de l\'arene' : 'le rail va du depart a l\'arrivee'} `
    + `(z ${r.zDebut.toFixed(0)} → ${r.zFin.toFixed(0)}, parcours ${r.spawnZ.toFixed(0)} → ${r.finishZ.toFixed(0)})`);
  dit(r.carteVisee === r.nom, `${r.nom} — le carrousel vise bien cette epreuve (${r.carteVisee})`);

  // Trois images de la sequence : carrousel, survol, ligne de depart apres la coupe.
  await page.evaluate(() => { window.__probeGame().intro.t = 0.1; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${id}-1-carrousel.png` });

  await page.evaluate(() => {
    const g = window.__probeGame();
    g.intro.phase = 'survol'; g.intro.t = 1.4;
    document.getElementById('nextup').classList.add('hidden');
    document.getElementById('iris').className = 'hidden';
    document.getElementById('titlecard').className = '';
    g.cadrerSurvol(0.4);
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${id}-2-survol.png` });

  await page.evaluate(() => window.__probeGame().sauterIntro());
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${id}-3-depart.png` });
}

dit(erreurs.length === 0, `aucune erreur console${erreurs.length ? ' : ' + erreurs[0] : ''}`);
console.log(`\n${ids.length * 3} images dans ${OUT}/`);
console.log(echecs ? `\n${echecs} VERDICT(S) EN ECHEC` : `\nSURVOL CONFORME SUR LES ${ids.length} EPREUVES`);
await browser.close();
process.exit(echecs ? 1 : 0);
