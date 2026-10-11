-- ── 0365 — ONLY THE CREW IS SENT NEW ORDERS ─────────────────────────────────────────────────────────────
-- 2026-10-11 (the review of the iPhone app's alerts, which read the web's half too).
--
-- A new order's push carries the customer's name, what they ordered and the total, and it goes to every device
-- whose row is marked is_admin (supabase/functions/push, the orders INSERT case). The mark was whatever the page
-- that subscribed sent: the insert and update rules (0081, 0009) ask only whose row it is, and the column is open
-- to anon and authenticated alike (0006). So anyone — signed in or not — could mark a browser of their own and be
-- sent every order. The database decides now:
--
--   · a row is marked only while the person it belongs to is on the crew (public.is_staff's test, 0035, asked of
--     the row's own person), whatever the page sent — and a page can still leave it unmarked: a crew member who
--     turned on "order ready" from the customer's side has not asked for the pass's alerts;
--   · someone who leaves the crew stops being sent orders the moment their role changes, on every device;
--   · the rows marked today go through the same test.
--
-- Nothing a page does changes: the crew console's alerts send the mark (components/DeviceAlerts), a customer's
-- send none (lib/push subscribePush), and both are kept as they were asked for.

create or replace function public.push_sub_crew_only() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.is_admin := coalesce(new.is_admin, false) and new.user_id is not null and exists (
    select 1 from public.profiles p where p.id = new.user_id and (p.role <> 'member' or p.is_admin = true));
  return new;
end $$;
revoke all on function public.push_sub_crew_only() from public, anon, authenticated;

drop trigger if exists push_sub_crew_only on public.push_subscriptions;
create trigger push_sub_crew_only before insert or update on public.push_subscriptions
  for each row execute function public.push_sub_crew_only();

-- Off the crew: off the pass's alerts, on every device the person has.
create or replace function public.push_subs_leave_with_the_crew() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not (new.role <> 'member' or new.is_admin = true) then
    update public.push_subscriptions set is_admin = false where user_id = new.id and is_admin;
  end if;
  return null;
end $$;
revoke all on function public.push_subs_leave_with_the_crew() from public, anon, authenticated;

drop trigger if exists push_subs_leave_with_the_crew on public.profiles;
create trigger push_subs_leave_with_the_crew after update of role, is_admin on public.profiles
  for each row when (old.role is distinct from new.role or old.is_admin is distinct from new.is_admin)
  execute function public.push_subs_leave_with_the_crew();

-- The rows marked today, through the same test: the trigger above decides each one this touches.
update public.push_subscriptions set is_admin = is_admin where is_admin;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Only the crew is sent new orders','security','Crew',
   'A new order''s alert — the customer''s name, what they ordered and the total — goes to the devices marked for the pass. That mark was whatever the page that turned alerts on said, so a device could be marked by someone who isn''t on the crew. Now the database marks a device only while the person it belongs to is on the crew, and takes the mark off every device of someone who leaves it, the moment their role changes. Crew alerts that are on stay on.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select count(*) filter (where s.is_admin) as marked,
--          count(*) filter (where s.is_admin and not exists (select 1 from public.profiles p
--            where p.id = s.user_id and (p.role <> 'member' or p.is_admin))) as marked_off_the_crew
--     from public.push_subscriptions s;                                   -- marked_off_the_crew = 0
select public.record_migration('0365_only_the_crew_is_sent_new_orders');
