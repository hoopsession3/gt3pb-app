-- ── 0416 — A REFUND IS FLAGGED WHERE THE MONEY GOES BACK: THE DATABASE RAISES IT, ONCE, WHOEVER CANCELS ───────────────
-- 2026-10-16. R9 of the customer audit — money (Ryan, 2026-10-16: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A paid cup voided, a paid pack canceled, a paid office order canceled: each is a refund somebody has to make in
-- Square, and the flag that says so was raised by whichever screen made the change — when it remembered to, and when it
-- had signal. The Pass raised it from the browser after the void (components/pass/ThePass), so a void made with no
-- signal — "void saved, will sync" — replayed the status and nothing else: the member's push said "Your card is being
-- refunded in full" and no flag existed. The pack board raised it the same way (components/DropOps), judged from the row
-- on its screen: a pack collected on the card reader by another phone a moment before was canceled with no flag. The
-- office board raised none at all (components/OfficeOrders: a plain update). A stop called off listed its paid cups in one
-- long alert that the alert writer cuts at 300 characters (lib/serverAlerts), left cups paid on the card reader off it,
-- and on a retry raised nothing.
--
-- WHAT.
--   · refund_needed is raised by the database, in the same write as the change, under the row's lock — one per order,
--     pack or office order (alert_open_once, 0336), whoever makes the change and however:
--       orders           status → void, when a card took money: paid online, or collected on the card reader;
--       drop_orders      canceled, the same;
--       business_orders  canceled while paid.
--     Cash at the window goes back across it from the person who voids it, as it always did; nothing taken, nothing to
--     flag. A cup already given back in full in Square is not flagged again.
--   · The words say who did it — a member from the app, a guest from the order page, the crew, a stop called off — set by
--     the function that does it (gt3.void_by, for its own transaction only) and read by the trigger. cancel_own_order and
--     cancel_by_ticket (0409's), cancel_own_reservation (0397's) say who and no longer raise their own.
--   · An app from before this (the crew's iPhone build) still raises its own from the browser: a second open
--     refund_needed for the same subject is not written (alerts_dedupe_refund_flag).
--   · void_stop_orders(stop) — a stop called off voids its open cups, each its own write, so each paid one has its own
--     flag; a cup the database refuses is named, never the reason the rest stay open. Owners and admins, as cancel_stop.
--     A second call voids what is still open and nothing twice.
--   · use_credit(card, cents, key) and give_free_cup(card, key) — the scan screen's two spends, keyed per tap: an answer
--     lost on the way and the tap repeated returns the first answer instead of spending again. spend_credit and
--     redeem_free_cup (0410's) stay for the apps from before, as calls to these with no key.
--   · A pack's stamps: marking a picked-up pack back a stage keeps what it earned, as a cup's Recall does (0229); a pack
--     canceled gives back what it earned. It used to strip them on any step back — and its referral's $5 + $5 with them
--     (0411) — for good: a pack is awarded once.
--   · Covered at the window: a cup or a pack paid with a free cup or the member's credit is settled as covered — owed
--     nothing, and counted nowhere as money (it never reached the till or Square).
-- existing rows: refund_flag_order — new here; it has written nothing yet. The flags the screens raised before say what
--   was owed then, in the same title, and stay open until someone records the refund.
-- existing rows: refund_flag_pack — new here; it has written nothing yet (as refund_flag_order).
-- existing rows: refund_flag_office — new here; it has written nothing yet. The office board raised none before.
-- existing rows: cancel_by_ticket — its one line of its own (an unpaid cup canceled, fyi) is 0409's word for word; its
--   paid flag moves to the trigger, which writes the same title and words.
-- changelog: below.

-- ── the words, said one way (0409's refund_words; the payment's own words) ───────────────────────────────────────────
create or replace function public.paid_words(p_how text) returns text
  language sql immutable set search_path = public as $$
  select case p_how when 'card_reader' then 'on the card reader' when 'online' then 'online' else 'by card' end
$$;
revoke all on function public.paid_words(text) from public, anon, authenticated;

-- ── a cup voided ───────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.refund_flag_order() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_how    text;
  v_by     text := coalesce(nullif(current_setting('gt3.void_by', true), ''), 'crew');
  v_no     text := '#' || upper(substr(new.id::text, 1, 4));
  v_who    text := coalesce(nullif(split_part(btrim(coalesce(new.customer, '')), ' ', 1), ''), 'A guest');
  v_charge integer := coalesce(new.total_cents, 0) + greatest(coalesce(new.tip_cents, 0), 0);
  v_back   integer;
  v_stop   text;
  v_words  text;
  v_title  text;
  v_body   text;
begin
  -- How a card took money for it: on the reader at the window (paid stays false there — Square counts it, 0341), or
  -- online (paid, and no collection). Cash goes back across the window; nothing taken, nothing to give back.
  if new.collected_via = 'card_reader' then v_how := 'card_reader';
  elsif new.collected_at is null and coalesce(new.paid, false) then v_how := 'online';
  end if;
  if v_how is null or v_charge <= 0 then return null; end if;
  -- Given back already, in full, in Square (a refund made first, the order voided after): nothing left to flag.
  if v_how = 'online' and new.payment_id is not null then
    select coalesce(sum(r.amount_cents), 0) into v_back from public.square_refunds r
     where r.payment_id = new.payment_id and r.status in ('COMPLETED', 'PENDING');
    if v_back >= v_charge then return null; end if;
  end if;
  v_words := public.refund_words(new.total_cents, new.tip_cents);
  if v_by = 'member' then
    v_title := 'Customer canceled a paid order — refund needed';
    v_body  := 'A member canceled order ' || v_no || '. Refund ' || v_words || ' in Square — all of the charge.';
  elsif v_by = 'ticket' then
    v_title := 'Customer canceled a paid order — refund needed';
    v_body  := v_who || ' canceled order ' || v_no || ' from its order page. Refund ' || v_words || ' in Square — all of the charge.';
  elsif v_by = 'stop' then
    select s.name into v_stop from public.stops s where s.id = new.stop_id;
    v_title := 'Stop called off — refund needed';
    v_body  := v_who || ' · ' || v_no || ' · ' || v_words || ' paid ' || public.paid_words(v_how) || ' — '
            || coalesce(nullif(btrim(v_stop), ''), 'its stop') || ' was called off. Refund it in Square — all of the charge.';
  else
    v_title := 'Voided a PAID order — refund needed';
    v_body  := v_who || ' · ' || v_no || ' · ' || v_words || ' paid ' || public.paid_words(v_how) || '. Refund it in Square — all of the charge.';
  end if;
  perform public.alert_open_once('refund_needed', new.id, 'critical', 'money', v_title, v_body, '/crew?s=money&a=pay');
  return null;
end $$;
revoke all on function public.refund_flag_order() from public, anon, authenticated;
drop trigger if exists orders_refund_flag on public.orders;
create trigger orders_refund_flag after update of status on public.orders
  for each row when (new.status = 'void' and old.status is distinct from 'void')
  execute function public.refund_flag_order();

-- ── a pack canceled ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.refund_flag_pack() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_how   text;
  v_by    text := coalesce(nullif(current_setting('gt3.void_by', true), ''), 'crew');
  v_more  integer;
  v_title text;
  v_body  text;
begin
  if new.collected_via = 'card_reader' then v_how := 'card_reader';
  elsif new.collected_at is null and coalesce(new.paid, false) and new.payment_id is not null then v_how := 'online';
  end if;
  if v_how is null or coalesce(new.total_cents, 0) <= 0 then return null; end if;   -- a pack on us took nothing (R7b)
  -- A pack made bigger was charged the difference on its own (0388): each charge is refunded where it was taken.
  select count(*) into v_more from public.drop_order_changes ch
   where ch.drop_order_id = new.id and ch.state = 'done' and ch.charge_payment_id is not null;
  v_title := case when v_by = 'member' then 'Member canceled a PAID reservation — refund needed'
                  else 'Canceled a PAID reservation — refund needed' end;
  v_body  := coalesce(nullif(btrim(new.name), ''), 'A member') || ' · ' || new.size || '-pack · $'
          || to_char((new.total_cents / 100.0)::numeric, 'FM999990.00') || ' paid ' || public.paid_words(v_how)
          || coalesce(' for ' || to_char(new.drop_date, 'Dy Mon DD') || '''s drop', '') || '. Refund it in Square — all of it.'
          || case when v_more > 0 then ' It was charged in ' || (v_more + 1) || ' payments — the pack and '
                    || case when v_more = 1 then 'the change that made it bigger' else 'the changes that made it bigger' end
                    || ' — so refund each.' else '' end;
  perform public.alert_open_once('refund_needed', new.id, 'critical', 'money', v_title, v_body, '/crew?s=money&a=pay');
  return null;
end $$;
revoke all on function public.refund_flag_pack() from public, anon, authenticated;
drop trigger if exists drop_orders_refund_flag on public.drop_orders;
create trigger drop_orders_refund_flag after update of canceled_at on public.drop_orders
  for each row when (old.canceled_at is null and new.canceled_at is not null)
  execute function public.refund_flag_pack();

-- ── an office order canceled while paid ──────────────────────────────────────────────────────────────────────────
create or replace function public.refund_flag_office() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status is distinct from 'paid' or coalesce(new.total_cents, 0) <= 0 then return null; end if;
  perform public.alert_open_once('refund_needed', new.id, 'critical', 'money',
    'Canceled a PAID office order — refund needed',
    coalesce(nullif(btrim(new.company), ''), 'An office') || coalesce(' · ' || to_char(new.delivery_date, 'Dy Mon DD') || ' delivery', '')
      || ' · $' || to_char((new.total_cents / 100.0)::numeric, 'FM999990.00')
      || case when new.payment_id is not null then ' paid by its link' else ' marked paid' end
      || '. Refund it in Square — or settle it with them, and say how on this flag.',
    '/crew?s=money&a=pay');
  return null;
end $$;
revoke all on function public.refund_flag_office() from public, anon, authenticated;
drop trigger if exists business_orders_refund_flag on public.business_orders;
create trigger business_orders_refund_flag after update of canceled_at on public.business_orders
  for each row when (old.canceled_at is null and new.canceled_at is not null)
  execute function public.refund_flag_office();

-- ── one open refund flag per thing: an app from before still raises its own from the browser ───────────────────────
-- 0372's fold (alerts_fold_repeats) would count the browser's copy into the open flag and write its words over the
-- database's — older words, without the tip or "all of the charge". This runs before it (triggers fire by name) and drops
-- the copy whole: the flag the database raised is the one, said once, in its own words.
create or replace function public.alerts_dedupe_refund_flag() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.alerts a
              where a.kind = 'refund_needed' and a.subject_id = new.subject_id and a.ack_at is null) then
    return null;   -- the database's own flag is open: the copy is not written (and so not sent)
  end if;
  -- A cup or a pack covered at the window (a free cup or credit, below) took no money: an app from before reads it as
  -- paid and raises "refund it in Square" for it. Nothing to refund — not written.
  if exists (select 1 from public.orders o where o.id = new.subject_id and o.collected_via = 'covered')
     or exists (select 1 from public.drop_orders d where d.id = new.subject_id and d.collected_via = 'covered') then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.alerts_dedupe_refund_flag() from public, anon, authenticated;
drop trigger if exists alerts_dedupe_refund_flag on public.alerts;
create trigger alerts_dedupe_refund_flag before insert on public.alerts
  for each row when (new.kind = 'refund_needed' and new.subject_id is not null)
  execute function public.alerts_dedupe_refund_flag();

-- ── a member's cancel (0409's: who says so; the flag is the trigger's) ─────────────────────────────────────────────────
create or replace function public.cancel_own_order(p_order uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  -- FOR UPDATE added: cancel_own_reservation (0136) and cancel_own_delivery (0139) already lock
  -- their row here; this one didn't, so two concurrent cancels (double-tap / client retry) could
  -- both read status='new' before either write landed and both insert a refund alert.
  select * into o from public.orders where id = p_order and user_id = auth.uid() for update;
  if not found then return false; end if;      -- not yours (or doesn't exist)
  if o.status <> 'new' then return false; end if;  -- too late: already preparing / ready / done / void
  if o.collected_at is not null then return false; end if;  -- paid at the window (0341): the crew cancels it

  -- A card-paid order canceled needs a refund in Square — all of what the card was charged (0409). The flag is the
  -- database's (0416, refund_flag_order), raised by this write; this says who made it.
  perform set_config('gt3.void_by', 'member', true);
  update public.orders set status = 'void' where id = p_order;
  return true;
end $$;
revoke all on function public.cancel_own_order(uuid) from public, anon, authenticated;
grant execute on function public.cancel_own_order(uuid) to authenticated;

-- ── a guest's cancel, from the ticket (0409's: who says so; the flag is the trigger's) ─────────────────────────────────
create or replace function public.cancel_by_ticket(p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o     public.orders;
  v_no  text;
  v_who text;
begin
  select * into o from public.orders where ticket = p_ticket for update;
  if not found then
    raise exception 'That ticket isn''t one of ours.' using errcode = 'PT404';   -- a 4xx, never a 5xx (0360)
  end if;
  -- the member's rule (cancel_own_order, 0341): only while it is In, never once paid at the window
  if o.status <> 'new' then return jsonb_build_object('ok', false, 'outcome', 'too_late', 'now', o.status); end if;
  if o.collected_at is not null then return jsonb_build_object('ok', false, 'outcome', 'at_window'); end if;

  perform set_config('gt3.void_by', 'ticket', true);
  update public.orders set status = 'void' where id = o.id;

  v_no  := '#' || upper(substr(o.id::text, 1, 4));
  v_who := coalesce(nullif(split_part(btrim(coalesce(o.customer, '')), ' ', 1), ''), 'A guest');
  if not coalesce(o.paid, false) then
    insert into public.alerts (severity, category, title, body, link)
    values ('fyi', 'order', 'Canceled: ' || v_who || '''s cup order',
            v_who || ' canceled order ' || v_no || ' from its order page. Nothing was charged — no refund needed.',
            '/crew');
  end if;
  return jsonb_build_object('ok', true, 'outcome', 'canceled', 'paid', coalesce(o.paid, false));
end $$;
revoke all on function public.cancel_by_ticket(uuid) from public, anon, authenticated;
grant execute on function public.cancel_by_ticket(uuid) to anon, authenticated;

-- ── a member's pack cancel (0397's: who says so; the flag is the trigger's) ───────────────────────────────────────────
create or replace function public.cancel_own_reservation(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.drop_orders%rowtype; v_closes timestamptz;
begin
  select * into r from public.drop_orders
    where id = p_id and user_id = (select auth.uid())
    for update;
  if r.id is null or r.canceled_at is not null or r.picked_up then return false; end if;
  if r.collected_at is not null then return false; end if;  -- paid at the window (0341): the crew cancels it
  -- 0397: preparing, ready or on its way is the crew's — and so is a pack whose drop has closed.
  if coalesce(r.stage, 'reserved') <> 'reserved' then return false; end if;
  v_closes := public.pack_closes_at(r.drop_date, r.stop_id);
  if v_closes is not null and now() >= v_closes then return false; end if;
  -- The refund flag, for a paid pack, is the database's (0416, refund_flag_pack), raised by this write.
  perform set_config('gt3.void_by', 'member', true);
  update public.drop_orders set canceled_at = now() where id = p_id;
  return true;
end $$;
revoke execute on function public.cancel_own_reservation(uuid) from public, anon, authenticated;
grant execute on function public.cancel_own_reservation(uuid) to authenticated, service_role;

-- ── a stop called off voids its cups, one write each ─────────────────────────────────────────────────────────────
create or replace function public.void_stop_orders(p_stop uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  s       public.stops%rowtype;
  o       record;
  v_done  jsonb := '[]'::jsonb;
  v_stuck jsonb := '[]'::jsonb;
  v_id    uuid;
begin
  if not public.is_admin() then raise exception 'owners and admins only' using errcode = '42501'; end if;
  select * into s from public.stops where id = p_stop;
  if s.id is null then return null; end if;
  if s.canceled_at is null then raise exception 'That stop isn''t called off.' using errcode = 'P0001'; end if;
  perform set_config('gt3.void_by', 'stop', true);
  for o in select id from public.orders where stop_id = p_stop and status in ('new', 'preparing', 'ready') order by created_at loop
    begin
      update public.orders set status = 'void'
       where id = o.id and status in ('new', 'preparing', 'ready')
       returning id into v_id;
      if v_id is not null then
        v_done := v_done || (select jsonb_build_object('id', x.id, 'user_id', x.user_id, 'items', to_jsonb(x.items),
                    'paid', coalesce(x.paid, false), 'collected_via', x.collected_via, 'total_cents', x.total_cents,
                    'tip_cents', coalesce(x.tip_cents, 0), 'payment_id', x.payment_id)
                    from public.orders x where x.id = v_id);
      end if;
    exception when others then
      v_stuck := v_stuck || to_jsonb(o.id::text);   -- refused (a rule said no): named to the crew, the rest go on
    end;
    v_id := null;
  end loop;
  return jsonb_build_object('voided', v_done, 'stuck', v_stuck);
end $$;
revoke all on function public.void_stop_orders(uuid) from public, anon, authenticated;
grant execute on function public.void_stop_orders(uuid) to authenticated;
comment on function public.void_stop_orders(uuid) is
  'A stop called off voids its open cup orders (0416), each in its own write, so each paid one raises its own refund flag (refund_flag_order) with the stop''s name. A cup the database refuses is named in stuck, never the reason the rest stay open. Owners and admins, as cancel_stop; a second call voids only what is still open.';

-- ── a spend, keyed per tap ───────────────────────────────────────────────────────────────────────────────────────
alter table public.credit_spends add column if not exists idem_key text;
create unique index if not exists credit_spends_once on public.credit_spends (user_id, idem_key) where idem_key is not null;
alter table public.loyalty_ledger add column if not exists idem_key text;
create unique index if not exists loyalty_ledger_once on public.loyalty_ledger (user_id, idem_key) where idem_key is not null;

create or replace function public.use_credit(p_code text, p_cents integer, p_key text default null) returns integer
  language plpgsql security definer set search_path = public as $$
declare uid uuid; cur int; take int; was int;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  if p_key is not null and (char_length(p_key) < 8 or char_length(p_key) > 80) then
    raise exception 'a spend key is 8 to 80 characters' using errcode = '22023';
  end if;
  select p.id, greatest(coalesce(p.credit_cents, 0), 0) into uid, cur from public.profiles p
   where p.referral_code = p_code or p.id::text = p_code
   limit 1
   for update;
  if uid is null then return null; end if;
  -- 0392's rule, for credit (0410): never your own card.
  if uid = auth.uid() then
    raise exception 'your own card: another crew member takes its credit off' using errcode = '42501';
  end if;
  -- The same tap again (an answer lost on the way): what it took the first time, and nothing more.
  if p_key is not null then
    select cs.cents into was from public.credit_spends cs where cs.user_id = uid and cs.idem_key = p_key;
    if found then return was; end if;
  end if;
  take := coalesce(p_cents, cur);
  if cur <= 0 or take <= 0 then raise exception 'no credit to use' using errcode = 'P0001'; end if;
  if take > cur then raise exception 'not that much credit' using errcode = 'P0001'; end if;
  insert into public.credit_spends (user_id, tenant_id, cents, by_user, idem_key)
    select uid, p.tenant_id, take, auth.uid(), p_key from public.profiles p where p.id = uid;
  update public.profiles set credit_cents = cur - take where id = uid;
  return take;
end $$;
revoke all on function public.use_credit(text, integer, text) from public, anon, authenticated;
grant execute on function public.use_credit(text, integer, text) to authenticated;
comment on function public.use_credit(text, integer, text) is
  'The scan screen''s credit at the window (0416): 0410''s spend_credit, keyed per tap — the same key again returns what the first took and spends nothing. Staff only, never the caller''s own card; the profile locked first.';

create or replace function public.give_free_cup(p_code text, p_key text default null) returns integer
  language plpgsql security definer set search_path = public as $$
declare uid uuid; cur int; after int;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  if p_key is not null and (char_length(p_key) < 8 or char_length(p_key) > 80) then
    raise exception 'a redeem key is 8 to 80 characters' using errcode = '22023';
  end if;
  select p.id, coalesce(p.points, 0) into uid, cur from public.profiles p
   where p.referral_code = p_code or p.id::text = p_code
   limit 1
   for update;
  if uid is null then return null; end if;
  -- 0392's rule, for a free cup (0410): never your own card.
  if uid = auth.uid() then
    raise exception 'your own card: another crew member gives its free cup' using errcode = '42501';
  end if;
  -- The same tap again: the card as it stands, and no second cup.
  if p_key is not null and exists (select 1 from public.loyalty_ledger l where l.user_id = uid and l.idem_key = p_key) then
    return cur;
  end if;
  if cur < 10 then raise exception 'no free cup to redeem' using errcode = 'P0001'; end if;
  insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user, idem_key)
    values (uid, 'scan', 'redeem', -10, 'free cup redeemed at the window', auth.uid(), p_key);
  select coalesce(points, 0) into after from public.profiles where id = uid;
  return after;
end $$;
revoke all on function public.give_free_cup(text, text) from public, anon, authenticated;
grant execute on function public.give_free_cup(text, text) to authenticated;
comment on function public.give_free_cup(text, text) is
  'The scan screen''s free cup at the window (0416): 0410''s redeem_free_cup, keyed per tap — the same key again returns the card as it stands and gives nothing. Staff only, never the caller''s own card; refused under ten points; the profile locked first.';

-- The apps from before call these by their old names: the same spends, with no key. Invoker: the checks are the two above.
create or replace function public.spend_credit(p_code text, p_cents integer default null) returns integer
  language sql security invoker set search_path = public as $$
  select public.use_credit(p_code, p_cents, null)
$$;
revoke all on function public.spend_credit(text, integer) from public, anon, authenticated;
grant execute on function public.spend_credit(text, integer) to authenticated;
create or replace function public.redeem_free_cup(p_code text) returns integer
  language sql security invoker set search_path = public as $$
  select public.give_free_cup(p_code, null)
$$;
revoke all on function public.redeem_free_cup(text) from public, anon, authenticated;
grant execute on function public.redeem_free_cup(text) to authenticated;

-- ── a pack's stamps: a step back keeps them; a cancel gives them back (0229's, the claw moved) ─────────────────────────
create or replace function public.award_points_pack() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.picked_up = true and old.picked_up is distinct from true and new.canceled_at is null and new.user_id is not null then
    perform public.credit_wallet(new.user_id, new.size, new.total_cents, new.id, 'pickup');
  elsif new.canceled_at is not null and old.canceled_at is null and new.user_id is not null then
    -- Canceled: what it earned, if it earned anything, comes back (claw_wallet writes nothing for a pack never handed over).
    perform public.claw_wallet(new.user_id, new.id, 'pickup');
  end if;
  -- Picked up → back a stage is a correction on the board (0416): the stamps stay, as a cup's Recall keeps its own (0229);
  -- it can never double on the way back to picked up — the ledger awards an order once.
  return new;
end $$;

-- ── covered at the window: a free cup or the member's credit ──────────────────────────────────────────────────────
-- 0341's checks were the columns' own (Postgres names them <table>_<column>_check); the ways are named now.
alter table public.orders drop constraint if exists orders_collected_via_check;
alter table public.drop_orders drop constraint if exists drop_orders_collected_via_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_collected_via_ways') then
    alter table public.orders add constraint orders_collected_via_ways check (collected_via in ('cash', 'card_reader', 'covered'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drop_orders_collected_via_ways') then
    alter table public.drop_orders add constraint drop_orders_collected_via_ways check (collected_via in ('cash', 'card_reader', 'covered'));
  end if;
end $$;

create or replace function public.staff_collect_payment(p_kind text, p_id uuid, p_via text)
returns text language plpgsql security definer set search_path = public as $$
declare v_paid boolean; v_at timestamptz; v_gone boolean;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_via is null or p_via not in ('cash', 'card_reader', 'covered') then
    raise exception 'say how it was paid: cash, card_reader or covered';
  end if;

  -- Cash sets paid (the till is counted nowhere else); the reader does not (Square counts it, 0341); covered — a free
  -- cup or the member's credit (0416) — does not either: it is owed nothing, and it is no money anywhere.
  if p_kind = 'cup' then
    select paid, collected_at, status = 'void' into v_paid, v_at, v_gone
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that order does not exist'; end if;
    if v_gone then raise exception 'that order was voided — nothing to collect'; end if;
    if v_paid or v_at is not null then return 'already settled'; end if;
    update public.orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
    return 'collected';
  elsif p_kind = 'pickup' then
    select paid, collected_at, canceled_at is not null into v_paid, v_at, v_gone
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that pack does not exist'; end if;
    if v_gone then raise exception 'that pack was canceled — nothing to collect'; end if;
    if v_paid or v_at is not null then return 'already settled'; end if;
    update public.drop_orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
    return 'collected';
  end if;
  raise exception 'unknown kind: %', coalesce(p_kind, 'null');
end $$;
revoke all on function public.staff_collect_payment(text, uuid, text) from public, anon, authenticated;
grant execute on function public.staff_collect_payment(text, uuid, text) to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Every refund is flagged, whoever cancels and wherever', 'fix', 'Money',
   'When a paid cup is voided, a paid pack or office order is canceled, or a stop is called off, the crew''s inbox gets one refund flag for each — raised by the database with the change itself, so a void made with no signal, or just after someone took the money on the card reader, is flagged too. Each flag says who canceled it and how it was paid.',
   '2026-10-16', false),
  ('Credit and free cups are spent once', 'fix', 'Loyalty',
   'At the window, if the app loses the answer to "Use credit" or "Give free cup" and the crew taps again, the second tap returns the first answer instead of taking the credit or the cup twice.',
   '2026-10-16', false),
  ('A pack keeps its stamps when the crew corrects its stage', 'fix', 'Loyalty',
   'Moving a picked-up pack back a stage no longer takes its stamps (and a friend''s referral credit) away for good; canceling a pack still gives back what it earned. And an order paid with a free cup or credit can be settled at the window as covered.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_trigger where tgname in ('orders_refund_flag', 'drop_orders_refund_flag', 'business_orders_refund_flag', 'alerts_dedupe_refund_flag'); -- 4
--   select prosrc like '%gt3.void_by%' from pg_proc where proname = 'cancel_own_order';                                    -- true
--   select prosrc not like '%alert_open_once%' from pg_proc where proname = 'cancel_by_ticket';                            -- true
--   select has_function_privilege('anon', 'public.void_stop_orders(uuid)', 'execute');                                     -- false
--   select has_function_privilege('authenticated', 'public.use_credit(text, integer, text)', 'execute');                   -- true
--   select count(*) from pg_constraint where conname in ('orders_collected_via_ways', 'drop_orders_collected_via_ways');  -- 2
select public.record_migration('0416_a_refund_is_flagged_where_the_money_goes_back');
