/**
 * La BOUTIQUE dans un vrai navigateur : le parcours entier, cliqué.
 *
 * `diag/boutique.mjs` juge la règle sans navigateur. Celui-ci juge le GESTE, qu'aucune
 * fonction ne porte : la tuile cadenassée de la garde-robe mène-t-elle à la boutique, la
 * fenêtre qui s'ouvre part-elle bien vers X avec le post écrit, le bouton attend-il avant
 * d'accepter la réclamation, et le personnage est-il porté à l'arrivée.
 *
 * Il INTERCEPTE la fenêtre vers X et la referme : on vérifie son adresse, on ne charge
 * pas x.com — un banc qui dépend d'un site tiers ne mesure plus le jeu.
 *
 * Le port est figé et le serveur est `vite preview`, pas le serveur de dev : le
 * rechargement à chaud déclenché par une autre session fausse la mesure en cours.
 *
 * `vite preview` n'ecoute que sur `localhost` par defaut : on lui impose l'hote, sinon
 * l'adresse ci-dessous ne repond pas. `FEELLAB_BASE` reste la sortie de secours quand un
 * autre serveur sert deja la page.
 *
 *   cd tools/feel-lab && npx vite build
 *   npx vite preview --port 5274 --host 127.0.0.1 &
 *   node diag/boutique-ecran.mjs
 */
import { chromium } from 'playwright';

const PORT = process.env.FEELLAB_PORT ?? 5274;
const BASE = process.env.FEELLAB_BASE ?? `http://127.0.0.1:${PORT}`;

let echecs = 0;
const dit = (ok, texte) => {
  if (!ok) echecs++;
  console.log(`${ok ? 'OK  ' : 'ECHEC'} ${texte}`);
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 780 } });
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));

// Memoire VIERGE : c'est l'etat d'un joueur qui decouvre le jeu, et le seul ou la
// campagne existe encore.
await page.addInitScript(() => localStorage.clear());
await page.goto(`${BASE}/?lowfx&nointro`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 180000 });

const texte = (sel) => page.textContent(sel).then((t) => (t ?? '').trim());
const visible = (sel) => page.isVisible(sel);

console.log('\n\x1b[1mAu premier lancement\x1b[0m');
dit(await page.evaluate(() => localStorage.getItem('tumble-model')) === null
  || await page.evaluate(() => localStorage.getItem('tumble-model')) !== 'char-babytrump',
  'on ne demarre pas avec BabyTrump equipe');
dit(await visible('#btn-boutique'), 'le bouton SHOP est dans la colonne de gauche');
dit(await texte('#shop-neuf') === '1', `la pastille annonce 1 article a prendre : ${await texte('#shop-neuf')}`);

console.log('\n\x1b[1mLa garde-robe mene a la boutique\x1b[0m');
await page.click('#btn-perso');
await page.waitForTimeout(200);
const tuile = page.locator('#skins-grid .tile').first();
dit(await tuile.locator('.lock').textContent() === 'SHOP',
  'la premiere vignette porte SHOP, pas SOON : ce n\'est pas un asset manquant');
await tuile.click();
await page.waitForTimeout(250);
dit(await page.locator('#screen-boutique.on').count() === 1,
  'cliquer la vignette cadenassee ouvre la BOUTIQUE');
dit(await texte('#shop-nom') === 'BabyTrump', `l'article montre : ${await texte('#shop-nom')}`);
dit(await texte('#shop-prix') === 'FREE', 'et son prix : FREE');
dit((await texte('#shop-post')).includes('Baby Guys'),
  'le post est montre AVANT le clic, en toutes lettres');
dit(await texte('#shop-action') === 'UNLOCK WITH A POST', `le bouton dit : ${await texte('#shop-action')}`);

console.log('\n\x1b[1mLe depart vers X\x1b[0m');
const [ongletX] = await Promise.all([
  page.waitForEvent('popup', { timeout: 15000 }),
  page.click('#shop-action'),
]);
const urlX = ongletX.url();
// On referme AVANT que x.com ne charge : le banc ne depend d'aucun site tiers.
await ongletX.close();
dit(urlX.startsWith('https://x.com/intent/post?'), `un onglet part vers : ${urlX.slice(0, 34)}…`);
{
  const p = new URL(urlX).searchParams;
  dit(p.get('text').includes('Baby Guys') && p.get('text').includes('BabyTrump'),
    'le post est deja ecrit : le jeu et le skin y sont nommes');
  dit(p.get('url') === 'https://play.babyguy.dev', `et il porte le lien du jeu : ${p.get('url')}`);
}

console.log('\n\x1b[1mL\'attente, puis la reclamation\x1b[0m');
await page.waitForTimeout(300);
dit((await texte('#shop-action')).startsWith('I POSTED IT'),
  `le bouton a change de role : ${await texte('#shop-action')}`);
dit(await page.isDisabled('#shop-action'), 'et il refuse le clic tant que le decompte court');
dit(await visible('#shop-lien'), 'le lien de secours apparait : un pop-up bloque ne ferme pas la porte');
dit((await page.evaluate(() => localStorage.getItem('tumble-boutique')) ?? '').includes('envois'),
  'le depart est ecrit en memoire : fermer le jeu ne le perd pas');

await page.waitForSelector('#shop-action:not([disabled])', { timeout: 20000 });
dit(await texte('#shop-action') === 'I POSTED IT — UNLOCK',
  `le decompte fini, le bouton s'ouvre : ${await texte('#shop-action')}`);
await page.click('#shop-action');
await page.waitForTimeout(400);

console.log('\n\x1b[1mCe que le joueur obtient\x1b[0m');
dit(await texte('#shop-action') === 'EQUIPPED', `le bouton dit : ${await texte('#shop-action')}`);
dit(await page.isDisabled('#shop-action'), 'et il ne propose plus rien : c\'est fait');
dit(await page.evaluate(() => localStorage.getItem('tumble-model')) === 'char-babytrump',
  'BabyTrump est PORTE, sans un clic de plus');
dit(!(await visible('#shop-neuf')), 'la pastille du bouton SHOP s\'efface : il ne reste rien a prendre');
dit(await page.evaluate(() => JSON.parse(localStorage.getItem('tumble-boutique')).debloques[0]) === 'char-babytrump',
  'la possession est ecrite : elle survivra au rechargement');

await page.click('#btn-retour-boutique');
await page.click('#btn-perso');
await page.waitForTimeout(250);
dit(await page.locator('#skins-grid .tile').first().locator('.lock').count() === 0,
  'la vignette de la garde-robe a perdu son cadenas');
dit(await page.locator('#skins-grid .tile').first().locator('.porte').textContent() === 'EQUIPPED',
  'et porte le bandeau EQUIPPED');

await page.screenshot({ path: 'shots/boutique-obtenue.png' });
dit(erreurs.length === 0, erreurs.length ? `erreurs de page : ${erreurs.join(' | ')}` : 'aucune erreur de page');

await browser.close();
console.log(`\n--- ${echecs === 0 ? 'le parcours de deblocage tient de bout en bout' : `${echecs} ecart(s)`} ---`);
process.exit(echecs === 0 ? 0 : 1);
