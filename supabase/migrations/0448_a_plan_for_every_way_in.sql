-- ── 0448 — A PLAN FOR EVERY WAY IN ─────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R53, phase A of the investor-ready vision (Ryan, 2026-10-25: "allow for the brick and mortar to have
-- phases. Maybe it's not a full brick and mortar, maybe it's a bar that's rented out from a gym… different square
-- footages, different opportunities, lease versus buy, versus space, versus partnering with a coffee shop that already
-- has the standards… our recipe on a menu… multiple plans built out and saved… each plan its own database record with
-- its own requirements"). Paste into Supabase → SQL Editor → Run. A second run changes nothing. Needs 0447.
--
-- WHAT.
--   1. vision_plans — a program's ways in, each its own record: its format (a bar inside a gym, a kiosk, our recipe on a
--      partner café's menu, a pop-up, a leased or a bought storefront, a shared space), its phase (1, 2, 3…), its status
--      (exploring → validating → ready → go → live; paused; no-go), its square feet, its deal (lease, buy, sublease,
--      revenue share, license fee, partnership), where, why, the gate that says when it goes ("go when…"), its own room
--      in the store designer, and whether it may be shown on a link (a draft stays private: shareable is off).
--   2. vision_plan_needs — what a plan needs before it can go: financing, a site, a permit, equipment, a hire, proof of
--      demand, a partner, the build — each with who owns it, when it's due and when it was done. They are the plan's
--      requirements and its milestones at once.
--   3. vision_plan_deps — a plan that waits on another (the storefront waits on the gym bar's proof). A loop is refused
--      (PT409): a plan can't wait on itself, however far round.
--   4. vision_asks.plan_id — an ask may belong to a plan (what the gym bar's equipment costs is the gym bar's ask).
--   5. vision_shares.expires_at — a link can end on a date; vision_shared reads only live, unexpired links, and shows only
--      the plans marked shareable (and only their asks, needs and waits — never who owns a need or its notes).
--   Staff read; owners and admins write — as 0447. Every change is in Settings › Activity log.
--   A first draft, only where no plan exists yet: "The first store" gets three ways in, in phases — a bar inside a gym,
--   our recipe on a partner café's menu, then the storefront (its room is the 0447 draft) — each with the needs Ryan
--   named (financing, the site, permits, equipment, hiring, proven demand). No numbers: the gates say what to set.
--
-- set lock_timeout (database F16): three tables made, two columns added (nullable, no default — no rewrite), one
-- function replaced (same signature), triggers and policies on new tables only.
-- existing rows: none changed (the draft only inserts, only into an empty plan table).
-- rollback: drop function vision_plan_no_loop() cascade; drop table vision_plan_deps, vision_plan_needs, vision_plans
--   cascade; alter table vision_asks drop column plan_id; alter table vision_shares drop column expires_at; re-run 0447's
--   vision_shared.
-- changelog: none — the crew's own screen, and links the owner sends.

set lock_timeout = '5s';

-- ── 1 · a plan ──────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.vision_plans (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  program_id  uuid not null references public.vision_programs(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  format      text not null default 'storefront_lease' check (format in
                ('gym_bar','kiosk','partner_menu','pop_up','storefront_lease','storefront_buy','shared_space','other')),
  phase       smallint not null default 1 check (phase between 1 and 9),
  status      text not null default 'exploring' check (status in ('exploring','validating','ready','go','live','paused','no_go')),
  sqft        int check (sqft is null or sqft between 10 and 100000),
  deal        text not null default 'tbd' check (deal in ('tbd','lease','buy','sublease','rev_share','license_fee','partnership','none')),
  place       text check (length(place) <= 200),
  summary     text check (length(summary) <= 600),
  why         text check (length(why) <= 2000),
  gate        text check (length(gate) <= 600),
  layout_id   uuid references public.store_layouts(id) on delete set null,
  shareable   boolean not null default false,
  sort        int not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists vision_plans_program on public.vision_plans (program_id, phase, sort);
create index if not exists vision_plans_layout on public.vision_plans (layout_id) where layout_id is not null;

-- ── 2 · what it needs ───────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.vision_plan_needs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  plan_id     uuid not null references public.vision_plans(id) on delete cascade,
  label       text not null check (length(btrim(label)) between 1 and 200),
  kind        text not null default 'other' check (kind in ('financing','site','permit','equipment','hiring','demand','partner','build','other')),
  owner       text check (length(owner) <= 80),
  due_on      date,
  done_on     date,
  note        text check (length(note) <= 600),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists vision_plan_needs_plan on public.vision_plan_needs (plan_id, sort);

-- ── 3 · what it waits on ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.vision_plan_deps (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  plan_id       uuid not null references public.vision_plans(id) on delete cascade,
  needs_plan_id uuid not null references public.vision_plans(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint vision_plan_deps_not_itself check (plan_id <> needs_plan_id),
  constraint vision_plan_deps_once unique (plan_id, needs_plan_id)
);
create index if not exists vision_plan_deps_needs on public.vision_plan_deps (needs_plan_id);

-- A wait that would close a loop (A waits on B, B on C, C on A) is refused: nothing could ever go first.
create or replace function public.vision_plan_no_loop()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (
    with recursive up(id) as (
      select d.needs_plan_id from public.vision_plan_deps d where d.plan_id = new.needs_plan_id
      union
      select d.needs_plan_id from public.vision_plan_deps d join up on d.plan_id = up.id
    )
    select 1 from up where id = new.plan_id
  ) or new.needs_plan_id = new.plan_id then
    raise exception 'That would make a loop — a plan can''t wait on something that waits on it.' using errcode = 'PT409';
  end if;
  return new;
end $$;
drop trigger if exists vision_plan_no_loop_tg on public.vision_plan_deps;
create trigger vision_plan_no_loop_tg before insert or update on public.vision_plan_deps for each row execute function public.vision_plan_no_loop();

-- ── 4 · an ask may be a plan's; 5 · a link may end ──────────────────────────────────────────────────────────────────
alter table public.vision_asks add column if not exists plan_id uuid references public.vision_plans(id) on delete set null;
create index if not exists vision_asks_plan on public.vision_asks (plan_id) where plan_id is not null;
alter table public.vision_shares add column if not exists expires_at timestamptz;

-- tenant, RLS, grants, history — as 0447
do $$
declare t text;
begin
  foreach t in array array['vision_plans', 'vision_plan_needs', 'vision_plan_deps'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "vision staff read" on public.%I', t);
    execute format('create policy "vision staff read" on public.%I for select using ((select public.is_staff()))', t);
    execute format('drop policy if exists "vision admin write" on public.%I', t);
    execute format('create policy "vision admin write" on public.%I for all using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', 'admin_audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_admin_audit()', 'admin_audit_' || t, t);
  end loop;
end $$;
-- Said once more, a table at a time, as drift.check reads it (the loop did it already; this is a no-op).
alter table public.vision_plans enable row level security;
alter table public.vision_plan_needs enable row level security;
alter table public.vision_plan_deps enable row level security;
revoke all on function public.vision_plan_no_loop() from public, anon, authenticated;

-- ── the one door for a link, again: live and unexpired, and only what was marked to show ────────────────────────────
create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  select * into s from public.vision_shares
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  return jsonb_build_object(
    'label', s.label,
    'show_asks', s.show_asks,
    'expires_at', s.expires_at,
    'programs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'lane', p.lane, 'title', p.title, 'summary', p.summary, 'why', p.why, 'pillars', p.pillars,
        'horizon', p.horizon, 'status', p.status, 'start_on', p.start_on, 'target_on', p.target_on, 'emoji', p.emoji,
        'layout_id', p.layout_id, 'sort', p.sort) order by p.horizon, p.sort, p.created_at)
      from public.vision_programs p where p.tenant_id = s.tenant_id), '[]'::jsonb),
    'asks', case when s.show_asks then coalesce((select jsonb_agg(jsonb_build_object(
        'program_id', a.program_id, 'plan_id', a.plan_id, 'label', a.label, 'amount_cents', a.amount_cents, 'state', a.state,
        'note', a.note, 'sort', a.sort) order by a.sort, a.created_at)
      from public.vision_asks a
      where a.tenant_id = s.tenant_id
        and (a.plan_id is null or exists (select 1 from public.vision_plans x where x.id = a.plan_id and x.shareable))), '[]'::jsonb)
      else '[]'::jsonb end,
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'program_id', v.program_id, 'name', v.name, 'format', v.format, 'phase', v.phase, 'status', v.status,
        'sqft', v.sqft, 'deal', v.deal, 'place', v.place, 'summary', v.summary, 'why', v.why, 'gate', v.gate,
        'layout_id', v.layout_id, 'sort', v.sort,
        'needs', coalesce((select jsonb_agg(jsonb_build_object('label', n.label, 'kind', n.kind, 'due_on', n.due_on, 'done_on', n.done_on, 'sort', n.sort)
            order by n.sort, n.created_at) from public.vision_plan_needs n where n.plan_id = v.id), '[]'::jsonb),
        'waits_on', coalesce((select jsonb_agg(d.needs_plan_id) from public.vision_plan_deps d
            join public.vision_plans w on w.id = d.needs_plan_id and w.shareable where d.plan_id = v.id), '[]'::jsonb))
        order by v.phase, v.sort, v.created_at)
      from public.vision_plans v where v.tenant_id = s.tenant_id and v.shareable), '[]'::jsonb),
    'layouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', l.name, 'width_in', l.width_in, 'depth_in', l.depth_in, 'ceiling_in', l.ceiling_in, 'notes', l.notes,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'kind', i.kind, 'label', i.label, 'x_in', i.x_in, 'y_in', i.y_in, 'rot', i.rot,
            'w_in', i.w_in, 'd_in', i.d_in, 'h_in', i.h_in, 'why', i.why, 'pillars', i.pillars, 'sort', i.sort) order by i.sort, i.created_at)
          from public.store_items i where i.layout_id = l.id), '[]'::jsonb)) order by l.created_at)
      from public.store_layouts l where l.tenant_id = s.tenant_id), '[]'::jsonb)
  );
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

-- ── a first draft: the first store, in three ways in (only into an empty plan table) ─────────────────────────────────
do $$
declare store uuid; lay uuid; gym uuid; cafe uuid; shop uuid;
begin
  if exists (select 1 from public.vision_plans) then return; end if;
  select id, layout_id into store, lay from public.vision_programs where title = 'The first store' order by created_at limit 1;
  if store is null then return; end if;

  insert into public.vision_plans (program_id, name, format, phase, status, deal, summary, why, gate, sort)
  values (store, 'A bar inside a gym', 'gym_bar', 1, 'exploring', 'tbd',
          'A small GT3 bar in a gym''s lobby — the members are already moving; we bring the fuel.',
          'The smallest way in: little to build, a crowd that shows up every day, and proof of daily demand before anyone signs a lease.',
          'Go to the next phase when cups a day and repeat guests hold for eight weeks — set the numbers.', 1)
  returning id into gym;
  insert into public.vision_plans (program_id, name, format, phase, status, deal, summary, why, gate, sort)
  values (store, 'Our recipe on a partner café''s menu', 'partner_menu', 2, 'exploring', 'tbd',
          'GT3 cold extraction on the menu of a café that already meets the standard — our name and our recipe, their room.',
          'More places people can find us without building a room of our own; a partner who shares the standard carries it.',
          'Go when a partner meets the standard and the terms are signed — set what "meets" means.', 2)
  returning id into cafe;
  insert into public.vision_plans (program_id, name, format, phase, status, sqft, deal, summary, why, gate, layout_id, sort)
  values (store, 'The first store', 'storefront_lease', 3, 'exploring', 1200, 'lease',
          'Our own room: the 30 × 40 ft draft in the store designer — daylight, a stillness corner, the bar, bottles to go.',
          'The full experience of the four pillars in one place, once the first phases have proven the demand.',
          'Go when the first phases have proven the demand and the financing is in place.', lay, 3)
  returning id into shop;

  insert into public.vision_plan_needs (plan_id, label, kind, sort) values
    (gym,  'Choose the gym',                        'site',      1),
    (gym,  'Agree the terms with the gym',          'partner',   2),
    (gym,  'Health permit for the space',           'permit',    3),
    (gym,  'Equipment list for a small bar',        'equipment', 4),
    (gym,  'Count the door at its busiest hours',   'demand',    5),
    (cafe, 'Find cafés that meet the standard',     'partner',   1),
    (cafe, 'The recipe and training card',          'build',     2),
    (cafe, 'Agree the terms',                       'partner',   3),
    (shop, 'Financing',                             'financing', 1),
    (shop, 'Site selection',                        'site',      2),
    (shop, 'Permits',                               'permit',    3),
    (shop, 'Equipment procurement',                 'equipment', 4),
    (shop, 'Hiring',                                'hiring',    5),
    (shop, 'Demand proven by the first phases',     'demand',    6);
  insert into public.vision_plan_deps (plan_id, needs_plan_id) values (shop, gym);
end $$;

-- verify (numbers only):
--   select (select count(*) from public.vision_plans) plans, (select count(*) from public.vision_plan_needs) needs;   -- 3, 14 (first run)
select public.record_migration('0448_a_plan_for_every_way_in');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
