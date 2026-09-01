/**
 * Verdict sur la table des gains — le seul diagnostic du dossier qui n'ouvre pas de
 * navigateur, parce qu'il ne juge pas une image mais des nombres.
 *
 * `src/economie.js` est un PORT de `src/Fallguys.Rules/PayoutPolicy.cs`. Deux
 * implementations de la meme regle derivent toujours l'une de l'autre : celle du front
 * annonce au joueur ce qu'il gagnera, celle du backend le paie. Un ecart entre les deux
 * est un montant faux affiche a l'ecran dans un jeu ou l'on engage de l'argent reel.
 *
 * Les valeurs attendues ci-dessous ne sont pas recalculees par la meme formule — elles
 * sont posees en dur, telles qu'on les a derivees a la main depuis le C#. Un test qui
 * refait le calcul du code teste ne teste rien.
 *
 * Usage : node diag/economie.mjs
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// `economie.js` touche a localStorage. Sous Node il n'existe pas : on lui en donne un
// minimal plutot que d'eclater le module en deux pour les besoins du test.
const memoire = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
  setItem: (k, v) => memoire.set(k, String(v)),
  removeItem: (k) => memoire.delete(k),
};

const src = pathToFileURL(path.resolve('src/economie.js')).href;
const { MICROS, CONFIG, PALIERS, table, echelle, montant, facteur, ordinal } = await import(src);

/**
 * Gains attendus par rang, en USDC, pour 16 joueurs et un rake de 10 %.
 *
 * Ces nombres divergent volontairement de la table imprimee dans le spec du 19 aout, qui
 * supposait 15 % : le taux a ete ramene a 10 % et les poids de bonus recalibres a
 * [40, 15, 7, 2] pour que les montants restent exacts. Vainqueur ×5,0 au lieu de ×4,5.
 */
const ATTENDU = {
  1: { pot: 16, rake: 1.6, rangs: [5, 2.5, 1.7, 1.2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
  2: { pot: 32, rake: 3.2, rangs: [10, 5, 3.4, 2.4, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0] },
  5: { pot: 80, rake: 8, rangs: [25, 12.5, 8.5, 6, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0] },
};

let echecs = 0;
const dit = (ok, texte) => {
  if (!ok) echecs++;
  console.log(`${ok ? 'OK  ' : 'ECHEC'} ${texte}`);
};

dit(CONFIG.joueurs === 16 && CONFIG.rakeBp === 1000, `structure : ${CONFIG.joueurs} joueurs, rake ${CONFIG.rakeBp / 100} %`);
dit(String(CONFIG.poidsFinalistes) === '40,15,7,2', `poids de bonus : ${CONFIG.poidsFinalistes.join(' / ')}`);
dit(String(CONFIG.survivants) === '8,4,1', `survivants par manche : ${CONFIG.survivants.join(' → ')}`);
dit(String(PALIERS) === '1,2,5', `tables ouvertes : ${PALIERS.join(' / ')} USDC`);

for (const usdc of PALIERS) {
  const attendu = ATTENDU[usdc];
  const { pot, rake, parRang } = table(usdc * MICROS);

  dit(pot === attendu.pot * MICROS, `mise ${usdc} · pot = ${montant(pot)} (attendu ${attendu.pot})`);
  dit(rake === attendu.rake * MICROS, `mise ${usdc} · commission = ${montant(rake)} (attendu ${attendu.rake})`);

  const ecarts = parRang
    .map((v, i) => ({ rang: i + 1, vu: v, attendu: Math.round(attendu.rangs[i] * MICROS) }))
    .filter((e) => e.vu !== e.attendu);
  dit(ecarts.length === 0, `mise ${usdc} · 16 rangs conformes`
    + (ecarts.length ? ` — ${ecarts.map((e) => `rang ${e.rang}: ${montant(e.vu)} ≠ ${montant(e.attendu)}`).join(', ')}` : ''));

  // Conservation : rien ne se cree, rien ne se perd. C'est l'invariant qui attrape les
  // erreurs d'arrondi que la comparaison rang par rang laisserait passer si les valeurs
  // attendues etaient elles-memes fausses.
  const distribue = parRang.reduce((a, b) => a + b, 0);
  dit(distribue + rake === pot,
    `mise ${usdc} · ${montant(distribue)} distribues + ${montant(rake)} de commission = ${montant(pot)}`);
}

// L'echelle affichee : six lignes, pas seize. Le regroupement est ce que voit le joueur.
const lignes = echelle(1 * MICROS);
dit(lignes.length === 6, `echelle du ticket : ${lignes.length} lignes (attendu 6)`);
dit(lignes[4]?.rembourse === true && lignes[4]?.depuis === 5 && lignes[4]?.jusqu === 8,
  `seuil de non-perte sur la bande 5e–8e`);
dit(lignes[5]?.gain === 0 && lignes[5]?.depuis === 9,
  `les rangs 9 a 16 ne touchent rien`);

// Point decimal et non virgule : l'interface est en anglais, ou « 4,50 » se lit comme
// un separateur de milliers. Le format fait partie de ce qu'on affiche sur un pot.
dit(montant(1_700_000) === '1.70', `format : ${montant(1_700_000)} USDC`);
dit(facteur(2.5) === '×2.5', `multiplicateur : ${facteur(2.5)}`);
dit([1, 2, 3, 4, 11, 12, 13, 16].map(ordinal).join(' ') === '1st 2nd 3rd 4th 11th 12th 13th 16th',
  `ordinaux : ${[1, 2, 3, 4, 11, 12, 13, 16].map(ordinal).join(' ')}`);

console.log(`\n--- ${echecs === 0 ? 'la table du lobby est celle du noyau de regles' : `${echecs} ecart(s)`} ---`);
process.exit(echecs === 0 ? 0 : 1);
