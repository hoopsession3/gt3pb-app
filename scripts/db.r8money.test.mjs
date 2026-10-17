// R8 OF THE CUSTOMER AUDIT — A PACK CHANGE IS COUNTED ONCE, ON THE DAY ITS MONEY MOVED, RUN IN POSTGRES (2026-10-16; Ryan:
// "Keep working to improve to a 10").
//
//   0415  report_sales and the founder digest's week count a pack's money when it moved: the reservation (its total less
//         what its applied changes moved) on its day, and each applied change's difference on the change's day — in Packs.
//         An applied change's charge leaves walk-up money; one never applied keeps its place there.
//
// The finding, as a sentence: a member who made a paid pack bigger was charged the difference, Square sent that payment to
// the books like any other, and Money counted it twice — as walk-up money (no order of ours carried it: its change did) and
// again in Packs, which counts the pack at its new total. Taking it out of walk-up alone would lose it whenever the pack was
// reserved before the report's first day. What is run here is the whole schema up to 0414, a week of money that has every
// case in it — read by the owner before 0415, then 0415 twice, and the books and the digest again.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = readFileSync(join(ROOT, "supabase/migrations/0415_a_pack_change_is_counted_once.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c415000-0000-4000-8000-0000000000a1", SAM = "0c415000-0000-4000-8000-0000000000a2", MEMBER = "0c415000-0000-4000-8000-0000000000a3";

const t0 = Date.now();
const db = await fullSchema({ before: "0415" });
console.log(`the schema to 0414 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
const sales = async (uid = OWNER) => { const r = await as(uid, `select public.report_sales(7) r`); return r.error ? { error: r.error } : r.rows[0]?.r; };
const daysAgo = (n) => `now() - interval '${n} days'`;
const dayKey = async (n) => (await q(`select to_char((current_date - ${n}), 'MM-DD') k`))[0].k;

await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
for (const [id, role, name] of [[OWNER, "owner", "Alex Rivera"], [SAM, "member", "Sam Ito"], [MEMBER, "member", "Nia Park"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
}

// ── the week's money (cents) ────────────────────────────────────────────────────────────────────────────────────────
//   W1  a walk-up cup at the window, today: $10
//   P1  a 6-pack paid today ($36), made a 12-pack today — the change charged $42 (applied)
//   P2  a 6-pack paid TEN days ago ($36, before the week), made a 12-pack two days ago — $42 (applied)
//   P3  a 4-pack paid today ($24); a change charged $15 and was never applied (state moved: the pack changed first)
//   P4  a pack paid today ($30), made bigger ($12, applied), then canceled — all of it given back
const sale = (id, cents, ago = 0) => q(`insert into public.event_sales (square_payment_id, amount_cents, source, tenant_id, created_at) values ($1, $2, 'square', $3, ${daysAgo(ago)})`, [id, cents, T1]);
const pack = async (pay, total, ago, canceled = false) => (await q(`insert into public.drop_orders (user_id, name, size, glass, total_cents, paid, payment_id, drop_date, tenant_id, created_at, canceled_at)
  values ($1, 'Sam Ito', 12, 'return', $2, true, $3, current_date + 2, $4, ${daysAgo(ago)}, ${canceled ? "now()" : "null"}) returning id`, [SAM, total, pay, T1]))[0].id;
const change = (key, packId, state, diff, pay, ago = 0) => q(`insert into public.drop_order_changes (key, drop_order_id, user_id, state, card, before, after, diff_cents, charge_payment_id, created_at)
  values ($1, $2, $3, $4, true, '{"size": 6}', '{"size": 12}', $5, $6, ${daysAgo(ago)})`, [key, packId, SAM, state, diff, pay]);

await sale("sq-r8-w1", 1000);
const p1 = await pack("sq-r8-p1", 3600 + 4200, 0); await sale("sq-r8-p1", 3600); await change("r8-change-p1-0001", p1, "done", 4200, "sq-r8-c1"); await sale("sq-r8-c1", 4200);
const p2 = await pack("sq-r8-p2", 3600 + 4200, 10); await sale("sq-r8-p2", 3600, 10); await change("r8-change-p2-0001", p2, "done", 4200, "sq-r8-c2", 2); await sale("sq-r8-c2", 4200, 2);
const p3 = await pack("sq-r8-p3", 2400, 0); await sale("sq-r8-p3", 2400); await change("r8-change-p3-0001", p3, "moved", 1500, "sq-r8-c3"); await sale("sq-r8-c3", 1500);
const p4 = await pack("sq-r8-p4", 3000 + 1200, 0, true); await sale("sq-r8-p4", 3000); await change("r8-change-p4-0001", p4, "done", 1200, "sq-r8-c4"); await sale("sq-r8-c4", 1200);
// What the business took in the week and kept: W1 + P1 + its change + P2's change + P3 + P3's unapplied charge. P2's own
// $36 was taken before the week; P4 and its change were given back.
const KEPT = 1000 + 3600 + 4200 + 4200 + 2400 + 1500;   // $169
const sumDays = (s) => (s?.by_day ?? []).reduce((a, d) => a + Number(d.cents), 0);

// ── before 0415: the applied changes counted twice ──────────────────────────────────────────────────────────────────
{
  const s = await sales();
  const ch = s?.by_channel ?? {};
  // walk-up: W1, and every change charge (no order carries them); packs: P1 and P3 at their totals.
  ok("before 0415: applied changes' charges are walk-up money AND in Packs — revenue reads $54 more than was kept",
    ch.square_walkup === 1000 + 4200 + 4200 + 1500 + 1200 && ch.packs === 7800 + 2400 && s?.revenue_cents === KEPT + 4200 + 1200, { ch, rev: s?.revenue_cents });
}

await db.exec(SQL);
await db.exec(SQL);   // a second run changes nothing
// 0415 loads on the schema to 0414, and loads again — a throw above fails this file; a milestone, not counted as a check (R14, F25).

// ── after 0415: once, in Packs, on the day it moved ───────────────────────────────────────────────────────────────────
{
  const s = await sales();
  const ch = s?.by_channel ?? {};
  ok("0415: walk-up is the walk-up and the change never applied — an applied change's charge is the pack's money",
    ch.square_walkup === 1000 + 1500, ch);
  ok("0415: Packs is each pack's reservation (its total less its applied changes) and each applied change on its own day — a pack reserved before the week still brings its change",
    ch.packs === (7800 - 4200) + 2400 + 4200 + 4200, ch);
  ok("0415: revenue is what was taken and kept, and the days add up to it", s?.revenue_cents === KEPT && sumDays(s) === KEPT, { rev: s?.revenue_cents, days: sumDays(s) });
  const two = await dayKey(2), today = await dayKey(0);
  const day = (k) => Number((s?.by_day ?? []).find((d) => d.day === k)?.cents ?? NaN);
  ok("0415: P2's change is on the day it was charged (two days ago); today holds the rest", day(two) === 4200 && day(today) === KEPT - 4200, { two: day(two), today: day(today) });
  ok("0415: a member is still told 'unauthorized', and anon may not call it",
    (await sales(MEMBER))?.error === "unauthorized"
    && (await q(`select has_function_privilege('anon', 'public.report_sales(integer)', 'execute') a`))[0].a === false
    && (await q(`select has_function_privilege('authenticated', 'public.report_sales(integer)', 'execute') a`))[0].a === true);
  ok("0415: it says so in the changelog, once, and records itself",
    Number((await q(`select count(*) n from public.changelog where title = 'A bigger pack is counted once'`))[0].n) === 1
    && (await q(`select applied_count from public.schema_migrations where version = '0415_a_pack_change_is_counted_once'`))[0]?.applied_count === 2);
}

// ── the founder digest's week: the same money ───────────────────────────────────────────────────────────────────────
{
  const had = (await q(`select count(*) n from public.live_status where id = 1`))[0].n;
  if (Number(had) === 0) await q(`insert into public.live_status (id) values (1)`);
  await q(`update public.live_status set digest_cadence = 'daily' where id = 1`);
  await q(`select public.founder_digest_alert()`);
  const body = (await q(`select body from public.alerts where title = '📊 Daily founder digest' and tenant_id = $1 order by created_at desc limit 1`, [T1]))[0]?.body ?? "";
  ok("0415: the founder digest's week reads the same $169.00", /^Revenue 7d: \$169\.00 /.test(body), body.slice(0, 40));
  ok("0415: the digest stays the machinery's — not callable by a signed-in person or anon",
    (await q(`select has_function_privilege('authenticated', 'public.founder_digest_alert()', 'execute') a`))[0].a === false
    && (await q(`select has_function_privilege('anon', 'public.founder_digest_alert()', 'execute') a`))[0].a === false);
}

console.log(`R8 MONEY (0415, in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
