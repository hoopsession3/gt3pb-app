-- 0276 — EQUIPMENT LIFECYCLE BY MARKET. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- THE PROBLEM THIS CLOSES
-- Until now an asset was simply a row that existed until somebody hard-deleted it, and that delete
-- CASCADED into asset_maintenance (0083) — so "retiring" a piece of equipment permanently destroyed
-- the record of every service it ever had, with no audit trail on that table to recover it from.
-- Meanwhile kegs.archived_at and brew_vessels.archived_at have existed since 0096/0082 and no code
-- has ever written to either one. There was no lifecycle, and no equipment table knew what a market
-- was — 0275 deliberately left this island alone so it could be done properly rather than patched.
--
-- WHAT THIS ESTABLISHES
--   1. Equipment has a LIFECYCLE: planned → active ⇄ maintenance ⇄ reserve → retired.
--   2. Equipment belongs to a MARKET, and can move between them.
--   3. Every market change and status change writes itself to an append-only movement ledger, by
--      database trigger — never by whichever screen happened to make the edit.
--   4. Retirement REPLACES deletion. The database refuses the hard delete outright, so the asset,
--      its service log and its provenance survive being taken out of service.
--   5. The four equipment tables that had no audit trail now have one.
--
-- ZERO-REGRESSION CONTRACT
--   * status defaults to 'active' — which is exactly what "this row is in the register" means today.
--   * criticality defaults to 'standard'; market defaults to 'greenville'. Every existing row keeps
--     the precise meaning it already has, and every CHECK added is satisfied by those defaults, so
--     no constraint can fail validation against live data.
--   * Nothing is dropped except the trailer singleton CHECK, which is WIDENED (one row was legal
--     before and stays legal) so a second market can have its own rig.
--   * The inventory_ledger autolink trigger is rewritten to prefer the same market and a live asset,
--     falling through to the previous oldest-first rule — so with one market and nothing retired it
--     resolves to exactly the same row it resolves to today.
--
-- ORDERING NOTE: unlike 0275, this one changes behaviour. Run it BEFORE the accompanying deploy.
-- Either order is safe (nothing can be lost either way), but migration-first is strictly better:
-- it stops destructive deletes the moment it lands.

-- ── 1. Lifecycle + identity + market on assets ────────────────────────────────────────────────────
alter table public.assets add column if not exists market        text not null default 'greenville';
alter table public.assets add column if not exists status        text not null default 'active';
alter table public.assets add column if not exists criticality   text not null default 'standard';
alter table public.assets add column if not exists asset_tag     text;
alter table public.assets add column if not exists serial_no     text;
alter table public.assets add column if not exists in_service_on date;
alter table public.assets add column if not exists retired_on    date;
alter table public.assets add column if not exists retire_reason text;
alter table public.assets add column if not exists disposition   text;
alter table public.assets add column if not exists cost_cents    integer;

create index if not exists assets_market_idx on public.assets(market);
create index if not exists assets_status_idx on public.assets(status);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'assets_status_check') then
    alter table public.assets add constraint assets_status_check
      check (status in ('planned','active','maintenance','reserve','retired'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_criticality_check') then
    alter table public.assets add constraint assets_criticality_check
      check (criticality in ('critical','important','standard'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_disposition_check') then
    alter table public.assets add constraint assets_disposition_check
      check (disposition is null or disposition in ('sold','scrapped','returned','lost','donated','replaced'));
  end if;
  -- A retired asset must say where it went. This is the difference between an asset register and a
  -- list of names, and it is unanswerable later if nobody answered it at the time.
  if not exists (select 1 from pg_constraint where conname = 'assets_retired_needs_disposition') then
    alter table public.assets add constraint assets_retired_needs_disposition
      check (status <> 'retired' or disposition is not null);
  end if;
end $$;

-- ── 2. Market on the rest of the equipment island ─────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['asset_maintenance','kegs','brew_vessels','inventory_items','inventory_ledger'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists market text not null default %L', t, 'greenville');
      execute format('create index if not exists %I on public.%I(market)', t||'_market_idx', t);
    end if;
  end loop;
end $$;

-- ── 3. The movement ledger ────────────────────────────────────────────────────────────────────────
-- Append-only provenance. Answers "where has this been, and when did it stop working" without
-- relying on anyone having remembered to write it down.
create table if not exists public.asset_movements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  asset_id    uuid not null references public.assets(id) on delete cascade,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('commission','transfer','status','retire','reinstate')),
  from_market text,
  to_market   text,
  from_status text,
  to_status   text,
  reason      text,
  actor       uuid references auth.users(id)
);
create index if not exists asset_movements_asset_idx on public.asset_movements(asset_id, at desc);

alter table public.asset_movements enable row level security;
drop policy if exists "asset_movements staff read" on public.asset_movements;
create policy "asset_movements staff read" on public.asset_movements
  for select using ((select public.is_staff()));
-- No write policy: rows are written by the trigger below (security definer), never by a client.
-- Provenance you can hand-edit is not provenance.

create or replace function public.log_asset_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if new.status is distinct from old.status or new.market is distinct from old.market then
    k := case
           when new.status = 'retired'                     then 'retire'
           when old.status = 'retired'                     then 'reinstate'
           when new.market is distinct from old.market     then 'transfer'
           when old.status = 'planned'                     then 'commission'
           else 'status'
         end;
    insert into public.asset_movements
      (asset_id, kind, from_market, to_market, from_status, to_status, reason, actor)
    values
      (new.id, k, old.market, new.market, old.status, new.status, new.retire_reason, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_log_asset_movement on public.assets;
create trigger trg_log_asset_movement after update on public.assets
  for each row execute function public.log_asset_movement();

-- ── 4. Retirement replaces deletion ───────────────────────────────────────────────────────────────
-- Same shape as guard_customer_delete (0141), including the deliberate-maintenance escape hatch.
create or replace function public.guard_asset_delete()
returns trigger language plpgsql as $$
begin
  if current_setting('gt3.allow_hard_delete', true) = 'on' then return old; end if;
  raise exception 'Hard deletes are blocked on % — equipment is RETIRED, never deleted, so its service history and provenance survive. Set status = ''retired'' with a disposition instead. Deliberate maintenance only: select set_config(''gt3.allow_hard_delete'',''on'',false); first.', tg_table_name;
end $$;

drop trigger if exists guard_delete_assets on public.assets;
create trigger guard_delete_assets before delete on public.assets
  for each row execute function public.guard_asset_delete();

-- ── 5. Give the equipment island an audit trail ───────────────────────────────────────────────────
-- assets and inventory_items were already wired to the 0042 engine; these four never were, which is
-- why a cascaded delete of a maintenance log was unrecoverable.
do $$
declare t text;
begin
  foreach t in array array['asset_maintenance','kegs','brew_vessels','trailer_profile','asset_movements'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
    end if;
  end loop;
end $$;

-- ── 6. A second market can have its own rig ───────────────────────────────────────────────────────
-- trailer_profile was CHECK (id = 1) — one rig, forever, by construction. Widen it: the existing row
-- stays id 1 and stays Greenville's, so every caller that reads .eq("id", 1) is unaffected.
alter table public.trailer_profile drop constraint if exists trailer_profile_singleton;
alter table public.trailer_profile add column if not exists market text not null default 'greenville';

-- id defaulted to the literal 1, so a second insert would have collided. Give it a sequence.
do $$ begin
  if not exists (select 1 from pg_class where relname = 'trailer_profile_id_seq') then
    create sequence public.trailer_profile_id_seq owned by public.trailer_profile.id;
    perform setval('public.trailer_profile_id_seq', coalesce((select max(id) from public.trailer_profile), 1));
    alter table public.trailer_profile alter column id set default nextval('public.trailer_profile_id_seq');
  end if;
end $$;
create index if not exists trailer_profile_market_idx on public.trailer_profile(market);

-- ── 7. Stop the stock ledger auto-linking to the wrong market's gear ──────────────────────────────
-- The 0232 autolink matched lower(assets.name) = lower(ledger.item) and took the OLDEST row on a tie.
-- With two markets owning similarly-named gear ("Nitro Kegerator"), every Atlanta ledger row would
-- silently attach to Greenville's asset. Prefer the same market, then a live asset, then fall through
-- to the original oldest-first rule — so with one market and nothing retired this resolves to exactly
-- the row it resolves to today.
create or replace function public.inventory_ledger_autolink()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is null and new.item is not null then
    select a.id into new.item_id
      from public.assets a
      where lower(a.name) = lower(new.item)
      order by (a.market is not distinct from new.market) desc,
               (a.status <> 'retired') desc,
               a.created_at asc
      limit 1;
  end if;
  return new;
end $$;

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- every asset is 'active' in 'greenville' and nothing moved:
--   select market, status, count(*) from public.assets group by 1,2 order by 1,2;
--
--   -- the guard actually refuses:
--   delete from public.assets where id = (select id from public.assets limit 1);   -- expect: EXCEPTION
--
--   -- retiring writes its own provenance:
--   update public.assets set status='retired', disposition='scrapped', retire_reason='test',
--          retired_on=current_date where id = (select id from public.assets limit 1);
--   select kind, from_status, to_status, from_market, to_market from public.asset_movements order by at desc limit 1;
--   -- then put it back:
--   update public.assets set status='active', disposition=null, retire_reason=null, retired_on=null
--    where id = (select asset_id from public.asset_movements order by at desc limit 1);
--
--   -- a retired asset cannot exist without a disposition:
--   update public.assets set status='retired', disposition=null where id = (select id from public.assets limit 1);  -- expect: EXCEPTION
--
--   -- the four tables that had no audit trail now have one:
--   select tgrelid::regclass from pg_trigger where tgname like 'audit_%' order by 1;
