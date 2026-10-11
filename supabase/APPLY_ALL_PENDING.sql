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
-- pending-from: 0371
-- generated-at: 2026-10-11
-- pending-count: 5
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0367_alerts_in_the_iphone_app.sql
-- ============================================================
-- ── 0367 — ALERTS IN THE IPHONE APP ───────────────────────────────────────────────────────────────────
-- 2026-10-11 (the App Store pass: "Turn on alerts" was taken out of the iPhone app because the app had nothing to
-- turn on — the web's push needs a browser's push service, and an app is reached through Apple's, APNs).
--
-- A phone running the app registers with Apple and gets a device token; the app keeps it here, as the web keeps a
-- browser's subscription, so the push function (supabase/functions/push) can reach it. Same table, same rules
-- (0006, 0009, 0081; 0365 decides who is marked for new orders), one more kind of row:
--
--   platform 'web'   the browser's subscription — endpoint, p256dh, auth, as before;
--   platform 'apns'  the app's device token — endpoint 'apns:<token>' (unique, as every endpoint is), no keys.
--
-- A web row still needs its two keys (the check below), so nothing that was true of a web row stops being true.
--
-- THE DATABASE KEEPS THE PHONE (keep_app_push_token), as it keeps a browser since 0366 (keep_push_device): for
-- whoever is signed in on it now, or nobody — it moves to them whoever had it — one app install each (a browser is
-- not one: the person's browsers keep ringing), marked for the pass's new orders only for the crew (0365's trigger
-- decides). The page wrote the row itself in this commit's first draft; the review found what 0366 had found on the
-- web: a phone someone signed out of stayed theirs, and the next person's write was refused.
--
-- And 0366's release_push_device is a signed-in person's alone: 0366 revoked it from PUBLIC, but Supabase grants a new
-- function to anon by name as well, so anon kept it (measured in production, 2026-10-11). It changed nothing for a
-- guest — the update is the caller's own row — but the grant now says what the function is for.
--
-- changelog: none yet — the line is written the day the app's alerts are switched on (APNs' key in the push function,
-- NEXT_PUBLIC_NATIVE_PUSH on the web), not the day this table can first hold a token.

alter table public.push_subscriptions add column if not exists platform text not null default 'web';
alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth drop not null;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions add constraint push_subscriptions_platform_check
  check (platform in ('web', 'apns') and (platform = 'apns' or (p256dh is not null and auth is not null)));

create or replace function public.keep_app_push_token(p_token text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_endpoint text;
begin
  if coalesce(p_token, '') !~ '^[0-9A-Fa-f]{32,200}$' then
    raise exception 'That isn''t a device token.' using errcode = '22023';
  end if;
  v_endpoint := 'apns:' || lower(p_token);
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
revoke all on function public.keep_app_push_token(text) from public;
grant execute on function public.keep_app_push_token(text) to anon, authenticated;

revoke execute on function public.release_push_device(text) from anon;

-- verify:
--   select platform, count(*) from public.push_subscriptions group by platform;          -- 'web' rows as before
--   select conname from pg_constraint where conname = 'push_subscriptions_platform_check';   -- one
--   select has_function_privilege('anon', 'public.release_push_device(text)', 'execute');  -- f
select public.record_migration('0367_alerts_in_the_iphone_app');

-- ============================================================
-- 0368_a_voided_order_stays_voided.sql
-- ============================================================
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

-- ============================================================
-- 0369_the_pass_alert_rings_until_the_pass_is_clear.sql
-- ============================================================
-- ── 0369 — THE PASS ALERT RINGS UNTIL THE PASS IS CLEAR ────────────────────────────────────────────────
-- 2026-10-11 (the audit of the kitchen display, "the Pass").
--
-- alert_stale_orders (0120; on alert_open_once since 0336; every five minutes from pg_cron) is the one alert for a
-- pass nobody is working: tickets still in 'new' ten minutes on. Three things about it were wrong.
--
-- 1. IT COUNTED A PRE-ORDER FROM WHEN IT WAS PLACED. orders.ready_from (0343) is "when the truck said it would make
--    this order": an order placed ahead of a stop is made from the stop's start, and the customer is told so — "We
--    make it when we open — Sat at 11:00am" (lib/ordering, readyWords). It is the time the order MAY BE STARTED FROM,
--    not a time it must be READY BY: before it, nobody is late, and the pass shows the ticket as "for 11:00am" and
--    starts its clock there (lib/ordering, orderClockFrom: ready_from when it is later than created_at). Read as
--    "ready by", the alert would have to fire before the stop opened, about an order the truck had promised to make
--    after it. The alert counted from created_at, so a 7am order for an 11am stop rang the owners' phones at 7:10.
--    An order is now due at the later of when it was placed and ready_from — the instant the pass's clock starts, so
--    the ticket reading "12m" on the pass is the one the alert counts — and it is counted once it has been due for ten
--    minutes or more.
--
-- 2. IT RANG ONCE. The push and the Teams post fan out from an INSERT on alerts (0157), and alert_open_once keeps its
--    one open line by UPDATING it for as long as it stays true. So the first late ticket rang, and then the line sat
--    in the inbox, refreshed every five minutes and never heard again — until somebody acknowledged it, or 0258's
--    sweep did, 21 days on — however long the tickets went on waiting. "Got it" on a broadcast hides it only from the
--    person who tapped it (0157), and they were never told again either. Now, while tickets are still waiting, it
--    rings again every fifteen minutes: the open line is closed and a fresh one opened, because a new row is what the
--    push function hears (unchanged — it fans out on INSERT, as it always has). There is never more than one open
--    line, so the inbox holds one line, not a pile. 0336's dedupe and 0174's cooldown hold: between rings the open
--    line is refreshed, not repeated, and a line someone acknowledged is not reopened until fifteen minutes after it
--    rang.
--
-- 3. IT NEVER CLEARED. An empty pass went on saying tickets were waiting. A run that finds none waiting now closes
--    the line, the way 0340's stalled-shop-order watchdog closes its own: ack_at set, ack_by left null — a
--    mechanism, not a person (0258) — and the row kept for history.
--
-- Fifteen minutes is measured with half a minute to spare. The cron is */5 (0120) and pg_cron starts each run a
-- moment after its minute — a different moment each time — so the run fifteen minutes on can find the last ring
-- 14:59.8 old; measured strictly, about half the re-rings would wait for the next run, twenty minutes after the last.
--
-- 4. ITS LINK OPENS THE PASS. It said '/admin', which a tapped push opened as the console wherever it was last left;
--    '/crew?s=now&a=kitchen-pass' is the console's own jump to the Pass (app/crew/page.tsx jumpTo), in the inbox and
--    from the lock screen alike.
--
-- Unchanged on purpose: who is told (no target — leadership's phones, the Teams channel; 0157), how loudly
-- ('important', the 'order' category), the words, the schedule, and what counts as waiting (status 'new', across the
-- whole pass).
--
-- The producer runs once at the end, so a line left open over a pass that is already clear closes when this is
-- applied, and an open line is restated as the cron would restate it within five minutes.

create or replace function public.alert_stale_orders(grace_min int default 10) returns int
  language plpgsql security definer set search_path = public as $$
declare
  n          int;
  last_rung  timestamptz;
  ring_every constant interval := interval '15 minutes' - interval '30 seconds';
begin
  -- Due: the later of when it was placed and when the truck said it would make it (greatest() passes over a null
  -- ready_from) — lib/ordering's orderClockFrom. greatest(grace_min, 2) as 0120 wrote it, so a mistaken 0 cannot
  -- ring for every ticket the moment it lands.
  select count(*) into n from public.orders
   where status = 'new'
     and greatest(created_at, ready_from) <= now() - make_interval(mins => greatest(grace_min, 2));

  -- Nothing waiting: the line closes itself (0340), the mechanism's ack — ack_by stays null.
  if n = 0 then
    update public.alerts set ack_at = now()
     where kind = 'order_stale' and subject_id is null and ack_at is null;
    return 0;
  end if;

  -- Still waiting, and the pass was last rung fifteen minutes ago or more: the open line closes, so the one
  -- alert_open_once opens below is a new row, and a new row is what rings (0157).
  select max(a.created_at) into last_rung from public.alerts a where a.kind = 'order_stale' and a.subject_id is null;
  if last_rung <= now() - ring_every then
    update public.alerts set ack_at = now()
     where kind = 'order_stale' and subject_id is null and ack_at is null;
  end if;

  -- One open line (0336): refreshed while it is open; opened when there is none — but not within fifteen minutes of
  -- the last ring, so a line someone acknowledged stays down until then (0174's cooldown).
  perform public.alert_open_once(
    'order_stale', null, 'important', 'order',
    '🧾 ' || n || ' order' || case when n = 1 then '' else 's' end || ' waiting on the pass',
    'A ticket has been sitting 10+ minutes in "new" — someone open the kitchen pass.',
    '/crew?s=now&a=kitchen-pass',
    ring_every);
  return n;
end $$;

-- A cron job's, as 0120 and 0123 said: nothing in the app calls it, and a stranger must not ring the owners' phones.
revoke all on function public.alert_stale_orders(int) from public, anon, authenticated;

comment on function public.alert_stale_orders(int) is
  'The pass''s waiting alert (kind order_stale, no subject, important, to leadership): counts tickets in ''new'' that have been due grace_min minutes (due = greatest(created_at, ready_from), lib/ordering orderClockFrom). Rings through alert_open_once; while tickets wait it rings again every fifteen minutes by closing the open line and opening a new one (the push fans out on INSERT, 0157), so one line is ever open; a pass with nothing waiting closes it (0369).';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The pass alert rings until the pass is clear','fix','Ops',
   'The alert that tells you tickets are waiting on the pass rang once and then sat quietly in the inbox — for up to three weeks — however long the tickets went on waiting, and it still said they were waiting after the pass had been cleared. It now rings again every fifteen minutes while tickets are still waiting, as one line rather than a pile, and closes itself when nothing is waiting. An order placed ahead of a stop counts from when the truck said it would make it, so a pre-order no longer sets the alert off hours before the stop opens.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- The rows it already wrote, restated by the producer itself (scripts/smoke.cjs: a re-emitted producer restates them).
select public.alert_stale_orders(10);

-- verify:
--   select kind, title, created_at, ack_at, ack_by from public.alerts where kind = 'order_stale' order by created_at desc limit 3;
--     -- at most one row with ack_at null; none at all when nothing is waiting
--   select has_function_privilege('authenticated', 'public.alert_stale_orders(int)', 'execute');   -- f
select public.record_migration('0369_the_pass_alert_rings_until_the_pass_is_clear');

-- ============================================================
-- 0370_the_86_board_and_brew_status_update_live.sql
-- ============================================================
-- ── 0370 — THE 86 BOARD AND BREW STATUS UPDATE LIVE ───────────────────────────────────────────────────
-- 2026-10-11 (the audit of the kitchen display, "the Pass").
--
-- Supabase sends a screen a table's changes only when two switches are on: the page subscribes (useRealtimeTable),
-- and the table is in the supabase_realtime publication. 0248 found the second switch off once before — customers,
-- with 34 other tables in the publication and the Customer book silently stale. Two more were never added:
--
--   products      the 86 board under the pass (components/EightySix) flips sold_out, and the pass (app/crew), the
--                 menu, the drink sheet and checkout (lib/availability) and the perks and codes panels
--                 (components/useBenefitProducts) subscribe to it: an item 86'd on one phone stayed on sale on every
--                 other screen until somebody reloaded it;
--   brew_batches  the brew board (components/DropOps), the crew calendar and an event's or a stop's prep screen
--                 (app/crew, PrepDetail) subscribe to it: a brew started, ready or bottled on one device did not move
--                 on another.
--
-- Both join the publication the way 0357 and 0359 add theirs: each only if it is not a member already, and only if
-- the publication exists, so this runs the same on a database without realtime and runs twice without error.
--
-- What a screen is sent follows each table's own read rules, which do not change: realtime checks every inserted or
-- updated row against the subscriber's policies, so products' active rows reach anyone and the rest only the crew
-- (0062), and brew_batches reaches only the crew (0079). A delete, which no policy can check, is sent as the row's id
-- alone — as it is for every table already in the publication.

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['products', 'brew_batches'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The 86 board and brew status update on every screen','fix','Crew',
   'An item 86''d on one phone stayed on sale everywhere else — the pass, the menu, the drink sheet — until someone reloaded the page, and a brew started, ready or bottled on one device did not move on another. Both now change on every open screen the moment they change.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('products', 'brew_batches');
--     -- two rows
select public.record_migration('0370_the_86_board_and_brew_status_update_live');

-- ============================================================
-- 0371_a_card_is_charged_once.sql
-- ============================================================
-- ── 0371 — A CARD IS CHARGED ONCE ─────────────────────────────────────────────────────────────────────
-- 2026-10-11 (the checkout audit: a retry after a lost answer could charge a card twice).
--
-- WHY. The idempotency key is what stops Square from charging a card twice for one checkout: send the same key
-- again and Square answers with the first payment instead of making a second. The cup checkout sent a NEW key on
-- every tap of Pay — the key was derived from the card token, and every tap asked the card form for a new token —
-- so a retry after a lost answer (the payment went through, the phone never heard) was, to Square, a request it
-- had never seen, and it charged the card again. Pay at pickup sent no key at all, so a retry after "we're
-- offline" put a second unpaid order on the pass.
--
-- WHAT. The page keeps one key per checkout now (components/useIdemKey), and /api/checkout CLAIMS it here — one
-- row, unique on the key — before it asks Square for money (lib/chargeOnce, lib/checkoutClaims). A request whose
-- key is already here is never sent to Square: it is given the first request's own answer, or "still confirming
-- your payment" while that request is in flight or its outcome is unknown. Unknown means Square's answer never
-- came or did not say; the crew is alerted with the key, and the payment, if there is one, carries the key as its
-- reference_id in Square.
--
--   idempotency_key  the checkout's key, exactly as Square is sent it (8–45 characters: lib/squareServer)
--   card             false for pay at pickup, which claims the same way and never calls Square
--   state            started → charged → done, or unknown; a claim stuck in started or charged past any
--                    request's life is moved on by the next retry of its key, which tells the crew
--   status, answer   what the first request answered, said again to every retry of the key
--
-- WHO READS IT. The server alone, with the service role (the routes' supabaseAdmin, which bypasses RLS). RLS is on
-- with no policy, and anon and authenticated hold no privilege on it — Supabase grants every new table to both by
-- default, so that is revoked by name: a browser cannot read whose checkout is whose, or claim a key to block
-- somebody's payment. No function, so nothing to revoke there. No tenant_id: a key is a random uuid a page minted,
-- not business data, and the order it leads to is stamped with its tenant as every order is (0134).
--
-- ORDER. Paste this BEFORE the deploy that reads it. Pasted after, nothing breaks: until it is here,
-- lib/checkoutClaims reports the table missing and the checkout runs without claims, exactly as it did before them.
-- Idempotent: it can run twice.

create table if not exists public.checkout_claims (
  idempotency_key text primary key check (char_length(idempotency_key) between 8 and 45),
  channel         text not null default 'cups',
  card            boolean not null,
  amount_cents    integer,
  state           text not null default 'started' check (state in ('started', 'charged', 'done', 'unknown')),
  payment_id      text,
  status          integer,
  answer          jsonb,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.checkout_claims enable row level security;
revoke all on table public.checkout_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.checkout_claims to service_role;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A card is charged once, however many times Pay is tapped','fix','Ordering',
   'Tapping Pay again after the connection dropped could charge the card a second time: every tap went to Square as a new payment. A checkout now keeps one key until it is settled, and the server records that key before it asks Square for money, so a second tap is told what happened to the first — the order that went in, or "still confirming your payment" — and is never charged again. A pre-order sent twice is one order.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select relrowsecurity from pg_class where oid = 'public.checkout_claims'::regclass;                 -- t
--   select has_table_privilege('anon', 'public.checkout_claims', 'select'),
--          has_table_privilege('authenticated', 'public.checkout_claims', 'insert');                    -- f, f
--   select state, count(*) from public.checkout_claims group by state;    -- 'unknown' rows are the crew's to check
select public.record_migration('0371_a_card_is_charged_once');
