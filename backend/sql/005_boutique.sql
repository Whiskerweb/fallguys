-- ============================================================================
--  LA BOUTIQUE — les skins achetes, et a qui
--
--  Une ligne par (joueur, article) : acheter deux fois le meme skin est
--  impossible, et c'est la base qui le dit. Le prix paye est note tel quel :
--  le catalogue peut changer, la ligne raconte ce qui a ete paye ce jour-la.
--  L'argent, lui, est au grand livre (genre `achat`) et sur la chaine
--  (`chain_tx`, objet `achat`) : du wallet du joueur vers le wallet des FRAIS,
--  ou le brulage le trouve. Tous les revenus de la boutique brulent du BG.
--
--  Statuts : paye (au livre) -> confirme (sur la chaine) | soumis (chaine
--  incertaine, la reprise tranchera) | echoue (chaine refusee, rembourse).
-- ============================================================================
create table if not exists public.purchases (
  id            uuid primary key,
  user_id       uuid not null references public.profiles (id),
  article       text not null,
  prix_micros   bigint not null check (prix_micros > 0),
  statut        text not null default 'paye'
                check (statut in ('paye', 'soumis', 'confirme', 'echoue')),
  -- La cle du journal (`joueur:article:tentative`) : une tentative, une cle, sinon un
  -- achat retente apres un refus retrouverait le mouvement deja pose sans debiter.
  ref           text,
  signature     text,
  raison_echec  text,
  cree_le       timestamptz not null default now(),
  tx_id         uuid references public.ledger_tx (id),
  constraint purchases_un_par_joueur unique (user_id, article)
);

create index if not exists purchases_user_idx on public.purchases (user_id);

alter table public.purchases enable row level security;

-- Un joueur lit ses propres achats ; le reste passe par le backend.
drop policy if exists purchases_lecture_de_soi on public.purchases;
create policy purchases_lecture_de_soi on public.purchases
  for select to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.purchases to anon, authenticated;
