/**
 * LA BASCULE — deux navigateurs, deux files, une notification qui les réunit.
 *
 * Le scénario fondateur du lobby en ligne, joué dans le VRAI jeu :
 *
 *   machine-1 clique PLAY sur ARENA 16 à 2 USDC. Elle attend seule.
 *   machine-2 clique PLAY sur 1v1 à 2 USDC. Elle attend seule aussi — mais un duel part à
 *   deux, et l'arène ne partira jamais à deux.
 *   Au bout du délai, le serveur le dit à machine-1 : « 1 player waiting in 1v1 · 2 USDC —
 *   your match would start right now ». Elle clique SWITCH. Les deux entrent en manche.
 *
 * Ce que ce harnais vérifie, et qu'aucun test sans navigateur ne peut voir :
 *
 *   - le lobby est EN LIGNE sans rien ouvrir ni saisir : la pastille passe à ONLINE ;
 *   - la PRÉSENCE se voit avant de choisir : machine-2 lit « 1 waiting » sur ARENA ;
 *   - la file s'affiche dans le ticket, avec ses places et son chrono ;
 *   - la SUGGESTION arrive chez la bonne machine, et seulement elle ;
 *   - SWITCH bascule vraiment : le ticket suit (le mode sélectionné devient 1v1), et les
 *     deux pages entrent en manche ;
 *   - LEAVE QUEUE sort de la file, et la présence redescend chez l'autre.
 *
 * Aucun serveur à lancer d'avance : le harnais démarre le sien, qui sert aussi la page.
 *
 *   cd tools/feel-lab && npm run build && node diag/bascule.mjs
 */

import { chromium } from 'playwright';
import { dossierDeBanc } from '../src/boutique.js';
import { demarrerServeur } from '../../../serveur/src/serveur.js';
import { POLITIQUES } from '../../../serveur/src/politique.js';

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

let browser;
process.on('exit', () => { try { browser?.close(); } catch {} });

/*
 * DEV, en plus court : l'arène annonce seize places et n'en exige que trois avec une mise,
 * le duel part à deux, et la suggestion tombe après UNE seconde au lieu de huit. Ces
 * navigateurs tournent au dixième de la vitesse réelle ; on n'attend pas des durées, on
 * attend des ÉTATS, mais un délai de huit secondes n'apprendrait rien de plus qu'un délai
 * d'une seconde.
 */
const serveur = await demarrerServeur({
  port: 0,
  politique: { ...POLITIQUES.DEV, nom: 'DEV_BASCULE', suggererApres: 1, attente: 60, proposerApres: 60, dureeManche: 300 },
  graine: 20260902,
});
const BASE = `http://127.0.0.1:${serveur.port}`;
console.log(`serveur de jeu et page sur ${BASE}`);

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** Ouvre une page jusqu'au lobby, sous ce nom, sur ce mode — sans cliquer PLAY. */
async function ouvrir(nom, mode, modele) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.setDefaultTimeout(120000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`${nom}: ${String(e).slice(0, 160)}`));
  // `boutique` manquait à la liste : le script jetait « boutique is not defined » sur
  // chaque machine, et BabyTrump n'était jamais équipé — trouvé par la ligne « erreurs ».
  await page.addInitScript(({ nom, mode, modele, boutique }) => {
    localStorage.setItem('tumble-pseudo', nom);
    localStorage.setItem('tumble-mode', mode);
    localStorage.setItem('tumble-mise', '2');
    localStorage.setItem('tumble-model', modele);
    // BabyTrump est en BOUTIQUE : sans son dossier de possession, le catalogue refuse de
    // l'equiper et les deux machines repartent avec le meme personnage.
    localStorage.setItem(boutique.cle, boutique.valeur);
  }, { nom, mode, modele, boutique: dossierDeBanc() });
  await page.goto(`${BASE}/?lowfx&nointro&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && getComputedStyle(l).display === 'none';
  }, { timeout: 300000 });
  return { nom, page, erreurs };
}

const lire = (j) => j.page.evaluate(() => {
  const f = window.__probeGame()?.file;
  const txt = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
  const vis = (id) => { const e = document.getElementById(id); return e ? !e.classList.contains('hidden') : null; };
  return {
    etat: f?.etat, enFile: f?.enFile, salon: f?.salon, suggestion: f?.suggestion,
    lien: txt('lien-txt'), lienClasse: document.getElementById('lien')?.className,
    play: txt('play-txt'), note: txt('play-note'), playDesactive: document.getElementById('play')?.disabled,
    file: vis('file'), fileTitre: txt('file-titre'), fileLigne: txt('file-ligne'),
    sieges: document.querySelectorAll('#file-sieges i').length,
    pris: document.querySelectorAll('#file-sieges i.pris').length,
    modeOn: document.querySelector('.mode.on')?.dataset.mode,
    badges: [...document.querySelectorAll('.mode')].map((b) => `${b.dataset.mode}:${b.querySelector('.attente')?.classList.contains('hidden') ? '' : b.querySelector('.attente')?.textContent}`),
    notif: document.querySelector('#notifs .notif')?.textContent?.trim() ?? null,
    mode: window.__probeGame()?.mode,
  };
});

// ===========================================================================
titre('1. Le lobby est en ligne sans rien ouvrir');
// ===========================================================================
const un = await ouvrir('machine-1', 'arena', 'char-babytrump');
await un.page.waitForFunction(() => window.__probeGame()?.file?.etat === 'ouvert', { timeout: 20000 });
{
  const v = await lire(un);
  dit(v.etat === 'ouvert', `la page s'est connectée toute seule (${v.etat})`);
  dit(/ONLINE/.test(v.lien ?? ''), `la pastille de la barre dit « ${v.lien} »`);
  dit(v.play === 'PLAY' && v.playDesactive === false, `le bouton dit « ${v.play} » et il est actif`);
  dit(!(await un.page.$('#btn-enligne')) && !(await un.page.$('#enligne-fond')),
    'il n\'existe plus ni bouton ONLINE ni panneau à ouvrir');
  const nom = await un.page.evaluate(() => document.getElementById('pname')?.textContent?.trim());
  dit(nom === 'machine-1', `la barre porte le nom sous lequel on s'est présenté (« ${nom} »)`);
}

// ===========================================================================
titre('2. PLAY entre en file, et le ticket le montre');
// ===========================================================================
await un.page.click('#play');
await un.page.waitForFunction(() => Boolean(window.__probeGame()?.file?.salon), { timeout: 20000 });
{
  const v = await lire(un);
  dit(v.enFile === true, 'machine-1 est en file');
  dit(v.file === true && /LOOKING/.test(v.fileTitre ?? ''), `le bloc de file est visible : « ${v.fileTitre} »`);
  dit(/ARENA/.test(v.fileLigne ?? '') && /1 \/ 16/.test(v.fileLigne ?? ''), `il dit où l'on attend : « ${v.fileLigne} »`);
  dit(v.sieges === 16 && v.pris === 1, `seize places dessinées, une prise (${v.pris}/${v.sieges})`);
  dit(v.play === 'LEAVE QUEUE', `le bouton est devenu « ${v.play} »`);
  dit(v.salon?.mode === 'arena' && v.salon?.mise === 2_000_000, 'le salon reçu est bien l\'arène à 2 USDC');
  await un.page.screenshot({ path: 'shots/bascule-en-file.png' });
  console.log('     shots/bascule-en-file.png');
}

// ===========================================================================
titre('3. La présence se voit AVANT de choisir');
// ===========================================================================
const deux = await ouvrir('machine-2', 'duel', 'char-techtitan');
await deux.page.waitForFunction(() => window.__probeGame()?.file?.etat === 'ouvert', { timeout: 20000 });
await deux.page.waitForFunction(
  () => (window.__probeGame()?.file?.files ?? []).some((f) => f.mode === 'arena' && f.joueurs === 1),
  { timeout: 20000 },
);
{
  const v = await lire(deux);
  const arene = v.badges.find((b) => b.startsWith('arena:'));
  dit(arene === 'arena:1 waiting', `machine-2, qui n'a rien cliqué, lit « ${arene?.split(':')[1]} » sur ARENA`);
  dit(v.enFile === false, 'et elle n\'est dans aucune file');
  dit(/2 players/.test(v.lien ?? ''), `la pastille compte les connectés : « ${v.lien} »`);
  await deux.page.screenshot({ path: 'shots/bascule-presence.png' });
  console.log('     shots/bascule-presence.png');
}

// ===========================================================================
titre('4. La suggestion arrive chez la bonne machine, et chez elle seule');
// ===========================================================================
await deux.page.click('#play');
await deux.page.waitForFunction(() => Boolean(window.__probeGame()?.file?.salon), { timeout: 20000 });
await un.page.waitForFunction(() => Boolean(window.__probeGame()?.file?.suggestion), { timeout: 30000 });
{
  const a = await lire(un);
  const b = await lire(deux);
  dit(a.suggestion?.mode === 'duel' && a.suggestion?.mise === 2_000_000,
    `machine-1 (seule en arène) reçoit la suggestion du 1v1 à 2 USDC`);
  dit(a.suggestion?.demarre === true, 'elle dit que la partie DÉMARRERAIT tout de suite');
  dit(a.notif !== null && /waiting in 1v1/.test(a.notif) && /SWITCH/.test(a.notif),
    `la notification s'affiche : « ${a.notif?.replace(/\s+/g, ' ').slice(0, 90)} »`);
  dit(!b.suggestion && b.notif === null, 'machine-2 (en duel, où l\'on vient) ne reçoit rien');
  await un.page.screenshot({ path: 'shots/bascule-suggestion.png' });
  console.log('     shots/bascule-suggestion.png');
}

// ===========================================================================
titre('5. SWITCH bascule vraiment');
// ===========================================================================
await un.page.click('#notifs .nt-ok');
for (const j of [un, deux]) {
  await j.page.waitForFunction(() => window.__probeGame()?.mode === 'racing', { timeout: 120000 });
}
{
  const a = await lire(un);
  const b = await lire(deux);
  dit(a.mode === 'racing' && b.mode === 'racing', 'les deux pages sont entrées en manche');
  dit(a.modeOn === 'duel', `le ticket de machine-1 a suivi : le mode sélectionné est « ${a.modeOn} »`);
  dit(a.notif === null, 'la notification a disparu');
  const formats = await Promise.all([un, deux].map((j) => j.page.evaluate(() => ({
    format: window.__probeGame().format, effectif: window.__probeGame().enligne?.manche?.joueurs?.length,
  }))));
  dit(formats.every((f) => f.format === 'duel' && f.effectif === 2),
    `la partie est un duel à deux (${formats.map((f) => `${f.format}/${f.effectif}`).join(' · ')})`);
  const memoire = await un.page.evaluate(() => localStorage.getItem('tumble-mode'));
  dit(memoire === 'duel', 'et le choix mémorisé pour la prochaine fois est le 1v1');
}

// ===========================================================================
titre('6. Le départ réduit se lit, et LEAVE QUEUE sort de la file');
// ===========================================================================
/*
 * LA RÈGLE DE DÉPART DE L'ARÈNE, vue de l'écran. Sous DEV avec une mise, le minimum vaut
 * trois (aucun barème ne paie moins). Deux joueurs lisent « Need 3 » ; le troisième
 * déclenche le décompte — « Starting in N s with 3 players » — et un départ remet tout
 * dans l'état d'avant. Le pot, lui, est annoncé EN FOURCHETTE dès le ticket : c'est ce qui
 * remplace l'accord de tous.
 */
{
  const pages = [];
  for (const nom of ['machine-3', 'machine-4', 'machine-5']) {
    const j = await ouvrir(nom, 'arena', 'char-babytrump');
    await j.page.waitForFunction(() => window.__probeGame()?.file?.etat === 'ouvert', { timeout: 20000 });
    pages.push(j);
  }
  const [trois, quatre, cinq] = pages;

  const pot = await trois.page.evaluate(() => ({
    val: document.getElementById('pot-val')?.textContent?.trim(),
    sub: document.getElementById('pot-sub')?.textContent?.trim(),
  }));
  // Depuis le 4 septembre 2026 le ticket ne dit plus le pot : il dit ce que le vainqueur
  // gagne, du pire au meilleur tirage, et la borne basse descend au gain d'une table
  // partie au minimum. L'effectif en fourchette reste la divulgation du départ réduit.
  dit(/^[\d.]+–[\d.]+USDC$/.test(pot.val ?? ''), `le gain du vainqueur de l'arène est annoncé en fourchette : « ${pot.val} »`);
  dit(/^3–16 players · top \d+ paid$/.test(pot.sub ?? ''), `et l'effectif aussi, réduit compris : « ${pot.sub} »`);

  await trois.page.click('#play');
  await quatre.page.click('#play');
  await quatre.page.waitForFunction(() => window.__probeGame()?.file?.salon?.humains === 2, { timeout: 20000 });
  {
    const v = await lire(quatre);
    const note = await quatre.page.evaluate(() => document.getElementById('file-msg')?.textContent);
    const depart = await quatre.page.evaluate(() => document.getElementById('file-depart')?.classList.contains('hidden'));
    dit(/Need 3/.test(note ?? ''), `à deux, l'arène dit ce qu'il manque : « ${note} »`);
    dit(depart === true, 'et n\'annonce aucun départ : on n\'annonce jamais l\'impossible');
    dit(v.pris === 2 && v.sieges === 16, `deux places prises sur seize`);
  }

  await cinq.page.click('#play');
  await quatre.page.waitForFunction(() => Boolean(window.__probeGame()?.file?.salon?.departReduit), { timeout: 20000 });
  {
    const depart = await quatre.page.evaluate(() => document.getElementById('file-depart')?.textContent);
    dit(/Starting in \d+ s with 3 players · 6\.00 USDC pot/.test(depart ?? ''),
      `à trois, le décompte du départ réduit s'affiche : « ${depart} »`);
    await quatre.page.screenshot({ path: 'shots/bascule-depart-reduit.png' });
    console.log('     shots/bascule-depart-reduit.png');
  }

  await trois.page.click('#play');   // LEAVE QUEUE
  await quatre.page.waitForFunction(() => window.__probeGame()?.file?.salon?.humains === 2, { timeout: 20000 });
  {
    const v = await lire(trois);
    dit(v.enFile === false && v.play === 'PLAY' && v.file === false,
      `machine-3 est sortie : le bouton redit « ${v.play} », le bloc de file est rangé`);
    const depart = await quatre.page.evaluate(() => document.getElementById('file-depart')?.classList.contains('hidden'));
    dit(depart === true, 'chez les deux qui restent, le décompte a disparu : on est repassé sous le minimum');
    const vu = await quatre.page.evaluate(() => (window.__probeGame()?.file?.files ?? []).find((f) => f.mode === 'arena')?.joueurs);
    dit(vu === 2, `et la présence redescend à ${vu}`);
  }

  for (const j of pages) { un.erreurs.push(...j.erreurs); await j.page.close(); }
}

const erreurs = [...un.erreurs, ...deux.erreurs];
console.log(erreurs.length ? `\nerreurs : ${[...new Set(erreurs)].join(' | ')}` : '\nerreurs : aucune');

await browser.close();
await serveur.arreter();
console.log(`\n--- ${ko === 0 && !erreurs.length ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`} ---`);
process.exit(ko || erreurs.length ? 1 : 0);
