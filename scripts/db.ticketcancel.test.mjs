// 0396 — A GUEST CANCELS FROM THE TICKET, executed from its file against the whole schema (every migration before it,
// in order: scripts/fixtures/schema.full.mjs), acting as a signed-out guest and a member the way PostgREST does.
//
// The finding, as a sentence (R3c of the customer audit): a member could take back a cup order while it was still in;
// a guest — who has a ticket and no account — could read it and tell the truck, and nothing let them cancel it.
//
// What it proves: the ticket cancels its own order, by the member's rule (only while In, never once paid at the
// window), answering in the words the screens use; a paid one raises the crew's refund alert, an unpaid one an FYI;
// a second cancel says it is already canceled; an unknown ticket is refused in words, as a 4xx; the ticket's view says
// whether it was paid at the window and still carries nobody's account or payment; and a second run changes nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL396 = readFileSync(join(ROOT, "supabase/migrations/0396_a_guest_cancels_from_the_ticket.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const SAM = "0c396000-0000-4000-8000-0000000000a2";

const t0 = Date.now();
const db = await fullSchema({ before: "0396" });
console.log(`the schema before 0396 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
await db.query(`insert into auth.users (id, email) values ($1, $2)`, [SAM, "sam@example.test"]);
await db.query(`update public.profiles set role = 'member', tenant_id = $2 where id = $1`, [SAM, T1]);
const WX = (await q1(`insert into public.stops (name, status, starts_at, ends_at, address)
  values ('WineXpress', 'upcoming', now() + interval '1 hour', now() + interval '4 hours', '202 Scuffletown Rd') returning id`)).id;
// A cup paid at the window carries how and when together (0341, orders_collected_pair).
const order = async (row) => (await q1(`insert into public.orders (items, total_cents, status, customer, user_id, tenant_id, stop_id, paid, payment_id, collected_at, collected_via)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id, ticket`, [row.items ?? ["flow"], row.total ?? 2200, row.status ?? "new", row.customer ?? "Ana Ruiz",
  row.user ?? null, T1, WX, row.paid ?? false, row.payment ?? null, row.collected ?? null, row.collected ? "cash" : null]));
const statusOf = async (id) => (await q1(`select status from public.orders where id = $1`, [id])).status;
const alertsLike = async (s) => (await q1(`select count(*)::int as n from public.alerts where body like $1`, [s])).n;

ok("before 0396: nothing cancels by ticket", (await q(`select 1 from pg_proc where proname = 'cancel_by_ticket'`)).length === 0);
await db.exec(SQL396);

// ── the guest's own order, while it is In ──────────────────────────────────────────────────────────────────
const unpaid = await order({ customer: "Ana Ruiz" });
const r1 = await as(null, `select public.cancel_by_ticket($1) as r`, [unpaid.ticket]);
ok("a guest cancels their unpaid order from its ticket, and is told so in the screens' words",
  !r1.error && r1.rows[0].r.ok === true && r1.rows[0].r.outcome === "canceled" && r1.rows[0].r.paid === false && (await statusOf(unpaid.id)) === "void", r1);
ok("the crew hear it: an FYI that nothing was charged, naming the order by its number",
  (await alertsLike(`Ana canceled order #${unpaid.id.slice(0, 4).toUpperCase()} from its order page. Nothing was charged%`)) === 1);
const again = await as(null, `select public.cancel_by_ticket($1) as r`, [unpaid.ticket]);
ok("a second cancel changes nothing and says it is already canceled",
  again.rows[0]?.r.ok === false && again.rows[0].r.outcome === "too_late" && again.rows[0].r.now === "void"
  && (await alertsLike(`Ana canceled order #${unpaid.id.slice(0, 4).toUpperCase()}%`)) === 1, again.rows[0]);

const paid = await order({ customer: "Jordan Reyes", paid: true, payment: "sq-pay-396" });
const r2 = await as(null, `select public.cancel_by_ticket($1) as r`, [paid.ticket]);
ok("a card-paid order canceled from its ticket raises the crew's refund alert, with its number and amount",
  r2.rows[0]?.r.ok === true && r2.rows[0].r.paid === true
  && (await q1(`select count(*)::int as n from public.alerts where severity = 'critical' and category = 'money' and title = 'Customer canceled a paid order — refund needed'
       and body like $1`, [`Jordan canceled order #${paid.id.slice(0, 4).toUpperCase()} ($22.00) from its order page. Refund it in Square.`])).n === 1, r2.rows[0]);

// ── the member's rule ──────────────────────────────────────────────────────────────────────────────────────
const making = await order({ status: "preparing" });
const r3 = await as(null, `select public.cancel_by_ticket($1) as r`, [making.ticket]);
ok("too late once it is being made — the status it is in now comes back, and nothing changes",
  r3.rows[0]?.r.ok === false && r3.rows[0].r.outcome === "too_late" && r3.rows[0].r.now === "preparing" && (await statusOf(making.id)) === "preparing", r3.rows[0]);
const window = await order({ paid: true, collected: new Date().toISOString() });
const r4 = await as(null, `select public.cancel_by_ticket($1) as r`, [window.ticket]);
ok("paid at the window is the crew's to cancel, there — refused in those words, nothing changes",
  r4.rows[0]?.r.ok === false && r4.rows[0].r.outcome === "at_window" && (await statusOf(window.id)) === "new", r4.rows[0]);
const sams = await order({ user: SAM, customer: "Sam Lee" });
const r5 = await as(SAM, `select public.cancel_by_ticket($1) as r`, [sams.ticket]);
ok("a member holding their own order's ticket cancels it the same way", r5.rows[0]?.r.ok === true && (await statusOf(sams.id)) === "void", r5);

// ── refusals ───────────────────────────────────────────────────────────────────────────────────────────────
const r6 = await as(null, `select public.cancel_by_ticket('7e1c0000-0000-4000-8000-0000000000ff') as r`);
ok("an unknown ticket is refused in words, as a 4xx (PT404)", r6.code === "PT404" && /That ticket isn't one of ours\./.test(r6.error ?? ""), r6);

// ── the ticket's view ──────────────────────────────────────────────────────────────────────────────────────
const v1 = await as(null, `select public.order_ticket($1) as v`, [window.ticket]);
const v2 = await as(null, `select public.order_ticket($1) as v`, [paid.ticket]);
ok("the ticket's view says whether it was paid at the window — so the page offers Cancel only when it can go through",
  v1.rows[0]?.v.at_window === true && v2.rows[0]?.v.at_window === false && v2.rows[0].v.status === "void", [v1.rows[0]?.v.at_window, v2.rows[0]?.v.at_window]);
const keys = Object.keys(v2.rows[0]?.v ?? {});
ok("the view still carries nobody's account, email, payment id or full name — and no order id",
  !keys.some((k) => /email|user|payment_id|customer|^id$/.test(k)) && !JSON.stringify(v2.rows[0]?.v ?? {}).includes("sq-pay-396") && !JSON.stringify(v2.rows[0]?.v ?? {}).includes("Reyes"), keys);
const grants = await q1(`select has_function_privilege('anon', 'public.cancel_by_ticket(uuid)', 'execute') as a1,
  has_function_privilege('authenticated', 'public.cancel_by_ticket(uuid)', 'execute') as a2`);
ok("cancel_by_ticket is anyone's — the ticket is the key, not the account", grants.a1 && grants.a2, grants);
ok("a signed-out reader still cannot read the orders table", (await as(null, `select count(*)::int as n from public.orders`)).rows[0]?.n === 0);

// ── a second run ───────────────────────────────────────────────────────────────────────────────────────────
await db.exec(SQL396);
ok("a second run changes nothing: one changelog entry, one ledger row",
  (await q1(`select count(*)::int as n from public.changelog where title = 'A guest can cancel from the order page'`)).n === 1
  && (await q1(`select count(*)::int as n from public.schema_migrations where version = '0396_a_guest_cancels_from_the_ticket'`)).n === 1);

console.log(`A GUEST CANCELS FROM THE TICKET (0396): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
