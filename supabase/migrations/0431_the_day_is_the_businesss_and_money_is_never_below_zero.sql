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
