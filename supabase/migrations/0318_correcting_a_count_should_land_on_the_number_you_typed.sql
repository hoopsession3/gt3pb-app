-- 0318 — CORRECTING A COUNT SHOULD LAND ON THE NUMBER YOU TYPED (2026-09-09)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The load-out screen lets you correct a carried-in count: you type what you actually have, and the
-- app writes a DELTA to the ledger, because inventory_ledger is append-only signed movements and
-- that is the right shape for it. The arithmetic was done in the browser:
--
--     const cur   = onHand.find(o => o.item === item)?.bal ?? 0;   -- from state loaded at mount
--     const delta = want - cur;
--     insert into inventory_ledger (item, kind, qty) values (item, 'adjust', delta);
--
-- The resulting balance is `actual + (want - cur)`. That equals `want` only while `cur` is still
-- true. It stops being true the moment anything else moves that item — another crew member logging
-- use, an event deducting stock, a restock — between the page loading and you typing. Nobody
-- reloads before correcting a count; the whole point is that you are standing at the trailer
-- looking at the shelf.
--
-- So the number you deliberately typed is the one number the ledger was NOT guaranteed to end on,
-- and it failed silently: the write succeeds, the screen shows what you typed, and the balance
-- underneath is off by however much you missed.
--
-- ── THE SECOND BUG, WHICH IS THE SAME BUG ──────────────────────────────────────────────────────
-- 0288 split the shelf by market, because "a Greenville item would pick up an Atlanta balance".
-- It fixed public.inventory_on_hand to group by (item, market). The load-out screen never used
-- that view — it re-implemented the sum client-side, fetching every ledger row and grouping by item
-- ALONE. So the aggregate 0288 exists to correct was still being computed the old way in the
-- browser, and the correction written back carried no market at all, landing on 'greenville' by
-- column default no matter which shelf you were looking at.
--
-- One canonical home for a balance. It already existed. This migration gives the WRITE side the
-- same treatment, and the app stops doing either sum itself.
--
-- ── WHY A FUNCTION AND NOT A TRIGGER ───────────────────────────────────────────────────────────
-- A trigger cannot help: by the time a row is being inserted the caller has already decided the
-- delta. The decision itself is what has to move server-side, which makes it an RPC.
--
-- ── WHY NOT SECURITY DEFINER ───────────────────────────────────────────────────────────────────
-- The house idiom for guards is `security definer set search_path = public`, and it is wrong here.
-- Definer would let this read and write shelves the caller cannot see. Left as invoker, the sum and
-- the insert both run under the caller's RLS, so you can only correct stock you are already allowed
-- to see — the function narrows what can go wrong rather than widening it.
--
-- ── AND THE LOCK ───────────────────────────────────────────────────────────────────────────────
-- Moving the arithmetic to the server removes the stale-read window but not the concurrent one: two
-- people correcting the same shelf in the same second would each read the balance before the
-- other's insert and both apply a delta computed from it. A transaction-scoped advisory lock keyed
-- on the shelf serialises just that pair — PostgREST wraps each call in a transaction, so the lock
-- is taken and released per request, and it never touches anything but this one item and market.
--
-- changelog: covered below.

create or replace function public.set_on_hand(
  p_item   text,
  p_want   numeric,
  p_market text default null,
  p_event  uuid default null,
  p_stop   uuid default null,
  p_note   text default null
) returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_market text;
  v_cur    numeric;
  v_delta  numeric;
begin
  if p_item is null or btrim(p_item) = '' then
    raise exception 'set_on_hand needs an item';
  end if;
  if p_want is null then
    raise exception 'set_on_hand needs the count you are correcting to';
  end if;

  -- lib/markets.ts's zero-regression contract, in SQL: an absent or blank market can only ever mean
  -- the founding one, never an error and never a second shelf created by a typo.
  v_market := coalesce(nullif(btrim(p_market), ''), 'greenville');

  -- One shelf at a time. hashtextextended gives a stable bigint for the (item, market) pair.
  perform pg_advisory_xact_lock(hashtextextended(p_item || '|' || v_market, 0));

  select coalesce(sum(qty), 0) into v_cur
    from public.inventory_ledger
   where item = p_item and market = v_market;

  v_delta := p_want - v_cur;
  if v_delta = 0 then
    return v_cur;                      -- already right; an empty movement is not a record
  end if;

  insert into public.inventory_ledger (item, market, kind, qty, event_id, stop_id, note, created_by)
  values (p_item, v_market, 'adjust', v_delta, p_event, p_stop, p_note, auth.uid());

  return p_want;                       -- what the shelf now holds, by construction
end $$;

comment on function public.set_on_hand(text, numeric, text, uuid, uuid, text) is
  'Corrects a shelf to an absolute count by writing the delta the server computes, under an advisory lock on (item, market). Replaces the browser-side `want - cur` in crew/page.tsx, whose `cur` came from state loaded at mount and was wrong the moment anything else moved that item. Invoker rights on purpose: the sum and the insert both run under the caller''s RLS.';

grant execute on function public.set_on_hand(text, numeric, text, uuid, uuid, text) to authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Correcting a stock count now lands on the number you typed','fix','Inventory',
   'When you correct a carried-in count on the load-out screen, the app records the difference rather than the total, so the shelf keeps its full history. It worked out that difference in your phone using the numbers from when the screen was opened — so if anyone had logged usage or a restock in between, the correction was off by exactly that much, quietly, and the shelf ended on a number nobody chose. The sum is now worked out on the server at the moment you save, against the shelf as it stands, and one shelf can only be corrected by one person at a time. The same screen was also adding up stock across cities instead of per city, which would have mixed Greenville and Atlanta the day the second one opens; it now reads the per-city figure the rest of the app already uses.',
   '2026-09-09', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0318_correcting_a_count_should_land_on_the_number_you_typed',
  'set_on_hand() computes the ledger delta server-side under an advisory lock on (item, market), replacing a browser-side want-minus-stale-cur that silently landed the shelf on the wrong number; the load-out screen also stops re-implementing 0288''s per-market on-hand sum.');

-- verify:
--   select public.set_on_hand('__probe__', 5);                     -- expect 5
--   select on_hand from public.inventory_on_hand where item = '__probe__';   -- expect 5
--   select public.set_on_hand('__probe__', 5);                     -- expect 5, and NO new row
--   select public.set_on_hand('__probe__', 0);                     -- expect 0
--   delete from public.inventory_ledger where item = '__probe__';  -- clean up
