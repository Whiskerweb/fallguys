import * as THREE from 'three';

/**
 * SURVOL — la caméra qui présente le parcours avant le départ.
 *
 * Trois secondes et demie au-dessus du tracé, puis coupe franche sur la ligne de départ.
 * Ce n'est pas de la décoration : c'est la seule occasion qu'a le joueur de voir ce qui
 * l'attend. Dans un jeu où l'on mise, découvrir un obstacle en le percutant n'est pas une
 * surprise, c'est une information retenue.
 *
 * ── POURQUOI UN MODULE GÉNÉRIQUE ────────────────────────────────────────────────
 * Le survol doit exister sur TOUTES les épreuves. Écrire un rail à la main dans chaque
 * scène aurait garanti qu'il finisse juste sur une seule : la scène change, le rail ne
 * suit pas, et personne ne s'en aperçoit avant de regarder. Ici le rail est DÉRIVÉ du
 * tracé réel, donc il ne peut pas se désynchroniser de lui — modifier une carte déplace
 * son survol dans le même mouvement.
 *
 * ── LE PROBLÈME DES DEUX FORMATS ────────────────────────────────────────────────
 * `arena.trajectoires` n'a pas la même forme partout. La Course renvoie un objet de voies
 * nommées, chacune une liste de points ; Le Rondin renvoie une liste de segments décrits
 * par leurs cotes. Les Portes et Les Dalles n'en renvoient pas du tout.
 *
 * Plutôt que de traiter trois cas, on ramène tout à la même mesure : un ÉCHANTILLONNAGE
 * PAR Z. On verse tous les points connus dans des tranches de profondeur, on moyenne
 * chaque tranche, et on interpole les tranches vides. Une carte qui bifurque en deux voies
 * donne alors la ligne médiane — ce qui est exactement ce qu'un survol doit montrer — et
 * une carte sans données donne la droite du départ à l'arrivée, sans cas particulier.
 *
 * Une épreuve d'ARÈNE échappe à ce cadre : son départ et son arrivée sont à la même cote,
 * il n'y a rien à longer. Elle est traitée à part, en orbite (voir `construireSurvol`).
 */

/** Durée du survol, en secondes. Relevée sur la référence : 3,5 s. */
export const SURVOL_DUREE = 3.5;

const TRANCHES = 48;

/** Verse en vrac tous les points de `trajectoires`, quelle que soit sa forme. */
function pointsDe(trajectoires) {
  const out = [];
  if (!trajectoires) return out;
  const verser = (v) => {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const p of v) {
        if (typeof p?.z !== 'number') continue;
        if (typeof p.x === 'number' && typeof p.y === 'number') {
          out.push({ x: p.x, y: p.y, z: p.z });
        }
      }
      // Forme « segments » du Rondin : { z0, z1, x, y }. On la déplie en deux extrémités.
      for (const s of v) {
        if (typeof s?.z0 !== 'number' || typeof s?.z1 !== 'number') continue;
        out.push({ x: s.x ?? 0, y: s.y ?? 0, z: s.z0 });
        out.push({ x: s.x ?? 0, y: s.y ?? 0, z: s.z1 });
      }
    } else if (typeof v === 'object') {
      for (const sous of Object.values(v)) verser(sous);
    }
  };
  verser(trajectoires);
  return out;
}

/**
 * Ligne moyenne du parcours, échantillonnée régulièrement du départ à l'arrivée.
 *
 * Les tranches vides sont comblées par interpolation entre les tranches pleines qui les
 * encadrent — et non laissées à zéro. Une tranche à zéro aurait fait plonger la caméra
 * vers l'origine du monde à chaque trou de données, ce qui est précisément ce qui arrive
 * sur une carte qui décrit ses voies par morceaux.
 */
function ligneMoyenne(arena) {
  const zDepart = arena.spawn.z;
  const zFin = arena.finishZ;
  const span = zDepart - zFin;
  if (Math.abs(span) < 1) return null;

  const sommeX = new Array(TRANCHES).fill(0);
  const sommeY = new Array(TRANCHES).fill(0);
  const compte = new Array(TRANCHES).fill(0);

  for (const p of pointsDe(arena.trajectoires)) {
    const t = (zDepart - p.z) / span;
    if (t < 0 || t > 1) continue;
    const i = Math.min(TRANCHES - 1, Math.floor(t * TRANCHES));
    sommeX[i] += p.x; sommeY[i] += p.y; compte[i]++;
  }

  const pts = [];
  for (let i = 0; i < TRANCHES; i++) {
    const t = (i + 0.5) / TRANCHES;
    const z = zDepart - span * t;
    if (compte[i]) {
      pts.push(new THREE.Vector3(sommeX[i] / compte[i], sommeY[i] / compte[i], z));
    } else {
      pts.push(new THREE.Vector3(NaN, NaN, z));
    }
  }

  // Comblement : on cherche de part et d'autre la tranche pleine la plus proche.
  const dernierePleine = (depuis, sens) => {
    for (let i = depuis; i >= 0 && i < TRANCHES; i += sens) if (!Number.isNaN(pts[i].x)) return i;
    return -1;
  };
  for (let i = 0; i < TRANCHES; i++) {
    if (!Number.isNaN(pts[i].x)) continue;
    const a = dernierePleine(i, -1), b = dernierePleine(i, +1);
    if (a < 0 && b < 0) { pts[i].x = arena.spawn.x; pts[i].y = arena.spawn.y; continue; }
    if (a < 0) { pts[i].x = pts[b].x; pts[i].y = pts[b].y; continue; }
    if (b < 0) { pts[i].x = pts[a].x; pts[i].y = pts[a].y; continue; }
    const f = (i - a) / (b - a);
    pts[i].x = THREE.MathUtils.lerp(pts[a].x, pts[b].x, f);
    pts[i].y = THREE.MathUtils.lerp(pts[a].y, pts[b].y, f);
  }
  return pts;
}

/** Accélération puis décélération douces : un survol à vitesse constante démarre sec. */
const adoucir = (t) => t * t * (3 - 2 * t);

/**
 * Construit le survol d'une arène.
 *
 * @returns `{ duree, echantillon(t) }` où `t` va de 0 à 1 et `echantillon` renvoie
 *          `{ pos, look }`, deux `Vector3` prêts pour la caméra.
 */
export function construireSurvol(arena) {
  // Une scène peut reprendre la main en exposant `survol: [{ pos, look }, …]`. Aucune ne le
  // fait aujourd'hui ; le point est que le générique ne soit jamais un plafond.
  if (Array.isArray(arena.survol) && arena.survol.length >= 2) {
    const posC = new THREE.CatmullRomCurve3(arena.survol.map((k) => new THREE.Vector3(...k.pos)));
    const lookC = new THREE.CatmullRomCurve3(arena.survol.map((k) => new THREE.Vector3(...k.look)));
    return {
      duree: SURVOL_DUREE,
      echantillon(t) {
        const u = adoucir(THREE.MathUtils.clamp(t, 0, 1));
        return { pos: posC.getPoint(u), look: lookC.getPoint(u) };
      },
    };
  }

  /**
   * ARÈNE : quand le parcours n'avance pas en Z, on TOURNE AUTOUR.
   *
   * Tout ce module suppose qu'on progresse du départ vers l'arrivée le long de Z, ce qui
   * est vrai des quatre premières épreuves. Une épreuve d'ARÈNE — un damier d'hexagones où
   * l'on descend étage par étage — a son départ et son arrivée à la même cote : la ligne
   * moyenne est alors dégénérée, et le rail se réduisait à un point. La caméra restait
   * immobile pendant trois secondes et demie.
   *
   * Un survol de terrain longe ; un survol d'arène fait le tour. On produit donc un demi-arc
   * autour du centre, qui descend en se rapprochant — c'est ce qui montre une aire de jeu,
   * là où un travelling ne montrerait qu'un bord.
   */
  const span = arena.spawn.z - arena.finishZ;
  if (Math.abs(span) < 12) {
    const centre = new THREE.Vector3(arena.spawn.x, arena.spawn.y, arena.spawn.z);
    const RAYON = 46, HAUT_A = 30, HAUT_B = 16;
    return {
      duree: SURVOL_DUREE,
      echantillon(t) {
        const u = adoucir(THREE.MathUtils.clamp(t, 0, 1));
        const a = -Math.PI * 0.62 + u * Math.PI * 0.75;
        const r = RAYON * (1 - u * 0.28);
        return {
          pos: new THREE.Vector3(
            centre.x + Math.sin(a) * r,
            centre.y + THREE.MathUtils.lerp(HAUT_A, HAUT_B, u),
            centre.z + Math.cos(a) * r,
          ),
          look: new THREE.Vector3(centre.x, centre.y - 4, centre.z),
        };
      },
    };
  }

  const ligne = ligneMoyenne(arena);
  const courbe = ligne
    ? new THREE.CatmullRomCurve3(ligne)
    : new THREE.CatmullRomCurve3([
      arena.spawn.clone(),
      new THREE.Vector3(arena.spawn.x, arena.spawn.y, arena.finishZ),
    ]);

  /**
   * Hauteur et recul de la caméra.
   *
   * L'inclinaison qui en résulte, atan(15/17) ≈ 41°, est celle de la référence : assez
   * plongeante pour lire le tracé d'un coup d'œil, assez rasante pour que le relief garde
   * du volume. À la verticale on verrait une carte, pas un parcours.
   */
  const HAUT_DEBUT = 22, HAUT_FIN = 15;
  const RECUL = 17;
  const AVANCE = 0.09;   // le regard précède la caméra de 9 % du parcours

  return {
    duree: SURVOL_DUREE,
    echantillon(t) {
      const u = adoucir(THREE.MathUtils.clamp(t, 0, 1));
      const p = courbe.getPoint(u);
      const cible = courbe.getPoint(Math.min(1, u + AVANCE));
      // La caméra descend au fil du survol : on arrive sur le parcours au lieu de le
      // longer, ce qui donne à la coupe finale une raison d'être — on est déjà en place.
      const haut = THREE.MathUtils.lerp(HAUT_DEBUT, HAUT_FIN, u);
      return {
        pos: new THREE.Vector3(p.x, p.y + haut, p.z + RECUL),
        look: new THREE.Vector3(cible.x, cible.y + 1.5, cible.z),
      };
    },
  };
}
