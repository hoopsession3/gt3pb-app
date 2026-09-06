-- 0279 — CARRY MARKET THROUGH TO THE ROAD. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- THE BUG THIS CLOSES: 0275 added `market` to `stops`, `events` and `field_ops` — but field_ops is
-- not written by hand. It is a MIRROR, maintained by after-triggers on stops and events (0222), and
-- those trigger functions copy an EXPLICIT list of ~40 columns. `market` was in neither list. So a
-- stop tagged 'atlanta' mirrored into field_ops as 'greenville' (the column default), because the
-- mirror simply never mentioned the column.
--
-- That is worse than the column not existing: every customer-facing screen reads field_ops, so
-- filtering Find Us by market would have looked correct, passed review, and shown Atlanta's stops to
-- Greenville anyway — silently, with no error to notice.
--
-- HOW THIS FIXES IT, AND WHY NOT THE OBVIOUS WAY. The obvious fix is to rewrite the two mirror
-- functions with `market` added to their column lists. Do not: `mirror_stop_to_field_ops` and
-- `mirror_event_to_field_ops` have been redefined since 0222 — by 0240 (contact columns removed) and
-- 0270 (the event publish gate) — so a create-or-replace built from 0222's text SILENTLY REVERTS
-- both of those migrations. Splicing the column into the live definition programmatically is worse
-- still: it assumes a shape, and the first attempt at exactly that produced a syntax error because
-- `archived_at, tenant_id` is not the tail of the event mirror's list the way it is in the stop's.
--
-- So the mirrors are left completely alone. One tiny trigger per source table copies `market` onto
-- the mirror row AFTER the mirror has written it. It cannot revert anything, it cannot go stale when
-- someone adds column 41, and there is nothing in it to get subtly wrong.
--
-- Trigger firing order is alphabetical by NAME within the same timing, which is exactly why these
-- are named zz_* — they must land after mirror_stop_to_field_ops_tg / mirror_event_to_field_ops_tg
-- have created or updated the row this then corrects.
--
-- ZERO REGRESSION: with one market every row is 'greenville' on both sides, so this changes no value
-- that exists today. Safe to run repeatedly.
--
-- Apply after 0278.

-- ── the sync ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_market_to_field_ops() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- tg_argv[0] is the field_ops.kind this table mirrors into ('stop' or 'event'), so one function
  -- serves both tables rather than two near-identical copies drifting apart.
  update public.field_ops
     set market = new.market
   where id = new.id
     and kind = tg_argv[0]
     and market is distinct from new.market;
  return null;             -- AFTER trigger: the return value is ignored
end $$;

drop trigger if exists zz_sync_market_to_field_ops on public.stops;
create trigger zz_sync_market_to_field_ops after insert or update on public.stops
  for each row execute function public.sync_market_to_field_ops('stop');

do $$
begin
  if to_regclass('public.events') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'events' and column_name = 'market') then
    execute 'drop trigger if exists zz_sync_market_to_field_ops on public.events';
    execute 'create trigger zz_sync_market_to_field_ops after insert or update on public.events
               for each row execute function public.sync_market_to_field_ops(''event'')';
  end if;
end $$;

-- ── resync anything already out of step ──────────────────────────────────────────────────────────
-- With one market this matches nothing. It exists so the fix is complete rather than only forward-
-- looking: any row written between 0275 and now carries the default rather than its real market.
update public.field_ops fo
   set market = s.market
  from public.stops s
 where fo.id = s.id and fo.kind = 'stop' and fo.market is distinct from s.market;

do $$
begin
  if to_regclass('public.events') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'events' and column_name = 'market') then
    update public.field_ops fo
       set market = e.market
      from public.events e
     where fo.id = e.id and fo.kind = 'event' and fo.market is distinct from e.market;
  end if;
end $$;

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The road knows which city it belongs to','improvement','Ops',
   'Stops and events can now be tagged with the city they belong to, and that tag follows them all the way to the customer screens — so Find Us shows the city you are actually in, and whether ordering is open is decided by your city''s next stop rather than by whichever stop happens to be next anywhere. Nothing changes while only one city is running: with a single market every screen behaves exactly as it did, and the city switcher only appears once a second city genuinely has something on the road.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- both triggers exist, and both fire after their mirror (alphabetical: mirror_* then zz_*):
--   select tgrelid::regclass as on_table, tgname from pg_trigger
--    where not tgisinternal and tgname in ('zz_sync_market_to_field_ops')
--    order by 1;                                                            -- expect: events, stops
--
--   -- the mirrors were NOT touched (0240 + 0270 still intact):
--   select proname, length(pg_get_functiondef(p.oid)) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and proname like 'mirror_%_to_field_ops' order by 1;
--
--   -- no mirror row disagrees with its source:
--   select count(*) from public.field_ops fo join public.stops s on s.id = fo.id
--    where fo.kind='stop' and fo.market is distinct from s.market;          -- expect: 0
--
--   -- and the round trip works (safe — sets a stop to the market it already has):
--   update public.stops set market = market where id = (select id from public.stops limit 1);
--   select market, count(*) from public.field_ops group by 1 order by 1;
