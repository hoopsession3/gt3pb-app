-- 0325 — A draft nobody has seen is not a record.
--
-- Ryan tapped "Draft employee contract", landed on a form, and left a stub behind:
--   greenville / draft / associate / ramp / 50-0-50 / made 2026-09-07
-- It cannot be removed. Not "there is no button" — there is no PATH. Two independent rules close
-- the door from both sides:
--
--   the database   0277 puts a BEFORE DELETE guard on operator_agreements: "an agreement is
--                  ENDED, never deleted, so what was agreed stays answerable."
--   the app        lib/operatorDeal FLOW.draft = ['sent'] — the only move out of draft is to
--                  send it to somebody.
--
-- Both rules are RIGHT about the thing they were written for. An executed agreement is a legal
-- record and deleting one is not a feature. But 0308 already worked out that this is the wrong
-- question, and said so in its own header: every row is DELETE (it never happened and nothing
-- depends on it), DISCARD (it happened, or something points at it), or NEVER (money, stock, a
-- legal record) — "the mistake this migration corrects is that the code did not know which was
-- which." 0308 fixed that for brew batches and nineteen money tables. It did not come back for
-- agreements, so agreements still get the NEVER treatment uniformly, including for a draft that
-- exists only because a button was tapped once.
--
-- A draft that has never been sent has no counterparty, no signature, no digest, and no event in
-- its own trail except the one saying it was drafted. There is nothing to stay answerable about.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────────────────────────
-- 'voided' — the honest end state for a proposal that dies before anyone agrees to it. NOT
-- 'ended': ended means a live agreement finished, and filing a withdrawn proposal there would make
-- the operator history read as if a deal had run and concluded. Terminal, like ended.
--
-- discard_agreement() — the same shape as discard_batch (0308): THE FUNCTION PICKS THE OUTCOME,
-- not the caller. A never-sent draft is deleted outright; anything the other side has seen, or
-- that another agreement supersedes, is kept and marked voided. A caller who could choose would
-- eventually choose wrong on the row where it mattered.

-- ── 1) the vocabulary ──────────────────────────────────────────────────────────────────────────
alter table public.operator_agreements drop constraint if exists operator_agreements_status_check;
alter table public.operator_agreements add constraint operator_agreements_status_check
  check (status in ('draft','sent','changes_requested','countered','accepted','signed','active','ended','voided'));

alter table public.operator_agreements
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

comment on column public.operator_agreements.voided_at is
  'When this proposal was withdrawn. Distinct from ended_at: ended means an agreement ran and finished, voided means it never took effect.';

-- ── 2) the one way out ─────────────────────────────────────────────────────────────────────────
-- Admin-gated to match the table policy ("agreements admin all"). The operator can respond to a
-- proposal (respond_to_agreement, 0277) but cannot make one disappear.
create or replace function public.discard_agreement(p_agreement uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_left_draft boolean;
  v_superseded int;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can discard an agreement.';
  end if;

  select status into v_status from public.operator_agreements where id = p_agreement for update;
  if not found then
    raise exception 'That agreement is already gone.';
  end if;

  -- Once someone has said yes, this is no longer a proposal. 'ended' is the move for those, and it
  -- is deliberately not reachable from here: unwinding an executed agreement is a different act
  -- with different consequences, and it should not share a button with clearing a typo.
  if v_status in ('accepted','signed','active','ended','voided') then
    raise exception 'This agreement is % — that is past the point a proposal can be withdrawn. End it instead.', v_status;
  end if;

  -- HAS ANYONE SEEN IT? The trail answers this and nothing else does: the status column only says
  -- where the agreement is NOW, so a proposal that was sent, read, and walked back to draft looks
  -- identical to one that was never sent at all. 0277's trigger writes an event on every status
  -- change, so a draft nobody has seen has exactly one row, and its to_status is 'draft'.
  select exists (
    select 1 from public.operator_agreement_events e
     where e.agreement_id = p_agreement
       and e.to_status is distinct from 'draft'
  ) into v_left_draft;

  select count(*) into v_superseded
    from public.operator_agreements a where a.supersedes_id = p_agreement;

  if v_left_draft or v_superseded > 0 then
    update public.operator_agreements
       set status = 'voided',
           voided_at = now(),
           voided_by = auth.uid(),
           void_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = p_agreement;
    return 'voided';
  end if;

  -- Never sent, nothing points at it. agreement_hours and operator_agreement_events cascade; the
  -- guard from 0277 is stood down for THIS STATEMENT ONLY (the third argument to set_config is
  -- is_local = true, so it expires with the transaction rather than leaking into the session).
  perform set_config('gt3.allow_hard_delete', 'on', true);
  delete from public.operator_agreements where id = p_agreement;
  perform set_config('gt3.allow_hard_delete', '', true);
  return 'deleted';
end $$;

revoke all on function public.discard_agreement(uuid, text) from public, anon;
grant execute on function public.discard_agreement(uuid, text) to authenticated;

comment on function public.discard_agreement(uuid, text) is
  'Remove a proposal that should not exist. Deletes it outright when it never left draft and nothing supersedes it; otherwise keeps the row and marks it voided so the negotiation trail stays readable. Refuses once an agreement has been accepted. Returns deleted or voided.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A draft agreement made by mistake can be thrown away','fix','Money',
   'Tapping "Draft employee contract" and changing your mind used to leave a permanent half-filled agreement on the operator list, because the only move out of draft was to send it to someone. A draft nobody has ever seen can now be discarded outright; one that has been sent is kept and marked withdrawn, so the other side''s copy still makes sense.',
   '2026-09-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0325_a_draft_nobody_has_seen',
  'voided status + discard_agreement(). 0277 guards agreement deletes and FLOW.draft = [sent], so a draft created by a mis-tap was permanent by two independent rules. 0308 had already drawn the DELETE/DISCARD/NEVER distinction and never came back for agreements. The function picks: never-sent draft deletes, anything seen or superseded voids, accepted or later refuses.');

-- verify:
--   select public.discard_agreement('<the greenville stub id>');   -- expect: deleted
--   select id, status from public.operator_agreements order by created_at;
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.operator_agreements'::regclass and conname like '%status%';
