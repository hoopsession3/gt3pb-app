// DB smoke — the security-critical money paths that pure-TS smoke can't reach: the REAL
// `cancel_own_order` RPC (loaded verbatim from its migration) and the orders row-level-security
// isolation. Runs on an in-process WASM Postgres (PGlite) — no Docker, no service container, so it
// runs identically on a laptop and in CI. The fixture stubs ONLY what Supabase provides at runtime
// (the `auth` schema, `auth.uid()`, and the anon/authenticated roles) and mirrors the exact orders +
// alerts DDL/policies from migrations 0005 and 0050; the function under test is the production file.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const A = "11111111-1111-1111-1111-111111111111"; // member A
const B = "22222222-2222-2222-2222-222222222222"; // member B
const oid = (n) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); }
};

const db = new PGlite();
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];
const as = (uid) => db.exec(`set test.uid = '${uid}';`);
const cancel = async (order) => (await q1("select public.cancel_own_order($1) as r", [order])).r;

// ── platform stubs (what Supabase provides at runtime) ──
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
  create role anon;
  create role authenticated;
  grant usage on schema auth, public to anon, authenticated;
`);

// ── orders + alerts, mirroring prod DDL (0005 orders, 0050 alerts) — only what the invariants touch ──
await db.exec(`
  create table public.orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete set null,
    customer text, items text[] not null default '{}', total_cents int not null default 0,
    paid boolean not null default false, payment_id text,
    status text not null default 'new' check (status in ('new','preparing','ready','done','void')),
    created_at timestamptz not null default now()
  );
  alter table public.orders enable row level security;
  grant insert, select on public.orders to anon, authenticated;
  -- verbatim from 0005: a signed-in member can read ONLY their own orders
  create policy "own orders read" on public.orders for select using (auth.uid() = user_id);

  create table public.alerts (
    id uuid primary key default gen_random_uuid(),
    severity text not null default 'important', category text, title text not null, body text,
    link text default '/admin', created_at timestamptz not null default now()
  );
`);

// ── the REAL function under test, loaded from its migration file ──
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0118_cancel_own_order.sql"), "utf8"));

// ── seed two members and A's orders ──
await db.exec(`
  insert into auth.users (id) values ('${A}'), ('${B}');
  insert into public.orders (id, user_id, items, total_cents, paid, status) values
    ('${oid(1)}','${A}','{RISE}', 900, false, 'new'),        -- A: unpaid, new
    ('${oid(2)}','${A}','{FLOW}',1200, true,  'new'),        -- A: paid, new
    ('${oid(3)}','${A}','{DUSK}', 800, false, 'preparing');  -- A: already preparing
`);

// ── cancel_own_order behaviour ──
await as(A);
ok("owner cancels own 'new' order → true", (await cancel(oid(1))) === true);
ok("canceled order is now 'void'", (await q1(`select status from public.orders where id='${oid(1)}'`)).status === "void");

ok("owner cancels own PAID 'new' order → true", (await cancel(oid(2))) === true);
const refundAlerts = (await q1(`select count(*)::int n from public.alerts where category='money' and title ilike '%refund%'`)).n;
ok("paid cancel raises exactly one refund alert", refundAlerts === 1, refundAlerts);

ok("cannot cancel once 'preparing' → false", (await cancel(oid(3))) === false);
ok("preparing order left untouched", (await q1(`select status from public.orders where id='${oid(3)}'`)).status === "preparing");

// cross-user: member B cannot cancel A's order (the BOLA/IDOR ownership guard)
await db.exec(`insert into public.orders (id, user_id, items, total_cents, paid, status)
  values ('${oid(4)}','${A}','{RISE}', 900, false, 'new');`);
await as(B);
ok("member B cannot cancel member A's order → false", (await cancel(oid(4))) === false);
ok("member A's order untouched by B", (await q1(`select status from public.orders where id='${oid(4)}'`)).status === "new");

ok("cancel of a nonexistent order → false", (await cancel("aaaaaaaa-0000-0000-0000-0000000000ff")) === false);

// ── orders RLS isolation (enforced only for non-superuser roles) ──
await db.exec("set role authenticated;");
await as(B);
const bSeesA = (await q1(`select count(*)::int n from public.orders where user_id='${A}'`)).n;
ok("RLS: member B sees zero of A's orders", bSeesA === 0, bSeesA);
await as(A);
const aSeesOwn = (await q1(`select count(*)::int n from public.orders where user_id='${A}'`)).n;
ok("RLS: member A sees A's own orders", aSeesOwn >= 1, aSeesOwn);
await db.exec("reset role;");

console.log(`DB SMOKE: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
