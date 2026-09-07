/**
 * Le service. UN SEUL PROCESSUS, et c'est une contrainte, pas un choix de simplicite.
 *
 * Le guetteur de depots, le signataire des mises, des gains, des retraits et des rachats
 * ne doivent pas tourner en double : deux processus qui signent depuis la meme caisse
 * produisent deux transactions concurrentes sur le meme nonce, et deux signataires
 * peuvent envoyer deux fois le meme paiement. C'est le scenario dont on ne se releve pas.
 * Une seule instance, donc — voir README.md.
 *
 * Lancer depuis backend/ : `npm start` (le .env de la racine est lu tout seul).
 */

import { formatEther } from 'ethers';
import { creerPool } from './pool.js';
import { enrober, appliquerSchema } from './base.js';
import { creerServeur } from './http/serveur.js';
import { unTour } from './robinhood/guetteur.js';
import { executer } from './robinhood/retraits.js';
import { creerChaine, connexion } from './robinhood/chaine.js';
import { tresorerie } from './robinhood/tresorerie.js';
import { RESEAUX } from './robinhood/reseaux.js';
import { rattraperChaine } from './match/regler.js';
import { racheterEtBruler } from './robinhood/brulage.js';
import { verifierChaine } from './robinhood/reconciliation.js';
import { config, exiger } from './config.js';
import { verifierInvariant } from './livre.js';
import { ecrire } from './argent.js';
import { publier } from './evenements.js';
import { invaliderStats, poserVerification } from './stats.js';

exiger('databaseUrl', 'supabaseUrl', 'supabaseAnon', 'graineDepots', 'caisseCle', 'fraisCle', 'poolCle', 'serveurPublique', 'usdgAdresse', 'lotAdresse');

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

// La tresorerie, telle qu'on la voit d'ici : les adresses, et de quoi payer le gaz.
const adresses = tresorerie.adresses();
const reseau = RESEAUX[config.reseau] ?? { nom: config.reseau };
let ethCaisse = null;
let contratsOk = null;
try {
  const co = connexion();
  ethCaisse = Number(formatEther(await co.getBalance(adresses.caisse)));
  // Un contrat absent repond « 0x » : mieux vaut le lire ici qu'au premier reglement.
  const codes = await Promise.all([config.usdgAdresse, config.lotAdresse, config.bgAdresse].map((a) => (a ? co.getCode(a) : Promise.resolve('0x'))));
  contratsOk = { usdg: codes[0] !== '0x', lot: codes[1] !== '0x', bg: codes[2] !== '0x' };
} catch { /* RPC muet */ }
console.log(`grand livre equilibre · ${reseau.nom} (chainId ${config.chainId}) · ${config.stableSymbole} ${config.usdgAdresse} · BG ${config.bgAdresse ?? 'PAS ENCORE CREE'} · Lot ${config.lotAdresse}`);
console.log(`  caisse ${adresses.caisse} · ${ethCaisse === null ? 'ETH inconnu (RPC muet)' : `${ethCaisse.toFixed(5)} ETH`}`);
console.log(`  frais  ${adresses.frais}`);
console.log(`  pool   ${adresses.pool}`);
if (contratsOk && (!contratsOk.usdg || !contratsOk.lot)) {
  console.error(`  CONTRAT ABSENT sur ${reseau.nom} : USDG ${contratsOk.usdg ? 'ok' : 'MANQUE'}, Lot ${contratsOk.lot ? 'ok' : 'MANQUE'} — lancez « node outils/contrats.mjs »`);
  process.exit(1);
}
/*
 * MAINNET : de l'argent reel. On refuse de demarrer sur ce qui serait une faute, pas une
 * imprudence : une origine ouverte a tout le web, les cles de test, ou un pool sans
 * dollars (le brulage vendrait tout le BG pour un centime — il refuse, mais autant le
 * savoir au demarrage). Chaque refus dit quoi faire.
 */
if (config.reseau === 'mainnet') {
  const fautes = [];
  if (!config.origine || config.origine === '*') fautes.push('ORIGINE_AUTORISEE vaut « * » : poser l\'adresse publiee du jeu');
  const cleDeTest = (octet) => '0x' + Buffer.alloc(32, octet).toString('hex');
  if ([1, 2, 3, 0x11, 0x22, 0x33].some((o) => [config.caisseCle, config.fraisCle, config.poolCle].includes(cleDeTest(o)))) fautes.push('une cle de TEST est en service : npm run tresorerie -- --nouvelles');
  if (!/^https?:\/\/[^/]*alchemy|^https?:\/\/[^/]*robinhood\.com/.test(config.rpc)) fautes.push(`RPC inattendu pour mainnet : ${config.rpc}`);
  if (fautes.length) { for (const f of fautes) console.error(`  MAINNET REFUSE : ${f}`); process.exit(1); }
  try {
    const pool = Number(await chaine.solde(adresses.pool, 'usdg'));
    if (pool <= 0) console.warn(`  ATTENTION : le pool ${adresses.pool} n'a pas de ${config.stableSymbole} — le brulage attendra qu'il soit dote`);
  } catch { /* RPC muet : deja dit */ }
  console.log(`  MAINNET · dollar ${config.stableSymbole} · robinet ferme · USDG d'essai jamais deploye ici`);
}
if (ethCaisse !== null && ethCaisse < 0.002) {
  console.warn(`  ATTENTION : la caisse manque d'ETH pour payer le gaz.${reseau.faucet ? ` Testnet : ${reseau.faucet}` : ''}`);
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
    for (const d of vus) console.log(`depot ${ecrire(d.micros)} USDG pour ${d.userId} (${d.signature})`);
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
          console.log(`brulage : ${ecrire(b.usdg)} USDG → ${(b.bg / 1e6).toFixed(2)} BG brules (${b.signature})`);
          publier('brulage', { usdg: b.usdg, bg: b.bg, signature: b.signature });
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
