-- 0309 — What you actually agreed to, and what it cost you to do it.
--
-- Ryan: "operators may brew as well, deliver until we can become profitable and staff accordingly.
-- Hours invested. Allow me to edit and build agreement, stamp and sign off approve when done."
--
-- Four things are missing, and they are missing together because they are one idea.
--
--   SCOPE      The agreement says what an operator EARNS and never what they DO. There is no
--              duties field anywhere in this database. An operator who is also brewing and also
--              driving has agreed to something the record cannot express.
--   THE END    And that scope is temporary on purpose — it holds until the market can fund a
--              brewer and a driver of its own. The condition that RETIRES the extra work is the
--              part people forget to write down, and it is the whole reason someone agrees to it.
--   HOURS      Nothing anywhere in this app records how long anyone worked. Not one column.
--              "Hours invested" is unanswerable today, for anybody, at any time.
--   SIGNATURE  0281 says it plainly: "this records agreement, it is not an e-signature product."
--              0277 does not even have a signature column. accepted_at is a click by an
--              authenticated user, and the company side is not recorded at all.
--
-- THE ONE THING A SIGNATURE HAS TO DO is bind to what was signed. A name plus a timestamp on a row
-- somebody can still edit is worse than no signature: it looks like proof and is not. So signing
-- digests the exact terms and stores the digest. If a term changes afterwards, the digest stops
-- matching and v_agreement_integrity says so, in words, without anyone having to remember.
--
-- STILL NOT AN E-SIGNATURE PRODUCT, and this migration does not pretend otherwise. It records a
-- typed name, by an authenticated account, at a time, against a digest of specific terms. Whether
-- that is sufficient execution for any given agreement is a question for counsel, not for me. The
-- terms themselves stay Ryan's words: nothing here writes legal language.

-- ── 1) WHAT THIS OPERATOR ACTUALLY COVERS ──────────────────────────────────────────────────────
-- Not a role. Roles are permissions — who can open which screen — and they were never meant to
-- carry duties. This is a list of activities, held on a stated basis, with a stated end.
alter table public.operator_agreements
  add column if not exists covers        text[] not null default '{}',
  add column if not exists scope_basis   text not null default 'standing'
    check (scope_basis in ('standing','interim')),
  add column if not exists scope_until   text,
  add column if not exists hours_basis   text not null default 'not_tracked'
    check (hours_basis in ('not_tracked','logged_for_record','logged_toward_equity','logged_billable')),
  add column if not exists hours_note    text;

comment on column public.operator_agreements.covers is
  'The activities this operator actually performs — serve, brew, deliver, and so on. Roles grant access; this records duties, which nothing in the database did before.';
comment on column public.operator_agreements.scope_basis is
  'standing = this is the job. interim = they are covering work the market cannot yet staff, and scope_until says what ends it.';
comment on column public.operator_agreements.scope_until is
  'The condition that retires the interim scope, in plain words: "until Greenville clears $X/month and funds a dedicated driver". Deliberately free text — a date would be a guess, and a guess in an agreement is a broken promise waiting to happen.';
comment on column public.operator_agreements.hours_basis is
  'What logged hours are FOR. Recording hours without saying what they count toward is how a sweat-equity argument starts two years later with both sides sure they were right.';

-- An interim scope with no stated end is the failure mode this column exists to prevent, so the
-- database refuses it rather than letting it pass as filled in.
alter table public.operator_agreements drop constraint if exists operator_agreements_interim_needs_end;
alter table public.operator_agreements add constraint operator_agreements_interim_needs_end
  check (scope_basis <> 'interim' or coalesce(btrim(scope_until), '') <> '');

-- The vocabulary lands in option_sets (0306), so Ryan edits it from the Lists panel without a
-- deploy — the whole point of moving the closed vocabularies there in the first place.
insert into public.option_sets (set_key, value, label, sort, note)
select 'agreement_activity', v.value, v.label, v.sort, v.note from (values
  ('serve','Serving and events',10,null),
  ('brew','Brewing',20,'Interim for most operators until a market funds a dedicated brewer.'),
  ('deliver','Delivery driving',30,'Interim for most operators until a market funds a dedicated driver.'),
  ('prep','Prep and pack-out',40,null),
  ('sourcing','Buying and supply runs',50,null),
  ('maintenance','Rig and equipment upkeep',60,null),
  ('market_lead','Leading the market',70,'Requires operator or above — the same rule set_market_lead enforces.'),
  ('sales','Selling accounts',80,null)
) as v(value, label, sort, note)
where not exists (select 1 from public.option_sets o
                   where o.set_key = 'agreement_activity' and o.value = v.value);

-- ── 2) HOURS INVESTED ──────────────────────────────────────────────────────────────────────────
-- Attached to the agreement AND to an activity, because the flat number cannot answer the question
-- anybody actually asks. "Two hundred hours" settles nothing. "Two hundred hours, of which a
-- hundred and forty were brewing and driving that the agreement calls interim" settles a lot.
create table if not exists public.agreement_hours (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  agreement_id  uuid not null references public.operator_agreements(id) on delete cascade,
  on_date       date not null default current_date,
  activity      text not null,
  hours         numeric not null check (hours > 0 and hours <= 24),
  note          text,
  logged_by     uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  -- one entry per person per activity per day: a second entry for the same shift is a duplicate,
  -- and a duplicate in an hours record is the thing that discredits the whole record.
  unique (agreement_id, on_date, activity)
);

create index if not exists agreement_hours_agreement_idx on public.agreement_hours (agreement_id, on_date desc);

alter table public.agreement_hours enable row level security;

-- The operator logs their OWN hours and the owner can see and correct them. An hours record the
-- person who worked cannot write is a timesheet somebody else remembers for them.
drop policy if exists agreement_hours_read on public.agreement_hours;
create policy agreement_hours_read on public.agreement_hours for select
  using (public.is_admin() or exists (select 1 from public.operator_agreements a
          where a.id = agreement_id and a.operator_user_id = (select auth.uid())));

drop policy if exists agreement_hours_write on public.agreement_hours;
create policy agreement_hours_write on public.agreement_hours for insert
  with check (public.is_admin() or exists (select 1 from public.operator_agreements a
               where a.id = agreement_id and a.operator_user_id = (select auth.uid())));

drop policy if exists agreement_hours_edit on public.agreement_hours;
create policy agreement_hours_edit on public.agreement_hours for update
  using (public.is_admin() or exists (select 1 from public.operator_agreements a
          where a.id = agreement_id and a.operator_user_id = (select auth.uid())))
  with check (public.is_admin() or exists (select 1 from public.operator_agreements a
               where a.id = agreement_id and a.operator_user_id = (select auth.uid())));

drop policy if exists agreement_hours_delete on public.agreement_hours;
create policy agreement_hours_delete on public.agreement_hours for delete
  using (public.is_admin() or exists (select 1 from public.operator_agreements a
          where a.id = agreement_id and a.operator_user_id = (select auth.uid())));

grant select, insert, update, delete on public.agreement_hours to authenticated;

comment on table public.agreement_hours is
  'Hours invested against an agreement, by activity and by day. The operator logs their own; an owner can see and correct them. Nothing in this app recorded hours before — not one column anywhere.';

-- the rollup, so nobody sums it by hand
create or replace view public.v_agreement_hours as
select a.id as agreement_id,
       a.operator_name,
       a.market,
       a.scope_basis,
       a.hours_basis,
       coalesce(sum(h.hours), 0) as hours_total,
       coalesce(sum(h.hours) filter (where h.activity = any (a.covers)), 0) as hours_in_scope,
       coalesce(sum(h.hours) filter (where a.scope_basis = 'interim'
                                       and h.activity in ('brew','deliver')), 0) as hours_on_interim_work,
       count(distinct h.on_date) as days_worked,
       min(h.on_date) as first_day,
       max(h.on_date) as last_day
  from public.operator_agreements a
  left join public.agreement_hours h on h.agreement_id = a.id
 group by a.id, a.operator_name, a.market, a.scope_basis, a.hours_basis, a.covers;

revoke all on public.v_agreement_hours from public, anon;
grant select on public.v_agreement_hours to authenticated;

comment on view public.v_agreement_hours is
  'Hours per agreement, split out by whether the work was the interim brewing and driving the agreement describes as temporary. That split is the number the conversation is actually about.';

-- ── 3) SIGNING, AND WHAT IT BINDS TO ───────────────────────────────────────────────────────────
alter table public.operator_agreements
  add column if not exists signed_name        text,
  add column if not exists signed_by          uuid references auth.users(id),
  add column if not exists signed_at          timestamptz,
  add column if not exists signed_digest      text,
  add column if not exists countersigned_name text,
  add column if not exists countersigned_by   uuid references auth.users(id),
  add column if not exists countersigned_at   timestamptz,
  add column if not exists supersedes_id      uuid references public.operator_agreements(id) on delete set null;

create index if not exists operator_agreements_supersedes_idx on public.operator_agreements (supersedes_id);

comment on column public.operator_agreements.signed_digest is
  'SHA-256 of the exact terms at the moment of signing. A name and a timestamp on a row somebody can still edit is worse than no signature — it looks like proof. This is what makes the signature checkable afterwards.';

-- The digest is a pure function of the terms, defined once so signing and verifying can never
-- disagree about what "the terms" means — which is the only way this check is worth anything.
create or replace function public.agreement_digest(p public.operator_agreements)
returns text language sql immutable as $$
  select encode(sha256(convert_to(concat_ws('|',
    p.market, p.operator_name, p.tier, p.stage,
    p.supply_funding::text, p.operator_pct::text, p.royalty_pct::text, p.market_pct::text,
    coalesce(p.package::text, '[]'),
    array_to_string(coalesce(p.covers, '{}'), ','),
    p.scope_basis, coalesce(p.scope_until, ''),
    p.hours_basis,
    coalesce(p.supply_sourcing, ''), coalesce(p.supply_price_basis, ''),
    coalesce(p.supply_markup_pct::text, ''),
    array_to_string(coalesce(p.spec_items, '{}'), ','),
    coalesce(p.equity_eligible::text, ''), coalesce(p.equity_scope, ''),
    coalesce(p.starts_on::text, ''), coalesce(p.ends_on::text, '')
  ), 'utf8')), 'hex')
$$;

comment on function public.agreement_digest(public.operator_agreements) is
  'The terms, as one string, hashed. Defined once so signing and verifying can never disagree about what "the terms" means.';

-- 'signed' joins the vocabulary. accepted = said yes. signed = put their name on it.
-- active = GT3 countersigned and it is in force. Three distinct facts that were one before.
alter table public.operator_agreements drop constraint if exists operator_agreements_status_check;
alter table public.operator_agreements add constraint operator_agreements_status_check
  check (status in ('draft','sent','changes_requested','countered','accepted','signed','active','ended'));

create or replace function public.sign_agreement(p_id uuid, p_typed_name text)
returns public.operator_agreements
language plpgsql security definer set search_path = public as $$
declare a public.operator_agreements;
begin
  select * into a from public.operator_agreements where id = p_id for update;
  if not found then raise exception 'That agreement no longer exists.'; end if;
  if not (a.operator_user_id = auth.uid() or public.is_admin()) then
    raise exception 'Only the operator this agreement is for can sign it.';
  end if;
  if a.status <> 'accepted' then
    raise exception 'An agreement is signed after it is accepted (this one is %).', a.status;
  end if;
  if coalesce(btrim(p_typed_name), '') = '' then
    raise exception 'Type your full name to sign.';
  end if;

  update public.operator_agreements
     set status = 'signed',
         signed_name = btrim(p_typed_name),
         signed_by = auth.uid(),
         signed_at = now(),
         signed_digest = public.agreement_digest(a)
   where id = p_id returning * into a;
  return a;
end $$;

revoke all on function public.sign_agreement(uuid, text) from public, anon;
grant execute on function public.sign_agreement(uuid, text) to authenticated;

-- THE COMPANY SIDE, WHICH NOTHING RECORDED. Not who clicked send — who executed it.
create or replace function public.countersign_agreement(p_id uuid, p_typed_name text)
returns public.operator_agreements
language plpgsql security definer set search_path = public as $$
declare a public.operator_agreements;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can countersign for GT3.';
  end if;
  select * into a from public.operator_agreements where id = p_id for update;
  if not found then raise exception 'That agreement no longer exists.'; end if;
  if a.status <> 'signed' then
    raise exception 'GT3 countersigns after the operator has signed (this one is %).', a.status;
  end if;
  if coalesce(btrim(p_typed_name), '') = '' then
    raise exception 'Type your full name to countersign.';
  end if;
  -- The operator signed a specific document. If it changed in between, refuse — that is the entire
  -- reason for storing the digest, and a countersignature over altered terms is the worst outcome
  -- this table could produce.
  if a.signed_digest is distinct from public.agreement_digest(a) then
    raise exception 'These terms have changed since % signed. Draft a superseding version rather than countersigning something they did not agree to.', coalesce(a.signed_name, 'the operator');
  end if;

  update public.operator_agreements
     set status = 'active',
         countersigned_name = btrim(p_typed_name),
         countersigned_by = auth.uid(),
         countersigned_at = now()
   where id = p_id returning * into a;
  return a;
end $$;

revoke all on function public.countersign_agreement(uuid, text) from public, anon;
grant execute on function public.countersign_agreement(uuid, text) to authenticated;

-- ── 4) A SECOND VERSION, WHICH THE ERROR MESSAGE HAS BEEN RECOMMENDING SINCE 0277 ──────────────
-- "End it and draft a new version instead" — and there was no way to. version has existed on this
-- table since 0277 and has never once been written or read. This makes the advice followable and
-- keeps the chain, so v1 is not an orphan nobody can connect to v2.
create or replace function public.supersede_agreement(p_id uuid, p_why text default null)
returns public.operator_agreements
language plpgsql security definer set search_path = public as $$
declare old_a public.operator_agreements; new_id uuid;
begin
  if not public.is_admin() then raise exception 'Only an owner or admin can draft a new version.'; end if;
  select * into old_a from public.operator_agreements where id = p_id for update;
  if not found then raise exception 'That agreement no longer exists.'; end if;
  if old_a.status = 'ended' then raise exception 'That agreement has already ended.'; end if;

  insert into public.operator_agreements (
    tenant_id, market, operator_user_id, operator_name, operator_email, title,
    status, tier, stage, supply_funding, operator_pct, royalty_pct, market_pct, package, notes,
    version, starts_on, ends_on, created_by,
    supply_sourcing, supply_price_basis, supply_markup_pct, spec_items, supply_notes,
    equity_eligible, equity_scope, equity_note,
    covers, scope_basis, scope_until, hours_basis, hours_note, supersedes_id
  )
  select tenant_id, market, operator_user_id, operator_name, operator_email, title,
         'draft', tier, stage, supply_funding, operator_pct, royalty_pct, market_pct, package, notes,
         version + 1, starts_on, ends_on, auth.uid(),
         supply_sourcing, supply_price_basis, supply_markup_pct, spec_items, supply_notes,
         equity_eligible, equity_scope, equity_note,
         covers, scope_basis, scope_until, hours_basis, hours_note, old_a.id
    from public.operator_agreements where id = p_id
  returning id into new_id;

  update public.operator_agreements
     set status = 'ended',
         ends_on = coalesce(ends_on, current_date),
         notes = concat_ws(E'\n', notes, 'Superseded by v' || (old_a.version + 1)::text ||
                                          case when coalesce(btrim(p_why), '') <> ''
                                               then ' — ' || btrim(p_why) else '' end)
   where id = p_id;

  return (select a from public.operator_agreements a where a.id = new_id);
end $$;

revoke all on function public.supersede_agreement(uuid, text) from public, anon;
grant execute on function public.supersede_agreement(uuid, text) to authenticated;

-- ── 5) IS THIS STILL THE DOCUMENT THAT WAS SIGNED ──────────────────────────────────────────────
create or replace view public.v_agreement_integrity as
select a.id, a.operator_name, a.market, a.version, a.status,
       a.signed_name, a.signed_at, a.countersigned_name, a.countersigned_at,
       a.scope_basis, a.scope_until, a.covers,
       case
         when a.signed_at is null then 'not signed yet'
         when a.signed_digest is null then 'signed before terms were digested'
         when a.signed_digest = public.agreement_digest(a) then 'intact — matches what was signed'
         else 'ALTERED SINCE SIGNING'
       end as integrity,
       case when a.scope_basis = 'interim' and a.status in ('signed','active')
            then a.scope_until end as interim_ends_when
  from public.operator_agreements a
 order by a.created_at desc;

revoke all on public.v_agreement_integrity from public, anon;
grant select on public.v_agreement_integrity to authenticated;

comment on view public.v_agreement_integrity is
  'Whether each signed agreement still says what it said when it was signed, and when an interim scope is due to retire. Both answers were previously unavailable at any price.';

-- Freeze the scope terms on the same footing as the money once signed, not just once accepted.
-- The 0289 guard fires from 'accepted' onward and did not know about these columns.
create or replace function public.guard_agreement_terms()
returns trigger language plpgsql as $$
begin
  if current_setting('gt3.allow_hard_delete', true) = 'on' then return new; end if;
  if old.status in ('accepted','signed','active','ended') and (
       new.operator_pct is distinct from old.operator_pct or
       new.royalty_pct is distinct from old.royalty_pct or
       new.market_pct is distinct from old.market_pct or
       new.supply_funding is distinct from old.supply_funding or
       new.tier is distinct from old.tier or
       new.stage is distinct from old.stage or
       new.package::text is distinct from old.package::text or
       new.market is distinct from old.market or
       new.supply_sourcing is distinct from old.supply_sourcing or
       new.supply_price_basis is distinct from old.supply_price_basis or
       new.supply_markup_pct is distinct from old.supply_markup_pct or
       new.spec_items is distinct from old.spec_items or
       new.equity_eligible is distinct from old.equity_eligible or
       new.equity_scope is distinct from old.equity_scope or
       new.covers is distinct from old.covers or
       new.scope_basis is distinct from old.scope_basis or
       new.scope_until is distinct from old.scope_until or
       new.hours_basis is distinct from old.hours_basis
     ) then
    raise exception 'This agreement was already accepted — its terms are final, including what it says the operator covers. Draft a superseding version instead: select public.supersede_agreement(''%'', ''why''); (Deliberate correction: select set_config(''gt3.allow_hard_delete'',''on'',false); first.)', old.id;
  end if;
  return new;
end $$;

-- ── 6) THE REVERSALS THE DELETION AUDIT LEFT OPEN ──────────────────────────────────────────────
-- Both were flagged as the highest-value gaps: a mistyped bottle return bakes in a credit, and a
-- wrong empties count writes a wrong account balance too. void_expense (0292) is the pattern —
-- a mandatory reason, and the row stays.
alter table public.loop_txns
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text;

alter table public.jug_ledger
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text;

create or replace function public.void_loop_txn(p_id uuid, p_reason text)
returns public.loop_txns
language plpgsql security definer set search_path = public as $$
declare r public.loop_txns;
begin
  if not public.is_staff() then raise exception 'Only crew can void a return.'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why this is being voided — a reversal without a reason is unreadable in six weeks.';
  end if;
  select * into r from public.loop_txns where id = p_id for update;
  if not found then raise exception 'That entry no longer exists.'; end if;
  if r.voided_at is not null then raise exception 'That entry was already voided.'; end if;
  update public.loop_txns
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_id returning * into r;
  return r;
end $$;

revoke all on function public.void_loop_txn(uuid, text) from public, anon;
grant execute on function public.void_loop_txn(uuid, text) to authenticated;

-- The jug void has a second job the loop void does not: bumpJugs also writes
-- business_accounts.jug_balance, so a wrong count landed in two places. Reversing one and not the
-- other would leave the balance quietly wrong, which is the failure this is meant to fix.
create or replace function public.void_jug_entry(p_id uuid, p_reason text)
returns public.jug_ledger
language plpgsql security definer set search_path = public as $$
declare r public.jug_ledger; delta int;
begin
  if not public.is_staff() then raise exception 'Only crew can void a jug entry.'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why this is being voided — a reversal without a reason is unreadable in six weeks.';
  end if;
  select * into r from public.jug_ledger where id = p_id for update;
  if not found then raise exception 'That entry no longer exists.'; end if;
  if r.voided_at is not null then raise exception 'That entry was already voided.'; end if;

  delta := coalesce(r.jugs_out, 0) - coalesce(r.jugs_in, 0);
  update public.business_accounts
     set jug_balance = coalesce(jug_balance, 0) - delta, updated_at = now()
   where id = r.business_id;

  update public.jug_ledger
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_id returning * into r;
  return r;
end $$;

revoke all on function public.void_jug_entry(uuid, text) from public, anon;
grant execute on function public.void_jug_entry(uuid, text) to authenticated;

-- The open rows, so every reader gets the corrected picture without remembering to filter.
create or replace view public.v_jug_open as
select * from public.jug_ledger where voided_at is null;
create or replace view public.v_loop_open as
select * from public.loop_txns where voided_at is null;

revoke all on public.v_jug_open, public.v_loop_open from public, anon;
grant select on public.v_jug_open, public.v_loop_open to authenticated;

-- ── 7) what changed ────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An agreement now says what the work actually is','improvement','Command',
   'Agreements recorded what an operator earns and never what they do — there was no duties field anywhere in the database. An operator who is also brewing and also driving had agreed to something the record could not express. An agreement now carries the activities it covers, whether that scope is the standing job or interim cover the market cannot yet staff, and the condition that retires the interim part. That last one is the piece people forget to write down, and it is the reason someone agrees to the extra work in the first place.',
   '2026-09-07', true),
  ('Hours invested are recorded, and signatures bind to the terms','improvement','Command',
   'Nothing in this app recorded how long anyone worked — not one column. Hours are now logged by the person who worked them, against the agreement and against the activity, so the interim brewing and driving can be told apart from everything else. Signing is now a real act on both sides: the operator types their name, GT3 countersigns, and the signature is stored against a digest of the exact terms. Change a term afterwards and the record says so rather than quietly passing for what was agreed.',
   '2026-09-07', false),
  ('A mistyped bottle return or jug count can be taken back','improvement','Money',
   'Both were append-only with no undo: mistype a return and the credit was baked in, and a wrong empties count wrote a wrong account balance too. Both can now be voided with a reason, the row stays as the record, and voiding a jug entry corrects the account balance it moved.',
   '2026-09-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0309_what_you_actually_agreed_to',
  'scope + interim end condition + hours on agreements; sign/countersign bound to a terms digest; supersede_agreement; void_loop_txn and void_jug_entry.');

-- verify:
--   select integrity, count(*) from public.v_agreement_integrity group by 1;
--   select * from public.v_agreement_hours;
--   select value, label from public.option_sets where set_key = 'agreement_activity' order by sort;
--   select public.agreement_digest(a) = a.signed_digest from public.operator_agreements a where a.signed_at is not null;
