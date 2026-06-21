-- 0024 — the operational event object (the keystone). Gives an event a setup type,
-- menu, power/water, headcount; links every order to the event it was rung up at; and
-- mirrors Square sales so walk-up POS sales (which never touch the app) still feed
-- per-event totals. Everything downstream (pack list, command center, per-event P&L,
-- AAR) hangs off this.

-- 1) operational config on events (the "hard prep" data — pack list + command center read it)
alter table public.events add column if not exists archetype text
  check (archetype in ('beltline_cart','trailer_full','market','private_booking','festival') or archetype is null);
alter table public.events add column if not exists rig text
  check (rig in ('cart_only','trailer_plus_cart') or rig is null);
alter table public.events add column if not exists menu_nitro        boolean not null default false;
alter table public.events add column if not exists menu_nature_aid   boolean not null default false;
alter table public.events add column if not exists menu_salted_maple boolean not null default false;
alter table public.events add column if not exists menu_bottles      boolean not null default false;
alter table public.events add column if not exists menu_broth        boolean not null default false;
alter table public.events add column if not exists power_available     boolean;
alter table public.events add column if not exists water_available     boolean;
alter table public.events add column if not exists expected_attendance int;
alter table public.events add column if not exists duration_hrs        numeric;
alter table public.events add column if not exists staff_count         int;
alter table public.events add column if not exists is_live boolean not null default false; -- the currently-running event
-- at most one live event at a time
create unique index if not exists events_one_live on public.events (is_live) where is_live = true;

-- 2) link orders to the event they were sold at, and auto-stamp with the active event
alter table public.orders add column if not exists event_id uuid references public.events(id);
create index if not exists orders_event on public.orders(event_id);

create or replace function public.active_event_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.events where is_live = true limit 1;
$$;
grant execute on function public.active_event_id() to anon, authenticated;

-- Every new order auto-links to the live event (no app change needed for stamping).
create or replace function public.stamp_order_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is null then new.event_id := public.active_event_id(); end if;
  return new;
end; $$;
drop trigger if exists orders_stamp_event on public.orders;
create trigger orders_stamp_event before insert on public.orders
  for each row execute function public.stamp_order_event();

-- Mark an event live / closed (admin-gated; only one live at a time). Closing is the
-- hook the post-event AAR / Notion write-back will fire on later.
create or replace function public.admin_set_event_live(p_event uuid, p_live boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_live then update public.events set is_live = false where is_live = true and id <> p_event; end if;
  update public.events set is_live = p_live where id = p_event;
end; $$;
grant execute on function public.admin_set_event_live(uuid, boolean) to authenticated;

-- 3) Square sales mirror — every paid sale (POS or app) lands here scoped to the active
-- event, so $/hr and sales velocity are real even for cart walk-ups that never hit the app.
-- Written only by the service role (the Square webhook); staff read for the command center.
create table if not exists public.event_sales (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id),
  source text not null default 'square',
  square_payment_id text unique,
  amount_cents int not null default 0,
  item_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.event_sales enable row level security;
create index if not exists event_sales_event on public.event_sales(event_id);
drop policy if exists "event_sales staff read" on public.event_sales;
create policy "event_sales staff read" on public.event_sales for select using (public.is_staff());
