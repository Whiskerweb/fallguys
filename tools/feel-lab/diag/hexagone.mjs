/**
 * L'HEXAGONE est-il une carte juste, et est-il un JEU ?
 *
 * Deux questions distinctes, et la seconde ne se déduit pas de la première. Une tour
 * géométriquement irréprochable sur laquelle on peut rester immobile n'est pas un jeu ;
 * une tour dont on ne peut pas descendre non plus.
 *
 * Ce qui se mesure ici, dans l'ordre :
 *   la géométrie (le collider colle-t-il au visuel, un trou est-il un vrai trou),
 *   la règle qui fait le jeu (toute la capsule paie-t-elle ce qu'elle touche),
 *   les deux verrous qui tiennent la carte debout (on ne remonte jamais, on ne culbute
 *     pas en changeant d'étage),
 *   les portées de la référence (un trou se saute, deux ne se sautent pas),
 *   et enfin le jeu lui-même : deux pilotes opposés doivent obtenir deux issues opposées.
 *
 * Les cotes sont TOUJOURS relues dans la scène et dans `window.__TUNING`, jamais recopiées
 * ici : un harnais qui garde sa propre copie des cotes valide une carte imaginaire dès que
 * quelqu'un déplace une valeur de dix centimètres.
 *
 * Lancer depuis tools/feel-lab, serveur actif :
 *   node diag/hexagone.mjs        ·  FEELLAB_PORT=5274 node diag/hexagone.mjs
 */
import { chromium } from 'playwright';

const BASE = `http://127.0.0.1:${process.env.FEELLAB_PORT ?? 5273}`;
let browser;
process.on('exit', () => { try { browser?.close(); } catch {} });

const verdicts = [];
const dire = (ok, titre, detail) => {
  verdicts.push(ok);
  console.log(`${ok ? '  OK ' : 'ECHEC'} ${titre}${detail ? ' — ' + detail : ''}`);
};

browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 360, height: 240 } });
page.setDefaultTimeout(600000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 160)));

/** Démarre une manche neuve de L'Hexagone et attend que le joueur ait la main. */
async function manche(graine = 4242) {
  await page.goto(`${BASE}/?lowfx&nointro&noassets&skip=scenery&graine=${graine}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && getComputedStyle(l).display === 'none';
  }, { timeout: 600000 });
  await page.evaluate(() => {
    const g = window.__probeGame();
    g.partie = { parcours: [window.__MINIGAMES.find((m) => m.id === 'hexagone')], index: 0, temps: [], chutes: 0 };
    g.startRace();
  });
  await page.waitForFunction(() => window.__probeGame().arena?.__cotes, { timeout: 600000 });
  // Le decompte dure 2,7 s et la sonde d'erosion est desarmee pendant tout ce temps : rien
  // ne se mesure avant qu'il soit ecoule.
  await page.waitForFunction(() => window.__probeGame().countdown <= 0, { timeout: 600000 });
}

await manche();
const cotes = await page.evaluate(() => window.__probeGame().arena.__cotes());
const etages = await page.evaluate(() => window.__probeGame().arena.__etages());
const T = await page.evaluate(() => ({ ...window.__TUNING }));

console.log(`tour : ${etages.length} etages, ${cotes.TOTAL} hexagones · `
  + `hexagone R=${cotes.RAYON} pas=${cotes.PAS.toFixed(3)} m · `
  + `sursis ${cotes.SURSIS} s · duree a tenir ${cotes.DUREE} s`);

/* ── 1. RAYON DE CONTROLE ──────────────────────────────────────────────────────────────
 *
 * Avant toute mesure par rayons, on verifie qu'un rayon tire sur du sol CERTAIN touche
 * quelque chose. Sans ce controle, une page rechargee en cours de mesure — le rechargement
 * a chaud de Vite le fait tout seul quand quelqu'un edite le depot — produit une volee de
 * faux rouges tres convaincants : « aucun hexagone ne porte », alors que c'est la scene
 * qui n'existe plus. Mieux vaut s'arreter net que mentir.
 */
{
  const t = await page.evaluate(([x, z, y]) => window.__probeGame().arena.__ray(x, y, z, 0, -1, 0, 20),
    [0, 0, etages[0].y + 1]);
  if (t === null) {
    console.error('\nABANDON : le rayon de controle ne touche pas le sommet de la tour.');
    console.error('La scene n\'est pas celle qu\'on croit mesurer (page rechargee ?).');
    await browser.close();
    process.exit(2);
  }
}

/* ── 2. LE COLLIDER COLLE-T-IL AU VISUEL ? ─────────────────────────────────────────────
 *
 * Le collider est l'enveloppe convexe des sommets du maillage : en principe il ne PEUT pas
 * s'en ecarter. « En principe » ne vaut rien — on tire donc un rayon vertical au centre de
 * chaque hexagone de chaque etage et on compare la cote touchee a la cote annoncee.
 */
{
  const r = await page.evaluate((n) => {
    const a = window.__probeGame().arena;
    let pire = 0, sondes = 0, manques = 0;
    for (let e = 0; e < n; e++) {
      const et = a.__etages()[e];
      for (const h of a.__hexas(e)) {
        const t = a.__ray(h.x, et.y + 1, h.z, 0, -1, 0, 6);
        sondes++;
        if (t === null) { manques++; continue; }
        pire = Math.max(pire, Math.abs(t - 1));
      }
    }
    return { pire, sondes, manques };
  }, etages.length);
  dire(r.manques === 0 && r.pire < 0.001,
    'le dessus de chaque hexagone est exactement a la cote de son etage',
    `${r.sondes} hexagones sondes, ${r.manques} sans sol, ecart max ${(r.pire * 1000).toFixed(2)} mm`);
}

/* ── 3. UN HEXAGONE PORTE-T-IL JUSQU'A SON BORD ? ──────────────────────────────────────
 *
 * A 5 cm en dedans de chacun de ses six plats. Le joueur juge du bord a dix centimetres
 * pres sur cette carte : un hexagone qui ne porterait que son centre serait un piege muet.
 */
{
  const r = await page.evaluate(() => {
    const a = window.__probeGame().arena;
    const { APOTHEME } = a.__cotes();
    const et = a.__etages()[2];
    let ok = 0, total = 0;
    for (const h of a.__hexas(2)) {
      for (let i = 0; i < 6; i++) {
        // Les NORMALES des plats sont a 30, 90, 150… en flat-top.
        const ang = Math.PI / 6 + (i * Math.PI) / 3;
        const d = APOTHEME - 0.05;
        const t = a.__ray(h.x + Math.cos(ang) * d, et.y + 1, h.z + Math.sin(ang) * d, 0, -1, 0, 6);
        total++;
        if (t !== null && Math.abs(t - 1) < 0.01) ok++;
      }
    }
    return { ok, total };
  });
  dire(r.ok === r.total, 'un hexagone porte jusqu\'a 5 cm de son bord',
    `${r.ok}/${r.total} tirs de bord`);
}

/* ── 4. LA REGLE QUI FAIT LE JEU : TOUTE LA CAPSULE PAIE ───────────────────────────────
 *
 * Pose au centre d'un hexagone, on en recouvre UN. A cheval sur une arete, DEUX. Sur un
 * sommet, TROIS.
 *
 * C'est le verdict central de cette carte. Si seul l'hexagone sous le centre du corps
 * cedait, un joueur a cheval resterait debout sur un hexagone qu'il n'a jamais paye — et
 * « creuser son propre trou », qui EST le jeu, ne couterait plus rien.
 *
 * On interroge la sonde NON DESTRUCTIVE plutot que de poser le personnage. Une premiere
 * version le posait vraiment, et lisait QUATRE hexagones sur un sommet : ce n'etait pas la
 * regle mais le solveur, qui expulse une capsule coincee la ou trois hexagones se
 * rencontrent — en quelques images le corps avait derive jusqu'a en toucher un quatrieme,
 * et la mesure decrivait ce voyage. Que la sonde s'applique bien au VRAI corps est prouve
 * ailleurs : les pilotes du verdict 12 ne consomment le sol que par ce chemin-la.
 */
{
  const r = await page.evaluate(() => {
    const a = window.__probeGame().arena;
    const { RAYON, APOTHEME } = a.__cotes();
    const et = a.__etages()[1];
    const h = a.__hexas(1).find((x) => x.q === 0 && x.r === 0);
    const y = et.y + 0.85;
    return {
      // Centre, milieu d'une arete (a un apotheme, dans la direction d'une NORMALE),
      // et sommet (a un rayon, dans la direction d'un SOMMET).
      centre: a.__sonde(h.x, y, h.z).length,
      arete: a.__sonde(h.x, y, h.z + APOTHEME).length,
      sommet: a.__sonde(h.x + RAYON, y, h.z).length,
    };
  });
  dire(r.centre === 1 && r.arete === 2 && r.sommet === 3,
    'toute la capsule paie ce qu\'elle recouvre',
    `centre ${r.centre} hexagone, arete ${r.arete}, sommet ${r.sommet}`);
}

/* ── 5. LE SURSIS, ET SON REBOND ───────────────────────────────────────────────────────
 *
 * Mesure faite PAR LA SCENE (`sursisReel`), jamais chronometree depuis Node. Le navigateur
 * sans fenetre tourne autour de dix images par seconde : un chronometrage externe ne peut
 * pas resoudre un evenement plus fin que son image, et sur Les Dalles il lisait un
 * decalage constant de +0,55 s. Le decalage etait l'instrument, pas la carte.
 */
{
  const r = await page.evaluate(async () => {
    const g = window.__probeGame(), a = g.arena, c = g.character;
    const et = a.__etages()[1];
    a.reset();
    await new Promise((res) => setTimeout(res, 140));
    const h = a.__hexas(1).find((x) => x.q === 0 && x.r === 0);
    for (let i = 0; i < 60; i++) {
      c.respawn({ x: h.x, y: et.y + 0.85, z: h.z });
      const s = a.__etats().find((s) => s.e === 1 && s.q === 0 && s.r === 0);
      if (s?.sursisReel != null) return { sursisReel: s.sursisReel, etat: s.etat };
      await new Promise((res) => setTimeout(res, 40));
    }
    return null;
  });
  dire(r && Math.abs(r.sursisReel - cotes.SURSIS) < 0.06,
    'le sursis mesure vaut le sursis annonce',
    r ? `${r.sursisReel.toFixed(3)} s mesures pour ${cotes.SURSIS} s annonces`
      : 'aucun hexagone n\'a cede');
}

/* ── 6. UN TROU EST-IL UN VRAI TROU ? ──────────────────────────────────────────────────
 *
 * Un hexagone disparu ne doit rien laisser derriere lui — ni collider fantome, ni reste de
 * l'enveloppe convexe. On tire au droit d'un trou frais, vers le bas, sur toute la hauteur
 * de la tour : le rayon ne doit rencontrer QUE des etages inferieurs, jamais l'etage qu'on
 * vient de vider.
 */
{
  const r = await page.evaluate(async () => {
    const g = window.__probeGame(), a = g.arena, c = g.character;
    const et = a.__etages()[0], sous = a.__etages()[1];
    // On evacue le personnage AVANT la remise a zero : reste-t-il sur la tour, il
    // re-declenche l'hexagone sous ses pieds dans l'image qui suit, et le controle
    // ci-dessous conclurait a tort que `reset()` est incomplet.
    c.body.setTranslation({ x: 120, y: et.y + 20, z: 0 }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    await new Promise((res) => setTimeout(res, 120));
    a.reset();
    await new Promise((res) => setTimeout(res, 140));
    // On part d'une tour INTACTE, et on le verifie : les verdicts precedents ont mange des
    // hexagones, et une premiere version lisait 7,40 m au lieu de 4,20 — le rayon filait
    // jusqu'a l'etage 3 parce que l'etage 2 etait deja perce sous le point de tir. Le
    // verdict accusait alors la scene de laisser trainer un collider, alors qu'il mesurait
    // les degats des mesures precedentes.
    const sale = a.__etats().length;
    // On choisit aussi un hexagone qu'aucun autre verdict n'a touche.
    const h = a.__hexas(0).find((x) => x.q === 2 && x.r === -1);
    // On use l'hexagone jusqu'a sa disparition complete.
    for (let i = 0; i < 80; i++) {
      c.respawn({ x: h.x, y: et.y + 0.85, z: h.z });
      const s = a.__etats().find((s) => s.e === 0 && s.q === h.q && s.r === h.r);
      if (s?.etat === 'disparu') break;
      await new Promise((res) => setTimeout(res, 40));
    }
    const s = a.__etats().find((s) => s.e === 0 && s.q === h.q && s.r === h.r);
    /*
     * On ECARTE le personnage avant de tirer. `__ray` ne filtre aucun collider, et le
     * corps se trouvait pile sur l'origine du rayon : la premiere version lisait donc une
     * distance de 0,00 m et accusait la scene de laisser un collider dans le vide, alors
     * qu'elle mesurait le joueur lui-meme.
     */
    c.body.setTranslation({ x: h.x + 80, y: et.y + 20, z: h.z }, true);
    await new Promise((res) => setTimeout(res, 90));
    const t = a.__ray(h.x, et.y + 1, h.z, 0, -1, 0, 40);
    // Le rayon doit filer jusqu'a l'etage du DESSOUS, pas s'arreter sur l'etage vide.
    const attenduSous = 1 + (et.y - sous.y);
    // L'hexagone du dessous, au meme endroit, doit etre INTACT : sinon le rayon file
    // plus bas et la mesure ne dit plus rien de ce qu'on croit mesurer.
    const dessousIntact = a.__intact(h.x, h.z, 1);
    return { etat: s?.etat ?? 'posee', t, attenduSous, sale, dessousIntact };
  });
  dire(r.sale === 0 && r.dessousIntact && r.etat === 'disparu'
    && r.t !== null && Math.abs(r.t - r.attenduSous) < 0.02,
    'un hexagone disparu ne laisse aucun collider derriere lui',
    `le rayon file jusqu'a ${r.t === null ? 'rien' : r.t.toFixed(2) + ' m'} `
    + `(l'etage du dessous est a ${r.attenduSous.toFixed(2)} m)`
    + (r.sale ? ` · REMISE A ZERO INCOMPLETE : ${r.sale} hexagones encore abimes` : '')
    + (r.dessousIntact ? '' : ' · l\'hexagone du dessous n\'etait pas intact'));
}

/* ── 7. ON NE REMONTE JAMAIS D'UN ETAGE ────────────────────────────────────────────────
 *
 * Le verrou qui tient toute la carte : si l'on peut remonter, la tour n'est plus une tour
 * et il n'y a plus d'epreuve. On essaie les deux facons — le saut plein, et le saut suivi
 * d'un plongeon au sommet, qui est l'echappatoire evidente.
 */
{
  const r = await page.evaluate(async () => {
    const g = window.__probeGame(), a = g.arena, c = g.character;
    const et = a.__etages()[2];
    const k = (code, bas) => dispatchEvent(new KeyboardEvent(bas ? 'keydown' : 'keyup', { code, bubbles: true }));
    const essai = async (avecPlongeon) => {
      a.reset();
      const h = a.__hexas(2).find((x) => x.q === 0 && x.r === 0);
      c.respawn({ x: h.x, y: et.y + 0.85, z: h.z });
      c.fatigue = 0;
      await new Promise((res) => setTimeout(res, 260));
      const sol = c.body.translation().y;
      k('Space', true);
      setTimeout(() => k('Space', false), 80);
      if (avecPlongeon) setTimeout(() => { k('ShiftLeft', true); setTimeout(() => k('ShiftLeft', false), 70); }, 250);
      let haut = -1e9;
      for (let i = 0; i < 40; i++) {
        haut = Math.max(haut, c.body.translation().y);
        await new Promise((res) => setTimeout(res, 30));
      }
      return +(haut - sol).toFixed(3);
    };
    const simple = await essai(false);
    const plonge = await essai(true);
    return { simple, plonge, ecart: a.__cotes().ETAGE_H };
  });
  const pire = Math.max(r.simple, r.plonge);
  dire(pire < r.ecart - 0.35,
    'on ne remonte JAMAIS d\'un etage',
    `apex ${r.simple.toFixed(2)} m au saut, ${r.plonge.toFixed(2)} m avec plongeon, `
    + `contre ${r.ecart.toFixed(2)} m d'ecart (marge ${(r.ecart - pire).toFixed(2)} m)`);
}

/* ── 8. CHANGER D'ETAGE NE DOIT PAS CULBUTER ───────────────────────────────────────────
 *
 * On arrive a plus de seize metres par seconde au bout d'une chute d'etage. La detection de
 * culbute ne mesure que l'horizontal et accorde 0,18 s de grace a l'atterrissage, donc en
 * principe rien ne se declenche — mais c'est exactement le genre de « en principe » qui
 * rend une carte injouable sans qu'aucune image ne dise pourquoi.
 */
{
  const r = await page.evaluate(async () => {
    const g = window.__probeGame(), a = g.arena, c = g.character;
    const et = a.__etages()[1];
    a.reset();
    const h = a.__hexas(1).find((x) => x.q === 0 && x.r === 0);
    // On lache le personnage juste au-dessus de l'etage 2, a l'aplomb d'un hexagone intact.
    c.respawn({ x: h.x, y: a.__etages()[0].y + 0.85, z: h.z });
    await new Promise((res) => setTimeout(res, 120));
    c.body.setTranslation({ x: h.x, y: et.y + a.__cotes().ETAGE_H + 0.85, z: h.z }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let vPire = 0, culbute = false, ecrete = false;
    for (let i = 0; i < 60; i++) {
      const v = c.body.linvel();
      vPire = Math.min(vPire, v.y);
      if (c.state === 'tumbling') culbute = true;
      if (v.y < -54) ecrete = true;
      await new Promise((res) => setTimeout(res, 25));
    }
    return { vPire: +vPire.toFixed(2), culbute, ecrete, etat: c.state };
  });
  dire(!r.culbute && !r.ecrete,
    'changer d\'etage ne declenche aucune culbute parasite',
    `arrivee a ${Math.abs(r.vPire).toFixed(1)} m/s, etat final « ${r.etat} »`);
}

/* ── 9. LES PORTEES : CE QU'ON FRANCHIT, ET COMMENT ────────────────────────────────────
 *
 * La carte a d'abord ete batie sur les deux regles de la reference — un saut simple franchit
 * UN hexagone manquant, un saut-plongeon en franchit deux — et le rayon de l'hexagone avait
 * ete choisi pour qu'elles tombent juste. En agrandissant la dalle d'une fois et demie pour
 * la lisibilite, un trou d'un seul hexagone est passe de 4,16 m a 6,24 m : le saut plein
 * n'en vient plus a bout.
 *
 * Le franchissement passe donc TOUT ENTIER par le saut-plongeon. C'est une decision de jeu,
 * pas un accident, et c'est pour cela qu'on la mesure dans les deux sens : le saut ne doit
 * PAS suffire (sinon l'agrandissement n'aurait rien change au jeu), et le plongeon doit
 * suffire MEME A FATIGUE PLEINE (sinon un trou serait une condamnation, et le joueur
 * n'aurait aucun moyen de le savoir avant d'essayer).
 */
{
  const portee = (h) => T.maxSpeed * (Math.sqrt(2 * h / T.gravity)
    + Math.sqrt(2 * h / (T.gravity * T.fallMultiplier)));
  /*
   * Portee d'un SAUT-PLONGEON : on court jusqu'au sommet du saut, puis le plongeon remplace
   * la vitesse par la sienne — 11,5 m/s a l'horizontale et 4,2 m/s vers le haut. Trois
   * morceaux, donc : la montee a la vitesse de course, la remontee du plongeon, la chute.
   */
  const sautPlongeon = (apex) => {
    const tMontee = Math.sqrt(2 * apex / T.gravity);
    const hPlongeon = (T.diveUp * T.diveUp) / (2 * T.gravity);
    const tHaut = T.diveUp / T.gravity;
    const tChute = Math.sqrt(2 * (apex + hPlongeon) / (T.gravity * T.fallMultiplier));
    return T.maxSpeed * tMontee + T.diveForward * (tHaut + tChute);
  };
  const apexEpuise = T.jumpHeight * T.jumpFatigueFloor;
  const pFrais = portee(T.jumpHeight);
  const pdEpuise = sautPlongeon(apexEpuise);
  const pdFrais = sautPlongeon(T.jumpHeight);
  console.log(`portees : saut ${pFrais.toFixed(2)} m · saut-plongeon ${pdFrais.toFixed(2)} m `
    + `(${pdEpuise.toFixed(2)} m epuise) · trou d'un hexagone ${cotes.TROU_1.toFixed(2)} m`);

  dire(pFrais < cotes.TROU_1 - 0.4,
    'un trou d\'un hexagone ne se franchit PAS d\'un simple saut',
    `portee de saut ${pFrais.toFixed(2)} m contre un trou de ${cotes.TROU_1.toFixed(2)} m — `
    + 'la dalle agrandie a fait du plongeon le seul franchissement');
  dire(pdEpuise > cotes.TROU_1 + 0.5,
    'le saut-plongeon franchit un trou MEME a fatigue pleine',
    `${pdEpuise.toFixed(2)} m epuise contre ${cotes.TROU_1.toFixed(2)} m `
    + `(marge ${(pdEpuise - cotes.TROU_1).toFixed(2)} m)`);
  dire(pdFrais < cotes.TROU_2 - 0.5,
    'un trou de DEUX hexagones ne se franchit par aucun moyen',
    `saut-plongeon ${pdFrais.toFixed(2)} m contre ${cotes.TROU_2.toFixed(2)} m — `
    + 'creuser large est sans retour, et c\'est ce qui fait le jeu');
}

/* ── 10. LES ETAGES S'ELARGISSENT VERS LE BAS ──────────────────────────────────────────
 *
 * Fidelite a la reference, et c'est ce qui fait de la descente un CHOIX : on perd de la
 * hauteur, on gagne du sol. Un etage inferieur plus etroit rendrait la chute purement
 * punitive et la carte n'aurait plus qu'une seule facon de se jouer.
 */
{
  const croissant = etages.every((e, i) => i === 0 || e.total > etages[i - 1].total);
  dire(croissant, 'les etages s\'elargissent vers le bas',
    etages.map((e) => e.total).join(' < ') + ' hexagones');
}

/* ── 11. LA BOUE ELIMINE, ELLE NE FAIT PAS REAPPARAITRE ────────────────────────────────
 *
 * Sur les quatre autres cartes, passer sous `killY` coute une chute et rend la main au
 * dernier point de reprise. Ici, cela doit TERMINER la manche. Si la boue ne faisait que
 * renvoyer le joueur en haut, il n'y aurait plus rien a tenir, donc plus de jeu.
 */
{
  const r = await page.evaluate(async () => {
    const g = window.__probeGame(), a = g.arena, c = g.character;
    const chutesAvant = g.falls;
    c.respawn({ x: 0, y: a.killY - 2, z: 0 });
    for (let i = 0; i < 50; i++) {
      if (g.mode !== 'racing') break;
      await new Promise((res) => setTimeout(res, 40));
    }
    return {
      mode: g.mode,
      titre: document.getElementById('result-title')?.textContent ?? '',
      verdict: document.getElementById('verdict-texte')?.textContent ?? '',
      classe: document.getElementById('verdict')?.className ?? '',
      chutes: g.falls - chutesAvant,
    };
  });
  dire(r.mode === 'finished' && r.classe.includes('ko') && r.chutes === 0,
    'toucher la boue termine la manche au lieu de faire reapparaitre',
    `mode « ${r.mode} », bandeau « ${r.verdict} », ${r.chutes} reapparition(s)`);
}

/* ── 12. EST-CE UN JEU ? ───────────────────────────────────────────────────────────────
 *
 * LA question, et la seule que la geometrie ne sait pas trancher.
 *
 * Deux pilotes aux comportements opposes doivent obtenir deux issues opposees. Celui qui
 * reste plante doit TOMBER — sinon il suffit de se poser dans un coin et d'attendre, et il
 * n'y a pas d'epreuve. Celui qui joue proprement doit tenir nettement plus longtemps —
 * sinon l'adresse ne sert a rien et la carte est une loterie.
 *
 * Le pilote « propre » joue la strategie de la reference : tourner, en changeant d'appui
 * des que le sol commence a ceder, et descendre quand le voisinage est perce.
 */
async function pilote(strategie, limite = 100) {
  await manche(4242);
  await page.evaluate((strat) => {
    const g = window.__probeGame(), a = g.arena, c = g.character;
    const k = (code, bas) => dispatchEvent(new KeyboardEvent(bas ? 'keydown' : 'keyup', { code, bubbles: true }));
    const TOUCHES = { av: 'KeyW', ar: 'KeyS', ga: 'KeyA', dr: 'KeyD' };
    let enCours = { av: false, ar: false, ga: false, dr: false };
    const viser = (dx, dz) => {
      // Le repere des touches est celui de la camera, qui ne tourne pas ici : W va vers
      // -Z, D vers +X.
      const veut = { av: dz < -0.25, ar: dz > 0.25, ga: dx < -0.25, dr: dx > 0.25 };
      for (const n of Object.keys(veut)) {
        if (veut[n] !== enCours[n]) k(TOUCHES[n], veut[n]);
      }
      enCours = veut;
    };
    window.__pilote = { fini: false, tenu: 0, mode: 'racing', consommes: 0, y: 0, etage: 0 };
    /*
     * Le pilote REGARDE ou il met les pieds.
     *
     * Deux versions ont echoue avant celle-ci, et pour la meme raison de fond : elles
     * suivaient une trajectoire ecrite d'avance — un cercle, puis une spirale — au lieu de
     * lire le terrain. La spirale avancait de surcroit d'un pas par IMAGE, or le navigateur
     * sans fenetre tourne autour de dix images par seconde : le pilote se tournait les
     * pouces a un demi-metre par seconde et tombait sur place. Un pilote qui depend de la
     * cadence d'affichage ne mesure pas le jeu, il mesure la machine.
     *
     * Celui-ci fait ce que fait un joueur : il garde un cap, et si le sol manque devant
     * lui, il tourne jusqu'a trouver un appui. Le cap derive lentement, ce qui produit une
     * spirale quand le terrain le permet et un contournement quand il ne le permet pas.
     */
    let cap = 0.7;
    /*
     * PILOTE ECONOME — la strategie d'endurance de la reference (« hopping »), et le seul
     * moyen de savoir si une manche bien jouee se gagne.
     *
     * Il tient sa dalle jusqu'a ce qu'elle soit sur le point de partir, puis passe sur UNE
     * voisine. Trois versions ont echoue avant celle-ci, chacune pour une raison qui vaut
     * d'etre retenue :
     *
     *  1. une horloge fixe, sans regarder la dalle : 11,8 s, MOINS que le pilote qui court.
     *     Un pilote qui n'utilise pas l'information affichee mesure sa propre cecite.
     *  2. en lisant l'avancement du sursis, mais en s'arretant la ou il se trouvait : 75 s
     *     a un essai, 13 s au suivant. A cheval, sa capsule brule deux ou trois dalles par
     *     pause au lieu d'une, et le resultat depend de l'endroit ou il s'immobilise.
     *  3. en se recentrant par une direction recalculee a chaque image : 2,4 s. A 7,6 m/s
     *     et une dizaine d'images par seconde, un pas fait 76 cm — il depassait le centre,
     *     repartait en sens inverse, et sortait de l'etage du haut en oscillant.
     *
     * D'ou les POINTS DE PASSAGE. On ne vise pas une direction recalculee sans cesse mais
     * un point FIXE, jusqu'a l'avoir atteint. Un point de passage ne peut pas osciller : on
     * l'atteint, ou l'on continue d'aller vers lui. C'est la lecon du pilote des Dalles,
     * qui perdait une dalle par correction pour exactement la meme raison.
     */
    const NORMALES6 = [0, 1, 2, 3, 4, 5].map((i) => {
      const ang = Math.PI / 6 + (i * Math.PI) / 3;
      return [Math.cos(ang), Math.sin(ang)];
    });
    let cible = null, depart6 = 0;
    const jouerEconome = (p) => {
      const { PAS } = a.__cotes();
      if (cible) {
        const d = Math.hypot(cible.x - p.x, cible.z - p.z);
        // 0,7 m : un peu plus qu'un pas d'image. Viser plus serre demanderait une precision
        // que la cadence d'affichage n'autorise pas, et relancerait l'oscillation.
        if (d > 0.7) { viser((cible.x - p.x) / d, (cible.z - p.z) / d); return; }
        cible = null;
      }
      const sous = a.__sonde(p.x, p.y, p.z);
      const presse = sous.some((h) => h.etat !== 'posee' && h.u > 0.40);
      if (!presse && sous.length) { viser(0, 0); return; }
      /*
       * Il faut partir. On choisit une voisine INTACTE, mesuree depuis le CENTRE de la
       * dalle qu'on quitte et non depuis sa propre position : sinon le point de passage
       * herite du decalage qu'on cherchait justement a corriger, et l'erreur s'accumule
       * de saut en saut.
       */
      const base = sous[0] ?? { x: p.x, z: p.z };
      const ets = a.__etages();
      const et = ets.reduce((m, e) => (Math.abs(p.y - e.y) < Math.abs(p.y - m.y) ? e : m), ets[0]);
      for (let k = 0; k < 6; k++) {
        const [nx, nz] = NORMALES6[(depart6 + k) % 6];
        const cx = base.x + nx * PAS, cz = base.z + nz * PAS;
        if (Math.hypot(cx, cz) > et.rayon * 0.95) continue;
        if (!a.__intact(cx, cz, et.indice)) continue;
        cible = { x: cx, z: cz };
        // On fait tourner le point de depart du balayage : essayer toujours la meme
        // direction en premier ferait longer un bord, puis tomber au bout.
        depart6 = (depart6 + 1) % 6;
        viser(nx, nz);
        return;
      }
      viser(0, 0);   // cerne : plus rien d'intact autour. On tombera, et c'est le jeu.
    };

    const tick = () => {
      const p = c.body.translation();
      window.__pilote.tenu = g.runTime;
      window.__pilote.mode = g.mode;
      window.__pilote.consommes = a.__consommes();
      window.__pilote.y = +p.y.toFixed(2);
      if (g.mode !== 'racing') { window.__pilote.fini = true; viser(0, 0); return; }
      if (strat === 'immobile') viser(0, 0);
      else if (strat === 'econome') { jouerEconome(p); requestAnimationFrame(tick); return; }
      else {
        const ets = a.__etages();
        const et = ets.reduce((meilleur, e) =>
          (Math.abs(p.y - e.y) < Math.abs(p.y - meilleur.y) ? e : meilleur), ets[0]);
        window.__pilote.etage = et.indice;
        const { PAS } = a.__cotes();
        // On derive le cap vers l'exterieur : revenir sur ses propres trous est la faute
        // que la reference reproche aux debutants, et un cap fixe y mene tout droit.
        const versDehors = Math.atan2(p.z, p.x);
        cap += 0.035 * Math.sin(versDehors + Math.PI / 2 - cap);
        let choisi = null;
        // On essaie le cap, puis de part et d'autre, par ecarts croissants.
        for (const d of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2, 2.8, -2.8, Math.PI]) {
          const ang = cap + d;
          const cx = p.x + Math.cos(ang) * PAS * 1.15;
          const cz = p.z + Math.sin(ang) * PAS * 1.15;
          // Rester dans l'etage : viser au-dela du bord, c'est se jeter dans le vide.
          if (Math.hypot(cx, cz) > et.rayon * 0.95) continue;
          if (!a.__intact(cx, cz, et.indice)) continue;
          choisi = ang;
          break;
        }
        if (choisi === null) choisi = cap;   // plus rien de sur : on avance quand meme
        cap = choisi;
        viser(Math.cos(cap), Math.sin(cap));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, strategie);

  const t0 = Date.now();
  let dernier = null;
  while (Date.now() - t0 < limite * 1000) {
    dernier = await page.evaluate(() => window.__pilote);
    if (dernier.fini) break;
    await page.waitForTimeout(1500);
  }
  await page.evaluate(() => {
    for (const c of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) {
      dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
    }
  });
  return dernier;
}

const immobile = await pilote('immobile', 70);
console.log(`pilote immobile : tenu ${immobile.tenu.toFixed(1)} s, `
  + `${immobile.consommes} hexagones, mode « ${immobile.mode} »`);
dire(immobile.mode !== 'racing' && immobile.tenu < cotes.DUREE * 0.5,
  'rester immobile ne sauve pas : le sol part quand meme',
  `tombe au bout de ${immobile.tenu.toFixed(1)} s`);

const actif = await pilote('court', 150);
console.log(`pilote qui COURT : tenu ${actif.tenu.toFixed(1)} s, `
  + `${actif.consommes}/${cotes.TOTAL} hexagones, altitude finale ${actif.y}, mode « ${actif.mode} »`);

const econome = await pilote('econome', 150);
console.log(`pilote ECONOME : tenu ${econome.tenu.toFixed(1)} s, `
  + `${econome.consommes}/${cotes.TOTAL} hexagones, altitude finale ${econome.y}, mode « ${econome.mode} »`);

dire(actif.tenu > immobile.tenu * 2,
  'jouer sert a quelque chose : bouger tient bien plus longtemps que subir',
  `${actif.tenu.toFixed(1)} s en courant contre ${immobile.tenu.toFixed(1)} s en subissant`);

/*
 * CE QUE CE HARNAIS PEUT MESURER, ET CE QU'IL NE PEUT PAS.
 *
 * Il ne sait pas jouer cette carte au niveau ou elle se gagne. La strategie d'endurance
 * demande de se tenir a moins de 60 cm du centre de sa dalle — au-dela, la capsule mord sur
 * la voisine et l'on paie deux dalles au lieu d'une. Or le navigateur sans fenetre tourne
 * autour de dix images par seconde, et un pas d'image fait 76 cm : la precision requise est
 * hors de portee de l'instrument, quel que soit le pilote. Quatre versions l'ont montre.
 *
 * On mesure donc ce qui reste MESURABLE, et qui suffit a repondre a la question de fond :
 * economiser son sol ralentit-il vraiment sa consommation ? C'est un TAUX, pas une survie,
 * et un taux ne demande aucune precision de placement. S'il baisse, la strategie existe et
 * un joueur qui a des mains, lui, saura la convertir en secondes.
 */
const tauxCourt = actif.consommes / Math.max(0.1, actif.tenu);
const tauxEconome = econome.consommes / Math.max(0.1, econome.tenu);
console.log(`consommation : ${tauxCourt.toFixed(2)} hexagone/s en courant, `
  + `${tauxEconome.toFixed(2)} en economisant`);
dire(tauxEconome < tauxCourt * 0.8,
  'economiser son sol ralentit reellement sa consommation',
  `${tauxEconome.toFixed(2)} hexagone/s contre ${tauxCourt.toFixed(2)} en courant `
  + `(${((1 - tauxEconome / tauxCourt) * 100).toFixed(0)} % de moins)`);

/*
 * LA DUREE A TENIR — le seul reglage de cette carte qu'aucune mesure ne tranche seule.
 *
 * On l'encadre par une position de DESIGN, pas par une loi : la manche doit demander
 * nettement mieux qu'un jeu grossier a pleine vitesse — sinon elle se gagne sans rien
 * comprendre — sans exiger plus du double, faute de quoi elle deviendrait une epreuve de
 * patience. Le pilote qui court est l'etalon du bas ; le haut n'est pas mesurable ici.
 * C'est un chiffre a rejuger des qu'un humain y aura mis les mains.
 */
/*
 * LA DUREE A TENIR doit tomber DANS la fenetre, pas a cote.
 *
 * Sous le pilote qui court, la manche se gagnerait sans rien comprendre. Au-dessus du pilote
 * econome, elle serait ingagnable. La fenetre est mesuree a chaque execution : le jour ou
 * une cote de la carte bouge, c'est ce verdict qui dira que la duree ne suit plus.
 *
 * Les deux bornes sont ELLES-MEMES des mesures, jamais des constantes recopiees ici — et
 * quand un pilote est arrete par sa propre victoire, sa borne ne vaut plus rien : on le
 * signale au lieu de conclure.
 */
const borneAtteinte = econome.tenu >= cotes.DUREE - 0.5;
dire(cotes.DUREE > actif.tenu * 1.25 && (borneAtteinte || cotes.DUREE < econome.tenu * 0.9),
  'la duree a tenir tombe dans la fenetre mesuree',
  `${cotes.DUREE} s a tenir, pour une fenetre de ${actif.tenu.toFixed(0)} s (jeu grossier) `
  + (borneAtteinte
    ? 'a au moins autant (le pilote econome gagne avant de tomber)'
    : `a ${econome.tenu.toFixed(0)} s (jeu applique)`));
dire(actif.consommes > 0 && actif.consommes < cotes.TOTAL * 0.6,
  'le budget d\'hexagones est du bon ordre : ni infini, ni epuise d\'avance',
  `${actif.consommes} consommes sur ${cotes.TOTAL} (${(actif.consommes / cotes.TOTAL * 100).toFixed(0)} %)`);

/* ── 13. DETERMINISME ──────────────────────────────────────────────────────────────────
 *
 * Il n'y a presque rien a tirer au sort sur cette carte — chaque etage est une grille
 * pleine, et c'est fidele. La graine ne decide que du socle de depart. C'est peu, mais
 * c'est ce peu qui doit etre reproductible : en multijoueur le serveur impose la graine
 * aux seize joueurs, qui doivent partir du meme endroit.
 */
{
  await manche(4242);
  const a1 = await page.evaluate(() => window.__probeGame().arena.__depart());
  await manche(4242);
  const a2 = await page.evaluate(() => window.__probeGame().arena.__depart());
  await manche(99);
  const b = await page.evaluate(() => window.__probeGame().arena.__depart());
  dire(a1.q === a2.q && a1.r === a2.r, 'meme graine, meme socle de depart',
    `graine 4242 → (${a1.q}, ${a1.r}) deux fois`);
  dire(b.q !== a1.q || b.r !== a1.r, 'graine differente, ouverture differente',
    `graine 99 → (${b.q}, ${b.r})`);
}

console.log(erreurs.length ? `\nerreurs page : ${[...new Set(erreurs)].join(' | ')}` : '\nerreurs page : aucune');
const ok = verdicts.filter(Boolean).length;
console.log(`\n${ok}/${verdicts.length} verdicts au vert`);
await browser.close();
process.exit(ok === verdicts.length ? 0 : 1);
