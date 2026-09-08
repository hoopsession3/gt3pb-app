-- 0317 — THE ROUTE SWEEP IS DONE; THE DOOR IS NOT OPEN (2026-09-08)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0305 installed a trigger that refuses to create a second tenant, and wrote the reason into the
-- error a person would see:
--
--     "62 service-role API reads still do not filter by tenant (risk R-002, remaining half). While
--      one tenant exists that is harmless; a second one makes every one of them a cross-tenant read."
--     hint: "Finish the route sweep (scripts/service-role.audit.mjs must report 0) …"
--
-- The sweep is finished. scripts/service-role.audit.mjs reports 0 across 0 routes, of 166 accesses:
--
--     43  filter by tenant_id                        21  proved inline with // scoped-by:
--     33  inserts, stamped by 0134's trigger          5  scoped to the caller's own rows
--     27  on global tables with no tenant             4  in declared-exempt routes
--
-- So the message is now false in a way that matters: it tells whoever hits it to go and do work that
-- is already done, and it names a number that has been zero for two commits.
--
-- ── WHY THE GUARD STAYS ────────────────────────────────────────────────────────────────────────
-- The obvious move is to drop the trigger. That would be wrong, and finding out why is the whole
-- value of this migration.
--
-- Four paths have no session and can never have one: two Apliiq webhooks (HMAC-signed by Apliiq) and
-- two guest checkouts (a guest has no bearer). They are now scoped — but scoped to
-- lib/tenantScope.integrationTenant(), a single constant, because a shared secret belongs to ONE
-- integration and there is one Square account, one Apliiq account, one storefront.
--
-- Which means: create a second tenant today and its guests would be sold the FOUNDING tenant's
-- products, and Apliiq's webhooks would ship against the founding tenant's orders. Not a
-- cross-tenant READ any more — a cross-tenant SALE, which is worse.
--
-- The blocker moved rather than cleared. So the guard stays and says what is actually left, which
-- is a smaller and more specific job than the one it used to describe: per-tenant provider
-- credentials, and a storefront that knows which market it is.
--
-- changelog: covered below.

create or replace function public.guard_second_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.tenants;
  if n >= 1 and coalesce(current_setting('gt3.allow_second_tenant', true), 'off') <> 'on' then
    raise exception using
      errcode = 'raise_exception',
      message = 'A second tenant cannot be created yet.',
      detail  = 'The R-002 route sweep IS finished — service-role.audit.mjs reports 0 unscoped '
                || 'reads. What blocks a second market now is narrower: the four paths that have no '
                || 'session (two Apliiq webhooks, two guest checkouts) are scoped to ONE constant, '
                || 'lib/tenantScope.integrationTenant(), because this deployment has one Square '
                || 'account, one Apliiq account and one storefront. Create a second tenant today '
                || 'and its guests would be sold the founding tenant''s products.',
      hint    = 'Give the second market its own provider credentials and set '
                || 'GT3_INTEGRATION_TENANT_ID per deployment, then make the storefront resolve its '
                || 'own tenant instead of the constant. To create one deliberately anyway: begin; '
                || 'set local gt3.allow_second_tenant = ''on''; <insert>; commit;';
  end if;
  return new;
end $$;

comment on function public.guard_second_tenant() is
  'Refuses a second tenant while the app cannot serve one safely. 0305 raised it for 62 unscoped service-role reads; 0317 rewrote the reason after the sweep reached 0 — what remains is that guest checkout and the provider webhooks resolve their tenant from one constant, so a second market would sell the first market''s products.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Every server read now names which business it belongs to','improvement','Settings',
   'The app talks to the database two ways: as you, where the database itself enforces what you may see, and as the server, where it does not. Sixty-two server reads never said which business they were for — harmless with one, and the reason the app refused to let you open a second market. All sixty-two are now either filtered, proven to be about a single row that could only be yours, or written down with the reason. What still stands between you and a second city is smaller and more specific: one Square account, one Apliiq account and one storefront, all pointing at this one. The app now says exactly that if you try, instead of pointing at work that is already finished.',
   '2026-09-08', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0317_the_route_sweep_is_done_the_door_is_not_open',
  'R-002 route sweep reached 0 unscoped service-role reads; 0305''s guard message rewritten to name what actually blocks a second market now — the single-constant integration tenant — rather than a route sweep that is finished.');

-- verify:
--   select public.record_migration is not null;
--   begin; insert into public.tenants (name) values ('probe'); rollback;   -- expect the new message
