/**
 * LE RONDIN — vue d'ensemble et verdicts de la nouvelle echine.
 *
 * Remplace les mesures de `rondin.mjs`, qui portaient sur le cylindre etroit et tournant
 * de la version precedente. La geometrie a change de nature : un arc large et quasi
 * immobile ne se juge pas sur les memes grandeurs.
 *
 * Les cameras ne sont PAS ecrites en dur : elles sont derivees de `__sections()`. Un
 * apercu code en dur cesse d'apercevoir des que le plan de decoupe bouge, et personne ne
 * s'en apercoit puisqu'il continue a produire des images.
 *
 * Usage : node diag/echine.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

let browser;
const fermer = () => { try { browser?.close(); } catch {} };
process.on('exit', fermer);
process.on('SIGINT', () => { fermer(); process.exit(130); });

const PORT = process.env.FEELLAB_PORT ?? '5273';
const OUT = 'shots/echine';
await fs.mkdir(OUT, { recursive: true });

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.setDefaultTimeout(120000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)); });

await page.goto(`http://127.0.0.1:${PORT}/?lowfx&nointro&graine=12345`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 240000 });

await page.evaluate(() => {
  const g = window.__probeGame();
  const jeu = window.__MINIGAMES.find((m) => m.id === 'rondin');
  g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
  g.startRace();
});
await page.waitForFunction(() => (window.__probeGame?.()?.runTime ?? 0) > 0.3, { timeout: 120000 });

// ── Mesures ────────────────────────────────────────────────────────────────────────
const mesures = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  const cotes = a.__cotes();
  const sections = a.__sections();
  const echines = a.__echines();

  /**
   * Le collider colle-t-il au visuel ?
   *
   * On tire vers le bas depuis au-dessus de la crete, en balayant la largeur de l'echine,
   * et on compare l'impact a la hauteur THEORIQUE de la paroi cylindrique. C'est la
   * garantie centrale du projet : une hitbox qui ne suit pas le dessin est disqualifiante.
   *
   * On ne tire JAMAIS depuis l'interieur d'une forme : `castRay` en mode solide renvoie
   * une distance nulle quand l'origine est deja dans un solide, et le harnais conclurait a
   * un obstacle permanent.
   */
  let pire = 0, tirs = 0, manques = 0, surObstacle = 0;
  const R = cotes.R, CY = cotes.CY;
  /** Le tir tombe-t-il sur un trou declare ? Compare en angle LOCAL, comme les trous. */
  const ecart = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const dansUnTrou = (e, z, thLocal) => e.trous.some((t) =>
    Math.abs(z - (e.z0 + e.z1) / 2 - t.z) < t.long / 2 + 0.6
    && (ecart(thLocal, t.angle) < t.arc / 2 + 0.05
      || ecart(thLocal, t.angle + Math.PI) < t.arc / 2 + 0.05));

  for (const e of echines) {
    for (let f = 0.12; f <= 0.88; f += 0.04) {
      const z = e.z0 - (e.z0 - e.z1) * f;
      for (let d = -cotes.DEMI_CRETE; d <= cotes.DEMI_CRETE; d += 0.6) {
        // Deux angles, et le sens de la conversion compte.
        //
        // La CRETE EST TOUJOURS EN HAUT : un cylindre qui tourne autour de son axe ne
        // change pas de silhouette, donc la paroi se trouve a l'angle monde pi/2 quelle que
        // soit sa rotation. C'est le repere LOCAL, ou sont declares les trous, qui tourne
        // sous elle. Une premiere version de ce test ajoutait la rotation a la position du
        // tir : passe une demi-rotation, il sondait SOUS le tronc et rapportait deux metres
        // d'ecart. Le defaut etait dans la mesure, pas dans la scene.
        const thMonde = Math.PI / 2 + d / R;
        const thLocal = thMonde - e.angle;
        if (dansUnTrou(e, z, thLocal)) continue;   // pas de sol attendu, donc rien a mesurer
        const x = R * Math.cos(thMonde);
        const yParoi = CY + R * Math.sin(thMonde);
        const depart = yParoi + 4.2;
        const t = a.__ray(x, depart, z, 0, -1, 0, 14);
        tirs++;
        if (t === null) { manques++; continue; }
        const ecart = (depart - t) - yParoi;
        // Un impact AU-DESSUS de la paroi est une arete ou un baril pose dessus : c'est
        // legitime, et ce n'est pas ce qu'on mesure. L'invariant est que le collider ne
        // soit jamais SOUS le visuel — sinon le joueur traverse ce qu'il voit.
        if (ecart > 0.05) { surObstacle++; continue; }
        if (-ecart > pire) pire = -ecart;
      }
    }
  }

  /**
   * Les barils sont-ils une fonction PURE du temps ?
   *
   * On lit leur position a un instant donne, on fait avancer la scene ailleurs, puis on
   * revient au meme instant. Si la position differe, c'est qu'un etat s'est accumule — et
   * la spec interdit exactement cela.
   */
  a.update(7.0, 0.016, null, null);
  const avant = a.__barils().map((b) => `${b.actif}|${b.z.toFixed(4)}|${b.x.toFixed(4)}`);
  a.update(21.3, 0.016, null, null);
  a.update(3.1, 0.016, null, null);
  a.update(7.0, 0.016, null, null);
  const apres = a.__barils().map((b) => `${b.actif}|${b.z.toFixed(4)}|${b.x.toFixed(4)}`);
  const barilsPurs = avant.length > 0 && avant.every((v, i) => v === apres[i]);

  /**
   * REGRESSION DU BUG D'EXPULSION.
   *
   * Le joueur qui touchait un baril partait a l'autre bout de la carte. On reproduit le cas
   * le plus dur : on POSE le personnage exactement sur la trajectoire d'un baril, a
   * l'instant ou celui-ci arrive, et on regarde sa vitesse pendant une seconde. Elle doit
   * rester sous le plafond du garde-fou.
   */
  let pireVitesse = 0;
  const perso = window.__probeGame().character;
  if (perso) {
    const b = a.__barils()[0];
    if (b) {
      // On se cale une demi-seconde avant son passage, pile dans sa voie.
      a.update(b.phase + b.periode + 2.0, 0.016, null, null);
      const cible = a.__barils()[0];
      perso.respawn({ x: cible.x, y: cotes.CRETE + 1.2, z: cible.z - 3 });
      for (let k = 0; k < 60; k++) {
        a.update(b.phase + b.periode + 2.0 + k / 60, 1 / 60, null, null);
        a.world.step();
        perso.limiterVitesse();
        const v = perso.body.linvel();
        pireVitesse = Math.max(pireVitesse, Math.hypot(v.x, v.y, v.z));
      }
    }
  }

  // Continuite : un rayon par metre le long de l'axe, du depart a l'arrivee. Les trous
  // DECLARES sont exclus — ce sont des obstacles voulus, pas des defauts de raccord. Ce
  // que le test cherche est le vide dont personne n'a decide.
  const trous = [];
  const zDepart = a.spawn.z, zFin = a.finishZ;
  // Angles RELUS ici. Les mesures precedentes font avancer la scene de plusieurs dizaines
  // de secondes ; se servir des angles captures au debut revenait a chercher les trous la
  // ou ils n'etaient plus, et a compter comme defaut chaque ouverture legitime.
  const maintenant = a.__echines();
  for (let z = zDepart; z >= zFin; z -= 1) {
    const voulu = maintenant.some((e) =>
      z <= e.z0 && z >= e.z1 && dansUnTrou(e, z, Math.PI / 2 - e.angle));   // crete -> local
    if (voulu) continue;
    const t = a.__ray(0, cotes.CRETE + 4, z, 0, -1, 0, 18);
    if (t === null) trous.push(+z.toFixed(1));
  }

  /**
   * LES OBSTACLES COUVRENT-ILS TOUTE LA CIRCONFERENCE ?
   *
   * C'est le verdict qui manquait, et son absence a laisse passer le pire defaut de la
   * scene : les aretes etaient posees autour de la crete dans le repere LOCAL du troncon,
   * donc elles tournaient avec lui, et passe un quart de tour il ne restait plus rien au
   * sommet. Le mini-jeu se vidait de lui-meme au bout de quelques secondes.
   *
   * Deux exigences, et il faut les deux :
   *   — au moins un ANNEAU complet par troncon, qui presente toujours une portion au
   *     sommet quelle que soit la rotation ;
   *   — des ARCS repartis, sans secteur vide trop large.
   */
  const couverture = a.__aretes().map((liste) => {
    const anneaux = liste.filter((x) => x.ouverture > Math.PI * 2 - 0.01).length;
    const arcs = liste.filter((x) => x.ouverture <= Math.PI * 2 - 0.01)
      .map((x) => ((x.thCentre % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
      .sort((p, q) => p - q);
    let trouMax = 0;
    for (let i = 0; i < arcs.length; i++) {
      const suivant = i === arcs.length - 1 ? arcs[0] + Math.PI * 2 : arcs[i + 1];
      trouMax = Math.max(trouMax, suivant - arcs[i]);
    }
    return { anneaux, arcs: arcs.length, trouMax: +trouMax.toFixed(2) };
  });

  /**
   * LES JONCTIONS. Le tablier du pont s'enfoncait dans le tronc parce que les sections se
   * chevauchaient de deux metres. On verifie ici que le sol d'une jonction est bien a la
   * hauteur de la crete — donc qu'on y marche, au lieu d'y trouver un flanc de cylindre.
   */
  const jonctions = a.__jonctions().map((zj) => {
    const t = a.__ray(0, cotes.CRETE + 4, zj, 0, -1, 0, 18);
    return { z: +zj.toFixed(1), h: t === null ? null : +(cotes.CRETE + 4 - t).toFixed(3) };
  });

  return {
    cotes, sections, couverture, jonctions,
    echines: echines.map((e) => ({ z0: e.z0, z1: e.z1, omega: e.omega, trous: e.trous.length })),
    colliderPireEcartCm: +(pire * 100).toFixed(2),
    colliderTirs: tirs, colliderManques: manques, colliderSurObstacle: surObstacle,
    barils: a.__barils().length, barilsPurs, pireVitesse: +pireVitesse.toFixed(1),
    continuiteTrous: trous,
    longueur: +(zDepart - zFin).toFixed(1),
  };
});

// ── Captures ───────────────────────────────────────────────────────────────────────
const vues = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  const c = a.__cotes();
  const s = a.__sections();
  const v = [];
  // Une vue a hauteur de course par section, cadree sur son premier tiers.
  s.forEach((sec, i) => {
    const z = sec.z0 - (sec.z0 - sec.z1) * 0.32;
    v.push([`jeu-${i}-${sec.type}`, [0, c.CRETE + 6, z + 20], [0, c.CRETE + 1, z - 12]]);
  });
  // Zooms de dessus sur les RACCORDS : c'est la que le sol peut manquer.
  s.forEach((sec, i) => {
    if (i === 0) return;
    v.push([`raccord-${i}-${s[i - 1].type}-${sec.type}`, [0, c.CRETE + 40, sec.z0], [0, c.CRETE, sec.z0]]);
  });
  const zMid = (a.spawn.z + a.finishZ) / 2;
  v.push(['dessus', [0, 190, zMid], [0, 0, zMid]]);
  // Vue de FLANC, basse : la seule qui montre que la levre de la coque est sous l'eau.
  // Camera POSEE DANS LE CHENAL, pas dans la berge : a x = 95 elle etait a l'interieur de
  // la masse de terre et ne filmait que du vert.
  v.push(['flanc', [30, c.CRETE + 3, zMid], [0, c.EAU_Y + 3, zMid]]);
  return v;
});

await page.evaluate(() => {
  document.querySelectorAll('body > div').forEach((e) => { e.style.visibility = 'hidden'; });
  window.__probeGame().freezeCamera = true;
});

for (const [nom, pos, look] of vues) {
  await page.evaluate(({ pos, look }) => {
    const g = window.__probeGame();
    g.view.camera.position.set(...pos);
    g.view.camera.lookAt(...look);
    g.view.camera.updateProjectionMatrix();
  }, { pos, look });
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${OUT}/${nom}.png` });
}

// ── Verdicts ───────────────────────────────────────────────────────────────────────
const c = mesures.cotes;
const dit = (ok, texte) => console.log(`${ok ? 'OK  ' : 'ECHEC'} ${texte}`);
let echecs = 0;
const verdict = (ok, texte) => { if (!ok) echecs++; dit(ok, texte); };

console.log('\n--- COTES ---');
console.log(`  rayon ${c.R} m · crete ${c.CRETE} m · demi-crete praticable ${c.DEMI_CRETE.toFixed(2)} m`);
console.log(`  pente sure ${(c.PENTE_SURE * 57.2958).toFixed(0)}° · perdue ${(c.PENTE_PERDUE * 57.2958).toFixed(0)}°`);
console.log(`  portee de saut ${c.PORTEE.toFixed(2)} m · trou ${c.TROU_M} m (${(100 * c.TROU_M / c.PORTEE).toFixed(0)} % de la portee)`);
console.log(`  longueur du parcours ${mesures.longueur} m · ${mesures.sections.length} sections · ${mesures.barils} barils`);

console.log('\n--- VERDICTS ---');
verdict(mesures.colliderPireEcartCm < 2,
  `le collider n'est jamais sous le visuel — au pire ${mesures.colliderPireEcartCm} cm `
  + `(${mesures.colliderTirs} tirs, dont ${mesures.colliderSurObstacle} sur un obstacle pose dessus)`);
verdict(mesures.colliderManques === 0,
  `aucun trou non voulu dans la paroi (${mesures.colliderManques} manque(s) hors trous declares)`);
verdict(c.entrainement.every((v) => v >= 1.0 && v <= 2.6),
  `la rotation se voit et reste tenable — entrainement ${c.entrainement.join(' / ')} m/s a la crete`);
verdict(mesures.pireVitesse > 0 && mesures.pireVitesse < 26,
  `un baril n'expedie plus le joueur — pointe a ${mesures.pireVitesse} m/s (plafond 16,7 horizontal)`);
verdict(c.passageResiduel >= c.PASSAGE_MIN - 1e-9,
  `une arete haute laisse ${c.passageResiduel.toFixed(2)} m de passage (minimum ${c.PASSAGE_MIN.toFixed(2)} m)`);
verdict(c.ARETE_BASSE < 2.15 && c.ARETE_HAUTE > 2.15,
  `l'arete basse se saute (${c.ARETE_BASSE} m) et la haute non (${c.ARETE_HAUTE} m)`);
verdict(c.TROU_M < c.PORTEE,
  `un trou se franchit d'un saut (${c.TROU_M} m pour ${c.PORTEE.toFixed(2)} m de portee)`);
verdict(mesures.barilsPurs,
  'la position des barils est une fonction pure du temps ecoule');
verdict(mesures.couverture.every((c) => c.anneaux >= 1),
  `chaque troncon a un anneau complet — ${mesures.couverture.map((c) => c.anneaux).join(' / ')}`);
verdict(mesures.couverture.every((c) => c.trouMax < 2.4),
  `les arcs couvrent la circonference — plus grand secteur vide `
  + `${mesures.couverture.map((c) => c.trouMax).join(' / ')} rad`);
verdict(mesures.jonctions.every((j) => j.h !== null && Math.abs(j.h - c.CRETE) < 0.2),
  `chaque jonction se marche a hauteur de crete — `
  + mesures.jonctions.map((j) => (j.h === null ? 'VIDE' : j.h.toFixed(2))).join(' / '));
verdict(mesures.continuiteTrous.length === 0,
  `le sol est continu sur l'axe du depart a l'arrivee${mesures.continuiteTrous.length ? ' — manque en z=' + mesures.continuiteTrous.join(', ') : ''}`);
verdict(erreurs.length === 0, `aucune erreur console${erreurs.length ? ' : ' + erreurs[0] : ''}`);

console.log(`\n${vues.length} vues dans ${OUT}/`);
console.log(echecs ? `\n${echecs} VERDICT(S) EN ECHEC` : '\nECHINE CONFORME');
await browser.close();
process.exit(echecs ? 1 : 0);
