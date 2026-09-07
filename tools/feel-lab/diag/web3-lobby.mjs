/**
 * LE LOBBY CONNECTÉ À L'ARGENT — vu par un vrai navigateur, contre un vrai backend.
 *
 * Ce harnais ne lance PAS ses serveurs : il vise un serveur de jeu en PRODUCTION, branché
 * sur un backend (Supabase + Robinhood Chain testnet), exactement comme un joueur. Il faut donc :
 *
 *   cd backend && PORT=8788 npm start
 *   cd serveur && PORT=8081 BACKEND_URL=http://127.0.0.1:8788 npm start
 *   cd tools/feel-lab && node diag/web3-lobby.mjs http://127.0.0.1:8081 email motdepasse
 *
 * Ce qu'il vérifie, dans l'ordre où un joueur le vit : sans compte, le solde vaut ZÉRO et
 * PLAY dit de se connecter (plus de TOP UP) ; connecté, la barre montre le solde du grand
 * livre, le panneau WALLET montre l'adresse de dépôt dérivée par le backend et l'historique ;
 * et une table payante reste fermée tant que le solde ne la couvre pas.
 *
 * Aucun verdict n'est jugé sur une image : on lit le DOM et `__probeGame()`.
 */

import { chromium } from 'playwright';

const [BASE = 'http://127.0.0.1:8081', EMAIL, MDP] = process.argv.slice(2);
// Sans compte, on ne vérifie que ce qu'un inconnu voit : les sections 1 et 4. Un compte
// Supabase CONFIRMÉ est nécessaire pour le reste (Confirm email désactivé, ou lien cliqué).
const CONNECTE = Boolean(EMAIL && MDP);

let total = 0; let echecs = 0;
const dit = (ok, t) => { total++; if (!ok) echecs++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${t}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
await page.addInitScript(() => localStorage.setItem('tumble-pseudo', 'Web3Probe'));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#lobby-ui:not(.hidden)', { timeout: 60_000 });
await page.waitForFunction(() => document.getElementById('lien')?.className === 'ouvert', null, { timeout: 30_000 });

titre('1. Sans compte : zéro, et pas de recharge');
{
  await page.waitForFunction(() => document.getElementById('balance')?.textContent !== '—', null, { timeout: 10_000 });
  const solde = await page.$eval('#balance', (e) => e.textContent);
  dit(solde === '0.00', `la barre affiche ${solde} USDC (attendu 0.00)`);
  const bouton = await page.$eval('#recharger', (e) => ({ texte: e.textContent, cache: e.classList.contains('hidden') }));
  dit(bouton.texte === 'SIGN IN' && !bouton.cache, `le bouton de la barre dit « ${bouton.texte} » — plus de TOP UP`);
  const play = await page.$eval('#play', (e) => e.disabled);
  const note = await page.$eval('#play-note', (e) => e.textContent);
  dit(play && /Sign in/i.test(note), `PLAY est fermé : « ${note} »`);
  const etat = await (await fetch(`${BASE}/etat`)).json();
  dit(etat.argent === true && etat.identite === true, `le serveur dit : argent ${etat.argent}, identité vérifiée ${etat.identite}`);
}

if (CONNECTE) {
titre('2. Connexion');
{
  // La PORTE s'ouvre dès que le serveur dit qu'il y a de l'argent : on entre par elle.
  await page.waitForSelector('#porte:not(.hidden)', { timeout: 30_000 });
  await page.fill('#porte-mail', EMAIL);
  await page.fill('#porte-mdp', MDP);
  await page.click('#porte-bouton');
  await page.waitForFunction(() => document.getElementById('porte').classList.contains('hidden'), null, { timeout: 30_000 });
  // La session est reconnue par le backend (solde relu) ET par le serveur de jeu (reconnexion
  // avec jeton) : la caisse passe en ligne.
  await page.waitForFunction(() => document.getElementById('recharger')?.textContent === 'WALLET', null, { timeout: 20_000 });
  const bouton = await page.$eval('#recharger', (e) => e.textContent);
  dit(bouton === 'WALLET', `connecté, le bouton devient « ${bouton} »`);
  const solde = await page.$eval('#balance', (e) => e.textContent);
  dit(/^\d+\.\d\d$/.test(solde), `la barre montre le solde du grand livre : ${solde} USDC`);
  const note = await page.$eval('#play-note', (e) => e.textContent);
  const play = await page.$eval('#play', (e) => e.disabled);
  const jouable = Number(solde) >= 2;
  dit(play === !jouable, `PLAY ${play ? 'fermé' : 'ouvert'} avec ${solde} USDC sur une table à 2 : « ${note} »`);
}

titre('3. Le panneau WALLET : dépôt, retrait, historique');
{
  await page.click('#recharger');
  await page.waitForSelector('#wallet-fond:not(.hidden)');
  await page.waitForFunction(() => (document.getElementById('wallet-adresse')?.textContent ?? '—') !== '—', null, { timeout: 15_000 });
  const adresse = await page.$eval('#wallet-adresse', (e) => e.textContent);
  dit(/^0x[0-9a-fA-F]{40}$/.test(adresse), `l'adresse de dépôt est une adresse Robinhood Chain : ${adresse}`);
  const lien = await page.$eval('#wallet-adresse', (e) => e.getAttribute('href'));
  dit(/chain\.robinhood\.com\/address\/|blockscout\.com\/address\//.test(lien) && lien.includes(adresse), `et elle mène à l'explorateur : ${lien}`);
  const noteDepot = await page.$eval('#wallet-depot-note', (e) => e.textContent);
  dit(/Robinhood Chain/.test(noteDepot) && /Minimum/.test(noteDepot), `la note dit le réseau et le minimum : « ${noteDepot.slice(0, 60)}… »`);
  const robinet = await page.$eval('#wallet-robinet', (e) => ({ cache: e.classList.contains('hidden'), texte: e.textContent }));
  dit(!robinet.cache && /TEST USDC/.test(robinet.texte), `le robinet d'essai est offert sur le testnet : « ${robinet.texte} »`);
  const deposer = await page.$eval('#wallet-deposer', (e) => e.textContent);
  dit(/DEPOSIT FROM WALLET/.test(deposer), 'et le dépôt direct depuis le wallet du joueur est proposé');
  const lie = await page.$eval('#wallet-lie', (e) => e.textContent);
  dit(/LINK|Withdrawals go to/.test(lie), `le retrait exige un wallet lié : « ${lie.slice(0, 50)}… »`);
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('wallet-historique')?.textContent ?? ''), null, { timeout: 15_000 });
  const histo = await page.$eval('#wallet-historique', (e) => e.textContent);
  dit(histo.length > 0, `l'historique répond : « ${histo.slice(0, 60)} »`);
  const stats = await page.$eval('#wallet-stats', (e) => e.getAttribute('href'));
  dit(/\/suivi$/.test(stats), `le lien vers le suivi on-chain : ${stats}`);
  // Un retrait sans wallet lié est refusé par le backend, et le panneau le dit.
  await page.fill('#wallet-montant', '30');
  await page.click('#wallet-retirer');
  await page.waitForFunction(() => /Link a wallet|Minimum|Not enough|opens/.test(document.getElementById('wallet-msg')?.textContent ?? ''), null, { timeout: 15_000 });
  const msg = await page.$eval('#wallet-msg', (e) => e.textContent);
  dit(/Link a wallet|Minimum|Not enough|opens/.test(msg), `un retrait impossible est refusé en clair : « ${msg} »`);
  await page.click('#wallet-fermer');
}
} else {
  console.log('\n(sections 2 et 3 sautées : passer <email> <mot de passe> d\'un compte confirmé)');
}

titre('4. La page de suivi, relayée par le serveur de jeu');
{
  const r = await fetch(`${BASE}/api/stats`);
  const s = await r.json();
  dit(r.ok && s.reseau === 'testnet' && s.reseauDetail?.chainId === 46630, `/api/stats répond : réseau ${s.reseau} (chainId ${s.reseauDetail?.chainId}), ${s.parties.reglees} parties, ${s.brulage.rachats} rachats`);
  const etat = await (await fetch(`${BASE}/etat`)).json();
  dit(etat.chaine?.stable === 'USDC' && etat.chaine?.reseau === 'testnet', `le serveur de jeu dit la chaîne au navigateur : ${etat.chaine?.reseau}, dollar ${etat.chaine?.stable}`);
  const p = await fetch(`${BASE}/api/suivi`);
  dit(p.ok && /Tumble · on-chain/.test(await p.text()), '/api/suivi sert la page de suivi');
}

dit(erreurs.length === 0, `aucune erreur de page (${erreurs.length})${erreurs.length ? ' : ' + erreurs[0] : ''}`);
await browser.close();
console.log(`\n--- ${echecs === 0 ? `${total} verdicts, aucun écart` : `${echecs} ÉCHEC(S) sur ${total}`} ---`);
process.exit(echecs ? 1 : 0);
