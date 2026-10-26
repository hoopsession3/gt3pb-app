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
-- pending-from: 0456
-- generated-at: 2026-10-26
-- pending-count: 6
-- ledger-read-from: hand-read from the SQL editor
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0442_the_course_is_bought_and_the_pillars_are_given.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0456_the_primal_standard_engine.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0450_what_the_market_says.sql
-- ============================================================
begin;   -- 0450, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0450 — WHAT THE MARKET SAYS ───────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R56, phase D of the investor-ready vision (Ryan, 2026-10-25: "AI do a market research and give a score of
-- success… continuous AI market research with citations, never invented… explainable scores, not probabilities").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing. Needs 0449.
--
-- WHAT.
--   vision_research — what a plan's market research found, one finding a row: its topic (demand, competition, costs,
--   the location, the rules, trends), the claim in a sentence, the figure if it has one, and where it came from — the
--   source's address (https only) and title, when the source dates itself, and when GT3 read it. A finding arrives
--   "proposed": the research route keeps only findings whose address the web search actually returned (an address the
--   model wrote that no search returned is dropped, never stored). An owner or admin accepts or rejects each one; only
--   accepted findings count in a plan's score, and every one keeps its link. Accepting says which way it bears on the
--   plan — for it, against it, or neither — a person's reading of the source, never the model's.
--   Owners and admins read and write — the research sits beside the plan's money. No link reads it (vision_shared is
--   unchanged). Every change is in Settings › Activity log.
--
-- set lock_timeout (database F16): one table made, its triggers and policies.
-- existing rows: none changed.
-- rollback: drop table vision_research cascade.
-- changelog: none — the owners' own screen.

set lock_timeout = '5s';

create table if not exists public.vision_research (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  plan_id      uuid not null references public.vision_plans(id) on delete cascade,
  run_id       uuid,
  topic        text not null check (topic in ('demand','competition','costs','location','rules','trends')),
  claim        text not null check (length(claim) between 1 and 600),
  figure       text check (figure is null or length(figure) <= 120),
  source_url   text not null check (source_url ~ '^https://' and length(source_url) <= 1000),
  source_title text check (source_title is null or length(source_title) <= 300),
  published    text check (published is null or length(published) <= 60),
  retrieved_at timestamptz not null default now(),
  status       text not null default 'proposed' check (status in ('proposed','accepted','rejected')),
  bearing      text check (bearing is null or bearing in ('for','against','neutral')),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists vision_research_plan on public.vision_research (plan_id, retrieved_at desc);

drop trigger if exists stamp_tenant_tg on public.vision_research;
create trigger stamp_tenant_tg before insert on public.vision_research for each row execute function public.stamp_tenant();
alter table public.vision_research enable row level security;
drop policy if exists "vision research admin" on public.vision_research;
create policy "vision research admin" on public.vision_research for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.vision_research;
create policy "tenant isolation" on public.vision_research as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke all on public.vision_research from public, anon, authenticated;
grant select, insert, update, delete on public.vision_research to authenticated;
drop trigger if exists admin_audit_vision_research on public.vision_research;
create trigger admin_audit_vision_research after insert or update or delete on public.vision_research for each row execute function public.log_admin_audit();

-- verify (numbers only):
--   select count(*) from public.vision_research;   -- 0 (first run)
select public.record_migration('0450_what_the_market_says');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0450

-- ============================================================
-- 0451_the_investor_case.sql
-- ============================================================
begin;   -- 0451, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0451 — THE INVESTOR CASE ──────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R57, phase E of the investor-ready vision (Ryan, 2026-10-25: "investor presentation with expiring share
-- links… everything an investor wants to see"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
-- Needs 0450.
--
-- WHAT.
--   vision_shares.money_plans / research_plans — per link, per plan, what it may show beyond the plan itself: the plan's
--   money (its approved baseline only — never the working what-ifs) and its research (accepted findings only, each with
--   its source). Nothing by default: an existing link shows exactly what it showed before. Only an owner may choose
--   (a trigger refuses anyone else, PT403) — the same owners who approve a baseline. The presenter computes the case from
--   the baseline with the one engine (lib/visionMoney), so the link and the app can't disagree.
--   vision_shared — as 0448, plus each plan's "money" and "research" where the link was given them.
--
-- set lock_timeout (database F16): two columns added (constant default — no rewrite), one trigger, one function
-- replaced (same signature).
-- existing rows: none changed (the new columns are empty for every link).
-- rollback: drop trigger vision_share_case_guard_tg on vision_shares; drop function vision_share_case_guard(); alter
--   table vision_shares drop column money_plans, drop column research_plans; re-run 0448's vision_shared.
-- changelog: none — links the owner sends.

set lock_timeout = '5s';

alter table public.vision_shares add column if not exists money_plans uuid[] not null default '{}';
alter table public.vision_shares add column if not exists research_plans uuid[] not null default '{}';

create or replace function public.vision_share_case_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and (cardinality(new.money_plans) > 0 or cardinality(new.research_plans) > 0))
     or (tg_op = 'UPDATE' and (new.money_plans is distinct from old.money_plans or new.research_plans is distinct from old.research_plans)) then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'Only an owner can choose what a link shows of the money.' using errcode = 'PT403';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.vision_share_case_guard() from public, anon, authenticated;
drop trigger if exists vision_share_case_guard_tg on public.vision_shares;
create trigger vision_share_case_guard_tg before insert or update on public.vision_shares for each row execute function public.vision_share_case_guard();

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
            join public.vision_plans w on w.id = d.needs_plan_id and w.shareable where d.plan_id = v.id), '[]'::jsonb),
        -- 0451: the plan's money, only its owner-approved baseline, only where an owner chose this link to show it.
        'money', case when v.id = any(s.money_plans) then (select jsonb_build_object('baseline', m.baseline, 'approved_at', m.baseline_at)
            from public.vision_plan_money m where m.plan_id = v.id and m.baseline is not null) end,
        -- 0451: its research — accepted findings only, each with its source — where an owner chose this link to show it.
        'research', case when v.id = any(s.research_plans) then coalesce((select jsonb_agg(jsonb_build_object(
            'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
            'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted'), '[]'::jsonb) end)
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

-- verify (numbers only):
--   select count(*) from public.vision_shares where cardinality(money_plans) > 0;   -- 0 (first run)
select public.record_migration('0451_the_investor_case');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0451

-- ============================================================
-- 0452_actual_against_the_plan.sql
-- ============================================================
begin;   -- 0452, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0452 — ACTUAL AGAINST THE PLAN ────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R58 (the financial traceability audit's gap 8: "no actual-vs-projected for a live plan"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing. Needs 0448.
--
-- WHAT.
--   vision_plans.opened_on — the day a plan opened (its month 1 starts here).
--   vision_plans.actual_channel — which of GT3's order channels records its sales (the truck's cups, pickups, delivery,
--   office, the shop), so its real months can be read from the order ledger beside the months the plan projected.
--   Both empty until an owner or admin sets them; nothing is guessed. Written under the plans' existing policies
--   (owners and admins), in the history as every plan change is. No link reads them (vision_shared is unchanged).
--
-- set lock_timeout (database F16): two columns added (nullable, no default — no rewrite).
-- existing rows: none changed.
-- rollback: alter table vision_plans drop column opened_on, drop column actual_channel.
-- changelog: none — the owners' own screen.

set lock_timeout = '5s';

alter table public.vision_plans add column if not exists opened_on date;
alter table public.vision_plans add column if not exists actual_channel text;
alter table public.vision_plans drop constraint if exists vision_plans_actual_channel;
alter table public.vision_plans add constraint vision_plans_actual_channel check (actual_channel is null or actual_channel in ('cup','pickup','delivery','office','shop'));

-- verify (numbers only):
--   select count(*) from public.vision_plans where opened_on is not null;   -- 0 (first run)
select public.record_migration('0452_actual_against_the_plan');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0452

-- ============================================================
-- 0453_research_on_a_schedule.sql
-- ============================================================
begin;   -- 0453, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0453 — RESEARCH ON A SCHEDULE ─────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R60 (Ryan, 2026-10-25: "research should refresh on demand and through configurable scheduled checks, with
-- change detection and alerts when material findings affect an initiative"). Paste into Supabase → SQL Editor → Run. A
-- second run changes nothing. Needs 0450.
--
-- WHAT.
--   vision_plans.research_every_days — how often a plan's market research is checked again: never (0), or every 30, 60
--   or 90 days. research_last_at — when it last ran; research_by — who set the schedule (the one told when a check finds
--   something new). A check runs when it's due and an owner or admin has the vision open — GT3 has no background job that
--   may spend on AI without someone there; a run finds only what's new (a source and claim already stored is not stored
--   again) and, when something is, raises one quiet alert to whoever set the schedule.
--   Written under the plans' existing policies (owners and admins), in the history as every plan change is.
--
-- set lock_timeout (database F16): three columns added (a constant default — no rewrite).
-- existing rows: none changed (every plan starts at "never").
-- rollback: alter table vision_plans drop column research_every_days, drop column research_last_at, drop column research_by.
-- changelog: none — the owners' own screen.

set lock_timeout = '5s';

alter table public.vision_plans add column if not exists research_every_days smallint not null default 0;
alter table public.vision_plans add column if not exists research_last_at timestamptz;
alter table public.vision_plans add column if not exists research_by uuid;
alter table public.vision_plans drop constraint if exists vision_plans_research_every;
alter table public.vision_plans add constraint vision_plans_research_every check (research_every_days in (0, 30, 60, 90));

-- verify (numbers only):
--   select count(*) from public.vision_plans where research_every_days > 0;   -- 0 (first run)
select public.record_migration('0453_research_on_a_schedule');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0453

-- ============================================================
-- 0454_the_plans_case_in_words.sql
-- ============================================================
begin;   -- 0454, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0454 — THE PLAN'S CASE, IN WORDS ──────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R61 (Ryan, 2026-10-25: "each roadmap initiative should have an expandable, investor-ready business case:
-- strategic objective and customer problem… target customer, addressable market, and competitive positioning… risks,
-- assumptions, mitigation strategies, and supporting evidence"). Paste into Supabase → SQL Editor → Run. A second run
-- changes nothing. Needs 0451.
--
-- WHAT.
--   vision_plans.customer / market / positioning — who it's for and the problem it solves for them, the market it serves
--   (in words; a number belongs with its source in the research), and how it stands apart. Ryan's words; nothing seeded.
--   vision_plan_risks — a plan's risks and its assumptions, one a row: what could go wrong (or what we're assuming), how
--   likely and how much it would hurt (low, medium, high), what we'd do about it, the evidence or how we'd test it, and
--   where it stands (open; a risk handled; an assumption validated or proved wrong). The crew read them with the plan;
--   owners and admins write them; every change in the history.
--   vision_shared — as 0451, plus each plan's customer, market and positioning; and its risks, with its case, only where
--   an owner chose the link to show the case.
--
-- set lock_timeout (database F16): three columns added (nullable, no default — no rewrite), one table made, one function
-- replaced (same signature).
-- existing rows: none changed.
-- rollback: drop table vision_plan_risks cascade; alter table vision_plans drop column customer, drop column market,
--   drop column positioning; re-run 0451's vision_shared.
-- changelog: none — the owners' own screen, and links the owner sends.

set lock_timeout = '5s';

alter table public.vision_plans add column if not exists customer text;
alter table public.vision_plans add column if not exists market text;
alter table public.vision_plans add column if not exists positioning text;
alter table public.vision_plans drop constraint if exists vision_plans_case_words;
alter table public.vision_plans add constraint vision_plans_case_words check (
  (customer is null or length(customer) <= 600) and (market is null or length(market) <= 1000) and (positioning is null or length(positioning) <= 600));

create table if not exists public.vision_plan_risks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  plan_id     uuid not null references public.vision_plans(id) on delete cascade,
  kind        text not null default 'risk' check (kind in ('risk','assumption')),
  words       text not null check (length(btrim(words)) between 1 and 400),
  likelihood  text check (likelihood is null or likelihood in ('low','medium','high')),
  impact      text check (impact is null or impact in ('low','medium','high')),
  mitigation  text check (mitigation is null or length(mitigation) <= 600),
  evidence    text check (evidence is null or length(evidence) <= 600),
  status      text not null default 'open' check (status in ('open','handled','validated','wrong')),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists vision_plan_risks_plan on public.vision_plan_risks (plan_id, sort);
drop trigger if exists stamp_tenant_tg on public.vision_plan_risks;
create trigger stamp_tenant_tg before insert on public.vision_plan_risks for each row execute function public.stamp_tenant();
alter table public.vision_plan_risks enable row level security;
drop policy if exists "vision staff read" on public.vision_plan_risks;
create policy "vision staff read" on public.vision_plan_risks for select using ((select public.is_staff()));
drop policy if exists "vision admin write" on public.vision_plan_risks;
create policy "vision admin write" on public.vision_plan_risks for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.vision_plan_risks;
create policy "tenant isolation" on public.vision_plan_risks as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke all on public.vision_plan_risks from public, anon, authenticated;
grant select, insert, update, delete on public.vision_plan_risks to authenticated;
drop trigger if exists admin_audit_vision_plan_risks on public.vision_plan_risks;
create trigger admin_audit_vision_plan_risks after insert or update or delete on public.vision_plan_risks for each row execute function public.log_admin_audit();

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
        -- 0454: who it's for, the market, how it stands apart — part of the plan, shown wherever the plan is.
        'customer', v.customer, 'market', v.market, 'positioning', v.positioning,
        'needs', coalesce((select jsonb_agg(jsonb_build_object('label', n.label, 'kind', n.kind, 'due_on', n.due_on, 'done_on', n.done_on, 'sort', n.sort)
            order by n.sort, n.created_at) from public.vision_plan_needs n where n.plan_id = v.id), '[]'::jsonb),
        'waits_on', coalesce((select jsonb_agg(d.needs_plan_id) from public.vision_plan_deps d
            join public.vision_plans w on w.id = d.needs_plan_id and w.shareable where d.plan_id = v.id), '[]'::jsonb),
        -- 0451: the plan's money, only its owner-approved baseline, only where an owner chose this link to show it.
        'money', case when v.id = any(s.money_plans) then (select jsonb_build_object('baseline', m.baseline, 'approved_at', m.baseline_at)
            from public.vision_plan_money m where m.plan_id = v.id and m.baseline is not null) end,
        -- 0451: its research — accepted findings only, each with its source — where an owner chose this link to show it.
        'research', case when v.id = any(s.research_plans) then coalesce((select jsonb_agg(jsonb_build_object(
            'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
            'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted'), '[]'::jsonb) end,
        -- 0454: its risks and assumptions — with the case, where an owner chose this link to show it.
        'risks', case when v.id = any(s.money_plans) then coalesce((select jsonb_agg(jsonb_build_object(
            'kind', k.kind, 'words', k.words, 'likelihood', k.likelihood, 'impact', k.impact, 'mitigation', k.mitigation,
            'evidence', k.evidence, 'status', k.status) order by k.sort, k.created_at)
          from public.vision_plan_risks k where k.plan_id = v.id), '[]'::jsonb) end)
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

-- verify (numbers only):
--   select count(*) from public.vision_plan_risks;   -- 0 (first run)
select public.record_migration('0454_the_plans_case_in_words');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0454

-- ============================================================
-- 0455_a_link_shows_what_you_chose.sql
-- ============================================================
begin;   -- 0455, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0455 — A LINK SHOWS WHAT YOU CHOSE ───────────────────────────────────────────────────────────────────────────────
-- 2026-10-26. Ryan, 2026-10-26: "every link currently shows all roadmap programs and all store layouts, not just the ones
-- you choose. Fix that as well." Paste into Supabase → SQL Editor → Run. A second run changes nothing. Needs 0454.
--
-- WHAT.
--   vision_shares.program_ids — the roadmap programs this link shows; layout_ids — the store rooms it shows. Before this,
--   vision_shared returned every program and every room in the business to anyone holding any link (plans were already
--   opt-in: only those marked shareable). Now a program, a program's asks and a room reach a link only when chosen for
--   it. A new link chooses nothing until its maker picks.
--   Existing links: on the first run only, each is given what it was evidently meant to show — the programs and rooms of
--   the plans marked to show on a link — so no live link goes blank. Programs and rooms with no shareable plan stop
--   showing. The owner can change either list on the link any time.
--   vision_shared — as 0454, with programs, program-level asks and rooms filtered by the link's choices.
--
-- set lock_timeout (database F16): two columns added (a constant default — no rewrite), one function replaced (same
-- signature).
-- existing rows: vision_shares — each existing link's two new lists set once, as above.
-- rollback: re-run 0454's vision_shared; alter table vision_shares drop column program_ids, drop column layout_ids.
-- changelog: none — links the owner sends.

set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vision_shares' and column_name = 'program_ids') then
    alter table public.vision_shares add column program_ids uuid[] not null default '{}';
    alter table public.vision_shares add column layout_ids uuid[] not null default '{}';
    -- The first run only: what each existing link was meant to show.
    update public.vision_shares s set
      program_ids = coalesce((select array_agg(distinct v.program_id) from public.vision_plans v
                               where v.tenant_id = s.tenant_id and v.shareable and v.program_id is not null), '{}'),
      layout_ids  = coalesce((select array_agg(distinct v.layout_id) from public.vision_plans v
                               where v.tenant_id = s.tenant_id and v.shareable and v.layout_id is not null), '{}');
  end if;
end $$;

-- vision_shared, filtered by what the link was given.
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
      from public.vision_programs p where p.tenant_id = s.tenant_id and p.id = any(s.program_ids)), '[]'::jsonb),
    -- 0455: the programs this link was given, and no others.
    'asks', case when s.show_asks then coalesce((select jsonb_agg(jsonb_build_object(
        'program_id', a.program_id, 'plan_id', a.plan_id, 'label', a.label, 'amount_cents', a.amount_cents, 'state', a.state,
        'note', a.note, 'sort', a.sort) order by a.sort, a.created_at)
      from public.vision_asks a
      where a.tenant_id = s.tenant_id
        -- 0455: an ask on a program shows only with that program; an ask on a plan, only with a plan marked to show.
        and ((a.plan_id is null and a.program_id = any(s.program_ids)) or exists (select 1 from public.vision_plans x where x.id = a.plan_id and x.shareable))), '[]'::jsonb)
      else '[]'::jsonb end,
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'program_id', v.program_id, 'name', v.name, 'format', v.format, 'phase', v.phase, 'status', v.status,
        'sqft', v.sqft, 'deal', v.deal, 'place', v.place, 'summary', v.summary, 'why', v.why, 'gate', v.gate,
        'layout_id', v.layout_id, 'sort', v.sort,
        -- 0454: who it's for, the market, how it stands apart — part of the plan, shown wherever the plan is.
        'customer', v.customer, 'market', v.market, 'positioning', v.positioning,
        'needs', coalesce((select jsonb_agg(jsonb_build_object('label', n.label, 'kind', n.kind, 'due_on', n.due_on, 'done_on', n.done_on, 'sort', n.sort)
            order by n.sort, n.created_at) from public.vision_plan_needs n where n.plan_id = v.id), '[]'::jsonb),
        'waits_on', coalesce((select jsonb_agg(d.needs_plan_id) from public.vision_plan_deps d
            join public.vision_plans w on w.id = d.needs_plan_id and w.shareable where d.plan_id = v.id), '[]'::jsonb),
        -- 0451: the plan's money, only its owner-approved baseline, only where an owner chose this link to show it.
        'money', case when v.id = any(s.money_plans) then (select jsonb_build_object('baseline', m.baseline, 'approved_at', m.baseline_at)
            from public.vision_plan_money m where m.plan_id = v.id and m.baseline is not null) end,
        -- 0451: its research — accepted findings only, each with its source — where an owner chose this link to show it.
        'research', case when v.id = any(s.research_plans) then coalesce((select jsonb_agg(jsonb_build_object(
            'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
            'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted'), '[]'::jsonb) end,
        -- 0454: its risks and assumptions — with the case, where an owner chose this link to show it.
        'risks', case when v.id = any(s.money_plans) then coalesce((select jsonb_agg(jsonb_build_object(
            'kind', k.kind, 'words', k.words, 'likelihood', k.likelihood, 'impact', k.impact, 'mitigation', k.mitigation,
            'evidence', k.evidence, 'status', k.status) order by k.sort, k.created_at)
          from public.vision_plan_risks k where k.plan_id = v.id), '[]'::jsonb) end)
        order by v.phase, v.sort, v.created_at)
      from public.vision_plans v where v.tenant_id = s.tenant_id and v.shareable), '[]'::jsonb),
    'layouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', l.name, 'width_in', l.width_in, 'depth_in', l.depth_in, 'ceiling_in', l.ceiling_in, 'notes', l.notes,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'kind', i.kind, 'label', i.label, 'x_in', i.x_in, 'y_in', i.y_in, 'rot', i.rot,
            'w_in', i.w_in, 'd_in', i.d_in, 'h_in', i.h_in, 'why', i.why, 'pillars', i.pillars, 'sort', i.sort) order by i.sort, i.created_at)
          from public.store_items i where i.layout_id = l.id), '[]'::jsonb)) order by l.created_at)
      from public.store_layouts l where l.tenant_id = s.tenant_id and l.id = any(s.layout_ids)), '[]'::jsonb)
    -- 0455: the rooms this link was given, and no others.
  );
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

-- verify (numbers only):
--   select count(*) from public.vision_shares where cardinality(program_ids) = 0 and cardinality(layout_ids) = 0;
select public.record_migration('0455_a_link_shows_what_you_chose');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0455
