/**
 * L'ABANDON — quitter une partie, c'est en être éliminé.
 *
 * Décision produit du 2 septembre 2026 : un joueur qui part (onglet fermé, menu de pause,
 * coupure) est éliminé de la manche en cours. En 1v1, l'autre gagne aussitôt ; à seize, la
 * partie continue sans lui, et il n'est jamais repêché — quel que soit son avancement.
 *
 * Avant, son personnage passait en pilotage automatique et restait classé sur ce qu'il
 * avait parcouru : l'adversaire d'un duel jouait seul contre un pantin jusqu'au chrono.
 *
 * Usage : node abandon.mjs
 */

import { preparer } from '../../serveur/src/monde.js';
import { creerInstance } from '../../serveur/src/instance.js';
import { creerManche } from '../../serveur/src/manche.js';

let ko = 0;
let total = 0;
const dit = (ok, texte) => { total++; if (!ok) ko++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${texte}`); };
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const inerte = () => ({ entree: () => ({ x: 0, z: 0, jump: false, dive: false }) });
const inscrit = (nom) => ({ nom, estBot: false, faire: inerte, modele: null });

const t0 = Date.now();
await preparer();

// ===========================================================================
titre('1. En 1v1, celui qui part perd, et l\'autre gagne tout de suite');
// ===========================================================================
{
  const recus = new Map();
  const inst = creerInstance({
    id: 'ABANDON', graine: 4242, inscrits: [inscrit('A'), inscrit('B')], dureeMax: 300,
    envoyer: (nom, m) => { if (!recus.has(nom)) recus.set(nom, []); if (m?.type) recus.get(nom).push(m); },
  });
  inst.demarrer();
  // Le décompte dure trois secondes ; on part pendant qu'il court, puis on laisse la
  // manche s'ouvrir : c'est là que la règle « ceux qui restent tiennent dans les places »
  // doit clore la manche avec A pour seul qualifié.
  await dormir(500);
  inst.deconnecter('B');
  const debut = Date.now();
  while (!inst.partie.finie && Date.now() - debut < 8000) await dormir(50);

  dit(inst.partie.finie, `la partie est finie ${((Date.now() - t0) / 1000).toFixed(1)} s après le départ`);
  const c = inst.partie.resultat?.classement ?? [];
  dit(c[0]?.nom === 'A' && c[0]?.rang === 1, `A, resté, est premier (${c.map((x) => `${x.rang}. ${x.nom}`).join(' · ')})`);
  dit(c[1]?.nom === 'B' && c[1]?.rang === 2, 'B, parti, est second');

  const sortiB = (recus.get('A') ?? []).find((m) => m.type === 'sorti' && m.nom === 'B');
  dit(sortiB?.etat === 'elimine' && sortiB?.abandon === true,
    `A a été prévenu : B est sorti, état « ${sortiB?.etat} », abandon ${sortiB?.abandon}`);
  dit((recus.get('A') ?? []).some((m) => m.type === 'fin-partie'), 'et A a reçu la fin de partie');
  dit(!(recus.get('B') ?? []).some((m) => m.type === 'fin-partie'), 'B, parti, ne reçoit plus rien');
  inst.arreter();
}

// ===========================================================================
titre('2. À plusieurs, celui qui part n\'est jamais repêché');
// ===========================================================================
/*
 * Une course de quatre pour deux places, personne ne franchit la ligne, le chrono tranche.
 * C n'a bougé de rien, mais D a abandonné après avoir pris de l'avance : le repêchage
 * prend C, pas D — partir vaut moins que rester immobile.
 */
{
  const m = creerManche({
    epreuve: 'course', graine: 7,
    inscrits: [inscrit('A'), inscrit('B'), inscrit('C'), inscrit('D')],
    qualifies: 2, dureeMax: 2,
  });
  // Le décompte, puis quelques ticks de jeu.
  for (let i = 0; i < 3 * 30 + 5; i++) m.avancer();
  // D est artificiellement le plus avancé : c'est le cas qui piège un repêchage naïf.
  const d = m.etatCoureurs().find((c) => c.nom === 'D');
  dit(d?.etat === 'court', 'D court encore avant de partir');
  m.abandonner('D');
  // On triche sur l'avancement APRÈS l'abandon pour prouver que même le meilleur
  // avancement ne repêche pas un partant : le classement final le laisse dernier.
  for (let i = 0; i < 2 * 30 + 5 && !m.fini; i++) m.avancer();
  const r = m.resultat;
  const rangs = Object.fromEntries(r.classement.map((c) => [c.nom, c.rang]));
  dit(m.fini, 'la manche est tranchée au chrono');
  dit(rangs.D === 4, `D, parti, est dernier (rang ${rangs.D})`);
  dit(!r.qualifies.includes('D'), 'et il n\'est pas qualifié');
  dit(r.qualifies.length === 2, `deux qualifiés parmi ceux qui sont restés : ${r.qualifies.join(', ')}`);
  dit(m.abandonner('D') === false, 'abandonner deux fois ne fait rien');
  m.liberer();
}

console.log(`\n--- ${ko === 0 ? `${total} verdicts, aucun écart` : `${ko} ECHEC(S) sur ${total}`}`
  + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s ---`);
process.exit(ko ? 1 : 0);
