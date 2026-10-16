-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0418
-- generated-at: 2026-10-16
-- pending-count: 3
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0416_a_refund_is_flagged_where_the_money_goes_back.sql
-- ============================================================
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

-- ============================================================
-- 0417_the_books_count_what_went_back.sql
-- ============================================================
-- ── 0417 — THE BOOKS COUNT WHAT WENT BACK; A PART REFUNDED KEEPS THE ORDER; AN UNCLEAR SEND IS CHECKED ────────────────
-- 2026-10-16. R9 of the customer audit — money (Ryan, 2026-10-16: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · Money (report_sales, 0415) and the founder digest's week counted what came in and never what went back. A walk-up
--     sale refunded in Square, a pre-order paid on the card reader and refunded, a cup or a pack refunded after it was
--     handed over, a pack change's charge given back: each stayed in revenue. Square sends every refund to the books
--     (square_refunds, by its webhook, 0330); nothing read it there but the shop's drift check.
--   · A part of a shop order refunded (a $5 goodwill credit on a $32 cap not yet sent) ended the order: 'refunded' is
--     final (set_shop_order_status, 0334), so it left "waiting on us", Send to printer went away and nothing shipped for
--     the $27 kept. A second part could not be recorded at all, so Square's refund-mismatch alert could never clear.
--   · Send to printer (0335) treated a timeout, a 5xx or a reply with no order id as "not sent": the claim aged out in
--     two minutes and a second press could place a second cap — on the business card — when Apliiq had taken the first.
--   · An office payment link could not be switched off: its Square id was never kept (0221).
--
-- WHAT.
--   · refund_counts_against(refund, payment) — what a completed Square refund takes off, on the day it was made:
--       a cup still counted (paid, not void) — its drinks, never more (the tip is no revenue here);
--       a pack still counted (paid, not canceled), by its own charge or an applied change's;
--       a delivery or an office order still counted (paid, not canceled);
--       a payment no order of ours carries — walk-up money, where the sale was counted (a change never applied included).
--     Nothing for an order already out of the books (voided, canceled: its sale left with it), for the shop and the
--     Limited Reserve (each keeps its own account of what went back: refund_amount_cents, refunded_cents), or for the
--     refund a pack change made itself (0415 counts the change's difference on its day).
--   · refunds_counted(tenant) — each completed refund and what it takes off, a cup's refunds capped together at its
--     drinks (a $10 cup and $2 tip given back as $6 and $6 takes off $10).
--   · report_sales (0415's) and founder_digest_alert (0415's) take each refund off the channel it counts against, on its
--     day; report_sales says how much (refunds_cents).
--   · set_shop_order_status (0334's): a refund for less than what is left on the order is recorded — added to what went
--     back — and the order stays where it is; the refund that leaves nothing is the one that ends it. The amount is this
--     refund's; none given is all that is left.
--   · An unclear answer from the printer: shop_orders.apliiq_submit_unknown_at. The sending routes write it before the
--     order leaves and take it off when a clear answer comes, so a send stopped half way is one too. The claim (0335's)
--     refuses while it is set — the printer may have the order — until the crew says, on the order, what Apliiq shows
--     (shop_apliiq_checked: its order id, or "not there", which clears it to send again — never while a send is still
--     out). v_shop_orders (0407's) gains the send's two marks, at its end.
--   · business_orders.paylink_id — the Square id of an office payment link, so a cancel can switch it off.
-- changelog: below.

-- ── what a refund takes off, and from where ─────────────────────────────────────────────────────────────────────────
create or replace function public.refund_counts_against(p_refund_id text, p_payment_id text, out channel text, out cap integer)
  language plpgsql stable security definer set search_path = public as $$
declare o record; d record; x record;
begin
  channel := null; cap := null;
  if p_payment_id is null then return; end if;
  -- A pack change's own refund (a smaller pack, 0388): the change moved it, and 0415 counts the change's difference.
  if exists (select 1 from public.drop_order_changes ch, jsonb_array_elements(ch.refunds) rf
              where ch.state = 'done' and rf->>'refund_id' = p_refund_id) then return; end if;
  -- The shop and the Limited Reserve keep their own account of what went back.
  if exists (select 1 from public.shop_orders sh where sh.payment_id = p_payment_id)
     or exists (select 1 from public.reserve_claims rc where rc.payment_id = p_payment_id) then return; end if;
  select paid, status, total_cents into o from public.orders where payment_id = p_payment_id limit 1;
  if found then
    if coalesce(o.paid, false) and o.status <> 'void' then channel := 'cup'; cap := greatest(coalesce(o.total_cents, 0), 0); end if;
    return;
  end if;
  select dd.paid, dd.canceled_at into d from public.drop_orders dd
   where dd.payment_id = p_payment_id
      or exists (select 1 from public.drop_order_changes ch
                  where ch.drop_order_id = dd.id and ch.state = 'done' and ch.charge_payment_id = p_payment_id)
   limit 1;
  if found then
    if coalesce(d.paid, false) and d.canceled_at is null then channel := 'packs'; end if;
    return;
  end if;
  select payment_status, canceled_at into x from public.delivery_orders where payment_id = p_payment_id limit 1;
  if found then
    if x.payment_status = 'paid' and x.canceled_at is null then channel := 'delivery'; end if;
    return;
  end if;
  select payment_status, canceled_at into x from public.business_orders where payment_id = p_payment_id limit 1;
  if found then
    if x.payment_status = 'paid' and x.canceled_at is null then channel := 'office'; end if;
    return;
  end if;
  channel := 'walkup';   -- nothing of ours carries it: walk-up money, where its sale was counted
end $$;
revoke all on function public.refund_counts_against(text, text) from public, anon, authenticated;
comment on function public.refund_counts_against(text, text) is
  'What a completed Square refund takes off (0417): the channel it counts against — cup, packs, delivery, office, walkup — and for a cup the most it can (the drinks, not the tip). Null for an order already out of the books, the shop and the Limited Reserve (their own accounts) and a pack change''s own refund. The books'' own helper: report_sales and the founder digest.';

-- Each completed refund and what it takes off, once: a cup's refunds together never take off more than its drinks (the
-- tip is no revenue here) — a $10 cup and $2 tip given back as $6 and $6 takes off $10, never $12. Each refund takes off
-- what it adds under the cap, in the order they were made, so a day's sum and a week's agree.
create or replace function public.refunds_counted(p_tenant uuid)
returns table (refund_id text, made_at timestamptz, channel text, off_cents bigint)
language sql stable security definer set search_path = public as $$
  with rf as (
    select r.id::text as id, r.payment_id, coalesce(r.amount_cents, 0)::bigint as amt, r.created_at, c.channel, c.cap
      from public.square_refunds r cross join lateral public.refund_counts_against(r.id::text, r.payment_id) c
     where r.status = 'COMPLETED' and r.tenant_id = p_tenant and c.channel is not null
  )
  select rf.id, rf.created_at, rf.channel,
         case when rf.channel = 'cup'
              then greatest(least(sum(rf.amt) over w, rf.cap) - least(sum(rf.amt) over w - rf.amt, rf.cap), 0)
              else rf.amt end
    from rf
  window w as (partition by rf.payment_id order by rf.created_at, rf.id rows between unbounded preceding and current row)
$$;
revoke all on function public.refunds_counted(uuid) from public, anon, authenticated;
comment on function public.refunds_counted(uuid) is
  'Every completed Square refund of a tenant and what it takes off its channel (0417, refund_counts_against): a cup''s refunds capped together at its drinks. The books'' own helper: report_sales and the founder digest.';

-- ── Money's report: what came in, less what went back (0415's, the refunds added) ─────────────────────────────────────
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (current_date - (greatest(p_days, 1) - 1))::timestamptz;
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint; shop bigint; resv bigint;
  sq_n bigint;
  rf_walk bigint; rf_cup bigint; rf_packs bigint; rf_deliv bigint; rf_office bigint;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  select coalesce(sum(es.amount_cents), 0), count(*) into sq, sq_n from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
                and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
                and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
                and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id)
                -- 0415: an applied pack change's own charge is the pack's money — counted in packs, on the change's day.
                and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done');
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  -- 0415: a pack's money on the days it moved — at its reservation, its total less what its applied changes moved; at each
  -- applied change, what that change moved.
  packs  := coalesce((select sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))
                        from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= since and d.tenant_id = tid), 0)
          + coalesce((select sum(ch.diff_cents) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
                        where ch.state = 'done' and ch.created_at >= since and d.paid and d.canceled_at is null and d.tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid), 0);
  shop   := coalesce((select sum(total_cents - coalesce(refund_amount_cents, 0)) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid), 0);
  resv   := coalesce((select sum(paid_cents - refunded_cents) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at >= since and tenant_id = tid), 0);
  -- 0417: what went back, on the day it went, from what it counts against.
  select coalesce(sum(x.off_cents) filter (where x.channel = 'walkup'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'cup'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'packs'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'delivery'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'office'), 0)
    into rf_walk, rf_cup, rf_packs, rf_deliv, rf_office
    from public.refunds_counted(tid) x
   where x.made_at >= since;
  sq := sq - rf_walk; cup := cup - rf_cup; packs := packs - rf_packs; deliv := deliv - rf_deliv; office := office - rf_office;
  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',
    'revenue_cents', sq + cup + packs + deliv + office + shop + resv,
    'by_channel', jsonb_build_object('square_walkup', sq, 'cup', cup, 'packs', packs, 'delivery', deliv, 'office', office, 'shop', shop, 'reserve', resv),
    -- 0417: what Square gave back in the window and the books took off (each channel above is net of its own).
    'refunds_cents', rf_walk + rf_cup + rf_packs + rf_deliv + rf_office,
    -- Each channel's orders under the same rule as its money, so an average never divides one channel by another's count.
    'orders_by_channel', jsonb_build_object(
      'square_walkup', sq_n,
      'cup',      (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
      'packs',    (select count(*) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid),
      'delivery', (select count(*) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid),
      'office',   (select count(*) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid),
      'shop',     (select count(*) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid),
      'reserve',  (select count(*) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at >= since and tenant_id = tid)),
    'order_count', (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
    'cogs_pct', public.catalog_cogs_pct(),
    -- What cogs_pct rests on. 'costed' is the COGS calculator's test (every ingredient has a unit cost and a quantity);
    -- 'assumed' is catalog_cogs_pct's own fallback, 30%, taken when no priced product has a recipe at all.
    'cogs_basis', (select jsonb_build_object(
        'products', count(*),
        'costed',   count(*) filter (where m.costed),
        'assumed',  not exists (select 1 from products p
                                  join product_components pc on pc.product_id = p.id
                                  join inventory_items ii on ii.id = pc.inventory_item_id
                                 where p.price_cents > 0 and p.tenant_id = tid and ii.tenant_id = tid))
      from (select p.id,
                   exists (select 1 from product_components pc where pc.product_id = p.id)
                   and not exists (select 1 from product_components pc
                                     left join inventory_items ii on ii.id = pc.inventory_item_id
                                    where pc.product_id = p.id and (ii.unit_cost is null or pc.qty_per_serving is null)) as costed
              from products p where p.active and p.price_cents > 0 and p.tenant_id = tid) m),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('key', item, 'n', n, 'cents', cents) order by n desc) from (
        select unnest(items) item, count(*) n,
               sum(total_cents / greatest(coalesce(array_length(items, 1), 1), 1)) cents
        from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid group by 1
      ) p), '[]'::jsonb),
    'by_event', coalesce((select jsonb_agg(jsonb_build_object('event', coalesce(e.title, '(unlinked)'), 'cents', s.cents, 'orders', s.n) order by s.cents desc) from (
        select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales es where created_at >= since and tenant_id = tid
          and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
          and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id) group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d, 'MM-DD'), 'cents', coalesce(c, 0)) order by d) from (
        select g::date d,
          (select coalesce(sum(es.amount_cents), 0) from event_sales es where es.created_at::date = g::date and es.tenant_id = tid
             and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
             and not exists (select 1 from drop_orders dd2 where dd2.payment_id = es.square_payment_id)
             and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
             and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
             and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
             and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id)
             and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done'))
          + (select coalesce(sum(total_cents), 0) from orders o where o.paid and o.status <> 'void' and o.created_at::date = g::date and o.tenant_id = tid)
          + (select coalesce(sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0)), 0)
               from drop_orders d where d.paid and d.canceled_at is null and d.created_at::date = g::date and d.tenant_id = tid)
          + (select coalesce(sum(ch.diff_cents), 0) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
               where ch.state = 'done' and ch.created_at::date = g::date and d.paid and d.canceled_at is null and d.tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents - coalesce(refund_amount_cents, 0)), 0) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(paid_cents - refunded_cents), 0) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at::date = g::date and tenant_id = tid)
          -- 0417: what went back that day
          - (select coalesce(sum(x.off_cents), 0) from public.refunds_counted(tid) x where x.made_at::date = g::date) c
        from generate_series(since::date, current_date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;
revoke execute on function public.report_sales(int) from public, anon, authenticated;
grant execute on function public.report_sales(int) to authenticated, service_role;

-- The founder digest's week (0415's, the refunds taken off the same way): kept for the machinery alone, as 0381 left it.
create or replace function public.founder_digest_alert() returns void
  language plpgsql security definer set search_path = public as $$
declare
  cadence text; t record; rev bigint; blockers int; reorders int; crit int;
  rdy_blocked int; rdy_total int; verdict text; msg text; back bigint;
begin
  select digest_cadence into cadence from public.live_status where id = 1;
  if cadence is null or cadence = 'off' then return; end if;
  if cadence = 'weekly' and extract(dow from now()) <> 1 then return; end if;

  for t in select id from public.tenants loop
    select coalesce((select sum(es.amount_cents) from event_sales es
             where es.created_at >= (current_date - 6)::timestamptz and es.tenant_id = t.id
               and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
               and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
               and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
               and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
               -- 0415: an applied pack change's charge is the pack's money (below), not walk-up money.
               and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done')), 0)
         + coalesce((select sum(total_cents) from orders           where paid and status <> 'void' and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         -- 0415: a pack's money on the days it moved — its reservation (less what its applied changes moved), and each change.
         + coalesce((select sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))
                       from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= (current_date - 6)::timestamptz and d.tenant_id = t.id), 0)
         + coalesce((select sum(ch.diff_cents) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
                       where ch.state = 'done' and ch.created_at >= (current_date - 6)::timestamptz and d.paid and d.canceled_at is null and d.tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from delivery_orders  where payment_status = 'paid' and canceled_at is null and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from business_orders  where payment_status = 'paid' and canceled_at is null and delivery_date between current_date - 6 and current_date and tenant_id = t.id), 0)
      into rev;
    -- 0417: what went back in the week, from the channels counted above (the digest has no shop or Limited Reserve line).
    select coalesce(sum(x.off_cents), 0) into back
      from public.refunds_counted(t.id) x
     where x.made_at >= (current_date - 6)::timestamptz and x.channel in ('walkup', 'cup', 'packs', 'delivery', 'office');
    rev := rev - back;

    select count(*) into blockers from public.incident_log where resolved = false and severity = 'blocker' and tenant_id = t.id;
    select count(*) into reorders from public.alerts where ack_at is null and category = 'prep' and title like '📦 Reorder%' and tenant_id = t.id;
    select count(*) into crit     from public.alerts where ack_at is null and severity = 'critical' and tenant_id = t.id;
    select count(*) filter (where critical and status = 'blocked'), count(*) filter (where critical)
      into rdy_blocked, rdy_total from public.readiness_checks where tenant_id = t.id;
    verdict := case when rdy_total = 0 then 'no criteria yet' when rdy_blocked > 0 then 'NO-GO' else 'on track' end;

    msg := 'Revenue 7d: $' || to_char(rev / 100.0, 'FM999,999,990.00')
        || '  ·  Launch: ' || verdict || case when rdy_blocked > 0 then ' (' || rdy_blocked::text || ' blocked)' else '' end
        || '  ·  Blockers: ' || blockers::text
        || '  ·  Reorders: ' || reorders::text
        || '  ·  Needs you: ' || crit::text;

    insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
    values ('fyi', 'money', '📊 Daily founder digest', msg, '/admin', null, t.id);
  end loop;
end $$;
revoke execute on function public.founder_digest_alert() from public, anon, authenticated;
grant execute on function public.founder_digest_alert() to service_role;
-- existing rows: founder_digest_alert — each digest is that day's snapshot ('fyi', never open work); the past ones stay as
-- they were said, and the next one counts the week this way.

-- ── a shop order: a part refunded keeps it (0334's, the refund made one of many) ──────────────────────────────────────
create or replace function public.set_shop_order_status(
  p_order uuid, p_status text, p_note text default null, p_refund_cents int default null)
returns public.shop_orders
language plpgsql security definer set search_path = public as $$
declare o public.shop_orders; legal text[]; amt int; left_cents int;
begin
  if not public.is_staff() then raise exception 'Only crew can move a shop order.'; end if;
  select * into o from public.shop_orders where id = p_order for update;
  if not found then raise exception 'That order no longer exists.'; end if;
  if p_status = o.status then raise exception 'That order is already %.', o.status; end if;

  legal := case o.status
    when 'paid'              then array['needs_fulfillment','submitted','canceled','refunded']
    when 'needs_fulfillment' then array['submitted','shipped','canceled','refunded']
    -- needs_fulfillment added 2026-09-30: the printer can refuse an order AFTER we send it and
    -- says so only by email to the account owner, so an order handed back had nowhere honest to
    -- go. This is the ONLY line of 0313's function this migration changes; the rest is spliced
    -- from 0313's own text, unread by human hands, because retyping it silently altered five
    -- behaviours on the first attempt — including turning `amt <= 0` into `amt < 0`, which
    -- would have let a zero-cent refund mark an order refunded.
    when 'submitted'         then array['needs_fulfillment','in_production','shipped','canceled','refunded']
    when 'in_production'     then array['shipped','refunded']
    when 'shipped'           then array['delivered','refunded']
    when 'delivered'         then array['refunded']
    when 'canceled'          then array['refunded']
    else array[]::text[] end;

  if not (p_status = any(legal)) then
    if cardinality(legal) = 0 then
      raise exception 'This order is %. That is the end of its life — nothing moves it from here.', o.status;
    end if;
    raise exception 'An order that is % can go to: %. Not %.', o.status, array_to_string(legal, ', '), p_status;
  end if;

  -- The two that cost a customer something get a mandatory reason. Same rule as void_expense (0292)
  -- and the voids in 0309, and it matters more here because there is a person on the other end.
  if p_status in ('refunded','canceled') and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say why. A refund or a cancellation with no reason is unreadable in six weeks, and this one has a customer attached to it.';
  end if;

  if p_status = 'refunded' then
    -- 0417: this refund's amount — none given is all that is left — between a cent and what is left.
    left_cents := coalesce(o.total_cents, 0) - coalesce(o.refund_amount_cents, 0);
    amt := coalesce(p_refund_cents, left_cents);
    if amt <= 0 or amt > left_cents then
      raise exception 'A refund has to be between 1 cent and the $% still on this order.',
        to_char(greatest(left_cents, 0) / 100.0, 'FM999999990.00');
    end if;
    if amt < left_cents then
      -- A part: added to what went back, and the order stays where it is — still to make, still to send.
      update public.shop_orders
         set refund_amount_cents = coalesce(refund_amount_cents, 0) + amt,
             status_note         = nullif(btrim(coalesce(p_note, '')), ''),
             updated_at          = now()
       where id = p_order
       returning * into o;
      return o;
    end if;
    amt := coalesce(o.total_cents, 0);   -- the refund that leaves nothing: all of it has gone back
  end if;

  update public.shop_orders
     set status              = p_status,
         status_note         = nullif(btrim(coalesce(p_note, '')), ''),
         status_changed_at   = now(),
         status_changed_by   = auth.uid(),
         refund_amount_cents = coalesce(amt, refund_amount_cents),
         updated_at          = now()
   where id = p_order
   returning * into o;
  return o;
end $$;

-- ── an unclear send: the printer may have it ───────────────────────────────────────────────────────────────────────
alter table public.shop_orders add column if not exists apliiq_submit_unknown_at timestamptz;
comment on column public.shop_orders.apliiq_submit_unknown_at is
  'When a send to the printer got no clear answer — a timeout, a 5xx, a reply with no order id (0417). Apliiq may have the order: the claim refuses another send until the crew says what Apliiq shows (shop_apliiq_checked).';

create or replace function public.claim_shop_order_for_submit(
  p_order uuid, p_tenant uuid, p_stale_seconds int default 120)
returns text
language plpgsql security definer set search_path = public as $$
declare o public.shop_orders; got uuid;
begin
  if p_tenant is null then return 'No tenant on this request.'; end if;
  select * into o from public.shop_orders where id = p_order and tenant_id = p_tenant;
  -- Deliberately the same sentence as a genuinely missing order. Saying "that belongs to somebody
  -- else" would confirm the id exists, which is the question an IDOR probe is asking.
  if not found then return 'That order no longer exists.'; end if;

  -- Said before the claim is attempted so the refusal can name the real reason. The claim's own
  -- WHERE repeats every one of these — these messages are for the human, that is for correctness.
  if o.apliiq_order_id is not null then
    return 'Apliiq already has this order (' || o.apliiq_order_id || '). Sending it again would '
        || 'make a second cap and charge the card twice.';
  end if;
  if o.status not in ('paid', 'needs_fulfillment') then
    return 'An order that is ' || o.status || ' is not waiting to be sent to the printer.';
  end if;
  -- 0417: a send not answered yet (the route marks the order before it leaves), or one that got no clear answer —
  -- Apliiq may have it. Look there first, and say so on the order.
  if o.apliiq_submit_unknown_at is not null then
    if o.apliiq_submit_started_at >= now() - make_interval(secs => greatest(p_stale_seconds, 5)) then
      return 'Somebody is sending this order right now. Give it a moment and refresh before trying again.';
    end if;
    return 'The last send got no clear answer from Apliiq — they may already have this order. Check Apliiq, then '
        || 'say on the order whether it is there. Sending it again before that could make a second cap.';
  end if;

  update public.shop_orders
     set apliiq_submit_started_at = now()
   where id = p_order
     and tenant_id = p_tenant
     and apliiq_order_id is null
     and apliiq_submit_unknown_at is null
     and status in ('paid', 'needs_fulfillment')
     -- A LOCK WITH NO EXPIRY IS AN OUTAGE. If a submit dies mid-flight — the process is killed, the
     -- network drops — the claim must age out or this paid order can never be sent by anyone again.
     -- The window is deliberately longer than any plausible Apliiq round trip.
     and (apliiq_submit_started_at is null
          or apliiq_submit_started_at < now() - make_interval(secs => greatest(p_stale_seconds, 5)))
   returning id into got;

  if got is null then
    return 'Somebody is sending this order right now. Give it a moment and refresh before trying again.';
  end if;
  return 'ok';
end $$;
revoke all on function public.claim_shop_order_for_submit(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_shop_order_for_submit(uuid, uuid, int) to service_role;

-- What the crew found at Apliiq: its order id (the order is at the printer), or none (it is not there: send it again).
create or replace function public.shop_apliiq_checked(p_order uuid, p_apliiq_id text default null)
returns public.shop_orders language plpgsql security definer set search_path = public as $$
declare o public.shop_orders; v_id text := nullif(btrim(coalesce(p_apliiq_id, '')), '');
begin
  if not public.is_staff() then raise exception 'Only crew can say what the printer has.' using errcode = '42501'; end if;
  select * into o from public.shop_orders where id = p_order for update;
  if not found or o.tenant_id is distinct from public.effective_tenant() then raise exception 'That order no longer exists.'; end if;
  if o.apliiq_order_id is not null then raise exception 'Apliiq already has this order (%).', o.apliiq_order_id; end if;
  if v_id is not null and v_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$' then raise exception 'That doesn''t read as an Apliiq order id.'; end if;
  -- "Not there" while a send is still out is not known yet: its answer comes first (the route clears or keeps the mark).
  if v_id is null and o.apliiq_submit_unknown_at is not null
     and o.apliiq_submit_started_at >= now() - interval '120 seconds' then
    raise exception 'It is being sent to Apliiq right now — wait for its answer, then look again.';
  end if;
  update public.shop_orders
     set apliiq_order_id          = v_id,
         status                   = case when v_id is not null and status in ('paid', 'needs_fulfillment') then 'submitted' else status end,
         apliiq_submit_unknown_at = null,
         apliiq_submit_started_at = null,
         updated_at               = now()
   where id = p_order
   returning * into o;
  return o;
end $$;
revoke all on function public.shop_apliiq_checked(uuid, text) from public, anon, authenticated;
grant execute on function public.shop_apliiq_checked(uuid, text) to authenticated;

-- 0407's view, with the send's two marks appended (a view may only grow at its end): the order's panel shows a send
-- still out, or one waiting for the crew's check, in place of Send to printer.
create or replace view public.v_shop_orders with (security_invoker = on) as
select
  o.id, o.created_at, o.updated_at, o.status,
  o.customer_id, o.user_id,
  coalesce(nullif(btrim(c.name), ''), nullif(btrim(o.ship_name), ''), o.email, 'Guest') as who,
  o.email, o.ship_name, o.ship_address,
  o.subtotal_cents, o.total_cents, o.refund_amount_cents,
  o.payment_id, o.apliiq_order_id, o.benefit_code, o.note,
  o.status_note, o.status_changed_at, o.status_changed_by,
  i.item_count, i.unit_count, i.items, i.cost_cents,
  case when i.cost_cents is null then null
       else coalesce(o.total_cents, 0) - i.cost_cents end                       as margin_cents,
  f.carrier, f.tracking_number, f.tracking_url, f.shipped_at,
  (o.status in ('paid','needs_fulfillment','submitted'))                        as waiting_on_us,
  (o.status in ('in_production'))                                               as waiting_on_printer,
  (o.status = 'shipped')                                                        as waiting_on_carrier,
  (o.status in ('delivered','refunded','canceled'))                             as closed,
  floor(extract(epoch from (now() - o.created_at)) / 3600.0)::int                as age_hours,
  o.ship_by,
  (o.ship_by is null or public.business_day() >= public.prior_business_day(o.ship_by))  as ship_risk,
  -- 0417: a send still out (started in the last two minutes, marked before it left), or one with no clear answer.
  o.apliiq_submit_started_at,
  o.apliiq_submit_unknown_at
from public.shop_orders o
left join public.customers c on c.id = o.customer_id
left join lateral (
  select count(*)::int                                                     as item_count,
         coalesce(sum(si.qty), 0)::int                                     as unit_count,
         string_agg(si.qty::text || 'x ' || si.title, ', ' order by si.title) as items,
         nullif(sum(coalesce(si.cost_cents, 0) * si.qty), 0)::int          as cost_cents
    from public.shop_order_items si where si.order_id = o.id
) i on true
left join lateral (
  select mf.carrier, mf.tracking_number, mf.tracking_url, mf.shipped_at
    from public.merch_fulfillments mf where mf.order_id = o.id
   order by mf.shipped_at desc nulls last, mf.created_at desc limit 1
) f on true;
revoke all on public.v_shop_orders from anon;
grant select on public.v_shop_orders to authenticated;

-- ── an office payment link's own id ────────────────────────────────────────────────────────────────────────────────
alter table public.business_orders add column if not exists paylink_id text;
comment on column public.business_orders.paylink_id is
  'The Square id of this order''s payment link (0417), so a cancel — or a payment taken another way — can switch it off.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Money counts what went back', 'fix', 'Money',
   'Refunds made in Square now come off Money''s revenue — and the founder digest''s week — on the day they were made: a walk-up sale, a cup or pack refunded after it was handed over, a card-reader payment given back. An order voided or canceled was already out of the books, so its refund is not taken off twice.',
   '2026-10-16', false),
  ('A partial shop refund keeps the order open', 'fix', 'Shop',
   'Recording part of a shop order as refunded adds it to what went back and leaves the order where it is — still to make and send. Only the refund that leaves nothing ends it. And a send to the printer with no clear answer waits for the crew to check Apliiq before it can be sent again.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select prosrc like '%refunds_counted%' from pg_proc where proname = 'report_sales';                       -- true
--   select prosrc like '%refunds_counted%' from pg_proc where proname = 'founder_digest_alert';               -- true
--   select has_function_privilege('authenticated', 'public.refund_counts_against(text, text)', 'execute');   -- false
--   select prosrc like '%amt < left_cents%' from pg_proc where proname = 'set_shop_order_status';             -- true
--   select count(*) from information_schema.columns where table_name = 'shop_orders' and column_name = 'apliiq_submit_unknown_at'; -- 1
--   select count(*) from information_schema.columns where table_name = 'business_orders' and column_name = 'paylink_id';           -- 1
--   select count(*) from information_schema.columns where table_name = 'v_shop_orders' and column_name like 'apliiq_submit_%';     -- 2
--   select prosrc like '%being sent to Apliiq right now%' from pg_proc where proname = 'shop_apliiq_checked';  -- true
select public.record_migration('0417_the_books_count_what_went_back');

-- ============================================================
-- 0418_every_public_door_that_rings_is_counted.sql
-- ============================================================
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
