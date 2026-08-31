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

/** Gains attendus par rang, en USDC, derives de PayoutPolicy.Compute pour 16 joueurs. */
const ATTENDU = {
  1: { pot: 16, rake: 2.4, rangs: [4.5, 2.5, 1.5, 1.1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
  2: { pot: 32, rake: 4.8, rangs: [9, 5, 3, 2.2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0] },
  5: { pot: 80, rake: 12, rangs: [22.5, 12.5, 7.5, 5.5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0] },
};

let echecs = 0;
const dit = (ok, texte) => {
  if (!ok) echecs++;
  console.log(`${ok ? 'OK  ' : 'ECHEC'} ${texte}`);
};

dit(CONFIG.joueurs === 16 && CONFIG.rakeBp === 1500, `structure : ${CONFIG.joueurs} joueurs, rake ${CONFIG.rakeBp / 100} %`);
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
dit(montant(4_500_000) === '4.50', `format : ${montant(4_500_000)} USDC`);
dit(facteur(4.5) === '×4.5', `multiplicateur : ${facteur(4.5)}`);
dit([1, 2, 3, 4, 11, 12, 13, 16].map(ordinal).join(' ') === '1st 2nd 3rd 4th 11th 12th 13th 16th',
  `ordinaux : ${[1, 2, 3, 4, 11, 12, 13, 16].map(ordinal).join(' ')}`);

console.log(`\n--- ${echecs === 0 ? 'la table du lobby est celle du noyau de regles' : `${echecs} ecart(s)`} ---`);
process.exit(echecs === 0 ? 0 : 1);
