-- ── 0437 — A PASSWORD ALONE OPENS NO OWNER DOOR, AND A PAID ORDER KEEPS WHAT IT BOUGHT ─────────────────────────────────
-- 2026-10-18. R32 of the 10/10 audit (the fresh audit at R31: database DB11-01, DB11-03, DB11-05, DB11-06, DB11-07;
-- security SEC11-01; API API11-05 — Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into Supabase → SQL
-- Editor → Run, after 0436. A second run changes nothing.
--
-- WHY.
--   · Two-step (0433) holds every owner and admin power that asks is_admin() or is_owner() — but four doors never asked
--     them. They read the role straight from profiles: what the AI agents are taught (agent_knowledge — its "owner
--     corrections" are read into the public concierge's instructions), the storefront's promos (whose button may point
--     anywhere https), the strategy decisions and the go-to-market drafts. An owner's or admin's password, phished, opened
--     all four without the authenticator's code — what 0433 was asked to stop.
--   · The money guard (0420, 0423) holds an order's price, its payment and who settled it — not what the price buys. Any
--     crew role could make a paid three-pack a twelve (and the stamps follow the size: award_points_pack), a delivery's six
--     bottles twenty-four, an office order's five gallons fifty at the five-gallon total, or move an invoice's due date
--     out so its overdue line never came. No screen writes any of these: a pack's size changes through its own charged
--     door (0388), an office order's gallons through office_change_delivery (0359).
--   · The anonymous doors the database keeps were counted by nobody: track_guest (the guest-traffic count, limited only by
--     the browser), funnel_events (any insert, any time it said — a step could be back-dated into the report), and two
--     doors no screen uses any more — subscription_interest's and booking_requests' own inserts (the app books through
--     /api/book, as the server). 0436 counted an IPv6 caller by its /64, the block one device is handed; a household is
--     handed a /56 or more, so one home could still spend the guest alerts door for everyone, and an IPv4 address written
--     as IPv6 (::ffff:a.b.c.d) fell into one '::/64' with every other.
--   · An every-other-week office program with neither an anchor nor a start counted its weeks from the UTC date it was
--     saved: a program saved on a Sunday evening (Eastern) ran on the opposite weeks to the same one saved an hour sooner.
--
-- WHAT.
--   · The four doors ask the gates: (select public.is_admin()) — the same owner-or-admin as before, and the code given on
--     this sign-in when one is set up. scripts/db.r32.test.mjs fails a release whose policies grant owner-and-admin by the
--     role alone. (A policy that also lets an event manager in is drawn that way on purpose — 0433: an owner without the
--     code acts as an event manager — and is left as it is.)
--   · money_columns_guard (0423's, line for line but the lists): a pack's size, glass, mix, member and benefit code; a
--     delivery's pack size, its bottle counts and mix, its member; an office order's gallons, container, billing terms,
--     member, business and company; an invoice's terms, issue and due dates and company — a page's write that changes one
--     is refused unless the caller is an owner or admin. The functions and the server write them as before.
--   · caller_address() reads an IPv4 address written as IPv6 as the IPv4 it is; caller_block() is an IPv6 caller's /48 —
--     the most a home or a tunnel hands out. The guest alerts door asks the address's thirty an hour, then the block's
--     sixty, then everyone's three hundred: one household can't take the hour any more.
--   · track_guest counts an address sixty times an hour at most (a browser asks once an hour — lib/track); past that,
--     the visit isn't counted again. funnel_events: each step is stamped now, whatever the page said, and an address
--     records three hundred an hour at most — past that, the row is dropped (the page never reads its own steps back).
--   · subscription_interest's and booking_requests' anonymous inserts go: nothing the app does uses them.
--   · office_rule_matches counts an unanchored program's weeks from the Eastern day it was saved (business_day's clock).
--     A program that already runs on its UTC date first has that date written as its anchor, so no schedule moves. The
--     app makes no program of more than one week (0355 makes weekly ones), so this paste expects none.
--
-- set lock_timeout (database F16): four ALTER POLICY (each its table's lock for a moment), functions made again, one
-- trigger, two policies dropped. Nothing reads a table's rows but the anchor's update, which expects none.
-- existing rows: a program of more than a week with no anchor and no start gets its UTC date as its anchor (none
-- expected); nothing else.
-- changelog: below.

set lock_timeout = '5s';

-- ── 1 · the four owner doors ask the gates ──────────────────────────────────────────────────────────────────────────
alter policy "knowledge owner write" on public.agent_knowledge
  using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "promos owner write" on public.promos
  using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "drafts owner write" on public.gtm_drafts
  using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "decisions owner write" on public.strategy_decisions
  with check ((select public.is_admin()));

-- ── 2 · what a paid order bought keeps its door ─────────────────────────────────────────────────────────────────────
create or replace function public.money_columns_guard() returns trigger
  language plpgsql security invoker set search_path = public as $$
declare cols text[]; c text; o jsonb; n jsonb;
begin
  -- A function of ours runs as its owner and the server as service_role: only a page's own write is asked. Invoker on
  -- purpose — a definer would always see its owner here.
  if current_user not in ('authenticated', 'anon') or public.is_admin() then   -- a guest's write is a page's too
    return new;
  end if;
  n := to_jsonb(new);
  if tg_op = 'INSERT' then
    -- What a page never makes (0423): a shop order and its lines are the checkout's, a jug count the delivery's door.
    if tg_table_name in ('shop_orders', 'shop_order_items', 'jug_ledger') then
      raise exception '% is recorded through its own door, not written by a page.',
        case tg_table_name when 'shop_orders' then 'A shop order' when 'shop_order_items' then 'A shop order''s line'
                           else 'A jug count' end
        using errcode = '42501';
    end if;
    -- An expense a page logs is a live one (0423): it is voided through void_expense, never logged voided.
    if tg_table_name = 'expenses' then
      if n ->> 'voided_at' is not null then
        raise exception 'An expense is voided through its own door — it is not logged voided.' using errcode = '42501';
      end if;
      return new;
    end if;
    -- A page may not create one already settled (0420).
    if coalesce((n ->> 'paid')::boolean, false)
       or coalesce(n ->> 'payment_status', '') in ('paid', 'invoiced', 'refunded')
       or n ->> 'collected_at' is not null
       or (tg_table_name = 'invoices') then
      raise exception 'Money on an order is recorded through its own door — an owner or admin can settle it.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  -- 0437: what the price bought, beside the price — a size, a count, gallons, a due date.
  cols := case tg_table_name
    when 'drop_orders'      then array['paid', 'total_cents', 'payment_id', 'payment_status', 'collected_via', 'collected_at', 'collected_by', 'idempotency_key',
                                       'size', 'glass', 'mix', 'user_id', 'customer_id', 'benefit_code']
    when 'delivery_orders'  then array['total_cents', 'bottle_subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'payment_status', 'payment_method', 'payment_id',
                                       'pack_size', 'rise_count', 'flow_count', 'dusk_count', 'performance_count', 'performance_mix', 'refill_count', 'new_count',
                                       'user_id', 'customer_id']
    when 'business_orders'  then array['total_cents', 'subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'price_per_gallon_cents', 'payment_status', 'payment_id', 'square_order_id', 'paylink_url', 'paylink_id',
                                       'gallons', 'container', 'billing_terms', 'user_id', 'business_id', 'company_id']
    when 'invoices'         then array['amount_cents', 'status', 'paid_at', 'business_order_id', 'business_id',
                                       'terms', 'issued_at', 'due_at', 'company_id']
    when 'shop_orders'      then array['payment_id', 'subtotal_cents', 'total_cents', 'refund_amount_cents', 'status', 'status_changed_at', 'status_changed_by', 'benefit_code', 'user_id', 'customer_id', 'apliiq_order_id']
    when 'shop_order_items' then array['order_id', 'product_id', 'variant', 'qty', 'unit_cents', 'cost_cents']
    when 'jug_ledger'       then array['business_id', 'business_order_id', 'jugs_out', 'jugs_in', 'balance_after', 'voided_at', 'voided_by', 'void_reason']
    when 'expenses'         then array['amount_cents', 'spent_on', 'created_by', 'voided_at', 'voided_by', 'void_reason']
    else array[]::text[] end;
  o := to_jsonb(old);
  foreach c in array cols loop
    if (n -> c) is distinct from (o -> c) then
      raise exception 'Money on an order changes through its own door — % is not a page''s to write. An owner or admin can settle it.', c
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.money_columns_guard() from public, anon, authenticated;
comment on function public.money_columns_guard() is
  'Before a page writes a pack, delivery, office order, invoice (0420), shop order, shop order line, jug count or expense (0423): its money columns — and, since 0437, what the money bought: a size, a count, gallons, terms and dates — change only through a function of ours or the server, unless the caller is an owner or admin; a page may not create one already settled, nor a shop order, its line or a jug count at all. Named a_… so it reads the row as the page sent it, before the triggers that derive payment_status.';

-- ── 3 · the anonymous doors count who is calling ────────────────────────────────────────────────────────────────────
-- 0436's, with an IPv4 address written as IPv6 read as the IPv4 it is.
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
  if family(v_ip) = 6 and v_ip << '::ffff:0:0/96'::inet then
    return host(('0.0.0.0'::inet + (v_ip - '::ffff:0:0'::inet)));   -- ::ffff:a.b.c.d is a.b.c.d (0437)
  end if;
  if family(v_ip) = 6 then
    return host(network(set_masklen(v_ip, 64))) || '/64';
  end if;
  return host(v_ip);
end $$;
revoke all on function public.caller_address() from public, anon, authenticated;
comment on function public.caller_address() is
  'The caller''s address from cf-connecting-ip (Cloudflare''s, in front of Supabase''s API): an IPv4 address whole (also when written as IPv6, ::ffff:a.b.c.d — 0437), an IPv6 one as its /64; null when there is none (0436). Read by the anonymous doors to count one address apart.';

-- An IPv6 caller's /48: the most a home's router or a free tunnel hands out. Null for IPv4 and when there is no address.
create or replace function public.caller_block() returns text
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
  if family(v_ip) <> 6 or v_ip << '::ffff:0:0/96'::inet then return null; end if;
  return host(network(set_masklen(v_ip, 48))) || '/48';
end $$;
revoke all on function public.caller_block() from public, anon, authenticated;
comment on function public.caller_block() is
  'An IPv6 caller''s /48 from cf-connecting-ip — the most one home or tunnel is handed (0437); null for IPv4 or no address. The guest alerts door counts it between the address''s own count and everyone''s.';

-- The guest alerts door (0436's): the address's thirty, then the block's sixty, then everyone's three hundred, an hour.
create or replace function public.guest_device_fits() returns boolean
  language plpgsql volatile set search_path = public as $$
declare v_from text := public.caller_address(); v_block text := public.caller_block();
begin
  if v_from is not null then
    if not public.rate_limit_hit('push:new-guest:' || v_from, 3600000, 30) then
      return false;
    end if;
  end if;
  if v_block is not null then
    if not public.rate_limit_hit('push:new-guest:' || v_block, 3600000, 60) then
      return false;
    end if;
  end if;
  return public.rate_limit_hit('push:new-guest', 3600000, 300);
end $$;
revoke all on function public.guest_device_fits() from public, anon, authenticated;
comment on function public.guest_device_fits() is
  'Whether a new push device nobody is signed in on may be kept (0436, 0437): thirty an hour from one address (caller_address), then sixty from one IPv6 /48 (caller_block), then three hundred an hour for everyone (0418) — asked in that order. Read by keep_push_device and keep_app_push_token.';

-- The guest-traffic count (0267's): an address counted sixty times an hour at most; past that, not counted again.
create or replace function public.track_guest() returns void
language plpgsql security definer set search_path = public as $$
declare v_from text := public.caller_address();
begin
  if v_from is not null and not public.rate_limit_hit('guest-visit:' || v_from, 3600000, 60) then
    return;   -- a browser asks once an hour (lib/track); an address past sixty is a script, and isn't counted
  end if;
  insert into public.guest_daily (day, hits) values ((now() at time zone 'America/New_York')::date, 1)
  on conflict (day) do update set hits = public.guest_daily.hits + 1;
end $$;
revoke all on function public.track_guest() from public, anon, authenticated;
grant execute on function public.track_guest() to anon, authenticated;   -- every page asks it, signed in or not (lib/track)

-- A funnel step: stamped now, whatever the page said, and three hundred an hour from one address at most.
create or replace function public.funnel_step_counted() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_from text := public.caller_address();
begin
  new.at := now();   -- whenever a page says it happened, it happened now (nobody back-dates a step on purpose)
  if v_from is not null and not public.rate_limit_hit('funnel:' || v_from, 3600000, 300) then
    return null;     -- past the address's count: the step isn't kept (the page never reads its steps back)
  end if;
  return new;
end $$;
revoke all on function public.funnel_step_counted() from public, anon, authenticated;
comment on function public.funnel_step_counted() is
  'Before a page records a funnel step (0437): its time is now, and one address keeps three hundred an hour at most — past that the step is dropped.';
drop trigger if exists funnel_step_counted_tg on public.funnel_events;
create trigger funnel_step_counted_tg before insert on public.funnel_events
  for each row execute function public.funnel_step_counted();

-- Two doors nothing uses: the launch-interest list (no screen writes it any more) and a booking written straight from a
-- page (the app books through /api/book, as the server).
drop policy if exists "interest insert" on public.subscription_interest;
revoke insert on public.subscription_interest from anon, authenticated;
drop policy if exists "anyone request" on public.booking_requests;
revoke insert on public.booking_requests from anon;

-- ── 4 · an every-other-week program counts its weeks on the business's day ─────────────────────────────────────────
-- One already running on its UTC date keeps it, written as its anchor (none expected: the app makes weekly programs).
update public.company_programs
   set anchor_date = (created_at at time zone 'UTC')::date
 where every_n_weeks > 1 and anchor_date is null and starts_on is null;

-- 0356's, with the unanchored program's weeks counted from the Eastern day it was saved.
create or replace function public.office_rule_matches(p public.company_programs, d date) returns boolean
language plpgsql immutable as $$
declare anchor date; weeks int;
begin
  if p.starts_on is not null and d < p.starts_on then return false; end if;
  if p.ends_on is not null and d > p.ends_on then return false; end if;
  if not (extract(isodow from d)::smallint = any (p.weekdays)) then return false; end if;
  if p.monthly_nth is not null then
    if p.monthly_nth = -1 then return extract(month from d + 7) <> extract(month from d); end if;
    return ((extract(day from d)::int - 1) / 7) + 1 = p.monthly_nth;
  end if;
  if p.every_n_weeks > 1 then
    anchor := coalesce(p.anchor_date, p.starts_on, (p.created_at at time zone 'America/New_York')::date);   -- 0437: the business's day
    weeks := ((d - (extract(isodow from d)::int - 1)) - (anchor - (extract(isodow from anchor)::int - 1))) / 7;
    if weeks % p.every_n_weeks <> 0 then return false; end if;
  end if;
  return true;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A password alone opens no owner door', 'security', 'Settings',
   'With two-step set up, the AI agents'' lessons, the storefront''s promos, the strategy decisions and the drafts now ask for the authenticator''s code too — like every other owner and admin power.',
   '2026-10-18', false),
  ('A paid order keeps what it bought', 'fix', 'Money',
   'A pack''s size, a delivery''s bottles, an office order''s gallons and an invoice''s dates change only through their own doors (or an owner or admin) — never by editing the order behind its price.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_policies where schemaname = 'public'
--      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'role = ANY \(ARRAY\[''owner''::text, ''admin''::text\]\)'
--      and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'is_(admin|owner)\(';                                  -- 0
--   select count(*) from pg_policies where schemaname = 'public' and policyname in ('interest insert', 'anyone request');  -- 0
--   select count(*) from pg_trigger where tgname = 'funnel_step_counted_tg';                                         -- 1
--   select count(*) from public.company_programs where every_n_weeks > 1 and anchor_date is null and starts_on is null;  -- 0
select public.record_migration('0437_a_password_alone_opens_no_owner_door_and_a_paid_order_keeps_what_it_bought');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
