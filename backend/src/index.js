/**
 * Le service. UN SEUL PROCESSUS, et c'est une contrainte, pas un choix de simplicite.
 *
 * Le guetteur de depots, le signataire des mises, des gains, des retraits et des rachats
 * ne doivent pas tourner en double : deux processus qui signent depuis le meme wallet
 * produisent deux transactions concurrentes sur le meme solde, et deux signataires
 * peuvent envoyer deux fois le meme paiement. C'est le scenario dont on ne se releve pas.
 * Une seule instance, donc — voir README.md.
 *
 * Lancer depuis backend/, apres avoir charge le .env de la racine :
 *   set -a && source ../.env && set +a && npm start
 */

import { creerPool } from './pool.js';
import { enrober, appliquerSchema } from './base.js';
import { creerServeur } from './http/serveur.js';
import { unTour } from './solana/guetteur.js';
import { executer } from './solana/retraits.js';
import { creerChaine, connexion } from './solana/chaine.js';
import { tresorerie } from './solana/tresorerie.js';
import { rattraperChaine } from './match/regler.js';
import { racheterEtBruler } from './solana/brulage.js';
import { verifierChaine } from './solana/reconciliation.js';
import { config, exiger } from './config.js';
import { verifierInvariant } from './livre.js';
import { ecrire } from './argent.js';
import { publier } from './evenements.js';
import { invaliderStats, poserVerification } from './stats.js';

exiger('databaseUrl', 'supabaseUrl', 'supabaseAnon', 'graineDepots', 'caisseCle', 'fraisCle', 'poolCle', 'serveurPublique');

const db = enrober(creerPool());

if (process.env.APPLIQUER_SCHEMA === '1') {
  console.log('schema :', (await appliquerSchema(db)).join(', '));
}

/*
 * On verifie l'invariant AU DEMARRAGE, avant d'accepter la moindre requete. Si le grand
 * livre est desequilibre, continuer a payer par-dessus une comptabilite fausse aggrave le
 * probleme a chaque partie. Mieux vaut refuser de demarrer et le voir tout de suite.
 */
const inv = await verifierInvariant(db);
if (inv.total !== 0 || inv.desequilibres.length || inv.potsNonSoldes.length) {
  console.error('GRAND LIVRE INCOHERENT — demarrage refuse');
  console.error(`  somme du livre : ${inv.total} (attendu 0)`);
  console.error(`  mouvements desequilibres : ${inv.desequilibres.length}`);
  console.error(`  pots de parties reglees non soldes : ${inv.potsNonSoldes.length}`);
  process.exit(1);
}

/*
 * La chaine. Chaque confirmation est publiee : c'est ce que la page de suivi ecoute.
 */
const chaine = creerChaine({
  db,
  surEvenement: (e) => { publier('chaine', e); invaliderStats(); },
});

// La tresorerie, telle qu'on la voit d'ici : les adresses, et de quoi payer les frais.
const adresses = tresorerie.adresses();
let solCaisse = null;
try { solCaisse = await connexion().getBalance(tresorerie.caisse().publicKey) / 1e9; } catch { /* RPC muet */ }
console.log(`grand livre equilibre · reseau ${config.reseau} · USDC ${config.mintUsdc} · BG ${config.mintBg ?? 'PAS ENCORE CREE'}`);
console.log(`  caisse ${adresses.caisse} · ${solCaisse === null ? 'SOL inconnu (RPC muet)' : `${solCaisse.toFixed(4)} SOL`}`);
console.log(`  frais  ${adresses.frais}`);
console.log(`  pool   ${adresses.pool}`);
if (solCaisse !== null && solCaisse < 0.05) {
  console.warn('  ATTENTION : la caisse manque de SOL pour payer les frais. Sur devnet : https://faucet.solana.com');
}

creerServeur(db, { chaine }).listen(config.port, () => {
  console.log(`API sur http://127.0.0.1:${config.port} · suivi sur http://127.0.0.1:${config.port}/suivi`);
});

/*
 * BOUCLE DE FOND. Elle fait ce que personne ne declenche : voir arriver les depots,
 * envoyer les retraits, rejouer ce que la chaine n'a pas encore fait, bruler les frais,
 * et verifier que le livre et la chaine racontent la meme histoire.
 */
const INTERVALLE = 15_000;
let enCours = false;
let tours = 0;

setInterval(async () => {
  if (enCours) return;      // un tour qui deborde ne doit pas en declencher un second.
  enCours = true;
  tours++;
  try {
    const vus = await unTour(db);
    for (const d of vus) console.log(`depot ${ecrire(d.micros)} USDC pour ${d.userId} (${d.signature})`);
    if (vus.length) { publier('depot', { n: vus.length }); invaliderStats(); }

    const enAttente = await db.query(
      `select id from public.withdrawals where statut = 'demande' order by demande_le limit 10`,
    );
    for (const { id } of enAttente.rows) {
      try {
        const r = await executer(db, chaine, id);
        if (r.statut === 'confirme') { console.log(`retrait ${id} confirme (${r.signature})`); publier('retrait', { statut: 'confirme' }); }
      } catch (e) {
        console.error(`retrait ${id} : ${e.message}`);
      }
    }

    const rattrapage = await rattraperChaine(db, chaine);
    if (rattrapage.reglees || rattrapage.annulees || rattrapage.reprise?.echouees || rattrapage.reprise?.confirmees) {
      console.log(`rattrapage : ${JSON.stringify(rattrapage)}`);
    }
    for (const e of rattrapage.erreurs) console.error(`rattrapage : ${e}`);

    if (config.brulageActif) {
      try {
        const b = await racheterEtBruler(db, chaine);
        if (b?.statut === 'brule') {
          console.log(`brulage : ${ecrire(b.usdc)} USDC → ${(b.bg / 1e6).toFixed(2)} BG brules (${b.signature})`);
          publier('brulage', { usdc: b.usdc, bg: b.bg, signature: b.signature });
          invaliderStats();
        } else if (b && b.statut !== 'brule') {
          console.warn(`brulage : ${b.statut} ${b.raison ?? ''}`);
        }
      } catch (e) {
        console.error(`brulage : ${e.message}`);
      }
    }

    // La reconciliation coute un appel RPC par compte : un tour sur quatre, une minute.
    if (tours % 4 === 1) {
      try {
        const v = await verifierChaine(db, chaine);
        poserVerification(v);
        invaliderStats();
        publier('verification', { ok: v.ok, verifies: v.verifies, ecarts: v.ecarts.length });
        if (!v.ok) console.warn(`LIVRE ≠ CHAINE : ${v.ecarts.length} ecart(s) — ${JSON.stringify(v.ecarts.slice(0, 3))}`);
      } catch (e) {
        console.error(`verification : ${e.message}`);
      }
    }
  } catch (e) {
    console.error('tour de fond :', e.message);
  } finally {
    enCours = false;
  }
}, INTERVALLE);
