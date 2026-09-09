-- A SIGNATURE IS NOT AN EDIT.
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────────────────
-- log_agreement_event() was written in 0277 and never redefined. Its status CASE covers sent,
-- changes_requested, countered, accepted, active and ended, and falls through to 'edited'.
--
-- 0309 added 'signed' to the status vocabulary — the operator types their name and the terms digest
-- is stored against it — and did not touch the logger. So the single most consequential transition
-- in the entire contract lifecycle wrote a trail row saying somebody EDITED something. The kind
-- CHECK constraint did not include 'signed' either, so this could not have been fixed in the
-- function alone.
--
-- The second half is worse and quieter. The "terms changed" branch watched exactly four columns:
--
--     supply_funding, tier, stage, package
--
-- 0287 added supply_sourcing, supply_price_basis, supply_markup_pct, spec_items.
-- 0289 added equity_eligible, equity_scope.
-- 0309 added covers, scope_basis, scope_until, hours_basis.
--
-- None of them were added to the watch list. A save that changed only what an operator COVERS, or
-- whether they are eligible for equity, or where that equity would sit, wrote NO EVENT AT ALL. The
-- agreement changed and the trail was silent.
--
-- The tell is that guard_agreement_terms() — three files later, in this same table — freezes all
-- eighteen of those columns on execution. The schema already knows which columns are contractual.
-- The logger was reading a list from before three migrations of them existed.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- 1. Adds 'signed' to the event vocabulary, so signing can be recorded as signing.
-- 2. Points the terms-changed branch at the SAME eighteen columns guard_agreement_terms freezes,
--    so "what the guard protects" and "what the trail records" are one list rather than two that
--    drifted for three migrations.
-- 3. Records WHICH terms moved, by name, in the event's own terms payload. "Edited" on its own is
--    not an audit trail; it is a timestamp with a shrug.
-- 4. Stores the digest on a signing event, so the row that says a person signed also carries the
--    hash of what they signed. v_agreement_integrity can already tell you the terms moved AFTER a
--    signature; this makes the trail itself carry the evidence rather than only the row.
--
-- Deliberately NOT changed: 'active' still logs as 'activated'. Countersigning is the only route to
-- that status, so 'activated' is already an accurate name for it, and renaming a kind that existing
-- rows may carry would make old trails and new trails mean different things.

-- ── 1) the vocabulary ──────────────────────────────────────────────────────────────────────────
-- The constraint was declared inline in 0277, so its name is whatever Postgres generated. Find it
-- by what it says rather than by a name we are guessing at.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.operator_agreement_events'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%activated%';
  if c is not null then
    execute format('alter table public.operator_agreement_events drop constraint %I', c);
  end if;
end $$;

alter table public.operator_agreement_events
  add constraint operator_agreement_events_kind_check
  check (kind in ('drafted','edited','sent','feedback','countered','accepted','signed','activated','ended'));

comment on column public.operator_agreement_events.kind is
  'What happened. ''signed'' is the operator putting their name to it; ''activated'' is GT3 countersigning, which is the only way an agreement reaches status active.';

-- ── 2) the logger, reading the guard''s list ────────────────────────────────────────────────────
create or replace function public.log_agreement_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k       text;
  changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.operator_agreement_events (agreement_id, actor, kind, to_status, terms)
    values (new.id, auth.uid(), 'drafted', new.status,
            jsonb_build_object('tier',new.tier,'stage',new.stage,'supply_funding',new.supply_funding,
                               'operator_pct',new.operator_pct,'royalty_pct',new.royalty_pct,'market_pct',new.market_pct));
    return new;
  end if;

  if new.status is distinct from old.status then
    k := case new.status
           when 'sent'              then 'sent'
           when 'changes_requested' then 'feedback'
           when 'countered'         then 'countered'
           when 'accepted'          then 'accepted'
           when 'signed'            then 'signed'      -- 0309 added the status; this is the fix
           when 'active'            then 'activated'
           when 'ended'             then 'ended'
           else 'edited' end;
  else
    -- EXACTLY the columns guard_agreement_terms() freezes on execution. If a column is contractual
    -- enough to be frozen, it is contractual enough to be logged. Keep the two lists together.
    changed := array_remove(array[
      case when new.operator_pct       is distinct from old.operator_pct       then 'operator_pct' end,
      case when new.royalty_pct        is distinct from old.royalty_pct        then 'royalty_pct' end,
      case when new.market_pct         is distinct from old.market_pct         then 'market_pct' end,
      case when new.supply_funding     is distinct from old.supply_funding     then 'supply_funding' end,
      case when new.tier               is distinct from old.tier               then 'tier' end,
      case when new.stage              is distinct from old.stage              then 'stage' end,
      case when new.package::text      is distinct from old.package::text      then 'package' end,
      case when new.market             is distinct from old.market             then 'market' end,
      case when new.supply_sourcing    is distinct from old.supply_sourcing    then 'supply_sourcing' end,
      case when new.supply_price_basis is distinct from old.supply_price_basis then 'supply_price_basis' end,
      case when new.supply_markup_pct  is distinct from old.supply_markup_pct  then 'supply_markup_pct' end,
      case when new.spec_items         is distinct from old.spec_items         then 'spec_items' end,
      case when new.equity_eligible    is distinct from old.equity_eligible    then 'equity_eligible' end,
      case when new.equity_scope       is distinct from old.equity_scope       then 'equity_scope' end,
      case when new.covers             is distinct from old.covers             then 'covers' end,
      case when new.scope_basis        is distinct from old.scope_basis        then 'scope_basis' end,
      case when new.scope_until        is distinct from old.scope_until        then 'scope_until' end,
      case when new.hours_basis        is distinct from old.hours_basis        then 'hours_basis' end
    ], null);
    if changed = '{}' or changed is null then return new; end if;  -- a note or a title is not a term
    k := 'edited';
  end if;

  insert into public.operator_agreement_events (agreement_id, actor, kind, from_status, to_status, terms)
  values (new.id, auth.uid(), k, old.status, new.status,
          jsonb_build_object(
            'tier',new.tier,'stage',new.stage,'supply_funding',new.supply_funding,
            'operator_pct',new.operator_pct,'royalty_pct',new.royalty_pct,'market_pct',new.market_pct,
            -- WHICH terms moved. "Edited" alone is a timestamp with a shrug.
            'changed', case when changed is null then null else to_jsonb(changed) end,
            -- On a signature, carry the hash of what was signed, so the trail row is evidence and
            -- not just a pointer at a row that can be read again later.
            'digest', case when k = 'signed' then new.signed_digest else null end));
  return new;
end $$;

drop trigger if exists trg_log_agreement_event on public.operator_agreements;
create trigger trg_log_agreement_event after insert or update on public.operator_agreements
  for each row execute function public.log_agreement_event();

comment on function public.log_agreement_event() is
  'Writes the agreement trail. Its terms-changed list is the same eighteen columns guard_agreement_terms freezes — if a column is contractual enough to be frozen it is contractual enough to be logged, and keeping two lists is how they drifted for three migrations.';

-- ── 3) what changed ────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The agreement history now records a signature as a signature','fix','Command',
   'When an operator signed their agreement, the history recorded it as somebody editing something — the trail was written before signing existed and was never updated. It now says signed, and carries the hash of the exact terms that were signed. Separately, and more quietly, changing what an agreement says the operator COVERS, or whether they are eligible for equity, or where that equity would sit, wrote nothing to the history at all: the trail was watching four columns while fourteen more had been added around it. It now watches every term the agreement freezes on execution, and names which ones moved.',
   '2026-09-09', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0319_a_signature_is_not_an_edit',
  'operator_agreement_events gains the ''signed'' kind; log_agreement_event() records signing as signing, watches the same eighteen columns guard_agreement_terms freezes rather than the four it was written with, names which terms moved, and carries the signed digest on a signature event.');

-- verify:
--   select kind, from_status, to_status, terms->'changed' from public.operator_agreement_events
--     order by at desc limit 5;
--   -- a term change with no status change must now produce a row:
--   --   update public.operator_agreements set covers = array['brew'] where status = 'draft';
--   --   select kind, terms->'changed' from public.operator_agreement_events order by at desc limit 1;
--   -- expect: edited, ["covers"]
