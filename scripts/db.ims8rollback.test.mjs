// 0473's and 0474's PRE-PASTE CHECKS (supabase/checks/ims8_047{3,4}_prepaste.sql), 0473's PRE-PASTE CHECK (supabase/checks/ims8_0473_prepaste.sql) and the research reconciliation
// (supabase/checks/ims8_research_reconciliation.sql) run on a replay; then 0473's ROLLBACK (supabase/cleanup/0473_rollback.sql), replayed: after 0473 and then its rollback, every policy on the
// tables 0473 touches, every function it touches (body, security, grants) and std_research_runs' columns are exactly as
// they were before 0473. What it can't restore is stated in 0473's header (settle keys; comments are left).
import { readFileSync } from "node:fs";
import { fullSchema } from "./fixtures/schema.full.mjs";

const TABLES = ["program_access", "shop_orders", "shop_order_items", "merch_fulfillments", "std_research_runs", "customers"];
const FNS = ["course_students", "course_status", "customers_total", "set_shop_order_status", "std_research_settle", "std_research_settle_server", "vision_shared"];
const shape = async (db) => {
  const q = async (s, p) => (await db.query(s, p)).rows;
  await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);
  return ({
    pol: await q(`select tablename, policyname, cmd, permissive, qual, with_check from pg_policies where schemaname = 'public' and tablename = any($1) order by 1, 2`, [TABLES]),
    fn: await q(`select p.proname, pg_get_function_identity_arguments(p.oid) a, p.prosecdef, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) b,
                 has_function_privilege('anon', p.oid, 'execute') x_anon, has_function_privilege('authenticated', p.oid, 'execute') x_auth, has_function_privilege('service_role', p.oid, 'execute') x_svc
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1) order by 1, 2`, [FNS]),
    cols: await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'std_research_runs' order by 1`),
  });
};
const J = (x) => JSON.stringify(x);
const without = (sh, fn) => J({ ...sh, fn: sh.fn.filter((f) => f.proname !== fn) });
const only = (sh, fn) => J(sh.fn.filter((f) => f.proname === fn));
const PRE3 = readFileSync("supabase/checks/ims8_0473_prepaste.sql", "utf8"), PRE4 = readFileSync("supabase/checks/ims8_0474_prepaste.sql", "utf8");
const s0 = await fullSchema({ before: "0473" });
const S0 = await shape(s0); const pre3at0 = (await s0.query(PRE3)).rows; await s0.close();
const s1 = await fullSchema({ before: "0474" });
const S1 = await shape(s1); const pre3at1 = (await s1.query(PRE3)).rows; const pre4at1 = (await s1.query(PRE4)).rows; await s1.close();
const after = await fullSchema({});
const S2 = await shape(after); const pre4at2 = (await after.query(PRE4)).rows;
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
await after.exec(readFileSync("supabase/cleanup/0474_rollback.sql", "utf8"));
const back1 = await shape(after);
const led4 = (await after.query(`select count(*)::int n from public.schema_migrations where version like '0474%'`)).rows[0].n;
await after.exec(readFileSync("supabase/cleanup/0473_rollback.sql", "utf8"));
const back0 = await shape(after);
const led3 = (await after.query(`select count(*)::int n from public.schema_migrations where version like '0473%'`)).rows[0].n;
// Still closed after the rollback: another business can't move this one's order.
await after.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
  begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('0c476000-0000-4000-8000-0000000000b2', 'x', 'X'); commit;
  insert into auth.users (id, email) values ('0c476000-0000-4000-8000-0000000000a1', 'x@example.test');
  update public.profiles set role = 'owner', tenant_id = '0c476000-0000-4000-8000-0000000000b2' where id = '0c476000-0000-4000-8000-0000000000a1';`);
const so = (await after.query(`insert into public.shop_orders (email, total_cents, status) values ('b@example.test', 100, 'paid') returning id`)).rows[0].id;
await after.exec(`select set_config('request.jwt.claim.sub', '0c476000-0000-4000-8000-0000000000a1', false); set role authenticated;`);
const xMove = await after.query(`select public.set_shop_order_status($1, 'canceled', 'x')`, [so]).then(() => "moved", (e) => e.code ?? "refused");
await after.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
await after.exec(readFileSync("supabase/cleanup/0473_rollback_order_scope.sql", "utf8"));
const scopeBack = await shape(after);
await after.close();
let fail = 0, pass = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got).slice(0, 600)}` : "")); } };
ok("0473 pre-paste check on the state it expects (replay to 0472): every row t", pre3at0.length === 14 && pre3at0.every((r) => r.as_expected === true), pre3at0.filter((r) => !r.as_expected));
ok("…and after 0473 it says not to paste again (some f)", pre3at1.some((r) => r.as_expected === false));
ok("0474 pre-paste check on the state it expects (0473 in, 0474 not): every row t", pre4at1.length >= 5 && pre4at1.every((r) => r.as_expected === true), pre4at1.filter((r) => !r.as_expected));
ok("…and after 0474 it says not to paste again (some f)", pre4at2.some((r) => r.as_expected === false));
ok("reconciliation with nothing yet: no rows", recEmpty.length === 0, recEmpty);
const d = rec[0] ?? {};
ok("reconciliation, a day with one reported run and one unreported: 2 runs, 2 metered calls, 1 unreported", rec.length === 1 && Number(d.runs) === 2 && Number(d.metered_calls) === 2 && Number(d.unreported) === 1, rec);
ok("…the meter above what the reported runs were charged shows (a call the bill under-counted: 67.5 metered vs 7.5)", Number(d.reported_bill_minus_meter_cents) === -60 && d.meter_above_bill === true, d);
ok("…every call on the priced model", d.all_calls_on_the_priced_model === true, d);
ok("0473 and 0474 each change something (the comparisons aren't empty)", J(S0) !== J(S1) && J(S1) !== J(S2));
ok("0474's rollback: policies, functions (body, definer, grants) and columns exactly as with 0473 alone", J(back1) === J(S1));
ok("…and 0474 is off the ledger", led4 === 0);
ok("then 0473's rollback: everything as before 0473 — except set_shop_order_status", without(back0, "set_shop_order_status") === without(S0, "set_shop_order_status"));
ok("…set_shop_order_status keeps 0473's business check (its body is 0473's, not 0417's)", only(back0, "set_shop_order_status") === only(S1, "set_shop_order_status") && only(S1, "set_shop_order_status") !== only(S0, "set_shop_order_status"));
ok("…so, rolled back, another business still can't move our order", xMove !== "moved", xMove);
ok("…and 0473 is off the ledger", led3 === 0);
ok("the separate order-scope file, if ever decided, puts back 0417's body exactly", only(scopeBack, "set_shop_order_status") === only(S0, "set_shop_order_status"));
for (const [a, b, n] of [[S1, back1, "after 0474's rollback"], [JSON.parse(without(S0, "set_shop_order_status")), JSON.parse(without(back0, "set_shop_order_status")), "after 0473's rollback (set_shop_order_status kept on purpose)"]]) if (J(a) !== J(b)) for (const k of Object.keys(a)) if (J(a[k]) !== J(b[k])) console.log(`    ${n} differs: ${k}`);
console.log(`IMS8 0473/0474 PRE-PASTE CHECKS, RECONCILIATION AND ROLLBACKS (replayed): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
