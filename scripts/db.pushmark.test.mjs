// ONLY THE CREW IS SENT NEW ORDERS — 0365, executed from its file against a real Postgres.
//
// A new order's push (the customer's name, the items, the total) goes to every push_subscriptions row marked
// is_admin. Until 0365 the mark was whatever the subscribing page sent, under rules that ask only whose row it is
// (0006's grants, 0009's update rule, 0081's insert rule — copied here as production has them). These are the
// writes a browser holding the public key can make, made as that browser: anon, and a signed-in member, each
// trying to mark a row; the crew keeping theirs; someone leaving the crew; and the rows marked before 0365.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MEMBER = "00000000-0000-0000-0000-0000000000a1", CREW = "00000000-0000-0000-0000-0000000000a2",
  LEGACY = "00000000-0000-0000-0000-0000000000a3", LEAVER = "00000000-0000-0000-0000-0000000000a4";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };
const as = async (role, uid) => { await db.exec(`reset role; select set_config('test.uid', '${uid ?? ""}', false); set role ${role};`); };
const mark = async (endpoint) => { await db.exec("reset role"); return (await q1(`select is_admin from public.push_subscriptions where endpoint = '${endpoint}'`))?.is_admin; };
// What a page's upsert is (lib/push subscribePush, PostgREST's on-conflict on the endpoint).
const upsert = (endpoint, uid, isAdmin) => `insert into public.push_subscriptions (endpoint, p256dh, auth, user_id, is_admin)
  values ('${endpoint}', 'k', 'a', ${uid ? `'${uid}'` : "null"}, ${isAdmin})
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id, is_admin = excluded.is_admin`;
// A row nobody is signed in for, written the way a stranger would: a plain insert (an upsert with no user fails the
// read rule — 0006's "own sub read" — before it is written).
const insert = (endpoint, isAdmin) => `insert into public.push_subscriptions (endpoint, p256dh, auth, user_id, is_admin)
  values ('${endpoint}', 'k', 'a', null, ${isAdmin})`;

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${MEMBER}'), ('${CREW}'), ('${LEGACY}'), ('${LEAVER}');
  create role anon; create role authenticated; create role service_role;
  -- Supabase's own default (2026-10-11, measured in production after 0366): a function made in public can be run
  -- by anon, authenticated and service_role by name, so a revoke from PUBLIC alone leaves anon its grant.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.uid', true), ''), '')::uuid $$;

  create table public.profiles (id uuid primary key references auth.users(id), role text not null default 'member',
    is_admin boolean not null default false);
  insert into public.profiles (id, role, is_admin) values
    ('${MEMBER}', 'member', false), ('${CREW}', 'server', false), ('${LEGACY}', 'member', true), ('${LEAVER}', 'admin', true);
  create or replace function public.is_admin() returns boolean language sql security definer stable set search_path = public as $$
    select coalesce((select role in ('admin', 'owner') from public.profiles where id = auth.uid()), false) $$;

  -- push_subscriptions as production has it: 0006, 0009, 0081 (0040's tenant and 0257's wants_live beside them).
  create table public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    is_admin boolean not null default false,
    endpoint text unique not null,
    p256dh text not null, auth text not null,
    created_at timestamptz default now(),
    tenant_id uuid default '00000000-0000-0000-0000-000000000001',
    wants_live boolean not null default false);
  alter table public.push_subscriptions enable row level security;
  grant insert, select, update, delete on public.push_subscriptions to anon, authenticated;
  grant all on public.push_subscriptions to service_role;
  create policy "sub insert" on public.push_subscriptions for insert to anon, authenticated with check (user_id is null or user_id = auth.uid());
  create policy "sub update" on public.push_subscriptions for update to anon, authenticated
    using (user_id is null or user_id = auth.uid()) with check (user_id is null or user_id = auth.uid());
  create policy "own sub read" on public.push_subscriptions for select using (auth.uid() = user_id or public.is_admin());
  create policy "own sub delete" on public.push_subscriptions for delete using (auth.uid() = user_id or public.is_admin());
  create policy "service all" on public.push_subscriptions for all to service_role using (true) with check (true);

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

// ── before 0365: the hole, as production has it ─────────────────────────────────────────────────
await as("anon");
ok("before 0365: a browser nobody is signed in on could mark itself for new orders", (await raises(insert("web:stranger", true))) === null);
ok("…and the mark stuck", (await mark("web:stranger")) === true);
await as("authenticated", MEMBER);
await db.exec(upsert("web:member", MEMBER, true));
ok("before 0365: a signed-in member could mark their own browser", (await mark("web:member")) === true);
await as("authenticated", CREW);
await db.exec(upsert("web:crew", CREW, true));
await as("authenticated", LEAVER);
await db.exec(upsert("web:leaver", LEAVER, true));
await db.exec("reset role");

const sql = readFileSync(join(ROOT, "supabase/migrations/0365_only_the_crew_is_sent_new_orders.sql"), "utf8");
await db.exec(sql);
console.log("0365 executed against a real Postgres.\n");

// ── the rows marked before ───────────────────────────────────────────────────────────────────────
ok("the stranger's mark is gone", (await mark("web:stranger")) === false);
ok("the member's mark is gone", (await mark("web:member")) === false);
ok("the crew's marks stay — their alerts that are on stay on", (await mark("web:crew")) === true && (await mark("web:leaver")) === true);

// ── what a page can write now ────────────────────────────────────────────────────────────────────
await as("anon");
await db.exec(insert("web:stranger2", true));
ok("a browser nobody is signed in on: the row is kept, unmarked", (await mark("web:stranger2")) === false);
await as("authenticated", MEMBER);
await db.exec(upsert("web:member", MEMBER, true));
ok("a member re-subscribing with the mark: unmarked", (await mark("web:member")) === false);
await as("authenticated", MEMBER);
await db.exec(`update public.push_subscriptions set is_admin = true where endpoint = 'web:member'`);
ok("a member writing the mark straight onto their row: unmarked", (await mark("web:member")) === false);
await as("authenticated", CREW);
await db.exec(upsert("web:crew2", CREW, true));
ok("the crew console's subscribe: marked", (await mark("web:crew2")) === true);
await as("authenticated", CREW);
await db.exec(upsert("web:crew3", CREW, false));
ok("a crew member's customer-side \"order ready\" subscribe stays unmarked — the page can still leave it off", (await mark("web:crew3")) === false);
await as("authenticated", LEGACY);
await db.exec(upsert("web:legacy", LEGACY, true));
ok("an admin from before roles (member, is_admin) is crew, as is_staff says", (await mark("web:legacy")) === true);
await as("service_role");
await db.exec(`update public.push_subscriptions set wants_live = true where endpoint = 'web:crew2'`);
ok("the server touching a crew row (no one signed in) leaves its mark: the test is the row's person, not the writer", (await mark("web:crew2")) === true);

// ── leaving the crew ─────────────────────────────────────────────────────────────────────────────
await db.exec(`reset role; update public.profiles set role = 'member', is_admin = false where id = '${LEAVER}'`);
ok("someone who leaves the crew is off the pass's alerts at once", (await mark("web:leaver")) === false);
await db.exec(`reset role; update public.profiles set role = 'server' where id = '${MEMBER}'`);
ok("someone who joins it is not marked until they turn the crew's alerts on", (await mark("web:member")) === false);
await as("authenticated", MEMBER);
await db.exec(upsert("web:member", MEMBER, true));
ok("…and then is", (await mark("web:member")) === true);
await db.exec(`reset role; update public.profiles set is_admin = true where id = '${CREW}'`);
ok("a crew member's other change (not leaving) touches nothing", (await mark("web:crew2")) === true && (await mark("web:crew3")) === false);

// ── its own rules ────────────────────────────────────────────────────────────────────────────────
await db.exec("reset role");
for (const fn of ["push_sub_crew_only", "push_subs_leave_with_the_crew"]) {
  const p = await q1(`select prosecdef as d, coalesce(proconfig::text, '') as c from pg_proc where proname = '${fn}'`);
  ok(`${fn}: runs as its definer with search_path pinned (it reads profiles for any writer)`, p?.d === true && /search_path=public/.test(p?.c), p);
  ok(`${fn}: no browser can call it`, (await q1(`select has_function_privilege('anon', 'public.${fn}()', 'execute') as a, has_function_privilege('authenticated', 'public.${fn}()', 'execute') as b`)).a === false);
}
ok("it says so in the changelog, once", (await q1("select count(*)::int as n from public.changelog where title = 'Only the crew is sent new orders' and category = 'security'")).n === 1);
ok("it records itself", (await q1("select applied_count from public.schema_migrations where version = '0365_only_the_crew_is_sent_new_orders'"))?.applied_count === 1);
ok("run again: no error, no second changelog line, the marks unchanged", (await raises(sql)) === null
  && (await q1("select count(*)::int as n from public.changelog where title = 'Only the crew is sent new orders'")).n === 1
  && (await mark("web:crew2")) === true && (await mark("web:stranger")) === false);

console.log(`0365 (only the crew is sent new orders): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
