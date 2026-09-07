/**
 * LES STATISTIQUES PUBLIQUES — ce que la page de suivi montre a tout le monde.
 *
 * Aucun solde de joueur n'en sort, aucun identifiant non plus : des totaux, des
 * comptes, et des haches de transactions que n'importe qui peut ouvrir sur
 * l'explorateur. C'est deliberement la meme information que celle qu'on peut reconstituer
 * depuis la chaine — la page ne fait que l'assembler et la mettre a jour en direct.
 *
 * Les lectures sur la chaine (soldes du pool, offre de BG) sont mises en cache quelques
 * secondes : dix onglets ouverts ne doivent pas faire dix fois les memes appels RPC.
 */

import { config } from './config.js';
import { tresorerie } from './robinhood/tresorerie.js';
import { etatMarche, bilanBrulage } from './robinhood/brulage.js';
import { lienExplorateur, lienAdresse } from './robinhood/chaine.js';
import { RESEAUX } from './robinhood/reseaux.js';
import { bilanBoutique } from './boutique.js';

let cache = null;
let cacheA = 0;
const DUREE_CACHE = 4000;

/** La derniere verification livre ↔ chaine, posee par le tour de fond. */
let derniereVerification = null;
export function poserVerification(v) { derniereVerification = v; }

export async function statistiques(db, chaine) {
  if (cache && Date.now() - cacheA < DUREE_CACHE) return cache;

  const un = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const tous = async (sql, params = []) => (await db.query(sql, params)).rows;

  const parties = await un(`
    select count(*) filter (where statut = 'reglee' and mise_micros > 0)::int as reglees,
           count(*) filter (where statut = 'engagee')::int as en_cours,
           count(*) filter (where statut = 'annulee')::int as annulees,
           coalesce(sum(pot_micros) filter (where statut = 'reglee'), 0)::text as volume,
           coalesce(sum(rake_micros) filter (where statut = 'reglee'), 0)::text as rake,
           coalesce(sum(effectif) filter (where statut = 'reglee'), 0)::int as mises_jouees
      from public.matches`);
  const parMode = await tous(`
    select mode, count(*)::int as n, coalesce(sum(pot_micros), 0)::text as volume
      from public.matches where statut = 'reglee' and mise_micros > 0 group by mode`);
  const parMise = await tous(`
    select mise_micros::text as mise, count(*)::int as n
      from public.matches where statut = 'reglee' and mise_micros > 0 group by mise_micros order by mise_micros`);
  const joueurs = await un(`select count(*)::int as inscrits from public.profiles`);
  const depots = await un(`
    select count(*)::int as n, coalesce(sum(amount_micros), 0)::text as total from public.deposits`);
  const retraits = await un(`
    select count(*) filter (where statut = 'confirme')::int as n,
           coalesce(sum(amount_micros) filter (where statut = 'confirme'), 0)::text as total,
           count(*) filter (where statut in ('demande', 'soumis'))::int as en_attente
      from public.withdrawals`);
  const chaineTx = await un(`
    select count(*) filter (where statut = 'confirme')::int as confirmees,
           count(*) filter (where statut in ('prevu', 'signe'))::int as en_transit,
           count(*) filter (where statut = 'echoue')::int as echouees
      from public.chain_tx`);
  const dernieres = await tous(`
    select objet, montant::text as montant, coalesce(mint, 'usdg') as mint, signature, partie, statut, cree_le, clos_le
      from public.chain_tx where signature is not null
      order by coalesce(clos_le, cree_le) desc limit 40`);
  const dernieresParties = await tous(`
    select id, mode, mise_micros::text as mise, effectif, issue, pot_micros::text as pot, rake_micros::text as rake,
           statut, coalesce(regle_le, engagee_le) as quand, adresse_pot
      from public.matches where mise_micros > 0 order by coalesce(regle_le, engagee_le) desc limit 12`);
  const livre = await un(`
    select coalesce(sum(amount_micros), 0)::text as somme,
           coalesce(sum(amount_micros) filter (where compte = 'treasury:rake'), 0)::text as rake,
           coalesce(sum(amount_micros) filter (where compte = 'treasury:pool'), 0)::text as pool,
           coalesce(sum(amount_micros) filter (where compte like 'user:%'), 0)::text as joueurs
      from public.ledger_entries`);

  let marche = null;
  try { marche = await etatMarche(chaine); } catch (e) { marche = { erreur: e.message }; }
  const brulage = await bilanBrulage(db);
  const boutique = await bilanBoutique(db);

  const adresses = tresorerie.adresses();
  cache = {
    reseau: config.reseau,
    // `chaine`, plus bas, compte les transactions : le reseau porte un autre nom, sinon l'un ecrase l'autre.
    reseauDetail: { nom: RESEAUX[config.reseau]?.nom ?? config.reseau, chainId: config.chainId, explorateur: RESEAUX[config.reseau]?.explorateur ?? null, stable: config.stableSymbole },
    a: new Date().toISOString(),
    contrats: { usdg: config.usdgAdresse ?? null, bg: config.bgAdresse ?? null, lot: config.lotAdresse ?? null },
    adresses,
    liens: {
      caisse: adresses.caisse && lienAdresse(adresses.caisse),
      frais: adresses.frais && lienAdresse(adresses.frais),
      pool: adresses.pool && lienAdresse(adresses.pool),
      bg: config.bgAdresse && lienAdresse(config.bgAdresse),
      usdg: config.usdgAdresse && lienAdresse(config.usdgAdresse),
      lot: config.lotAdresse && lienAdresse(config.lotAdresse),
    },
    parties: {
      reglees: parties.reglees, enCours: parties.en_cours, annulees: parties.annulees,
      volume: Number(parties.volume), rake: Number(parties.rake), misesJouees: parties.mises_jouees,
      parMode: parMode.map((m) => ({ mode: m.mode, n: m.n, volume: Number(m.volume) })),
      parMise: parMise.map((m) => ({ mise: Number(m.mise), n: m.n })),
    },
    joueurs: { inscrits: joueurs.inscrits },
    depots: { n: depots.n, total: Number(depots.total) },
    retraits: { n: retraits.n, total: Number(retraits.total), enAttente: retraits.en_attente },
    chaine: {
      confirmees: chaineTx.confirmees, enTransit: chaineTx.en_transit, echouees: chaineTx.echouees,
      dernieres: dernieres.map((t) => ({ ...t, montant: Number(t.montant), lien: lienExplorateur(t.signature) })),
    },
    livre: { somme: Number(livre.somme), rake: Number(livre.rake), pool: Number(livre.pool), joueurs: Number(livre.joueurs) },
    brulage: {
      ...brulage,
      offreInitiale: 1_000_000_000 * 1_000_000,
      derniers: brulage.derniers.map((b) => ({ ...b, lien: lienExplorateur(b.signature) })),
    },
    marche,
    /* Les skins vendus : chaque USDG est parti aux frais, donc au brulage. */
    boutique,
    dernieresParties: dernieresParties.map((p) => ({ ...p, lienPot: p.adresse_pot && lienAdresse(p.adresse_pot) })),
    verification: derniereVerification,
  };
  cacheA = Date.now();
  return cache;
}

export function invaliderStats() { cache = null; }
