/**
 * Diagnostic du mini-jeu « Le Rondin ».
 *
 * Six questions, dans l'ordre où elles peuvent invalider les suivantes :
 *
 *  1. Le collider colle-t-il au visuel ? Un rayon tiré vers l'axe doit rencontrer la paroi
 *     exactement au rayon annoncé. C'est LA garantie du jeu à mises : ce qu'on voit porte.
 *  2. Les trous traversent-ils ? Au droit d'un percement, le rayon ne doit rien trouver ;
 *     juste à côté, il doit trouver la paroi. Un trou qui ne troue pas que le visuel serait
 *     un piège invisible ; un trou qui ne troue que le collider, un sol fantôme.
 *  3. La rotation EMPORTE-T-ELLE le joueur ? C'est la question qui décide de tout le
 *     mini-jeu, et elle ne se voit sur aucune capture. Touches lâchées, la dérive doit
 *     valoir ω·R. Un témoin sur l'îlot de pierre, immobile, prouve que la mesure ne vient
 *     pas d'une pente ou d'un défaut du contrôleur.
 *  4. La culbute se déclenche-t-elle toute seule ? Poser le pied sur une surface qui défile
 *     ressemble à un impact. Si la secousse n'était pas mesurée dans le repère de surface,
 *     chaque atterrissage finirait au sol.
 *  5. Le parcours se franchit-il ? Un pilote traverse les quatre tronçons.
 *  6. Est-ce déterministe ? Même graine, mêmes trous et mêmes phases ; autre graine, autres.
 *
 * Lancer depuis tools/feel-lab, serveur de dev actif : node diag/rondin.mjs
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
const page = await browser.newPage({ viewport: { width: 700, height: 460 } });
page.setDefaultTimeout(600000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)); });

// ?noassets : la scène retombe sur ses formes procédurales. Le décor Meshy ne porte aucun
// collider, il ne peut donc rien changer aux mesures — et le harnais passe alors même
// quand la machine est trop chargée pour charger 20 modèles.
await page.goto('http://127.0.0.1:5273/?lowfx&noassets&skip=scenery', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const l = document.getElementById('loading');
  return l && getComputedStyle(l).display === 'none';
}, { timeout: 600000 });

/**
 * Lance une manche du Rondin sur une graine imposée, via le vrai chemin de code.
 *
 * `skip` permet d'écarter les fagots pour les tirs de géométrie. Ce n'est pas une
 * facilité : un rayon tiré vers l'axe rencontre le fagot AVANT la paroi, et la première
 * version de ce test comptait quatre parois « percées » qui n'étaient qu'un anneau de
 * bâtons vu de l'extérieur. On mesure la paroi, donc on ne garde que la paroi.
 */
const lancer = async (graine, skip = 'scenery') => {
  await page.evaluate(([g, sk]) => {
    const u = new URL(location.href);
    u.searchParams.set('graine', String(g));
    u.searchParams.set('skip', sk);
    history.replaceState(null, '', u);
  }, [graine, skip]);
  await page.evaluate(() => {
    const jeu = window.__probeGame();
    const epreuve = window.__MINIGAMES.find((m) => m.id === 'rondin');
    jeu.partie = { parcours: [epreuve], index: 0, temps: [], chutes: 0 };
    jeu.startRace();
  });
};

await lancer(4242, 'scenery,fagots');
await page.waitForFunction(() => window.__probeGame().arena?.__troncons, { timeout: 600000 });
await page.waitForTimeout(1500);

// ── 0 : les cotes, verifiees AVANT de jouer ───────────────────────────────────────────
// Un pilote qui passe ne prouve pas qu'une cote est juste : il peut passer par chance, ou
// echouer pour une raison etrangere a la cote. Les regles se verifient sur les nombres.
const cotes = await page.evaluate(() => {
  const c = window.__probeGame().arena.__cotes();
  return { ...c, saut: 2.15 };
});
dire(cotes.FAGOT_H < cotes.saut * 0.6, 'le fagot est franchement sous le saut',
  `${cotes.FAGOT_H} m pour un saut de ${cotes.saut} m`);
dire(cotes.MUR_H > cotes.saut * 1.15, 'la palissade est franchement au-dessus du saut',
  `${cotes.MUR_H} m pour un saut de ${cotes.saut} m`);
dire(cotes.passageResiduel >= cotes.PASSAGE_MIN,
  'une palissade laisse toujours de quoi la contourner',
  `${cotes.passageResiduel.toFixed(2)} m de terrain libre dans la bande jouable, `
  + `${cotes.PASSAGE_MIN.toFixed(2)} m exiges`);
dire(cotes.TROU_M > cotes.PERSO_LARGE * 2, 'un trou ne se franchit pas par hasard',
  `${cotes.TROU_M} m pour un corps de ${cotes.PERSO_LARGE} m`);

// ── 1 et 2 : la paroi et les trous ────────────────────────────────────────────────────
// Les deux tirs se font dans UNE seule évaluation : la scène ne tourne pas pendant qu'on
// l'interroge, donc l'angle lu au début vaut encore à la fin.
const geom = await page.evaluate(() => {
  const a = window.__probeGame().arena;
  const trs = a.__troncons();
  const paroi = [];      // écarts au rayon annoncé
  const trousVus = [];   // { attenduVide, trouve }
  for (let i = 0; i < trs.length; i++) {
    const t = trs[i];
    const L = t.z0 - t.z1;
    for (let iz = 1; iz <= 6; iz++) {
      const z = t.z0 - (iz / 7) * L;
      const zLocal = z - (t.z0 + t.z1) / 2;
      for (let k = 0; k < 36; k++) {
        const th = (k / 36) * Math.PI * 2;
        // Tir depuis l'extérieur VERS l'axe : l'impact doit tomber sur la paroi.
        const D = t.R + 6;
        const ox = D * Math.cos(th), oy = t.centerY + D * Math.sin(th);
        const toi = a.__ray(ox, oy, z, -Math.cos(th), -Math.sin(th), 0, D * 2);

        // Ce point est-il dans un trou ? Les angles des trous sont LOCAUX : on les ramène
        // au monde avec l'angle courant du tronçon.
        // Le percement retire les cellules dont le CENTRE tombe dans l'ouverture : il
        // deborde donc d'une demi-cellule de chaque cote. On exclut l'ouverture entiere
        // plus cette marge, sinon les rayons du bord tombent dans le vide et sont
        // comptes comme une paroi manquante.
        const DEMI_CELL = Math.PI / 64 + 0.02;
        let dansTrou = false;
        for (const h of t.trous) {
          if (Math.abs(zLocal - h.z) > h.long / 2 + 0.6) continue;
          for (const base of [h.angle, h.angle + Math.PI]) {
            const aMonde = base + t.angle;
            let d = th - aMonde;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            if (Math.abs(d) < h.arc / 2 + DEMI_CELL) dansTrou = true;
          }
        }
        if (dansTrou) {
          continue;   // les trous ont leur propre passe, ciblee : voir plus bas
        } else if (toi !== null) {
          paroi.push(Math.abs((D - toi) - t.R));
        } else {
          paroi.push(Infinity);   // rien touché hors trou : la paroi manque
        }
      }
    }
  }
  // ── Passe ciblee sur les trous ──
  // Balayer une grille de cotes ne trouve jamais un trou : il fait 2,2 m sur 45. La
  // premiere version de ce test balayait six cotes par troncon et n'a touche AUCUN trou —
  // elle annoncait donc « 0 trou bouche » sur zero mesure, ce qui ne prouvait rien. On
  // tire desormais AU DROIT de chaque percement, a sa cote exacte.
  for (const t of trs) {
    const zMid = (t.z0 + t.z1) / 2;
    for (const h of t.trous) {
      const z = zMid + h.z;
      for (const base of [h.angle, h.angle + Math.PI]) {
        const aMonde = base + t.angle;
        // Coeur du trou : rien ne doit porter. Et deux temoins juste a cote, ou la paroi
        // doit etre intacte — sans eux, un trou trop grand passerait pour un succes.
        for (const f of [-0.3, 0, 0.3]) {
          const th = aMonde + f * h.arc;
          const D = t.R + 6;
          const toi = a.__ray(D * Math.cos(th), t.centerY + D * Math.sin(th), z,
            -Math.cos(th), -Math.sin(th), 0, D * 2);
          trousVus.push({ coeur: true, porte: toi !== null && Math.abs((D - toi) - t.R) < 0.5 });
        }
        for (const f of [-1.4, 1.4]) {
          const th = aMonde + f * h.arc;
          const D = t.R + 6;
          const toi = a.__ray(D * Math.cos(th), t.centerY + D * Math.sin(th), z,
            -Math.cos(th), -Math.sin(th), 0, D * 2);
          trousVus.push({ coeur: false, porte: toi !== null && Math.abs((D - toi) - t.R) < 0.5 });
        }
      }
    }
  }
  const coeurs = trousVus.filter((t) => t.coeur);
  const bords = trousVus.filter((t) => !t.coeur);
  return {
    n: paroi.length,
    max: Math.max(...paroi),
    moyen: paroi.reduce((s, x) => s + x, 0) / paroi.length,
    coeurs: coeurs.length,
    coeursBouches: coeurs.filter((t) => t.porte).length,
    bords: bords.length,
    bordsPerces: bords.filter((t) => !t.porte).length,
  };
});
dire(geom.max <= 0.01, 'le collider colle au visuel',
  `${geom.n} tirs, ecart max ${(geom.max * 100).toFixed(2)} cm, moyen ${(geom.moyen * 1000).toFixed(1)} mm`);
dire(geom.coeurs > 0 && geom.coeursBouches === 0 && geom.bordsPerces === 0,
  'les trous traversent, et seulement les trous',
  `${geom.coeurs} tirs au coeur : ${geom.coeursBouches} ont trouve du sol ; `
  + `${geom.bords} tirs juste a cote : ${geom.bordsPerces} sont passes au travers`);

// ── 2 bis : LARGEUR REELLE DE LA BANDE JOUABLE ────────────────────────────────────────
// L'ouverture d'une palissade se deduit de cette largeur. Elle etait ESTIMEE a 40 degres,
// jamais mesuree — et une palissade calculee sur une bande trop large ne se contournerait
// plus. On place le joueur a des angles croissants depuis la crete, on le fait remonter,
// et on retient le dernier angle d'ou il revient.
await lancer(4242, 'scenery,fagots');
await page.waitForFunction(() => window.__probeGame().arena?.__troncons, { timeout: 600000 });
await page.waitForTimeout(1200);
const bande = await page.evaluate(async () => {
  const jeu = window.__probeGame();
  const a = jeu.arena, c = jeu.character;
  const t = a.__troncons()[0];
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const touche = (code, bas) =>
    dispatchEvent(new KeyboardEvent(bas ? 'keydown' : 'keyup', { code, bubbles: true }));

  // Quelle touche va vers les x negatifs ? On le mesure au lieu de le supposer : le
  // mappage depend du lacet de la camera, qui n'est pas garanti nul.
  c.respawn({ x: 0, y: t.centerY + t.R + 1.4, z: (t.z0 + t.z1) / 2 });
  await attendre(700);
  const x0 = c.body.translation().x;
  touche('KeyA', true); await attendre(500); touche('KeyA', false);
  const versGauche = c.body.translation().x - x0 < 0;
  const versCrete = versGauche ? 'KeyA' : 'KeyD';   // depuis un x positif

  let dernierBon = 0;
  const releves = [];
  for (let deg = 20; deg <= 75; deg += 5) {
    const al = deg * Math.PI / 180;
    // Place a l'angle `al` du sommet, cote x positif.
    c.respawn({
      x: (t.R + 0.9) * Math.sin(al),
      y: t.centerY + (t.R + 0.9) * Math.cos(al),
      z: (t.z0 + t.z1) / 2,
    });
    await attendre(450);
    const avant = c.body.translation();
    if (avant.y < t.centerY) { releves.push(`${deg}:tombe`); continue; }
    // On relache des qu'il atteint la crete. Tenir la touche 1,5 s le faisait traverser
    // le sommet a 7,6 m/s et ressortir de l'autre cote : depuis 25 degres il tombait par
    // EXCES de vitesse, et la mesure annoncait « perdu » a des angles ou il tenait tres
    // bien. C'est ce qui rendait la serie non monotone.
    touche(versCrete, true);
    for (let i = 0; i < 30; i++) {
      await attendre(50);
      if (Math.abs(c.body.translation().x) < 0.6) break;
    }
    touche(versCrete, false);
    await attendre(300);
    const apres = c.body.translation();
    // « Revenu » = il tient toujours le haut du tronc. Exiger que l'angle DIMINUE etait
    // faux : depuis 25 degres il traverse la crete en une seconde et ressort de l'autre
    // cote, ou l'angle mesure redevient grand. Le critere comptait donc une remontee
    // reussie comme un echec, et la bande mesuree sautait de « perdu » a « revient ».
    const revenu = apres.y > t.centerY + t.R * 0.72;
    releves.push(`${deg}:${revenu ? 'revient' : 'perdu'}`);
    // On ne s'arrete PAS au premier echec : un angle rate isolement ne dit rien, c'est la
    // limite au-dela de laquelle plus rien ne revient qui interesse.
    if (revenu) dernierBon = deg;
  }
  return { dernierBon, releves, configuree: a.__cotes().BANDE * 180 / Math.PI };
});
dire(bande.configuree <= bande.dernierBon + 0.5,
  'la bande jouable retenue par le code est prudente',
  `mesuree ${bande.dernierBon}°, retenue ${bande.configuree.toFixed(0)}° `
  + `· ${bande.releves.join(' ')}`);

// ── 3 : la rotation emporte-t-elle le joueur ? ────────────────────────────────────────
// On remet les fagots : a partir d'ici, c'est le mini-jeu complet qu'on mesure.
await lancer(4242);
await page.waitForFunction(() => window.__probeGame().arena?.__troncons, { timeout: 600000 });
await page.waitForTimeout(1200);
const derive = await page.evaluate(async () => {
  const jeu = window.__probeGame();
  const a = jeu.arena, c = jeu.character;
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  async function mesurer(z, y) {
    c.respawn({ x: 0, y, z });
    await attendre(900);                     // le temps de retomber et de se stabiliser
    const p0 = c.body.translation();
    const t0 = performance.now();
    await attendre(1000);
    const p1 = c.body.translation();
    return { dx: p1.x - p0.x, dt: (performance.now() - t0) / 1000, y0: p0.y, y1: p1.y };
  }

  const trs = a.__troncons();
  const rapide = trs[3];
  const zRapide = (rapide.z0 + rapide.z1) / 2;
  const surRondin = await mesurer(zRapide, rapide.centerY + rapide.R + 1.4);
  // Témoin : le même geste sur l'îlot de pierre, qui ne tourne pas.
  const zIlot = trs[2].z1 - 4.5;
  const surIlot = await mesurer(zIlot, rapide.centerY + rapide.R + 1.4);
  return {
    attendu: Math.abs(rapide.omega) * rapide.R,
    rondin: Math.abs(surRondin.dx) / surRondin.dt,
    ilot: Math.abs(surIlot.dx) / surIlot.dt,
    sens: Math.sign(surRondin.dx) === Math.sign(-rapide.omega),
  };
});
const ecartRel = Math.abs(derive.rondin - derive.attendu) / derive.attendu;
dire(ecartRel < 0.25 && derive.sens, 'la rotation emporte le joueur',
  `${derive.rondin.toFixed(2)} m/s mesures pour ${derive.attendu.toFixed(2)} attendus `
  + `(${(ecartRel * 100).toFixed(0)} %), sens ${derive.sens ? 'correct' : 'INVERSE'}`);
dire(derive.ilot < 0.25, 'un sol immobile ne derive pas',
  `temoin sur l'ilot : ${derive.ilot.toFixed(2)} m/s`);

// ── 4 : pas de culbute parasite ───────────────────────────────────────────────────────
const culbute = await page.evaluate(async () => {
  const jeu = window.__probeGame();
  const a = jeu.arena, c = jeu.character;
  const trs = a.__troncons();
  const t = trs[3];
  let vues = 0;
  for (let essai = 0; essai < 4; essai++) {
    // On tombe DE HAUT sur le tronçon le plus rapide : c'est le pire cas, celui où le
    // contact impose d'un coup la vitesse de la surface.
    c.respawn({ x: 0, y: t.centerY + t.R + 4.5, z: (t.z0 + t.z1) / 2 - essai * 3 });
    const jusqua = performance.now() + 1400;
    while (performance.now() < jusqua) {
      if (c.state === 'tumbling' || c.state === 3) vues++;
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  return vues;
});
dire(culbute === 0, 'aucune culbute parasite a l\'atterrissage',
  `4 chutes sur le troncon le plus rapide, ${culbute} releves en culbute`);

// ── 5 : le parcours se franchit-il ? ──────────────────────────────────────────────────
await lancer(4242);
await page.waitForFunction(() => window.__probeGame().arena?.__troncons, { timeout: 600000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const jeu = window.__probeGame();
  const enfonce = new Set();
  const tenir = (code, veut) => {
    if (veut === enfonce.has(code)) return;
    veut ? enfonce.add(code) : enfonce.delete(code);
    dispatchEvent(new KeyboardEvent(veut ? 'keydown' : 'keyup', { code, bubbles: true }));
  };
  const etat = { plusLoin: 99, fini: false, chutes: 0, enChute: false };
  window.__pilote = etat;

  // Le pilote tourne DANS la page : depuis Node, un aller-retour par image le ferait
  // jouer au ralenti et la rotation le jetterait avant qu'il ait décidé quoi que ce soit.
  const tick = () => {
    // On relit `jeu.arena` a chaque image au lieu de garder la reference capturee au
    // depart : la manche terminee, l'arene et son monde Rapier sont liberes, et sonder
    // l'ancienne leve « null pointer passed to rust ».
    const a = jeu.arena, c = jeu.character;
    if (etat.fini || jeu.mode !== 'racing' || !a || !c) return;
    requestAnimationFrame(tick);
    const p = c.body.translation();
    if (!Number.isFinite(p.x)) return;
    etat.plusLoin = Math.min(etat.plusLoin, p.z);
    if (p.y < 0 && !etat.enChute) {
      etat.enChute = true; etat.chutes++;
      // Ou il tombe compte plus que combien de fois : une chute repetee au meme endroit
      // designe un piege, des chutes eparpillees designent un pilote depasse.
      if (etat.chutes <= 40) (etat.ou = etat.ou ?? []).push(Math.round(p.z));
    }
    else if (p.y > 3) etat.enChute = false;

    tenir('KeyW', true);

    // Tenir la crête : elle est toujours en x = 0, puisque c'est le point le plus haut du
    // cylindre. Corriger x, c'est exactement lutter contre la rotation.
    tenir('KeyA', p.x > 0.35);
    tenir('KeyD', p.x < -0.35);

    // Sauter si quelque chose barre devant, ou si le sol manque devant.
    //
    // Le rayon part 1,2 m EN AVANT du joueur. Tire depuis son centre, il naissait a
    // l'interieur de sa propre capsule : `castRay` en mode solide renvoie alors une
    // distance nulle, le pilote croyait un obstacle colle en permanence et sautait a
    // chaque image sans jamais rien franchir. Les autres harnais du projet tirent depuis
    // au-dessus de la tete pour la meme raison.
    const AVANT = 1.2;
    const devant = a.__ray(p.x, p.y - 0.3, p.z - AVANT, 0, 0, -1, 2.4);
    const sol = a.__ray(p.x, p.y, p.z - 4.6, 0, -1, 0, 7);
    // 3,0 m : a 7,6 m/s, l'obstacle arrive 0,4 s plus tard, soit pres du sommet du saut.
    // A 4,6 m le pilote sautait trop tot et repassait sous 1,06 m au moment du contact,
    // pour un fagot haut de 1,05 — il le franchissait a un centimetre pres, donc jamais.
    const doitSauter = devant !== null || sol === null;
    tenir('Space', doitSauter && c.grounded);

    // Journal glissant : en cas d'echec, on veut savoir CE QUE VOYAIT le pilote, pas
    // reconstituer son raisonnement apres coup.
    if (!etat.dernier || performance.now() - etat.dernier > 500) {
      etat.dernier = performance.now();
      const v = c.body.linvel();
      (etat.trace = etat.trace ?? []).push(
        `z${p.z.toFixed(0)} x${p.x.toFixed(1)} v${Math.hypot(v.x, v.z).toFixed(1)}`
        + `${c.grounded ? ' sol' : ' air'}${devant !== null ? ' MUR' : ''}${sol === null ? ' VIDE' : ''}`);
      if (etat.trace.length > 24) etat.trace.shift();
    }
  };
  tick();
});
await page.waitForFunction(
  () => window.__pilote && window.__probeGame().mode !== 'racing',
  { timeout: 180000 },
).catch(() => {});
const course = await page.evaluate(() => ({
  ...window.__pilote,
  finishZ: window.__probeGame().arena?.finishZ ?? null,
  mode: window.__probeGame().mode,
}));
dire(course.mode !== 'racing', 'le parcours se franchit de bout en bout',
  `arrivee ${course.mode !== 'racing' ? 'FRANCHIE' : 'PAS ATTEINTE'} `
  + `(plus loin z = ${course.plusLoin.toFixed(0)} sur ${course.finishZ}), ${course.chutes} chutes`
  + (course.ou?.length ? ` · ou : ${course.ou.slice(0, 14).join(', ')}` : ''));
if (course.mode === 'racing') console.log('       trace : ' + (course.trace ?? []).join(' | '));

// ── 6 : determinisme ──────────────────────────────────────────────────────────────────
const empreinte = async (graine) => {
  await lancer(graine);
  await page.waitForFunction(() => window.__probeGame().arena?.__troncons, { timeout: 600000 });
  await page.waitForTimeout(700);
  return page.evaluate(() => JSON.stringify(window.__probeGame().arena.__troncons()
    .map((t) => ({ o: t.omega, tr: t.trous.map((h) => [h.z.toFixed(3), h.angle.toFixed(6)]) }))));
};
const a1 = await empreinte(4242);
const a2 = await empreinte(4242);
const b1 = await empreinte(777);
dire(a1 === a2 && a1 !== b1, 'la disposition est deterministe',
  a1 === a2 ? (a1 !== b1 ? 'meme graine identique, autre graine differente'
    : 'DEUX GRAINES DONNENT LA MEME CARTE') : 'DEUX PASSAGES DIFFERENT');

// ── Verdict ───────────────────────────────────────────────────────────────────────────
console.log('\n--- console ---');
console.log(erreurs.length ? [...new Set(erreurs)].join('\n') : 'aucune erreur');
const rates = verdicts.filter((v) => !v).length;
console.log(`\n${verdicts.length - rates}/${verdicts.length} verdicts au vert`);
await browser.close();
process.exit(rates ? 1 : 0);
