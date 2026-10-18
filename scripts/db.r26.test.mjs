// R26 — THE DAY IS THE BUSINESS'S, AND MONEY IS NEVER BELOW ZERO (0431), IN POSTGRES (2026-10-18 — the 10/10 audit,
// database F4's last and F2's last; Ryan: "Keep working to improve to a 10").
//
// The whole schema to 0430 is loaded, the business day pinned to a date the database's clock is not on (so a definition
// still reading current_date shows), one event's takings written below zero (so a check that its own rows would break is
// seen to wait), then 0431 — twice. Each function made again is its old definition with current_date read as the business
// day and not one character else; each view keeps its options, its grants and its comment, and counts on the business day;
// the eight defaults date a new row on it. Sixteen money checks stand, proven against the rows; the takings' waits, named
// in the crew's inbox — and stands once its row is put right and 0431 is pasted again. Every row is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M431 = readFileSync(join(ROOT, "supabase/migrations/0431_the_day_is_the_businesss_and_money_is_never_below_zero.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const t0 = Date.now();
const db = await fullSchema({ before: "0431" });
console.log(`the schema to 0430 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];

const FUNCS = ["map_ingredient", "progress_kpis", "receive_lot", "set_market_live", "supersede_agreement"];
const VIEWS = ["v_compliance_freshness", "v_crew_person", "v_receipt_gaps"];
const DEFAULTS = ["agreement_hours.on_date", "asset_maintenance.performed_on", "changelog.shipped_on", "check_ins.day", "expenses.spent_on",
  "inventory_lots.received_on", "maintenance_log.ran_on", "meeting_notes.met_on"];
const fdef = async (name) => (await q1(`select pg_get_functiondef(p.oid) as d, p.proacl::text as acl, obj_description(p.oid, 'pg_proc') as c
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1`, [name]));
const vdef = async (name) => (await q1(`select pg_get_viewdef(c.oid) as d, c.reloptions::text as o, c.relacl::text as acl, obj_description(c.oid, 'pg_class') as cm
  from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname = $1`, [name]));

const before = {};
for (const f of FUNCS) before[f] = await fdef(f);
for (const v of VIEWS) before[v] = await vdef(v);
ok("before: the five functions and three views read current_date — the database's day", FUNCS.every((f) => /current_date/i.test(before[f].d)) && VIEWS.every((v) => /current_date/i.test(before[v].d)));

// The business day pinned to a date the database's clock is not on: whatever reads current_date reads another day.
const PINNED = "2001-02-03";
await db.exec(`create or replace function public.business_day() returns date language sql stable set search_path = public as $$ select date '${PINNED}' $$;`);
// One event's takings below zero, written before the check could refuse it.
await db.exec(`insert into public.event_sales (event_id, source, amount_cents) values (null, 'manual', -500)`);

await db.exec(M431);
await db.exec(M431);

// ── 1) the business day ─────────────────────────────────────────────────────────────────────────────────────────────
// The body is kept as written, so it says public.business_day(); a default in the header is printed as Postgres reads it
// back (business_day(), its schema on the path) — the same call. Compared with that one difference set aside.
const same = (s) => s.replace(/\bpublic\.business_day\(\)/g, "business_day()");
for (const f of FUNCS) {
  const after = await fdef(f);
  ok(`${f}: made again as it was, current_date read as the business day — not one character else; its grants and comment kept`,
    same(after.d) === same(before[f].d.replace(/\bcurrent_date\b/gi, "public.business_day()")) && after.acl === before[f].acl && after.c === before[f].c && !/current_date/i.test(after.d),
    { after: after.d.slice(0, 160) });
}
for (const v of VIEWS) {
  const after = await vdef(v);
  ok(`${v}: counts on the business day, its options, grants and comment kept`,
    !/current_date/i.test(after.d) && /business_day\(\)/.test(after.d) && after.o === before[v].o && after.acl === before[v].acl && after.cm === before[v].cm,
    { o: [before[v].o, after.o], acl: after.acl === before[v].acl });
}
ok("the views that ran as their caller still do (security_invoker kept — a view made again without it loses it)",
  (await q(`select relname from pg_class where relname = any($1) and reloptions::text like '%security_invoker=on%'`, [VIEWS])).length === 2);
const defs = await q(`select table_name || '.' || column_name as c, column_default as d from information_schema.columns where table_schema = 'public' and column_default ~* '(current_date|business_day)'`);
ok("the eight defaults date a new row on the business day — and none is left on current_date",
  DEFAULTS.every((c) => defs.some((d) => d.c === c && /business_day\(\)/.test(d.d))) && !defs.some((d) => /current_date/i.test(d.d)), defs);
// Behaviour, with the day pinned: a check-in and an expense made now are dated the business day.
await db.exec(`insert into public.changelog (title, category, area, summary) values ('made-up line', 'fix', 'System', 'made-up')`);
ok("a changelog line written now is dated the business day", (await q1(`select shipped_on::text as d from public.changelog where title = 'made-up line'`)).d === PINNED);
const kpi = await q1(`select public.progress_kpis() as k`);
ok("progress_kpis runs, reading the business day", kpi && kpi.k !== null);

// ── 2) money is never below zero ────────────────────────────────────────────────────────────────────────────────────
const checks = await q(`select conrelid::regclass::text as t, conname, convalidated from pg_constraint where conname like '%\\_not\\_negative'`);
ok("sixteen money checks stand, each proven against every row (validated) — added once, though pasted twice",
  checks.length === 16 && checks.every((c) => c.convalidated) && new Set(checks.map((c) => c.conname)).size === 16, checks.map((c) => c.conname));
ok("…and the takings' waits: a row of its own is below zero, so a check its rows would break does not stand",
  !checks.some((c) => c.conname === "event_sales_amount_cents_not_negative"));
const alert = await q1(`select title, body, severity, category from public.alerts where kind = 'money_below_zero' and ack_at is null`);
ok("…named in the crew's inbox, once (a second paste is the same line): which column, how many rows",
  alert && /event_sales\.amount_cents \(1 row\)/.test(alert.body) && alert.category === "money" && (await q(`select count(*)::int as n from public.alerts where kind = 'money_below_zero'`))[0].n === 1, alert);
let refused = null;
try { await db.exec(`insert into public.shop_order_items (order_id, title, qty, unit_cents) values (gen_random_uuid(), 'made-up tee', 1, -1)`); } catch (e) { refused = String(e.message); }
ok("a shop line priced below zero is refused by its check", /shop_order_items_unit_cents_not_negative/.test(refused || ""), refused);
// Put right, pasted again: the takings' check stands.
await db.exec(`update public.event_sales set amount_cents = 500 where amount_cents < 0`);
await db.exec(M431);
const later = await q(`select conname, convalidated from pg_constraint where conname = 'event_sales_amount_cents_not_negative'`);
ok("its row put right and 0431 pasted again, the takings' check stands too — seventeen", later.length === 1 && later[0].convalidated
  && (await q(`select count(*)::int as n from pg_constraint where conname like '%\\_not\\_negative'`))[0].n === 17, later);
let takings = null;
try { await db.exec(`insert into public.event_sales (event_id, source, amount_cents) values (null, 'manual', -1)`); } catch (e) { takings = String(e.message); }
ok("…and takings below zero are refused from then on", /event_sales_amount_cents_not_negative/.test(takings || ""), takings);

await db.close();
console.log(`\nR26 — THE DAY IS THE BUSINESS'S, AND MONEY IS NEVER BELOW ZERO (0431): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
