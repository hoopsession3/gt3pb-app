// R39 — A CHECKOUT'S KEY IS KEPT AS LONG AS IT CAN MATTER (0439), IN POSTGRES (2026-10-19 — the fresh audit's
// API11-12; Ryan: "Keep working to improve to a 10").
//
// The whole schema to 0438 is loaded, then 0439 — twice. checkout_claims (0371) holds keys of every age and state; the
// sweep is run and what it leaves is read: a settled key goes after 90 days, a key a check closed having found nothing
// after 7, and a key whose outcome isn't settled — started, charged, unknown — never, however old. No API role may run
// it. Every key is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M439 = readFileSync(join(ROOT, "supabase/migrations/0439_a_checkouts_key_is_kept_as_long_as_it_can_matter.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const t0 = Date.now();
const db = await fullSchema({ before: "0439" });
console.log(`the schema to 0438 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
const as = async (role, sql) => {
  await db.exec(`select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try { const r = await db.query(sql); return { rows: r.rows, error: null, code: null }; }
  catch (e) { return { rows: [], error: String(e.message || e).split("\n")[0], code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role; alter role service_role bypassrls;`);

ok("before 0439: no sweep", (await q1(`select to_regprocedure('public.sweep_checkout_claims()') is null as v`)).v === true);
await db.exec(M439);
await db.exec(M439);
ok("0439 twice: recorded (applied twice), one function and one index — nothing made twice",
  (await q1(`select applied_count::int n from public.schema_migrations where version like '0439%'`)).n === 2
  && (await q1(`select count(*)::int n from pg_proc where proname = 'sweep_checkout_claims'`)).n === 1
  && (await q1(`select count(*)::int n from pg_indexes where tablename = 'checkout_claims' and indexname = 'checkout_claims_settled_idx'`)).n === 1);

// Keys of every age and state, as lib/chargeOnce leaves them.
const day = 864e5;
const keys = [
  // [key, state, amount_cents, answer, days old]
  ["made-up-key-done-old-0001", "done", 600, { ok: true, paid: true }, 91],          // settled, past 90 days: goes
  ["made-up-key-done-new-0002", "done", 600, { ok: true, paid: true }, 89],          // settled, within 90: stays
  ["made-up-key-check-old-0003", "done", 0, { ok: false, checked: true, charged: false }, 8],   // a check that found nothing, past 7: goes
  ["made-up-key-check-new-0004", "done", 0, { ok: false, checked: true, charged: false }, 6],   // …within 7: stays
  ["made-up-key-free-old-00005", "done", 0, { ok: true, paid: false }, 30],          // settled at $0, not a check, within 90: stays
  ["made-up-key-unknown-0006", "unknown", 1500, null, 400],                           // outcome unknown, however old: stays
  ["made-up-key-started-0007", "started", 1500, null, 400],                           // started, however old: stays
  ["made-up-key-charged-0008", "charged", 1500, null, 400],                           // charged, however old: stays
];
for (const [k, state, cents, answer, old] of keys) {
  const at = new Date(Date.now() - old * day).toISOString();
  await q(`insert into public.checkout_claims (idempotency_key, channel, card, amount_cents, state, answer, created_at, updated_at) values ($1, 'cups', true, $2, $3, $4, $5, $5)`,
    [k, cents, state, answer === null ? null : JSON.stringify(answer), at]);
}
const left = async () => (await q(`select idempotency_key k from public.checkout_claims order by idempotency_key`)).map((r) => r.k);

const anon = await as("anon", `select public.sweep_checkout_claims() n`);
const authed = await as("authenticated", `select public.sweep_checkout_claims() n`);
ok("no API role may run the sweep: signed out and signed in are refused (42501), and nothing goes",
  anon.code === "42501" && authed.code === "42501" && (await left()).length === keys.length, { anon, authed });
ok("…refused by the function itself, not only by the table under it: neither role may execute it; the server's role may",
  (await q1(`select has_function_privilege('anon', 'public.sweep_checkout_claims()', 'execute') a, has_function_privilege('authenticated', 'public.sweep_checkout_claims()', 'execute') u,
    has_function_privilege('service_role', 'public.sweep_checkout_claims()', 'execute') s`)).a === false
  && (await q1(`select has_function_privilege('authenticated', 'public.sweep_checkout_claims()', 'execute') u`)).u === false
  && (await q1(`select has_function_privilege('service_role', 'public.sweep_checkout_claims()', 'execute') s`)).s === true);

const swept = await as("service_role", `select public.sweep_checkout_claims() n`);
const after = await left();
ok("the sweep, as the server's role: two keys go — the settled one past 90 days, and the check past 7 that found nothing",
  swept.error === null && swept.rows[0].n === 2 && !after.includes("made-up-key-done-old-0001") && !after.includes("made-up-key-check-old-0003"), { swept, after });
ok("…and the rest stay: a settled key within 90 days, a check within 7, a $0 order that was no check",
  ["made-up-key-done-new-0002", "made-up-key-check-new-0004", "made-up-key-free-old-00005"].every((k) => after.includes(k)), after);
ok("…and no key whose outcome isn't settled ever goes, however old — started, charged, unknown: a payment a person may still settle",
  ["made-up-key-unknown-0006", "made-up-key-started-0007", "made-up-key-charged-0008"].every((k) => after.includes(k)), after);
ok("a second sweep finds nothing more", (await as("service_role", `select public.sweep_checkout_claims() n`)).rows[0].n === 0 && (await left()).length === after.length);
ok("the sweep's own read is on the settled keys' age (a partial index — the payment path's reads are by key, as before)",
  /\(updated_at\) WHERE \(state = 'done'::text\)/i.test((await q1(`select indexdef d from pg_indexes where indexname = 'checkout_claims_settled_idx'`)).d));

console.log(`\nR39 — 0439, the checkout keys' sweep, in Postgres: ${pass} passed, ${fail} failed`);
await db.close?.();
if (fail) process.exit(1);
