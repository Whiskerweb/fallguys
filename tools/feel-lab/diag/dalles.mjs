/**
 * Diagnostic du mini-jeu « Les Dalles ».
 *
 * Les questions, dans l'ordre où une réponse fausse invalide les suivantes :
 *
 *  0. Les cotes tiennent-elles ? Vérifié sur les nombres, avant de jouer : un pilote qui
 *     passe ne prouve pas qu'une cote est juste, il peut passer par chance.
 *  1. Le chemin EXISTE-T-IL ? C'est la question qui décide de tout : un damier dont le
 *     chemin sûr n'est pas connexe est un mini-jeu impossible, et rien à l'écran ne le
 *     dirait. On le vérifie en parcours de graphe, pas à l'œil.
 *  2. Le collider colle-t-il au visuel ? Une dalle porte sur exactement 2,40 m, et le jeu
 *     de 16 cm entre deux dalles est un vrai vide. Sur ce mini-jeu, le joueur juge du bord
 *     d'une dalle à dix centimètres près : un collider plus large que le visuel serait un
 *     sol fantôme, plus étroit une chute inexplicable.
 *  3. Une dalle piégée cède-t-elle, et une dalle sûre tient-elle ? C'est la règle du jeu.
 *     Le test de la dalle sûre est le plus important des deux : une règle qui punit au
 *     hasard détruit le mini-jeu, alors qu'une dalle qui refuse de tomber se voit.
 *  4. Le SURSIS dure-t-il ce qui est annoncé, et diminue-t-il vraiment de section en
 *     section ? C'est lui qui rend le pas de sonde possible ; s'il ne change pas, la
 *     difficulté croissante n'est qu'un commentaire.
 *  5. Un trou reste-t-il ouvert après une chute du joueur ? C'est la mémoire du damier,
 *     et donc tout ce qui rend une deuxième tentative moins chère que la première.
 *  6. Le parcours se franchit-il ? Un pilote qui connaît le chemin le suit de bout en
 *     bout. Il ne joue pas au jeu — il prouve que le chemin est PHYSIQUEMENT praticable.
 *  7. Est-ce déterministe ? Même graine, même damier ; autre graine, autre damier.
 *
 * Lancer depuis tools/feel-lab, serveur de dev actif : node diag/dalles.mjs
 */
import { chromium } from 'playwright';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

const verdicts = [];
const dire = (ok, titre, detail) => {
  verdicts.push(ok);
  console.log(`${ok ? '  OK ' : 'ECHEC'} ${titre}${detail ? ' — ' + detail : ''}`);
};

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// Fenêtre MINUSCULE : ce harnais ne regarde jamais une image, il mesure. Le rendu se
// fait en SwiftShader, sans GPU, et son coût est proportionnel au nombre de pixels — la
// course du pilote dure plusieurs minutes, et en 700x460 le rendu a fini par emporter le
// contexte du navigateur en cours de route (« execution context was destroyed »).
const page = await browser.newPage({ viewport: { width: 320, height: 220 } });
page.setDefaultTimeout(600000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)); });

// ?noassets : la scène retombe sur ses formes procédurales. Le décor Meshy ne porte aucun
// collider, il ne peut donc rien changer aux mesures — et le harnais passe alors même
// quand la machine est trop chargée pour charger vingt modèles.
/*
 * SERVEUR CIBLE.
 *
 * Par défaut le serveur de dev. `FEELLAB_PORT=5274 node diag/dalles.mjs` vise un autre
 * port — typiquement `vite preview` sur un build figé. C'est ce qu'il faut faire quand
 * quelqu'un d'autre travaille dans le dépôt : le rechargement à chaud de Vite recharge la
 * page en pleine mesure, l'arène disparaît sous le harnais, et les verdicts qui en
 * sortent accusent la scène de pannes qui n'ont pas eu lieu.
 */
const BASE = `http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}`;
await page.goto(`${BASE}/?lowfx&nointro&noassets&skip=scenery`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 600000 });

/** Lance une manche des Dalles sur une graine imposée, par le vrai chemin de code. */
const lancer = async (graine) => {
  await page.evaluate((g) => {
    const u = new URL(location.href);
    u.searchParams.set('graine', String(g));
    history.replaceState(null, '', u);
  }, graine);
  await page.evaluate(() => {
    const jeu = window.__probeGame();
    const epreuve = window.__MINIGAMES.find((m) => m.id === 'dalles');
    jeu.partie = { parcours: [epreuve], index: 0, temps: [], chutes: 0 };
    jeu.startRace();
  });
  await page.waitForFunction(() => window.__probeGame().arena?.__sections, { timeout: 600000 });
  // On attend la FIN DU DECOMPTE. Pendant celui-ci `runTime` ne court pas, et c'est
  // l'horloge sur laquelle tout le chronometrage de ce harnais s'appuie.
  await page.waitForFunction(() => window.__probeGame().countdown <= 0, { timeout: 600000 });
  await page.waitForTimeout(600);
};

await lancer(4242);

// ── 0 : les cotes ─────────────────────────────────────────────────────────────────────
const cotes = await page.evaluate(() => window.__probeGame().arena.__cotes());
dire(cotes.DALLE > cotes.PERSO_LARGE * 2,
  'une dalle porte largement le corps',
  `${cotes.DALLE} m pour un corps de ${cotes.PERSO_LARGE} m`);
dire(cotes.DIAGONALE < cotes.PORTEE * 0.8,
  'aucun deplacement du damier n\'exige un saut',
  `diagonale ${cotes.DIAGONALE.toFixed(2)} m, portee de saut ${cotes.PORTEE.toFixed(2)} m`);
dire(cotes.JEU > 0.1 && cotes.JEU < cotes.PERSO_LARGE * 0.25,
  'le jeu entre deux dalles se voit sans se franchir par accident',
  `${cotes.JEU} m`);

// ── 1 : le chemin existe-t-il ? ───────────────────────────────────────────────────────
/**
 * Parcours en largeur sur les dalles sûres, en connexité par les ARÊTES.
 *
 * Le point délicat est là : deux dalles qui ne se touchent que par un COIN ne forment pas
 * un chemin. Le joueur devrait y franchir un vide en diagonale, et le rayon de sol du
 * contrôleur — un seul rayon, parti du centre du corps — peut ne rien y trouver. Un test
 * qui accepterait la connexité diagonale déclarerait praticables des damiers qui ne le
 * sont pas.
 */
function cheminer(section) {
  const sur = new Set(section.chemin.map((d) => `${d.r},${d.c}`));
  const depart = section.chemin.filter((d) => d.r === 0);
  const vus = new Map();
  const file = depart.map((d) => `${d.r},${d.c}`);
  for (const k of file) vus.set(k, null);
  while (file.length) {
    const k = file.shift();
    const [r, c] = k.split(',').map(Number);
    if (r === section.rangs - 1) {
      const suite = [];
      for (let x = k; x; x = vus.get(x)) suite.unshift(x);
      return suite.map((s) => {
        const [rr, cc] = s.split(',').map(Number);
        return section.chemin.find((d) => d.r === rr && d.c === cc);
      });
    }
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = `${r + dr},${c + dc}`;
      if (!sur.has(v) || vus.has(v)) continue;
      vus.set(v, k);
      file.push(v);
    }
  }
  return null;
}

const sections = await page.evaluate(() => window.__probeGame().arena.__sections());
const routes = sections.map(cheminer);
dire(routes.every(Boolean), 'chaque section a un chemin sur connexe par les aretes',
  routes.map((r, i) => `s${i}:${r ? r.length + ' dalles' : 'AUCUN'}`).join(' '));

// La dalle sûre du premier rang doit tomber sous les pieds du joueur qui arrive du palier.
// Elle est atteignable en un pas de côté au plus : au-delà, le joueur descend du palier
// dans le vide sans avoir eu la moindre chance de faire autrement.
const entrees = sections.map((s, i) => {
  const rang0 = s.chemin.filter((d) => d.r === 0).map((d) => d.x);
  const xArrivee = i === 0 ? 0
    : (sections[i - 1].chemin.filter((d) => d.r === sections[i - 1].rangs - 1)
        .reduce((a, d) => a + d.x, 0) / sections[i - 1].chemin.filter((d) => d.r === sections[i - 1].rangs - 1).length);
  return Math.min(...rang0.map((x) => Math.abs(x - xArrivee)));
});
dire(entrees.every((e) => e <= cotes.PAS * 1.05),
  'on entre dans chaque section a un pas de cote au plus',
  entrees.map((e, i) => `s${i}:${e.toFixed(2)} m`).join(' '));

/*
 * RAYON TEMOIN, AVANT TOUTE MESURE PAR RAYONS.
 *
 * La plateforme de départ est pleine, toujours, par construction. Si un rayon tiré à son
 * aplomb ne trouve rien, ce n'est pas la scène qui est en cause : c'est la sonde. Une
 * exécution l'a montré — la page avait été rechargée en cours de route, tous les tirs
 * revenaient vides, et le harnais annonçait « 0 dalle sondée », « le jeu n'est pas un
 * vide » et « une dalle du chemin CEDE ». Trois verdicts rouges, aucun défaut. Un
 * instrument qui ne voit pas le sol sous ses pieds n'a pas le droit de condamner quoi que
 * ce soit.
 */
for (let essai = 0; ; essai++) {
  const temoin = await page.evaluate(() => {
    const a = window.__probeGame().arena;
    return a.__ray(0, a.__cotes().SOL + 4, 14, 0, -1, 0, 10);
  });
  if (temoin !== null) break;
  if (essai >= 3) {
    console.log('ECHEC la sonde ne voit pas la plateforme de depart — mesures abandonnees');
    await browser.close();
    process.exit(2);
  }
  await lancer(4242);
}

// ── 2 : le collider colle-t-il au visuel ? ────────────────────────────────────────────
const geom = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  const { DALLE, PAS, SOL } = a.__cotes();
  const H = 4;
  const bas = (x, z) => a.__ray(x, SOL + H, z, 0, -1, 0, H + 6);
  let dessus = 0, ecartMax = 0, bord = 0, vide = 0, videRate = [];
  for (const s of a.__sections()) {
    for (const d of s.chemin) {
      // Le dessus, au centre : il doit être exactement à SOL.
      const t = bas(d.x, d.z);
      if (t !== null) { dessus++; ecartMax = Math.max(ecartMax, Math.abs(H - t)); }
      // Le bord intérieur : à 5 cm du bord, la dalle porte encore.
      for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t2 = bas(d.x + ux * (DALLE / 2 - 0.05), d.z + uz * (DALLE / 2 - 0.05));
        if (t2 !== null && Math.abs(H - t2) < 0.02) bord++;
      }
      /*
       * Le milieu du jeu, 8 cm plus loin que le bord : ce doit être un vrai vide.
       *
       * On ne vise QUE des jeux intérieurs au damier. Une première version tirait aussi
       * vers l'avant du premier rang et vers l'arrière du dernier — c'est-à-dire sur les
       * paliers de pierre, qui sont pleins et le doivent. Elle comptait donc sept sols
       * fantômes qui étaient exactement le sol qu'on veut y trouver. Un test qui accuse
       * la scène de faire ce qu'on lui demande ne mesure rien.
       */
      if (d.c < s.cols - 1) {
        const x = d.x + PAS / 2;
        if (bas(x, d.z) === null) vide++;
        else if (videRate.length < 4) videRate.push(`x=${x.toFixed(2)} z=${d.z.toFixed(2)}`);
      } else vide++;
      if (d.r < s.rangs - 1) {
        const z = d.z - PAS / 2;
        if (bas(d.x, z) === null) vide++;
        else if (videRate.length < 4) videRate.push(`x=${d.x.toFixed(2)} z=${z.toFixed(2)}`);
      } else vide++;
    }
  }
  return { dessus, ecartMax, bord, attenduBord: dessus * 4, vide, attenduVide: dessus * 2, videRate };
});
dire(geom.ecartMax < 0.01, 'le dessus des dalles est exactement a la cote annoncee',
  `${geom.dessus} dalles sondees, ecart max ${(geom.ecartMax * 1000).toFixed(1)} mm`);
dire(geom.bord === geom.attenduBord, 'une dalle porte jusqu\'a 5 cm de son bord',
  `${geom.bord}/${geom.attenduBord} tirs de bord`);
dire(geom.vide === geom.attenduVide, 'le jeu entre deux dalles est un vrai vide',
  `${geom.vide}/${geom.attenduVide} tirs traversants`
  + (geom.videRate.length ? ` · rates en ${geom.videRate.join(' ')}` : ''));

// ── 3 et 4 : la regle, et le sursis ───────────────────────────────────────────────────
/**
 * On pose le personnage sur une dalle et on regarde ce qui arrive, en lisant l'état réel
 * de la scène et le sol réel sous ses pieds.
 *
 * Le témoin — la dalle SÛRE — n'est pas une formalité. C'est le seul test qui distingue
 * « le mini-jeu marche » de « toutes les dalles tombent », et les deux ont exactement la
 * même allure sur une capture.
 */
const regle = await page.evaluate(async () => {
  const jeu = window.__probeGame();
  const a = jeu.arena, c = jeu.character;
  const { SOL } = a.__cotes();
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const porte = (x, z) => a.__ray(x, SOL + 3, z, 0, -1, 0, 9) !== null;

  /**
   * Pose le joueur au centre d'une dalle DÉSIGNÉE et suit son sort.
   *
   * On suit la dalle par son rang et sa colonne, pas « une dalle qui tremble quelque
   * part » : au moment du test, celles des essais précédents sont encore en train de
   * tomber, et une lecture globale attribuerait leur chronologie à celle-ci.
   */
  async function poser(sec, r, col, x, z, duree) {
    c.respawn({ x, y: SOL + 1.1, z });
    /*
     * ON RELEVE DES LA PREMIERE IMAGE.
     *
     * Une première version laissait d'abord une demi-seconde « le temps de se poser ».
     * Sur les sections 2 et 3, dont le sursis vaut 0,30 s et 0,20 s, la dalle était déjà
     * tombée quand le relevé commençait : le tremblement n'était jamais vu, la mesure
     * revenait nulle, et les deux sections les plus dures n'étaient tout simplement pas
     * mesurées. Le joueur est posé à 30 cm du sol, il touche en un sixième de seconde —
     * il n'y a rien à attendre.
     */
    const debut = jeu.runTime;
    let ouvert = false, mesure = null;
    while (jeu.runTime - debut < duree && !ouvert) {
      // Le verdict, c'est le SOL : un état interne qui bascule sans que le trou s'ouvre
      // laisserait le joueur debout sur une dalle officiellement tombée.
      if (!porte(x, z)) ouvert = true;
      const e = a.__etats().find((v) => v.s === sec && v.r === r && v.c === col);
      if (e?.sursisReel != null) mesure = e.sursisReel;
      await attendre(12);
    }
    return { ouvert, sursis: mesure, tombe: c.body.translation().y < SOL - 3 };
  }

  const { PAS } = a.__cotes();
  const out = { pieges: [], sures: [] };
  for (const s of a.__sections()) {
    const sur = new Set(s.chemin.map((d) => `${d.r},${d.c}`));
    // Une dalle piégée au milieu de la section, et la dalle sûre du même rang : même
    // profondeur, même distance, même approche — seule la nature de la dalle change.
    const rang = Math.floor(s.rangs / 2);
    const sure = s.chemin.filter((d) => d.r === rang)[0];
    let col = -1;
    for (let k = 0; k < s.cols; k++) if (!sur.has(`${rang},${k}`)) { col = k; break; }
    const x = (col - (s.cols - 1) / 2) * PAS;
    out.pieges.push({ s: s.indice, col, sursisAnnonce: s.sursis,
      ...(await poser(s.indice, rang, col, x, sure.z, 3)) });
    out.sures.push({ s: s.indice,
      ...(await poser(s.indice, rang, sure.c, sure.x, sure.z, 2)) });
  }
  return out;
});

dire(regle.pieges.every((p) => p.ouvert), 'une dalle piegee cede sous le pied',
  regle.pieges.map((p) => `s${p.s}:${p.ouvert ? 'cede' : 'TIENT'}`).join(' '));
dire(regle.sures.every((p) => !p.ouvert), 'une dalle du chemin ne cede JAMAIS',
  regle.sures.map((p) => `s${p.s}:${p.ouvert ? 'CEDE' : 'tient'}`).join(' '));

/*
 * LE SURSIS SE LIT DANS LA SCENE, IL NE SE CHRONOMETRE PAS.
 *
 * Une première version le mesurait de l'extérieur, en sondant l'état de la dalle entre
 * deux `setTimeout`. Elle rendait 1,01 s, 0,85 s et 0,74 s pour 0,45 s, 0,30 s et 0,20 s
 * annoncés — une demi-seconde de trop, la MEME sur les trois sections. Ce n'était pas la
 * scène : le navigateur headless rend à une dizaine d'images par seconde, et un sondage
 * ne peut pas voir un événement plus finement que la fréquence d'image. Le décalage
 * constant est la signature du défaut, et il aurait fait condamner un réglage correct.
 *
 * La scène relève donc elle-même le temps de jeu écoulé entre le contact et le lâcher.
 * Ce que ce verdict prouve n'est pas la chronologie — elle est acquise par construction —
 * mais que l'accumulateur AVANCE : un `dt` resté nul, une dalle jamais mise à jour, et
 * `sursisReel` s'écarterait aussitôt de sa consigne.
 */
const mesures = regle.pieges.filter((p) => p.sursis !== null);
dire(mesures.length === regle.pieges.length
  && mesures.every((p) => p.sursis >= p.sursisAnnonce
      && p.sursis - p.sursisAnnonce < p.sursisAnnonce * 0.5 + 0.10),
  'le sursis mesure vaut le sursis annonce',
  mesures.map((p) => `s${p.s}:${p.sursis?.toFixed(2)}s/${p.sursisAnnonce}s`).join(' '));
dire(mesures.length === 3 && mesures[0].sursis > mesures[2].sursis * 1.4,
  'le droit a l\'erreur s\'eteint vraiment d\'une section a l\'autre',
  mesures.length === 3
    ? `${mesures[0].sursis.toFixed(2)}s en section 1 contre ${mesures[2].sursis.toFixed(2)}s en section 3`
    : `${mesures.length}/3 sections mesurees seulement`);

// L'affaissement du tremblement ne doit jamais couter le sursis lui-meme : si la dalle
// s'enfonçait de la marge de sol du controleur, le joueur decrocherait avant qu'elle ne
// lache, et le pas de sonde — toute la raison d'etre du sursis — n'existerait pas.
dire(cotes.AFFAISSEMENT < 0.12, 'l\'affaissement du tremblement ne fait pas decrocher',
  `${(cotes.AFFAISSEMENT * 100).toFixed(0)} cm d'enfoncement pendant le sursis`);

// ── 5 : le damier garde la memoire des dalles tombees ─────────────────────────────────
const memoire = await page.evaluate(async () => {
  const jeu = window.__probeGame();
  const a = jeu.arena, c = jeu.character;
  const { SOL } = a.__cotes();
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const avant = a.__etats().filter((e) => e.etat === 'disparue' || e.etat === 'chute').length;
  // On fait tomber le joueur dans le vide : c'est le vrai chemin de la remise en jeu.
  c.respawn({ x: 0, y: SOL - 30, z: -40 });
  await attendre(1400);
  const apres = a.__etats().filter((e) => e.etat === 'disparue' || e.etat === 'chute').length;
  return { avant, apres, replace: c.body.translation().y > SOL - 3 };
});
dire(memoire.apres >= memoire.avant && memoire.avant > 0,
  'les dalles tombees le restent apres une chute du joueur',
  `${memoire.avant} trous avant, ${memoire.apres} apres`);

// ── 6 : le parcours se franchit-il ? ──────────────────────────────────────────────────
/*
 * Le pilote CONNAIT le chemin — il le lit dans la scène. Ce n'est pas de la triche : ce
 * test ne mesure pas la difficulté du mini-jeu, il mesure si le chemin est physiquement
 * praticable. Un pilote qui devrait le deviner mesurerait sa propre chance, et un échec
 * ne dirait pas si c'est le damier ou le devin qui a fauté.
 */
await lancer(4242);
const plan = await page.evaluate(() => window.__probeGame().arena.__sections());
const itineraire = [];
plan.forEach((s, i) => {
  const route = (function bfs() {
    const sur = new Set(s.chemin.map((d) => `${d.r},${d.c}`));
    const vus = new Map();
    const file = s.chemin.filter((d) => d.r === 0).map((d) => `${d.r},${d.c}`);
    for (const k of file) vus.set(k, null);
    while (file.length) {
      const k = file.shift();
      const [r, c] = k.split(',').map(Number);
      if (r === s.rangs - 1) {
        const suite = [];
        for (let x = k; x; x = vus.get(x)) suite.unshift(x);
        return suite.map((t) => {
          const [rr, cc] = t.split(',').map(Number);
          return s.chemin.find((d) => d.r === rr && d.c === cc);
        });
      }
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const v = `${r + dr},${c + dc}`;
        if (!sur.has(v) || vus.has(v)) continue;
        vus.set(v, k);
        file.push(v);
      }
    }
    return [];
  })();
  for (const d of route) itineraire.push({ x: d.x, z: d.z });
  /*
   * ON QUITTE UN DAMIER TOUT DROIT — Y COMPRIS LE DERNIER.
   *
   * Un repère posé au MILIEU de la pierre suivante oblige le pilote à se recentrer en X
   * avant d'avancer, c'est-à-dire à traverser latéralement le DERNIER RANG de dalles,
   * dont tout ce qui n'est pas le chemin cède. On pose donc d'abord un repère droit
   * devant, à l'aplomb de la dernière dalle sûre : le pilote pose le pied sur la pierre,
   * et ne se recentre qu'une fois dessus.
   *
   * La première correction n'avait traité que les paliers INTERMEDIAIRES. Le dernier rang
   * du dernier damier gardait le défaut, et le pilote y restait coincé à sept repères de
   * l'arrivée après avoir parcouru cent vingt mètres sans faute. Un cas particulier oublié
   * ressemble exactement à une carte infranchissable.
   */
  const derniere = route[route.length - 1];
  itineraire.push({ x: derniere.x, z: s.zArriere - 2.0 });
  // Puis le milieu de la pierre. Pour la dernière section, on vise DERRIERE la ligne
  // d'arrivée : un coureur ne s'arrête pas dessus.
  itineraire.push({ x: 0, z: s.zArriere - (i < plan.length - 1 ? 6.0 : 11.0) });
});

/*
 * LE PILOTE S'INSTALLE, PUIS ON L'OBSERVE DE LOIN.
 *
 * Une première version tenait toute la course dans un seul `page.evaluate` de plusieurs
 * minutes. Deux exécutions de suite y ont perdu le contexte du navigateur — le rendu
 * logiciel ne tient pas trois minutes sous charge — et l'exception emportait au passage
 * les seize mesures déjà faites. On pose donc la boucle sur `window.__pilote` et on la
 * SONDE toutes les deux secondes : on garde la trace de ce qui a été fait, on peut
 * s'arrêter dès que le pilote n'avance plus, et une page qui meurt ne coûte que ce
 * verdict-là.
 */
await page.evaluate((points) => {
  const jeu = window.__probeGame();
  const c = jeu.character;
  const enfonce = new Set();
  const tenir = (code, veut) => {
    if (veut === enfonce.has(code)) return;
    veut ? enfonce.add(code) : enfonce.delete(code);
    dispatchEvent(new KeyboardEvent(veut ? 'keydown' : 'keyup', { code, bubbles: true }));
  };
  const etat = { i: 0, fini: false, chutes: 0, enChute: false, plusLoin: 99,
    points: points.length, mode: 'racing' };
  window.__pilote = etat;

  const tick = () => {
    if (etat.fini) return;
    if (jeu.mode !== 'racing' || !jeu.arena) {
      // Une arène absente en pleine manche n'est pas une fin de course : c'est la page
      // qui a été rechargée sous le pilote. On le dit, plutôt que de laisser le verdict
      // conclure que le parcours ne se franchit pas.
      etat.fini = true;
      etat.mode = !jeu.arena && jeu.mode === 'racing' ? 'arene disparue' : jeu.mode;
      for (const code of [...enfonce]) tenir(code, false);
      return;
    }
    requestAnimationFrame(tick);
    const p = c.body.translation();
    if (!Number.isFinite(p.x)) return;
    etat.plusLoin = Math.min(etat.plusLoin, p.z);
    if (p.y < -6 && !etat.enChute) { etat.enChute = true; etat.chutes++; }
    else if (p.y > -1 && etat.enChute) {
      /*
       * LE PILOTE SE REACCROCHE A L'ITINERAIRE.
       *
       * Une chute renvoie le joueur au point de reprise, des dizaines de mètres en
       * arrière. Une première version gardait son numéro de repère : le pilote visait
       * alors un point situé loin devant, traversait le damier en ligne droite et
       * retombait — indéfiniment. Il a chuté 145 fois sans jamais dépasser la deuxième
       * section, et le verdict accusait le damier de ce qui était une panne de pilote.
       * On repart donc du premier repère encore DEVANT la position de reprise.
       */
      etat.enChute = false;
      let k = 0;
      while (k < points.length - 1 && points[k].z > p.z - 0.5) k++;
      etat.i = k;
    }

    const w = points[Math.min(etat.i, points.length - 1)];
    const dx = w.x - p.x, dz = w.z - p.z;
    if (Math.abs(dx) < 1.0 && Math.abs(dz) < 1.0) { etat.i++; return; }

    /*
     * LE PILOTE FREINE PAR ANTICIPATION.
     *
     * Une première version tenait la touche jusqu'à la tolérance d'arrivée. Le navigateur
     * headless rend à une dizaine d'images par seconde : à 7,6 m/s, le pilote parcourt
     * 76 cm entre deux corrections, sur une grille au pas de 2,56 m. Il dépassait donc
     * d'une dalle à chaque repère — c'est-à-dire qu'il posait le pied hors du chemin, et
     * il est tombé 79 fois sur un itinéraire pourtant connu. Le damier n'y était pour
     * rien ; c'est le pilote qui ne savait pas s'arrêter.
     */
    const v = c.body.linvel();
    const frein = (u) => (u * u) / (2 * 46);      // TUNING.groundFriction

    const besoinX = Math.abs(dx) > 0.30 + frein(Math.abs(v.x));
    tenir('ArrowLeft', besoinX && dx < 0);
    tenir('ArrowRight', besoinX && dx > 0);

    /*
     * ON NE COURT PAS EN DIAGONALE.
     *
     * Le pilote s'aligne D'ABORD en X, puis avance. Une trajectoire diagonale coupe les
     * coins, et couper un coin sur ce damier veut dire poser le pied sur une dalle qui
     * n'est pas du chemin. Un joueur humain fait exactement pareil, en escalier : c'est
     * la seule façon de marcher là-dessus.
     */
    const aligne = Math.abs(dx) < 0.9;
    const avance = -dz;                            // > 0 : le repère est devant
    const marge = 0.30 + frein(Math.abs(v.z));
    tenir('ArrowUp', aligne && avance > marge);
    tenir('ArrowDown', aligne && avance < -marge - 1.0);
  };
  requestAnimationFrame(tick);
}, itineraire);

let course = { i: 0, points: itineraire.length, plusLoin: 99, chutes: 0,
  mode: 'perdu', duree: 0 };
const debutCourse = Date.now();
let dernierProgres = Date.now(), meilleur = -1;
while (Date.now() - debutCourse < 200000) {
  await page.waitForTimeout(2000);
  let vu;
  try {
    vu = await page.evaluate(() => window.__pilote && { ...window.__pilote });
  } catch (e) {
    // La page a rendu l'âme. On garde le dernier relevé plutôt que de tout perdre.
    course.mode = 'contexte perdu : ' + String(e).slice(0, 50);
    break;
  }
  if (!vu) continue;
  course = { ...vu, duree: (Date.now() - debutCourse) / 1000 };
  if (vu.i > meilleur) { meilleur = vu.i; dernierProgres = Date.now(); }
  if (vu.fini) break;
  // Quarante secondes sans franchir un seul repère : le pilote est coincé. Insister
  // n'apprend plus rien et c'est exactement ce qui finissait par tuer la page.
  if (Date.now() - dernierProgres > 40000) { course.mode = 'bloque'; break; }
}

dire(course.mode === 'finished' || course.mode === 'lobby',
  'le parcours se franchit de bout en bout',
  `${course.i}/${course.points} reperes, z max ${course.plusLoin.toFixed(0)}, `
  + `${course.chutes} chute(s), ${course.duree.toFixed(0)} s, fin: ${course.mode}`);
dire(course.chutes <= 1, 'suivre le chemin ne fait pas tomber',
  `${course.chutes} chute(s) sur un itineraire connu`);

// ── 7 : determinisme ──────────────────────────────────────────────────────────────────
const signature = (secs) => secs.map((s) => s.chemin.map((d) => `${d.r}.${d.c}`).join('-')).join('|');
await lancer(4242);
const a1 = signature(await page.evaluate(() => window.__probeGame().arena.__sections()));
await lancer(4242);
const a2 = signature(await page.evaluate(() => window.__probeGame().arena.__sections()));
await lancer(777);
const b1 = signature(await page.evaluate(() => window.__probeGame().arena.__sections()));
dire(a1 === a2, 'meme graine, meme damier', `${a1.length} caracteres de signature`);
dire(a1 !== b1, 'graine differente, damier different');

// ── Bilan ─────────────────────────────────────────────────────────────────────────────
console.log(erreurs.length ? `\nerreurs page : ${[...new Set(erreurs)].join(' | ')}` : '\nerreurs page : aucune');
const ok = verdicts.filter(Boolean).length;
console.log(`\n${ok}/${verdicts.length} verdicts au vert`);
await browser.close();
process.exit(ok === verdicts.length ? 0 : 1);
