-- ── 0418 — EVERY PUBLIC DOOR THAT RINGS, EMAILS OR TEXTS IS COUNTED ─────────────────────────────────────────────────
-- 2026-10-16. R9 of the customer audit — abuse (Ryan, 2026-10-16: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. The abuse audit (R9) found no door that let one person read or change another's: every one is keyed to the
-- verified caller. What it found were doors anyone could loop — each pass rang the crew's phones, emailed every admin,
-- or sent a paid text:
--   · booking_requests took a row from any browser ("anyone request", 0004): each one an alert on the crew's phones and
--     an email to every admin carrying what was typed. The form posts to /api/book now (counted, with a field only a bot
--     fills); a browser from before it — the app's own build — still writes direct, and is counted here.
--   · a texts yes could be recorded for any number in any country, from a page (say_text_consent, 0398): a member put a
--     stranger's number on a pay-at-pickup pack and said yes for it, and a yes from the account outweighed the STOP the
--     phone itself had texted (the later one won). A yes is for a US number now, and a STOP texted from the phone holds
--     until the phone texts START.
--   · push_subscriptions took rows straight from any page (0009, 0081 — "sub insert", "sub update"), around
--     keep_push_device's checks (0366), and keep_push_device took any https address: thousands of rows marked for the
--     truck's go-live ping crowded out real ones, and each made the push function post to an address of the sender's
--     choosing. A device is kept only through its function now, and only at one of the browsers' push services; a new
--     guest device is counted.
--
-- WHAT.
--   · booking_requests_throttle — before a row is written from a browser (anon or a member, never the server's own
--     door, which counts its own): six an hour, for everyone together. Over it: refused, with where to write instead.
--   · say_text_consent (0398's): a yes for a number that is not a US one is refused; a yes from a page (a checkout, the
--     account) for a number whose latest word is a STOP texted from it is not kept — only START from the phone undoes it.
--     A stop is kept for any number, as before.
--   · push_host_ok(endpoint) — the browsers' push services: Google's (Chrome, Edge on Android, Samsung, Opera, Brave),
--     Mozilla's, Apple's and Microsoft's. keep_push_device (0366's) keeps a web device only there, and counts new guest
--     devices: three hundred an hour, for everyone together.
--   · PART 2, for the SQL editor (it drops): the page-side insert and update rules on push_subscriptions go — every
--     page has kept its device through keep_push_device (web, 0366) or keep_app_push_token (the iPhone app, 0367) since
--     2026-10-11.
-- existing rows: none of these functions writes an alert.
-- changelog: below.

-- ── a booking from a browser, counted ─────────────────────────────────────────────────────────────────────────────
create or replace function public.booking_requests_throttle() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- A session with no request is a person at the SQL editor; the service role is /api/book, which counts its own.
  if coalesce(nullif(current_setting('request.jwt.claims', true), ''), nullif(current_setting('request.jwt.claim.role', true), '')) is null
     or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if not public.rate_limit_hit('book:direct', 3600000, 6) then
    raise exception 'We''ve had a lot of booking requests just now — try again in an hour, or email hello@gt3pb.com.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.booking_requests_throttle() from public, anon, authenticated;
drop trigger if exists booking_requests_throttle on public.booking_requests;
create trigger booking_requests_throttle before insert on public.booking_requests
  for each row execute function public.booking_requests_throttle();

-- ── a texts yes: a US number, and never over the phone's own STOP ────────────────────────────────────────────────────
-- A US phone: +1, area code and exchange from 2 to 9, the area code not Canada's, the Caribbean's or Bermuda's (+1 is
-- twenty-five countries — the Caribbean's are where SMS pumping is billed), nor one that reaches no person's phone
-- (toll-free, premium 900, carrier and government services, personal-number blocks). lib/texts usTextable, the same list.
create or replace function public.us_textable(p_phone text) returns boolean
  language sql immutable set search_path = public as $$
  select coalesce(p_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'
    and substring(p_phone from 3 for 3) !~ '^[2-9]11$'
    and substring(p_phone from 3 for 3) <> all (array[
    '204', '226', '236', '242', '246', '249', '250', '257', '263', '264', '268', '273', '284', '289', '306', '343',
    '345', '354', '365', '367', '368', '382', '387', '403', '416', '418', '428', '431', '437', '438', '441', '450',
    '456', '460', '468', '473', '474', '500', '506', '514', '519', '521', '522', '523', '524', '525', '526', '527',
    '528', '529', '533', '544', '548', '566', '577', '579', '581', '584', '587', '588', '600', '604', '613', '622',
    '633', '639', '644', '647', '649', '655', '658', '664', '672', '677', '683', '688', '700', '705', '709', '710',
    '721', '742', '753', '758', '767', '778', '780', '782', '784', '800', '807', '809', '819', '822', '825', '829',
    '833', '844', '849', '855', '866', '867', '868', '869', '873', '876', '877', '879', '880', '881', '882', '883',
    '884', '885', '886', '887', '888', '889', '900', '902', '905', '942']), false)
$$;
revoke all on function public.us_textable(text) from public, anon, authenticated;

create or replace function public.say_text_consent(p_phone text, p_yes boolean, p_source text, p_user uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'That isn''t a phone number we can text.' using errcode = '22023';
  end if;
  if p_yes then
    -- 0418: a US number (lib/texts usTextable).
    if not public.us_textable(p_phone) then
      raise exception 'We can only text US numbers.' using errcode = '22023';
    end if;
    -- 0418: a STOP texted from the phone is undone from the phone. A yes from a page — a checkout, the account — can
    -- name any number, so it does not outweigh the number's own word; it is not kept, and the answer says no yes stands.
    if coalesce(p_source, '') <> 'start_text' and exists (
         select 1 from public.text_consents c
          where c.phone = p_phone and c.stop_source = 'stop_text' and c.stop_at is not null
            and (c.yes_at is null or c.stop_at >= c.yes_at)) then
      return false;
    end if;
    insert into public.text_consents (phone, user_id, yes_at, yes_source, updated_at)
    values (p_phone, p_user, now(), p_source, now())
    on conflict (phone) do update
      set yes_at = now(), yes_source = excluded.yes_source,
          user_id = coalesce(excluded.user_id, public.text_consents.user_id), updated_at = now();
  else
    insert into public.text_consents (phone, user_id, stop_at, stop_source, updated_at)
    values (p_phone, p_user, now(), p_source, now())
    on conflict (phone) do update
      set stop_at = now(),
          -- 0418: a STOP the phone texted, still standing, stays the phone's — a stop from a page after it must not turn
          -- it into one a page's yes can undo.
          stop_source = case when public.text_consents.stop_source = 'stop_text' and public.text_consents.stop_at is not null
                               and (public.text_consents.yes_at is null or public.text_consents.stop_at >= public.text_consents.yes_at)
                             then 'stop_text' else excluded.stop_source end,
          user_id = coalesce(excluded.user_id, public.text_consents.user_id), updated_at = now();
  end if;
  return public.text_consent_standing(p_phone);
end $$;
revoke all on function public.say_text_consent(text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.say_text_consent(text, boolean, text, uuid) to service_role;

-- ── a web device, at a browser's push service ─────────────────────────────────────────────────────────────────────
create or replace function public.push_host_ok(p_endpoint text) returns boolean
  language sql immutable set search_path = public as $$
  -- At one of the browsers' push services: under Google's, Mozilla's, Apple's or Microsoft's own domains — each runs its
  -- service on hosts of its own (fcm.googleapis.com, updates.push.services.mozilla.com, web.push.apple.com,
  -- *.notify.windows.com, and older ones), and nobody else can name a host under them.
  select coalesce(lower(substring(p_endpoint from '^https://([^/:?#]+)')) ~ '(^|\.)(googleapis\.com|google\.com|mozilla\.com|apple\.com|windows\.com)$', false)
$$;
revoke all on function public.push_host_ok(text) from public, anon, authenticated;
comment on function public.push_host_ok(text) is
  'A web push endpoint at one of the browsers'' push services (0418): a host under Google''s, Mozilla''s, Apple''s or Microsoft''s own domains (googleapis.com, google.com, mozilla.com, apple.com, windows.com). supabase/functions/push/policy.ts pushHostOk is the same rule.';

create or replace function public.keep_push_device(p_endpoint text, p_p256dh text, p_auth text,
  p_crew boolean default null, p_wants_live boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if coalesce(length(p_endpoint), 0) not between 12 and 2048 or p_endpoint !~ '^https://' then
    raise exception 'That isn''t a push subscription.' using errcode = '22023';
  end if;
  -- 0418: at a browser's push service — any other address was a post the push function made to wherever it said.
  if not public.push_host_ok(p_endpoint) then
    raise exception 'That isn''t a push subscription.' using errcode = '22023';
  end if;
  if coalesce(length(p_p256dh), 0) not between 16 and 256 or coalesce(length(p_auth), 0) not between 8 and 128 then
    raise exception 'That push subscription has no keys.' using errcode = '22023';
  end if;
  -- 0418: a new device nobody is signed in on is counted — three hundred an hour, for everyone together. A member's is
  -- not: theirs replaces their other browsers (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint)
     and not public.rate_limit_hit('push:new-guest', 3600000, 300) then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, p256dh, auth, user_id, is_admin, wants_live)
  values (p_endpoint, p_p256dh, p_auth, v_user, coalesce(p_crew, false), coalesce(p_wants_live, false))
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,          -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = case when s.user_id is distinct from excluded.user_id then coalesce(p_crew, false)
                    else coalesce(p_crew, false) or s.is_admin end,
    wants_live = coalesce(p_wants_live, s.wants_live);
  -- One browser each: the person's other browsers go (a reinstall or a new browser mints a new endpoint, and every
  -- alert fanned out to all the stale ones). Only browsers — an endpoint that is a web address.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> p_endpoint and endpoint like 'https://%';
  end if;
end $$;
revoke all on function public.keep_push_device(text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.keep_push_device(text, text, text, boolean, boolean) to anon, authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Public forms and switches are counted', 'security', 'Crew',
   'Every door the public can use that rings the crew, emails the admins or sends a text is counted now: booking requests, orders to pay at the window, packs to pay at pickup, card tries at every card door, the texts switch, a phone''s alerts. A person ordering never meets the limits; a script looping one does at once. Texts go to US numbers only, and a STOP texted from a phone holds until that phone texts START.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ═════ PART 2 — for the SQL editor (it drops). Run after part 1, in the same paste or on its own. ═════════════════════
-- A device is kept through its function only (0366 web, 0367 the iPhone app): the page-side rules go.
drop policy if exists "sub insert" on public.push_subscriptions;
drop policy if exists "sub update" on public.push_subscriptions;

-- verify (numbers and booleans only):
--   select count(*) from pg_trigger where tgname = 'booking_requests_throttle';                                           -- 1
--   select prosrc like '%start_text%' from pg_proc where proname = 'say_text_consent';                                     -- true
--   select public.push_host_ok('https://fcm.googleapis.com/fcm/send/x'), public.push_host_ok('https://example.com/x');   -- true, false
--   select count(*) from pg_policies where tablename = 'push_subscriptions' and policyname in ('sub insert', 'sub update'); -- 0
select public.record_migration('0418_every_public_door_that_rings_is_counted');
