/**
 * Deux verifications qui ne se font qu'a l'image :
 *  1. le bandeau de fin de manche s'affiche, et se rejoue a la manche suivante ;
 *  2. rien ne distingue visuellement une porte franchissable d'une porte condamnee.
 *
 * Le second point se MESURE : on compare les pixels du mur au-dessus des portes
 * franchissables et au-dessus des condamnees. Un ecart de couleur significatif
 * signifierait qu'un indice subsiste quelque part dans le rendu.
 */
import { chromium } from 'playwright';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.setDefaultTimeout(120000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 150)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 150)); });

await page.addInitScript(() => {
  localStorage.setItem('tumble-model', 'char-tycoon');
  localStorage.setItem('tumble-minijeu', 'doors');
  localStorage.setItem('tumble-manche', '6');
});
await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 240000 });
await page.waitForTimeout(700);
// On force l'epreuve : une partie tire ses manches au sort, et ce test porte sur
// l'apparence des PORTES — il ne peut pas dependre du tirage.
await page.evaluate(() => {
  const g = window.__probeGame();
  const jeu = window.__MINIGAMES.find((m) => m.id === 'doors');
  g.partie = { parcours: [jeu, jeu], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 120000 });

// ── 1. Le mur ne doit rien reveler ──
// Camera figee face au premier mur, a bonne distance de lecture.
const infos = await page.evaluate(() => {
  const g = window.__probeGame();
  g.freezeCamera = true;
  const cam = g.view.camera;
  cam.position.set(0, 9.4, 4);
  cam.lookAt(0, 8.2, -12);
  cam.fov = 55;
  cam.updateProjectionMatrix();
  const m = g.arena.__murs().find((m) => Math.abs(m.z + 12) < 1);
  return { ouvertes: m.xOuvertes, condamnees: m.xCondamnees, y: m.y, z: m.z };
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/portes-indistinguables.png' });

/*
 * L'INVARIANT : l'apparence d'une porte depend de sa position, jamais de son etat.
 *
 * Une mesure de pixels a d'abord ete tentee, et elle mentait : lire le canevas WebGL
 * hors du cycle de rendu renvoie du noir, si bien que le test comparait du noir a du
 * noir et concluait a l'identite. On verifie donc l'invariant directement — on rejoue
 * DEUX donnes differentes et on compare les apparences emplacement par emplacement.
 * Si elles coincident alors que les etats different, aucune information ne peut fuir
 * par le rendu.
 */
const donneA = await page.evaluate(() => window.__probeGame().arena.__apparences());
// Seconde donne : on relance l'epreuve directement. Passer par le lobby remettrait la
// partie a zero, et la manche suivante serait tiree au sort — on comparerait alors deux
// maps differentes au lieu de deux dispositions de la meme.
await page.evaluate(() => {
  const g = window.__probeGame();
  const jeu = window.__MINIGAMES.find((m) => m.id === 'doors');
  g.partie = { parcours: [jeu, jeu], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 60000 });
await page.waitForTimeout(400);
const donneB = await page.evaluate(() => window.__probeGame().arena.__apparences());

console.log('--- l apparence trahit-elle la donne ? ---');
console.log(`donne A : ${donneA.length} panneaux, dont ${donneA.filter((p) => p.ouverte).length} franchissables`);
console.log(`donne B : ${donneB.length} panneaux, dont ${donneB.filter((p) => p.ouverte).length} franchissables`);

const cle = (p) => `${p.x}|${p.z}`;
const carteB = new Map(donneB.map((p) => [cle(p), p]));
let compares = 0, divergents = 0, etatsDifferents = 0;
for (const a of donneA) {
  const b = carteB.get(cle(a));
  if (!b) continue;
  compares++;
  if (a.ouverte !== b.ouverte) etatsDifferents++;
  for (const champ of ['couleur', 'embleme', 'bombement', 'phase']) {
    if (a[champ] !== b[champ]) {
      divergents++;
      if (divergents <= 3) console.log(`  DIVERGENCE ${champ} en x=${a.x} z=${a.z} : "${a[champ]}" vs "${b[champ]}"`);
      break;
    }
  }
}
console.log(`${compares} emplacements compares · ${etatsDifferents} ont change d'etat entre les deux donnes`);
const invariantOk = divergents === 0 && etatsDifferents > 0;
console.log(divergents === 0
  ? "aucune difference d'apparence -> l'etat ne se lit PAS sur le rendu"
  : `${divergents} emplacements changent d'apparence avec la donne -> un indice fuit`);
if (etatsDifferents === 0) console.log('! les deux donnes sont identiques : le test ne prouve rien, changer de graines');

// ── 2. Le bandeau de fin ──
await page.evaluate(() => { window.__probeGame().freezeCamera = false; });
const cas = [
  { nom: 'qualifie-record', chutes: 0, temps: 23.71, type: 'ok' },
  { nom: 'qualifie-chutes', chutes: 3, temps: 41.08, type: 'ok' },
  { nom: 'elimine', chutes: 5, temps: 0, type: 'ko' },
];
for (const [i, c] of cas.entries()) {
  await page.evaluate((c) => {
    const g = window.__probeGame();
    g.falls = c.chutes;
    g.runTime = c.temps;
    if (c.type === 'ko') {
      // Variante d'elimination : elle n'est pas encore declenchee par le jeu (il faudra
      // une limite de temps ou des adversaires), mais son style doit etre valide des
      // maintenant — c'est le meme bandeau, il ne doit pas casser au changement de ton.
      g.mode = 'finished';
      g.finishTimer = 0;
      g.verdict('ÉLIMINÉ', `${c.chutes} chutes · hors délai`, 'ko');
    } else {
      g.finishRace();
    }
  }, c);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `shots/verdict-${c.nom}.png` });
  const essai = i + 1;
  const visible = await page.evaluate(() => {
    const b = document.getElementById('verdict');
    const bande = b.querySelector('.bande.avant');
    return {
      classes: b.className,
      texte: document.getElementById('verdict-texte').textContent,
      sous: document.getElementById('verdict-sous').textContent,
      // Position reelle apres animation : c'est le seul moyen de savoir si la bande est
      // bien ENTREE dans le cadre, plutot que restee hors champ.
      x: Math.round(bande.getBoundingClientRect().left),
      // Le texte doit etre ARRIVE a pleine echelle : c'est lui le message, et une
      // capture prise en pleine animation le montrerait riquiqui.
      tx: (() => {
        const t = b.querySelector('.txt'), s = getComputedStyle(t);
        return `opacite ${(+s.opacity).toFixed(2)}, largeur ${Math.round(t.getBoundingClientRect().width)} px`;
      })(),
    };
  });
  console.log(`\nbandeau "${visible.texte}" — ${visible.sous}`);
  console.log(`  classes "${visible.classes}", bande a x=${visible.x} px, texte ${visible.tx}`);
  if (essai < cas.length) {
    // On rejoue depuis un etat propre : les animations CSS ne repartent pas si les
    // classes sont deja posees, et c'est exactement ce que ce test doit verifier.
    await page.evaluate(() => { const g = window.__probeGame(); g.mode = 'racing'; g.cacherVerdict(); });
    await page.waitForTimeout(500);
  }
}

console.log(`\nerreurs : ${erreurs.length}`);
for (const e of erreurs.slice(0, 5)) console.log('  ' + e);
await browser.close();
process.exit(erreurs.length || !invariantOk ? 1 : 0);
