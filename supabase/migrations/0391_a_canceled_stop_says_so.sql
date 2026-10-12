-- ── 0391 — A CANCELED STOP SAYS SO, AND ITS PRE-ORDERS ARE TOLD ────────────────────────────────────────────────────
-- 2026-10-12. H5 of the customer frontend audit, release C1 (the owner approved the release, "yes to all
-- improvements"; texting customers is approved, decision 7).
--
-- WHY. A stop called off just disappeared. The crew archived it, Find Us dropped the row on its next 20-second read,
-- and nobody who had ordered for it was told — a cup pre-order was not even linked to its stop (the checkout never
-- wrote orders.stop_id), and a pack is reserved for a day, not a stop.
--
-- WHAT.
--   · stops.canceled_at, stops.cancel_reason (what the customers are told, 140 characters at most).
--   · cancel_stop(stop, reason): an owner's or admin's (the stops' writers, 0003). It archives the stop — so every
--     reader that drops an archived stop drops this one, the road and ordering included, and 0386 turns the live
--     switch off if it named it — and marks it canceled with the reason. It answers what there is to tell: the cup
--     orders placed for it and not yet picked up, and the packs reserved for its day when no other stop is left that
--     day. A second call changes nothing.
--   · The cup checkout now writes the stop an order is for (orders.stop_id, 0219's column), so the next canceled stop
--     knows its pre-orders.
-- The telling is the server's (app/api/crew/stops/cancel): a text or email to each, and one line to the crew naming the
-- paid pre-orders to refund. Find Us reads canceled stops (stops are public, 0001) and says so in place of the stop.
-- Restoring a canceled stop (the crew's Restore) clears all three.
--
-- ORDER. Paste it before the deploy that reads it. Pasted after, nothing breaks: until it is here the cancel button
-- answers "Canceling isn't switched on yet", and Find Us reads no canceled stops.
-- existing rows: none written.
-- changelog: below.

alter table public.stops add column if not exists canceled_at timestamptz;
alter table public.stops add column if not exists cancel_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stops_cancel_reason_len') then
    alter table public.stops add constraint stops_cancel_reason_len check (cancel_reason is null or char_length(cancel_reason) <= 140);
  end if;
end $$;
comment on column public.stops.canceled_at is 'When the stop was called off (0391, cancel_stop). A canceled stop is archived too.';
comment on column public.stops.cancel_reason is 'What the customers are told about a canceled stop (0391): on Find Us, and in the text.';

create or replace function public.cancel_stop(p_stop uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s public.stops%rowtype; v_day date; v_cups int; v_packs int; v_other int; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then raise exception 'owners and admins only' using errcode = '42501'; end if;
  if v_reason is not null and char_length(v_reason) > 140 then raise exception 'keep the reason to 140 characters' using errcode = '22001'; end if;
  select * into s from public.stops where id = p_stop for update;
  if s.id is null then return null; end if;
  if s.canceled_at is null then
    update public.stops
       set canceled_at = now(), cancel_reason = v_reason, archived_at = coalesce(archived_at, now()),
           status = case when status = 'live' then 'upcoming' else status end
     where id = p_stop;
  end if;
  v_day := (s.starts_at at time zone 'America/New_York')::date;
  select count(*) into v_cups from public.orders o where o.stop_id = p_stop and o.status in ('new', 'preparing', 'ready');
  select count(*) into v_other from public.stops x
   where x.id <> p_stop and x.archived_at is null and x.canceled_at is null and x.starts_at is not null
     and (x.starts_at at time zone 'America/New_York')::date = v_day;
  if v_day is null or v_other > 0 then v_packs := 0;
  else
    select count(*) into v_packs from public.drop_orders d where d.drop_date = v_day and d.canceled_at is null and not d.picked_up;
  end if;
  return jsonb_build_object('day', v_day, 'cups', v_cups, 'packs', v_packs, 'other_stop_that_day', v_other > 0, 'already', s.canceled_at is not null);
end $$;
revoke all on function public.cancel_stop(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_stop(uuid, text) to authenticated;
comment on function public.cancel_stop(uuid, text) is
  'An owner or admin calls a stop off (0391): archived and marked canceled with the reason customers are told; answers how many pre-orders there are to tell. A second call changes nothing.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A canceled stop says so','fix','Find Us',
   'A stop called off used to vanish from Find Us, and nobody who had ordered for it heard. Now the crew cancels a visit with a reason: Find Us shows it canceled, with the reason, until it would have started; everyone with a cup ordered for it gets a text or an email, and so does everyone with a pack for that day when no other stop is left; and the crew gets the list of paid pre-orders to refund. A stop now ends at its end time on Find Us too, not 8 hours after it began.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from information_schema.columns where table_name = 'stops' and column_name in ('canceled_at', 'cancel_reason');   -- 2
--   select has_function_privilege('anon', 'public.cancel_stop(uuid, text)', 'execute');                                             -- f
select public.record_migration('0391_a_canceled_stop_says_so');
