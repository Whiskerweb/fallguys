/**
 * Le service. UN SEUL PROCESSUS, et c'est une contrainte, pas un choix de simplicite.
 *
 * Le guetteur de depots et le signataire de retraits ne doivent pas tourner en double :
 * deux guetteurs qui balaient la meme adresse produisent deux transactions concurrentes
 * sur le meme solde, et deux signataires peuvent envoyer deux fois le meme retrait. C'est
 * le scenario dont on ne se releve pas. Une seule instance, donc — voir README.md.
 *
 * Lancer depuis backend/, apres avoir charge le .env de la racine :
 *   set -a && source ../.env && set +a && npm start
 */

import { creerPool } from './pool.js';
import { enrober, appliquerSchema } from './base.js';
import { creerServeur } from './http/serveur.js';
import { unTour } from './solana/guetteur.js';
import { executer } from './solana/retraits.js';
import { config, exiger } from './config.js';
import { verifierInvariant } from './livre.js';
import { ecrire } from './argent.js';

exiger('databaseUrl', 'supabaseUrl', 'supabaseAnon', 'graineDepots');

const db = enrober(creerPool());

if (process.env.APPLIQUER_SCHEMA === '1') {
  console.log('schema :', (await appliquerSchema(db)).join(', '));
}

/*
 * On verifie l'invariant AU DEMARRAGE, avant d'accepter la moindre requete.
 *
 * Si le grand livre est desequilibre, quelque chose s'est passe qu'on ne comprend pas —
 * une migration, une intervention manuelle, un bug. Continuer a payer par-dessus une
 * comptabilite fausse aggrave le probleme a chaque partie. Mieux vaut refuser de demarrer
 * et le voir tout de suite.
 */
const inv = await verifierInvariant(db);
if (inv.total !== 0 || inv.desequilibres.length || inv.potsNonSoldes.length) {
  console.error('GRAND LIVRE INCOHERENT — demarrage refuse');
  console.error(`  somme du livre : ${inv.total} (attendu 0)`);
  console.error(`  mouvements desequilibres : ${inv.desequilibres.length}`);
  console.error(`  pots de parties reglees non soldes : ${inv.potsNonSoldes.length}`);
  process.exit(1);
}
console.log(`grand livre equilibre · reseau ${config.reseau} · mint ${config.mintUsdc}`);

creerServeur(db).listen(config.port, () => {
  console.log(`API sur http://127.0.0.1:${config.port}`);
});

/*
 * BOUCLE DE FOND. Elle fait deux choses que personne ne declenche : voir arriver les
 * depots dont le joueur n'a pas encore rafraichi son lobby, et reprendre les retraits
 * laisses en plan par un arret au mauvais moment.
 *
 * Le second point est le plus important : sans lui, un retrait interrompu entre le debit
 * et la diffusion resterait immobilise indefiniment, argent reserve et jamais envoye.
 */
const INTERVALLE = 15_000;
let enCours = false;

setInterval(async () => {
  if (enCours) return;      // un tour qui deborde ne doit pas en declencher un second.
  enCours = true;
  try {
    const vus = await unTour(db);
    for (const d of vus) console.log(`depot ${ecrire(d.micros)} USDC pour ${d.userId} (${d.signature})`);

    const enAttente = await db.query(
      `select id from public.withdrawals where statut in ('demande', 'soumis')
        order by demande_le limit 10`,
    );
    for (const { id } of enAttente.rows) {
      try {
        const r = await executer(db, id);
        if (r.statut === 'confirme') console.log(`retrait ${id} confirme (${r.signature})`);
      } catch (e) {
        console.error(`retrait ${id} : ${e.message}`);
      }
    }
  } catch (e) {
    console.error('tour de fond :', e.message);
  } finally {
    enCours = false;
  }
}, INTERVALLE);
