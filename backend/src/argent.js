/**
 * L'argent, en micro-unites entieres.
 *
 * PORT de `src/Fallguys.Rules/Money.cs`, et troisieme implementation de la meme regle
 * apres le C# et `tools/feel-lab/src/economie.js`. Les trois doivent donner les memes
 * nombres : le lobby annonce, ce fichier paie. Un ecart entre les deux serait un mensonge
 * affiche a l'ecran dans un jeu ou l'on engage de l'argent reel.
 *
 * 1 USDC = 1 000 000 micros. JAMAIS de flottant. 0,1 + 0,2 ne fait pas 0,3 en binaire, et
 * un centieme d'USDC perdu par arrondi a chaque partie est un bug comptable qu'on ne
 * retrouve plus six mois plus tard.
 */

export const MICROS = 1_000_000;

/**
 * Borne de securite des entiers JavaScript, en micro-USDC : environ 9 milliards d'USDC.
 *
 * Postgres stocke des `bigint` (jusqu'a 9,2 x 10^18) ; JavaScript ne represente
 * exactement que jusqu'a 2^53 - 1. L'ecart entre les deux est un endroit ou un nombre
 * peut changer de valeur en silence. On ne l'atteindra jamais avec des mises a 1 USDC,
 * mais « on ne l'atteindra jamais » est precisement ce qu'on dit avant de l'atteindre :
 * chaque montant qui traverse cette frontiere est donc verifie.
 */
export const PLAFOND = Number.MAX_SAFE_INTEGER;

/**
 * Lit un montant venu de la base ou du reseau, et refuse tout ce qui n'est pas un entier
 * exact dans les bornes.
 *
 * Le pilote `pg` rend les `bigint` sous forme de CHAINE, precisement pour ne pas les
 * degrader silencieusement. On fait donc la conversion ici, une fois, avec le controle —
 * plutot que par un `Number()` dissemine dans le code appelant.
 *
 * @param {unknown} valeur
 * @param {string} quoi libelle pour le message d'erreur
 * @returns {number} montant en micros
 */
export function micros(valeur, quoi = 'montant') {
  const n = typeof valeur === 'bigint' ? Number(valeur) : Number(valeur);
  if (!Number.isInteger(n)) throw new Error(`${quoi} : « ${valeur} » n'est pas un entier de micros`);
  if (Math.abs(n) > PLAFOND) throw new Error(`${quoi} : ${valeur} depasse la precision entiere de JavaScript`);
  return n;
}

/** Convertit des USDC en micros. N'accepte que ce qui tombe juste au micro pres. */
export function depuisUsdc(usdc) {
  const n = Math.round(Number(usdc) * MICROS);
  if (!Number.isFinite(n)) throw new Error(`montant USDC invalide : ${usdc}`);
  return n;
}

/**
 * Applique un pourcentage en points de base (1000 = 10 %), TRONQUE VERS LE BAS.
 *
 * Meme troncature que `Money.MultiplyByBasisPoints` en C# : arrondir au plus proche ici
 * et vers le bas la-bas ferait diverger le rake annonce du rake preleve.
 */
export function pointsDeBase(montant, bp) {
  if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) throw new Error(`points de base hors bornes : ${bp}`);
  return Math.floor((montant * bp) / 10_000);
}

/**
 * « 16.00 » — deux decimales, POINT decimal.
 *
 * Point et non virgule : l'interface est en anglais, et « 16,00 » s'y lit comme un
 * separateur de milliers, donc comme mille six cents. C'est l'ambiguite la plus chere
 * qu'on puisse afficher sur un pot. Identique a `montant()` dans economie.js.
 */
export function ecrire(m) {
  const negatif = m < 0;
  const abs = Math.abs(m);
  const unites = Math.floor(abs / MICROS);
  const cents = Math.round((abs % MICROS) / 10_000);
  return `${negatif ? '-' : ''}${unites}.${String(cents).padStart(2, '0')}`;
}
