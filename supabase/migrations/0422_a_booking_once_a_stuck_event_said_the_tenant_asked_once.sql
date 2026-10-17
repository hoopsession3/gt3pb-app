-- 0422 — A BOOKING IS MADE ONCE, AN EVENT SQUARE SENT AND WE DIDN'T FINISH IS SAID, AND THE TENANT IS ASKED ONCE A QUERY
-- (R15, 2026-10-17 — the 10/10 audit: API F25, operations F15, database F3 and F16)
--
--   · business_orders.idempotency_key — an office one-off booking carries its own key (components/OfficeOrder, made
--     when the form opens): an answer lost on the way back, tapped again, finds the first booking instead of making a
--     second — two alerts for the crew, two pay links or invoices for the office. Unique per person and key.
--   · watch_webhook_inbox() — every ten minutes: a Square event that arrived more than thirty minutes ago and is still
--     not processed raises one alert (kind webhook_stuck — critical, money, one open at a time), saying how many wait,
--     since when, and the last error the route kept with one (R14). Nothing read webhook_events.processed_at: a refund,
--     a dispute or a subscription change Square had sent could sit unrecorded for good, and the inbox said nothing.
--   · "tenant isolation" — the restrictive policy on every tenant table called effective_tenant() for each row it looked
--     at (a definer function is never inlined: two calls and a profiles read per candidate row, the Pass board and the
--     alerts paying it per row). Wrapped in a sub-select, Postgres asks once per query (Supabase's auth_rls_initplan).
--     The same rule and the same answer: each policy is changed in place only where it is exactly the 0134 shape.
--
-- set lock_timeout (database F16): each of these takes a brief lock on its table; if a long query is holding one, this
-- stops after five seconds instead of queueing every order and every read behind it. Run it again a moment later.
-- existing rows: business_orders — idempotency_key null on every row (a booking before this had no key; the unique
--   index holds keys only). webhook_events — untouched: the first watch reads what is already there, so an event stuck
--   from before is said on the first run. Policies — the same rule; only the shape it is written in changes.
-- existing rows: watch_webhook_inbox — new here: no alert of its kind (webhook_stuck) has been written to restate.
-- changelog: below.

set lock_timeout = '5s';

-- ── an office booking, once ────────────────────────────────────────────────────────────────────────────────────────
alter table public.business_orders add column if not exists idempotency_key text
  check (idempotency_key is null or char_length(idempotency_key) between 8 and 80);
create unique index if not exists business_orders_user_key_uidx on public.business_orders (user_id, idempotency_key)
  where idempotency_key is not null;
comment on column public.business_orders.idempotency_key is
  'The booking''s own key (0422), made by the office form when it opens: the same person and key is the same booking — a second insert is refused (23505) and app/api/office answers with the first.';

-- ── an event Square sent and we didn't finish, said ────────────────────────────────────────────────────────────────
create or replace function public.watch_webhook_inbox() returns integer
  language plpgsql security definer set search_path = public as $$
declare stuck integer; oldest timestamptz; last_err text;
begin
  select count(*), min(received_at), (array_agg(left(coalesce(error, ''), 160) order by received_at desc))[1]
    into stuck, oldest, last_err
    from public.webhook_events
   where provider = 'square' and processed_at is null
     and received_at < now() - interval '30 minutes' and received_at > now() - interval '7 days';
  if coalesce(stuck, 0) = 0 then return 0; end if;
  -- One open alert for the inbox (the subject is its name made a uuid), its words kept current while it lasts.
  perform public.alert_open_once('webhook_stuck', md5('webhook-inbox:square')::uuid, 'critical', 'money',
    'Square events aren''t being recorded — ' || stuck || ' waiting',
    stuck || case when stuck = 1 then ' event' else ' events' end
      || ' Square sent (a refund, a dispute, a subscription change) '
      || case when stuck = 1 then 'has' else 'have' end || ' waited since '
      || to_char(oldest at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET without being recorded. '
      || 'The last said: ' || coalesce(nullif(btrim(last_err), ''), '(nothing — it never finished)')
      || '. Square sends an unanswered event again for a while; if this stays open, make the change it describes by hand.',
    '/crew?s=money&a=pay');
  return stuck;
end $$;
revoke all on function public.watch_webhook_inbox() from public, anon, authenticated;
grant execute on function public.watch_webhook_inbox() to service_role;
comment on function public.watch_webhook_inbox() is
  'Every ten minutes (0422): Square events received more than 30 minutes ago (and less than a week) and still not processed raise one critical money alert (kind webhook_stuck, one open at a time).';
create index if not exists webhook_events_unprocessed_idx on public.webhook_events (received_at) where processed_at is null;

do $$ begin perform cron.unschedule('webhook-watch'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('webhook-watch', '*/10 * * * *', 'select public.watch_webhook_inbox()');
exception when others then
  raise notice '0422: pg_cron is not here — run select public.watch_webhook_inbox() by hand.';
end $$;

-- ── the tenant, asked once a query ─────────────────────────────────────────────────────────────────────────────────
do $$
declare r record; n integer := 0;
begin
  for r in
    select c.relname as tbl
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and p.polname = 'tenant isolation' and not p.polpermissive and p.polcmd = '*'
       and regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', ' ', 'g') ~ '^\(tenant_id = (public\.)?effective_tenant\(\)\)$'
       and regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '\s+', ' ', 'g') ~ '^\(tenant_id = (public\.)?effective_tenant\(\)\)$'
  loop
    execute format('alter policy "tenant isolation" on public.%I using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()))', r.tbl);
    n := n + 1;
  end loop;
  raise notice '0422: % "tenant isolation" policies ask the tenant once a query', n;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An office order is booked once, however many times it is tapped', 'fix', 'Ordering',
   'If the answer to an office booking is lost on the way back and the button is tapped again, the second tap finds the first booking instead of making another — no second delivery, no second invoice.',
   '2026-10-17', false),
  ('A Square event that never finished is said', 'fix', 'Money',
   'Refunds, disputes and subscription changes Square sends that the app couldn''t record within half an hour raise a critical alert, with what went wrong, instead of waiting unseen.',
   '2026-10-17', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from information_schema.columns where table_name = 'business_orders' and column_name = 'idempotency_key'; -- 1
--   select count(*) from pg_indexes where indexname = 'business_orders_user_key_uidx';                                        -- 1
--   select count(*) from cron.job where jobname = 'webhook-watch';                                                            -- 1
--   select count(*) from pg_policy where polname = 'tenant isolation' and pg_get_expr(polqual, polrelid) like '%SELECT%';     -- every one
--   select count(*) from pg_policy where polname = 'tenant isolation' and pg_get_expr(polqual, polrelid) not like '%SELECT%'; -- 0
select public.record_migration('0422_a_booking_once_a_stuck_event_said_the_tenant_asked_once');
