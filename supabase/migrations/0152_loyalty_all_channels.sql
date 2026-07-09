-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0152 · LOYALTY + REFERRAL ACROSS ALL CHANNELS  (Layer 1, closes audit Flag 03)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- award_points() (0012 → 0013 → 0016 → 0021) has only ever been attached to `orders` — so a member
-- who spends hundreds on Sunday delivery or a pickup pack earns zero points and never converts a
-- referral. Fix: factor the points+referral logic into ONE shared function (credit_wallet), keep
-- the cup trigger's exact behavior, and attach the same logic to drop_orders (fires on pickup) and
-- delivery_orders (fires on delivery). Subscriptions stay out of scope — off for launch (0150).
--
-- 100% ADDITIVE: redefines one function (behavior-preserving for cup orders), adds one column, adds
-- two new triggers on tables that had none. Nothing dropped, no existing data touched.

-- ── 1. referral_events: let a conversion originate from any channel, not just `orders` ───────────
alter table public.referral_events add column if not exists converting_channel text not null default 'cup';
do $$
declare cname text;
begin
  -- drop whatever the FK on converting_order is actually named (don't assume the Postgres default),
  -- so a drop_orders/delivery_orders id can be recorded there too. converting_channel says which.
  select con.conname into cname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
    where con.conrelid = 'public.referral_events'::regclass and con.contype = 'f' and att.attname = 'converting_order';
  if cname is not null then
    execute format('alter table public.referral_events drop constraint %I', cname);
  end if;
end $$;

-- ── 2. the shared wallet credit — points + referral conversion, one implementation ───────────────
create or replace function public.credit_wallet(p_user_id uuid, p_points int, p_total_cents int, p_order_id uuid, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare ref uuid; existing int := 0; grant_cents int := 500; floor_cents int := 500;
begin
  if p_user_id is null then return; end if;
  update public.profiles set points = points + greatest(coalesce(p_points, 1), 1) where id = p_user_id;

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
grant  execute on function public.credit_wallet(uuid, int, int, uuid, text) to service_role;

-- ── 3. cup orders — same trigger, same moment (status -> done), now delegates to credit_wallet ───
create or replace function public.award_points() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.user_id is not null then
    perform public.credit_wallet(new.user_id, coalesce(array_length(new.items, 1), 1), new.total_cents, new.id, 'cup');
  end if;
  return new;
end $$;
-- trigger already exists (0012) — redefining the function is enough, no re-create needed.

-- ── 4. pickup packs — award on the crew confirming pickup (picked_up false -> true) ───────────────
create or replace function public.award_points_pack() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.picked_up = true and old.picked_up is distinct from true and new.user_id is not null then
    perform public.credit_wallet(new.user_id, new.size, new.total_cents, new.id, 'pickup');
  end if;
  return new;
end $$;
drop trigger if exists trg_award_points_pack on public.drop_orders;
create trigger trg_award_points_pack after update on public.drop_orders
  for each row execute function public.award_points_pack();

-- ── 5. Sunday delivery — award on the crew/driver confirming delivered ───────────────────────────
create or replace function public.award_points_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.user_id is not null then
    perform public.credit_wallet(new.user_id, new.pack_size, new.total_cents, new.id, 'delivery');
  end if;
  return new;
end $$;
drop trigger if exists trg_award_points_delivery on public.delivery_orders;
create trigger trg_award_points_delivery after update on public.delivery_orders
  for each row execute function public.award_points_delivery();

-- verify:
--   select tgname from pg_trigger where tgname in ('trg_award_points','trg_award_points_pack','trg_award_points_delivery');  -- 3 rows
--   select proname from pg_proc where proname = 'credit_wallet';  -- 1 row
--   select column_name from information_schema.columns where table_name='referral_events' and column_name='converting_channel';  -- 1 row
