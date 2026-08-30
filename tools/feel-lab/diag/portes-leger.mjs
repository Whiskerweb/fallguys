/**
 * Verification LEGERE des Portes : physique et etancheite, sans decor ni captures.
 *
 * `?noassets` coupe les quarante-neuf modeles Meshy et fait retomber la scene sur ses
 * formes procedurales. Le rendu logiciel devient alors praticable meme sur une machine
 * chargee, ou le harnais complet n'arrive plus au bout. Ce qui est teste ici — colliders,
 * rupture, etancheite — ne depend d'aucun asset.
 */
import { chromium } from 'playwright';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
page.setDefaultTimeout(180000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 150)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 150)); });

await page.addInitScript(() => {
  localStorage.setItem('tumble-manche', '6');
});
await page.goto('http://127.0.0.1:5273/?lowfx&noassets', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 300000 });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const g = window.__probeGame();
  const jeu = window.__MINIGAMES.find((m) => m.id === 'doors');
  g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 120000 });

const Z_MUR = -12;
const geo = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  return { murs: a.__murs(), largeur: a.largeur, portes: a.__portes().length, toutes: a.__apparences().length };
});
const mur1 = geo.murs.find((m) => Math.abs(m.z - Z_MUR) < 1);
console.log(`couloir ${geo.largeur} m · ${geo.toutes} panneaux dont ${geo.portes} franchissables`);
console.log(`mur 1 : ${mur1.xOuvertes.length} franchissables, ${mur1.xCondamnees.length} condamnees`);

async function foncer(x) {
  await page.evaluate(([x, z]) => {
    const c = window.__probeCharacter();
    c.body.setTranslation({ x, y: 7.8, z }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }, [x, Z_MUR + 5]);
  await page.waitForTimeout(300);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2600);
  const e = await page.evaluate(() => {
    const c = window.__probeCharacter();
    return { z: c.body.translation().z, vz: c.body.linvel().z };
  });
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(250);
  return e;
}

const vraie = await foncer(mur1.xOuvertes[0]);
const passe = vraie.z < Z_MUR - 1 && Math.abs(vraie.vz) > 5;
console.log(`franchissable x=${mur1.xOuvertes[0].toFixed(1)} : z ${vraie.z.toFixed(2)}, `
  + `${Math.abs(vraie.vz).toFixed(1)} m/s -> ${passe ? 'FRANCHIE SANS RALENTIR' : 'ANOMALIE'}`);

const fausse = await foncer(mur1.xCondamnees[0]);
const bloque = fausse.z > Z_MUR + 0.4;
console.log(`condamnee     x=${mur1.xCondamnees[0].toFixed(1)} : z ${fausse.z.toFixed(2)} `
  + `-> ${bloque ? 'A RESISTE' : 'A CEDE — anomalie'}`);

// Une porte condamnee ne doit JAMAIS se briser. Une regression recente les faisait
// toutes ceder a l'approche : la boucle de mise a jour, etendue a tous les panneaux
// pour la respiration, avait emporte avec elle le test de rupture.
const brisees = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  const ouvertes = new Set(a.__portes().map((p) => `${p.x.toFixed(2)}|${p.z}`));
  return a.__apparences().filter((p) => !p.ouverte).length
    + '|' + a.__portes().filter((p) => p.brisee).length
    + '|' + [...ouvertes].length;
});
const [condamnees, nbBrisees] = brisees.split('|');
console.log(`portes brisees : ${nbBrisees} (attendu 1) · ${condamnees} condamnees intactes`);

await page.evaluate(() => window.__probeGame().arena.reset());
await page.waitForTimeout(500);
const fuites = await page.evaluate(() => {
  const RAPIER = window.__RAPIER, a = window.__probeGame().arena, monde = a.world;
  const out = [];
  for (const m of a.__murs()) {
    let trous = 0;
    for (let x = -a.largeur / 2 + 0.1; x <= a.largeur / 2 - 0.1; x += 0.2) {
      const ray = new RAPIER.Ray({ x, y: m.y + 1.2, z: m.z + 4 }, { x: 0, y: 0, z: -1 });
      if (!monde.castRay(ray, 8, true)) trous++;
    }
    if (trous) out.push({ z: m.z, trous });
  }
  return out;
});
console.log(fuites.length
  ? fuites.map((f) => `FUITE mur z=${f.z} : ${f.trous} rayons`).join('\n')
  : `les ${geo.murs.length} murs ferment toute la largeur`);

console.log(`erreurs : ${erreurs.length}`);
for (const e of erreurs.slice(0, 4)) console.log('  ' + e);
await browser.close();
process.exit(erreurs.length || !passe || !bloque || fuites.length || nbBrisees !== '1' ? 1 : 0);
