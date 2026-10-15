// 0404 — AN ACCOUNT IS ERASED BEFORE ANYTHING OUTSIDE IT, executed against the whole schema (every migration, in order,
// with Supabase's own default privileges and stand-ins for auth, storage and cron: scripts/fixtures/schema.full.mjs).
//
// The finding, as a sentence (A3 of the account audit): deleting an account cancelled the membership at Square, removed
// the photos and revoked Sign in with Apple before the database's erasure — which could still say no — so a refusal left
// an account standing without its membership, its photos or its Apple sign-in. The database goes first now, and what lies
// outside it follows from a queue the erasure cannot commit without. The claims:
//   1. A membership no longer stands in the way; the only owner and an order on its way still do, in the same words.
//   2. Deleting writes what is left outside — the membership's cancel, the Square profile, the Apple token, each photo —
//      with the route's ticket, in the deleting transaction: a refused deletion leaves no row at all.
//   3. The route takes its own rows, once; done is gone, a failure is free to be taken again.
//   4. What can't be done goes to the crew, once, saying what to do by hand — the membership's rings; an Apple token is
//      let go. The watch does the same for rows nobody finished.
//   5. Only the server reads or writes the queue; the watch is on the schedule; a second run changes nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL404 = readFileSync(join(ROOT, "supabase/migrations/0404_an_account_is_erased_before_anything_outside_it.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c404000-0000-4000-8000-0000000000c1";
const CASEY = "0c404000-0000-4000-8000-0000000000a1";   // a member with a membership, a saved card, Apple, two photos
const RORY = "0c404000-0000-4000-8000-0000000000a2";    // a member with an order on its way

const t0 = Date.now();
const db = await fullSchema();
console.log(`the whole schema loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const n = async (s, p) => Number((await q1(s, p)).n);
const raises = async (s, p) => { try { await q(s, p); return null; } catch (e) { return String(e.message || e); } };
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`);
const as = async (uid, sql, params) => {
  const sub = uid && uid !== "server" ? uid : "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false);
    set role ${uid === "server" ? "service_role" : uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code }; }
  finally { await root(); }
};
const blockers = async (id) => (await q1(`select public.account_erasure_blockers($1) as b`, [id])).b.map((x) => x.code);

for (const [id, email, role] of [[OWNER, "owner@example.test", "owner"], [CASEY, "casey@example.test", "member"], [RORY, "rory@example.test", "member"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
const casey = (await q1(`select id from public.customers where user_id = $1`, [CASEY])).id;
await q(`update public.profiles set square_customer_id = 'SQ-CUST-7Q2X' where id = $1`, [CASEY]);
await q(`insert into public.subscriptions (user_id, customer_id, square_subscription_id, plan, status, tenant_id) values
  ($1, $2, 'SQ-SUB-LIVE', 'six', 'active', $3), ($1, $2, 'SQ-SUB-OLD', 'six', 'canceled', $3)`, [CASEY, casey, T1]);
await q(`insert into public.apple_tokens (user_id, apple_user, refresh_token) values ($1, '001234.7q2x', 'r.7q2x.apple')`, [CASEY]);
await q(`insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true), ('vip', 'vip', true) on conflict do nothing`);
await q(`insert into storage.objects (bucket_id, name) values ('avatars', $1 || '/face.jpg'), ('vip', $1 || '/badge.jpg'), ('avatars', $2 || '/face.jpg')`, [CASEY, RORY]);
const rory = (await q1(`select id from public.customers where user_id = $1`, [RORY])).id;
await q(`insert into public.drop_orders (user_id, customer_id, name, phone, size, glass, total_cents, drop_date, tenant_id) values ($1, $2, 'Rory', '864-555-0100', 6, 'new', 6000, current_date + 2, $3)`, [RORY, rory, T1]);
await q(`update public.profiles set square_customer_id = 'SQ-CUST-RORY' where id = $1`, [RORY]);

// ── 1 · what stands in the way ──
ok("1 · a membership Square can still bill no longer stands in the way", (await blockers(CASEY)).length === 0, await blockers(CASEY));
ok("1 · an order on its way still does, in its words", (await blockers(RORY)).includes("order_on_its_way"), await blockers(RORY));
ok("1 · and so does the business's only owner", (await blockers(OWNER)).includes("only_owner"), await blockers(OWNER));

// ── 2 · deleting writes what is left outside, in its transaction ──
const refused = await raises(`delete from auth.users where id = $1`, [RORY]);
ok("2 · a refused deletion (an order on its way) is refused whole", /order on its way/.test(refused || "") && (await n(`select count(*) n from public.profiles where id = $1`, [RORY])) === 1, refused);
ok("2 · and leaves nothing in the queue — not the Square profile, not the photo", (await n(`select count(*) n from public.erasure_followups`)) === 0);

await q(`update auth.users set raw_app_meta_data = jsonb_build_object('erasure_ticket', 'tkt-7f3a90') where id = $1`, [CASEY]);
const gone = await raises(`delete from auth.users where id = $1`, [CASEY]);
ok("2 · Casey's deletion goes through, membership and all", gone === null && (await n(`select count(*) n from public.profiles where id = $1`, [CASEY])) === 0, gone);
const rows = await q(`select kind, ref, ticket from public.erasure_followups order by kind, ref`);
const has = (kind, ref) => rows.some((r) => r.kind === kind && r.ref === ref && r.ticket === "tkt-7f3a90");
ok("2 · the membership Square can still bill is queued to cancel — not the one already cancelled",
  has("square_subscription", "SQ-SUB-LIVE") && !rows.some((r) => r.ref === "SQ-SUB-OLD") && rows.filter((r) => r.kind === "square_subscription").length === 1, rows);
ok("2 · the Square profile that holds the saved card is queued", has("square_customer", "SQ-CUST-7Q2X"), rows);
ok("2 · the Apple token is queued to revoke", has("apple_token", "r.7q2x.apple"), rows);
ok("2 · both her photos are queued, and nobody else's", has("photo", `avatars/${CASEY}/face.jpg`) && has("photo", `vip/${CASEY}/badge.jpg`) && !rows.some((r) => r.ref.includes(RORY)), rows);
ok("2 · five rows in all, and nothing in them says who", rows.length === 5 && !rows.some((r) => /casey@example|Casey/.test(JSON.stringify(r))), rows);
ok("2 · the queue's trigger fires before the erasure's (name order), so it read the profile the erasure deletes",
  (await q(`select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and tgname in ('erasure_queues_what_is_outside', 'on_auth_user_deleted') order by tgname`)).map((r) => r.tgname).join(",") === "erasure_queues_what_is_outside,on_auth_user_deleted");

// ── 3 · the route takes its own rows, once ──
const take = async (ticket, limit = 20) => (await as("server", `select id, kind, ref, attempts from public.claim_erasure_followups($1, $2)`, [ticket, limit])).rows;
const mine = await take("tkt-7f3a90");
ok("3 · the route takes its own five, each tried once", mine.length === 5 && mine.every((r) => r.attempts === 1), mine);
ok("3 · taken again at once: nothing — they're being worked", (await take("tkt-7f3a90")).length === 0);
ok("3 · a ticket that isn't hers takes nothing", (await take("tkt-somebody-else")).length === 0);
const sub = mine.find((r) => r.kind === "square_subscription"), cust = mine.find((r) => r.kind === "square_customer");
const apple = mine.find((r) => r.kind === "apple_token"), photos = mine.filter((r) => r.kind === "photo");
for (const p of photos) await as("server", `select public.finish_erasure_followup($1, true)`, [p.id]);
ok("3 · a step done is gone — nothing kept", (await n(`select count(*) n from public.erasure_followups where kind = 'photo'`)) === 0);
await as("server", `select public.finish_erasure_followup($1, false, 'Square answered 503')`, [sub.id]);
const after = await q1(`select claimed_at, last_error, attempts from public.erasure_followups where id = $1`, [sub.id]);
ok("3 · a step that failed says why and is free to be taken again", after.claimed_at === null && after.last_error === "Square answered 503" && after.attempts === 1, after);
const again = await take(null);
ok("3 · with no ticket, the oldest open rows are taken — the failed one among them, tried a second time", again.some((r) => r.id === sub.id && r.attempts === 2), again);

// ── 4 · what can't be done goes to the crew, once ──
const alerts = async (id) => q(`select severity, category, title, body, link from public.alerts where kind = 'erasure_followup' and subject_id = $1`, [id]);
await as("server", `select public.erasure_followup_alert($1)`, [sub.id]);
await as("server", `select public.erasure_followup_alert($1)`, [sub.id]);
const sa = await alerts(sub.id);
ok("4 · a membership the route couldn't cancel rings the crew — critical, money — once, with the subscription to cancel by hand",
  sa.length === 1 && sa[0].severity === "critical" && sa[0].category === "money" && /SQ-SUB-LIVE/.test(sa[0].body) && /Square › Subscriptions/.test(sa[0].body), sa);
ok("4 · and it is handed off: no worker takes it again", (await q1(`select handed_off_at from public.erasure_followups where id = $1`, [sub.id])).handed_off_at !== null
  && !(await take(null)).some((r) => r.id === sub.id));
await as("server", `select public.erasure_followup_alert($1)`, [cust.id]);
const ca = await alerts(cust.id);
ok("4 · the Square profile: important, money, with the profile to delete", ca.length === 1 && ca[0].severity === "important" && /SQ-CUST-7Q2X/.test(ca[0].body), ca);
await as("server", `select public.erasure_followup_alert($1)`, [apple.id]);
ok("4 · an Apple token has no hand step: it is let go, with no alert", (await n(`select count(*) n from public.erasure_followups where id = $1`, [apple.id])) === 0 && (await alerts(apple.id)).length === 0);
ok("4 · no alert says who", !(await q(`select body from public.alerts where kind = 'erasure_followup'`)).some((r) => /casey/i.test(r.body)));

// the watch: rows nobody finished
await q(`insert into public.erasure_followups (kind, ref, created_at) values ('square_customer', 'SQ-CUST-STUCK', now() - interval '20 minutes'),
  ('photo', 'vip/x/new.jpg', now() - interval '5 minutes'), ('apple_token', 'r.old', now() - interval '2 hours'), ('apple_token', 'r.new', now() - interval '10 minutes')`);
const watched = Number((await as("server", `select public.erasure_followups_watch() as w`)).rows[0]?.w);
const stuck = (await q1(`select id, handed_off_at from public.erasure_followups where ref = 'SQ-CUST-STUCK'`));
ok("4 · the watch hands a row nobody finished in fifteen minutes to the crew", watched === 1 && stuck.handed_off_at !== null && (await alerts(stuck.id)).length === 1, { watched, stuck });
ok("4 · and leaves a newer one to its worker", (await q1(`select handed_off_at from public.erasure_followups where ref = 'vip/x/new.jpg'`)).handed_off_at === null);
ok("4 · an Apple token nobody revoked in an hour is let go; a newer one stays", (await n(`select count(*) n from public.erasure_followups where ref = 'r.old'`)) === 0
  && (await n(`select count(*) n from public.erasure_followups where ref = 'r.new'`)) === 1);

// ── 5 · only the server ──
for (const [who, uid] of [["nobody signed out", null], ["a signed-in member", RORY]]) {
  const read = await as(uid, `select * from public.erasure_followups`);
  const write = await as(uid, `insert into public.erasure_followups (kind, ref) values ('photo', 'x/y')`);
  const claim = await as(uid, `select * from public.claim_erasure_followups(null, 5)`);
  const watch = await as(uid, `select public.erasure_followups_watch()`);
  ok(`5 · ${who} can't read the queue, write it, take from it or run the watch`,
    /permission denied/i.test(read.error || "") && /permission denied/i.test(write.error || "") && /permission denied/i.test(claim.error || "") && /permission denied/i.test(watch.error || ""),
    { read: read.error, write: write.error, claim: claim.error, watch: watch.error });
}
ok("5 · row level security is on", (await q1(`select relrowsecurity r from pg_class where oid = 'public.erasure_followups'::regclass`)).r === true);
ok("5 · the watch is on the schedule, every ten minutes", (await q1(`select schedule from cron.job where jobname = 'erasure-followups-watch'`))?.schedule === "*/10 * * * *");
let rerun = null;
try { await db.exec(SQL404); } catch (e) { rerun = String(e.message || e); }
ok("5 · 0404 runs twice without an error, one trigger and one job", rerun === null
  && (await n(`select count(*) n from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'erasure_queues_what_is_outside'`)) === 1
  && (await n(`select count(*) n from cron.job where jobname = 'erasure-followups-watch'`)) === 1, rerun);
ok("5 · 0404 is in the ledger", (await n(`select count(*)::int as n from public.schema_migrations where version like '0404%'`)) >= 1);

await db.close();
console.log(`\nERASE QUEUE (0404): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
