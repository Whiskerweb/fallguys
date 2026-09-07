-- ============================================================================
--  USDG — le dollar du jeu ne s'appelle plus USDC (7 septembre 2026)
--
--  Le renommage a touche les fichiers de schema, mais `create table if not
--  exists` ne renomme pas une colonne existante : une base nee avant porte
--  encore `burns.usdc_micros`, et `/stats` tombait sur « column usdg_micros
--  does not exist ». Idempotent : rejouer ne change rien.
-- ============================================================================
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'burns' and column_name = 'usdc_micros') then
    alter table public.burns rename column usdc_micros to usdg_micros;
  end if;
end $$;
