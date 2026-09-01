-- ============================================================================
--  LE GRAND LIVRE
--
--  Toute somme d'argent du jeu vit ici, et nulle part ailleurs. Un solde n'est
--  jamais une colonne qu'on incremente : c'est la SOMME des lignes d'un compte.
--  Un solde stocke finit toujours par diverger de son historique ; une somme ne
--  le peut pas.
--
--  Ecriture en PARTIE DOUBLE : chaque mouvement ecrit au moins deux lignes de
--  signe oppose dont la somme vaut exactement zero. L'invariant du systeme tient
--  alors en une requete — `select sum(amount_micros) from ledger_entries` doit
--  valoir 0 — et n'importe qui peut la lancer sans rien connaitre du code.
--
--  Tous les montants sont en MICRO-UNITES ENTIERES (1 USDC = 1 000 000), en
--  `bigint`. Jamais `numeric`, jamais de flottant : c'est le meme type et la
--  meme echelle que `Money.Micros` dans src/Fallguys.Rules, pour qu'aucune
--  conversion n'intervienne entre le calcul du gain et son paiement.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Profils — le miroir applicatif de `auth.users`
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  pseudo            text,

  -- Adresse Solana LIEE au compte, prouvee par signature (Sign in with Solana).
  -- C'est la seule destination possible d'un retrait : un compte vole ne peut donc
  -- pas rediriger les fonds, et l'adresse de sortie est celle dont le joueur a
  -- demontre la possession — pas une chaine saisie au clavier.
  wallet            text unique,
  wallet_lie_le     timestamptz,

  -- Adresse de DEPOT dediee, derivee de la graine maitresse et de `id`.
  -- La cle privee n'est jamais stockee : elle est re-derivable a la demande.
  adresse_depot     text unique not null,

  -- Verrou anti-bot : la friction est a la SORTIE, pas a l'entree (spec section 2).
  premier_retrait_le timestamptz,

  cree_le           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
--  Mouvements
--
--  Un mouvement (`ledger_tx`) porte la cle d'idempotence ; ses lignes
--  (`ledger_entries`) portent l'argent. La separation n'est pas cosmetique : un
--  mouvement compte PLUSIEURS lignes, donc la contrainte d'unicite ne peut pas
--  vivre sur la ligne. C'est l'erreur qui laisse crediter deux fois le meme depot.
-- ---------------------------------------------------------------------------
create table if not exists public.ledger_tx (
  id          uuid primary key,

  -- 'depot' | 'mise' | 'rake' | 'gain' | 'remboursement' | 'retrait' | 'retrait_echoue'
  genre       text not null,

  -- CLE D'IDEMPOTENCE, unique par genre. Une signature de transaction Solana pour
  -- un depot, un identifiant de partie pour un reglement. `null` pour les
  -- mouvements qui n'ont pas de source externe rejouable.
  ref         text,

  metadata    jsonb not null default '{}',
  cree_le     timestamptz not null default now(),

  constraint ledger_tx_ref_unique unique (genre, ref)
);

create table if not exists public.ledger_entries (
  id             bigserial primary key,
  tx_id          uuid not null references public.ledger_tx (id) on delete restrict,

  -- 'user:<uuid>' | 'pot:<match_id>' | 'treasury:rake' | 'treasury:hot'
  -- | 'chain:in' | 'chain:out'
  compte         text not null,

  -- Signe. Debit negatif, credit positif. La somme par mouvement vaut zero.
  amount_micros  bigint not null,

  cree_le        timestamptz not null default now()
);

create index if not exists ledger_entries_compte_idx on public.ledger_entries (compte);
create index if not exists ledger_entries_tx_idx     on public.ledger_entries (tx_id);

-- ---------------------------------------------------------------------------
--  L'INVARIANT, garanti par la base et non par le code appelant
--
--  Contrainte DIFFEREE : elle se verifie au COMMIT, pas a chaque `insert`.
--  Il le faut, puisqu'un mouvement s'ecrit ligne par ligne et n'est equilibre
--  qu'une fois toutes ses lignes posees.
--
--  La placer ici plutot que dans le code TypeScript est deliberé : le jour ou
--  quelqu'un ecrit dans la base par un autre chemin — une migration, un script
--  de reprise, une console psql a 3 h du matin — la regle tient encore.
-- ---------------------------------------------------------------------------
create or replace function public.ledger_verifie_equilibre()
returns trigger
language plpgsql
as $$
declare
  desequilibre record;
begin
  select tx_id, sum(amount_micros) as ecart
    into desequilibre
    from public.ledger_entries
   where tx_id = coalesce(new.tx_id, old.tx_id)
   group by tx_id
  having sum(amount_micros) <> 0;

  if found then
    raise exception
      'mouvement % desequilibre de % micros : la partie double n''est pas respectee',
      desequilibre.tx_id, desequilibre.ecart;
  end if;

  return null;
end;
$$;

drop trigger if exists ledger_entries_equilibre on public.ledger_entries;
create constraint trigger ledger_entries_equilibre
  after insert or update or delete on public.ledger_entries
  deferrable initially deferred
  for each row execute function public.ledger_verifie_equilibre();

-- ---------------------------------------------------------------------------
--  Depots observes sur la chaine
--
--  La signature Solana EST la cle primaire : rejouer le meme bloc ne peut pas
--  crediter deux fois, et c'est la base qui le garantit, pas la prudence du
--  guetteur.
-- ---------------------------------------------------------------------------
create table if not exists public.deposits (
  signature      text primary key,
  user_id        uuid not null references public.profiles (id),
  amount_micros  bigint not null check (amount_micros > 0),
  slot           bigint,
  expediteur     text,
  vu_le          timestamptz not null default now(),
  credite_le     timestamptz,
  tx_id          uuid references public.ledger_tx (id)
);

create index if not exists deposits_user_idx on public.deposits (user_id);

-- ---------------------------------------------------------------------------
--  Retraits
--
--  Machine a etats : demande -> soumis -> confirme | echoue.
--  La signature est enregistree DES LA SOUMISSION, avant meme la confirmation :
--  c'est le seul moyen de savoir, apres un redemarrage au mauvais moment, qu'une
--  transaction est peut-etre deja partie. Re-signer sans cette trace, c'est
--  payer deux fois.
-- ---------------------------------------------------------------------------
create table if not exists public.withdrawals (
  id              uuid primary key,
  user_id         uuid not null references public.profiles (id),
  amount_micros   bigint not null check (amount_micros > 0),

  -- Copiee depuis `profiles.wallet` AU MOMENT DE LA DEMANDE. Si le joueur change
  -- de wallet ensuite, le retrait deja demande part quand meme a l'adresse qui
  -- avait ete validee — jamais a la nouvelle.
  destination     text not null,

  statut          text not null default 'demande'
                  check (statut in ('demande', 'soumis', 'confirme', 'echoue')),
  signature       text unique,

  -- Le blockhash de la transaction signee.
  --
  -- Il repond a la seule question qui autorise a RE-SIGNER apres un arret : « cette
  -- transaction peut-elle encore etre acceptee ? » Tant que le blockhash est valide, la
  -- reponse est oui, et en signer une seconde paierait deux fois. Une fois expire, la
  -- premiere ne partira jamais et l'on peut recommencer sans risque.
  blockhash       text,

  raison_echec    text,

  demande_le      timestamptz not null default now(),
  soumis_le       timestamptz,
  clos_le         timestamptz,

  tx_id           uuid references public.ledger_tx (id)
);

create index if not exists withdrawals_user_idx   on public.withdrawals (user_id);
create index if not exists withdrawals_statut_idx on public.withdrawals (statut);

-- ---------------------------------------------------------------------------
--  Parties reglees
--
--  `match_id` en cle primaire : regler deux fois la meme partie est impossible,
--  et c'est la base qui le dit.
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id              text primary key,
  mise_micros     bigint not null check (mise_micros >= 0),
  pot_micros      bigint not null,
  rake_micros     bigint not null,
  classement      jsonb not null,
  regle_le        timestamptz not null default now(),
  tx_id           uuid references public.ledger_tx (id)
);
