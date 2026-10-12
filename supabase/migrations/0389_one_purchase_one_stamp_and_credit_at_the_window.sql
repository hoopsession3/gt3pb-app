-- ── 0389 — ONE PURCHASE, ONE STAMP · CREDIT IS SPENT AT THE WINDOW ─────────────────────────────────────────────────
-- 2026-10-12. H8 of the customer frontend audit, release C1. The owner approved the release ("yes to all improvements")
-- and chose, on 2026-10-12, that referral credit is spent at the window: the crew takes it off in one tap, like a free
-- cup, and rings the order up that much less.
--
-- WHY. One purchase could earn two stamps: an app order earns its own at pickup (0152/0229, one award per order),
-- while the member card said "Scan at the truck to earn your stamp" and a scan awards one more with no order behind it
-- — so the once-per-order rule never applied to it. And the $5 "give $5, get $5" credit was shown on accounts but
-- nothing could spend it: no checkout read it, and the crew could not see it at the window.
--
-- WHAT.
--   · member_card(code): the scan screen's read of a member — name, points, founding, the credit, and what they
--     ordered in the app today (cups, and packs for today's pickup), which stamp themselves. Staff only, as
--     member_by_code (0132), which stays for any older page.
--   · award_manual_point: the same stamp, now signed by who gave it (loyalty_ledger.by_user, 0387) and noted as a
--     walk-up purchase.
--   · credit_spends: credit used at the window, one row each, with who took it off. spend_credit(code, cents) is the
--     scan screen's "Use credit": staff only, the profile locked first (two phones cannot spend it twice), refused
--     when there is none or less than asked; all of it when no amount is named. profiles.credit_cents is what is left.
-- Untouched: the referral grant (0013), the crew's member editor (admin_set_member), member_by_code, every reader of
-- points and credit_cents.
--
-- ORDER. Paste it before the deploy that reads it. Until it is pasted the scan screen falls back to member_by_code
-- (no app orders line, no credit button) and nothing else changes.
-- existing rows: none written.
-- changelog: below.

create or replace function public.member_card(p_code text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare p public.profiles%rowtype; today date := (now() at time zone 'America/New_York')::date; cups int; orders int; packs int;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into p from public.profiles where referral_code = p_code or id::text = p_code limit 1;
  if p.id is null then return null; end if;
  select count(*), coalesce(sum(greatest(coalesce(array_length(o.items, 1), 1), 1)), 0) into orders, cups
    from public.orders o
   where o.user_id = p.id and o.status <> 'void' and (o.created_at at time zone 'America/New_York')::date = today;
  select count(*) into packs from public.drop_orders d
   where d.user_id = p.id and d.drop_date = today and d.canceled_at is null;
  return jsonb_build_object('display_name', p.display_name, 'points', coalesce(p.points, 0), 'founding_member', coalesce(p.founding_member, false),
    'credit_cents', greatest(coalesce(p.credit_cents, 0), 0), 'orders_today', orders, 'cups_today', cups, 'packs_today', packs);
end $$;
revoke all on function public.member_card(text) from public, anon, authenticated;
grant execute on function public.member_card(text) to authenticated;
comment on function public.member_card(text) is
  'The crew''s scan screen (0389, app/scan): a member by their card code — name, points, credit, and the app orders of today that stamp themselves. Staff only.';

create or replace function public.award_manual_point(p_code text) returns int
  language plpgsql security definer set search_path = public as $$
declare uid uuid; new_points int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select p.id into uid from public.profiles p
    where p.referral_code = p_code or p.id::text = p_code
    limit 1;
  if uid is null then return null; end if;
  insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user)
    values (uid, 'scan', 'award', 1, 'walk-up purchase, stamped at the window', auth.uid());
  select points into new_points from public.profiles where id = uid;
  return new_points;
end $$;

-- Kept for the books when an account is erased — no longer the member's, with nothing about them in it (0353's rule
-- for orders): the money a discount took off stays counted.
create table if not exists public.credit_spends (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  user_id     uuid references auth.users(id) on delete set null,
  cents       integer not null check (cents > 0),
  by_user     uuid references auth.users(id) on delete set null,   -- the crew member who took it off
  created_at  timestamptz not null default now()
);
create index if not exists credit_spends_user on public.credit_spends (user_id, created_at desc);
comment on table public.credit_spends is
  'Referral credit used at the window (0389): one row each, with who took it off. Written only by spend_credit.';
alter table public.credit_spends enable row level security;
drop policy if exists "credit spends own read" on public.credit_spends;
create policy "credit spends own read" on public.credit_spends for select
  using (user_id = (select auth.uid()) or (select public.is_staff()));
drop trigger if exists stamp_tenant_tg on public.credit_spends;
create trigger stamp_tenant_tg before insert on public.credit_spends for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.credit_spends;
create policy "tenant isolation" on public.credit_spends as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
revoke all on public.credit_spends from public, anon;
revoke insert, update, delete, truncate on public.credit_spends from authenticated;
grant select on public.credit_spends to authenticated;

create or replace function public.spend_credit(p_code text, p_cents integer default null) returns integer
  language plpgsql security definer set search_path = public as $$
declare uid uuid; cur int; take int;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select p.id, greatest(coalesce(p.credit_cents, 0), 0) into uid, cur from public.profiles p
   where p.referral_code = p_code or p.id::text = p_code
   limit 1
   for update;
  if uid is null then return null; end if;
  take := coalesce(p_cents, cur);
  if cur <= 0 or take <= 0 then raise exception 'no credit to use' using errcode = 'P0001'; end if;
  if take > cur then raise exception 'not that much credit' using errcode = 'P0001'; end if;
  insert into public.credit_spends (user_id, tenant_id, cents, by_user)
    select uid, p.tenant_id, take, auth.uid() from public.profiles p where p.id = uid;
  update public.profiles set credit_cents = cur - take where id = uid;
  return take;
end $$;
revoke all on function public.spend_credit(text, integer) from public, anon, authenticated;
grant execute on function public.spend_credit(text, integer) to authenticated;
comment on function public.spend_credit(text, integer) is
  'The crew''s scan screen (0389, app/scan): a member''s referral credit taken off at the window — all of it unless an amount is named. Staff only; refused when there is none; the profile locked first. Returns the cents taken off.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('One purchase, one stamp — and credit you can use','fix','Loyalty',
   'App orders stamp themselves when they''re picked up, and the member card used to say to scan for a stamp too — so one cup could earn two. The card now says scan for walk-up cups, and the crew''s scan screen shows what a member ordered in the app today. Referral credit can be spent now: the crew sees it on the scan screen and takes it off at the window in one tap, and your account says so.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.member_card(text)', 'execute');                  -- f
--   select has_function_privilege('anon', 'public.spend_credit(text, integer)', 'execute');        -- f
--   select relrowsecurity from pg_class where oid = 'public.credit_spends'::regclass;              -- t
select public.record_migration('0389_one_purchase_one_stamp_and_credit_at_the_window');
