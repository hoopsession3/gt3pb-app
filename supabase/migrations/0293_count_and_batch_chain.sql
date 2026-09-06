-- 0293 — A REAL COUNT, AND THE CHAIN FROM A POUND TO A BOTTLE. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Two things asked for together, and they turn out to be the same thing: you cannot start counting
-- from a number you do not believe, and you cannot keep believing a number if nothing subtracts.
--
-- WHAT THE DATABASE ACTUALLY SAYS TODAY, checked before writing this:
--   · 49 inventory items. 21 of them carry a hand-typed qty and have NEVER had a ledger movement.
--     0205 already warned that the static qty and the ledger had drifted apart; what it could not say
--     is that for most of the shelf there is no ledger at all, just a number somebody typed once.
--   · 6 ledger rows in the entire history. Three of those I wrote an hour ago for Atlanta.
--   · 5 brew batches, every one of them status 'served'. Between them they drew down ZERO pounds of
--     coffee, because nothing connects a batch to the shelf it was brewed from. Five batches were
--     made and sold and the inventory never noticed.
--
-- That last one is the real finding. The stale numbers are a symptom; the missing link is the cause.
--
-- HOW THIS ZEROES, AND WHY NOT THE OBVIOUS WAY. `update inventory_items set qty = 0` would erase what
-- the old numbers claimed with no trace, which is the exact thing every other guard in this database
-- exists to prevent. A physical count is not an erasure, it is a MOVEMENT: the shelf said 14, the
-- shelf actually holds 0, so post -14 and write down why. reset_inventory_count() does that — the
-- balance goes to zero, the previous number survives in the ledger note and the audit log, and the
-- static qty is cleared so it can never resurrect a figure nobody trusts.
--
-- WHAT MAKES "EVERY BATCH AND EVERY POUND ACCOUNTED FOR" TRUE RATHER THAN HOPED FOR:
--   · lots — a pound knows which purchase it came from, what it cost and when it arrived
--   · a ledger row can name the batch that consumed it
--   · a batch CANNOT be marked served or dumped until something has been drawn down for it
--
-- That last rule is a hard stop on the terminal states only. You can brew and be ready without
-- having logged the draw yet; you cannot close the loop on a batch that never touched the shelf.
-- Batches already sitting at 'served' are untouched — the guard fires on the transition, not the row —
-- and v_unaccounted_batches lists them so the existing five are visible rather than quietly forgiven.
--
-- Apply after 0292.

-- ── 1. A pound knows where it came from ──────────────────────────────────────────────────────────
create table if not exists public.inventory_lots (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  market          text not null default 'greenville' references public.markets(slug),
  item_name       text not null,                       -- matches inventory_items.name, the ledger's key
  lot_code        text,                                -- roaster lot, bin code, or your own label
  received_on     date not null default current_date,
  qty_received    numeric not null check (qty_received > 0),
  unit            text,
  unit_cost_cents int check (unit_cost_cents is null or unit_cost_cents >= 0),
  expense_id      uuid references public.expenses(id) on delete set null,
  vendor_id       uuid references public.vendors(id) on delete set null,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists inventory_lots_item_idx on public.inventory_lots (market, item_name, received_on desc);

alter table public.inventory_lots enable row level security;
drop policy if exists "lots staff" on public.inventory_lots;
create policy "lots staff" on public.inventory_lots for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.inventory_lots;
create policy "tenant isolation" on public.inventory_lots as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
drop policy if exists "market scope" on public.inventory_lots;
create policy "market scope" on public.inventory_lots as restrictive for select
  using (public.market_visible(market));
grant select, insert, update on public.inventory_lots to authenticated;

drop trigger if exists stamp_tenant_tg on public.inventory_lots;
create trigger stamp_tenant_tg before insert on public.inventory_lots
  for each row execute function public.stamp_tenant();

comment on table public.inventory_lots is
  'A delivery of one item: how much arrived, what it cost, which expense paid for it. A pound that cannot name its lot cannot name its cost.';

-- ── 2. The ledger can name the lot and the batch ─────────────────────────────────────────────────
alter table public.inventory_ledger add column if not exists lot_id   uuid references public.inventory_lots(id) on delete set null;
alter table public.inventory_ledger add column if not exists batch_id uuid references public.brew_batches(id) on delete set null;
create index if not exists inventory_ledger_batch_idx on public.inventory_ledger (batch_id) where batch_id is not null;

comment on column public.inventory_ledger.batch_id is
  'The brew batch this movement was for. Five batches were served before this column existed, drawing down nothing — see v_unaccounted_batches.';

-- ── 3. Counting is a movement, not an erasure ────────────────────────────────────────────────────
create or replace function public.reset_inventory_count(p_market text, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; bal numeric;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the shelf is being reset — a count with no reason is indistinguishable from losing the data.';
  end if;
  if not exists (select 1 from public.markets where slug = p_market) then
    raise exception 'No such market: %', p_market;
  end if;

  for r in
    select i.id, i.name, i.market, i.tenant_id, i.qty,
           coalesce(oh.on_hand, i.qty, 0) as effective,
           coalesce(oh.on_hand, 0)        as ledger_balance
      from public.inventory_items i
      left join public.inventory_on_hand oh on oh.item = i.name and oh.market = i.market
     where i.market = p_market
  loop
    -- The correction is against the LEDGER balance, not the effective one. Most of this shelf has
    -- no ledger rows at all — its number is a hand-typed qty — so its ledger balance is already 0
    -- and posting -effective would drive it to minus fourteen instead of zero. Caught by
    -- scripts/db.market.test.mjs on the first run, which is the only reason this file is correct.
    if r.effective <> 0 or r.ledger_balance <> 0 then
      insert into public.inventory_ledger (item, market, tenant_id, qty, kind, note, created_by)
      values (r.name, r.market, r.tenant_id, -r.ledger_balance, 'count',
              'Counted to zero. Previous balance: ' || r.effective::text ||
              case when r.ledger_balance <> r.effective
                   then ' (ledger held ' || r.ledger_balance::text || ', the rest was a hand-typed qty)'
                   else '' end ||
              '. Reason: ' || btrim(p_reason), auth.uid());
      n := n + 1;
    end if;
    -- Clear the hand-typed fallback too, or inventory_status resurrects it for any item that still
    -- has no ledger rows. The old value is already preserved above and in the audit log.
    if r.qty is distinct from 0 then
      update public.inventory_items set qty = 0 where id = r.id;
    end if;
  end loop;

  return n;
end $$;
revoke all on function public.reset_inventory_count(text, text) from public;
grant execute on function public.reset_inventory_count(text, text) to authenticated;

-- ── 4. Receiving a lot puts it on the shelf in one act ───────────────────────────────────────────
-- Two writes that must not come apart: the lot exists AND the shelf went up by exactly that much.
create or replace function public.receive_lot(
  p_market text, p_item text, p_qty numeric, p_unit text default null,
  p_unit_cost_cents int default null, p_lot_code text default null,
  p_expense_id uuid default null, p_received_on date default current_date, p_note text default null
) returns public.inventory_lots language plpgsql security definer set search_path = public as $$
declare l public.inventory_lots; tid uuid := public.effective_tenant();
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'A delivery has to be more than zero.'; end if;
  if not exists (select 1 from public.inventory_items where name = p_item and market = p_market) then
    raise exception 'No shelf called % in %. Create the item first, so the count has somewhere to land.', p_item, p_market;
  end if;

  insert into public.inventory_lots
    (market, item_name, lot_code, received_on, qty_received, unit, unit_cost_cents, expense_id, notes, created_by)
  values (p_market, p_item, p_lot_code, p_received_on, p_qty, p_unit, p_unit_cost_cents, p_expense_id, p_note, auth.uid())
  returning * into l;

  insert into public.inventory_ledger (item, market, tenant_id, qty, kind, note, lot_id, created_by)
  values (p_item, p_market, tid, p_qty, 'restock',
          coalesce(p_note, 'Lot received' || coalesce(' — ' || p_lot_code, '')), l.id, auth.uid());

  return l;
end $$;
revoke all on function public.receive_lot(text, text, numeric, text, int, text, uuid, date, text) from public;
grant execute on function public.receive_lot(text, text, numeric, text, int, text, uuid, date, text) to authenticated;

-- ── 5. A batch draws down what it used ───────────────────────────────────────────────────────────
create or replace function public.log_batch_use(
  p_batch_id uuid, p_item text, p_qty numeric, p_lot_id uuid default null, p_note text default null
) returns public.inventory_ledger language plpgsql security definer set search_path = public as $$
declare b public.brew_batches; mk text; row public.inventory_ledger; tid uuid := public.effective_tenant();
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'Say how much was used — a draw of zero is not a draw.'; end if;

  select * into b from public.brew_batches where id = p_batch_id;
  if not found then raise exception 'No such batch.'; end if;

  -- A batch has no market of its own; take it from the lot, else the item's own shelf.
  select market into mk from public.inventory_lots where id = p_lot_id;
  if mk is null then
    select market into mk from public.inventory_items where name = p_item limit 1;
  end if;
  mk := coalesce(mk, 'greenville');

  insert into public.inventory_ledger (item, market, tenant_id, qty, kind, note, lot_id, batch_id, created_by)
  values (p_item, mk, tid, -abs(p_qty), 'use',
          coalesce(p_note, 'Used in batch ' || coalesce(b.recipe_name, b.id::text)),
          p_lot_id, p_batch_id, auth.uid())
  returning * into row;

  return row;
end $$;
revoke all on function public.log_batch_use(uuid, text, numeric, uuid, text) from public;
grant execute on function public.log_batch_use(uuid, text, numeric, uuid, text) to authenticated;

-- ── 6. A batch cannot be finished without saying what it consumed ────────────────────────────────
-- Terminal states only. Brewing and ready stay unblocked so nothing stops mid-shift; served and
-- dumped are where the loop closes, and a closed loop with nothing drawn down is the defect this
-- whole file exists to end. Fires on the TRANSITION, so the five batches already at 'served' are
-- left exactly as they are.
create or replace function public.guard_batch_accounted() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('served', 'dumped') then return new; end if;
  if current_setting('gt3.allow_hard_delete', true) = 'on' then return new; end if;

  if not exists (select 1 from public.inventory_ledger where batch_id = new.id and qty < 0) then
    raise exception 'Batch % has nothing drawn down against it. Log what it used first: select public.log_batch_use(''%'', ''Org Ethiopia Coffee (bulk)'', <lb>); (Deliberate exception: select set_config(''gt3.allow_hard_delete'',''on'',false); first.)',
      coalesce(new.recipe_name, new.id::text), new.id;
  end if;
  return new;
end $$;

drop trigger if exists guard_batch_accounted_tg on public.brew_batches;
create trigger guard_batch_accounted_tg before update of status on public.brew_batches
  for each row execute function public.guard_batch_accounted();

-- ── 7. Audit coverage reaches the shelf ──────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_ledger','inventory_lots','brew_batches'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ── 8. The chain, readable end to end ────────────────────────────────────────────────────────────
create or replace view public.v_batch_traceability as
select b.id as batch_id, b.recipe_name, b.batch_gal, b.brew_date, b.status, b.signal_score,
       coalesce(sum(-l.qty) filter (where l.qty < 0), 0) as qty_used,
       count(distinct l.lot_id) filter (where l.lot_id is not null) as lots_touched,
       string_agg(distinct lo.lot_code, ', ') filter (where lo.lot_code is not null) as lot_codes,
       coalesce(sum(-l.qty * (lo.unit_cost_cents / 100.0)) filter (where l.qty < 0 and lo.unit_cost_cents is not null), 0)::numeric(12,2) as cost_dollars,
       (count(l.id) filter (where l.qty < 0) > 0) as accounted
  from public.brew_batches b
  left join public.inventory_ledger l on l.batch_id = b.id
  left join public.inventory_lots lo on lo.id = l.lot_id
 group by b.id, b.recipe_name, b.batch_gal, b.brew_date, b.status, b.signal_score
 order by b.brew_date desc nulls last, b.id;

revoke all on public.v_batch_traceability from public, anon;
grant select on public.v_batch_traceability to authenticated;

create or replace view public.v_unaccounted_batches as
select batch_id, recipe_name, batch_gal, brew_date, status,
       case
         when status in ('served','dumped') then 'finished without drawing anything down — predates the rule'
         else 'not yet accounted for'
       end as why
  from public.v_batch_traceability
 where not accounted
 order by brew_date desc nulls last;

revoke all on public.v_unaccounted_batches from public, anon;
grant select on public.v_unaccounted_batches to authenticated;

comment on view public.v_unaccounted_batches is
  'Batches with no pounds drawn against them. The ones already served predate the guard and are shown rather than forgiven; anything new here means someone brewed without logging it.';

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Every pound and every batch is now accounted for','improvement','Prep',
   'Stock counts had drifted because almost nothing ever subtracted from them: five batches had been brewed and sold without a single pound coming off the shelf, because nothing connected a batch to the coffee it used. Deliveries now arrive as a lot that remembers what it cost and which purchase paid for it, a batch records what it drew down and from which lot, and a batch cannot be marked served or dumped until it says what it used. Resetting a shelf to zero is recorded as a count with the previous number and a reason kept on the record, not as an erasure. Two new lists show the whole chain from a pound to a bottle, and anything that has been brewed without being logged.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- the five that were served without drawing anything down:
--   select recipe_name, brew_date, status, why from public.v_unaccounted_batches;
--
--   -- zero a shelf, with the reason on the record (staff only):
--   -- select public.reset_inventory_count('greenville', 'Physical count 2026-09-06 — starting fresh');
--
--   -- nothing was erased: the previous numbers are in the ledger
--   -- select item, qty, note from public.inventory_ledger where kind = 'count' order by created_at desc;
--
--   -- finishing a batch with nothing drawn down: expect EXCEPTION
--   -- update public.brew_batches set status = 'served' where status = 'planned';
