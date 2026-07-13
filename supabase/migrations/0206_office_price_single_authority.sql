-- 0206 — One office price authority. Office per-gallon price had a three-way split: the code constant
-- (lib/office.ts), the owner override (live_status.office_price_cents, 0189), and a hardcoded 4500 in
-- the standing-order generator (0188). So an owner price change flowed to one-off office orders but NOT
-- to standing/recurring ones — the generator kept billing $45 forever. This makes
-- live_status.office_price_cents the single source: the generator reads it (falling back to 4500 only
-- if the singleton is somehow unset). Pairs with the client fix (OfficeOrder now records the same
-- override it charges). Function replacement only — no schema change. Idempotent.

create or replace function public.generate_office_route(p_date date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0; a record; ppg int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(office_price_cents, 4500) into ppg from public.live_status where id = 1;
  ppg := coalesce(ppg, 4500);   -- singleton missing → code fallback
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
        a.standing_gallons, ppg, (a.standing_gallons * ppg)::int, 0, 0, (a.standing_gallons * ppg)::int,
        a.billing_terms, true
      );
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

grant execute on function public.generate_office_route(date) to authenticated;

-- verify:
--   select prosrc like '%office_price_cents%' as reads_authority from pg_proc where proname = 'generate_office_route'; -- true
