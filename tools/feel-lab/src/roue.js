/**
 * LA ROUE — le disque d'UN joueur, son lancer, et la case sur laquelle il se cale.
 *
 * Ce module ne CALCULE rien. Il dessine ce que `economie.js` a déjà décidé : il consomme
 * `roueDe(mode, rang, mise)`, qui rend les DIX cases du rang du joueur — une par ligne du
 * tableau des issues, avec son gain en micro-USDG, son XP quand il n'y a pas d'argent, et
 * son POIDS. Aucun montant n'est recalculé ici, et il ne doit jamais l'être : le jour où
 * ce fichier ferait sa propre arithmétique, l'écran de fin cesserait d'annoncer ce que le
 * grand livre paie, et rien ne le signalerait.
 *
 * ─── UNE ROUE PAR JOUEUR, SELON SON PALIER ─────────────────────────────────
 *
 * Diamant pour le 1er, or pour le podium, argent pour la bande remboursée, bronze pour
 * ceux qui ont perdu leur mise. Deux joueurs du même palier n'ont pas la même roue : un
 * 2e et un 3e voient chacun LEUR colonne du tableau, et les montants diffèrent.
 *
 * ─── LA TAILLE D'UNE CASE EST SA PROBABILITÉ, et ça ne se négocie pas ──────
 *
 * Une case couvre `poids / 10 000` du disque : JACKPOT (2 %) est un éclat, STANDARD
 * (22 %) un large quartier. Sa POSITION sur le cercle est libre : `ordreDesCases` alterne
 * les lignes modestes et les lignes hautes pour que le disque ressemble à une roue de
 * foire et que le gros lot passe sous le curseur souvent. Redistribuer les positions est
 * une décision de lisibilité ; redimensionner une case serait un mensonge sur les cotes —
 * la seule chose que ce fichier n'a pas le droit de faire.
 *
 * ─── ELLE S'ARRÊTE OÙ LE SERVEUR A DIT ──────────────────────────────────────
 *
 * La ligne est tirée par le serveur au classement final (graine de roue) ; la roue se
 * cale sur la case de cette ligne. Le geste change le nombre de tours, jamais la case.
 *
 * ─── POURQUOI DU SVG, ET POURQUOI PAS UNE TRANSITION CSS ────────────────────
 *
 * SVG : net à toute taille, et le même composant sert à 52 px dans le ticket comme à 900 px
 * en bas de l'écran. `requestAnimationFrame` plutôt qu'une transition CSS pour le SON : un
 * cran à chaque case qui passe sous le curseur, et un état final lisible de façon
 * SYNCHRONE, ce dont les harnais ont besoin pour ne jamais attendre une durée.
 */

import { roueDe, montant, CASES_PAR_ROUE } from './economie.js';
import { sfx } from './audio.js';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Les paliers, du plus rare au plus commun.
 *
 * `teinte` sert au voile qui recouvre l'écran quand la roue se cale : c'est lui qui fait
 * dire « j'ai eu une roue diamant » plutôt que « j'ai eu 10,00 ».
 */
export const GRADES = {
  diamant: { nom: 'DIAMOND', teinte: '#8fe9ff', encre: '#04323f' },
  or:      { nom: 'GOLD',    teinte: '#ffdc72', encre: '#3d2a00' },
  argent:  { nom: 'SILVER',  teinte: '#d8dde8', encre: '#242a33' },
  bronze:  { nom: 'BRONZE',  teinte: '#c98a52', encre: '#2e1a0a' },
};

/** Le palier d'une ligne d'échelle, sous la forme que l'interface affiche. */
export const nomDuGrade = (gemme) => GRADES[gemme]?.nom ?? '—';

/*
 * Un compteur d'instances pour préfixer les identifiants SVG.
 *
 * Le ticket et la grande roue vivent dans la même page ; deux `<linearGradient id="or">`
 * feraient que le second écrase le premier, et l'un des deux disques perdrait ses
 * couleurs sans qu'aucune erreur ne soit levée.
 */
let compteur = 0;

/** Point du cercle, angle en degrés, zéro à midi, sens horaire. */
function point(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** Le chemin d'un secteur, de `a0` à `a1` degrés. */
function secteur(cx, cy, r, a0, a1) {
  // Un secteur de 360° ne se trace pas en un seul arc : le point de départ et le point
  // d'arrivée seraient confondus et le navigateur ne dessinerait rien.
  if (a1 - a0 >= 359.99) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const [x0, y0] = point(cx, cy, r, a0);
  const [x1, y1] = point(cx, cy, r, a1);
  const grand = a1 - a0 > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${grand} 1 ${x1} ${y1} Z`;
}

const el = (nom, attrs = {}) => {
  const n = document.createElementNS(SVG, nom);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/**
 * L'ORDRE DES CASES AUTOUR DU DISQUE.
 *
 * Le catalogue va de la ligne la plus plate à la plus pointue. Posées dans cet ordre, les
 * dix cases feraient un dégradé : tout le bas d'un côté, tout le haut de l'autre. On
 * alterne donc les deux bouts — 1re, 10e, 2e, 9e, 3e, 8e… — et le gros lot se retrouve
 * entre deux lignes modestes, comme sur une roue de foire.
 *
 * CE QUE ÇA NE CHANGE PAS : les chances. Chaque case garde exactement son angle.
 */
function ordreDesCases(n) {
  const out = [];
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    out.push(i);
    if (n - 1 - i > i) out.push(n - 1 - i);
  }
  return out;
}

/**
 * Les matières du disque : le métal de la jante, les familles de cases.
 * Chaque famille se reconnaît à sa COULEUR et à sa TEXTURE — un joueur daltonien et un
 * clip recompressé doivent pouvoir les distinguer.
 */
function defs(id) {
  const d = el('defs');

  const degrade = (nom, haut, bas, x2 = 0, y2 = 1) => {
    const g = el('linearGradient', { id: `${id}-${nom}`, x1: 0, y1: 0, x2, y2 });
    g.append(el('stop', { offset: '0%', 'stop-color': haut }),
      el('stop', { offset: '100%', 'stop-color': bas }));
    d.appendChild(g);
  };
  degrade('or', '#ffe884', '#e89a10');       // la meilleure case de CETTE roue : le gros lot
  degrade('paye', '#e0323a', '#8e1116');     // les cases qui paient
  degrade('xp', '#5b47d6', '#2a1d7a');       // les cases d'XP — de la progression, pas de l'argent
  degrade('rien', '#3a3b46', '#171820');     // celles qui ne donnent rien
  degrade('jante', '#fdfdff', '#b9bec9');    // le métal extérieur
  degrade('anneau', '#e23a34', '#6d0d12');   // l'anneau rouge sous la jante

  // Les facettes de l'or, en biais : une taille brillant, pas un aplat.
  const fac = el('pattern', { id: `${id}-facettes`, width: 26, height: 26,
    patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)' });
  fac.append(el('path', { d: 'M0 0 L13 26 L26 0', fill: 'none', stroke: '#fff',
    'stroke-width': 3, 'stroke-opacity': 0.34 }));
  d.appendChild(fac);

  // Le grain des cases rouges : un pointillé FIXE — aucun aléatoire, ici non plus.
  const grain = el('pattern', { id: `${id}-grain`, width: 16, height: 16, patternUnits: 'userSpaceOnUse' });
  for (const [x, y, r] of [[3, 4, 1.6], [11, 6, 1.1], [7, 12, 1.3], [13, 13, 1]]) {
    grain.append(el('circle', { cx: x, cy: y, r, fill: '#fff', 'fill-opacity': 0.09 }));
  }
  d.appendChild(grain);

  // Le relief de la jante : une lumière en haut, une ombre en bas.
  const relief = el('radialGradient', { id: `${id}-relief`, cx: '50%', cy: '32%', r: '72%' });
  relief.append(el('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 0.28 }),
    el('stop', { offset: '62%', 'stop-color': '#fff', 'stop-opacity': 0 }),
    el('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': 0.20 }));
  d.appendChild(relief);

  return d;
}

/** La famille d'une case : le gros lot de cette roue, les cases payées, l'XP, le reste. */
const familleDe = (c, plafond) => (
  c.gain > 0 && c.gain === plafond ? 'or' : (c.gain > 0 ? 'paye' : (c.xp > 0 ? 'xp' : 'rien'))
);
const MOTIF = { or: 'facettes', paye: 'grain' };

/**
 * Construit le disque : dix cases, chacune à l'angle de son poids.
 *
 * @param {object} p
 * @param {Array}  p.cases     les cases de `roueDe()` — gain, xp, poids
 * @param {number} p.taille    côté du carré SVG
 * @param {boolean} p.libelles écrire les montants (faux pour l'aperçu du ticket)
 */
function construire({ cases, taille, libelles }) {
  const id = `roue${++compteur}`;
  const cx = taille / 2;
  const cy = taille / 2;
  const R = taille / 2;
  const RJANTE = R * 0.90;     // bord extérieur des cases
  const total = cases.reduce((s, c) => s + c.poids, 0);
  const plafond = Math.max(...cases.map((c) => c.gain));

  const svg = el('svg', { viewBox: `0 0 ${taille} ${taille}`, class: 'roue-svg' });
  svg.appendChild(defs(id));

  // La jante, HORS du groupe qui tourne : une jante qui tourne avec le disque donne
  // l'impression que c'est le cadre qui bouge, pas la roue.
  const jante = el('g', { class: 'roue-jante' });
  jante.append(
    el('circle', { cx, cy, r: R * 0.995, fill: `url(#${id}-jante)` }),
    el('circle', { cx, cy, r: R * 0.945, fill: `url(#${id}-anneau)` }),
  );
  // Les boulons. Douze, à intervalle fixe : ils donnent l'échelle et la matière.
  for (let i = 0; i < 12; i++) {
    const [bx, by] = point(cx, cy, R * 0.945, i * 30 + 15);
    jante.append(
      el('circle', { cx: bx, cy: by, r: R * 0.026, fill: '#7a0d10' }),
      el('circle', { cx: bx, cy: by - R * 0.004, r: R * 0.021, fill: '#ffd24a' }),
    );
  }
  svg.appendChild(jante);

  const disque = el('g', { class: 'roue-disque' });
  svg.appendChild(disque);

  const quartiers = [];
  let a0 = 0;
  for (const index of ordreDesCases(cases.length)) {
    const c = cases[index];
    const pas = (c.poids / total) * 360;
    const a1 = a0 + pas;
    const famille = familleDe(c, plafond);

    const g = el('g', { class: `roue-q f-${famille}`, 'data-issue': c.issue });
    const chemin = secteur(cx, cy, RJANTE, a0, a1);
    g.appendChild(el('path', { d: chemin, fill: `url(#${id}-${famille})` }));
    if (MOTIF[famille]) g.appendChild(el('path', { d: chemin, fill: `url(#${id}-${MOTIF[famille]})` }));
    g.appendChild(el('path', { d: chemin, fill: 'none', stroke: '#20060a', 'stroke-width': taille * 0.005 }));

    /*
     * LE MONTANT SE LIT LE LONG DU RAYON, comme sur une vraie roue de foire.
     *
     * Écrit en travers, « 10.00 » ne tiendrait pas dans une case de 7° ; le long du rayon
     * il dispose de la moitié du disque. Les cases qui ne donnent RIEN restent vides ;
     * les cases d'XP l'écrivent, parce que c'est un gain — pas de l'argent, mais un gain.
     */
    if (libelles && (c.gain > 0 || c.xp > 0)) {
      const mid = a0 + pas / 2;
      const [tx, ty] = point(cx, cy, RJANTE * 0.60, mid);
      const t = el('text', {
        x: tx, y: ty, transform: `rotate(${mid - 90} ${tx} ${ty})`,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: `roue-montant m-${famille}`,
      });
      t.textContent = c.gain > 0 ? montant(c.gain) : `+${c.xp} XP`;
      g.appendChild(t);
    }

    disque.appendChild(g);
    quartiers.push({ ...c, a0, a1, pas, famille, noeud: g });
    a0 = a1;
  }

  // Le relief par-dessus les cases : c'est ce qui donne le volume.
  disque.appendChild(el('circle', { cx, cy, r: RJANTE, fill: `url(#${id}-relief)`, class: 'roue-relief' }));

  /*
   * LE MOYEU, avec son éclair. Il ne tourne PAS : sur une vraie roue, l'axe est fixe et
   * c'est le disque qui pivote autour. Le faire tourner donnait une toupie.
   */
  const moyeu = el('g', { class: 'roue-moyeu' });
  moyeu.append(
    el('circle', { cx, cy, r: R * 0.115, fill: '#fff' }),
    el('circle', { cx, cy, r: R * 0.098, fill: '#c8181f' }),
    el('circle', { cx, cy, r: R * 0.082, fill: '#8c0d12' }),
  );
  const u = R * 0.075;
  moyeu.append(el('path', {
    d: `M ${cx + u * 0.28} ${cy - u} L ${cx - u * 0.55} ${cy + u * 0.12}`
     + ` L ${cx - u * 0.02} ${cy + u * 0.12} L ${cx - u * 0.28} ${cy + u}`
     + ` L ${cx + u * 0.55} ${cy - u * 0.14} L ${cx + u * 0.02} ${cy - u * 0.14} Z`,
    fill: '#ffd24a', stroke: '#7a0d10', 'stroke-width': R * 0.012, 'stroke-linejoin': 'round',
  }));
  svg.appendChild(moyeu);

  return { svg, disque, quartiers, plafond };
}

/**
 * Le même disque, en petit et immobile — pour le ticket du lobby.
 *
 * C'est LE MÊME composant que la roue lançable, pas une seconde représentation. Par défaut
 * la roue du VAINQUEUR : c'est celle que le joueur vient chercher. Sans libellés : à 52 px,
 * un montant est un pâté.
 */
export function apercu(cible, { mode, mise, rang = 1 }) {
  const { cases } = roueDe(mode, rang, mise);
  cible.innerHTML = '';
  const { svg } = construire({ cases, taille: 1000, libelles: false });
  svg.classList.add('roue-apercu');
  cible.appendChild(svg);
}

/**
 * Une roue lançable.
 *
 * DEUX ÉLÉMENTS, ET C'EST NÉCESSAIRE :
 *
 *   `hote`    la scène — elle porte la position, les classes d'état et les gestes ;
 *   `montage` le point de montage du SVG, et LUI SEUL est vidé à chaque partie.
 *
 * Les confondre coûtait cher et sans un mot : `innerHTML = ''` sur la scène effaçait le
 * curseur, puis collait le SVG en élément STATIQUE sous une jante POSITIONNÉE — on voyait
 * un cercle vide, jante comprise, et rien n'était en erreur.
 *
 * Ce module ne décide pas de la mise en page, seulement du disque et de son mouvement.
 */
export function creerRoue({ hote, montage, voile = null }) {
  let etat = null;      // { cases, quartiers, disque, grade, rang }
  let angle = 0;        // rotation courante du disque, en degrés
  let issue = null;     // la ligne sur laquelle on doit se caler
  let gain = 0;
  let xp = 0;
  let anime = 0;        // handle rAF
  let promesse = null;  // resolve() du tour en cours

  const rendre = (angleDeg) => {
    if (etat) etat.disque.style.transform = `rotate(${angleDeg}deg)`;
  };

  /** La case d'une ligne — il y en a exactement une par ligne. */
  const quartierDe = (id) => etat?.quartiers.find((q) => q.issue === id) ?? null;

  function poser({ mode, rang, mise }) {
    const roue = roueDe(mode, rang, mise);
    montage.innerHTML = '';
    etat = { ...construire({ cases: roue.cases, taille: 1000, libelles: true }), cases: roue.cases, grade: roue.grade, rang };
    montage.appendChild(etat.svg);
    // Le palier colore la scène (CSS) : une roue diamant ne se présente pas comme une
    // roue de bronze, avant même de tourner.
    hote.dataset.palier = roue.grade;
    /*
     * ON NE DEMARRE PAS SOUS LA PREMIERE CASE.
     *
     * A rotation nulle, le curseur tombe sur la frontiere de la premiere case. La roue
     * avait donc l'air d'etre deja arrivee avant qu'on la lance. Une demi-case de decalage
     * la pose au milieu d'une case, et le geste retrouve son sens.
     */
    angle = etat.quartiers[0].pas / 2;
    rendre(angle);
  }

  return {
    /** Construit les cases de CE joueur. À appeler avant `montrer()`. */
    preparer(p) { poser(p); },

    /** La jante entre dans le champ. Elle n'est pas encore lançable. */
    montrer() {
      hote.classList.add('visible');
      hote.classList.remove('armee', 'calee');
    },

    /**
     * La roue s'arme : on connaît enfin la ligne tirée, donc l'endroit où elle doit
     * s'arrêter. Tant qu'elle n'est pas armée, la lancer ne ferait que tourner dans le
     * vide — et une roue qu'on peut lancer avant de savoir où elle tombe est exactement la
     * chose qu'il ne faut pas construire ici.
     */
    armer(issueId, montantGagne, xpGagnee = 0) {
      issue = issueId;
      gain = montantGagne;
      xp = xpGagnee;
      hote.classList.add('armee');
    },

    get armee() { return issue !== null; },
    get lancee() { return anime !== 0 || hote.classList.contains('calee'); },

    /**
     * Le lancer.
     *
     * `force` vient du geste (0 = clic simple, 1 = grand mouvement). Elle change le nombre
     * de tours et la durée — JAMAIS l'endroit où la roue s'arrête. La destination vient du
     * serveur ; le poignet ne décide de rien.
     *
     * @param {number} [force] 0..1
     * @param {boolean} [instantane] pour `?nointro` et les harnais : on saute le RÉCIT,
     *   jamais le RÉSULTAT.
     */
    tourner(force = 0.5, instantane = false) {
      if (issue === null || anime) return Promise.resolve(this.resultat());

      const q = quartierDe(issue);
      if (!q) return Promise.resolve(this.resultat());
      // Le centre de la CASE de cette ligne : c'est sa position sur le disque qui compte,
      // pas son numéro dans le catalogue (`ordreDesCases`).
      const cible = q.a0 + q.pas / 2;
      const tours = 4 + Math.round(force * 3);
      /*
       * On repart de la position COURANTE, pas de zero : le disque porte le demi-quartier
       * de decalage du depart, et il gardera l'angle du lancer precedent si l'on rejoue.
       */
      const depart = angle;
      const restant = (((-cible - depart) % 360) + 360) % 360;
      const fin = depart + tours * 360 + restant;

      /*
       * ─── L'ARRÊT EN TROIS TEMPS, ET LA CASE D'À CÔTÉ ─────────────────────────
       *
       * Demande du directeur produit : « sur Winamax, la roue ralentit progressivement,
       * on croit qu'elle va s'arrêter sur la grosse case… et elle s'arrête sur celle d'à
       * côté ». La courbe d'avant — une seule fonction d'assouplissement — passait toute
       * la fin du parcours en un mouvement imperceptible ; l'œil lisait un arrêt sec.
       *
       * On décrit donc une VITESSE plutôt qu'une position :
       *
       *   1. LE LANCER : la vitesse décroît linéairement, de vite à lent ;
       *   2. LA REPTATION : vitesse CONSTANTE et basse sur toute la case voisine — celle
       *      qui passe sous le curseur juste avant la case tirée. Chaque cran s'entend,
       *      le joueur a le temps de la lire et d'y croire ;
       *   3. L'ARRÊT : la vitesse tombe à zéro en une demi-seconde, au centre de la case.
       *
       * La reptation part de la frontière où la case voisine ENTRE sous le curseur. Le
       * disque tourne dans le sens des angles croissants, donc la case qui passe avant la
       * cible est celle dont `a0` est la fin `a1` de la cible.
       *
       * Rien ici ne change la DESTINATION : `fin` est fixée avant, par la ligne tirée. La
       * mise en scène ne touche que le chemin.
       */
      const voisine = etat.quartiers.find((k) => Math.abs(k.a0 - (q.a1 % 360)) < 1e-6) ?? q;
      const reptation = Math.min(voisine.pas + q.pas / 2, (fin - depart) * 0.5);
      const tRept = 1500 + force * 500;       // ms de reptation à vitesse constante
      const tArret = 550;                     // ms pour s'immobiliser au centre
      const vRept = reptation / (tRept + tArret / 2);   // deg/ms : reptation + arrêt = `reptation`
      const tLancer = 3200 + force * 1600;
      const aLancer = (fin - depart) - reptation;
      // Phase 1 : de vLancer à vRept, linéairement, sur aLancer degrés.
      const vLancer = Math.max(vRept * 1.001, (2 * aLancer) / tLancer - vRept);
      const duree = tLancer + tRept + tArret;
      /** L'angle parcouru à l'instant `t` (ms depuis le lancer) : l'intégrale du profil. */
      const parcours = (t) => {
        if (t <= tLancer) return vLancer * t - ((vLancer - vRept) * t * t) / (2 * tLancer);
        if (t <= tLancer + tRept) return aLancer + vRept * (t - tLancer);
        const u = Math.min(1, (t - tLancer - tRept) / tArret);
        return aLancer + vRept * tRept + vRept * tArret * (u - u * u / 2);
      };

      const caler = () => {
        anime = 0;
        rendre(fin);
        hote.classList.add('calee');
        q.noeud.classList.add('gagnant');
        hote.dataset.grade = etat.grade;
        if (voile) {
          voile.style.setProperty('--teinte', GRADES[etat.grade]?.teinte ?? '#2a2044');
          voile.classList.add('visible');
        }
        // Le gros lot de SA roue sonne comme un jackpot, quel que soit le palier.
        if (gain > 0) (q.famille === 'or' ? sfx.jackpot() : sfx.finish());
        promesse?.(this.resultat());
        promesse = null;
      };

      if (instantane) { caler(); return Promise.resolve(this.resultat()); }

      sfx.lancer();
      const t0 = performance.now();
      let dernierCran = -1;

      return new Promise((resolve) => {
        promesse = resolve;
        const pas = (t) => {
          const u = Math.min(1, (t - t0) / duree);
          // Le chemin suit le profil de vitesse ci-dessus ; à la fin, il tombe EXACTEMENT
          // sur `fin` — la case tirée —, quel que soit l'arrondi des phases.
          angle = u >= 1 ? fin : depart + Math.min(fin - depart, parcours(t - t0));
          rendre(angle);

          /*
           * UN CRAN PAR CASE PASSÉE SOUS LE CURSEUR. Les cases n'ont pas toutes la même
           * taille : on regarde laquelle est sous le curseur à cette image, et on joue le
           * cran quand elle change. Une case de 2 % fait un cran bref, une de 22 % un cran
           * long — c'est le rythme d'une vraie roue.
           */
          const sous = (((-angle) % 360) + 360) % 360;
          const cran = etat.quartiers.findIndex((k) => sous >= k.a0 && sous < k.a1);
          if (cran !== dernierCran) { dernierCran = cran; sfx.tick(); }

          if (u < 1) { anime = requestAnimationFrame(pas); return; }
          caler();
        };
        anime = requestAnimationFrame(pas);
      });
    },

    /** L'état final, lisible SYNCHRONEMENT : les harnais n'attendent jamais une durée. */
    resultat() {
      const g = etat?.grade ?? null;
      return {
        rang: etat?.rang ?? null,
        issue,
        gain,
        xp,
        gemme: g,
        grade: g ? GRADES[g].nom : '—',
        montant: montant(gain),
        cases: etat ? etat.quartiers.length : 0,
        calee: hote.classList.contains('calee'),
      };
    },

    cacher() {
      if (anime) cancelAnimationFrame(anime);
      anime = 0;
      issue = null;
      gain = 0;
      xp = 0;
      hote.classList.remove('visible', 'armee', 'calee');
      delete hote.dataset.grade;
      delete hote.dataset.palier;
      voile?.classList.remove('visible');
    },
  };
}

/** Dix cases, toujours — la promesse produit, relue par les harnais. */
export const CASES = CASES_PAR_ROUE;
