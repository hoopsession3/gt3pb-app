// 0385 — GOING LIVE SAYS HOW MANY PEOPLE WILL HEAR, executed from its file against the whole schema (every migration
// before it, in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does.
//
// The finding, as a sentence: Go live's checks (components/crew/GoLiveSheet) say "Go live and tell N people", N being who
// asked on Find Us to hear when the truck goes live (push_subscriptions.wants_live, 0257) — and nothing could count them
// without reading the rows, a device's endpoint and keys. Shown first on the schema as production has it: no function,
// and the crew cannot see the rows. Then 0385: owners and admins (is_admin(), the test admin_set_live asks — the legacy
// is_admin flag included) get the number for their own business and nothing else; an event manager, the crew, a member
// and anon get nothing; the number is the push function's own filter; and a second run changes nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F385 = "0385_going_live_says_how_many_will_hear.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001", T2 = "00000000-0000-0000-0000-000000000002";
const OWNER = "0c385000-0000-4000-8000-0000000000c1", ADMIN = "0c385000-0000-4000-8000-0000000000c2",
  EVENTM = "0c385000-0000-4000-8000-0000000000c3", SERVER = "0c385000-0000-4000-8000-0000000000c4",
  MEMBER = "0c385000-0000-4000-8000-0000000000c5", LEGACY = "0c385000-0000-4000-8000-0000000000c6",
  OTHER = "0c385000-0000-4000-8000-0000000000c7";

const t0 = Date.now();
const db = await fullSchema({ before: "0385" });
console.log(`the schema before 0385 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
const count = (uid) => as(uid, `select public.live_ping_count() as n`);

await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`);
// A second business, made deliberately (the guard_second_tenant way: one transaction, the setting on).
await db.exec(`begin; set local gt3.allow_second_tenant = 'on';
  insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar'); commit;`);
for (const [id, role, tenant] of [[OWNER, "owner", T1], [ADMIN, "admin", T1], [EVENTM, "event_manager", T1],
  [SERVER, "server", T1], [MEMBER, "member", T1], [LEGACY, "event_manager", T1], [OTHER, "owner", T2]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, tenant, `Made-up ${role}`]);
}
// The legacy flag on its own (0280 mirrors it from the role on every role change, so it is set apart from one): the
// one profile whose stored role is not owner or admin and whom is_admin() still lets go live.
await db.query(`update public.profiles set is_admin = true where id = $1`, [LEGACY]);

// Devices, made as the database itself (root): who asked to hear, and who did not. Endpoints and keys are made up.
let n = 0;
const device = async (tenant, wantsLive, userId = null, crew = false) => {
  n++;
  await q(`insert into public.push_subscriptions (endpoint, p256dh, auth, user_id, is_admin, wants_live, tenant_id)
    values ($1, $2, $3, $4, $5, $6, $7)`, [`https://push.example.test/device-${n}`, `p256dh-made-up-key-${n}`, `auth-made-up-${n}`, userId, crew, wantsLive, tenant]);
  return `https://push.example.test/device-${n}`;
};
const guestA = await device(T1, true);              // a guest on Find Us: "Ping me when the truck goes live"
await device(T1, true);                             // another guest
await device(T1, true, MEMBER);                     // a member who asked
await device(T1, false, SERVER, true);              // the crew's own phone: a pass device, not a guest's ping
const quiet = await device(T1, false, MEMBER);      // a device that never asked
await device(T2, true);                             // another business's guest
const pushRule = (await q(`select count(*)::int n from public.push_subscriptions where wants_live and tenant_id = $1`, [T1]))[0].n;

// ── BEFORE 0385: no number to be had ────────────────────────────────────────────────────────────
{
  const c = await count(OWNER);
  ok("before 0385: there is no count to ask for", /live_ping_count/.test(c.error || "") && /does not exist/.test(c.error || ""), c);
  const crew = await as(SERVER, `select count(*)::int n from public.push_subscriptions where wants_live`);
  ok("before 0385: the crew cannot count the rows either — they read only their own (0006)", crew.rows[0]?.n === 0, crew);
}

// ── 0385 ───────────────────────────────────────────────────────────────────────────────────────
await db.exec(MIG(F385));

for (const [who, name] of [[OWNER, "an owner"], [ADMIN, "an admin"]]) {
  const c = await count(who);
  ok(`after 0385: ${name} gets how many of the business's devices asked to hear — ${pushRule}`, c.rows[0]?.n === pushRule && pushRule === 3, c);
}
{
  const c = await count(LEGACY);
  ok("after 0385: an event manager with the legacy is_admin flag counts too — is_admin(), as admin_set_live asks (lib/liveOps mayGoLive reads it the same)", c.rows[0]?.n === 3, c);
  const other = await count(OTHER);
  ok("after 0385: another business's owner gets their own business's number, not ours", other.rows[0]?.n === 1, other);
}
for (const [who, name] of [[EVENTM, "an event manager"], [SERVER, "a server"], [MEMBER, "a member"]]) {
  const c = await count(who);
  ok(`after 0385: ${name} is refused — not authorized`, /not authorized/.test(c.error || "") && c.rows.length === 0, c);
}
{
  const c = await count(null);
  ok("after 0385: anon cannot call it at all", /permission denied/.test(c.error || ""), c);
}

// It is the push function's own filter: who raises a hand is counted, who lowers it is not.
{
  const fn = readFileSync(join(ROOT, "supabase/functions/push/index.ts"), "utf8");
  ok("the push function pings wants_live = true of the business's tenant on the live flip — the rows counted",
    /targets = await subsFor\(\(q\) => q\.eq\("wants_live", true\)\.eq\("tenant_id", tenantOf\(record\)\), faults\);/.test(fn));
  await q(`update public.push_subscriptions set wants_live = true where endpoint = $1`, [quiet]);
  const up = await count(OWNER);
  await q(`update public.push_subscriptions set wants_live = false where endpoint = $1`, [guestA]);
  await q(`update public.push_subscriptions set wants_live = false where endpoint = $1`, [quiet]);
  const down = await count(OWNER);
  ok("a device that asks is counted the moment it asks; one that stops asking, gone", up.rows[0]?.n === 4 && down.rows[0]?.n === 2, { up: up.rows, down: down.rows });
  const crew = await as(SERVER, `select count(*)::int n from public.push_subscriptions where wants_live`);
  ok("after 0385: the crew still read no one's subscription — only the number, and only for owners and admins", crew.rows[0]?.n === 0, crew);
}

// The function's shape, a second run, the ledger.
{
  const g = (await q(`select has_function_privilege('anon', 'public.live_ping_count()', 'execute') a,
    has_function_privilege('authenticated', 'public.live_ping_count()', 'execute') b`))[0];
  ok("anon holds no execute; authenticated does (the function refuses inside it)", g.a === false && g.b === true, g);
  const f = (await q(`select prosecdef, proconfig from pg_proc where proname = 'live_ping_count'`))[0];
  ok("a definer, its search_path pinned", f?.prosecdef === true && JSON.stringify(f?.proconfig) === JSON.stringify(["search_path=public"]), f);
  await db.exec(MIG(F385));
  const again = await count(ADMIN);
  ok("a second run changes nothing", again.rows[0]?.n === 2, again);
  const line = (await q(`select count(*)::int n from public.changelog where title = 'Live Ops reads at a glance'`))[0].n;
  ok("its changelog line is written once", line === 1, line);
  const rec = (await q(`select count(*)::int n from public.schema_migrations where version = '0385_going_live_says_how_many_will_hear'`))[0].n;
  ok("0385 records itself in the ledger", rec >= 1, rec);
}

console.log(`db.liveping: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
