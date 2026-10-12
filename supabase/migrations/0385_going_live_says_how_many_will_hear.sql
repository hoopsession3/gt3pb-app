-- ── 0385 — GOING LIVE SAYS HOW MANY PEOPLE WILL HEAR ─────────────────────────────────────────────────────────────────
-- 2026-10-12. The Live Ops round; the owner approved the Go live pre-flight on 2026-10-12.
--
-- WHY. Go live on Live Ops opens a sheet of checks now (components/crew/GoLiveSheet, lib/liveOps preflight), and the
-- sheet says what going live does: "Go live and tell 12 people" — the people who asked on Find Us to hear when the truck
-- goes live. Their hand is push_subscriptions.wants_live (0257), and the push function sends each of them one ping when
-- live_status flips to live: its filter is wants_live = true and the business's tenant_id
-- (supabase/functions/push/index.ts, the live_status UPDATE case). The number had nowhere to come from without reading
-- those rows — a device's endpoint and its keys, a guest's among them — and no screen should hold one to count it.
--
-- WHAT. live_ping_count(): how many of the caller's business's devices have asked to hear (wants_live), and nothing
-- else — the push function's own filter, so the number on the button is who the ping goes to. One row is one device
-- (endpoint is unique, 0006), as the function sends one ping a device.
--   · SECURITY DEFINER, search_path pinned: it counts rows the caller cannot read, and says only how many.
--   · For owners and admins: public.is_admin() (0035) — the test admin_set_live asks (0124), so whoever may go live may
--     know how many it tells, and no one else: an event manager, the crew and a member are refused (42501), and anon
--     cannot call it at all.
--   · Its own business: effective_tenant() (0134). A definer is not under 0134's tenant isolation, so the function says
--     the tenant itself.
--   · PUBLIC's execute is revoked (anon and authenticated are members of PUBLIC: 0381's rule), and authenticated's given
--     back; the function refuses inside it anyone not an owner or an admin.
-- Untouched: push_subscriptions and its policies, the push function, who may go live (admin_set_live is unchanged), and
-- what a ping says.
--
-- ORDER. Paste it with the deploy that carries Live Ops' rows, or after it: the app works on either side (before it is
-- pasted the sheet says "Couldn't count who asked on Find Us to hear — they're still told", the call answering
-- PGRST202 — never 0), and its changelog line, below, says what that deploy does.
--
-- existing rows: none written. A second run replaces the function with itself, and writes the changelog line once.
-- changelog: below.

create or replace function public.live_ping_count() returns integer
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (select count(*)::integer from public.push_subscriptions s
           where s.wants_live and s.tenant_id = public.effective_tenant());
end $$;
revoke all on function public.live_ping_count() from public, anon, authenticated;
grant execute on function public.live_ping_count() to authenticated;

comment on function public.live_ping_count() is
  'Go live''s checks (0385, components/crew/GoLiveSheet): how many devices of the caller''s business asked on Find Us to hear when the truck goes live (push_subscriptions.wants_live, 0257) — the rows the push function pings on the flip. A number only; owners and admins only (is_admin(), as admin_set_live asks).';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Live Ops reads at a glance','improvement','Ops',
   'Live Ops opens on one row for the Pass and one for the truck, each saying where it stands in words — "Pass clear · 2 phones can ring", "Off the road · next: Wine Express · Sat 11:00am" — with its one action. A line leads the screen only while something is hurting service: tickets past their promise, no phone on the Pass that can ring, or a paid order that didn''t record. Go live first shows whether the stop is due, a phone is on the Pass with its alerts on, and the stop is on the map, and how many people asked to hear — "Go live and tell 12 people". Go live and Go offline show only to owners and admins, who can use them, and an alert opens only where its reader can go.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.live_ping_count()', 'execute');            -- f
--   select has_function_privilege('authenticated', 'public.live_ping_count()', 'execute');   -- t
--   select prosecdef, proconfig from pg_proc where proname = 'live_ping_count';              -- t, {search_path=public}
select public.record_migration('0385_going_live_says_how_many_will_hear');
