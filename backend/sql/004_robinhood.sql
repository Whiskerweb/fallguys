-- ============================================================================
--  ROBINHOOD CHAIN — la migration d'une base nee sur l'ancienne chaine
--
--  Le 5 septembre 2026, le jeu quitte Solana pour Robinhood Chain (decision du
--  directeur produit). Les fichiers 001 et 003 decrivent deja la forme finale ;
--  ce fichier amene une base EXISTANTE a cette forme :
--
--    - les colonnes propres a l'ancienne chaine disparaissent (`blockhash`,
--      `slot`) et celles de la nouvelle apparaissent (`nonce`, `tx_brute`,
--      `bloc`, `dernier_robinet_le`, `chain_curseur`) ;
--    - les adresses derivees changent de forme (0x…) : `adresse_depot` est
--      re-derivee a la premiere requete de chaque joueur (`joueurDe`) ;
--    - les DONNEES de l'ancienne chaine — soldes adosses a des wallets qui
--      n'existent plus ici — ne sont PAS effacees par ce fichier, parce qu'une
--      migration jouee a chaque demarrage ne doit rien detruire. C'est
--      `outils/purger.mjs --oui` qui les efface, une fois, a la main, sur un
--      reseau d'essai. Sur mainnet, cette question ne se posera jamais : la
--      base y nait sur Robinhood Chain.
--
--  Tout est idempotent : rejouer ce fichier ne change rien.
-- ============================================================================

alter table public.chain_tx    drop column if exists blockhash;
alter table public.chain_tx    add column if not exists nonce    bigint;
alter table public.chain_tx    add column if not exists tx_brute text;

alter table public.withdrawals drop column if exists blockhash;

alter table public.deposits    drop column if exists slot;
alter table public.deposits    add column if not exists bloc bigint;

alter table public.profiles    add column if not exists dernier_robinet_le timestamptz;

create table if not exists public.chain_curseur (
  nom   text primary key,
  bloc  bigint not null,
  lu_le timestamptz not null default now()
);
