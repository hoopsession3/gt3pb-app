// A CARD IS CHARGED ONCE — 0371, executed from its file against a real Postgres.
//
// 0371 adds public.checkout_claims, the row /api/checkout writes for a checkout's idempotency key before it asks
// Square for money (lib/chargeOnce decides, lib/checkoutClaims reads and writes). The claims worth a database:
//
//   1. Before the paste, lib/checkoutClaims reports the table MISSING — the one error lib/chargeOnce forgives,
//      by running the checkout without claims as it ran before them — not a failure that refuses every order.
//   2. The table as production will have it, under production's rules: Supabase grants every new table to anon
//      and authenticated by default (modelled here with the same default privileges, and the same for
//      functions), so 0371 must take that back by name. RLS on, no policy; a browser can neither read a claim
//      nor write one; the service role — the routes' supabaseAdmin — can.
//   3. The key is unique and well-formed, and a state is one of four: the database, not the route, is what
//      makes two requests with one key unable to both be "the first".
//   4. Every branch scripts/chargeonce.test.mjs drives against a stand-in, driven again here through the REAL
//      lib/checkoutClaims against this table — PostgREST's shapes (to_jsonb timestamps, 23505 on a taken key,
//      an update that returns what it touched) standing in for supabase-js, nothing else.
//   5. It runs twice without harm: no error, no second changelog line, the ledger counts the re-run, and the
//      claims already written stay as they were.
// No Square and no Supabase: the Square in scripts/fixtures/chargeonce.mjs is a stand-in, every key made up.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { libLoader, branches, clock } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return `${e.code ?? ""} ${String(e.message || e)}`; } };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const as = async (role, s) => { try { await db.transaction(async (tx) => { await tx.exec(`set local role ${role}`); await tx.exec(s); }); return null; } catch (e) { return `${e.code ?? ""} ${String(e.message || e)}`; } };

const load = libLoader();
const C = load("lib/chargeOnce.ts"), SQ = load("lib/squareServer.ts"), I = load("lib/idempotency.ts"), CC = load("lib/checkoutClaims.ts");
ok("compiled: lib/checkoutClaims, lib/chargeOnce, lib/squareServer, lib/idempotency", typeof CC.checkoutClaims === "function" && typeof C.seenBefore === "function");

// ── PostgREST, for the five shapes lib/checkoutClaims uses, as the service role ────────────────────────
// from(t).select(cols).eq(…).maybeSingle() · insert(row) · update(values).eq(…).select(cols) · delete().eq(…)
// Rows come back as to_jsonb renders them — timestamps as text, jsonb as objects — which is what PostgREST
// sends; errors as { code, message }, never thrown. Each statement runs in its own transaction under `role`.
function postgrest(role = "service_role") {
  return {
    from(table) {
      const st = { table, op: "select", cols: "*", values: null, filters: [], single: false, returning: null };
      const b = {
        select(cols) { if (st.op === "select") st.cols = cols; else st.returning = cols; return b; },
        insert(row) { st.op = "insert"; st.values = row; return b; },
        update(values) { st.op = "update"; st.values = values; return b; },
        delete() { st.op = "delete"; return b; },
        eq(c, v) { st.filters.push([c, v]); return b; },
        maybeSingle() { st.single = true; return b; },
        then(resolve, reject) { return run(st).then(resolve, reject); },
      };
      return b;
    },
  };
  async function run(st) {
    const params = [];
    const p = (v) => { params.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v); return `$${params.length}`; };
    const ident = (c) => { if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`postgrest stand-in: column ${c}`); return c; };
    const cols = (s) => s.split(",").map((c) => ident(c.trim())).join(", ");
    let sql;
    if (st.op === "insert") {
      const keys = Object.keys(st.values).map(ident);
      sql = `insert into public.${ident(st.table)} (${keys.join(", ")}) values (${keys.map((k) => p(st.values[k])).join(", ")})`;
    } else if (st.op === "update") {
      sql = `update public.${ident(st.table)} set ${Object.keys(st.values).map((k) => `${ident(k)} = ${p(st.values[k])}`).join(", ")}`;
    } else if (st.op === "delete") {
      sql = `delete from public.${ident(st.table)}`;
    } else {
      sql = `select ${cols(st.cols)} from public.${ident(st.table)}`;
    }
    if (st.filters.length) sql += ` where ${st.filters.map(([c, v]) => `${ident(c)} = ${p(v)}`).join(" and ")}`;
    const wantRows = st.op === "select" || st.returning;
    if (st.returning) sql += ` returning ${cols(st.returning)}`;
    const wrapped = wantRows ? `with r as (${sql}) select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as rows from r` : sql;
    try {
      const res = await db.transaction(async (tx) => { await tx.exec(`set local role ${role}`); return tx.query(wrapped, params); });
      if (!wantRows) return { data: null, error: null };
      const rows = res.rows[0].rows;
      if (st.single) return rows.length > 1 ? { data: null, error: { code: "PGRST116", message: "multiple rows" } } : { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    } catch (e) {
      return { data: null, error: { code: e.code ?? "", message: String(e.message || e) } };
    }
  }
}

await db.exec(`
  -- Supabase's roles, and its defaults: every table and function made in public is granted to all three
  -- (measured in production for functions after 0366; the table default is why 0309's RLS gate exists).
  create role anon; create role authenticated; create role service_role bypassrls;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;

  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid,
    applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;
`);

const store = CC.checkoutClaims(postgrest());

// ── 1 · before the paste ─────────────────────────────────────────────────────────────────────────
{
  const r = await store.read("before-0371-key-0001");
  ok("before 0371: the read reports the table missing — not a failure", r.ok === false && r.missing === true, r);
  const c = await store.claim("before-0371-key-0001", { channel: "cups", card: true, amountCents: 1000 }, new Date().toISOString());
  ok("before 0371: so does the claim", c.ok === false && c.missing === true, c);
  const seen = await C.seenBefore(store, "before-0371-key-0001", true, () => Date.now(), async () => {});
  ok("before 0371: the checkout runs without claims, as it did before them", !("answer" in seen) && seen.claims === null, seen);
}

const sql = readFileSync(join(ROOT, "supabase/migrations/0371_a_card_is_charged_once.sql"), "utf8");
await db.exec(sql);
console.log("0371 executed against a real Postgres.\n");

// ── 2 · who can touch it ─────────────────────────────────────────────────────────────────────────
ok("RLS is on, with no policy", (await q1("select relrowsecurity as r from pg_class where oid = 'public.checkout_claims'::regclass")).r === true
  && (await q1("select count(*)::int as n from pg_policies where tablename = 'checkout_claims'")).n === 0);
for (const role of ["anon", "authenticated"]) {
  const priv = await q1(`select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"].map((p) => `has_table_privilege('${role}', 'public.checkout_claims', '${p}') as ${p}`).join(", ")}`);
  ok(`${role}: no privilege on it at all, though Supabase's default grants every new table`, Object.values(priv).every((v) => v === false), priv);
  ok(`${role}: a read is refused outright`, /^42501 /.test((await as(role, "select * from public.checkout_claims")) ?? ""));
  ok(`${role}: so is claiming a key — nobody can block another person's payment from a browser`,
    /^42501 /.test((await as(role, "insert into public.checkout_claims (idempotency_key, card) values ('browser-claimed-key-01', true)")) ?? ""));
}
ok("public: nothing either", (await q1("select has_table_privilege('public', 'public.checkout_claims', 'select') as s")).s === false);
ok("service_role (the routes' supabaseAdmin): reads and writes it",
  (await q1("select has_table_privilege('service_role', 'public.checkout_claims', 'select') and has_table_privilege('service_role', 'public.checkout_claims', 'insert') and has_table_privilege('service_role', 'public.checkout_claims', 'update') and has_table_privilege('service_role', 'public.checkout_claims', 'delete') as ok")).ok === true);
ok("it adds no function, so no function needs revoking", (await q1("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'record_migration'")).n === 0);

// ── 3 · what the table itself refuses ────────────────────────────────────────────────────────────
ok("a key shorter than 8 is refused (lib/squareServer.safeIdemKey's floor)", /^23514 /.test((await raises("insert into public.checkout_claims (idempotency_key, card) values ('1234567', true)")) ?? ""));
ok("a key longer than 45 is refused (Square's limit)", /^23514 /.test((await raises(`insert into public.checkout_claims (idempotency_key, card) values ('${"k".repeat(46)}', true)`)) ?? ""));
ok("a state that is not one of the four is refused", /^23514 /.test((await raises("insert into public.checkout_claims (idempotency_key, card, state) values ('state-check-key-01', true, 'paid')")) ?? ""));
ok("card is said, never assumed", /^23502 /.test((await raises("insert into public.checkout_claims (idempotency_key) values ('card-check-key-001')")) ?? ""));
{
  const at = new Date().toISOString();
  const a = await store.claim("unique-check-key-0001", { channel: "cups", card: true, amountCents: 1000 }, at);
  const b = await store.claim("unique-check-key-0001", { channel: "cups", card: true, amountCents: 1000 }, at);
  ok("one key, one claim: the second is told someone holds it (23505), and nothing is written twice",
    a.ok && a.claimed === true && b.ok && b.claimed === false && (await q1("select count(*)::int as n from public.checkout_claims where idempotency_key = 'unique-check-key-0001'")).n === 1, { a, b });
  const r = await store.read("unique-check-key-0001");
  ok("a new claim starts 'started', on the 'cups' channel, with what it is for", r.ok && r.claim.state === "started" && r.claim.card === true && r.claim.amount_cents === 1000 && typeof r.claim.updated_at === "string", r);
  const moved = await store.move("unique-check-key-0001", { state: "charged", paymentId: "pay_TEST-unique" }, new Date(Date.parse(at) + 1000).toISOString(), r.claim);
  const again = await store.move("unique-check-key-0001", { state: "unknown", note: "x" }, new Date(Date.parse(at) + 2000).toISOString(), r.claim);
  ok("a conditional move happens once: the second, holding the claim as it was, finds it moved and says so", moved === true && again === false
    && (await q1("select state, payment_id from public.checkout_claims where idempotency_key = 'unique-check-key-0001'")).state === "charged");
  await store.release("unique-check-key-0001");
  ok("release gives back only a claim still 'started' — a charged one stays", (await q1("select count(*)::int as n from public.checkout_claims where idempotency_key = 'unique-check-key-0001'")).n === 1);
  const answer = { status: 200, body: { ok: true, paid: true, paymentId: "pay_TEST-unique", amount: 1000, recorded: true, readyFrom: null, pickup: "At the truck" } };
  await store.move("unique-check-key-0001", { state: "done", answer, paymentId: "pay_TEST-unique" }, new Date(Date.parse(at) + 3000).toISOString());
  const done = await store.read("unique-check-key-0001");
  ok("the answer is kept as it was given, to be given again (jsonb orders keys its own way; the content is the same)",
    done.ok && done.claim.state === "done" && done.claim.status === 200 && canon(done.claim.answer) === canon(answer.body), done);
}

// ── 4 · every branch, against this table ─────────────────────────────────────────────────────────
const before = pass + fail;
const realFetch = globalThis.fetch;
await branches({ C, SQ, I, store, ok });
globalThis.fetch = realFetch;
const states = (await db.query("select state, count(*)::int as n from public.checkout_claims group by state order by state")).rows;
ok(`the branches ran here (${pass + fail - before} assertions), and left answered claims and unknown ones behind them`,
  pass + fail - before >= 45 && states.some((r) => r.state === "done") && states.some((r) => r.state === "unknown"), states);
{
  // The stale path reads the database's clock back, not the route's: a timestamp written by the route
  // comes back as Postgres renders it ("+00:00"), and the age is still read right.
  const now = clock("2026-10-11T18:00:00.000Z");
  await C.claimKey(store, "clock-check-key-0001", { channel: "cups", card: false, amountCents: 500 }, now, async () => {});
  const r = await store.read("clock-check-key-0001");
  ok("a claim's time comes back in Postgres's own form", /\+00:00$/.test(r.claim.updated_at) && Date.parse(r.claim.updated_at) === now(), r.claim.updated_at);
  const told = [];
  now.advance(C.IN_FLIGHT_MS - 1000);
  const soon = await C.answerFor(store, "clock-check-key-0001", (await store.read("clock-check-key-0001")).claim, now, async (s) => told.push(s));
  now.advance(2000);
  const late = await C.answerFor(store, "clock-check-key-0001", (await store.read("clock-check-key-0001")).claim, now, async (s) => told.push(s));
  ok("…and read right: in flight just inside the window, moved on just past it, and told once",
    soon.body.pending === true && /Still sending your order/.test(soon.body.error) && /couldn't confirm your order went in/.test(late.body.error) && told.length === 1
    && (await q1("select state from public.checkout_claims where idempotency_key = 'clock-check-key-0001'")).state === "unknown", { soon: soon.body, late: late.body, told });
}

// ── 5 · again ────────────────────────────────────────────────────────────────────────────────────
ok("it says so in the changelog, once", (await q1("select count(*)::int as n from public.changelog where title = 'A card is charged once, however many times Pay is tapped' and category = 'fix'")).n === 1);
ok("it records itself", (await q1("select applied_count from public.schema_migrations where version = '0371_a_card_is_charged_once'"))?.applied_count === 1);
const kept = (await q1("select count(*)::int as n from public.checkout_claims")).n;
ok("run again: no error, no second changelog line, the claims as they were, the ledger counting the re-run",
  (await raises(sql)) === null
  && (await q1("select count(*)::int as n from public.changelog where title = 'A card is charged once, however many times Pay is tapped'")).n === 1
  && (await q1("select count(*)::int as n from public.checkout_claims")).n === kept && kept > 0
  && (await q1("select applied_count from public.schema_migrations where version = '0371_a_card_is_charged_once'")).applied_count === 2
  && (await q1("select has_table_privilege('anon', 'public.checkout_claims', 'select') as a")).a === false);

console.log(`0371 (a card is charged once): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
