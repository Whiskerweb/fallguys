/**
 * PLAN DE JEU — vue arriere, la camera du JEU, un personnage qui joue vraiment, et une
 * meute d'adversaires autour de lui.
 *
 * Les deux autres plans sont des plans de presentation : celui-ci doit ressembler a une
 * manche. La camera n'est donc PAS pilotee — on rend la main a `game.updateCamera`, et ce
 * qu'on filme est exactement ce qu'un joueur voit. Les obstacles tournent, les ballons
 * devalent, le personnage encaisse.
 *
 * ── LES FIGURANTS ────────────────────────────────────────────────────────────────
 * Le prototype est solo : il n'existe qu'un personnage a la fois, avec un corps physique.
 * Une manche a seize ne peut donc pas se filmer telle quelle. On ajoute des figurants —
 * de vrais modeles rigges, joues par leurs propres clips de course, mais SANS corps ni
 * collider : le harnais les deplace lui-meme, cale sur la position du joueur, et pose
 * leurs pieds sur le sol releve au rayon a chaque image.
 *
 * C'est une mise en scene, et elle est assumee : aucun d'eux ne joue, ils courent. Ce que
 * le plan montre honnetement, c'est la DENSITE visuelle d'une manche et les cinq
 * personnages du catalogue cote a cote. Aucun skin n'est invente : les six silhouettes a
 * l'ecran sont les cinq modeles livres, dont un double.
 *
 * Usage :
 *   node cine/plan-jeu.mjs                # les deux epreuves prevues
 *   node cine/plan-jeu.mjs course         # une seule
 *   node cine/plan-jeu.mjs --apercu       # huit images, pas de video
 */
import fs from 'node:fs/promises';
import {
  ouvrirScene, preparer, monterEpreuve, brouillard, decorLarge,
  tourner, poser, avancer, capturer, encoder,
  SORTIE, IMAGES, FPS,
} from './noyau.mjs';

const args = process.argv.slice(2);
const apercu = args.includes('--apercu');
const voulus = args.filter((a) => !a.startsWith('--'));

const GRAINE = 4242;
const JOUEUR = 'char-babytrump';

/** Une epreuve, sa duree, et l'instant des sauts (en secondes). */
const PLANS = [
  { id: 'course', duree: 26, sauts: [3.4, 8.1, 13.6, 19.2, 23.5], pilote: 'droit' },
  { id: 'dalles', duree: 22, sauts: [], pilote: 'chemin' },
];

/**
 * Les figurants. `dz` est compte vers l'AVANT du joueur (le parcours descend en Z, donc
 * un figurant devant lui a un dz negatif) ; `dx` l'ecarte lateralement.
 *
 * Ils sont tous devant : la camera est derriere le joueur, un figurant place en arriere
 * serait hors champ pendant tout le plan.
 */
const FIGURANTS = [
  { nom: 'char-techtitan', dz: -3.4, dx: -3.2, phase: 0.0 },
  { nom: 'char-grenouille', dz: -5.8, dx: 2.6, phase: 1.7 },
  { nom: 'char-diplomate', dz: -8.6, dx: -1.4, phase: 3.1 },
  { nom: 'char-captainleeky', dz: -6.9, dx: 4.4, phase: 4.6 },
  { nom: 'char-grenouille', dz: -11.5, dx: -4.6, phase: 5.9 },
];

/** Construit les figurants dans la scene et installe leur mise a jour par image. */
async function poserFigurants(page, specs) {
  await page.evaluate((specs) => {
    const T = window.__THREE, g = window.__probeGame();
    const liste = [];
    for (const s of specs) {
      const f = window.__probeFigurant(s.nom, 1.6);
      if (!f) { console.warn('[cine] figurant introuvable : ' + s.nom); continue; }
      // Deux groupes : le socle porte la position dans le monde, le pivot l'orientation.
      // Le modele sort de la fabrique les PIEDS sur y=0, il se pose donc tel quel.
      const socle = new T.Group(), pivot = new T.Group();
      pivot.rotation.y = Math.PI;            // yaw 0 regarde vers +Z ; on court vers -Z
      pivot.add(f.model);
      socle.add(pivot);
      g.view.scene.add(socle);
      liste.push({ ...s, socle, rig: f.rig, y: null });
    }
    window.__cineFig = liste;

    /**
     * SOL SOUS LES PIEDS — un rayon vertical, mais pas n'importe lequel.
     *
     * Premiere version : le rayon partait vingt-huit metres au-dessus du joueur. Sur ce
     * parcours il traversait d'abord une ARCHE, un tube ou une passerelle, et le figurant
     * se retrouvait pose dessus, dix metres en l'air et hors du cadre — les cinq
     * disparaissaient des la premiere arche. Rapier ne renvoyant que la premiere
     * intersection, on repart SOUS chaque touche trop haute jusqu'a trouver une cote
     * plausible : au niveau du joueur, a trois metres pres.
     */
    const solSous = (monde, R, x, z, yRef) => {
      let depart = yRef + 6;
      for (let essai = 0; essai < 5; essai++) {
        const h = monde.castRay(new R.Ray({ x, y: depart, z }, { x: 0, y: -1, z: 0 }), 60, true);
        if (!h) return null;
        const y = depart - h.timeOfImpact;
        if (y <= yRef + 3) return y < yRef - 10 ? null : y;   // un gouffre ne porte personne
        depart = y - 0.3;
      }
      return null;
    };

    /**
     * Une image de figurants. Ils ne sont pas simules : leur avance est celle du joueur,
     * a un decalage pres, et leurs pieds se posent sur le sol releve au rayon. C'est ce
     * qui les fait monter les rampes et suivre les devers sans rien savoir de la carte.
     */
    window.__cineMajFigurants = (dt, temps) => {
      const R = window.__RAPIER, jeu = window.__probeGame();
      const p = jeu.character.position, monde = jeu.arena.world;
      const vmax = window.__TUNING.maxSpeed;
      for (const f of window.__cineFig) {
        // Le decalage longitudinal respire : sans cela, cinq silhouettes gardent un
        // ecart au centimetre pres pendant vingt-six secondes, ce qui ne ressemble a
        // rien de vivant.
        const z = p.z + f.dz + Math.sin(temps * 0.55 + f.phase) * 1.4;
        const lateral = f.dx + Math.sin(temps * 1.15 + f.phase) * 0.9;
        /*
         * On CHERCHE du sol, on ne le suppose pas.
         *
         * La place voulue est a `lateral` metres de l'axe du joueur. Elle n'est pas
         * toujours praticable : la voie se retrecit, un trou s'ouvre, et sur Les Dalles
         * l'essentiel du damier est du vide. On balaie donc une bande de douze metres et
         * on retient la position PORTEUSE la plus proche de la place voulue. Sur un
         * parcours large cela ne change rien ; sur un damier, les figurants se rangent
         * d'eux-memes en file sur la ligne sure, ce qui est exactement ce qu'on y voit.
         */
        let x = p.x + lateral, sol = null, meilleur = Infinity;
        for (let d = -6; d <= 6; d += 0.75) {
          const ecart = Math.abs(d - lateral);
          if (ecart >= meilleur) continue;
          const y = solSous(monde, R, p.x + d, z, p.y);
          if (y == null) continue;
          meilleur = ecart; x = p.x + d; sol = y;
        }
        if (sol != null) f.y = f.y == null ? sol : f.y + (sol - f.y) * Math.min(1, dt * 12);
        f.socle.position.set(x, f.y ?? p.y - 0.8, z);
        f.rig.update(dt, vmax, vmax, 'grounded', 0);
      }
    };
  }, specs);
}

for (const plan of PLANS.filter((p) => !voulus.length || voulus.includes(p.id))) {
  const { page, fermer } = await ouvrirScene({
    largeur: 1920, hauteur: 1080,
    params: `&graine=${GRAINE}`,
    stockage: { 'tumble-model': JOUEUR },
  });
  await preparer(page);
  await monterEpreuve(page, plan.id);
  await decorLarge(page, false);
  // Le brouillard du jeu, tel qu'il est regle pour une camera de jeu : c'est lui qui
  // donne la profondeur d'une vue a hauteur de course.
  await brouillard(page, 120, 380);
  await poserFigurants(page, FIGURANTS);

  // Camera libre : c'est celle du jeu qui filme.
  const pose = () => null;

  /*
   * PILOTE. Il tient « avancer » en permanence, saute aux instants prevus, et surtout
   * DEBLOQUE.
   *
   * Le premier essai se contentait de maintenir la touche : le personnage s'est arrete
   * contre un rouleau a la douzieme seconde et les quatorze suivantes montrent un
   * personnage qui pousse un cylindre. Un obstacle qui bloque n'est pas un accident de
   * harnais, c'est le jeu — mais un plan de vingt-six secondes ne peut pas en dependre.
   * On mesure donc l'AVANCE REELLE sur les quatre derniers dixiemes de seconde : sous un
   * metre, le pilote saute ; si cela ne suffit pas, il se decale sur le cote, comme le
   * ferait un joueur.
   */
  /*
   * Le chemin sur, quand la carte en a un.
   *
   * Sur Les Dalles, un seul trace traverse le damier : le reste cede sous les pieds. Un
   * pilote qui tiendrait « avancer » tomberait au troisieme rang, et le plan montrerait
   * une chute, pas une manche. La scene expose son trace par `__sections()` — la meme
   * sonde que `diag/dalles.mjs` — donc on le SUIT au lieu de l'inventer.
   */
  const chemin = plan.pilote === 'chemin'
    ? (await page.evaluate(() => (window.__probeGame().arena.__sections?.() ?? [])
      .flatMap((s) => s.chemin).map((d) => ({ x: d.x, z: d.z })).sort((a, b) => b.z - a.z)))
    : [];

  let temps = 0, bloque = 0, cote = 0;
  const histoire = [];
  const enfoncees = new Set();
  const touche = async (code, bas) => {
    if (bas === enfoncees.has(code)) return;                 // pas de repetition inutile
    bas ? enfoncees.add(code) : enfoncees.delete(code);
    await page.evaluate(({ code, bas }) => {
      dispatchEvent(new KeyboardEvent(bas ? 'keydown' : 'keyup', { code, bubbles: true }));
    }, { code, bas });
  };
  const sauts = new Set(plan.sauts.map((s) => Math.round(s * FPS)));

  const pendant = async (i) => {
    if (i === 0) await touche('KeyW', true);

    if (i >= 0) {
      temps += 1 / FPS;
      const p = await page.evaluate(() => {
        const c = window.__probeGame().character.position;
        return [c.x, c.y, c.z];
      });
      histoire.push(p[2]);
      if (histoire.length > 12) histoire.shift();
      const avance = histoire.length >= 12 ? histoire[0] - histoire[histoire.length - 1] : 99;
      bloque = avance < 1 ? bloque + 1 : 0;

      if (chemin.length) {
        // Viser le point du trace le plus proche DEVANT soi, et corriger la derive.
        const but = chemin.find((d) => d.z < p[2] - 1.2) ?? chemin[chemin.length - 1];
        const ecart = but.x - p[0];
        await touche('KeyA', ecart < -0.35);
        await touche('KeyD', ecart > 0.35);
      } else if (bloque > 45 && cote === 0) {
        // Coince apres une seconde et demie de sauts : on longe l'obstacle.
        cote = Math.random() < 0.5 ? -1 : 1;
        await touche(cote < 0 ? 'KeyA' : 'KeyD', true);
      } else if (cote !== 0 && bloque === 0) {
        await touche(cote < 0 ? 'KeyA' : 'KeyD', false);
        cote = 0;
      }

      if (sauts.has(i) || (bloque > 0 && bloque % 14 === 0)) {
        await touche('Space', true);
        await touche('Space', false);
      }
    }

    await page.evaluate(({ dt, temps }) => window.__cineMajFigurants(dt, temps), { dt: 1 / FPS, temps });
  };

  console.log(`\n${plan.id} — vue joueur, ${FIGURANTS.length} figurants`);

  if (apercu) {
    const dossier = `${SORTIE}/apercu`;
    await fs.mkdir(dossier, { recursive: true });
    const total = Math.round(plan.duree * FPS);
    const pas = Math.floor(total / 8);
    for (let i = 0; i < total; i++) {
      await pendant(i);
      await poser(page, pose());
      await avancer(page, 1);
      if (i % pas === 0 && i / pas < 8) await capturer(page, `${dossier}/jeu-${plan.id}-${i / pas}.jpg`);
    }
    process.stdout.write('  apercu ecrit\n');
    fermer();
    continue;
  }

  const dossier = `${IMAGES}/jeu-${plan.id}`;
  await fs.rm(dossier, { recursive: true, force: true });
  await tourner(page, { dossier, duree: plan.duree, pose, pendant, prechauffe: 8 });
  await encoder(dossier, `${SORTIE}/jeu-${plan.id}.mp4`, FPS);
  await fs.rm(dossier, { recursive: true, force: true });
  fermer();
}

process.exit(0);
