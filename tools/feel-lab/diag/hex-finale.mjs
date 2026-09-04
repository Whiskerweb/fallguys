/**
 * EN FINALE, LA MORT DE L'UN DOIT SACRER L'AUTRE — vu des deux écrans.
 *
 * Rapporté en jouant, capture à l'appui : l'un tombe et reçoit son écran de résultat,
 * pendant que l'autre continue de jouer avec soixante secondes au compteur. Le serveur,
 * interrogé seul, envoyait pourtant bien `fin-partie` aux deux au même tick. On reproduit
 * donc dans deux vrais navigateurs, et on regarde ce que CHACUN affiche.
 */
import { chromium } from 'playwright';
import { demarrerServeur } from '../../../serveur/src/serveur.js';

let ko = 0;
const dit = (ok, t) => { if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${t}`); };

const s = await demarrerServeur({ port: 0,
  politique: { nom:'DUEL_TEST', cible:2, minimum:2, attente:1, proposerApres:1, bots:'jamais', dureeManche:360 },
  graine: 1 });                       // graine serveur qui tire « hexagone » en duel
const BASE = `http://127.0.0.1:${s.port}`;
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });

const pages = [];
for (const nom of ['tombeur', 'survivant']) {
  const page = await browser.newPage({ viewport:{width:800,height:500} });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => console.log(`  ERREUR ${nom} : ${String(e).slice(0,140)}`));
  /*
   * LE MODE SE CHOISIT AVANT LE CHARGEMENT.
   *
   * Un salon est déterminé par le couple mode + mise, et la table des gains REFUSE deux
   * joueurs en `arena` — « un salon réduit demande au moins 3 joueurs ». Sans ce réglage,
   * les deux clients lèvent une erreur au calcul du barème et le relevé ne vaut rien.
   */
  await page.addInitScript(() => localStorage.setItem('tumble-mode', 'duel'));
  // Le nom se pose AVANT le chargement, comme le personnage : c'est `bonjour` qui le porte.
  await page.addInitScript((n) => localStorage.setItem('tumble-pseudo', n), nom);
  await page.goto(`${BASE}/?lowfx&nointro&noassets`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout:300000 });
  // Plus de panneau ONLINE : la page se connecte toute seule au serveur qui l'a servie, et
  // le nom est parti avec `bonjour` (posé avant le chargement). On attend la liaison, puis
  // PLAY entre en file — c'est exactement le geste du joueur.
  await page.waitForFunction(() => window.__probeGame()?.file?.etat === 'ouvert', { timeout: 20000 });
  await page.click('#play');
  pages.push({ nom, page });
}
const [A, B] = pages;

/*
 * ON CAPTE LE MESSAGE DE FIN, tel que chaque client le reçoit.
 *
 * Le serveur couronne bien quelqu'un — mesuré. Reste à savoir ce que le client en fait :
 * `brancher.js` cherche SON nom dans le classement, et s'il ne s'y retrouve pas il se
 * range dernier. Une différence de nom suffirait à priver le vainqueur de son titre.
 */
for (const { nom, page } of pages) {
  await page.exposeFunction('__noterFin', (t) => console.log(`  [${nom}] ${t}`));
  await page.evaluate((moi) => {
    const g = window.__probeGame();
    const attendre = setInterval(() => {
      const s = g.enligne ?? window.__probeGame().enligne;
      if (!s || s.__espionne) return;
      s.__espionne = true;
      s.sur('fin-partie', (msg) => {
        const c = msg.classement ?? [];
        const mien = c.find((x) => x.nom === moi);
        window.__noterFin(`je m'appelle « ${moi} » · classement ${JSON.stringify(c.map((x) => x.nom + ':' + x.rang))}`
          + ` · mon rang ${mien ? mien.rang : 'INTROUVABLE'}`);
      });
      clearInterval(attendre);
    }, 100);
  }, nom);
}
for (const { page } of pages) await page.waitForFunction(() => window.__probeGame()?.mode === 'racing', { timeout:120000 });
const carte = await A.page.evaluate(() => window.__probeGame().jeuId);
console.log('carte :', carte);
if (carte !== 'hexagone') { console.log('mauvaise carte'); await browser.close(); await s.arreter(); process.exit(1); }
for (const { page } of pages) await page.waitForFunction(() => window.__probeGame().countdown <= 0, { timeout:180000 });

/* On laisse la tour faire son travail : personne ne bouge, les tuiles cèdent. */
const etat = (j) => j.page.evaluate(() => {
  const g = window.__probeGame();
  const panneau = document.getElementById('fin-panneau');
  const lire = (id) => (document.getElementById(id)?.textContent ?? '').trim();
  return {
    y: +(g.character?.body.translation().y ?? 0).toFixed(1),
    enligne: !!g.enligne,
    classes: panneau ? panneau.className : '(absent)',
    titre: lire('fin-titre'),
    /*
     * `fin-sous` DÉPARTAGE LES DEUX CHEMINS.
     *
     * La voie en ligne y écrit « 1st of 2 » — l'effectif réel du classement du serveur. La
     * voie hors ligne y écrit « of 16 », la taille de table par défaut. Un seul coup d'œil
     * suffit donc à savoir lequel a produit l'écran, là où lire un titre ne dit rien.
     */
    sous: lire('fin-sous'),
    podium: lire('fin-podium'),
  };
});

let vu = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const [a, b] = await Promise.all([etat(A), etat(B)]);
  if (i < 20 || a.classes.includes('show') || b.classes.includes('show')) {
    console.log(`  t${String(i).padStart(2)}s  ${A.nom}: y=${String(a.y).padStart(7)} enligne=${a.enligne}`
      + ` [${a.classes}] « ${a.titre} » · ${a.sous} · ${a.podium}`);
    console.log(`        ${B.nom}: y=${String(b.y).padStart(7)} enligne=${b.enligne}`
      + ` [${b.classes}] « ${b.titre} » · ${b.sous} · ${b.podium}`);
  }
  if (a.classes.includes('show') && b.classes.includes('show')) { vu = { a, b, t: i }; break; }
}

console.log('');
dit(vu !== null, 'la partie se termine et les deux voient l\'écran de fin');
if (vu) {
  const gagnants = [vu.a, vu.b].filter((e) => e.titre.includes('WON')).length;
  dit(gagnants === 1, `exactement UN vainqueur déclaré (trouvé : ${gagnants})`);
  dit([vu.a, vu.b].every((e) => / of 2$/.test(e.sous)),
    `l'écran vient de la voie EN LIGNE — « ${vu.a.sous} » et « ${vu.b.sous} », pas « of 16 »`);
}

await browser.close();
await s.arreter();
console.log(`\n--- ${ko === 0 ? 'aucun écart' : ko + ' ECHEC(S)'} ---`);
process.exit(ko === 0 ? 0 : 1);
