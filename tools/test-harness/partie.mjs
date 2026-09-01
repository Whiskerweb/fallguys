/**
 * Une PARTIE COMPLÈTE, jouée par des bots, affichée manche par manche.
 *
 * Aucun navigateur, aucun réseau : la simulation entière tourne dans ce processus. C'est
 * ce qui rend une partie de seize joueurs observable — personne ne peut en tester une à
 * la main, et c'est la raison pour laquelle la spec range ce harnais en « priorité n°1 ».
 *
 *   node partie.mjs            · node partie.mjs 4242 8
 */
import { preparer } from '../../serveur/src/monde.js';
import { creerSalon } from '../../serveur/src/salon.js';
import { jouerPartie } from '../../serveur/src/partie.js';

const graine = Number(process.argv[2] ?? 4242);
const taille = Number(process.argv[3] ?? 16);

const t0 = Date.now();
await preparer();

/*
 * Un salon SANS AUCUN HUMAIN. L'attente est mise à zéro : on ne va pas patienter quinze
 * secondes pour un banc d'essai, et la règle des quinze secondes est éprouvée à part,
 * sur une horloge factice, dans `verdicts.mjs`.
 */
const salon = creerSalon({ taille, attente: 0, mise: 0, graine });
salon.rejoindre({ nom: 'observateur', faire: () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) }) });
const grille = salon.composer();

console.log(`\x1b[1mPartie ${graine} · ${grille.humains} humain(s) + ${grille.bots} bots\x1b[0m`);
const parNiveau = {};
for (const i of grille.inscrits) if (i.estBot) parNiveau[i.niveau] = (parNiveau[i.niveau] ?? 0) + 1;
console.log('composition :', Object.entries(parNiveau).map(([n, c]) => `${c} ${n}`).join(' · '), '\n');

const resultat = jouerPartie({
  graine,
  inscrits: grille.inscrits,
  surManche: (n, r, enLice) => {
    console.log(`  MANCHE ${n}  ${r.epreuve.padEnd(9)} ${String(r.duree).padStart(6)} s de jeu`
      + ` · ${r.qualifies.length} qualifiés sur ${r.classement.length}`);
    console.log(`            qualifiés : ${r.qualifies.join(', ')}`);
    if (enLice.length <= 1) console.log(`            couronne : ${enLice[0]?.nom ?? '—'}`);
  },
});

console.log(`\n  parcours : ${resultat.parcours.join(' → ')} · paliers ${resultat.paliers.join(' → ')}`);
console.log('\n  classement final');
for (const c of resultat.classement.slice(0, 8)) {
  console.log(`    ${String(c.rang).padStart(2)}. ${c.nom.padEnd(12)} ${c.estBot ? '(bot ' + c.niveau + ')' : '(humain)'}`);
}
console.log(`    …  ${resultat.classement.length - 8} autres`);
console.log(`\n  ${((Date.now() - t0) / 1000).toFixed(1)} s de calcul pour une partie complète`);
