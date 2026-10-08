-- 0359 — A CLIENT CHANGES A DELIVERY UNTIL ITS CUTOFF. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Phase 2, part 2 of the B2B challenge report (2026-10-07, "GT3 Challenge Report — B2B and Adaptive
-- Layout": Client experience — "Self-service until the cutoff, then a graceful handoff"; Scheduling —
-- "Exceptions live on the delivery itself"; Data and state — "Cutoffs are enforced in the database",
-- "Every client action carries an idempotency key", "A change locks its delivery row"; Performance —
-- "The client home is one server call"). Until now a client could turn the weekly order on or off and
-- set its gallons (0354), and nothing else: one Monday's change was a text to GT3. This gives the
-- client the change sheet's four actions on one delivery, each kept by the database:
--
--   office_change_delivery(order, action, …, key) — this delivery's quantity, skip it (kept as
--   skipped, never deleted), bring a skip back, move it to another morning (its program date kept,
--   the date it left recorded), or a note for the driver. Until the delivery's cutoff (6 PM market
--   time the weekday before, stored on the delivery by 0356); after it the database refuses with
--   55000 and the screen turns the same sheet into a request — never a dead button. The note runs
--   until the driver leaves. A delivery that is paid, invoiced or has a pay link keeps its money: its
--   quantity and skip go through a request. The row is locked while it is written; the same key
--   twice changes nothing twice; the same answer twice (5 gallons, then 5 again) is no change at all.
--   Who: the crew, or a member of the delivery's company whose role changes deliveries (admin,
--   location manager, orderer) at that location. A viewer or billing person is told so; anyone
--   else is told the delivery is not there, exactly as their screen would.
--
--   office_open_dates(order) — the mornings it can move to: weekdays within two weeks of its day and
--   inside the schedule's six weeks, open (no closed date), cutoff still ahead, and not a morning that
--   location already has a delivery on (or will: one of its program's own dates).
--
--   office_request(kind, body, …, key) — a change after the cutoff, an extra delivery, a new
--   location, an event, equipment, billing, a service issue: a real record with a status and an
--   owner, so it becomes work for GT3 (the crew's inbox is told, once). office_request_set — the
--   crew moves it along, and answering it answers the alert.
--
--   office_home(company) — the client's home in one call: the company, its locations and programs,
--   the next delivery, six weeks of agenda (skips and pauses included, so they can be undone), the
--   recent ones, invoices with their pay link, requests, the jug count, and what the caller may do.
--
-- THE GENERATOR NEVER OVERWRITES A CLIENT. A delivery the client changed is a decision (0356 left the
-- word for this part): a new weekly quantity no longer reaches a delivery whose quantity the client
-- set for that day, and a new rule no longer takes off a delivery the client moved to a morning of
-- their own. A pause still takes off every open delivery (changed or not — paused means none), a
-- resume brings them back as the client left them, and the program's window, price and door still
-- reach them all (those are GT3's, not the client's). Skipped stays skipped: the generator never
-- makes a decided date again (0356's unique program date), and a resume brings back only what the
-- pause took off.
--
-- LOCATIONS. company_members.location_ids (null = every location of the company) is the "which
-- locations" the report gives each person. Every function here asks it; a one-location client never
-- sees it.
--
-- Nothing here changes a value anyone reads today; production has no office accounts yet.
--
-- changelog: below.

-- ── 1 · the delivery remembers a client's change ─────────────────────────────────────────────────
alter table public.business_orders add column if not exists changed_at timestamptz;
alter table public.business_orders add column if not exists changed_by uuid references auth.users(id) on delete set null;
alter table public.business_orders add column if not exists change_reason text;
alter table public.business_orders add column if not exists gallons_changed_at timestamptz;
alter table public.business_orders add column if not exists moved_from date;
alter table public.business_orders add column if not exists moved_at timestamptz;
alter table public.business_orders add column if not exists client_note text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_orders_client_change_ok') then
    alter table public.business_orders add constraint business_orders_client_change_ok check (
      (change_reason is null or change_reason in ('fewer_people', 'ran_out', 'office_closed', 'other'))
      and (client_note is null or char_length(client_note) <= 300));
  end if;
end $$;
comment on column public.business_orders.changed_at is 'When someone last changed this delivery through office_change_delivery (0359): its quantity, a skip, a move or the note.';
comment on column public.business_orders.gallons_changed_at is 'When this delivery''s quantity was set for this day (0359). The program''s weekly quantity no longer reaches it.';
comment on column public.business_orders.moved_from is 'The morning this delivery was on before it was first moved (0359). scheduled_for keeps the program date.';
comment on column public.business_orders.moved_at is 'When it was moved to another morning (0359). A new program rule no longer takes it off.';
comment on column public.business_orders.client_note is 'The client''s note for this delivery, shown on the driver''s stop (0359). Up to 300 characters.';

-- ── 2 · which locations a person is for ──────────────────────────────────────────────────────────
alter table public.company_members add column if not exists location_ids uuid[];
comment on column public.company_members.location_ids is 'The locations this person is for (0359); null = every location of the company.';

-- May the caller act for this company at this location? read: any active member · change (a
-- delivery's quantity, skip, move, note): admin, location manager, orderer · request: those and
-- billing. A null location is the company as a whole (a billing question). The crew is asked separately.
create or replace function public.office_member_can(p_company uuid, p_location uuid, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members m
     where m.company_id = p_company and m.user_id = (select auth.uid()) and m.active
       and (m.location_ids is null or p_location is null or p_location = any (m.location_ids))
       and case p_action
             when 'read'    then true
             when 'change'  then m.role in ('admin', 'location_manager', 'orderer')
             when 'request' then m.role in ('admin', 'location_manager', 'orderer', 'billing')
             else false
           end)
$$;
revoke all on function public.office_member_can(uuid, uuid, text) from public, anon;
grant execute on function public.office_member_can(uuid, uuid, text) to authenticated;

-- ── 3 · every change is on record: who, what it was, what it became, why ───────────────────────
create table if not exists public.office_order_changes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  company_id  uuid not null references public.companies(id),
  location_id uuid references public.company_locations(id),
  order_id    uuid not null references public.business_orders(id),
  market      text not null default 'greenville',
  change      text not null check (change in ('quantity', 'skip', 'unskip', 'move', 'note')),
  was         jsonb not null default '{}'::jsonb,      -- the delivery before: date, gallons, total, skipped, note
  became      jsonb not null default '{}'::jsonb,      -- and after
  reason      text check (reason is null or reason in ('fewer_people', 'ran_out', 'office_closed', 'other')),
  -- the company's record: a person who deletes their GT3 account leaves it, unsigned (0353's rule)
  changed_by  uuid references auth.users(id) on delete set null,
  by_crew     boolean not null default false,
  idem_key    uuid,
  created_at  timestamptz not null default now()
);
create unique index if not exists office_order_changes_key on public.office_order_changes (order_id, idem_key) where idem_key is not null;
create index if not exists office_order_changes_company on public.office_order_changes (company_id, created_at desc);
comment on table public.office_order_changes is
  'Every change to an office delivery made through office_change_delivery (0359): the change, the delivery before and after, the reason, who. Written only by that function; nobody edits it.';

-- ── 4 · a request is a record with a status and an owner ─────────────────────────────────────────
create table if not exists public.company_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  company_id  uuid not null references public.companies(id),
  location_id uuid references public.company_locations(id),
  order_id    uuid references public.business_orders(id),
  market      text not null default 'greenville',
  kind        text not null check (kind in ('change_after_cutoff', 'extra_delivery', 'new_location', 'event', 'equipment', 'billing', 'service_issue', 'other')),
  body        text not null check (btrim(body) <> '' and char_length(body) <= 1000),
  -- what a change after the cutoff asked for, as the sheet had it: {"change":"quantity","gallons":6}
  wants       jsonb,
  status      text not null default 'open' check (status in ('open', 'in_progress', 'done', 'declined')),
  owner       uuid references auth.users(id) on delete set null,     -- who at GT3 has it; null = the crew's
  resolution  text check (resolution is null or char_length(resolution) <= 1000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  -- the company's record: a person who deletes their GT3 account leaves it, unsigned (0353's rule)
  created_by  uuid references auth.users(id) on delete set null,
  idem_key    uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists company_requests_key on public.company_requests (company_id, idem_key) where idem_key is not null;
create index if not exists company_requests_open on public.company_requests (tenant_id, status, created_at desc);
create index if not exists company_requests_company on public.company_requests (company_id, created_at desc);
comment on table public.company_requests is
  'What a client asked GT3 for (0359): a change after the cutoff, an extra delivery, a new location, an event, equipment, billing, a service issue. Made by office_request, moved along by office_request_set; each one tells the crew once.';

-- ── 5 · who reads them, and that only the functions write them ───────────────────────────────────
alter table public.office_order_changes enable row level security;
alter table public.company_requests enable row level security;

drop policy if exists "office changes staff read" on public.office_order_changes;
create policy "office changes staff read" on public.office_order_changes for select using ((select public.is_staff()));
drop policy if exists "office changes member read" on public.office_order_changes;
create policy "office changes member read" on public.office_order_changes for select
  using (public.office_member_can(company_id, location_id, 'read'));

drop policy if exists "company requests staff read" on public.company_requests;
create policy "company requests staff read" on public.company_requests for select using ((select public.is_staff()));
drop policy if exists "company requests member read" on public.company_requests;
create policy "company requests member read" on public.company_requests for select
  using (public.office_member_can(company_id, location_id, 'read'));

do $$
declare t text;
begin
  foreach t in array array['office_order_changes', 'company_requests'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant())', t);
    -- the crew's city filter (0291), as on the company records
    execute format('drop policy if exists "market scope" on public.%I', t);
    execute format('create policy "market scope" on public.%I as restrictive for select using (public.market_visible(market))', t);
    -- read for the signed-in (the policies decide which rows), nothing for anyone else, and no
    -- writes from the app: office_change_delivery, office_request and office_request_set write them
    execute format('revoke all on public.%I from public, anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ── 5b · the company's people read its deliveries, live ──────────────────────────────────────────
-- 0187 let a client read the deliveries they booked (user_id is theirs) and nothing else — the whole
-- of it when one person was the account. A company has people now (0355): the office manager who did
-- not book still has to see Monday's delivery, and the client's home follows the crew as it works
-- (brewed, on the way, delivered) only if the database lets realtime show them the row. Read only, at
-- their locations; every client write goes through office_change_delivery.
drop policy if exists "biz order member read" on public.business_orders;
create policy "biz order member read" on public.business_orders for select
  using (company_id is not null and public.office_member_can(company_id, location_id, 'read'));

-- A change and a request reach every screen that has the company open the moment they are saved
-- (business_orders joined supabase_realtime in 0357).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['office_order_changes', 'company_requests'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ── 6 · one delivery as the client's screen reads it ─────────────────────────────────────────────
-- One shape for the home's agenda and every change's answer. `open`: changes are still open (before
-- the cutoff, not under way) — a skipped delivery too, so it can come back. `money_locked`: paid,
-- invoiced or linked to a payment — its quantity and skip go through a request.
create or replace function public.office_delivery_json(o public.business_orders) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'date', o.delivery_date, 'scheduled_for', o.scheduled_for, 'window', o.delivery_window,
    'gallons', o.gallons, 'price_per_gallon_cents', o.price_per_gallon_cents, 'total_cents', o.total_cents,
    'status', o.status, 'payment_status', o.payment_status, 'driver_outcome', o.driver_outcome,
    'jugs_out', o.jugs_out, 'jugs_in', o.jugs_in,
    'canceled', o.canceled_at is not null, 'canceled_reason', o.canceled_reason,
    'cutoff_at', coalesce(o.cutoff_at, public.office_cutoff(o.delivery_date, o.market)),
    'open', (o.canceled_at is null or o.canceled_reason = 'skipped') and o.status = 'received'
            and now() < coalesce(o.cutoff_at, public.office_cutoff(o.delivery_date, o.market)),
    'money_locked', o.payment_status in ('paid', 'invoiced', 'refunded') or o.paylink_url is not null or o.square_order_id is not null,
    'note_open', o.canceled_at is null and o.status in ('received', 'brewed') and o.delivery_date >= public.office_local_today(o.market),
    'moved_from', o.moved_from, 'client_note', o.client_note, 'change_reason', o.change_reason,
    'changed_at', o.changed_at, 'gallons_changed', o.gallons_changed_at is not null,
    'location_id', o.location_id, 'program_id', o.program_id, 'market', o.market,
    'paylink_url', case when o.payment_status in ('pending', 'failed') and o.canceled_at is null then o.paylink_url end)
$$;
revoke all on function public.office_delivery_json(public.business_orders) from public, anon, authenticated;

-- ── 7 · the change ───────────────────────────────────────────────────────────────────────────────
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
    raise exception 'That delivery no longer exists.' using errcode = 'P0002';
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
      raise exception 'The driver has left for this delivery — send a message instead.' using errcode = '55000';
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
        raise exception 'That delivery was taken off the schedule, not skipped — send a request to bring it back.' using errcode = '55000';
      end if;
    elsif o.canceled_at is not null then
      if p_change = 'skip' and o.canceled_reason = 'skipped' then return public.office_delivery_json(o); end if;   -- already skipped
      raise exception 'That delivery is off the schedule%.', case when o.canceled_reason = 'paused' then ' while the program is paused' else '' end
        using errcode = '55000';
    end if;
    if o.status <> 'received' then
      raise exception 'That delivery is already under way — send a request instead.' using errcode = '55000';
    end if;
    if not v_crew and now() >= v_cut then
      raise exception 'Changes to this delivery closed %. Send it as a request and we''ll do what we can.', v_closes using errcode = '55000';
    end if;
    if p_change in ('quantity', 'skip')
       and (o.payment_status in ('paid', 'invoiced', 'refunded') or o.paylink_url is not null or o.square_order_id is not null) then
      raise exception 'That delivery is %. Send the change as a request and we''ll settle the difference.',
        case when o.payment_status = 'paid' then 'paid' when o.payment_status = 'invoiced' then 'invoiced' else 'already billed' end
        using errcode = '55000';
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
        raise exception 'The weekly program is paused — turn it back on first.' using errcode = '55000';
      end if;
      if exists (select 1 from public.business_orders x where x.location_id is not distinct from o.location_id and x.delivery_date = o.delivery_date
                    and x.canceled_at is null and x.id <> o.id) then
        raise exception 'That morning already has a delivery.' using errcode = '55000';
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

-- ── 8 · the mornings a delivery can move to ──────────────────────────────────────────────────────
create or replace function public.office_open_dates(p_order uuid)
returns table (delivery_date date, cutoff_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare o public.business_orders; p public.company_programs; v_crew boolean := public.is_staff(); v_today date; d date;
begin
  select * into o from public.business_orders
   where id = p_order and tenant_id = public.effective_tenant() and (not v_crew or public.market_visible(market));
  if not found or (not v_crew and (o.company_id is null or not public.office_member_can(o.company_id, o.location_id, 'read'))) then
    raise exception 'That delivery no longer exists.' using errcode = 'P0002';
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

-- ── 9 · a request ────────────────────────────────────────────────────────────────────────────────
create or replace function public.office_request_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'change_after_cutoff' then 'Change after the cutoff' when 'extra_delivery' then 'Extra delivery'
    when 'new_location' then 'New location' when 'event' then 'Event' when 'equipment' then 'Equipment'
    when 'billing' then 'Billing question' when 'service_issue' then 'Service issue' else 'Request' end
$$;

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
    if not found or o.company_id is null then raise exception 'That delivery no longer exists.' using errcode = 'P0002'; end if;
    if v_company is not null and v_company <> o.company_id then raise exception 'That delivery no longer exists.' using errcode = 'P0002'; end if;
    v_company := o.company_id; v_location := o.location_id; v_market := o.market;
  elsif v_company is null and not v_crew then
    -- the caller's own company, when they have one
    select m.company_id into v_company from public.company_members m
     where m.user_id = auth.uid() and m.active order by m.created_at limit 1;
  end if;
  select c.name, coalesce(v_market, c.market) into v_name, v_market from public.companies c
   where c.id = v_company and c.tenant_id = public.effective_tenant() and (not v_crew or public.market_visible(c.market));
  if v_name is null or (not v_crew and not public.office_member_can(v_company, v_location, 'read')) then
    if p_order is not null then raise exception 'That delivery no longer exists.' using errcode = 'P0002'; end if;
    raise exception 'That company isn''t yours.' using errcode = 'P0002';
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
-- existing rows: office_request — a new producer; it has never written an alert.
revoke all on function public.office_request(text, text, uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.office_request(text, text, uuid, uuid, jsonb, uuid) to authenticated;

-- The crew moves a request along. Done or declined answers the crew's alert about it.
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
  if not found then raise exception 'That request no longer exists.' using errcode = 'P0002'; end if;
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

-- ── 10 · the client's home, in one call ──────────────────────────────────────────────────────────
-- p_company: the company to read; null = the caller's own (their first active membership). The crew
-- may read any company in its tenant and city (what the client sees, for the AM).
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
  if not found then raise exception 'That company isn''t yours.' using errcode = 'P0002'; end if;
  select * into m from public.company_members cm
   where cm.company_id = c.id and cm.user_id = auth.uid() and cm.active;
  if m.id is null and not v_crew then raise exception 'That company isn''t yours.' using errcode = 'P0002'; end if;
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

-- ── 11 · the program's followers leave a client's change alone ───────────────────────────────────
-- 0356's office_program_follow verbatim but two lines: a new rule no longer takes off a delivery the
-- client moved (`and o.moved_at is null`), and a new weekly quantity no longer reaches a delivery
-- whose quantity the client set for that day (`and o.gallons_changed_at is null`). A pause, a
-- resume, the window, the price and the door reach every open delivery, as before.
create or replace function public.office_program_follow() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_from date;
begin
  if tg_table_name = 'company_programs' then
    if old.status = 'active' and new.status <> 'active' then
      update public.business_orders o
         set canceled_at = now(), canceled_reason = case when new.status = 'paused' then 'paused' else 'program ended' end
       where o.program_id = new.id and public.office_untouched(o);
    elsif new.status = 'active' and old.status is distinct from 'active' then
      update public.business_orders set canceled_at = null, canceled_reason = null
       where program_id = new.id and canceled_reason = 'paused' and canceled_at is not null and cutoff_at > now();
      perform public.office_generate(new.tenant_id, new.market, public.office_local_today(new.market) + public.office_horizon(), new.id);
    elsif new.status = 'active' then
      -- THE RULE, THE WINDOW OR THE PRICE CHANGED while the program stayed on. An untouched delivery
      -- the new rule no longer makes is taken off ('schedule changed', kept as the record); one a
      -- change took off that the rule makes again comes back; the rest take the program's window and
      -- price; then the new rule's dates whose cutoff is still ahead are made. Without this, a Monday
      -- program moved to Thursdays kept its Monday and gained a Thursday — both delivered.
      update public.business_orders o set canceled_at = now(), canceled_reason = 'schedule changed'
       where o.program_id = new.id and public.office_untouched(o) and o.moved_at is null and not public.office_rule_matches(new, o.scheduled_for);
      update public.business_orders o set canceled_at = null, canceled_reason = null
       where o.program_id = new.id and o.canceled_reason = 'schedule changed' and o.canceled_at is not null
         and o.status = 'received' and o.payment_status = 'pending' and o.paylink_url is null and o.square_order_id is null
         and o.cutoff_at > now() and public.office_rule_matches(new, o.scheduled_for);
      update public.business_orders o
         set delivery_window = public.office_window(new), price_per_gallon_cents = public.office_price(new),
             subtotal_cents = (o.gallons * public.office_price(new))::int,
             total_cents = (o.gallons * public.office_price(new))::int + o.delivery_fee_cents + o.tax_cents
       where o.program_id = new.id and public.office_untouched(o)
         and (o.delivery_window, o.price_per_gallon_cents) is distinct from (public.office_window(new), public.office_price(new));
      v_from := public.office_local_today(new.market) + 1;
      while public.office_cutoff(v_from, new.market) <= now() loop v_from := v_from + 1; end loop;
      perform public.office_generate(new.tenant_id, new.market, public.office_local_today(new.market) + public.office_horizon(), new.id, v_from);
    end if;
  elsif tg_table_name = 'company_program_lines' then
    if new.product = 'cold_brew_gallon' and new.quantity is distinct from old.quantity then
      update public.business_orders o
         set gallons = new.quantity,
             subtotal_cents = (new.quantity * o.price_per_gallon_cents)::int,
             total_cents = (new.quantity * o.price_per_gallon_cents)::int + o.delivery_fee_cents + o.tax_cents
       where o.program_id = new.program_id and public.office_untouched(o) and o.gallons_changed_at is null;
    end if;
  elsif tg_table_name = 'company_locations' then
    update public.business_orders o
       set address_street = coalesce(new.address_street, ''), address_city = coalesce(new.address_city, ''),
           address_zip = coalesce(new.address_zip, ''), access_instructions = new.access_instructions,
           delivery_window = public.office_window(p)
      from public.company_programs p
     where p.id = o.program_id and o.location_id = new.id and public.office_untouched(o);
  elsif tg_table_name = 'live_status' then
    -- Settings' price. The programs without a price of their own bill it, so their untouched
    -- deliveries do too: /office quotes Settings' price, and the delivery it quotes must bill the same.
    if new.office_price_cents is distinct from old.office_price_cents then
      update public.business_orders o
         set price_per_gallon_cents = coalesce(new.office_price_cents, 4500),
             subtotal_cents = (o.gallons * coalesce(new.office_price_cents, 4500))::int,
             total_cents = (o.gallons * coalesce(new.office_price_cents, 4500))::int + o.delivery_fee_cents + o.tax_cents
        from public.company_programs p
       where p.id = o.program_id and p.price_per_gallon_cents is null and public.office_untouched(o);
    end if;
  elsif tg_table_name = 'markets' then
    -- A city's office window: the programs with no window of their own, or on their door, take it.
    if new.office_window is distinct from old.office_window then
      update public.business_orders o set delivery_window = public.office_window(p)
        from public.company_programs p
       where p.id = o.program_id and p.market = new.slug and public.office_untouched(o)
         and o.delivery_window is distinct from public.office_window(p);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.office_program_follow() from public, anon, authenticated;

comment on function public.office_untouched(public.business_orders) is
  'Open: generated, not canceled, still received and unpaid, no Square link, before its cutoff (0356). A pause, a resume, the window, the price and the door reach every open delivery; a new rule skips one the client moved, and a new weekly quantity one whose quantity the client set (0359).';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Office clients change their own deliveries until the cutoff','feature','Delivery',
   'An office client can now change one delivery themselves — its gallons, skip it, move it to another morning within two weeks, or leave the driver a note — right up to that delivery''s cutoff, shown in their own time. After the cutoff the same sheet becomes a request to GT3, never a dead button. Requests (a change after the cutoff, an extra delivery, an event, a billing question, an issue) are real records the crew sees and answers. A client''s change is never overwritten by the weekly schedule, and a double tap changes nothing twice.',
   '2026-10-07', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select count(*) from information_schema.columns where table_name = 'business_orders' and column_name in ('changed_at','changed_by','change_reason','gallons_changed_at','moved_from','moved_at','client_note');   -- 7
--   select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('office_order_changes','company_requests') and c.relrowsecurity;   -- 2
--   select has_function_privilege('anon', 'public.office_change_delivery(uuid, text, numeric, date, text, text, uuid)', 'execute');   -- false
--   select has_function_privilege('anon', 'public.office_home(uuid)', 'execute');   -- false
--   select count(*) from pg_policies where tablename = 'business_orders' and policyname = 'biz order member read';   -- 1
--   select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('office_order_changes','company_requests');   -- 2
select public.record_migration('0359_a_client_changes_a_delivery_until_its_cutoff',
  'business_orders changed_at, changed_by, change_reason, gallons_changed_at, moved_from, moved_at, client_note; company_members.location_ids; office_member_can; office_order_changes; company_requests; office_delivery_json; office_change_delivery (quantity, skip, unskip, move, note — until the cutoff, keyed); office_open_dates; office_request (+ office_request alert), office_request_set; office_home; business_orders member read (the company''s people, at their locations); office_order_changes and company_requests join supabase_realtime; office_program_follow: a new rule skips moved deliveries, a new weekly quantity skips ones the client set.');
