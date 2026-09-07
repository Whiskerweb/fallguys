/**
 * LIVRE ↔ CHAINE — la verification qui dit si les deux racontent la meme histoire.
 *
 * Le grand livre est la comptabilite ; la chaine en est la preuve. Ils doivent dire la
 * meme chose compte par compte, a ceci pres que la chaine est EN RETARD le temps qu'une
 * transaction se confirme. On calcule donc, pour chaque compte, ce que la chaine DEVRAIT
 * montrer compte tenu de ce qui est en transit, et on compare a ce qu'elle montre.
 *
 *   joueur : solde du livre + sorties en transit (mise, retrait, achat pas encore confirmes)
 *                            − entrees en transit (gain, annulation pas encore confirmes)
 *   frais  : treasury:rake  + rake et achats en transit − rachats en transit
 *   pot    : engagee → les mises confirmees ; reglee ou annulee → zero une fois payee
 *
 * Un ecart n'est pas forcement une fraude : c'est d'abord une transaction en suspens que
 * `rattraperChaine` n'a pas encore tranchee, ou un depot que le guetteur n'a pas encore
 * vu. Mais un ecart qui PERSISTE est la seule chose qui merite qu'on arrete le service,
 * et c'est pour ca que la page de suivi l'affiche a tout le monde.
 */

import { solde, compte } from '../livre.js';
import { tresorerie } from './tresorerie.js';

const EN_TRANSIT = `('prevu', 'signe')`;

async function transit(db, ou, params) {
  const r = await db.query(
    `select objet, coalesce(sum(montant), 0)::text as total from public.chain_tx
      where statut in ${EN_TRANSIT} and ${ou} group by objet`, params,
  );
  const par = {};
  for (const l of r.rows) par[l.objet] = Number(l.total);
  return par;
}

/**
 * @returns {Promise<{ok: boolean, verifies: number, ecarts: Array, verifieLe: string}>}
 */
export async function verifierChaine(db, chaine, { joueursMax = 200 } = {}) {
  const ecarts = [];
  let verifies = 0;

  // ---- les joueurs ----
  const joueurs = (await db.query(
    `select p.id, p.adresse_depot from public.profiles p
      where exists (select 1 from public.ledger_entries e where e.compte = 'user:' || p.id::text)
      order by p.cree_le desc limit $1`, [joueursMax],
  )).rows;
  for (const j of joueurs) {
    const livre = await solde(db, compte.joueur(j.id));
    const t = await transit(db, 'user_id = $1', [j.id]);
    // Un retrait DEMANDE est deja debite au livre, et n'a pas encore de ligne de journal :
    // ses fonds sont encore sur le wallet, et c'est normal.
    const demandes = Number((await db.query(
      `select coalesce(sum(amount_micros), 0)::text as t from public.withdrawals where user_id = $1 and statut = 'demande'`, [j.id],
    )).rows[0].t);
    const attendu = livre + demandes + (t.mise ?? 0) + (t.retrait ?? 0) + (t.achat ?? 0) - (t.gain ?? 0) - (t.annulation ?? 0);
    const surChaine = await chaine.solde(j.adresse_depot, 'usdg');
    verifies++;
    if (surChaine !== attendu) {
      ecarts.push({ compte: `joueur ${j.id.slice(0, 8)}…`, adresse: j.adresse_depot, livre, attendu, chaine: surChaine, ecart: surChaine - attendu });
    }
  }

  // ---- les frais ----
  {
    const livre = await solde(db, compte.rake);
    const t = await transit(db, `objet in ('rake', 'rachat', 'achat') and (mint = 'usdg' or mint is null)`, []);
    const attendu = livre - (t.rake ?? 0) - (t.achat ?? 0) + (t.rachat ?? 0);
    const adresse = tresorerie.frais().address;
    const surChaine = await chaine.solde(adresse, 'usdg');
    verifies++;
    if (surChaine !== attendu) ecarts.push({ compte: 'frais', adresse, livre, attendu, chaine: surChaine, ecart: surChaine - attendu });
  }

  // ---- les pots des parties engagees et des parties recemment closes ----
  const pots = (await db.query(
    `select id, statut, adresse_pot from public.matches
      where mise_micros > 0 and (statut = 'engagee' or regle_le > now() - interval '1 day' or engagee_le > now() - interval '1 day')
      order by coalesce(regle_le, engagee_le) desc limit 100`,
  )).rows;
  for (const p of pots) {
    const adresse = p.adresse_pot ?? tresorerie.pot(p.id).address;
    const livre = await solde(db, compte.pot(p.id));
    const t = await transit(db, 'partie = $1', [p.id]);
    const attendu = livre - (t.mise ?? 0) + (t.gain ?? 0) + (t.rake ?? 0) + (t.annulation ?? 0);
    const surChaine = await chaine.solde(adresse, 'usdg');
    verifies++;
    if (surChaine !== attendu) ecarts.push({ compte: `pot ${p.id}`, adresse, livre, attendu, chaine: surChaine, ecart: surChaine - attendu });
  }

  return { ok: ecarts.length === 0, verifies, ecarts, verifieLe: new Date().toISOString() };
}
