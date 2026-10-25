-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
--
-- EACH MIGRATION IS ITS OWN TRANSACTION (R32 — the 10/10 audit, DB11-04 and OPS11-03). A paste runs as one transaction
-- unless it says otherwise, so a lock one migration took was held to the end of all of them, and one that stopped took
-- the others back with it. Each section below is wrapped in its own begin … commit: its locks end with it, and if one
-- stops (a busy table's lock wait ran out), the ones above it stay applied and nothing below it runs — paste the file
-- again a moment later; a migration already applied changes nothing the second time.
-- pending-from: 0448
-- generated-at: 2026-10-25
-- pending-count: 2
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0442_the_course_is_bought_and_the_pillars_are_given.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0447_the_plan_people_can_see.sql
-- ============================================================
begin;   -- 0447, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0447 — THE PLAN PEOPLE CAN SEE ──────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R52 (Ryan, 2026-10-25: "People are always asking, 'What are our plans? What's next?'… allow me a place to
-- interactively build my roadmap of the business plan, where I can just pull the app up and show someone… design a
-- brick-and-mortar… place items, explain why it's there… where investors may be needed in each plan/program… almost
-- like a light version of AutoCAD"; and: espresso is not part of the brand — nothing that introduces toxicity to the
-- body; everything abides by the four primal pillars: stillness, light, fuel, movement). Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing.
--
-- WHAT.
--   1. vision_programs — the roadmap: a program (the truck, drops, delivery, office, GT3 Nutrition, the first store…),
--      its lane, its horizon (now · next · later — the roadmap's industry standard), its status, optional dates, why it
--      exists and which of the four pillars it serves, and the store layout it opens (if it is a place).
--   2. vision_asks — where capital may be needed: each program's ask as what it buys (build-out, equipment, runway…),
--      an amount, and whether it is open, committed or funded.
--   3. store_layouts and store_items — the store designer: a room in inches (width, depth, ceiling) and every thing in
--      it — where it sits, which way it faces, how big it is, what it is called, why it is there and its pillars.
--   4. vision_shares — a private, read-only link for someone outside (an investor, a partner): a long random token, who
--      it is for, how often it was opened, and turned off with one tap. vision_shared(token) is the only door: anyone
--      holding a live token reads the roadmap, the asks and the layouts — never who wrote them, never another table.
--   Staff read; owners and admins write (is_admin, two-step — 0433). Every change is in Settings › Activity log (0260).
--   A first draft, so the screen opens on something to edit: the programs the app already runs, a first store in "next",
--   its asks with no amounts yet (the owner's numbers, never invented here), and a starter room on the four pillars —
--   cold extraction, no espresso.
--
-- set lock_timeout (database F16): five tables made, one function, triggers and policies on new tables only.
-- existing rows: none changed.
-- changelog: none — the crew's own screen, and links the owner sends.

set lock_timeout = '5s';

-- ── 1 · the roadmap ─────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.store_layouts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name        text not null check (length(btrim(name)) between 1 and 80),
  width_in    int  not null default 360 check (width_in between 96 and 2400),    -- 8 ft to 200 ft
  depth_in    int  not null default 480 check (depth_in between 96 and 2400),
  ceiling_in  int  not null default 132 check (ceiling_in between 84 and 480),
  notes       text check (length(notes) <= 2000),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.vision_programs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  lane        text not null default 'Business' check (length(btrim(lane)) between 1 and 40),
  title       text not null check (length(btrim(title)) between 1 and 80),
  summary     text check (length(summary) <= 400),
  why         text check (length(why) <= 2000),
  pillars     text[] not null default '{}' check (pillars <@ array['stillness','light','fuel','movement']::text[]),
  horizon     text not null default 'next' check (horizon in ('now','next','later')),
  status      text not null default 'planned' check (status in ('idea','planned','building','live','paused')),
  start_on    date,
  target_on   date,
  emoji       text check (length(emoji) <= 8),
  layout_id   uuid references public.store_layouts(id) on delete set null,
  sort        int not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vision_dates_in_order check (start_on is null or target_on is null or start_on <= target_on)
);
create index if not exists vision_programs_board on public.vision_programs (horizon, sort);
-- A room taken out sets its programs' link to null: the index finds them without a scan (db.r30's rule).
create index if not exists vision_programs_layout on public.vision_programs (layout_id) where layout_id is not null;

create table if not exists public.vision_asks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  program_id   uuid not null references public.vision_programs(id) on delete cascade,
  label        text not null check (length(btrim(label)) between 1 and 80),   -- what it buys
  amount_cents bigint not null default 0 check (amount_cents between 0 and 100000000000),
  state        text not null default 'open' check (state in ('open','committed','funded')),
  note         text check (length(note) <= 400),
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists vision_asks_program on public.vision_asks (program_id, sort);

create table if not exists public.store_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  layout_id   uuid not null references public.store_layouts(id) on delete cascade,
  kind        text not null check (length(kind) between 1 and 40),                -- lib/vision CATALOG
  label       text check (length(label) <= 80),
  x_in        numeric not null default 0,                                         -- the item's centre, from the room's top-left
  y_in        numeric not null default 0,
  rot         int  not null default 0 check (rot in (0, 90, 180, 270)),
  w_in        numeric not null check (w_in > 0 and w_in <= 2400),
  d_in        numeric not null check (d_in > 0 and d_in <= 2400),
  h_in        numeric not null check (h_in >= 0 and h_in <= 480),
  why         text check (length(why) <= 1000),
  pillars     text[] not null default '{}' check (pillars <@ array['stillness','light','fuel','movement']::text[]),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists store_items_layout on public.store_items (layout_id, sort);

create table if not exists public.vision_shares (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  -- 64 hex characters from two random UUIDs (244 random bits): unguessable, and no extension needed to make it.
  token          text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') check (length(token) >= 32),
  label          text not null default 'A link' check (length(btrim(label)) between 1 and 80),   -- who it is for
  show_asks      boolean not null default true,                                                   -- the money, or the vision alone
  created_by     uuid,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  last_opened_at timestamptz,
  opens          int not null default 0
);

-- tenant, RLS, grants, history — every table the same way
do $$
declare t text;
begin
  foreach t in array array['store_layouts', 'vision_programs', 'vision_asks', 'store_items', 'vision_shares'] loop
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

-- Said once more, a table at a time, as drift.check reads it (the loop above did it already; this is a no-op).
alter table public.store_layouts enable row level security;
alter table public.vision_programs enable row level security;
alter table public.vision_asks enable row level security;
alter table public.store_items enable row level security;
alter table public.vision_shares enable row level security;

-- A link is an owner's to hand out: the crew read the plan, not the links to it.
drop policy if exists "vision staff read" on public.vision_shares;
drop policy if exists "vision shares admin read" on public.vision_shares;
create policy "vision shares admin read" on public.vision_shares for select using ((select public.is_admin()));

-- ── 2 · the one door for a link ─────────────────────────────────────────────────────────────────────────────────────
-- Everything a live link shows, and nothing else: no ids of who wrote it, no other table. A token that isn't live
-- answers PT404 (not found), the same for a wrong token as for a turned-off one.
create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  select * into s from public.vision_shares where token = p_token and revoked_at is null;
  if not found then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  return jsonb_build_object(
    'label', s.label,
    'show_asks', s.show_asks,
    'programs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'lane', p.lane, 'title', p.title, 'summary', p.summary, 'why', p.why, 'pillars', p.pillars,
        'horizon', p.horizon, 'status', p.status, 'start_on', p.start_on, 'target_on', p.target_on, 'emoji', p.emoji,
        'layout_id', p.layout_id, 'sort', p.sort) order by p.horizon, p.sort, p.created_at)
      from public.vision_programs p where p.tenant_id = s.tenant_id), '[]'::jsonb),
    'asks', case when s.show_asks then coalesce((select jsonb_agg(jsonb_build_object(
        'program_id', a.program_id, 'label', a.label, 'amount_cents', a.amount_cents, 'state', a.state, 'note', a.note, 'sort', a.sort)
        order by a.sort, a.created_at)
      from public.vision_asks a where a.tenant_id = s.tenant_id), '[]'::jsonb) else '[]'::jsonb end,
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

-- ── 3 · a first draft (only into an empty board) ────────────────────────────────────────────────────────────────────
do $$
declare lay uuid; store uuid;
begin
  if exists (select 1 from public.vision_programs) then return; end if;

  insert into public.store_layouts (name, width_in, depth_in, ceiling_in, notes)
  values ('The first store (draft)', 360, 480, 132,
          'A 30 × 40 ft starter room. Cold extraction, bottles, broth — no espresso. Move, add or take out anything.')
  returning id into lay;

  insert into public.store_items (layout_id, kind, label, x_in, y_in, rot, w_in, d_in, h_in, why, pillars, sort) values
    (lay, 'door',          'Entry',                    180, 477,   0,  42,   6,  84, 'One way in, straight to the order counter — no maze before the first hello.', '{movement}', 1),
    (lay, 'window_wall',   'Daylight wall',              3, 330,  90, 300,   6,  96, 'The long wall is glass: daylight on every seat. Light is a pillar, not decor.', '{light}', 2),
    (lay, 'order_counter', 'Order counter',            170, 200,   0, 144,  30,  42, 'Order and pay in one place, facing the door, so the line moves.', '{movement}', 3),
    (lay, 'tap_tower',     'Cold-brew & nitro taps',   260, 200,   0,  36,  30,  60, 'Cold extracted, poured to order — the cleanest cup, no espresso.', '{fuel}', 4),
    (lay, 'bottle_cooler', 'Grab-and-go bottles',      340, 330,   0,  30,  30,  80, 'Bottles for the road: a ten-second stop for people on the move.', '{fuel,movement}', 5),
    (lay, 'broth_station', 'Bone broth station',       345, 240, 270,  48,  30,  42, 'Warm broth, sipped slow — fuel without the crash.', '{fuel}', 6),
    (lay, 'prep_counter',  'Prep counter',             200,  70,   0,  96,  30,  36, 'Back-of-house prep behind the line, out of the guests'' path.', '{fuel}', 7),
    (lay, 'brew_vessels',  'Cold-extraction vessels',  345, 130, 270,  60,  30,  72, 'Where every batch steeps cold, on view from the counter.', '{fuel}', 8),
    (lay, 'three_sink',    'Three-compartment sink',   190,  12,   0,  72,  24,  40, 'Required by code, kept to the back wall.', '{}', 9),
    (lay, 'hand_sink',     'Hand sink',                100,   9,   0,  18,  18,  40, 'At the start of the line, where hands get washed first.', '{}', 10),
    (lay, 'reach_in',      'Reach-in fridge',           60,  40,   0,  54,  30,  80, 'Milks and garnish, one step from the taps.', '{fuel}', 11),
    (lay, 'community',     'Community table',          170, 330,   0,  96,  36,  30, 'One long table: strangers share it, people stay.', '{stillness}', 12),
    (lay, 'two_top',       'Two-top',                   40, 260,   0,  30,  30,  30, 'For two, in the light.', '{light}', 13),
    (lay, 'two_top',       'Two-top',                   40, 330,   0,  30,  30,  30, 'For two, in the light.', '{light}', 14),
    (lay, 'lounge',        'Stillness corner',          60, 435,   0,  72,  60,  32, 'Soft seats, no screens, low sound — a place to sit still for ten minutes.', '{stillness}', 15),
    (lay, 'plants',        'Living wall',               60, 474,   0,  72,  12,  84, 'Green and growing by the quiet corner.', '{stillness,light}', 16),
    (lay, 'merch_wall',    'Merch & primal library',   353, 420, 270,  84,  14,  84, 'The shirts, and the GT3 Nutrition maps people can take home.', '{movement}', 17),
    (lay, 'pickup_shelf',  'Pickup shelf',             270, 473,   0,  48,  14,  60, 'Drops and pre-orders, picked up without waiting in line.', '{movement}', 18),
    (lay, 'restroom',      'Restroom (accessible)',    330,  30,   0,  60,  60,  96, 'Accessible, by code — and the kind of clean people notice.', '{}', 19);

  insert into public.vision_programs (lane, title, summary, why, pillars, horizon, status, emoji, sort) values
    ('Truck & events', 'The truck at events', 'Cold-extracted coffee and broth at markets, gyms and races.', 'Meet people where they already move.', '{movement,fuel}', 'now', 'live', '🚚', 1),
    ('Drops & delivery', 'Saturday drops & pickups', 'Packs reserved ahead, picked up at the drop.', 'A weekly rhythm people can plan their fuel around.', '{fuel}', 'now', 'live', '📦', 2),
    ('Drops & delivery', 'Home delivery', 'Bottles to the porch, empties back on the next run.', 'Clean fuel without a trip.', '{fuel}', 'now', 'live', '🏠', 3),
    ('Office', 'Office cold brew', 'Gallons delivered to offices on a standing schedule.', 'A better default at work than the break-room pot.', '{fuel}', 'now', 'live', '🏢', 4),
    ('Learning', 'GT3 Nutrition', 'The Return to Primal course — the four pillars free, the rest one purchase.', 'Teach why, not just sell what.', '{stillness,light,fuel,movement}', 'now', 'live', '📚', 5),
    ('Places', 'The first store', 'A GT3 Performance Bar with a door, a counter and seats.', 'A place to be every day, built on the four pillars — light, stillness, clean fuel, a reason to move.', '{stillness,light,fuel,movement}', 'next', 'planned', '🏛️', 1),
    ('Markets', 'New markets', 'The next cities, opened when each is ready.', 'Grow where the readiness checks say yes, not before.', '{movement}', 'later', 'idea', '🗺️', 1);

  select id into store from public.vision_programs where title = 'The first store' order by created_at desc limit 1;
  update public.vision_programs set layout_id = lay where id = store;
  insert into public.vision_asks (program_id, label, amount_cents, state, note, sort) values
    (store, 'Build-out', 0, 'open', 'Set the amount.', 1),
    (store, 'Equipment', 0, 'open', 'Set the amount.', 2),
    (store, 'Opening runway', 0, 'open', 'Set the amount.', 3);
end $$;

-- verify (numbers only):
--   select (select count(*) from public.vision_programs) programs, (select count(*) from public.store_items) items;   -- 7, 19 (first run)
--   select has_function_privilege('anon', 'public.vision_shared(text)', 'execute');                                    -- true
select public.record_migration('0447_the_plan_people_can_see');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0447

-- ============================================================
-- 0448_a_plan_for_every_way_in.sql
-- ============================================================
begin;   -- 0448, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
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
commit;  -- 0448
