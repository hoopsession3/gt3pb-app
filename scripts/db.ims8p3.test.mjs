// IMS8 P3 — AN ASK SAYS WHETHER IT'S SET (0471, in Postgres). An ask's amount has three states: NULL (not set yet), 0
// (confirmed: no capital needed), > 0 (the amount). Existing $0 rows become NULL only where the intent is proven — no
// person ever saved the row (the system's own seed, 0447). Where a person saved a $0 row, or a row has no history, the
// migration stops, changing nothing, and the mapping file lists them. A second run changes nothing. Totals don't move.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = readFileSync(join(ROOT, "supabase/migrations/0471_an_ask_says_whether_it_is_set.sql"), "utf8");
const MAP = readFileSync(join(ROOT, "supabase/cleanup/0471_ask_mapping.sql"), "utf8");
const V = loadTs("lib/vision.ts"), R = loadTs("lib/visionRead.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", OWNER = "0c46c000-0000-4000-8000-0000000000a1";

async function world() {
  const db = await fullSchema({ before: "0471" });
  const q = async (s, p) => (await db.query(s, p)).rows;
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
  await q(`insert into auth.users (id, email) values ($1, 'owner@example.test')`, [OWNER]);
  await q(`update public.profiles set role = 'owner', tenant_id = $2 where id = $1`, [OWNER, T1]);
  const as = async (sql, p) => { await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER}', false); set role authenticated;`); try { return (await db.query(sql, p)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); } };
  return { db, q, q1: async (s, p) => (await q(s, p))[0], as };
}
const nullable = async (q1) => (await q1(`select is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'vision_asks' and column_name = 'amount_cents'`));
const sumOf = async (q1) => Number((await q1(`select coalesce(sum(amount_cents), 0)::bigint s from public.vision_asks`)).s);

// ── The seeded world (production's shape): the system's $0 asks, never edited ───────────────────────────────────────
{
  const { db, q, q1, as } = await world();
  const seeded = await q(`select a.id, a.amount_cents, (select count(*)::int from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text) lines,
                                 (select count(*)::int from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text and l.actor is not null) by_people
                            from public.vision_asks a`);
  ok("before 0471: the seed's asks are all $0, each with its activity line, none written by a person", seeded.length >= 3 && seeded.every((r) => r.amount_cents === 0 && r.lines >= 1 && r.by_people === 0), seeded);
  ok("…and the column can't say 'not set' (NOT NULL, default 0)", (await nullable(q1)).is_nullable === "NO");
  // A person's own priced ask: untouched by 0471.
  const prog = (await q1(`select id from public.vision_programs limit 1`)).id;
  const priced = (await as(`insert into public.vision_asks (program_id, label, amount_cents) values ($1, 'Priced by a person', 250000) returning id`, [prog]))[0].id;
  const before = await sumOf(q1);
  await db.exec(M);
  const after = await q(`select id, amount_cents from public.vision_asks`);
  const col = await nullable(q1);
  ok("0471: the column is nullable, default NULL", col.is_nullable === "YES" && (col.column_default == null || /null/i.test(col.column_default)), col);
  ok("…the proven seed rows now say 'not set' (NULL)", seeded.every((s) => after.find((a) => a.id === s.id).amount_cents === null), after);
  ok("…a person's priced ask is unchanged", after.find((a) => a.id === priced).amount_cents === 250000);
  ok("…the totals are the same before and after", (await sumOf(q1)) === before, { before, after: await sumOf(q1) });
  ok("…recorded in the ledger", !!(await q1(`select 1 x from public.schema_migrations where version = '0471_an_ask_says_whether_it_is_set'`)));
  // A confirmed $0 saved after 0471, a new ask with no amount, then a second run.
  const zero = (await as(`insert into public.vision_asks (program_id, label, amount_cents) values ($1, 'No capital needed here', 0) returning id`, [prog]))[0].id;
  const unset = (await as(`insert into public.vision_asks (program_id, label) values ($1, 'Not priced yet') returning id, amount_cents`, [prog]))[0];
  ok("after 0471: a new ask with no amount is NULL (not set); a saved 0 stays 0 (confirmed)", unset.amount_cents === null && (await q1(`select amount_cents from public.vision_asks where id = $1`, [zero])).amount_cents === 0);
  const snap = JSON.stringify(await q(`select id, amount_cents from public.vision_asks order by id`));
  await db.exec(M);
  ok("a second run changes nothing — a confirmed $0 is never turned into 'not set'", JSON.stringify(await q(`select id, amount_cents from public.vision_asks order by id`)) === snap);
  // What the screens make of the three states, read the way the app reads them.
  const rows = (await q(`select program_id, label, amount_cents, state, note, sort from public.vision_asks`)).map(R.toAsk);
  const t = V.askTotals(rows);
  ok("the app reads NULL as not set, 0 as none needed, > 0 as money", t.unset === seeded.length + 1 && t.none === 1 && t.total === 250000, t);
  ok("…in words", V.askAmountWords(null) === "Amount to be set" && V.askAmountWords(0) === "No capital needed" && V.askAmountWords(250000) === "$2,500");
  ok("…and the roadmap form: empty → not set, '0' → confirmed $0, '$1,200' → 120000, words refused; and back", V.askAmountOf("") === null && V.askAmountOf("  ") === null && V.askAmountOf("0") === 0 && V.askAmountOf("$1,200") === 120000
    && V.askAmountOf("abc") === undefined && V.askAmountOf("-5") === undefined && V.askAmountDraft(null) === "" && V.askAmountDraft(0) === "0" && V.askAmountDraft(120000) === "1200");
  // An investor link sends the state as it is: NULL as null, 0 as 0.
  const plan = (await q1(`select id, program_id from public.vision_plans where program_id = $1 limit 1`, [prog])) ?? (await q1(`select id, program_id from public.vision_plans limit 1`));
  await q(`update public.vision_plans set shareable = true where id = $1`, [plan.id]);
  const link = (await as(`insert into public.vision_shares (label, program_ids, plan_ids, show_asks) values ('Asks', $1, $2, true) returning token`, [[plan.program_id], [plan.id]]))[0];
  await db.exec(`set role anon;`);
  const v = (await db.query(`select public.vision_shared($1) v`, [link.token])).rows[0].v; await db.exec(`reset role;`);
  const sent = (v.asks ?? []).map((a) => a.amount_cents);
  ok("an investor link sends NULL as null and $0 as 0 (no state lost on the way)", sent.length > 0 && sent.every((c) => c === null || typeof c === "number") && sent.includes(null), sent);
  await db.close();
}

// ── A person saved a $0 ask: the intent isn't proven, so 0471 stops and changes nothing ────────────────────────────
{
  const { db, q, q1, as } = await world();
  const one = (await q1(`select id from public.vision_asks order by sort limit 1`)).id;
  await as(`update public.vision_asks set note = 'Edited by a person' where id = $1`, [one]);
  const orphan = (await q1(`select id from public.vision_asks where id <> $1 order by sort limit 1`, [one])).id;
  await q(`delete from public.admin_audit where table_name = 'vision_asks' and row_pk = $1`, [orphan]);   // a row with no history
  const snap = JSON.stringify(await q(`select id, amount_cents from public.vision_asks order by id`));
  let err = null;
  try { await db.exec(M); } catch (e) { err = e; }
  ok("0471 stops when a person saved a $0 ask (or one has no history): it says how many, and what to run", err && /0471 stopped, nothing changed: 2 ask\(s\)/.test(err.message) && /0471_ask_mapping\.sql/.test(err.message), err?.message);
  await db.exec(`rollback;`).catch(() => {});
  ok("…nothing changed: the column is still NOT NULL, every amount as it was", (await nullable(q1)).is_nullable === "NO" && JSON.stringify(await q(`select id, amount_cents from public.vision_asks order by id`)) === snap);
  // STEP 1 of the mapping file lists exactly those two, read-only.
  const step1 = MAP.slice(MAP.indexOf("-- STEP 1"), MAP.indexOf("-- STEP 2")).split("\n").filter((l) => !l.startsWith("--")).join("\n");
  const listed = (await q(step1)).map((r) => r.id).sort();
  ok("the mapping file's STEP 1 lists exactly the asks whose intent isn't proven", JSON.stringify(listed) === JSON.stringify([one, orphan].sort()), listed);
  ok("…STEP 2 is commented out — nothing runs without the owner's own list", MAP.slice(MAP.indexOf("-- STEP 2")).split("\n").filter((l) => l.trim()).every((l) => l.startsWith("--")));
  await db.close();
}

console.log(`IMS8 P3 — AN ASK SAYS WHETHER IT'S SET (0471, in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
