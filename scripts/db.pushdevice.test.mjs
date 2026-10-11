// A DEVICE'S ALERTS ARE WHOEVER IS SIGNED IN ON IT — 0366 (on 0365), executed from its files against a real Postgres.
//
// The page used to write its own row (lib/push: an upsert on the endpoint, then a delete of the person's other
// devices) under 0006/0009/0081's rules, copied here as production has them. Three failures on today's web, each
// made here first the old way and then through keep_push_device / release_push_device as the same browser would:
// a guest's "truck is live" ping that never saved; a browser that stayed the last person's after they signed out;
// and the next person, refused the device, losing their own.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KAYLA = "00000000-0000-0000-0000-0000000000c1", NINO = "00000000-0000-0000-0000-0000000000c2";   // a member; crew
const P256 = "B".repeat(87), AUTH = "a".repeat(22);
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const rows = async (s) => (await db.query(s)).rows;
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };
const as = async (role, uid) => { await db.exec(`reset role; select set_config('test.uid', '${uid ?? ""}', false); set role ${role};`); };
const row = async (endpoint) => { await db.exec("reset role"); return q1(`select user_id, is_admin, wants_live from public.push_subscriptions where endpoint = '${endpoint}'`); };
const keep = (endpoint, crew = "null", live = "null") => `select public.keep_push_device('${endpoint}', '${P256}', '${AUTH}', ${crew}, ${live})`;
// The old page's write (lib/push before 0366), as PostgREST ran it.
const oldUpsert = (endpoint, uid, live = false) => `insert into public.push_subscriptions (endpoint, p256dh, auth, user_id, is_admin, wants_live)
  values ('${endpoint}', '${P256}', '${AUTH}', ${uid ? `'${uid}'` : "null"}, false, ${live})
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id, is_admin = excluded.is_admin, wants_live = excluded.wants_live`;

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${KAYLA}'), ('${NINO}');
  create role anon; create role authenticated; create role service_role;
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

// ── before 0366: the three failures, the old way ─────────────────────────────────────────────────
await as("anon");
const guestErr = await raises(oldUpsert("https://push.example/guest", null, true));
ok("before: a guest's \"truck is live\" ping could not be kept — the row is nobody's, and nobody may read it", /row-level security/.test(guestErr ?? ""), guestErr);
await as("authenticated", KAYLA);
await db.exec(oldUpsert("https://push.example/shared", KAYLA));
await as("authenticated", NINO);
await db.exec(oldUpsert("https://push.example/nino-phone", NINO));
const takeErr = await raises(oldUpsert("https://push.example/shared", NINO));
ok("before: the next person to sign in on a browser was refused it", /row-level security/.test(takeErr ?? ""), takeErr);
ok("…so it stayed the last person's", (await row("https://push.example/shared"))?.user_id === KAYLA);
await db.exec("reset role; delete from public.push_subscriptions");

for (const f of ["0365_only_the_crew_is_sent_new_orders", "0366_a_device_is_whoever_is_signed_in_on_it"]) {
  await db.exec(readFileSync(join(ROOT, `supabase/migrations/${f}.sql`), "utf8"));
}
const sql366 = readFileSync(join(ROOT, "supabase/migrations/0366_a_device_is_whoever_is_signed_in_on_it.sql"), "utf8");
console.log("0365 and 0366 executed against a real Postgres.\n");

// ── a guest ──────────────────────────────────────────────────────────────────────────────────────
await as("anon");
ok("a guest's \"truck is live\" ping is kept", (await raises(keep("https://push.example/guest", "null", "true"))) === null
  && (await row("https://push.example/guest"))?.wants_live === true && (await row("https://push.example/guest"))?.user_id === null);
await as("anon");
await db.exec(keep("https://push.example/guest", "null", "false"));
ok("…and turned off again", (await row("https://push.example/guest"))?.wants_live === false);
await as("anon");
await db.exec(keep("https://push.example/guest", "true", "null"));
ok("a guest asking for the pass's alerts is not given them", (await row("https://push.example/guest"))?.is_admin === false);

// ── someone signed in ────────────────────────────────────────────────────────────────────────────
await db.exec(`reset role; insert into public.push_subscriptions (endpoint, p256dh, auth, user_id) values
  ('https://push.example/kayla-old', 'k', 'a', '${KAYLA}'), ('apns:${"ab".repeat(32)}', 'k', 'a', '${KAYLA}')`);
await as("authenticated", KAYLA);
await db.exec(keep("https://push.example/shared"));
ok("signed in: the device is theirs", (await row("https://push.example/shared"))?.user_id === KAYLA);
ok("one browser each: their old browser goes", !(await row("https://push.example/kayla-old")));
ok("…but only browsers — the iPhone app's device is not a browser", (await row(`apns:${"ab".repeat(32)}`))?.user_id === KAYLA);
await as("authenticated", KAYLA);
await db.exec(keep("https://push.example/shared", "null", "true"));
ok("wantsLive given: set; the row stays theirs", (await row("https://push.example/shared"))?.wants_live === true && (await row("https://push.example/shared"))?.user_id === KAYLA);
await as("authenticated", KAYLA);
await db.exec(keep("https://push.example/shared"));
ok("wantsLive not given: left as it was", (await row("https://push.example/shared"))?.wants_live === true);

// ── signing out ──────────────────────────────────────────────────────────────────────────────────
await as("authenticated", NINO);
await db.exec(`select public.release_push_device('https://push.example/shared')`);
ok("someone else can't release a device that isn't theirs", (await row("https://push.example/shared"))?.user_id === KAYLA);
await as("authenticated", KAYLA);
await db.exec(`select public.release_push_device('https://push.example/shared')`);
const left = await row("https://push.example/shared");
ok("signing out releases it: nobody's, unmarked — and still subscribed, with its \"truck is live\"", left?.user_id === null && left?.is_admin === false && left?.wants_live === true, left);

// ── the next person on the same browser ──────────────────────────────────────────────────────────
await as("authenticated", NINO);
await db.exec(keep("https://push.example/nino-phone", "true"));
await as("authenticated", KAYLA);
await db.exec(keep("https://push.example/shared"));
await as("authenticated", NINO);
ok("the next person to sign in on a browser gets it — even one somebody else still had", (await raises(keep("https://push.example/shared"))) === null
  && (await row("https://push.example/shared"))?.user_id === NINO);
ok("…and it starts without the pass's alerts — a device that changes hands is not marked by whoever had it", (await row("https://push.example/shared"))?.is_admin === false);
await as("authenticated", NINO);
await db.exec(keep("https://push.example/shared", "true"));
ok("the crew console asks for them: marked", (await row("https://push.example/shared"))?.is_admin === true);
await as("authenticated", NINO);
await db.exec(keep("https://push.example/shared"));
ok("an order from the shop (asks for nothing) doesn't take them away", (await row("https://push.example/shared"))?.is_admin === true);
await as("authenticated", NINO);
await db.exec(keep("https://push.example/shared", "false"));
ok("nor does a page saying false", (await row("https://push.example/shared"))?.is_admin === true);
await as("authenticated", KAYLA);
await db.exec(keep("https://push.example/kayla-new", "true"));
ok("a member asking for the pass's alerts is not given them (0365)", (await row("https://push.example/kayla-new"))?.is_admin === false);

// ── what it refuses, and who may ask ─────────────────────────────────────────────────────────────
await as("anon");
ok("an endpoint that isn't a web address is refused", /isn't a push subscription/.test((await raises(`select public.keep_push_device('ftp://x/yyyyyyyyyy', '${P256}', '${AUTH}')`)) ?? ""));
await as("anon");
ok("a subscription without its keys is refused", /no keys/.test((await raises(`select public.keep_push_device('https://push.example/nokeys', '', '')`)) ?? ""));
await db.exec("reset role");
const priv = await q1(`select has_function_privilege('anon', 'public.keep_push_device(text,text,text,boolean,boolean)', 'execute') as ka,
  has_function_privilege('authenticated', 'public.keep_push_device(text,text,text,boolean,boolean)', 'execute') as kau,
  has_function_privilege('anon', 'public.release_push_device(text)', 'execute') as ra,
  has_function_privilege('authenticated', 'public.release_push_device(text)', 'execute') as rau`);
ok("a guest and a signed-in person may keep a device; only someone signed in may release one", priv.ka && priv.kau && !priv.ra && priv.rau, priv);
for (const fn of ["keep_push_device", "release_push_device"]) {
  const p = await q1(`select prosecdef as d, coalesce(proconfig::text, '') as c from pg_proc where proname = '${fn}'`);
  ok(`${fn}: runs as its definer with search_path pinned`, p?.d === true && /search_path=public/.test(p?.c), p);
}
ok("it says so in the changelog, once", (await q1("select count(*)::int as n from public.changelog where title = 'A device''s alerts are whoever is signed in on it'")).n === 1);
ok("run again: no error, no second line", (await raises(sql366)) === null
  && (await q1("select count(*)::int as n from public.changelog where title = 'A device''s alerts are whoever is signed in on it'")).n === 1
  && (await q1("select applied_count from public.schema_migrations where version = '0366_a_device_is_whoever_is_signed_in_on_it'"))?.applied_count === 2);
const left4 = (await rows("select endpoint from public.push_subscriptions order by endpoint")).map((r) => r.endpoint);
ok("what is left is what the rules meant: the guest's, the shared browser (now Niño's latest, so his phone's went — one browser each), Kayla's new one and her iPhone app",
  left4.length === 4 && left4.includes("https://push.example/guest") && left4.includes("https://push.example/shared") && left4.includes("https://push.example/kayla-new")
  && left4.includes(`apns:${"ab".repeat(32)}`) && !left4.includes("https://push.example/nino-phone"), left4);

console.log(`0366 (a device's alerts are whoever is signed in on it): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
