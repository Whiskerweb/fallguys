/**
 * Le panneau de COMPTE — connexion par e-mail et mot de passe.
 *
 * Ce harnais s'adapte a ce qu'il trouve, et c'est le point important : le jeu doit tourner
 * dans les DEUX modes, et chacun a sa propriete a prouver.
 *
 *   - Supabase NON configure (pas de `.env.local`, cas du clone frais et des autres
 *     harnais) : le bouton SIGN IN doit etre CACHE. Un bouton de connexion sans backend
 *     derriere promettrait quelque chose qui ne peut pas arriver.
 *   - Supabase configure : le panneau s'ouvre, et une tentative de connexion refusee par le
 *     VRAI serveur d'authentification doit remonter un message lisible. C'est le seul
 *     verdict qui prouve que le client parle bien a Supabase — le reste ne teste que du DOM.
 *
 * Dans les deux cas, le portefeuille local de 25,00 USDC reste affiche : personne n'est
 * connecte, donc rien ne vient du grand livre.
 *
 * Lancer depuis tools/feel-lab, serveur actif :
 *   node diag/compte.mjs        ·  FEELLAB_PORT=5291 node diag/compte.mjs
 */
import { chromium } from 'playwright';

const BASE = `http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}`;
let browser;
process.on('exit', () => { try { browser?.close(); } catch {} });

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });
page.setDefaultTimeout(180000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 140)));

let ko = 0;
const dit = (ok, t) => { if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${t}`); };

// `noassets` : ce harnais juge une interface, pas un decor. Charger les modeles Meshy
// tripleraient son temps sans rien apporter au verdict.
await page.goto(`${BASE}/?lowfx&nointro&noassets`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 300000 });
await page.waitForTimeout(1200);

const btn = page.locator('#btn-compte');
const configure = await btn.isVisible();
console.log(`Supabase ${configure ? 'CONFIGURE' : 'absent'} dans ce bundle\n`);

if (!configure) {
  /*
   * Mode hors ligne. Le seul verdict qui compte ici est que le bouton reste cache — mais
   * il faut verifier qu'il est cache POUR LA BONNE RAISON. Un `#btn-compte` absent du HTML
   * passerait le meme test tout en signalant un panneau jamais construit.
   */
  const existe = await page.locator('#btn-compte').count();
  dit(existe === 1, 'le bouton existe dans le DOM mais reste cache (et non : il manque)');
  dit(await page.locator('#compte-fond').count() === 1, 'le panneau existe, simplement jamais ouvert');
} else {
  dit((await btn.textContent())?.trim() === 'SIGN IN',
    'le bouton annonce SIGN IN, donc personne n\'est connecte');

  await btn.click();
  await page.waitForTimeout(400);
  dit(await page.locator('#compte-fond').isVisible(), 'le panneau s\'ouvre');
  dit(await page.locator('#compte-mail').isVisible() && await page.locator('#compte-mdp').isVisible(),
    'les champs e-mail et mot de passe sont presents');
  await page.screenshot({ path: 'shots/compte-panneau.png' });

  /*
   * LE VERDICT CENTRAL : un refus venu du vrai serveur d'authentification.
   *
   * On se connecte volontairement avec un compte qui n'existe pas. Supabase repond
   * « Invalid login credentials » — deliberement ambigu de leur part, puisque distinguer
   * « mauvais mot de passe » de « compte inconnu » revelerait quelles adresses sont
   * inscrites. Ce qu'on verifie, c'est que ce refus TRAVERSE toute la chaine et ressort en
   * une phrase que le joueur peut lire.
   */
  await page.fill('#compte-mail', 'personne-inexistante@tumble-test.dev');
  await page.fill('#compte-mdp', 'MauvaisMotDePasse123');
  await page.click('#compte-entrer');
  await page.waitForFunction(() => {
    const m = document.getElementById('compte-msg')?.textContent ?? '';
    return m && m !== 'Signing in…';
  }, { timeout: 60000 });
  const msg = (await page.locator('#compte-msg').textContent())?.trim();
  console.log(`     message rendu : « ${msg} »`);
  dit(/password|confirm|rate|invalid|email/i.test(msg),
    'un refus du vrai Supabase ressort en une phrase lisible');
  dit(!/\[object|undefined|AuthApiError/.test(msg),
    'le message est traduit, pas un objet d\'erreur brut recopie a l\'ecran');
  await page.screenshot({ path: 'shots/compte-refus.png' });

  // Les boutons doivent etre reactives : un panneau qui reste grise apres un echec
  // enferme le joueur, et c'est le genre de blocage qu'on ne voit qu'en le cherchant.
  dit(!(await page.locator('#compte-entrer').isDisabled()),
    'apres un echec, les boutons redeviennent cliquables');

  await page.click('#compte-fermer');
  await page.waitForTimeout(300);
  dit(!(await page.locator('#compte-fond').isVisible()), 'le panneau se referme');
}

// Dans les deux modes : personne n'est connecte, donc le solde vient du prototype local.
const solde = await page.evaluate(() => document.getElementById('balance').textContent);
dit(solde === '25.00', `le portefeuille local est intact : ${solde} USDC`);

// Et le jeu doit rester jouable — c'est la propriete qu'on protege depuis le debut.
const jouable = await page.evaluate(() => {
  const g = window.__probeGame?.();
  return Boolean(g && g.mode === 'lobby');
});
dit(jouable, 'le jeu est en lobby et jouable, avec ou sans compte');

console.log(erreurs.length ? `\nerreurs : ${[...new Set(erreurs)].join(' | ')}` : '\nerreurs : aucune');
await browser.close();
process.exit(ko || erreurs.length ? 1 : 0);
