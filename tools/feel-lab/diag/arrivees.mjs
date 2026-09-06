/**
 * LES LIGNES D'ARRIVÉE — quatre courses, UNE porte, les pieds au sol.
 *
 * Décision du directeur produit du 6 septembre 2026 : « plus de truc qui vole on ne sait
 * comment, propre, comme Fall Guys ». La porte est dans `src/arrivee.js` ; ce harnais
 * vérifie sur chaque carte de course ce qui rendait les anciennes arrivées fausses :
 *
 *   1. UNE porte d'arrivée, pas zéro ni deux ;
 *   2. posée SUR la ligne du jeu (`finishZ`, celle que `main.js` compare), au centimètre —
 *      sur Les Dalles l'ancienne arche était deux mètres derrière ;
 *   3. le damier centré sur cette même ligne ;
 *   4. les DEUX pieds au sol : un rayon Rapier sous chaque pied doit toucher une surface
 *      à moins de douze centimètres — c'est le verdict « rien ne vole ». Sur La Course
 *      la piste est à dix-neuf mètres au-dessus du relief, sur Les Dalles le palier finit
 *      dans le vide : un pilier posé à côté de la piste rate ce test ;
 *   5. de l'air sous l'enseigne (au moins trois mètres : un saut culmine à 2,15) ;
 *   6. AUCUNE guirlande libre à moins de douze mètres de la ligne — c'est elle, tendue
 *      en l'air entre rien et rien, qui « volait » sur trois cartes sur quatre ;
 *   7. l'enseigne est la texture PEINTE (`finish-sign.jpg`), pas le repli au canevas.
 *
 * Les rayons ne touchent rien tant que le monde n'a pas fait un pas : on en fait deux.
 * Et le champ s'appelle `timeOfImpact`, pas `toi` (voir `cine/README.md`).
 *
 *   cd tools/feel-lab && npx vite build
 *   npx vite preview --port 5275 --host 127.0.0.1 &
 *   node diag/arrivees.mjs
 */
import { chromium } from 'playwright';

const PORT = process.env.FEELLAB_PORT ?? 5275;
const BASE = process.env.FEELLAB_BASE ?? `http://127.0.0.1:${PORT}`;

let ok = 0, ko = 0;
const verdict = (cond, msg) => { if (cond) ok++; else ko++; console.log(`${cond ? 'OK' : 'KO'}  ${msg}`); };

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 160)); });

await page.goto(`${BASE}/?nointro&lowfx&graine=4242`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, null, { polling: 200, timeout: 300000 });

const ids = await page.evaluate(() => window.__MINIGAMES.map((m) => m.id));

for (const id of ids) {
  const r = await page.evaluate((id) => {
    const g = window.__probeGame();
    const jeu = window.__MINIGAMES.find((m) => m.id === id);
    g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
    g.startRace();
    g.countdown = 0;
    const a = g.arena;
    if (a.survie) return { nom: jeu.name, survie: true };
    a.world.step(); a.world.step();
    const T = window.__THREE, R = window.__RAPIER;

    const portes = [];
    a.group.traverse((o) => { if (o.name === 'porte-arrivee') portes.push(o); });
    const out = { nom: jeu.name, survie: false, finishZ: a.finishZ, portes: portes.length };
    if (portes.length !== 1) return out;
    const p = portes[0];
    p.updateWorldMatrix(true, true);
    const origine = new T.Vector3().setFromMatrixPosition(p.matrixWorld);
    out.origineZ = origine.z;

    const { entraxe, yEnseigne, hauteurEnseigne } = p.userData.arrivee;
    out.airSousEnseigne = yEnseigne - hauteurEnseigne / 2;
    out.pieds = [-1, 1].map((sx) => {
      const v = new T.Vector3(sx * entraxe / 2, 0, 0).applyMatrix4(p.matrixWorld);
      const h = a.world.castRay(new R.Ray({ x: v.x, y: v.y + 0.6, z: v.z }, { x: 0, y: -1, z: 0 }), 40, true);
      return { x: v.x, y: v.y, z: v.z, sol: h ? v.y + 0.6 - h.timeOfImpact : null };
    });

    let damier = null;
    p.traverse((o) => { if (o.name === 'damier-arrivee') damier = o; });
    out.damierZ = damier ? new T.Vector3().setFromMatrixPosition(damier.matrixWorld).z : null;

    out.guirlandes = 0;
    a.group.traverse((o) => {
      if (!o.isInstancedMesh || o.geometry?.type !== 'ConeGeometry') return;
      const w = new T.Vector3();
      o.getWorldPosition(w);
      if (Math.abs(w.z - a.finishZ) < 12) out.guirlandes++;
    });

    out.peinte = false;
    p.traverse((o) => {
      const img = o.material?.map?.image;
      const src = img?.currentSrc ?? img?.src ?? '';
      if (/finish-sign/.test(src)) out.peinte = true;
    });
    return out;
  }, id);

  if (r.survie) { console.log(`\n${id} — ${r.nom} : survie, pas de ligne d'arrivée`); continue; }
  console.log(`\n${id} — ${r.nom} · finishZ ${r.finishZ.toFixed(2)}`);
  verdict(r.portes === 1, `une porte d'arrivée (${r.portes})`);
  if (r.portes !== 1) continue;
  verdict(Math.abs(r.origineZ - r.finishZ) < 0.01, `posée sur la ligne du jeu (z = ${r.origineZ.toFixed(2)})`);
  verdict(r.damierZ !== null && Math.abs(r.damierZ - r.finishZ) < 0.01, `damier centré sur la ligne (z = ${r.damierZ?.toFixed(2)})`);
  for (const [i, pied] of r.pieds.entries()) {
    const ecart = pied.sol === null ? null : Math.abs(pied.sol - pied.y);
    verdict(ecart !== null && ecart < 0.12,
      `pied ${i + 1} au sol : x ${pied.x.toFixed(1)}, ${ecart === null ? 'RIEN dessous' : `sol à ${(ecart * 100).toFixed(0)} cm`}`);
  }
  verdict(r.airSousEnseigne >= 3, `${r.airSousEnseigne.toFixed(2)} m d'air sous l'enseigne`);
  verdict(r.guirlandes === 0, `aucune guirlande libre près de la ligne (${r.guirlandes})`);
  verdict(r.peinte, `enseigne peinte (finish-sign)`);
}

verdict(erreurs.length === 0, `aucune erreur de page${erreurs.length ? ` : ${erreurs[0]}` : ''}`);
console.log(`\n${ok} OK, ${ko} KO`);
await browser.close();
process.exit(ko ? 1 : 0);
