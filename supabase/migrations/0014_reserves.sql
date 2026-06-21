-- 0014 — limited reserves (Supabase owns stock + atomic claim; oversell is a DB
-- invariant Square Inventory can't express). Pay-at-pickup hold for v1: a claim
-- atomically reserves a unit; the member pays at the truck (operator marks paid,
-- which flows through the existing KDS/loyalty rails). No service-role required.

create table if not exists public.reserves (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  blurb text,
  price_cents int not null check (price_cents >= 0),
  stock_total int not null check (stock_total >= 0),
  stock_remaining int not null check (stock_remaining >= 0),
  per_member_limit int not null default 1 check (per_member_limit >= 1),
  member_only boolean not null default true,
  status text not null default 'draft' check (status in ('draft','live','sold_out','archived')),
  drop_at timestamptz,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check (stock_remaining <= stock_total)
);
alter table public.reserves enable row level security;
drop policy if exists "reserves read" on public.reserves;
create policy "reserves read" on public.reserves for select
  using (status in ('live','sold_out') or public.is_admin());
drop policy if exists "reserves admin write" on public.reserves;
create policy "reserves admin write" on public.reserves for all
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.reserve_claims (
  id uuid primary key default gen_random_uuid(),
  reserve_id uuid not null references public.reserves(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  qty int not null default 1 check (qty >= 1),
  state text not null default 'held' check (state in ('held','paid','expired','cancelled')),
  hold_expires_at timestamptz,
  order_id uuid references public.orders(id),
  created_at timestamptz not null default now()
);
create unique index if not exists one_active_claim_per_member
  on public.reserve_claims(reserve_id, user_id) where state in ('held','paid');
alter table public.reserve_claims enable row level security;
drop policy if exists "claims read own" on public.reserve_claims;
create policy "claims read own" on public.reserve_claims for select
  using (auth.uid() = user_id or public.is_admin());
drop policy if exists "claims admin write" on public.reserve_claims;
create policy "claims admin write" on public.reserve_claims for all
  using (public.is_admin()) with check (public.is_admin());
-- members never write claims directly: claim_reserve (definer) is the only member path.

alter publication supabase_realtime add table public.reserves;

-- return expired holds to stock (self-heal even if no cron)
create or replace function public.release_expired_holds() returns void
language plpgsql security definer set search_path = public as $$
begin
  with expired as (
    update public.reserve_claims set state = 'expired'
    where state = 'held' and hold_expires_at is not null and hold_expires_at < now()
    returning reserve_id, qty
  )
  update public.reserves r set stock_remaining = least(r.stock_total, r.stock_remaining + e.s)
  from (select reserve_id, sum(qty) s from expired group by reserve_id) e
  where r.id = e.reserve_id;
  update public.reserves set status = 'live' where status = 'sold_out' and stock_remaining > 0;
end; $$;
grant execute on function public.release_expired_holds() to authenticated;

-- atomic claim: reserve a unit or fail (no oversell), honor per-member limit
create or replace function public.claim_reserve(p_reserve uuid, p_qty int default 1) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit int; v_member_only boolean; v_have int; v_claim uuid;
begin
  if v_uid is null then raise exception 'sign in to reserve'; end if;
  if p_qty < 1 then p_qty := 1; end if;
  perform public.release_expired_holds();

  select per_member_limit, member_only into v_limit, v_member_only
    from public.reserves where id = p_reserve and status = 'live';
  if v_limit is null then raise exception 'reserve not available'; end if;

  select coalesce(sum(qty),0) into v_have from public.reserve_claims
    where reserve_id = p_reserve and user_id = v_uid and state in ('held','paid');
  if v_have + p_qty > v_limit then raise exception 'limit reached'; end if;

  update public.reserves set stock_remaining = stock_remaining - p_qty
    where id = p_reserve and status = 'live' and stock_remaining >= p_qty;
  if not found then raise exception 'sold out'; end if;

  select id into v_claim from public.reserve_claims
    where reserve_id = p_reserve and user_id = v_uid and state in ('held','paid') limit 1;
  if v_claim is not null then
    update public.reserve_claims set qty = qty + p_qty, hold_expires_at = now() + interval '48 hours'
      where id = v_claim;
  else
    insert into public.reserve_claims (reserve_id, user_id, qty, state, hold_expires_at)
      values (p_reserve, v_uid, p_qty, 'held', now() + interval '48 hours')
      returning id into v_claim;
  end if;

  update public.reserves set status = 'sold_out' where id = p_reserve and stock_remaining = 0;
  return v_claim;
end; $$;
grant execute on function public.claim_reserve(uuid, int) to authenticated;

-- member cancels their own held claim → stock returns
create or replace function public.cancel_reserve_claim(p_claim uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_res uuid; v_qty int;
begin
  update public.reserve_claims set state = 'cancelled'
    where id = p_claim and user_id = auth.uid() and state = 'held'
    returning reserve_id, qty into v_res, v_qty;
  if v_res is not null then
    update public.reserves set stock_remaining = least(stock_total, stock_remaining + v_qty) where id = v_res;
    update public.reserves set status = 'live' where id = v_res and status = 'sold_out' and stock_remaining > 0;
  end if;
end; $$;
grant execute on function public.cancel_reserve_claim(uuid) to authenticated;
