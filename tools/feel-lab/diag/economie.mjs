/**
 * Verdict sur la table des gains — le seul diagnostic du dossier qui n'ouvre pas de
 * navigateur, parce qu'il ne juge pas une image mais des nombres.
 *
 * `src/economie.js` est un PORT de `src/Fallguys.Rules/PrizeWheel.cs`. Deux
 * implementations de la meme regle derivent toujours l'une de l'autre : celle du front
 * annonce au joueur ce qu'il gagnera, celle du backend le paie. Un ecart entre les deux
 * est un montant faux affiche a l'ecran dans un jeu ou l'on engage de l'argent reel.
 *
 * Les valeurs attendues ci-dessous ne sont pas recalculees par la meme formule — elles
 * sont posees en dur, telles qu'on les a derivees a la main (et par un script Python
 * independant pour les tirages). Un test qui refait le calcul du code teste ne teste rien.
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
const {
  MICROS, CONFIG, PALIERS, MODES, ORDRE_MODES, ISSUES, VARIANTES, CASES_PAR_ROUE,
  table, tableEffectif, echelle, grade, roueDe, esperance, hachage32, tirerIssue, verifierRoue,
  montant, facteur, ordinal,
} = await import(src);

const { GRADES, nomDuGrade } = await import(pathToFileURL(path.resolve('src/roue.js')).href);

/**
 * TOUT CE QUI SUIT EST POSE A LA MAIN, en USDG.
 *
 * Derive du noyau C# (`PrizeWheelTests.cs`), jamais recalcule par la formule testee.
 * STANDARD reste, au dixieme pres, la table historique du depot, et c'est la ligne la
 * plus frequente : la roue ajoute de la variance autour du bareme qui existait.
 */
const ARENE = {                       // mise 2 USDG · pot 32 · [1er..4e], rake de la ligne, bronze rembourse
  plat:      [[5.0, 4.4, 3.8, 3.0], 4.4, 15],
  doux:      [[6.2, 4.5, 3.5, 2.7], 4.0, 13],
  partage:   [[7.0, 5.1, 3.1, 2.6], 3.6, 11],
  equilibre: [[8.2, 4.7, 2.9, 2.5], 3.4, 10],
  standard:  [[10, 5, 3.4, 2.4], 3.2, 0],
  podium:    [[10.2, 3.9, 2.6, 2.3], 3.0, 9],
  pointu:    [[11.6, 3.3, 2.4, 2.1], 2.6, 12],
  couronne:  [[12.5, 2.8, 2.3, 2.0], 2.4, 14],
  royale:    [[13.1, 2.6, 2.2, 2.2], 1.9, 16],
  jackpot:   [[15.8, 2.2, 2.0, 2.0], 2.0, 0],
};
const SQUAD = {                       // mise 5 USDG · pot 20
  plat: [7.5, 6, 0, 3.25], doux: [8.25, 5.25, 3.25, 0], partage: [9.25, 8.25, 0, 0], equilibre: [10.25, 7.75, 0, 0],
  standard: [12.5, 5.5, 0, 0], podium: [11.25, 6.75, 0, 0], pointu: [12, 6.5, 0, 0],
  couronne: [13, 6.25, 0, 0], royale: [14, 5.75, 0, 0], jackpot: [15, 5, 0, 0],
};
/** Graine → issue, calcule par un script Python independant (lowbias32 reecrit a part). */
const TIRAGES = { 0: 'plat', 1: 'standard', 2: 'partage', 3: 'equilibre', 4: 'podium', 7: 'couronne', 25: 'royale', 42: 'standard', 123456789: 'partage' };

let echecs = 0;
const dit = (ok, texte) => {
  if (!ok) echecs++;
  console.log(`${ok ? 'OK  ' : 'ECHEC'} ${texte}`);
};

console.log('\n\x1b[1mLes trois modes\x1b[0m');
dit(String(ORDRE_MODES) === 'duel,squad,arena', `modes ouverts : ${ORDRE_MODES.join(' / ')}`);
dit(String(PALIERS) === '2,5,10', `tables ouvertes : ${PALIERS.join(' / ')} USDG`);
dit(MODES.duel.joueurs === 2 && String(MODES.duel.survivants) === '1',
  'duel : 2 joueurs, 1 manche — une finale, et rien d\'autre');
dit(MODES.squad.joueurs === 4 && String(MODES.squad.survivants) === '2,1',
  'squad : 4 joueurs, 2 manches, 2 places payees');
dit(MODES.arena.joueurs === 16 && String(MODES.arena.survivants) === '8,4,1',
  'arena : 16 joueurs, 3 manches, 8 remboursees');
dit(CONFIG === MODES.arena && CONFIG.rakeBp === 1000,
  `CONFIG est l'arene elle-meme, rake ${CONFIG.rakeBp / 100} %`);

console.log('\n\x1b[1mLa roue : dix lignes par mode\x1b[0m');
for (const id of ORDRE_MODES) {
  let ok = true;
  try { verifierRoue(id); } catch (e) { ok = false; console.log(`      ${e.message}`); }
  const moyenne = 18 * MODES[id].joueurs;
  dit(ok && ISSUES[id].length === CASES_PAR_ROUE,
    `${id} : ${ISSUES[id].length} issues, ${moyenne} vingtiemes de mise distribues en moyenne — 90 % du pot`);
}
dit(VARIANTES === ISSUES, 'VARIANTES est le meme objet qu\'ISSUES : le ticket lit le meme catalogue');
// Le melangeur, pose a la main : calcule par une implementation independante, pas par lui.
dit(hachage32(1) === 1_753_845_952 && hachage32(42) === 388_445_122
  && hachage32(20260901) === 3_676_312_043,
  'le melangeur rend les entiers attendus (memes valeurs qu\'en C# et dans gains.js)');
{
  const faux = [];
  for (const [g, v] of Object.entries(TIRAGES)) {
    for (const id of ORDRE_MODES) if (tirerIssue(id, Number(g)).id !== v) faux.push(`graine ${g} en ${id} attendait ${v}`);
  }
  dit(faux.length === 0, `9 graines posees a la main donnent les lignes attendues dans les 3 modes`
    + (faux.length ? ` — ${faux.join(', ')}` : ''));
}
// Les poids annonces sont ceux qui tombent.
{
  const compte = {};
  for (let g = 0; g < 100_000; g++) { const id = tirerIssue('arena', g).id; compte[id] = (compte[id] ?? 0) + 1; }
  const menteuses = ISSUES.arena.filter((v) => Math.abs((compte[v.id] ?? 0) / 10 - v.poids) >= 50);
  dit(menteuses.length === 0, `sur 100 000 graines, chaque ligne tombe a son poids annonce (${menteuses.map((v) => v.id).join(', ') || 'aucun ecart'})`);
}
// Le pot ne bouge pas ; le rake, si — entre 0 et 30 % selon la ligne, 10 % en moyenne.
// La maison ne paie JAMAIS : aucune ligne ne depasse le pot.
{
  let bouge = 0;
  let moyenne = 0;
  for (const v of ISSUES.arena) {
    const t = table(2 * MICROS, 'arena', v.id);
    if (t.pot !== 32 * MICROS || t.rake < 0 || t.rake * 10 > t.pot * 3) bouge++;
    moyenne += (t.rake * v.poids) / 10_000;
  }
  dit(bouge === 0 && Math.round(moyenne) === 3.2 * MICROS,
    `quelle que soit la ligne, le pot vaut 32.00 ; le rake va de ${montant(table(2 * MICROS, 'arena', 'plat').rake)} (FLAT) a ${montant(table(2 * MICROS, 'arena', 'royale').rake)} (ROYAL), 3.20 en moyenne`);
  dit(table(2 * MICROS, 'duel', 'jackpot').rake === 0 && table(2 * MICROS, 'duel', 'jackpot').parRang[0] === 4 * MICROS,
    'JACKPOT en duel a 2 USDG : 4.00 au vainqueur, tout le pot, rake zero sur cette ligne');
}

console.log('\n\x1b[1mLes tables, rang par rang\x1b[0m');
for (const [id, [attendu, rakeAttendu, rembourse]] of Object.entries(ARENE)) {
  const { pot, rake, parRang } = table(2 * MICROS, 'arena', id);
  const rangs = attendu.concat([2, 2, 2, 2], new Array(8).fill(0));
  if (rembourse) rangs[rembourse - 1] = 2;
  dit(rake === Math.round(rakeAttendu * MICROS), `arena/${id.padEnd(9)} · rake de la ligne ${montant(rake)} (attendu ${rakeAttendu.toFixed(2)})`);
  // La bande 5e-8e : AU MOINS la mise, parfois un peu plus (plat, doux, partage).
  const ecarts = parRang
    .map((v, i) => ({ rang: i + 1, vu: v, att: Math.round(rangs[i] * MICROS) }))
    .filter((e) => (e.rang >= 5 && e.rang <= 8) ? e.vu < 2 * MICROS : e.vu !== e.att);
  dit(ecarts.length === 0, `arena/${id.padEnd(9)} a 2 USDG · ${attendu.map((x) => x.toFixed(2)).join(' / ')}`
    + (rembourse ? ` · mise rendue au ${rembourse}e` : '')
    + (ecarts.length ? ` — rang ${ecarts[0].rang} : ${montant(ecarts[0].vu)} ≠ ${montant(ecarts[0].att)}` : ''));
  dit(parRang.reduce((a, b) => a + b, 0) + rake === pot,
    `arena/${id.padEnd(9)} · ${montant(parRang.reduce((a, b) => a + b, 0))} distribues + ${montant(rake)} = ${montant(pot)}`);
}
for (const [id, attendu] of Object.entries(SQUAD)) {
  const { pot, rake, parRang } = table(5 * MICROS, 'squad', id);
  const ok = attendu.every((x, i) => parRang[i] === Math.round(x * MICROS));
  dit(ok, `squad/${id.padEnd(9)} a 5 USDG · ${attendu.map((x) => x.toFixed(2)).join(' / ')}`);
  dit(parRang.reduce((a, b) => a + b, 0) + rake === pot, `squad/${id.padEnd(9)} · le pot boucle`);
}
{
  const s = table(10 * MICROS, 'duel', 'standard');
  const p = table(10 * MICROS, 'duel', 'plat');
  dit(s.pot === 20 * MICROS && s.rake === 2 * MICROS && s.parRang[0] === 18 * MICROS && s.parRang[1] === 0,
    `duel/standard a 10 USDG · ${montant(s.parRang[0])} au vainqueur (×1.8), rien au perdant`);
  dit(p.parRang[0] === 13 * MICROS && p.parRang[1] === 3.5 * MICROS && p.rake === 3.5 * MICROS,
    `duel/plat a 10 USDG · ${montant(p.parRang[0])} au vainqueur, ${montant(p.parRang[1])} rendus au perdant, ${montant(p.rake)} a la maison`);
  // Dix montants DISTINCTS pour le vainqueur, dans les trois modes : la demande du directeur
  // produit devant trois « 3.60 » sur la meme roue.
  for (const id of ORDRE_MODES) {
    const gains = roueDe(id, 1, 2 * MICROS).cases.map((c) => c.gain);
    dit(new Set(gains).size === 10, `${id} : dix montants distincts pour le vainqueur — ${gains.map(montant).join(' / ')}`);
  }
}

console.log('\n\x1b[1mLa regle fondatrice, sur toutes les lignes\x1b[0m');
{
  let sous = 0;
  let trop = 0;
  for (const id of ORDRE_MODES) {
    for (const v of ISSUES[id]) {
      const { parRang } = table(2 * MICROS, id, v.id);
      for (let r = 1; r <= MODES[id].survivants[0]; r++) if (parRang[r - 1] < 2 * MICROS) sous++;
      for (let r = MODES[id].survivants[0] + 1; r <= MODES[id].joueurs; r++) if (parRang[r - 1] > 2 * MICROS) trop++;
    }
  }
  dit(sous === 0, 'aucune ligne ne paie un survivant de la manche 1 sous sa mise');
  dit(trop === 0, 'aucune ligne ne paie un bronze plus que sa mise : il la retrouve, il ne gagne pas');
  const plafond = Math.max(...ISSUES.arena.map((v) => v.vingtiemes[0])) / 20;
  dit(plafond === 7.9, `plafond d'arene : ×${plafond} au vainqueur — JACKPOT, la maison n'y garde que 6 %`);
  dit(Math.max(...ISSUES.squad.map((v) => v.vingtiemes[0])) / 20 === 3, 'plafond de squad : ×3.0');
  dit(Math.max(...ISSUES.duel.map((v) => v.vingtiemes[0])) / 20 === 2, 'plafond de duel : ×2.0, le pot entier');
}

console.log('\n\x1b[1mLes paliers, et la roue de chaque rang\x1b[0m');
{
  const a = Array.from({ length: 16 }, (_, i) => grade('arena', i + 1));
  dit(a.join(',') === 'diamant,or,or,or,argent,argent,argent,argent,bronze,bronze,bronze,bronze,bronze,bronze,bronze,bronze',
    `arene : ◆ 1 · ★ 2-4 · ● 5-8 · ○ 9-16`);
  dit([1, 2, 3, 4].map((r) => grade('squad', r)).join(',') === 'diamant,or,bronze,bronze', 'squad : ◆ 1 · ★ 2 · ○ 3-4');
  dit([1, 2].map((r) => grade('duel', r)).join(',') === 'diamant,bronze', 'duel : ◆ 1 · ○ 2');

  // La roue du vainqueur en arene a 2 USDG : de 5,60 a 14,80, dix cases, poids a 100 %.
  const v = roueDe('arena', 1, 2 * MICROS);
  const gains = v.cases.map((c) => c.gain);
  dit(v.grade === 'diamant' && v.cases.length === 10 && v.cases.reduce((s, c) => s + c.poids, 0) === 10_000,
    'la roue du vainqueur : diamant, dix cases, poids a 100 %');
  dit(Math.min(...gains) === 5 * MICROS && Math.max(...gains) === 15.8 * MICROS,
    `elle va de ${montant(Math.min(...gains))} a ${montant(Math.max(...gains))} USDG`);
  dit(v.cases.find((c) => c.issue === 'jackpot').poids === 200, 'la case JACKPOT fait 2 % du disque, pas plus');

  // La roue du 9e : neuf cases d'XP et UNE mise rendue, sur la ligne PODIUM (14 %).
  const n = roueDe('arena', 9, 2 * MICROS);
  const rendue = n.cases.filter((c) => c.gain > 0);
  dit(n.grade === 'bronze' && rendue.length === 1 && rendue[0].issue === 'podium' && rendue[0].poids === 1400 && rendue[0].gain === 2 * MICROS,
    'la roue du 9e : bronze, la mise rendue sur PODIUM (14 %), et rien d\'autre en argent');
  dit(n.cases.filter((c) => c.gain === 0).every((c) => c.xp > 0), 'ses neuf autres cases donnent de l\'XP — jamais rien');
  dit(n.cases.find((c) => c.issue === 'jackpot').xp === 150, 'jusqu\'a 150 XP sur la case JACKPOT');
  // Deux joueurs du meme palier n'ont pas la meme roue : le 2e et le 3e.
  const deux = roueDe('arena', 2, 2 * MICROS).cases.map((c) => c.gain).join();
  const trois = roueDe('arena', 3, 2 * MICROS).cases.map((c) => c.gain).join();
  dit(deux !== trois, 'le 2e et le 3e, tous deux OR, n\'ont pas la meme roue');

  // L'esperance : Σ poids × gain / 10 000, posee a la main.
  const e = esperance(2 * MICROS, 'arena');
  dit(e.parRang[0] === 9_349_000 && e.parRang[1] === 4_259_000,
    `esperance en arene a 2 USDG : ${montant(e.parRang[0])} au 1er, ${montant(e.parRang[1])} au 2e`);
  dit(e.parRang.reduce((s, x) => s + x, 0) === 28_800_000, 'la somme des esperances vaut le distribuable : le pot boucle en moyenne aussi');
  dit(e.max[0] === 15.8 * MICROS && e.rake === 3_200_000, `au mieux ${montant(e.max[0])} au 1er ; rake moyen ${montant(e.rake)}`);
}

console.log('\n\x1b[1mL\'echelle affichee\x1b[0m');
{
  // Quatre lignes, une par palier : c'est ce que voit le joueur.
  const lignes = echelle(2 * MICROS, 'arena');
  dit(lignes.length === 4, `arena : ${lignes.length} lignes (attendu 4 — un palier chacune)`);
  dit(lignes.map((l) => l.gemme).join(',') === 'diamant,or,argent,bronze', `gemmes : ${lignes.map((l) => l.gemme).join(' / ')}`);
  dit(lignes[2].rembourse === true && lignes[2].depuis === 5 && lignes[2].jusqu === 8, 'seuil de non-perte sur la bande 5e-8e');
  dit(lignes[3].depuis === 9 && lignes[3].xp > 0, `les rangs 9 a 16 : de l'XP (${lignes[3].xp} en moyenne pour le 9e)`);
  dit(lignes[0].gain === 9_349_000 && lignes[0].max === 15_800_000, 'la ligne du 1er porte son esperance et son plafond');
  const exacte = echelle(2 * MICROS, 'arena', 'jackpot');
  dit(exacte[0].gain === 15_800_000 && exacte[0].max === 15_800_000, 'avec une issue, l\'echelle donne les montants exacts de cette ligne');
  const d = echelle(10 * MICROS, 'duel');
  dit(d.length === 2 && d[0].gemme === 'diamant' && d[1].gemme === 'bronze', 'duel : un diamant, un bronze');
}

console.log('\n\x1b[1mLes salons reduits, inchanges\x1b[0m');
{
  // L'autre chemin de calcul : celui d'un salon qui part a effectif incomplet. Il n'a pas
  // de roue et n'en a jamais eu ; ce verdict existe pour qu'il le reste.
  const t = tableEffectif(1 * MICROS, 16);
  dit(t.rake === 1_600_000 && t.parRang[0] === 5_000_000 && t.parRang[1] === 2_500_000
    && t.parRang[2] === 1_700_000 && t.parRang[3] === 1_200_000,
    `a seize : ${t.parRang.slice(0, 4).map(montant).join(' / ')} — la table historique, intacte`);
  const parMode = table(1 * MICROS, 'arena', 'standard');
  dit(String(t.parRang) === String(parMode.parRang),
    'les deux chemins de calcul se rejoignent sur STANDARD a seize');
}

console.log('\n\x1b[1mLes formats\x1b[0m');
dit(montant(1_700_000) === '1.70', `format : ${montant(1_700_000)} USDG`);
dit(facteur(2.5) === '×2.5', `multiplicateur (outil interne) : ${facteur(2.5)}`);
dit([1, 2, 3, 4, 11, 12, 13, 16].map(ordinal).join(' ') === '1st 2nd 3rd 4th 11th 12th 13th 16th',
  `ordinaux : ${[1, 2, 3, 4, 11, 12, 13, 16].map(ordinal).join(' ')}`);
dit(nomDuGrade('diamant') === 'DIAMOND' && nomDuGrade('or') === 'GOLD'
  && nomDuGrade('argent') === 'SILVER' && nomDuGrade('bronze') === 'BRONZE' && nomDuGrade(null) === '—',
  `grades : ${['diamant', 'or', 'argent', 'bronze'].map(nomDuGrade).join(' / ')}`);
dit(Object.keys(GRADES).length === 4, 'quatre grades, pas un de plus');

console.log(`\n--- ${echecs === 0 ? 'la table du lobby est celle du noyau de regles' : `${echecs} ecart(s)`} ---`);
process.exit(echecs === 0 ? 0 : 1);
