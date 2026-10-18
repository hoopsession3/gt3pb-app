-- ── 0436 — ONE ADDRESS CAN'T SPEND THE GUEST DOOR FOR EVERYONE ─────────────────────────────────────────────────────
-- 2026-10-18. R30 of the 10/10 audit (database F14's last half; Ryan, 2026-10-17: "Keep working to improve to a 10").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A phone or a browser kept for alerts with nobody signed in on it (keep_app_push_token, keep_push_device) is
-- counted — three hundred new ones an hour, for everyone together (0418, 0419) — so made-up devices can't pile up. But
-- one script could make the three hundred itself, and every real guest's new phone or browser was refused for the rest
-- of the hour: "Too many devices just now". 0428 left this half open until it was known which header carries the
-- caller's address through Supabase's gateway untouched.
--
-- WHAT. caller_address(): the caller's address as Cloudflare, in front of Supabase's API, gives it — cf-connecting-ip,
-- which Cloudflare sets on every request and replaces when a caller sends one of their own (Supabase's own guide reads
-- the caller's address from it, to let one address alone ask for query plans). An IPv4 address is itself; an IPv6 one
-- is its /64, the block one home or one phone is given, so a caller can't walk through addresses of their own. Not
-- there, or not an address: null, and the door is as it was.
-- Both doors ask the caller's own count first — thirty new devices an hour from one address, more than a household or
-- a phone ever makes — and only a device let through there is counted against everyone's three hundred, so a script
-- stopped at its own thirty spends nothing of anyone else's (0419's order: a try over a cap is not counted). One
-- address can take a tenth of the hour now, not all of it. A member's own device is not counted, as before.
--
-- set lock_timeout (database F16): three functions replaced; no table touched — a moment's lock on the catalog.
-- existing rows: none changes.
-- changelog: below.

set lock_timeout = '5s';

-- ── where the caller is ─────────────────────────────────────────────────────────────────────────────────────────────
-- Read by the two doors below (definer functions, so callers need no grant of their own); nobody calls it directly.
create or replace function public.caller_address() returns text
  language plpgsql stable set search_path = public as $$
declare v_headers json; v_raw text; v_ip inet;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  v_raw := nullif(btrim(v_headers ->> 'cf-connecting-ip'), '');
  if v_raw is null or v_raw !~ '^[0-9A-Fa-f:.]{2,45}$' then return null; end if;
  begin
    v_ip := v_raw::inet;
  exception when others then
    return null;
  end;
  if family(v_ip) = 6 then
    return host(network(set_masklen(v_ip, 64))) || '/64';
  end if;
  return host(v_ip);
end $$;
revoke all on function public.caller_address() from public, anon, authenticated;
comment on function public.caller_address() is
  'The caller''s address from cf-connecting-ip (Cloudflare''s, in front of Supabase''s API): an IPv4 address whole, an IPv6 one as its /64; null when there is none (0436). Read by the guest push doors to count one address apart.';

-- ── the guest door's count: the caller's own first, then everyone's ─────────────────────────────────────────────────
-- True when a new device nobody is signed in on may be kept: under thirty an hour from this address (when there is
-- one), and then under three hundred an hour for everyone. Asked in that order, one after the other — a device the
-- address's own count refuses is never counted against everyone's.
create or replace function public.guest_device_fits() returns boolean
  language plpgsql volatile set search_path = public as $$
declare v_from text := public.caller_address();
begin
  if v_from is not null then
    if not public.rate_limit_hit('push:new-guest:' || v_from, 3600000, 30) then
      return false;
    end if;
  end if;
  return public.rate_limit_hit('push:new-guest', 3600000, 300);
end $$;
revoke all on function public.guest_device_fits() from public, anon, authenticated;
comment on function public.guest_device_fits() is
  'Whether a new push device nobody is signed in on may be kept (0436): thirty an hour from one address (caller_address), asked first, then three hundred an hour for everyone (0418). Read by keep_push_device and keep_app_push_token.';

-- ── the browser's door (0428's, line for line but the count) ─────────────────────────────────────────────────────────
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
  -- 0418, 0436: a new device nobody is signed in on is counted — thirty an hour from one address, three hundred for
  -- everyone together. A member's is not: theirs replaces their other browsers (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint)
     and not public.guest_device_fits() then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, p256dh, auth, user_id, is_admin, wants_live, seen_at)
  values (p_endpoint, p_p256dh, p_auth, v_user, coalesce(p_crew, false), coalesce(p_wants_live, false), now())
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,          -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = case when s.user_id is distinct from excluded.user_id then coalesce(p_crew, false)
                    else coalesce(p_crew, false) or s.is_admin end,
    wants_live = coalesce(p_wants_live, s.wants_live),
    seen_at = now();                         -- 0428: kept again is seen again (a device nobody keeps is let go)
  -- One browser each: the person's other browsers go (a reinstall or a new browser mints a new endpoint, and every
  -- alert fanned out to all the stale ones). Only browsers — an endpoint that is a web address.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> p_endpoint and endpoint like 'https://%';
  end if;
end $$;
revoke all on function public.keep_push_device(text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.keep_push_device(text, text, text, boolean, boolean) to anon, authenticated;

-- ── the iPhone app's door (0428's, line for line but the count) ──────────────────────────────────────────────────────
create or replace function public.keep_app_push_token(p_token text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_endpoint text;
begin
  if coalesce(p_token, '') !~ '^[0-9A-Fa-f]{32,200}$' then
    raise exception 'That isn''t a device token.' using errcode = '22023';
  end if;
  v_endpoint := 'apns:' || lower(p_token);
  -- 0419, 0436: a new phone nobody is signed in on is counted with the web's — thirty an hour from one address, three
  -- hundred for everyone together. A member's is not: theirs replaces their other phones (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = v_endpoint)
     and not public.guest_device_fits() then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, platform, p256dh, auth, user_id, is_admin, seen_at)
  values (v_endpoint, 'apns', null, null, v_user, true, now())          -- the mark is 0365's to give: the crew's alone
  on conflict (endpoint) do update set
    platform = 'apns', p256dh = null, auth = null,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,                             -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = true,
    seen_at = now();                                            -- 0428: kept again is seen again
  -- One app install each: the person's other phones go — a reinstall or a new phone is a new token. Browsers stay.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> v_endpoint and endpoint like 'apns:%';
  end if;
end $$;
revoke all on function public.keep_app_push_token(text) from public, anon, authenticated;
grant execute on function public.keep_app_push_token(text) to anon, authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('One address can''t turn alerts off for everyone', 'security', 'Alerts',
   'Phones and browsers kept for alerts with nobody signed in are counted by where they come from as well as all together — thirty an hour from one address — so a script making up devices can no longer use up the hour for every real guest.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.caller_address()', 'execute');                                 -- f
--   select has_function_privilege('anon', 'public.guest_device_fits()', 'execute');                              -- f
--   select count(*) from pg_proc where proname in ('keep_push_device', 'keep_app_push_token')
--      and prosrc like '%guest_device_fits()%';                                                                  -- 2
select public.record_migration('0436_one_address_cant_spend_the_guest_door_for_everyone');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
