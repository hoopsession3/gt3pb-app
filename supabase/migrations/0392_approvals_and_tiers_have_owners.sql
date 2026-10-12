-- ── 0392 — APPROVALS AND TIERS HAVE OWNERS ──────────────────────────────────────────────────────────────────────
-- 2026-10-12. A1 of the account audit (the owner approved all five decisions; decision 2 is (a): only admins and
-- the owner set tiers, every change shows in the Activity log, and a crew scan never stamps the scanner and is capped).
--
-- WHY. Four writes trusted the wrong person:
--   · a member could post their own review already approved (0131: the insert checked only the author), and the truck's
--     TV shows approved reviews;
--   · a member could file their own bottle proof already "verified" as Founding VIP (0203: the same check), and the
--     0251 trigger turns their VIP flag on, which unlocks VIP-only perks;
--   · any crew member could set anyone's tier, Founding included, which changes prices (0176, 0252: is_staff);
--   · any crew member could stamp any card as often as they liked, their own included (0229, 0389).
-- And the Activity log showed role changes only, so a tier change left no line anyone reads.
--
-- WHAT.
--   · reviews: a member's own review goes in unapproved and from the app. Staff still moderate and add (0131).
--   · vip_verifications: a member's own proof goes in pending, with nothing a reviewer sets. A server can still turn a
--     pending proof down; verifying it — which grants Founding, or Founding VIP — is an admin's or the owner's.
--   · admin_set_customer_tier and admin_set_customer_vip: admins and the owner only.
--   · award_manual_point: never the scanner's own card, and at most 6 walk-up stamps for one member in 10 minutes. Each
--     still records who stamped (0389).
--   · The Activity log (admin_audit, 0260) gets a line for every tier change — the tier, Founding VIP, and the owner's
--     Founding switch — with who made it. The line keeps the tier and nothing else of the person.
--   · admin_set_member's point adjustments record who made them, like a scan.
--
-- ORDER. Paste it before the deploy that reads it, or after: the screens hide what a person can't do either way, and
-- the database refuses it. existing rows: none written.
-- changelog: below.

-- Reviews: a member's own goes in unapproved, from the app. "reviews staff all" (0131) still lets staff add approved ones.
drop policy if exists "reviews insert own" on public.reviews;
create policy "reviews insert own" on public.reviews for insert to authenticated
  with check (auth.uid() = user_id and approved = false and source = 'app');

-- Bottle proofs: a member's own goes in pending, with nothing a reviewer sets.
drop policy if exists "vip insert own" on public.vip_verifications;
create policy "vip insert own" on public.vip_verifications for insert to authenticated
  with check (auth.uid() = user_id and status = 'pending' and granted_tier is null and reward is null
              and note is null and reviewed_by is null and reviewed_at is null);
-- Staff moderate pending proofs; only an admin or the owner verifies (verifying grants a tier), or edits a decided one.
drop policy if exists "vip staff write" on public.vip_verifications;
create policy "vip staff write" on public.vip_verifications for update
  using ((select public.is_admin()) or ((select public.is_staff()) and status = 'pending'))
  with check ((select public.is_admin()) or ((select public.is_staff()) and status in ('pending', 'rejected')));

-- Tiers: admins and the owner.
create or replace function public.admin_set_customer_tier(p_user uuid, p_tier text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'only an admin or the owner sets a tier' using errcode = '42501'; end if;
  if p_tier not in ('guest', 'member', 'founding') then raise exception 'bad tier'; end if;
  update public.customers set tier = p_tier, updated_at = now() where user_id = p_user;
  update public.profiles  set founding_member = (p_tier = 'founding') where id = p_user;
end; $$;
revoke all on function public.admin_set_customer_tier(uuid, text) from public, anon;
grant execute on function public.admin_set_customer_tier(uuid, text) to authenticated;

create or replace function public.admin_set_customer_vip(p_user uuid, p_vip boolean)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'only an admin or the owner sets a tier' using errcode = '42501'; end if;
  update public.customers set vip_verified = p_vip, updated_at = now() where user_id = p_user;
end; $$;
revoke all on function public.admin_set_customer_vip(uuid, boolean) from public, anon;
grant execute on function public.admin_set_customer_vip(uuid, boolean) to authenticated;

-- A walk-up stamp: never your own card, and at most 6 for one member in 10 minutes. The member's profile is locked
-- first, so two phones scanning the same card at once can't both slip under the limit.
create or replace function public.award_manual_point(p_code text) returns int
  language plpgsql security definer set search_path = public as $$
declare uid uuid; new_points int; recent int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select p.id into uid from public.profiles p where p.referral_code = p_code or p.id::text = p_code limit 1;
  if uid is null then return null; end if;
  if uid = auth.uid() then
    raise exception 'your own card: another crew member stamps it' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = uid for update;
  select count(*) into recent from public.loyalty_ledger
   where user_id = uid and channel = 'scan' and kind = 'award' and created_at > now() - interval '10 minutes';
  if recent >= 6 then
    raise exception 'stamp limit: 6 walk-up stamps in 10 minutes for one member' using errcode = 'P0001';
  end if;
  insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user)
    values (uid, 'scan', 'award', 1, 'walk-up purchase, stamped at the window', auth.uid());
  select points into new_points from public.profiles where id = uid;
  return new_points;
end $$;

-- The owner's loyalty edit (0229): unchanged, except its point adjustments say who made them, and a change to the
-- Founding switch writes its line in the Activity log.
create or replace function public.admin_set_member(member uuid, new_points int, new_credit_cents int, new_founding boolean)
returns void language plpgsql security definer set search_path = public as $$
declare cur int; delta int; was boolean;
begin
  if not public.is_owner() then raise exception 'not authorized'; end if;
  if new_points is not null then
    select coalesce(points, 0) into cur from public.profiles where id = member;
    delta := new_points - coalesce(cur, 0);
    if delta <> 0 then
      insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user)
        values (member, 'admin', 'adjust', delta, 'owner set points to ' || new_points, auth.uid());
    end if;
  end if;
  select founding_member into was from public.profiles where id = member;
  update public.profiles
     set credit_cents    = coalesce(new_credit_cents, credit_cents),
         founding_member = coalesce(new_founding, founding_member)
   where id = member;
  if found and new_founding is not null and was is distinct from new_founding then
    insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row)
    values (auth.uid(), 'UPDATE', 'customers', member::text,
            format('Founding member: %s → %s', case when coalesce(was, false) then 'on' else 'off' end,
                                               case when new_founding then 'on' else 'off' end),
            jsonb_build_object('founding_member', was), jsonb_build_object('founding_member', new_founding));
  end if;
end; $$;

-- Every tier change, whoever makes it and however (the tier buttons, Verify in the proof queue, the VIP switch), is a
-- line in the Activity log: who, when, and the tier before and after. Nothing else of the customer is kept in it.
create or replace function public.log_tier_change() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_on text := 'on'; v_off text := 'off';
begin
  insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row)
  values (auth.uid(), 'UPDATE', 'customers', coalesce(new.user_id::text, new.id::text),
          concat_ws(' · ',
            case when old.tier is distinct from new.tier
                 then format('tier: %s → %s', coalesce(old.tier, '∅'), coalesce(new.tier, '∅')) end,
            case when old.vip_verified is distinct from new.vip_verified
                 then format('Founding VIP: %s → %s', case when coalesce(old.vip_verified, false) then v_on else v_off end,
                                                       case when coalesce(new.vip_verified, false) then v_on else v_off end) end),
          jsonb_build_object('tier', old.tier, 'vip_verified', old.vip_verified),
          jsonb_build_object('tier', new.tier, 'vip_verified', new.vip_verified));
  return new;
end $$;
revoke all on function public.log_tier_change() from public, anon, authenticated;
drop trigger if exists audit_customers_tier on public.customers;
create trigger audit_customers_tier after update of tier, vip_verified on public.customers
  for each row when (old.tier is distinct from new.tier or old.vip_verified is distinct from new.vip_verified)
  execute function public.log_tier_change();

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Approvals and tiers have owners','security','Loyalty',
   'A member could post a review already approved, or file a bottle proof already verified as Founding VIP, and any crew member could set anyone''s tier or stamp any card — their own included — as often as they liked. Now a member''s review and proof go in waiting; verifying a proof and setting a tier are an admin''s or the owner''s; a scan never stamps the scanner''s own card and stops at 6 walk-up stamps for one member in 10 minutes; and every tier change is a line in the Activity log, with who made it.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_policies where tablename = 'reviews' and policyname = 'reviews insert own' and with_check like '%approved = false%';  -- 1
--   select count(*) from pg_trigger where tgname = 'audit_customers_tier';                                                                   -- 1
--   select prosrc like '%is_admin()%' from pg_proc where oid = 'public.admin_set_customer_tier(uuid, text)'::regprocedure;                  -- t
select public.record_migration('0392_approvals_and_tiers_have_owners');
