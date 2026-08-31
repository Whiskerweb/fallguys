/**
 * Diagnostic du mini-jeu « Les Portes ».
 *
 * Trois choses qu'on ne peut pas deduire du code et qu'il faut MESURER :
 *  1. la scene se construit et tourne sans une seule erreur console ;
 *  2. les portes franchissables se brisent au passage et les condamnees resistent ;
 *  3. l'indice visuel se distingue A DISTANCE — le seul critere qui decide si ce
 *     mini-jeu est un jeu d'adresse ou un tirage au sort.
 */
import { chromium } from 'playwright';

// Fermeture garantie : un script tue par timeout laisse sinon un Chromium orphelin,
// qui consomme le CPU et fait echouer les tests suivants sur des scenes pourtant saines.
let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });
process.on('SIGTERM', () => { fermer(); process.exit(143); });
browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.setDefaultTimeout(90000);

const erreurs = [];
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
page.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));

await page.addInitScript(() => {
  localStorage.setItem('tumble-model', 'char-tycoon');
  localStorage.setItem('tumble-manche', '6');   // manche 7 : donne fixe, resultat reproductible
});
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 180000 });
await page.waitForTimeout(700);
await page.screenshot({ path: 'shots/portes-0-lobby.png' });

await page.evaluate(() => {
  const g = window.__probeGame();
  const jeu = window.__MINIGAMES.find((m) => m.id === 'doors');
  g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 120000 });

const titre = await page.textContent('#race-title');
console.log('epreuve chargee :', titre);

// ── 1. Vues a hauteur de course, devant chaque mur ──
const etapes = [
  ['a-depart', 0, 9.4, 12], ['b-mur1-loin', 0, 7.8, 4], ['c-mur1-pres', 0, 7.8, -6],
  ['d-mur2-loin', 0, 6.2, -26], ['e-mur2-pres', 0, 6.2, -34],
  ['f-mur3-double', 0, 4.6, -58], ['g-entre-murs', 0, 4.6, -70],
  ['h-mur4', 0, 3.0, -95], ['i-goulot-loin', 0, 1.4, -118], ['j-goulot-pres', 0, 1.4, -124],
  ['k-arrivee', 0, 1.4, -144],
];
for (const [nom, x, y, z] of etapes) {
  await page.evaluate(([x, y, z]) => {
    const c = window.__probeCharacter?.();
    c.body.setTranslation({ x, y, z }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    // Sans cela la camera lissee met plusieurs secondes a rejoindre le joueur, et la
    // capture montre le decor qu'elle survole en chemin plutot que l'etape visee.
    window.__probeGame().snapCamera = true;
  }, [x, y, z]);
  await page.waitForTimeout(420);
  await page.screenshot({ path: `shots/portes-${nom}.png` });
}

// ── 2. Une porte franchissable cede-t-elle, et une condamnee resiste-t-elle ? ──
// On COURT vers la porte au clavier, on ne lui impose pas une vitesse : le controleur
// de personnage ecrase toute vitesse qu'on lui dicte, et un joueur relache finit par
// s'arreter. Une poussee artificielle mesurerait l'inertie, pas le franchissement.
const Z_MUR = -12;

async function foncer(x, z) {
  await page.evaluate(([x, z]) => {
    const c = window.__probeCharacter();
    c.body.setTranslation({ x, y: 7.8, z }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }, [x, z]);
  await page.waitForTimeout(220);
  await page.keyboard.down('ArrowUp');
  // On attend un temps de JEU, pas une duree d'horloge : en rendu logiciel le jeu tourne
  // bien plus lentement que le temps reel, et une attente en secondes reelles coupait la
  // course avant le mur — le test concluait alors a un blocage inexistant.
  const depart = await page.evaluate(() => window.__probeGame().runTime);
  await page.waitForFunction((t) => window.__probeGame().runTime > t + 3.0, depart, { timeout: 120000 })
    .catch(() => {});
  const etat = await page.evaluate(() => {
    const c = window.__probeCharacter();
    return { z: c.body.translation().z, vz: c.body.linvel().z };
  });
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(200);
  return etat;
}

// On LIT la geometrie du mur dans la scene. La recalculer ici la dupliquerait, et une
// premiere version l'a fait : le jour ou la largeur du couloir est passee de 26 a 21 m,
// le harnais a vise une porte situee hors piste et signale une anomalie inexistante.
const geo = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  return { murs: a.__murs(), largeur: a.largeur, portes: a.__portes() };
});
const mur1 = geo.murs.find((m) => Math.abs(m.z - Z_MUR) < 1);
const xFausse = mur1.xCondamnees[0];

console.log(`\n--- traversee du premier mur (couloir de ${geo.largeur} m) ---`);
console.log(`portes franchissables sur la map : ${geo.portes.length}, `
  + `dont ${mur1.xOuvertes.length} sur ce mur et ${mur1.xCondamnees.length} condamnees`);

// Le critere n'est pas seulement « passe / ne passe pas ». Une porte correctement lue
// doit se franchir SANS RALENTIR : un freinage se lirait comme une erreur de lecture et
// punirait le joueur qui a bien joue. On mesure donc aussi la vitesse au passage.
const vraie = await foncer(mur1.xOuvertes[0], Z_MUR + 5);
const passe = vraie.z < Z_MUR - 1.0 && Math.abs(vraie.vz) > 5;
console.log(`porte franchissable x=${mur1.xOuvertes[0].toFixed(1)} : z final ${vraie.z.toFixed(2)}, `
  + `vitesse ${Math.abs(vraie.vz).toFixed(1)} m/s -> ${passe ? 'FRANCHIE SANS RALENTIR' : 'ANOMALIE'}`);

const fausse = await foncer(xFausse, Z_MUR + 5);
// Le seul critere qui compte : il n'a PAS franchi le plan du mur. Exiger en plus une
// vitesse nulle etait cale sur une fenetre courte — sur trois secondes, le joueur
// culbute puis repart, et cette vitesse retrouvee se lisait a tort comme un echec.
const bloque = fausse.z > Z_MUR + 0.4;
console.log(`porte condamnee    x=${xFausse.toFixed(1)} : z final ${fausse.z.toFixed(2)}, `
  + `mur a z=${Z_MUR} -> ${bloque ? 'A RESISTE' : 'TRAVERSEE — anomalie'}`);

const brisees = await page.evaluate(() => window.__probeGame().arena.__portes().filter((p) => p.brisee).length);
console.log(`portes brisees comptees : ${brisees}`);
const traverseeOk = passe && bloque;

// ── 3. Etancheite des murs ──
// Un mur DOIT fermer toute la largeur du couloir. Sans ce controle, un decalage de
// grille avait laisse un passage libre de 1,75 m le long du muret : on traversait sans
// rien lire, ce qui vide le mini-jeu de sa substance. On tire donc un rayon horizontal
// tous les vingt centimetres et on verifie qu'aucun ne passe.
// Remise en place AVANT la mesure, et separee d'elle. Les portes ouvertes par le test
// precedent sont de vrais trous ; il faut donc les refermer. Mais un collider tout juste
// cree n'entre dans la broad-phase qu'au pas de simulation suivant : mesurer dans le meme
// evaluate signalait une fuite alors que la porte etait deja refermee. Au passage, ceci
// verifie reset().
// Et on ECARTE le pilote avant de refermer : il termine le test precedent colle au mur,
// donc a portee de rupture. Une porte franchissable voisine se rouvrait dans la seconde
// qui suit reset(), et le rayon la comptait comme une fuite du mur — un faux positif qui
// ne depend que de l'endroit ou le pilote a fini de culbuter.
await page.evaluate(() => {
  const c = window.__probeCharacter();
  c.body.setTranslation({ x: 0, y: 8.6, z: 6 }, true);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
});
await page.waitForTimeout(300);
await page.evaluate(() => window.__probeGame().arena.reset());
await page.waitForTimeout(400);

const fuites = await page.evaluate(() => {
  const RAPIER = window.__RAPIER;
  const g = window.__probeGame();
  const a = g.arena, monde = a.world;
  const out = [];
  for (const m of a.__murs()) {
    const trous = [];
    for (let x = -a.largeur / 2 + 0.1; x <= a.largeur / 2 - 0.1; x += 0.2) {
      const ray = new RAPIER.Ray({ x, y: m.y + 1.2, z: m.z + 4 }, { x: 0, y: 0, z: -1 });
      const hit = monde.castRay(ray, 8, true);
      if (!hit) trous.push(+x.toFixed(2));
    }
    if (trous.length) out.push({ z: m.z, trous: trous.length, de: trous[0], a: trous[trous.length - 1] });
  }
  return out;
});
console.log('\n--- etancheite des murs ---');
if (!fuites.length) console.log('les 7 murs ferment toute la largeur du couloir');
else for (const f of fuites) {
  console.log(`FUITE au mur z=${f.z} : ${f.trous} rayons passent, de x=${f.de} a x=${f.a}`);
}

// ── 4. Lisibilite de l'indice a distance ──
// On cadre le premier mur de loin et on compare, sur la bande des panneaux, la
// luminance moyenne des colonnes franchissables et condamnees. Un ecart nul
// signifierait que le joueur n'a rien a lire, donc que le hasard tranche.
await page.evaluate(() => {
  const g = window.__probeGame();
  g.freezeCamera = true;
  const cam = g.view.camera;
  cam.position.set(0, 10.5, 6);
  cam.lookAt(0, 8.2, -12);
  cam.fov = 55;
  cam.updateProjectionMatrix();
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/portes-lisibilite.png' });
console.log('\ncapture de lisibilite : shots/portes-lisibilite.png (mur 1 vu de 18 m)');

// ── 5. L'eclatement d'une porte ──
// Une porte qui cede est le seul moment spectaculaire du mini-jeu : c'est aussi le seul
// qu'on ne peut pas juger sur une capture prise au hasard, puisqu'il dure moins d'une
// seconde. On declenche donc la rupture A LA MAIN et on avance l'animation par pas fixes,
// camera calee de trois quarts sur la porte.
const eclat = await page.evaluate(() => {
  const g = window.__probeGame(), a = g.arena;
  const p = a.__portes().find((q) => Math.abs(q.z + 12) < 1) ?? a.__portes()[0];
  const m = a.__murs().find((w) => Math.abs(w.z - p.z) < 1);
  const cam = g.view.camera;
  g.freezeCamera = true;
  cam.position.set(p.x + 4.6, m.y + 3.4, p.z + 7.5);
  cam.lookAt(p.x, m.y + 2.0, p.z);
  cam.fov = 55;
  cam.updateProjectionMatrix();
  // Le personnage est envoye au loin : sans cela il traverse le champ ou rouvre la porte.
  window.__probeCharacter().body.setTranslation({ x: 0, y: m.y + 1, z: p.z + 26 }, true);
  window.__foyer = { x: p.x, y: m.y + 2.1, z: p.z };
  window.__porteTest = p;
  return { x: p.x, y: m.y + 2.1, z: p.z };
});
await page.waitForTimeout(300);
// La rupture : on appelle update avec un foyer POSE SUR la porte, comme le ferait le jeu
// quand le joueur arrive dessus.
await page.evaluate(() => {
  const a = window.__probeGame().arena;
  a.update(0, 0.016, window.__foyer, window.__probeGame().view.camera);
});
const morceaux = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  return a.__eclats(window.__porteTest.x, window.__porteTest.z);
});
console.log(`\n--- eclatement d'une porte ---`);
console.log(`  morceaux produits : ${morceaux} ${morceaux >= 9 ? '' : '<- TROP PEU'}`);
for (const [nom, pas] of [['a-rupture', 0], ['b-gerbe', 6], ['c-retombee', 10]]) {
  await page.evaluate((n) => {
    const a = window.__probeGame().arena;
    // Pas FIXE : sous rendu logiciel, le jeu avance de quelques centiemes par image et
    // les trois captures montreraient rigoureusement le meme instant.
    for (let i = 0; i < n; i++) a.update(0, 0.025, null, window.__probeGame().view.camera);
  }, pas);
  await page.waitForTimeout(260);
  await page.screenshot({ path: `shots/portes-eclat-${nom}.png` });
}

console.log(`\nerreurs console : ${erreurs.length}`);
for (const e of erreurs.slice(0, 8)) console.log('  ' + e);
await browser.close();
process.exit(erreurs.length || !traverseeOk || fuites.length || morceaux < 9 ? 1 : 0);
