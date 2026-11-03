// 0473's PRE-PASTE CHECK (supabase/checks/ims8_0473_prepaste.sql) and the research reconciliation
// (supabase/checks/ims8_research_reconciliation.sql) run on a replay; then 0473's ROLLBACK (supabase/cleanup/0473_rollback.sql), replayed: after 0473 and then its rollback, every policy on the
// tables 0473 touches, every function it touches (body, security, grants) and std_research_runs' columns are exactly as
// they were before 0473. What it can't restore is stated in 0473's header (settle keys; comments are left).
import { readFileSync } from "node:fs";
import { fullSchema } from "./fixtures/schema.full.mjs";

const TABLES = ["program_access", "shop_orders", "shop_order_items", "merch_fulfillments", "std_research_runs"];
const FNS = ["course_students", "course_status", "set_shop_order_status", "std_research_settle", "std_research_settle_server", "vision_shared"];
const shape = async (db) => {
  const q = async (s, p) => (await db.query(s, p)).rows;
  await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);
  return JSON.stringify({
    pol: await q(`select tablename, policyname, cmd, permissive, qual, with_check from pg_policies where schemaname = 'public' and tablename = any($1) order by 1, 2`, [TABLES]),
    fn: await q(`select p.proname, pg_get_function_identity_arguments(p.oid) a, p.prosecdef, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) b,
                 has_function_privilege('anon', p.oid, 'execute') x_anon, has_function_privilege('authenticated', p.oid, 'execute') x_auth, has_function_privilege('service_role', p.oid, 'execute') x_svc
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1) order by 1, 2`, [FNS]),
    cols: await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'std_research_runs' order by 1`),
  });
};
const before = await fullSchema({ before: "0473" });
const want = await shape(before);
const PRE = readFileSync("supabase/checks/ims8_0473_prepaste.sql", "utf8");
const preBefore = (await before.query(PRE)).rows;
await before.close();
const after = await fullSchema({});
const applied = await shape(after);
const preAfter = (await after.query(PRE)).rows;
const REC = readFileSync("supabase/checks/ims8_research_reconciliation.sql", "utf8");
const recEmpty = (await after.query(REC)).rows;
await after.exec(`insert into public.std_intakes (kind, input, request_hash) values ('describe', 'a bench', repeat('b', 64));
  insert into public.std_research_runs (intake_id, depth, reserved_cents, charged_cents, outcome, input_tokens, output_tokens, searches, settled_at, started_at, deadline_at)
    select id, 'light', 50, 7.5, 'done', 1000, 100, 1, now(), now(), now() from public.std_intakes limit 1;
  insert into public.std_research_runs (intake_id, depth, reserved_cents, charged_cents, outcome, settled_at, started_at, deadline_at)
    select id, 'light', 50, 50, 'unreported', now(), now(), now() from public.std_intakes limit 1;
  insert into public.ai_usage (agent, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, searches, fetches, cost_cents)
    values ('library-intake', 'claude-sonnet-4-6', 1000, 100, 0, 0, 1, 0, 7.5), ('library-intake', 'claude-sonnet-4-6', 4000, 900, 0, 0, 2, 0, 60);`).catch((e) => console.log("  (fixture) " + e.message));
const rec = (await after.query(REC)).rows;
await after.exec(readFileSync("supabase/cleanup/0473_rollback.sql", "utf8"));
const back = await shape(after);
const ledger = (await after.query(`select count(*)::int n from public.schema_migrations where version like '0473%'`)).rows[0].n;
await after.close();
let fail = 0, pass = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got).slice(0, 600)}` : "")); } };
ok("pre-paste check on the state 0473 expects (replay to 0472): every row t", preBefore.length === 13 && preBefore.every((r) => r.as_expected === true), preBefore.filter((r) => !r.as_expected));
ok("…and after 0473 it says not to paste again (some f)", preAfter.some((r) => r.as_expected === false));
ok("reconciliation with nothing yet: no rows", recEmpty.length === 0, recEmpty);
const d = rec[0] ?? {};
ok("reconciliation, a day with one reported run and one unreported: 2 runs, 2 metered calls, 1 unreported", rec.length === 1 && Number(d.runs) === 2 && Number(d.metered_calls) === 2 && Number(d.unreported) === 1, rec);
ok("…the meter above what the reported runs were charged shows (a call the bill under-counted: 67.5 metered vs 7.5)", Number(d.reported_bill_minus_meter_cents) === -60 && d.meter_above_bill === true, d);
ok("…every call on the priced model", d.all_calls_on_the_priced_model === true, d);
ok("0473 changes something (the comparison isn't empty)", applied !== want);
ok("after the rollback: policies, functions (body, definer, grants) and columns exactly as before 0473", back === want);
ok("…and 0473 is off the ledger", ledger === 0);
if (back !== want) { const a = JSON.parse(want), b = JSON.parse(back); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(`    differs: ${k}`); }
console.log(`IMS8 0473 PRE-PASTE CHECK, RECONCILIATION AND ROLLBACK (replayed): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
