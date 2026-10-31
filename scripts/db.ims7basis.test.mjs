// IMS7 — A PRICE SAYS WHAT KIND OF PRICE IT IS (0470), IN POSTGRES. Estimated · listed · quoted · actual (and scenario,
// kept). A researched price is listed (or quoted, or estimated) — never actual; what was recorded as actual before is
// flagged, never changed; the flag clears only when a person says the basis (or the cost is set again); nobody sets it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = readFileSync(join(ROOT, "supabase/migrations/0470_a_price_says_what_kind.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", ADMIN = "0f465000-0000-4000-8000-0000000000d4";
const db = await fullSchema({ before: "0470" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await q(`insert into auth.users (id, email) values ($1, 'admin@example.test')`, [ADMIN]);
await q(`update public.profiles set role = 'admin', tenant_id = $2 where id = $1`, [ADMIN, T1]);
const as = async (sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${ADMIN}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const mat = async (name, o = {}) => (await q1(`insert into public.std_materials (tenant_id, name, category, cost_cents, cost_unit, cost_basis, cost_source) values ($1, $2, 'seating', $3, 'each', $4, $5) returning id`,
  [T1, name, o.cents ?? null, o.basis ?? null, o.source ?? null])).id;
const fact = async (m, cls, cents, review = "accepted") => {
  const f = (await q1(`insert into public.std_asset_facts (tenant_id, material_id, field, value, unit, source_class, source_kind, source_ref, method) values ($1, $2, 'cost_cents', $3::jsonb, 'each', $4, $5, $6, $7) returning id`,
    [T1, m, String(cents), cls, cls === "ai_inference" ? "description" : "url", cls === "ai_inference" ? null : "https://shop.test/p", cls === "ai_inference" ? "inferred" : "quoted"])).id;
  if (review !== "pending") await q(`update public.std_asset_facts set review = $2 where id = $1`, [f, review]);
  return f;
};

// Before 0470: a researched listing accepted as "actual" (0462's rule), and a person's "actual (paid or quoted)".
const fromListing = await mat("From a listing", { cents: 189000, basis: "actual", source: "Fixture listing" });
await fact(fromListing, "supplier", 189000);
const typed = await mat("Typed as actual", { cents: 42000, basis: "actual", source: "Invoice 1142" });
const est = await mat("An estimate", { cents: 30000, basis: "estimated", source: "A guess" });
const scen = await mat("A scenario", { cents: 25000, basis: "scenario", source: "What-if" });
await db.exec(M);
await db.exec(M);
ok("0470 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0470%'`)).n === 2);
const row = (id) => q1(`select cost_cents, cost_basis, cost_source, cost_basis_flag from public.std_materials where id = $1`, [id]);
ok("nothing recorded is reinterpreted: the actuals are still actual, amounts and sources as they were", (await row(fromListing)).cost_basis === "actual" && (await row(fromListing)).cost_cents === 189000 && (await row(typed)).cost_source === "Invoice 1142");
ok("…and flagged for a person: from a published price, or the old \"paid or quoted\" choice", (await row(fromListing)).cost_basis_flag === "actual_from_a_listing" && (await row(typed)).cost_basis_flag === "actual_paid_or_quoted");
ok("…estimates and scenarios aren't flagged, and scenario is still a basis", (await row(est)).cost_basis_flag === null && (await row(scen)).cost_basis === "scenario" && (await row(scen)).cost_basis_flag === null);
ok("a second run flags nothing new (a cleared flag stays cleared)", await (async () => { await q(`update public.std_materials set cost_basis_flag = null where id = $1`, [typed]); await db.exec(M); return (await row(typed)).cost_basis_flag === null; })());

// The four bases, and only them (and scenario).
for (const b of ["estimated", "listed", "quoted", "actual", "scenario"]) ok(`basis '${b}' is allowed`, Array.isArray(await as(`update public.std_materials set cost_basis = $2 where id = $1 returning id`, [est, b])));
ok("…'paid' or anything else is refused", !!(await as(`update public.std_materials set cost_basis = 'paid' where id = $1`, [est])).error);
ok("a cost still needs its basis and its source (0461)", !!(await as(`update public.std_materials set cost_basis = null where id = $1`, [est])).error);

// Accepting a researched price: never actual.
const accept = async (cls) => { const m = await mat(`Accept ${cls}`); const f = await fact(m, cls, 50000, "pending"); const r = await as(`select public.std_accept_facts(array[$1::uuid], '{}', false) n`, [f]); return { r, row: await row(m) }; };
for (const [cls, want] of [["supplier", "listed"], ["manufacturer", "listed"], ["independent", "listed"], ["gt3", "quoted"], ["ai_inference", "estimated"]]) {
  const { r, row: x } = await accept(cls);
  ok(`a ${cls} price accepted: ${want}, never actual`, Array.isArray(r) && x.cost_basis === want && x.cost_cents === 50000, { r, x });
}
// The flag: a person clears it by saying the basis, or by setting the cost again — and can never set it.
ok("a person can't flag a cost", Array.isArray(await as(`update public.std_materials set cost_basis_flag = 'actual_from_a_listing' where id = $1 returning id`, [est])) && (await row(est)).cost_basis_flag === null);
ok("choosing the basis (Manage sends the flag cleared) clears it", Array.isArray(await as(`update public.std_materials set cost_basis = 'listed', cost_basis_flag = null where id = $1 returning id`, [fromListing])) && (await row(fromListing)).cost_basis_flag === null && (await row(fromListing)).cost_basis === "listed");
await q(`update public.std_materials set cost_basis_flag = 'actual_paid_or_quoted' where id = $1`, [typed]);
ok("…so does setting the amount or the source again", Array.isArray(await as(`update public.std_materials set cost_cents = 43000 where id = $1 returning id`, [typed])) && (await row(typed)).cost_basis_flag === null);
ok("…but saving something else leaves it flagged", await (async () => { await q(`update public.std_materials set cost_basis_flag = 'actual_paid_or_quoted' where id = $1`, [typed]); await as(`update public.std_materials set finishes = 'Oil' where id = $1`, [typed]); return (await row(typed)).cost_basis_flag === "actual_paid_or_quoted"; })());
ok("the flag is one of the two words, or none", !!(await q(`update public.std_materials set cost_basis_flag = 'whatever' where id = $1`, [typed]).catch((e) => ({ error: e.message }))).error);
console.log(`IMS7 — A PRICE SAYS WHAT KIND OF PRICE IT IS (0470, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
