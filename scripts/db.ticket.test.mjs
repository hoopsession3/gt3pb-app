// 0395 — EVERY ORDER A TICKET, executed from its file against the whole schema (every migration before it, in order:
// scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does.
//
// The finding, as a sentence (R3b of the customer audit, board 09): a guest who paid for a cup had the "Order in."
// screen and nothing after it — no number, no way back once the sheet closed, no word while they waited. Every order
// now carries a ticket: a link that shows that one order, and nothing else, to whoever holds it.
//
// What it proves: every order has a ticket, old ones too, each its own; the ticket's view is that order's — its number,
// status, items, total, how it was paid, the stop and the first name — and no one's email, id, payment or full name;
// an unknown ticket is refused in words, as a 4xx; telling the truck from the ticket works while the order is in
// progress and not after; a signed-out reader still cannot read the orders table; and a second run changes nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL395 = readFileSync(join(ROOT, "supabase/migrations/0395_every_order_a_ticket.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const JORDAN = "0c395000-0000-4000-8000-0000000000a1", SAM = "0c395000-0000-4000-8000-0000000000a2";

const t0 = Date.now();
const db = await fullSchema({ before: "0395" });
console.log(`the schema before 0395 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null, code: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
for (const [id, who] of [[JORDAN, "jordan"], [SAM, "sam"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${who}@example.test`]);
  await db.query(`update public.profiles set role = 'member', tenant_id = $2 where id = $1`, [id, T1]);
}
const WX = (await q1(`insert into public.stops (name, status, starts_at, ends_at, address, lat, lng)
  values ('WineXpress', 'upcoming', now() + interval '1 hour', now() + interval '4 hours', '202 Scuffletown Rd, Simpsonville, SC 29681', 34.73, -82.25) returning id`)).id;
const order = async (row) => (await q1(`insert into public.orders (items, total_cents, status, customer, user_id, tenant_id, stop_id, paid, payment_id)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [row.items, row.total ?? 2200, row.status ?? "new", row.customer ?? null, row.user ?? null, T1, row.stop ?? WX, row.paid ?? false, row.payment ?? null])).id;

// ── BEFORE: orders that were placed before tickets existed ─────────────────────────────────────────────────────────
const OLD_GUEST = await order({ items: ["flow", "tide"], customer: "Jordan Reyes", paid: true, payment: "sq-pay-old-1" });
const OLD_DONE = await order({ items: ["hunt"], customer: "Sam Lee", user: SAM, status: "done" });
ok("before 0395: no ticket to look an order up by", (await q(`select 1 from information_schema.columns where table_name = 'orders' and column_name = 'ticket'`)).length === 0);

// ── 0395 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(SQL395);
const tk = async (id) => (await q1(`select ticket from public.orders where id = $1`, [id])).ticket;
const T_OLD = await tk(OLD_GUEST), T_DONE = await tk(OLD_DONE);
ok("every order has a ticket — the ones placed before it too — each its own", !!T_OLD && !!T_DONE && T_OLD !== T_DONE
  && (await q1(`select count(*)::int as n from public.orders where ticket is null`)).n === 0);
const NEW_GUEST = await order({ items: ["flow", "flow", "rise"], customer: "  Ana  ", paid: false });
const T_NEW = await tk(NEW_GUEST);
ok("a new order is given its ticket by the table, with nothing asked of checkout", !!T_NEW && T_NEW !== T_OLD);
let uniq = null; try { await q(`update public.orders set ticket = $1 where id = $2`, [T_OLD, NEW_GUEST]); } catch (e) { uniq = e.code; }
ok("two orders cannot share a ticket (unique)", uniq === "23505", uniq);

// ── the ticket's view ───────────────────────────────────────────────────────────────────────────────────────────────
await q(`update public.orders set lines = $2, card_brand = 'Visa', card_last4 = '4242', tip_cents = 200, ready_from = now() + interval '1 hour' where id = $1`,
  [OLD_GUEST, JSON.stringify([{ slug: "flow", qty: 1, unit_cents: 1000 }, { slug: "tide", qty: 1, unit_cents: 1200 }])]);
const v = await as(null, `select public.order_ticket($1) as t`, [T_OLD]);
const t = v.rows[0]?.t;
ok("a signed-out phone reads its order by its ticket", v.error === null && !!t, v.error);
ok("the view: its number as the window calls it, its status, its items and lines, the total and the tip",
  t?.no === `#${OLD_GUEST.slice(0, 4).toUpperCase()}` && t?.status === "new" && JSON.stringify(t?.items) === '["flow","tide"]'
  && t?.lines?.length === 2 && t?.lines[1].unit_cents === 1200 && t?.total_cents === 2200 && t?.tip_cents === 200, t);
ok("the view: paid, and how — the brand and the last four, never more of the card", t?.paid === true && t?.card === "Visa ··4242", t);
ok("the view: the stop's name, place and hours, and where it is on a map", t?.stop?.name === "WineXpress" && /Scuffletown/.test(t?.stop?.place ?? "")
  && !!t?.stop?.starts_at && !!t?.stop?.ends_at && t?.stop?.lat === 34.73 && t?.stop?.canceled === false, t?.stop);
ok("the view: the first name it is for, and when it is made from", t?.for === "Jordan" && !!t?.ready_from, t);
const leaks = JSON.stringify(t ?? {});
ok("the view: nobody's email, account, payment, full name or order id — the ticket is the only key it shows",
  !/example\.test|sq-pay-old-1|Reyes/.test(leaks) && !leaks.includes(JORDAN) && !leaks.includes(SAM) && !leaks.includes(OLD_GUEST) && !leaks.includes(T_OLD)
  && !("user_id" in (t ?? {})) && !("payment_id" in (t ?? {})), leaks);
const nv = (await as(null, `select public.order_ticket($1) as t`, [T_NEW])).rows[0]?.t;
ok("the view: not paid is not paid; no card; a name typed with spaces is its first word", nv?.paid === false && nv?.card === null && nv?.for === "Ana" && nv?.lines === null, nv);
await q(`update public.orders set collected_at = now(), collected_via = 'cash' where id = $1`, [NEW_GUEST]);
ok("the view: paid at the window reads paid (lib/settled's rule)", (await as(null, `select public.order_ticket($1) as t`, [T_NEW])).rows[0]?.t?.paid === true);
const bad = await as(null, `select public.order_ticket($1) as t`, ["0c395000-0000-4000-8000-00000000dead"]);
ok("an unknown ticket is refused in words, as a 4xx (PT404) — never a 5xx", bad.code === "PT404" && /isn't one of ours/.test(bad.error ?? ""), bad);
const member = await as(SAM, `select public.order_ticket($1) as t`, [T_DONE]);
ok("a member reads their own order's ticket the same way", member.rows[0]?.t?.status === "done" && member.rows[0]?.t?.for === "Sam", member);

// ── what Square has refunded ──────────────────────────────────────────────────────────────────────────────────────
ok("the view: nothing refunded is nothing refunded", t?.refunded_cents === 0 && t?.refund_pending === false, t);
await q(`insert into public.square_refunds (id, payment_id, amount_cents, status) values ('rf-1', 'sq-pay-old-1', 2400, 'COMPLETED'), ('rf-2', 'sq-pay-old-1', 100, 'PENDING'), ('rf-3', 'sq-pay-other', 999, 'COMPLETED')`);
const rf = (await as(null, `select public.order_ticket($1) as t`, [T_OLD])).rows[0]?.t;
ok("the view: what Square completed for this payment, and that one is still pending — never another payment's",
  rf?.refunded_cents === 2400 && rf?.refund_pending === true, rf);
ok("the view: an order with no payment has no refunds, whatever the table holds", (await as(null, `select public.order_ticket($1) as t`, [T_NEW])).rows[0]?.t?.refunded_cents === 0);

// ── the table itself stays closed ───────────────────────────────────────────────────────────────────────────────────
const anonRead = await as(null, `select ticket from public.orders`);
ok("signed out, the orders table is still unreadable — the ticket opens one order through its view, not the table",
  anonRead.rows.length === 0, anonRead);
const samReads = await as(SAM, `select id, ticket from public.orders`);
ok("a member reads their own orders' tickets and no one else's", samReads.rows.length === 1 && samReads.rows[0].id === OLD_DONE, samReads.rows.map((r) => r.id));

// ── tell the truck, from the ticket ─────────────────────────────────────────────────────────────────────────────────
const eta = await as(null, `select public.ticket_eta($1, 'on_way') as ok`, [T_OLD]);
const etaRow = await q1(`select eta_status, eta_at from public.orders where id = $1`, [OLD_GUEST]);
ok("from the ticket, signed out: On my way reaches the order, with when", eta.rows[0]?.ok === true && etaRow.eta_status === "on_way" && !!etaRow.eta_at, { eta, etaRow });
const clear = await as(null, `select public.ticket_eta($1, null) as ok`, [T_OLD]);
ok("…and can be taken back", clear.rows[0]?.ok === true && (await q1(`select eta_status from public.orders where id = $1`, [OLD_GUEST])).eta_status === null);
const doneEta = await as(SAM, `select public.ticket_eta($1, 'outside') as ok`, [T_DONE]);
ok("a picked-up order has nothing to tell the truck: false, and nothing written", doneEta.rows[0]?.ok === false
  && (await q1(`select eta_status from public.orders where id = $1`, [OLD_DONE])).eta_status === null, doneEta);
const odd = await as(null, `select public.ticket_eta($1, 'teleporting') as ok`, [T_OLD]);
ok("a word the truck does not know is refused in words, as a 4xx (22023)", odd.code === "22023" && /isn't something we can tell the truck/.test(odd.error ?? ""), odd);
const badEta = await as(null, `select public.ticket_eta($1, 'on_way') as ok`, ["0c395000-0000-4000-8000-00000000dead"]);
ok("an unknown ticket tells the truck nothing — refused, PT404", badEta.code === "PT404", badEta);

// ── the card's last four are four digits ───────────────────────────────────────────────────────────────────────────
let chk = null; try { await q(`update public.orders set card_last4 = '42424' where id = $1`, [NEW_GUEST]); } catch (e) { chk = e.code; }
ok("card_last4 holds four digits and nothing longer", chk === "23514", chk);

// ── who may call what ───────────────────────────────────────────────────────────────────────────────────────────────
const grants = await q1(`select has_function_privilege('anon', 'public.order_ticket(uuid)', 'execute') as a1,
  has_function_privilege('authenticated', 'public.order_ticket(uuid)', 'execute') as a2,
  has_function_privilege('anon', 'public.ticket_eta(uuid, text)', 'execute') as a3`);
ok("the two functions are anyone's — the ticket is the key, not the account", grants.a1 && grants.a2 && grants.a3, grants);

// ── 0391's line, said as it is ─────────────────────────────────────────────────────────────────────────────────────
const c391 = (await q1(`select summary from public.changelog where title = 'A canceled stop says so'`))?.summary ?? "";
ok("0391's changelog no longer promises every cup a text or an email — a member is told, a guest's order page says it",
  !!c391 && !/gets a text or an email/.test(c391) && /a guest's order page says so/.test(c391), c391.slice(0, 200));

// ── a second run ────────────────────────────────────────────────────────────────────────────────────────────────────
const before2 = JSON.stringify(await q(`select id, ticket from public.orders order by id`));
await db.exec(SQL395);
ok("a second run changes nothing: the same tickets, one changelog entry, one ledger row",
  JSON.stringify(await q(`select id, ticket from public.orders order by id`)) === before2
  && (await q1(`select count(*)::int as n from public.changelog where title = 'Every order gets a ticket'`)).n === 1
  && (await q1(`select count(*)::int as n from public.schema_migrations where version = '0395_every_order_a_ticket'`)).n === 1);

console.log(`EVERY ORDER A TICKET (0395): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
