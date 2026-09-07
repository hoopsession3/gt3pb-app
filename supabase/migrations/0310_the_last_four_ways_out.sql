-- 0310 — The last four ways out, and one bug I shipped in 0309.
--
-- Closing the tail of the deletion audit. Three of these are small; the first is a real defect I put
-- into production two hours ago and found by reading the code that CALLS my function rather than the
-- function itself.

-- ── 1) THE BUG. void_jug_entry could drive an account balance negative ─────────────────────────
--
-- 0309's void subtracts (jugs_out - jugs_in) from business_accounts.jug_balance to reverse what the
-- delivery added. That is the right direction, and the test proved it on a clean balance.
--
-- What the test did not know is what the APP does, because the fixture was mine and the app is not:
--
--   OfficeOrders.bumpJugs:  bal = MAX(0, current + gallons - jugsIn)
--
-- The app clamps at zero. So a delivery that would have taken the balance to -2 stores 0 instead,
-- and the ledger row still says it moved 5. Voiding that row then subtracts 5 from 0 and lands at
-- -5 — a container count that says the customer owes negative jugs, which is not a thing.
--
-- A fixture that does not match production is a test that lies. Mine did not lie about the maths;
-- it was silent about the invariant, which is the same failure wearing a different hat. The
-- reversal now clamps exactly where the write clamps.
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
  -- greatest(0, ...) mirrors the MAX(0, ...) the delivery write uses. Reversing past zero would
  -- invent a debt in the other direction.
  update public.business_accounts
     set jug_balance = greatest(0, coalesce(jug_balance, 0) - delta), updated_at = now()
   where id = r.business_id;

  update public.jug_ledger
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_id returning * into r;
  return r;
end $$;

revoke all on function public.void_jug_entry(uuid, text) from public, anon;
grant execute on function public.void_jug_entry(uuid, text) to authenticated;

-- ── 2) LEAVING THE WAITLIST ────────────────────────────────────────────────────────────────────
-- Somebody puts their zip and email in to be told when delivery reaches them, and then has no way
-- to be forgotten: staff-select-only RLS, rows written server-side, a guard trigger blocking hard
-- deletes, and no interface anywhere. That is the shape a privacy request arrives in.
--
-- Matched on EMAIL, because the table has no user_id — the row is written before anybody has an
-- account, which is the whole point of a waitlist. So a signed-in person can remove the rows that
-- carry their own address, and crew can remove one on request from someone who never signed up.
-- The guard trigger still refuses everything else.
create or replace function public.leave_waitlist(p_email text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare target text; n int;
begin
  if p_email is null or btrim(p_email) = '' then
    -- no argument: the caller means themselves
    select lower(btrim(email)) into target from auth.users where id = auth.uid();
    if target is null then raise exception 'Sign in, or pass the address to remove.'; end if;
  else
    target := lower(btrim(p_email));
    -- Removing SOMEBODY ELSE's row is a crew action. Otherwise anyone could clear any address.
    if not public.is_staff() then
      declare mine text;
      begin
        select lower(btrim(email)) into mine from auth.users where id = auth.uid();
        if mine is null or mine <> target then
          raise exception 'You can only remove your own address from the waitlist.';
        end if;
      end;
    end if;
  end if;

  -- The guard from 0141 blocks hard deletes on this table; this is the sanctioned path through it.
  perform set_config('gt3.allow_hard_delete', 'on', true);
  delete from public.delivery_waitlist where lower(btrim(email)) = target;
  get diagnostics n = row_count;
  perform set_config('gt3.allow_hard_delete', 'off', true);
  return n;
end $$;

revoke all on function public.leave_waitlist(text) from public, anon;
grant execute on function public.leave_waitlist(text) to authenticated;

comment on function public.leave_waitlist(text) is
  'Remove an address from the delivery waitlist. No argument means the caller''s own; crew can pass any address to honour a request from someone who never made an account. The only sanctioned way past the 0141 delete guard on this table.';

-- ── 3) WHAT ARCHIVING A PILLAR TAKES WITH IT ───────────────────────────────────────────────────
-- The audit said pillars and modules "have no delete". Looking properly, they already carry
-- archived_at — the convention forty other call sites use — and the UI simply never offers it.
-- Archive is also the RIGHT answer rather than the merely available one: primal_progress points at
-- lessons, and deleting a pillar would take a person's course history with it.
--
-- What was missing is the honest number. Archiving a pillar hides everything under it, and a confirm
-- that does not say how much is a confirm nobody can give meaningfully.
create or replace view public.v_primal_tree as
select p.id as pillar_id, p.title as pillar, p.archived_at as pillar_archived,
       count(distinct m.id) filter (where m.archived_at is null) as live_modules,
       count(distinct l.id) filter (where l.archived_at is null) as live_lessons,
       count(distinct pr.id)                                     as progress_rows
  from public.primal_pillars p
  left join public.primal_modules m on m.pillar_id = p.id
  left join public.primal_lessons l on l.module_id = m.id
  left join public.primal_progress pr on pr.lesson_id = l.id
 group by p.id, p.title, p.archived_at
 order by p.sort;

revoke all on public.v_primal_tree from public, anon;
grant select on public.v_primal_tree to authenticated;

comment on view public.v_primal_tree is
  'Per pillar: how many live modules and lessons sit under it, and how many people have progress against them. The number a confirm dialog needs before someone hides a whole course branch.';

-- ── 4) and the changelog ───────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('You can take your address off the delivery waitlist','improvement','Delivery',
   'Someone who asked to be told when delivery reached their zip had no way to be forgotten again — the list was staff-only with no interface anywhere. You can now remove your own address, and crew can remove one for somebody who never made an account.',
   '2026-09-07', false),
  ('A voided jug swap can no longer push a balance below zero','fix','Money',
   'Voiding a jug entry reversed the containers it moved, but the delivery that wrote it clamps the balance at zero when it would have gone negative. Reversing the unclamped number could land an account on a negative container count. The reversal now stops at zero, the same place the delivery does.',
   '2026-09-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0310_the_last_four_ways_out',
  'void_jug_entry clamps at zero like the write does; leave_waitlist; v_primal_tree for an honest archive confirm.');

-- verify:
--   select * from public.v_primal_tree;
--   select proname from pg_proc where proname in ('leave_waitlist','void_jug_entry');
--   -- the clamp, on a balance the app already floored:
--   --   a jug row moving 5 against a balance of 0 must void to 0, never to -5.
