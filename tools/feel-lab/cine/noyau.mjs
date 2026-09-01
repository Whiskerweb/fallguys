/**
 * NOYAU CINEMA — rendre le jeu en video, image par image, sans dependre de la vitesse
 * de la machine.
 *
 * ── LE PROBLEME QUE CE FICHIER RESOUT ───────────────────────────────────────────
 * Le jeu tourne dans un navigateur pilote par Playwright, en rendu LOGICIEL : entre
 * deux images il peut s'ecouler une demi-seconde. Filmer l'ecran en temps reel donnerait
 * donc une video a trois images par seconde, saccadee, et dont la duree ne serait pas
 * reproductible d'une machine a l'autre.
 *
 * On ne filme pas le jeu : on le DEROULE. Le temps du jeu est remplace par une horloge
 * virtuelle qui n'avance que lorsqu'on le lui demande, d'exactement 1/FPS seconde. Chaque
 * image rendue vaut donc 1/FPS seconde de film, quel que soit le temps reel qu'elle a
 * coute a calculer. La video sort fluide meme si le rendu prend une seconde par image.
 *
 * Trois pieces :
 *   1. `INIT` — injecte AVANT le chargement de la page. Il detourne `requestAnimationFrame`
 *      (les callbacks sont mis en file au lieu d'etre appelees par le navigateur) et
 *      `performance.now` (source de temps de `THREE.Clock`). `__cineAvancer(ms)` fait
 *      avancer l'horloge puis vide la file : une image, exactement.
 *   2. `preparer()` — prend la main sur la camera. La boucle de jeu calcule SA camera a
 *      chaque image ; on ne la modifie pas, on repose la notre juste avant le rendu, en
 *      enveloppant `composer.render`. Aucune ligne du jeu n'est touchee.
 *   3. `capturer()` — lit le canevas WebGL. `preserveDrawingBuffer` est force a la
 *      creation du contexte, sinon `toDataURL` renvoie du noir hors du cycle de rendu
 *      (piege documente dans diag/README.md).
 *
 * Le HUD n'a pas a etre masque : on lit le CANEVAS, pas la page. L'interface est en DOM,
 * elle n'y figure donc jamais.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const PORT = process.env.CINE_PORT ?? '5399';
export const FPS = Number(process.env.CINE_FPS ?? 30);

/** Chemins absolus : un plan doit sortir au meme endroit d'ou qu'on lance la commande. */
export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SORTIE = path.join(RACINE, 'shots/cine');
/** Les images intermediaires sont volumineuses et jetables : hors du depot. */
export const IMAGES = process.env.CINE_IMAGES ?? path.join(os.tmpdir(), 'cine-fallguys');

/** Script injecte dans la page avant tout autre code. */
const INIT = `(() => {
  let vt = 0;
  Object.defineProperty(performance, 'now', { value: () => vt, configurable: true });
  const file = [];
  window.requestAnimationFrame = (cb) => { file.push(cb); return file.length; };
  window.cancelAnimationFrame = () => {};
  window.__cineAvancer = (ms) => {
    vt += ms;
    const lot = file.splice(0);
    for (const cb of lot) { try { cb(vt); } catch (e) { console.error('[cine] ' + e.message); } }
    return lot.length;
  };
  // Sans ceci, lire le canevas hors du cycle de rendu renvoie une image noire.
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2') attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return gc.call(this, type, attrs);
  };
})();`;

/**
 * Ouvre le jeu, attend la fin du chargement.
 *
 * `attente: 'polling'` partout : `waitForFunction` sonde par defaut via
 * `requestAnimationFrame`, qu'on vient justement de neutraliser — il attendrait
 * indefiniment.
 */
export async function ouvrirScene({ largeur = 1280, hauteur = 720, params = '', silence = false, stockage = null } = {}) {
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--mute-audio',
    ],
  });
  const fermer = () => { try { browser.close(); } catch { /* deja ferme */ } };
  process.on('exit', fermer);
  process.on('SIGINT', () => { fermer(); process.exit(130); });

  const page = await browser.newPage({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(240000);
  await page.addInitScript(INIT);
  /*
   * Le personnage se choisit AVANT le chargement.
   *
   * `cosmetics` lit `localStorage` a l'initialisation du module et n'est pas expose au
   * harnais. Poser la cle ici, dans un script d'initialisation, revient exactement a
   * avoir clique la tuile dans la vitrine avant de lancer la partie : le jeu emprunte le
   * meme chemin de code, on ne lui greffe pas une porte derobee.
   */
  if (stockage) {
    await page.addInitScript((paires) => {
      for (const [k, v] of Object.entries(paires)) localStorage.setItem(k, v);
    }, stockage);
  }
  const erreurs = [];
  page.on('pageerror', (e) => { erreurs.push(String(e).slice(0, 200)); if (!silence) console.error('[page]', String(e).slice(0, 160)); });
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)); });

  const url = `http://127.0.0.1:${PORT}/?nointro${params}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && getComputedStyle(l).display === 'none';
  }, null, { polling: 200, timeout: 300000 });

  return { browser, page, erreurs, fermer };
}

/**
 * Installe la prise de controle de la camera et les reglages propres au cinema.
 *
 * Le brouillard du jeu commence a 120 m et sature a 380 : cadre pour une camera de jeu
 * posee huit metres derriere le joueur, il efface entierement une carte vue de loin. Un
 * plan large en a donc son propre, et la camera voit plus loin.
 */
export async function preparer(page) {
  await page.evaluate(() => {
    const g = window.__probeGame();
    const v = g.view;
    if (!v.composer.__cine) {
      const rendre = v.composer.render.bind(v.composer);
      v.composer.render = (...a) => {
        const k = window.__cineCam;
        if (k) {
          const cam = v.camera;
          cam.position.set(k.pos[0], k.pos[1], k.pos[2]);
          // `up` incline la camera autour de son axe de visee. Une camera qui s'inscrit
          // dans son virage donne a un vol la fluidite d'un plan aerien ; sans lui, un
          // zigzag rapide ressemble a un glissement lateral.
          if (k.up) cam.up.set(k.up[0], k.up[1], k.up[2]); else cam.up.set(0, 1, 0);
          cam.lookAt(k.look[0], k.look[1], k.look[2]);
          if (k.fov && cam.fov !== k.fov) { cam.fov = k.fov; cam.updateProjectionMatrix(); }
          // L'ombre porte sur une boite de 92 m centree sur sa cible : sans la deplacer,
          // un plan large n'a d'ombres qu'autour du joueur.
          if (k.ombre !== false) v.followShadow({ x: k.look[0], y: k.look[1], z: k.look[2] });
        }
        rendre(...a);
      };
      v.composer.__cine = true;
    }
    window.__cineCam = null;
    // Portee de vue et brouillard de plan large.
    v.camera.far = 3000;
    v.camera.updateProjectionMatrix();
    for (const f of [v.fog, v.fogNuit]) { if (f) { f.near = 300; f.far = 1100; } }

    /**
     * ENVELOPPE JOUABLE — la boite qu'il faut cadrer.
     *
     * `Box3.setFromObject(arena.group)` mesure 1300 m de large sur les cinq cartes : le
     * decor lointain (mer, anneau d'iles, plan de sol) y entre au meme titre que la piste.
     * Une camera calee dessus se retrouve a un kilometre, et le brouillard a mange la
     * carte bien avant. On ne garde donc que les maillages de TAILLE HUMAINE et proches
     * de l'axe : ce qui reste est le terrain qu'on vient filmer.
     */
    window.__cineEnveloppe = (group, zDepart, zFin) => {
      const T = window.__THREE;
      // Couloir de jeu : 90 m de part et d'autre de l'axe, 60 m avant le depart et apres
      // l'arrivee. Sur L'Hexagone, dont le depart et l'arrivee sont a la meme cote, c'est
      // ce couloir qui ecarte les iles de decor posees a 300 m.
      const zMin = Math.min(zDepart, zFin) - 60, zMax = Math.max(zDepart, zFin) + 60;
      const boite = new T.Box3();
      const tmp = new T.Box3(), taille = new T.Vector3(), centre = new T.Vector3();
      group.traverse((o) => {
        if (!o.isMesh || o.userData.isOutline) return;
        tmp.setFromObject(o);
        if (!Number.isFinite(tmp.min.x)) return;
        tmp.getSize(taille); tmp.getCenter(centre);
        if (taille.x > 200 || taille.z > 200) return;   // sol, mer, anneau de decor
        if (Math.abs(centre.x) > 100) return;
        if (centre.z < zMin || centre.z > zMax) return;
        boite.union(tmp);
      });
      return boite.isEmpty() ? null
        : [boite.min.x, boite.min.y, boite.min.z, boite.max.x, boite.max.y, boite.max.z];
    };

    /**
     * DECOR DE PLAN LARGE.
     *
     * Deux details qu'une camera de jeu ne rencontre jamais et qu'un plan aerien montre
     * aussitot : le BORD du plan d'eau, qui s'arrete a 450 m et laisse voir le vide, et
     * les NUAGES, poses a 42-72 m — soit en dessous d'une camera d'orbite, qui filme
     * alors la carte a travers eux. On repousse le premier et on remonte les seconds.
     *
     * Les nuages se remontent enfant par enfant : `animateSky` REECRIT `clouds.position.y`
     * a chaque image, un decalage pose sur le groupe serait efface a l'image suivante.
     */
    window.__cineDecorLarge = (group, actif) => {
      const T = window.__THREE;
      const tmp = new T.Box3(), taille = new T.Vector3();
      group.traverse((o) => {
        if (!o.isMesh) return;
        if (o.userData.cineSol === undefined) {
          tmp.setFromObject(o); tmp.getSize(taille);
          o.userData.cineSol = taille.x > 400 && taille.y < 8;
          o.userData.cineEchelle = [o.scale.x, o.scale.z];
        }
        if (!o.userData.cineSol) return;
        const [sx, sz] = o.userData.cineEchelle;
        o.scale.x = actif ? sx * 3 : sx;
        o.scale.z = actif ? sz * 3 : sz;
      });
      for (const n of v.clouds.children) {
        if (n.userData.cineY === undefined) n.userData.cineY = n.position.y;
        n.position.y = n.userData.cineY + (actif ? 95 : 0);
      }
    };
  });
}

/** Repousse le bord du plan d'eau et remonte les nuages — voir `__cineDecorLarge`. */
export async function decorLarge(page, actif = true) {
  await page.evaluate((actif) => {
    const g = window.__probeGame();
    if (g.arena) window.__cineDecorLarge(g.arena.group, actif);
  }, actif);
}

/** Retablit un brouillard serre : utile pour les plans rapproches, ou il fait la profondeur. */
export async function brouillard(page, near, far) {
  await page.evaluate(({ near, far }) => {
    const v = window.__probeGame().view;
    for (const f of [v.fog, v.fogNuit]) { if (f) { f.near = near; f.far = far; } }
  }, { near, far });
}

/**
 * Construit l'epreuve demandee et la met en jeu, sans intro ni decompte.
 * `graine` fixe la carte : deux tournages du meme plan donnent la meme image.
 */
export async function monterEpreuve(page, id, { cacherJoueur = false } = {}) {
  return page.evaluate(({ id, cacherJoueur }) => {
    const g = window.__probeGame();
    const jeu = window.__MINIGAMES.find((m) => m.id === id);
    g.partie = { parcours: [jeu], index: 0, temps: [], chutes: 0 };
    g.startRace();
    g.countdown = 0;                       // le monde est vivant tout de suite
    document.getElementById('countdown')?.classList.add('hidden');
    if (cacherJoueur) g.character.container.visible = false;
    const a = g.arena;
    const B = new window.__THREE.Box3().setFromObject(a.group);
    return {
      nom: jeu.name,
      spawn: [a.spawn.x, a.spawn.y, a.spawn.z],
      finishZ: a.finishZ,
      killY: a.killY,
      survie: !!a.survie,
      boite: [B.min.x, B.min.y, B.min.z, B.max.x, B.max.y, B.max.z],
      jouable: window.__cineEnveloppe(a.group, a.spawn.z, a.finishZ),
      // Les points de reprise sont poses SUR le chemin jouable par chaque scene : c'est
      // le seul squelette de trace que les cinq epreuves ont en commun.
      checkpoints: (a.checkpoints ?? []).map((c) => [c.x, c.y, c.z]),
    };
  }, { id, cacherJoueur });
}

/**
 * RAIL — le trace du terrain, releve AU RAYON plutot qu'ecrit a la main.
 *
 * Deux epreuves sur cinq exposent des `trajectoires`, et pas dans le meme format ; les
 * trois autres n'exposent rien. Ecrire un trace par carte aurait garanti qu'il se
 * desynchronise a la premiere modification. On sonde donc le monde physique lui-meme.
 *
 * ── POURQUOI ON MARCHE, ET POURQUOI ON PREND LE PLUS HAUT ───────────────────────
 * Premiere version : une nappe de rayons sur cinquante-deux metres de large, et la
 * MEDIANE des hauteurs touchees. Elle donnait la PELOUSE. La piste ne fait qu'une
 * quinzaine de metres de large sur les cinquante sondes : la moitie des rayons tombent a
 * cote, et la mediane suit donc le terrain naturel, pas le terrain jouable. Sur Le
 * Rondin, elle donnait le fond du lagon.
 *
 * On MARCHE donc le long du parcours : chaque tranche est sondee autour de la position
 * de la precedente, on retient la surface la PLUS HAUTE — une piste de jeu est toujours
 * posee au-dessus de ce qui l'entoure — et le centre lateral est la moyenne des sondes
 * qui touchent cette surface-la. Le rail ne peut donc pas glisser hors de la piste : il
 * faudrait pour cela qu'elle disparaisse d'un coup sur quatorze metres.
 *
 * Une derniere finesse : chaque rayon repart SOUS toute intersection situee bien
 * au-dessus de la tranche precedente. Sinon la premiere arche venue devient le sol.
 *
 * @returns liste de `{ x, y, z }` du depart a l'arrivee.
 */
export async function releverRail(page, { tranches = 56, demiLargeur = 14, pas = 1 } = {}) {
  /*
   * Une arene qui vient d'etre construite ne repond a AUCUN rayon.
   *
   * Rapier tient ses requetes de scene dans une structure d'acceleration mise a jour par
   * `world.step()`. Tant que le monde n'a pas fait un pas, `castRay` renvoie null partout
   * — et le rail retombait alors sur son repli, une ligne parfaitement droite a la
   * hauteur du depart. Rien ne le signalait : les plans restaient plausibles, ils ne
   * suivaient simplement plus le terrain. On fait donc tourner deux images d'abord.
   */
  await avancer(page, 2);
  return page.evaluate(({ tranches, demiLargeur, pas }) => {
    const g = window.__probeGame();
    const R = window.__RAPIER;
    const a = g.arena, monde = a.world;
    const zA = a.spawn.z, zB = a.finishZ;

    /**
     * Premiere surface sous `(x, z)` qui ne soit pas perchee bien au-dessus de `yRef`.
     *
     * `timeOfImpact`, et non `toi` : rapier a renomme le champ, et l'ancien nom ne leve
     * aucune erreur — il renvoie `undefined`, donc une cote NaN, donc un rail entierement
     * plat qu'aucune image ne trahit. Le jeu lui-meme lit ce nom-la
     * (`scenes/hexagone.js`, `__ray`).
     */
    const solSous = (x, z, yRef) => {
      let depart = yRef + 16;
      for (let essai = 0; essai < 6; essai++) {
        const h = monde.castRay(new R.Ray({ x, y: depart, z }, { x: 0, y: -1, z: 0 }), 160, true);
        if (!h) return null;
        const y = depart - h.timeOfImpact;
        if (y <= yRef + 6) return y;      // 6 m : de quoi accepter une rampe, pas une arche
        depart = y - 0.3;
      }
      return null;
    };

    const pts = [];
    let cx = a.spawn.x, cy = a.spawn.y - 0.8;      // les pieds, pas le centre de la capsule
    for (let i = 0; i < tranches; i++) {
      const z = zA + (zB - zA) * (i / (tranches - 1));
      const touches = [];
      for (let d = -demiLargeur; d <= demiLargeur; d += pas) {
        const y = solSous(cx + d, z, cy);
        // Ce qui est dix metres plus bas n'est pas la piste : c'est le terrain naturel,
        // l'eau du lagon, ou le vide sous un damier.
        if (y != null && y > cy - 10) touches.push({ x: cx + d, y });
      }
      if (!touches.length) { pts.push({ x: cx, y: cy, z }); continue; }
      const plafond = Math.max(...touches.map((t) => t.y));
      const dessus = touches.filter((t) => t.y > plafond - 1);
      // Amorti sur la hauteur : une caisse ou un plot posé sur la piste ne doit pas
      // emporter le rail d'un metre d'une tranche a l'autre.
      cy += (plafond - cy) * 0.7;
      cx = dessus.reduce((s, t) => s + t.x, 0) / dessus.length;
      pts.push({ x: cx, y: cy, z });
    }
    return pts;
  }, { tranches, demiLargeur, pas });
}

/** Avance le jeu d'une image de film (1/FPS seconde de temps de jeu). */
export async function avancer(page, images = 1, fps = FPS) {
  await page.evaluate(({ images, fps }) => {
    for (let i = 0; i < images; i++) window.__cineAvancer(1000 / fps);
  }, { images, fps });
}

/** Pose la camera pour l'image a venir. */
export async function poser(page, cam) {
  await page.evaluate((k) => { window.__cineCam = k; }, cam);
}

/** Ecrit l'image courante du canevas. */
export async function capturer(page, chemin) {
  const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/jpeg', 0.94));
  await fs.writeFile(chemin, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
}

/**
 * Tourne un plan : `pose(t)` renvoie la camera pour l'instant t (0 a 1), et
 * `pendant(i)` est appele avant chaque image pour animer ce qui n'est pas la camera.
 */
export async function tourner(page, { dossier, duree, fps = FPS, pose, pendant = null, prechauffe = 0 }) {
  await fs.mkdir(dossier, { recursive: true });
  const total = Math.round(duree * fps);
  // Prechauffe : quelques images jouees sans etre gardees, le temps que la physique se
  // pose et que les melanges d'animation atteignent leur regime. La premiere image d'un
  // plan montre sinon un personnage en pose de liaison.
  for (let i = 0; i < prechauffe; i++) {
    if (pendant) await pendant(-1, page);
    await poser(page, await pose(0));
    await avancer(page, 1, fps);
  }
  const debut = Date.now();
  for (let i = 0; i < total; i++) {
    const t = total === 1 ? 0 : i / (total - 1);
    if (pendant) await pendant(i, page);
    await poser(page, await pose(t));
    await avancer(page, 1, fps);
    await capturer(page, `${dossier}/f${String(i).padStart(5, '0')}.jpg`);
    if (i % 30 === 0 || i === total - 1) {
      const ms = (Date.now() - debut) / (i + 1);
      process.stdout.write(`\r    image ${i + 1}/${total}  ${ms.toFixed(0)} ms/img  reste ~${Math.round(ms * (total - i - 1) / 1000)} s   `);
    }
  }
  process.stdout.write('\n');
  return total;
}

/** Assemble les images en MP4 lisible partout (h264, yuv420p). */
export async function encoder(dossier, sortie, fps = FPS) {
  await fs.mkdir(sortie.slice(0, sortie.lastIndexOf('/')), { recursive: true });
  await execFileP('ffmpeg', [
    '-y', '-framerate', String(fps), '-i', `${dossier}/f%05d.jpg`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sortie,
  ]);
  const { size } = await fs.stat(sortie);
  console.log(`  → ${sortie}  (${(size / 1e6).toFixed(1)} Mo)`);
}

// ── Outils de trajectoire ────────────────────────────────────────────────────────

/** Accelere puis ralentit : un mouvement de camera a vitesse constante demarre sec. */
export const adoucir = (t) => t * t * (3 - 2 * t);
export const lerp = (a, b, t) => a + (b - a) * t;
export const melange = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
