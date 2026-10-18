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
-- pending-from: 0436
-- generated-at: 2026-10-18
-- pending-count: 7
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0430_the_watcher_is_watched_and_the_push_hooks_counted.sql
-- ============================================================
-- ── 0430 — THE WATCHER IS WATCHED, AND THE PUSH WEBHOOKS ARE COUNTED ─────────────────────────────────────────────────
-- 2026-10-18. R24 of the 10/10 audit (database F8 and F6, operations F11 and F19; Ryan, 2026-10-17: "Keep working to
-- improve to a 10").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. pg_cron runs every scheduled job the migrations made — the watchdogs, the reminders, the sweeps — and cron_watch
-- (0419, 0423, 0427) says a job that fails or stops. But cron_watch is one of those jobs: if pg_cron stopped, or
-- cron_watch itself failed every run, nothing in the database was left to say so, and the alerts it would have raised
-- were simply never raised. And a job that was never made in this database (a restore, a project moved, a migration
-- pasted half) or that someone unscheduled fails nothing and stops nothing — it isn't there to be read. The push
-- webhooks are the same kind of thing: ten of the triggers that carry an order, a booking, a sign-up or an alert to the
-- phones, Teams and email were made in the dashboard (database F6), in no migration — one deleted or switched off there
-- is a push that silently never goes, and nothing looked.
--
-- WHAT. One question the app's own server may ask, from outside the database: public.ops_alive(p_jobs, p_from, p_hooks)
-- answers when cron_watch last finished without failing, how many active jobs there are, how many of the jobs the app
-- knows the migrations made (lib/opsWatch CRON_JOBS — held to the migrations by scripts/r24.test.mjs) are missing or
-- switched off — each counted only once the migration that made it is in this database's ledger, so a migration not yet
-- pasted is not "missing" — and how many of the push webhooks the app names (lib/opsWatch PUSH_HOOKS — held to the
-- security snapshot) are not on their table or are switched off. /api/health asks it and says whether the scheduled
-- jobs run and the webhooks are on; the half-hourly production check (scripts/verify.prod.mjs) fails when they are not —
-- outside the database, so a stopped pg_cron is heard. Counts and a time only: no job's or trigger's name, command or
-- address leaves the database (a webhook's definition carries its address and key — never read here).
--
-- set lock_timeout (database F16): a function only — nothing is locked — but the rule is the rule.
-- existing rows: none — a new function; cron_watch and the webhooks are not touched.
-- changelog: below.

set lock_timeout = '5s';

create or replace function public.ops_alive(p_jobs text[], p_from text[], p_hooks text[]) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- when the watcher last finished without failing: a stopped pg_cron, and a watcher failing every run, both age it
    'watched_at', (select max(d.end_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.jobname = 'cron-watch' and d.status = 'succeeded'),
    'active', (select count(*) from cron.job j where j.active),
    -- each job the app names, once the migration that made it is applied here (the ledger, 0304): not there, or off
    'missing', (select count(*) from unnest(coalesce(p_jobs, '{}'::text[]), coalesce(p_from, '{}'::text[])) as x(job, made_by)
                 where exists (select 1 from public.schema_migrations m where m.version = x.made_by)
                   and not exists (select 1 from cron.job j where j.jobname = x.job and j.active)),
    -- each push webhook the app names ("table.trigger", public's): not on that table, or switched off (tgenabled D) —
    -- its name and switch only, never its definition (it carries the function's address and key)
    'hooks_off', (select count(*) from unnest(coalesce(p_hooks, '{}'::text[])) as h(hook)
                   where not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                                      where n.nspname = 'public' and c.relname = split_part(h.hook, '.', 1) and t.tgname = split_part(h.hook, '.', 2)
                                        and not t.tgisinternal and t.tgenabled <> 'D')));
$$;
revoke all on function public.ops_alive(text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.ops_alive(text[], text[], text[]) to service_role;
comment on function public.ops_alive(text[], text[], text[]) is
  'Whether the scheduled jobs run and the push webhooks are on (0430): when cron_watch last finished without failing, how many jobs are active, how many of the jobs the app names (lib/opsWatch CRON_JOBS, with the migration that made each) are missing or switched off — counted only once that migration is in the ledger — and how many of the push webhooks it names (PUSH_HOOKS) are not there or are off. The app''s server alone (/api/health); counts and a time, never a name, a command or a definition.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The watcher is watched', 'fix', 'System',
   'The jobs the database runs on a schedule — the watchdogs, reminders and sweeps — and the hooks that carry orders and alerts to phones are checked from outside it every half hour: if the scheduler stopped, its watcher failed, a job went missing or a push hook was switched off, the production check fails and says so.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.ops_alive(text[], text[], text[])', 'execute');                  -- false
--   select has_function_privilege('service_role', 'public.ops_alive(text[], text[], text[])', 'execute');          -- true
--   select (public.ops_alive('{}', '{}', '{}') ->> 'active')::int > 0;                                              -- true
select public.record_migration('0430_the_watcher_is_watched_and_the_push_hooks_counted');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0431_the_day_is_the_businesss_and_money_is_never_below_zero.sql
-- ============================================================
-- ── 0431 — THE DAY IS THE BUSINESS'S, AND MONEY IS NEVER BELOW ZERO ──────────────────────────────────────────────────
-- 2026-10-18. R26 of the 10/10 audit (database F4's last and F2's last; Ryan, 2026-10-17: "Keep working to improve to a
-- 10"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. (1) 0348 named the business day — Eastern time, public.business_day() — and 0420 and 0423 moved the money's reports
-- onto it. Eight columns' defaults, five functions and three views still read current_date, the database's day (UTC),
-- which is already tomorrow from 8pm Eastern in summer, 7pm in winter. A delivery shelved at nine at night was received
-- tomorrow; an agreement ended at nine ended tomorrow; a city could be switched live the evening before its opening day;
-- an evening's check-in, meeting notes, expense or maintenance run was dated tomorrow; tonight's events stopped counting
-- as upcoming; an expense's age and a check's freshness were a day off every evening.
-- (2) A total, a fee, a tax or an amount the money stands on could be written below zero, and nothing in the database
-- said no — tips, refunds, credit spends and a pack's price had their checks; the cup orders', the packs', the
-- deliveries', the shop's, the office's, the invoices' and the event takings' totals did not.
--
-- WHAT. (1) Each of the five functions and three views is made again from its own definition as this database holds it
-- (pg_get_functiondef, pg_get_viewdef — a view's options, its grants and its comment kept), with current_date read as
-- public.business_day() and nothing else changed; one that no longer reads current_date is left as it is. The eight
-- defaults are the business day. (2) Each of seventeen money columns gets a check that it is never below zero — added,
-- then proven against every row it has. A column that already holds a row below zero gets no check (one its own rows
-- break would refuse every later write to them): it is named in the crew's inbox instead, to put right, and the next
-- paste adds it.
--
-- set lock_timeout (database F16): a check is added NOT VALID (a moment's lock) and then validated (reads and writes go
-- on while it reads the rows); a function or a view made again holds its own lock for a moment only.
-- existing rows: none — the defaults date new rows only (which evening a row was written cannot be told now), and every
--   check is proven against the rows already there before it stands.
-- changelog: below.

set lock_timeout = '5s';

-- ── 1) the business day ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare r record; n integer := 0;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('map_ingredient', 'progress_kpis', 'receive_lot', 'set_market_live', 'supersede_agreement')
       and pg_get_functiondef(p.oid) ~* '\mcurrent_date\M'
  loop
    execute regexp_replace(pg_get_functiondef(r.oid), '\mcurrent_date\M', 'public.business_day()', 'gi');
    n := n + 1;
  end loop;
  raise notice '0431: % function(s) read the business day', n;
end $$;

do $$
declare r record; n integer := 0;
begin
  for r in
    select c.oid, c.relname, c.reloptions from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relkind = 'v'
       and c.relname in ('v_compliance_freshness', 'v_crew_person', 'v_receipt_gaps')
       and pg_get_viewdef(c.oid) ~* '\mcurrent_date\M'
  loop
    -- A view made again without its options loses them (security_invoker among them): they are given back by name.
    execute format('create or replace view public.%I%s as %s', r.relname,
      case when r.reloptions is null then '' else ' with (' || array_to_string(r.reloptions, ', ') || ')' end,
      regexp_replace(rtrim(btrim(pg_get_viewdef(r.oid)), ';'), '\mcurrent_date\M', 'public.business_day()', 'gi'));
    n := n + 1;
  end loop;
  raise notice '0431: % view(s) read the business day', n;
end $$;

alter table public.agreement_hours   alter column on_date      set default public.business_day();
alter table public.asset_maintenance alter column performed_on set default public.business_day();
alter table public.changelog         alter column shipped_on   set default public.business_day();
alter table public.check_ins         alter column day          set default public.business_day();
alter table public.expenses          alter column spent_on     set default public.business_day();
alter table public.inventory_lots    alter column received_on  set default public.business_day();
alter table public.maintenance_log   alter column ran_on       set default public.business_day();
alter table public.meeting_notes     alter column met_on       set default public.business_day();

-- ── 2) money is never below zero ────────────────────────────────────────────────────────────────────────────────────
do $$
declare c record; bad bigint; n integer := 0; held text := '';
begin
  for c in
    select * from (values
      ('orders', 'total_cents'), ('drop_orders', 'total_cents'),
      ('delivery_orders', 'bottle_subtotal_cents'), ('delivery_orders', 'delivery_fee_cents'), ('delivery_orders', 'tax_cents'), ('delivery_orders', 'total_cents'),
      ('shop_orders', 'subtotal_cents'), ('shop_orders', 'total_cents'), ('shop_order_items', 'unit_cents'), ('shop_order_items', 'cost_cents'),
      ('invoices', 'amount_cents'),
      ('business_orders', 'price_per_gallon_cents'), ('business_orders', 'subtotal_cents'), ('business_orders', 'delivery_fee_cents'),
      ('business_orders', 'tax_cents'), ('business_orders', 'total_cents'),
      ('event_sales', 'amount_cents')) as v(tbl, col)
  loop
    continue when exists (select 1 from pg_constraint k where k.conrelid = format('public.%I', c.tbl)::regclass
                                                       and k.conname = c.tbl || '_' || c.col || '_not_negative');
    execute format('select count(*) from public.%I where %I < 0', c.tbl, c.col) into bad;
    if bad = 0 then
      begin
        execute format('alter table public.%I add constraint %I check (%I >= 0) not valid', c.tbl, c.tbl || '_' || c.col || '_not_negative', c.col);
        execute format('alter table public.%I validate constraint %I', c.tbl, c.tbl || '_' || c.col || '_not_negative');
        n := n + 1;
      exception when check_violation then
        -- A row below zero written between the count and the proof: the check goes with this block, the column is named.
        execute format('select count(*) from public.%I where %I < 0', c.tbl, c.col) into bad;
      end;
    end if;
    if bad > 0 then held := held || c.tbl || '.' || c.col || ' (' || bad || case when bad = 1 then ' row' else ' rows' end || '); '; end if;
  end loop;
  if held <> '' then
    perform public.alert_open_once('money_below_zero', md5('0431:money-below-zero')::uuid, 'important', 'money',
      'Money below zero in the records — its check waits',
      'These hold an amount below zero, so the check that refuses one does not stand on them yet: ' || held
        || 'Put each right, then paste 0431 again — it adds the checks that are missing.',
      '/crew?s=money&a=pay');
  end if;
  raise notice '0431: % money check(s) stand; waiting: %', n, coalesce(nullif(held, ''), 'none');
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The day is the business''s', 'fix', 'System',
   'Everything dated as it happens — a delivery shelved, a check-in, an expense, an agreement ended, a city switched live — is dated on Eastern time, not the database''s clock, which turns to tomorrow at 8pm. And no total, fee, tax or amount can be recorded below zero.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
--     and p.proname in ('map_ingredient','progress_kpis','receive_lot','set_market_live','supersede_agreement')
--     and pg_get_functiondef(p.oid) ~* '\mcurrent_date\M';                                                     -- 0
--   select count(*) from pg_class where relname in ('v_compliance_freshness','v_crew_person','v_receipt_gaps')
--     and pg_get_viewdef(oid) ~* '\mcurrent_date\M';                                                            -- 0
--   select count(*) from information_schema.columns where table_schema = 'public' and column_default ~* 'current_date'; -- 0
--   select count(*) from pg_constraint where conname like '%\_not\_negative' and convalidated;                  -- 17
select public.record_migration('0431_the_day_is_the_businesss_and_money_is_never_below_zero');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0432_a_covered_settle_is_a_free_cup_a_credit_or_an_owners_reason.sql
-- ============================================================
-- ── 0432 — A COVERED SETTLE IS A FREE CUP, A CREDIT, OR AN OWNER'S REASON ──────────────────────────────────────────────
-- 2026-10-18. R27 of the 10/10 audit (database F17; Ryan, 2026-10-18: "Owner/admin, with a reason"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. An order settled at the window as covered — paid with a free cup or the member's credit (0416) — takes no money,
-- and nothing recorded why: any crew member's tap made any order free, and the books said only "covered". A free cup
-- given (redeem_free_cup, 0387) and credit used (spend_credit, 0389) each write a row of their own, signed by whoever
-- gave it; the settle never asked for one.
--
-- WHAT.
--   · covered_settles: one row for each order settled as covered — the free cup or the credit that covered it, or an
--     owner's or admin's reason for putting it on the house — with who settled it and when. Written by
--     staff_collect_payment only, taken back with the settle by staff_undo_collection; the crew read it, nobody writes it.
--   · staff_collect_payment(kind, id, via, reason): covered, by anyone on the crew, takes a free cup redeemed for the
--     order's member today (the business day, Eastern) or credit they used today, that covers no other order — the
--     earliest, a free cup first, kept on the row. With nothing taken off, an owner or admin may put it on the house with
--     a reason (three characters or more, kept to 200), which is the record; anyone else is told to take it off on the
--     scan screen first. Your own order is still another crew member's to settle as covered (0420). Cash and the card
--     reader are as they were; a reason sent with them is not kept.
--   · staff_undo_collection (0341's): a covered settle taken back lets its free cup or credit cover an order again.
--
-- ORDER. Paste it right after the deploy that carries "On the house" (components/CollectSheet). Before this paste that
-- button is refused — its reason is an argument the database doesn't know yet (PGRST202); between this paste and that
-- deploy, an owner's covered settle with nothing taken off is asked for a reason the old screen can't give, and "Hand it
-- over unpaid" is the way through for those minutes. Every other settle works on either side.
--
-- set lock_timeout (database F16): a new table and its indexes; each function is made again under a moment's lock.
-- existing rows: none — an order settled as covered before this has no row here, and is left as it was.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.covered_settles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  order_kind  text not null check (order_kind in ('cup', 'pickup')),
  order_id    uuid not null,
  how         text not null check (how in ('free_cup', 'credit', 'on_the_house')),
  free_cup    uuid,   -- the loyalty_ledger row of the free cup that covered it (0387) — no key: an erased member's goes
  credit      uuid,   -- the credit_spends row of the credit that covered it (0389)
  reason      text,   -- an owner's or admin's, when nothing was taken off: why, not who
  by_user     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint covered_settles_says_what check (
       (how = 'free_cup'     and free_cup is not null and credit is null and reason is null)
    or (how = 'credit'       and credit is not null and free_cup is null and reason is null)
    or (how = 'on_the_house' and free_cup is null and credit is null and length(btrim(coalesce(reason, ''))) between 3 and 200))
);
-- One cover for an order, and a free cup or a credit covers one order.
create unique index if not exists covered_settles_one_per_order on public.covered_settles (order_kind, order_id);
create unique index if not exists covered_settles_free_cup_once on public.covered_settles (free_cup) where free_cup is not null;
create unique index if not exists covered_settles_credit_once on public.covered_settles (credit) where credit is not null;
create index if not exists covered_settles_by_user on public.covered_settles (by_user);
comment on table public.covered_settles is
  'Why an order settled at the window as covered took no money (0432): the free cup (loyalty_ledger, 0387) or the credit (credit_spends, 0389) that covered it, or an owner''s or admin''s reason for putting it on the house — who settled it, and when. Written only by staff_collect_payment; removed with the settle by staff_undo_collection.';

alter table public.covered_settles enable row level security;
drop trigger if exists stamp_tenant_tg on public.covered_settles;
create trigger stamp_tenant_tg before insert on public.covered_settles for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.covered_settles;
create policy "tenant isolation" on public.covered_settles as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
drop policy if exists "covered settles crew read" on public.covered_settles;
create policy "covered settles crew read" on public.covered_settles for select using ((select public.is_staff()));
revoke all on public.covered_settles from public, anon;
revoke insert, update, delete, truncate on public.covered_settles from authenticated;
grant select on public.covered_settles to authenticated;

-- ── the settle: covered takes what covered it ───────────────────────────────────────────────────────────────────────
-- 0420's, with a reason and the cover. The three-argument door goes: a call that names three still lands here (the
-- reason defaults to none), and two doors of one name would be one too many for PostgREST to choose between.
drop function if exists public.staff_collect_payment(text, uuid, text);
create or replace function public.staff_collect_payment(p_kind text, p_id uuid, p_via text, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_paid boolean; v_at timestamptz; v_gone boolean; v_owner uuid; v_tenant uuid;
        v_cup uuid; v_credit uuid; v_reason text; v_since timestamptz;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_via is null or p_via not in ('cash', 'card_reader', 'covered') then
    raise exception 'say how it was paid: cash, card_reader or covered';
  end if;

  -- Cash sets paid (the till is counted nowhere else); the reader does not (Square counts it, 0341); covered — a free
  -- cup or the member's credit (0416), or an owner's reason (0432) — does not either: it is owed nothing, and it is no
  -- money anywhere.
  if p_kind = 'cup' then
    select paid, collected_at, status = 'void', user_id, tenant_id into v_paid, v_at, v_gone, v_owner, v_tenant
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that order does not exist'; end if;
    if v_gone then raise exception 'that order was voided — nothing to collect'; end if;
  elsif p_kind = 'pickup' then
    select paid, collected_at, canceled_at is not null, user_id, tenant_id into v_paid, v_at, v_gone, v_owner, v_tenant
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that pack does not exist'; end if;
    if v_gone then raise exception 'that pack was canceled — nothing to collect'; end if;
  else
    raise exception 'unknown kind: %', coalesce(p_kind, 'null');
  end if;
  if v_paid or v_at is not null then return 'already settled'; end if;

  if p_via = 'covered' then
    -- 0420: a free cup or credit for your own order is another crew member's to give (0392's rule for a card).
    if v_owner is not null and v_owner = auth.uid() then
      raise exception 'your own %: another crew member settles it as covered', case when p_kind = 'cup' then 'order' else 'pack' end
        using errcode = '42501';
    end if;
    -- A cover left from a settle taken back some other way is not this one's (the order is held: nobody else is here).
    delete from public.covered_settles where order_kind = p_kind and order_id = p_id;
    -- 0432: what covered it — a free cup redeemed for their member today, or credit they used today, covering no other
    -- order. Held while this settles, so two phones settling two of their orders take two, not one twice.
    if v_owner is not null then
      v_since := (public.business_day()::timestamp at time zone 'America/New_York');
      select l.id into v_cup from public.loyalty_ledger l
       where l.user_id = v_owner and l.kind = 'redeem' and l.created_at >= v_since
         and not exists (select 1 from public.covered_settles s where s.free_cup = l.id)
       order by l.created_at, l.id
       limit 1
       for update of l skip locked;
      if v_cup is null then
        select c.id into v_credit from public.credit_spends c
         where c.user_id = v_owner and c.created_at >= v_since
           and not exists (select 1 from public.covered_settles s where s.credit = c.id)
         order by c.created_at, c.id
         limit 1
         for update of c skip locked;
      end if;
    end if;
    -- Nothing taken off: on the house — an owner's or admin's to say, with why.
    if v_cup is null and v_credit is null then
      if not public.is_admin() then
        raise exception 'Nothing was taken off for them today — redeem their free cup or use their credit on the scan screen first. An owner or admin can put it on the house, with a reason.'
          using errcode = '42501';
      end if;
      v_reason := left(btrim(coalesce(p_reason, '')), 200);
      if length(v_reason) < 3 then
        raise exception 'Say why it''s on the house — the reason is the record.' using errcode = '22023';
      end if;
    end if;
  end if;

  if p_kind = 'cup' then
    update public.orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
  else
    update public.drop_orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
  end if;
  if p_via = 'covered' then
    insert into public.covered_settles (tenant_id, order_kind, order_id, how, free_cup, credit, reason, by_user)
    values (v_tenant, p_kind, p_id,
            case when v_cup is not null then 'free_cup' when v_credit is not null then 'credit' else 'on_the_house' end,
            v_cup, v_credit, case when v_cup is null and v_credit is null then v_reason end, auth.uid());
  end if;
  return 'collected';
end $$;
revoke all on function public.staff_collect_payment(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.staff_collect_payment(text, uuid, text, text) to authenticated;
comment on function public.staff_collect_payment(text, uuid, text, text) is
  'The window''s settle (0341; 0416, 0420, 0432): cash, the card reader, or covered — staff only, tenant-scoped, the order locked. Covered is never your own order, and takes what covered it: a free cup redeemed or credit used for the order''s member today that covers no other order, or — nothing taken off — an owner''s or admin''s reason. Each is written to covered_settles.';

-- ── the undo: the cover goes with the settle ────────────────────────────────────────────────────────────────────────
-- 0341's, with one more line: a covered settle taken back lets its free cup or credit cover an order again.
create or replace function public.staff_undo_collection(p_kind text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_via text; v_at timestamptz; v_by uuid;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_kind = 'cup' then
    select collected_via, collected_at, collected_by into v_via, v_at, v_by
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
  elsif p_kind = 'pickup' then
    select collected_via, collected_at, collected_by into v_via, v_at, v_by
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
  else
    raise exception 'unknown kind: %', coalesce(p_kind, 'null');
  end if;
  if not found then raise exception 'that order does not exist'; end if;
  if v_at is null then return 'nothing to undo'; end if;
  if not (public.is_admin() or (v_by = auth.uid() and v_at > now() - interval '1 hour')) then
    raise exception 'only the person who took it can undo it, within the hour — or an admin';
  end if;

  if p_kind = 'cup' then
    update public.orders
       set paid = case when v_via = 'cash' then false else paid end,
           collected_via = null, collected_at = null, collected_by = null
     where id = p_id;
  else
    update public.drop_orders
       set paid = case when v_via = 'cash' then false else paid end,
           collected_via = null, collected_at = null, collected_by = null
     where id = p_id;
  end if;
  delete from public.covered_settles where order_kind = p_kind and order_id = p_id;   -- 0432
  return 'undone';
end $$;
revoke all on function public.staff_undo_collection(text, uuid) from public, anon, authenticated;
grant execute on function public.staff_undo_collection(text, uuid) to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A covered order says what covered it', 'fix', 'Money',
   'Settling an order at the window as a free cup or credit now takes the free cup redeemed or the credit used for that member today, and keeps which one it was. With nothing taken off, only an owner or admin can put an order on the house, and they say why — the reason is kept with it.',
   '2026-10-18', false),
  -- The same release's two changes outside the database (R27): said here, where the changelog is written.
  ('Deleting your account asks for a code', 'fix', 'Account',
   'Delete my account emails you an 8-digit code first, and deletes the account when you enter it — or, if you sign in with Apple, Face ID on your iPhone does. A phone left unlocked, or lent for a minute, can''t delete its owner''s account.',
   '2026-10-18', false),
  ('Alerts outside the app say only what kind and which order', 'fix', 'System',
   'Teams cards and alert emails say what kind of thing happened, the order''s number and the link — never a customer''s name, email, phone or address, or what anyone typed. A booking lead''s email says the day and the headcount; who it is stays in the app.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_proc where proname = 'staff_collect_payment';                                        -- 1
--   select pg_get_function_identity_arguments('public.staff_collect_payment(text,uuid,text,text)'::regprocedure)
--     = 'p_kind text, p_id uuid, p_via text, p_reason text';                                                     -- t
--   select relrowsecurity from pg_class where oid = 'public.covered_settles'::regclass;                          -- t
--   select has_table_privilege('authenticated', 'public.covered_settles', 'insert');                             -- f
--   select prosrc like '%covered_settles%' from pg_proc where proname = 'staff_undo_collection';                 -- t
select public.record_migration('0432_a_covered_settle_is_a_free_cup_a_credit_or_an_owners_reason');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0433_two_step_for_the_owners_and_admins.sql
-- ============================================================
-- ── 0433 — TWO-STEP FOR THE OWNERS AND ADMINS ──────────────────────────────────────────────────────────────────────────
-- 2026-10-18. R28 of the 10/10 audit (security F6; Ryan, 2026-10-18: "Yes, owner/admin"). Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing.
--
-- WHY. An owner's or an admin's password, or a code read off their email, is everything: refunds, the books, every
-- customer, the crew's roles and offer letters. Supabase has a second step built in — an authenticator app's six-digit
-- code (TOTP; Authentication → Multi-Factor says it is on for this project) — and nothing in the app asked for it, or
-- held an owner's or admin's powers to it.
--
-- WHAT.
--   · two_step_ok(): the caller has given the second step on this sign-in (the token's aal is aal2) — or has no
--     authenticator set up and nobody requires one. One question, asked by the two gates below.
--   · is_admin() and is_owner() — 0035's and 0023's, the gates every owner and admin power asks (171 places: policies,
--     functions, and the app's server through lib/apiAuth) — answer yes only with two_step_ok() as well. An owner or
--     admin who set up an authenticator is an owner or admin on a sign-in that gave its code, and crew (is_staff) on one
--     that didn't, until they give it. Nothing changes for anyone who hasn't set one up.
--   · two_step_settings: whether this business requires the second step of every owner and admin. Off until an owner
--     turns it on — require_two_step(true) — which only an owner who has set up an authenticator and given its code on
--     this sign-in may do, so turning it on can't lock its owner out. On, an owner or admin without an authenticator is
--     crew until they set one up (setting one up asks for no owner's power). Off again: an owner, on a sign-in with its
--     code.
--   · two_step_state(): what the app needs to ask — whether the caller is an owner or admin, has an authenticator,
--     gave its code on this sign-in, whether the business requires it — for the caller alone; no secret, no factor's id.
--
-- NO LOCKOUT. Before anyone sets up an authenticator nothing changes. An owner who loses theirs: Supabase → Authentication
-- → Users → the owner → remove the factor (the dashboard needs no app); they are an owner again on their next sign-in, and
-- set a new one up.
--
-- ORDER. Paste it right after the deploy that carries Settings & privacy → Two-step sign-in and the code prompt
-- (components/TwoStep*): before that deploy nobody can set an authenticator up from the app, and before this paste one set
-- up from it asks for its code and holds no power to it yet.
-- set lock_timeout (database F16): two functions made again, a small table, two more functions — a moment's lock each.
-- existing rows: none.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.two_step_settings (
  tenant_id   uuid primary key references public.tenants(id),
  required    boolean not null default false,
  set_by      uuid references auth.users(id) on delete set null,
  set_at      timestamptz not null default now()
);
create index if not exists two_step_settings_set_by on public.two_step_settings (set_by);
comment on table public.two_step_settings is
  'Whether a business requires the second step (an authenticator''s code) of every owner and admin (0433). Read by two_step_ok(); written only by require_two_step().';
alter table public.two_step_settings enable row level security;
drop policy if exists "tenant isolation" on public.two_step_settings;
create policy "tenant isolation" on public.two_step_settings as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke all on public.two_step_settings from public, anon, authenticated;

-- ── the one question ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.two_step_ok() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or (not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
          and not coalesce((select s.required from public.two_step_settings s
                             where s.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))), false))
$$;
revoke all on function public.two_step_ok() from public, anon, authenticated;
grant execute on function public.two_step_ok() to authenticated, service_role;
comment on function public.two_step_ok() is
  'Whether the caller has given the second step on this sign-in (aal2) — or has no authenticator set up and their business does not require one (0433). is_admin() and is_owner() ask it.';

-- ── the two gates, each 0035's and 0023's but the question ─────────────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role in ('admin','owner') or is_admin = true)
  ) and public.two_step_ok();
$$;

create or replace function public.is_owner()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) and public.two_step_ok();
$$;

-- ── what the app asks ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.two_step_state() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'leader',   coalesce((select p.role in ('owner', 'admin') or coalesce(p.is_admin, false) from public.profiles p where p.id = (select auth.uid())), false),
    'owner',    coalesce((select p.role = 'owner' from public.profiles p where p.id = (select auth.uid())), false),
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified'),
    'given',    coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2',
    'required', coalesce((select s.required from public.two_step_settings s
                           where s.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))), false),
    'ok',       public.two_step_ok())
$$;
revoke all on function public.two_step_state() from public, anon, authenticated;
grant execute on function public.two_step_state() to authenticated;
comment on function public.two_step_state() is
  'The second step, for the caller alone (0433): owner or admin, an authenticator set up, its code given on this sign-in, required by their business, and whether their owner and admin powers stand. No secret and no factor''s id.';

create or replace function public.require_two_step(p_on boolean) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if p_on is null then raise exception 'Say on or off.' using errcode = '22023'; end if;
  -- An owner, on a sign-in that gave its code, with an authenticator of their own: so the owner turning it on has one,
  -- and has just used it (GoTrue gives aal2 only for a code; the factor is asked too, as a second word for it).
  if not public.is_owner() or coalesce((select auth.jwt() ->> 'aal'), 'aal1') <> 'aal2'
     or not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified') then
    raise exception 'Only an owner, signed in with their authenticator''s code, sets this.' using errcode = '42501';
  end if;
  select p.tenant_id into v_tenant from public.profiles p where p.id = (select auth.uid());
  insert into public.two_step_settings (tenant_id, required, set_by, set_at)
  values (v_tenant, p_on, (select auth.uid()), now())
  on conflict (tenant_id) do update set required = excluded.required, set_by = excluded.set_by, set_at = excluded.set_at;
  return jsonb_build_object('ok', true, 'required', p_on);
end $$;
revoke all on function public.require_two_step(boolean) from public, anon, authenticated;
grant execute on function public.require_two_step(boolean) to authenticated;
comment on function public.require_two_step(boolean) is
  'Require the second step of every owner and admin of the caller''s business, or stop requiring it (0433): an owner, on a sign-in that gave their authenticator''s code, only.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Two-step sign-in for owners and admins', 'security', 'Account',
   'Owners and admins can add an authenticator app in Settings & privacy. Once it''s on, the money, the books, customers and the crew''s roles ask for its six-digit code once each sign-in — a password or an emailed code alone isn''t enough. An owner can require it of every owner and admin.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select prosrc like '%two_step_ok%' from pg_proc where proname in ('is_admin', 'is_owner');                  -- t, t
--   select has_function_privilege('anon', 'public.two_step_state()', 'execute');                                 -- f
--   select relrowsecurity from pg_class where oid = 'public.two_step_settings'::regclass;                        -- t
--   select count(*) from public.two_step_settings where required;                                                -- 0
select public.record_migration('0433_two_step_for_the_owners_and_admins');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0434_a_door_stays_open_while_a_script_knocks.sql
-- ============================================================
-- ── 0434 — A DOOR STAYS OPEN FOR THE CUSTOMER WHILE A SCRIPT KNOCKS ────────────────────────────────────────────────────
-- 2026-10-18. R29 of the 10/10 audit (API F1; Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. Every public door that rings the crew or reaches Square has a ceiling for everyone together, and a handful of
-- addresses could spend it for everybody: two addresses' booking requests silenced every catering lead for the hour
-- (book:global, thirty an hour), ten kept card checkout shut (checkout:global, sixty a minute), and the other card doors
-- the same way (card:all, a hundred and twenty a minute) — every real customer refused for a script's sake.
--
-- WHAT.
--   · rate_limit_peek(): whether a bucket is under its cap in this window — asked, never counted (rate_limit_hit counts
--     every ask). The server's alone. So a ceiling can be asked of what already happened — cards Square refused, a
--     minute's twenty and card payments pause for the rest of it — instead of every try a script can make.
--   · booking_requests.quiet: a lead kept past the hour's thirty, and not announced one by one (the push function skips
--     it; the crew are told once that a burst came, and where it is). Nobody asking is turned away.
--
-- set lock_timeout (database F16): one function, one column — its default a constant, so no rewrite; a moment's lock.
-- existing rows: every lead so far is not quiet (the default).
-- changelog: below.

set lock_timeout = '5s';

-- ── asked, not counted ──────────────────────────────────────────────────────────────────────────────────────────────
-- The window is rate_limit_hit's own (0419), to the millisecond: the same bucket, the same window, the same count. True
-- is UNDER the cap — the next rate_limit_hit would be let through — as rate_limit_hit answers.
create or replace function public.rate_limit_peek(p_bucket text, p_window_ms int, p_max int)
returns boolean language sql stable security definer set search_path = public as $$
  select p_max is not null and p_max >= 1 and p_window_ms is not null and p_window_ms >= 1
     and coalesce((select h.count from public.rate_limit_hits h
                    where h.bucket = p_bucket
                      and h.window_start = to_timestamp(floor(extract(epoch from now()) * 1000 / p_window_ms) * p_window_ms / 1000.0)), 0) < p_max
$$;
revoke all on function public.rate_limit_peek(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_peek(text, int, int) to service_role;
comment on function public.rate_limit_peek(text, int, int) is
  'Whether a rate_limit_hit bucket is under its cap in the current window, without counting (0434). The server''s alone: the card doors ask it of the minute''s refused cards before Square is asked.';

-- ── a lead past the hour's thirty: kept, not announced ──────────────────────────────────────────────────────────────
alter table public.booking_requests add column if not exists quiet boolean not null default false;
comment on column public.booking_requests.quiet is
  'Kept past the hour''s ceiling for everyone together (0434, /api/book): the push function announces it to nobody, and the crew are told once an hour that a burst came. Nobody asking is turned away.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A script can''t close the doors on customers', 'security', 'Checkout',
   'A burst of booking requests no longer turns real ones away — every request is kept, and past thirty an hour the crew hear once that a burst came. Card payments pause for a minute only after twenty cards are refused in one, instead of after a number of tries anyone could make, and the crew are told.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.rate_limit_peek(text, integer, integer)', 'execute');          -- f
--   select has_function_privilege('service_role', 'public.rate_limit_peek(text, integer, integer)', 'execute');  -- t
--   select count(*) from information_schema.columns where table_name = 'booking_requests' and column_name = 'quiet'; -- 1
select public.record_migration('0434_a_door_stays_open_while_a_script_knocks');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0435_every_row_that_points_at_another_is_found_by_an_index.sql
-- ============================================================
-- ── 0435 — EVERY ROW THAT POINTS AT ANOTHER IS FOUND BY AN INDEX ────────────────────────────────────────────────────
-- 2026-10-18. R30 of the 10/10 audit (database F19; Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A foreign key is checked from both ends. A row added looks up what it points at, and the primary key's index
-- answers that. A row deleted — an account erased, an event, a stop or a customer removed — asks every table that may
-- point at it, and where the pointing column has no index of its own, the answer is that whole table read, once for
-- each row deleted. 0419 and 0421 indexed five; about a hundred and fifty were left: erasing one account read sixty-two
-- tables from top to bottom (seventy-eight keys point at auth.users with no index of their own), and the console's
-- "collected by", "voided by" and "for this event" lookups read the same way.
--
-- WHAT. One pass over the catalog as it is in this database — an index made in the dashboard counts — and every
-- foreign key in public whose columns don't lead an index gets one. A column that may be empty gets a partial index,
-- `where <col> is not null`: it still serves the check (an empty column points at nothing) and leaves the empty rows
-- out. An index that already leads with the key's columns counts, whole or `where <col> is not null`; one kept to some
-- of the rows (`where not done`) doesn't, because the check asks of every row.
--   · not the tenant keys (tenant_id → tenants, 83 of them): with one tenant the column has one value, an index on it
--     alone is never chosen, and no tenant is ever deleted. When there are two, the tenant goes first in the indexes a
--     tenant's reads use, (tenant_id, …), not in one of its own.
-- From here a foreign key written in a migration comes with its index: scripts/db.r30.test.mjs reads every migration
-- into a database and fails the release on a key without one.
--
-- set lock_timeout (database F16): each index holds its table's share lock while it is built — reads go on, writes wait
-- the moment it takes on tables this size. If a table is busy the paste stops after five seconds and changes nothing;
-- run it again a moment later.
-- existing rows: indexed as they stand.
-- changelog: none — nothing anyone sees changes; a delete and the console's lookups stop reading whole tables.

set lock_timeout = '5s';

do $$
declare
  r record;
  base text;
  idx text;
  n int;
  made int := 0;
  seen text[] := '{}';   -- two keys on the same columns (a constraint written twice) want one index
  k text;
begin
  for r in
    select t.relname,
           array_agg(a.attname::text order by k.i) as cols,
           bool_or(not a.attnotnull) as may_be_empty
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace s on s.oid = t.relnamespace and s.nspname = 'public'
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, i)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and c.confrelid <> 'public.tenants'::regclass
       and not exists (
         select 1 from pg_index x
          where x.indrelid = c.conrelid
            and x.indisvalid
            and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
            and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
            and (x.indpred is null
                 or (cardinality(c.conkey) = 1
                     and pg_get_expr(x.indpred, x.indrelid) =
                         format('(%s IS NOT NULL)', (select quote_ident(b.attname) from pg_attribute b
                                                      where b.attrelid = c.conrelid and b.attnum = c.conkey[1])))))
     group by c.oid, t.relname
     order by t.relname, min(c.conname)
  loop
    k := r.relname || ':' || (select string_agg(x, ',' order by x) from unnest(r.cols) as x);
    continue when k = any(seen);
    seen := seen || k;
    base := left(r.relname || '_' || array_to_string(r.cols, '_'), 56);
    idx := base || '_fk_idx';
    n := 2;
    while exists (select 1 from pg_class where relname = idx and relnamespace = 'public'::regnamespace) loop
      idx := left(base, 52) || '_fk' || n || '_idx';
      n := n + 1;
    end loop;
    execute format('create index %I on public.%I (%s)%s', idx, r.relname,
                   (select string_agg(quote_ident(x), ', ') from unnest(r.cols) as x),
                   case when r.may_be_empty and cardinality(r.cols) = 1 then format(' where %I is not null', r.cols[1]) else '' end);
    made := made + 1;
  end loop;
  raise notice '0435: % foreign keys indexed', made;
end $$;

-- verify (numbers only — the foreign keys outside the tenant keys that no index leads; 0 after this paste):
--   select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
--    where c.contype = 'f' and t.relnamespace = 'public'::regnamespace and c.confrelid <> 'public.tenants'::regclass
--      and not exists (select 1 from pg_index x where x.indrelid = c.conrelid and x.indisvalid
--            and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
--            and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
--            and (x.indpred is null or (cardinality(c.conkey) = 1 and pg_get_expr(x.indpred, x.indrelid) =
--                 format('(%s IS NOT NULL)', (select quote_ident(b.attname) from pg_attribute b
--                                              where b.attrelid = c.conrelid and b.attnum = c.conkey[1])))));   -- 0
select public.record_migration('0435_every_row_that_points_at_another_is_found_by_an_index');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0436_one_address_cant_spend_the_guest_door_for_everyone.sql
-- ============================================================
-- ── 0436 — ONE ADDRESS CAN'T SPEND THE GUEST DOOR FOR EVERYONE ─────────────────────────────────────────────────────
-- 2026-10-18. R30 of the 10/10 audit (database F14's last half; Ryan, 2026-10-17: "Keep working to improve to a 10").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A phone or a browser kept for alerts with nobody signed in on it (keep_app_push_token, keep_push_device) is
-- counted — three hundred new ones an hour, for everyone together (0418, 0419) — so made-up devices can't pile up. But
-- one script could make the three hundred itself, and every real guest's new phone or browser was refused for the rest
-- of the hour: "Too many devices just now". 0428 left this half open until it was known which header carries the
-- caller's address through Supabase's gateway untouched.
--
-- WHAT. caller_address(): the caller's address as Cloudflare, in front of Supabase's API, gives it — cf-connecting-ip,
-- which Cloudflare sets on every request and replaces when a caller sends one of their own (Supabase's own guide reads
-- the caller's address from it, to let one address alone ask for query plans). An IPv4 address is itself; an IPv6 one
-- is its /64, the block one home or one phone is given, so a caller can't walk through addresses of their own. Not
-- there, or not an address: null, and the door is as it was.
-- Both doors ask the caller's own count first — thirty new devices an hour from one address, more than a household or
-- a phone ever makes — and only a device let through there is counted against everyone's three hundred, so a script
-- stopped at its own thirty spends nothing of anyone else's (0419's order: a try over a cap is not counted). One
-- address can take a tenth of the hour now, not all of it. A member's own device is not counted, as before.
--
-- set lock_timeout (database F16): three functions replaced; no table touched — a moment's lock on the catalog.
-- existing rows: none changes.
-- changelog: below.

set lock_timeout = '5s';

-- ── where the caller is ─────────────────────────────────────────────────────────────────────────────────────────────
-- Read by the two doors below (definer functions, so callers need no grant of their own); nobody calls it directly.
create or replace function public.caller_address() returns text
  language plpgsql stable set search_path = public as $$
declare v_headers json; v_raw text; v_ip inet;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  v_raw := nullif(btrim(v_headers ->> 'cf-connecting-ip'), '');
  if v_raw is null or v_raw !~ '^[0-9A-Fa-f:.]{2,45}$' then return null; end if;
  begin
    v_ip := v_raw::inet;
  exception when others then
    return null;
  end;
  if family(v_ip) = 6 then
    return host(network(set_masklen(v_ip, 64))) || '/64';
  end if;
  return host(v_ip);
end $$;
revoke all on function public.caller_address() from public, anon, authenticated;
comment on function public.caller_address() is
  'The caller''s address from cf-connecting-ip (Cloudflare''s, in front of Supabase''s API): an IPv4 address whole, an IPv6 one as its /64; null when there is none (0436). Read by the guest push doors to count one address apart.';

-- ── the guest door's count: the caller's own first, then everyone's ─────────────────────────────────────────────────
-- True when a new device nobody is signed in on may be kept: under thirty an hour from this address (when there is
-- one), and then under three hundred an hour for everyone. Asked in that order, one after the other — a device the
-- address's own count refuses is never counted against everyone's.
create or replace function public.guest_device_fits() returns boolean
  language plpgsql volatile set search_path = public as $$
declare v_from text := public.caller_address();
begin
  if v_from is not null then
    if not public.rate_limit_hit('push:new-guest:' || v_from, 3600000, 30) then
      return false;
    end if;
  end if;
  return public.rate_limit_hit('push:new-guest', 3600000, 300);
end $$;
revoke all on function public.guest_device_fits() from public, anon, authenticated;
comment on function public.guest_device_fits() is
  'Whether a new push device nobody is signed in on may be kept (0436): thirty an hour from one address (caller_address), asked first, then three hundred an hour for everyone (0418). Read by keep_push_device and keep_app_push_token.';

-- ── the browser's door (0428's, line for line but the count) ─────────────────────────────────────────────────────────
create or replace function public.keep_push_device(p_endpoint text, p_p256dh text, p_auth text,
  p_crew boolean default null, p_wants_live boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if coalesce(length(p_endpoint), 0) not between 12 and 2048 or p_endpoint !~ '^https://' then
    raise exception 'That isn''t a push subscription.' using errcode = '22023';
  end if;
  -- 0418: at a browser's push service — any other address was a post the push function made to wherever it said.
  if not public.push_host_ok(p_endpoint) then
    raise exception 'That isn''t a push subscription.' using errcode = '22023';
  end if;
  if coalesce(length(p_p256dh), 0) not between 16 and 256 or coalesce(length(p_auth), 0) not between 8 and 128 then
    raise exception 'That push subscription has no keys.' using errcode = '22023';
  end if;
  -- 0418, 0436: a new device nobody is signed in on is counted — thirty an hour from one address, three hundred for
  -- everyone together. A member's is not: theirs replaces their other browsers (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint)
     and not public.guest_device_fits() then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, p256dh, auth, user_id, is_admin, wants_live, seen_at)
  values (p_endpoint, p_p256dh, p_auth, v_user, coalesce(p_crew, false), coalesce(p_wants_live, false), now())
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,          -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = case when s.user_id is distinct from excluded.user_id then coalesce(p_crew, false)
                    else coalesce(p_crew, false) or s.is_admin end,
    wants_live = coalesce(p_wants_live, s.wants_live),
    seen_at = now();                         -- 0428: kept again is seen again (a device nobody keeps is let go)
  -- One browser each: the person's other browsers go (a reinstall or a new browser mints a new endpoint, and every
  -- alert fanned out to all the stale ones). Only browsers — an endpoint that is a web address.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> p_endpoint and endpoint like 'https://%';
  end if;
end $$;
revoke all on function public.keep_push_device(text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.keep_push_device(text, text, text, boolean, boolean) to anon, authenticated;

-- ── the iPhone app's door (0428's, line for line but the count) ──────────────────────────────────────────────────────
create or replace function public.keep_app_push_token(p_token text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_endpoint text;
begin
  if coalesce(p_token, '') !~ '^[0-9A-Fa-f]{32,200}$' then
    raise exception 'That isn''t a device token.' using errcode = '22023';
  end if;
  v_endpoint := 'apns:' || lower(p_token);
  -- 0419, 0436: a new phone nobody is signed in on is counted with the web's — thirty an hour from one address, three
  -- hundred for everyone together. A member's is not: theirs replaces their other phones (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = v_endpoint)
     and not public.guest_device_fits() then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, platform, p256dh, auth, user_id, is_admin, seen_at)
  values (v_endpoint, 'apns', null, null, v_user, true, now())          -- the mark is 0365's to give: the crew's alone
  on conflict (endpoint) do update set
    platform = 'apns', p256dh = null, auth = null,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,                             -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = true,
    seen_at = now();                                            -- 0428: kept again is seen again
  -- One app install each: the person's other phones go — a reinstall or a new phone is a new token. Browsers stay.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> v_endpoint and endpoint like 'apns:%';
  end if;
end $$;
revoke all on function public.keep_app_push_token(text) from public, anon, authenticated;
grant execute on function public.keep_app_push_token(text) to anon, authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('One address can''t turn alerts off for everyone', 'security', 'Alerts',
   'Phones and browsers kept for alerts with nobody signed in are counted by where they come from as well as all together — thirty an hour from one address — so a script making up devices can no longer use up the hour for every real guest.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.caller_address()', 'execute');                                 -- f
--   select has_function_privilege('anon', 'public.guest_device_fits()', 'execute');                              -- f
--   select count(*) from pg_proc where proname in ('keep_push_device', 'keep_app_push_token')
--      and prosrc like '%guest_device_fits()%';                                                                  -- 2
select public.record_migration('0436_one_address_cant_spend_the_guest_door_for_everyone');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
