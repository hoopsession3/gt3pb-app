-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0166 · DEAL MODELS — structured sales models on the catalog, with the margin floor
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Deals stop being free text. Each carries a MODEL the sales process can reason about:
--   rev_share — the account takes a % cut of sales (their 10% of on-site sales → we keep 90%)
--   discount  — the account buys at a % off list (20% off staff bottles → margin at the floor)
--   monthly   — the account pays a flat monthly (fridge stocking, standing service)
--   flat      — one-time flat amount
--   custom    — free-text terms (price_label carries them, as before)
-- The app derives "our take" per deal and warns when the give crosses the 80% margin floor —
-- the owner's rule ("keep our margin 80%") enforced where deals are written AND where reps pick.

alter table public.deals add column if not exists model text not null default 'custom';
alter table public.deals drop constraint if exists deals_model_check;
alter table public.deals add constraint deals_model_check
  check (model in ('rev_share','discount','monthly','flat','custom'));
alter table public.deals add column if not exists rate_pct numeric;      -- rev_share / discount %
alter table public.deals add column if not exists monthly_cents int;     -- monthly / flat amount

-- verify:
--   select count(*) from information_schema.columns
--     where table_name = 'deals' and column_name in ('model','rate_pct','monthly_cents');  -- 3
