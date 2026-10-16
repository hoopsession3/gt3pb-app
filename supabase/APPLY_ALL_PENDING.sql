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
-- pending-from: 0421
-- generated-at: 2026-10-16
-- pending-count: 3
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0419_a_push_is_sent_once_for_what_happened_and_a_limit_counts_what_it_lets_in.sql
-- ============================================================
-- ── 0419 — A PUSH IS SENT ONCE, FOR WHAT HAPPENED; A LIMIT COUNTS WHAT IT LETS IN; A JOB THAT FAILS IS SAID ──────────
-- 2026-10-16. R10 of the customer audit — the 10/10 audit of the back end (Ryan, 2026-10-16: "then audit for 10/10 best
-- practices... front and back end"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · The push function is reached with the public key every page carries (0157: the webhook's bearer is the
--     publishable key, which only gets past the platform's gate), and it acted on whatever row the request described: a
--     "critical" with any title emailed every admin from the business's own address with a link of the sender's choosing,
--     a "GT3 is LIVE" went to every subscriber, a "New order" rang every crew phone. The function now reads each row it is
--     told about from the database with the service role and sends from that — an event the database cannot show is not
--     sent, nor one whose own stamp says it is old news — and records each event it sends here (push_sent), so the same
--     event told twice is sent once. "The truck went live" had no stamp of its own: a request describing the flip while the
--     truck was live would have rung every subscriber again each half hour.
--   · rate_limit_hit (0154) counted the tries it refused, so one caller past its own limit used up the count every
--     caller shares (checkout's sixty a minute, the card doors' hundred and twenty) and a script from one address shut
--     card checkout for everyone. Its tidy-up deleted any window that started more than an hour ago — and a day's window
--     starts at midnight, so a per-day count (texts to a number, a booking's email) went back to zero at one in the
--     morning, and again every twenty calls after. And the one-off keys (an address, a card) were never swept at all.
--   · keep_app_push_token (0367) took a new phone signed out, without a count; 0418 counted only the web's door.
--   · push_subscriptions had no index the sends use: every crew ring and every member's notice read the whole table.
--   · Twenty-six scheduled jobs run inside the database and nothing read how they ran: a job failing every run (the
--     escalation of a critical, the release of a hold) said nothing anywhere, and cron's run log was never pruned.
--
-- WHAT.
--   · push_sent — one row per event sent (its key: what happened and to which row), the service role's alone; a row
--     older than ninety days is swept nightly.
--   · live_status.live_since — when the truck last went live, stamped by the database alone (a trigger on every write:
--     set on the flip to live, kept while live, cleared on going offline), so the push function can tell a flip that just
--     happened from one described again.
--   · rate_limit_hit — a try over the cap is refused and not counted; the windows swept are the ones that have ended
--     (any window of the bucket before the current one); a nightly sweep takes every bucket's windows older than two
--     days (the longest window is a day).
--   · keep_app_push_token — a new phone nobody is signed in on is counted with the web's (push:new-guest, 300 an hour
--     for everyone together, 0418). A member's is not: theirs replaces their other phones.
--   · three partial indexes on push_subscriptions: by member, the crew's by business, and the go-live list by business.
--   · cron_watch() — every ten minutes: a job with failed runs in the last twenty minutes raises one alert for that job
--     (kind cron_failed; alert_open_once, so a job failing every run is one open alert, its words kept current); cron's
--     run log keeps a week.
-- existing rows: cron_watch — new here; it has written nothing yet. live_since — left empty on every row: a truck live
--   when this is pasted went live before anything stamped it, and is not news (its next go-live is stamped).
-- changelog: below.

-- ── what the push function has sent ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.push_sent (
  event_key text primary key check (char_length(event_key) between 3 and 200),
  sent_at   timestamptz not null default now()
);
alter table public.push_sent enable row level security;   -- no policy: the push function's (service role) alone
revoke all on public.push_sent from public, anon, authenticated;
grant select, insert, delete on public.push_sent to service_role;
create index if not exists push_sent_at_idx on public.push_sent (sent_at);
comment on table public.push_sent is
  'One row per event the push function sent (0419): its key names what happened and to which row (orders:new:<id>, alert:<id>, …). The function reads each row it is told about from the database and sends once per key, so an event described twice — or by someone holding the public key — is sent at most once, and only if the database shows it.';

-- ── the truck going live, stamped by the database ───────────────────────────────────────────────────────────────────
alter table public.live_status add column if not exists live_since timestamptz;
create or replace function public.stamp_live_since() returns trigger language plpgsql set search_path = public as $$
begin
  -- Written here alone, on every write: a client's own value for it is never kept.
  if tg_op = 'INSERT' then
    new.live_since := case when new.is_live then now() else null end;
  elsif new.is_live and not coalesce(old.is_live, false) then
    new.live_since := now();
  elsif new.is_live then
    new.live_since := old.live_since;
  else
    new.live_since := null;
  end if;
  return new;
end $$;
drop trigger if exists a_live_since on public.live_status;
create trigger a_live_since before insert or update on public.live_status
  for each row execute function public.stamp_live_since();
comment on column public.live_status.live_since is
  'When the truck last went live (0419), stamped by the database alone (stamp_live_since): the push function sends the go-live ping only while this is minutes old.';

-- ── a limit counts what it lets in ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.rate_limit_hit(p_bucket text, p_window_ms int, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz; n int;
begin
  if p_max is null or p_max < 1 or p_window_ms is null or p_window_ms < 1 then return false; end if;
  w := to_timestamp(floor(extract(epoch from now()) * 1000 / p_window_ms) * p_window_ms / 1000.0);
  -- 0419: a try over the cap is refused and NOT counted — one caller past its own limit no longer spends the count
  -- every caller shares. Under the cap the count goes up one, atomically (the conflict serializes concurrent tries).
  insert into public.rate_limit_hits as h (bucket, window_start, count) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set count = h.count + 1 where h.count < p_max
    returning h.count into n;
  -- 0419: the windows of this bucket that have ENDED — every one before the current window. A window started more than
  -- an hour ago was swept before, and a day's window starts at midnight: its count went at one in the morning.
  if random() < 0.05 then
    delete from public.rate_limit_hits where bucket = p_bucket and window_start < w;
  end if;
  return n is not null;
end $$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
comment on function public.rate_limit_hit(text, int, int) is
  'Count one try in a fixed window and say whether it fits (0154; 0419): true is under the cap. A try over the cap is refused and not counted; a bucket''s ended windows are swept as it is used, and every bucket''s older than two days nightly (sweep_rate_limits).';

create or replace function public.sweep_rate_limits() returns integer
  language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  -- The longest window any caller uses is a day: two days back holds nothing that still counts.
  delete from public.rate_limit_hits where window_start < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sweep_rate_limits() from public, anon, authenticated;

-- ── a new phone signed out is counted ───────────────────────────────────────────────────────────────────────────────
create or replace function public.keep_app_push_token(p_token text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_endpoint text;
begin
  if coalesce(p_token, '') !~ '^[0-9A-Fa-f]{32,200}$' then
    raise exception 'That isn''t a device token.' using errcode = '22023';
  end if;
  v_endpoint := 'apns:' || lower(p_token);
  -- 0419: a new phone nobody is signed in on is counted with the web's (0418's push:new-guest — three hundred an hour,
  -- for everyone together). A member's is not: theirs replaces their other phones (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = v_endpoint)
     and not public.rate_limit_hit('push:new-guest', 3600000, 300) then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, platform, p256dh, auth, user_id, is_admin)
  values (v_endpoint, 'apns', null, null, v_user, true)          -- the mark is 0365's to give: the crew's alone
  on conflict (endpoint) do update set
    platform = 'apns', p256dh = null, auth = null,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,                             -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = true;
  -- One app install each: the person's other phones go — a reinstall or a new phone is a new token. Browsers stay.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> v_endpoint and endpoint like 'apns:%';
  end if;
end $$;
revoke all on function public.keep_app_push_token(text) from public, anon, authenticated;
grant execute on function public.keep_app_push_token(text) to anon, authenticated;

-- ── the sends' own indexes ─────────────────────────────────────────────────────────────────────────────────────────
create index if not exists push_subscriptions_member_idx on public.push_subscriptions (user_id) where user_id is not null;
create index if not exists push_subscriptions_crew_idx on public.push_subscriptions (tenant_id) where is_admin;
create index if not exists push_subscriptions_live_idx on public.push_subscriptions (tenant_id) where wants_live;

-- ── a job that fails is said ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.cron_watch() returns integer
  language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select j.jobname, count(*) as fails, max(d.end_time) as last_at,
           (array_agg(left(coalesce(d.return_message, ''), 160) order by d.end_time desc))[1] as said
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where d.status = 'failed' and d.end_time > now() - interval '20 minutes'
     group by j.jobname
  loop
    -- One open alert per job (alert_open_once: a job failing every run is one alert, its count going up), named by the
    -- job — the subject is the job's name made a uuid, so the same job is the same alert.
    perform public.alert_open_once('cron_failed', md5('cron:' || r.jobname)::uuid, 'important', 'system',
      'A scheduled job is failing — ' || r.jobname,
      r.fails || ' failed run' || case when r.fails = 1 then '' else 's' end || ' in the last 20 minutes. The last said: '
        || coalesce(nullif(btrim(r.said), ''), '(nothing)'),
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  end loop;
  -- The run log keeps a week (it grew by thousands of rows a day and was never pruned).
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  return n;
end $$;
revoke all on function public.cron_watch() from public, anon, authenticated;
comment on function public.cron_watch() is
  'Every ten minutes (0419): a scheduled job with failed runs in the last twenty minutes raises one alert for that job (kind cron_failed, one open per job), and the run log keeps a week.';

-- ── the schedules ──────────────────────────────────────────────────────────────────────────────────────────────────
do $$ begin perform cron.unschedule('push-sent-sweep'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('rate-limit-sweep'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('cron-watch'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('push-sent-sweep', '17 7 * * *', $q$delete from public.push_sent where sent_at < now() - interval '90 days'$q$);
  perform cron.schedule('rate-limit-sweep', '23 7 * * *', 'select public.sweep_rate_limits()');
  perform cron.schedule('cron-watch', '*/10 * * * *', 'select public.cron_watch()');
exception when others then
  raise notice '0419: pg_cron is not here — run select public.cron_watch() and select public.sweep_rate_limits() by hand.';
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A push is sent once, for what happened', 'security', 'Crew',
   'The app''s push sender reads every order, alert and notice it is told about from the database before it sends, and sends each one once — a made-up request, or the same one sent twice, rings nobody and emails nobody.',
   '2026-10-16', false),
  ('A busy door no longer closes for everyone', 'fix', 'Ordering',
   'Limits count what they let through: one person or script past its own limit no longer uses up the allowance everyone shares, so card checkout and booking stay open for real customers. Daily limits hold for the whole day.',
   '2026-10-16', false),
  ('A scheduled job that fails is said', 'fix', 'Crew',
   'The jobs the database runs on its own — re-ringing a critical, releasing a hold, sending pack notices — raise an alert in the inbox when they start failing, instead of failing quietly.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_class where relname = 'push_sent' and relrowsecurity;                                        -- 1
--   select count(*) from pg_trigger where tgname = 'a_live_since' and not tgisinternal;                                  -- 1
--   select has_table_privilege('anon', 'public.push_sent', 'select');                                                   -- false
--   select prosrc like '%h.count < p_max%' from pg_proc where proname = 'rate_limit_hit';                                -- true
--   select prosrc like '%window_start < w%' from pg_proc where proname = 'rate_limit_hit';                               -- true
--   select prosrc like '%push:new-guest%' from pg_proc where proname = 'keep_app_push_token';                            -- true
--   select count(*) from pg_indexes where indexname in ('push_subscriptions_member_idx', 'push_subscriptions_crew_idx', 'push_subscriptions_live_idx'); -- 3
--   select count(*) from cron.job where jobname in ('push-sent-sweep', 'rate-limit-sweep', 'cron-watch');  -- 3
select public.record_migration('0419_a_push_is_sent_once_for_what_happened_and_a_limit_counts_what_it_lets_in');

-- ============================================================
-- 0420_money_moves_through_its_own_doors_and_is_counted_on_the_business_day.sql
-- ============================================================
-- ── 0420 — MONEY MOVES THROUGH ITS OWN DOORS, AND IS COUNTED ON THE BUSINESS DAY ───────────────────────────────────
-- 2026-10-16. R10 of the customer audit — the 10/10 audit of the back end (Ryan, 2026-10-16: "then audit for 10/10 best
-- practices... front and back end"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · Any crew role could rewrite money straight through the API: the policies on packs, deliveries, office orders and
--     invoices let every role but member update any column, and nothing stood between a page and `paid`, `total_cents`,
--     `payment_status` or an invoice's `amount_cents`. A pack set paid by hand showed paid, counted as revenue in Money
--     and was handed over; an office order was marked paid without the owner's check mark_invoice_paid has (0341). The
--     office board itself did it that way (components/OfficeOrders: two writes from the browser, and an invoice).
--   · "Covered" (0416) settled any unpaid cup or pack for free and counted it nowhere — the caller's own included.
--   · A delivery's ↩ Undo took the member's stamps for good: stepping back from Delivered clawed them, and marking it
--     delivered again could not award them twice. 0416 fixed exactly this for packs.
--   · Money's report and the founder digest counted UTC days (current_date, created_at::date): after 8 pm Eastern every
--     sale landed in tomorrow's bar and "7 days" began at 8 pm. And the day-by-day bars ran nine reads for every day.
--   · rsvps took a row from a signed-out page with no person on it ("anyone rsvp", 0009): the public "N going" count could
--     be pushed up at will, and the brew planner reads it as expected attendance.
--
-- WHAT.
--   · money_columns_guard — before a page (the API's authenticated role) writes a pack, a delivery, an office order or
--     an invoice: the money on it (paid, totals, payment ids and links, how and when it was collected, an invoice's
--     amount and status) changes only through a function of ours or the server — never a direct write — unless the
--     caller is an owner or admin. A page may not create one already settled. The work on them — stages, batches,
--     dates, pickups, the driver's outcomes, a cancel — writes as it always did.
--   · settle_office_order(order, 'paid' | 'invoiced') — the office board's settle, one door: owners and admins, the order
--     locked, from a state that still owes only, the invoice made in the same write; the order's payment link is the
--     route's to switch off (app/api/office/paylink), as before.
--   · staff_collect_payment (0416's): covered — a free cup or credit — is never the caller's own order or pack.
--   · award_points_delivery (0229's): Delivered awards once; a cancel gives it back; a step back keeps it (0416's rule).
--   · report_sales and founder_digest_alert (0417's): on the business day (business_day(), 0348) — the window starts at
--     Eastern midnight and each bar is an Eastern day — and the bars come from one grouped read, not nine a day.
--   · rsvps: a member's own, signed in ("member rsvp"); a status that is going, maybe or cancelled (new rows).
--     PART 2, for the SQL editor (it drops): "anyone rsvp".
-- existing rows: report_sales — reads only; past bars are said again on Eastern days the next time Money opens.
-- existing rows: founder_digest_alert — each digest is that day's snapshot ('fyi'); the next one counts Eastern days.
-- existing rows: award_points_delivery — writes the ledger only (no alert); stamps clawed by an Undo before this stay
--   clawed (the ledger is the record; an owner can re-award by hand).
-- changelog: below.

-- ── the money on an order changes through its own doors ─────────────────────────────────────────────────────────────
create or replace function public.money_columns_guard() returns trigger
  language plpgsql security invoker set search_path = public as $$
declare cols text[]; c text; o jsonb; n jsonb;
begin
  -- A function of ours runs as its owner and the server as service_role: only a page's own write is asked. Invoker on
  -- purpose — a definer would always see its owner here.
  if current_user <> 'authenticated' or public.is_admin() then
    return new;
  end if;
  n := to_jsonb(new);
  if tg_op = 'INSERT' then
    -- A page may not create one already settled.
    if coalesce((n ->> 'paid')::boolean, false)
       or coalesce(n ->> 'payment_status', '') in ('paid', 'invoiced', 'refunded')
       or n ->> 'collected_at' is not null
       or (tg_table_name = 'invoices') then
      raise exception 'Money on an order is recorded through its own door — an owner or admin can settle it.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  cols := case tg_table_name
    when 'drop_orders'     then array['paid', 'total_cents', 'payment_id', 'payment_status', 'collected_via', 'collected_at', 'collected_by', 'idempotency_key']
    when 'delivery_orders' then array['total_cents', 'bottle_subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'payment_status', 'payment_method', 'payment_id']
    when 'business_orders' then array['total_cents', 'subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'price_per_gallon_cents', 'payment_status', 'payment_id', 'square_order_id', 'paylink_url', 'paylink_id']
    when 'invoices'        then array['amount_cents', 'status', 'paid_at', 'business_order_id', 'business_id']
    else array[]::text[] end;
  o := to_jsonb(old);
  foreach c in array cols loop
    if (n -> c) is distinct from (o -> c) then
      raise exception 'Money on an order changes through its own door — % is not a page''s to write. An owner or admin can settle it.', c
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.money_columns_guard() from public, anon, authenticated;
comment on function public.money_columns_guard() is
  'Before a page writes a pack, delivery, office order or invoice (0420): its money columns change only through a function of ours or the server, unless the caller is an owner or admin; a page may not create one already settled. Named a_… so it reads the row as the page sent it, before the triggers that derive payment_status.';

drop trigger if exists a_money_columns_guard on public.drop_orders;
create trigger a_money_columns_guard before insert or update on public.drop_orders
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.delivery_orders;
create trigger a_money_columns_guard before insert or update on public.delivery_orders
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.business_orders;
create trigger a_money_columns_guard before insert or update on public.business_orders
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.invoices;
create trigger a_money_columns_guard before insert or update on public.invoices
  for each row execute function public.money_columns_guard();

-- ── an office order settled, one door ──────────────────────────────────────────────────────────────────────────────
create or replace function public.settle_office_order(p_order uuid, p_how text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare o public.business_orders; v_invoice uuid;
begin
  if not public.is_admin() then
    raise exception 'Owners and admins settle office orders.' using errcode = '42501';
  end if;
  if p_how is null or p_how not in ('paid', 'invoiced') then
    raise exception 'Say how it was settled: paid or invoiced.' using errcode = '22023';
  end if;
  select * into o from public.business_orders
   where id = p_order and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'That order isn''t on the books.' using errcode = 'PT404'; end if;
  if o.canceled_at is not null then raise exception 'That order was canceled — nothing to settle.' using errcode = 'P0001'; end if;
  -- Settled already (a second tap, a second phone): said, not done twice.
  if o.payment_status not in ('pending', 'failed') then
    return jsonb_build_object('ok', true, 'already', o.payment_status);
  end if;
  update public.business_orders set payment_status = p_how where id = p_order;
  if p_how = 'invoiced' then
    insert into public.invoices (business_id, business_order_id, amount_cents, terms, status)
    values (o.business_id, o.id, o.total_cents, case when o.billing_terms = 'net30' then 'net30' else 'net15' end, 'open')
    returning id into v_invoice;
  end if;
  return jsonb_build_object('ok', true, 'payment_status', p_how, 'invoice', v_invoice);
end $$;
revoke all on function public.settle_office_order(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_office_order(uuid, text) to authenticated;
comment on function public.settle_office_order(uuid, text) is
  'The office board''s settle (0420): paid or invoiced, owners and admins only, the order locked, from pending or failed only (a second tap says it is settled already), and an invoice made in the same write. Its payment link is the route''s to switch off (app/api/office/paylink).';

-- ── covered is never your own ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.staff_collect_payment(p_kind text, p_id uuid, p_via text)
returns text language plpgsql security definer set search_path = public as $$
declare v_paid boolean; v_at timestamptz; v_gone boolean; v_owner uuid;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_via is null or p_via not in ('cash', 'card_reader', 'covered') then
    raise exception 'say how it was paid: cash, card_reader or covered';
  end if;

  -- Cash sets paid (the till is counted nowhere else); the reader does not (Square counts it, 0341); covered — a free
  -- cup or the member's credit (0416) — does not either: it is owed nothing, and it is no money anywhere.
  if p_kind = 'cup' then
    select paid, collected_at, status = 'void', user_id into v_paid, v_at, v_gone, v_owner
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that order does not exist'; end if;
    if v_gone then raise exception 'that order was voided — nothing to collect'; end if;
    if v_paid or v_at is not null then return 'already settled'; end if;
    -- 0420: a free cup or credit for your own order is another crew member's to give (0392's rule for a card).
    if p_via = 'covered' and v_owner is not null and v_owner = auth.uid() then
      raise exception 'your own order: another crew member settles it as covered' using errcode = '42501';
    end if;
    update public.orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
    return 'collected';
  elsif p_kind = 'pickup' then
    select paid, collected_at, canceled_at is not null, user_id into v_paid, v_at, v_gone, v_owner
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that pack does not exist'; end if;
    if v_gone then raise exception 'that pack was canceled — nothing to collect'; end if;
    if v_paid or v_at is not null then return 'already settled'; end if;
    if p_via = 'covered' and v_owner is not null and v_owner = auth.uid() then
      raise exception 'your own pack: another crew member settles it as covered' using errcode = '42501';
    end if;
    update public.drop_orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
    return 'collected';
  end if;
  raise exception 'unknown kind: %', coalesce(p_kind, 'null');
end $$;
revoke all on function public.staff_collect_payment(text, uuid, text) from public, anon, authenticated;
grant execute on function public.staff_collect_payment(text, uuid, text) to authenticated;

-- ── a delivery's stamps: a step back keeps them; a cancel gives them back (0416's rule for packs) ──────────────────────
create or replace function public.award_points_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.canceled_at is null and new.user_id is not null then
    perform public.credit_wallet(new.user_id, new.pack_size, new.total_cents, new.id, 'delivery');
  elsif new.canceled_at is not null and old.canceled_at is null and new.user_id is not null then
    -- Canceled: what it earned, if it earned anything, comes back (claw_wallet writes nothing for one never delivered).
    perform public.claw_wallet(new.user_id, new.id, 'delivery');
  end if;
  -- Delivered → back a step is a correction on the run (↩ Undo, components/DriverRun): the stamps stay; it can never
  -- double on the way back to delivered — the ledger awards an order once.
  return new;
end $$;

-- ── Money's report on the business day (0417's, the days Eastern) ─────────────────────────────────────────────────
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := public.business_day();
  first_day date := public.business_day() - (greatest(p_days, 1) - 1);
  -- 0420: the window opens at Eastern midnight of its first day (it opened at UTC midnight: 8 pm the evening before).
  since timestamptz := (first_day::timestamp at time zone 'America/New_York');
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint; shop bigint; resv bigint;
  sq_n bigint;
  rf_walk bigint; rf_cup bigint; rf_packs bigint; rf_deliv bigint; rf_office bigint;
  days jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  select coalesce(sum(es.amount_cents), 0), count(*) into sq, sq_n from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
                and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
                and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
                and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done');
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  packs  := coalesce((select sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))
                        from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= since and d.tenant_id = tid), 0)
          + coalesce((select sum(ch.diff_cents) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
                        where ch.state = 'done' and ch.created_at >= since and d.paid and d.canceled_at is null and d.tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between first_day and today and tenant_id = tid), 0);
  shop   := coalesce((select sum(total_cents - coalesce(refund_amount_cents, 0)) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid), 0);
  resv   := coalesce((select sum(paid_cents - refunded_cents) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at >= since and tenant_id = tid), 0);
  select coalesce(sum(x.off_cents) filter (where x.channel = 'walkup'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'cup'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'packs'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'delivery'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'office'), 0)
    into rf_walk, rf_cup, rf_packs, rf_deliv, rf_office
    from public.refunds_counted(tid) x
   where x.made_at >= since;
  sq := sq - rf_walk; cup := cup - rf_cup; packs := packs - rf_packs; deliv := deliv - rf_deliv; office := office - rf_office;

  -- 0420: the bars — every amount above on the Eastern day it moved, read once and grouped (nine reads a day before).
  with money as (
    select (es.created_at at time zone 'America/New_York')::date as d, es.amount_cents::bigint as c
      from event_sales es
     where es.created_at >= since and es.tenant_id = tid
       and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
       and not exists (select 1 from drop_orders d2 where d2.payment_id = es.square_payment_id)
       and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
       and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
       and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
       and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id)
       and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done')
    union all
    select (o.created_at at time zone 'America/New_York')::date, o.total_cents::bigint
      from orders o where o.paid and o.status <> 'void' and o.created_at >= since and o.tenant_id = tid
    union all
    select (d.created_at at time zone 'America/New_York')::date,
           (d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))::bigint
      from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= since and d.tenant_id = tid
    union all
    select (ch.created_at at time zone 'America/New_York')::date, ch.diff_cents::bigint
      from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
     where ch.state = 'done' and ch.created_at >= since and d.paid and d.canceled_at is null and d.tenant_id = tid
    union all
    select (dv.created_at at time zone 'America/New_York')::date, dv.total_cents::bigint
      from delivery_orders dv where dv.payment_status = 'paid' and dv.canceled_at is null and dv.created_at >= since and dv.tenant_id = tid
    union all
    select b.delivery_date, b.total_cents::bigint
      from business_orders b where b.payment_status = 'paid' and b.canceled_at is null and b.delivery_date between first_day and today and b.tenant_id = tid
    union all
    select (sh.created_at at time zone 'America/New_York')::date, (sh.total_cents - coalesce(sh.refund_amount_cents, 0))::bigint
      from shop_orders sh where sh.status <> 'canceled' and sh.total_cents > 0 and sh.created_at >= since and sh.tenant_id = tid
    union all
    select (rc.created_at at time zone 'America/New_York')::date, (rc.paid_cents - rc.refunded_cents)::bigint
      from reserve_claims rc where rc.state in ('paid', 'collected') and rc.paid_cents is not null and rc.created_at >= since and rc.tenant_id = tid
    union all
    select (x.made_at at time zone 'America/New_York')::date, -x.off_cents
      from public.refunds_counted(tid) x where x.made_at >= since
  ), per_day as (
    select m.d, sum(m.c) as cents from money m group by m.d
  )
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(g.day, 'MM-DD'), 'cents', coalesce(p.cents, 0)) order by g.day), '[]'::jsonb)
    into days
    from (select gs::date as day from generate_series(first_day, today, interval '1 day') gs) g
    left join per_day p on p.d = g.day;

  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',
    'revenue_cents', sq + cup + packs + deliv + office + shop + resv,
    'by_channel', jsonb_build_object('square_walkup', sq, 'cup', cup, 'packs', packs, 'delivery', deliv, 'office', office, 'shop', shop, 'reserve', resv),
    'refunds_cents', rf_walk + rf_cup + rf_packs + rf_deliv + rf_office,
    'orders_by_channel', jsonb_build_object(
      'square_walkup', sq_n,
      'cup',      (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
      'packs',    (select count(*) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid),
      'delivery', (select count(*) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid),
      'office',   (select count(*) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between first_day and today and tenant_id = tid),
      'shop',     (select count(*) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid),
      'reserve',  (select count(*) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at >= since and tenant_id = tid)),
    'order_count', (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
    'cogs_pct', public.catalog_cogs_pct(),
    'cogs_basis', (select jsonb_build_object(
        'products', count(*),
        'costed',   count(*) filter (where m.costed),
        'assumed',  not exists (select 1 from products p
                                  join product_components pc on pc.product_id = p.id
                                  join inventory_items ii on ii.id = pc.inventory_item_id
                                 where p.price_cents > 0 and p.tenant_id = tid and ii.tenant_id = tid))
      from (select p.id,
                   exists (select 1 from product_components pc where pc.product_id = p.id)
                   and not exists (select 1 from product_components pc
                                     left join inventory_items ii on ii.id = pc.inventory_item_id
                                    where pc.product_id = p.id and (ii.unit_cost is null or pc.qty_per_serving is null)) as costed
              from products p where p.active and p.price_cents > 0 and p.tenant_id = tid) m),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('key', item, 'n', n, 'cents', cents) order by n desc) from (
        select unnest(items) item, count(*) n,
               sum(total_cents / greatest(coalesce(array_length(items, 1), 1), 1)) cents
        from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid group by 1
      ) p), '[]'::jsonb),
    'by_event', coalesce((select jsonb_agg(jsonb_build_object('event', coalesce(e.title, '(unlinked)'), 'cents', s.cents, 'orders', s.n) order by s.cents desc) from (
        select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales es where created_at >= since and tenant_id = tid
          and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
          and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id) group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    'by_day', days
  );
end; $$;
revoke execute on function public.report_sales(int) from public, anon, authenticated;
grant execute on function public.report_sales(int) to authenticated, service_role;

-- The founder digest's week, on the business day (0417's).
create or replace function public.founder_digest_alert() returns void
  language plpgsql security definer set search_path = public as $$
declare
  cadence text; t record; rev bigint; blockers int; reorders int; crit int;
  rdy_blocked int; rdy_total int; verdict text; msg text; back bigint;
  today date := public.business_day();
  since timestamptz := ((public.business_day() - 6)::timestamp at time zone 'America/New_York');
begin
  select digest_cadence into cadence from public.live_status where id = 1;
  if cadence is null or cadence = 'off' then return; end if;
  if cadence = 'weekly' and extract(dow from today) <> 1 then return; end if;

  for t in select id from public.tenants loop
    select coalesce((select sum(es.amount_cents) from event_sales es
             where es.created_at >= since and es.tenant_id = t.id
               and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
               and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
               and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
               and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
               and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done')), 0)
         + coalesce((select sum(total_cents) from orders           where paid and status <> 'void' and created_at >= since and tenant_id = t.id), 0)
         + coalesce((select sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))
                       from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= since and d.tenant_id = t.id), 0)
         + coalesce((select sum(ch.diff_cents) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
                       where ch.state = 'done' and ch.created_at >= since and d.paid and d.canceled_at is null and d.tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from delivery_orders  where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from business_orders  where payment_status = 'paid' and canceled_at is null and delivery_date between today - 6 and today and tenant_id = t.id), 0)
      into rev;
    select coalesce(sum(x.off_cents), 0) into back
      from public.refunds_counted(t.id) x
     where x.made_at >= since and x.channel in ('walkup', 'cup', 'packs', 'delivery', 'office');
    rev := rev - back;

    select count(*) into blockers from public.incident_log where resolved = false and severity = 'blocker' and tenant_id = t.id;
    select count(*) into reorders from public.alerts where ack_at is null and category = 'prep' and title like '📦 Reorder%' and tenant_id = t.id;
    select count(*) into crit     from public.alerts where ack_at is null and severity = 'critical' and tenant_id = t.id;
    select count(*) filter (where critical and status = 'blocked'), count(*) filter (where critical)
      into rdy_blocked, rdy_total from public.readiness_checks where tenant_id = t.id;
    verdict := case when rdy_total = 0 then 'no criteria yet' when rdy_blocked > 0 then 'NO-GO' else 'on track' end;

    msg := 'Revenue 7d: $' || to_char(rev / 100.0, 'FM999,999,990.00')
        || '  ·  Launch: ' || verdict || case when rdy_blocked > 0 then ' (' || rdy_blocked::text || ' blocked)' else '' end
        || '  ·  Blockers: ' || blockers::text
        || '  ·  Reorders: ' || reorders::text
        || '  ·  Needs you: ' || crit::text;

    insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
    values ('fyi', 'money', '📊 Daily founder digest', msg, '/admin', null, t.id);
  end loop;
end $$;
revoke execute on function public.founder_digest_alert() from public, anon, authenticated;
grant execute on function public.founder_digest_alert() to service_role;

-- ── an RSVP is a member's own ──────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "member rsvp" on public.rsvps;
create policy "member rsvp" on public.rsvps for insert to authenticated
  with check (user_id = (select auth.uid()));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rsvps_status_words') then
    alter table public.rsvps add constraint rsvps_status_words check (status in ('going', 'maybe', 'cancelled')) not valid;
  end if;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Money on an order moves through its own doors', 'security', 'Money',
   'Whether a pack, a delivery or an office order is paid — and what an invoice is for — changes only through the app''s own steps (taking payment at the window, an owner settling an office order), never by a direct edit, and settling an office order is an owner''s or admin''s. A free cup or credit is never the crew member''s own order.',
   '2026-10-16', false),
  ('Money counts Eastern days', 'fix', 'Money',
   'Money''s report and the founder digest count the business day in Eastern time: a sale after 8 pm is that evening''s, not tomorrow''s, and "7 days" starts at midnight. The day-by-day bars load faster.',
   '2026-10-16', false),
  ('An Undo on a delivery keeps its stamps', 'fix', 'Loyalty',
   'Stepping a delivered order back on the driver''s run no longer takes the member''s stamps away for good; canceling a delivery still gives back what it earned.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ═════ PART 2 — for the SQL editor (it drops). Run after part 1, in the same paste or on its own. ═════════════════════
-- An RSVP is a member's own: the signed-out door goes.
drop policy if exists "anyone rsvp" on public.rsvps;

-- verify (numbers and booleans only):
--   select count(*) from pg_trigger where tgname = 'a_money_columns_guard';                                              -- 4
--   select has_function_privilege('authenticated', 'public.settle_office_order(uuid, text)', 'execute');                 -- true
--   select has_function_privilege('anon', 'public.settle_office_order(uuid, text)', 'execute');                          -- false
--   select prosrc like '%another crew member settles it as covered%' from pg_proc where proname = 'staff_collect_payment'; -- true
--   select prosrc like '%business_day()%' from pg_proc where proname = 'report_sales';                                   -- true
--   select prosrc like '%new.canceled_at is not null and old.canceled_at is null%' from pg_proc where proname = 'award_points_delivery'; -- true
--   select count(*) from pg_policies where tablename = 'rsvps' and policyname = 'anyone rsvp';                         -- 0
select public.record_migration('0420_money_moves_through_its_own_doors_and_is_counted_on_the_business_day');

-- ============================================================
-- 0421_files_are_their_owners_and_a_lost_answer_is_kept.sql
-- ============================================================
-- ── 0421 — A FILE IS ITS OWNER'S TO LIST; A SUBSCRIPTION SQUARE MAY HAVE STARTED IS KEPT; THE SMALLER DOORS, SHUT ──────
-- 2026-10-16. R10b of the customer audit — the rest of the 10/10 audit of the back end (Ryan, 2026-10-16: "then audit for
-- 10/10 best practices... front and back end"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · Storage: five public buckets (avatars, content, training, brand, shop) each had a read policy for everyone, so
--     anyone with the public key could LIST them — every member's and crew member's id and face photo, every Studio
--     draft's media. A public bucket serves its files by URL without any policy; the policy only ever added the listing.
--     And avatars took any file of any size from any signed-in member.
--   · note-files: every crew role could list, open, overwrite and delete the files of every note — private notes too —
--     at the storage layer ("note files staff all", 0262), whatever note_files' own rules said.
--   · reap-stale-pending-subs (0021) deleted a subscription row whose Square outcome was unknown: billed monthly, with
--     nothing in the app to cancel and every webhook for it matching no row.
--   · outlook_connection (0068) still granted the company mailbox's tokens' table to anon and authenticated (RLS the only
--     wall); the splash's and banners' button links took any text — javascript: ran on this origin from window.open.
--   · An order's 86 check ran before the order was stamped with its event (triggers fire by name), so "the event's city"
--     never applied. A planned brew's start day, and a stop's day, were taken on the UTC calendar. A market lead could pull
--     anyone into their market — an owner or admin, or another market's own lead; two owners demoting each other at once
--     could leave none.
--   · The joins the money triggers and account erasure walk had no index on four foreign keys.
--
-- WHAT.
--   · Storage: the everyone-read policies go; a member reads (and so may replace) their own avatar folder, the crew the
--     content bucket, an owner the shop's (each write policy already covers its writer). Avatars and VIP photos: images,
--     ten megabytes at most. note-files: read by those who may read the note, added by those who may add to it, removed
--     by whoever added the file, the note's author, or an admin.
--   · subscriptions.square_asked_at — stamped by app/api/subscriptions/create the moment Square is asked; the sweep is a
--     function now, reap_stale_pending_subs(): a try never asked goes as before, a try asked and never answered stays and
--     raises one critical (subscription_unknown) until a person looks.
--   · outlook_connection: revoked from anon and authenticated. promos and broadcasts: a button link is a path here or a
--     web address (checked for new and edited rows).
--   · orders_stamp_event is renamed a_orders_stamp_event (it fires first). brew_start_date and resync_stop_brews count
--     Eastern days. set_member_market: a lead never moves an owner or admin, or another market's lead (bringing crew into
--     their own market stays theirs — components/CrewPerson offers exactly that). admin_set_role locks the owners before
--     counting them.
--   · indexes: invoices(business_order_id), jug_ledger(business_order_id), reserve_claims(reserve_id), alerts(claimed_by).
-- existing rows: reap_stale_pending_subs — new here; it has written nothing yet (no row has square_asked_at before 0421).
-- existing rows: planned brew batches — brew_date and ready_at re-derived from their needed-by day on Eastern time (planned
--   only; a batch brewing or done is left as it is). Nothing else is rewritten: storage objects, subscriptions, promos and
--   broadcasts keep what they hold (the link checks are NOT VALID — new and edited rows only).
-- changelog: below.

-- ── storage: a file is listed by those who own it ─────────────────────────────────────────────────────────────────
do $$
begin
  -- Everyone-read (anon included) is what made the public buckets listable. Public URLs never needed it.
  drop policy if exists "avatars public read" on storage.objects;
  drop policy if exists "content public read" on storage.objects;
  drop policy if exists "training media public read" on storage.objects;
  drop policy if exists "brand assets public read" on storage.objects;
  drop policy if exists "shop media public read" on storage.objects;
  -- What a writer needs to replace its own file (an upsert asks select too): a member their avatar folder, the crew the
  -- content bucket, an owner the shop's. training and brand are covered by their staff FOR ALL policies.
  drop policy if exists "avatars own read" on storage.objects;
  create policy "avatars own read" on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
  drop policy if exists "content staff read" on storage.objects;
  create policy "content staff read" on storage.objects for select to authenticated
    using (bucket_id = 'content' and (select public.is_staff()));
  drop policy if exists "shop media owner read" on storage.objects;
  create policy "shop media owner read" on storage.objects for select to authenticated
    using (bucket_id = 'shop' and (select public.is_owner()));
  -- A photo is a photo: images only, ten megabytes at most (the card's own check is eight).
  update storage.buckets set file_size_limit = 10485760,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
   where id in ('avatars', 'vip');

  -- note-files: the note's own rules, at the storage layer. Keys are {note_id}/{ts-rand} (app/crew/page.tsx).
  drop policy if exists "note files staff all" on storage.objects;
  drop policy if exists "note files follow note read" on storage.objects;
  create policy "note files follow note read" on storage.objects for select to authenticated
    using (bucket_id = 'note-files' and (select public.is_staff()) and exists (
      select 1 from public.meeting_notes n
       where n.id::text = (storage.foldername(name))[1]
         and (n.visibility in ('team', 'collab') or n.created_by = (select auth.uid()))));
  drop policy if exists "note files follow note add" on storage.objects;
  create policy "note files follow note add" on storage.objects for insert to authenticated
    with check (bucket_id = 'note-files' and (select public.is_staff()) and exists (
      select 1 from public.meeting_notes n
       where n.id::text = (storage.foldername(name))[1]
         and (n.created_by = (select auth.uid())
              or (n.visibility <> 'private' and exists (select 1 from public.profiles p
                    where p.id = (select auth.uid()) and (p.role in ('owner', 'admin', 'event_manager') or p.is_admin))))));
  drop policy if exists "note files follow note remove" on storage.objects;
  create policy "note files follow note remove" on storage.objects for delete to authenticated
    using (bucket_id = 'note-files' and (
      owner = (select auth.uid()) or owner_id = (select auth.uid())::text or (select public.is_admin())
      or exists (select 1 from public.meeting_notes n where n.id::text = (storage.foldername(name))[1] and n.created_by = (select auth.uid()))));
exception when undefined_table or invalid_schema_name then
  raise notice '0421: no storage schema here — the storage policies are skipped.';
end $$;

-- ── a subscription Square may have started is kept ─────────────────────────────────────────────────────────────────
alter table public.subscriptions add column if not exists square_asked_at timestamptz;
comment on column public.subscriptions.square_asked_at is
  'When app/api/subscriptions/create asked Square to start this subscription (0421) — set before the ask, cleared when Square''s answer is kept. A pending row with this set and no Square id is one whose answer never came: kept, never swept.';

create or replace function public.reap_stale_pending_subs() returns integer
  language plpgsql security definer set search_path = public as $$
declare r record; n integer;
begin
  -- A try that never reached Square's subscription step (it died vaulting the card, or before): gone, as before.
  delete from public.subscriptions
   where status = 'pending' and square_subscription_id is null and square_asked_at is null
     and created_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  -- A try Square was asked about and never answered: kept, and said once until a person looks. The member's next visit
  -- to Subscribe asks Square what it has for them (app/api/subscriptions/create).
  for r in select id from public.subscriptions
            where status = 'pending' and square_subscription_id is null and square_asked_at < now() - interval '15 minutes'
  loop
    perform public.alert_open_once('subscription_unknown', r.id, 'critical', 'money',
      'A subscription may have started at Square — check it',
      'A member''s subscription was sent to Square and no answer came back. Look in Square for this member''s subscriptions: if one started, it is theirs — the app takes it up on their next visit to Subscribe; if none did, nothing was charged.',
      '/crew?s=money&a=pay');
  end loop;
  return n;
end $$;
revoke all on function public.reap_stale_pending_subs() from public, anon, authenticated;
do $$ begin perform cron.unschedule('reap-stale-pending-subs'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('reap-stale-pending-subs', '*/15 * * * *', 'select public.reap_stale_pending_subs()');
exception when others then
  raise notice '0421: pg_cron is not here — run select public.reap_stale_pending_subs() by hand.';
end $$;

-- ── the smaller doors ──────────────────────────────────────────────────────────────────────────────────────────────
-- The company mailbox's tokens: the service role's alone (RLS was the only wall; 0363 did this for Apple's).
revoke all on public.outlook_connection from anon, authenticated;

-- A button link is a page here or a web address (lib/safeLink holds the same rule in the app): never javascript:, data:
-- or //another-site — the schemes that run or that pass for a path.
alter table public.promos drop constraint if exists promos_cta_href_safe;
alter table public.promos add constraint promos_cta_href_safe
  check (cta_href is null or cta_href ~ '^(/([^/\\\s][^\s\\]*)?|https?://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^\s\\]*)?)$') not valid;
alter table public.broadcasts drop constraint if exists broadcasts_cta_href_safe;
alter table public.broadcasts add constraint broadcasts_cta_href_safe
  check (cta_href is null or cta_href ~ '^(/([^/\\\s][^\s\\]*)?|https?://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^\s\\]*)?)$') not valid;

-- An order is stamped with its event BEFORE its 86 check (triggers fire by name): "the event's city" applies.
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'orders_stamp_event' and tgrelid = 'public.orders'::regclass) then
    alter trigger orders_stamp_event on public.orders rename to a_orders_stamp_event;
  end if;
end $$;

-- A brew's start day, and a stop's day, on the Eastern calendar (0192 took the UTC date: a brew to start at 8 pm Friday
-- read Saturday, and its ready time landed after it was needed).
create or replace function public.brew_start_date(p_day date, p_ext numeric) returns date
  language sql immutable as $$
    select ((public.brew_needed_by(p_day) - (ceil(coalesce(p_ext, 0)) * interval '1 hour')) at time zone 'America/New_York')::date;
  $$;
create or replace function public.resync_stop_brews() returns trigger
  language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if new.starts_at is not null and new.starts_at is distinct from old.starts_at then
    d := (new.starts_at at time zone 'America/New_York')::date;   -- 0421: the stop's own (Eastern) day
    update public.brew_batches b set
      needed_by = public.brew_needed_by(d),
      brew_date = public.brew_start_date(d, b.extraction_hours),
      ready_at  = public.brew_ready_at(d, b.extraction_hours)
    where b.status = 'planned'
      and (b.stop_id = new.id
           or b.id in (select batch_id from public.brew_batch_links where stop_id = new.id));
  end if;
  return new;
end $$;
-- existing rows: the planned batches, re-derived from their own needed-by day.
update public.brew_batches b set
  brew_date = public.brew_start_date((b.needed_by at time zone 'America/New_York')::date, b.extraction_hours),
  ready_at  = public.brew_ready_at((b.needed_by at time zone 'America/New_York')::date, b.extraction_hours)
 where b.status = 'planned' and b.needed_by is not null
   and (b.brew_date is distinct from public.brew_start_date((b.needed_by at time zone 'America/New_York')::date, b.extraction_hours)
        or b.ready_at is distinct from public.brew_ready_at((b.needed_by at time zone 'America/New_York')::date, b.extraction_hours));

-- A market lead brings crew into their own market (components/CrewPerson's one destination for a lead) — but never an
-- owner or admin, and never another market's lead: those are an owner's to move.
create or replace function public.set_member_market(p_member uuid, p_market text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cur text; v_role text; v_admin boolean; v_leads text;
begin
  if not public.is_owner() and public.leads_market() is distinct from p_market then
    raise exception 'Only an owner, or the lead of that market, can move someone into it.';
  end if;
  if p_market is null or not exists (select 1 from public.markets where slug = p_market) then
    raise exception 'No such market: %', coalesce(p_market, '(null)');
  end if;
  select market, role, is_admin, leads_market into v_cur, v_role, v_admin, v_leads from public.profiles where id = p_member;
  if not found then
    raise exception 'no such profile';
  end if;
  if not public.is_owner() then
    if v_role in ('owner', 'admin') or coalesce(v_admin, false) then
      raise exception 'A market lead cannot move an owner or admin.' using errcode = '42501';
    end if;
    if v_leads is not null and v_leads is distinct from p_market then
      raise exception 'That person leads %. Only an owner moves a market''s lead.', v_leads using errcode = '42501';
    end if;
  end if;
  update public.profiles set market = p_market where id = p_member;
end $$;
revoke all on function public.set_member_market(uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_market(uuid, text) to authenticated;

-- The last owner, counted under a lock: two owners demoting each other at once can no longer leave none.
create or replace function public.admin_set_role(member uuid, new_role text) returns void
  language plpgsql security definer set search_path = public as $$
declare
  cur    text;
  owners int;
  tgt_mk text;
  lead   text;
  LEADABLE constant text[] := array['member','server','contractor','event_manager'];
begin
  -- Authorisation FIRST, before anything is looked up. Checking the caller after fetching the
  -- target would let anyone with a login distinguish 'no such profile' from 'owner only' and so
  -- confirm whether a given id exists. Small, but it costs nothing to close.
  lead := public.leads_market();
  if not public.is_owner() and lead is null then raise exception 'owner only'; end if;

  if new_role not in ('member','server','operator','event_manager','contractor','admin','owner')
    then raise exception 'invalid role: %', new_role; end if;

  select role, market into cur, tgt_mk from public.profiles where id = member;
  if cur is null then raise exception 'no such profile'; end if;

  if not public.is_owner() then
    if member = auth.uid() then
      raise exception 'You cannot change your own role. Ask an owner.';
    end if;
    if tgt_mk is distinct from lead then
      raise exception 'That person is not in %. A market lead can only set roles inside their own market.', lead;
    end if;
    if not (cur = any(LEADABLE)) then
      raise exception 'A market lead cannot change a %. That is an owner decision.', cur;
    end if;
    if not (new_role = any(LEADABLE)) then
      raise exception 'A market lead can set member, server, contractor or event manager. % is an owner decision.', new_role;
    end if;
  end if;

  -- Finding 2 from 0280: refuse to remove the last owner. 0421: the owners are locked before they are counted, so two
  -- owners demoting each other at once are taken one after the other — the second finds one owner left, and stops.
  if cur = 'owner' and new_role <> 'owner' then
    perform 1 from public.profiles where role = 'owner' for update;
    select count(*) into owners from public.profiles where role = 'owner';
    if owners <= 1 then
      raise exception 'This is the last owner. Promote someone else to owner first, then change this role.';
    end if;
  end if;

  -- Finding 1 from 0280: is_admin is a MIRROR of role, never an independent grant.
  update public.profiles
     set role = new_role,
         is_admin = (new_role in ('admin','owner'))
   where id = member;
end $$;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ── the joins the money triggers and account erasure walk ─────────────────────────────────────────────────────────
create index if not exists invoices_business_order_idx on public.invoices (business_order_id) where business_order_id is not null;
create index if not exists jug_ledger_business_order_idx on public.jug_ledger (business_order_id) where business_order_id is not null;
create index if not exists reserve_claims_reserve_idx on public.reserve_claims (reserve_id);
create index if not exists alerts_claimed_by_idx on public.alerts (claimed_by) where claimed_by is not null;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Photos and files are listed only by those they belong to', 'security', 'Account',
   'Profile photos, the Studio''s media and the shop''s images still show wherever they are used, but nobody can list them any more; a profile photo must be an image under ten megabytes; a note''s files open only for those who can open the note.',
   '2026-10-16', false),
  ('A subscription is never lost between the app and Square', 'fix', 'Money',
   'If Square doesn''t answer while a subscription is starting, the app keeps it and tells the crew instead of forgetting it — so a member is never billed for a subscription they can''t see or cancel.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('avatars public read', 'content public read', 'training media public read', 'brand assets public read', 'shop media public read', 'note files staff all'); -- 0
--   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'note files follow note%'; -- 3
--   select file_size_limit from storage.buckets where id = 'avatars';                                                  -- 10485760
--   select has_table_privilege('anon', 'public.outlook_connection', 'select');                                         -- false
--   select count(*) from pg_trigger where tgname = 'a_orders_stamp_event';                                              -- 1
--   select count(*) from information_schema.columns where table_name = 'subscriptions' and column_name = 'square_asked_at'; -- 1
--   select count(*) from cron.job where jobname = 'reap-stale-pending-subs' and command like '%reap_stale_pending_subs()%'; -- 1
select public.record_migration('0421_files_are_their_owners_and_a_lost_answer_is_kept');
