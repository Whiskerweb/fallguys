/**
 * QUAND QUELQU'UN FRANCHIT VRAIMENT LA LIGNE — vu par le SERVEUR, puis par deux navigateurs.
 *
 * Rapporté en jouant, à deux, sur Le Rondin : « je me suis qualifié et ça m'a ramené au
 * lobby sans rien, sans roue ; l'autre est encore en partie comme si de rien n'était ».
 *
 * `diag/duel.mjs` § 10 ne couvre PAS ce cas. Il fait finir la partie au CHRONO (manche de
 * douze secondes) avec un corps téléporté côté client : le serveur n'y détecte jamais un
 * franchissement, n'émet jamais `sorti · qualifie`, et le vainqueur y est repêché. Or le
 * chemin que le joueur emprunte en jouant est l'autre : le serveur voit `p.z <= finishZ`,
 * fige le corps, annonce `sorti`, puis ferme la manche au tick suivant.
 *
 * Ici on téléporte donc le corps SERVEUR de machine-1 au-delà de la ligne, sur une manche
 * longue, et on regarde ce que les deux pages en font. Ce n'est pas une porte dérobée :
 * c'est exactement l'état que produit une traversée réelle, sans les 286 s qu'elle coûte
 * à un bot.
 *
 * ─── TROIS SCÉNARIOS, ET LE BUG EST DANS LES DEUX DERNIERS ──────────────────
 *
 *   A. Un duel, en mode DUEL. Le barème existe : ×1,8 au vainqueur. Les deux pages
 *      montrent l'écran de fin, personne ne repart au lobby tout seul.
 *
 *   B. Un salon de DEUX en mode ARENA, avec une mise. C'est ce que produisait la politique
 *      par défaut du serveur — `npm start` sans `POLITIQUE=` donne DUEL_TEST, dont le
 *      `cible: 2` à la racine s'applique à TOUS les modes — dès que le ticket du lobby
 *      était resté sur ARENA à 2 USDC, c'est-à-dire SA VALEUR PAR DÉFAUT. Le client
 *      réglait alors « une arène partie à deux », un salon réduit sous le minimum de
 *      trois : `tableEffectif` jetait. Le serveur refuse désormais cette mise à
 *      l'inscription (`MISE_IMPAYABLE`), et le lobby dit pourquoi.
 *
 *   C. Le règlement JETTE quand même — panne injectée sur `reglerPartie`, parce que c'est
 *      la classe entière de pannes qu'on veut couvrir, pas la seule qu'on a vue. Ce jet
 *      tombait dans le gestionnaire `fin-partie` de `brancher.js`, APRÈS
 *      `jeu.enligne = null` et AVANT `ecranDeFin` — entre les deux gardes de `main.js`.
 *      À l'image suivante, la boucle retombait dans ses règles hors ligne : le vainqueur,
 *      posé au-delà de la ligne, voyait « QUALIFIED! » puis le lobby ; le perdant, au
 *      milieu du parcours, continuait de jouer seul. Les deux symptômes rapportés, d'une
 *      seule cause. L'écran doit monter quand même, gain « — », la raison dite au joueur.
 *
 *   cd tools/feel-lab && npm run build && node diag/franchir-rondin.mjs
 */
import { chromium } from 'playwright';
import { dossierDeBanc } from '../src/boutique.js';
import { demarrerServeur } from '../../../serveur/src/serveur.js';
import { preparer } from '../../../serveur/src/monde.js';

let ko = 0, total = 0;
const dit = (ok, t) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${t}`); };
const titre = (t) => console.log(`\n── ${t}`);

await preparer();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const DUEL_TEST = { nom: 'DUEL_TEST', cible: 2, minimum: 2, attente: 1, proposerApres: 1, bots: 'jamais', dureeManche: 300 };

async function ouvrir(base, nom, modele, mode) {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.setDefaultTimeout(300000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`${nom}: ${String(e).slice(0, 200)}`));
  // BabyTrump est en BOUTIQUE depuis le 2 septembre 2026 : sans ce dossier de possession,
  // le catalogue refuse de l'equiper et la machine repart avec le personnage suivant, sans
  // un mot. La forme du dossier vient de `src/boutique.js`, jamais recopiee ici.
  await page.addInitScript(({ id, mode, boutique }) => {
    localStorage.setItem('tumble-model', id);
    localStorage.setItem('tumble-mode', mode);
    localStorage.setItem('tumble-mise', '2');
    localStorage.setItem(boutique.cle, boutique.valeur);
  }, { id: modele, mode, boutique: dossierDeBanc() });
  // Le nom se pose AVANT le chargement, comme le personnage : c'est `bonjour` qui le porte.
  await page.addInitScript((n) => localStorage.setItem('tumble-pseudo', n), nom);
  await page.goto(`${base}/?lowfx&nointro&noassets`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && getComputedStyle(l).display === 'none';
  }, { timeout: 300000 });
  // Plus de panneau ONLINE : la page se connecte toute seule au serveur qui l'a servie, et
  // le nom est parti avec `bonjour` (posé avant le chargement). On attend la liaison, puis
  // PLAY entre en file — c'est exactement le geste du joueur.
  await page.waitForFunction(() => window.__probeGame()?.file?.etat === 'ouvert', { timeout: 20000 });
  await page.click('#play');
  return { nom, page, erreurs };
}

/** Ce qu'une page montre — les champs qui DISTINGUENT les chemins, pas ceux qui décrivent. */
const etatDe = (j) => j.page.evaluate(() => {
  const g = window.__probeGame();
  const vis = (id) => { const e = document.getElementById(id); return e ? !e.classList.contains('hidden') : null; };
  return {
    mode: g?.mode,
    enligne: Boolean(g?.enligne),
    fin: Boolean(g?._fin),
    panneau: document.getElementById('fin-panneau')?.classList.contains('show') ?? null,
    titre: document.getElementById('fin-titre')?.textContent?.trim(),
    sous: document.getElementById('fin-sous')?.textContent?.trim(),
    gain: document.getElementById('fin-gain')?.textContent?.trim(),
    verdict: vis('verdict') ? document.getElementById('verdict-texte')?.textContent?.trim() : null,
    lobby: vis('lobby-ui'),
    message: document.getElementById('play-note')?.textContent?.trim(),
    journal: window.__journal ?? [],
  };
});

/**
 * Joue un scénario complet : deux pages, une traversée détectée par le serveur, et ce que
 * chaque page en montre six secondes plus tard.
 */
async function scenario({ graine, mode, panne = false }) {
  const s = await demarrerServeur({ port: 0, politique: DUEL_TEST, graine });
  const base = `http://127.0.0.1:${s.port}`;
  const un = await ouvrir(base, 'machine-1', 'char-babytrump', mode);
  const deux = await ouvrir(base, 'machine-2', 'char-techtitan', mode);
  for (const j of [un, deux]) {
    await j.page.waitForFunction(() => window.__probeGame()?.mode === 'racing', { timeout: 120000 });
    /*
     * PANNE INJECTÉE : le règlement jette. Ce n'est pas une panne inventée — c'est celle
     * qu'un barème introuvable a produite en jouant —, mais on la pose à la main pour
     * couvrir la CLASSE : n'importe quelle exception à cet endroit doit laisser l'écran
     * de fin monter. Le harnais qui ne l'exercerait que par le cas connu ne prouverait
     * que le cas connu.
     */
    if (panne) {
      await j.page.evaluate(() => {
        window.__probeGame().reglerPartie = () => { throw new Error('panne injectée : pas de barème'); };
      });
    }
    // On note tout ce que le serveur dit à cette page, dans l'ordre : c'est la seule chose
    // qui distingue « le message n'est jamais parti » de « il est parti et le client l'a ignoré ».
    await j.page.evaluate(() => {
      window.__journal = [];
      const s = window.__probeGame().enligne;
      for (const t of ['sorti', 'fin-manche', 'fin-partie', 'manche']) {
        s.sur(t, (m) => window.__journal.push(`${t}${m.nom ? ':' + m.nom + '=' + m.etat : ''}`));
      }
    });
  }
  const epreuve = await un.page.evaluate(() => window.__probeGame().jeuId);
  const format = await un.page.evaluate(() => window.__probeGame().format);
  console.log(`     épreuve « ${epreuve} » · format client « ${format} »`);

  // Le départ a été donné des deux côtés : on est en course, pas dans le décompte.
  for (const j of [un, deux]) {
    await j.page.waitForFunction(() => { const g = window.__probeGame(); return g.countdown <= 0 && g.runTime > 0.5; }, { timeout: 120000 });
  }

  const inst = s.matchmaking.instanceDe('machine-1');
  const manche = inst?.partie?.manche;
  dit(Boolean(manche), 'la manche tourne côté serveur');
  const monde = manche.monde;
  /** Le corps physique d'un coureur : le seul corps DYNAMIQUE posé à sa position. */
  const corpsDe = (nom) => {
    const c = manche.etatCoureurs().find((x) => x.nom === nom);
    let corps = null;
    monde.arene.world.bodies.forEach((b) => {
      if (!b.isDynamic()) return;
      const p = b.translation();
      if (Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) < 1e-3) corps = b;
    });
    return corps;
  };
  if (monde.survie) {
    // En survie, on gagne parce que l'autre tombe : machine-2 passe sous le seuil.
    const corps = corpsDe('machine-2');
    dit(Boolean(corps), 'le corps serveur de machine-2 est retrouvé (survie : on le fait tomber)');
    corps.setTranslation({ x: 0, y: monde.killY - 1, z: 0 }, true);
  } else {
    const corps = corpsDe('machine-1');
    dit(Boolean(corps), `le corps serveur de machine-1 est retrouvé (ligne à z=${monde.finishZ.toFixed(2)})`);
    corps.setTranslation({ x: 0, y: monde.spawn.y, z: monde.finishZ - 1 }, true);
  }

  // La manche doit se fermer d'elle-même : un tick pour marquer, un tick pour clore.
  const debut = Date.now();
  while (!inst.partie.finie && Date.now() - debut < 5000) await new Promise((r) => setTimeout(r, 50));
  dit(inst.partie.finie, `la partie est close côté serveur (${Date.now() - debut} ms après la traversée)`);
  const res = inst.partie.resultat;
  console.log(`     classement serveur : ${res?.classement.map((c) => `${c.rang}. ${c.nom}`).join(' | ')}`);
  dit(res?.classement[0]?.nom === 'machine-1', 'machine-1 est classé premier');

  // On attend un ÉTAT, pas une durée : l'écran de fin, ou le retour au lobby — l'un des deux.
  for (const j of [un, deux]) {
    await j.page.waitForFunction(() => {
      const g = window.__probeGame();
      return document.getElementById('fin-panneau')?.classList.contains('show') || g.mode === 'lobby';
    }, { timeout: 60000 }).catch(() => {});
  }
  // Puis on laisse le temps aux règles hors ligne de se tromper, si elles doivent le faire.
  await un.page.waitForTimeout(6000);

  const [gagnant, perdant] = await Promise.all([etatDe(un), etatDe(deux)]);
  for (const [nom, e] of [['machine-1', gagnant], ['machine-2', perdant]]) {
    console.log(`     ${nom} : mode=${e.mode} enligne=${e.enligne} fin=${e.fin} panneau=${e.panneau} lobby=${e.lobby}`);
    console.log(`       titre « ${e.titre} » · sous « ${e.sous} » · gain « ${e.gain} » · verdict « ${e.verdict} »`);
    console.log(`       reçu : ${e.journal.join(' → ') || '(rien)'}`);
  }

  dit(gagnant.journal.includes('fin-partie'), 'le VAINQUEUR a reçu fin-partie');
  dit(gagnant.panneau === true, 'le VAINQUEUR a son écran de fin');
  dit(gagnant.lobby === false && gagnant.mode !== 'lobby', 'et il n\'a PAS été renvoyé au lobby');
  dit(/^1st of 2/.test(gagnant.sous ?? ''), `son rang vient du serveur : « ${gagnant.sous} » (« 1st of 2 » attendu)`);
  dit(gagnant.titre === 'MATCH WON', `il a gagné : « ${gagnant.titre} »`);
  dit(gagnant.verdict !== 'QUALIFIED!', `le verdict de manche n'écrase pas celui de la partie (« ${gagnant.verdict} »)`);

  dit(perdant.journal.includes('fin-partie'), 'le PERDANT a reçu fin-partie');
  dit(perdant.panneau === true, 'le PERDANT a son écran de fin');
  dit(perdant.enligne === false, 'sa session est détachée : il n\'est plus en partie');
  dit(perdant.fin === true, 'et la boucle sait que la partie est finie : il ne joue plus seul');
  dit(/^2nd of 2/.test(perdant.sous ?? ''), `son rang lui est annoncé : « ${perdant.sous} »`);

  const erreurs = [...un.erreurs, ...deux.erreurs];
  console.log(erreurs.length ? `     erreurs de page : ${[...new Set(erreurs)].join(' | ')}` : '     erreurs de page : aucune');
  await un.page.close(); await deux.page.close();
  await s.arreter();
  return { gagnant, perdant, erreurs };
}

// ===========================================================================
titre('A. Un duel en mode DUEL, sur Le Rondin : le barème existe');
// ===========================================================================
const a = await scenario({ graine: 2, mode: 'duel' });   // graine 2 tire « rondin » pour un duel
dit(a.erreurs.length === 0, 'aucune erreur de page');

// ===========================================================================
titre('B. Un salon de DEUX en mode ARENA, avec une mise : le serveur REFUSE');
// ===========================================================================
/*
 * C'est la configuration d'un `npm start` sans `POLITIQUE=PRODUCTION`, ticket resté sur
 * ARENA à 2 USDC — la valeur par défaut. Aucun barème ne paie une arène de deux ; plutôt
 * que de jouer une partie qu'on ne saura pas régler, le serveur refuse la mise à
 * l'inscription, et le lobby explique quoi faire.
 */
{
  const s = await demarrerServeur({ port: 0, politique: DUEL_TEST, graine: 2 });
  const base = `http://127.0.0.1:${s.port}`;
  const seul = await ouvrir(base, 'machine-1', 'char-babytrump', 'arena');
  await seul.page.waitForFunction(
    () => /cannot take a stake|Refused/.test(document.getElementById('play-note')?.textContent ?? ''),
    { timeout: 30000 },
  ).catch(() => {});
  const msg = await seul.page.evaluate(() => document.getElementById('play-note')?.textContent?.trim());
  const etat = s.matchmaking.etat();
  console.log(`     lobby : « ${msg} »`);
  dit(/cannot take a stake/.test(msg ?? ''), 'le lobby dit que ce serveur ne prend pas de mise dans ce mode');
  dit(etat.salons.every((f) => f.joueurs === 0), 'et personne n\'attend dans une file impayable');
  dit(seul.erreurs.length === 0, 'sans erreur de page');
  await seul.page.close();
  await s.arreter();
}

// ===========================================================================
titre('C. Le règlement JETTE quand même : l\'écran de fin monte, et il dit pourquoi');
// ===========================================================================
const c = await scenario({ graine: 2, mode: 'duel', panne: true });
dit(c.gagnant.gain === '—', `sans barème calculable, le gain affiché est « — » (${c.gagnant.gain})`);
dit(/payout could not be computed/.test(c.gagnant.sous ?? ''), `et le sous-titre le dit : « ${c.gagnant.sous} »`);
// Le message du lobby est écrit par une autre main (`matchmaking.js` client, en cours de
// réécriture) et peut être recouvert par le ticket : on le montre, on ne le juge pas.
console.log(`     lobby : « ${c.gagnant.message} »`);
dit(c.erreurs.length === 0, 'l\'erreur de règlement est ATTRAPÉE et journalisée, pas laissée remonter');

await browser.close();
console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`} ---`);
process.exit(ko ? 1 : 0);
