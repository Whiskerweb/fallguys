/**
 * L'ARRIVÉE D'UN NOUVEAU JOUEUR, cliquée dans un vrai navigateur : le cadeau, puis le
 * guide de dépôt — sans clic entre les deux.
 *
 * Ce qu'il juge, dans l'ordre où le joueur le vit :
 *
 *   1. la boîte est là, fermée, et BabyVlad n'est PAS encore porté ;
 *   2. un clic l'ouvre : le personnage est révélé, nommé, et EQUIPÉ — la barre du haut
 *      porte son portrait, la mémoire du navigateur le retient ;
 *   3. sans rien cliquer, le guide de dépôt s'ouvre ;
 *   4. le guide sur le MAINNET (profil imposé, wallet et RPC factices) : les trois
 *      chemins USDG / ETH, le jeton le mieux garni pré-choisi, le devis du swap
 *      lu sur le routeur et écrit sur le bouton, le montant proposé à 10 ;
 *   5. le guide sur le TESTNET : le robinet en tête, USDG et ETH grisés avec la raison ;
 *   6. rechargée, la page ne rouvre pas la boîte : le cadeau est reçu pour de bon.
 *
 * Le wallet est une DOUBLURE (`window.ethereum` posée avant le chargement) et le RPC est
 * intercepté : aucun réseau, aucun site tiers. Ce qu'on mesure est le jeu.
 *
 * Le port est figé et le serveur est `vite preview` : le rechargement à chaud d'une
 * autre session fausserait la mesure.
 *
 *   cd tools/feel-lab && npx vite build
 *   npx vite preview --port 5275 --host 127.0.0.1 &
 *   node diag/cadeau-ecran.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.FEELLAB_PORT ?? 5275;
const BASE = process.env.FEELLAB_BASE ?? `http://127.0.0.1:${PORT}`;
const RPC = 'https://rpc.factice.test/';
const ADRESSE = '0x1111111111111111111111111111111111111111';
const DEPOT = '0x2222222222222222222222222222222222222222';
const USDG = '0x3333333333333333333333333333333333333333';
const WETH = '0x5555555555555555555555555555555555555555';
const ROUTEUR = '0x6666666666666666666666666666666666666666';

let echecs = 0;
const dit = (ok, texte) => { if (!ok) echecs++; console.log(`${ok ? 'OK  ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const contexte = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));

// Mémoire VIERGE : l'état d'un joueur qui découvre le jeu. Et une doublure de wallet,
// qui connaît un compte sans qu'on le lui demande.
await page.addInitScript(({ adresse }) => {
  // Vierge UNE fois : le script d'initialisation rejoue à chaque navigation, et la
  // section 6 recharge la page précisément pour voir ce que la mémoire a retenu.
  if (!sessionStorage.getItem('cadeau-vierge')) { localStorage.clear(); sessionStorage.setItem('cadeau-vierge', '1'); }
  window.ethereum = {
    isMetaMask: true,
    async request({ method }) {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [adresse];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain') return null;
      // Une transaction « signée » : un hache, et rien ne part nulle part.
      if (method === 'eth_sendTransaction') return '0x' + 'ab'.repeat(32);
      throw Object.assign(new Error(`doublure : ${method}`), { code: 4200 });
    },
  };
}, { adresse: ADRESSE });

// Le RPC factice : des soldes connus, et un routeur qui cote 1 USDG = 0.0003 ETH.
const hex32 = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
await page.route(`${RPC}**`, async (route) => {
  const { id, method, params } = route.request().postDataJSON();
  let result = '0x0';
  if (method === 'eth_getBalance') result = hex32(2n * 10n ** 18n);                 // 2 ETH
  if (method === 'eth_call') {
    const { to, data } = params[0];
    if (data.startsWith('0x70a08231')) {                                            // balanceOf
      result = hex32(to.toLowerCase() === USDG ? 12_400_000 : to.toLowerCase() === USDG ? 50_000_000 : 0);
    } else if (data.startsWith('0x1f00ca74')) {                                     // getAmountsIn
      const sortie = BigInt('0x' + data.slice(10, 74));
      const premier = data.slice(74 + 128 + 24, 74 + 128 + 64).toLowerCase();       // path[0]
      const entree = premier === WETH.slice(2) ? sortie * 3n * 10n ** 8n : sortie * 101n / 100n;
      result = '0x' + [32n, 2n, entree, sortie].map((x) => x.toString(16).padStart(64, '0')).join('');
    }
  }
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id, result }) });
});

await page.goto(`${BASE}/?lowfx&nointro&cadeau`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, null, { timeout: 180000 });

const texte = (sel) => page.textContent(sel).then((t) => (t ?? '').trim());
const visible = (sel) => page.isVisible(sel);
const memoire = (cle) => page.evaluate((k) => localStorage.getItem(k), cle);

titre('1. La boîte, fermée');
await page.waitForSelector('#cadeau:not(.hidden)', { timeout: 10000 });
dit(await visible('#cadeau-boite'), 'la boîte cadeau est à l\'écran, plein écran');
dit(await texte('.cd-titre') === 'A GIFT FOR YOU', `le titre : ${await texte('.cd-titre')}`);
dit((await memoire('tumble-model')) !== 'char-tinytrader', 'BabyVlad n\'est pas encore porté');
dit(!(await page.evaluate(() => document.getElementById('cadeau').classList.contains('revele'))), 'rien n\'est révélé avant le clic');
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/cadeau-1-fermee.png' });

titre('2. Un clic, et BabyVlad est à lui');
// `force` : la boîte FLOTTE (animation continue), et Playwright refuse de cliquer ce qui bouge.
await page.click('#cadeau-boite', { force: true });
await page.waitForSelector('#cadeau.ouvert', { timeout: 3000 });
// La séquence dure ~3,5 s en tout et une capture en rendu logiciel en prend plus d'une :
// on LIT la révélation d'abord, on photographie ensuite. Attendre des états, pas des durées.
await page.screenshot({ path: 'shots/cadeau-2-ouverture.png' });
await page.waitForSelector('#cadeau.revele', { timeout: 5000 });
dit(await texte('#cadeau-nom') === 'BABYVLAD', `le personnage révélé : ${await texte('#cadeau-nom')}`);
page.screenshot({ path: 'shots/cadeau-3-revele.png' }).catch(() => {});
dit(await texte('#cadeau-rarity') === 'EPIC', `sa rareté : ${await texte('#cadeau-rarity')}`);
dit(await texte('#cadeau-etat') === 'SKIN UNLOCKED · EQUIPPED', `l'état : ${await texte('#cadeau-etat')}`);
dit((await memoire('tumble-model')) === 'char-tinytrader', 'la mémoire du navigateur porte BabyVlad');
dit(JSON.parse(await memoire('tumble-boutique') ?? '{}').debloques?.includes('char-tinytrader') === true, 'et la boutique le compte comme reçu');
dit((await page.getAttribute('#profil-port', 'src') ?? '').includes('char-tinytrader'), 'la barre du haut montre son portrait');
dit(await visible('#cadeau-suite'), 'la suite est annoncée : NEXT · FUND YOUR WALLET');

titre('3. Sans rien cliquer : le guide de dépôt');
await page.waitForSelector('#depot:not(.hidden)', { timeout: 8000 });
await page.waitForFunction(() => document.getElementById('cadeau').classList.contains('hidden'), null, { timeout: 3000 });
dit(true, 'le guide s\'est ouvert tout seul, la boîte s\'est refermée');
dit(await visible('#depot-sans-compte'), 'sans compte (banc, pas de backend) : il demande de se connecter, rien d\'autre');
await page.screenshot({ path: 'shots/cadeau-4-guide-sans-compte.png' });

titre('4. Le guide sur le MAINNET : USDG, USDG, ETH');
const profilMainnet = {
  userId: 'u1', reseau: 'mainnet', adresseDepot: DEPOT, depotMinimum: 1_000_000, solde: 0,
  chaine: { nom: 'Robinhood Chain', chainId: 4663, rpc: RPC, usdg: USDG, swap: { routeur: ROUTEUR, weth: WETH }, robinet: false, explorateur: 'https://x.test' },
  liens: { explorateur: 'https://x.test' },
};
await page.evaluate((p) => window.__probeDepot.ouvrir({ raison: 'wallet', profil: p }), profilMainnet);
await page.waitForFunction(() => /You have/.test(document.querySelector('.dp-jeton[data-jeton="usdg"] .dp-jeton-solde')?.textContent ?? ''), null, { timeout: 8000 });
const jetons = await page.$$eval('.dp-jeton', (bs) => bs.map((b) => ({ id: b.dataset.jeton, off: b.disabled, on: b.classList.contains('on'), solde: b.querySelector('.dp-jeton-solde').textContent })));
dit(jetons.length === 2 && jetons.every((j) => !j.off), `deux chemins ouverts, USDG direct ou ETH change : ${jetons.map((j) => j.id).join(' / ')}`);
dit(jetons.find((j) => j.id === 'usdg').solde === 'You have 12.40 USDG', `le solde USDG du wallet est lu sur la chaîne : ${jetons.find((j) => j.id === 'usdg').solde}`);
dit(jetons.find((j) => j.id === 'eth').solde === 'You have 2.0000 ETH', `et l'ETH : ${jetons.find((j) => j.id === 'eth').solde}`);
dit(jetons.find((j) => j.id === 'usdg').on, 'l\'USDG est pré-choisi : c\'est ce qu\'il a le plus (50 > 12.40)');
dit(await visible('#depot-testnet') === false, 'pas de bloc testnet sur le mainnet');
dit((await texte('#depot-wallet-etat')).startsWith('Wallet 0x1111'), `le wallet connu est nommé : ${await texte('#depot-wallet-etat')}`);
const dixOn = await page.$eval('.dp-montant[data-usdg="10"]', (b) => b.classList.contains('on'));
dit(dixOn, '10 USDG est proposé par défaut — la table du milieu');
await page.waitForFunction(() => /PAY ≈/.test(document.getElementById('depot-go')?.textContent ?? ''), null, { timeout: 8000 });
dit(await texte('#depot-go') === 'PAY ≈ 10.10 USDG → 10.00 USDG', `le bouton dit le devis USDG : ${await texte('#depot-go')}`);
await page.click('.dp-jeton[data-jeton="eth"]');
await page.waitForFunction(() => /ETH →/.test(document.getElementById('depot-go')?.textContent ?? ''), null, { timeout: 8000 });
dit(await texte('#depot-go') === 'PAY ≈ 0.0030 ETH → 10.00 USDG', `et le devis ETH, lu sur le routeur : ${await texte('#depot-go')}`);
dit(/One confirmation/.test(await texte('#depot-note')), `la note dit combien de confirmations : « ${await texte('#depot-note')} »`);
await page.click('.dp-montant[data-usdg="20"]');
await page.waitForFunction(() => /0\.0060 ETH → 20\.00/.test(document.getElementById('depot-go')?.textContent ?? ''), null, { timeout: 8000 });
dit(true, `changer le montant recote : ${await texte('#depot-go')}`);
await page.click('.dp-jeton[data-jeton="usdg"]');
await page.waitForFunction(() => /^DEPOSIT 20\.00 USDG$/.test(document.getElementById('depot-go')?.textContent ?? ''), null, { timeout: 4000 });
const goUsdg = await page.$eval('#depot-go', (b) => ({ texte: b.textContent, off: b.disabled }));
dit(goUsdg.off && /Not enough USDG/.test(await texte('#depot-note')), `20 USDG avec 12.40 en poche : bouton fermé, et il dit pourquoi — « ${(await texte('#depot-note')).slice(0, 48)}… »`);
await page.click('.dp-montant[data-usdg="10"]');
await page.waitForFunction(() => !document.getElementById('depot-go').disabled, null, { timeout: 4000 });
dit(await texte('#depot-go') === 'DEPOSIT 10.00 USDG', `10 USDG en USDG : ${await texte('#depot-go')}, ouvert`);
await page.screenshot({ path: 'shots/cadeau-5-guide-mainnet.png' });

titre('4b. Après la signature, on attend AVEC lui');
await page.click('#depot-go');
await page.waitForFunction(() => /Sent!/.test(document.getElementById('depot-2-titre')?.textContent ?? ''), null, { timeout: 8000 });
dit(await page.$eval('.dp-etape[data-n="2"]', (e) => e.classList.contains('on')), 'l\'étape 2 est allumée');
dit(/0xababab/.test(await texte('#depot-2-sous')), `le hache est nommé, et on dit qu'on regarde la chaîne : « ${(await texte('#depot-2-sous')).slice(0, 70)}… »`);
dit(await page.$eval('#depot-2-liste li:last-child', (e) => e.classList.contains('on')), 'la dernière étape de la liste — « we watch the chain » — est celle en cours');
dit(/credited anyway/.test(await texte('#depot-2-retour')), 'et fermer est permis : le crédit viendra quand même');
await page.screenshot({ path: 'shots/cadeau-5b-attente.png' });

titre('5. Le guide sur le TESTNET : le robinet en tête');
const profilTestnet = { ...profilMainnet, reseau: 'testnet', chaine: { ...profilMainnet.chaine, nom: 'Robinhood Chain Testnet', swap: null, robinet: true, robinetMicros: 20_000_000 } };
await page.evaluate((p) => window.__probeDepot.ouvrir({ raison: 'bienvenue', profil: p }), profilTestnet);
await page.waitForTimeout(400);
dit(await visible('#depot-testnet'), 'le bloc testnet est en tête');
dit(await texte('#depot-robinet') === 'GET 20.00 TEST USDG · FREE', `le robinet : ${await texte('#depot-robinet')}`);
const jetonsT = await page.$$eval('.dp-jeton', (bs) => bs.map((b) => ({ id: b.dataset.jeton, off: b.disabled, solde: b.querySelector('.dp-jeton-solde').textContent })));
dit(!jetonsT.find((j) => j.id === 'usdg').off, 'USDG reste ouvert');
dit(jetonsT.find((j) => j.id === 'eth').off && /Mainnet only/.test(jetonsT.find((j) => j.id === 'eth').solde), `ETH aussi : ${jetonsT.find((j) => j.id === 'eth').solde}`);
dit(await texte('#depot-titre') === 'Now, fund your game wallet', `le titre d'arrivée : ${await texte('#depot-titre')}`);
await page.screenshot({ path: 'shots/cadeau-6-guide-testnet.png' });
await page.click('#depot-fermer');
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/cadeau-7-lobby.png' });

titre('6. Rechargée, la boîte ne revient pas');
await page.goto(`${BASE}/?lowfx&nointro`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, null, { timeout: 180000 });
await page.waitForTimeout(500);
dit(!(await visible('#cadeau')), 'le cadeau est reçu pour de bon : pas de boîte');
dit((await memoire('tumble-model')) === 'char-tinytrader', 'et BabyVlad est toujours porté');

titre('La boutique le sait');
await page.click('#btn-boutique');
await page.waitForTimeout(300);
// La vitrine est en tuiles ; cliquer la sienne ouvre sa fiche (`#shop-detail`).
await page.click('.shop-tuile[data-article="char-tinytrader"]');
await page.waitForTimeout(250);
dit(await texte('#shop-detail .shop-prix') === 'GIFT', `sa fiche dit : ${await texte('#shop-detail .shop-prix')}`);
dit(/EQUIPPED/.test(await texte('#shop-detail .shop-action')), `et son bouton : ${await texte('#shop-detail .shop-action')}`);

dit(erreurs.length === 0, erreurs.length ? `erreurs de page : ${erreurs.join(' | ')}` : 'aucune erreur de page');
await browser.close();
console.log(`\n${echecs ? `\x1b[31m${echecs} échec(s)\x1b[0m` : '\x1b[32mtout passe\x1b[0m'}`);
process.exit(echecs ? 1 : 0);
