-- 0360 — A REFUSAL IS A 4xx, NOT A SERVER ERROR. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Found on the way (2026-10-08, the crew's first-day round). PostgREST answers SQLSTATE 55000
-- (object_not_in_prerequisite_state) and P0002 (no_data_found) with HTTP 500, the status it keeps
-- for a server that failed. The office functions (0357, 0359) use those two codes for the two
-- refusals a person causes:
--
--   "changes to this delivery closed" — 55000, eight places in office_change_delivery: the cutoff
--     passed, the driver left, it is brewing, it is paid, the program is paused, the morning is taken;
--   "that delivery isn't there" — P0002, eleven places in seven functions: a delivery the crew took
--     off, a stale tap, another company's id (which reads the same on purpose).
--
-- So every late change and every wrong id was logged as a server error: in Supabase's API logs, in
-- the browser's console, in any count of 5xx. 0226 named that noise when it gave the vendor
-- look-alike refusal PT409 ("a routine refusal reads as a true 409 Conflict, never a 5xx").
-- PostgREST answers a 'PTxyz' SQLSTATE with HTTP xyz, so these follow 0226's rule:
--
--   55000 → PT409   Conflict: the delivery's state refuses the change.
--   P0002 → PT404   Not Found: not there, or not theirs.
--
-- The functions keep their checks, in the same order, and their words. The bodies below are 0357's and
-- 0359's, copied with only the two codes swapped, and the grants are restated as they were.
--
-- The screens read both codes (lib/refusal.ts), so the paste and the deploy can go in either order. A
-- database test now fails any function that raises a code PostgREST answers with a 5xx
-- (scripts/db.refusals.test.mjs), so a new refusal cannot repeat this.
--
-- changelog: none — the same refusals in the same words; only the HTTP status under them changes.

-- ── 1 · office_log_delivery — the driver logs a delivery (0357; 1 refusal) ───────────────────────
-- existing rows: office_log_delivery — its alerts are written as before, word for word; only a refusal's code changes.
create or replace function public.office_log_delivery(p_order uuid, p_outcome text, p_jugs_in int default null)
returns public.business_orders
language plpgsql security definer set search_path = public as $$
declare
  o public.business_orders; v_out int; v_in int; v_bal int;
begin
  if not public.is_staff() then raise exception 'Only crew can log a delivery.' using errcode = '42501'; end if;
  if coalesce(p_outcome, '') not in ('delivered_swapped', 'delivered_no_swap', 'not_available') then
    raise exception 'Unknown outcome: %', coalesce(p_outcome, 'none') using errcode = '22023';
  end if;
  -- the caller's own company and city — what their screen shows them (0239's tenant isolation, 0291's
  -- market scope); anything else reads as not there, exactly as it does on the screen
  select * into o from public.business_orders
   where id = p_order and tenant_id = public.effective_tenant() and public.market_visible(market)
   for update;
  if not found then raise exception 'That delivery no longer exists.' using errcode = 'PT404'; end if;
  if o.canceled_at is not null then raise exception 'That delivery was canceled.' using errcode = '22023'; end if;
  if o.status in ('delivered', 'issue') or o.driver_outcome is not null then
    raise exception 'That delivery is already logged — undo it first.' using errcode = '22023';
  end if;
  if o.delivery_date > public.office_local_today(o.market) then
    raise exception 'That delivery is for % — log it on the day.', to_char(o.delivery_date, 'FMDay, Mon FMDD')
      using errcode = '22023';
  end if;

  if p_outcome = 'not_available' then
    update public.business_orders
       set status = 'issue', driver_outcome = 'not_available',
           driver_note = left('Not delivered — ' || to_char(now() at time zone public.office_tz(o.market), 'HH12:MI AM'), 200)
     where id = p_order returning * into o;
    perform public.alert_open_once(
      'office_not_delivered', o.id, 'important', 'order',
      left('Office delivery not made — ' || o.company, 180),
      o.company || ' (' || o.address_street || ', ' || o.address_city || ') wasn''t delivered this morning. '
        || round(o.gallons)::text || ' gal. ' || coalesce(o.contact_phone, ''),
      '/crew?s=now');
    return o;
  end if;

  v_out := round(o.gallons)::int;
  v_in  := case when p_outcome = 'delivered_swapped' then greatest(0, coalesce(p_jugs_in, v_out)) else 0 end;
  update public.business_orders
     set status = 'delivered', driver_outcome = p_outcome, jugs_out = v_out, jugs_in = v_in
   where id = p_order returning * into o;

  if o.business_id is not null then
    select greatest(0, coalesce(jug_balance, 0) + v_out - v_in) into v_bal
      from public.business_accounts where id = o.business_id for update;
    insert into public.jug_ledger (tenant_id, business_id, business_order_id, jugs_out, jugs_in, balance_after)
    values (o.tenant_id, o.business_id, o.id, v_out, v_in, v_bal);
    update public.business_accounts set jug_balance = v_bal, updated_at = now() where id = o.business_id;
  end if;
  return o;
end $$;
revoke all on function public.office_log_delivery(uuid, text, int) from public, anon;
grant execute on function public.office_log_delivery(uuid, text, int) to authenticated;

-- ── 2 · office_reopen_delivery — the driver undoes a mis-tap (0357; 1 refusal) ───────────────────
create or replace function public.office_reopen_delivery(p_order uuid, p_reason text)
returns public.business_orders
language plpgsql security definer set search_path = public as $$
declare o public.business_orders; j record;
begin
  if not public.is_staff() then raise exception 'Only crew can reopen a delivery.' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why it is being reopened.' using errcode = '22023'; end if;
  select * into o from public.business_orders
   where id = p_order and tenant_id = public.effective_tenant() and public.market_visible(market)
   for update;
  if not found then raise exception 'That delivery no longer exists.' using errcode = 'PT404'; end if;
  if o.canceled_at is not null then raise exception 'That delivery was canceled.' using errcode = '22023'; end if;
  if o.status not in ('delivered', 'issue') and o.driver_outcome is null then
    raise exception 'That delivery isn''t logged — there is nothing to undo.' using errcode = '22023';
  end if;
  -- the open jug entry for this delivery, reversed the way void_jug_entry reverses one (0310)
  for j in select id from public.v_jug_open where business_order_id = p_order loop
    perform public.void_jug_entry(j.id, btrim(p_reason));
  end loop;
  -- a "not delivered" that was a mis-tap: the crew's alert about it is answered, not left to chase
  update public.alerts set ack_at = now(), ack_by = auth.uid()
   where kind = 'office_not_delivered' and subject_id = p_order and ack_at is null;
  update public.business_orders
     set status = 'out_for_delivery', driver_outcome = null, jugs_in = null,
         driver_note = left('Reopened — ' || btrim(p_reason), 200)
   where id = p_order returning * into o;
  return o;
end $$;
revoke all on function public.office_reopen_delivery(uuid, text) from public, anon;
grant execute on function public.office_reopen_delivery(uuid, text) to authenticated;

-- ── 3 · office_change_delivery — a client's change to one delivery (0359; 9 refusals) ────────────
create or replace function public.office_change_delivery(
  p_order   uuid,
  p_change  text,
  p_gallons numeric default null,
  p_to      date    default null,
  p_note    text    default null,
  p_reason  text    default null,
  p_key     uuid    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.business_orders; v_before public.business_orders; p public.company_programs;
  v_crew boolean := public.is_staff();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_cut timestamptz; v_floor numeric; v_today date; v_closes text;
begin
  if auth.uid() is null then raise exception 'Sign in to change a delivery.' using errcode = '28000'; end if;
  if coalesce(p_change, '') not in ('quantity', 'skip', 'unskip', 'move', 'note') then
    raise exception 'Unknown change: %', coalesce(p_change, 'none') using errcode = '22023';
  end if;
  if v_reason is not null and v_reason not in ('fewer_people', 'ran_out', 'office_closed', 'other') then
    raise exception 'Unknown reason: %', v_reason using errcode = '22023';
  end if;

  -- the caller's own company, as their screen reads it: the crew in its tenant and city; a member of
  -- the delivery's company at its location. Anyone else is told it is not there.
  select * into o from public.business_orders
   where id = p_order and tenant_id = public.effective_tenant()
     and (not v_crew or public.market_visible(market))
   for update;
  if not found or (not v_crew and (o.company_id is null or not public.office_member_can(o.company_id, o.location_id, 'read'))) then
    raise exception 'That delivery no longer exists.' using errcode = 'PT404';
  end if;
  if not v_crew and not public.office_member_can(o.company_id, o.location_id, 'change') then
    raise exception 'Your role can read deliveries but not change them — ask your office admin.' using errcode = '42501';
  end if;

  -- the same key again: this change was made; answer with the delivery as it is, write nothing twice
  if p_key is not null and exists (select 1 from public.office_order_changes c where c.order_id = o.id and c.idem_key = p_key) then
    return public.office_delivery_json(o);
  end if;

  v_before := o;
  v_cut := coalesce(o.cutoff_at, public.office_cutoff(o.delivery_date, o.market));
  v_today := public.office_local_today(o.market);
  v_closes := to_char(v_cut at time zone public.office_tz(o.market), 'FMDy, Mon FMDD "at" FMHH12:MI AM');

  if p_change = 'note' then
    if o.canceled_at is not null or o.status not in ('received', 'brewed') or o.delivery_date < v_today then
      raise exception 'The driver has left for this delivery — send a message instead.' using errcode = 'PT409';
    end if;
    if char_length(coalesce(v_note, '')) > 300 then raise exception 'Keep the note to 300 characters.' using errcode = '22023'; end if;
    if o.client_note is not distinct from v_note then return public.office_delivery_json(o); end if;
    update public.business_orders set client_note = v_note, changed_at = now(), changed_by = auth.uid()
     where id = o.id returning * into o;
  else
    -- quantity, skip, unskip, move: open until the cutoff, and only while nothing is under way
    if p_change = 'unskip' then
      if o.canceled_at is null then return public.office_delivery_json(o); end if;     -- already on
      if o.canceled_reason is distinct from 'skipped' then
        raise exception 'That delivery was taken off the schedule, not skipped — send a request to bring it back.' using errcode = 'PT409';
      end if;
    elsif o.canceled_at is not null then
      if p_change = 'skip' and o.canceled_reason = 'skipped' then return public.office_delivery_json(o); end if;   -- already skipped
      raise exception 'That delivery is off the schedule%.', case when o.canceled_reason = 'paused' then ' while the program is paused' else '' end
        using errcode = 'PT409';
    end if;
    if o.status <> 'received' then
      raise exception 'That delivery is already under way — send a request instead.' using errcode = 'PT409';
    end if;
    if not v_crew and now() >= v_cut then
      raise exception 'Changes to this delivery closed %. Send it as a request and we''ll do what we can.', v_closes using errcode = 'PT409';
    end if;
    if p_change in ('quantity', 'skip')
       and (o.payment_status in ('paid', 'invoiced', 'refunded') or o.paylink_url is not null or o.square_order_id is not null) then
      raise exception 'That delivery is %. Send the change as a request and we''ll settle the difference.',
        case when o.payment_status = 'paid' then 'paid' when o.payment_status = 'invoiced' then 'invoiced' else 'already billed' end
        using errcode = 'PT409';
    end if;

    if p_change = 'quantity' then
      select greatest(3, coalesce(ls.office_min_gallons, 3)) into v_floor from public.live_status ls where ls.id = 1;
      v_floor := coalesce(v_floor, 3);
      if p_gallons is null or p_gallons <> round(p_gallons) then
        raise exception 'Gallons come in whole jugs.' using errcode = '22023';
      end if;
      if p_gallons < v_floor then raise exception 'The minimum is % gallons.', v_floor using errcode = '22023'; end if;
      if p_gallons > 100 then
        raise exception 'For more than 100 gallons, send a request — we''ll plan the brew.' using errcode = '22023';
      end if;
      if o.gallons = p_gallons then return public.office_delivery_json(o); end if;
      update public.business_orders
         set gallons = p_gallons, subtotal_cents = (p_gallons * price_per_gallon_cents)::int,
             total_cents = (p_gallons * price_per_gallon_cents)::int + delivery_fee_cents + tax_cents,
             gallons_changed_at = now(), changed_at = now(), changed_by = auth.uid(), change_reason = v_reason
       where id = o.id returning * into o;

    elsif p_change = 'skip' then
      update public.business_orders
         set canceled_at = now(), canceled_reason = 'skipped', changed_at = now(), changed_by = auth.uid(), change_reason = v_reason
       where id = o.id returning * into o;

    elsif p_change = 'unskip' then
      if o.program_id is not null and not exists (select 1 from public.company_programs cp where cp.id = o.program_id and cp.status = 'active') then
        raise exception 'The weekly program is paused — turn it back on first.' using errcode = 'PT409';
      end if;
      if exists (select 1 from public.business_orders x where x.location_id is not distinct from o.location_id and x.delivery_date = o.delivery_date
                    and x.canceled_at is null and x.id <> o.id) then
        raise exception 'That morning already has a delivery.' using errcode = 'PT409';
      end if;
      update public.business_orders
         set canceled_at = null, canceled_reason = null, changed_at = now(), changed_by = auth.uid(), change_reason = null
       where id = o.id returning * into o;

    else  -- move
      if p_to is null then raise exception 'Pick the morning to move it to.' using errcode = '22023'; end if;
      if p_to = o.delivery_date then return public.office_delivery_json(o); end if;
      if p_to <= v_today or p_to > v_today + public.office_horizon() or abs(p_to - o.delivery_date) > 14 then
        raise exception 'Pick a morning within two weeks of its day.' using errcode = '22023';
      end if;
      if extract(isodow from p_to) > 5 then raise exception 'Office deliveries are on weekdays.' using errcode = '22023'; end if;
      if public.office_closure(o.tenant_id, o.company_id, o.market, p_to) is not null then
        raise exception 'We''re closed that day — pick another morning.' using errcode = '22023';
      end if;
      if not v_crew and public.office_cutoff(p_to, o.market) <= now() then
        raise exception 'Changes for that morning have already closed — pick a later one.' using errcode = '22023';
      end if;
      if exists (select 1 from public.business_orders x where x.location_id is not distinct from o.location_id and x.delivery_date = p_to
                    and x.canceled_at is null and x.id <> o.id) then
        raise exception 'That morning already has a delivery — change its quantity instead.' using errcode = '22023';
      end if;
      if o.program_id is not null then
        select * into p from public.company_programs where id = o.program_id;
        if p.status = 'active' and public.office_rule_matches(p, p_to)
           and not exists (select 1 from public.business_orders x where x.program_id = o.program_id and x.scheduled_for = p_to) then
          raise exception 'That morning is already one of your delivery days — change its quantity instead.' using errcode = '22023';
        end if;
      end if;
      update public.business_orders
         set moved_from = coalesce(moved_from, delivery_date), moved_at = now(), delivery_date = p_to,
             cutoff_at = public.office_cutoff(p_to, market),
             changed_at = now(), changed_by = auth.uid(), change_reason = v_reason
       where id = o.id returning * into o;
    end if;
  end if;

  insert into public.office_order_changes (tenant_id, company_id, location_id, order_id, market, change, was, became, reason, changed_by, by_crew, idem_key)
  values (o.tenant_id, o.company_id, o.location_id, o.id, o.market, p_change,
          jsonb_build_object('date', v_before.delivery_date, 'gallons', v_before.gallons, 'total_cents', v_before.total_cents,
                             'canceled', v_before.canceled_at is not null, 'note', v_before.client_note),
          jsonb_build_object('date', o.delivery_date, 'gallons', o.gallons, 'total_cents', o.total_cents,
                             'canceled', o.canceled_at is not null, 'note', o.client_note),
          case when p_change in ('quantity', 'skip', 'move') then v_reason end, auth.uid(), v_crew, p_key);
  return public.office_delivery_json(o);
end $$;
revoke all on function public.office_change_delivery(uuid, text, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.office_change_delivery(uuid, text, numeric, date, text, text, uuid) to authenticated;

-- ── 4 · office_open_dates — the mornings a delivery can move to (0359; 1 refusal) ────────────────
create or replace function public.office_open_dates(p_order uuid)
returns table (delivery_date date, cutoff_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare o public.business_orders; p public.company_programs; v_crew boolean := public.is_staff(); v_today date; d date;
begin
  select * into o from public.business_orders
   where id = p_order and tenant_id = public.effective_tenant() and (not v_crew or public.market_visible(market));
  if not found or (not v_crew and (o.company_id is null or not public.office_member_can(o.company_id, o.location_id, 'read'))) then
    raise exception 'That delivery no longer exists.' using errcode = 'PT404';
  end if;
  if o.program_id is not null then select * into p from public.company_programs where id = o.program_id; end if;
  v_today := public.office_local_today(o.market);
  for d in select g::date from generate_series(greatest(v_today + 1, o.delivery_date - 14), least(o.delivery_date + 14, v_today + public.office_horizon()), interval '1 day') g loop
    continue when d = o.delivery_date or extract(isodow from d) > 5;
    continue when public.office_closure(o.tenant_id, o.company_id, o.market, d) is not null;
    continue when public.office_cutoff(d, o.market) <= now();
    continue when exists (select 1 from public.business_orders x where x.location_id is not distinct from o.location_id and x.delivery_date = d
                             and x.canceled_at is null and x.id <> o.id);
    continue when p.id is not null and p.status = 'active' and public.office_rule_matches(p, d)
                  and not exists (select 1 from public.business_orders x where x.program_id = p.id and x.scheduled_for = d);
    delivery_date := d; cutoff_at := public.office_cutoff(d, o.market);
    return next;
  end loop;
end $$;
revoke all on function public.office_open_dates(uuid) from public, anon;
grant execute on function public.office_open_dates(uuid) to authenticated;

-- ── 5 · office_request — a request to GT3 (0359; 4 refusals) ─────────────────────────────────────
-- existing rows: office_request — its alerts are written as before, word for word; only a refusal's code changes.
create or replace function public.office_request(
  p_kind    text,
  p_body    text,
  p_order   uuid  default null,
  p_company uuid  default null,
  p_wants   jsonb default null,
  p_key     uuid  default null
) returns public.company_requests
language plpgsql security definer set search_path = public as $$
declare
  r public.company_requests; o public.business_orders; v_crew boolean := public.is_staff();
  v_company uuid := p_company; v_location uuid; v_market text; v_name text; v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'Sign in to send a request.' using errcode = '28000'; end if;
  if coalesce(p_kind, '') not in ('change_after_cutoff', 'extra_delivery', 'new_location', 'event', 'equipment', 'billing', 'service_issue', 'other') then
    raise exception 'Unknown request: %', coalesce(p_kind, 'none') using errcode = '22023';
  end if;
  if v_body = '' then raise exception 'Say what you need.' using errcode = '22023'; end if;
  if char_length(v_body) > 1000 then raise exception 'Keep it to 1,000 characters.' using errcode = '22023'; end if;

  if p_order is not null then
    select * into o from public.business_orders
     where id = p_order and tenant_id = public.effective_tenant() and (not v_crew or public.market_visible(market));
    if not found or o.company_id is null then raise exception 'That delivery no longer exists.' using errcode = 'PT404'; end if;
    if v_company is not null and v_company <> o.company_id then raise exception 'That delivery no longer exists.' using errcode = 'PT404'; end if;
    v_company := o.company_id; v_location := o.location_id; v_market := o.market;
  elsif v_company is null and not v_crew then
    -- the caller's own company, when they have one
    select m.company_id into v_company from public.company_members m
     where m.user_id = auth.uid() and m.active order by m.created_at limit 1;
  end if;
  select c.name, coalesce(v_market, c.market) into v_name, v_market from public.companies c
   where c.id = v_company and c.tenant_id = public.effective_tenant() and (not v_crew or public.market_visible(c.market));
  if v_name is null or (not v_crew and not public.office_member_can(v_company, v_location, 'read')) then
    if p_order is not null then raise exception 'That delivery no longer exists.' using errcode = 'PT404'; end if;
    raise exception 'That company isn''t yours.' using errcode = 'PT404';
  end if;
  if not v_crew and not public.office_member_can(v_company, v_location, 'request') then
    raise exception 'Your role can read this account but not send requests — ask your office admin.' using errcode = '42501';
  end if;

  -- the same key again: this request was sent; answer with it, make nothing twice
  if p_key is not null then
    select * into r from public.company_requests where company_id = v_company and idem_key = p_key;
    if found then return r; end if;
  end if;

  insert into public.company_requests (tenant_id, company_id, location_id, order_id, market, kind, body, wants, created_by, idem_key)
  values (public.effective_tenant(), v_company, v_location, p_order, v_market, p_kind, v_body, p_wants, auth.uid(), p_key)
  returning * into r;
  perform public.alert_open_once(
    'office_request', r.id, 'important', 'order',
    left(public.office_request_label(p_kind) || ' — ' || v_name, 180),
    left(v_body, 400) || case when o.id is not null then ' (the ' || to_char(o.delivery_date, 'FMDay, Mon FMDD') || ' delivery)' else '' end,
    '/crew?s=now');
  return r;
end $$;
revoke all on function public.office_request(text, text, uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.office_request(text, text, uuid, uuid, jsonb, uuid) to authenticated;

-- ── 6 · office_request_set — the crew answers a request (0359; 1 refusal) ────────────────────────
create or replace function public.office_request_set(p_request uuid, p_status text, p_resolution text default null)
returns public.company_requests
language plpgsql security definer set search_path = public as $$
declare r public.company_requests;
begin
  if not public.is_staff() then raise exception 'Only the crew can answer a request.' using errcode = '42501'; end if;
  if coalesce(p_status, '') not in ('open', 'in_progress', 'done', 'declined') then
    raise exception 'Unknown status: %', coalesce(p_status, 'none') using errcode = '22023';
  end if;
  select * into r from public.company_requests
   where id = p_request and tenant_id = public.effective_tenant() and public.market_visible(market)
   for update;
  if not found then raise exception 'That request no longer exists.' using errcode = 'PT404'; end if;
  update public.company_requests
     set status = p_status,
         owner = case when p_status = 'in_progress' then coalesce(owner, auth.uid()) else owner end,
         resolution = coalesce(nullif(btrim(coalesce(p_resolution, '')), ''), resolution),
         resolved_at = case when p_status in ('done', 'declined') then now() end,
         resolved_by = case when p_status in ('done', 'declined') then auth.uid() end,
         updated_at = now()
   where id = r.id returning * into r;
  if p_status in ('done', 'declined') then
    update public.alerts set ack_at = now(), ack_by = auth.uid()
     where kind = 'office_request' and subject_id = r.id and ack_at is null;
  end if;
  return r;
end $$;
revoke all on function public.office_request_set(uuid, text, text) from public, anon;
grant execute on function public.office_request_set(uuid, text, text) to authenticated;

-- ── 7 · office_home — the client's home in one call (0359; 2 refusals) ───────────────────────────
create or replace function public.office_home(p_company uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_crew boolean := public.is_staff(); v_company uuid := p_company; m public.company_members; c public.companies;
  v_locs uuid[]; v_today date; v_role text;
begin
  if auth.uid() is null then raise exception 'Sign in to see your account.' using errcode = '28000'; end if;
  if v_company is null then
    select cm.company_id into v_company from public.company_members cm
     where cm.user_id = auth.uid() and cm.active order by cm.created_at limit 1;
    if v_company is null then return null; end if;      -- no office account: the page offers to set one up
  end if;
  select * into c from public.companies
   where id = v_company and tenant_id = public.effective_tenant() and (not v_crew or public.market_visible(market));
  if not found then raise exception 'That company isn''t yours.' using errcode = 'PT404'; end if;
  select * into m from public.company_members cm
   where cm.company_id = c.id and cm.user_id = auth.uid() and cm.active;
  if m.id is null and not v_crew then raise exception 'That company isn''t yours.' using errcode = 'PT404'; end if;
  v_role := case when m.id is not null then m.role else 'crew' end;
  v_locs := case when m.id is not null then m.location_ids end;     -- null = every location
  v_today := public.office_local_today(c.market);

  return jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'billing_terms', c.billing_terms, 'market', c.market),
    'role', v_role,
    'can_change', v_crew or v_role in ('admin', 'location_manager', 'orderer'),
    'can_request', v_crew or v_role in ('admin', 'location_manager', 'orderer', 'billing'),
    'today', v_today,
    'min_gallons', (select greatest(3, coalesce(ls.office_min_gallons, 3)) from public.live_status ls where ls.id = 1),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'label', coalesce(l.label, l.address_street), 'street', l.address_street,
                                   'city', l.address_city, 'access', l.access_instructions, 'market', l.market) order by l.created_at)
                             from public.company_locations l where l.company_id = c.id and (v_locs is null or l.id = any (v_locs))), '[]'::jsonb),
    'programs', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'location_id', p.location_id, 'status', p.status,
                                   'every_n_weeks', p.every_n_weeks, 'weekdays', p.weekdays, 'window', public.office_window(p),
                                   'gallons', (select coalesce(sum(pl.quantity), 0) from public.company_program_lines pl where pl.program_id = p.id),
                                   'price_per_gallon_cents', public.office_price(p),
                                   'account', (select jsonb_build_object('id', a.id, 'standing_active', a.standing_active, 'standing_gallons', a.standing_gallons,
                                                                         'mine', a.user_id = auth.uid())
                                                 from public.business_accounts a where a.program_id = p.id order by a.created_at limit 1)) order by p.created_at)
                            from public.company_programs p where p.company_id = c.id and p.status <> 'ended' and (v_locs is null or p.location_id = any (v_locs))), '[]'::jsonb),
    -- six weeks ahead, soonest first: what is coming, what was skipped (undoable), what a pause took off
    'agenda', coalesce((select jsonb_agg(public.office_delivery_json(o) order by o.delivery_date, o.created_at)
                          from public.business_orders o
                         where o.company_id = c.id and (v_locs is null or o.location_id = any (v_locs))
                           and o.delivery_date between v_today and v_today + public.office_horizon()
                           and (o.canceled_at is null or o.canceled_reason is null or o.canceled_reason in ('skipped', 'paused'))), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x.j order by x.d desc) from (
                          select public.office_delivery_json(o) j, o.delivery_date d from public.business_orders o
                           where o.company_id = c.id and (v_locs is null or o.location_id = any (v_locs))
                             and o.delivery_date < v_today and o.canceled_at is null
                           order by o.delivery_date desc limit 6) x), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(x.j order by x.t desc) from (
                            select jsonb_build_object('id', i.id, 'amount_cents', i.amount_cents, 'status', i.status, 'terms', i.terms,
                                     'issued_at', i.issued_at, 'due_at', i.due_at, 'paid_at', i.paid_at, 'order_id', i.business_order_id,
                                     'pay_url', case when i.status in ('open', 'sent') then (select bo.paylink_url from public.business_orders bo
                                                                                              where bo.id = i.business_order_id and bo.payment_status <> 'paid') end) j,
                                   i.issued_at t
                              from public.invoices i
                             where i.company_id = c.id and (v_locs is null or i.location_id = any (v_locs)) and i.status <> 'void'
                               and (i.status in ('open', 'sent') or i.issued_at > now() - interval '120 days')
                             order by i.issued_at desc limit 12) x), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(x.j order by x.t desc) from (
                            select jsonb_build_object('id', r.id, 'kind', r.kind, 'label', public.office_request_label(r.kind), 'body', r.body,
                                     'status', r.status, 'order_id', r.order_id, 'resolution', r.resolution, 'created_at', r.created_at,
                                     'resolved_at', r.resolved_at) j, r.created_at t
                              from public.company_requests r
                             where r.company_id = c.id and (v_locs is null or r.location_id is null or r.location_id = any (v_locs))
                               and (r.status in ('open', 'in_progress') or r.created_at > now() - interval '60 days')
                             order by r.created_at desc limit 20) x), '[]'::jsonb),
    'jugs', (select coalesce(sum(a.jug_balance), 0) from public.business_accounts a
              where a.company_id = c.id and (v_locs is null or a.location_id = any (v_locs))));
end $$;
revoke all on function public.office_home(uuid) from public, anon;
grant execute on function public.office_home(uuid) to authenticated;

-- verify:
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosrc ~* 'errcode\s*=\s*''(55000|P0002)''';   -- 0
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosrc ~ 'errcode = ''PT40[49]'''
--      and p.proname in ('office_log_delivery', 'office_reopen_delivery', 'office_change_delivery', 'office_open_dates',
--                        'office_request', 'office_request_set', 'office_home');   -- 7
--   select has_function_privilege('anon', 'public.office_change_delivery(uuid, text, numeric, date, text, text, uuid)', 'execute');   -- false
--   select has_function_privilege('authenticated', 'public.office_home(uuid)', 'execute');   -- true
select public.record_migration('0360_a_refusal_is_a_4xx_not_a_server_error',
  'office_log_delivery, office_reopen_delivery, office_change_delivery, office_open_dates, office_request, office_request_set, office_home: their refusals raise PT409 (was 55000) and PT404 (was P0002), so PostgREST answers 409 and 404, not 500. Checks, order and words unchanged; grants restated.');
