/**
 * Y a-t-il un trou là où deux rubans se rejoignent ?
 *
 * `continuite.mjs` sonde les TRAJECTOIRES — l'axe et les deux bords de chaque ruban. Il ne
 * peut donc pas voir un vide qui n'appartient à aucun ruban, et c'est exactement la forme
 * que prend un défaut de raccord : les deux voies existent chacune parfaitement, et c'est
 * l'espace ENTRE elles qui manque.
 *
 * On tire donc une grille de rayons sur toute la zone, sans rien supposer de la géométrie,
 * et on imprime pour chaque cote Z les intervalles de sol trouvés. Un trou encadré de sol
 * des deux côtés est un piège : il se lit comme une jonction et se traverse par le fond.
 *
 * Lancer depuis tools/feel-lab, serveur de dev actif :
 *   node diag/raccord.mjs [zDebut] [zFin]
 */
import { chromium } from 'playwright';

const Z_DEBUT = Number(process.argv[2] ?? -86);
const Z_FIN = Number(process.argv[3] ?? -102);

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 420 } });
page.setDefaultTimeout(600000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));

await page.goto('http://127.0.0.1:5273/?lowfx&nointro&noassets&skip=scenery', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 600000 });
await page.evaluate(() => {
  const jeu = window.__probeGame();
  jeu.partie = {
    parcours: [window.__MINIGAMES.find((m) => m.id === 'course')],
    index: 0, temps: [], chutes: 0,
  };
  jeu.startRace();
});
await page.waitForFunction(() => window.__probeGame().arena?.world && window.__RAPIER, { timeout: 600000 });
await page.waitForTimeout(1200);

const releve = await page.evaluate(([zA, zB]) => {
  // On tire les rayons SOI-MEME plutot que par une sonde de scene : toutes les epreuves
  // n'en exposent pas, et un outil de raccord doit pouvoir s'appliquer a n'importe
  // laquelle sans qu'on ait a l'instrumenter d'abord.
  const world = window.__probeGame().arena.world;
  const R = window.__RAPIER;
  const tir = (x, z) => {
    const ray = new R.Ray({ x, y: 14, z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 26, true);
    return hit ? hit.timeOfImpact : null;
  };
  const PAS_X = 0.25, PAS_Z = 0.5, X_MIN = -22, X_MAX = 10;
  const lignes = [];
  for (let z = zA; z >= zB; z -= PAS_Z) {
    // Un rayon par pas de 25 cm, tiré de haut en bas. On ne suppose aucune largeur.
    const dur = [];
    for (let x = X_MIN; x <= X_MAX; x += PAS_X) {
      const t = tir(x, z);
      dur.push(t !== null && 14 - t > -4);
    }
    // Intervalles de sol contigus, exprimés en mètres.
    const bandes = [];
    let debut = null;
    dur.forEach((plein, i) => {
      const x = X_MIN + i * PAS_X;
      if (plein && debut === null) debut = x;
      if (!plein && debut !== null) { bandes.push([debut, x - PAS_X]); debut = null; }
    });
    if (debut !== null) bandes.push([debut, X_MAX]);
    lignes.push({ z: Math.round(z * 10) / 10, bandes });
  }
  return lignes;
}, [Z_DEBUT, Z_FIN]);

console.log(`Grille de rayons, z de ${Z_DEBUT} a ${Z_FIN}, un tir tous les 25 cm.\n`);
console.log('   z    | bandes de sol (m)                      | trou entre deux bandes');
console.log('--------+----------------------------------------+------------------------');
let pire = 0, pireZ = null;
for (const l of releve) {
  const desc = l.bandes.map(([a, b]) => `[${a.toFixed(1)} ${b.toFixed(1)}]`).join(' ') || '— aucun sol —';
  let trous = '';
  for (let i = 1; i < l.bandes.length; i++) {
    const large = l.bandes[i][0] - l.bandes[i - 1][1];
    trous += `${large.toFixed(2)} m `;
    if (large > pire) { pire = large; pireZ = l.z; }
  }
  console.log(`${String(l.z).padStart(7)} | ${desc.padEnd(38)} | ${trous || '—'}`);
}
console.log(`\nPire trou ENTRE deux bandes de sol : ${pire.toFixed(2)} m a z = ${pireZ}`);
console.log(erreurs.length ? `erreurs : ${[...new Set(erreurs)].join(' | ')}` : 'erreurs : aucune');
await browser.close();
