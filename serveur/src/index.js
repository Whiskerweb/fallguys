/**
 * Le serveur de jeu, prêt à jouer.
 *
 * UN SEUL PROCESSUS sert la page et la partie. C'est ce qui rend l'essai à deux machines
 * possible sans configuration : la seconde ouvre une adresse, et la WebSocket part vers ce
 * même hôte. Deux serveurs sur deux ports obligeraient à retrouver une IP deux fois — et
 * cette friction-là suffit à ce qu'on ne teste pas.
 *
 *   cd tools/feel-lab && npm run build     # une fois, et à chaque changement du jeu
 *   cd serveur && npm start
 *
 * Réglages par variables d'environnement :
 *   PORT=8080            le port
 *   POLITIQUE=PRODUCTION PRODUCTION (1v1 à 2, squad à 4, arène à 16 ou dès 13 après 35 s
 *                        de calme) · DEV (mêmes formes, deux machines suffisent) ·
 *                        DUEL_TEST (tout à 2) · BANC (bots, bancs seulement)
 *
 * PRODUCTION PAR DÉFAUT. Un `npm start` sans rien doit donner LE JEU, pas un banc : sous
 * `DUEL_TEST` puis `DEV`, une arène partait à deux, et c'est ce qu'un directeur produit a
 * vu en jouant — « qu'on soit seize ou quatre, ça se lance quand on est deux ». Pour
 * tester à deux machines dans les trois modes : `POLITIQUE=DEV` (ou `npm run dev`).
 */

import { depuisFichier } from './env.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerServeur } from './serveur.js';
import { POLITIQUES, formatDe } from './politique.js';
import { ORDRE_MODES, MODES, PALIERS } from './economie.js';
import { creerPont } from './argent.js';
import { IDENTITE_CONFIGUREE } from './identite.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ICI, '..', '..', 'tools', 'feel-lab', 'dist');

const nomPolitique = process.env.POLITIQUE ?? 'PRODUCTION';
const politique = POLITIQUES[nomPolitique];
if (!politique) {
  console.error(`politique inconnue « ${nomPolitique} » — attendu : ${Object.keys(POLITIQUES).join(', ')}`);
  process.exit(1);
}

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('Le jeu compilé est introuvable.');
  console.error('  cd tools/feel-lab && npm run build');
  process.exit(1);
}

/*
 * LE PONT VERS L'ARGENT. `BACKEND_URL` et `SERVEUR_CLE` viennent du .env de la racine
 * (chargé par `env.js`). On vérifie au démarrage que le backend reconnaît notre clé :
 * découvrir au premier règlement que la signature est refusée, c'est seize joueurs qui
 * ont payé et que personne ne paie.
 *
 * En PRODUCTION, pas de pont = pas de démarrage. Un serveur qui ouvre des files payantes
 * sans rien derrière est exactement ce que le directeur produit a demandé de retirer.
 */
let pont = null;
try {
  pont = creerPont();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
if (pont) {
  try {
    const r = await pont.ping();
    // Ce que le backend dit de la chaine (reseau, dollar) : `/etat` le repete au navigateur,
    // qui renomme ce qu'il affiche — USDC sur le testnet, USDG sur mainnet.
    pont.chaine = { reseau: r.reseau ?? null, chainId: r.chainId ?? null, stable: r.stable ?? 'USDC' };
    console.log(`  backend ${pont.url} · reseau ${r.reseau} · dollar ${pont.chaine.stable} · signature reconnue`);
  } catch (e) {
    console.error(`  backend ${pont.url} : ${e.code} — ${e.message}`);
    console.error('  Le backend doit tourner (cd backend && npm start) et SERVEUR_PUBLIQUE doit être la moitié publique de SERVEUR_CLE.');
    process.exit(1);
  }
} else if (nomPolitique === 'PRODUCTION') {
  console.error('PRODUCTION sans BACKEND_URL : les files payantes n\'auraient rien derrière. Renseignez BACKEND_URL dans le .env, ou lancez POLITIQUE=DEV.');
  process.exit(1);
}
if (!IDENTITE_CONFIGUREE && pont) {
  console.error('BACKEND_URL est renseignée mais SUPABASE_URL / SUPABASE_ANON_KEY manquent : impossible de vérifier qui mise.');
  process.exit(1);
}

/*
 * LE PORT NE VIENT PAS DU .ENV : `PORT=8787` y est celui du BACKEND, et le prendre ici a
 * fait tomber le serveur de jeu sur « address already in use » le jour où il s'est mis à
 * charger le fichier. `SERVEUR_PORT` d'abord, puis un `PORT` posé dans l'environnement
 * réel, sinon 8080.
 */
const port = Number(process.env.SERVEUR_PORT ?? (depuisFichier.has('PORT') ? 8080 : (process.env.PORT ?? 8080)));
const serveur = await demarrerServeur({ port, politique, pont });

console.log('');
console.log(`  \x1b[1mServeur de jeu\x1b[0m · politique ${politique.nom}`);
// Une ligne par mode ouvert : une politique qui n'ouvre pas les trois le dit ici, plutôt
// que de le faire découvrir par une file qui ne part jamais.
for (const id of (politique.modes ? ORDRE_MODES : ['arena'])) {
  const f = formatDe(politique, id);
  const etiquette = politique.modes ? MODES[id].nom : 'toutes tables';
  console.log(`  ${etiquette.padEnd(9)} ${String(f.cible).padStart(2)} joueurs · minimum ${f.minimum}`
    + (f.calme != null ? ` · part à ${f.minimum}+ après ${f.calme} s sans arrivée` : ' · part plein')
    + ` · bots : ${politique.bots}`);
}
console.log(`  mises : ${PALIERS.join(' / ')} USDC`);
console.log(`  suggestion d'une autre file après ${politique.suggererApres ?? '—'} s d'attente`);
console.log(`  argent : ${pont ? `réel, via ${pont.url}` : (politique.identite === 'facultative' ? 'portefeuille de banc (aucun backend)' : 'AUCUN — files payantes fermées')}`);
console.log(`  identité : ${IDENTITE_CONFIGUREE ? 'jeton Supabase vérifié' : 'non vérifiée (invités seulement)'}`);
console.log('');
console.log('  Ouvrez le jeu ici :');
console.log(`    \x1b[36mhttp://localhost:${serveur.port}\x1b[0m        (cette machine)`);
for (const ip of serveur.adresses) {
  console.log(`    \x1b[36mhttp://${ip}:${serveur.port}\x1b[0m        (les autres machines du réseau)`);
}
console.log('');
console.log(`  État du serveur : http://localhost:${serveur.port}/etat`);
console.log('  Ctrl+C pour arrêter.');
console.log('');

/*
 * Arrêt propre. Sans cela, un Ctrl+C laisse les parties en cours et les sockets ouvertes :
 * au redémarrage suivant, le port est encore pris et l'on croit à un bug du serveur.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log('\n  arrêt…');
    await serveur.arreter();
    process.exit(0);
  });
}
