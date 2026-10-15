// 0403 — AN APPLE SIGN-IN JOINS THE ACCOUNT IT BELONGS TO, executed against the whole schema (every migration, in order,
// with Supabase's own default privileges: scripts/fixtures/schema.full.mjs), acting as anon, a member and the server the
// way PostgREST does.
//
// The finding, as a sentence (A3 of the account audit): Sign in with Apple can hide the email behind a relay address that
// matches nobody's, so a member who joined with their email and then tapped Continue with Apple got a second, empty
// account — and nothing linked the two. The server joins them (app/api/account/link-apple, lib/appleLink) when the Apple
// account holds nothing a person would lose; these are the two questions it asks the database.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL403 = readFileSync(join(ROOT, "supabase/migrations/0403_an_apple_sign_in_joins_the_account_it_belongs_to.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const MEMBER = "0c403000-0000-4000-8000-0000000000a1";   // joined with her email: Casey, with stamps
const APPLE = "0c403000-0000-4000-8000-0000000000b1";    // her second account, made by Continue with Apple a moment ago
const OTHER = "0c403000-0000-4000-8000-0000000000b2";    // someone else's Apple account, which ordered
const SUB = "001234.0a1b2c3d4e5f.0403";                    // Apple's sub for her Apple ID
const SUB2 = "001234.ffeeddccbbaa.0403";

const t0 = Date.now();
const db = await fullSchema();
console.log(`the whole schema loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`);
// "server" is the service role with no session; a uid is a signed-in person; null is anon.
const as = async (uid, sql, params) => {
  const sub = uid && uid !== "server" ? uid : "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false);
    set role ${uid === "server" ? "service_role" : uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code }; }
  finally { await root(); }
};
const unused = async (id) => (await q1(`select public.account_unused($1) as u`, [id])).u;

// ── the people: signing up makes the profile and the customer record (handle_new_user) ──
await q(`insert into auth.users (id, email) values ($1, 'casey@example.test'), ($2, 'x7k2pq9abc@privaterelay.appleid.com'), ($3, 'r4nd0m@privaterelay.appleid.com')`, [MEMBER, APPLE, OTHER]);
await q(`update public.profiles set tenant_id = $1 where id in ($2, $3, $4)`, [T1, MEMBER, APPLE, OTHER]);
await q(`insert into auth.identities (user_id, provider, provider_id) values ($1, 'email', $2), ($3, 'apple', $4), ($5, 'apple', $6)`, [MEMBER, MEMBER, APPLE, SUB, OTHER, SUB2]);
await q(`insert into public.loyalty_ledger (user_id, kind, points, note, tenant_id) values ($1, 'award', 10, 'Ten stamps', $2)`, [MEMBER, T1]);
const otherCust = (await q1(`select id from public.customers where user_id = $1`, [OTHER])).id;
await q(`insert into public.orders (user_id, customer_id, customer, items, total_cents, tenant_id) values ($1, $2, 'Rory', '{}', 1000, $3)`, [OTHER, otherCust, T1]);

// ── 1 · which account an Apple ID signs in to ──
ok("1 · account_for_apple: Apple's sub names the account it signs in to", (await q1(`select public.account_for_apple($1) as a`, [SUB])).a === APPLE);
ok("1 · an Apple ID nobody has used: no account", (await q1(`select public.account_for_apple('001234.unknown') as a`)).a === null);
ok("1 · an email identity is not an Apple one, whatever its id", (await q1(`select public.account_for_apple($1) as a`, [MEMBER])).a === null);

// ── 2 · whether an account holds nothing a person would lose ──
ok("2 · the account Continue with Apple just made holds nothing — the profile and customer record signing up writes don't count", await unused(APPLE) === true);
// what signing in makes by itself, or nobody would miss, still leaves it unused
await q(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, tenant_id) values ($1, 'https://push.example/apple', 'k', 'a', $2)`, [APPLE, T1]);
await q(`insert into public.notif_prefs (user_id) values ($1) on conflict do nothing`, [APPLE]);
await q(`insert into public.apple_tokens (user_id, apple_user, refresh_token) values ($1, $2, 'r.token.0403')`, [APPLE, SUB]);
ok("2 · a push registration, notification settings and the Apple token don't count either", await unused(APPLE) === true);
ok("2 · the member with ten stamps is not unused", await unused(MEMBER) === false);
ok("2 · an Apple account that ordered is not unused — found through the order's customer record and its account", await unused(OTHER) === false);
ok("2 · nobody, or an account that isn't there: not unused", (await q1(`select public.account_unused(null) as u`)).u === false
  && await unused("0c403000-0000-4000-8000-0000000000ff") === false);

// each thing a person would lose, one at a time, on a fresh copy of the Apple account's state
const each = [
  ["a stamp", `insert into public.loyalty_ledger (user_id, kind, points, note, tenant_id) values ($1, 'award', 1, 'One', '${T1}')`],
  ["points on the profile", `update public.profiles set points = 5 where id = $1`],
  ["store credit", `update public.profiles set credit_cents = 500 where id = $1`],
  ["a founding place", `update public.profiles set founding_member = true where id = $1`],
  ["a photo on the profile", `update public.profiles set avatar_url = 'https://x/avatars/a.jpg' where id = $1`],
  ["a role on the crew", `update public.profiles set role = 'server' where id = $1`],
  ["a review", `insert into public.reviews (user_id, name, rating, body, tenant_id) values ($1, 'R', 5, 'Great', '${T1}')`],
  ["a check-in", `insert into public.check_ins (user_id, day, note, tenant_id) values ($1, current_date, 'x', '${T1}')`],
  ["a membership", `insert into public.subscriptions (user_id, square_subscription_id, plan, status, tenant_id) values ($1, 'sq-sub-0403', 'six', 'active', '${T1}')`],
  ["a yes to texts", `select public.say_text_consent('+18645550199', true, 'pack_checkout', $1)`],
  ["a photo in storage", `insert into storage.objects (bucket_id, name) values ('vip', $1::text || '/badge.jpg')`],
];
for (const [what, sql] of each) {
  await q(`begin`);
  try {
    if (what === "a photo in storage") await q(`insert into storage.buckets (id, name) values ('vip', 'vip') on conflict do nothing`);
    await q(sql, [APPLE]);
    ok(`2 · ${what} makes it used`, await unused(APPLE) === false);
  } catch (e) { ok(`2 · ${what} makes it used`, false, String(e.message || e)); }
  await q(`rollback`);
}
// someone they referred names them through profiles.referred_by — a table that is otherwise one signing in writes
await q(`begin`);
await q(`update public.profiles set referred_by = $1 where id = $2`, [APPLE, MEMBER]);
ok("2 · someone they referred makes it used (profiles.referred_by, though the profile itself is signing in's)", await unused(APPLE) === false);
await q(`rollback`);
ok("2 · and every one of those was undone: the Apple account is unused again", await unused(APPLE) === true);

// a table added later that points at an account counts without anyone naming it
await q(`create table public.zz_later (id serial primary key, user_id uuid references auth.users(id) on delete set null)`);
await q(`insert into public.zz_later (user_id) values ($1)`, [APPLE]);
ok("2 · a table added later that points at the account counts, unnamed (the catalog, as 0353 reads it)", await unused(APPLE) === false);
await q(`drop table public.zz_later`);

// ── 3 · only the server asks ──
const anon = await as(null, `select public.account_unused($1)`, [APPLE]);
const member = await as(MEMBER, `select public.account_for_apple($1)`, [SUB]);
const server = await as("server", `select public.account_unused($1) as u, public.account_for_apple($2) as a`, [APPLE, SUB]);
ok("3 · nobody signed out may ask", /permission denied/i.test(anon.error || ""), anon.error);
ok("3 · nor a signed-in member — which account an Apple ID opens is not theirs to learn", /permission denied/i.test(member.error || ""), member.error);
ok("3 · the server may (the service role)", !server.error && server.rows[0]?.u === true && server.rows[0]?.a === APPLE, server.error ?? server.rows[0]);

// ── 4 · a second run, and the ledger ──
let again = null;
try { await db.exec(SQL403); } catch (e) { again = String(e.message || e); }
ok("4 · 0403 runs twice without an error", again === null, again);
ok("4 · its changelog line once", Number((await q1(`select count(*)::int n from public.changelog where title = 'Sign in with Apple finds the account you already have'`)).n) === 1);
ok("4 · 0403 is in the ledger", Number((await q1(`select count(*)::int as n from public.schema_migrations where version like '0403%'`)).n) >= 1);

await db.close();
console.log(`\nAPPLE LINK (0403): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
