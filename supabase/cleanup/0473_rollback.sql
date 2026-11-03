-- 0473 ROLLBACK — puts back exactly what 0473 replaced (0271 policies, 0444 course_students, 0462 std_research_settle,
-- 0472 vision_shared). Paste in one go; it ends by taking 0473 off the ledger. Owner's approval per the release rules.
-- Limits (also in 0473's header): settle keys are lost; comments stay; counted rate-limit rows age out.
set lock_timeout = '5s';
begin;

-- course
create or replace function public.course_students()
returns table (customer_id uuid, name text, email text, user_id uuid, source text, granted_at timestamptz, revoked_at timestamptz,
               order_id uuid, paid_cents int, note text, done int, total int, rookie_done int, rookie_total int, last_done_at timestamptz)
language sql stable security definer set search_path = public as $$
  with live as (
    select l.id, l.tier from public.primal_lessons l
     where l.published_at is not null and l.archived_at is null and l.tenant_id = public.effective_tenant()
  )
  select pa.customer_id, c.name, c.email, c.user_id, pa.source, pa.granted_at, pa.revoked_at, pa.order_id,
         (select o.total_cents from public.shop_orders o where o.id = pa.order_id),
         pa.note,
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed'),
         (select count(*)::int from live),
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed' and live.tier = 'rookie'),
         (select count(*)::int from live where live.tier = 'rookie'),
         (select max(p.completed_at) from public.primal_progress p where p.customer_id = pa.customer_id and p.status = 'completed')
    from public.program_access pa
    join public.customers c on c.id = pa.customer_id
   where pa.tier = 'pro' and pa.tenant_id = public.effective_tenant() and (select public.is_staff())
   order by pa.granted_at desc;
$$;
revoke all on function public.course_students() from public, anon, authenticated;
grant execute on function public.course_students() to authenticated;
drop function if exists public.course_status(uuid);

-- program_access (0271)
drop policy if exists "access own or admin read" on public.program_access;
drop policy if exists "access owner read" on public.program_access;
create policy "access owner read" on public.program_access for select
  using ((select public.is_staff()) or exists (
    select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())));
drop policy if exists "access staff manage" on public.program_access;
create policy "access staff manage" on public.program_access for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- shop orders (0271)
drop policy if exists "shop orders staff manage" on public.shop_orders;
create policy "shop orders staff manage" on public.shop_orders for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "shop items staff manage" on public.shop_order_items;
create policy "shop items staff manage" on public.shop_order_items for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "fulfillments staff read" on public.merch_fulfillments;
drop policy if exists "fulfillments staff" on public.merch_fulfillments;
create policy "fulfillments staff" on public.merch_fulfillments for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- set_shop_order_status (0417)
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

-- research (0462)
create or replace function public.std_research_settle(p_run uuid, p_usage jsonb, p_cost_cents numeric, p_outcome text, p_error text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare r public.std_research_runs; v_complete boolean; v_charge numeric;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Only an owner or admin settles research.' using errcode = 'PT403'; end if;
  select * into r from public.std_research_runs where id = p_run and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'No such run.' using errcode = 'PT404'; end if;
  if r.outcome <> 'running' then raise exception 'This run is already settled.' using errcode = 'PT409'; end if;
  if p_outcome not in ('done','failed','timed_out','cancelled') then raise exception 'An outcome is done, failed, timed_out or cancelled.' using errcode = 'PT422'; end if;
  v_complete := p_usage is not null and p_cost_cents is not null and p_cost_cents >= 0
    and (select bool_and(p_usage ? k and jsonb_typeof(p_usage -> k) = 'number') from unnest(array['searches','fetches','input_tokens','output_tokens']) k);
  -- Complete: charged what it cost, even past its reservation (an overrun is shown, never hidden, and counts today).
  v_charge := case when v_complete then p_cost_cents else r.reserved_cents end;
  update public.std_research_runs set
    searches = (p_usage ->> 'searches')::int, fetches = (p_usage ->> 'fetches')::int,
    input_tokens = (p_usage ->> 'input_tokens')::int, output_tokens = (p_usage ->> 'output_tokens')::int,
    cache_write_tokens = (p_usage ->> 'cache_write_tokens')::int, cache_read_tokens = (p_usage ->> 'cache_read_tokens')::int,
    charged_cents = v_charge, outcome = case when v_complete then p_outcome else 'unreported' end,
    error = left(p_error, 500), settled_at = now()
  where id = p_run;
  return v_charge;
end $$;
revoke all on function public.std_research_settle(uuid, jsonb, numeric, text, text) from public, anon, authenticated;
grant execute on function public.std_research_settle(uuid, jsonb, numeric, text, text) to authenticated;
drop function if exists public.std_research_settle_server(uuid, uuid, jsonb, numeric, text, text, uuid);
alter table public.std_research_runs drop column if exists settle_key;

-- the link's door (0472)
create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  select * into s from public.vision_shares
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now()) and published is not null;
  if not found then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  perform set_config('gt3.share_open', 'on', true);
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  perform set_config('gt3.share_open', 'off', true);
  return public.vision_share_live(s);
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

delete from public.schema_migrations where version = '0473_a_course_and_a_research_bill_are_the_right_peoples';
commit;
reset lock_timeout;
