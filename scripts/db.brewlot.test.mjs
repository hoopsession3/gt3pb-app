// A BREW NAMES ITS COFFEE — 0349, against a real Postgres.
//
// 0295's log_batch_consumption is cut out of its file and kept under another name, so every batch
// that names no lot can be drawn by both functions side by side: the change has to be invisible to
// them. Then the batches that do name one: the coffee off that lot, by weight or by the map; a shelf
// counted in bags, a shelf that is not coffee, a lot from the other city, a case of bottles. The two
// rules SQL restates from lib/brewMath — which line is the coffee, what a gram is — are held to the
// TypeScript: TO_GRAMS is read out of lib/brewMath.ts, and the coffee names come from the one list
// scripts/smoke.cjs runs the TypeScript rule over.
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
const raises = async (s, p) => { try { await db.query(s, p); return null; } catch (e) { return String(e.message || e); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;

await db.exec(`
  create schema if not exists auth;
  create role anon; create role authenticated;
  -- As Supabase sets it up: every function made in public is executable by anon and authenticated by
  -- an explicit grant, so "revoke ... from public" alone takes nothing away from either.
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true) <> 'off', true) $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$ select '${T1}'::uuid $$;
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text, category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null, applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid, applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null) returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note) values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 returning * into r; return r; end $$;
  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('${T1}');
  create table public.markets (slug text primary key, name text);
  insert into public.markets values ('greenville', 'Greenville'), ('atlanta', 'Atlanta');
  create table public.vendors (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T1}', name text not null);
  create table public.inventory_items (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T1}',
    name text not null, qty numeric, unit text, kind text, market text not null default 'greenville' references public.markets(slug));
  create table public.inventory_lots (
    id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T1}',
    market text not null default 'greenville' references public.markets(slug), item_name text not null, lot_code text,
    received_on date not null default current_date, qty_received numeric not null check (qty_received > 0), unit text,
    unit_cost_cents int, expense_id uuid, vendor_id uuid references public.vendors(id) on delete set null,
    notes text, created_by uuid, created_at timestamptz not null default clock_timestamp(), price_basis text);
  create table public.inventory_ledger (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T1}',
    item text not null, market text not null default 'greenville', kind text not null default 'confirm', qty numeric not null, note text,
    lot_id uuid references public.inventory_lots(id) on delete set null, batch_id uuid, inventory_item_id uuid,
    created_by uuid, created_at timestamptz not null default now());
  create table public.brew_recipes (id uuid primary key default gen_random_uuid(), name text not null, base_water_gal numeric not null default 2, ingredients jsonb not null default '[]');
  create table public.brew_batches (
    id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T1}',
    recipe_id uuid references public.brew_recipes(id) on delete set null, recipe_name text, batch_gal numeric not null default 2,
    scaled jsonb, status text not null default 'planned', market text not null default 'greenville' references public.markets(slug),
    coffee_lot text, brew_started_at timestamptz, consumption_logged_at timestamptz, consumption_gaps jsonb not null default '[]');
  grant select, insert, update on public.brew_batches to authenticated;
  grant select on public.inventory_lots, public.inventory_items, public.markets to authenticated;
  create table public.recipe_ingredient_map (
    id uuid primary key default gen_random_uuid(), ingredient text not null, market text references public.markets(slug),
    inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
    recipe_unit text, shelf_unit text, shelf_qty_per_recipe_unit numeric not null check (shelf_qty_per_recipe_unit > 0), basis text not null);
`);

// 0295, as production runs it before 0349: resolve_ingredient, and log_batch_consumption kept as
// log_batch_consumption_0295 so it survives 0349's create or replace and can be run side by side.
const src295 = readFileSync(join(ROOT, "supabase/migrations/0295_item_lifecycles.sql"), "utf8");
const fnText = (src, head, end) => { const s = src.indexOf(head); return s < 0 ? "" : src.slice(s, src.indexOf(end, s) + end.length); };
await db.exec(fnText(src295, "create or replace function public.resolve_ingredient(", "\n$$;"));
const lbc295 = fnText(src295, "create or replace function public.log_batch_consumption(", "end $$;");
ok("0295's log_batch_consumption was cut out of its file", /select l\.id into lot/.test(lbc295) && lbc295.endsWith("end $$;"), lbc295.length);
await db.exec(lbc295);
// …and its grants, as 0295 wrote them.
const grants295 = src295.match(/revoke all on function public\.log_batch_consumption\(uuid, boolean\) from public;\ngrant execute on function public\.log_batch_consumption\(uuid, boolean\) to authenticated;/);
ok("0295's grants were read from its file", !!grants295);
await db.exec(grants295?.[0] ?? "");
const anon295 = (await q1(`select has_function_privilege('anon', 'public.log_batch_consumption(uuid, boolean)', 'execute') as a`)).a;
ok("before 0349: a stranger may call the draw — 0295 revoked it from public, and anon holds it by name", anon295 === true, anon295);
await db.exec(lbc295.replace("function public.log_batch_consumption(", "function public.log_batch_consumption_0295("));

// ── the shelves, the lots, the recipes ─────────────────────────────────────────────────────────
const SPROUTS = (await q1(`insert into public.vendors (name) values ('Sprouts Farmers Market') returning id`)).id;
const shelf = async (name, unit, market, kind = "ingredient") =>
  (await q1(`insert into public.inventory_items (name, unit, kind, market) values ($1, $2, $3, $4) returning id`, [name, unit, kind, market])).id;
const lot = async (market, item, code, on, qty, unit) =>
  (await q1(`insert into public.inventory_lots (market, item_name, lot_code, received_on, qty_received, unit, vendor_id) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [market, item, code, on, qty, unit, SPROUTS])).id;

const A_COF = await shelf("Org Ethiopia Coffee (bulk)", "lb", "atlanta");
await shelf("Coffee 5 lb bag", "bag", "atlanta");
const A_NIB = await shelf("Yupik Organic Raw Cacao Nibs 2.2 lb", "each", "atlanta");
await shelf("Spring Water Case", "case", "atlanta");
await shelf("16 oz Bottle", "each", "atlanta", "packaging");
await shelf("Heat Gun", "each", "atlanta", "equipment");
const G_COF = await shelf("Org Ethiopia Coffee (bulk)", "lb", "greenville");
const G_COL = await shelf("Colombia Coffee (bulk)", "lb", "greenville");
const G_NIB = await shelf("Yupik Organic Raw Cacao Nibs 2.2 lb", "each", "greenville");

const L_OPEN = await lot("atlanta", "Org Ethiopia Coffee (bulk)", "OPENING-2026-09-06", "2026-09-06", 4, "lb");
const L_SPR = await lot("atlanta", "Org Ethiopia Coffee (bulk)", "SPROUTS-840214", "2026-09-06", 6, "lb");
const L_BAG = await lot("atlanta", "Coffee 5 lb bag", null, "2026-09-20", 2, "bag");
const L_NIB1 = await lot("atlanta", "Yupik Organic Raw Cacao Nibs 2.2 lb", null, "2026-09-01", 3, "each");
const L_NIB2 = await lot("atlanta", "Yupik Organic Raw Cacao Nibs 2.2 lb", null, "2026-09-25", 2, "each");
const L_BOT = await lot("atlanta", "16 oz Bottle", null, "2026-09-09", 48, "each");
const L_GUN = await lot("atlanta", "Heat Gun", null, "2026-09-09", 1, "each");
await lot("atlanta", "Spring Water Case", "SPROUTS-840214", "2026-09-06", 2, "case");
const L_GCOF = await lot("greenville", "Org Ethiopia Coffee (bulk)", null, "2026-09-10", 10, "lb");
const L_GCOL = await lot("greenville", "Colombia Coffee (bulk)", "COL-7", "2026-09-28", 5, "lb");

// The nibs, linked the way 0294 seeded Greenville's: 2.2 lb is in the bag's own name. Atlanta's too.
const NIBS = "Organic cacao nibs (mix with grounds)";
const NIB_F = 1 / (2.2 * 453.59237);
await db.query(`insert into public.recipe_ingredient_map (ingredient, market, inventory_item_id, recipe_unit, shelf_unit, shelf_qty_per_recipe_unit, basis)
  values ($1, 'greenville', $2, 'g', 'each', $3, 'stated in the name'), ($1, 'atlanta', $4, 'g', 'each', $3, 'stated in the name')`, [NIBS, G_NIB, NIB_F, A_NIB]);

const COFFEE = "Coarse-ground organic single-origin coffee";
const RISE = (await q1(`insert into public.brew_recipes (name, base_water_gal, ingredients) values ('GT3 Rise (OG)', 2, $1) returning id`, [JSON.stringify([
  { name: "Mountain Valley Spring Water", qty: 2, unit: "gal", scales: true }, { name: COFFEE, qty: 560, unit: "g", scales: true },
  { name: "Organic coconut water (add after filtration)", qty: 32, unit: "oz", scales: true }])])).id;
const FLOW = (await q1(`insert into public.brew_recipes (name, base_water_gal, ingredients) values ('GT3 Flow (OG)', 2, $1) returning id`, [JSON.stringify([
  { name: "Mountain Valley Spring Water", qty: 2, unit: "gal", scales: true }, { name: COFFEE, qty: 560, unit: "g", scales: true },
  { name: NIBS, qty: 160, unit: "g", scales: true }])])).id;
const scaledOf = async (recipe, gal) => {
  const r = await q1(`select base_water_gal, ingredients from public.brew_recipes where id = $1`, [recipe]);
  return JSON.stringify(r.ingredients.map((i) => ({ name: i.name, qty: (i.qty * gal) / Number(r.base_water_gal), unit: i.unit })));
};
const batch = async (recipe, market, { gal = 2, scaled = true } = {}) => (await q1(
  `insert into public.brew_batches (recipe_id, recipe_name, batch_gal, scaled, market) values ($1, (select name from public.brew_recipes where id = $1), $2, $3::jsonb, $4) returning id`,
  [recipe, gal, scaled ? await scaledOf(recipe, gal) : null, market])).id;
const ledgerOf = (b) => rows(`select item, qty, lot_id, inventory_item_id, kind, note from public.inventory_ledger where batch_id = $1 order by item, note`, [b]);

// ── 0 · BEFORE: what 0295 does with a batch whose coffee nobody can link ───────────────────────
const before = await batch(RISE, "atlanta");
const r0 = (await q1(`select public.log_batch_consumption($1) as r`, [before])).r;
ok("before 0349: an Atlanta Rise batch draws nothing — its coffee is a gap like the water", r0.drawn_count === 0 && r0.gaps.some((g) => g.ingredient === COFFEE), r0);

// Kept for the side by side: batches that name no lot, made BEFORE 0349 and drawn by both versions.
const twins = [];
for (const [recipe, market] of [[RISE, "atlanta"], [FLOW, "atlanta"], [FLOW, "greenville"], [RISE, "greenville"]]) {
  twins.push([await batch(recipe, market), await batch(recipe, market)]);
}

// ── 1 · 0349 ───────────────────────────────────────────────────────────────────────────────────
const SQL = readFileSync(join(ROOT, "supabase/migrations/0349_a_brew_names_its_coffee.sql"), "utf8");
await db.exec(SQL);

const col = await q1(`select data_type from information_schema.columns where table_name = 'brew_batches' and column_name = 'coffee_lot_id'`);
ok("the link: brew_batches.coffee_lot_id is a uuid", col?.data_type === "uuid", col);
const fk = await q1(`select confdeltype, confrelid::regclass::text as ref from pg_constraint where conrelid = 'public.brew_batches'::regclass and contype = 'f'
  and conkey = array[(select attnum from pg_attribute where attrelid = 'public.brew_batches'::regclass and attname = 'coffee_lot_id')]`);
ok("the link: it points at inventory_lots, and a lot that goes leaves the batch standing (on delete set null)", fk?.ref === "inventory_lots" && fk?.confdeltype === "n", fk);
ok("the link: indexed for 'which batches did this bag go into'", !!(await q1(`select 1 as x from pg_indexes where indexname = 'brew_batches_coffee_lot_idx'`)));

// ── 2 · the two rules, held to lib/brewMath ────────────────────────────────────────────────────
const bm = readFileSync(join(ROOT, "lib/brewMath.ts"), "utf8");
const table = bm.match(/const TO_GRAMS: Record<string, number> = \{([\s\S]*?)\};/);
const units = table ? [...table[1].matchAll(/([a-z]+):\s*([0-9.]+)/g)].map((m) => [m[1], Number(m[2])]) : [];
ok("grams: lib/brewMath's TO_GRAMS was read (13 units)", units.length === 13, units.length);
for (const [u, g] of units) {
  const got = (await q1(`select public.grams_per($1) as g`, [u])).g;
  ok(`grams: '${u}' is ${g} g in both languages`, got !== null && near(got, g), got);
  ok(`grams: '${u.toUpperCase()} ' reads the same, case and spacing aside`, near((await q1(`select public.grams_per($1) as g`, [` ${u.toUpperCase()} `])).g, g));
}
for (const u of ["gal", "case", "bag", "each", "fl oz", "", null]) {
  ok(`grams: '${u}' is not a weight — no number`, (await q1(`select public.grams_per($1) as g`, [u])).g === null);
}
const names = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/coffee-names.json"), "utf8")).cases;
ok("coffee: the shared list is there (at least 20 names)", names.length >= 20, names.length);
for (const [n, want] of names) ok(`coffee: is_coffee(${JSON.stringify(n)}) is ${want}`, (await q1(`select public.is_coffee($1) as c`, [n])).c === want);
ok("coffee: a null name is not coffee", (await q1(`select public.is_coffee(null) as c`)).c === false);

// ── 3 · the guard ──────────────────────────────────────────────────────────────────────────────
const g1 = await batch(RISE, "atlanta");
ok("guard: an Atlanta batch names an Atlanta coffee lot", (await raises(`update public.brew_batches set coffee_lot_id = $1 where id = $2`, [L_SPR, g1])) === null);
const cross = await raises(`update public.brew_batches set coffee_lot_id = $1 where id = $2`, [L_GCOF, g1]);
ok("guard: not a bag that came into Greenville — and it says which city is which", /That lot came into Greenville, and this batch is brewing in Atlanta/.test(cross ?? ""), cross);
const bottle = await raises(`update public.brew_batches set coffee_lot_id = $1 where id = $2`, [L_BOT, g1]);
ok("guard: not a case of bottles", /16 oz Bottle is packaging, not something a brew is made of/.test(bottle ?? ""), bottle);
ok("guard: not a heat gun", /Heat Gun is equipment/.test((await raises(`update public.brew_batches set coffee_lot_id = $1 where id = $2`, [L_GUN, g1])) ?? ""));
ok("guard: a lot not on file is refused in words", /That lot is not on file/.test((await raises(`update public.brew_batches set coffee_lot_id = gen_random_uuid() where id = $1`, [g1])) ?? ""));
ok("guard: the refusals left the lot it had", (await q1(`select coffee_lot_id from public.brew_batches where id = $1`, [g1])).coffee_lot_id === L_SPR);
ok("guard: moving the batch to Greenville while it names an Atlanta bag is refused",
  /That lot came into Atlanta, and this batch is brewing in Greenville/.test((await raises(`update public.brew_batches set market = 'greenville' where id = $1`, [g1])) ?? ""));
ok("guard: a batch inserted naming the other city's lot is refused too",
  /came into Greenville/.test((await raises(`insert into public.brew_batches (recipe_name, market, coffee_lot_id) values ('x', 'atlanta', $1)`, [L_GCOF])) ?? ""));
ok("guard: a batch inserted naming its own city's lot goes in",
  (await raises(`insert into public.brew_batches (recipe_name, market, coffee_lot_id) values ('x', 'greenville', $1)`, [L_GCOF])) === null);
// A shelf reclassified after the batch named it does not hold every later save of that batch hostage.
await db.query(`update public.inventory_items set kind = 'packaging' where id = $1`, [A_COF]);
ok("guard: a save that does not change the lot is not re-judged", (await raises(`update public.brew_batches set status = 'brewing' where id = $1`, [g1])) === null);
// The batch log writes the link back on every save once a lot is named — the same lot, unchanged.
ok("guard: nor is one that writes the same lot back", (await raises(`update public.brew_batches set coffee_lot_id = $1, status = 'ready' where id = $2`, [L_SPR, g1])) === null);
await db.query(`update public.inventory_items set kind = 'ingredient' where id = $1`, [A_COF]);
ok("guard: a lot can be un-named", (await raises(`update public.brew_batches set coffee_lot_id = null, coffee_lot = 'Colombia · roasted 6/20' where id = $1`, [g1])) === null);
// The trigger's function is no role's to call, and the trigger still runs for the crew.
await db.exec(`set role authenticated`);
const asCrew = await raises(`update public.brew_batches set coffee_lot_id = $1 where id = $2`, [L_SPR, g1]);
const crossCrew = await raises(`update public.brew_batches set coffee_lot_id = $1 where id = $2`, [L_GCOF, g1]);
await db.exec(`reset role`);
ok("guard: a signed-in crew member names a lot — the trigger runs without anyone holding EXECUTE on it", asCrew === null, asCrew);
ok("guard: and is refused the other city's", /came into Greenville/.test(crossCrew ?? ""), crossCrew);
const ex = await q1(`select has_function_privilege('authenticated', 'public.brew_coffee_lot_guard()', 'execute') as a, has_function_privilege('anon', 'public.brew_coffee_lot_guard()', 'execute') as b`);
ok("guard: no role may call the guard directly", ex.a === false && ex.b === false, ex);
const lbcx = await q1(`select has_function_privilege('authenticated', 'public.log_batch_consumption(uuid, boolean)', 'execute') as a, has_function_privilege('anon', 'public.log_batch_consumption(uuid, boolean)', 'execute') as b`);
ok("draw: the crew's to run — and, from 0349, not a stranger's", lbcx.a === true && lbcx.b === false, lbcx);

// ── 4 · the draw follows the lot named ─────────────────────────────────────────────────────────
const LB = 453.59237;
const draw = async (b, redo = false) => (await q1(`select public.log_batch_consumption($1, $2) as r`, [b, redo])).r;
const name = async (b, l) => db.query(`update public.brew_batches set coffee_lot_id = $1 where id = $2`, [l, b]);

// A — Atlanta Rise naming SPROUTS-840214, the newer of two lots received the same day.
const a = await batch(RISE, "atlanta");
await name(a, L_SPR);
const ra = await draw(a);
const la = await ledgerOf(a);
ok("lot: 560 g of coffee comes off the lot the batch names, by weight — 1.2346 lb", la.length === 1 && la[0].lot_id === L_SPR && near(la[0].qty, -560 / LB), la);
ok("lot: not the oldest lot on that shelf (OPENING, received the same day, logged first)", la[0].lot_id !== L_OPEN);
ok("lot: the row is on the shelf the lot is on, and says it came off the named lot",
  la[0].inventory_item_id === A_COF && la[0].item === "Org Ethiopia Coffee (bulk)" && /off the lot the batch names/.test(la[0].note) && la[0].kind === "use", la[0]);
ok("lot: the draw reports it with the lot, and the coffee is no longer a gap",
  ra.drawn_count === 1 && ra.drawn[0].lot_id === L_SPR && near(ra.drawn[0].shelf_qty, Math.round((560 / LB) * 1e6) / 1e6) && !ra.gaps.some((g) => g.ingredient === COFFEE), ra);
ok("lot: the water and the coconut water are still gaps, in 0295's words",
  ra.gaps.map((g) => g.why).every((w) => w === "nothing on any atlanta shelf is linked to this ingredient") && ra.gaps.length === 2, ra.gaps);

// B — the same batch with no lot named: the gap says what would draw it.
const b0 = await batch(RISE, "atlanta");
const rb = await draw(b0);
const cg = rb.gaps.find((g) => g.ingredient === COFFEE);
ok("no lot: the coffee is a gap that says no lot was named", rb.drawn_count === 0 && cg?.why === "no coffee lot named on the batch, and nothing on any atlanta shelf is linked to this ingredient", cg);

// C — a coffee shelf counted in bags: no weight to convert to, so it says so and draws nothing.
const c = await batch(RISE, "atlanta");
await name(c, L_BAG);
const rc = await draw(c);
const cgc = rc.gaps.find((g) => g.ingredient === COFFEE);
ok("bags: a coffee shelf counted in bags is not drawn by weight — and the gap says why",
  rc.drawn_count === 0 && cgc?.why === "the lot named on the batch is counted in bag, and g does not convert to it by weight" && cgc?.lot_id === L_BAG, cgc);
ok("bags: nothing came off the bag", (await ledgerOf(c)).length === 0);

// D — Flow naming a lot of NIBS as its coffee lot: the coffee is not drawn off a cacao shelf, and the
// nibs line, whose shelf it is, comes off that named lot instead of the oldest nibs.
const d = await batch(FLOW, "atlanta");
await name(d, L_NIB2);
const rd = await draw(d);
const ld = await ledgerOf(d);
ok("not coffee: a cacao shelf named as the coffee lot does not have coffee drawn off it",
  rd.gaps.find((g) => g.ingredient === COFFEE)?.why === "Yupik Organic Raw Cacao Nibs 2.2 lb is not a coffee shelf by its name, so the coffee was not drawn off it", rd.gaps);
ok("not coffee: the nibs line — that lot's shelf — comes off the named lot, at the map's rate",
  ld.length === 1 && ld[0].lot_id === L_NIB2 && near(ld[0].qty, -160 * NIB_F) && ld[0].inventory_item_id === A_NIB, ld);

// E — Flow naming the coffee lot: coffee off it by weight, the nibs off the OLDEST nibs as before.
const e = await batch(FLOW, "atlanta");
await name(e, L_SPR);
await draw(e);
const le = await ledgerOf(e);
ok("both: Flow's coffee off the named lot and its nibs off the oldest nibs lot, as 0295 did",
  le.length === 2 && le.some((x) => x.lot_id === L_SPR && near(x.qty, -560 / LB)) && le.some((x) => x.lot_id === L_NIB1 && near(x.qty, -160 * NIB_F)), le);

// F — the map already sends Greenville's coffee to the Ethiopia shelf, at a rate unlike weight's: the
// named lot on THAT shelf uses the map's rate; a named lot on another coffee shelf goes by weight.
await db.query(`insert into public.recipe_ingredient_map (ingredient, market, inventory_item_id, recipe_unit, shelf_unit, shelf_qty_per_recipe_unit, basis)
  values ($1, 'greenville', $2, 'g', 'lb', 0.002, 'test: a rate weight would never give')`, [COFFEE, G_COF]);
const f1 = await batch(RISE, "greenville");
await name(f1, L_GCOF);
await draw(f1);
const lf1 = await ledgerOf(f1);
ok("mapped: the named lot on the shelf the map points at is drawn at the map's rate",
  lf1.length === 1 && lf1[0].lot_id === L_GCOF && near(lf1[0].qty, -560 * 0.002) && lf1[0].inventory_item_id === G_COF, lf1);
const f2 = await batch(RISE, "greenville");
await name(f2, L_GCOL);
await draw(f2);
const lf2 = await ledgerOf(f2);
ok("mapped elsewhere: the batch said Colombia — Colombia it comes off, by weight, not the map's Ethiopia",
  lf2.length === 1 && lf2[0].lot_id === L_GCOL && lf2[0].inventory_item_id === G_COL && near(lf2[0].qty, -560 / LB), lf2);
const f3 = await batch(RISE, "greenville");
const rf3 = await draw(f3);
const lf3 = await ledgerOf(f3);
ok("mapped, nothing named: the map's shelf, its oldest lot, its rate — 0295's rule", lf3.length === 1 && lf3[0].lot_id === L_GCOF && near(lf3[0].qty, -560 * 0.002), lf3);
ok("mapped, nothing named: the draw says which lot it came off, as the named path does", rf3.drawn[0]?.lot_id === L_GCOF, rf3.drawn);
await db.query(`delete from public.recipe_ingredient_map where ingredient = $1`, [COFFEE]);

// G — a batch with no stored list falls back to the recipe, scaled: 4 gal is 1120 g.
const g = await batch(RISE, "atlanta", { gal: 4, scaled: false });
await name(g, L_SPR);
await draw(g);
ok("recipe: a batch with no stored list draws the recipe's coffee scaled to its size — 1120 g", near((await ledgerOf(g))[0]?.qty, -1120 / LB), await ledgerOf(g));

// H — a recipe line in ounces (weight: this is coffee) converts exactly: 16 oz is a pound.
const h = await batch(RISE, "atlanta");
await db.query(`update public.brew_batches set scaled = $1::jsonb where id = $2`, [JSON.stringify([{ name: COFFEE, qty: 16, unit: "oz" }]), h]);
await name(h, L_SPR);
await draw(h);
ok("ounces: 16 oz of coffee is exactly one pound off the shelf", near((await ledgerOf(h))[0]?.qty, -1), await ledgerOf(h));

// I — the guards around the draw are 0295's.
ok("again: a batch already logged is refused, in 0295's words", /already logged on .* twice/.test((await raises(`select public.log_batch_consumption($1)`, [a])) ?? ""));
await draw(a, true);
ok("again: p_redo draws again, off the same named lot", (await ledgerOf(a)).filter((x) => x.lot_id === L_SPR).length === 2);
await db.exec(`set test.staff = 'off'`);
ok("staff only, still", /staff only/.test((await raises(`select public.log_batch_consumption($1)`, [b0])) ?? ""));
await db.exec(`set test.staff = 'on'`);

// J — a lot that goes leaves the batch standing, its words kept.
const j = await batch(RISE, "atlanta");
const L_GONE = await lot("atlanta", "Org Ethiopia Coffee (bulk)", "GONE-1", "2026-09-30", 1, "lb");
await db.query(`update public.brew_batches set coffee_lot_id = $1, coffee_lot = 'Org Ethiopia Coffee (bulk), lot GONE-1' where id = $2`, [L_GONE, j]);
await db.query(`delete from public.inventory_lots where id = $1`, [L_GONE]);
const jr = await q1(`select coffee_lot_id, coffee_lot from public.brew_batches where id = $1`, [j]);
ok("gone: deleting a lot un-links the batch and keeps what it said", jr.coffee_lot_id === null && jr.coffee_lot === "Org Ethiopia Coffee (bulk), lot GONE-1", jr);

// ── 5 · side by side: a batch that names no lot is drawn exactly as 0295 drew it ───────────────
const without = (o, k) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
const strip = (r) => ({
  drawn: r.drawn.map((x) => without(x, "lot_id")),
  gaps: r.gaps.map((x) => ({ ...x, why: x.ingredient === COFFEE ? "(coffee)" : x.why })),
  drawn_count: r.drawn_count, gap_count: r.gap_count,
});
const rowsOf = async (b) => (await ledgerOf(b)).map((x) => without(x, "note"));
for (const [x, y] of twins) {
  const old = await q1(`select public.log_batch_consumption_0295($1) as r`, [x]);
  const now = await q1(`select public.log_batch_consumption($1) as r`, [y]);
  const tag = (await q1(`select recipe_name || ' in ' || market as t from public.brew_batches where id = $1`, [x])).t;
  ok(`same: ${tag} — 0295 and 0349 draw the same lines, the same amounts, off the same lots`, JSON.stringify(strip(old.r)) === JSON.stringify(strip(now.r)), [strip(old.r), strip(now.r)]);
  ok(`same: ${tag} — the same ledger rows`, JSON.stringify(await rowsOf(x)) === JSON.stringify(await rowsOf(y)), [await rowsOf(x), await rowsOf(y)]);
  const cw = now.r.gaps.find((g2) => g2.ingredient === COFFEE)?.why;
  ok(`same: ${tag} — only the coffee's gap reads differently, and only to say a lot would draw it`,
    cw === undefined || /^no coffee lot named on the batch, and nothing on any (atlanta|greenville) shelf is linked to this ingredient$/.test(cw), cw);
}

// ── 6 · the file again ─────────────────────────────────────────────────────────────────────────
const again = await (async () => { try { await db.exec(SQL); return null; } catch (e) { return String(e.message || e); } })();
ok("twice: the whole file runs again", again === null, again);
ok("twice: one guard trigger", (await rows(`select 1 from pg_trigger where tgrelid = 'public.brew_batches'::regclass and tgname = 'brew_coffee_lot_guard'`)).length === 1);
ok("twice: one changelog row", (await q1(`select count(*)::int as n from public.changelog where title = 'A brew names the coffee it was made from'`)).n === 1);
ok("twice: the ledger says it ran, twice", (await q1(`select applied_count from public.schema_migrations where version = '0349_a_brew_names_its_coffee'`))?.applied_count === 2);
ok("twice: still one log_batch_consumption with two arguments", (await rows(`select 1 from pg_proc where proname = 'log_batch_consumption'`)).length === 1);

console.log(`A BREW NAMES ITS COFFEE (0349): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
