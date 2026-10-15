-- ── 0408 — AN 86 IS FOR ONE CITY ──────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-15. Release 3 of the Today, Command, Audit & Catalog audit, "an 86 for one city" — the fourth of the crew's
-- database rules, one yes and one migration each. Ryan, 2026-10-15: "Pass: its city. Catalog: all" — an 86 at one truck
-- takes the item off that city's menu; an owner can still 86 everywhere from the Catalog. Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing.
--
-- WHY. Products have no city (0129: products.sold_out), so an 86 at one truck took the item off every city's menu — the
-- day a second city pours, Greenville running out of oat milk would sell Atlanta out of every oat drink.
--
-- WHAT.
--   · product_86 — an item sold out in one city: the product, the city, when, and who. Read wherever its product is
--     (a guest's menu says SOLD OUT from it; another tenant's product is another tenant's). Written only by set_eighty_six.
--   · set_eighty_six(product, city, out) — anyone on the crew, as the Pass's 86 board always was (0351), for their own
--     tenant's products.
--   · the change log (0260) has each city's 86 too, in the shape the product's page reads its 86s back in — who, when,
--     where — so the Catalog's history of a drink keeps the Pass's 86s, as it did when every 86 was products.sold_out.
--   · products.sold_out stays what it was: sold out everywhere — the Catalog's switch.
--   · check_order_availability() — the database's own refusal of an 86'd drink at the order (0129), for the order's
--     city as well: the stop's, else the event's, else the founding city (lib/markets' rule for a row with none).
--   · reset_daily_86s() — 0130's 4 am reset clears the cities' 86s with the rest.
--   · product_86 joins the realtime publication, as products did (0370): an 86 flipped mid-rush reaches every open menu.
--
-- changelog: below.

create table if not exists public.product_86 (
  product_id  uuid not null references public.products(id) on delete cascade,
  market      text not null references public.markets(slug) on delete cascade,
  sold_out_at timestamptz not null default now(),
  sold_out_by uuid references public.profiles(id) on delete set null,
  primary key (product_id, market)
);
alter table public.product_86 enable row level security;
drop policy if exists "product 86 read" on public.product_86;
create policy "product 86 read" on public.product_86 for select
  using (exists (select 1 from public.products p where p.id = product_86.product_id));
-- As readable as its product's sold_out, and in the same way (0129 left sold_out_by beside it on products): the row is
-- seen wherever the product is — products' own policies, its tenant's isolation (0134) among them, decide — so a guest's
-- menu says SOLD OUT from it, and realtime, which reads a changed row as the subscriber, can send it.
revoke all on public.product_86 from public, anon, authenticated;
grant select on public.product_86 to anon, authenticated;
comment on table public.product_86 is
  'An item sold out in one city (0408), from the Pass''s 86 board: the city''s menu, drink sheet and checkout refuse it there, and the 4 am reset clears it. products.sold_out is sold out in every city — the Catalog''s switch. Written only by set_eighty_six.';

create or replace function public.set_eighty_six(p_product uuid, p_market text, p_out boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = '42501', detail = 'An 86 is the crew''s.';
  end if;
  if not exists (select 1 from public.markets where slug = p_market) then
    return jsonb_build_object('ok', false, 'code', 'no_market', 'words', 'That city is not one of ours.');
  end if;
  -- The caller's own tenant's products only: this runs as the definer, past products' tenant isolation (0134).
  if not exists (select 1 from public.products where id = p_product and tenant_id = public.effective_tenant()) then
    return jsonb_build_object('ok', false, 'code', 'no_product', 'words', 'That item is no longer in the Catalog.');
  end if;
  if p_out then
    insert into public.product_86 (product_id, market, sold_out_by) values (p_product, p_market, auth.uid())
    on conflict (product_id, market) do nothing;
  else
    delete from public.product_86 where product_id = p_product and market = p_market;
  end if;
  return jsonb_build_object('ok', true, 'out', p_out, 'market', p_market);
end $$;
comment on function public.set_eighty_six(uuid, text, boolean) is
  'The Pass''s 86 for one city (0408): sold out there, or back on there. Anyone on the crew.';
revoke all on function public.set_eighty_six(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_eighty_six(uuid, text, boolean) to authenticated;

-- 0129's guard, and the order's city's 86s with it. Its words are 0129's.
create or replace function public.check_order_availability() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  bad      text;
  v_market text;
begin
  v_market := coalesce(
    (select s.market from public.stops s where s.id = new.stop_id),
    (select f.market from public.field_ops f where f.id = coalesce(new.field_op_id, new.event_id)),
    'greenville');
  select string_agg(p.name, ' · ') into bad from public.products p
   where p.slug = any(new.items)
     and (p.sold_out or not p.active
          or exists (select 1 from public.product_86 e where e.product_id = p.id and e.market = v_market));
  if bad is not null then
    raise exception '% just sold out — remove it and try again.', bad;
  end if;
  return new;
end $$;
revoke all on function public.check_order_availability() from public, anon, authenticated;

-- 0130's 4 am reset, and the cities' 86s with it.
create or replace function public.reset_daily_86s() returns int
  language plpgsql security definer set search_path = public as $$
declare n int; m int;
begin
  update public.products set sold_out = false, sold_out_at = null, sold_out_by = null where sold_out;
  get diagnostics n = row_count;
  delete from public.product_86 where true;
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke all on function public.reset_daily_86s() from public, anon, authenticated;

-- The change log (0260) has every 86 the products table takes — the crew's, the Catalog's, the 4 am reset's — and a
-- product's page reads its 86s back from it (lib/catalog flipsFrom: the flag on each side of a line naming sold_out). A
-- city's 86 is a line there too, in that shape, with its city: the product, who (nobody, for the reset), on or off.
create or replace function public.log_city_86() returns trigger
  language plpgsql security definer set search_path = public as $$
declare r public.product_86;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row)
  values (auth.uid(), tg_op, 'product_86', r.product_id::text,
          format('sold_out: %s → %s · market: %s', (tg_op = 'DELETE')::text, (tg_op = 'INSERT')::text, r.market),
          jsonb_build_object('sold_out', tg_op = 'DELETE', 'market', r.market),
          jsonb_build_object('sold_out', tg_op = 'INSERT', 'market', r.market));
  return null;
end $$;
revoke all on function public.log_city_86() from public, anon, authenticated;
drop trigger if exists audit_product_86 on public.product_86;
create trigger audit_product_86 after insert or delete on public.product_86
  for each row execute function public.log_city_86();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_86') then
    alter publication supabase_realtime add table public.product_86;
  end if;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An 86 at the truck is for its own city', 'improvement', 'Service',
   'The 86 board under the Pass sells an item out in the truck''s own city only, so one city running out never empties another''s menu. The Catalog''s 86 is still every city. Both reset at 4 am.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select relrowsecurity from pg_class where oid = 'public.product_86'::regclass;                              -- true
--   select has_table_privilege('anon', 'public.product_86', 'insert');                                          -- false
--   select has_function_privilege('anon', 'public.set_eighty_six(uuid, text, boolean)', 'execute');             -- false
--   select count(*) from pg_trigger where tgname = 'audit_product_86';                                          -- 1
--   select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'product_86'; -- 1
select public.record_migration('0408_an_86_is_for_one_city');
