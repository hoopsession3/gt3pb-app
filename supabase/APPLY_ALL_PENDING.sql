-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
--
-- EACH MIGRATION IS ITS OWN TRANSACTION (R32 — the 10/10 audit, DB11-04 and OPS11-03). A paste runs as one transaction
-- unless it says otherwise, so a lock one migration took was held to the end of all of them, and one that stopped took
-- the others back with it. Each section below is wrapped in its own begin … commit: its locks end with it, and if one
-- stops (a busy table's lock wait ran out), the ones above it stay applied and nothing below it runs — paste the file
-- again a moment later; a migration already applied changes nothing the second time.
-- pending-from: 0443
-- generated-at: 2026-10-21
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0442_the_course_is_bought_and_the_pillars_are_given.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0443_gt3_nutrition_is_for_sale.sql
-- ============================================================
begin;   -- 0443, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0443 — GT3 NUTRITION IS FOR SALE ───────────────────────────────────────────────────────────────────────────────
-- 2026-10-21. R46 (Ryan, 2026-10-21: "One-time buy" — $47 as the founding price, $97 once the Rookie path is written;
-- "you do it now"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. The course is sold now (R45 locked nothing yet — 0442 waits for this): one purchase, one time, opens every lesson
-- and every map. Nothing in the database said what the course costs, or tied the access a purchase gives to the payment
-- that bought it — so a refund could not take the access back.
--
-- WHAT.
--   1. The product: one shop_products row, kind 'program_tier', program_tier 'pro' (0271's spine) — "GT3 Nutrition ·
--      Return to Primal", $47, published. Its price is the catalog's like every product's; app/api/nutrition/checkout
--      charges what this row says, never what a page sent.
--   2. program_access.order_id: the shop order that bought it (nullable — the crew's comps and coaches' grants have none).
--   3. A refund takes it back: when a shop order moves to refunded or canceled, the access that order granted is revoked
--      (revoked_at now). A grant from anywhere else is not touched.
--
-- set lock_timeout (database F16): one column added, one trigger function and its trigger made, one row written.
-- existing rows: one product row added (none like it exists). No access row changes.
-- changelog: none — GT3 Nutrition's own line arrives with 0442, when the course is bought.

set lock_timeout = '5s';

-- 1 · the product
insert into public.shop_products (kind, program_tier, title, public_title, blurb, price_cents, published_at, sort)
select 'program_tier', 'pro', 'GT3 Nutrition · Return to Primal', 'GT3 Nutrition',
       'The whole Return to Primal course — every lesson, its key points and its stack, and every map to keep. One time, yours for good.',
       4700, now(), 0
where not exists (
  select 1 from public.shop_products where kind = 'program_tier' and program_tier = 'pro' and archived_at is null
);

-- 2 · the order that bought it
alter table public.program_access add column if not exists order_id uuid references public.shop_orders(id) on delete set null;
create index if not exists program_access_order on public.program_access(order_id) where order_id is not null;

-- 3 · a refund takes it back
create or replace function public.program_access_follows_its_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('refunded', 'canceled') and old.status is distinct from new.status then
    update public.program_access
       set revoked_at = now()
     where order_id = new.id and revoked_at is null;
  end if;
  return new;
end $$;
revoke all on function public.program_access_follows_its_order() from public, anon, authenticated;

drop trigger if exists program_access_follows_its_order_tg on public.shop_orders;
create trigger program_access_follows_its_order_tg
  after update of status on public.shop_orders
  for each row execute function public.program_access_follows_its_order();

-- verify (numbers and booleans only):
--   select count(*) from public.shop_products where kind = 'program_tier' and program_tier = 'pro' and archived_at is null;   -- 1
--   select price_cents from public.shop_products where kind = 'program_tier' and program_tier = 'pro' and archived_at is null; -- 4700
--   select count(*) from pg_trigger where tgname = 'program_access_follows_its_order_tg';                                       -- 1
select public.record_migration('0443_gt3_nutrition_is_for_sale');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0443
