-- ===================================================================================================
-- 0180 . DEAL PROPOSALS -- a co-authored reach-out strategy that moves through a real lifecycle
-- ===================================================================================================
-- The pipeline (0165) has a coarse stage (prospect..won/lost) and a chat thread. What the owner asked
-- for: "collaboration and editing of the proposal / reach-out strategy, moved through a lifecycle,
-- where the owner sees everything leading to the sales-engineer decision." This adds:
--   proposals        -- one per opportunity: an EDITABLE strategy doc + a lifecycle status
--                       (draft -> in_review -> sent -> negotiating -> won/lost). Co-authored by staff;
--                       won/lost is the owner's (admin) call.
--   proposal_events  -- the append-only TRAIL: every status move, who and when. No update/delete
--                       policies on purpose -- history is history, and the owner reads the whole path.
--   advance_proposal -- the one way to move the lifecycle: staff-gated, admin-gated for won/lost,
--                       logs the event, and keeps the opportunity's coarse stage in sync at milestones.
-- Strategy-doc edits stay a plain co-authored update (last-writer-wins + realtime). Tenant trio on
-- both tables (0158 rule). Idempotent.

-- -- proposals: the editable strategy + where it is in its life -------------------------------------
create table if not exists public.proposals (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  opportunity_id uuid not null unique references public.opportunities(id) on delete cascade,
  strategy       text,                        -- the co-authored reach-out strategy / proposal body
  status         text not null default 'draft'
                   check (status in ('draft','in_review','sent','negotiating','won','lost')),
  decision_note  text,                        -- the sales-engineer's note at won/lost (or any move)
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists proposals_opp on public.proposals(opportunity_id);
alter table public.proposals enable row level security;
drop policy if exists "proposals staff read" on public.proposals;
create policy "proposals staff read" on public.proposals for select using ((select public.is_staff()));
drop policy if exists "proposals staff write" on public.proposals;
create policy "proposals staff write" on public.proposals for insert with check ((select public.is_staff()));
drop policy if exists "proposals staff update" on public.proposals;
create policy "proposals staff update" on public.proposals for update using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "proposals admin delete" on public.proposals;
create policy "proposals admin delete" on public.proposals for delete using ((select public.is_admin()));
drop trigger if exists stamp_tenant_tg on public.proposals;
create trigger stamp_tenant_tg before insert on public.proposals for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.proposals;
create policy "tenant isolation" on public.proposals as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- -- proposal_events: the append-only lifecycle trail -----------------------------------------------
create table if not exists public.proposal_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  proposal_id  uuid not null references public.proposals(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  note         text,
  actor_id     uuid references public.profiles(id) on delete set null,
  at           timestamptz not null default now()
);
create index if not exists proposal_events_pid on public.proposal_events(proposal_id, at);
alter table public.proposal_events enable row level security;
-- Readable by staff; insert allowed (the RPC / trigger writes it). NO update/delete policies: the
-- trail is append-only by construction, so the decision path can never be quietly rewritten.
drop policy if exists "proposal_events staff read" on public.proposal_events;
create policy "proposal_events staff read" on public.proposal_events for select using ((select public.is_staff()));
drop policy if exists "proposal_events staff insert" on public.proposal_events;
create policy "proposal_events staff insert" on public.proposal_events for insert with check ((select public.is_staff()));
drop trigger if exists stamp_tenant_tg on public.proposal_events;
create trigger stamp_tenant_tg before insert on public.proposal_events for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.proposal_events;
create policy "tenant isolation" on public.proposal_events as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- Log the birth of a proposal (null -> draft) so the trail always starts at the beginning, whether
-- the row was created by the first strategy edit or by the first lifecycle move.
create or replace function public.log_proposal_birth() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.proposal_events(proposal_id, from_status, to_status, actor_id)
    values (new.id, null, new.status, auth.uid());
  return new;
end $$;
drop trigger if exists log_proposal_birth_tg on public.proposals;
create trigger log_proposal_birth_tg after insert on public.proposals for each row execute function public.log_proposal_birth();

-- The one way to move the lifecycle: create-if-missing, guard the transition, log it, and keep the
-- opportunity's coarse stage in step at the milestones (sent -> proposal, won -> won, lost -> lost).
create or replace function public.advance_proposal(p_opportunity uuid, p_to text, p_note text default null)
  returns public.proposals language plpgsql security definer set search_path = public as $$
declare pr public.proposals; prev text;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_to not in ('draft','in_review','sent','negotiating','won','lost') then raise exception 'bad status'; end if;
  -- won/lost is the decision -- reserved to the owner (admin), which is the whole point of the trail.
  if p_to in ('won','lost') and not public.is_admin() then raise exception 'only the owner records the decision'; end if;

  select * into pr from public.proposals where opportunity_id = p_opportunity;
  if not found then
    insert into public.proposals(opportunity_id, status, created_by, updated_by)
      values (p_opportunity, 'draft', auth.uid(), auth.uid()) returning * into pr;   -- birth logged by trigger
  end if;
  prev := pr.status;

  update public.proposals set
    status = p_to,
    decision_note = coalesce(p_note, decision_note),
    decided_by = case when p_to in ('won','lost') then auth.uid() else decided_by end,
    decided_at = case when p_to in ('won','lost') then now() else decided_at end,
    updated_by = auth.uid(), updated_at = now()
    where id = pr.id returning * into pr;

  if p_to is distinct from prev then
    insert into public.proposal_events(proposal_id, from_status, to_status, note, actor_id)
      values (pr.id, prev, p_to, p_note, auth.uid());
  end if;

  update public.opportunities set
    stage = case p_to when 'sent' then 'proposal' when 'won' then 'won' when 'lost' then 'lost' else stage end,
    won_at  = case when p_to = 'won'  then now() else won_at  end,
    lost_at = case when p_to = 'lost' then now() else lost_at end,
    updated_at = now()
    where id = p_opportunity;

  return pr;
end $$;
revoke all on function public.advance_proposal(uuid, text, text) from public, anon;

-- proposals + events ride realtime so co-authoring and the trail update live on every open device.
do $$ begin
  alter publication supabase_realtime add table public.proposals;
  alter publication supabase_realtime add table public.proposal_events;
exception when duplicate_object then null; end $$;

-- verify:
--   select count(*) from pg_policies where tablename = 'proposals';         -- 5
--   select count(*) from pg_policies where tablename = 'proposal_events';   -- 3
--   select count(*) from pg_proc where proname = 'advance_proposal';        -- 1
