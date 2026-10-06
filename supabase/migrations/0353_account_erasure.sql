-- ── DELETE MY ACCOUNT ─────────────────────────────────────────────────────────────────────────────
-- 2026-10-06, the iPhone round, part 2. Apple will not list an app that lets people make an account
-- but not delete it (App Store Review Guideline 5.1.1(v)), and the web owes people the same: a button
-- in their account that deletes it, then and there, with no email to send and no one to call.
-- Apple's own words on what that means (developer.apple.com/support/offering-account-deletion-in-
-- your-app): "Offer to delete the entire account record, along with associated personal data",
-- including what the person wrote ("photos, video, text posts, and reviews"); and "If local laws or
-- regulations require that you maintain some data, let your users know."
--
-- ── WHAT WAS THERE ───────────────────────────────────────────────────────────────────────────────
-- No account could be deleted at all. 0141 put a guard on profiles that refuses a delete unless the
-- maintenance switch is on, and deleting the account (auth.users) deletes its profile by cascade —
-- so the guard fired, and "Delete user" in the Supabase dashboard failed for every account with
-- "Database error deleting user". 0141 said so ("set the hatch first"); 0308's test says why it
-- happens ("guard a cascade target and you have not protected the row, you have broken the
-- parent"). And had it worked, the cascade would have left the person's name, phone and address on
-- every order, and every change ever made to their records, word for word, in the audit trail.
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────────────────────────
-- Deleting the account IS the erasure: a trigger on auth.users runs erase_account_data() first, in
-- the same transaction, however the account is deleted — the app's POST /api/account/erase (which
-- asks Supabase's admin API, the documented way), or the dashboard. All of it happens, or none of it.
--
--   DELETED — what is only about the person, or theirs: the profile, reviews, RSVPs, the VIP proof
--             (the photo itself is removed from storage by the route), the wait-list entries, Primal
--             progress and passes, AI conversations, points, check-ins, holds, notification settings,
--             a team invite to their email — and everything the schema already ties to the account
--             with ON DELETE CASCADE, found in the catalog.
--   KEPT WITHOUT THEM — what the business must keep for its books: every order, payment and refund,
--             with the name, phone, email, address and notes taken out ("Deleted customer"); the
--             customer record they point at, emptied the same way; what was sent to them about an
--             order, as sent, without its words; the work they did for the business as crew (notes,
--             brews, expenses, inspections, goals), with their name taken off.
--   KEPT AS SIGNED — offer letters and operator agreements, which are contracts: their names stay as
--             signed; the link to the account goes. The app tells crew this before they delete.
--   REFUSED — the business's only owner (a business with no owner cannot be run or handed on: make
--             someone else an owner first); a membership Square can still bill (the route cancels it
--             at Square first; if that could not be done, this says so rather than leave a charge
--             running for an account that no longer exists); and an order still on its way — a pickup
--             or delivery dated today or later, a truck order from the last twelve hours, merch paid
--             in the last thirty days and not yet with the maker — each needs the name or address that
--             deleting takes out. A past order still marked "placed" is a status nobody closed, not an
--             order on its way, and does not hold anyone's account hostage. Apple allows the wait if
--             the person is told; the words below tell them.
--
-- And so that a table added later can neither block a deletion nor keep a person attached: every
-- other reference the schema makes to the account or the profile is found in the catalog and let go
-- (set null), and a reference that cannot be let go (NOT NULL) stops the deletion with its name — the
-- cue to give it a rule here. Then the audit trail: the history of every row deleted goes with it;
-- the history of every row kept keeps its shape, with the person's ids, name, email, phone, address
-- and words taken out of each snapshot. Webhook copies are scrubbed the same way (they also age out
-- in 30 days, 0230).
--
-- Nothing calls erase_account_data() but the trigger: not the app, not a signed-in person, not the
-- service role. What it leaves is one row in account_erasures — when, the role, what was kept —
-- with nothing about who. scripts/db.erasure.test.mjs runs it against every migration in this
-- directory, applied in order, and reads every column of every table afterwards.
--
-- Also here, because it is the same switch: the weekly audit prune (0117) deletes from audit_log,
-- which 0141 guarded without the prune turning the switch on. It has had nothing old enough to delete
-- yet; the first Monday it does, it would fail and the audit log would grow without bound (R-003).
-- changelog: below.

-- 1 · A co-owner who approved an offer and later leaves: the approval stays, without them.
alter table public.offer_approvals alter column approver_id drop not null;

-- 2 · That an account was erased — and nothing about whose.
create table if not exists public.account_erasures (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  erased_at     timestamptz not null default now(),
  role          text not null,
  orders_kept   int not null default 0,
  rows_deleted  int not null default 0
);
alter table public.account_erasures enable row level security;
drop policy if exists account_erasures_read on public.account_erasures;
create policy account_erasures_read on public.account_erasures for select using ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.account_erasures;
create policy "tenant isolation" on public.account_erasures as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- 3 · A record's history, found by the record (the erasure asks; so can anyone reading the trail).
create index if not exists audit_log_row_idx on public.audit_log (table_name, row_id);

-- 4 · A snapshot, with the person taken out: any string that IS one of their words (a name, an
--     address, a note — `exact`, lower-cased) or CONTAINS one of their ids, emails or phones
--     (`ids`, `contains`, lower-cased) becomes null; everything else — amounts, statuses, times —
--     stays where it was.
create or replace function public.erasure_redact(j jsonb, ids text[], exact text[], contains text[])
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  out jsonb;
  k   text;
  v   jsonb;
  s   text;
begin
  if j is null then return null; end if;
  case jsonb_typeof(j)
    when 'object' then
      out := '{}'::jsonb;
      for k, v in select e.key, e.value from jsonb_each(j) e loop
        out := out || jsonb_build_object(k, public.erasure_redact(v, ids, exact, contains));
      end loop;
      return out;
    when 'array' then
      return coalesce((select jsonb_agg(public.erasure_redact(e.value, ids, exact, contains) order by e.ord)
                         from jsonb_array_elements(j) with ordinality e(value, ord)), '[]'::jsonb);
    when 'string' then
      s := lower(j #>> '{}');
      if btrim(s) = any(exact)
         or exists (select 1 from unnest(ids || contains) w where length(w) > 0 and strpos(s, w) > 0) then
        return 'null'::jsonb;
      end if;
      return j;
    else
      return j;
  end case;
end $$;

-- 5 · What stands in the way, in words a person can act on: [{code, message}], empty when nothing
--     does. The route asks this first so it can answer before anything changes (and cancels a
--     membership itself — code 'membership'); the erasure asks it again, last.
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

  if exists (select 1 from public.subscriptions s
              where s.user_id = p_user and s.square_subscription_id is not null
                and s.status in ('active', 'paused', 'pending', 'past_due')) then
    out := out || jsonb_build_object('code', 'membership',
      'message', 'Your membership can still bill. Cancel it from your membership card, then delete your account.');
  end if;

  if exists (select 1 from public.drop_orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers)) and o.canceled_at is null
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.drop_date >= current_date)
     or exists (select 1 from public.delivery_orders o
              where (o.user_id = p_user or o.customer_id = any(v_customers))
                and o.fulfillment_status in ('placed', 'in_prep', 'ready') and o.delivery_date >= current_date)
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

-- 6 · The erasure. Run by the trigger below, as the account is deleted — never on its own.
create or replace function public.erase_account_data(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- contracts keep their words; only the link to the account goes
  v_signed    constant text[] := array['offer_letters', 'offer_approvals', 'offer_events',
                                       'operator_agreements', 'operator_agreement_events', 'agreement_hours'];
  v_blockers  jsonb;
  v_role      text;
  v_tenant    uuid;
  v_email     text;
  v_customers uuid[];
  v_ids       text[];
  v_idre      text;
  v_exact     text[];
  v_contains  text[];
  v_gone      text[] := '{}';   -- 'table:id' of every row deleted
  v_tables    text[] := '{}';   -- every table the erasure changed
  v_kept      int := 0;
  v_deleted   int := 0;
  v_prev      text;
  n           int;
  got         text[];
  t           text;
  w           text;
  ref         record;
begin
  if p_user is null then raise exception 'erase_account_data: no account given' using errcode = '22023'; end if;
  v_blockers := public.account_erasure_blockers(p_user);
  if jsonb_array_length(v_blockers) > 0 then raise exception '%', v_blockers -> 0 ->> 'message' using errcode = 'P0001'; end if;

  select role, tenant_id into v_role, v_tenant from public.profiles where id = p_user;
  select lower(email) into v_email from auth.users where id = p_user;
  select coalesce(array_agg(id), '{}') into v_customers from public.customers where user_id = p_user;
  v_ids  := array[p_user::text] || v_customers::text[];
  v_idre := array_to_string(v_ids, '|');

  -- What the logs might still say about them — gathered before anything changes. Names, addresses
  -- and notes match a whole value; emails and phones match anywhere in one.
  select coalesce(array_agg(distinct x.w), '{}') into v_exact
    from (select lower(btrim(s)) as w from (
            select display_name as s from public.profiles where id = p_user
            union all select bio from public.profiles where id = p_user
            union all select name from public.customers where id = any(v_customers)
            union all select name from public.drop_orders where user_id = p_user or customer_id = any(v_customers)
            union all select unnest(array[name, address_street, access_instructions, driver_note]) from public.delivery_orders
                       where user_id = p_user or customer_id = any(v_customers)
            union all select unnest(array[ship_name, note]) from public.shop_orders where user_id = p_user or customer_id = any(v_customers)
            union all select a.value from public.shop_orders o
                       cross join lateral jsonb_each_text(case when jsonb_typeof(o.ship_address) = 'object' then o.ship_address else '{}'::jsonb end) a
                       where (o.user_id = p_user or o.customer_id = any(v_customers)) and a.key !~* '^(city|state|zip|postal|country|region)'
            union all select customer from public.orders where user_id = p_user or customer_id = any(v_customers)
            union all select unnest(array[name, body]) from public.reviews where user_id = p_user
            union all select note from public.vip_verifications where user_id = p_user or customer_id = any(v_customers)
          ) s0 where s is not null) x
   where length(x.w) >= 3 and x.w not in ('deleted customer', 'deleted');
  select coalesce(array_agg(distinct x.w), '{}') into v_contains
    from (select lower(btrim(s)) as w from (
            select v_email as s
            union all select unnest(array[email, email_norm, phone, phone_norm]) from public.customers where id = any(v_customers)
            union all select phone from public.drop_orders where user_id = p_user or customer_id = any(v_customers)
            union all select phone from public.delivery_orders where user_id = p_user or customer_id = any(v_customers)
            union all select email from public.shop_orders where user_id = p_user or customer_id = any(v_customers)
            union all select contact_email from public.rsvps where user_id = p_user
            union all select email from public.subscription_interest where user_id = p_user
          ) s0 where s is not null) x
   where length(x.w) >= 5;

  -- Deliberate, and for this transaction only (0141's switch): the deletes below are the point.
  v_prev := current_setting('gt3.allow_hard_delete', true);
  perform set_config('gt3.allow_hard_delete', 'on', true);

  -- ── DELETED: what is only about them, or theirs ──
  -- a hold they had on a reserve goes back on the shelf first (cancel_reserve_claim, 0014, for each)
  with released as (
    update public.reserve_claims set state = 'cancelled' where user_id = p_user and state = 'held' returning reserve_id, qty
  )
  update public.reserves r
     set stock_remaining = least(r.stock_total, r.stock_remaining + x.q),
         status = case when r.status = 'sold_out' then 'live' else r.status end
    from (select reserve_id, sum(qty) as q from released group by reserve_id) x
   where r.id = x.reserve_id;
  for t, w in select v.t, v.w from (values
      ('reviews',               'user_id = $1'),
      ('rsvps',                 'user_id = $1'),
      ('subscription_interest', 'user_id = $1 or lower(email) = $3'),
      ('vip_verifications',     'user_id = $1 or customer_id = any($2)'),
      ('agent_convos',          'user_id = $1'),
      -- a referral is a pair of people; with one of them gone the pair is gone (credit given stays given)
      ('referral_events',       'referrer = $1 or referee = $1'),
      ('delivery_waitlist',     'lower(email) = $3'),
      ('team_invites',          'claimed_by = $1 or lower(email) = $3'),
      ('admin_emails',          'lower(email) = $3')
    ) as v(t, w)
  loop
    execute format('with d as (delete from public.%I x where %s returning to_jsonb(x) ->> ''id'' as id)
                    select coalesce(array_agg(%L || '':'' || coalesce(id, '''')), ''{}''), count(*) from d', t, w, t)
      into got, n using p_user, v_customers, v_email;
    v_gone := v_gone || got; v_deleted := v_deleted + n;
    if n > 0 then v_tables := v_tables || t; end if;
  end loop;

  -- and everything the schema already says goes with the account, the profile or their customer
  -- record (ON DELETE CASCADE) — deleted here, under the switch, so the account's own delete has
  -- nothing guarded left to cascade into. The profile itself goes last, below.
  for ref in
    select cl.relname as tbl, a.attname as col, (c.confrelid = 'public.customers'::regclass) as by_customer
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and cardinality(c.conkey) = 1 and c.confdeltype = 'c'
       and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.customers'::regclass)
       and not (cl.relname = 'profiles' and a.attname = 'id')
  loop
    execute format('with d as (delete from public.%I x where %I = %s returning to_jsonb(x) ->> ''id'' as id)
                    select coalesce(array_agg(%L || '':'' || coalesce(id, '''')), ''{}''), count(*) from d',
                   ref.tbl, ref.col, case when ref.by_customer then 'any($2)' else '$1' end, ref.tbl)
      into got, n using p_user, v_customers;
    v_gone := v_gone || got; v_deleted := v_deleted + n;
    if n > 0 then v_tables := v_tables || ref.tbl::text; end if;
  end loop;

  -- ── KEPT WITHOUT THEM: the books ──
  -- what was sent to them about their orders: the record that it was sent stays; its words and address go
  update public.customer_messages set to_address = 'deleted', subject = null, body = 'deleted', detail = null, delivery_detail = null
   where order_id in (select id from public.shop_orders where user_id = p_user or customer_id = any(v_customers))
      or lower(to_address) = any(v_contains);
  get diagnostics n = row_count; if n > 0 then v_tables := v_tables || 'customer_messages'::text; end if;
  update public.drop_orders set name = 'Deleted customer', phone = null, user_id = null
   where user_id = p_user or customer_id = any(v_customers);
  get diagnostics n = row_count; v_kept := v_kept + n; if n > 0 then v_tables := v_tables || 'drop_orders'::text; end if;
  update public.delivery_orders set name = 'Deleted customer', phone = null, address_street = 'deleted', address_city = 'deleted',
         address_zip = 'deleted', access_instructions = null, driver_note = null, user_id = null
   where user_id = p_user or customer_id = any(v_customers);
  get diagnostics n = row_count; v_kept := v_kept + n; if n > 0 then v_tables := v_tables || 'delivery_orders'::text; end if;
  update public.shop_orders set email = null, ship_name = null, ship_address = null, note = null, user_id = null
   where user_id = p_user or customer_id = any(v_customers);
  get diagnostics n = row_count; v_kept := v_kept + n; if n > 0 then v_tables := v_tables || 'shop_orders'::text; end if;
  update public.orders set customer = 'Deleted customer', user_id = null
   where user_id = p_user or customer_id = any(v_customers);
  get diagnostics n = row_count; v_kept := v_kept + n; if n > 0 then v_tables := v_tables || 'orders'::text; end if;
  -- the customer record the orders point at: kept, emptied, and no longer theirs
  update public.customers set name = 'Deleted customer', phone = null, email = null,   -- phone_norm, email_norm follow (generated)
         vip_verified = false, user_id = null
   where id = any(v_customers);
  -- a business's account and orders are the business's: the person leaves them; the company's record stays
  update public.business_accounts set user_id = null where user_id = p_user;
  update public.business_orders set user_id = null where user_id = p_user;

  -- ── KEPT WITHOUT THEM: their work for the business, unsigned ──
  update public.goals set author_name = null where created_by = p_user;
  get diagnostics n = row_count; if n > 0 then v_tables := v_tables || 'goals'::text; end if;
  update public.agent_knowledge set author_name = null where created_by = p_user;
  get diagnostics n = row_count; if n > 0 then v_tables := v_tables || 'agent_knowledge'::text; end if;
  update public.strategy_decisions set author_name = null where author_id = p_user;
  get diagnostics n = row_count; if n > 0 then v_tables := v_tables || 'strategy_decisions'::text; end if;
  update public.gtm_drafts set author_name = null where author_id = p_user;
  get diagnostics n = row_count; if n > 0 then v_tables := v_tables || 'gtm_drafts'::text; end if;

  -- ── every other reference to the account or the profile: let go ──
  -- (in every schema but auth, whose own rows Supabase deletes with the account)
  for ref in
    select c.conrelid::regclass as rel, cl.relname as tbl, a.attname as col, a.attnotnull as required
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname <> 'auth'
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and cardinality(c.conkey) = 1 and c.confdeltype <> 'c'
       and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  loop
    if ref.required then
      execute format('select count(*) from %s where %I = $1', ref.rel, ref.col) into n using p_user;
      if n > 0 then
        raise exception 'erase_account_data: %.% names this account and cannot be cleared — give it a rule in this function', ref.tbl, ref.col
          using errcode = 'P0001';
      end if;
    else
      execute format('update %s set %I = null where %I = $1', ref.rel, ref.col, ref.col) using p_user;
      get diagnostics n = row_count;
      if n > 0 then v_tables := v_tables || ref.tbl::text; end if;
    end if;
  end loop;

  -- ── and the profile ──
  delete from public.profiles where id = p_user;
  get diagnostics n = row_count;
  if n > 0 then v_deleted := v_deleted + n; v_gone := v_gone || ('profiles:' || p_user::text); v_tables := v_tables || 'profiles'::text; end if;

  perform set_config('gt3.allow_hard_delete', coalesce(v_prev, ''), true);

  -- ── the audit trail ──
  -- the history of what was deleted goes with it
  update public.audit_log a set old_data = null, new_data = null
    from (select split_part(g, ':', 1) as tbl, split_part(g, ':', 2) as id from unnest(v_gone) g) gone
   where a.table_name = gone.tbl and a.row_id = gone.id and gone.id <> ''
     and (a.old_data is not null or a.new_data is not null);
  -- the history of what was kept keeps its shape, without them (contracts: without the link only)
  update public.audit_log a
     set old_data = public.erasure_redact(a.old_data, v_ids,
                      case when a.table_name = any(v_signed) then '{}'::text[] else v_exact end,
                      case when a.table_name = any(v_signed) then '{}'::text[] else v_contains end),
         new_data = public.erasure_redact(a.new_data, v_ids,
                      case when a.table_name = any(v_signed) then '{}'::text[] else v_exact end,
                      case when a.table_name = any(v_signed) then '{}'::text[] else v_contains end)
   where a.table_name = any(v_tables)
     and (a.old_data::text ~ v_idre or a.new_data::text ~ v_idre);
  update public.audit_log set actor = null where actor = p_user;
  -- the admin trail: their own profile's entries go entirely; any other that names them, without them
  update public.admin_audit a
     set actor   = case when a.actor = p_user then null else a.actor end,
         summary = case when a.table_name = 'profiles' and a.row_pk = p_user::text then null
                        when exists (select 1 from unnest(v_ids || v_exact || v_contains) x
                                      where length(x) >= 3 and strpos(lower(coalesce(a.summary, '')), x) > 0) then null
                        else a.summary end,
         old_row = case when a.table_name = 'profiles' and a.row_pk = p_user::text then null
                        else public.erasure_redact(a.old_row, v_ids, v_exact, v_contains) end,
         new_row = case when a.table_name = 'profiles' and a.row_pk = p_user::text then null
                        else public.erasure_redact(a.new_row, v_ids, v_exact, v_contains) end
   where a.actor = p_user or a.row_pk = any(v_ids)
      or a.old_row::text ~ v_idre or a.new_row::text ~ v_idre;
  -- what Square and Resend sent us about them (also gone within 30 days, 0230)
  if cardinality(v_contains) > 0 then
    update public.webhook_events e set payload = public.erasure_redact(e.payload, v_ids, v_exact, v_contains)
     where exists (select 1 from unnest(v_contains) x where strpos(lower(e.payload::text), x) > 0);
  end if;

  insert into public.account_erasures (tenant_id, role, orders_kept, rows_deleted)
  values (coalesce(v_tenant, '00000000-0000-0000-0000-000000000001'), coalesce(v_role, 'member'), v_kept, v_deleted);

  return jsonb_build_object('orders_kept', v_kept, 'rows_deleted', v_deleted);
end $$;

-- 7 · Deleting the account is what runs it — the app's route, Supabase's admin API, the dashboard.
create or replace function public.erase_account_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.erase_account_data(old.id);
  return old;
end $$;
drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted before delete on auth.users
  for each row execute function public.erase_account_on_delete();

revoke all on function public.erasure_redact(jsonb, text[], text[], text[]) from public, anon, authenticated, service_role;
revoke all on function public.erase_account_data(uuid) from public, anon, authenticated, service_role;
revoke all on function public.erase_account_on_delete() from public, anon, authenticated, service_role;
revoke all on function public.account_erasure_blockers(uuid) from public, anon, authenticated;
grant execute on function public.account_erasure_blockers(uuid) to service_role;

-- 8 · The weekly audit prune, with the switch it has needed since 0141 (see the header).
create or replace function public.tidy_audit_log(keep_days int default 365) returns int
  language plpgsql security definer set search_path = public as $$
declare n int; v_prev text;
begin
  v_prev := current_setting('gt3.allow_hard_delete', true);
  perform set_config('gt3.allow_hard_delete', 'on', true);
  -- floor the window at 90 days so a bad argument can never nuke the recent trail
  delete from public.audit_log
   where at < now() - make_interval(days => greatest(keep_days, 90));
  get diagnostics n = row_count;
  perform set_config('gt3.allow_hard_delete', coalesce(v_prev, ''), true);
  return n;
end $$;
revoke all on function public.tidy_audit_log(int) from public, anon, authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Delete your account, from your account','feature','Customers',
   'Anyone can delete their GT3 account from their account menu, on the web and in the iPhone app. It goes then and there: their profile, contact details, reviews, RSVPs, VIP photo, Primal progress, points and saved settings are deleted. Orders and payments stay for the books, with the name, phone, email and address taken out. A membership is cancelled first; the business''s only owner is asked to name another owner before leaving.',
   '2026-10-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_deleted';   -- 1 row
--   select public.account_erasure_blockers('<an owner''s id>');            -- the only-owner reason, if they are
--   select count(*) from public.account_erasures;                          -- 0 until someone deletes an account
--   select has_function_privilege('service_role', 'public.erase_account_data(uuid)', 'execute');   -- false
select public.record_migration('0353_account_erasure');
