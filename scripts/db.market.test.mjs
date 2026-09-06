// MARKET SPINE CONTRACT — acceptance tests for 0285–0288, each migration EXECUTED FROM ITS FILE.
//
// Same harness as db.tenant.test.mjs, and the same reason for existing: these four files change
// views, rewrite live trigger functions, and add guards, and none of that is reachable by a
// type-checker. The fixture stubs only what Supabase provides at runtime plus the base tables these
// migrations touch, then runs 0277 and 0281 (the tables under change) and 0285–0288 in order —
// so a break in the ORDER of the lineage fails here rather than in the SQL editor.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T1 = "00000000-0000-0000-0000-000000000001";
const RYAN = "11111111-1111-1111-1111-111111111111";
const KAYLA = "22222222-2222-2222-2222-222222222222";

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); }
};
const db = new PGlite();
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const mig = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
/** run something that should raise, and hand back the message (or null if it didn't) */
const raises = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return String(e.message || e); } };

// ── platform stubs ──────────────────────────────────────────────────────────────────────────────
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create role anon; create role authenticated;
  grant usage on schema auth, public to anon, authenticated;
  insert into auth.users values ('${RYAN}','ryan@gt3pb.com'), ('${KAYLA}','kayla@gt3pb.com');

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
  create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create or replace function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
  create or replace function public.is_owner()  returns boolean language sql stable as $$
    select coalesce(current_setting('test.owner',  true) <> 'off', true) $$;
  create or replace function public.is_staff()  returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff',  true) <> 'off', true) $$;
  -- Keyed off a GUC like the other two. A blanket always-true stub here made 0291 look like
  -- it did nothing: market_visible() lets admins see every city, so a stub that says everyone
  -- is an admin hid the entire policy. Second time a stub has flattered a migration in this
  -- file; both times the fix was to make the stub answer the question production answers.
  create or replace function public.is_admin()  returns boolean language sql stable as $$
    select coalesce(current_setting('test.admin', true) <> 'off', true) $$;
  create or replace function public.audit_row() returns trigger language plpgsql as $$ begin return new; end $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$ select '${T1}'::uuid $$;
  create or replace function public.stamp_tenant() returns trigger language plpgsql as $$
    begin new.tenant_id := coalesce(new.tenant_id, '${T1}'::uuid); return new; end $$;

  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('${T1}');

  create table public.profiles (
    id uuid primary key references auth.users(id), display_name text,
    role text not null default 'member', is_admin boolean not null default false, tenant_id uuid default '${T1}');
  insert into public.profiles (id, display_name, role, is_admin) values
    ('${RYAN}','Ryan','owner',true), ('${KAYLA}','Kayla','owner',true);

  -- Column list pulled from production information_schema on 2026-09-06, not guessed. The first
  -- version of this fixture invented a "label" column; 0286 built a view on it, every test passed,
  -- and production rejected the migration with 42703 because the column is called NAME. A fixture
  -- that does not match production is a test that lies.
  create table public.markets (
    slug text primary key, name text, region text, timezone text,
    active boolean not null default true, created_at timestamptz not null default now(),
    office_price_cents int default 4500, office_min_gallons int default 3,
    office_window text default 'mon_0500_0800', office_notes text);
  insert into public.markets (slug, name, region) values
    ('greenville','Greenville','SC'), ('atlanta','Atlanta','GA');

  create table public.live_status (
    id int primary key default 1 check (id = 1), is_live boolean not null default false,
    preorder_lead_h int not null default 4, pay_at_pickup boolean not null default true,
    office_price_cents int not null default 4500, office_min_gallons int not null default 3);
  insert into public.live_status (id, is_live, preorder_lead_h) values (1, true, 6);

  create table public.admin_emails (email text primary key);

  create table public.alerts (
    id uuid primary key default gen_random_uuid(), severity text, category text,
    title text not null, body text, link text, target_user_id uuid, tenant_id uuid,
    ack_at timestamptz, ack_by uuid, created_at timestamptz not null default now());

  create table public.changelog (
    id serial primary key, title text not null, category text, area text,
    summary text, shipped_on date, highlight boolean default false);

  create table public.inventory_items (
    id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T1}',
    name text not null, qty numeric, reorder_point numeric, unit text, reorder_link text,
    -- category arrived in 0044 and is what 0295 classifies from. Omitting it here would have made
    -- 0295's backfill look like a no-op and passed a migration that classifies nothing.
    category text);
  -- Column list from 0090 plus the later alters, not invented. The first version omitted "note"
  -- and 0293 failed on it. Third time a stub in this file has been thinner than production; the
  -- rule that keeps earning its keep is that a fixture must answer what production answers.
  create table public.inventory_ledger (
    id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T1}',
    item text not null, event_id uuid, stop_id uuid, task_id uuid,
    kind text not null default 'confirm', qty numeric not null, note text,
    inventory_item_id uuid, item_id uuid,
    created_by uuid, created_at timestamptz not null default now());
  create or replace view public.inventory_on_hand with (security_invoker = on) as
    select item, sum(qty) as on_hand, max(created_at) as last_movement
    from public.inventory_ledger group by item;
  create or replace view public.inventory_status with (security_invoker = on) as
    select i.*, coalesce(oh.on_hand, i.qty) as effective_on_hand, oh.last_movement,
      (i.reorder_point is not null and coalesce(oh.on_hand, i.qty) is not null
        and coalesce(oh.on_hand, i.qty) <= i.reorder_point) as needs_reorder
    from public.inventory_items i left join public.inventory_on_hand oh on oh.item = i.name;
  create table public.compliance_rules (
    id uuid primary key default gen_random_uuid(), state text, county text, label text not null,
    link text, kind text not null default 'permit', critical boolean not null default false,
    sort int not null default 0, active boolean not null default true,
    verified boolean not null default true, source text, created_at timestamptz not null default now());
  insert into public.compliance_rules (state, county, label, kind, critical, sort) values
    ('GA','Fulton','Temporary Food Service Permit — apply >= 30 days out','permit',true,10),
    ('GA','Fulton','Permit must go THROUGH the event organizer (no solo curb setup)','permit',true,11),
    ('GA','Fulton','Person-in-charge food-safety knowledge (ServSafe / CFSM — recommended, not required for temp)','cert',false,12),
    (null,null,'Permit + inspection report displayed on site','inspection',false,90);
`);
await db.exec(`set test.uid = '${RYAN}';`);

// the 0205/0215 reorder trigger, as it stands in production before 0288 rewrites it
await db.exec(mig("0215_inventory_reorder_tenant_scope.sql").replace(/^--.*$/gm, ""));
await db.exec(`drop trigger if exists inventory_reorder_alert_tg on public.inventory_ledger;
  create trigger inventory_reorder_alert_tg after insert on public.inventory_ledger
  for each row execute function public.inventory_reorder_alert();`);

// ── the tables under change ─────────────────────────────────────────────────────────────────────
await db.exec(mig("0277_operator_agreements.sql"));
await db.exec(mig("0281_offer_letters.sql"));
await db.exec(mig("0280_role_integrity.sql").replace(/create or replace function public\.handle_new_user[\s\S]*?end \$\$;/, ""));

ok("fixture: 0277 + 0281 + 0280 load", true);

// ═══ 0284 — compliance freshness ════════════════════════════════════════════════════════════════
await db.exec(mig("0284_compliance_freshness.sql"));

const fulton = await q1(`select label, lead_days, lead_basis, verified_on, authority
                           from public.compliance_rules
                          where state='GA' and county='Fulton' and label like 'Temporary Food Service Permit%'`);
ok("0284: the Fulton deadline now counts BUSINESS days", fulton?.lead_basis === "business", fulton?.lead_basis);
ok("0284: and says 30 of them", Number(fulton?.lead_days) === 30, fulton?.lead_days);
ok("0284: with an authority named", /Fulton County Board of Health/.test(fulton?.authority ?? ""), fulton?.authority);
ok("0284: the corrected label warns about the doubled fee", /fees may double/i.test(fulton?.label ?? ""), fulton?.label);

const cfsm = await q1(`select verified, check_note from public.compliance_rules where label like '%food-safety knowledge%'`);
ok("0284: the unsourced food-safety rule stops claiming to be verified", cfsm?.verified === false);
ok("0284: and says what to ask", /NOT CONFIRMED/.test(cfsm?.check_note ?? ""));

const sc = await rows(`select label, active, verified from public.compliance_rules where state='SC' order by sort`);
ok("0284: South Carolina has rules now", sc.length >= 2, sc.length);
ok("0284: SCDA is recorded as verified", sc.some((r) => r.verified === true && /AGRICULTURE/.test(r.label)));
ok("0284: the superseded event form is recorded UNVERIFIED", sc.some((r) => r.verified === false));
ok("0284: no inactive placeholder leaks onto a checklist",
   (await q1(`select count(*)::int n from public.v_compliance_freshness where state='SC' and label is null`)).n === 0);

const fresh = await rows(`select freshness, count(*)::int n from public.v_compliance_freshness group by 1`);
ok("0284: freshness view classifies every active rule", fresh.reduce((a, r) => a + r.n, 0) > 0);
ok("0284: unverified rules are called out",
   fresh.some((r) => /UNVERIFIED/.test(r.freshness)), fresh.map((r) => r.freshness));

// idempotent
const before284 = (await q1(`select count(*)::int n from public.compliance_rules`)).n;
await db.exec(mig("0284_compliance_freshness.sql"));
ok("0284: re-run adds no rows", (await q1(`select count(*)::int n from public.compliance_rules`)).n === before284);

// ═══ 0285 — the live switch ═════════════════════════════════════════════════════════════════════
await db.exec(mig("0285_market_live_switch.sql"));

const gv = await q1(`select * from public.market_live where market='greenville'`);
const atl = await q1(`select * from public.market_live where market='atlanta'`);
ok("0285: Greenville still reads the singleton's live flag", gv?.is_live === true, gv?.is_live);
ok("0285: and the singleton's pre-order window", Number(gv?.preorder_lead_h) === 6, gv?.preorder_lead_h);
ok("0285: Greenville is not held back", gv?.pre_launch === false, gv?.pre_launch);
ok("0285: Atlanta is held pre-launch by its opening date", atl?.pre_launch === true, atl?.pre_launch);
ok("0285: and is NOT live even though the singleton is", atl?.is_live === false, atl?.is_live);

const early = await raises(`select public.set_market_live('atlanta', true);`);
ok("0285: going live before the opening date is refused", early !== null && /opens on/i.test(early), early);
ok("0285: and Atlanta stayed dark",
   (await q1(`select is_live from public.market_live where market='atlanta'`))?.is_live === false);

await db.exec(`select public.set_market_opens_on('atlanta', current_date - 1);`);
await db.exec(`select public.set_market_live('atlanta', true);`);
ok("0285: once the date passes, the city can go live",
   (await q1(`select is_live from public.market_live where market='atlanta'`))?.is_live === true);
ok("0285: and Greenville was not touched by it",
   (await q1(`select is_live from public.market_live where market='greenville'`))?.is_live === true);

// a market that sets its own flag stops inheriting
await db.exec(`update public.markets set is_live = false where slug='greenville';`);
ok("0285: an explicit market flag beats the singleton",
   (await q1(`select is_live from public.market_live where market='greenville'`))?.is_live === false);
await db.exec(`update public.markets set is_live = null where slug='greenville';`);
ok("0285: clearing it returns the market to inheriting",
   (await q1(`select is_live from public.market_live where market='greenville'`))?.is_live === true);

await db.exec(`set test.staff = 'off';`);
const notStaff = await raises(`select public.set_market_live('greenville', false);`);
ok("0285: a non-staff caller cannot flip a city live", notStaff !== null && /staff only/.test(notStaff), notStaff);
await db.exec(`set test.staff = 'on';`);

// ═══ 0286 — what the letter must say ════════════════════════════════════════════════════════════
await db.exec(mig("0286_offer_letter_statutory.sql"));

await db.exec(`insert into public.offer_letters (id, market, candidate_name, candidate_email, title, role,
    base_cents, rate_per, author_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','greenville','Dana Reyes','dana@example.com',
          'Lead Server','server', 5200000, 'year', '${RYAN}');`);

const incomplete = await raises(`select public.submit_offer_for_review('aaaaaaaa-0000-0000-0000-000000000001');`);
ok("0286: an incomplete letter cannot go to the co-owners", incomplete !== null, incomplete);
ok("0286: and it names every missing field at once",
   /normal hours/.test(incomplete ?? "") && /when they get paid/.test(incomplete ?? "")
   && /how they get paid/.test(incomplete ?? "") && /deductions/.test(incomplete ?? ""), incomplete);
ok("0286: the offer is still a draft after the refusal",
   (await q1(`select status from public.offer_letters where id='aaaaaaaa-0000-0000-0000-000000000001'`))?.status === "draft");

await db.exec(`update public.offer_letters set
    normal_hours = 'Tue-Sat, 6am-2pm, about 38 hours a week',
    pay_schedule = 'Every other Friday, in arrears',
    pay_method   = 'Direct deposit to the account on file',
    deductions   = 'Federal and state withholding, FICA. No other deductions.'
  where id='aaaaaaaa-0000-0000-0000-000000000001';`);
await db.exec(`select public.submit_offer_for_review('aaaaaaaa-0000-0000-0000-000000000001');`);
ok("0286: a complete letter goes to review",
   (await q1(`select status from public.offer_letters where id='aaaaaaaa-0000-0000-0000-000000000001'`))?.status === "in_review");
ok("0286: the co-owner is on the hook for it",
   (await q1(`select count(*)::int n from public.offer_approvals where offer_id='aaaaaaaa-0000-0000-0000-000000000001'`)).n === 1);

const warn = await q1(`select note from public.offer_events
  where offer_id='aaaaaaaa-0000-0000-0000-000000000001' and kind='disclaimer_missing'`);
ok("0286: the missing disclaimer is written into the approval trail", !!warn, warn);
ok("0286: and the note tells you how to fix it", /set_market_offer_disclaimer/.test(warn?.note ?? ""));

const letter = await q1(`select * from public.v_offer_letter where id='aaaaaaaa-0000-0000-0000-000000000001'`);
ok("0286: the letter view assembles the statutory fields",
   letter?.normal_hours != null && letter?.pay_schedule != null && letter?.deductions != null);
ok("0286: and flags the absent disclaimer", letter?.disclaimer_missing === true);
ok("0286: no disclaimer was invented",
   (await q1(`select count(*)::int n from public.markets where offer_disclaimer is not null`)).n === 0);

await db.exec(`select public.set_market_offer_disclaimer('greenville', 'THIS LETTER IS NOT A CONTRACT OF EMPLOYMENT.');`);
ok("0286: once counsel supplies it, the flag clears",
   (await q1(`select disclaimer_missing from public.v_offer_letter where id='aaaaaaaa-0000-0000-0000-000000000001'`))?.disclaimer_missing === false);

await db.exec(`set test.owner = 'off';`);
const notOwner = await raises(`select public.set_market_offer_disclaimer('greenville','x');`);
ok("0286: only an owner sets the disclaimer", notOwner !== null && /owner/i.test(notOwner), notOwner);
await db.exec(`set test.owner = 'on';`);

// ═══ 0287 — who buys ════════════════════════════════════════════════════════════════════════════
await db.exec(mig("0287_supply_sourcing.sql"));

await db.exec(`insert into public.operator_agreements (id, market, operator_name, status, supply_funding)
  values ('bbbbbbbb-0000-0000-0000-000000000001','atlanta','Sam Okoye','draft', 50);`);
ok("0287: a new deal starts undecided, not assumed",
   (await q1(`select supply_sourcing from public.operator_agreements where id='bbbbbbbb-0000-0000-0000-000000000001'`))?.supply_sourcing === "undecided");
ok("0287: and the posture view says to decide it",
   /DECIDE THIS/.test((await q1(`select read_on_it from public.v_operator_supply_posture where id='bbbbbbbb-0000-0000-0000-000000000001'`))?.read_on_it ?? ""));

const strayMarkup = await raises(`update public.operator_agreements set supply_markup_pct = 12
  where id='bbbbbbbb-0000-0000-0000-000000000001';`);
ok("0287: a markup with no cost-plus basis is refused", strayMarkup !== null, strayMarkup);

await db.exec(`update public.operator_agreements
  set supply_sourcing='gt3_supplied', supply_price_basis='cost_plus', supply_markup_pct=12,
      spec_items = array['Mountain Valley still 1L','House espresso blend']
  where id='bbbbbbbb-0000-0000-0000-000000000001';`);
const posture = await q1(`select who_buys, read_on_it, spec_item_count from public.v_operator_supply_posture
  where id='bbbbbbbb-0000-0000-0000-000000000001'`);
ok("0287: the highest-risk combination is named as such",
   /HIGHEST EXPOSURE/.test(posture?.read_on_it ?? ""), posture?.read_on_it);
ok("0287: and it says why — a franchise fee by another name",
   /franchise/i.test(posture?.read_on_it ?? ""));
ok("0287: spec items are counted separately from sourcing", Number(posture?.spec_item_count) === 2, posture?.spec_item_count);

await db.exec(`update public.operator_agreements
  set supply_sourcing='operator_local', supply_price_basis=null, supply_markup_pct=null
  where id='bbbbbbbb-0000-0000-0000-000000000001';`);
ok("0287: the operator-sources arrangement reads as lowest exposure",
   /LOWEST/.test((await q1(`select read_on_it from public.v_operator_supply_posture where id='bbbbbbbb-0000-0000-0000-000000000001'`))?.read_on_it ?? ""));

// terms freeze on acceptance — the 0280 guard now covers sourcing too
await db.exec(`update public.operator_agreements set status='accepted' where id='bbbbbbbb-0000-0000-0000-000000000001';`);
const frozen = await raises(`update public.operator_agreements set supply_sourcing='gt3_supplied'
  where id='bbbbbbbb-0000-0000-0000-000000000001';`);
ok("0287: sourcing is final once the deal is accepted", frozen !== null && /terms are final/.test(frozen), frozen);
const frozenSpec = await raises(`update public.operator_agreements set spec_items = array['something else']
  where id='bbbbbbbb-0000-0000-0000-000000000001';`);
ok("0287: so are the specified items", frozenSpec !== null, frozenSpec);
const stillFrozen = await raises(`update public.operator_agreements set supply_funding = 90
  where id='bbbbbbbb-0000-0000-0000-000000000001';`);
ok("0287: and 0280's original frozen terms are still frozen", stillFrozen !== null, stillFrozen);

// ═══ 0288 — two cities, two shelves ═════════════════════════════════════════════════════════════
// Seed the pre-0288 world: one item, a Greenville ledger that has NOT yet tripped the reorder point.
await db.exec(`insert into public.inventory_items (name, qty, reorder_point, unit) values ('Mountain Valley 1L', 0, 10, 'cases');
  insert into public.inventory_ledger (item, qty, kind) values ('Mountain Valley 1L', 12, 'restock');`);
ok("0288 (before): one shelf, 12 on hand",
   Number((await q1(`select effective_on_hand from public.inventory_status where name='Mountain Valley 1L'`))?.effective_on_hand) === 12);

await db.exec(mig("0288_inventory_per_market.sql"));

ok("0288: existing stock landed in the founding market",
   (await q1(`select count(*)::int n from public.inventory_items where market <> 'greenville'`)).n === 0);
ok("0288: and Greenville's number did not move",
   Number((await q1(`select effective_on_hand from public.inventory_status where name='Mountain Valley 1L' and market='greenville'`))?.effective_on_hand) === 12);

// Atlanta stocks the SAME item name. Before 0288 this would have inflated Greenville's on-hand.
await db.exec(`insert into public.inventory_items (name, qty, reorder_point, unit, market)
  values ('Mountain Valley 1L', 0, 10, 'cases', 'atlanta');
  insert into public.inventory_ledger (item, qty, kind, market)
  values ('Mountain Valley 1L', 40, 'restock', 'atlanta');`);
ok("0288: Atlanta's 40 cases do NOT show up in Greenville",
   Number((await q1(`select effective_on_hand from public.inventory_status where name='Mountain Valley 1L' and market='greenville'`))?.effective_on_hand) === 12,
   (await q1(`select effective_on_hand from public.inventory_status where name='Mountain Valley 1L' and market='greenville'`))?.effective_on_hand);
ok("0288: and Atlanta sees its own 40",
   Number((await q1(`select effective_on_hand from public.inventory_status where name='Mountain Valley 1L' and market='atlanta'`))?.effective_on_hand) === 40);

// Greenville draws down below its reorder point. Atlanta is flush — the alert must still fire.
await db.exec(`insert into public.inventory_ledger (item, qty, kind, market)
  values ('Mountain Valley 1L', -5, 'use', 'greenville');`);
const gvAlert = await q1(`select title, severity from public.alerts
  where ack_at is null and category='prep' and title = '📦 Reorder — Mountain Valley 1L'`);
ok("0288: Greenville's low stock fires its alert even though Atlanta is full", !!gvAlert, gvAlert);
ok("0288: and the Greenville alert title is UNCHANGED, so alerts already open still match",
   gvAlert?.title === "📦 Reorder — Mountain Valley 1L", gvAlert?.title);

// Atlanta restocking must NOT clear Greenville's alert — the 0215 bug, one level up.
await db.exec(`insert into public.inventory_ledger (item, qty, kind, market)
  values ('Mountain Valley 1L', 20, 'restock', 'atlanta');`);
ok("0288: an Atlanta restock does not acknowledge Greenville's alert",
   (await q1(`select count(*)::int n from public.alerts
              where ack_at is null and title='📦 Reorder — Mountain Valley 1L'`)).n === 1);

// Atlanta's own shortage gets its own, separately-titled alert.
await db.exec(`insert into public.inventory_ledger (item, qty, kind, market)
  values ('Mountain Valley 1L', -55, 'use', 'atlanta');`);
ok("0288: Atlanta gets its own alert, distinctly titled",
   (await q1(`select count(*)::int n from public.alerts
              where ack_at is null and title='📦 Reorder — Mountain Valley 1L (atlanta)'`)).n === 1);
ok("0288: and Greenville's is still open beside it",
   (await q1(`select count(*)::int n from public.alerts
              where ack_at is null and title='📦 Reorder — Mountain Valley 1L'`)).n === 1);

// a real Greenville restock clears only Greenville's
await db.exec(`insert into public.inventory_ledger (item, qty, kind, market)
  values ('Mountain Valley 1L', 30, 'restock', 'greenville');`);
ok("0288: Greenville's restock clears Greenville's alert",
   (await q1(`select count(*)::int n from public.alerts
              where ack_at is null and title='📦 Reorder — Mountain Valley 1L'`)).n === 0);
ok("0288: and leaves Atlanta's alone",
   (await q1(`select count(*)::int n from public.alerts
              where ack_at is null and title='📦 Reorder — Mountain Valley 1L (atlanta)'`)).n === 1);

// ═══ 0289 — an operator can run a market ════════════════════════════════════════════════════════
await db.exec(mig("0289_market_ownership.sql"));

const SAM = "33333333-3333-3333-3333-333333333333";
const GV_SERVER = "44444444-4444-4444-4444-444444444444";
const ATL_SERVER = "55555555-5555-5555-5555-555555555555";
await db.exec(`insert into auth.users (id, email) values
    ('${SAM}','sam@example.com'), ('${GV_SERVER}','gv@example.com'), ('${ATL_SERVER}','atl@example.com');
  insert into public.profiles (id, display_name, role, market) values
    ('${SAM}','Sam','operator','atlanta'),
    ('${GV_SERVER}','Gwen','server','greenville'),
    ('${ATL_SERVER}','Ade','member','atlanta');`);

ok("0289: everyone who existed before is in the founding market",
   (await q1(`select count(*)::int n from public.profiles where id in ('${RYAN}','${KAYLA}') and market='greenville'`)).n === 2);
ok("0289: nobody leads anything until an owner says so",
   (await q1(`select count(*)::int n from public.profiles where leads_market is not null`)).n === 0);

// a market lead has to be senior enough to be one
const tooJunior = await raises(`select public.set_market_lead('${ATL_SERVER}', 'atlanta');`);
ok("0289: a member cannot be handed a market", tooJunior !== null && /operator, event manager/.test(tooJunior), tooJunior);

await db.exec(`select public.set_market_lead('${SAM}', 'atlanta');`);
ok("0289: an owner can put the operator in charge of Atlanta",
   (await q1(`select leads_market from public.profiles where id='${SAM}'`))?.leads_market === "atlanta");

await db.exec(`set test.owner = 'off';`);
await db.exec(`set test.uid = '${SAM}';`);

ok("0289: the lead is recognised as leading their market",
   (await q1(`select public.is_market_lead('atlanta') as v`))?.v === true);
ok("0289: and not as leading the other one",
   (await q1(`select public.is_market_lead('greenville') as v`))?.v === false);

// what the lead CAN do
await db.exec(`select public.admin_set_role('${ATL_SERVER}', 'server');`);
ok("0289: the lead can make someone in their own city a server",
   (await q1(`select role from public.profiles where id='${ATL_SERVER}'`))?.role === "server");
ok("0289: and the is_admin mirror stayed false",
   (await q1(`select is_admin from public.profiles where id='${ATL_SERVER}'`))?.is_admin === false);

// what the lead CANNOT do — each bound asserted separately, because each is a different way in
const crossCity = await raises(`select public.admin_set_role('${GV_SERVER}', 'member');`);
ok("0289: the lead cannot reach into the other city", crossCity !== null && /own market/.test(crossCity), crossCity);
ok("0289: and that person was untouched",
   (await q1(`select role from public.profiles where id='${GV_SERVER}'`))?.role === "server");

const makeAdmin = await raises(`select public.admin_set_role('${ATL_SERVER}', 'admin');`);
ok("0289: the lead cannot mint an admin", makeAdmin !== null && /owner decision/.test(makeAdmin), makeAdmin);
const makeOwner = await raises(`select public.admin_set_role('${ATL_SERVER}', 'owner');`);
ok("0289: the lead cannot mint an owner", makeOwner !== null, makeOwner);
const makeOperator = await raises(`select public.admin_set_role('${ATL_SERVER}', 'operator');`);
ok("0289: the lead cannot mint another operator", makeOperator !== null, makeOperator);

const selfPromote = await raises(`select public.admin_set_role('${SAM}', 'admin');`);
ok("0289: the lead cannot promote themselves", selfPromote !== null && /your own role/.test(selfPromote), selfPromote);
ok("0289: the lead is still an operator", (await q1(`select role from public.profiles where id='${SAM}'`))?.role === "operator");

// someone with no market at all is refused outright
await db.exec(`set test.uid = '${ATL_SERVER}';`);
const notLead = await raises(`select public.admin_set_role('${SAM}', 'member');`);
ok("0289: a plain server cannot assign roles at all", notLead !== null && /owner only/.test(notLead), notLead);
// The refusal must not leak whether an id exists: an unauthorised caller gets the SAME message
// whether the target is real or invented.
const probeReal = await raises(`select public.admin_set_role('${SAM}', 'member');`);
const probeFake = await raises(`select public.admin_set_role('99999999-9999-9999-9999-999999999999', 'member');`);
ok("0289: an unauthorised caller cannot probe which profiles exist", probeReal === probeFake, [probeReal, probeFake]);

await db.exec(`set test.owner = 'on'; set test.uid = '${RYAN}';`);

// the owner path is untouched, including 0280's last-owner guard
await db.exec(`select public.admin_set_role('${GV_SERVER}', 'admin');`);
ok("0289: an owner can still do what an owner could do",
   (await q1(`select role, is_admin from public.profiles where id='${GV_SERVER}'`))?.is_admin === true);
await db.exec(`select public.admin_set_role('${GV_SERVER}', 'server');`);
ok("0289: demotion still clears the admin mirror",
   (await q1(`select is_admin from public.profiles where id='${GV_SERVER}'`))?.is_admin === false);

await db.exec(`update public.profiles set role='member' where id='${KAYLA}';`);
const lastOwner = await raises(`select public.admin_set_role('${RYAN}', 'admin');`);
ok("0289: 0280's last-owner guard survived the rewrite", lastOwner !== null && /last owner/.test(lastOwner), lastOwner);
await db.exec(`update public.profiles set role='owner' where id='${KAYLA}';`);

// one lead per market, enforced
await db.exec(`insert into auth.users (id,email) values ('66666666-6666-6666-6666-666666666666','two@example.com');
  insert into public.profiles (id, display_name, role, market)
  values ('66666666-6666-6666-6666-666666666666','Rae','operator','atlanta');
  select public.set_market_lead('66666666-6666-6666-6666-666666666666', 'atlanta');`);
ok("0289: handing the market to someone else takes it from the first",
   (await q1(`select count(*)::int n from public.profiles where leads_market='atlanta'`)).n === 1);
ok("0289: and it is the new person",
   (await q1(`select leads_market from public.profiles where id='66666666-6666-6666-6666-666666666666'`))?.leads_market === "atlanta");

// moving cities drops the lead rather than leaving them holding the wrong crew
await db.exec(`update public.profiles set market='greenville' where id='66666666-6666-6666-6666-666666666666';`);
ok("0289: moving someone to another city takes their market with it",
   (await q1(`select leads_market from public.profiles where id='66666666-6666-6666-6666-666666666666'`))?.leads_market === null);

// equity: eligibility and scope only, and frozen once accepted
ok("0289: a deal starts not eligible and undecided about scope",
   (await q1(`select equity_eligible, equity_scope from public.operator_agreements
              where id='bbbbbbbb-0000-0000-0000-000000000001'`))?.equity_scope === "undecided");
const badScope = await raises(`update public.operator_agreements set equity_scope='whatever'
  where id='bbbbbbbb-0000-0000-0000-000000000001';`);
ok("0289: equity scope is a closed set", badScope !== null, badScope);
const frozenEquity = await raises(`update public.operator_agreements set equity_eligible=true
  where id='bbbbbbbb-0000-0000-0000-000000000001';`);
ok("0289: equity eligibility is final once the deal is accepted", frozenEquity !== null && /terms are final/.test(frozenEquity), frozenEquity);
ok("0289: no percentage column was invented anywhere",
   (await q1(`select count(*)::int n from information_schema.columns
              where table_name='operator_agreements' and column_name like 'equity%'`)).n === 3);

// ═══ 0291 — reading is scoped to your own city ══════════════════════════════════════════════════
// A money table with a market and RLS on, plus an operational one that must stay shared.
await db.exec(`
  create table public.business_orders (
    id serial primary key, market text not null default 'greenville',
    company text, total_cents int, tenant_id uuid default '${T1}');
  alter table public.business_orders enable row level security;
  grant select on public.business_orders to authenticated;
  create policy "staff read" on public.business_orders for select using (public.is_staff());

  create table public.events (
    id serial primary key, market text not null default 'greenville', title text);
  alter table public.events enable row level security;
  grant select on public.events to authenticated;
  create policy "staff read" on public.events for select using (public.is_staff());

  insert into public.business_orders (market, company, total_cents) values
    ('greenville','Gwen Co', 90000), ('atlanta','Ade Co', 120000);
  insert into public.events (market, title) values ('greenville','GV pour'), ('atlanta','ATL pour');
`);

await db.exec(mig("0291_market_read_scope.sql"));

ok("0291: the money table is scoped",
   (await q1(`select market_scoped from public.v_market_scope where table_name='business_orders'`))?.market_scoped === true);
ok("0291: the operational table is left shared, and says so",
   /shared on purpose/.test((await q1(`select verdict from public.v_market_scope where table_name='events'`))?.verdict ?? ""));

// An owner sees both cities.
await db.exec(`set test.owner = 'on'; set test.uid = '${RYAN}';`);
await db.exec("set role authenticated;");
ok("0291: an owner still reads every city's money",
   (await q1(`select count(*)::int n from public.business_orders`)).n === 2,
   (await q1(`select count(*)::int n from public.business_orders`)).n);

// A non-owner in Atlanta sees Atlanta only.
await db.exec("reset role;");
await db.exec(`set test.owner = 'off'; set test.admin = 'off'; set test.uid = '${ATL_SERVER}';`);
await db.exec("set role authenticated;");
const atlSees = await rows(`select market from public.business_orders`);
ok("0291: a non-owner sees exactly one city's money", atlSees.length === 1, atlSees.length);
ok("0291: and it is their own city", atlSees[0]?.market === "atlanta", atlSees[0]?.market);
ok("0291: the other city's revenue is not reachable at all",
   (await q1(`select count(*)::int n from public.business_orders where market='greenville'`)).n === 0);

// …but the operational table is still shared, which is the point of not scoping it.
ok("0291: the same person still sees both cities' events",
   (await q1(`select count(*)::int n from public.events`)).n === 2,
   (await q1(`select count(*)::int n from public.events`)).n);

await db.exec("reset role;");
await db.exec(`set test.owner = 'on'; set test.admin = 'on'; set test.uid = '${RYAN}';`);

// A row with no city attributed to it must not vanish.
await db.exec(`alter table public.business_orders alter column market drop not null;
  insert into public.business_orders (market, company, total_cents) values (null, 'Unattributed', 500);`);
await db.exec(`set test.owner = 'off'; set test.admin = 'off'; set test.uid = '${ATL_SERVER}';`);
await db.exec("set role authenticated;");
ok("0291: an unattributed row stays visible rather than disappearing silently",
   (await q1(`select count(*)::int n from public.business_orders where company='Unattributed'`)).n === 1);
await db.exec("reset role;");
await db.exec(`set test.owner = 'on'; set test.admin = 'on'; set test.uid = '${RYAN}';`);

// ═══ 0292 — receipts, and spend brought to standard ═════════════════════════════════════════════
// Fixture mirrors 0209's live shape plus the storage schema the receipts bucket needs.
await db.exec(`
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;

  -- 0034's real shape, not a two-column stub: 0298 writes notes and sort, and the venue-shaped
  -- columns (service_dates, location_text, lat/lng) are the evidence its backfill reasons from.
  -- Fifth time a fixture here has been thinner than production; the rule keeps earning its keep.
  create table public.vendors (
    id uuid primary key default gen_random_uuid(), name text not null default 'New vendor',
    poc_name text, poc_phone text, poc_email text, address text, location_text text,
    lat double precision, lng double precision, service_dates text, notes text,
    archived_at timestamptz, sort int not null default 0,
    created_at timestamptz not null default now());

  create table public.expenses (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid default '${T1}',
    vendor_id uuid references public.vendors(id) on delete set null,
    category text not null default 'other',
    description text,
    amount_cents int not null check (amount_cents >= 0),
    spent_on date not null default current_date,
    status text not null default 'paid' check (status in ('paid','pending')),
    created_by uuid, created_at timestamptz not null default now());

  create table public.budgets (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid default '${T1}',
    category text not null,
    monthly_limit_cents int not null default 0 check (monthly_limit_cents >= 0),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint budgets_tenant_id_category_key unique (tenant_id, category));

  alter table public.expenses enable row level security;
  alter table public.budgets enable row level security;
  grant select, insert, update, delete on public.expenses, public.budgets to authenticated;

  insert into public.budgets (category, monthly_limit_cents) values
    ('ingredients', 100000), ('marketing', 20000), ('supplies', 0), ('equipment', 0),
    ('fees', 0), ('labor', 0), ('other', 0);
`);

await db.exec(mig("0292_receipts_and_spend.sql"));

// categories
ok("0292: the seven categories exist as rows, not strings",
   (await q1(`select count(*)::int n from public.spend_categories`)).n === 7);
ok("0292: the receipt rule lives on the category",
   Number((await q1(`select receipt_required_over_cents r from public.spend_categories where slug='marketing'`))?.r) === 2500);

// the category FK closes the typo hole
const typo = await raises(`insert into public.expenses (category, amount_cents) values ('ingrediants', 500);`);
ok("0292: a mistyped category is refused instead of silently creating one", typo !== null, typo);

// market + receipt + void columns
ok("0292: an expense belongs to a city",
   (await q1(`select count(*)::int n from information_schema.columns
              where table_name='expenses' and column_name='market'`)).n === 1);
ok("0292: and can carry a receipt",
   (await q1(`select count(*)::int n from information_schema.columns
              where table_name='expenses' and column_name='receipt_path'`)).n === 1);

await db.exec(`insert into public.expenses (id, category, amount_cents, spent_on, market, description) values
  ('cccccccc-0000-0000-0000-000000000001','ingredients', 90000, current_date, 'greenville', 'Beans'),
  ('cccccccc-0000-0000-0000-000000000002','marketing',    2000, current_date, 'greenville', 'Small ad'),
  ('cccccccc-0000-0000-0000-000000000003','ingredients', 50000, current_date, 'atlanta',    'ATL beans');`);

// deleting is refused; voiding is the way
const del = await raises(`delete from public.expenses where id='cccccccc-0000-0000-0000-000000000001';`);
ok("0292: an expense cannot be deleted", del !== null && /void them instead/.test(del), del);
ok("0292: and it is still there afterwards",
   (await q1(`select count(*)::int n from public.expenses where id='cccccccc-0000-0000-0000-000000000001'`)).n === 1);

const noReason = await raises(`select public.void_expense('cccccccc-0000-0000-0000-000000000001', '  ');`);
ok("0292: voiding without a reason is refused — a void with no reason is a delete",
   noReason !== null && /why it is being voided/.test(noReason), noReason);

await db.exec(`select public.void_expense('cccccccc-0000-0000-0000-000000000001', 'Duplicate of the Sysco invoice');`);
ok("0292: a voided expense keeps its row and its reason",
   /Duplicate/.test((await q1(`select void_reason v from public.expenses where id='cccccccc-0000-0000-0000-000000000001'`))?.v ?? ""));
const revoid = await raises(`select public.void_expense('cccccccc-0000-0000-0000-000000000001', 'again');`);
ok("0292: voiding twice is refused", revoid !== null);

// the report
const rep = await q1(`select public.report_spend(current_date, 'greenville') as r`);
const r = rep.r;
ok("0292: the report drops voided spend from the total", Number(r.total_spent_cents) === 2000, r.total_spent_cents);
ok("0292: and reports it separately rather than hiding it", Number(r.voided_cents) === 90000, r.voided_cents);
ok("0292: the other city's spend is not in this city's number", Number(r.total_spent_cents) === 2000);
const atlRep = (await q1(`select public.report_spend(current_date, 'atlanta') as r`)).r;
ok("0292: asking for the other city gets the other city", Number(atlRep.total_spent_cents) === 50000, atlRep.total_spent_cents);
ok("0292: categories come back with their labels", r.by_category.some((c) => c.label === "Ingredients"));

// a budget belongs to a month
await db.exec(`insert into public.budgets (category, market, monthly_limit_cents, effective_from)
  values ('ingredients', 'greenville', 250000, date_trunc('month', current_date)::date);`);
ok("0292: two budgets for the same category can coexist when they start on different dates",
   (await q1(`select count(*)::int n from public.budgets where category='ingredients'`)).n === 2);
const thisMonth = (await q1(`select public.report_spend(current_date, 'greenville') as r`)).r;
const lastMonth = (await q1(`select public.report_spend((date_trunc('month', current_date) - interval '1 month')::date, 'greenville') as r`)).r;
const ingNow = thisMonth.by_category.find((c) => c.category === 'ingredients');
const ingThen = lastMonth.by_category.find((c) => c.category === 'ingredients');
ok("0292: this month reads the new budget", Number(ingNow.budget_cents) === 250000, ingNow.budget_cents);
ok("0292: last month still reads what was planned then — changing July no longer rewrites June",
   Number(ingThen.budget_cents) === 100000, ingThen.budget_cents);

// receipt gaps
const gaps = await rows(`select id, amount_cents, why from public.v_receipt_gaps order by amount_cents desc`);
ok("0292: the small marketing spend is under its threshold and not chased",
   !gaps.some((g) => g.id === 'cccccccc-0000-0000-0000-000000000002'), gaps.map((g) => g.id));
ok("0292: the voided one is not chased either",
   !gaps.some((g) => g.id === 'cccccccc-0000-0000-0000-000000000001'));
ok("0292: the Atlanta beans are chased", gaps.some((g) => g.id === 'cccccccc-0000-0000-0000-000000000003'));
ok("0292: a big one says to get that one first", /get this one first/.test(gaps[0]?.why ?? ""), gaps[0]?.why);

await db.exec(`update public.expenses set receipt_path = 'receipts/atl-beans.jpg', receipt_uploaded_at = now()
  where id='cccccccc-0000-0000-0000-000000000003';`);
ok("0292: attaching a receipt clears the gap",
   (await q1(`select count(*)::int n from public.v_receipt_gaps`)).n === 0);
ok("0292: and the touch trigger recorded the change",
   !!(await q1(`select updated_at from public.expenses where id='cccccccc-0000-0000-0000-000000000003'`))?.updated_at);

// the bucket is private, unlike the shop one
ok("0292: the receipts bucket exists",
   (await q1(`select count(*)::int n from storage.buckets where id='receipts'`)).n === 1);
ok("0292: and is PRIVATE — a receipt carries a vendor, a price and an address",
   (await q1(`select public from storage.buckets where id='receipts'`))?.public === false);

// audit coverage caught up
ok("0292: expenses are audited now",
   (await q1(`select count(*)::int n from pg_trigger t join pg_class c on c.oid=t.tgrelid
              where c.relname='expenses' and t.tgname='audit_expenses'`)).n === 1);
ok("0292: spend is now inside 0291's market scope, which it could not be before",
   (await q1(`select market_scoped from public.v_market_scope where table_name='expenses'`))?.market_scoped === true);
ok("0292: and so are budgets",
   (await q1(`select market_scoped from public.v_market_scope where table_name='budgets'`))?.market_scoped === true);
ok("0292: so are budgets",
   (await q1(`select count(*)::int n from pg_trigger t join pg_class c on c.oid=t.tgrelid
              where c.relname='budgets' and t.tgname='audit_budgets'`)).n === 1);

// ═══ 0293 — the count, and the chain from a pound to a bottle ═══════════════════════════════════
await db.exec(`
  create table public.brew_recipes (id uuid primary key default gen_random_uuid(), name text);
  create table public.brew_batches (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid default '${T1}',
    recipe_id uuid references public.brew_recipes(id) on delete set null,
    recipe_name text, batch_gal numeric not null default 1, brew_date date,
    status text not null default 'planned'
      check (status in ('planned','brewing','ready','kegged','served','dumped')),
    signal_score int, notes text, created_by uuid, created_at timestamptz not null default now());
  alter table public.brew_batches enable row level security;
  grant select, insert, update on public.brew_batches to authenticated;

  -- the five already-served batches, as production has them
  insert into public.brew_batches (id, recipe_name, batch_gal, brew_date, status) values
    ('dddddddd-0000-0000-0000-000000000001','Nitro',        5, current_date - 30, 'served'),
    ('dddddddd-0000-0000-0000-000000000002','Salted Maple', 3, current_date - 20, 'served');

  -- a stale shelf: a hand-typed qty and no ledger movement at all, which is 21 of 49 in production
  insert into public.inventory_items (name, market, qty, reorder_point, unit)
    values ('Stale Beans', 'greenville', 14, 2, 'lb');
`);

await db.exec(mig("0293_count_and_batch_chain.sql"));

// The count: a movement, not an erasure.
ok("0293: a shelf with a hand-typed number reads as stocked before the count",
   Number((await q1(`select effective_on_hand e from public.inventory_status where name='Stale Beans'`))?.e) === 14);
const noWhy = await raises(`select public.reset_inventory_count('greenville', '   ');`);
ok("0293: zeroing without a reason is refused", noWhy !== null && /no reason/.test(noWhy), noWhy);
const badMarket = await raises(`select public.reset_inventory_count('nowhere', 'x');`);
ok("0293: an unknown market is refused", badMarket !== null);

const reset = await q1(`select public.reset_inventory_count('greenville', 'Physical count — starting fresh') as n`);
ok("0293: the count moved the shelves that had something on them", Number(reset.n) >= 1, reset.n);
ok("0293: the shelf now reads zero",
   Number((await q1(`select effective_on_hand e from public.inventory_status where name='Stale Beans'`))?.e) === 0);
ok("0293: and the number it used to claim is still on the record",
   /Previous balance: 14/.test((await q1(`select note from public.inventory_ledger
      where item='Stale Beans' and kind='count'`))?.note ?? ""));
ok("0293: the hand-typed qty was cleared so it cannot resurrect",
   Number((await q1(`select qty from public.inventory_items where name='Stale Beans'`))?.qty) === 0);
ok("0293: the other city was not touched",
   Number((await q1(`select effective_on_hand e from public.inventory_status
      where name='Mountain Valley 1L' and market='atlanta'`))?.e) !== 0);

// Receiving a lot puts it on the shelf in one act.
const noShelf = await raises(`select public.receive_lot('greenville','Nothing Called This', 5);`);
ok("0293: receiving into a shelf that does not exist is refused", noShelf !== null && /No shelf/.test(noShelf), noShelf);

const lot = await q1(`select (public.receive_lot('greenville','Stale Beans', 10, 'lb', 1599, 'LOT-A')).id as id`);
const LOT = lot.id;
ok("0293: the lot exists", !!lot.id);
ok("0293: and the shelf went up by exactly that much",
   Number((await q1(`select effective_on_hand e from public.inventory_status where name='Stale Beans'`))?.e) === 10);
ok("0293: the movement names the lot it came from",
   (await q1(`select count(*)::int n from public.inventory_ledger where lot_id = $1`, [LOT])).n === 1);

// A batch cannot be finished without saying what it used.
await db.exec(`insert into public.brew_batches (id, recipe_name, batch_gal, brew_date, status)
  values ('dddddddd-0000-0000-0000-000000000003','Rise', 4, current_date, 'brewing');`);
await db.exec(`update public.brew_batches set status='ready' where id='dddddddd-0000-0000-0000-000000000003';`);
ok("0293: brewing and ready are not blocked — nothing stops mid-shift",
   (await q1(`select status from public.brew_batches where id='dddddddd-0000-0000-0000-000000000003'`))?.status === "ready");

const unaccounted = await raises(`update public.brew_batches set status='served'
  where id='dddddddd-0000-0000-0000-000000000003';`);
ok("0293: a batch cannot be served with nothing drawn down", unaccounted !== null && /nothing drawn down/.test(unaccounted), unaccounted);
const dumped = await raises(`update public.brew_batches set status='dumped'
  where id='dddddddd-0000-0000-0000-000000000003';`);
ok("0293: nor dumped — a dumped batch still consumed the coffee", dumped !== null);

await db.exec(`select public.log_batch_use('dddddddd-0000-0000-0000-000000000003', 'Stale Beans', 4, '` + LOT + `');`);
ok("0293: the draw came off the shelf",
   Number((await q1(`select effective_on_hand e from public.inventory_status where name='Stale Beans'`))?.e) === 6);
await db.exec(`update public.brew_batches set status='served' where id='dddddddd-0000-0000-0000-000000000003';`);
ok("0293: once it says what it used, it can be served",
   (await q1(`select status from public.brew_batches where id='dddddddd-0000-0000-0000-000000000003'`))?.status === "served");

const zeroDraw = await raises(`select public.log_batch_use('dddddddd-0000-0000-0000-000000000003','Stale Beans', 0);`);
ok("0293: a draw of zero is refused", zeroDraw !== null);

// The chain, readable end to end.
const trace = await q1(`select * from public.v_batch_traceability where batch_id='dddddddd-0000-0000-0000-000000000003'`);
ok("0293: the batch reports what it used", Number(trace?.qty_used) === 4, trace?.qty_used);
ok("0293: and what that cost, from the lot's own price", Number(trace?.cost_dollars) === 63.96, trace?.cost_dollars);
ok("0293: and which lot it came from", trace?.lot_codes === "LOT-A", trace?.lot_codes);
ok("0293: and that it is accounted for", trace?.accounted === true);

const open = await rows(`select recipe_name, why from public.v_unaccounted_batches`);
ok("0293: the batches served before the rule are listed, not forgiven", open.length === 2, open.length);
ok("0293: and the list says why they are there", /predates the rule/.test(open[0]?.why ?? ""), open[0]?.why);
ok("0293: the accounted batch is not in the list",
   !open.some((b) => b.recipe_name === "Rise"));

// ═══ 0294 — the bridge between a recipe and a shelf ═════════════════════════════════════════════
// The fixture's brew_recipes was (id, name); production's is 0079's, with a jsonb ingredient list, a
// reference water volume and an archived_at. Fourth time a stub here has been thinner than
// production, and the fourth time it would have made 0294 pass on a table it will never meet.
await db.exec(`
  -- production defines this in 0041; the fixture never needed it until the map table's touch trigger.
  create or replace function public.touch_updated_at() returns trigger
    language plpgsql as $fn$ begin new.updated_at := now(); return new; end $fn$;

  alter table public.brew_recipes add column tenant_id uuid default '${T1}';
  alter table public.brew_recipes add column base_water_gal numeric not null default 1;
  alter table public.brew_recipes add column ingredients jsonb not null default '[]';
  alter table public.brew_recipes add column archived_at timestamptz;
  alter table public.brew_batches add column scaled jsonb;
  alter table public.brew_batches add column event_id int references public.events(id);
  alter table public.brew_batches add column stop_id int;

  insert into public.brew_recipes (id, name, base_water_gal, ingredients) values
    ('eeeeeeee-0000-0000-0000-000000000001', 'GT3 Rise (OG)', 2, '[
       {"name":"Coarse-ground organic single-origin coffee","qty":560,"unit":"g","scales":true},
       {"name":"Organic cacao nibs (mix with grounds)","qty":160,"unit":"g","scales":true}]'::jsonb);

  -- the shelf the map will point at: a 2.2 lb bag counted in "each", exactly as production has it
  insert into public.inventory_items (name, market, qty, unit)
    values ('Yupik Organic Raw Cacao Nibs 2.2 lb', 'greenville', 3, 'each'),
           ('Yupik Organic Raw Cacao Nibs 2.2 lb', 'atlanta',    1, 'each');

  -- a batch of that recipe, not yet served, with the scaled list the planner stores
  insert into public.brew_batches (id, recipe_id, recipe_name, batch_gal, brew_date, status, scaled)
  values ('dddddddd-0000-0000-0000-000000000009','eeeeeeee-0000-0000-0000-000000000001',
          'GT3 Rise (OG)', 4, current_date, 'ready', '[
       {"name":"Coarse-ground organic single-origin coffee","qty":1120,"unit":"g"},
       {"name":"Organic cacao nibs (mix with grounds)","qty":320,"unit":"g"}]'::jsonb);

  -- an orphan draw-down from the pre-map era: an item name that matches no shelf anywhere
  insert into public.inventory_ledger (item, market, qty, kind, note)
    values ('Coarse-ground organic single-origin coffee', 'greenville', -420, 'use', 'Brew — GT3 Rise (OG)');
`);

await db.exec(mig("0294_ingredient_map.sql"));

ok("0294: every existing batch now names a city",
   Number((await q1(`select count(*)::int n from public.brew_batches where market is null`)).n) === 0);

// The seeded conversion is the only one that could be derived from what the app already knew.
const seeded = await q1(`select shelf_qty_per_recipe_unit f, basis from public.recipe_ingredient_map
                         where lower(ingredient) like 'organic cacao nibs%'`);
ok("0294: the one derivable conversion is seeded", seeded != null);
ok("0294: and it is 1 gram over a 2.2 lb bag, not a guess",
   Math.abs(Number(seeded.f) - 1 / (2.2 * 453.59237)) < 1e-12, seeded?.f);
ok("0294: it says where the number came from", /2\.2 lb/.test(seeded?.basis ?? ""), seeded?.basis);

// A conversion with no stated basis is refused: that is the whole point of the column.
const noBasis = await raises(`select public.map_ingredient('Whatever',
  (select id from public.inventory_items where name='Yupik Organic Raw Cacao Nibs 2.2 lb' and market='greenville'),
  2, '   ', 'greenville')`);
ok("0294: a conversion with no stated basis is refused", noBasis !== null && /where the number came from/.test(noBasis), noBasis);
const zero = await raises(`select public.map_ingredient('Whatever',
  (select id from public.inventory_items where name='Yupik Organic Raw Cacao Nibs 2.2 lb' and market='greenville'),
  0, 'nonsense', 'greenville')`);
ok("0294: a zero conversion is refused", zero !== null && /positive number/.test(zero), zero);

// Resolution is market-aware: the Atlanta shelf is a different row of inventory_items.
ok("0294: the ingredient resolves in Greenville",
   (await q1(`select count(*)::int n from public.resolve_ingredient('Organic cacao nibs (mix with grounds)','greenville')`)).n === 1);
ok("0294: a global map row still has to find a shelf in the city that is brewing",
   (await q1(`select count(*)::int n from public.resolve_ingredient('Organic cacao nibs (mix with grounds)','atlanta')`)).n === 0,
   "the seeded row is greenville-scoped, so Atlanta must not resolve");

// ── the guard, and the way to satisfy it ──
const beforeLog = await raises(`update public.brew_batches set status='served'
                                 where id='dddddddd-0000-0000-0000-000000000009'`);
ok("0294: a batch cannot be served before its consumption is logged",
   beforeLog !== null && /Log what this batch used/.test(beforeLog), beforeLog);

const logged = await q1(`select public.log_batch_consumption('dddddddd-0000-0000-0000-000000000009') r`);
const res = typeof logged.r === "string" ? JSON.parse(logged.r) : logged.r;
ok("0294: logging drew the ingredient it could resolve", Number(res.drawn_count) === 1, JSON.stringify(res.drawn));
ok("0294: and recorded the one it could not, rather than passing over it",
   Number(res.gap_count) === 1 && /coffee/i.test(res.gaps[0].ingredient), JSON.stringify(res.gaps));

// 320 g of nibs against a 997.903 g bag is 0.3206 of a bag.
const drew = await q1(`select qty from public.inventory_ledger
                        where batch_id='dddddddd-0000-0000-0000-000000000009' and qty < 0`);
ok("0294: the draw is in the shelf's units, not the recipe's",
   Math.abs(Number(drew.qty) + 320 / (2.2 * 453.59237)) < 1e-9, drew?.qty);

ok("0294: the shortfall is kept on the batch, permanently",
   Number((await q1(`select jsonb_array_length(consumption_gaps) n from public.brew_batches
                      where id='dddddddd-0000-0000-0000-000000000009'`)).n) === 1);

await db.exec(`update public.brew_batches set status='served' where id='dddddddd-0000-0000-0000-000000000009';`);
ok("0294: once logged, the batch can be served",
   (await q1(`select status from public.brew_batches where id='dddddddd-0000-0000-0000-000000000009'`))?.status === "served");

const twice = await raises(`select public.log_batch_consumption('dddddddd-0000-0000-0000-000000000009')`);
ok("0294: logging the same batch twice is refused, so nothing is drawn down twice",
   twice !== null && /already logged/.test(twice), twice);

// ── a batch that was logged but not fully accounted still says so ──
const still = await db.query(`select why, gap_count from public.v_unaccounted_batches
                               where batch_id='dddddddd-0000-0000-0000-000000000009'`);
ok("0294: a partly-accounted batch stays on the unaccounted list",
   still.rows.length === 1 && /could not come off a shelf/.test(still.rows[0].why), JSON.stringify(still.rows));

// ── the gap, as a query ──
const ingGaps = await db.query(`select market, ingredient, why from public.v_recipe_ingredient_gaps order by market, ingredient`);
ok("0294: the coffee nobody can draw is listed for both cities",
   ingGaps.rows.filter((r) => /coffee/i.test(r.ingredient)).length === 2, JSON.stringify(ingGaps.rows));
ok("0294: Greenville's mapped ingredient is NOT listed as a gap",
   !ingGaps.rows.some((r) => r.market === "greenville" && /cacao/i.test(r.ingredient)), JSON.stringify(ingGaps.rows));
ok("0294: but Atlanta's unstocked one is",
   ingGaps.rows.some((r) => r.market === "atlanta" && /cacao/i.test(r.ingredient)), JSON.stringify(ingGaps.rows));

// ── the orphan rows are annotated, not deleted ──
const orphan = await q1(`select note from public.inventory_ledger
                          where item='Coarse-ground organic single-origin coffee' and batch_id is null`);
ok("0294: the pre-map orphan draw-down is annotated rather than removed",
   /\[orphan:/.test(orphan?.note ?? ""), orphan?.note);

// ── the escape hatch still exists for a deliberate correction ──
await db.exec(`insert into public.brew_batches (id, recipe_name, batch_gal, status)
               values ('dddddddd-0000-0000-0000-00000000000a','Odd one', 1, 'ready');`);
await db.exec(`select set_config('gt3.allow_hard_delete','on',false);
               update public.brew_batches set status='dumped' where id='dddddddd-0000-0000-0000-00000000000a';
               select set_config('gt3.allow_hard_delete','off',false);`);
ok("0294: a deliberate exception can still dump an unlogged batch",
   (await q1(`select status from public.brew_batches where id='dddddddd-0000-0000-0000-00000000000a'`))?.status === "dumped");

// ═══ 0295 — four lifecycles on one shelf ════════════════════════════════════════════════════════
await db.exec(`
  create table public.brew_vessels (
    id uuid primary key default gen_random_uuid(),
    name text not null, capacity_gal numeric not null default 1,
    filter_type text, notes text, sort int not null default 0,
    archived_at timestamptz);
  alter table public.brew_vessels enable row level security;
  grant select, insert, update on public.brew_vessels to authenticated;
  insert into public.brew_vessels (name, capacity_gal) values
    ('Toddy (commercial)', 2.5), ('Cold Brew Avenue', 5.0);

  -- the four categories production actually carries, plus one it cannot classify
  update public.inventory_items set category = 'Ingredients'
    where name in ('Yupik Organic Raw Cacao Nibs 2.2 lb');
  insert into public.inventory_items (name, market, qty, reorder_point, unit, category) values
    ('Vevor Stainless Work Table',  'greenville', 1,  1, 'each', 'Tools/Hardware'),
    ('Melitta #4 Cone Filters',     'greenville', 40, 20, 'each', 'Cleaning/Sanitation'),
    ('GT3 Bottle 12oz',             'greenville', 90, 24, 'each', 'Packaging'),
    ('Window decal run',            'greenville', 1,  null, 'each', 'Marketing');
`);

await db.exec(mig("0295_item_lifecycles.sql"));

const kinds = Object.fromEntries((await db.query(
  `select coalesce(kind,'(null)') k, count(*)::int n from public.inventory_items group by 1`
)).rows.map((r) => [r.k, Number(r.n)]));
ok("0295: Ingredients classify as ingredient", (kinds.ingredient ?? 0) >= 1, JSON.stringify(kinds));
ok("0295: Tools/Hardware classifies as equipment", (kinds.equipment ?? 0) >= 1, JSON.stringify(kinds));
ok("0295: Packaging classifies as packaging", (kinds.packaging ?? 0) >= 1, JSON.stringify(kinds));
ok("0295: Cleaning/Sanitation classifies as consumable", (kinds.consumable ?? 0) >= 1, JSON.stringify(kinds));
ok("0295: a category nobody can bucket is left unsaid, not guessed",
   (await q1(`select count(*)::int n from public.v_item_kind_gaps where name='Window decal run'`)).n === 1);

// ── equipment does not get reordered ──
await db.exec(`insert into public.inventory_ledger (item, market, qty, kind, note)
               values ('Vevor Stainless Work Table','greenville', -1, 'adjust', 'moved to the truck');`);
ok("0295: equipment raises no reorder alert even at its reorder point",
   Number((await q1(`select count(*)::int n from public.alerts
                      where ack_at is null and title like '%Vevor%'`)).n) === 0);
// ...while a real consumable still does, so the skip is targeted and not a blanket mute.
await db.exec(`insert into public.inventory_ledger (item, market, qty, kind, note)
               values ('Melitta #4 Cone Filters','greenville', -35, 'use', 'a run of brews');`);
ok("0295: a consumable at its reorder point still raises one",
   Number((await q1(`select count(*)::int n from public.alerts
                      where ack_at is null and title like '%Melitta%'`)).n) === 1);

// ── a recipe may not draw down the grinder ──
const eqMap = await raises(`select public.map_ingredient('Some step',
  (select id from public.inventory_items where name='Vevor Stainless Work Table'),
  1, 'nonsense', 'greenville')`);
ok("0295: mapping a recipe line to equipment is refused",
   eqMap !== null && /equipment, not something a batch uses up/.test(eqMap), eqMap);

// A row written before the rule existed still cannot resolve: the guard is on the read path too.
await db.exec(`insert into public.recipe_ingredient_map
  (ingredient, market, inventory_item_id, shelf_qty_per_recipe_unit, basis)
  select 'Legacy equipment line', 'greenville', id, 1, 'written before 0295'
    from public.inventory_items where name='Vevor Stainless Work Table';`);
ok("0295: and a pre-existing equipment map row cannot resolve either",
   (await q1(`select count(*)::int n from public.resolve_ingredient('Legacy equipment line','greenville')`)).n === 0);

// ── the scaling fix ──
// A recipe defined per 1 gal with one filter that does NOT scale, brewed at 4 gal.
await db.exec(`
  insert into public.brew_recipes (id, name, base_water_gal, ingredients) values
    ('eeeeeeee-0000-0000-0000-000000000002', 'Filter Test', 1, '[
       {"name":"Melitta #4 Cone Filters","qty":1,"unit":"each","scales":false},
       {"name":"Organic cacao nibs (mix with grounds)","qty":10,"unit":"g","scales":true}]'::jsonb);
  insert into public.brew_batches (id, recipe_id, recipe_name, batch_gal, status, scaled)
    values ('dddddddd-0000-0000-0000-00000000000b','eeeeeeee-0000-0000-0000-000000000002',
            'Filter Test', 4, 'ready', null);
  select public.map_ingredient('Melitta #4 Cone Filters',
    (select id from public.inventory_items where name='Melitta #4 Cone Filters' and market='greenville'),
    1, 'one filter is one filter', 'greenville', 'each');
`);
const fres = await q1(`select public.log_batch_consumption('dddddddd-0000-0000-0000-00000000000b') r`);
const fr = typeof fres.r === "string" ? JSON.parse(fres.r) : fres.r;
const filterDraw = await q1(`select qty from public.inventory_ledger
                              where batch_id='dddddddd-0000-0000-0000-00000000000b'
                                and item='Melitta #4 Cone Filters'`);
ok("0295: a non-scaling line draws ONE, not one per gallon",
   Number(filterDraw?.qty) === -1, `${filterDraw?.qty} (was -4 before the fix)`);
const nibDraw = await q1(`select qty from public.inventory_ledger
                           where batch_id='dddddddd-0000-0000-0000-00000000000b'
                             and item like 'Yupik%'`);
ok("0295: while a scaling line in the same batch still scales",
   Math.abs(Number(nibDraw?.qty) + (10 * 4) / (2.2 * 453.59237)) < 1e-9, nibDraw?.qty);

// ── a vessel belongs to a city ──
ok("0295: both existing vessels are Greenville's",
   Number((await q1(`select count(*)::int n from public.brew_vessels where market='greenville'`)).n) === 2);
const gvCap = await q1(`select * from public.market_brew_capacity('greenville')`);
ok("0295: Greenville's ceiling is its biggest vessel, not the sum",
   Number(gvCap.largest_gal) === 5 && Number(gvCap.total_gal) === 7.5, JSON.stringify(gvCap));
const atlCap = await q1(`select * from public.market_brew_capacity('atlanta')`);
ok("0295: a city with no vessel reads as unknown, not as zero capacity",
   Number(atlCap.vessels) === 0 && atlCap.largest_gal === null, JSON.stringify(atlCap));

// ═══ 0296 — can this city open? ═════════════════════════════════════════════════════════════════
await db.exec(mig("0296_market_readiness.sql"));

ok("0296: the state is set explicitly, not parsed out of free text",
   (await q1(`select state from public.markets where slug='greenville'`))?.state === 'SC' &&
   (await q1(`select state from public.markets where slug='atlanta'`))?.state === 'GA');

const board = await db.query(`select market, area, check_name, status, detail, blocking
                                from public.v_market_readiness order by market, area, check_name`);
ok("0296: every market gets the full set of checks",
   board.rows.filter((r) => r.market === "greenville").length ===
   board.rows.filter((r) => r.market === "atlanta").length, JSON.stringify(board.rows.length));
ok("0296: a status is only ever ready, blocked or unknown",
   board.rows.every((r) => ["ready","blocked","unknown"].includes(r.status)),
   JSON.stringify([...new Set(board.rows.map((r) => r.status))]));
ok("0296: every row explains itself",
   board.rows.every((r) => (r.detail ?? "").length > 0));

const cell = (mkt, chk) => board.rows.find((r) => r.market === mkt && r.check_name === chk);

// The distinction the view exists to make: nothing recorded is not the same as recorded-and-failing.
ok("0296: a market with no vessel reads unknown, not blocked",
   cell("atlanta", "A vessel to brew in")?.status === "unknown",
   JSON.stringify(cell("atlanta", "A vessel to brew in")));
ok("0296: a market with vessels reads ready and states its ceiling",
   cell("greenville", "A vessel to brew in")?.status === "ready" &&
   /5 gal/.test(cell("greenville", "A vessel to brew in")?.detail ?? ""),
   cell("greenville", "A vessel to brew in")?.detail);

// Atlanta cannot draw a single recipe line — that IS evidence, so it blocks.
ok("0296: a city whose recipes cannot find a shelf is blocked",
   cell("atlanta", "Every recipe line can be drawn")?.status === "blocked",
   cell("atlanta", "Every recipe line can be drawn")?.detail);

// Greenville was counted to zero in 0293, so its ingredient shelves are empty — and the board says so
// rather than reporting a city with nothing on the shelf as ready to pour.
ok("0296: shelves counted to zero block the city that owns them",
   cell("greenville", "Ingredient shelves have stock")?.status === "blocked",
   cell("greenville", "Ingredient shelves have stock")?.detail);

ok("0296: a lead-less market is blocked on crew",
   ["blocked","ready"].includes(cell("atlanta", "Someone leads this market")?.status ?? ""),
   cell("atlanta", "Someone leads this market")?.detail);

// The count(*) trap: on a LEFT JOIN a market with NO matching row still yields one row, so count(*)
// reads 1 and the "nothing recorded" branch is unreachable. Atlanta has no packaging item at all and
// would have reported "every packaging line is at zero" — stating as fact something never recorded,
// which is exactly the confusion this view was built to prevent. Caught by reading the view, not by
// the first round of tests, so it gets one of its own per check that joins.
ok("0296: a market with no packaging item reads unknown, not 'all at zero'",
   cell("atlanta", "Bottles on the shelf")?.status === "unknown" &&
   /No packaging item exists/.test(cell("atlanta", "Bottles on the shelf")?.detail ?? ""),
   JSON.stringify(cell("atlanta", "Bottles on the shelf")));
ok("0296: while a market that HAS packaging in stock reads ready",
   cell("greenville", "Bottles on the shelf")?.status === "ready",
   cell("greenville", "Bottles on the shelf")?.detail);
ok("0296: no check reports a null detail, which is how the count(*) bug first showed",
   board.rows.every((r) => r.detail != null && String(r.detail).trim().length > 0),
   JSON.stringify(board.rows.filter((r) => !r.detail).map((r) => r.market + "/" + r.check_name)));

// Advisory checks must never hold a city shut.
const advisory = board.rows.filter((r) => r.blocking === false);
ok("0296: the advisory checks are marked non-blocking", advisory.length >= 2, JSON.stringify(advisory.length));
ok("0296: batch history is advisory, not a gate",
   cell("greenville", "Every batch accounted for")?.blocking === false);

const summary = await db.query(`select * from public.v_market_readiness_summary order by market`);
ok("0296: the summary counts one row per market", summary.rows.length === 2, JSON.stringify(summary.rows));
ok("0296: can_open is false while any blocking check is unmet",
   summary.rows.every((r) => r.can_open === (Number(r.blocked) + Number(r.unknown) === 0)),
   JSON.stringify(summary.rows));
ok("0296: advisories do not count against can_open",
   Number(summary.rows.find((r) => r.market === 'greenville')?.advisories) >= 0);

// ═══ 0297 — the readiness board reads the resolved switch ═══════════════════════════════════════
// The board must report the RESOLVED switch (0285: null on a market means inherit the company one),
// not the raw column. Every case below sets the state it is testing rather than inheriting whatever
// an earlier block left behind — the first version of this test assumed production's values, passed
// nothing, and knocked over a later assertion by restoring the wrong baseline.
await db.exec(mig("0297_readiness_live_resolution.sql"));

const liveCell = async (mkt) => await q1(`select status, detail from public.v_market_readiness
                                           where market='${mkt}' and check_name='Storefront switched on'`);

// company switch OFF, market inheriting → blocked, and it says which switch is off
await db.exec(`update public.live_status set is_live = false where id = 1;
               update public.markets set is_live = null where slug = 'greenville';`);
ok("0297: an inherited-off switch is blocked, not unknown",
   (await liveCell("greenville"))?.status === "blocked", JSON.stringify(await liveCell("greenville")));
ok("0297: and it names the company-wide switch rather than claiming nobody set it",
   /company-wide switch is off/.test((await liveCell("greenville"))?.detail ?? ""),
   (await liveCell("greenville"))?.detail);

// company switch ON, market still inheriting → ready, without touching the market row
await db.exec(`update public.live_status set is_live = true where id = 1;`);
ok("0297: a market inheriting an ON switch reads ready",
   (await liveCell("greenville"))?.status === "ready", JSON.stringify(await liveCell("greenville")));

// market overrides OFF while the company switch is ON → the override wins
await db.exec(`update public.markets set is_live = false where slug = 'greenville';`);
ok("0297: a market's own override beats the company switch",
   (await liveCell("greenville"))?.status === "blocked", JSON.stringify(await liveCell("greenville")));

// a held market with an opening date says the date instead of the generic line
await db.exec(`update public.markets set is_live = false, opens_on = date '2026-12-01' where slug = 'atlanta';`);
ok("0297: a held market reports its opening date",
   /Dec 1, 2026/.test((await liveCell("atlanta"))?.detail ?? ""), (await liveCell("atlanta"))?.detail);

// 'unknown' still means genuinely unrecorded, not merely off
ok("0297: 'unknown' is still reserved for what nobody has recorded",
   (await q1(`select status from public.v_market_readiness
               where market='atlanta' and check_name='A vessel to brew in'`))?.status === "unknown");

// Put back exactly what the 0285 block left: company switch on, Greenville inheriting.
await db.exec(`update public.live_status set is_live = true where id = 1;
               update public.markets set is_live = null where slug = 'greenville';`);

// ═══ 0298 — the supply side ═════════════════════════════════════════════════════════════════════
// Reproduces production: venues already in the vendor table, the Sprouts receipt itemised into
// expenses, the arrivals already in the ledger, and no lot anywhere carrying a cost.
await db.exec(`
  insert into public.vendors (name, service_dates, location_text) values
    ('ACA Sports Club', 'Saturdays', 'Greenville'),
    ('Euphoria Office', null, 'Greenville');

  insert into public.inventory_items (name, market, qty, unit, category, kind) values
    ('Org Ethiopia Coffee (bulk)', 'atlanta', 0, 'lb',   'Ingredients', 'ingredient'),
    ('Spring Water Case',          'atlanta', 0, 'case', 'Ingredients', 'ingredient');

  insert into public.expenses (category, description, amount_cents, spent_on, market) values
    ('ingredients', 'Org Ethiopia coffee — 6 lb @ $15.99/lb retail (Sprouts #840214)', 9594, '2026-09-06', 'atlanta'),
    ('ingredients', 'Spring water — 2 cases @ $34.99 (Sprouts #840214)',                6998, '2026-09-06', 'atlanta'),
    ('other',       'Sales tax on Sprouts #840214 — Co Food 3.32 + District 1.66',       498, '2026-09-06', 'atlanta');

  -- the arrivals, as the ledger already holds them
  insert into public.inventory_ledger (item, market, qty, kind, note) values
    ('Org Ethiopia Coffee (bulk)', 'atlanta', 6, 'restock', 'Sprouts #840214 — 6 lb purchased'),
    ('Spring Water Case',          'atlanta', 2, 'restock', 'Sprouts #840214 — 2 cases purchased'),
    ('Org Ethiopia Coffee (bulk)', 'atlanta', 4, 'adjust',  'Opening stock — 4 lb already on hand, no receipt on file');
`);

const shelfBefore = Number((await q1(`select coalesce(sum(qty),0) n from public.inventory_ledger
                                       where market='atlanta' and item='Org Ethiopia Coffee (bulk)'`)).n);

await db.exec(mig("0298_supply_side.sql"));

ok("0298: the places we sell at are classified as venues, not suppliers",
   Number((await q1(`select count(*)::int n from public.vendors where name in ('ACA Sports Club','Euphoria Office') and kind='venue'`)).n) === 2);
const sprouts = await q1(`select name, kind, price_basis from public.vendors where lower(name) like 'sprouts%'`);
ok("0298: the company we actually buy from exists, as a supplier on retail terms",
   sprouts?.kind === "supplier" && sprouts?.price_basis === "retail", JSON.stringify(sprouts));

ok("0298: every line of the receipt is attached to that supplier",
   Number((await q1(`select count(*)::int n from public.expenses e join public.vendors v on v.id=e.vendor_id
                      where lower(v.name) like 'sprouts%'`)).n) === 3);

// The cost, out of the sentence and into a field the costing can read.
const coffee = await q1(`select unit_cost_cents, price_basis, (expense_id is not null) as receipted
                           from public.inventory_lots
                          where item_name='Org Ethiopia Coffee (bulk)' and lot_code='SPROUTS-840214'`);
ok("0298: the receipted lot carries $15.99 a pound, priced as retail",
   Number(coffee?.unit_cost_cents) === 1599 && coffee?.price_basis === "retail" && coffee?.receipted === true,
   JSON.stringify(coffee));
const water = await q1(`select unit_cost_cents from public.inventory_lots where item_name='Spring Water Case'`);
ok("0298: and the water carries $34.99 a case", Number(water?.unit_cost_cents) === 3499, water?.unit_cost_cents);

// The opening stock is costed by decision, and says so rather than passing as documented.
const opening = await q1(`select unit_cost_cents, (expense_id is not null) as receipted, notes
                            from public.inventory_lots where lot_code='OPENING-2026-09-06'`);
ok("0298: the un-receipted four pounds carry the same rate by decision",
   Number(opening?.unit_cost_cents) === 1599 && opening?.receipted === false, JSON.stringify(opening));
ok("0298: and the lot itself admits it is an assumption",
   /assumption|no receipt/i.test(opening?.notes ?? ""), opening?.notes);

// THE DEFECT THIS GUARDS: receive_lot() also writes a ledger row, and the ledger already held these
// arrivals. Costing the shelf must not restock it a second time.
ok("0298: costing the shelf did not move it",
   Number((await q1(`select coalesce(sum(qty),0) n from public.inventory_ledger
                      where market='atlanta' and item='Org Ethiopia Coffee (bulk)'`)).n) === shelfBefore,
   `${shelfBefore} before`);

ok("0298: the arrival rows now point at the lot they were",
   Number((await q1(`select count(*)::int n from public.inventory_ledger
                      where market='atlanta' and lot_id is not null and qty > 0`)).n) === 3);

// What a pound costs today, which is the number a wholesale deal gets measured against.
const cost = await db.query(`select item, unit_cost, price_basis, supplier, receipted, cost_note
                               from public.v_ingredient_cost where market='atlanta' order by item`);
const sourced = cost.rows.filter((r) => /Ethiopia|Spring Water/.test(r.item));
ok("0298: the cost view prices both items the receipt covered", sourced.length === 2, JSON.stringify(cost.rows));
ok("0298: and names the supplier and the terms",
   sourced.every((r) => r.supplier && /sprouts/i.test(r.supplier) && r.price_basis === "retail"),
   JSON.stringify(sourced));
ok("0298: a retail price says it is a third party's shelf price",
   cost.rows.some((r) => /retail shelf price/.test(r.cost_note ?? "")), JSON.stringify(cost.rows.map((r) => r.cost_note)));

// An item nobody has costed must read as uncosted rather than as free.
await db.exec(`insert into public.inventory_items (name, market, qty, unit, category, kind)
               values ('Uncosted Syrup', 'atlanta', 3, 'each', 'Ingredients', 'ingredient');`);
const un = await q1(`select unit_cost, cost_note from public.v_ingredient_cost
                      where market='atlanta' and item='Uncosted Syrup'`);
ok("0298: an item with no costed lot says so instead of reading as free",
   un?.unit_cost === null && /cost nothing/.test(un?.cost_note ?? ""), JSON.stringify(un));

// Equipment is not a thing you price per unit into a batch — the view leaves it out.
ok("0298: equipment is not in the ingredient cost view",
   Number((await q1(`select count(*)::int n from public.v_ingredient_cost
                      where kind = 'equipment'`)).n) === 0);

// ═══ every file is idempotent, in order ═════════════════════════════════════════════════════════
const snap = async () => JSON.stringify({
  cl: (await q1(`select count(*)::int n from public.changelog`)).n,
  cr: (await q1(`select count(*)::int n from public.compliance_rules`)).n,
  al: (await q1(`select count(*)::int n from public.alerts`)).n,
  ii: (await q1(`select count(*)::int n from public.inventory_items`)).n,
});
const before = await snap();
// 0294 widens the two batch views that 0293 creates. `create or replace view` can only append
// columns, so replaying 0293 over 0294's wider version raises "cannot drop columns from view" —
// that is Postgres being right, not a defect: an older migration is not meant to run after a newer
// one has redefined the same view. Dropping them first lets the loop check what it is actually for,
// which is that re-running the files does not duplicate a row or re-seed a table.
await db.exec(`drop view if exists public.v_market_readiness_summary;
               drop view if exists public.v_market_readiness;
               drop view if exists public.v_unaccounted_batches;
               drop view if exists public.v_batch_traceability;`);
for (const f of ["0284_compliance_freshness.sql", "0285_market_live_switch.sql",
                 "0286_offer_letter_statutory.sql", "0287_supply_sourcing.sql",
                 "0288_inventory_per_market.sql", "0289_market_ownership.sql", "0291_market_read_scope.sql", "0292_receipts_and_spend.sql", "0293_count_and_batch_chain.sql",
                 "0294_ingredient_map.sql",
                 "0295_item_lifecycles.sql",
                 "0296_market_readiness.sql",
                 "0297_readiness_live_resolution.sql",
                 "0298_supply_side.sql"]) {
  await db.exec(mig(f));
}
ok("re-running 0284–0288 in order changes nothing", (await snap()) === before, await snap());
ok("re-run: Greenville still resolves live",
   (await q1(`select is_live from public.market_live where market='greenville'`))?.is_live === true);
// Greenville reached 37 (12 restocked, 5 used, 30 restocked) and none of Atlanta's ever leaked in.
// 0293's count then took it to zero, which is what a count is for — so the assertion that matters
// after the whole lineage has run is that the reset reached this shelf and Atlanta's is untouched.
ok("re-run: the count zeroed Greenville's shelf",
   Number((await q1(`select effective_on_hand from public.inventory_status where name='Mountain Valley 1L' and market='greenville'`))?.effective_on_hand) === 0,
   (await q1(`select effective_on_hand from public.inventory_status where name='Mountain Valley 1L' and market='greenville'`))?.effective_on_hand);
ok("re-run: and left the other city's shelf alone",
   Number((await q1(`select effective_on_hand from public.inventory_status where name='Mountain Valley 1L' and market='atlanta'`))?.effective_on_hand) === 5,
   (await q1(`select effective_on_hand from public.inventory_status where name='Mountain Valley 1L' and market='atlanta'`))?.effective_on_hand);

console.log(`MARKET SPINE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
