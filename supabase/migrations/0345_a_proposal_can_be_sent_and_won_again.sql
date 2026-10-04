-- ── A PROPOSAL CAN BE SENT, AND WON, AGAIN ───────────────────────────────────────────────────
-- 2026-10-04. Found by the form audit, tracing where a proposal's decision goes.
--
-- ── WHAT WAS TRUE ──────────────────────────────────────────────────────────────────────────────
-- advance_proposal() (0180) keeps the account's coarse stage in step with its proposal: sent →
-- 'proposal', won → 'won', lost → 'lost'. 0265 moved the pipeline onto the Playbook's enum —
-- lead · warm · sampled · pilot · live · expand · lost — migrated every row ('proposal' →
-- 'sampled', 'won' → 'live') and locked the check. It did not restate advance_proposal. So "Mark
-- sent" and "Mark won" on the proposal desk each try to write a stage the check refuses, and the
-- whole call rolls back: the proposal stays where it was, and the desk shows an error. Only "Mark
-- lost" works. And a lost decision's note lands on the proposal, never on the account card's
-- "Lost:" line, which reads opportunities.lost_reason.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- Restates advance_proposal verbatim from 0180 with the stage written in 0265's words, forward only,
-- and the lost note carried to lost_reason (when one is given; an empty note keeps what was there).
-- Nothing else about the function changes: who may record a decision, the trail, the birth row.

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

  -- The account's stage follows the proposal FORWARD on the Playbook's enum (0265): sent moves a
  -- lead or a warm account to sampled (0265 mapped 'proposal' to 'sampled'), won makes it live
  -- (0265: won → live, won_at "stamped when an account goes live"), lost is lost — with the
  -- decision's words as the reason the account card prints. A proposal never moves an account
  -- backward: an account already piloting that is sent a proposal stays piloting.
  update public.opportunities set
    stage = case
      when p_to = 'sent' and stage in ('lead','warm') then 'sampled'
      when p_to = 'won'  and stage not in ('live','expand') then 'live'
      when p_to = 'lost' then 'lost'
      else stage end,
    won_at  = case when p_to = 'won' and stage not in ('live','expand') then now() else won_at end,
    lost_at = case when p_to = 'lost' then now() else lost_at end,
    lost_reason = case when p_to = 'lost' then coalesce(nullif(btrim(coalesce(p_note, '')), ''), lost_reason) else lost_reason end,
    updated_at = now()
    where id = p_opportunity;

  return pr;
end $$;
revoke all on function public.advance_proposal(uuid, text, text) from public, anon;


-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Proposals can be marked sent and won again','fix','Pipeline',
   'Since the pipeline moved onto the Playbook''s stages in August, marking a proposal sent or won failed: it tried to move the account to a stage that no longer exists. Sent now moves a lead or warm account to sampled, won makes it live, lost is lost with your note as the reason on the account card — and a proposal never moves an account backward.',
   '2026-10-04', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0345_a_proposal_can_be_sent_and_won_again',
  'advance_proposal restated from 0180: opportunities.stage on the 0265 enum, forward only — sent: lead/warm -> sampled; won: -> live unless live/expand (won_at with it); lost: -> lost with lost_reason = the decision note when one is given. 0180 wrote proposal/won, which 0265''s check refuses, so Mark sent and Mark won rolled back since 0265.');

-- verify:
--   select prosrc like '%sampled%' from pg_proc where proname = 'advance_proposal';   -- t
