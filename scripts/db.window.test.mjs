// 0389 — ONE PURCHASE, ONE STAMP · CREDIT IS SPENT AT THE WINDOW, executed from its file against the whole schema
// (every migration before it, in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way
// PostgREST does.
//
// The finding, as two sentences (H8 of the customer frontend audit): one purchase could earn two stamps — an app order
// stamps itself at pickup and the card told the member to scan for a stamp too; and referral credit was shown but
// nothing could spend it. After 0389 the crew's scan screen reads what the member ordered in the app today
// (member_card), the walk-up stamp is signed by who gave it, and credit is taken off at the window (spend_credit), once.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F389 = "0389_one_purchase_one_stamp_and_credit_at_the_window.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const SERVER = "0c389000-0000-4000-8000-0000000000c1", JORDAN = "0c389000-0000-4000-8000-0000000000c2",
  RIVER = "0c389000-0000-4000-8000-0000000000c3";

const t0 = Date.now();
const db = await fullSchema({ before: "0389" });
console.log(`the schema before 0389 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
// Made-up people: a server, and two members with made-up card codes. Jordan has $5 of credit.
for (const [id, role, code] of [[SERVER, "server", "SERVER-3MP"], [JORDAN, "member", "JORDAN-3MP"], [RIVER, "member", "RIVER-3MP"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3, referral_code = $4, display_name = $5 where id = $1`, [id, role, T1, code, `Made-up ${role}`]);
}
await q(`update public.profiles set credit_cents = 500 where id = $1`, [JORDAN]);
// Jordan's app orders: two today (2 cups and 1 cup), one voided today, one yesterday; a pack for today's pickup, one later.
const cup = (items, status, ago) => q(`insert into public.orders (user_id, customer, items, total_cents, status, created_at) values ($1, 'Jordan', $2, 1000, $3, now() - $4::interval)`, [JORDAN, items, status, ago]);
await cup(["rise", "flow"], "new", "0 minutes"); await cup(["dusk"], "done", "0 minutes"); await cup(["rise", "rise", "rise"], "void", "0 minutes"); await cup(["flow"], "done", "1 day");
const pack = (day) => q(`insert into public.drop_orders (user_id, name, size, glass, mix, total_cents, drop_date) values ($1, 'Jordan', 6, 'return', '{"RISE":6}', 3000, ${day})`, [JORDAN]);
await pack(`(now() at time zone 'America/New_York')::date`); await pack(`(now() at time zone 'America/New_York')::date + 7`);

// ── BEFORE 0389 ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const card = await as(SERVER, `select public.member_card('JORDAN-3MP') c`);
  ok("before 0389: the scan screen cannot read what a member ordered in the app", /member_card/.test(card.error || "") && /does not exist/.test(card.error || ""), card);
  const spend = await as(SERVER, `select public.spend_credit('JORDAN-3MP') c`);
  ok("before 0389: credit cannot be spent anywhere", /spend_credit/.test(spend.error || "") && /does not exist/.test(spend.error || ""), spend);
  await as(SERVER, `select public.award_manual_point('RIVER-3MP')`);
  const row = (await q(`select by_user from public.loyalty_ledger where user_id = $1 and channel = 'scan' order by created_at desc limit 1`, [RIVER]))[0];
  ok("before 0389: a walk-up stamp says nothing of who gave it", row && row.by_user === null, row);
}

await db.exec(MIG(F389));

// ── what the scan screen reads ───────────────────────────────────────────────────────────────────────────────
{
  const r = await as(SERVER, `select public.member_card('JORDAN-3MP') c`);
  const c = r.rows[0]?.c;
  ok("member_card: name, points, the credit", c && c.display_name === "Made-up member" && c.credit_cents === 500 && c.founding_member === false, r);
  ok("…and today's app orders — 2 orders, 3 cups (the voided one and yesterday's left out), 1 pack pickup today",
    c && c.orders_today === 2 && c.cups_today === 3 && c.packs_today === 1, c);
  const byId = await as(SERVER, `select public.member_card($1) c`, [JORDAN]);
  ok("…by the member's id as well as their card code", byId.rows[0]?.c?.cups_today === 3, byId);
  const nobody = await as(SERVER, `select public.member_card('NOBODY-3MP') c`);
  ok("…a code that names nobody is no one", nobody.rows[0]?.c === null && !nobody.error, nobody);
  const member = await as(JORDAN, `select public.member_card('RIVER-3MP') c`);
  ok("…a member cannot read another member's card", /staff only/.test(member.error || ""), member);
  const anon = await as(null, `select public.member_card('JORDAN-3MP') c`);
  ok("…nor can anon", /permission denied/.test(anon.error || ""), anon);
}

// ── a walk-up stamp, signed ──────────────────────────────────────────────────────────────────────────────────
{
  const before = (await q(`select coalesce(points, 0)::int p from public.profiles where id = $1`, [RIVER]))[0].p;
  const r = await as(SERVER, `select public.award_manual_point('RIVER-3MP') n`);
  const row = (await q(`select by_user, note, points from public.loyalty_ledger where user_id = $1 and channel = 'scan' order by created_at desc limit 1`, [RIVER]))[0];
  ok("award_manual_point: one stamp, as before, now signed by the server who gave it", r.rows[0]?.n === before + 1 && row.by_user === SERVER && row.points === 1 && /walk-up/.test(row.note), { r, row });
  const member = await as(RIVER, `select public.award_manual_point('RIVER-3MP') n`);
  ok("…a member still cannot stamp their own card", /staff only/.test(member.error || ""), member);
}

// ── credit, at the window ────────────────────────────────────────────────────────────────────────────────────
{
  const r = await as(SERVER, `select public.spend_credit('JORDAN-3MP') n`);
  const left = (await q(`select credit_cents c from public.profiles where id = $1`, [JORDAN]))[0].c;
  const rows = await q(`select cents, by_user from public.credit_spends where user_id = $1`, [JORDAN]);
  ok("spend_credit: all of it by default — $5 taken off, none left, one row signed by the server", r.rows[0]?.n === 500 && left === 0 && rows.length === 1 && rows[0].cents === 500 && rows[0].by_user === SERVER, { r, left, rows });
  const again = await as(SERVER, `select public.spend_credit('JORDAN-3MP') n`);
  ok("…a second tap takes nothing: no credit to use, no second row", /no credit to use/.test(again.error || "") && (await q(`select count(*)::int n from public.credit_spends where user_id = $1`, [JORDAN]))[0].n === 1, again);
  await q(`update public.profiles set credit_cents = 1000 where id = $1`, [JORDAN]);
  const part = await as(SERVER, `select public.spend_credit('JORDAN-3MP', 300) n`);
  ok("…an amount named is that amount: $3 of $10, $7 left", part.rows[0]?.n === 300 && (await q(`select credit_cents c from public.profiles where id = $1`, [JORDAN]))[0].c === 700, part);
  const over = await as(SERVER, `select public.spend_credit('JORDAN-3MP', 800) n`);
  ok("…more than is there is refused, and nothing moves", /not that much credit/.test(over.error || "") && (await q(`select credit_cents c from public.profiles where id = $1`, [JORDAN]))[0].c === 700, over);
  const self = await as(JORDAN, `select public.spend_credit('JORDAN-3MP') n`);
  ok("…a member cannot spend credit — not even their own", /staff only/.test(self.error || "") && (await q(`select credit_cents c from public.profiles where id = $1`, [JORDAN]))[0].c === 700, self);
  const anon = await as(null, `select public.spend_credit('JORDAN-3MP') n`);
  ok("…anon cannot call it at all", /permission denied/.test(anon.error || ""), anon);
  const nobody = await as(SERVER, `select public.spend_credit('NOBODY-3MP') n`);
  ok("…a code that names nobody spends nothing", nobody.rows[0]?.n === null && !nobody.error, nobody);
}
{
  const mine = await as(JORDAN, `select count(*)::int n from public.credit_spends`);
  const theirs = await as(RIVER, `select count(*)::int n from public.credit_spends`);
  const crew = await as(SERVER, `select count(*)::int n from public.credit_spends`);
  ok("credit_spends: a member reads their own, another member none, the crew all", mine.rows[0]?.n === 2 && theirs.rows[0]?.n === 0 && crew.rows[0]?.n === 2, { mine, theirs, crew });
  const write = await as(JORDAN, `insert into public.credit_spends (user_id, cents) values ($1, 100)`, [JORDAN]);
  ok("…and nobody writes it but spend_credit", /permission denied/.test(write.error || ""), write);
  const g = (await q(`select has_function_privilege('anon', 'public.member_card(text)', 'execute') a,
    has_function_privilege('anon', 'public.spend_credit(text, integer)', 'execute') b,
    has_function_privilege('authenticated', 'public.spend_credit(text, integer)', 'execute') c`))[0];
  ok("grants: anon holds no execute; authenticated does (the functions refuse inside)", g.a === false && g.b === false && g.c === true, g);
  const f = (await q(`select bool_and(prosecdef) d, bool_and(proconfig::text like '%search_path=public%') s from pg_proc where proname in ('member_card', 'spend_credit')`))[0];
  ok("definers, their search_path pinned", f.d === true && f.s === true, f);
}

// ── a second run ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const n = (await q(`select count(*)::int n from public.credit_spends`))[0].n;
  await db.exec(MIG(F389));
  ok("a second run changes nothing: the spends kept, one changelog line, recorded",
    (await q(`select count(*)::int n from public.credit_spends`))[0].n === n
    && (await q(`select count(*)::int n from public.changelog where title = 'One purchase, one stamp — and credit you can use'`))[0].n === 1
    && (await q(`select count(*)::int n from public.schema_migrations where version = '0389_one_purchase_one_stamp_and_credit_at_the_window'`))[0].n >= 1);
}

console.log(`db.window: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
