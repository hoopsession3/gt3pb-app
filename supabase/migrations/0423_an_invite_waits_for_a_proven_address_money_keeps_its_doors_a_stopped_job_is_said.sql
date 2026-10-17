-- ── 0423 — A STAFF INVITE WAITS FOR A PROVEN ADDRESS, MONEY KEEPS ITS DOORS, AND A JOB THAT STOPPED IS SAID ─────────
-- 2026-10-17. R18 of the 10/10 audit (Ryan, 2026-10-16: "then audit for 10/10 best practices... front and back end";
-- 2026-10-17: "Keep working to improve to a 10"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · A staff invite was claimed the moment an account row was made with the invited address — before anyone proved
--     the address was theirs (the security pass, SEC1). Anyone who knew an invitee's email could sign up with it and a
--     password; when the real invitee later signed in with the emailed code, the account they proved was the stranger's,
--     with the stranger's password still on it, now holding the invite's role.
--   · 0420 put packs, deliveries, office orders and invoices behind their own doors. Shop orders and their lines, the
--     office jug count and expenses were left writable by any crew role straight through the API (database F2): a
--     shop order's total or refund amount — which Money subtracts — an expense's amount, or a voided expense un-voided.
--   · Four places still asked the calendar in UTC (database F4): a city "opened" at 8 pm Eastern the evening before its
--     opening day (market_live), an office order showed at 8 pm the evening before its delivery (all_orders), an offer
--     letter expired at 8 pm on its last day (respond_to_offer), and an order due today stopped blocking an account's
--     erasure at 8 pm (account_erasure_blockers).
--   · cron_watch (0419) saw only runs that failed. A job that stopped running fails nothing, and the requests the
--     database sends — the push function's webhook, which carries every alert to the phones — answered errors no one
--     read (database F8, operations F11).
--   · The public buckets for Studio, training, brand and the shop took any file of any size from the crew writing them
--     (the security pass, SEC3). And four foreign keys on the paths alerts and the money doors walk had no index
--     (database F19).
--
-- WHAT.
--   · claim_team_invites(user, email): the one claim (0280's two updates). handle_new_user claims at sign-up only an
--     address a provider vouched for with no password on the row (Sign in with Apple); every other account claims when
--     its address is proven (claim_invites_on_proof, after email_confirmed_at is first set), and a password set on the
--     row before then is taken off it in the same write (invite_email_proven) — whoever proved the address signs in by
--     code, or sets a password of their own.
--   · money_columns_guard (0420's) takes four more tables: a page may not make a shop order, a shop order's line or a
--     jug count (the checkout, the delivery's door and void_jug_entry do), may log an expense but not a voided one, and
--     may not change a shop order's money, status or owner, a line's price or quantity, a jug count, or an expense's
--     amount, date, author or void — unless the caller is an owner or admin (Money's own spend editor is theirs).
--   · business_day() (0348) where current_date stood: market_live, all_orders, respond_to_offer,
--     account_erasure_blockers — each otherwise as it was, word for word.
--   · cron_watch: also one alert for a job that ran at least three times this week and has gone three of its usual gaps
--     without starting (cron_stalled, one open per job), and one while requests the database sent failed in the last
--     twenty minutes (db_http_failed — pg_net's answers, kept six hours).
--   · storage: content and shop take images and videos up to 100 MB (the shop's own list of types); brand and training
--     images up to 12 MB — what each screen's picker already allows (lib/shopMedia, the Studio, the brand kit, the AI
--     trainer).
--   · indexes on orders.collected_by, drop_orders.collected_by, loyalty_ledger.by_user and alerts.ack_by.
-- existing rows: team_invites — an invite already claimed stays claimed; one waiting is claimed by the next proven
--   sign-in, as before for every code sign-in. Passwords on accounts already confirmed are untouched.
-- existing rows: shop_orders, shop_order_items, jug_ledger, expenses — the guard reads writes from now on; no row changes.
-- existing rows: storage objects already in the four buckets stay; the limits apply to the next upload.
-- existing rows: cron_watch — its cron_failed alerts are written as they were; cron_stalled and db_http_failed are new
--   kinds, with no rows of theirs to restate.
-- changelog: below.

set lock_timeout = '5s';

-- ── a staff invite is claimed by a proven address ────────────────────────────────────────────────────────────────────
create or replace function public.claim_team_invites(p_user uuid, p_email text) returns integer
  language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_user is null or coalesce(btrim(p_email), '') = '' then return 0; end if;
  -- 0280's claim, word for word: it cannot mint an owner (team_invites.role excludes it) and leaves a crew role alone.
  update public.profiles p set role = i.role, is_admin = (i.role in ('admin','owner'))
    from public.team_invites i
    where p.id = p_user and i.claimed_at is null and lower(i.email) = lower(p_email) and p.role = 'member';
  update public.team_invites set claimed_at = now(), claimed_by = p_user
    where claimed_at is null and lower(email) = lower(p_email);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.claim_team_invites(uuid, text) from public, anon, authenticated;
comment on function public.claim_team_invites(uuid, text) is
  'The one staff-invite claim (0423): the invite''s role onto a member''s profile, the invite marked claimed. Called by handle_new_user for an address a provider vouched for, and by claim_invites_on_proof when an address is first proven.';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; base text; ref text;
begin
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), initcap(split_part(new.email, '@', 1)));
  base := upper(regexp_replace(split_part(nm, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
  if base = '' then base := 'GT3'; end if;
  ref := left(base, 8) || '-' || upper(substr(md5(new.id::text), 1, 4));
  begin
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, ref, false, 'member')
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, left(base, 8) || '-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8)), false, 'member')
    on conflict (id) do nothing;
  end;

  begin
    insert into public.customers (user_id, name, email, tenant_id)
    values (new.id, nm, new.email, public.effective_tenant())
    on conflict (user_id) do nothing;
  exception when others then null; -- never let a CRM-seed hiccup block account creation
  end;

  -- A STAFF INVITE WAITS FOR A PROVEN ADDRESS (0423). It was claimed here, the moment a row was made with the invited
  -- address — before anyone proved it. Now: an address a provider vouched for, with no password on the row (Sign in
  -- with Apple), claims here; every other account claims when its address is first proven (claim_invites_on_proof).
  if new.email_confirmed_at is not null and coalesce(new.encrypted_password, '') = '' then
    perform public.claim_team_invites(new.id, new.email);
  end if;

  return new;
end $$;

create or replace function public.invite_email_proven() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- The address is proven now. A password already on the row was set by whoever made the account before that — not
  -- necessarily its owner — and an invite waits for this address: the password goes, so only the person who proved it
  -- is in. They sign in by code, or set a password of their own.
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and coalesce(new.encrypted_password, '') <> ''
     and exists (select 1 from public.team_invites i where i.claimed_at is null and lower(i.email) = lower(new.email)) then
    new.encrypted_password := '';
  end if;
  return new;
end $$;
revoke all on function public.invite_email_proven() from public, anon, authenticated;
comment on function public.invite_email_proven() is
  'Before an account''s address is first proven (0423): if a staff invite waits for that address, a password set on the row before the proof is taken off — the invite is claimed only by whoever proved the address.';

create or replace function public.claim_invites_on_proof() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public.claim_team_invites(new.id, new.email);
  end if;
  return null;
end $$;
revoke all on function public.claim_invites_on_proof() from public, anon, authenticated;
comment on function public.claim_invites_on_proof() is
  'After an account''s address is first proven (0423): a staff invite waiting for it is claimed.';

drop trigger if exists invite_email_proven on auth.users;
create trigger invite_email_proven before update of email_confirmed_at on auth.users
  for each row execute function public.invite_email_proven();
drop trigger if exists claim_invites_on_proof on auth.users;
create trigger claim_invites_on_proof after update of email_confirmed_at on auth.users
  for each row execute function public.claim_invites_on_proof();

-- ── the money on a shop order, a jug count and an expense keeps its doors ────────────────────────────────────────────
create or replace function public.money_columns_guard() returns trigger
  language plpgsql security invoker set search_path = public as $$
declare cols text[]; c text; o jsonb; n jsonb;
begin
  -- A function of ours runs as its owner and the server as service_role: only a page's own write is asked. Invoker on
  -- purpose — a definer would always see its owner here.
  if current_user <> 'authenticated' or public.is_admin() then
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
  cols := case tg_table_name
    when 'drop_orders'      then array['paid', 'total_cents', 'payment_id', 'payment_status', 'collected_via', 'collected_at', 'collected_by', 'idempotency_key']
    when 'delivery_orders'  then array['total_cents', 'bottle_subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'payment_status', 'payment_method', 'payment_id']
    when 'business_orders'  then array['total_cents', 'subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'price_per_gallon_cents', 'payment_status', 'payment_id', 'square_order_id', 'paylink_url', 'paylink_id']
    when 'invoices'         then array['amount_cents', 'status', 'paid_at', 'business_order_id', 'business_id']
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
  'Before a page writes a pack, delivery, office order, invoice (0420), shop order, shop order line, jug count or expense (0423): its money columns change only through a function of ours or the server, unless the caller is an owner or admin; a page may not create one already settled, nor a shop order, its line or a jug count at all. Named a_… so it reads the row as the page sent it, before the triggers that derive payment_status.';

drop trigger if exists a_money_columns_guard on public.shop_orders;
create trigger a_money_columns_guard before insert or update on public.shop_orders
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.shop_order_items;
create trigger a_money_columns_guard before insert or update on public.shop_order_items
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.jug_ledger;
create trigger a_money_columns_guard before insert or update on public.jug_ledger
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.expenses;
create trigger a_money_columns_guard before insert or update on public.expenses
  for each row execute function public.money_columns_guard();

-- ── the business day where the calendar was still UTC ────────────────────────────────────────────────────────────────
-- Each is its last migration's text with current_date → public.business_day() (0348: the Eastern calendar day), and
-- nothing else changed.
-- security_invoker: market_live — definer on purpose, as 0285 made it and 0412 kept it: the storefront asks it signed out,
-- and markets is the crew's to read; it says only whether each city is open.
create or replace view public.market_live as
select m.slug                                                    as market,
       ((m.is_live is distinct from false)
         and coalesce(ls.is_live, false)
         and (m.opens_on is null or m.opens_on <= public.business_day()))  as is_live,
       coalesce(m.preorder_lead_h, ls.preorder_lead_h, 4)         as preorder_lead_h,
       coalesce(m.pay_at_pickup,   ls.pay_at_pickup,   true)      as pay_at_pickup,
       m.opens_on,
       (m.opens_on is not null and m.opens_on > public.business_day())     as pre_launch,
       (m.is_live is not distinct from false)                     as held_closed
  from public.markets m
  left join (select is_live, preorder_lead_h, pay_at_pickup
               from public.live_status where id = 1) ls on true;
revoke all on public.market_live from public;
grant select on public.market_live to anon, authenticated;

create or replace view public.all_orders with (security_invoker = on) as
  select 'cup'::text as channel, id, customer_id, user_id, tenant_id,
    fulfillment_status, payment_status, total_cents, created_at
  from public.orders
  union all
  select 'pickup', id, customer_id, user_id, tenant_id,
    fulfillment_status, payment_status, total_cents, created_at
  from public.drop_orders
  union all
  select 'delivery', id, customer_id, user_id, tenant_id,
    fulfillment_status, payment_status, total_cents, created_at
  from public.delivery_orders
  union all
  select 'office', id, customer_id, user_id, tenant_id,
    case when canceled_at is not null then 'canceled' when status = 'delivered' then 'fulfilled' when status in ('received','brewed') then 'placed' else 'in_prep' end,
    case payment_status when 'paid' then 'paid' when 'refunded' then 'refunded' when 'failed' then 'failed' else 'pending' end,
    total_cents, (delivery_date + time '12:00') at time zone 'UTC'
  from public.business_orders
  where delivery_date <= public.business_day();

create or replace function public.respond_to_offer(p_id uuid, p_action text, p_note text default null)
returns public.offer_letters language plpgsql security definer set search_path = public as $$
declare o public.offer_letters; nxt text; me_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to answer your offer.' using errcode = '28000';
  end if;
  select * into o from public.offer_letters where id = p_id;
  if not found then raise exception 'No such offer.'; end if;

  me_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if o.candidate_user_id is distinct from auth.uid()
     and lower(o.candidate_email) is distinct from me_email then
    raise exception 'Only the person this offer is for can respond to it.';
  end if;
  if o.status not in ('sent','countered') then
    raise exception 'This offer is not open for a response right now (it is %).', o.status;
  end if;
  if o.expires_on is not null and o.expires_on < public.business_day() then
    update public.offer_letters set status = 'expired', updated_at = now() where id = p_id;
    raise exception 'This offer expired on %.', o.expires_on;
  end if;

  nxt := case p_action when 'accept' then 'accepted'
                       when 'decline' then 'declined'
                       when 'counter' then 'countered' else null end;
  if nxt is null then raise exception 'Unknown response: %. Use accept, decline or counter.', p_action; end if;

  update public.offer_letters
     set status = nxt,
         responded_at = now(),
         -- link the account on first response, so later reads stop depending on the email match
         candidate_user_id = coalesce(candidate_user_id, auth.uid()),
         updated_at = now()
   where id = p_id returning * into o;

  update public.offer_events set note = coalesce(p_note, note)
   where id = (select id from public.offer_events where offer_id = p_id order by at desc limit 1);

  return o;
end $$;

create or replace function public.account_erasure_blockers(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role      text;
  v_tenant    uuid;
  v_customers uuid[];
  out         jsonb := '[]'::jsonb;
begin
  select role, tenant_id into v_role, v_tenant from public.profiles where id = p_user;
  select coalesce(array_agg(id), '{}') into v_customers from public.customers where user_id = p_user;

  if v_role = 'owner' and not exists (
    select 1 from public.profiles o where o.role = 'owner' and o.id <> p_user and o.tenant_id is not distinct from v_tenant
  ) then
    out := out || jsonb_build_object('code', 'only_owner',
      'message', 'You are this business''s only owner. Make someone else an owner in Team first, then delete your account.');
  end if;

  if exists (select 1 from public.drop_orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers)) and o.canceled_at is null
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.drop_date >= public.business_day())
     or exists (select 1 from public.delivery_orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers))
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.delivery_date >= public.business_day())
     or exists (select 1 from public.orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers))
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.created_at > now() - interval '12 hours')
     or exists (select 1 from public.shop_orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers))
                and o.status in ('paid', 'needs_fulfillment') and o.created_at > now() - interval '30 days')
     -- a reserve they paid for, from a drop still running, not yet in their hands
     or exists (select 1 from public.reserve_claims c join public.reserves r on r.id = c.reserve_id
              where c.user_id = p_user and c.state = 'paid' and r.status in ('live', 'sold_out')
                and (c.order_id is null or exists (select 1 from public.orders o where o.id = c.order_id
                                                     and o.fulfillment_status in ('placed', 'in_prep', 'ready')))) then
    out := out || jsonb_build_object('code', 'order_on_its_way',
      'message', 'You have an order on its way. Once it is picked up or delivered, you can delete your account here.');
  end if;

  return out;
end $$;


-- ── a job that stopped, and a request the database sent that failed, are said ────────────────────────────────────────
create or replace function public.cron_watch() returns integer
  language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; bad integer; last_err text; gap text;
begin
  for r in
    select j.jobname, count(*) as fails, max(d.end_time) as last_at,
           (array_agg(left(coalesce(d.return_message, ''), 160) order by d.end_time desc))[1] as said
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where d.status = 'failed' and d.end_time > now() - interval '20 minutes'
     group by j.jobname
  loop
    -- One open alert per job (alert_open_once: a job failing every run is one alert, its count going up), named by the
    -- job — the subject is the job's name made a uuid, so the same job is the same alert.
    perform public.alert_open_once('cron_failed', md5('cron:' || r.jobname)::uuid, 'important', 'system',
      'A scheduled job is failing — ' || r.jobname,
      r.fails || ' failed run' || case when r.fails = 1 then '' else 's' end || ' in the last 20 minutes. The last said: '
        || coalesce(nullif(btrim(r.said), ''), '(nothing)'),
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  end loop;

  -- A JOB THAT STOPPED (0423). A schedule that no longer fires fails nothing, so the loop above never sees it. A job
  -- that started at least three times this week and has now gone three of its usual gaps (half an hour at least)
  -- without starting is one alert of its own.
  for r in
    with runs as (
      select j.jobname, d.start_time,
             extract(epoch from d.start_time - lag(d.start_time) over (partition by d.jobid order by d.start_time))::float8 as gap_s
        from cron.job j join cron.job_run_details d on d.jobid = j.jobid
       where d.start_time > now() - interval '7 days'
    )
    select jobname, max(start_time) as last_start, percentile_cont(0.5) within group (order by gap_s) as usual_s
      from runs group by jobname
    having count(*) >= 3
  loop
    continue when r.usual_s is null or now() - r.last_start <= make_interval(secs => greatest(3 * r.usual_s, 1800));
    gap := case when r.usual_s < 5400 then round((r.usual_s / 60)::numeric) || ' minutes'
                when r.usual_s < 172800 then round((r.usual_s / 3600)::numeric) || ' hours'
                else round((r.usual_s / 86400)::numeric) || ' days' end;
    perform public.alert_open_once('cron_stalled', md5('cron-stalled:' || r.jobname)::uuid, 'important', 'system',
      'A scheduled job stopped running — ' || r.jobname,
      'It usually starts about every ' || gap || '; it last started '
        || to_char(r.last_start at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET.',
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  end loop;

  -- WHAT THE DATABASE SENT AND DIDN'T LAND (0423). pg_net keeps six hours of answers to the requests the database
  -- makes — the push function's webhook among them, which carries every alert to the phones, Teams and email — and
  -- nothing read them. One alert while any failed in the last twenty minutes.
  begin
    execute $q$
      select count(*)::int,
             (array_agg(left(coalesce(nullif(btrim(error_msg), ''), 'HTTP ' || status_code::text, 'timed out'), 160)
                order by created desc))[1]
        from net._http_response
       where created > now() - interval '20 minutes'
         and (timed_out or status_code >= 400 or nullif(btrim(error_msg), '') is not null)$q$
      into bad, last_err;
  exception when undefined_table or invalid_schema_name or undefined_column then
    bad := 0;
  end;
  if coalesce(bad, 0) > 0 then
    perform public.alert_open_once('db_http_failed', md5('db-http:sent')::uuid, 'important', 'system',
      'Requests the database sends are failing — ' || bad || ' in 20 minutes',
      'Most likely the push function''s webhook: alerts may not be reaching phones, Teams or email until it answers. The last said: '
        || coalesce(last_err, '(nothing)') || '.',
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  end if;

  -- The run log keeps a week (it grew by thousands of rows a day and was never pruned).
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  return n;
end $$;
revoke all on function public.cron_watch() from public, anon, authenticated;
comment on function public.cron_watch() is
  'Every ten minutes (0419, 0423): a job with failed runs in the last twenty minutes (cron_failed), a job that has gone three of its usual gaps without starting (cron_stalled) — one open alert per job — and one alert while requests the database sent failed in the last twenty minutes (db_http_failed). The run log keeps a week.';

-- ── what a public bucket takes ───────────────────────────────────────────────────────────────────────────────────────
update storage.buckets set file_size_limit = 104857600, allowed_mime_types = array['image/*', 'video/*']
 where id = 'content';
update storage.buckets set file_size_limit = 104857600,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']
 where id = 'shop';
update storage.buckets set file_size_limit = 12582912, allowed_mime_types = array['image/*']
 where id in ('brand', 'training');

-- ── the foreign keys alerts and the money doors walk ─────────────────────────────────────────────────────────────────
create index if not exists orders_collected_by_idx on public.orders (collected_by) where collected_by is not null;
create index if not exists drop_orders_collected_by_idx on public.drop_orders (collected_by) where collected_by is not null;
create index if not exists loyalty_ledger_by_user_idx on public.loyalty_ledger (by_user) where by_user is not null;
create index if not exists alerts_ack_by_idx on public.alerts (ack_by) where ack_by is not null;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A crew invite goes to whoever proves the address', 'fix', 'Team',
   'A staff invite is claimed only once the invited address is proven — by the emailed code or link, or by Sign in with Apple — and a password someone set on that address before it was proven no longer opens the account.',
   '2026-10-17', false),
  ('Shop orders, jug counts and expenses keep their money', 'fix', 'Money',
   'A shop order''s total, refund and status, a jug count, and an expense''s amount or void change only through the app''s own steps (or an owner or admin), as packs, deliveries and office orders already did.',
   '2026-10-17', false),
  ('A scheduled job that stops is said', 'fix', 'System',
   'Besides a job that fails, a job that stops running and requests to the push service that fail now raise an alert in Settings, instead of going quiet.',
   '2026-10-17', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_trigger where tgname = 'a_money_columns_guard';                                       -- 8
--   select count(*) from pg_trigger where tgname in ('invite_email_proven', 'claim_invites_on_proof');            -- 2
--   select prosrc like '%claim_team_invites%' from pg_proc where proname = 'handle_new_user';                    -- t
--   select count(*) from pg_proc where proname = 'cron_watch' and prosrc like '%cron_stalled%';                  -- 1
--   select count(*) from storage.buckets where id in ('content','shop','brand','training') and allowed_mime_types is not null; -- 4
--   select count(*) from pg_indexes where indexname in ('orders_collected_by_idx','drop_orders_collected_by_idx','loyalty_ledger_by_user_idx','alerts_ack_by_idx'); -- 4
select public.record_migration('0423_an_invite_waits_for_a_proven_address_money_keeps_its_doors_a_stopped_job_is_said');
