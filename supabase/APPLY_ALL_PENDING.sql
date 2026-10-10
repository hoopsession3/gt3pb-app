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
-- pending-from: 0361
-- generated-at: 2026-10-09
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0361_business_opens_on_money.sql
-- ============================================================
-- ── BUSINESS OPENS ON MONEY ─────────────────────────────────────────────────────────────────────
-- 2026-10-09, round 2 of the UX plan (Ryan: "Business opens on Money", approved). Reverses 0259's call
-- (2026-07-31: "when we click on business, should it not focus on what we're doing to make the money?",
-- answered then with the company calendar first). Tapping Business lands on Money — the week's sales and
-- margin against the week before, each with what moved it — and the calendar is one tap along the row.
--
-- Money moves to the front of the Business lane; nothing else in it moves, and no other lane is touched.
-- Idempotent by guard (a lane already led by Money is left alone; re-running changes nothing), scoped by
-- key, and a lane a tenant reshaped without Money is left as its tenant made it. DEFAULT_STREAMS
-- (lib/streams.ts) lists the same order, for the moment before the table answers.

update public.work_streams
   set sections = array['money']::text[] || array_remove(sections, 'money')
 where key = 'business' and 'money' = any(sections) and sections[1] is distinct from 'money';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Business opens on Money','improvement','Crew',
   'Tapping Business lands on Money: the week''s sales and margin against the week before, each with what moved it, and the next drop''s orders. The calendar, notes, catalog, customers and team are one tap along the row. Sales and the shop''s queue of orders stay open; Money''s other panels stay folded until you open one.',
   '2026-10-09', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select key, sections from public.work_streams where key = 'business';   -- 'money' first, the rest as they were
select public.record_migration('0361_business_opens_on_money');
