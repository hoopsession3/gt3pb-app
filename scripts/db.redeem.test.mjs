// 0387 — A FREE CUP IS REDEEMED ONCE, executed from its file against the whole schema (every migration before it, in
// order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does.
//
// The finding, as a sentence (C6 of the customer frontend audit): every tenth cup is on us and nothing recorded a free
// cup as given — the ledger had no such row, so the card counted every ten points as a free cup forever. Shown first on
// the schema as production has it. Then 0387: the crew redeem a free cup from the scan screen — one ledger row of −10,
// with who gave it — and the member's points are what is left; under ten points nothing is given; a member and anon
// cannot redeem; a code that names nobody is no one; and a second run changes nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F387 = "0387_a_free_cup_is_redeemed_once.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c387000-0000-4000-8000-0000000000c1", SERVER = "0c387000-0000-4000-8000-0000000000c2",
  JORDAN = "0c387000-0000-4000-8000-0000000000c3", NINE = "0c387000-0000-4000-8000-0000000000c4",
  BIG = "0c387000-0000-4000-8000-0000000000c5";

const t0 = Date.now();
const db = await fullSchema({ before: "0387" });
console.log(`the schema before 0387 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`);
// Made-up people: the owner, a server, and three members with made-up card codes.
for (const [id, role, code] of [[OWNER, "owner", "OWNER-3MP"], [SERVER, "server", "SERVER-3MP"], [JORDAN, "member", "JORDAN-3MP"], [NINE, "member", "NINE-3MP"], [BIG, "member", "BIG-3MP"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3, referral_code = $4, display_name = $5 where id = $1`, [id, role, T1, code, `Made-up ${role}`]);
}
// Stamps, as the system writes them (root): Jordan 10, Nine 9, Big 25.
const stamps = async (uid, n) => q(`insert into public.loyalty_ledger (user_id, channel, kind, points, note) values ($1, 'scan', 'award', $2, 'made-up stamps')`, [uid, n]);
await stamps(JORDAN, 10); await stamps(NINE, 9); await stamps(BIG, 25);
const pts = async (uid) => (await q(`select coalesce(points, 0)::int p from public.profiles where id = $1`, [uid]))[0].p;
const redeem = (who, code) => as(who, `select public.redeem_free_cup($1) as n`, [code]);
const rows = async (uid) => q(`select kind, points, by_user, note from public.loyalty_ledger where user_id = $1 and kind = 'redeem' order by created_at`, [uid]);

// ── BEFORE 0387: a free cup cannot be given ─────────────────────────────────────────────────────
{
  ok("before 0387: Jordan's card holds ten points — one free cup, by the card's count", (await pts(JORDAN)) === 10, await pts(JORDAN));
  const r = await redeem(SERVER, "JORDAN-3MP");
  ok("before 0387: there is nothing to redeem with", /redeem_free_cup/.test(r.error || "") && /does not exist/.test(r.error || ""), r);
  let refused = null;
  try { await q(`insert into public.loyalty_ledger (user_id, channel, kind, points, note) values ($1, 'scan', 'redeem', -10, 'x')`, [JORDAN]); }
  catch (e) { refused = String(e.message || e); }
  ok("before 0387: the ledger has no kind for it — a 'redeem' row is refused by its check", /loyalty_ledger_kind_check/.test(refused || ""), refused);
}

// ── 0387 ───────────────────────────────────────────────────────────────────────────────────────
await db.exec(MIG(F387));

{
  const r = await redeem(SERVER, "JORDAN-3MP");
  ok("after 0387: the crew redeem Jordan's free cup — the answer is what is left, zero", r.rows[0]?.n === 0 && !r.error, r);
  ok("after 0387: …and Jordan's card says so", (await pts(JORDAN)) === 0, await pts(JORDAN));
  const l = await rows(JORDAN);
  ok("after 0387: one ledger row of −10, kind redeem, written by the server who gave it", l.length === 1 && l[0].points === -10 && l[0].by_user === SERVER, l);
  const again = await redeem(SERVER, "JORDAN-3MP");
  ok("after 0387: a second tap gives nothing — no free cup to redeem, and no second row", /no free cup to redeem/.test(again.error || "") && (await rows(JORDAN)).length === 1 && (await pts(JORDAN)) === 0, again);
}
{
  const r = await redeem(OWNER, "NINE-3MP");
  ok("after 0387: nine points is no free cup — refused, nothing written", /no free cup to redeem/.test(r.error || "") && (await rows(NINE)).length === 0 && (await pts(NINE)) === 9, r);
  const big = await redeem(OWNER, "BIG-3MP");
  ok("after 0387: twenty-five points less one free cup is fifteen — the stamps on the card stay", big.rows[0]?.n === 15 && (await pts(BIG)) === 15, big);
  const byId = await redeem(OWNER, BIG);
  ok("after 0387: the card code or the member's id, as award_manual_point reads it", byId.rows[0]?.n === 5, byId);
  const nobody = await redeem(OWNER, "NOBODY-3MP");
  ok("after 0387: a code that names nobody is no one — null, nothing written", nobody.rows[0]?.n === null && !nobody.error, nobody);
}
{
  await stamps(JORDAN, 10);
  const self = await redeem(JORDAN, "JORDAN-3MP");
  ok("after 0387: a member cannot redeem — not even their own card", /staff only/.test(self.error || "") && (await pts(JORDAN)) === 10, self);
  const anon = await redeem(null, "JORDAN-3MP");
  ok("after 0387: anon cannot call it at all", /permission denied/.test(anon.error || ""), anon);
  const read = await as(JORDAN, `select kind, points from public.loyalty_ledger where user_id = $1 and kind = 'redeem'`, [JORDAN]);
  ok("after 0387: Jordan reads his own redemption (0229's own-read policy)", read.rows.length === 1 && read.rows[0].points === -10, read);
}

// The function's shape, a second run, the ledger.
{
  const g = (await q(`select has_function_privilege('anon', 'public.redeem_free_cup(text)', 'execute') a,
    has_function_privilege('authenticated', 'public.redeem_free_cup(text)', 'execute') b`))[0];
  ok("anon holds no execute; authenticated does (the function refuses inside it)", g.a === false && g.b === true, g);
  const f = (await q(`select prosecdef, proconfig from pg_proc where proname = 'redeem_free_cup'`))[0];
  ok("a definer, its search_path pinned", f?.prosecdef === true && JSON.stringify(f?.proconfig) === JSON.stringify(["search_path=public"]), f);
  await db.exec(MIG(F387));
  const after = await pts(JORDAN);
  const c = (await q(`select count(*)::int n from pg_constraint where conname = 'loyalty_ledger_kind_check'`))[0].n;
  ok("a second run changes nothing: one kind check, the balances as they were", c === 1 && after === 10, { c, after });
  const line = (await q(`select count(*)::int n from public.changelog where title = 'A free cup is redeemed once'`))[0].n;
  ok("its changelog line is written once", line === 1, line);
  const rec = (await q(`select count(*)::int n from public.schema_migrations where version = '0387_a_free_cup_is_redeemed_once'`))[0].n;
  ok("0387 records itself in the ledger", rec >= 1, rec);
}

console.log(`db.redeem: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
