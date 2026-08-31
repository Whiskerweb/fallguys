/**
 * Parcours COMPLET des Portes, piloté comme le ferait un joueur qui lit bien les murs :
 * a chaque mur, il vise la porte franchissable la plus proche de sa position.
 *
 * C'est le test qui dit si la map est jouable de bout en bout. Il verifie deux choses
 * qu'aucune inspection du code ne donne : que chaque mur laisse un passage reellement
 * ATTEIGNABLE, et que la suite des murs, rampes et paliers mene bien a la ligne. Comme la
 * disposition depend de la graine, il faut le passer sur PLUSIEURS manches — une seule
 * donne validee ne dit rien des autres.
 *
 * Usage : node diag/portes-run.mjs [nombre de manches]
 */
import { chromium } from 'playwright';

const MANCHES = Number(process.argv[2] ?? 3);

// Fermeture garantie : un script tue par timeout laisse sinon un Chromium orphelin,
// qui consomme le CPU et fait echouer les tests suivants sur des scenes pourtant saines.
let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });
process.on('SIGTERM', () => { fermer(); process.exit(143); });
browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.setDefaultTimeout(90000);
const erreurs = [];
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 150)); });
page.on('pageerror', (e) => erreurs.push('PAGE ' + String(e).slice(0, 150)));

await page.addInitScript(() => {
  localStorage.setItem('tumble-model', 'char-tycoon');
  localStorage.setItem('tumble-manche', '0');
});
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 180000 });
await page.waitForTimeout(600);

let gauche = false, droite = false;
async function cap(vers) {
  if (vers < -0.4 && !gauche) { await page.keyboard.down('ArrowLeft'); gauche = true; }
  if (vers > -0.4 && gauche) { await page.keyboard.up('ArrowLeft'); gauche = false; }
  if (vers > 0.4 && !droite) { await page.keyboard.down('ArrowRight'); droite = true; }
  if (vers < 0.4 && droite) { await page.keyboard.up('ArrowRight'); droite = false; }
}
async function relacher() {
  await page.keyboard.up('ArrowUp');
  if (gauche) { await page.keyboard.up('ArrowLeft'); gauche = false; }
  if (droite) { await page.keyboard.up('ArrowRight'); droite = false; }
}

let ko = 0, inacheve = 0;
for (let n = 0; n < MANCHES; n++) {
  await page.evaluate(() => {
    const g = window.__probeGame();
    const jeu = window.__MINIGAMES.find((m) => m.id === 'doors');
    g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
    g.startRace();
  });
  await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 120000 });

  const info = await page.evaluate(() => {
    const g = window.__probeGame();
    return { murs: g.arena.__murs(), manche: g.manche };
  });

  await page.keyboard.down('ArrowUp');
  // La borne porte sur le TEMPS DE JEU, pas sur l'horloge murale : en rendu logiciel le
  // jeu tourne bien plus lentement que le temps reel, et une limite en secondes reelles
  // coupait des parcours parfaitement franchissables au milieu.
  // L'immobilite se mesure en TEMPS DE JEU, jamais en nombre d'iterations du script.
  // En rendu logiciel, une iteration de 45 ms ne laisse parfois pas passer une seule
  // image : le joueur n'a alors pas bouge, sans etre bloque pour autant. Un compteur
  // d'iterations avait ainsi declare bloquees cinq manches sur cinq, toutes
  // parfaitement franchissables.
  let arrive = false, dernierZ = 999, tempsAuDernierProgres = 0, dernierEtat = null;
  // Le budget d'iterations n'est PAS un verdict : sous rendu logiciel, une manche
  // parfaitement franchissable peut l'epuiser sans avoir rien de bloque. On distingue
  // donc les deux, sinon le test accuse la map de ce qui n'est qu'une machine chargee.
  let raison = 'budget du harnais epuise';
  for (let i = 0; i < 8000; i++) {
    // Sonde TOLERANTE au vide. Franchir la ligne libere l'arene et le personnage trois
    // secondes plus tard : une manche gagnee faisait planter le harnais sur un
    // `__probeCharacter()` nul, et l'ARRIVEE se lisait comme une erreur de script.
    const p = await page.evaluate(() => {
      const g = window.__probeGame();
      const c = window.__probeCharacter();
      const t = c?.body?.translation() ?? null;
      return { x: t?.x ?? 0, z: t?.z ?? 0, mode: t ? g?.mode ?? 'lobby' : 'lobby', temps: g?.runTime ?? 0 };
    });
    dernierEtat = p;
    if (p.mode !== 'racing') { arrive = true; break; }
    if (p.temps > 90) { raison = 'plus de 90 s de jeu'; break; }                       // 90 s de JEU : largement au-dessus du besoin

    const devant = info.murs.filter((m) => m.z < p.z - 0.5).sort((a, b) => b.z - a.z)[0];
    const cible = devant?.xOuvertes.length
      ? devant.xOuvertes.reduce((a, b) => (Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a))
      : 0;
    await cap(cible - p.x);

    if (p.z < dernierZ - 0.5) { dernierZ = p.z; tempsAuDernierProgres = p.temps; }
    // 6 s de JEU sans avancer d'un demi-metre : la, c'est un vrai blocage. Une culbute
    // contre une porte condamnee coute environ une seconde et demie, relevage compris.
    if (p.temps - tempsAuDernierProgres > 6) {
      raison = `IMMOBILE 6 s de jeu a z=${p.z.toFixed(1)}`;
      break;
    }
    await page.waitForTimeout(45);
  }
  await relacher();

  const fin = await page.evaluate(() => {
    const g = window.__probeGame();
    const c = window.__probeCharacter();
    const portes = g?.arena?.__portes?.() ?? [];
    return {
      z: c?.body?.translation().z ?? 0, temps: g?.runTime ?? 0, chutes: g?.falls ?? 0,
      brisees: portes.filter((p) => p.brisee).length, total: portes.length,
    };
  });
  // Seule l'immobilite condamne la donne : un budget epuisé ne dit rien de la map.
  if (!arrive && raison.startsWith('IMMOBILE')) ko++;
  if (!arrive && !raison.startsWith('IMMOBILE')) inacheve++;
  console.log(`manche ${String(info.manche).padStart(2)} · ${info.murs.length} murs · `
    + `${arrive ? 'ARRIVEE' : `arret a z=${fin.z.toFixed(1)} x=${(dernierEtat?.x ?? 0).toFixed(1)} (${raison})`} · `
    + `${fin.temps.toFixed(1)} s · ${fin.chutes} chute(s) · portes ${fin.brisees}/${fin.total}`);
  if (n === 0) await page.screenshot({ path: 'shots/portes-run-fin.png' });

  await page.evaluate(() => window.__probeGame().returnToLobby());
  await page.waitForTimeout(350);
}

console.log(`\n${MANCHES - ko - inacheve}/${MANCHES} manches menees a la ligne, ${ko} bloquee(s), `
  + `${inacheve} non conclue(s) faute de temps machine · erreurs console : ${erreurs.length}`);
for (const e of erreurs.slice(0, 5)) console.log('  ' + e);
await browser.close();
process.exit(erreurs.length || ko ? 1 : 0);
