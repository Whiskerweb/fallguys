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
 *   POLITIQUE=DUEL_TEST  PRODUCTION (16 joueurs, minimum 10) · DUEL_TEST (2) · BANC (bots)
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerServeur } from './serveur.js';
import { POLITIQUES } from './politique.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ICI, '..', '..', 'tools', 'feel-lab', 'dist');

const nomPolitique = process.env.POLITIQUE ?? 'DUEL_TEST';
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

const port = Number(process.env.PORT ?? 8080);
const serveur = await demarrerServeur({ port, politique });

console.log('');
console.log(`  \x1b[1mServeur de jeu\x1b[0m · politique ${politique.nom}`);
console.log(`  ${politique.cible} joueurs par partie · minimum ${politique.minimum}`
  + ` · bots : ${politique.bots}`);
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
