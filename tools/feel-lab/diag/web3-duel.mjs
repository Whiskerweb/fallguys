/**
 * UN DUEL PAYANT, POUR DE VRAI — deux comptes, deux navigateurs, le serveur de production,
 * le backend, et Robinhood Chain testnet.
 *
 *   cd backend && npm start · cd serveur && npm start
 *   node diag/web3-duel.mjs http://127.0.0.1:8080 emailA mdpA emailB mdpB
 *
 * Les deux comptes doivent exister et détenir au moins 2 USDG. Le harnais les fait entrer
 * en 1v1 à 2 USDG, attend que le serveur fasse partir les mises (« STAKING… ») et que la
 * manche 1 s'annonce, puis fait ABANDONNER les deux : le serveur clôt la partie, la règle
 * par le backend, et chaque compte reçoit `reglement`. On lit ensuite les soldes et la
 * page de suivi. Rien ici ne pilote un personnage : c'est l'ARGENT qu'on prouve.
 */

import { chromium } from 'playwright';

const [BASE, EA, MA, EB, MB] = process.argv.slice(2);
if (!EB) { console.error('usage : node diag/web3-duel.mjs <url> emailA mdpA emailB mdpB'); process.exit(2); }
let total = 0; let echecs = 0;
const dit = (ok, t) => { total++; if (!ok) echecs++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${t}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const api = (chemin) => fetch(`${BASE}/api${chemin}`).then((r) => r.json());

const browser = await chromium.launch();
async function joueur(nom, email, mdp) {
  // UN CONTEXTE PAR JOUEUR : deux pages du même contexte partagent le localStorage, donc la
  // session Supabase — la seconde connexion écraserait la première, et le serveur verrait
  // deux fois le même compte sous le même nom.
  const contexte = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await contexte.newPage();
  await page.addInitScript((n) => localStorage.setItem('tumble-pseudo', n), nom);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#lobby-ui:not(.hidden)', { timeout: 60_000 });
  // La PORTE s'ouvre dès que le serveur dit qu'il y a de l'argent : on entre par elle.
  await page.waitForSelector('#porte:not(.hidden)', { timeout: 30_000 });
  await page.fill('#porte-mail', email);
  await page.fill('#porte-mdp', mdp);
  await page.click('#porte-bouton');
  await page.waitForFunction(() => document.getElementById('porte').classList.contains('hidden'), null, { timeout: 30_000 });
  await page.waitForFunction(() => document.getElementById('recharger')?.textContent === 'WALLET', null, { timeout: 20_000 });
  // Le lobby se représente au serveur avec le jeton : on attend d'être RECONNU, pas
  // seulement connecté — c'est le compte qui ouvre les files payantes.
  await page.waitForFunction(() => document.getElementById('lien')?.className === 'ouvert' && Boolean(window.__probeGame?.().file?.compte), null, { timeout: 30_000 });
  const solde = Number(await page.$eval('#balance', (e) => e.textContent));
  return { nom, page, solde };
}

titre('1. Deux comptes connectés');
const A = await joueur('ProbeA', EA, MA);
const B = await joueur('ProbeB', EB, MB);
dit(A.solde >= 2 && B.solde >= 2, `A a ${A.solde.toFixed(2)} USDG, B ${B.solde.toFixed(2)} — assez pour une table à 2`);
const avant = (await api('/stats')).parties.reglees;

titre('2. Ils entrent en 1v1 à 2 USDG ; le serveur fait partir les mises');
for (const j of [A, B]) {
  await j.page.click('.mode[data-mode="duel"]');
  await j.page.click('.palier[data-usdg="2"]');
  await j.page.waitForFunction(() => !document.getElementById('play').disabled, null, { timeout: 10_000 });
  await j.page.click('#play');
}
await A.page.waitForFunction(() => document.getElementById('play-txt')?.textContent === 'STAKING…', null, { timeout: 30_000 }).catch(() => {});
const staking = await A.page.$eval('#play-txt', (e) => e.textContent);
dit(staking === 'STAKING…', `le bouton a dit « ${staking} » pendant l'engagement`);
await A.page.waitForFunction(() => window.__probeGame?.().mode === 'racing', null, { timeout: 120_000 });
await B.page.waitForFunction(() => window.__probeGame?.().mode === 'racing', null, { timeout: 60_000 });
dit(true, 'la manche 1 s\'est annoncée aux deux : les deux mises sont dans le pot, sur la chaîne');
const enCours = (await api('/stats')).parties.enCours;
dit(enCours >= 1, `le backend voit ${enCours} partie engagée`);

titre('3. Les deux abandonnent : le serveur clôt, le backend règle');
await A.page.evaluate(() => window.__probeGame().surAbandon());
await new Promise((r) => setTimeout(r, 1500));
await B.page.evaluate(() => window.__probeGame().surAbandon());
let stats = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  stats = await api('/stats');
  if (stats.parties.reglees > avant) break;
}
dit(stats.parties.reglees === avant + 1, `le backend a réglé la partie (${stats.parties.reglees} réglée(s))`);
const p = stats.dernieresParties[0];
dit(p && p.mode === 'duel' && Number(p.mise) === 2_000_000 && p.statut === 'reglee', `duel à 2 USDG, ligne ${p?.issue}, pot ${Number(p?.pot) / 1e6}, frais ${Number(p?.rake) / 1e6} — pot ${p?.adresse_pot}`);
const tx = stats.chaine.dernieres.filter((t) => t.partie === p.id);
dit(tx.some((t) => t.objet === 'mise') && tx.some((t) => t.objet === 'gain' || t.objet === 'rake') && new Set(tx.filter((t) => t.objet === 'mise').map((t) => t.signature)).size === 1,
  `${tx.length} opérations sur la chaîne pour cette partie, les deux mises dans UNE transaction : ${[...new Set(tx.map((t) => t.objet))].join(', ')}`);
for (const t of tx) console.log(`      ${t.objet.padEnd(12)} ${t.montant / 1e6} ${t.mint.toUpperCase()} ${t.lien}`);

titre('4. Les soldes ont bougé, sur les deux écrans');
// Le `reglement` arrive après les virements on-chain : on attend que la barre BOUGE, pas
// une durée — une durée fixe mesurerait le RPC, pas le jeu.
for (const j of [A, B]) {
  await j.page.waitForFunction((s) => Number(document.getElementById('balance').textContent) !== s, j.solde, { timeout: 60_000 }).catch(() => {});
}
const apresA = Number(await A.page.evaluate(() => document.getElementById('balance').textContent));
const apresB = Number(await B.page.evaluate(() => document.getElementById('balance').textContent));
dit(Math.abs(apresA + apresB - (A.solde + B.solde) + Number(p.rake) / 1e6) < 0.005,
  `A ${A.solde.toFixed(2)} → ${apresA.toFixed(2)} · B ${B.solde.toFixed(2)} → ${apresB.toFixed(2)} · frais ${Number(p.rake) / 1e6}`);

await browser.close();
console.log(`\n--- ${echecs === 0 ? `${total} verdicts, aucun écart` : `${echecs} ÉCHEC(S) sur ${total}`} ---`);
process.exit(echecs ? 1 : 0);
