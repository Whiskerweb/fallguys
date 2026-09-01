-- ============================================================================
--  POLITIQUES D'ACCES
--
--  Le navigateur recoit la cle `anon` de Supabase. Elle est PUBLIQUE : elle est
--  dans le bundle JavaScript, lisible par n'importe qui. La seule chose qui
--  separe alors un joueur de la caisse, ce sont les regles ci-dessous.
--
--  Regle unique, dont tout le reste decoule :
--    le joueur peut LIRE ce qui le concerne, et n'ecrit RIEN.
--
--  Toute ecriture monetaire passe par le backend avec la cle `service_role`, qui
--  contourne RLS et ne quitte jamais le serveur. Rater ce point, c'est refaire
--  le `localStorage` du prototype avec des etapes supplementaires — et cette
--  fois avec de l'argent dedans.
-- ============================================================================

alter table public.profiles       enable row level security;
alter table public.ledger_tx      enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.deposits       enable row level security;
alter table public.withdrawals    enable row level security;
alter table public.matches        enable row level security;

-- ---------------------------------------------------------------------------
--  Le grand livre : AUCUNE POLITIQUE, volontairement.
--
--  RLS active sans politique = personne ne passe. Ni lecture, ni ecriture, pour
--  tout role autre que `service_role`. Les lignes du livre ne sont donc jamais
--  exposees telles quelles : le joueur lit son solde par la fonction dediee
--  plus bas, qui filtre sur SON identifiant et sur rien d'autre.
--
--  L'absence de politique est ici une DECISION, pas un oubli. Si vous ajoutez un
--  jour un `select` sur ces deux tables, relisez cette ligne d'abord : exposer
--  `ledger_entries` en lecture, c'est publier les mouvements de tous les joueurs.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
--  Profil : lecture de sa propre ligne, et c'est tout.
--
--  Pas de politique d'`update` : le joueur ne modifie meme pas son propre wallet.
--  Lier une adresse est un acte monetaire — il conditionne la destination de tous
--  les retraits futurs — donc il passe par le backend, apres verification de la
--  signature. Un `update` client sur `wallet` serait une porte de detournement.
-- ---------------------------------------------------------------------------
drop policy if exists profils_lecture_de_soi on public.profiles;
create policy profils_lecture_de_soi on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------------
--  Historique : le joueur voit ses depots, ses retraits, ses parties.
--  En lecture seule, toujours filtre sur lui.
-- ---------------------------------------------------------------------------
drop policy if exists depots_lecture_de_soi on public.deposits;
create policy depots_lecture_de_soi on public.deposits
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists retraits_lecture_de_soi on public.withdrawals;
create policy retraits_lecture_de_soi on public.withdrawals
  for select to authenticated
  using (user_id = auth.uid());

-- Les parties sont publiques en lecture : le classement d'une partie terminee
-- n'est un secret pour personne, et c'est ce qui permettra a un joueur de
-- verifier lui-meme le calcul de son gain. Aucun solde n'y figure.
drop policy if exists parties_lecture_publique on public.matches;
create policy parties_lecture_publique on public.matches
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
--  Le solde, par fonction plutot que par table
--
--  `security definer` : la fonction s'execute avec les droits de son
--  proprietaire et voit donc le livre, que l'appelant ne voit pas. Le filtre sur
--  `auth.uid()` est ecrit ICI, en dur, hors de portee de l'appelant : il ne peut
--  pas demander le solde de quelqu'un d'autre, parce qu'il ne peut rien demander
--  du tout — il n'y a pas de parametre.
--
--  `set search_path = ''` n'est pas une precaution de style : sans lui, un
--  appelant capable de creer un schema prioritaire detournerait les tables
--  referencees dans le corps. Toute fonction `security definer` doit le porter,
--  et tous les noms qu'elle utilise doivent etre pleinement qualifies.
-- ---------------------------------------------------------------------------
create or replace function public.mon_solde()
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(sum(e.amount_micros), 0)::bigint
    from public.ledger_entries e
   where e.compte = 'user:' || auth.uid()::text;
$$;

create or replace function public.mon_historique(limite int default 50)
returns table (
  cree_le       timestamptz,
  genre         text,
  amount_micros bigint,
  metadata      jsonb
)
language sql
security definer
set search_path = ''
stable
as $$
  select e.cree_le, t.genre, e.amount_micros, t.metadata
    from public.ledger_entries e
    join public.ledger_tx t on t.id = e.tx_id
   where e.compte = 'user:' || auth.uid()::text
   order by e.id desc
   limit least(greatest(limite, 1), 200);
$$;

-- ---------------------------------------------------------------------------
--  Qui a le droit d'appeler ces deux fonctions
--
--  On revoque de `public` ET NOMMEMENT DE `anon`. Le second n'est pas redondant :
--  Supabase pose des droits par defaut (`alter default privileges ... grant execute
--  ... to anon, authenticated`) qui s'appliquent a toute fonction nouvellement creee.
--  Ce grant-la est explicite, il n'appartient pas a `public`, et un `revoke ... from
--  public` ne l'enleve donc pas.
--
--  Verifie sur la vraie base : avant cette ligne, `mon_solde()` repondait 200 a une
--  requete portant la seule cle publique. Elle ne fuitait rien — `auth.uid()` vaut NULL
--  pour un anonyme, donc la somme portait sur zero ligne — mais le code annoncait une
--  restriction que la base n'appliquait pas. Un ecart de ce genre finit toujours par
--  etre lu comme une garantie qu'il n'offre pas.
-- ---------------------------------------------------------------------------
revoke all on function public.mon_solde()          from public, anon;
revoke all on function public.mon_historique(int)  from public, anon;
grant execute on function public.mon_solde()         to authenticated;
grant execute on function public.mon_historique(int) to authenticated;

-- ---------------------------------------------------------------------------
--  Droits de table — reproduction fidele de ce que fait Supabase
--
--  Supabase accorde par defaut lecture ET ecriture sur `public` aux roles `anon` et
--  `authenticated`, puis compte sur RLS comme unique barriere. On l'ecrit ici
--  explicitement plutot que de s'en remettre a un defaut invisible : c'est ce qui
--  rend le test de RLS honnete. Un test qui echouerait faute de `grant` prouverait
--  que la permission manque, pas que la politique protege.
--
--  Autrement dit : sous ces droits, RLS est LA SEULE chose qui separe un joueur du
--  grand livre. C'est pourquoi les deux tables du livre n'ont aucune politique.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.profiles, public.ledger_tx, public.ledger_entries,
  public.deposits, public.withdrawals, public.matches
  to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
