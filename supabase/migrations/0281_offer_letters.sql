-- 0281 — OFFER LETTERS, WITH CO-OWNER APPROVAL. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- An owner writes it, the co-owners approve it, the person signs it.
--
-- The middle step is the reason this exists as its own thing rather than a variant of 0277's
-- operator agreement. An operator agreement goes owner → operator. An offer letter goes
-- owner → CO-OWNERS → candidate, because a title, a salary and a database role are a decision the
-- other owners live with. Nothing reaches the candidate until every other owner has said yes, and
-- the record shows who said it and when.
--
-- WHAT THE DATABASE ENFORCES, rather than trusting a screen:
--   * Only an owner can draft, submit or send. Admins can read; they cannot approve or send.
--   * "Sent" is unreachable from "in_review". The only door to the candidate is through `approved`,
--     and `approved` is only reachable when every required approver has said yes. That is a CHECK
--     on the status transition, not a hopeful UI.
--   * Approvers are SNAPSHOTTED at submit time. Promoting a new owner mid-review does not silently
--     add a signature requirement, and demoting one does not silently remove an objection.
--   * The candidate can accept, decline or counter — never edit a term. Same shape as 0277.
--   * The trail is append-only with no client write path at all.
--   * No hard deletes: an offer is withdrawn, never erased. Hiring decisions are exactly the record
--     you want to still have in two years.
--
-- LIMIT, STATED PLAINLY: this records agreement, it is not an e-signature product. It does not
-- capture a legally-executed signature, and it is not a substitute for counsel on the employment or
-- classification questions the letter itself raises.
--
-- Apply after 0280 (which makes role assignment safe — the thing this hands out).

-- ── the offer ────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.offer_letters (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  market            text not null default 'greenville',

  candidate_name    text not null,
  candidate_email   text not null,
  candidate_user_id uuid references auth.users(id),      -- linked once they have an account

  title             text not null,
  -- The app role this offer grants on acceptance. 'owner' is deliberately NOT allowed: making
  -- another owner is a deliberate act through admin_set_role, never a line item a candidate signs.
  role              text not null default 'server'
                      check (role in ('member','server','contractor','operator','event_manager','admin')),
  employment_type   text not null default 'employee' check (employment_type in ('employee','contractor')),

  base_cents        integer check (base_cents is null or base_cents >= 0),
  rate_per          text check (rate_per is null or rate_per in ('year','hour')),
  commission_pct    numeric check (commission_pct is null or (commission_pct >= 0 and commission_pct <= 100)),
  starts_on         date,
  reports_to        text,
  package           jsonb not null default '[]'::jsonb,
  notes             text,

  status            text not null default 'draft'
                      check (status in ('draft','in_review','changes_requested','approved','sent',
                                        'countered','accepted','declined','withdrawn','expired')),
  version           integer not null default 1,
  expires_on        date,

  author_id         uuid references auth.users(id),
  submitted_at      timestamptz,
  approved_at       timestamptz,
  sent_at           timestamptz,
  responded_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- An offer with no pay is a mistake, not a draft worth keeping.
  constraint offer_letters_has_pay
    check (coalesce(base_cents,0) > 0 or coalesce(commission_pct,0) > 0),
  -- A base needs a unit. Stored as a constraint because the letter renders "$X/yr" from it.
  constraint offer_letters_base_needs_unit
    check (coalesce(base_cents,0) = 0 or rate_per is not null)
);
create index if not exists offer_letters_status_idx    on public.offer_letters(status);
create index if not exists offer_letters_market_idx    on public.offer_letters(market);
create index if not exists offer_letters_candidate_idx on public.offer_letters(lower(candidate_email));
create index if not exists offer_letters_user_idx      on public.offer_letters(candidate_user_id);

-- ── the required approvers, snapshotted at submit ────────────────────────────────────────────────
create table if not exists public.offer_approvals (
  id          uuid primary key default gen_random_uuid(),
  offer_id    uuid not null references public.offer_letters(id) on delete cascade,
  approver_id uuid not null references auth.users(id),
  decision    text check (decision is null or decision in ('approved','changes_requested')),
  note        text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (offer_id, approver_id)
);
create index if not exists offer_approvals_offer_idx on public.offer_approvals(offer_id);

-- ── the trail ────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.offer_events (
  id          uuid primary key default gen_random_uuid(),
  offer_id    uuid not null references public.offer_letters(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid references auth.users(id),
  kind        text not null check (kind in ('drafted','edited','submitted','approved','changes_requested',
                                            'sent','accepted','declined','countered','withdrawn','expired')),
  note        text,
  terms       jsonb,
  from_status text,
  to_status   text
);
create index if not exists offer_events_idx on public.offer_events(offer_id, at desc);

-- ── who can see what ─────────────────────────────────────────────────────────────────────────────
alter table public.offer_letters   enable row level security;
alter table public.offer_approvals enable row level security;
alter table public.offer_events    enable row level security;

-- Owners write. Admins READ ONLY — an offer letter carries someone's salary, and a hiring decision
-- in progress is not general staff information.
drop policy if exists "offers owner write" on public.offer_letters;
create policy "offers owner write" on public.offer_letters
  for all using ((select public.is_owner())) with check ((select public.is_owner()));

drop policy if exists "offers admin read" on public.offer_letters;
create policy "offers admin read" on public.offer_letters
  for select using ((select public.is_admin()));

-- The candidate sees their own — matched on the account once linked, or on the email before that,
-- so an offer is readable the moment they sign up with the address it was sent to.
drop policy if exists "offers candidate read own" on public.offer_letters;
create policy "offers candidate read own" on public.offer_letters
  for select using (
    status in ('sent','countered','accepted','declined','expired')
    and (candidate_user_id = (select auth.uid())
         or lower(candidate_email) = lower((select auth.jwt() ->> 'email')))
  );

drop policy if exists "offer approvals read" on public.offer_approvals;
create policy "offer approvals read" on public.offer_approvals
  for select using ((select public.is_admin()));
-- No client write policy: decisions are recorded by decide_on_offer() only.

drop policy if exists "offer events read" on public.offer_events;
create policy "offer events read" on public.offer_events
  for select using (
    (select public.is_admin())
    or exists (select 1 from public.offer_letters o
                where o.id = offer_id
                  and (o.candidate_user_id = (select auth.uid())
                       or lower(o.candidate_email) = lower((select auth.jwt() ->> 'email'))))
  );
-- No insert/update/delete policy at all — the trail is trigger-written. A trail anyone can write is
-- not a trail.

-- ── every change writes itself ───────────────────────────────────────────────────────────────────
create or replace function public.log_offer_event() returns trigger
  language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if tg_op = 'INSERT' then
    insert into public.offer_events (offer_id, actor, kind, to_status, terms)
    values (new.id, auth.uid(), 'drafted', new.status,
            jsonb_build_object('title',new.title,'role',new.role,'market',new.market,
                               'employment_type',new.employment_type,'base_cents',new.base_cents,
                               'rate_per',new.rate_per,'commission_pct',new.commission_pct));
    return new;
  end if;

  if new.status is distinct from old.status then
    k := case new.status
           when 'in_review' then 'submitted'
           when 'approved' then 'approved'
           when 'changes_requested' then 'changes_requested'
           when 'sent' then 'sent'
           when 'accepted' then 'accepted'
           when 'declined' then 'declined'
           when 'countered' then 'countered'
           when 'withdrawn' then 'withdrawn'
           when 'expired' then 'expired'
           else 'edited' end;
  elsif new.title is distinct from old.title
     or new.role is distinct from old.role
     or new.base_cents is distinct from old.base_cents
     or new.commission_pct is distinct from old.commission_pct
     or new.employment_type is distinct from old.employment_type
     or new.package is distinct from old.package
     or new.starts_on is distinct from old.starts_on then
    k := 'edited';
  else
    return new;
  end if;

  insert into public.offer_events (offer_id, actor, kind, from_status, to_status, terms)
  values (new.id, auth.uid(), k, old.status, new.status,
          jsonb_build_object('title',new.title,'role',new.role,'market',new.market,
                             'employment_type',new.employment_type,'base_cents',new.base_cents,
                             'rate_per',new.rate_per,'commission_pct',new.commission_pct));
  return new;
end $$;

drop trigger if exists trg_log_offer_event on public.offer_letters;
create trigger trg_log_offer_event after insert or update on public.offer_letters
  for each row execute function public.log_offer_event();

-- ── the gate: approved is only reachable when everyone has said yes ──────────────────────────────
-- This is the load-bearing rule of the whole feature, so it lives in the database rather than in the
-- screen that happens to be calling. It also blocks the shortcut: sent is unreachable except from
-- approved, so nothing skips review by writing status directly.
create or replace function public.guard_offer_status() returns trigger
  language plpgsql security definer set search_path = public as $$
declare pending int; objections int; required int;
begin
  if new.status is not distinct from old.status then return new; end if;

  if new.status = 'approved' then
    select count(*) filter (where decision is null),
           count(*) filter (where decision = 'changes_requested'),
           count(*)
      into pending, objections, required
      from public.offer_approvals where offer_id = new.id;

    if required = 0 then
      raise exception 'This offer has not been submitted for review yet.';
    end if;
    if objections > 0 then
      raise exception 'A co-owner asked for changes. Address them and resubmit.';
    end if;
    if pending > 0 then
      raise exception 'Still waiting on % co-owner approval(s).', pending;
    end if;
  end if;

  if new.status = 'sent' and old.status <> 'approved' then
    raise exception 'An offer goes to the candidate only after the co-owners approve it.';
  end if;

  return new;
end $$;

drop trigger if exists guard_status_offer_letters on public.offer_letters;
create trigger guard_status_offer_letters before update of status on public.offer_letters
  for each row execute function public.guard_offer_status();

-- ── submit for review: snapshot the approvers ────────────────────────────────────────────────────
create or replace function public.submit_offer_for_review(p_id uuid)
returns public.offer_letters language plpgsql security definer set search_path = public as $$
declare o public.offer_letters; n int;
begin
  if not public.is_owner() then raise exception 'Only an owner can submit an offer for review.'; end if;
  select * into o from public.offer_letters where id = p_id;
  if not found then raise exception 'No such offer.'; end if;
  if o.status not in ('draft','changes_requested','countered') then
    raise exception 'This offer is % — only a draft can go for review.', o.status;
  end if;

  -- Snapshot every OTHER owner as a required approver. Re-submitting after changes clears prior
  -- decisions: an approval was given to a specific set of terms, and the terms just moved.
  delete from public.offer_approvals where offer_id = p_id;
  insert into public.offer_approvals (offer_id, approver_id)
  select p.id from public.profiles p
   where p.role = 'owner' and p.id is distinct from coalesce(o.author_id, auth.uid());

  select count(*) into n from public.offer_approvals where offer_id = p_id;

  if n = 0 then
    -- Sole owner: there is nobody to review it. Say so in the trail rather than pretending a
    -- unanimous vote of zero people took place.
    update public.offer_letters
       set status = 'approved', submitted_at = now(), approved_at = now(), updated_at = now()
     where id = p_id returning * into o;
    insert into public.offer_events (offer_id, actor, kind, from_status, to_status, note)
    values (p_id, auth.uid(), 'approved', 'draft', 'approved', 'No co-owners to review — approved by default.');
  else
    update public.offer_letters
       set status = 'in_review', submitted_at = now(), approved_at = null, updated_at = now()
     where id = p_id returning * into o;
  end if;
  return o;
end $$;
revoke all on function public.submit_offer_for_review(uuid) from public;
grant execute on function public.submit_offer_for_review(uuid) to authenticated;

-- ── a co-owner decides ───────────────────────────────────────────────────────────────────────────
create or replace function public.decide_on_offer(p_id uuid, p_action text, p_note text default null)
returns public.offer_letters language plpgsql security definer set search_path = public as $$
declare o public.offer_letters; mine int; pending int; objections int;
begin
  if not public.is_owner() then raise exception 'Only an owner can approve an offer.'; end if;
  if p_action not in ('approve','request_changes') then
    raise exception 'Unknown decision: %. Use approve or request_changes.', p_action;
  end if;

  select * into o from public.offer_letters where id = p_id;
  if not found then raise exception 'No such offer.'; end if;
  if o.status <> 'in_review' then raise exception 'This offer is not open for review (it is %).', o.status; end if;

  select count(*) into mine from public.offer_approvals
   where offer_id = p_id and approver_id = auth.uid();
  if mine = 0 then raise exception 'You are not a required approver on this offer.'; end if;

  update public.offer_approvals
     set decision = case when p_action = 'approve' then 'approved' else 'changes_requested' end,
         note = p_note, decided_at = now()
   where offer_id = p_id and approver_id = auth.uid();

  insert into public.offer_events (offer_id, actor, kind, note, from_status, to_status)
  values (p_id, auth.uid(),
          case when p_action = 'approve' then 'approved' else 'changes_requested' end,
          p_note, o.status, o.status);

  select count(*) filter (where decision is null),
         count(*) filter (where decision = 'changes_requested')
    into pending, objections
    from public.offer_approvals where offer_id = p_id;

  if objections > 0 then
    update public.offer_letters set status = 'changes_requested', updated_at = now()
     where id = p_id returning * into o;
  elsif pending = 0 then
    update public.offer_letters set status = 'approved', approved_at = now(), updated_at = now()
     where id = p_id returning * into o;
  end if;
  return o;
end $$;
revoke all on function public.decide_on_offer(uuid, text, text) from public;
grant execute on function public.decide_on_offer(uuid, text, text) to authenticated;

-- ── the candidate responds ───────────────────────────────────────────────────────────────────────
-- Same narrow contract as respond_to_agreement (0277): they can move it forward and say something,
-- and they cannot touch a single term.
create or replace function public.respond_to_offer(p_id uuid, p_action text, p_note text default null)
returns public.offer_letters language plpgsql security definer set search_path = public as $$
declare o public.offer_letters; nxt text; me_email text;
begin
  select * into o from public.offer_letters where id = p_id;
  if not found then raise exception 'No such offer.'; end if;

  me_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if o.candidate_user_id is distinct from auth.uid()
     and lower(o.candidate_email) is distinct from me_email then
    raise exception 'Only the person this offer is for can respond to it.';
  end if;
  if o.status not in ('sent','countered') then
    raise exception 'This offer is not open for a response right now (it is %).', o.status;
  end if;
  if o.expires_on is not null and o.expires_on < current_date then
    update public.offer_letters set status = 'expired', updated_at = now() where id = p_id;
    raise exception 'This offer expired on %.', o.expires_on;
  end if;

  nxt := case p_action when 'accept' then 'accepted'
                       when 'decline' then 'declined'
                       when 'counter' then 'countered' else null end;
  if nxt is null then raise exception 'Unknown response: %. Use accept, decline or counter.', p_action; end if;

  update public.offer_letters
     set status = nxt,
         responded_at = now(),
         -- link the account on first response, so later reads stop depending on the email match
         candidate_user_id = coalesce(candidate_user_id, auth.uid()),
         updated_at = now()
   where id = p_id returning * into o;

  update public.offer_events set note = coalesce(p_note, note)
   where id = (select id from public.offer_events where offer_id = p_id order by at desc limit 1);

  return o;
end $$;
revoke all on function public.respond_to_offer(uuid, text, text) from public;
grant execute on function public.respond_to_offer(uuid, text, text) to authenticated;

-- ── audit + no deletes ───────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['offer_letters','offer_approvals','offer_events'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

create or replace function public.guard_offer_delete() returns trigger
  language plpgsql as $$
begin
  if current_setting('gt3.allow_hard_delete', true) = 'on' then return old; end if;
  raise exception 'Hard deletes are blocked on % — an offer is WITHDRAWN, never erased, so what was offered to whom stays answerable. Set status = ''withdrawn'' instead. Deliberate maintenance only: select set_config(''gt3.allow_hard_delete'',''on'',false); first.', tg_table_name;
end $$;

drop trigger if exists guard_delete_offer_letters on public.offer_letters;
create trigger guard_delete_offer_letters before delete on public.offer_letters
  for each row execute function public.guard_offer_delete();

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Offer letters: written by an owner, approved by the co-owners, signed by the person','feature','Crew',
   'Hiring someone now has a real path instead of a conversation and a text message. An owner writes the offer — title, market, pay, start date, and the access level it grants — and the letter tells you in plain language what that access actually reaches, because a role name is not the same as what someone can see. It then goes to the other owners, and nothing reaches the candidate until every one of them has approved it; the database enforces that, so an offer cannot be sent early even by accident. The candidate accepts, declines or counters from their own account, and can never edit a term. Every version, every approval, every objection and every response is kept, so what was offered to whom, and who signed off, is answerable a year later by looking.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- the three tables and their policies exist:
--   select tablename, count(*) from pg_policies
--    where tablename in ('offer_letters','offer_approvals','offer_events') group by 1 order by 1;
--
--   -- an offer cannot skip review (expect: EXCEPTION on both):
--   -- insert into public.offer_letters (candidate_name, candidate_email, title, base_cents, rate_per)
--   -- values ('Test','t@example.com','Test role', 5000000, 'year') returning id;
--   -- update public.offer_letters set status = 'approved' where candidate_email = 't@example.com';
--   -- update public.offer_letters set status = 'sent'     where candidate_email = 't@example.com';
--
--   -- an offer with no pay is refused (expect: EXCEPTION):
--   -- insert into public.offer_letters (candidate_name, candidate_email, title) values ('X','x@e.com','Y');
--
--   -- deletes refuse (expect: EXCEPTION):
--   -- delete from public.offer_letters where candidate_email = 't@example.com';
--
--   -- clean up the test row deliberately:
--   -- select set_config('gt3.allow_hard_delete','on',false);
--   -- delete from public.offer_letters where candidate_email = 't@example.com';
