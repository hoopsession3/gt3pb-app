-- ── 0432 — A COVERED SETTLE IS A FREE CUP, A CREDIT, OR AN OWNER'S REASON ──────────────────────────────────────────────
-- 2026-10-18. R27 of the 10/10 audit (database F17; Ryan, 2026-10-18: "Owner/admin, with a reason"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. An order settled at the window as covered — paid with a free cup or the member's credit (0416) — takes no money,
-- and nothing recorded why: any crew member's tap made any order free, and the books said only "covered". A free cup
-- given (redeem_free_cup, 0387) and credit used (spend_credit, 0389) each write a row of their own, signed by whoever
-- gave it; the settle never asked for one.
--
-- WHAT.
--   · covered_settles: one row for each order settled as covered — the free cup or the credit that covered it, or an
--     owner's or admin's reason for putting it on the house — with who settled it and when. Written by
--     staff_collect_payment only, taken back with the settle by staff_undo_collection; the crew read it, nobody writes it.
--   · staff_collect_payment(kind, id, via, reason): covered, by anyone on the crew, takes a free cup redeemed for the
--     order's member today (the business day, Eastern) or credit they used today, that covers no other order — the
--     earliest, a free cup first, kept on the row. With nothing taken off, an owner or admin may put it on the house with
--     a reason (three characters or more, kept to 200), which is the record; anyone else is told to take it off on the
--     scan screen first. Your own order is still another crew member's to settle as covered (0420). Cash and the card
--     reader are as they were; a reason sent with them is not kept.
--   · staff_undo_collection (0341's): a covered settle taken back lets its free cup or credit cover an order again.
--
-- ORDER. Paste it right after the deploy that carries "On the house" (components/CollectSheet). Before this paste that
-- button is refused — its reason is an argument the database doesn't know yet (PGRST202); between this paste and that
-- deploy, an owner's covered settle with nothing taken off is asked for a reason the old screen can't give, and "Hand it
-- over unpaid" is the way through for those minutes. Every other settle works on either side.
--
-- set lock_timeout (database F16): a new table and its indexes; each function is made again under a moment's lock.
-- existing rows: none — an order settled as covered before this has no row here, and is left as it was.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.covered_settles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  order_kind  text not null check (order_kind in ('cup', 'pickup')),
  order_id    uuid not null,
  how         text not null check (how in ('free_cup', 'credit', 'on_the_house')),
  free_cup    uuid,   -- the loyalty_ledger row of the free cup that covered it (0387) — no key: an erased member's goes
  credit      uuid,   -- the credit_spends row of the credit that covered it (0389)
  reason      text,   -- an owner's or admin's, when nothing was taken off: why, not who
  by_user     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint covered_settles_says_what check (
       (how = 'free_cup'     and free_cup is not null and credit is null and reason is null)
    or (how = 'credit'       and credit is not null and free_cup is null and reason is null)
    or (how = 'on_the_house' and free_cup is null and credit is null and length(btrim(coalesce(reason, ''))) between 3 and 200))
);
-- One cover for an order, and a free cup or a credit covers one order.
create unique index if not exists covered_settles_one_per_order on public.covered_settles (order_kind, order_id);
create unique index if not exists covered_settles_free_cup_once on public.covered_settles (free_cup) where free_cup is not null;
create unique index if not exists covered_settles_credit_once on public.covered_settles (credit) where credit is not null;
create index if not exists covered_settles_by_user on public.covered_settles (by_user);
comment on table public.covered_settles is
  'Why an order settled at the window as covered took no money (0432): the free cup (loyalty_ledger, 0387) or the credit (credit_spends, 0389) that covered it, or an owner''s or admin''s reason for putting it on the house — who settled it, and when. Written only by staff_collect_payment; removed with the settle by staff_undo_collection.';

alter table public.covered_settles enable row level security;
drop trigger if exists stamp_tenant_tg on public.covered_settles;
create trigger stamp_tenant_tg before insert on public.covered_settles for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.covered_settles;
create policy "tenant isolation" on public.covered_settles as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
drop policy if exists "covered settles crew read" on public.covered_settles;
create policy "covered settles crew read" on public.covered_settles for select using ((select public.is_staff()));
revoke all on public.covered_settles from public, anon;
revoke insert, update, delete, truncate on public.covered_settles from authenticated;
grant select on public.covered_settles to authenticated;

-- ── the settle: covered takes what covered it ───────────────────────────────────────────────────────────────────────
-- 0420's, with a reason and the cover. The three-argument door goes: a call that names three still lands here (the
-- reason defaults to none), and two doors of one name would be one too many for PostgREST to choose between.
drop function if exists public.staff_collect_payment(text, uuid, text);
create or replace function public.staff_collect_payment(p_kind text, p_id uuid, p_via text, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_paid boolean; v_at timestamptz; v_gone boolean; v_owner uuid; v_tenant uuid;
        v_cup uuid; v_credit uuid; v_reason text; v_since timestamptz;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_via is null or p_via not in ('cash', 'card_reader', 'covered') then
    raise exception 'say how it was paid: cash, card_reader or covered';
  end if;

  -- Cash sets paid (the till is counted nowhere else); the reader does not (Square counts it, 0341); covered — a free
  -- cup or the member's credit (0416), or an owner's reason (0432) — does not either: it is owed nothing, and it is no
  -- money anywhere.
  if p_kind = 'cup' then
    select paid, collected_at, status = 'void', user_id, tenant_id into v_paid, v_at, v_gone, v_owner, v_tenant
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that order does not exist'; end if;
    if v_gone then raise exception 'that order was voided — nothing to collect'; end if;
  elsif p_kind = 'pickup' then
    select paid, collected_at, canceled_at is not null, user_id, tenant_id into v_paid, v_at, v_gone, v_owner, v_tenant
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that pack does not exist'; end if;
    if v_gone then raise exception 'that pack was canceled — nothing to collect'; end if;
  else
    raise exception 'unknown kind: %', coalesce(p_kind, 'null');
  end if;
  if v_paid or v_at is not null then return 'already settled'; end if;

  if p_via = 'covered' then
    -- 0420: a free cup or credit for your own order is another crew member's to give (0392's rule for a card).
    if v_owner is not null and v_owner = auth.uid() then
      raise exception 'your own %: another crew member settles it as covered', case when p_kind = 'cup' then 'order' else 'pack' end
        using errcode = '42501';
    end if;
    -- A cover left from a settle taken back some other way is not this one's (the order is held: nobody else is here).
    delete from public.covered_settles where order_kind = p_kind and order_id = p_id;
    -- 0432: what covered it — a free cup redeemed for their member today, or credit they used today, covering no other
    -- order. Held while this settles, so two phones settling two of their orders take two, not one twice.
    if v_owner is not null then
      v_since := (public.business_day()::timestamp at time zone 'America/New_York');
      select l.id into v_cup from public.loyalty_ledger l
       where l.user_id = v_owner and l.kind = 'redeem' and l.created_at >= v_since
         and not exists (select 1 from public.covered_settles s where s.free_cup = l.id)
       order by l.created_at, l.id
       limit 1
       for update of l skip locked;
      if v_cup is null then
        select c.id into v_credit from public.credit_spends c
         where c.user_id = v_owner and c.created_at >= v_since
           and not exists (select 1 from public.covered_settles s where s.credit = c.id)
         order by c.created_at, c.id
         limit 1
         for update of c skip locked;
      end if;
    end if;
    -- Nothing taken off: on the house — an owner's or admin's to say, with why.
    if v_cup is null and v_credit is null then
      if not public.is_admin() then
        raise exception 'Nothing was taken off for them today — redeem their free cup or use their credit on the scan screen first. An owner or admin can put it on the house, with a reason.'
          using errcode = '42501';
      end if;
      v_reason := left(btrim(coalesce(p_reason, '')), 200);
      if length(v_reason) < 3 then
        raise exception 'Say why it''s on the house — the reason is the record.' using errcode = '22023';
      end if;
    end if;
  end if;

  if p_kind = 'cup' then
    update public.orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
  else
    update public.drop_orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
  end if;
  if p_via = 'covered' then
    insert into public.covered_settles (tenant_id, order_kind, order_id, how, free_cup, credit, reason, by_user)
    values (v_tenant, p_kind, p_id,
            case when v_cup is not null then 'free_cup' when v_credit is not null then 'credit' else 'on_the_house' end,
            v_cup, v_credit, case when v_cup is null and v_credit is null then v_reason end, auth.uid());
  end if;
  return 'collected';
end $$;
revoke all on function public.staff_collect_payment(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.staff_collect_payment(text, uuid, text, text) to authenticated;
comment on function public.staff_collect_payment(text, uuid, text, text) is
  'The window''s settle (0341; 0416, 0420, 0432): cash, the card reader, or covered — staff only, tenant-scoped, the order locked. Covered is never your own order, and takes what covered it: a free cup redeemed or credit used for the order''s member today that covers no other order, or — nothing taken off — an owner''s or admin''s reason. Each is written to covered_settles.';

-- ── the undo: the cover goes with the settle ────────────────────────────────────────────────────────────────────────
-- 0341's, with one more line: a covered settle taken back lets its free cup or credit cover an order again.
create or replace function public.staff_undo_collection(p_kind text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_via text; v_at timestamptz; v_by uuid;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_kind = 'cup' then
    select collected_via, collected_at, collected_by into v_via, v_at, v_by
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
  elsif p_kind = 'pickup' then
    select collected_via, collected_at, collected_by into v_via, v_at, v_by
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
  else
    raise exception 'unknown kind: %', coalesce(p_kind, 'null');
  end if;
  if not found then raise exception 'that order does not exist'; end if;
  if v_at is null then return 'nothing to undo'; end if;
  if not (public.is_admin() or (v_by = auth.uid() and v_at > now() - interval '1 hour')) then
    raise exception 'only the person who took it can undo it, within the hour — or an admin';
  end if;

  if p_kind = 'cup' then
    update public.orders
       set paid = case when v_via = 'cash' then false else paid end,
           collected_via = null, collected_at = null, collected_by = null
     where id = p_id;
  else
    update public.drop_orders
       set paid = case when v_via = 'cash' then false else paid end,
           collected_via = null, collected_at = null, collected_by = null
     where id = p_id;
  end if;
  delete from public.covered_settles where order_kind = p_kind and order_id = p_id;   -- 0432
  return 'undone';
end $$;
revoke all on function public.staff_undo_collection(text, uuid) from public, anon, authenticated;
grant execute on function public.staff_undo_collection(text, uuid) to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A covered order says what covered it', 'fix', 'Money',
   'Settling an order at the window as a free cup or credit now takes the free cup redeemed or the credit used for that member today, and keeps which one it was. With nothing taken off, only an owner or admin can put an order on the house, and they say why — the reason is kept with it.',
   '2026-10-18', false),
  -- The same release's two changes outside the database (R27): said here, where the changelog is written.
  ('Deleting your account asks for a code', 'fix', 'Account',
   'Delete my account emails you an 8-digit code first, and deletes the account when you enter it — or, if you sign in with Apple, Face ID on your iPhone does. A phone left unlocked, or lent for a minute, can''t delete its owner''s account.',
   '2026-10-18', false),
  ('Alerts outside the app say only what kind and which order', 'fix', 'System',
   'Teams cards and alert emails say what kind of thing happened, the order''s number and the link — never a customer''s name, email, phone or address, or what anyone typed. A booking lead''s email says the day and the headcount; who it is stays in the app.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_proc where proname = 'staff_collect_payment';                                        -- 1
--   select pg_get_function_identity_arguments('public.staff_collect_payment(text,uuid,text,text)'::regprocedure)
--     = 'p_kind text, p_id uuid, p_via text, p_reason text';                                                     -- t
--   select relrowsecurity from pg_class where oid = 'public.covered_settles'::regclass;                          -- t
--   select has_table_privilege('authenticated', 'public.covered_settles', 'insert');                             -- f
--   select prosrc like '%covered_settles%' from pg_proc where proname = 'staff_undo_collection';                 -- t
select public.record_migration('0432_a_covered_settle_is_a_free_cup_a_credit_or_an_owners_reason');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
