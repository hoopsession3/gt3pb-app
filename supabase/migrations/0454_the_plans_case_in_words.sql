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
