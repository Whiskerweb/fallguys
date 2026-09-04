-- ============================================================================
--  LA CHAINE — le journal de tout ce qui part sur Solana, et le brulage
--
--  Depuis le 2 septembre 2026, l'argent d'une partie BOUGE SUR LA CHAINE, pas
--  seulement dans le grand livre : chaque joueur detient ses USDC sur un wallet
--  a lui (derive, garde par le service), la mise part de ce wallet vers le
--  wallet du POT de la partie, et le reglement vide le pot vers les gagnants et
--  vers le wallet des FRAIS. Le grand livre reste la comptabilite ; la chaine en
--  est la preuve, ligne a ligne, et `verifierChaine()` compare les deux.
--
--  Ce journal existe pour la meme raison que `withdrawals.signature` : savoir,
--  apres un arret au mauvais moment, quelle transaction est PEUT-ETRE partie.
--  Une ligne est ecrite en `prevu` DANS la transaction du grand livre qui
--  l'exige, passe en `signe` AVANT la diffusion, puis en `confirme`. Re-signer
--  sans relire la chaine, c'est payer deux fois — ce journal est ce qu'on relit.
-- ============================================================================

create table if not exists public.chain_tx (
  id            uuid primary key,

  -- 'mise' | 'gain' | 'rake' | 'annulation' | 'cloture_pot' | 'retrait'
  -- | 'rachat' | 'dotation' | 'balayage'
  objet         text not null,

  -- Cle d'idempotence PAR OBJET : `partie:userId` pour une mise, `partie` pour le
  -- rake, l'identifiant du retrait pour un retrait. Rejouer un objet deja
  -- journalise retrouve la ligne au lieu d'en ouvrir une seconde.
  ref           text not null,

  -- Les PROPRIETAIRES des comptes (pas les comptes de jetons) : lisibles tels
  -- quels sur un explorateur.
  de            text,
  vers          text,
  mint          text,
  montant       bigint not null default 0,

  statut        text not null default 'prevu'
                check (statut in ('prevu', 'signe', 'confirme', 'echoue', 'inutile')),
  signature     text,
  blockhash     text,

  partie        text,
  user_id       uuid,
  metadata      jsonb not null default '{}',
  raison_echec  text,

  cree_le       timestamptz not null default now(),
  soumis_le     timestamptz,
  clos_le       timestamptz,

  constraint chain_tx_objet_ref unique (objet, ref)
);

-- Plusieurs lignes peuvent partager une signature : un reglement groupe jusqu'a
-- six virements dans une seule transaction. Index, donc, et non unicite.
create index if not exists chain_tx_signature_idx on public.chain_tx (signature);
create index if not exists chain_tx_statut_idx    on public.chain_tx (statut);
create index if not exists chain_tx_partie_idx    on public.chain_tx (partie);
create index if not exists chain_tx_cree_idx      on public.chain_tx (cree_le desc);

-- ---------------------------------------------------------------------------
--  Les parties, depuis qu'elles ont un cycle de vie
--
--  `matches` n'etait ecrite qu'au reglement. Une partie est desormais ENGAGEE
--  (mises parties vers le pot), puis REGLEE ou ANNULEE (une mise n'a pas pu
--  partir : tout le monde est rembourse, personne ne joue pour rien).
-- ---------------------------------------------------------------------------
alter table public.matches add column if not exists mode        text;
alter table public.matches add column if not exists effectif    integer;
alter table public.matches add column if not exists graine_roue bigint;
alter table public.matches add column if not exists issue       text;
alter table public.matches add column if not exists statut      text not null default 'reglee';
alter table public.matches add column if not exists engagee_le  timestamptz;
alter table public.matches add column if not exists adresse_pot text;
-- Pose quand TOUS les virements du reglement sont confirmes sur la chaine : tant qu'elle
-- est vide, le tour de fond rejoue `payerSurChaine`, qui est idempotent.
alter table public.matches add column if not exists paye_sur_chaine_le timestamptz;

-- Le classement n'est connu qu'au reglement : une partie engagee n'en a pas.
alter table public.matches alter column classement set default '[]'::jsonb;
alter table public.matches alter column pot_micros set default 0;
alter table public.matches alter column rake_micros set default 0;

-- ---------------------------------------------------------------------------
--  Le brulage — le rachat des BG avec les frais, et leur destruction
--
--  Une ligne par rachat : combien d'USDC ont ete depenses, combien de BG ont
--  ete achetes et brules, et ce qu'il restait de l'offre APRES. La signature
--  est celle de la transaction unique qui fait les trois gestes (achat, retour,
--  brulage) : elle est atomique, il n'existe pas d'etat ou les BG sont achetes
--  et pas brules.
-- ---------------------------------------------------------------------------
create table if not exists public.burns (
  id             uuid primary key,
  signature      text unique,
  usdc_micros    bigint not null check (usdc_micros > 0),
  bg_micros      bigint not null check (bg_micros > 0),
  supply_apres   bigint,
  reseau         text,
  cree_le        timestamptz not null default now(),
  tx_id          uuid references public.ledger_tx (id)
);

alter table public.chain_tx enable row level security;
alter table public.burns    enable row level security;

-- Les rachats sont publics : c'est la promesse du jeton, et la page de suivi
-- les montre a tout le monde. Aucun solde de joueur n'y figure.
drop policy if exists burns_lecture_publique on public.burns;
create policy burns_lecture_publique on public.burns
  for select to anon, authenticated using (true);

-- Le journal de chaine porte des identifiants de joueurs : un joueur ne voit que
-- ses propres lignes. Le reste passe par le backend, qui anonymise.
drop policy if exists chain_tx_lecture_de_soi on public.chain_tx;
create policy chain_tx_lecture_de_soi on public.chain_tx
  for select to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.chain_tx, public.burns to anon, authenticated;
