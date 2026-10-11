// THE IPHONE APP'S PHONE, KEPT BY THE DATABASE — 0367 (on 0365 and 0366), executed from its files against a real Postgres.
//
// The app's first draft wrote its own 'apns' row (an upsert on the endpoint, then a delete of the person's other rows,
// every kind), and the review found on the phone what 0366 had found on the web: a phone someone signed out of stayed
// theirs, the next person's write was refused and the delete after it took away their devices — their browsers too.
// keep_app_push_token does it in the database. Production's rules are copied here (0006, 0009, 0081, and Supabase's
// default grants, which let anon run a new function unless anon is revoked by name).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KAYLA = "00000000-0000-0000-0000-0000000000d1", NINO = "00000000-0000-0000-0000-0000000000d2";   // a member; crew
const T1 = "AB".repeat(32), T2 = "cd".repeat(32), T3 = "ef".repeat(32);
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };
const as = async (role, uid) => { await db.exec(`reset role; select set_config('test.uid', '${uid ?? ""}', false); set role ${role};`); };
const row = async (endpoint) => { await db.exec("reset role"); return q1(`select user_id, is_admin, platform, p256dh from public.push_subscriptions where endpoint = '${endpoint}'`); };
const keep = (t) => `select public.keep_app_push_token('${t}')`;

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${KAYLA}'), ('${NINO}');
  create role anon; create role authenticated; create role service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.uid', true), ''), '')::uuid $$;
  create table public.profiles (id uuid primary key references auth.users(id), role text not null default 'member',
    is_admin boolean not null default false);
  insert into public.profiles (id, role) values ('${KAYLA}', 'member'), ('${NINO}', 'server');
  create or replace function public.is_admin() returns boolean language sql security definer stable set search_path = public as $$
    select coalesce((select role in ('admin', 'owner') from public.profiles where id = auth.uid()), false) $$;
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
  create policy "sub insert" on public.push_subscriptions for insert to anon, authenticated with check (user_id is null or user_id = auth.uid());
  create policy "sub update" on public.push_subscriptions for update to anon, authenticated
    using (user_id is null or user_id = auth.uid()) with check (user_id is null or user_id = auth.uid());
  create policy "own sub read" on public.push_subscriptions for select using (auth.uid() = user_id or public.is_admin());
  create policy "own sub delete" on public.push_subscriptions for delete using (auth.uid() = user_id or public.is_admin());
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
for (const f of ["0365_only_the_crew_is_sent_new_orders", "0366_a_device_is_whoever_is_signed_in_on_it", "0367_alerts_in_the_iphone_app"]) {
  await db.exec(readFileSync(join(ROOT, `supabase/migrations/${f}.sql`), "utf8"));
}
const sql367 = readFileSync(join(ROOT, "supabase/migrations/0367_alerts_in_the_iphone_app.sql"), "utf8");
console.log("0365, 0366 and 0367 executed against a real Postgres.\n");

// ── the table's new kind of row ──────────────────────────────────────────────────────────────────
ok("a browser's row still needs its keys", /violates check constraint/.test((await raises(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/nokeys', null, null)`)) ?? ""));
ok("rows from before are browsers", (await q1("select column_default from information_schema.columns where table_name = 'push_subscriptions' and column_name = 'platform'"))?.column_default?.includes("'web'"));

// ── a phone ──────────────────────────────────────────────────────────────────────────────────────
await as("anon");
await db.exec(keep(T1));
const g = await row(`apns:${T1.toLowerCase()}`);
ok("a phone nobody is signed in on is kept — nobody's, an app row, no keys, unmarked", g?.user_id === null && g?.platform === "apns" && g?.p256dh === null && g?.is_admin === false, g);
await db.exec(`reset role; insert into public.push_subscriptions (endpoint, p256dh, auth, user_id) values ('https://push.example/kayla-laptop', 'k', 'a', '${KAYLA}')`);
await as("authenticated", KAYLA);
await db.exec(keep(T1));
ok("signed in: the phone is theirs, its token kept in one case", (await row(`apns:${T1.toLowerCase()}`))?.user_id === KAYLA && !(await row(`apns:${T1}`)));
ok("a member's phone is not marked for the pass's new orders (0365)", (await row(`apns:${T1.toLowerCase()}`))?.is_admin === false);
await as("authenticated", KAYLA);
await db.exec(keep(T2));
ok("one app install each: her new phone's token replaces the old one", !(await row(`apns:${T1.toLowerCase()}`)) && (await row(`apns:${T2}`))?.user_id === KAYLA);
ok("…and her browser keeps ringing — a phone is not a browser", (await row("https://push.example/kayla-laptop"))?.user_id === KAYLA);

// ── someone else on the same phone ───────────────────────────────────────────────────────────────
await as("authenticated", NINO);
ok("the next person to sign in on a phone gets it — the one before can't keep it from him", (await raises(keep(T2))) === null && (await row(`apns:${T2}`))?.user_id === NINO);
ok("…marked for new orders: he is crew", (await row(`apns:${T2}`))?.is_admin === true);
ok("…and hers elsewhere are untouched: the laptop is still hers", (await row("https://push.example/kayla-laptop"))?.user_id === KAYLA);
await as("anon");
await db.exec(keep(T2));
ok("signed out: the phone is nobody's, and hears of no orders", (await row(`apns:${T2}`))?.user_id === null && (await row(`apns:${T2}`))?.is_admin === false);

// ── what it refuses, and who may ask ─────────────────────────────────────────────────────────────
await as("anon");
ok("a token that isn't hex is refused", /isn't a device token/.test((await raises(keep("not-a-token-at-all-but-long-enough"))) ?? ""));
await as("anon");
ok("a token too short is refused", /isn't a device token/.test((await raises(keep("abcd"))) ?? ""));
await db.exec("reset role");
const priv = await q1(`select has_function_privilege('anon', 'public.keep_app_push_token(text)', 'execute') as ka,
  has_function_privilege('authenticated', 'public.keep_app_push_token(text)', 'execute') as kau,
  has_function_privilege('anon', 'public.release_push_device(text)', 'execute') as ra,
  has_function_privilege('authenticated', 'public.release_push_device(text)', 'execute') as rau`);
ok("a guest's phone and a signed-in person's can be kept", priv.ka && priv.kau, priv);
ok("0366's release is a signed-in person's alone now — anon's grant (Supabase's default) is revoked by name", !priv.ra && priv.rau, priv);
const p = await q1("select prosecdef as d, coalesce(proconfig::text, '') as c from pg_proc where proname = 'keep_app_push_token'");
ok("keep_app_push_token runs as its definer with search_path pinned", p?.d === true && /search_path=public/.test(p?.c), p);
ok("run again: no error, recorded twice, the rows unchanged", (await raises(sql367)) === null
  && (await q1("select applied_count from public.schema_migrations where version = '0367_alerts_in_the_iphone_app'"))?.applied_count === 2
  && (await row(`apns:${T2}`))?.platform === "apns");
await as("anon");
ok("T3 sanity: a third phone kept by a guest is one more nobody's row", (await raises(keep(T3))) === null && (await row(`apns:${T3}`))?.user_id === null);

console.log(`0367 (the iPhone app's phone, kept by the database): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
