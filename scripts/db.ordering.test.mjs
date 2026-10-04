// A PRE-ORDER SAYS WHEN IT IS MADE — 0343, executed from its file against a real Postgres.
//
// 0343 adds one column, orders.ready_from, and the claims worth a database are about the window
// around it rather than the column itself:
//   1. The push lands before the paste. Until 0343 is applied, /api/checkout's write carries a key
//      the table does not have; lib/schemaSkew.writeAcrossSkew must write the order anyway, without
//      that key — and must NOT forgive a column it was not told about. Run here against a real
//      Postgres error (42703), with the real TypeScript compiled, not restated.
//   2. After the paste the same call writes ready_from, and an order placed now carries none.
//   3. The pass's clock (lib/ordering orderClockFrom / waitingToOpen) reads the row the way
//      PostgREST hands it over — JSON timestamps, not driver Date objects.
//   4. It runs twice without harm: no second changelog row, the ledger counts the re-run.
// The orders fixture is 0005's table with the columns the checkout route writes (0151's
// customer_id, 0219's stop_id, 0268's benefit_code) — not a table invented for the test.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s, p) => (await db.query(s, p)).rows[0];

// ── the real TypeScript, compiled ──────────────────────────────────────────────────────────────
const ts = (await import("typescript")).default;
const cache = new Map();
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports;
  const mod = { exports: {} };
  cache.set(rel, mod);
  const out = ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function("module", "exports", "require", out)(mod, mod.exports, (spec) => {
    if (spec.startsWith("./")) return load(`lib/${spec.slice(2)}.ts`);
    throw new Error(`unexpected import ${spec} in ${rel}`);
  });
  return mod.exports;
}
const SK = load("lib/schemaSkew.ts");
const OR = load("lib/ordering.ts");
ok("known pair: lib/schemaSkew and lib/ordering compiled", typeof SK.writeAcrossSkew === "function" && typeof OR.orderClockFrom === "function");

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
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

  -- 0005, with the columns /api/checkout writes
  create table public.orders (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid references auth.users(id) on delete set null,
    customer     text,
    items        text[] not null,
    total_cents  int not null,
    paid         boolean not null default false,
    payment_id   text,
    status       text not null default 'new' check (status in ('new', 'preparing', 'ready', 'done', 'void')),
    created_at   timestamptz not null default now(),
    customer_id  uuid,
    stop_id      uuid,
    benefit_code text);
`);

// The route's row, and a writer shaped like supabase-js: { error } back, never a throw.
const ROW = { items: ["rise"], total_cents: 1000, paid: false, payment_id: null, customer: "Ana", user_id: null, customer_id: null, status: "new", benefit_code: null };
const READY = "2026-10-10T15:00:00.000Z";
const write = async (row) => {
  const keys = Object.keys(row);
  try {
    await db.query(`insert into public.orders (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map((k) => row[k]));
    return { error: null };
  } catch (e) { return { error: { code: e.code ?? null, message: String(e.message ?? e) } }; }
};
const count = async () => Number((await q1(`select count(*)::int as n from public.orders`)).n);

// ── 1 · BEFORE THE PASTE ───────────────────────────────────────────────────────────────────────
{
  const raw = await write({ ...ROW, ready_from: READY });
  ok("before 0343: Postgres refuses the key as an undefined column (42703) — the error the fallback is for",
    raw.error && SK.isMissingColumn(raw.error) && raw.error.code === "42703", raw.error);
  const r = await SK.writeAcrossSkew(write, { ...ROW, ready_from: READY }, ["ready_from"]);
  ok("before 0343: the order is written anyway, without ready_from, and the call says what it dropped",
    r.error === null && r.dropped.join() === "ready_from" && (await count()) === 1, r);
  const typo = await SK.writeAcrossSkew(write, { ...ROW, readyfrom: READY }, ["ready_from"]);
  ok("before 0343: a column it was not told about is not forgiven — no order, the error comes back",
    typo.error !== null && typo.dropped.length === 0 && (await count()) === 1, typo);
}

// ── 2 · THE PASTE ──────────────────────────────────────────────────────────────────────────────
const SQL = readFileSync(join(ROOT, "supabase/migrations/0343_a_pre_order_says_when_it_is_made.sql"), "utf8");
const checksBefore = Number((await q1(`select count(*)::int as n from pg_constraint where conrelid = 'public.orders'::regclass`)).n);
await db.exec(SQL);
{
  const c = await q1(`select data_type, is_nullable, column_default from information_schema.columns where table_name = 'orders' and column_name = 'ready_from'`);
  ok("0343: orders.ready_from is a nullable timestamptz with no default", c && c.data_type === "timestamp with time zone" && c.is_nullable === "YES" && c.column_default === null, c);
  ok("0343: …and it adds no constraint — a refused write after a charge is the outcome it must never cause",
    Number((await q1(`select count(*)::int as n from pg_constraint where conrelid = 'public.orders'::regclass`)).n) === checksBefore);
  ok("0343: the column says what it means", /When the truck said it would make this order/.test((await q1(`select col_description('public.orders'::regclass, (select attnum from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'ready_from')) as d`)).d ?? ""));
  ok("0343: the row written before the paste reads as made-now (null)", (await q1(`select count(*)::int as n from public.orders where ready_from is null`)).n === 1);
}

// ── 3 · AFTER: the same call keeps the promise ────────────────────────────────────────────────
{
  const r = await SK.writeAcrossSkew(write, { ...ROW, customer: "Bo", ready_from: READY }, ["ready_from"]);
  ok("after 0343: the same call writes ready_from and drops nothing", r.error === null && r.dropped.length === 0, r);
  const bo = await q1(`select to_json(created_at) #>> '{}' as created_at, to_json(ready_from) #>> '{}' as ready_from from public.orders where customer = 'Bo'`);
  ok("after 0343: the instant is the one the server promised", Date.parse(bo.ready_from) === Date.parse(READY), bo);
  ok("the pass: a ticket placed ahead is aged from its stop's opening and waits until then — on the row as PostgREST hands it over",
    OR.orderClockFrom(bo) === bo.ready_from && OR.waitingToOpen(bo, Date.parse(READY) - 3600e3) && !OR.waitingToOpen(bo, Date.parse(READY)), bo);
  const now = await SK.writeAcrossSkew(write, { ...ROW, customer: "Cy" }, ["ready_from"]);
  const cy = await q1(`select to_json(created_at) #>> '{}' as created_at, ready_from from public.orders where customer = 'Cy'`);
  ok("after 0343: an order made now carries no ready_from, and its clock is when it came in",
    now.error === null && cy.ready_from === null && OR.orderClockFrom(cy) === cy.created_at && !OR.waitingToOpen(cy), cy);
}

// ── 4 · TWICE ──────────────────────────────────────────────────────────────────────────────────
await db.exec(SQL);
ok("0343 twice: one changelog row", (await q1(`select count(*)::int as n from public.changelog where title = 'Ordering says when the truck is open, and when your order is made'`)).n === 1);
ok("0343 twice: the ledger counts the re-run", (await q1(`select applied_count from public.schema_migrations where version = '0343_a_pre_order_says_when_it_is_made'`)).applied_count === 2);

console.log(`\nDB ORDERING (0343): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
