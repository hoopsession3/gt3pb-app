-- ── 0458 — WHAT WAS APPROVED STAYS APPROVED ──────────────────────────────────────────────────────────────────────────
-- 2026-10-27. The consolidated baseline challenge (F7, F8): an investor link read the plan's baseline, research and risks
-- LIVE — approving new numbers silently changed what an investor had already been sent — and approving a baseline wrote
-- over the one before, so an earlier approved plan could not be read back. Ryan: "Never rewrite an earlier approved
-- plan… Ensure investor links reference immutable approved snapshots." Paste into Supabase → SQL Editor → Run. A second
-- run changes nothing. Needs 0455.
--
-- WHAT.
--   vision_plan_versions — one row per approval, written by the database when a baseline is approved (or an owner's
--   acknowledgement is recorded with it): the baseline, the case in words, the accepted research and the risks as they
--   stood. Never updated, never deleted (a trigger refuses both, for everyone). Owners and admins read them.
--   vision_shares.pinned_at — the moment a link's case is fixed at. A new link is pinned when it's made; only an owner can
--   move the pin ("update to the latest approval").
--   vision_shared — as 0455, but each plan's money, risks, case words and research come from the latest version approved
--   at or before the pin. The roadmap around the case (status, needs, rooms, asks) stays as it is now.
--   Existing plans with a baseline get version 1 (approved when their baseline was; research and risks as of this run).
--   Existing links are pinned to this run, so each keeps showing exactly what it showed.
--
-- set lock_timeout (database F16): one table, one column with no rewrite (nullable, then backfilled), three triggers,
-- one function replaced (same signature).
-- existing rows: vision_plan_versions — one per approved baseline; vision_shares — pinned_at set once.
-- rollback: re-run 0455's vision_shared; drop trigger vision_money_version_tg on vision_plan_money; drop table
--   vision_plan_versions; alter table vision_shares drop column pinned_at.
-- changelog: none — the owner's plans and links.

set lock_timeout = '5s';

create table if not exists public.vision_plan_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  -- No foreign key on purpose: an approved version outlives the plan it was approved for.
  plan_id     uuid not null,
  version     int  not null check (version >= 1),
  baseline    jsonb not null check (jsonb_typeof(baseline) = 'object' and baseline ? 'scenarios' and baseline ? 'structure'),
  plan        jsonb not null default '{}'::jsonb,
  research    jsonb not null default '[]'::jsonb,
  risks       jsonb not null default '[]'::jsonb,
  approved_at timestamptz not null default now(),
  approved_by uuid,
  created_at  timestamptz not null default now(),
  unique (plan_id, version)
);
create index if not exists vision_plan_versions_plan on public.vision_plan_versions (plan_id, version desc);

-- Never rewritten: no update, no delete — for an owner, an admin or the service role alike.
create or replace function public.vision_version_frozen()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'An approved version is never changed or removed — approve a new one.' using errcode = 'PT403';
end $$;
drop trigger if exists vision_version_frozen_tg on public.vision_plan_versions;
create trigger vision_version_frozen_tg before update or delete on public.vision_plan_versions for each row execute function public.vision_version_frozen();

alter table public.vision_plan_versions enable row level security;
drop policy if exists "vision versions admin read" on public.vision_plan_versions;
create policy "vision versions admin read" on public.vision_plan_versions for select using ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.vision_plan_versions;
create policy "tenant isolation" on public.vision_plan_versions as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke all on public.vision_plan_versions from public, anon, authenticated;
grant select on public.vision_plan_versions to authenticated;

-- The snapshot of a plan at an approval: its case in words, its accepted research, its risks. One function, used by the
-- trigger and the backfill, so the two can't differ.
create or replace function public.vision_version_write(p_plan uuid, p_baseline jsonb, p_at timestamptz, p_by uuid, p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.vision_plan_versions (tenant_id, plan_id, version, baseline, plan, research, risks, approved_at, approved_by)
  select coalesce(p_tenant, v.tenant_id), p_plan,
    coalesce((select max(x.version) from public.vision_plan_versions x where x.plan_id = p_plan), 0) + 1,
    p_baseline,
    jsonb_build_object('name', v.name, 'format', v.format, 'deal', v.deal, 'place', v.place, 'summary', v.summary, 'why', v.why,
      'gate', v.gate, 'customer', v.customer, 'market', v.market, 'positioning', v.positioning),
    coalesce((select jsonb_agg(jsonb_build_object(
        'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
        'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
      from public.vision_research r where r.plan_id = p_plan and r.status = 'accepted'), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'kind', k.kind, 'words', k.words, 'likelihood', k.likelihood, 'impact', k.impact, 'mitigation', k.mitigation,
        'evidence', k.evidence, 'status', k.status) order by k.sort, k.created_at)
      from public.vision_plan_risks k where k.plan_id = p_plan), '[]'::jsonb),
    coalesce(p_at, now()), p_by
  from public.vision_plans v where v.id = p_plan;
end $$;
revoke all on function public.vision_version_write(uuid, jsonb, timestamptz, uuid, uuid) from public, anon, authenticated;

-- Every approval is a version. 0449's guard has already refused a non-owner and stamped who and when.
create or replace function public.vision_money_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.baseline is not null and (tg_op = 'INSERT' or new.baseline is distinct from old.baseline) then
    perform public.vision_version_write(new.plan_id, new.baseline, new.baseline_at, new.baseline_by, new.tenant_id);
  end if;
  return null;
end $$;
revoke all on function public.vision_money_version() from public, anon, authenticated;
drop trigger if exists vision_money_version_tg on public.vision_plan_money;
create trigger vision_money_version_tg after insert or update on public.vision_plan_money for each row execute function public.vision_money_version();

-- Backfill: a plan approved before this migration gets version 1, dated when its baseline was approved.
do $$
declare m record;
begin
  for m in select * from public.vision_plan_money mm where mm.baseline is not null
             and not exists (select 1 from public.vision_plan_versions x where x.plan_id = mm.plan_id) loop
    perform public.vision_version_write(m.plan_id, m.baseline, m.baseline_at, m.baseline_by, m.tenant_id);
  end loop;
end $$;

-- The pin. Existing links: this run (they keep showing what they showed). A new link: the moment it's made.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vision_shares' and column_name = 'pinned_at') then
    alter table public.vision_shares add column pinned_at timestamptz;
    update public.vision_shares set pinned_at = now();
    alter table public.vision_shares alter column pinned_at set default now();
    alter table public.vision_shares alter column pinned_at set not null;
  end if;
end $$;

-- Only an owner moves a pin; anyone who makes a link pins it to the moment it's made.
create or replace function public.vision_share_pin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_owner() then new.pinned_at := now(); end if;
    if new.pinned_at is null or new.pinned_at > now() then new.pinned_at := now(); end if;
  elsif new.pinned_at is distinct from old.pinned_at then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'Only an owner can move what a link shows to a newer approval.' using errcode = 'PT403';
    end if;
    if new.pinned_at > now() then new.pinned_at := now(); end if;
  end if;
  return new;
end $$;
revoke all on function public.vision_share_pin_guard() from public, anon, authenticated;
drop trigger if exists vision_share_pin_guard_tg on public.vision_shares;
create trigger vision_share_pin_guard_tg before insert or update on public.vision_shares for each row execute function public.vision_share_pin_guard();

-- vision_shared, the case from the pinned version.
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
    -- 0458: the case this link shows is the one approved by this moment — an approval after it doesn't change the link.
    'pinned_at', s.pinned_at,
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
        -- 0454: who it's for, the market, how it stands apart. 0458: as approved with the pinned version, when there is one.
        'customer', coalesce(pv.plan->>'customer', v.customer), 'market', coalesce(pv.plan->>'market', v.market),
        'positioning', coalesce(pv.plan->>'positioning', v.positioning),
        'needs', coalesce((select jsonb_agg(jsonb_build_object('label', n.label, 'kind', n.kind, 'due_on', n.due_on, 'done_on', n.done_on, 'sort', n.sort)
            order by n.sort, n.created_at) from public.vision_plan_needs n where n.plan_id = v.id), '[]'::jsonb),
        'waits_on', coalesce((select jsonb_agg(d.needs_plan_id) from public.vision_plan_deps d
            join public.vision_plans w on w.id = d.needs_plan_id and w.shareable where d.plan_id = v.id), '[]'::jsonb),
        -- 0451: the plan's money, only its owner-approved baseline, only where an owner chose this link to show it.
        -- 0458: the approved VERSION in force when the link was pinned — never the baseline as it stands now.
        'money', case when v.id = any(s.money_plans) and pv.id is not null then jsonb_build_object('baseline', pv.baseline, 'approved_at', pv.approved_at, 'version', pv.version) end,
        -- 0451: its research — accepted findings only, each with its source — where an owner chose this link to show it.
        -- 0458: the findings accepted when the pinned version was approved; with no version, those read by the pin.
        'research', case when v.id = any(s.research_plans) then coalesce(pv.research, (select jsonb_agg(jsonb_build_object(
            'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
            'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted' and r.retrieved_at <= s.pinned_at), '[]'::jsonb) end,
        -- 0454: its risks and assumptions — with the case, where an owner chose this link to show it.
        -- 0458: the risks as they stood at the pinned approval.
        'risks', case when v.id = any(s.money_plans) and pv.id is not null then pv.risks end)
        order by v.phase, v.sort, v.created_at)
      from public.vision_plans v
      -- 0458: each plan's latest approved version at or before the link's pin (none if it wasn't approved by then).
      left join lateral (select x.* from public.vision_plan_versions x
                          where x.plan_id = v.id and x.approved_at <= s.pinned_at order by x.version desc limit 1) pv on true
      where v.tenant_id = s.tenant_id and v.shareable), '[]'::jsonb),
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
--   select count(*) from public.vision_plan_versions;                       -- one per approved baseline
--   select count(*) from public.vision_shares where pinned_at is null;      -- 0
select public.record_migration('0458_what_was_approved_stays_approved');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
