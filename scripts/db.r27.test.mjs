// R27 — A COVERED SETTLE IS A FREE CUP, A CREDIT, OR AN OWNER'S REASON (0432), IN POSTGRES (2026-10-18 — the 10/10 audit,
// database F17; Ryan: "Owner/admin, with a reason").
//
// The whole schema to 0431 is loaded and the finding reproduced on it — anyone on the crew settles any member's order as
// covered, with nothing taken off and nothing recorded — then 0432, twice, and the window's every way through, as the
// roles that call it: a free cup redeemed today covers one order and is named on it; credit used today, the same; nothing
// taken off is refused to the crew and is an owner's to put on the house, with a reason that is kept; your own order is
// still another crew member's; a settle taken back frees its free cup; and nobody writes the record but the settle.
// Every person, order and cup is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M432 = readFileSync(join(ROOT, "supabase/migrations/0432_a_covered_settle_is_a_free_cup_a_credit_or_an_owners_reason.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const SAM = "0c432000-0000-4000-8000-0000000000a1";    // a member
const NIA = "0c432000-0000-4000-8000-0000000000a2";    // a member
const KAY = "0c432000-0000-4000-8000-0000000000b1";    // crew (server)
const LEE = "0c432000-0000-4000-8000-0000000000b2";    // crew (server)
const ALEX = "0c432000-0000-4000-8000-0000000000c1";   // an owner

const t0 = Date.now();
const db = await fullSchema({ before: "0432" });
console.log(`the schema to 0431 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
const as = async (who, sql, params) => {
  const role = who ? "authenticated" : "anon";
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ""}', false);
    select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null, code: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated;`);
for (const [id, role, name] of [[SAM, "member", "Sam Ito"], [NIA, "member", "Nia Park"], [KAY, "server", "Kay Lin"], [LEE, "server", "Lee Ford"], [ALEX, "owner", "Alex Rivera"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
}
const cup = async (user = null, customer = "Ana Ruiz") => (await q1(`insert into public.orders (items, total_cents, tip_cents, status, customer, user_id, tenant_id, paid)
  values ('{flow}', 1000, 0, 'new', $1, $2, $3, false) returning id`, [customer, user, T1])).id;
const pack = async (user = SAM) => (await q1(`insert into public.drop_orders (user_id, name, size, glass, total_cents, paid, drop_date, tenant_id)
  values ($1, 'Sam Ito', 6, 'return', 3600, false, current_date + 1, $2) returning id`, [user, T1])).id;
const settle = (who, kind, id, via, reason) => reason === undefined
  ? as(who, `select public.staff_collect_payment($1, $2, $3) r`, [kind, id, via])
  : as(who, `select public.staff_collect_payment($1, $2, $3, $4) r`, [kind, id, via, reason]);
const freeCups = (uid, n) => q(`update public.profiles set points = $2 where id = $1`, [uid, n]);
const redeem = (who, uid) => as(who, `select public.redeem_free_cup($1) r`, [uid]);
const cover = (kind, id) => q1(`select how, free_cup, credit, reason, by_user from public.covered_settles where order_kind = $1 and order_id = $2`, [kind, id]);
const orderNow = (id) => q1(`select collected_via, collected_at is not null as settled, paid from public.orders where id = $1`, [id]);

// ── before 0432: the finding ────────────────────────────────────────────────────────────────────────────────────────
{
  const o = await cup(SAM, "Sam Ito");
  const r = await settle(KAY, "cup", o, "covered");
  ok("before 0432: anyone on the crew settled a member's order as covered with nothing taken off — and nothing said why",
    r.rows[0]?.r === "collected" && (await orderNow(o)).collected_via === "covered" && !(await q1(`select to_regclass('public.covered_settles') as t`)).t, r);
}

await db.exec(M432);
await db.exec(M432);
ok("0432 pasted twice: one staff_collect_payment (the three-argument door gone, a call naming three still lands), recorded twice",
  (await q1(`select count(*)::int n from pg_proc where proname = 'staff_collect_payment'`)).n === 1
  && (await q1(`select pg_get_function_identity_arguments('public.staff_collect_payment(text,uuid,text,text)'::regprocedure) a`)).a === "p_kind text, p_id uuid, p_via text, p_reason text"
  && (await q1(`select applied_count::int n from public.schema_migrations where version = '0432_a_covered_settle_is_a_free_cup_a_credit_or_an_owners_reason'`)).n === 2);

// ── the crew: what covered it, or nothing ───────────────────────────────────────────────────────────────────────────
{
  const o1 = await cup(SAM, "Sam Ito");
  const none = await settle(KAY, "cup", o1, "covered");
  ok("crew, nothing taken off for the member today: refused, saying what to do — and the order is as it was",
    /Nothing was taken off for them today — redeem their free cup or use their credit on the scan screen first/.test(none.error ?? "") && none.code === "42501"
    && !(await orderNow(o1)).settled && !(await cover("cup", o1)), none);

  await freeCups(SAM, 20);
  const r1 = await redeem(KAY, SAM);
  const cupRow = (await q1(`select id from public.loyalty_ledger where user_id = $1 and kind = 'redeem' order by created_at limit 1`, [SAM])).id;
  const yes = await settle(KAY, "cup", o1, "covered");
  const c1 = await cover("cup", o1);
  ok("crew, a free cup redeemed for them today: settled covered — and the cover names that free cup and who settled it",
    r1.rows[0]?.r === 10 && yes.rows[0]?.r === "collected" && (await orderNow(o1)).collected_via === "covered" && (await orderNow(o1)).paid === false
    && c1?.how === "free_cup" && c1.free_cup === cupRow && c1.credit === null && c1.reason === null && c1.by_user === KAY, { r1, yes, c1 });

  const o2 = await cup(SAM, "Sam Ito");
  const twice = await settle(LEE, "cup", o2, "covered");
  ok("one free cup covers one order: a second of theirs, from another phone, is refused", /Nothing was taken off/.test(twice.error ?? "") && !(await orderNow(o2)).settled, twice);
  await redeem(LEE, SAM);
  const second = await settle(LEE, "cup", o2, "covered");
  const c2 = await cover("cup", o2);
  ok("…and a second free cup redeemed covers the second order, the cover naming the second cup",
    second.rows[0]?.r === "collected" && c2?.how === "free_cup" && c2.free_cup !== c1.free_cup && c2.by_user === LEE, { second, c2 });

  // Yesterday's free cup is yesterday's.
  const o3 = await cup(SAM, "Sam Ito");
  await q(`insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user, created_at)
    values ($1, 'scan', 'redeem', -10, 'made-up: yesterday', $2, ((public.business_day() - 1)::timestamp at time zone 'America/New_York') + interval '20 hours')`, [SAM, KAY]);
  const stale = await settle(KAY, "cup", o3, "covered");
  ok("a free cup redeemed before today (the business day, Eastern) covers nothing today", /Nothing was taken off/.test(stale.error ?? ""), stale);

  // Credit used today covers a pack.
  await q(`update public.profiles set credit_cents = 500 where id = $1`, [NIA]);
  const spent = await as(KAY, `select public.spend_credit($1, null) r`, [NIA]);
  const p1 = await pack(NIA);
  const cp = await settle(KAY, "pickup", p1, "covered");
  const c3 = await cover("pickup", p1);
  const creditRow = (await q1(`select id from public.credit_spends where user_id = $1`, [NIA])).id;
  ok("crew, credit used for them today: their pack settled covered, the cover naming that credit",
    spent.rows[0]?.r === 500 && cp.rows[0]?.r === "collected" && c3?.how === "credit" && c3.credit === creditRow && c3.free_cup === null, { spent, cp, c3 });
  const p2 = await pack(NIA);
  ok("…and that credit covers that pack only", /Nothing was taken off/.test((await settle(LEE, "pickup", p2, "covered")).error ?? ""));

  // Cash and the reader are as they were; a reason sent with them is not kept.
  const o4 = await cup(null);
  const cash = await settle(KAY, "cup", o4, "cash", "a reason nobody needs");
  ok("cash takes no reason and writes no cover — and a call naming three arguments, as every screen before this did, still settles",
    cash.rows[0]?.r === "collected" && (await orderNow(o4)).paid === true && !(await cover("cup", o4))
    && (await settle(KAY, "cup", await cup(null), "card_reader")).rows[0]?.r === "collected");

  // Undo frees the free cup.
  const undo = await as(KAY, `select public.staff_undo_collection('cup', $1) r`, [o1]);
  ok("a covered settle taken back takes its cover with it", undo.rows[0]?.r === "undone" && !(await cover("cup", o1)) && !(await orderNow(o1)).settled, undo);
  const again = await settle(KAY, "cup", o3, "covered");
  ok("…and the free cup it held covers another of their orders", again.rows[0]?.r === "collected" && (await cover("cup", o3))?.free_cup === c1.free_cup, again);
}

// ── an owner: on the house, with why ───────────────────────────────────────────────────────────────────────────────
{
  const g = await cup(null, "Walk-up");
  const crew = await settle(KAY, "cup", g, "covered", "Spilled drink");
  ok("crew, a reason given, nothing taken off: still refused — on the house is an owner's or admin's", /An owner or admin can put it on the house/.test(crew.error ?? "") && !(await orderNow(g)).settled, crew);
  const noWhy = await settle(ALEX, "cup", g, "covered");
  ok("an owner, nothing taken off, no reason: asked why (22023) — nothing settled", /Say why it's on the house/.test(noWhy.error ?? "") && noWhy.code === "22023" && !(await orderNow(g)).settled, noWhy);
  const short = await settle(ALEX, "cup", g, "covered", "  ok  ");
  ok("…a reason of two letters is no reason", /Say why/.test(short.error ?? "") && !(await orderNow(g)).settled, short);
  const house = await settle(ALEX, "cup", g, "covered", "  Spilled drink — remade  ");
  const ch = await cover("cup", g);
  ok("an owner with a reason: on the house, the reason kept as said (trimmed), and who said it",
    house.rows[0]?.r === "collected" && ch?.how === "on_the_house" && ch.reason === "Spilled drink — remade" && ch.by_user === ALEX && ch.free_cup === null, { house, ch });
  const long = await settle(ALEX, "cup", await cup(null), "covered", "x".repeat(500));
  ok("a reason past 200 characters is kept to 200", long.rows[0]?.r === "collected"
    && (await q1(`select max(length(reason))::int n from public.covered_settles where how = 'on_the_house'`)).n === 200, long);

  // An owner settling a member's order that has a free cup waiting: the free cup is the record, not the reason.
  await freeCups(SAM, 10);
  await redeem(KAY, SAM);
  const m = await cup(SAM, "Sam Ito");
  const owned = await settle(ALEX, "cup", m, "covered", "doesn't matter");
  const cm = await cover("cup", m);
  ok("an owner settling a member's order with a free cup waiting: the free cup covers it, and no reason is kept",
    owned.rows[0]?.r === "collected" && cm?.how === "free_cup" && cm.reason === null, { owned, cm });
}

// ── your own order, still another crew member's ─────────────────────────────────────────────────────────────────────
{
  await freeCups(KAY, 10);
  await redeem(LEE, KAY);
  const mine = await cup(KAY, "Kay Lin");
  const self = await settle(KAY, "cup", mine, "covered");
  const other = await settle(LEE, "cup", mine, "covered");
  ok("your own order, a free cup redeemed for you: another crew member settles it as covered, not you (0420, kept)",
    /your own order: another crew member settles it as covered/.test(self.error ?? "") && other.rows[0]?.r === "collected" && (await cover("cup", mine))?.by_user === LEE, { self, other });
  const myPack = await pack(ALEX);
  const ownerSelf = await settle(ALEX, "pickup", myPack, "covered", "my own pack, on the house");
  ok("…an owner's own pack, on the house: refused too", /your own pack: another crew member settles it as covered/.test(ownerSelf.error ?? "") && ownerSelf.code === "42501", ownerSelf);
}

// ── the record: the settle's alone ─────────────────────────────────────────────────────────────────────────────────
{
  const anyRow = (await q1(`select id, order_id from public.covered_settles limit 1`));
  const write = await as(KAY, `insert into public.covered_settles (order_kind, order_id, how, reason) values ('cup', gen_random_uuid(), 'on_the_house', 'made up by a page')`);
  const edit = await as(ALEX, `update public.covered_settles set reason = 'changed after' where id = $1`, [anyRow.id]);
  const gone = await as(KAY, `delete from public.covered_settles where id = $1`, [anyRow.id]);
  ok("nobody writes, changes or removes a cover by hand — the crew and an owner alike (only the settle and its undo do)",
    /permission denied/.test(write.error ?? "") && /permission denied/.test(edit.error ?? "") && /permission denied/.test(gone.error ?? ""), { write: write.error, edit: edit.error, gone: gone.error });
  const crewSees = await as(KAY, `select count(*)::int n from public.covered_settles`);
  const memberSees = await as(SAM, `select count(*)::int n from public.covered_settles`);
  ok("the crew read the covers; a member reads none", crewSees.rows[0]?.n > 5 && memberSees.rows[0]?.n === 0, { crew: crewSees.rows[0], member: memberSees.rows[0] });
  let twice = null;
  try { await q(`insert into public.covered_settles (order_kind, order_id, how, free_cup) values ('cup', gen_random_uuid(), 'free_cup', (select free_cup from public.covered_settles where free_cup is not null limit 1))`); }
  catch (e) { twice = String(e.message); }
  let bare = null;
  try { await q(`insert into public.covered_settles (order_kind, order_id, how, reason) values ('cup', gen_random_uuid(), 'on_the_house', 'ab')`); }
  catch (e) { bare = String(e.message); }
  ok("the table itself holds it: a free cup covers one order, and on the house says why", /covered_settles_free_cup_once/.test(twice ?? "") && /covered_settles_says_what/.test(bare ?? ""), { twice, bare });
  const meta = await q1(`select c.relrowsecurity as rls, has_table_privilege('authenticated', 'public.covered_settles', 'insert') as ins,
      has_table_privilege('anon', 'public.covered_settles', 'select') as anon_read,
      has_function_privilege('anon', 'public.staff_collect_payment(text,uuid,text,text)', 'execute') as anon_exec,
      (select prosrc like '%covered_settles%' from pg_proc where proname = 'staff_undo_collection') as undo_knows
    from pg_class c where c.oid = 'public.covered_settles'::regclass`);
  ok("row security on, no page inserts, no guest reads or settles, and the undo knows the cover (the migration's own verify)",
    meta.rls === true && meta.ins === false && meta.anon_read === false && meta.anon_exec === false && meta.undo_knows === true, meta);
  ok("the changelog says it once — and the release's two changes outside the database beside it, once each",
    (await q1(`select count(*)::int n from public.changelog where title in ('A covered order says what covered it', 'Deleting your account asks for a code',
      'Alerts outside the app say only what kind and which order')`)).n === 3);
}

await db.close();
console.log(`\nR27 — A COVERED SETTLE IS A FREE CUP, A CREDIT, OR AN OWNER'S REASON (0432): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
