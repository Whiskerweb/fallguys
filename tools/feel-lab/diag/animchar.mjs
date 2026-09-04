/**
 * Personnage anime par CLIPS : le maillage suit-il vraiment ses animations en jeu ?
 *
 * Trois choses qu'aucune inspection du code ne donne :
 *  1. les clips sont bien charges (ils vivent A COTE de la scene dans un glTF, et se
 *     perdent silencieusement si on ne conserve que `gltf.scene`) ;
 *  2. le melange marche/course suit la vitesse, au lieu de rester bloque sur un clip ;
 *  3. le personnage ne PEDALE PAS en l'air — le defaut le plus visible qui soit.
 */
import { chromium } from 'playwright';
import { dossierDeBanc } from '../src/boutique.js';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

const modele = process.argv[2] ?? 'char-babytrump';
browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.setDefaultTimeout(240000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)); });

// BabyTrump est en BOUTIQUE depuis le 2 septembre 2026 : sans ce dossier de possession,
// le catalogue refuse de l'equiper et la machine repart avec le personnage suivant, sans
// un mot. La forme du dossier vient de `src/boutique.js`, jamais recopiee ici.
await page.addInitScript(({ cle, valeur }) => localStorage.setItem(cle, valeur), dossierDeBanc());
await page.addInitScript((m) => localStorage.setItem('tumble-model', m), modele);
await page.goto('http://127.0.0.1:5273/?lowfx&nointro', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 300000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `shots/anim-${modele}-lobby.png` });

await page.evaluate(() => {
  const g = window.__probeGame();
  const jeu = window.__MINIGAMES.find((m) => m.id === 'course');
  g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
/*
 * Le chrono s'affiche en mm:ss:cs. `parseFloat` sur « 00:00:00 » rend donc 0 quoi qu'il
 * arrive : l'attente d'origine ne se debloquait qu'a la minute pleine — « 01:02:03 » rend
 * 1 — c'est-a-dire par accident. On lit les trois champs.
 */
await page.waitForFunction(() => {
  const [m, s, cs] = (document.getElementById('timer')?.textContent ?? '').split(':').map(Number);
  return Number.isFinite(cs) && m * 60 + s + cs / 100 > 0.3;
}, { timeout: 120000 });

const type = await page.evaluate(() => {
  const c = window.__probeCharacter();
  return { rig: c.rig?.constructor?.name ?? 'aucun', clips: c.rig?.__poids ? Object.keys(c.rig.__poids()) : [] };
});
console.log(`animation : ${type.rig} · clips ${type.clips.join(', ') || '(aucun)'}`);
if (type.rig !== 'ClipRig') { console.log('ANOMALIE : le personnage devrait etre joue par ses clips'); }

/** Attend que le personnage soit POSE et stable : mesurer en vol ou en culbute ne dit
 *  rien du melange marche/course. */
async function auSol() {
  await page.waitForFunction(() => {
    const c = window.__probeCharacter();
    return c.state === 'grounded';
  }, { timeout: 30000 }).catch(() => {});
}

/** Poids des clips a une vitesse donnee, apres stabilisation. */
async function mesurer(nom, prep) {
  await prep();
  await auSol();
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const c = window.__probeCharacter();
    const v = c.body.linvel();
    return { poids: c.rig.__poids(), vitesse: +Math.hypot(v.x, v.z).toFixed(2), etat: c.state };
  });
  const dominant = Object.entries(r.poids).sort((a, b) => b[1] - a[1])[0];
  console.log(`  ${nom.padEnd(14)} v=${String(r.vitesse).padStart(5)} m/s · ${r.etat.padEnd(9)} · `
    + Object.entries(r.poids).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ')
    + `  -> ${dominant[0]}`);
  return { ...r, dominant: dominant[0] };
}

console.log('\n--- melange des clips selon la vitesse ---');
const arret = await mesurer('a l arret', async () => {
  await page.evaluate(() => {
    const c = window.__probeCharacter();
    // Zone de depart de Block Dash : la premiere vague balaie de z=-32 a z=+2, donc
    // au-dela de z=+6 le personnage n'est jamais percute et les mesures portent bien
    // sur l'animation, pas sur une culbute.
    c.body.setTranslation({ x: 0, y: 2.2, z: 12 }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  });
  await page.waitForTimeout(900);   // le temps de retomber et de se stabiliser
});
await page.keyboard.down('ArrowUp');
const course = await mesurer('en course', async () => page.waitForTimeout(1600));
await page.keyboard.up('ArrowUp');

/*
 * En l'air : le personnage doit TENIR UNE POSE, pas continuer son cycle.
 *
 * On appelle directement `rig.update` avec l'etat voulu, au lieu de faire sauter le
 * personnage. Deux tentatives par la physique ont echoue a atteindre `airborne` de
 * facon fiable — teleporte, le controleur le repose aussitot au sol ; lance en saut, il
 * se relevait encore d'une culbute. Ce qu'on veut verifier est de toute facon une regle
 * du rig, pas un comportement du moteur physique.
 */
const enLAir = await page.evaluate(async () => {
  const c = window.__probeCharacter();
  const rig = c.rig;
  const lire = () => rig.bones.get('LeftUpLeg')?.quaternion.toArray() ?? [];
  const mesurer = (etat, vy) => {
    for (let i = 0; i < 6; i++) rig.update(0.016, 7, 7.4, etat, vy);   // stabilisation
    const a = lire();
    for (let i = 0; i < 25; i++) rig.update(0.016, 7, 7.4, etat, vy);  // ~0,4 s
    const b = lire();
    let e = 0;
    for (let i = 0; i < a.length; i++) e += Math.abs(a[i] - b[i]);
    return +e.toFixed(4);
  };
  const montee = mesurer('airborne', 6);
  const chute = mesurer('airborne', -6);
  // Temoin : au sol, la cuisse DOIT bouger. Sans ce controle, un rig completement fige
  // passerait le test en l'air avec les honneurs.
  const auSolBouge = mesurer('grounded', 0);
  return { montee, chute, auSolBouge, poids: rig.__poids() };
});
console.log(`\n--- pose en l'air (appel direct du rig) ---`);
console.log(`  en montee : ${enLAir.montee} · en chute : ${enLAir.chute} `
  + `-> ${enLAir.montee < 0.02 && enLAir.chute < 0.02 ? 'POSE TENUE' : 'IL PEDALE'}`);
console.log(`  temoin au sol : ${enLAir.auSolBouge} -> ${enLAir.auSolBouge > 0.1 ? 'la course anime bien' : 'RIG FIGE'}`);
const enVol = true;
const poseOk = enLAir.montee < 0.02 && enLAir.chute < 0.02 && enLAir.auSolBouge > 0.1;

await page.waitForTimeout(500);
await page.screenshot({ path: `shots/anim-${modele}-jeu.png` });
console.log(`\nerreurs : ${erreurs.length}`);
for (const e of erreurs.slice(0, 5)) console.log('  ' + e);
await browser.close();
const ok = type.rig === 'ClipRig' && course.dominant !== 'idle' && poseOk;
process.exit(erreurs.length || !ok ? 1 : 0);
