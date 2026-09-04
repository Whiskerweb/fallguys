/**
 * SEIZE JOUEURS, SEIZE PLACES — un par parcelle, et personne dans le vide.
 *
 * Ce fichier existe parce que le verdict qui aurait dû attraper ce défaut était aveugle.
 * Il construisait bien seize personnages sur chaque carte, puis vérifiait après quatre-vingt
 * -dix ticks que « personne n'est passé sous killY ». Sur Les Hexagones, quatorze joueurs
 * sur seize apparaissaient hors de la tuile de départ et tombaient dès le premier tick — mais
 * une chute depuis trente-quatre mètres met bien plus de trois secondes à franchir le seuil.
 * Le test mesurait une fenêtre trop courte pour voir la faute qu'il devait voir.
 *
 * D'où le parti pris d'ici : **on juge AVANT le premier tick**. Un rayon vers le bas dit
 * s'il y a de la matière sous chaque départ, tout de suite, sans attendre que la gravité
 * fasse la démonstration.
 *
 * Usage : node depart.mjs
 */

import { preparer, construire, liberer, epreuves, moteur } from '../../serveur/src/monde.js';
import { placer, DIAMETRE, MAX_JOUEURS } from '../feel-lab/src/placement.js';

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const t0 = Date.now();
await preparer();
const { RAPIER } = moteur();

/** Distance hexagonale : 1 = les deux cases partagent une arête, donc on marche de l'une à l'autre. */
const distHex = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q - b.q + a.r - b.r) + Math.abs(a.r - b.r)) / 2;

// ===========================================================================
titre('1. Sur les cinq cartes, seize joueurs ont chacun leur place');
// ===========================================================================
for (const e of epreuves()) {
  const monde = construire(e.id, 4242);

  /*
   * UN PAS AVANT DE TIRER LE RAYON.
   *
   * Un rayon Rapier ne touche rien tant que le monde n'a pas avancé d'un pas : la structure
   * d'accélération n'existe pas avant. Sans lui, ce harnais annonçait « aucun sol » sur les
   * cinq cartes et accusait un placement parfaitement correct — la faute était dans la
   * mesure, pas dans le jeu.
   *
   * On tire AVANT de créer le moindre personnage : sinon le rayon toucherait la capsule du
   * voisin et l'on croirait avoir trouvé du sol.
   */
  monde.arene.world.step();
  const p = Array.from({ length: MAX_JOUEURS }, (_, i) => placer(monde.arene, i, MAX_JOUEURS));

  /*
   * DU SOL SOUS LES PIEDS — un rayon vers le bas, avant toute simulation.
   *
   * Générique : aucune sonde propre à une carte, donc le verdict vaut pour les cinq et
   * vaudra pour la sixième. On tire depuis un demi-mètre au-dessus de la place, sur trois
   * mètres — de quoi trouver la tuile sans traverser tout l'étage du dessous.
   */
  const portes = p.filter((q) => {
    const rayon = new RAPIER.Ray({ x: q.x, y: q.y + 0.5, z: q.z }, { x: 0, y: -1, z: 0 });
    // Cinq mètres : les places sont déclarées un peu au-dessus du sol, et une tuile
    // d'hexagone se trouve à 1,2 m sous les pieds.
    return monde.arene.world.castRay(rayon, 5.0, true) !== null;
  }).length;

  let mini = Infinity;
  let maxi = 0;
  for (let a = 0; a < p.length; a++) {
    for (let b = a + 1; b < p.length; b++) {
      const d = Math.hypot(p[a].x - p[b].x, p[a].z - p[b].z);
      mini = Math.min(mini, d);
      maxi = Math.max(maxi, d);
    }
  }

  console.log(`     ${e.id.padEnd(9)} sol sous ${portes}/16 · écart min ${mini.toFixed(2)} m · étalement ${maxi.toFixed(2)} m`);
  dit(portes === MAX_JOUEURS, `${e.id.padEnd(9)} : les 16 départs ont du sol sous les pieds`);
  dit(mini > DIAMETRE, `${e.id.padEnd(9)} : jamais deux joueurs à moins d'un diamètre (${mini.toFixed(2)} m)`);
  // Côte à côte, pas dispersés aux quatre coins : c'est une grille de départ, pas un semis.
  dit(maxi < 20, `${e.id.padEnd(9)} : tout le monde reste groupé (${maxi.toFixed(2)} m d'un bout à l'autre)`);

  liberer(monde);
}

// ===========================================================================
titre('2. Les Hexagones : seize socles, un par joueur');
// ===========================================================================
{
  const monde = construire('hexagone', 4242);
  const socles = monde.arene.__socles();

  const distincts = new Set(socles.map((s) => `${s.q},${s.r}`)).size;
  let colles = 0;
  for (let i = 0; i < socles.length; i++) {
    for (let j = i + 1; j < socles.length; j++) if (distHex(socles[i], socles[j]) < 2) colles++;
  }
  const isoles = socles.filter((c) => socles.every((d) => c === d || distHex(c, d) >= 2)).length;

  console.log(`     ${socles.length} socles · ${distincts} distincts · ${isoles} totalement isolés`
    + ` · ${colles} paires en contact sur 120`);

  dit(socles.length === MAX_JOUEURS && distincts === MAX_JOUEURS,
    'seize socles, tous distincts — chacun a sa parcelle');
  /*
   * Le contact est BORNÉ, pas interdit.
   *
   * Seize socles couvrent près de la moitié des trente-sept tuiles du plateau : on ne peut
   * en isoler que treize au maximum, c'est une contrainte de la grille. Le sous-réseau en
   * garde six en contact ; un choix glouton en laissait dix. Ce seuil casse si l'on revient
   * à un placement plus grossier.
   */
  dit(colles <= 6, `au plus six paires en contact (mesuré : ${colles})`);

  liberer(monde);
}

// ===========================================================================
titre('3. La liste des socles ne dépend QUE de la graine');
// ===========================================================================
{
  /*
   * Le client et le serveur construisent chacun leur arène, dans deux moteurs JavaScript
   * différents. Si la liste des socles variait d'un tirage de plus ou d'un tri instable, le
   * joueur démarrerait à une place que le serveur ne lui a pas donnée — et se ferait
   * téléporter. C'est le seul verdict de ce fichier dont l'échec rendrait le jeu injouable.
   */
  const cles = (g) => {
    const m = construire('hexagone', g);
    const out = m.arene.__socles().map((s) => `${s.q},${s.r}`).join(' ');
    liberer(m);
    return out;
  };
  const a = cles(4242);
  const b = cles(4242);
  const c = cles(7);

  dit(a === b, 'deux constructions de la même graine donnent la même couronne');
  dit(a !== c, 'deux graines différentes donnent deux couronnes différentes');
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s ---`);
process.exit(ko === 0 ? 0 : 1);
