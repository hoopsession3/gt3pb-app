-- 0223 — The field_op_id spine (merge Phase 3, still EXPAND — nothing is dropped). Every table that
-- referenced events(id) or stops(id) — 21 of them, measured live — gains ONE field_op_id FK into
-- field_ops (0222), backfilled from coalesce(event_id, stop_id), and a BEFORE trigger keeps it
-- auto-filled forever: old writers keep setting event_id/stop_id and the spine fills itself, so NO
-- application code changes are required for the spine to be complete and self-maintaining.
-- (live_status.current_stop_id is deliberately left for the contract phase — it's the live pointer,
-- owned by the set_live RPC.) One-owner CHECK constraints are untouched: they still police the old
-- columns, which remain authoritative until the contract phase. ROLLBACK: drop the triggers + columns.

-- One generic sync: reads event_id/stop_id off whatever row shape fires it (to_jsonb → no per-table
-- functions), and re-derives on UPDATE of either column so a re-parented row stays true.
create or replace function public.sync_field_op_id() returns trigger
  language plpgsql as $$
declare
  j jsonb := to_jsonb(new);
  eid uuid := (j ->> 'event_id')::uuid;
  sid uuid := (j ->> 'stop_id')::uuid;
  jo jsonb;
begin
  if tg_op = 'UPDATE' then
    -- Re-derive (INCLUDING to null) only when a parent link actually changed: an unlink must CLEAR
    -- the spine (the review panel proved Studio's {event_id: null} left it stale — invisibly, since
    -- the drift check filtered on non-null parents), while a future spine-native write that touches
    -- only field_op_id must be left alone.
    jo := to_jsonb(old);
    if (jo ->> 'event_id') is distinct from (j ->> 'event_id')
       or (jo ->> 'stop_id') is distinct from (j ->> 'stop_id') then
      new.field_op_id := coalesce(eid, sid);
    end if;
  elsif eid is not null or sid is not null then
    new.field_op_id := coalesce(eid, sid);
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    -- dual-parent (event_id + stop_id)
    'brew_batch_links','brew_batches','content_items','content_links','event_approvals',
    'event_menu_items','event_schedule_items','event_staff','event_tasks','incident_log',
    'inventory_ledger','meeting_notes','orders',
    -- event-only
    'documents','event_economics','event_ops','event_sales','expenses','rsvps','todos',
    -- stop-only
    'stop_ops'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists field_op_id uuid references public.field_ops(id) on delete set null', t);
    execute format('create index if not exists %I on public.%I (field_op_id) where field_op_id is not null', t || '_field_op_idx', t);
    execute format('drop trigger if exists sync_field_op_id_tg on public.%I', t);
    execute format('create trigger sync_field_op_id_tg before insert or update on public.%I for each row execute function public.sync_field_op_id()', t);
  end loop;
end $$;

-- Backfill each table from whichever parent it has (guarded per column so event-only/stop-only work).
do $$
declare t text; has_e boolean; has_s boolean;
begin
  foreach t in array array[
    'brew_batch_links','brew_batches','content_items','content_links','event_approvals',
    'event_menu_items','event_schedule_items','event_staff','event_tasks','incident_log',
    'inventory_ledger','meeting_notes','orders','documents','event_economics','event_ops',
    'event_sales','expenses','rsvps','todos','stop_ops'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'event_id'),
           exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'stop_id')
      into has_e, has_s;
    if has_e and has_s then
      execute format('update public.%I set field_op_id = coalesce(event_id, stop_id) where field_op_id is null and (event_id is not null or stop_id is not null)', t);
    elsif has_e then
      execute format('update public.%I set field_op_id = event_id where field_op_id is null and event_id is not null', t);
    elsif has_s then
      execute format('update public.%I set field_op_id = stop_id where field_op_id is null and stop_id is not null', t);
    end if;
  end loop;
end $$;

-- verify:
--   select count(*) from information_schema.columns where table_schema='public' and column_name='field_op_id';  -- 21
--   select count(*) from public.event_tasks where event_id is not null and field_op_id is distinct from coalesce(event_id, stop_id); -- 0
--   select count(*) from public.orders where coalesce(event_id, stop_id) is not null and field_op_id is null;   -- 0
--   select count(*) from public.event_tasks where field_op_id is not null and event_id is null and stop_id is null; -- 0 (stale class)
