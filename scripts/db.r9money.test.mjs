// R9 OF THE CUSTOMER AUDIT — THE MONEY, RUN IN POSTGRES (2026-10-16; Ryan: "Keep working to improve to a 10").
//
//   0416  a refund is flagged where the money goes back — by the database, once, whoever cancels; a stop called off
//         voids its cups one write each; credit and free cups spent once per tap; a pack's stamps survive a step back;
//         covered at the window
//   0417  the books count what went back; a part of a shop order refunded keeps it open; an unclear send to the
//         printer waits for a check; an office link keeps its id
//
// The findings, as sentences: a void made with no signal raised no refund flag (the browser raised it, and the replay
// sent only the status); a pack canceled just after another phone took the money on the card reader raised none; a paid
// office order canceled raised none; a stop called off left card-reader cups off its list and raised nothing on a retry;
// "Use credit" retried after a lost answer spent twice; Money never took a Square refund off; a part of a shop order
// refunded ended it; a stage chip tapped on a picked-up pack stripped its stamps for good. What is run here is the whole
// schema up to 0415, then 0416 and 0417 — twice — as the roles that call them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlOf = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const SQL = [sqlOf("0416_a_refund_is_flagged_where_the_money_goes_back.sql"), sqlOf("0417_the_books_count_what_went_back.sql")];
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const SAM = "0c416000-0000-4000-8000-0000000000a1";     // a member
const NIA = "0c416000-0000-4000-8000-0000000000a2";     // a member
const KAY = "0c416000-0000-4000-8000-0000000000b1";     // crew
const LEE = "0c416000-0000-4000-8000-0000000000b2";     // crew
const ALEX = "0c416000-0000-4000-8000-0000000000c1";    // an owner

const t0 = Date.now();
const db = await fullSchema({ before: "0416" });
console.log(`the schema to 0415 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
for (const [id, role, name] of [[SAM, "member", "Sam Ito"], [NIA, "member", "Nia Park"], [KAY, "server", "Kay Lin"], [LEE, "server", "Lee Ford"], [ALEX, "owner", "Alex Rivera"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
}
const order = async (row) => (await q1(`insert into public.orders (items, total_cents, tip_cents, status, customer, user_id, tenant_id, paid, payment_id, stop_id)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id, ticket`,
  [row.items ?? ["flow"], row.total ?? 1000, row.tip ?? 0, row.status ?? "new", row.customer ?? "Ana Ruiz", row.user ?? null, T1, row.paid ?? false, row.payment ?? null, row.stop ?? null]));
const flags = async (id) => q(`select severity, category, title, body, link, ack_at from public.alerts where kind = 'refund_needed' and subject_id = $1`, [id]);
const noOf = (id) => `#${id.slice(0, 4).toUpperCase()}`;
const pack = async (row) => (await q1(`insert into public.drop_orders (user_id, name, size, glass, total_cents, paid, payment_id, drop_date, tenant_id)
  values ($1, $2, $3, 'return', $4, $5, $6, current_date + 3, $7) returning id`,
  [row.user ?? SAM, row.name ?? "Sam Ito", row.size ?? 6, row.total ?? 3600, row.paid ?? false, row.payment ?? null, T1])).id;

// ── before 0416: the bug, reproduced ───────────────────────────────────────────────────────────────────────────────
{
  const o = await order({ paid: true, payment: "sq-416-before", total: 1000, tip: 150 });
  const v = await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [o.id]);
  ok("before 0416: a paid order voided on the Pass (the database's own write) raises no refund flag — the browser had to",
    v.rows[0]?.r === "void" && (await flags(o.id)).length === 0, v);
}

for (const sql of SQL) await db.exec(sql);
for (const sql of SQL) await db.exec(sql);   // a second run changes nothing
ok("0416 and 0417 load on the schema to 0415, and load again", true);

// ── 0416 · the flag is the database's ─────────────────────────────────────────────────────────────────────────
{
  // The Pass: the crew's void, as staff_set_order_status writes it — online, then the card reader, then cash.
  const online = await order({ paid: true, payment: "sq-416-a", total: 1000, tip: 150, customer: "Ana Ruiz" });
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [online.id]);
  const f1 = await flags(online.id);
  ok("a crew void of a card-paid order raises one critical refund flag, in the same write, with all of the charge",
    f1.length === 1 && f1[0].severity === "critical" && f1[0].category === "money" && f1[0].title === "Voided a PAID order — refund needed"
      && f1[0].body === `Ana · ${noOf(online.id)} · $11.50 (drinks $10.00 + tip $1.50) paid online. Refund it in Square — all of the charge.`
      && f1[0].link === "/crew?s=money&a=pay", f1);

  const reader = await order({ total: 900, customer: "Bo Diaz" });
  await as(LEE, `select public.staff_collect_payment('cup', $1, 'card_reader') r`, [reader.id]);
  // Another phone, still showing it unpaid, voids it: the database reads the row as it is now.
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [reader.id]);
  const f2 = await flags(reader.id);
  ok("a void just after another phone took the money on the card reader is flagged — the row as it is, not the screen",
    f2.length === 1 && /paid on the card reader\./.test(f2[0].body) && f2[0].body.startsWith("Bo · "), f2);

  const cash = await order({ total: 900 });
  await as(LEE, `select public.staff_collect_payment('cup', $1, 'cash') r`, [cash.id]);
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [cash.id]);
  const unpaid = await order({ total: 900 });
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [unpaid.id]);
  ok("cash goes back across the window and an unpaid order took nothing: neither is flagged",
    (await flags(cash.id)).length === 0 && (await flags(unpaid.id)).length === 0);

  const given = await order({ paid: true, payment: "sq-416-given", total: 1000, tip: 0 });
  await q(`insert into public.square_refunds (id, payment_id, amount_cents, status) values ('rf-416-given', 'sq-416-given', 1000, 'COMPLETED')`);
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [given.id]);
  ok("an order refunded in full in Square first, then voided, is not flagged again", (await flags(given.id)).length === 0);

  // The offline replay is the same write: what the browser never got to raise, the database did.
  const replay = await order({ paid: true, payment: "sq-416-replay", total: 1000 });
  await as(KAY, `select public.staff_set_order_status($1, 'preparing', 'new') r`, [replay.id]);
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'preparing') r`, [replay.id]);
  ok("a void replayed from a phone that had no signal raises its flag with it", (await flags(replay.id)).length === 1);

  // A member, from the app; a guest, from the order page — one flag each, in their words.
  const mine = await order({ user: SAM, paid: true, payment: "sq-416-m", total: 1000, tip: 150, customer: "Sam Ito" });
  const c1 = await as(SAM, `select public.cancel_own_order($1) r`, [mine.id]);
  const f3 = await flags(mine.id);
  ok("a member's cancel: one flag, the member's words (0409's), from the trigger — the function raises none of its own",
    c1.rows[0]?.r === true && f3.length === 1 && f3[0].title === "Customer canceled a paid order — refund needed"
      && f3[0].body === `A member canceled order ${noOf(mine.id)}. Refund $11.50 (drinks $10.00 + tip $1.50) in Square — all of the charge.`, f3);
  const guest = await order({ paid: true, payment: "sq-416-g", total: 2200, tip: 330, customer: "Jordan Reyes" });
  const c2 = await as(null, `select public.cancel_by_ticket($1) r`, [guest.ticket]);
  const f4 = await flags(guest.id);
  ok("a guest's cancel from the order page: one flag, who and from where",
    c2.rows[0]?.r?.outcome === "canceled" && f4.length === 1
      && f4[0].body === `Jordan canceled order ${noOf(guest.id)} from its order page. Refund $25.30 (drinks $22.00 + tip $3.30) in Square — all of the charge.`, f4);
  const guestUnpaid = await order({ total: 800, customer: "Pat Lee" });
  await as(null, `select public.cancel_by_ticket($1) r`, [guestUnpaid.ticket]);
  ok("a guest's unpaid cancel is the crew's FYI, as before — and no refund flag",
    (await flags(guestUnpaid.id)).length === 0
      && Number((await q1(`select count(*) n from public.alerts where title = 'Canceled: Pat''s cup order'`)).n) === 1);
  ok("the words are for this transaction only: the next crew void says the crew did it",
    (await q1(`select coalesce(current_setting('gt3.void_by', true), '') v`)).v === "");

  // An app from before (the crew's iPhone build) still raises its own from the browser: one flag stays one.
  const before = await order({ paid: true, payment: "sq-416-old", total: 1000 });
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [before.id]);
  const old = await as(KAY, `insert into public.alerts (severity, category, kind, subject_id, title, body, link) values ('critical', 'money', 'refund_needed', $1, 'Voided a PAID order — refund needed', 'old words', '/crew') returning id`, [before.id]);
  const kept = await flags(before.id);
  ok("an old app's browser-raised copy is not written while the database's flag is open — nor counted into it, nor its words",
    !old.error && old.rows.length === 0 && kept.length === 1 && /all of the charge/.test(kept[0].body)
      && (await q1(`select coalesce(occurrences, 1) n from public.alerts where kind = 'refund_needed' and subject_id = $1`, [before.id])).n === 1, { old, kept });
}

// ── 0416 · a pack, an office order ────────────────────────────────────────────────────────────────────────────────
{
  const online = await pack({ paid: true, payment: "sq-416-p1", total: 3600, name: "Sam Ito" });
  const crew = await as(KAY, `update public.drop_orders set canceled_at = now() where id = $1 returning id`, [online]);
  const f1 = await flags(online);
  ok("the pack board's cancel (a plain update, the crew's) of a card-paid pack raises one flag, from the row",
    !crew.error && f1.length === 1 && f1[0].title === "Canceled a PAID reservation — refund needed"
      && /^Sam Ito · 6-pack · \$36\.00 paid online for .+'s drop\. Refund it in Square — all of it\.$/.test(f1[0].body), { crew, f1 });

  const reader = await pack({ total: 3600, name: "Nia Park", user: NIA });
  await as(LEE, `select public.staff_collect_payment('pickup', $1, 'card_reader') r`, [reader]);
  await as(KAY, `update public.drop_orders set canceled_at = now() where id = $1`, [reader]);
  const free = await pack({ paid: true, payment: null, total: 0 });
  await as(KAY, `update public.drop_orders set canceled_at = now() where id = $1`, [free]);
  const unpaid = await pack({ total: 3600 });
  await as(KAY, `update public.drop_orders set canceled_at = now() where id = $1`, [unpaid]);
  ok("a pack collected on the card reader is flagged; a pack on us ($0) and an unpaid one are not",
    (await flags(reader)).length === 1 && /paid on the card reader/.test((await flags(reader))[0].body)
      && (await flags(free)).length === 0 && (await flags(unpaid)).length === 0);

  const changed = await pack({ paid: true, payment: "sq-416-p2", total: 3600 + 4200 });
  await q(`insert into public.drop_order_changes (key, drop_order_id, user_id, state, card, before, after, diff_cents, charge_payment_id)
    values ('r9-change-p2-0001', $1, $2, 'done', true, '{"size": 6}', '{"size": 12}', 4200, 'sq-416-c2')`, [changed, SAM]);
  await as(KAY, `update public.drop_orders set canceled_at = now() where id = $1`, [changed]);
  ok("a pack made bigger was charged twice: its flag says so — refund each",
    /charged in 2 payments — the pack and the change that made it bigger — so refund each\./.test((await flags(changed))[0]?.body ?? ""), await flags(changed));

  const members = await pack({ paid: true, payment: "sq-416-p3", total: 2400, user: NIA, name: "Nia Park" });
  const c = await as(NIA, `select public.cancel_own_reservation($1) r`, [members]);
  const f2 = await flags(members);
  ok("a member's own pack cancel: one flag in the member's words — no second, unkeyed alert as 0397 wrote",
    c.rows[0]?.r === true && f2.length === 1 && f2[0].title === "Member canceled a PAID reservation — refund needed"
      && Number((await q1(`select count(*) n from public.alerts where title like 'Member canceled a PAID reservation%'`)).n) === 1, { c, f2 });

  // An office order: canceled while paid is flagged; unpaid is not.
  const acct = (await q1(`insert into public.business_accounts (user_id, company) values ($1, 'Acme Dental') returning id`, [SAM])).id;
  const bo = async (pay, payId) => (await q1(`insert into public.business_orders (business_id, user_id, company, contact_name, contact_phone, address_street, address_city, address_zip, delivery_date, gallons, subtotal_cents, total_cents, billing_terms, payment_status, payment_id, tenant_id)
    values ($1, $2, 'Acme Dental', 'Dee Ross', '8645550100', '1 Main St', 'Greenville', '29601', current_date + 4, 3, 13500, 13500, 'net15', $3, $4, $5) returning id`, [acct, SAM, pay, payId, T1])).id;
  const paidOffice = await bo("paid", "sq-416-o1");
  await as(KAY, `update public.business_orders set canceled_at = now(), status = 'issue' where id = $1`, [paidOffice]);
  const handPaid = await bo("paid", null);
  await as(KAY, `update public.business_orders set canceled_at = now(), status = 'issue' where id = $1`, [handPaid]);
  const owed = await bo("pending", null);
  await as(KAY, `update public.business_orders set canceled_at = now(), status = 'issue' where id = $1`, [owed]);
  const o1 = await flags(paidOffice), o2 = await flags(handPaid);
  ok("an office order canceled while paid is flagged — by its link, or marked paid by hand; one still owed is not",
    o1.length === 1 && o1[0].title === "Canceled a PAID office order — refund needed" && /\$135\.00 paid by its link\./.test(o1[0].body)
      && o2.length === 1 && /\$135\.00 marked paid\./.test(o2[0].body) && (await flags(owed)).length === 0, { o1, o2 });
}

// ── 0416 · a stop called off ─────────────────────────────────────────────────────────────────────────────────────
{
  const stop = (await q1(`insert into public.stops (name, starts_at, market) values ('Falls Park', now() + interval '1 day', 'greenville') returning id`)).id;
  const a = await order({ stop, paid: true, payment: "sq-416-s1", total: 1000, tip: 100, customer: "Ana Ruiz", user: SAM });
  const b = await order({ stop, total: 800, customer: "Bo Diaz" });
  await as(LEE, `select public.staff_collect_payment('cup', $1, 'card_reader') r`, [b.id]);
  const c = await order({ stop, total: 700, customer: "Cy Moss" });
  const done = await order({ stop, status: "done", paid: true, payment: "sq-416-s4", total: 900 });
  const early = await as(ALEX, `select public.void_stop_orders($1) r`, [stop]);
  ok("void_stop_orders refuses a stop that isn't called off", /isn't called off/.test(early.error ?? ""), early);
  await as(ALEX, `select public.cancel_stop($1, 'storm') r`, [stop]);
  const crewTry = await as(KAY, `select public.void_stop_orders($1) r`, [stop]);
  ok("…and is an owner's or an admin's, as cancel_stop", /owners and admins only/.test(crewTry.error ?? ""), crewTry);
  const v = await as(ALEX, `select public.void_stop_orders($1) r`, [stop]);
  const r = v.rows[0]?.r;
  const ids = (r?.voided ?? []).map((x) => x.id).sort();
  ok("a stop called off voids its open cups — the picked-up one stays — and says what each was",
    !v.error && ids.join() === [a.id, b.id, c.id].sort().join() && (r?.stuck ?? []).length === 0
      && (await q1(`select status from public.orders where id = $1`, [done.id])).status === "done"
      && r.voided.find((x) => x.id === b.id)?.collected_via === "card_reader", v);
  const fa = await flags(a.id), fb = await flags(b.id);
  ok("each paid cup has its own flag in the stop's words — the card-reader cup too; the unpaid cup none",
    fa.length === 1 && fa[0].title === "Stop called off — refund needed"
      && fa[0].body === `Ana · ${noOf(a.id)} · $11.00 (drinks $10.00 + tip $1.00) paid online — Falls Park was called off. Refund it in Square — all of the charge.`
      && fb.length === 1 && /paid on the card reader — Falls Park was called off/.test(fb[0].body) && (await flags(c.id)).length === 0, { fa, fb });
  const again = await as(ALEX, `select public.void_stop_orders($1) r`, [stop]);
  ok("a second call voids nothing twice and flags nothing twice", (again.rows[0]?.r?.voided ?? []).length === 0
    && (await flags(a.id)).length === 1 && (await flags(b.id)).length === 1);
  const late = await order({ stop, paid: true, payment: "sq-416-s5", total: 600 });
  const retry = await as(ALEX, `select public.void_stop_orders($1) r`, [stop]);
  ok("…and a retry voids what was still open — and flags it", (retry.rows[0]?.r?.voided ?? []).map((x) => x.id).join() === late.id && (await flags(late.id)).length === 1);
}

// ── 0416 · spent once per tap ──────────────────────────────────────────────────────────────────────────────────────
{
  await q(`update public.profiles set credit_cents = 1500, points = 25 where id = $1`, [NIA]);
  const code = (await q1(`select referral_code from public.profiles where id = $1`, [NIA])).referral_code;
  const KEY = "tap-0c416-credit-0001";
  const s1 = await as(KAY, `select public.use_credit($1, 600, $2) r`, [code, KEY]);
  const s2 = await as(KAY, `select public.use_credit($1, 600, $2) r`, [code, KEY]);
  const left = (await q1(`select credit_cents c from public.profiles where id = $1`, [NIA])).c;
  ok("Use credit, the answer lost and the tap repeated: the second returns the first answer and spends nothing ($15 → $9)",
    s1.rows[0]?.r === 600 && s2.rows[0]?.r === 600 && left === 900
      && Number((await q1(`select count(*) n from public.credit_spends where user_id = $1`, [NIA])).n) === 1, { s1, s2, left });
  const s3 = await as(KAY, `select public.use_credit($1, 300, 'tap-0c416-credit-0002') r`, [code]);
  ok("…a new tap is a new spend", s3.rows[0]?.r === 300 && (await q1(`select credit_cents c from public.profiles where id = $1`, [NIA])).c === 600);
  const g1 = await as(KAY, `select public.give_free_cup($1, 'tap-0c416-cup-0001') r`, [code]);
  const g2 = await as(KAY, `select public.give_free_cup($1, 'tap-0c416-cup-0001') r`, [code]);
  ok("Give free cup twice on one tap: one cup (25 → 15), the second answer the card as it stands",
    g1.rows[0]?.r === 15 && g2.rows[0]?.r === 15 && (await q1(`select points p from public.profiles where id = $1`, [NIA])).p === 15, { g1, g2 });
  const oldSpend = await as(KAY, `select public.spend_credit($1, 100) r`, [code]);
  const oldCup = await as(KAY, `select public.redeem_free_cup($1) r`, [code]);
  ok("the apps from before still spend and redeem by the old names — no key, as before",
    oldSpend.rows[0]?.r === 100 && oldCup.rows[0]?.r === 5, { oldSpend, oldCup });
  const own = await as(NIA, `select public.use_credit($1, 100, 'tap-0c416-own-0001') r`, [code]);
  const member = await as(SAM, `select public.use_credit($1, 100, 'tap-0c416-mem-0001') r`, [code]);
  const shortKey = await as(KAY, `select public.use_credit($1, 100, 'x') r`, [code]);
  ok("the rules stand: staff only, never your own card, and a key is a key",
    /staff only/.test(member.error ?? "") && /staff only|your own card/.test(own.error ?? "") && /8 to 80/.test(shortKey.error ?? ""), { own, member, shortKey });
  ok("use_credit and give_free_cup are the crew's (authenticated), never anon's; the old names are callers of them",
    (await q1(`select has_function_privilege('anon', 'public.use_credit(text, integer, text)', 'execute') a,
      has_function_privilege('authenticated', 'public.give_free_cup(text, text)', 'execute') b,
      (select prosecdef from pg_proc where proname = 'spend_credit') c`)).a === false
      && (await q1(`select has_function_privilege('authenticated', 'public.give_free_cup(text, text)', 'execute') b`)).b === true
      && (await q1(`select (select prosecdef from pg_proc where proname = 'spend_credit') c`)).c === false);
}

// ── 0416 · a pack's stamps; covered at the window ────────────────────────────────────────────────────────────────
{
  const pts = async (id) => (await q1(`select coalesce(points, 0) p from public.profiles where id = $1`, [id])).p;
  await q(`update public.profiles set points = 0 where id = $1`, [SAM]);
  const p = await pack({ paid: true, payment: "sq-416-st", total: 3600, size: 6 });
  await as(KAY, `update public.drop_orders set stage = 'picked_up' where id = $1`, [p]);
  const earned = await pts(SAM);
  await as(KAY, `update public.drop_orders set stage = 'ready' where id = $1`, [p]);
  const kept = await pts(SAM);
  await as(KAY, `update public.drop_orders set stage = 'picked_up' where id = $1`, [p]);
  const again = await pts(SAM);
  ok("a picked-up pack moved back a stage keeps its stamps, and picked up again earns no second set",
    earned === 6 && kept === 6 && again === 6, { earned, kept, again });
  await as(KAY, `update public.drop_orders set canceled_at = now() where id = $1`, [p]);
  ok("…and canceled, it gives them back", (await pts(SAM)) === 0);

  const cup = await order({ total: 900 });
  const cov = await as(KAY, `select public.staff_collect_payment('cup', $1, 'covered') r`, [cup.id]);
  const row = await q1(`select paid, collected_via, collected_at is not null c, payment_status from public.orders where id = $1`, [cup.id]);
  ok("covered at the window — a free cup or credit — settles it with no money: paid stays false, nothing to collect",
    cov.rows[0]?.r === "collected" && row.paid === false && row.collected_via === "covered" && row.c === true, { cov, row });
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [cup.id]);
  ok("…and voided, it took nothing to give back: no flag", (await flags(cup.id)).length === 0);
  // The crew's iPhone app from before reads covered as paid and raises its own "refund it in Square" — not written.
  const old = await as(KAY, `insert into public.alerts (severity, category, kind, subject_id, title, body, link, tenant_id)
    values ('critical', 'money', 'refund_needed', $1, 'Voided a PAID order — refund needed', 'Guest · #0000 · $9.00 paid online. Refund it in Square.', '/crew?s=money&a=pay', $2)`, [cup.id, T1]);
  ok("…and an older app's 'refund it in Square' for it is not written — a covered cup took no money", !old.error && (await flags(cup.id)).length === 0, { old, flags: await flags(cup.id) });
  const und = await as(KAY, `select public.staff_undo_collection('cup', $1) r`, [(await order({ total: 500 })).id]);
  const bad = await as(KAY, `select public.staff_collect_payment('cup', $1, 'iou') r`, [(await order({ total: 500 })).id]);
  ok("…and the ways are still named: cash, card reader, covered", und.rows[0]?.r === "nothing to undo" && /cash, card_reader or covered/.test(bad.error ?? ""), { und, bad });
}

// ── 0417 · the books count what went back ─────────────────────────────────────────────────────────────────────
{
  // A fresh week: only what is written here counts.
  await db.exec(`delete from public.alerts; delete from public.square_refunds; delete from public.event_sales;`);
  const sales = async () => { const r = await as(ALEX, `select public.report_sales(7) r`); return r.error ? { error: r.error } : r.rows[0]?.r; };
  const sale = (id, cents, ago = 0) => q(`insert into public.event_sales (square_payment_id, amount_cents, source, tenant_id, created_at) values ($1, $2, 'square', $3, now() - make_interval(days => $4))`, [id, cents, T1, ago]);
  const refund = (id, pay, cents, ago = 0, status = "COMPLETED") => q(`insert into public.square_refunds (id, payment_id, amount_cents, status, created_at) values ($1, $2, $3, $4, now() - make_interval(days => $5))`, [id, pay, cents, status, ago]);
  const base = await sales();
  // W: a walk-up sale ($20) refunded $5 in Square; a card-reader pre-order ($9) voided and refunded in full.
  await sale("sq-417-w", 2000); await refund("rf-417-w", "sq-417-w", 500);
  const readerCup = await order({ total: 900 });
  await as(LEE, `select public.staff_collect_payment('cup', $1, 'card_reader') r`, [readerCup.id]);
  await sale("sq-417-reader", 900);
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [readerCup.id]);
  await refund("rf-417-reader", "sq-417-reader", 900);
  // C: a cup paid online ($10 + $2 tip), handed over, then refunded in full ($12): the drinks come off, never the tip.
  await order({ paid: true, payment: "sq-417-c", total: 1000, tip: 200, status: "done" });
  await refund("rf-417-c", "sq-417-c", 1200);
  // H: a cup paid online ($10 + $2 tip), handed over, given back in two halves ($6 and $6): $10 off together, never $12.
  await order({ paid: true, payment: "sq-417-h", total: 1000, tip: 200, status: "done" });
  await refund("rf-417-h1", "sq-417-h", 600, 1); await refund("rf-417-h2", "sq-417-h", 600);
  // V: a cup paid online and voided ($8), refunded: already out of the books — not taken off twice.
  const voided = await order({ paid: true, payment: "sq-417-v", total: 800 });
  await as(KAY, `select public.staff_set_order_status($1, 'void', 'new') r`, [voided.id]);
  await refund("rf-417-v", "sq-417-v", 800);
  // P: a pack ($36) picked up and refunded $6 by hand; its own change refund (a smaller pack) is the change's money.
  const p = await pack({ paid: true, payment: "sq-417-p", total: 3000 });
  await q(`insert into public.drop_order_changes (key, drop_order_id, user_id, state, card, before, after, diff_cents, refunds)
    values ('r9-change-p-0001', $1, $2, 'done', true, '{"size": 6}', '{"size": 5}', -600, '[{"payment_id": "sq-417-p", "refund_id": "rf-417-p-change", "cents": 600, "status": "COMPLETED"}]')`, [p, SAM]);
  await refund("rf-417-p-change", "sq-417-p", 600);
  await refund("rf-417-p-hand", "sq-417-p", 600);
  // S: a stale change's charge ($15, never applied) given back: walk-up money, where its charge was counted.
  await sale("sq-417-stale", 1500);
  await q(`insert into public.drop_order_changes (key, drop_order_id, user_id, state, card, before, after, diff_cents, charge_payment_id)
    values ('r9-change-p-0002', $1, $2, 'stale', true, '{"size": 5}', '{"size": 8}', 1500, 'sq-417-stale')`, [p, SAM]);
  await refund("rf-417-stale", "sq-417-stale", 1500);
  // A refund still pending, and one from before the week, count nothing here.
  await refund("rf-417-pending", "sq-417-w", 100, 0, "PENDING");
  await sale("sq-417-old", 700, 20); await refund("rf-417-old", "sq-417-old", 700, 20);
  const s = await sales();
  const ch = s?.by_channel ?? {}, b0 = base?.by_channel ?? {};
  ok("0417: walk-up nets its refunds — the $5 off a sale, the card-reader cup given back, the stale change's charge given back",
    ch.square_walkup - b0.square_walkup === (2000 - 500) + (900 - 900) + (1500 - 1500), { now: ch.square_walkup, before: b0.square_walkup });
  ok("0417: a cup handed over and refunded comes off — its drinks, never its tip; a voided cup's refund is not taken off twice",
    ch.cup - b0.cup === (1000 - 1000) + (1000 - 1000), { now: ch.cup, before: b0.cup });
  const hDays = await q(`select x.made_at::date d, x.off_cents o from public.refunds_counted($1) x where x.refund_id in ('rf-417-h1', 'rf-417-h2') order by x.made_at`, [T1]);
  ok("0417: a cup given back in parts takes off its drinks together — $6 the first day, $4 the next, never past $10",
    hDays.length === 2 && Number(hDays[0].o) === 600 && Number(hDays[1].o) === 400, hDays);
  ok("0417: a pack's refund by hand comes off; its own change's refund does not (the change's difference already counts)",
    ch.packs - b0.packs === (3000 - (-600)) + (-600) - 600, { now: ch.packs, before: b0.packs });
  ok("0417: refunds_cents says what came off, and the days add up to revenue",
    s?.refunds_cents === 500 + 900 + 1000 + 1000 + 600 + 1500 && (s?.by_day ?? []).reduce((a, d) => a + Number(d.cents), 0) === s?.revenue_cents, { rf: s?.refunds_cents, rev: s?.revenue_cents });
  ok("0417: what a refund counts against is the books' own — not callable from the API",
    (await q1(`select has_function_privilege('authenticated', 'public.refunds_counted(uuid)', 'execute') a`)).a === false
      && (await q1(`select has_function_privilege('authenticated', 'public.refund_counts_against(text, text)', 'execute') a`)).a === false
      && (await q1(`select has_function_privilege('anon', 'public.refund_counts_against(text, text)', 'execute') a`)).a === false);
  const member = await as(SAM, `select public.report_sales(7) r`);
  ok("0417: a member is still told 'unauthorized'", member.rows[0]?.r?.error === "unauthorized");
  // The founder digest's week takes the same off.
  const had = (await q(`select count(*) n from public.live_status where id = 1`))[0].n;
  if (Number(had) === 0) await q(`insert into public.live_status (id) values (1)`);
  await q(`update public.live_status set digest_cadence = 'daily' where id = 1`);
  await q(`select public.founder_digest_alert()`);
  const body = (await q1(`select body from public.alerts where title = '📊 Daily founder digest' and tenant_id = $1 order by created_at desc limit 1`, [T1]))?.body ?? "";
  const expect = (s.revenue_cents - (ch.shop ?? 0) - (ch.reserve ?? 0)) / 100;
  ok("0417: the founder digest's week reads the same money, its refunds taken off",
    body.startsWith(`Revenue 7d: $${expect.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `), { body: body.slice(0, 40), expect });
}

// ── 0417 · a part of a shop order refunded ──────────────────────────────────────────────────────────────────────
{
  const so = (await q1(`insert into public.shop_orders (tenant_id, email, payment_id, subtotal_cents, total_cents, ship_name, ship_address, status)
    values ($1, 'ana@example.test', 'sq-417-shop', 3200, 3200, 'Ana Ruiz', '{"street": "1 Main"}', 'paid') returning id`, [T1])).id;
  const st = async () => q1(`select status, refund_amount_cents r from public.shop_orders where id = $1`, [so]);
  const p1 = await as(KAY, `select (public.set_shop_order_status($1, 'refunded', 'goodwill: late', 500)).status s`, [so]);
  ok("a $5 refund on a $32 cap not yet sent: recorded, and the order stays paid — still to send",
    p1.rows[0]?.s === "paid" && (await st()).status === "paid" && (await st()).r === 500, { p1, st: await st() });
  const p2 = await as(KAY, `select (public.set_shop_order_status($1, 'refunded', 'second credit', 700)).status s`, [so]);
  ok("…a second part is recorded too ($12 back in all)", p2.rows[0]?.s === "paid" && (await st()).r === 1200, p2);
  const over = await as(KAY, `select public.set_shop_order_status($1, 'refunded', 'too much', 2500) s`, [so]);
  ok("…never more than what is left ($20)", /\$20\.00 still on this order/.test(over.error ?? ""), over);
  const claim0 = await q1(`select public.claim_shop_order_for_submit($1, $2, 0) r`, [so, T1]);
  ok("…and it can still be sent to the printer (the claim takes it)", claim0.r === "ok", claim0);
  const rest = await as(KAY, `select (public.set_shop_order_status($1, 'refunded', 'printer lost it', null)).status s`, [so]);
  ok("the refund that leaves nothing ends it: refunded, all $32 back", rest.rows[0]?.s === "refunded" && (await st()).r === 3200, { rest, st: await st() });
  const noWhy = await as(KAY, `select public.set_shop_order_status($1, 'refunded', '', 100) s`, [(await q1(`insert into public.shop_orders (tenant_id, email, payment_id, subtotal_cents, total_cents, ship_name, ship_address, status) values ($1, 'b@example.test', 'sq-417-shop2', 1000, 1000, 'Bo', '{}', 'paid') returning id`, [T1])).id]);
  ok("…and a refund still needs a reason", /Say why/.test(noWhy.error ?? ""), noWhy);

  // An unclear send: the claim waits for a check.
  const cap = (await q1(`insert into public.shop_orders (tenant_id, email, payment_id, subtotal_cents, total_cents, ship_name, ship_address, status)
    values ($1, 'cy@example.test', 'sq-417-cap', 3200, 3200, 'Cy Moss', '{}', 'needs_fulfillment') returning id`, [T1])).id;
  await q(`update public.shop_orders set apliiq_submit_unknown_at = now() where id = $1`, [cap]);
  const claim = await q1(`select public.claim_shop_order_for_submit($1, $2, 0) r`, [cap, T1]);
  ok("a send with no clear answer: the claim refuses until the crew checks Apliiq", /no clear answer from Apliiq/.test(claim.r), claim);
  const notThere = await as(KAY, `select (public.shop_apliiq_checked($1, null)).apliiq_submit_unknown_at is null c`, [cap]);
  ok("…'not there' clears it to send again", notThere.rows[0]?.c === true && (await q1(`select public.claim_shop_order_for_submit($1, $2, 0) r`, [cap, T1])).r === "ok", notThere);
  await q(`update public.shop_orders set apliiq_submit_unknown_at = now(), apliiq_submit_started_at = null where id = $1`, [cap]);
  const there = await as(KAY, `select (public.shop_apliiq_checked($1, 'AQ-77812')).status s`, [cap]);
  ok("…and 'it's there, AQ-77812' puts it at the printer — the button can't send a second",
    there.rows[0]?.s === "submitted" && (await q1(`select apliiq_order_id a from public.shop_orders where id = $1`, [cap])).a === "AQ-77812"
      && /already has this order/.test((await q1(`select public.claim_shop_order_for_submit($1, $2, 0) r`, [cap, T1])).r), there);
  const memberCheck = await as(SAM, `select public.shop_apliiq_checked($1, null) s`, [cap]);
  ok("…the crew's to say, nobody else's", /Only crew/.test(memberCheck.error ?? ""), memberCheck);

  // A send still out: the route marks the order before it leaves (unknown + started now).
  const out = (await q1(`insert into public.shop_orders (tenant_id, email, payment_id, subtotal_cents, total_cents, ship_name, ship_address, status)
    values ($1, 'di@example.test', 'sq-417-out', 3200, 3200, 'Di Fox', '{}', 'needs_fulfillment') returning id`, [T1])).id;
  await q(`update public.shop_orders set apliiq_submit_started_at = now(), apliiq_submit_unknown_at = now() where id = $1`, [out]);
  const second = await q1(`select public.claim_shop_order_for_submit($1, $2) r`, [out, T1]);
  ok("a send still out: a second press hears it is being sent right now — not 'no clear answer', and not sent",
    /sending this order right now/.test(second.r), second);
  const early = await as(KAY, `select public.shop_apliiq_checked($1, null) s`, [out]);
  ok("…and 'not there' waits for its answer — it can't clear the way for a second send meanwhile",
    /being sent to Apliiq right now/.test(early.error ?? ""), early);
  const hashId = await as(KAY, `select public.shop_apliiq_checked($1, '#AQ 1') s`, [out]);
  ok("…an id that can't be an Apliiq order id is refused", /doesn't read as an Apliiq order id/.test(hashId.error ?? ""), hashId);
  // The function stopped mid-send: the mark stays, and after two minutes it reads as no clear answer.
  await q(`update public.shop_orders set apliiq_submit_started_at = now() - interval '10 minutes' where id = $1`, [out]);
  const stale = await q1(`select public.claim_shop_order_for_submit($1, $2) r`, [out, T1]);
  ok("a send stopped half way never ages into a second one: the claim waits for the crew's check",
    /no clear answer from Apliiq/.test(stale.r), stale);
  const view = await as(KAY, `select apliiq_submit_unknown_at is not null u, apliiq_submit_started_at is not null s from public.v_shop_orders where id = $1`, [out]);
  ok("…the order's panel can see both marks (v_shop_orders, at its end)", view.rows[0]?.u === true && view.rows[0]?.s === true, view);
  const cleared = await as(KAY, `select (public.shop_apliiq_checked($1, null)).apliiq_submit_started_at is null c`, [out]);
  ok("…and once it's looked for and not there, it can be sent again", cleared.rows[0]?.c === true
    && (await q1(`select public.claim_shop_order_for_submit($1, $2) r`, [out, T1])).r === "ok", cleared);
}

ok("0416 and 0417 say so in the changelog, once each, and record themselves",
  Number((await q1(`select count(*) n from public.changelog where title in ('Every refund is flagged, whoever cancels and wherever', 'Credit and free cups are spent once', 'A pack keeps its stamps when the crew corrects its stage', 'Money counts what went back', 'A partial shop refund keeps the order open')`)).n) === 5
    && (await q1(`select applied_count from public.schema_migrations where version = '0416_a_refund_is_flagged_where_the_money_goes_back'`))?.applied_count === 2
    && (await q1(`select applied_count from public.schema_migrations where version = '0417_the_books_count_what_went_back'`))?.applied_count === 2);

console.log(`R9 MONEY (0416–0417, in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
