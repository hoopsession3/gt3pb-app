-- 0229 — the loyalty BOOK. profiles.points was a bare counter that five writers mutated directly
-- (cup/pickup/delivery via credit_wallet, the scan +1, the owner absolute set) — and a behavioral
-- probe proved the flagship bug: mark an order done -> void -> done and points award TWICE; voiding
-- claws back nothing. A counter can't refuse a double-award; a ledger can.
--
-- Design (canonical loyalty): loyalty_ledger is append-only truth. ONE 'award' per
-- (user, order, channel) ever — enforced by a partial unique index, so the done->void->done loop is
-- structurally impossible. 'clawback' negates a specific award exactly once (void/un-pickup/
-- un-deliver). 'adjust' covers the owner set and the opening balances. profiles.points stays (every
-- reader keeps working: StampCard, member_by_code, wallet passes) but is now MAINTAINED — a trigger
-- applies each ledger row's delta, clamped at zero.
--
-- Writer rewrites diff against the LIVE versions (0152 credit_wallet/award_points/award_points_pack/
-- award_points_delivery, 0132 award_manual_point, 0023 admin_set_member) — the referral-conversion
-- block (credit_cents wallet, referral_events one-per-referee guard) is preserved verbatim and only
-- runs on a FIRST award, never on a replayed one.

-- ── 1. the book ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.loyalty_ledger (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  user_id     uuid not null references auth.users(id) on delete cascade,
  order_id    uuid,                                  -- the order in its OWN family's table (cup/pickup/delivery); no FK on purpose: ids come from 3 tables
  channel     text not null default 'unknown',       -- cup | pickup | delivery | scan | admin | opening
  kind        text not null check (kind in ('award','clawback','adjust')),
  points      int  not null,                         -- signed delta
  note        text,
  created_at  timestamptz not null default now()
);
create unique index if not exists loyalty_once
  on public.loyalty_ledger (user_id, order_id, channel, kind) where order_id is not null;
create index if not exists loyalty_user_idx on public.loyalty_ledger (user_id, created_at desc);

alter table public.loyalty_ledger enable row level security;
drop policy if exists "ledger own read" on public.loyalty_ledger;
create policy "ledger own read" on public.loyalty_ledger for select using (user_id = auth.uid());
drop policy if exists "ledger staff read" on public.loyalty_ledger;
create policy "ledger staff read" on public.loyalty_ledger for select using ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.loyalty_ledger;
create policy "tenant isolation" on public.loyalty_ledger as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select on public.loyalty_ledger to authenticated;  -- writes only via SECURITY DEFINER fns

-- ── 2. history FIRST (before the apply trigger exists, so nothing double-applies) ─────────────────
-- 2a. per-order awards for orders that were already done pre-ledger — so voiding a HISTORICAL order
--     claws back correctly instead of double-dipping (panel catch). Idempotent via the unique index.
insert into public.loyalty_ledger (user_id, order_id, channel, kind, points, note)
select o.user_id, o.id, 'cup', 'award', greatest(coalesce(array_length(o.items, 1), 1), 1), 'historical award backfill at 0229'
from public.orders o
where o.status = 'done' and o.user_id is not null
on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
insert into public.loyalty_ledger (user_id, order_id, channel, kind, points, note)
select d.user_id, d.id, 'pickup', 'award', greatest(coalesce(d.size, 1), 1), 'historical award backfill at 0229'
from public.drop_orders d
where d.picked_up = true and d.user_id is not null
on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
insert into public.loyalty_ledger (user_id, order_id, channel, kind, points, note)
select v.user_id, v.id, 'delivery', 'award', greatest(coalesce(v.pack_size, 1), 1), 'historical award backfill at 0229'
from public.delivery_orders v
where v.status = 'delivered' and v.user_id is not null
on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
-- 2b. the residual opening adjust — ledger sum lands EXACTLY on today's balance. Guarded so a
--     re-apply of this file can never double anyone's points (panel catch).
insert into public.loyalty_ledger (user_id, channel, kind, points, note)
select p.id, 'opening', 'adjust',
       coalesce(p.points, 0) - coalesce((select sum(l.points) from public.loyalty_ledger l where l.user_id = p.id), 0),
       'opening balance residual at 0229'
from public.profiles p
where coalesce(p.points, 0) <> coalesce((select sum(l.points) from public.loyalty_ledger l where l.user_id = p.id), 0)
  and not exists (select 1 from public.loyalty_ledger l2 where l2.user_id = p.id and l2.channel = 'opening');

-- ── 3. the apply trigger — profiles.points is now maintained, never hand-set ──────────────────────
-- NO clamp: the counter IS the sum (a clamp would silently desync them forever — panel-probed).
-- Balances can, rarely, go negative (owner set-down followed by a void); every reader already
-- renders Math.max(0, points).
create or replace function public.loyalty_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set points = coalesce(points, 0) + new.points
   where id = new.user_id;
  return new;
end $$;
drop trigger if exists trg_loyalty_apply on public.loyalty_ledger;
create trigger trg_loyalty_apply after insert on public.loyalty_ledger
  for each row execute function public.loyalty_apply();

-- ── 4. credit_wallet — same signature, ledger-first, replay-proof ─────────────────────────────────
create or replace function public.credit_wallet(p_user_id uuid, p_points int, p_total_cents int, p_order_id uuid, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare ref uuid; existing int := 0; grant_cents int := 500; floor_cents int := 500;
begin
  if p_user_id is null then return; end if;

  insert into public.loyalty_ledger (user_id, order_id, channel, kind, points)
  values (p_user_id, p_order_id, coalesce(p_channel, 'unknown'), 'award', greatest(coalesce(p_points, 1), 1))
  on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
  if not found then return; end if;  -- already awarded for this order+channel: a replay, not a sale

  if p_total_cents >= floor_cents then
    select referred_by into ref from public.profiles where id = p_user_id and referred_by is not null and referral_converted = false;
    if ref is not null then
      select count(*) into existing from public.referral_events where referee = p_user_id;
      if existing = 0 then
        update public.profiles set referral_converted = true, credit_cents = credit_cents + grant_cents where id = p_user_id;
        update public.profiles set credit_cents = credit_cents + grant_cents where id = ref;
        insert into public.referral_events (referrer, referee, converting_order, converting_channel, referrer_credit_cents, referee_credit_cents)
          values (ref, p_user_id, p_order_id, p_channel, grant_cents, grant_cents);
      end if;
    end if;
  end if;
end $$;
revoke execute on function public.credit_wallet(uuid, int, int, uuid, text) from anon, authenticated;

-- ── 5. claw_wallet — negate a specific award exactly once ─────────────────────────────────────────
create or replace function public.claw_wallet(p_user_id uuid, p_order_id uuid, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null or p_order_id is null then return; end if;
  insert into public.loyalty_ledger (user_id, order_id, channel, kind, points, note)
  select l.user_id, l.order_id, l.channel, 'clawback', -l.points, 'order voided / undone'
  from public.loyalty_ledger l
  where l.user_id = p_user_id and l.order_id = p_order_id and l.channel = coalesce(p_channel, 'unknown') and l.kind = 'award'
  on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
end $$;
revoke execute on function public.claw_wallet(uuid, uuid, text) from anon, authenticated;

-- ── 6. the three channel triggers — award on the same moments, claw on the undo ───────────────────
create or replace function public.award_points() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.user_id is not null then
    perform public.credit_wallet(new.user_id, coalesce(array_length(new.items, 1), 1), new.total_cents, new.id, 'cup');
  elsif old.status = 'done' and new.status = 'void' and new.user_id is not null then
    -- a void takes the points back; done -> preparing/ready corrections keep the award (it can
    -- never double on the way back to done — the ledger refuses).
    perform public.claw_wallet(new.user_id, new.id, 'cup');
  end if;
  return new;
end $$;

create or replace function public.award_points_pack() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.picked_up = true and old.picked_up is distinct from true and new.user_id is not null then
    perform public.credit_wallet(new.user_id, new.size, new.total_cents, new.id, 'pickup');
  elsif old.picked_up = true and new.picked_up is distinct from true and new.user_id is not null then
    perform public.claw_wallet(new.user_id, new.id, 'pickup');
  end if;
  return new;
end $$;

create or replace function public.award_points_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.user_id is not null then
    perform public.credit_wallet(new.user_id, new.pack_size, new.total_cents, new.id, 'delivery');
  elsif old.status = 'delivered' and new.status is distinct from 'delivered' and new.user_id is not null then
    perform public.claw_wallet(new.user_id, new.id, 'delivery');
  end if;
  return new;
end $$;
-- triggers already exist (0012/0152) — redefining the functions is enough.

-- ── 7. the scan +1 and the owner set, through the book ────────────────────────────────────────────
create or replace function public.award_manual_point(p_code text)
returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid; new_points int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select p.id into uid from public.profiles p
    where p.referral_code = p_code or p.id::text = p_code
    limit 1;
  if uid is null then return null; end if;
  insert into public.loyalty_ledger (user_id, channel, kind, points, note)
    values (uid, 'scan', 'award', 1, 'member card scan');
  select points into new_points from public.profiles where id = uid;
  return new_points;
end $$;

create or replace function public.admin_set_member(member uuid, new_points int, new_credit_cents int, new_founding boolean)
returns void language plpgsql security definer set search_path = public as $$
declare cur int; delta int;
begin
  if not public.is_owner() then raise exception 'not authorized'; end if;
  if new_points is not null then
    select coalesce(points, 0) into cur from public.profiles where id = member;
    delta := new_points - coalesce(cur, 0);
    if delta <> 0 then
      insert into public.loyalty_ledger (user_id, channel, kind, points, note)
        values (member, 'admin', 'adjust', delta, 'owner set points to ' || new_points);
    end if;
  end if;
  update public.profiles
     set credit_cents    = coalesce(new_credit_cents, credit_cents),
         founding_member = coalesce(new_founding, founding_member)
   where id = member;
end; $$;

-- verify:
--   select count(*) from loyalty_ledger;                                              -- >= profiles with points
--   select p.id from profiles p where coalesce(p.points,0) <> coalesce((select sum(l.points) from loyalty_ledger l where l.user_id = p.id), 0);  -- 0 rows
--   done->void->done in a sandbox: +n, then -n, then the re-award is REFUSED — an order that was
--   ever voided nets ZERO until the owner says otherwise (admin_set_member writes an auditable
--   adjust). Chosen over auto-re-award: a double-void could otherwise leak points. (Panel decision.)
