-- ── 0388 — A PACK IS CHANGED IN PLACE ──────────────────────────────────────────────────────────────────────────────
-- 2026-10-12. C5 of the customer frontend audit. The owner approved it on 2026-10-12 (decision 4: a paid pack is changed
-- in place, charging or refunding only the difference).
--
-- WHY. "Change the pack" placed a second reservation and then canceled the first. A paid pack was charged again in
-- full; the first payment waited on a crew alert ("Member canceled a PAID reservation — refund needed") to be refunded
-- by hand; and the customer was told only "Pack updated" (OrderFunnel, cancel_own_reservation 0341).
--
-- WHAT. A change is one row here, keyed by the page's idempotency key (components/useIdemKey), written only by the
-- functions below, and only the server calls them (app/api/reserve/change, through lib/packChange):
--
--   started   the pack is held for this change — one change at a time per pack — and nothing has moved yet
--   moved     what the change needed is done in Square: the difference charged, or refunded, or nothing to move
--   done      the pack was changed in place: size, glass, mix, day, name, phone, code, the total
--   refused   Square declined the card: nothing moved, and the pack is free again
--   unknown   Square's answer never came or did not say; the crew is told, and the pack is unchanged
--   void      it stopped before any money moved (the pack changed underneath, or its request died)
--   stale     money moved but the pack changed underneath before it was applied: the server gives a charge back,
--             and tells the crew about a refund
--
-- The money rule lives in pack_change_begin, read under the pack's lock — the page is quoted the same rule
-- (lib/packChange.diffFor) and sends what it was shown; a different answer here refuses before anything moves:
--   paid pack      the difference: the new total less what the pack holds now. More is charged to a card; less is
--                  refunded to the payments that funded the pack, newest first (pack_change_funding).
--   pay at pickup  nothing moves, unless the customer pays now: then the new total is charged.
--
-- Untouched: /api/reserve, cancel_own_reservation (a cancel still flags a paid pack's refund for the crew), the
-- loyalty trigger (a pack earns its stamps at pickup, so a change before pickup moves none), the drop board.
--
-- ORDER. Paste it before the deploy that carries the change route. Pasted after, nothing breaks: until it is here the
-- route answers "Changing a pack isn't switched on yet" and the page keeps the old way.
-- existing rows: none written.
-- changelog: below.

create table if not exists public.drop_order_changes (
  key               text primary key check (char_length(key) between 8 and 45),
  drop_order_id     uuid not null references public.drop_orders(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  tenant_id         uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  state             text not null default 'started'
                    check (state in ('started', 'moved', 'done', 'refused', 'unknown', 'void', 'stale')),
  card              boolean not null default false,       -- a card is charged under this key
  before            jsonb not null,                       -- the pack as it was, read under its lock
  after             jsonb not null,                       -- what it becomes
  diff_cents        integer not null,                     -- + charged under this key, − refunded, 0 nothing moves
  charge_payment_id text unique,
  refunds           jsonb not null default '[]'::jsonb,   -- [{payment_id, refund_id, cents, status}]
  by_hand_cents     integer not null default 0 check (by_hand_cents >= 0),  -- refund the crew sends by hand
  status            integer,                              -- what the server answered, said again to a retry
  answer            jsonb,
  outcome           text,                                 -- how the money step went, in Square's words or ours
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists drop_order_changes_one_at_a_time
  on public.drop_order_changes (drop_order_id) where state in ('started', 'moved');
create index if not exists drop_order_changes_pack on public.drop_order_changes (drop_order_id, created_at desc);
comment on table public.drop_order_changes is
  'Every change to a reserved pack (0388): the pack before and after, the money it moved and how. No name or phone is kept here — they go straight onto the pack — so an erased account leaves nothing of the person in it. Written only by pack_change_begin / _moved / _end / _apply / _refunded / _answer, which only the server calls.';

alter table public.drop_order_changes enable row level security;
drop policy if exists "pack changes own read" on public.drop_order_changes;
create policy "pack changes own read" on public.drop_order_changes for select
  using (user_id = (select auth.uid()) or (select public.is_staff()));
drop trigger if exists stamp_tenant_tg on public.drop_order_changes;
create trigger stamp_tenant_tg before insert on public.drop_order_changes for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.drop_order_changes;
create policy "tenant isolation" on public.drop_order_changes as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
-- read for the signed-in (the policies decide which rows); no writes from the app
revoke all on public.drop_order_changes from public, anon;
revoke insert, update, delete, truncate on public.drop_order_changes from authenticated;
grant select on public.drop_order_changes to authenticated;
grant select, insert, update, delete on public.drop_order_changes to service_role;

-- The pack as a change compares it: what it is, and what it holds.
create or replace function public.pack_snapshot(r public.drop_orders) returns jsonb
  language sql stable set search_path = public as $$
  select jsonb_build_object('size', r.size, 'glass', r.glass, 'mix', r.mix, 'drop_date', r.drop_date,
    'total_cents', r.total_cents, 'paid', r.paid, 'payment_id', r.payment_id)
$$;

-- The payments that fund a pack, newest first, with what is left to refund on each. The reservation's own payment
-- (drop_orders.payment_id) holds what the pack cost before its first change — or, when a change paid a pay-at-pickup
-- pack, what that change charged; every later charged difference is its own payment. A refund recorded by a change
-- comes off the payment it was taken from. A refund made by hand in Square is not here: Square refuses a refund past
-- what is left, and the crew is told.
create or replace function public.pack_change_funding(p_order uuid) returns jsonb
  language sql stable set search_path = public as $$
  with r as (select * from public.drop_orders where id = p_order),
  done as (select c.* from public.drop_order_changes c where c.drop_order_id = p_order and c.state in ('moved', 'done', 'stale')),
  pays as (
    select r.payment_id as payment_id,
           coalesce((select d.diff_cents from done d where d.charge_payment_id = r.payment_id),
                    (select (d.before->>'total_cents')::int from done d order by d.created_at limit 1),
                    r.total_cents) as cents,
           '-infinity'::timestamptz as at
      from r where r.payment_id is not null
    union all
    select d.charge_payment_id, d.diff_cents, d.created_at
      from done d, r where d.charge_payment_id is not null and d.charge_payment_id is distinct from r.payment_id
  ),
  taken as (
    select x->>'payment_id' as payment_id, sum((x->>'cents')::int) as cents
      from done d, jsonb_array_elements(d.refunds) x group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.payment_id,
           'left', greatest(0, p.cents - coalesce(t.cents, 0))) order by p.at desc), '[]'::jsonb)
    from pays p left join taken t on t.payment_id = p.payment_id
$$;

-- Hold the pack for this change, or say why not. A key seen before answers with its change, whatever has happened
-- since. The money it will move is decided here, under the pack's lock.
create or replace function public.pack_change_begin(
  p_key text, p_order uuid, p_user uuid, p_after jsonb, p_new_total integer, p_pay_now boolean, p_expected_diff integer
) returns jsonb language plpgsql set search_path = public as $$
declare r public.drop_orders%rowtype; c public.drop_order_changes%rowtype; h public.drop_order_changes%rowtype;
  v_diff integer; v_card boolean;
begin
  select * into c from public.drop_order_changes where key = p_key;
  if c.key is not null then
    if c.drop_order_id is distinct from p_order or c.user_id is distinct from p_user then
      return jsonb_build_object('refused', 'key');
    end if;
    return jsonb_build_object('change', to_jsonb(c), 'again', true,
      'age_ms', floor(extract(epoch from (now() - c.updated_at)) * 1000));
  end if;
  select * into r from public.drop_orders where id = p_order for update;
  if r.id is null or r.user_id is distinct from p_user then return jsonb_build_object('refused', 'not_found'); end if;
  if r.canceled_at is not null then return jsonb_build_object('refused', 'canceled'); end if;
  if r.picked_up or r.stage is distinct from 'reserved' then return jsonb_build_object('refused', 'in_motion'); end if;
  if r.collected_at is not null then return jsonb_build_object('refused', 'collected'); end if;
  select * into h from public.drop_order_changes where drop_order_id = p_order and state in ('started', 'moved');
  if h.key is not null then
    return jsonb_build_object('held', to_jsonb(h), 'age_ms', floor(extract(epoch from (now() - h.updated_at)) * 1000));
  end if;
  if r.paid then
    v_diff := p_new_total - r.total_cents;
  elsif p_pay_now then
    v_diff := p_new_total;
  else
    v_diff := 0;
  end if;
  v_card := v_diff > 0;
  if p_expected_diff is distinct from v_diff then
    return jsonb_build_object('refused', 'repriced', 'diff', v_diff, 'was', r.total_cents, 'paid', r.paid);
  end if;
  insert into public.drop_order_changes (key, drop_order_id, user_id, tenant_id, card, before, after, diff_cents)
    values (p_key, p_order, p_user, r.tenant_id, v_card, public.pack_snapshot(r), p_after, v_diff)
    returning * into c;
  return jsonb_build_object('change', to_jsonb(c), 'funding', public.pack_change_funding(p_order));
end $$;

-- Square did what the change needed (or there was nothing to do): started → moved.
create or replace function public.pack_change_moved(
  p_key text, p_charge_payment_id text, p_refunds jsonb, p_by_hand integer, p_outcome text
) returns boolean language plpgsql set search_path = public as $$
begin
  update public.drop_order_changes
     set state = 'moved', charge_payment_id = p_charge_payment_id, refunds = coalesce(p_refunds, '[]'::jsonb),
         by_hand_cents = greatest(0, coalesce(p_by_hand, 0)), outcome = p_outcome, updated_at = now()
   where key = p_key and state = 'started';
  return found;
end $$;

-- A change that ends before it moved anything: started → refused | unknown | void.
create or replace function public.pack_change_end(p_key text, p_state text, p_outcome text) returns boolean
  language plpgsql set search_path = public as $$
begin
  if p_state not in ('refused', 'unknown', 'void') then raise exception 'pack_change_end: % is not an end', p_state; end if;
  update public.drop_order_changes set state = p_state, outcome = p_outcome, updated_at = now()
   where key = p_key and state = 'started';
  return found;
end $$;

-- Change the pack in place: moved → done, when the pack is still as the change found it. Otherwise → stale (money
-- moved) or void (none did), and the pack is left alone. The name and phone come with the request that made the
-- change; a change finished by a later request keeps the pack's. The pack's name and phone come back for the words.
create or replace function public.pack_change_apply(p_key text, p_name text default null, p_phone text default null) returns jsonb
  language plpgsql set search_path = public as $$
declare c public.drop_order_changes%rowtype; r public.drop_orders%rowtype; v_state text;
begin
  select * into c from public.drop_order_changes where key = p_key for update;
  if c.key is null then return jsonb_build_object('state', 'missing'); end if;
  select * into r from public.drop_orders where id = c.drop_order_id for update;
  if c.state <> 'moved' then return jsonb_build_object('state', c.state, 'change', to_jsonb(c), 'name', r.name, 'phone', r.phone); end if;
  if r.id is null or r.canceled_at is not null or r.picked_up or r.stage is distinct from 'reserved'
     or r.collected_at is not null or public.pack_snapshot(r) is distinct from c.before then
    v_state := case when c.charge_payment_id is not null or jsonb_array_length(c.refunds) > 0 or c.by_hand_cents > 0
                    then 'stale' else 'void' end;
    update public.drop_order_changes set state = v_state, outcome = coalesce(c.outcome || ' · ', '') || 'the pack changed before this was applied', updated_at = now()
     where key = p_key returning * into c;
    return jsonb_build_object('state', v_state, 'change', to_jsonb(c), 'name', r.name, 'phone', r.phone);
  end if;
  update public.drop_orders set
      size = (c.after->>'size')::int,
      glass = c.after->>'glass',
      mix = c.after->'mix',
      drop_date = (c.after->>'drop_date')::date,
      total_cents = (c.after->>'total_cents')::int,
      name = coalesce(nullif(trim(p_name), ''), r.name),
      phone = coalesce(nullif(trim(p_phone), ''), r.phone),
      benefit_code = nullif(c.after->>'benefit_code', ''),
      -- a pay-at-pickup pack paid by this change is paid, by this change's payment
      paid = r.paid or c.charge_payment_id is not null,
      payment_id = case when not r.paid and c.charge_payment_id is not null then c.charge_payment_id else r.payment_id end
   where id = r.id
  returning * into r;
  update public.drop_order_changes set state = 'done', updated_at = now() where key = p_key returning * into c;
  return jsonb_build_object('state', 'done', 'change', to_jsonb(c), 'name', r.name, 'phone', r.phone);
end $$;

-- A refund made after the change moved — a stale change's charge given back — goes on its record, so the payment it
-- came from holds that much less (pack_change_funding).
create or replace function public.pack_change_refunded(p_key text, p_refund jsonb) returns boolean
  language plpgsql set search_path = public as $$
begin
  update public.drop_order_changes set refunds = refunds || jsonb_build_array(p_refund), updated_at = now()
   where key = p_key and state in ('moved', 'done', 'stale');
  return found;
end $$;

-- What the server answered, kept for a retry of the same key.
create or replace function public.pack_change_answer(p_key text, p_status integer, p_answer jsonb) returns void
  language sql set search_path = public as $$
  update public.drop_order_changes set status = p_status, answer = p_answer, updated_at = now() where key = p_key
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.pack_snapshot(public.drop_orders)', 'public.pack_change_funding(uuid)',
    'public.pack_change_begin(text, uuid, uuid, jsonb, integer, boolean, integer)',
    'public.pack_change_moved(text, text, jsonb, integer, text)', 'public.pack_change_end(text, text, text)',
    'public.pack_change_apply(text, text, text)', 'public.pack_change_refunded(text, jsonb)',
    'public.pack_change_answer(text, integer, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A pack is changed in place','fix','Ordering',
   'Changing a paid pack used to charge a second full pack and leave the first to be refunded by hand. Now the pack itself changes — size, flavors, glass, day — and only the difference moves: a bigger pack charges the difference to a card, a smaller one refunds it to the card that paid, and the same price moves nothing. The page shows the difference before you confirm, and the text says what moved.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select relrowsecurity from pg_class where oid = 'public.drop_order_changes'::regclass;                       -- t
--   select has_function_privilege('authenticated', 'public.pack_change_apply(text, text, text)', 'execute');    -- f
--   select count(*) from pg_proc where proname like 'pack_change_%';                                             -- 7
select public.record_migration('0388_a_pack_is_changed_in_place');
