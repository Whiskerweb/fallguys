/**
 * Vues de L'Hexagone — pour REGARDER, pas pour mesurer.
 *
 * `diag/hexagone.mjs` prouve que la tour est juste ; il ne dit rien de ce qu'elle donne à
 * voir, et sur cette carte la lisibilité EST une règle du jeu — un joueur qui ne distingue
 * pas un hexagone condamné d'un hexagone intact joue à pile ou face.
 *
 * Six vues fixes : la tour entière, le départ, un étage de près avec ses hexagones à
 * différents stades, des trous déjà ouverts vus de profil, la boue vue d'en haut, et
 * l'orientation des hexagones vérifiée à la verticale — c'est la seule façon de contrôler
 * qu'ils sont bien FLAT-TOP, arête plate en haut, pointes à gauche et à droite.
 *
 * Le décor est CHARGÉ ici, contrairement au harnais de mesure : c'est justement lui qu'on
 * vient juger.
 *
 * Lancer depuis tools/feel-lab, serveur actif :
 *   node diag/hexavues.mjs        ·  FEELLAB_PORT=5274 node diag/hexavues.mjs
 */
import { chromium } from 'playwright';

const BASE = `http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}`;
let browser;
process.on('exit', () => { try { browser?.close(); } catch {} });

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(600000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 160)));

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
await page.waitForTimeout(1200);

const cotes = await page.evaluate(() => window.__probeGame().arena.__cotes());
const etages = await page.evaluate(() => window.__probeGame().arena.__etages());

/*
 * On CREUSE avant de photographier. Une tour intacte ne montre pas ce que le mini-jeu donne
 * réellement à voir : ce sont les trous, et les hexagones à moitié blanchis, qui font
 * l'image — et ce sont eux que le joueur doit savoir lire.
 */
await page.evaluate(async () => {
  const g = window.__probeGame(), a = g.arena, c = g.character;
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const e of [0, 1]) {
    const et = a.__etages()[e];
    const hexas = a.__hexas(e);
    for (let i = 0; i < hexas.length; i += 3) {
      const h = hexas[i];
      c.body.setTranslation({ x: h.x, y: et.y + 0.85, z: h.z }, true);
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      await attendre(24);
    }
  }
  // On laisse quelques hexagones EN COURS de sursis au moment de la photo : c'est l'état
  // le plus informatif, et celui qu'aucune capture d'une tour au repos ne montrerait.
  const et = a.__etages()[2];
  for (const h of a.__hexas(2).slice(0, 9)) {
    c.body.setTranslation({ x: h.x, y: et.y + 0.85, z: h.z }, true);
    await attendre(20);
  }
  c.body.setTranslation({ x: 0, y: a.__etages()[2].y + 0.9, z: 0 }, true);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
});
await page.waitForTimeout(350);

await page.evaluate(() => {
  window.__probeGame().freezeCamera = true;
  document.querySelectorAll('body > div').forEach((e) => { e.style.visibility = 'hidden'; });
});

const bas = etages[etages.length - 1];
const R = bas.rayon;

// Les cadrages se calculent sur les cotes LUES DANS LA SCENE, jamais sur des nombres
// ecrits ici : la tour a triple de hauteur en une seule modification, et des positions
// figees auraient cadre le vide sans que rien ne le signale.
const MILIEU = (cotes.HAUT + cotes.BOUE_Y) / 2;
const vues = [
  // nom                 position caméra                       point visé
  ['tour', [R * 2.9, cotes.HAUT + 6, R * 2.9], [0, MILIEU, 0]],
  ['depart', [7, cotes.SOCLE_Y + 4, 15], [0, cotes.HAUT - 2, 0]],
  ['etage-pres', [5, etages[2].y + 5.5, 16], [0, etages[2].y - 2, 0]],
  ['trous-de-profil', [R * 1.4, etages[1].y - 3.5, R * 1.4], [0, etages[2].y + 1, 0]],
  ['boue', [R * 1.2, cotes.BOUE_Y + 14, R * 1.2], [0, cotes.BOUE_Y, 0]],
  // A la VERTICALE : c'est la seule vue qui prouve l'orientation des hexagones.
  ['flat-top', [0, etages[2].y + 19, 0], [0, etages[2].y, 0]],
];

for (const [nom, pos, cible] of vues) {
  await page.evaluate(([p, c, nom]) => {
    const cam = window.__probeGame().view.camera;
    /*
     * La vue a la VERTICALE impose son vecteur « haut ».
     *
     * Regarder droit vers le bas avec le haut par defaut (0,1,0) rend `lookAt` degenere —
     * l'axe de roulis devient indetermine et la projection part en vrille : la premiere
     * capture montrait l'image dedoublee de part et d'autre d'une couture verticale. On
     * impose donc -Z vers le haut de l'ecran, ce qui rend la vue LISIBLE et, surtout,
     * interpretable : un hexagone flat-top doit alors montrer une arete plate en haut.
     */
    cam.up.set(0, 1, 0);
    if (nom === 'flat-top') cam.up.set(0, 0, -1);
    cam.position.set(p[0], p[1], p[2]);
    cam.lookAt(c[0], c[1], c[2]);
  }, [pos, cible, nom]);
  await page.waitForTimeout(320);
  await page.screenshot({ path: `diag/vues/hexa-${nom}.png` });
  console.log(`diag/vues/hexa-${nom}.png`);
}
console.log(erreurs.length ? `erreurs : ${[...new Set(erreurs)].join(' | ')}` : 'erreurs : aucune');
await browser.close();
