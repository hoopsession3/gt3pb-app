-- 0277 — OPERATOR AGREEMENTS. Paste into Supabase → SQL Editor → Run. Idempotent. Purely additive.
--
-- A market operator needs a deal: what they get, what they fund, what they earn, and what returns to
-- GT3 as royalty. Today none of that exists anywhere — an operator's terms live in a conversation.
-- This makes them a record, with a negotiation trail, so "what did we actually agree" is answerable
-- a year later by looking rather than remembering.
--
-- THE MONEY MATH IS NOT IN HERE. lib/operatorDeal.ts owns the split (anchored on 50/30/20 at the
-- midpoint of the supply-funding slider) and is unit-tested; this table stores the INPUTS plus a
-- snapshot of the computed split at the moment terms were saved. Storing the snapshot means a
-- historical agreement keeps the numbers it was signed under even if the model is later retuned —
-- an agreement whose terms silently change when you edit a formula is not an agreement.
--
-- WHO CAN DO WHAT
--   * Owners/admins draft, price and send agreements.
--   * An operator can READ their own agreement and RESPOND to it — accept, request changes, or
--     counter — through respond_to_agreement() only. They can never edit their own terms, which is
--     why there is no update policy for them: a security-definer function with a narrow contract is
--     safer than an update policy someone has to get exactly right.
--   * Nobody edits the event trail. It is the record.

-- ── the agreement ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.operator_agreements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  market            text not null default 'greenville',
  operator_user_id  uuid references auth.users(id),
  operator_name     text not null,
  operator_email    text,
  title             text,

  status            text not null default 'draft'
                      check (status in ('draft','sent','changes_requested','countered','accepted','active','ended')),
  tier              text not null default 'associate'
                      check (tier in ('associate','operator','senior','partner')),
  stage             text not null default 'ramp'
                      check (stage in ('ramp','profitable')),

  -- the one negotiable input: the share of SUPPLY COST the operator funds (0 = GT3 funds it all)
  supply_funding    numeric not null default 50 check (supply_funding >= 0 and supply_funding <= 100),

  -- snapshot of the split these terms computed to, so history is stable (see header)
  operator_pct      numeric not null default 50,
  royalty_pct       numeric not null default 30,
  market_pct        numeric not null default 20,

  -- what the operator GETS: [{ label, included, note }]
  package           jsonb not null default '[]'::jsonb,

  notes             text,
  version           integer not null default 1,
  starts_on         date,
  ends_on           date,
  sent_at           timestamptz,
  accepted_at       timestamptz,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- the three shares must always reconstruct the whole. Enforced here as well as in the module,
  -- because a split that doesn't total 100 is money quietly going nowhere.
  constraint operator_agreements_split_totals
    check (round(operator_pct + royalty_pct + market_pct) = 100)
);
create index if not exists operator_agreements_market_idx on public.operator_agreements(market);
create index if not exists operator_agreements_operator_idx on public.operator_agreements(operator_user_id);
create index if not exists operator_agreements_status_idx on public.operator_agreements(status);

alter table public.operator_agreements enable row level security;

drop policy if exists "agreements admin all" on public.operator_agreements;
create policy "agreements admin all" on public.operator_agreements
  for all using ((select public.is_admin())) with check ((select public.is_admin()));

-- The operator sees their own, and only their own.
drop policy if exists "agreements operator read own" on public.operator_agreements;
create policy "agreements operator read own" on public.operator_agreements
  for select using (operator_user_id = (select auth.uid()));

-- ── the negotiation trail ─────────────────────────────────────────────────────────────────────────
create table if not exists public.operator_agreement_events (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid not null references public.operator_agreements(id) on delete cascade,
  at            timestamptz not null default now(),
  actor         uuid references auth.users(id),
  kind          text not null
                  check (kind in ('drafted','edited','sent','feedback','countered','accepted','activated','ended')),
  note          text,
  terms         jsonb,          -- snapshot of the terms as they stood at this moment
  from_status   text,
  to_status     text
);
create index if not exists operator_agreement_events_idx on public.operator_agreement_events(agreement_id, at desc);

alter table public.operator_agreement_events enable row level security;
drop policy if exists "agreement events read" on public.operator_agreement_events;
create policy "agreement events read" on public.operator_agreement_events
  for select using (
    (select public.is_admin())
    or exists (select 1 from public.operator_agreements a
               where a.id = agreement_id and a.operator_user_id = (select auth.uid()))
  );
-- No insert/update/delete policy at all: every row is written by a trigger or by
-- respond_to_agreement(), both security definer. A trail anyone can write is not a trail.

-- ── every status change writes itself ─────────────────────────────────────────────────────────────
create or replace function public.log_agreement_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
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
           when 'sent' then 'sent'
           when 'changes_requested' then 'feedback'
           when 'countered' then 'countered'
           when 'accepted' then 'accepted'
           when 'active' then 'activated'
           when 'ended' then 'ended'
           else 'edited' end;
  elsif new.supply_funding is distinct from old.supply_funding
     or new.tier is distinct from old.tier
     or new.stage is distinct from old.stage
     or new.package is distinct from old.package then
    k := 'edited';
  else
    return new;
  end if;

  insert into public.operator_agreement_events (agreement_id, actor, kind, from_status, to_status, terms)
  values (new.id, auth.uid(), k, old.status, new.status,
          jsonb_build_object('tier',new.tier,'stage',new.stage,'supply_funding',new.supply_funding,
                             'operator_pct',new.operator_pct,'royalty_pct',new.royalty_pct,'market_pct',new.market_pct));
  return new;
end $$;

drop trigger if exists trg_log_agreement_event on public.operator_agreements;
create trigger trg_log_agreement_event after insert or update on public.operator_agreements
  for each row execute function public.log_agreement_event();

-- ── the operator's own voice ──────────────────────────────────────────────────────────────────────
-- Accept, ask for changes, or counter — with a note, from the operator's own account. Deliberately
-- narrow: it can move status and record what was said, and it cannot touch a single term.
create or replace function public.respond_to_agreement(p_id uuid, p_action text, p_note text default null)
returns public.operator_agreements
language plpgsql security definer set search_path = public as $$
declare a public.operator_agreements; nxt text;
begin
  select * into a from public.operator_agreements where id = p_id;
  if not found then raise exception 'No such agreement.'; end if;
  if a.operator_user_id is distinct from auth.uid() then
    raise exception 'Only the operator this agreement is for can respond to it.';
  end if;
  if a.status not in ('sent','countered') then
    raise exception 'This agreement is not open for a response right now (it is %).', a.status;
  end if;

  nxt := case p_action
           when 'accept' then 'accepted'
           when 'request_changes' then 'changes_requested'
           when 'counter' then 'countered'
           else null end;
  if nxt is null then raise exception 'Unknown response: %. Use accept, request_changes or counter.', p_action; end if;

  update public.operator_agreements
     set status = nxt,
         accepted_at = case when nxt = 'accepted' then now() else accepted_at end,
         updated_at = now()
   where id = p_id
   returning * into a;

  -- the note is the operator's, so it is recorded against them explicitly
  update public.operator_agreement_events
     set note = coalesce(p_note, note)
   where id = (select id from public.operator_agreement_events
                where agreement_id = p_id order by at desc limit 1);

  return a;
end $$;

revoke all on function public.respond_to_agreement(uuid, text, text) from public;
grant execute on function public.respond_to_agreement(uuid, text, text) to authenticated;

-- ── audit + delete guard ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['operator_agreements','operator_agreement_events'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

create or replace function public.guard_agreement_delete()
returns trigger language plpgsql as $$
begin
  if current_setting('gt3.allow_hard_delete', true) = 'on' then return old; end if;
  raise exception 'Hard deletes are blocked on % — an agreement is ENDED, never deleted, so what was agreed stays answerable. Set status = ''ended'' instead. Deliberate maintenance only: select set_config(''gt3.allow_hard_delete'',''on'',false); first.', tg_table_name;
end $$;

drop trigger if exists guard_delete_operator_agreements on public.operator_agreements;
create trigger guard_delete_operator_agreements before delete on public.operator_agreements
  for each row execute function public.guard_agreement_delete();

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Operator deals are built on a slider, negotiated in the app, and kept on the record','feature','Money',
   'An owner can now build an operator''s package the way the deal actually gets made: slide the split, choose who funds supplies, pick the tier, and watch what the operator keeps and what comes back as royalty and market reinvestment update as you move it. Send it, and the operator can accept or counter with a note from their own screen — they can move the deal forward, never quietly rewrite its terms. Every version, every send, every counter is kept, so what was agreed and when is never a memory question. The split always totals one hundred percent; the database refuses anything else.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- an agreement writes its own first event:
--   insert into public.operator_agreements (market, operator_name, supply_funding, operator_pct, royalty_pct, market_pct)
--   values ('atlanta','Test Operator',50,50,30,20) returning id;
--   select kind, to_status, terms from public.operator_agreement_events order by at desc limit 1;  -- drafted / draft
--
--   -- the split must total 100:
--   insert into public.operator_agreements (market, operator_name, operator_pct, royalty_pct, market_pct)
--   values ('atlanta','Bad Split',60,30,20);   -- expect: EXCEPTION (totals 110)
--
--   -- deletes refuse:
--   delete from public.operator_agreements where operator_name = 'Test Operator';   -- expect: EXCEPTION
--
--   -- clean up the test row deliberately:
--   select set_config('gt3.allow_hard_delete','on',false);
--   delete from public.operator_agreements where operator_name = 'Test Operator';
