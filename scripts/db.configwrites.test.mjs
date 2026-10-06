// WHAT ONLY AN OWNER OR ADMIN SEES, ONLY AN OWNER OR ADMIN CAN CHANGE — 0351, against a real
// Postgres, under the roles it governs.
//
// Every other check of a policy in this repo can be fooled the same way: run as the superuser, RLS
// never fires, and a policy that admits everybody passes exactly like one that admits nobody. So
// this suite runs each write AS somebody — `set role authenticated` with that person's uid, `anon`
// for a guest, and a `service_role` that bypasses RLS the way Supabase's does — against tables made
// by their own migrations (0048, 0062, 0129, 0130, 0134, 0144, 0176, 0196, 0250, 0260, 0285, and the
// member_benefits half of 0268, cut from its own text), held to production's column lists
// (supabase/schema.columns.json) before 0351 runs. The role gates are production's too: is_admin and
// is_staff from 0035, is_owner cut out of 0023, current_tenant out of 0040 — not switches.
//
// What it proves, in order: the finding was real (before 0351 a server could do all five); after it,
// codes and perks, plans and broadcasts are written by an owner or admin and refused to every other
// role; a product can still be 86'd by every crew role and changed in no other way — every one of
// its other columns tried, one at a time; set_market_live is the owner's alone, and is otherwise
// 0285's function to the character; the service role, the 4am reset and the SQL editor still write
// everything; and every role reads exactly what it read before.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const rows = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await rows(s, p))[0];
const mig = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
/** One statement cut out of a migration's own text — the definition production runs, not a copy of it. */
const cut = (f, re) => { const m = mig(f).match(re); if (!m) throw new Error(`${f}: ${re} matched nothing`); return m[0]; };
const T1 = "00000000-0000-0000-0000-000000000001";

const PEOPLE = {
  owner:         "10000000-0000-0000-0000-000000000001",
  admin:         "10000000-0000-0000-0000-000000000002",
  event_manager: "10000000-0000-0000-0000-000000000003",
  operator:      "10000000-0000-0000-0000-000000000004",
  contractor:    "10000000-0000-0000-0000-000000000005",
  server:        "10000000-0000-0000-0000-000000000006",
  member:        "10000000-0000-0000-0000-000000000007",
};
const CREW = ["event_manager", "operator", "contractor", "server"];   // staff (is_staff), not admin
const BOSSES = ["admin", "owner"];
const NAME = {
  owner: "the owner", admin: "an admin", event_manager: "an event manager", operator: "an operator",
  contractor: "a contractor", server: "a server", member: "a member", guest: "a guest", service: "the service role",
};

/** Run one statement as somebody: a person (authenticated, with their uid), a guest (anon, no uid),
 *  or the service role (the key the server routes hold — nobody behind it, RLS bypassed). */
const as = async (who, sql, params) => {
  const uid = PEOPLE[who] ?? "";
  const role = who === "guest" ? "anon" : who === "service" ? "service_role" : "authenticated";
  await db.query(`select set_config('test.uid', $1, false)`, [uid]);
  await db.exec(`set role ${role}`);
  try {
    const r = await db.query(sql, params);
    return { rows: r.rows, n: r.affectedRows ?? 0, err: null, detail: null };
  } catch (e) {
    return { rows: [], n: 0, err: String(e.message || e), detail: e.detail ?? null };
  } finally {
    // Inside a transaction a failed statement aborts it, and these would fail too; ROLLBACK then
    // restores both, which is all the callers that open one rely on.
    try { await db.exec(`reset role`); await db.query(`select set_config('test.uid', '', false)`); } catch { /* aborted */ }
  }
};

// ── 0 · the platform, as Supabase sets it up ───────────────────────────────────────────────────
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema auth, public to anon, authenticated, service_role;
  -- Everything made in public is granted to the API roles by name, so row level security is the only
  -- thing between a role and a row (scripts/drift.check.mjs, third rule). That is the claim on test.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create publication supabase_realtime;
  -- 0042's audit trail, which 0144 hangs promos on. What it records is not this file's question.
  create or replace function public.audit_row() returns trigger language plpgsql as $$
    begin return coalesce(new, old); end $$;

  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('${T1}');
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text, category text,
    area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null, applied_at timestamptz,
    recorded_at timestamptz not null default now(), applied_by uuid, applied_count int not null default 1,
    evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;

  -- people: a role (0031's seven), the is_admin mirror (0280) and a tenant (0040)
  create table public.profiles (
    id uuid primary key references auth.users(id),
    display_name text,
    founding_member boolean not null default false,
    is_admin boolean not null default false,
    role text not null default 'member'
      check (role in ('member','server','operator','event_manager','contractor','admin','owner')),
    tenant_id uuid references public.tenants(id) default '${T1}'
  );
  create table public.customers (
    id uuid primary key default gen_random_uuid(),
    user_id uuid unique,
    name text,
    email text,
    tenant_id uuid default '${T1}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table public.inventory_items (id uuid primary key default gen_random_uuid(), name text);
  create table public.content_items (id uuid primary key default gen_random_uuid());
  create table public.orders (
    id uuid primary key default gen_random_uuid(),
    items text[] not null,
    total_cents int not null default 0,
    created_at timestamptz not null default now()
  );
  -- markets and live_status as 0285 found them (db.market.test.mjs's list, read from production)
  create table public.markets (
    slug text primary key, name text, region text, timezone text,
    active boolean not null default true, created_at timestamptz not null default now(),
    office_price_cents int default 4500, office_min_gallons int default 3,
    office_window text default 'mon_0500_0800', office_notes text
  );
  insert into public.markets (slug, name, region) values ('greenville','Greenville','SC'), ('atlanta','Atlanta','GA');
  create table public.live_status (
    id int primary key default 1 check (id = 1), is_live boolean not null default false,
    preorder_lead_h int not null default 4, pay_at_pickup boolean not null default true,
    office_price_cents int not null default 4500, office_min_gallons int not null default 3
  );
  insert into public.live_status (id, is_live) values (1, true);
`);

// The gates, from their files: is_admin and is_staff are 0035's, is_owner 0023's, current_tenant 0040's.
await db.exec(mig("0035_admin_guard_fix.sql"));
await db.exec(cut("0023_roles.sql", /create or replace function public\.is_owner\(\)[\s\S]*?\$\$;/));
await db.exec(cut("0040_multitenant_foundation.sql", /create or replace function public\.current_tenant\(\)[\s\S]*?\$\$;/));

await db.exec(`insert into auth.users (id) values ${Object.values(PEOPLE).map((id) => `('${id}')`).join(", ")}`);
for (const [role, id] of Object.entries(PEOPLE)) {
  await db.query(`insert into public.profiles (id, display_name, role, is_admin) values ($1, $2, $3, $4)`,
    [id, NAME[role], role, BOSSES.includes(role)]);
}
for (const who of [...Object.keys(PEOPLE), "guest"]) {
  const g = (await as(who, `select public.is_staff() as s, public.is_admin() as a, public.is_owner() as o`)).rows[0];
  const want = { s: who !== "member" && who !== "guest", a: BOSSES.includes(who), o: who === "owner" };
  ok(`gates: ${NAME[who]} is ${JSON.stringify(want)} by production's own functions`, JSON.stringify(g) === JSON.stringify(want), g);
}

// ── 1 · the tables, made the way production made them, in production's order ──────────────────
await db.exec(mig("0048_mrr_and_event_pnl.sql"));          // subscription_plans
await db.exec(mig("0062_products.sql"));                   // products
await db.exec(mig("0129_sold_out.sql"));                   // the 86, and orders refuse a sold-out item
await db.exec(mig("0130_86_lifecycle.sql"));               // who and when, stamped; the 4am reset
await db.exec(mig("0134_tenant_enforcement.sql"));         // tenant isolation, products' included
await db.exec(mig("0144_promos_and_bulk.sql"));            // products.bulk_*
await db.exec(mig("0176_founding_members_benefits.sql"));  // member_benefits
await db.exec(`alter table public.customers add column if not exists vip_verified boolean not null default false;`);  // 0249
await db.exec(mig("0196_broadcasts.sql"));                 // broadcasts
await db.exec(mig("0250_founding_vip_perks.sql"));         // member_benefits.requires_vip
await db.exec(`alter table public.products add column if not exists econ_key text;`);                                 // 0256
await db.exec(mig("0260_admin_audit_trail.sql"));          // products' change log
await db.exec(cut("0268_activation_economics.sql", /-- ── the code engine learns a flat-amount kind[\s\S]*?(?=-- ── the funnel spine)/));
await db.exec(cut("0268_activation_economics.sql", /insert into public\.member_benefits[\s\S]*?;\n/));                 // GT3-5OFF
await db.exec(mig("0285_market_live_switch.sql"));         // set_market_live
await db.exec(`alter table public.markets add column if not exists offer_disclaimer text;
               alter table public.markets add column if not exists state text;`);                                    // 0286, 0296

const snap = JSON.parse(readFileSync(join(ROOT, "supabase/schema.columns.json"), "utf8"));
const colsOf = async (t) => (await rows(`select attname from pg_attribute where attrelid = ('public.' || $1)::regclass
  and attnum > 0 and not attisdropped order by attnum`, [t])).map((r) => r.attname);
for (const t of ["products", "member_benefits", "subscription_plans", "broadcasts", "markets"]) {
  const have = await colsOf(t);
  ok(`before 0351: ${t} has production's columns, in production's order`, JSON.stringify(have) === JSON.stringify(snap[t]), { have, prod: snap[t] });
}

// What each table holds, so every read rule has something to say no to: a retired code, a retired
// plan, a draft and a members-only broadcast, a drink off the menu. And one row per table per person
// for the delete tests, so a refusal and a success are both about a row that exists.
const ACTORS = [...CREW, "member", "guest", ...BOSSES, "service"];
await db.exec(`
  insert into public.member_benefits (scope, code, kind, percent, label, active) values ('code', 'OLD-10', 'percent_off', 10, 'Retired 10% code', false);
  insert into public.subscription_plans (key, label, price_cents, period_days, active) values ('retired', 'Retired plan', 1000, 14, false);
  insert into public.broadcasts (title, active, audience) values
    ('Sunday run is on', true, 'all'), ('Members: early pickup', true, 'members'), ('Draft: holiday hours', false, 'all');
  update public.products set active = false where slug = 'wild';
`);
for (const who of ACTORS) {
  await db.query(`insert into public.member_benefits (scope, code, kind, percent, label) values ('code', $1, 'percent_off', 5, $1)`, [`DEL-member_benefits-${who}`]);
  await db.query(`insert into public.subscription_plans (key, label) values ($1, $1)`, [`DEL-subscription_plans-${who}`]);
  await db.query(`insert into public.broadcasts (title, active) values ($1, false)`, [`DEL-broadcasts-${who}`]);
}

// ── what every role reads, and the policies that decide it — taken before 0351 ─────────────────
const TABLES = ["member_benefits", "subscription_plans", "broadcasts", "products"];
const KEY = { member_benefits: "label", subscription_plans: "key", broadcasts: "title", products: "slug" };
const READERS = ["guest", "member", ...CREW, ...BOSSES];
const reads = async () => {
  const out = {};
  for (const who of READERS) for (const t of TABLES) {
    const r = await as(who, `select ${KEY[t]} as k from public.${t} order by 1`);
    out[`${who} reads ${t}`] = r.err ? `ERROR ${r.err}` : r.rows.map((x) => x.k);
  }
  return out;
};
// The read side and the tenant side of every table's RLS: the two things 0351 must not move.
const keptPolicies = async () => rows(`select tablename, policyname, cmd, permissive, roles::text as roles, qual, with_check
  from pg_policies where tablename = any($1) and (cmd = 'SELECT' or permissive = 'RESTRICTIVE') order by 1, 2`, [TABLES]);
const fnShape = async () => q1(`select pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
  p.prosecdef, p.proconfig, p.provolatile, p.proacl::text as acl, l.lanname
  from pg_proc p join pg_language l on l.oid = p.prolang where p.proname = 'set_market_live'`);
const fnSrc = async () => (await q1(`select prosrc from pg_proc where proname = 'set_market_live'`)).prosrc;

const readsBefore = await reads();
const policiesBefore = await keptPolicies();
const shapeBefore = await fnShape();
const srcBefore = await fnSrc();
ok("before 0351: the read side has rules to compare (a select and a tenant isolation policy on each table but plans)",
  policiesBefore.filter((p) => p.cmd === "SELECT").length >= 4 && policiesBefore.filter((p) => p.policyname === "tenant isolation").length === 3,
  policiesBefore.map((p) => `${p.tablename}.${p.policyname}`));
ok("before 0351: a guest reads the menu but not the drink that is off it", readsBefore["guest reads products"].includes("rise") && !readsBefore["guest reads products"].includes("wild"));

// ── 2 · the finding, reproduced: before 0351 a server could do all five ─────────────────────────
// In one transaction, rolled back — so it is proven on the fixture and leaves no trace in it.
const P = async (slug) => q1(`select * from public.products where slug = $1`, [slug]);
const risePrice = (await P("rise")).price_cents;
await db.exec("begin");
const found = {
  code:   await as("server", `insert into public.member_benefits (scope, code, kind, percent, label) values ('code', 'CREW-FREE', 'percent_off', 100, 'Everything free')`),
  plan:   await as("server", `update public.subscription_plans set price_cents = 1 where key = 'coffee_6'`),
  price:  await as("server", `update public.products set price_cents = 1 where slug = 'rise'`),
  shout:  await as("server", `insert into public.broadcasts (title, active, audience) values ('Free coffee today, just say the word', true, 'all')`),
  dark:   await as("server", `select (public.set_market_live('greenville', false)).is_live as live`),
};
await db.exec("rollback");
ok("the finding, before 0351: a server could mint a 100%-off code", found.code.err === null && found.code.n === 1, found.code);
ok("the finding, before 0351: …reprice a membership plan", found.plan.err === null && found.plan.n === 1, found.plan);
ok("the finding, before 0351: …reprice a drink on the menu", found.price.err === null && found.price.n === 1, found.price);
ok("the finding, before 0351: …put a message in front of every customer", found.shout.err === null && found.shout.n === 1, found.shout);
ok("the finding, before 0351: …and take a city dark", found.dark.err === null && found.dark.rows[0]?.live === false, found.dark);
ok("the finding was rolled back — the fixture is as it was",
  (await P("rise")).price_cents === risePrice && (await q1(`select is_live from public.markets where slug = 'greenville'`)).is_live === null
  && (await q1(`select count(*)::int as n from public.member_benefits where code = 'CREW-FREE'`)).n === 0);

// ── 3 · 0351 ───────────────────────────────────────────────────────────────────────────────────
const SQL = mig("0351_config_writes_owner_admin.sql");
const first = await (async () => { try { await db.exec(SQL); return null; } catch (e) { return String(e.message || e); } })();
ok("0351 runs", first === null, first);

// ── 4 · reads, and the read and tenant rules, exactly as they were ─────────────────────────────
const readsAfter = await reads();
for (const k of Object.keys(readsBefore)) {
  ok(`reads unchanged: ${k}`, JSON.stringify(readsAfter[k]) === JSON.stringify(readsBefore[k]), { before: readsBefore[k], after: readsAfter[k] });
}
ok("reads unchanged: a guest still reads the live broadcast and nothing else of them",
  JSON.stringify(readsAfter["guest reads broadcasts"]) === JSON.stringify(["Sunday run is on"]), readsAfter["guest reads broadcasts"]);
ok("reads unchanged: a member still reads the active perks and codes, not the retired one",
  readsAfter["member reads member_benefits"].includes("$5 off — coupon card A (QR)") && !readsAfter["member reads member_benefits"].includes("Retired 10% code"));
ok("reads unchanged: a server still reads everything the crew manages — the retired code, the retired plan, the draft",
  readsAfter["server reads member_benefits"].includes("Retired 10% code") && readsAfter["server reads subscription_plans"].includes("retired")
  && readsAfter["server reads broadcasts"].includes("Draft: holiday hours") && readsAfter["server reads products"].includes("wild"));
ok("the read policies and the tenant isolation policies are byte-for-byte what they were",
  JSON.stringify(await keptPolicies()) === JSON.stringify(policiesBefore), await keptPolicies());

const writes = await rows(`select tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies
  where tablename = any($1) and permissive = 'PERMISSIVE' and cmd <> 'SELECT' order by 1, 2`, [TABLES]);
ok("the write policies are these six and no others",
  JSON.stringify(writes.map((w) => `${w.tablename}.${w.policyname}:${w.cmd}`)) === JSON.stringify([
    "broadcasts.broadcast admin write:ALL", "member_benefits.benefits admin write:ALL",
    "products.products admin delete:DELETE", "products.products admin insert:INSERT", "products.products staff update:UPDATE",
    "subscription_plans.sub_plans admin write:ALL"]), writes.map((w) => `${w.tablename}.${w.policyname}:${w.cmd}`));
ok("every write policy but the crew's door to a product asks is_admin(), and none asks is_staff()",
  writes.filter((w) => w.policyname !== "products staff update")
    .every((w) => [w.qual, w.with_check].filter(Boolean).every((x) => /is_admin\(\)/.test(x) && !/is_staff/.test(x))), writes);
ok("no staff write policy is left on any of the four", writes.every((w) => !/staff write/.test(w.policyname)));

// ── 5 · codes and perks, plans, broadcasts: the owner or an admin, and nobody else ─────────────
const CONFIG = {
  member_benefits: {
    what: "a discount code",
    insert: `insert into public.member_benefits (scope, code, kind, percent, label) values ('code', $1, 'percent_off', 100, $1)`,
    landed: `select count(*)::int as n from public.member_benefits where code = $1`,
    thing: "what the $5-off code takes off", value: (i) => 100000 + i,
    update: `update public.member_benefits set value_cents = $1 where code = 'GT3-5OFF'`,
    current: `select value_cents as v from public.member_benefits where code = 'GT3-5OFF'`,
    del: `delete from public.member_benefits where code = $1`,
  },
  subscription_plans: {
    what: "a membership plan",
    insert: `insert into public.subscription_plans (key, label, price_cents, period_days, active) values ($1, $1, 100, 14, true)`,
    landed: `select count(*)::int as n from public.subscription_plans where key = $1`,
    thing: "the 6-pack's price", value: (i) => 1 + i,
    update: `update public.subscription_plans set price_cents = $1 where key = 'coffee_6'`,
    current: `select price_cents as v from public.subscription_plans where key = 'coffee_6'`,
    del: `delete from public.subscription_plans where key = $1`,
  },
  broadcasts: {
    what: "a broadcast",
    insert: `insert into public.broadcasts (title, active, audience) values ($1, true, 'all')`,
    landed: `select count(*)::int as n from public.broadcasts where title = $1`,
    thing: "the live broadcast", value: (i) => `rewritten (${i})`,
    update: `update public.broadcasts set body = $1 where title = 'Sunday run is on'`,
    current: `select body as v from public.broadcasts where title = 'Sunday run is on'`,
    del: `delete from public.broadcasts where title = $1`,
  },
};
for (const [t, c] of Object.entries(CONFIG)) {
  for (const [i, who] of ACTORS.entries()) {
    const may = BOSSES.includes(who) || who === "service";
    const tag = `${t}-${who}`;
    const ins = await as(who, c.insert, [tag]);
    const landed = (await q1(c.landed, [tag])).n;
    if (may) ok(`${t}: ${NAME[who]} can add ${c.what}`, ins.err === null && landed === 1, ins);
    else ok(`${t}: ${NAME[who]} cannot add ${c.what}`, /row-level security/i.test(ins.err ?? "") && landed === 0, { ins, landed });

    const was = (await q1(c.current)).v;
    const val = c.value(i);
    const up = await as(who, c.update, [val]);
    const now = (await q1(c.current)).v;
    if (may) ok(`${t}: ${NAME[who]} can change ${c.thing}`, up.err === null && up.n === 1 && String(now) === String(val), { up, now });
    else ok(`${t}: ${NAME[who]} cannot change ${c.thing} — no row matches, nothing moves`, up.err === null && up.n === 0 && String(now) === String(was), { up, was, now });

    const gone = `DEL-${tag}`;
    const del = await as(who, c.del, [gone]);
    const left = (await q1(c.landed, [gone])).n;
    if (may) ok(`${t}: ${NAME[who]} can remove ${c.what}`, del.err === null && del.n === 1 && left === 0, { del, left });
    else ok(`${t}: ${NAME[who]} cannot remove ${c.what} — no row matches, it stays`, del.err === null && del.n === 0 && left === 1, { del, left });
  }
}

// ── 6 · products: every crew role can 86 one, and change nothing else about it ─────────────────
const MSG = /^Only an owner or admin can change a product — crew can 86 it\.$/;
const count = async (slug) => (await q1(`select count(*)::int as n from public.products where slug = $1`, [slug])).n;

for (const who of CREW) {
  const on = await as(who, `update public.products set sold_out = true where slug = 'rise'`);
  const r1 = await P("rise");
  ok(`products: ${NAME[who]} can 86 an item (the 86 board's write)`, on.err === null && on.n === 1 && r1.sold_out === true, on);
  ok(`products: …and the database stamps when, and who — ${NAME[who]}`, r1.sold_out_at !== null && r1.sold_out_by === PEOPLE[who], r1);
  const off = await as(who, `update public.products set sold_out = false where id = $1`, [r1.id]);   // by id, as the menu list sends it
  const r2 = await P("rise");
  ok(`products: ${NAME[who]} can bring it back on`, off.err === null && off.n === 1 && r2.sold_out === false && r2.sold_out_at === null && r2.sold_out_by === null, { off, r2 });
}
const logged = (await q1(`select count(*)::int as n from public.admin_audit where table_name = 'products' and actor = $1
  and summary like 'sold_out: false → true%'`, [PEOPLE.server])).n;
ok("products: a crew 86 is still on the change log (0260), under the person who did it", logged === 1, logged);

await as("server", `update public.products set sold_out = true where slug = 'dusk'`);
const refusedOrder = await (async () => { try { await db.query(`insert into public.orders (items) values (array['dusk'])`); return null; } catch (e) { return String(e.message); } })();
ok("products: a crew 86 still does what it is for — an order for the item is refused at the database (0129)", /just sold out/.test(refusedOrder ?? ""), refusedOrder);
await as("server", `update public.products set sold_out = false where slug = 'dusk'`);
ok("products: …and once it is back on, the order goes through",
  (await (async () => { try { await db.query(`insert into public.orders (items) values (array['dusk'])`); return true; } catch { return false; } })()) === true);

const tidePrice = (await P("tide")).price_cents;
for (const who of CREW) {
  for (const [what, set] of [["its price", "price_cents = 1"], ["its name", "name = 'TIDE (crew)'"], ["whether it is on the menu", "active = false"]]) {
    const before = await P("tide");
    const r = await as(who, `update public.products set ${set} where slug = 'tide'`);
    ok(`products: ${NAME[who]} cannot change ${what} — refused, in words`,
      MSG.test(r.err ?? "") && JSON.stringify(await P("tide")) === JSON.stringify(before), r);
  }
  const both = await as(who, `update public.products set sold_out = true, price_cents = 1 where slug = 'tide'`);
  const t = await P("tide");
  ok(`products: ${NAME[who]} cannot carry a price change in on an 86 — and the 86 does not land either`,
    MSG.test(both.err ?? "") && /price_cents/.test(both.detail ?? "") && t.sold_out === false && t.price_cents === tidePrice, { both, t });
  const ins = await as(who, `insert into public.products (slug, name, price_cents) values ($1, 'Crew special', 1)`, [`crew-${who}`]);
  ok(`products: ${NAME[who]} cannot add a product`, /row-level security/i.test(ins.err ?? "") && (await count(`crew-${who}`)) === 0, ins);
  const del = await as(who, `delete from public.products where slug = 'hunt'`);
  ok(`products: ${NAME[who]} cannot remove one — no row matches, it stays`, del.err === null && del.n === 0 && (await count("hunt")) === 1, del);
}

// Every column but the three, one at a time — the rule is the whole row, so it is tested as one.
const CREW_MAY = ["sold_out", "sold_out_at", "updated_at"];
const cols = await rows(`select column_name as c, data_type as t from information_schema.columns
  where table_schema = 'public' and table_name = 'products' order by ordinal_position`);
const another = (c, t) => ({
  boolean: `not coalesce(${c}, false)`,
  integer: `coalesce(${c}, 0) + 1`,
  text: c === "bulk_tier" ? `case when ${c} = 'brew' then 'premium' else 'brew' end` : `coalesce(${c}, '') || ' (crew)'`,
  ARRAY: `array_append(${c}, 'crew')`,
  "timestamp with time zone": `coalesce(${c}, now()) - interval '1 day'`,
  uuid: `gen_random_uuid()`,
})[t];
const guarded = cols.filter(({ c }) => !CREW_MAY.includes(c));
ok("products: the crew rule is tried on every other column production's products has (23)",
  guarded.length === 23 && guarded.length === snap.products.length - CREW_MAY.length && guarded.every(({ c, t }) => !!another(c, t)),
  guarded.filter(({ c, t }) => !another(c, t)));
const flowBefore = await P("flow");
for (const { c, t } of guarded) {
  const r = await as("server", `update public.products set ${c} = ${another(c, t)} where slug = 'flow'`);
  ok(`products: a server cannot change ${c}`, MSG.test(r.err ?? "") && new RegExp(`\\b${c}\\b`).test(r.detail ?? ""), r);
}
ok("products: …and after all of that, the drink is exactly as it was", JSON.stringify(await P("flow")) === JSON.stringify(flowBefore));
const claim = await as("server", `update public.products set sold_out = true, sold_out_by = $1 where slug = 'flow'`, [PEOPLE.owner]);
ok("products: a server cannot say somebody else 86'd it — who is stamped, never claimed", MSG.test(claim.err ?? "") && (await P("flow")).sold_out === false, claim);
const allowed = await as("server", `update public.products set sold_out = true, sold_out_at = now(), updated_at = now() where slug = 'flow'`);
ok("products: sold_out, sold_out_at and updated_at are the crew's to send", allowed.err === null && allowed.n === 1 && (await P("flow")).sold_out === true, allowed);
await as("server", `update public.products set sold_out = false where slug = 'flow'`);

for (const who of ["member", "guest"]) {
  const r = await as(who, `update public.products set sold_out = true where slug = 'rise'`);
  ok(`products: ${NAME[who]} cannot 86 anything — no row matches`, r.err === null && r.n === 0 && (await P("rise")).sold_out === false, r);
  const ins = await as(who, `insert into public.products (slug, name) values ($1, 'x')`, [`p-${who}`]);
  ok(`products: ${NAME[who]} cannot add a product`, /row-level security/i.test(ins.err ?? "") && (await count(`p-${who}`)) === 0, ins);
}

for (const who of BOSSES) {
  const price = who === "admin" ? 1100 : 1200;
  const r = await as(who, `update public.products set price_cents = $1, name = $2, active = true, econ_key = 'broth', bulk_price_cents = 1500 where slug = 'forge'`,
    [price, `FORGE (${who})`]);
  const f = await P("forge");
  ok(`products: ${NAME[who]} can change anything about a product`, r.err === null && r.n === 1 && f.price_cents === price && f.name === `FORGE (${who})` && f.econ_key === "broth", { r, f });
  const off = await as(who, `update public.products set active = false where slug = 'forge'`);
  ok(`products: ${NAME[who]} can take one off the menu`, off.err === null && (await P("forge")).active === false, off);
  await as(who, `update public.products set active = true where slug = 'forge'`);
  const n86 = await as(who, `update public.products set sold_out = true where slug = 'rise'`);
  ok(`products: ${NAME[who]} can 86 one too`, n86.err === null && (await P("rise")).sold_out_by === PEOPLE[who], n86);
  await as(who, `update public.products set sold_out = false where slug = 'rise'`);
  const ins = await as(who, `insert into public.products (slug, name, price_cents) values ($1, 'New', 900)`, [`new-${who}`]);
  ok(`products: ${NAME[who]} can add one`, ins.err === null && ins.n === 1 && (await count(`new-${who}`)) === 1, ins);
  const del = await as(who, `delete from public.products where slug = $1`, [`new-${who}`]);
  ok(`products: ${NAME[who]} can remove one`, del.err === null && del.n === 1 && (await count(`new-${who}`)) === 0, del);
}

// Nobody behind the write: every server route, the 4am reset, a migration, the SQL editor.
const svc = await as("service", `update public.products set price_cents = 1300, name = 'HUNT (route)' where slug = 'hunt'`);
ok("products: the service role still changes anything — no person, so the crew rule is not asked", svc.err === null && svc.n === 1 && (await P("hunt")).price_cents === 1300, svc);
const sIns = await as("service", `insert into public.products (slug, name, price_cents) values ('made-by-route', 'Route', 100)`);
const sDel = await as("service", `delete from public.products where slug = 'made-by-route'`);
ok("products: …adds and removes one", sIns.err === null && sIns.n === 1 && sDel.err === null && sDel.n === 1, { sIns, sDel });
const editor = await (async () => { try { await db.query(`update public.products set price_cents = 1400, line = 'Recovery' where slug = 'hunt'`); return null; } catch (e) { return String(e.message); } })();
ok("products: the SQL editor and a migration (the table's owner, no person) still change anything", editor === null && (await P("hunt")).price_cents === 1400, editor);
await as("server", `update public.products set sold_out = true where slug = 'rise'`);
await as("event_manager", `update public.products set sold_out = true where slug = 'dusk'`);
const reset = await (async () => { try { return (await q1(`select public.reset_daily_86s() as n`)).n; } catch (e) { return String(e.message); } })();
ok("products: the 4am reset (0130, pg_cron — no person) still clears every 86",
  reset === 2 && (await q1(`select count(*)::int as n from public.products where sold_out`)).n === 0, reset);

// ── 7 · a city goes live on the owner's word ───────────────────────────────────────────────────
const live = async (slug) => (await q1(`select is_live from public.markets where slug = $1`, [slug])).is_live;
for (const who of [...CREW, "admin", "member", "guest", "service"]) {
  for (const want of [true, false]) {
    const r = await as(who, `select (public.set_market_live('greenville', ${want})).is_live as live`);
    ok(`markets: ${NAME[who]} cannot ${want ? "put Greenville live" : "take Greenville offline"}`,
      /^Only an owner can put a city live or take it offline\.$/.test(r.err ?? "") && (await live("greenville")) === null, r);
  }
}
const dark = await as("owner", `select (public.set_market_live('greenville', false)).is_live as live`);
ok("markets: the owner can take Greenville offline", dark.err === null && dark.rows[0]?.live === false && (await live("greenville")) === false, dark);
const lit = await as("owner", `select (public.set_market_live('greenville', true)).is_live as live`);
ok("markets: …and put it live again", lit.err === null && lit.rows[0]?.live === true && (await live("greenville")) === true, lit);
await db.exec(`update public.markets set opens_on = current_date + 30 where slug = 'atlanta'`);
const early = await as("owner", `select public.set_market_live('atlanta', true)`);
ok("markets: the owner still cannot open a city before its opening date — the rest of 0285 holds", /^That market opens on /.test(early.err ?? "") && (await live("atlanta")) === null, early);
const nowhere = await as("owner", `select public.set_market_live('nowhere', true)`);
ok("markets: …and a city that does not exist is still named", /No such market: nowhere/.test(nowhere.err ?? ""), nowhere);

ok("markets: one set_market_live, not an overload beside the old one", (await q1(`select count(*)::int as n from pg_proc where proname = 'set_market_live'`)).n === 1);
const shapeAfter = await fnShape();
ok("markets: the same signature, security definer, search_path, volatility, language and grants as 0285's",
  JSON.stringify(shapeAfter) === JSON.stringify(shapeBefore), { before: shapeBefore, after: shapeAfter });
const srcAfter = await fnSrc();
const OWNER_LINE = /\n {2}if not public\.is_owner\(\) then raise exception 'Only an owner can put a city live or take it offline\.'; end if;/;
ok("markets: the body is 0285's to the character, plus the one line at its top",
  OWNER_LINE.test(srcAfter) && srcAfter.replace(OWNER_LINE, "") === srcBefore && srcAfter.indexOf("is_owner") < srcAfter.indexOf("is_staff"),
  srcAfter);

// ── 8 · the trigger's function is the trigger's alone, and it runs first ───────────────────────
for (const role of ["anon", "authenticated"]) {
  const can = (await q1(`select has_function_privilege($1, 'public.product_crew_86_only()', 'execute') as c`, [role])).c;
  ok(`grants: ${role} cannot call product_crew_86_only — it runs as its owner, for the trigger`, can === false, can);
}
const def = await q1(`select prosecdef, proconfig from pg_proc where proname = 'product_crew_86_only'`);
ok("grants: it runs as its owner with its search_path pinned", def?.prosecdef === true && (def?.proconfig ?? []).some((c) => /^search_path=public/.test(c)), def);
const order = (await rows(`select tgname from pg_trigger where tgrelid = 'public.products'::regclass and not tgisinternal
  and (tgtype & 2) = 2 and (tgtype & 16) = 16 order by tgname`)).map((r) => r.tgname);
ok("order: the crew rule is the first BEFORE UPDATE trigger on products, so it judges what the person sent",
  JSON.stringify(order) === JSON.stringify(["products_crew_86_only", "products_stamp_86", "products_touch"]), order);

// ── 9 · the file again ─────────────────────────────────────────────────────────────────────────
const policyCount = async () => (await q1(`select count(*)::int as n from pg_policies where tablename = any($1)`, [TABLES])).n;
const policiesOnce = await policyCount();
const again = await (async () => { try { await db.exec(SQL); return null; } catch (e) { return String(e.message || e); } })();
ok("twice: the whole file runs again", again === null, again);
ok("twice: the same policies, no more", (await policyCount()) === policiesOnce, await policyCount());
ok("twice: one crew trigger", (await q1(`select count(*)::int as n from pg_trigger where tgname = 'products_crew_86_only'`)).n === 1);
ok("twice: still refused, still 86-able",
  MSG.test((await as("server", `update public.products set price_cents = 1 where slug = 'rise'`)).err ?? "")
  && (await as("server", `update public.products set sold_out = true where slug = 'rise'`)).n === 1
  && (await as("server", `update public.products set sold_out = false where slug = 'rise'`)).n === 1);
ok("twice: one changelog row, said as a security change",
  JSON.stringify(await rows(`select category, area, shipped_on::text as d from public.changelog where title = 'Only owners and admins can change codes, plans, products and broadcasts'`))
    === JSON.stringify([{ category: "security", area: "Crew", d: "2026-10-06" }]));
ok("twice: the ledger says it ran, twice",
  (await q1(`select applied_count from public.schema_migrations where version = '0351_config_writes_owner_admin'`))?.applied_count === 2);

console.log(`CONFIG WRITES ARE AN OWNER'S OR ADMIN'S (0351): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
