/**
 * Deroulement d'une PARTIE : trois manches tirees au sort, enchainees jusqu'a la victoire.
 *
 * Ce que le code seul ne dit pas :
 *  - les epreuves s'enchainent vraiment, sans repasser par le lobby ;
 *  - chaque manche libere le monde physique de la precedente ;
 *  - la couronne tombe a la FIN de la partie, pas a chaque manche ;
 *  - deux parties ne tirent pas la meme suite ni les memes dispositions.
 *
 * On triche sur la traversee : franchir trois maps au pilote prendrait des minutes de
 * rendu logiciel. On teleporte le joueur sur la ligne d'arrivee — ce qui est teste ici,
 * c'est l'ENCHAINEMENT, pas la jouabilite, deja couverte par les harnais de chaque map.
 */
import { chromium } from 'playwright';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 580 } });
page.setDefaultTimeout(180000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 180)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 180)); });

await page.addInitScript(() => localStorage.setItem('tumble-model', 'char-tycoon'));
await page.goto(`http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}/?lowfx&nointro`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 300000 });
await page.evaluate(() => localStorage.setItem('tumble-mise', '1'));
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/partie-lobby.png' });

/* Le solde remplace le compteur de couronnes : c'est desormais lui qui dit qu'une
   partie gagnee a paye, et c'est le seul chiffre que le joueur verifie vraiment. */
const lireSolde = () => page.evaluate(() => Number(localStorage.getItem('tumble-solde') ?? 25e6));
const soldeAvant = await lireSolde();
let ko = 0;

async function jouerUnePartie(numero) {
  await page.evaluate(() => window.__probeGame().startEpisode());
  const suite = [];
  for (let manche = 1; manche <= 4; manche++) {
    // Timeouts larges : le decompte dure quatre secondes de JEU, et La Course met pres
    // de trois secondes a se construire. En rendu logiciel, ces quatre secondes de jeu
    // peuvent demander plusieurs dizaines de secondes d'horloge.
    await page.waitForFunction(() => window.__probeGame().mode === 'racing', { timeout: 180000 });
    await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 180000 });
    const etat = await page.evaluate(() => {
      const g = window.__probeGame();
      return {
        titre: document.getElementById('race-title').textContent,
        badge: document.getElementById('race-manche').textContent,
        graine: g.manche, corps: g.arena.world.bodies.len(), index: g.partie?.index ?? -1,
      };
    });
    suite.push({ ...etat });
    console.log(`  ${etat.badge.padEnd(13)} ${etat.titre.padEnd(12)} graine ${String(etat.graine).padStart(10)} · ${etat.corps} corps`);
    if (manche === 3) await page.screenshot({ path: `shots/partie-${numero}-finale.png` });

    // Teleportation sur la ligne : on teste l'enchainement, pas la traversee.
    // La garde sur `arena` n'est pas decorative : une manche peut s'achever pendant la
    // capture d'ecran qui precede, et l'arene est alors deja liberee.
    const pose = await page.evaluate(() => {
      const g = window.__probeGame();
      if (!g.arena) return false;
      /*
       * Une epreuve de SURVIE n'a pas de ligne a franchir : la teleporter au bout ne fait
       * rien du tout, et l'attente qui suit expirait au bout de soixante secondes. On
       * avance donc son chronometre, ce qui emprunte exactement le meme chemin de code que
       * le joueur qui tient jusqu'au bout — la boucle de jeu compare `runTime` a la duree
       * annoncee, et rien d'autre. Pas de porte derobee : le raccourci vaut la chose.
       */
      if (g.arena.survie) { g.runTime = g.arena.survie.duree; return true; }
      window.__probeCharacter().body.setTranslation({ x: 0, y: 3, z: g.arena.finishZ - 1 }, true);
      return true;
    });
    if (!pose) { console.log('    (manche deja terminee avant la teleportation)'); break; }
    await page.waitForFunction(() => window.__probeGame().mode !== 'racing', { timeout: 60000 });
    const fin = await page.evaluate(() => ({
      texte: document.getElementById('verdict-texte').textContent,
      classes: document.getElementById('verdict').className,
      partie: window.__probeGame().partie ? 'en cours' : 'terminee',
    }));
    console.log(`    -> ${fin.texte} (${fin.classes.replace('show ', '')}) · partie ${fin.partie}`);
    if (fin.partie === 'terminee') {
      if (manche !== 3) { console.log(`    ! la partie s'arrete a la manche ${manche}, 3 attendues`); ko++; }
      // La finale doit annoncer la VICTOIRE tout de suite : pas de « qualifie » suivi
      // d'une seconde annonce, ce serait deux messages pour un seul evenement.
      if (!fin.texte?.startsWith('VICTORY')) { console.log(`    ! verdict final "${fin.texte}", VICTORY attendu`); ko++; }
      await page.screenshot({ path: `shots/partie-${numero}-victoire.png` });
      break;
    }
    if (!fin.texte?.startsWith('QUALIFIED')) { console.log(`    ! verdict "${fin.texte}", QUALIFIED attendu`); ko++; }
    // On laisse la boucle de jeu enchainer d'elle-meme sur la manche suivante.
    await page.waitForFunction(() => window.__probeGame().mode === 'racing', { timeout: 60000 });
  }
  return suite;
}

console.log('--- partie 1 ---');
const p1 = await jouerUnePartie(1);
await page.waitForFunction(() => window.__probeGame().mode === 'lobby', { timeout: 60000 });
console.log('\n--- partie 2 ---');
const p2 = await jouerUnePartie(2);
await page.waitForFunction(() => window.__probeGame().mode === 'lobby', { timeout: 60000 });

/* Deux parties gagnees a 1 USDC : -1 de mise +4,50 de gain, deux fois. Le solde doit
   donc monter de 7,00 exactement — un centieme d'ecart signalerait un arrondi fautif. */
const soldeApres = await lireSolde();
const delta = soldeApres - soldeAvant;
console.log(`\nsolde : ${(soldeAvant / 1e6).toFixed(2)} -> ${(soldeApres / 1e6).toFixed(2)} USDC `
  + `(${delta >= 0 ? '+' : ''}${(delta / 1e6).toFixed(2)}, attendu +7,00 : 2 x (-1,00 de mise + 4,50 de gain))`);
if (delta !== 7_000_000) ko++;

const graines = [...p1, ...p2].map((m) => m.graine);
const uniques = new Set(graines).size;
console.log(`graines tirees : ${uniques}/${graines.length} distinctes -> ${uniques === graines.length ? 'chaque manche a sa disposition' : 'COLLISION'}`);
if (uniques !== graines.length) ko++;
console.log(`suite 1 : ${p1.map((m) => m.titre).join(' -> ')}`);
console.log(`suite 2 : ${p2.map((m) => m.titre).join(' -> ')}`);

console.log(`\nerreurs : ${erreurs.length}`);
for (const e of erreurs.slice(0, 6)) console.log('  ' + e);
await browser.close();
process.exit(erreurs.length || ko ? 1 : 0);
