/**
 * EFFACE LES DONNEES D'ARGENT d'un reseau d'essai — une fois, a la main, jamais sur mainnet.
 *
 *   node outils/purger.mjs          # dit ce qu'il effacerait
 *   node outils/purger.mjs --oui    # l'efface
 *
 * Quand le jeu change de chaine, les soldes du grand livre ne correspondent plus a rien :
 * ils etaient adosses a des wallets d'une autre chaine. On ne « migre » pas de l'argent
 * d'essai, on repart de zero. Les comptes Supabase (auth) sont GARDES ; les profils
 * aussi, avec une adresse de depot re-derivee a la premiere requete. Tout le reste —
 * livre, depots, retraits, parties, journal de chaine, rachats — est efface.
 */
const { config } = await import('../src/config.js');
if (config.reseau === 'mainnet') { console.error('purger : JAMAIS sur mainnet.'); process.exit(1); }
const { creerPool } = await import('../src/pool.js');
const { enrober } = await import('../src/base.js');
const db = enrober(creerPool());
const tables = ['burns', 'purchases', 'chain_tx', 'chain_curseur', 'withdrawals', 'deposits', 'matches', 'ledger_entries', 'ledger_tx'];
for (const t of tables) {
  const n = (await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n;
  console.log(`  ${t.padEnd(16)} ${n} ligne(s)`);
}
if (!process.argv.includes('--oui')) { console.log(`\n  Rien n'est efface (reseau ${config.reseau}). Relancer avec --oui.`); await db.fermer(); process.exit(0); }
await db.executer(`truncate table ${tables.map((t) => `public.${t}`).join(', ')} restart identity`);
await db.query(`update public.profiles set wallet = null, wallet_lie_le = null, dernier_robinet_le = null`);
console.log(`\n  Efface. Les profils gardent leur compte ; adresse de depot re-derivee a la prochaine requete.`);
await db.fermer();
