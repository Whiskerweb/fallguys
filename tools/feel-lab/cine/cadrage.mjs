/**
 * CADRAGE — de quoi placer une camera sans jamais ecrire une coordonnee a la main.
 *
 * Trois outils, et un seul principe : tout se DEDUIT de la carte mesuree. Une epreuve
 * qui s'allonge ou qui grandit deplace ses plans dans le meme mouvement, ce qu'un rail
 * ecrit en dur ne ferait pas.
 */
import * as THREE from 'three';

/** Champ vertical du jeu, en radians. Le champ horizontal en decoule via le format. */
export const FOV = 50;
const TAN_V = Math.tan(((FOV / 2) * Math.PI) / 180);
const TAN_H = TAN_V * (16 / 9);

/**
 * Distance a laquelle une boite tient dans le cadre, avec `air` de marge.
 *
 * On prend le maximum des deux contraintes — largeur vue en diagonale, et HAUTEUR. Sans
 * la seconde, une carte verticale comme L'Hexagone (49 m de large, 68 m de haut) se
 * cadrait sur ses 49 m : la camera se retrouvait a l'interieur de la tour, entre deux
 * echafaudages.
 */
export function rayonDeCadrage(jouable, air = 1.1) {
  const [x0, y0, z0, x1, y1, z1] = jouable;
  const demiDiag = Math.hypot(x1 - x0, z1 - z0) / 2;
  const demiHaut = (y1 - y0) / 2;
  return Math.max(30, (demiDiag * air) / TAN_H, (demiHaut * air) / TAN_V);
}

/**
 * PROFIL DE VITESSE — progression de 0 a 1 avec des extremites adoucies.
 *
 * `adoucir` sur toute la duree donnerait un mouvement lent-vite-lent : sur une orbite de
 * vingt secondes, cela se lit comme un balancement, pas comme un tour. On veut une
 * vitesse CONSTANTE au milieu, qui s'installe et se retire sur les bords. La courbe de
 * vitesse n'ayant pas de primitive commode, on l'integre numeriquement une fois.
 */
export function profil(bords = 0.16, n = 2048) {
  const S = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const cumul = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    cumul[i] = cumul[i - 1] + S(t / bords) * S((1 - t) / bords);
  }
  const total = cumul[n];
  return (t) => {
    const u = Math.min(1, Math.max(0, t)) * n;
    const i = Math.floor(u), f = u - i;
    const a = cumul[i], b = cumul[Math.min(n, i + 1)];
    return (a + (b - a) * f) / total;
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
/** Interpolation adoucie entre deux bornes — sert a fondre deux mouvements. */
export const seuil = (a, b, t) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/**
 * Courbe lisse passant par les points releves, parametree par la longueur d'arc.
 *
 * `centripetal` plutot que `catmullrom` : sur un trace qui vire sec — le raccord des deux
 * voies de La Course — l'interpolation uniforme fait une boucle en dehors du terrain, et
 * la camera passe alors a travers le decor.
 */
export function courbe(points) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, 'centripetal');
  const table = c.getLengths(600);          // reparametrage par la longueur
  return {
    point(u) { return c.getPointAt(Math.min(1, Math.max(0, u))); },
    longueur: table[table.length - 1],
  };
}

/**
 * HELICE — le plan de presentation d'une carte.
 *
 * Un tour d'orbite montre la SILHOUETTE ; un survol longitudinal montre le DETAIL. Les
 * enchainer demanderait de raccorder deux mouvements, et un raccord se voit toujours. On
 * les superpose donc : la camera tourne autour d'une cible qui, elle, avance le long du
 * parcours en descendant. Un seul geste continu, qui fait le tour ET remonte la piste.
 *
 * @param rail    ligne moyenne relevee (depart → arrivee)
 * @param rayon   distance de depart, mesuree par `rayonDeCadrage`
 * @param options tours, rayonFin, hautDebut, hautFin, azimutDebut
 */
export function helice(rail, rayon, centre, {
  tours = 1,
  rayonFin = null,
  hautDebut = null,
  hautFin = 24,
  azimutDebut = 0,
  regard = 4,
  bords = 0.16,
  approche = [0.28, 0.9],
} = {}) {
  const ligne = courbe(rail);
  const p = profil(bords);
  const rFin = rayonFin ?? Math.max(38, rayon * 0.34);
  const hDebut = hautDebut ?? rayon * 0.46;

  return (t) => {
    const u = p(t);
    /*
     * LA CIBLE SE DEPLACE DU CENTRE DE LA CARTE VERS LE TERRAIN SOUS LA CAMERA.
     *
     * Premiere version : la cible suivait le rail des la premiere image. Le plan
     * s'ouvrait donc a 170 m d'une camera visant la LIGNE DE DEPART — le parcours
     * s'enfuyait vers le fond du cadre et n'occupait qu'un huitieme de l'image. Un
     * cadrage large doit viser le milieu de ce qu'il montre. On ne rejoint le rail
     * qu'en se rapprochant, quand il n'y a plus de vue d'ensemble a tenir.
     */
    const proche = seuil(approche[0], approche[1], u);
    const suivi = ligne.point(u);
    const cible = {
      x: lerp(centre[0], suivi.x, proche),
      y: lerp(centre[1], suivi.y, proche),
      z: lerp(centre[2], suivi.z, proche),
    };
    const a = azimutDebut + u * Math.PI * 2 * tours;
    /*
     * Le rayon ne se resserre qu'a la FIN. Reduire lineairement donnerait une orbite qui
     * accelere en apparence tout du long — a vitesse angulaire constante, la vitesse vue
     * a l'ecran est proportionnelle au rayon. On garde donc le large jusqu'aux deux tiers,
     * et le rapproche ensuite : le plan se termine sur le terrain, pas sur la carte.
     */
    const serrage = seuil(approche[0], 1, u);
    const r = lerp(rayon, rFin, serrage);
    const h = lerp(hDebut, hautFin, seuil(0.18, 1, u));
    return {
      pos: [cible.x + Math.sin(a) * r, cible.y + h, cible.z + Math.cos(a) * r],
      look: [cible.x, cible.y + regard, cible.z],
      fov: FOV,
    };
  };
}
