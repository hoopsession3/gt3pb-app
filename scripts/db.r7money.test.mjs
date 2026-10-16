// R7 OF THE CUSTOMER RE-AUDIT — THE MONEY, RUN IN POSTGRES (2026-10-15; Ryan: "Keep working to improve to a 10").
//
//   0409  money back is all of it — a canceled order's refund alert names the drinks AND the tip
//   0410  your own card is another crew member's — its free cup and its credit too
//   0411  a referral follows its order — undone with it, its $5 + $5 come back
//
// The findings, as sentences: a canceled card order's refund alert named the drinks' total, so the tip stayed on the
// card; a crew member could give their own card a free cup or ring up its credit; and a referral's $10 stayed after the
// order that earned it was voided or refunded — and Recall then Void kept the stamps too. What is run here is the whole
// schema up to 0408, then 0409–0411 — twice — as the roles that call them: a member, a guest, two crew members.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlOf = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const SQL = [sqlOf("0409_money_back_is_all_of_it.sql"), sqlOf("0410_your_own_card_is_another_crew_members.sql"), sqlOf("0411_a_referral_follows_its_order.sql")];
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const SAM = "0c409000-0000-4000-8000-0000000000a1";     // a member
const KAY = "0c409000-0000-4000-8000-0000000000b1";     // crew
const LEE = "0c409000-0000-4000-8000-0000000000b2";     // crew
const REF = "0c409000-0000-4000-8000-0000000000c1";     // a member who referred…
const NEW = "0c409000-0000-4000-8000-0000000000c2";     // …this one

const t0 = Date.now();
const db = await fullSchema({ before: "0409" });
console.log(`the schema to 0408 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
for (const [id, role, name] of [[SAM, "member", "Sam Ito"], [KAY, "server", "Kay Lin"], [LEE, "server", "Lee Ford"], [REF, "member", "Rae Cole"], [NEW, "member", "Nia Park"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
}
const codeOf = async (id) => (await q1(`select referral_code from public.profiles where id = $1`, [id])).referral_code;
const credit = async (id) => (await q1(`select coalesce(credit_cents, 0) c from public.profiles where id = $1`, [id])).c;
const points = async (id) => (await q1(`select coalesce(points, 0) p from public.profiles where id = $1`, [id])).p;
const order = async (row) => (await q1(`insert into public.orders (items, total_cents, tip_cents, status, customer, user_id, tenant_id, paid, payment_id)
  values ($1, $2, $3, 'new', $4, $5, $6, $7, $8) returning id, ticket`,
  [row.items ?? ["flow"], row.total ?? 1000, row.tip ?? 0, row.customer ?? "Ana Ruiz", row.user ?? null, T1, row.paid ?? false, row.payment ?? null]));
const setStatus = (id, status) => q(`update public.orders set status = $2 where id = $1`, [id, status]);
const refundAlerts = async (id) => q(`select severity, category, title, body, link from public.alerts where kind = 'refund_needed' and subject_id = $1`, [id]);

for (const sql of SQL) await db.exec(sql);
for (const sql of SQL) await db.exec(sql);   // a second run changes nothing (below: one alert, one reversal)
ok("0409–0411 load on the schema to 0408, and load again", true);

// ── 0409 · money back is all of it ──────────────────────────────────────────────────────────────────────────
ok("refund_words says what the card was charged, and which is which",
  (await q1(`select public.refund_words(1000, 150) a, public.refund_words(1000, 0) b, public.refund_words(1000, null) c`)).a === "$11.50 (drinks $10.00 + tip $1.50)"
  && (await q1(`select public.refund_words(1000, 0) b`)).b === "$10.00" && (await q1(`select public.refund_words(1000, null) c`)).c === "$10.00");
ok("refund_words is nobody's to call from the API", (await q1(`select has_function_privilege('anon', 'public.refund_words(integer, integer)', 'execute') a,
  has_function_privilege('authenticated', 'public.refund_words(integer, integer)', 'execute') b`)).a === false);

const mine = await order({ user: SAM, paid: true, payment: "sq-409-a", total: 1000, tip: 150, customer: "Sam Ito" });
const c1 = await as(SAM, `select public.cancel_own_order($1) r`, [mine.id]);
const a1 = await refundAlerts(mine.id);
ok("a member's canceled card order: one refund alert about the order, naming all of the charge — the tip with the drinks",
  c1.rows[0]?.r === true && a1.length === 1 && a1[0].severity === "critical" && a1[0].category === "money"
    && a1[0].body === `A member canceled order #${mine.id.slice(0, 4).toUpperCase()}. Refund $11.50 (drinks $10.00 + tip $1.50) in Square — all of the charge.`
    && a1[0].link === "/crew?s=money&a=pay", { c1, a1 });
const c1b = await as(SAM, `select public.cancel_own_order($1) r`, [mine.id]);
ok("…a second cancel is refused, and raises nothing more", c1b.rows[0]?.r === false && (await refundAlerts(mine.id)).length === 1);
const theirs = await order({ user: SAM, paid: true, total: 1000 });
ok("…and nobody else's order is theirs to cancel", (await as(KAY, `select public.cancel_own_order($1) r`, [theirs.id])).rows[0]?.r === false
  && (await q1(`select status from public.orders where id = $1`, [theirs.id])).status === "new");

const guest = await order({ paid: true, payment: "sq-409-b", total: 2200, tip: 330, customer: "Jordan Reyes" });
const c2 = await as(null, `select public.cancel_by_ticket($1) r`, [guest.ticket]);
const a2 = await refundAlerts(guest.id);
ok("a guest's canceled card order, from its ticket: the same — who, from where, and all of the charge",
  c2.rows[0]?.r?.outcome === "canceled" && c2.rows[0].r.paid === true && a2.length === 1
    && a2[0].body === `Jordan canceled order #${guest.id.slice(0, 4).toUpperCase()} from its order page. Refund $25.30 (drinks $22.00 + tip $3.30) in Square — all of the charge.`, { c2, a2 });
const unpaid = await order({ customer: "Ana Ruiz" });
const c3 = await as(null, `select public.cancel_by_ticket($1) r`, [unpaid.ticket]);
ok("an unpaid one is still the FYI that nothing was charged, and no refund alert",
  c3.rows[0]?.r?.outcome === "canceled" && (await refundAlerts(unpaid.id)).length === 0
    && (await q1(`select count(*)::int n from public.alerts where body = $1`, [`Ana canceled order #${unpaid.id.slice(0, 4).toUpperCase()} from its order page. Nothing was charged — no refund needed.`])).n === 1);
ok("Cancel from a ticket is still a guest's to call", (await q1(`select has_function_privilege('anon', 'public.cancel_by_ticket(uuid)', 'execute') a`)).a === true);

// ── 0410 · your own card is another crew member's ──────────────────────────────────────────────────────────
await q(`insert into public.loyalty_ledger (user_id, channel, kind, points, note) values ($1, 'admin', 'adjust', 12, 'test opening')`, [KAY]);
await q(`update public.profiles set credit_cents = 1500 where id = $1`, [KAY]);
const kay = await codeOf(KAY);
const own1 = await as(KAY, `select public.redeem_free_cup($1) r`, [kay]);
ok("a crew member cannot give their own card its free cup", /your own card: another crew member gives its free cup/.test(own1.error ?? "") && (await points(KAY)) === 12, own1);
const own2 = await as(KAY, `select public.spend_credit($1, 600) r`, [kay]);
ok("…nor take its credit off", /your own card: another crew member takes its credit off/.test(own2.error ?? "") && (await credit(KAY)) === 1500, own2);
const other1 = await as(LEE, `select public.redeem_free_cup($1) r`, [kay]);
ok("another crew member gives it", other1.rows[0]?.r === 2 && (await points(KAY)) === 2, other1);
const other2 = await as(LEE, `select public.spend_credit($1, 600) r`, [kay]);
ok("…and takes off the order's amount, not the whole balance: $6 of $15, $9 stays on the card",
  other2.rows[0]?.r === 600 && (await credit(KAY)) === 900
    && (await q1(`select count(*)::int n from public.credit_spends where user_id = $1 and cents = 600 and by_user = $2`, [KAY, LEE])).n === 1, other2);
const tooMuch = await as(LEE, `select public.spend_credit($1, 1000) r`, [kay]);
ok("…never more than the card holds", /not that much credit/.test(tooMuch.error ?? "") && (await credit(KAY)) === 900, tooMuch);
ok("a member still cannot spend anyone's credit", /staff only/.test((await as(SAM, `select public.spend_credit($1, 100) r`, [kay])).error ?? ""));

// ── 0411 · a referral follows its order ──────────────────────────────────────────────────────────────────────
await q(`update public.profiles set referred_by = $2, referral_converted = false, credit_cents = 0 where id = $1`, [NEW, REF]);
await q(`update public.profiles set credit_cents = 0 where id = $1`, [REF]);
const stake = async () => q1(`select s.referee_cents f, s.referrer_cents b from public.referral_stakes s join public.referral_events e on e.id = s.event_id where e.referee = $1`, [NEW]);
const first = await order({ user: NEW, total: 900, paid: true, payment: "sq-411-a", customer: "Nia Park" });
await setStatus(first.id, "done");
ok("the referee's first order of $5 or more converts it: $5 each", (await credit(NEW)) === 500 && (await credit(REF)) === 500);
await setStatus(first.id, "void");
const ev1 = await q1(`select reversed_at is not null r from public.referral_events where referee = $1`, [NEW]);
ok("voided, its stamps come off — and the referral with them: $5 back off each card, the event says when",
  (await credit(NEW)) === 0 && (await credit(REF)) === 0 && ev1?.r === true
    && (await q1(`select referral_converted c from public.profiles where id = $1`, [NEW])).c === false, ev1);
ok("…what came off each card is the next conversion's to give back, kept where neither side reads it",
  ((st) => st?.f === 500 && st.b === 500)(await stake())
    && (await as(REF, `select count(*)::int n from public.referral_stakes`)).error !== null
    && (await as(NEW, `select count(*)::int n from public.referral_stakes`)).error !== null);
ok("…the event carries no amount either side could read the other's balance from",
  (await q(`select column_name from information_schema.columns where table_name = 'referral_events' and column_name like '%back%'`)).length === 0);
ok("…and the change log has the line, with the amounts", (await q1(`select count(*)::int n from public.admin_audit where table_name = 'referral_events'
  and summary like 'referral undone with its order (order voided / undone): $5.00 back from the referee, $5.00 from the referrer'`)).n === 1);

const second = await order({ user: NEW, total: 700, paid: true, payment: "sq-411-b", customer: "Nia Park" });
await setStatus(second.id, "done");
const ev2 = await q1(`select reversed_at, converting_order o from public.referral_events where referee = $1`, [NEW]);
ok("the referee's next real order converts it again — the same event, re-stamped with this order — and gives back what came off",
  (await credit(NEW)) === 500 && (await credit(REF)) === 500 && ev2.reversed_at === null && ev2.o === second.id
    && (await q1(`select count(*)::int n from public.referral_events where referee = $1`, [NEW])).n === 1, ev2);

// Recall, then void: the stamps and the referral both go back (before 0411 they stayed).
await q(`update public.profiles set credit_cents = 200 where id = $1`, [NEW]);      // $3 of it spent at the window
const before = await points(NEW);
await setStatus(second.id, "ready");                                                 // the Pass's Recall
await setStatus(second.id, "void");
ok("Recall then Void takes the stamps back", (await points(NEW)) === before - 1, { before, now: await points(NEW) });
ok("…and the referral: what is still on each card, never below zero — $2 of the referee's $5, all of the referrer's",
  (await credit(NEW)) === 0 && (await credit(REF)) === 0 && ((st) => st?.f === 200 && st.b === 500)(await stake()), await stake());

// The leak R7's first 0411 had: re-earning paid the whole $5 again over a $5 already spent.
const third = await order({ user: NEW, total: 800, paid: true, payment: "sq-411-c", customer: "Nia Park" });
await setStatus(third.id, "done");
ok("a third order converts it again — and gives back only what came off: $2 to the referee (whose $3 was spent), $5 to the referrer",
  (await credit(NEW)) === 200 && (await credit(REF)) === 500, { fee: await credit(NEW), ref: await credit(REF) });
await q(`insert into public.square_refunds (id, payment_id, amount_cents, status) values ('rf-411-c', 'sq-411-c', 800, 'COMPLETED')`);
ok("refunded in full in Square: its stamps come off, and the referral with them — never more than this conversion gave",
  (await credit(NEW)) === 0 && (await credit(REF)) === 0 && ((st) => st?.f === 200 && st.b === 500)(await stake())
    && (await q1(`select count(*)::int n from public.admin_audit where table_name = 'referral_events' and summary like 'referral undone with its order (refunded in Square)%'`)).n === 1);
// Undone and redone as often as you like: across the referral's life each side holds at most its $5.
const fourth = await order({ user: NEW, total: 800, paid: true, payment: "sq-411-d", customer: "Nia Park" });
await setStatus(fourth.id, "done");
ok("…and converted again, the referee has $2 and the referrer $5 — what the referral is worth to each, less what was spent",
  (await credit(NEW)) === 200 && (await credit(REF)) === 500);

// An order that converted nothing undoes nothing.
await q(`update public.profiles set credit_cents = 700 where id = $1`, [SAM]);
const plain = await order({ user: SAM, total: 900, paid: true });
await setStatus(plain.id, "done");
await setStatus(plain.id, "void");
ok("an order that converted no referral takes back its stamps and nothing else", (await credit(SAM)) === 700);
ok("the trigger is the database's: nobody calls it", (await q1(`select has_function_privilege('authenticated', 'public.referral_follows_its_order()', 'execute') a`)).a === false);

// A take-back is never refused: a void after the stamps were given as a free cup.
const ZOE = "0c409000-0000-4000-8000-0000000000c3";
await q(`insert into auth.users (id, email) values ($1, 'zoe@example.test')`, [ZOE]);
await q(`update public.profiles set role = 'member', tenant_id = $2, display_name = 'Zoe Hart' where id = $1`, [ZOE, T1]);
const zo = await order({ user: ZOE, items: ["flow", "tide"], total: 2200, paid: true, customer: "Zoe Hart" });
await setStatus(zo.id, "done");
await q(`insert into public.loyalty_ledger (user_id, channel, kind, points, note) values ($1, 'admin', 'adjust', 8, 'test: eight more')`, [ZOE]);
const freeCup = await as(KAY, `select public.redeem_free_cup($1) r`, [await codeOf(ZOE)]);
const voidAfter = await q(`update public.orders set status = 'void' where id = $1 returning status`, [zo.id]).then((r) => ({ r, error: null })).catch((e) => ({ r: null, error: String(e.message || e) }));
ok("a void after the stamps went on a free cup goes through — the card is two below zero until it is earned back",
  freeCup.rows[0]?.r === 0 && !voidAfter.error && (await points(ZOE)) === -2
    && (await q1(`select count(*)::int n from pg_constraint where conname = 'profiles_points_nonneg'`)).n === 0, { freeCup, voidAfter, pts: await points(ZOE) });

// A friend's link is for someone who has not bought yet.
await q(`update public.profiles set referred_by = null, referral_converted = false where id = $1`, [SAM]);
await as(SAM, `select public.attach_referral($1)`, [await codeOf(REF)]);
ok("a member who has bought before doesn't attach a friend's link — their next order is not a first order",
  (await q1(`select referred_by r from public.profiles where id = $1`, [SAM])).r === null);
const TED = "0c409000-0000-4000-8000-0000000000c4";
await q(`insert into auth.users (id, email) values ($1, 'ted@example.test')`, [TED]);
await q(`update public.profiles set role = 'member', tenant_id = $2, display_name = 'Ted Ruiz' where id = $1`, [TED, T1]);
await as(TED, `select public.attach_referral($1)`, [await codeOf(REF)]);
ok("…a new account still does", (await q1(`select referred_by r from public.profiles where id = $1`, [TED])).r === REF);
ok("attach_referral is a signed-in caller's only", (await q1(`select has_function_privilege('anon', 'public.attach_referral(text)', 'execute') a,
  has_function_privilege('authenticated', 'public.attach_referral(text)', 'execute') b`)).a === false
  && (await q1(`select has_function_privilege('authenticated', 'public.attach_referral(text)', 'execute') b`)).b === true);

console.log(`R7 MONEY (0409 · 0410 · 0411, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
