/**
 * Cadrage du lobby : vue d'accueil et vitrine des personnages.
 *
 * Deux choses qui ne se jugent qu'a l'image : le personnage est-il assez grand et bien
 * place, et le socle donne-t-il l'impression d'etre POSE sur un sol qui n'existe pas ?
 * Le script mesure en plus la position du personnage a l'ecran, pour que le cadrage se
 * regle sur un chiffre plutot qu'a l'oeil.
 */
import { chromium } from 'playwright';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(120000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 150)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 150)); });

const modele = process.argv[2] ?? 'char-runner';
await page.addInitScript((m) => localStorage.setItem('tumble-model', m), modele);
await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 240000 });
await page.waitForTimeout(900);

/** Ou se projette le personnage a l'ecran, en pourcentage de la fenetre. */
async function mesurer(nom) {
  const m = await page.evaluate(() => {
    const THREE = window.__THREE;
    const g = window.__probeGame();
    const av = g.lobby.avatarHandle?.() ?? null;
    const cam = g.view.camera;
    // Le personnage rigge est un SkinnedMesh : sa boite englobante au repos ne reflete
    // pas la pose courante. On force la mise a jour du monde avant de la calculer,
    // sinon la mesure renvoie une boite vide.
    const cible = av?.model ?? g.lobby.group;
    cible.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    cible.traverse((o) => {
      if (!o.isMesh || o.userData.isOutline) return;
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    const coin = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(x, y, z).project(cam);
      coin.push({ x: (v.x + 1) / 2 * 100, y: (1 - v.y) / 2 * 100 });
    }
    const xs = coin.map((c) => c.x), ys = coin.map((c) => c.y);
    return {
      gauche: Math.min(...xs), droite: Math.max(...xs),
      haut: Math.min(...ys), bas: Math.max(...ys),
    };
  });
  const largeur = m.droite - m.gauche, hauteur = m.bas - m.haut;
  console.log(`${nom.padEnd(9)} personnage centre a ${((m.gauche + m.droite) / 2).toFixed(0)}% / `
    + `${((m.haut + m.bas) / 2).toFixed(0)}% de l'ecran · occupe ${largeur.toFixed(0)}% x ${hauteur.toFixed(0)}%`);
  await page.screenshot({ path: `shots/lobby-${nom}.png` });
}

await mesurer('accueil');

// Onglet Personnage : la vitrine.
await page.click('.navbtn[data-tab="skins"]');
await page.waitForTimeout(900);
await mesurer('vitrine');

console.log(`erreurs : ${erreurs.length}`);
for (const e of erreurs.slice(0, 5)) console.log('  ' + e);
await browser.close();
