// 0392 — APPROVALS AND TIERS HAVE OWNERS, executed from its file against the whole schema (every migration before it,
// in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does.
//
// The finding, as a sentence (A1 of the account audit): four writes trusted the wrong person — a member could post a
// review already approved and a bottle proof already verified as Founding VIP, any crew member could set anyone's
// tier, and any crew member could stamp any card as often as they liked, their own included; and a tier change left no
// line in the Activity log. After 0392 each is refused for the wrong person and still works for the right one.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F392 = "0392_approvals_and_tiers_have_owners.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c392000-0000-4000-8000-0000000000c1", ADMIN = "0c392000-0000-4000-8000-0000000000c2",
  SERVER = "0c392000-0000-4000-8000-0000000000c3", JORDAN = "0c392000-0000-4000-8000-0000000000c4",
  RIVER = "0c392000-0000-4000-8000-0000000000c5", SAM = "0c392000-0000-4000-8000-0000000000c6";

const t0 = Date.now();
const db = await fullSchema({ before: "0392" });
console.log(`the schema before 0392 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select on all tables in schema public to anon, authenticated;
`);
// Made-up people: the owner, an admin, a server, and three members.
for (const [id, role] of [[OWNER, "owner"], [ADMIN, "admin"], [SERVER, "server"], [JORDAN, "member"], [RIVER, "member"], [SAM, "member"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
// Every account has its customer row (0246); make sure, without assuming the trigger's shape.
for (const id of [JORDAN, RIVER, SAM, SERVER]) {
  if (!(await q(`select 1 from public.customers where user_id = $1`, [id])).length) {
    await q(`insert into public.customers (user_id, name) values ($1, 'A member')`, [id]);
  }
}
const tierOf = async (id) => (await q(`select c.tier, c.vip_verified, p.founding_member from public.customers c join public.profiles p on p.id = c.user_id where c.user_id = $1`, [id]))[0];
const trail = async () => q(`select actor, table_name, row_pk, summary, old_row, new_row from public.admin_audit where table_name = 'customers' order by id`);
const review = (uid, extra = {}) => {
  const cols = ["user_id", "name", "rating", "body", ...Object.keys(extra)];
  const vals = [uid, "Jordan", 5, "Great", ...Object.values(extra)];
  // No RETURNING, as the app sends it (ReviewPrompt): a member can't read their own review back until it's approved.
  return as(uid, `insert into public.reviews (${cols.join(", ")}) values (${vals.map((_, i) => `$${i + 1}`).join(", ")})`, vals);
};
const reviewsOf = async (uid) => q(`select approved, source from public.reviews where user_id = $1 order by created_at`, [uid]);

// ── BEFORE 0392: the four holes are there ──────────────────────────────────────────────────────────────────────
{
  const r = await review(JORDAN, { approved: true });
  ok("before 0392: a member could post their own review already approved", !r.error && (await reviewsOf(JORDAN))[0]?.approved === true, r);
  const p = await as(JORDAN, `insert into public.vip_verifications (user_id, photo_url, status, granted_tier) values ($1, 'x.jpg', 'verified', 'founding_vip') returning status`, [JORDAN]);
  ok("…and file a bottle proof already verified as Founding VIP — which turned the VIP flag on", !p.error && (await tierOf(JORDAN)).vip_verified === true, { p, t: await tierOf(JORDAN) });
  const t = await as(SERVER, `select public.admin_set_customer_tier($1, 'founding')`, [RIVER]);
  ok("…a server could set anyone's tier", !t.error && (await tierOf(RIVER)).tier === "founding", t);
  const s = await as(SERVER, `select public.award_manual_point($1) n`, [SERVER]);
  ok("…and stamp their own card", !s.error && s.rows[0]?.n >= 1, s);
  // Put the made-up world back where it started.
  await db.exec(`select set_config('gt3.allow_hard_delete', 'on', false);
    delete from public.reviews; delete from public.vip_verifications; delete from public.loyalty_ledger where channel = 'scan';
    select set_config('gt3.allow_hard_delete', '', false);`);
  await q(`update public.customers set tier = 'member', vip_verified = false where user_id = any($1::uuid[])`, [[JORDAN, RIVER, SAM, SERVER]]);
  await q(`update public.profiles set founding_member = false where id = any($1::uuid[])`, [[JORDAN, RIVER, SAM, SERVER]]);
  await db.exec(`delete from public.admin_audit where table_name = 'customers';`);
}

await db.exec(MIG(F392));

// ── REVIEWS ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = await review(JORDAN, { approved: true });
  ok("a member can't post their own review approved", /row-level security/.test(r.error || ""), r);
  const g = await review(JORDAN, { source: "google" });
  ok("…nor dress it as a Google review", /row-level security/.test(g.error || ""), g);
  const fine = await review(JORDAN);
  const mine = await reviewsOf(JORDAN);
  ok("…and still posts one, waiting for the crew", !fine.error && mine.length === 1 && mine[0].approved === false && mine[0].source === "app", { fine, mine });
  const staff = await as(SERVER, `insert into public.reviews (name, rating, body, source, approved) values ('From Google', 5, 'Ace', 'google', true) returning approved`);
  ok("staff still add an approved review by hand", !staff.error && staff.rows[0]?.approved === true, staff);
  const mod = await as(SERVER, `update public.reviews set approved = true where user_id = $1 returning approved`, [JORDAN]);
  ok("…and approve a member's", !mod.error && mod.rows[0]?.approved === true, mod);
}

// ── BOTTLE PROOFS ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const v = await as(JORDAN, `insert into public.vip_verifications (user_id, photo_url, status, granted_tier) values ($1, 'x.jpg', 'verified', 'founding_vip')`, [JORDAN]);
  ok("a member can't file their own proof verified", /row-level security/.test(v.error || "") && (await tierOf(JORDAN)).vip_verified === false, v);
  const rw = await as(JORDAN, `insert into public.vip_verifications (user_id, photo_url, reward) values ($1, 'x.jpg', 'a free bottle')`, [JORDAN]);
  ok("…nor write their own reward on it", /row-level security/.test(rw.error || ""), rw);
  const fine = await as(JORDAN, `insert into public.vip_verifications (user_id, photo_url) values ($1, 'proof.jpg') returning id, status`, [JORDAN]);
  ok("…and still files one, pending", !fine.error && fine.rows[0]?.status === "pending", fine);
  const id = fine.rows[0]?.id;
  const sv = await as(SERVER, `update public.vip_verifications set status = 'verified', granted_tier = 'founding_vip' where id = $1`, [id]);
  ok("a server can't verify it — verifying grants a tier", /row-level security/.test(sv.error || "") && (await tierOf(JORDAN)).vip_verified === false, sv);
  const second = await as(RIVER, `insert into public.vip_verifications (user_id, photo_url) values ($1, 'r.jpg') returning id`, [RIVER]);
  const sr = await as(SERVER, `update public.vip_verifications set status = 'rejected', note = 'blurry' where id = $1 returning status`, [second.rows[0]?.id]);
  ok("…but still turns a pending one down", !sr.error && sr.rows[0]?.status === "rejected", sr);
  const back = await as(SERVER, `update public.vip_verifications set status = 'pending' where id = $1 returning status`, [second.rows[0]?.id]);
  ok("…and can't reopen one already decided", back.rows.length === 0, back);
  const av = await as(ADMIN, `update public.vip_verifications set status = 'verified', granted_tier = 'founding_vip', reviewed_by = $2 where id = $1 returning status`, [id, ADMIN]);
  ok("an admin verifies it, and the VIP flag turns on", !av.error && av.rows[0]?.status === "verified" && (await tierOf(JORDAN)).vip_verified === true, av);
  const line = (await trail()).find((l) => l.row_pk === JORDAN && /Founding VIP: off → on/.test(l.summary || ""));
  ok("…and the Activity log says so, with who", line?.actor === ADMIN, await trail());
}

// ── TIERS ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const st = await as(SERVER, `select public.admin_set_customer_tier($1, 'founding')`, [RIVER]);
  ok("a server can't set a tier", /only an admin or the owner/.test(st.error || "") && (await tierOf(RIVER)).tier === "member", st);
  const sv = await as(SERVER, `select public.admin_set_customer_vip($1, true)`, [RIVER]);
  ok("…nor the VIP flag", /only an admin or the owner/.test(sv.error || "") && (await tierOf(RIVER)).vip_verified === false, sv);
  const mt = await as(JORDAN, `select public.admin_set_customer_tier($1, 'founding')`, [JORDAN]);
  ok("…and a member can't set their own", /only an admin or the owner/.test(mt.error || ""), mt);
  const before = (await trail()).length;
  const at = await as(ADMIN, `select public.admin_set_customer_tier($1, 'founding')`, [RIVER]);
  const t = await tierOf(RIVER);
  ok("an admin sets one: the tier and the Founding badge move together", !at.error && t.tier === "founding" && t.founding_member === true, { at, t });
  const lines = (await trail()).slice(before);
  ok("…one line in the Activity log: who, the customer, before → after", lines.length === 1 && lines[0].actor === ADMIN
    && lines[0].row_pk === RIVER && lines[0].summary === "tier: member → founding", lines);
  ok("…and the line keeps the tier and nothing else of the person", lines.length === 1
    && Object.keys(lines[0].new_row).sort().join() === "tier,vip_verified" && !/example\.test|A member/.test(JSON.stringify(lines[0])), lines);
  const ot = await as(OWNER, `select public.admin_set_customer_tier($1, 'member')`, [RIVER]);
  ok("the owner sets one too", !ot.error && (await tierOf(RIVER)).tier === "member", ot);
  const same = (await trail()).length;
  await as(ADMIN, `select public.admin_set_customer_tier($1, 'member')`, [RIVER]);
  ok("setting the tier it already has writes no line", (await trail()).length === same);
  const grants = (await q(`select has_function_privilege('anon', 'public.admin_set_customer_tier(uuid, text)', 'execute') a,
    has_function_privilege('authenticated', 'public.admin_set_customer_tier(uuid, text)', 'execute') b`))[0];
  ok("grants: anon can't call it; a signed-in caller can (the function judges)", grants.a === false && grants.b === true, grants);
}

// ── THE OWNER'S LOYALTY EDIT ───────────────────────────────────────────────────────────────────────────────────
{
  const before = (await trail()).length;
  const o = await as(OWNER, `select public.admin_set_member($1, 12, null, true)`, [SAM]);
  const adj = (await q(`select by_user, points from public.loyalty_ledger where user_id = $1 and kind = 'adjust'`, [SAM]))[0];
  ok("the owner's point adjustment says who made it", !o.error && adj?.by_user === OWNER && adj?.points === 12, { o, adj });
  const lines = (await trail()).slice(before);
  ok("…and flipping the Founding switch is a line in the Activity log", lines.length === 1 && lines[0].summary === "Founding member: off → on" && lines[0].actor === OWNER, lines);
  const again = await as(OWNER, `select public.admin_set_member($1, 12, null, true)`, [SAM]);
  ok("…saving it again unchanged writes nothing", !again.error && (await trail()).length === before + 1);
  const a = await as(ADMIN, `select public.admin_set_member($1, 99, null, null)`, [SAM]);
  ok("…and it stays the owner's alone", /not authorized/.test(a.error || ""), a);
}

// ── WALK-UP STAMPS ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const own = await as(SERVER, `select public.award_manual_point($1) n`, [SERVER]);
  ok("nobody stamps their own card", /your own card/.test(own.error || ""), own);
  const ownAdmin = await as(ADMIN, `select public.award_manual_point($1) n`, [ADMIN]);
  ok("…not an admin either", /your own card/.test(ownAdmin.error || ""), ownAdmin);
  const other = await as(ADMIN, `select public.award_manual_point($1) n`, [SERVER]);
  ok("a crew member's card is stamped by someone else", !other.error && other.rows[0]?.n >= 1, other);
  let last = null;
  for (let i = 0; i < 6; i++) last = await as(SERVER, `select public.award_manual_point($1) n`, [JORDAN]);
  ok("a server stamps a member's walk-up cups, six in a row", !last.error && last.rows[0]?.n >= 6, last);
  const signed = (await q(`select count(*)::int n from public.loyalty_ledger where user_id = $1 and channel = 'scan' and by_user = $2`, [JORDAN, SERVER]))[0].n;
  ok("…each one signed by who stamped it", signed === 6, signed);
  const seventh = await as(SERVER, `select public.award_manual_point($1) n`, [JORDAN]);
  ok("…the seventh in 10 minutes is refused, and says why", /stamp limit/.test(seventh.error || ""), seventh);
  const otherCrew = await as(ADMIN, `select public.award_manual_point($1) n`, [JORDAN]);
  ok("…by anyone: the limit is the member's, not the scanner's", /stamp limit/.test(otherCrew.error || ""), otherCrew);
  const river = await as(SERVER, `select public.award_manual_point($1) n`, [RIVER]);
  ok("another member is stamped as usual", !river.error && river.rows[0]?.n >= 1, river);
  await q(`update public.loyalty_ledger set created_at = created_at - interval '11 minutes' where user_id = $1 and channel = 'scan'`, [JORDAN]);
  const later = await as(SERVER, `select public.award_manual_point($1) n`, [JORDAN]);
  ok("…and ten minutes on, Jordan can be stamped again", !later.error && later.rows[0]?.n >= 7, later);
}

// ── RUN TWICE ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const pol = async () => (await q(`select count(*)::int n from pg_policies where tablename in ('reviews', 'vip_verifications')`))[0].n;
  const n = await pol();
  await db.exec(MIG(F392));
  ok("a second run changes nothing: the same policies, one trigger, one changelog line, recorded", (await pol()) === n
    && (await q(`select count(*)::int n from pg_trigger where tgname = 'audit_customers_tier'`))[0].n === 1
    && (await q(`select count(*)::int n from public.changelog where title = 'Approvals and tiers have owners'`))[0].n === 1
    && (await q(`select count(*)::int n from public.schema_migrations where version = '0392_approvals_and_tiers_have_owners'`))[0].n >= 1);
}

console.log(`db.permissions: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
