// AN 86 IS FOR ONE CITY — 0408, run in Postgres (Release 3 of the Today, Command, Audit & Catalog audit; the fourth of the
// crew's database rules. Ryan, 2026-10-15: "Pass: its city. Catalog: all").
//
// The finding, as a sentence: products have no city, so an 86 at one truck took the item off every city's menu — the day
// a second city pours, Greenville running out of oat milk would sell Atlanta out of every oat drink. What is run here is
// the whole schema up to 0407, then 0408 — twice — and the Pass's 86 as the roles that call it: who may, for which city
// and which tenant's products; the order's own refusal for the order's city (its stop's, its event's, else the founding
// city); the change log's line for each; the 4 am reset; and the realtime publication.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL408 = readFileSync(join(ROOT, "supabase/migrations/0408_an_86_is_for_one_city.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "0c408000-0000-4000-8000-0000000000f2";
const OWNER = "0c408000-0000-4000-8000-0000000000c1";
const SERVER = "0c408000-0000-4000-8000-0000000000c2";
const MEMBER = "0c408000-0000-4000-8000-0000000000c3";

const t0 = Date.now();
const db = await fullSchema({ before: "0408" });
console.log(`the schema to 0407 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const n = async (s, p) => Number((await q1(s, p)).n);
const raises = async (s, p) => { try { await q(s, p); return null; } catch (e) { return String(e.message || e); } };
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
const set86 = (uid, product, market, out) => as(uid, `select public.set_eighty_six($1, $2, $3) r`, [product, market, out]);

await db.exec(`begin; set local gt3.allow_second_tenant = 'on';
  insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar'); commit;`);
for (const [id, role] of [[OWNER, "owner"], [SERVER, "server"], [MEMBER, "member"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, `Made-up ${role}`]);
}
const product = async (slug, name, tenant = T1, active = true) => (await q1(
  `insert into public.products (slug, name, price_cents, active, tenant_id) values ($1, $2, 600, $3, $4) returning id`, [slug, name, active, tenant])).id;
const OAT = await product("oat-test", "OAT TEST");
const RISE = await product("rise-test", "RISE TEST");
const OFF = await product("off-test", "OFF TEST", T1, false);
const THEIRS = await product("theirs-test", "THEIRS TEST", T2);
const GVL = (await q1(`insert into public.stops (name, starts_at, market) values ('Main St', now() + interval '1 hour', 'greenville') returning id`)).id;
const ATL = (await q1(`insert into public.stops (name, starts_at, market) values ('Ponce City', now() + interval '1 hour', 'atlanta') returning id`)).id;
const ATL_EVENT = (await q1(`insert into public.events (title, market, tenant_id) values ('Made-up Atlanta pop-up', 'atlanta', $1) returning id`, [T1])).id;
// An order, as the database is asked for one: the error it refuses with, or null.
const order = (items, where = {}) => raises(`insert into public.orders (items, total_cents, stop_id, event_id) values ($1::text[], 600, $2, $3)`,
  [items, where.stop ?? null, where.event ?? null]);

ok("before 0408 there is no city to 86 in", (await q1(`select to_regclass('public.product_86') r`)).r === null);

// ── 0408 ──
await db.exec(SQL408);
ok("product_86: row security on, and only the database writes it — nobody may insert, change or delete a row directly",
  (await q1(`select relrowsecurity r from pg_class where oid = 'public.product_86'::regclass`)).r === true
    && (await q1(`select has_table_privilege('anon', 'public.product_86', 'insert') a, has_table_privilege('authenticated', 'public.product_86', 'insert') b,
        has_table_privilege('authenticated', 'public.product_86', 'update') c, has_table_privilege('authenticated', 'public.product_86', 'delete') d`)).a === false
    && Object.values(await q1(`select has_table_privilege('authenticated', 'public.product_86', 'insert') b, has_table_privilege('authenticated', 'public.product_86', 'update') c,
        has_table_privilege('authenticated', 'public.product_86', 'delete') d`)).every((v) => v === false));
ok("set_eighty_six is the crew's to call — not a guest's", (await q1(`select has_function_privilege('anon', 'public.set_eighty_six(uuid, text, boolean)', 'execute') a,
  has_function_privilege('authenticated', 'public.set_eighty_six(uuid, text, boolean)', 'execute') b`)).a === false);

// ── who may ──
const crewOut = await set86(SERVER, OAT, "greenville", true);
ok("anyone on the crew can 86 an item in a city — the Pass's 86 board always was the crew's", crewOut.error === null && crewOut.rows[0]?.r?.ok === true, crewOut);
const row = await q1(`select market, sold_out_by, sold_out_at is not null s from public.product_86 where product_id = $1`, [OAT]);
ok("…and the row says the city, when, and who", row?.market === "greenville" && row?.sold_out_by === SERVER && row?.s === true, row);
ok("…and products.sold_out — every city — is not touched", (await q1(`select sold_out from public.products where id = $1`, [OAT])).sold_out === false);
const memberTry = await set86(MEMBER, RISE, "greenville", true);
ok("a customer cannot 86 anything", /not_allowed/.test(memberTry.error ?? ""), memberTry);
const guestTry = await set86(null, RISE, "greenville", true);
ok("…nor can a guest", !!guestTry.error, guestTry);
const writeTry = await as(SERVER, `insert into public.product_86 (product_id, market) values ($1, 'atlanta')`, [RISE]);
ok("…and the crew cannot write the table past it", !!writeTry.error, writeTry);
ok("a city that is not one of ours is refused, in words", (await set86(SERVER, RISE, "nowhere", true)).rows[0]?.r?.code === "no_market");
ok("an item no longer in the Catalog is refused, in words", (await set86(SERVER, "0c408000-0000-4000-8000-00000000dead", "greenville", true)).rows[0]?.r?.code === "no_product");
ok("another tenant's item is refused as if it were not there — an 86 cannot reach another business's menu",
  (await set86(SERVER, THEIRS, "greenville", true)).rows[0]?.r?.code === "no_product" && await n(`select count(*) n from public.product_86 where product_id = $1`, [THEIRS]) === 0);
ok("86'ing it again in the same city is the same 86 — not a second row", (await set86(SERVER, OAT, "greenville", true)).rows[0]?.r?.ok === true
  && await n(`select count(*) n from public.product_86 where product_id = $1`, [OAT]) === 1);

// ── the order's city ──
ok("an order at a Greenville stop is refused — in 0129's words", /^OAT TEST just sold out — remove it and try again\.$/.test(await order(["oat-test"], { stop: GVL }) ?? ""));
ok("the same drink at an Atlanta stop goes through: Greenville's 86 is Greenville's", await order(["oat-test"], { stop: ATL }) === null);
ok("an order for an Atlanta event goes through too — its city is the event's", await order(["oat-test"], { event: ATL_EVENT }) === null);
ok("an order with no stop and no event is the founding city's, and refused there", /just sold out/.test(await order(["oat-test"]) ?? ""));
ok("an item 86'd nowhere still goes through everywhere", await order(["rise-test"], { stop: GVL }) === null && await order(["rise-test"]) === null);
await as(SERVER, `update public.products set sold_out = true where id = $1`, [RISE]);
ok("the Catalog's 86 is still every city: refused in Atlanta as in Greenville", /just sold out/.test(await order(["rise-test"], { stop: ATL }) ?? "")
  && /just sold out/.test(await order(["rise-test"], { stop: GVL }) ?? ""));
ok("an item off the menu is still refused (0129)", /just sold out/.test(await order(["off-test"], { stop: ATL }) ?? ""));

// ── who can see it ──
const guestSees = await as(null, `select market from public.product_86 where product_id = $1`, [OAT]);
ok("a guest's menu reads the city's 86 — it says SOLD OUT from it", guestSees.error === null && guestSees.rows.length === 1 && guestSees.rows[0].market === "greenville", guestSees);
await q(`insert into public.product_86 (product_id, market) values ($1, 'atlanta')`, [THEIRS]);
const crewSees = await as(SERVER, `select product_id from public.product_86 where product_id = $1`, [THEIRS]);
ok("another tenant's 86 is not read by this one — a row is seen where its product is", crewSees.error === null && crewSees.rows.length === 0, crewSees);
await q(`insert into public.product_86 (product_id, market) values ($1, 'greenville')`, [OFF]);
const guestOff = await as(null, `select product_id from public.product_86 where product_id = $1`, [OFF]);
ok("…and an item off the menu, which a guest cannot read, has no 86 a guest can read either", guestOff.error === null && guestOff.rows.length === 0, guestOff);
await q(`delete from public.product_86 where product_id = any($1::uuid[])`, [[THEIRS, OFF]]);

// ── the change log ──
const logged = await q(`select actor, action, summary, row_pk, old_row->'sold_out' was, new_row->'sold_out' now, new_row->>'market' city
  from public.admin_audit where table_name = 'product_86' and row_pk = $1 order by id`, [OAT]);
ok("the change log has the city's 86, under the person who did it, in the shape the product's page reads",
  logged.length === 1 && logged[0].actor === SERVER && logged[0].action === "INSERT" && logged[0].summary === "sold_out: false → true · market: greenville"
    && logged[0].was === false && logged[0].now === true && logged[0].city === "greenville", logged);
const back = await set86(SERVER, OAT, "greenville", false);
ok("back on in the city: the row goes", back.rows[0]?.r?.ok === true && await n(`select count(*) n from public.product_86 where product_id = $1`, [OAT]) === 0, back);
ok("…the order goes through there again", await order(["oat-test"], { stop: GVL }) === null);
const logged2 = await q(`select actor, action, summary, old_row->'sold_out' was, new_row->'sold_out' now from public.admin_audit
  where table_name = 'product_86' and row_pk = $1 order by id`, [OAT]);
ok("…and the change log says it was put back, by whom", logged2.length === 2 && logged2[1].action === "DELETE" && logged2[1].actor === SERVER
  && logged2[1].summary === "sold_out: true → false · market: greenville" && logged2[1].was === true && logged2[1].now === false, logged2);
const crewLog = await as(SERVER, `select count(*) n from public.admin_audit where table_name = 'product_86'`);
const ownerLog = await as(OWNER, `select count(*) n from public.admin_audit where table_name = 'product_86'`);
ok("only an owner or admin reads the change log, as before (0260)", crewLog.error === null && Number(crewLog.rows[0]?.n) === 0
  && ownerLog.error === null && Number(ownerLog.rows[0]?.n) >= 2, { crewLog, ownerLog });

// ── the 4 am reset ──
await set86(SERVER, OAT, "greenville", true);
await set86(OWNER, OAT, "atlanta", true);
const cleared = Number((await q1(`select public.reset_daily_86s() n`)).n);
ok("the 4 am reset clears every city's 86s with the rest, and counts them", cleared === 3 && await n(`select count(*) n from public.product_86`) === 0
  && (await q1(`select sold_out from public.products where id = $1`, [RISE])).sold_out === false, { cleared });
ok("…each a line on the change log with nobody behind it — the page says 'the daily reset'",
  await n(`select count(*) n from public.admin_audit where table_name = 'product_86' and row_pk = $1 and action = 'DELETE' and actor is null`, [OAT]) === 2);

// ── live ──
ok("product_86 is in the realtime publication: an 86 flipped mid-rush reaches every open menu",
  await n(`select count(*) n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_86'`) === 1);

// ── a second run changes nothing ──
await set86(SERVER, OAT, "greenville", true);
const shape = async () => JSON.stringify([
  await q(`select product_id, market, sold_out_by from public.product_86 order by product_id, market`),
  await n(`select count(*) n from public.admin_audit where table_name = 'product_86'`),
  await n(`select count(*) n from pg_trigger where tgname = 'audit_product_86'`),
  await n(`select count(*) n from pg_policies where tablename = 'product_86'`),
  await n(`select count(*) n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'product_86'`),
  await n(`select count(*) n from public.changelog where title = 'An 86 at the truck is for its own city'`),
]);
const before = await shape();
await db.exec(SQL408);
const after = await shape();
ok("a second run changes nothing — the city's 86 that stands, stands", after === before && JSON.parse(after)[0].length === 1, { before, after });
ok("…and its grants are what they were: guests and the crew read, nobody writes",
  (await q1(`select has_table_privilege('anon', 'public.product_86', 'select') a, has_table_privilege('authenticated', 'public.product_86', 'insert') b`)).a === true
    && (await q1(`select has_table_privilege('authenticated', 'public.product_86', 'insert') b`)).b === false);

console.log(`AN 86 FOR ONE CITY (0408): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
