-- ── 0459 — FOOD IS PLANNED BEFORE IT IS SOLD (PF1) ──────────────────────────────────────────────────────────────────
-- 2026-10-28. Primal Food, step 1 (Ryan, 2026-10-28: "GT3 will open with its existing approved offerings. Primal Food is
-- a planned future expansion targeted for Q2–Q3 2027… Plan it, model it, and make it interoperable" — "do not implement
-- food as an active menu item"). A second run changes nothing. Needs 0458.
-- Paste it after the deploy that carries the Food screen.
--
-- WHAT.
--   food_items — a food idea on its way: concept → proposed → approved → live → retired. It is NOT a menu product: the
--   menu, the Shop and Square read public.products, and a food item reaches products only when an owner takes it live
--   (product_id set then). Its allergens are named from the nine major allergens; its target price says where it came
--   from. Owners and admins write it; only an owner approves it or takes it live.
--   food_recipes — a food item's recipe, versioned: its portion in grams, the cook loss, the components (name, raw grams,
--   cost per kg and where that cost came from, allergens), the method, how it's cooked, held, kept and discarded. The
--   recipe is GT3's own: owners and admins read it, nobody else, and it never ships in a page. An approved version is
--   never changed — a new version replaces it. Only an owner approves one. Temperatures are written as the governing
--   rule says, with its source; this file sets none.
--   inventory_lots — a use-by date and the allergens a lot carries.
--   food_temp_logs — a temperature taken (receiving, cold holding, hot holding, cooking, cooling, reheating): the
--   reading, what it was taken of, by whom, and what was done if it was out. Kept as taken: no edit, no delete. The crew
--   write and read them.
--   vendors — an approval status for a supplier (unreviewed, approved, conditional, rejected), with who decided and why.
--   Only an owner decides.
--
-- set lock_timeout (database F16): three tables made; columns added to two (nullable or a constant default — no rewrite);
-- guards and policies.
-- existing rows: none changed (vendors start unreviewed; lots have no use-by until one is written).
-- rollback: drop table food_temp_logs, food_recipes, food_items cascade; drop the columns named here.
-- changelog: none — the owners' planning screen.

set lock_timeout = '5s';

create table if not exists public.food_items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name              text not null check (length(btrim(name)) between 1 and 120),
  category          text not null default 'bowl' check (category in ('bowl','plate','handheld','snack','side','other')),
  status            text not null default 'concept' check (status in ('concept','proposed','approved','live','retired')),
  summary           text check (summary is null or length(summary) <= 1000),
  serving           text check (serving is null or length(serving) <= 300),
  allergens         text[] not null default '{}',
  packaging         text check (packaging is null or length(packaging) <= 300),
  target_price_cents int check (target_price_cents is null or target_price_cents between 1 and 100000),
  price_source      text check (price_source is null or length(price_source) <= 300),
  plan_id           uuid references public.vision_plans(id) on delete set null,
  product_id        uuid references public.products(id) on delete set null,
  approved_by       uuid,
  approved_at       timestamptz,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint food_items_allergens check (allergens <@ array['milk','eggs','fish','shellfish','tree_nuts','peanuts','wheat','soy','sesame']::text[]),
  constraint food_items_price_said check (target_price_cents is null or length(btrim(coalesce(price_source, ''))) > 0),
  constraint food_items_live check (status <> 'live' or product_id is not null)
);

create table if not exists public.food_recipes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  food_item_id     uuid not null references public.food_items(id) on delete cascade,
  version          int not null check (version >= 1),
  status           text not null default 'draft' check (status in ('draft','approved','retired')),
  portion_g        numeric(8,1) not null check (portion_g > 0 and portion_g <= 5000),
  cook_loss_pct    numeric(5,2) not null default 0 check (cook_loss_pct >= 0 and cook_loss_pct < 95),
  components       jsonb not null default '[]' check (jsonb_typeof(components) = 'array'),
  method           text check (method is null or length(method) <= 4000),
  cook_rule        text check (cook_rule is null or length(cook_rule) <= 600),
  hold_rule        text check (hold_rule is null or length(hold_rule) <= 600),
  rule_source      text check (rule_source is null or length(rule_source) <= 600),
  shelf_life_hours int check (shelf_life_hours is null or shelf_life_hours between 1 and 2160),
  discard_rule     text check (discard_rule is null or length(discard_rule) <= 600),
  approved_by      uuid,
  approved_at      timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (food_item_id, version)
);
create index if not exists food_recipes_item on public.food_recipes (food_item_id, version desc);

alter table public.inventory_lots add column if not exists use_by date;
alter table public.inventory_lots add column if not exists allergens text[] not null default '{}';
alter table public.inventory_lots drop constraint if exists inventory_lots_allergens;
alter table public.inventory_lots add constraint inventory_lots_allergens check (allergens <@ array['milk','eggs','fish','shellfish','tree_nuts','peanuts','wheat','soy','sesame']::text[]);

create table if not exists public.food_temp_logs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  kind              text not null check (kind in ('receiving','cold_hold','hot_hold','cooking','cooling','reheating')),
  reading_f         numeric(5,1) not null check (reading_f between -40 and 500),
  what              text not null check (length(btrim(what)) between 1 and 200),
  lot_id            uuid references public.inventory_lots(id) on delete set null,
  food_item_id      uuid references public.food_items(id) on delete set null,
  place             text check (place is null or length(place) <= 200),
  within_rule       boolean,
  corrective_action text check (corrective_action is null or length(corrective_action) <= 600),
  taken_at          timestamptz not null default now(),
  logged_by         uuid default auth.uid(),
  constraint food_temp_logs_out_said check (within_rule is distinct from false or length(btrim(coalesce(corrective_action, ''))) > 0)
);
create index if not exists food_temp_logs_taken on public.food_temp_logs (taken_at desc);
create index if not exists food_temp_logs_food_item on public.food_temp_logs (food_item_id);
create index if not exists food_temp_logs_lot on public.food_temp_logs (lot_id);
create index if not exists food_items_plan on public.food_items (plan_id);
create index if not exists food_items_product on public.food_items (product_id);

alter table public.vendors add column if not exists approval_status text not null default 'unreviewed';
alter table public.vendors add column if not exists approval_note text;
alter table public.vendors add column if not exists approved_by uuid;
alter table public.vendors add column if not exists approved_at timestamptz;
alter table public.vendors drop constraint if exists vendors_approval_status;
alter table public.vendors add constraint vendors_approval_status check (approval_status in ('unreviewed','approved','conditional','rejected'));

-- ── guards ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.food_item_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('approved','live') then raise exception 'An approved or live food item is kept; retire it instead.' using errcode = 'PT409'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('concept','proposed') then raise exception 'A food item starts as a concept or a proposal.' using errcode = 'PT409'; end if;
    new.approved_by := null; new.approved_at := null; new.product_id := null;
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    return new;
  end if;
  new.updated_at := now();
  if new.status is distinct from old.status and new.status in ('approved','live') then
    perform public.std_owner_only('approve food or take it live');
    if new.status = 'approved' then new.approved_by := auth.uid(); new.approved_at := now(); end if;
  elsif (new.approved_by, new.approved_at) is distinct from (old.approved_by, old.approved_at) then
    raise exception 'Only an approval records an approver.' using errcode = 'PT409';
  end if;
  if new.product_id is distinct from old.product_id then
    perform public.std_owner_only('put food on the menu');
  end if;
  return new;
end $$;
revoke all on function public.food_item_guard() from public, anon, authenticated;
drop trigger if exists food_item_guard_tg on public.food_items;
create trigger food_item_guard_tg before insert or update or delete on public.food_items for each row execute function public.food_item_guard();

create or replace function public.food_recipe_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'An approved recipe is kept as approved.' using errcode = 'PT409'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'A recipe starts as a draft.' using errcode = 'PT409'; end if;
    new.approved_by := null; new.approved_at := null;
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    return new;
  end if;
  if old.status = 'retired' then raise exception 'A retired recipe is kept as it was.' using errcode = 'PT409'; end if;
  if old.status = 'approved' then
    if new.status = 'retired' and (new.portion_g, new.cook_loss_pct, new.components, new.method, new.cook_rule, new.hold_rule,
        new.rule_source, new.shelf_life_hours, new.discard_rule, new.version, new.food_item_id)
        is not distinct from (old.portion_g, old.cook_loss_pct, old.components, old.method, old.cook_rule, old.hold_rule,
        old.rule_source, old.shelf_life_hours, old.discard_rule, old.version, old.food_item_id) then
      perform public.std_owner_only('retire an approved recipe');
      return new;
    end if;
    raise exception 'An approved recipe is never changed — write a new version.' using errcode = 'PT409';
  end if;
  if new.status = 'approved' then
    perform public.std_owner_only('approve a recipe');
    if jsonb_array_length(new.components) = 0 then raise exception 'A recipe needs its components before it is approved.' using errcode = 'PT422'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif new.status = 'retired' then
    raise exception 'Only an approved recipe is retired; delete a draft instead.' using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.food_recipe_guard() from public, anon, authenticated;
drop trigger if exists food_recipe_guard_tg on public.food_recipes;
create trigger food_recipe_guard_tg before insert or update or delete on public.food_recipes for each row execute function public.food_recipe_guard();

create or replace function public.food_temp_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.logged_by := auth.uid(); end if;
    return new;
  end if;
  raise exception 'A temperature is kept as it was taken; log a new reading instead.' using errcode = 'PT409';
end $$;
revoke all on function public.food_temp_guard() from public, anon, authenticated;
drop trigger if exists food_temp_guard_tg on public.food_temp_logs;
create trigger food_temp_guard_tg before insert or update or delete on public.food_temp_logs for each row execute function public.food_temp_guard();

create or replace function public.vendor_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.approval_status <> 'unreviewed' then perform public.std_owner_only('approve a supplier'); new.approved_by := auth.uid(); new.approved_at := now(); end if;
    return new;
  end if;
  if (new.approval_status, new.approval_note) is distinct from (old.approval_status, old.approval_note) then
    perform public.std_owner_only('approve a supplier');
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif (new.approved_by, new.approved_at) is distinct from (old.approved_by, old.approved_at) then
    raise exception 'Only an approval records an approver.' using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.vendor_approval_guard() from public, anon, authenticated;
drop trigger if exists vendor_approval_guard_tg on public.vendors;
create trigger vendor_approval_guard_tg before insert or update on public.vendors for each row execute function public.vendor_approval_guard();

-- ── access ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The plan and the recipe: owners and admins. The thermometer: the crew.
alter table public.food_items enable row level security;
alter table public.food_recipes enable row level security;
alter table public.food_temp_logs enable row level security;
do $$
declare t text;
begin
  foreach t in array array['food_items','food_recipes','food_temp_logs'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop trigger if exists admin_audit_%s on public.%I', t, t);
    execute format('create trigger admin_audit_%s after insert or update or delete on public.%I for each row execute function public.log_admin_audit()', t, t);
  end loop;
end $$;
drop policy if exists "food admin" on public.food_items;
create policy "food admin" on public.food_items for all using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.food_items to authenticated;
drop policy if exists "food recipes admin" on public.food_recipes;
create policy "food recipes admin" on public.food_recipes for all using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.food_recipes to authenticated;
drop policy if exists "food temps staff read" on public.food_temp_logs;
create policy "food temps staff read" on public.food_temp_logs for select using ((select public.is_staff()));
drop policy if exists "food temps staff write" on public.food_temp_logs;
create policy "food temps staff write" on public.food_temp_logs for insert with check ((select public.is_staff()));
grant select, insert on public.food_temp_logs to authenticated;

-- verify (numbers only):
--   select count(*) from public.food_items;                                  -- 0 (first run)
--   select count(*) from public.vendors where approval_status <> 'unreviewed'; -- 0 (first run)
select public.record_migration('0459_food_is_planned_before_it_is_sold');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
