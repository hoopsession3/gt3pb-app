-- 0305 — R-002 cannot bite while there is one tenant. So make the second one wait for the sweep.
--
-- WHERE R-002 ACTUALLY STANDS. The DB half closed in 0134: every tenant_id table carries a
-- stamp_tenant() trigger and a restrictive policy. The remaining half is 62 supabaseAdmin reads
-- across 31 API routes that do not filter by tenant. The service role bypasses RLS, so on those
-- reads tenancy is enforced by the app — and today it isn't.
--
-- WHAT THAT IS WORTH RIGHT NOW. This database holds exactly ONE tenant. A read that fails to filter
-- by tenant returns that tenant's rows to that tenant's own staff. There is no second party for the
-- data to leak to. Every one of the 62 is latent: real, and not yet reachable.
--
-- SO THE CHEAPEST HONEST FIX IS NOT 31 EDITS TONIGHT. It is to stop the condition that turns them
-- into a breach from arriving unnoticed. Creating tenant number two is a deliberate act — onboarding
-- another operator, splitting a city into its own books — and it is exactly the moment those 62
-- reads stop being latent and start being cross-tenant. That moment should be a decision, not a
-- surprise, so this refuses the insert and says why.
--
-- The escape hatch is the house idiom (gt3.allow_hard_delete, 0119): set the GUC in the same
-- transaction and the insert goes through. It exists so the sweep's own tests can create a second
-- tenant, and so the day the sweep IS done, unblocking takes one line rather than a migration.
--
--   begin;
--     set local gt3.allow_second_tenant = 'on';
--     insert into public.tenants ...;
--   commit;
--
-- The route sweep stays open in the risk register. This does not close R-002; it holds the door
-- shut while it is open, which nothing did before.

create or replace function public.guard_second_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.tenants;
  if n >= 1 and coalesce(current_setting('gt3.allow_second_tenant', true), 'off') <> 'on' then
    raise exception using
      errcode = 'raise_exception',
      message = 'A second tenant cannot be created yet.',
      detail  = format('%s service-role API reads still do not filter by tenant (risk R-002, '
                       || 'remaining half). While one tenant exists that is harmless; a second one '
                       || 'makes every one of them a cross-tenant read.', 62),
      hint    = 'Finish the route sweep (scripts/service-role.audit.mjs must report 0), or, to '
                || 'create it deliberately anyway: begin; set local gt3.allow_second_tenant = ''on''; '
                || '<insert>; commit;';
  end if;
  return new;
end $$;

drop trigger if exists guard_second_tenant_tg on public.tenants;
create trigger guard_second_tenant_tg before insert on public.tenants
  for each row execute function public.guard_second_tenant();

comment on function public.guard_second_tenant() is
  'Refuses a second tenant while the service-role route sweep (R-002) is unfinished, because that is the exact moment 62 unscoped reads stop being latent. Bypass in one transaction with gt3.allow_second_tenant, the same shape as gt3.allow_hard_delete.';

-- ── two of the three unclassified shelf items ──────────────────────────────────────────────────
-- 0295 gave every inventory item a kind and backfilled 46 of 49 from the existing category. Three
-- were left. Two of them are plain once you read the name; the third is not an inventory item at
-- all and is left alone on purpose.
update public.inventory_items set kind = 'equipment'
 where kind is null and name = 'EVEBOT Handheld Inkjet Printer';

update public.inventory_items set kind = 'packaging'
 where kind is null and name = 'UVDTF bottle labels (Jiffy Land)';

-- NOT TOUCHED: 'Site plans - Webflow Business Hosting Plan'. It is a monthly software subscription
-- sitting on the shelf, and none of the four kinds fit — it is not an ingredient, a consumable, a
-- piece of equipment or packaging, because it is not a thing you can hold or count. Giving it a
-- kind to clear the gap would be filing a recurring expense as stock, which is how a shelf starts
-- lying. It stays flagged until an owner decides whether it becomes a fifth kind ('service') or
-- comes off the shelf and lives only as an expense line.

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A second city''s books cannot open before the last security sweep is done','improvement','System',
   'Some parts of the app read the database with a key that ignores the per-tenant boundary, and 62 of those reads do not yet filter by which business they belong to. With one business in the system that is harmless — the rows come back to the people who own them. The day a second one is added it stops being harmless, all at once. Creating that second business is now refused, with an explanation of what has to be finished first, so the change lands as a decision instead of a surprise. Two shelf items that never got classified are also sorted; the third is a software subscription filed as stock and is left flagged rather than mislabelled.',
   '2026-09-07', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0305_second_tenant_guard',
  'Holds R-002 shut at the door while the 62-read route sweep is outstanding.');

-- verify:
--   select * from public.v_item_kind_gaps;            -- expect 1 (the Webflow plan, on purpose)
--   insert into public.tenants (id) values (gen_random_uuid());   -- expect the refusal
