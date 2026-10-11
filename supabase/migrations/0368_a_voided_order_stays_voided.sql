-- ── 0368 — A VOIDED ORDER STAYS VOIDED ──────────────────────────────────────────────────────────────────
-- 2026-10-11 (the audit of the kitchen display, "the Pass").
--
-- Every move a ticket makes on the pass is one call, staff_set_order_status (0023): the ticket's buttons
-- (app/crew/page.tsx, move and voidOrder) and the offline queue's replay (components/offlineReplay.ts, flushQueue) all make
-- it, by name, with {p_order, p_status}. It set the status it was given, whatever the order's was:
--
--   · it never read the order, so nothing about where the order stood could refuse a tap — a voided order could be
--     moved again (void → done, void → new) and came back on the pass, and done → new went through as well;
--   · nothing held the order while it was being moved, so two phones' taps on one ticket landed in whatever order
--     they arrived;
--   · it runs as its owner (SECURITY DEFINER, which row-level security does not stop) and found the order by its id
--     alone, so the crew of one business could move another business's order by its id.
--
-- The offline queue is why it matters now: a phone with no signal keeps its taps and replays them when the signal
-- comes back, for up to six hours (lib/offline, pruneStale), the last tap per order winning. A tap made before
-- someone else voided the order, or handed it over, lands after.
--
-- WHAT IT DOES NOW. It returns the order's status after the call.
--   · Crew only, and a status it knows: as before, in the same words ('not authorized', 'invalid status').
--   · The order is read the way staff_collect_payment reads it (0341): only in the caller's tenant, and locked until
--     the call is done, so two phones tapping one ticket go one after the other. An order that is not there, or not
--     theirs, is 'order not found'.
--   · A move to where the order already is does nothing and answers where it is. A double tap, or the replay of a
--     move that already happened, is harmless — and writes nothing (before, it rewrote the row).
--   · Void is final: nothing leaves it. Anything can be voided, a handed-over order too.
--   · Among new, preparing, ready and done every move is allowed. Forward any distance, because the queue coalesces
--     taps and new → done arrives as one write; and back, because the pass has ↩ (a stage back) and Recall
--     (done → ready).
--   · p_from, new and optional, is the status the screen showed when the tap was made. When it is given and the order
--     is neither there nor where the tap sends it, someone moved the order first, and the tap is refused.
--
-- A refused move is one error: 'order_moved', SQLSTATE P0001 (HTTP 400 through PostgREST, a refusal and not a server
-- error — 0360), with the order's status now in its detail, so a screen can say where the order went. Leaving void
-- says 'void'.
--
-- THE CALLERS. Two named arguments still reach this function, with p_from left null — a page loaded before this
-- release keeps working. The two-argument function is dropped first: beside this one, a call naming p_order and
-- p_status would fit both, and Postgres (and PostgREST before it) refuses a call that fits two functions. The pass
-- sends p_from from this release on (lib/orderStatus — the ticket's buttons and the offline replay, which keeps the
-- status the FIRST of a ticket's queued taps was made from); before this is pasted it answers PGRST202 to that, and
-- the pass falls back to the two arguments for the rest of the session.
--
-- Untouched: the triggers that stamp status_changed_at and derive the status columns (0018, 0155, 0232). They see
-- the same UPDATE of status as before, and nothing at all when the call changes nothing. EXECUTE is the signed-in
-- caller's: PUBLIC's is revoked and so is anon's, by name (Supabase grants a new function to anon as well — 0367).

drop function if exists public.staff_set_order_status(uuid, text);

create or replace function public.staff_set_order_status(p_order uuid, p_status text, p_from text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_now text;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_status is null or p_status not in ('new', 'preparing', 'ready', 'done', 'void') then
    raise exception 'invalid status';
  end if;

  -- 0341's read (staff_collect_payment): the caller's tenant only, and the row held until this call is done.
  select status into v_now
    from public.orders where id = p_order and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'order not found'; end if;

  -- Already there: a double tap, or a replay of a move that already happened.
  if v_now = p_status then return v_now; end if;

  -- Void is final.
  if v_now = 'void' then
    raise exception 'order_moved' using errcode = 'P0001', detail = 'void';
  end if;

  -- The screen was behind: someone moved the order after it was drawn.
  if p_from is not null and v_now <> p_from then
    raise exception 'order_moved' using errcode = 'P0001', detail = v_now;
  end if;

  update public.orders set status = p_status where id = p_order;
  return p_status;
end $$;
revoke all on function public.staff_set_order_status(uuid, text, text) from public, anon;
grant execute on function public.staff_set_order_status(uuid, text, text) to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A voided order stays voided','fix','Crew',
   'A ticket could come back after it was voided. A phone that loses signal on the pass keeps its taps and sends them when the signal returns — up to six hours later — and the database moved an order from any step to any other, so a tap made before the void undid it. Void is final now: nothing moves an order out of it. Tapping a ticket to the step it is already on changes nothing, two phones tapping the same ticket take turns, and moving a ticket forward, back a step, or recalling it work as they did.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select pg_get_function_identity_arguments(oid), prorettype::regtype from pg_proc where proname = 'staff_set_order_status';
--     -- one row: p_order uuid, p_status text, p_from text | text
--   select has_function_privilege('anon', 'public.staff_set_order_status(uuid, text, text)', 'execute');            -- f
--   select has_function_privilege('authenticated', 'public.staff_set_order_status(uuid, text, text)', 'execute');   -- t
select public.record_migration('0368_a_voided_order_stays_voided');
