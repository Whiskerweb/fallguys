/**
 * Le seul verdict qui compte : le parcours se TERMINE-T-IL ?
 *
 * Les harnais precedents testaient les obstacles un par un en teleportant le joueur
 * devant chacun. Ils mesuraient donc la justesse de MA liste d'obstacles, pas la
 * jouabilite : un obstacle absent de la liste etait invisible, et une teleportation a
 * une hauteur devinee faisait naitre le joueur dans le decor.
 *
 * Ici le pilote part du spawn, ne recoit aucune liste, et trouve son chemin au radar :
 * il sonde le sol devant lui a plusieurs largeurs, vise la colonne qui porte, et saute
 * quand le sol manque ou qu'un obstacle bas le barre. Il tourne DANS la page, au rythme
 * du jeu — un pilote pilote depuis Node subit un aller-retour par frame et joue au ralenti.
 */
import { chromium } from 'playwright';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

const ACTES = process.argv[2] ?? '5';
browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 460 } });
page.setDefaultTimeout(600000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 160)); });

await page.goto(`http://127.0.0.1:5273/?lowfx&noassets&skip=scenery`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 600000 });
await page.evaluate(() => {
  const g = window.__probeGame();
  const jeu = window.__MINIGAMES.find((m) => m.id === 'rondin');
  g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 600000 });

await page.evaluate(() => {
  const g = window.__probeGame();
  const a = g.arena, c = g.character;
  const touche = (code, bas) => dispatchEvent(new KeyboardEvent(bas ? 'keydown' : 'keyup', { code, bubbles: true }));
  const enfonce = new Set();
  const tenir = (code, veut) => {
    if (veut === enfonce.has(code)) return;
    veut ? enfonce.add(code) : enfonce.delete(code);
    touche(code, veut);
  };

  // Hauteur du sol sous (x, z), ou null. On ignore ce qui se trouve au-dessus des
  // epaules : un pilier renvoie un impact, mais ce n'est pas un sol.
  const solA = (x, z, yRef) => {
    const t = a.__ray(x, yRef + 1.2, z, 0, -1, 0, 26);
    if (t < 0) return null;
    const h = yRef + 1.2 - t;
    return h > yRef + 1.1 || h < yRef - 9 ? null : h;
  };

  const etat = { cible: 0, saut: 0, journal: [], plusLoin: 99, bloque: 0, dernierZ: 99 };
  window.__pilote = etat;

  const tick = () => {
    // La course terminee, l'arene et son monde Rapier sont liberes : continuer a les
    // sonder leve « null pointer passed to rust ». Le pilote s'arrete avec la manche.
    if (etat.fini || g.mode !== 'racing' || !g.arena) return;
    requestAnimationFrame(tick);
    const p = c.body.translation();
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
    etat.plusLoin = Math.min(etat.plusLoin, p.z);
    if (p.y < -6 && !etat.enChute) {
      etat.enChute = true;
      etat.chutes = etat.chutes || [];
      etat.chutes.push(`x=${p.x.toFixed(1)} z=${p.z.toFixed(1)}`);
    } else if (p.y > 0) etat.enChute = false;

    // ── choix de la colonne : on note chaque largeur sur deux profondeurs ──
    let meilleur = etat.cible, note = -1e9;
    for (let dx = -8; dx <= 8; dx += 1) {
      const x = p.x + dx;
      if (Math.abs(x) > 12) continue;
      const proche = solA(x, p.z - 3.0, p.y);
      const loin = solA(x, p.z - 7.0, p.y);
      let n = (proche !== null ? 3 : 0) + (loin !== null ? 2 : 0);
      // Marge laterale : personne ne court sur 20 cm de bord. Une colonne dont les
      // voisines portent vaut mieux qu'une colonne isolee — sans ce terme le pilote
      // longeait l'arete de la voie basse et tombait au moindre ecart.
      if (solA(x - 1.6, p.z - 3.0, p.y) !== null) n += 0.9;
      if (solA(x + 1.6, p.z - 3.0, p.y) !== null) n += 0.9;
      // La colonne est-elle DEGAGEE ? Les sondes de sol regardent a 3 m et 7 m ; un
      // pilier a 1 m tombe dans leur angle mort. Le pilote poussait contre lui
      // indefiniment en le croyant absent.
      if (a.__ray(x, p.y + 0.2, p.z, 0, 0, -1, 4.5) >= 0) n -= 5;
      n -= Math.abs(dx) * 0.12;                       // ne pas zigzaguer pour rien
      n -= Math.abs(x - etat.cible) * 0.30;           // hysterese : tenir sa ligne
      if (n > note) { note = n; meilleur = x; }
    }
    etat.cible = meilleur;

    /*
     * APPROCHE DE FOSSE : on cesse de slalomer. La vitesse est un budget partage entre
     * X et Z ; sauter en diagonale ramene la portee de 5,3 m a 3,9 m, et le fosse
     * devient infranchissable sans que rien ne l'indique. Un joueur humain s'aligne
     * d'instinct avant un saut long — le pilote doit faire pareil, sinon il mesure sa
     * propre maladresse et pas la map.
     */
    const fosseDevant = solA(p.x, p.z - 4.5, p.y) === null && solA(p.x, p.z - 9.0, p.y) !== null;
    const ecart = etat.cible - p.x;
    // On ne braque pas non plus EN VOL : la vitesse est un budget partage, et corriger
    // sa ligne au-dessus du vide raccourcit le saut d'un metre. Le pilote perdait ainsi
    // des fosses qu'il avait pourtant declenches au bon endroit.
    const enVol = c.state === 'airborne';
    const fige = fosseDevant || enVol;
    tenir('ArrowLeft', !fige && ecart < -0.35);
    tenir('ArrowRight', !fige && ecart > 0.35);
    tenir('ArrowUp', true);

    // ── sauter : soit le sol manque devant, soit un obstacle bas barre la route ──
    const solProche = solA(p.x, p.z - 1.4, p.y);
    const solApres = solA(p.x, p.z - 6.5, p.y);
    // Origine DEVANT le corps : un rayon parti du centre du joueur touche sa propre
    // capsule a distance 0 et signale un mur en permanence. Le pilote sautait alors
    // sans arret et arrivait aux fosses en plein temps de recharge.
    const murBas = a.__ray(p.x, p.y - 0.35, p.z - 0.9, 0, 0, -1, 2.2);
    const murHaut = a.__ray(p.x, p.y + 1.25, p.z - 0.9, 0, 0, -1, 2.2);
    const fosse = solProche === null && solApres !== null;
    const plat = solProche !== null && Math.abs(solProche - (p.y - 0.8)) < 0.9;
    const barriere = plat && murBas >= 0 && murBas < 1.9 && (murHaut < 0 || murHaut > 2.1);
    const auSol = c.state === 'grounded';
    etat.saut -= 1;
    if (auSol && etat.saut <= 0 && (fosse || barriere)) {
      etat.saut = 10;
      touche('Space', true);
      setTimeout(() => touche('Space', false), 90);
      const v0 = c.body.linvel();
      // On suit CE saut jusqu'a son terme : hauteur gagnee et distance reellement
      // couverte. Mesurer la portee sur une piste temoin ne dit rien de la portee au
      // moment ou le joueur meurt.
      const suivi = { z0: p.z, y0: p.y, yMax: p.y, n: 0 };
      const voir = () => {
        const q = c.body.translation();
        suivi.yMax = Math.max(suivi.yMax, q.y);
        suivi.n++;
        if (c.state === 'grounded' && suivi.n > 8 || suivi.n > 140 || q.y < suivi.y0 - 5) {
          etat.journal.push(`z=${suivi.z0.toFixed(1)} vz=${Math.abs(v0.z).toFixed(1)} vx=${Math.abs(v0.x).toFixed(1)} monte=${(suivi.yMax - suivi.y0).toFixed(2)}m portee=${(suivi.z0 - q.z).toFixed(1)}m ${fosse ? 'fosse' : 'obst'}`);
          return;
        }
        requestAnimationFrame(voir);
      };
      requestAnimationFrame(voir);
    }
  };
  requestAnimationFrame(tick);
});

// ── suivi, cadence au TEMPS DE JEU : le rendu logiciel avance 10x moins vite ──
const t0 = await page.evaluate(() => window.__probeGame().runTime);
let precedent = 99, immobile = 0, verdict = 'en cours';
for (let i = 1; i <= 70; i++) {
  await page.waitForFunction((t) => window.__probeGame().runTime > t, t0 + i * 2.0, { timeout: 600000 }).catch(() => {});
  const e = await page.evaluate(() => {
    const g = window.__probeGame(), c = window.__probeCharacter();
    if (!c || g.mode !== 'racing') return { fini: true, mode: g?.mode, z: 0, y: 0, x: 0, chutes: g?.falls ?? 0, cible: 0, etat: '-' };
    const t = c.body.translation();
    return { z: +t.z.toFixed(1), y: +t.y.toFixed(1), x: +t.x.toFixed(1), chutes: g.falls,
             cible: +window.__pilote.cible.toFixed(1), etat: c.state,
             mode: g.mode, fini: g.mode === 'finished', arrivee: g.arena.finishZ };
  });
  console.log(`  t+${String(i * 2).padStart(3)}s  x=${String(e.x).padStart(6)} z=${String(e.z).padStart(7)} y=${String(e.y).padStart(6)}  vise=${String(e.cible).padStart(6)}  ${e.etat.padEnd(9)} chutes=${e.chutes}`);
  if (e.fini) { verdict = 'ARRIVEE'; break; }
  immobile = e.z > precedent - 1.2 ? immobile + 1 : 0;
  precedent = Math.min(precedent, e.z);
  if (immobile >= 8) { verdict = `BLOQUE a z=${e.z}`; break; }
}

await page.evaluate(() => { window.__pilote.fini = true; });
const bilan = await page.evaluate(() => ({
  plusLoin: +window.__pilote.plusLoin.toFixed(1),
  sauts: window.__pilote.journal.length,
  ouChute: (window.__pilote.chutes || []).slice(0, 10),
  journal: window.__pilote.journal.slice(0, 14),
  chutes: window.__probeGame().falls,
  arrivee: window.__probeGame().arena?.finishZ ?? -204,
}));
console.log(`\nplus loin : z=${bilan.plusLoin} sur ${bilan.arrivee} · ${bilan.chutes} chute(s) · ${bilan.sauts} saut(s)`);
console.log('sauts :', bilan.journal.slice(0, 8).join(' | ') || 'aucun');
console.log('chutes :', bilan.ouChute.join(' | ') || 'aucune');
const pct = Math.round(((22 - bilan.plusLoin) / (22 - bilan.arrivee)) * 100);
console.log(`-> ${verdict} · ${pct}% du parcours`);
if (erreurs.length) console.log('erreurs :', erreurs.slice(0, 4));
await browser.close();
