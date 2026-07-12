-- 0188 — Phase 2: the standing-order generator. For every business_account with a standing weekly
-- order, emit the next Monday's business_order (idempotent — skips one already booked for that date).
-- Staff-invoked (a crew "Generate this week's office route" button); a cron can call it later with the
-- same signature. Security definer so it can read every standing account regardless of the caller's RLS.

create or replace function public.generate_office_route(p_date date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0; a record;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  for a in
    select * from public.business_accounts
     where standing_active and standing_gallons is not null and standing_gallons >= 3
  loop
    if not exists (
      select 1 from public.business_orders
       where business_id = a.id and delivery_date = p_date and canceled_at is null
    ) then
      insert into public.business_orders (
        business_id, user_id, company, contact_name, contact_phone,
        address_street, address_city, address_zip, delivery_date, delivery_window,
        gallons, price_per_gallon_cents, subtotal_cents, delivery_fee_cents, tax_cents, total_cents,
        billing_terms, standing
      ) values (
        a.id, a.user_id, a.company, a.contact_name, a.contact_phone,
        coalesce(a.address_street, ''), coalesce(a.address_city, ''), coalesce(a.address_zip, ''),
        p_date, a.preferred_window,
        a.standing_gallons, 4500, (a.standing_gallons * 4500)::int, 0, 0, (a.standing_gallons * 4500)::int,
        a.billing_terms, true
      );
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

grant execute on function public.generate_office_route(date) to authenticated;

-- verify:
-- select public.generate_office_route(current_date + ((1 - extract(dow from current_date)::int + 7) % 7 + 7) % 7);
