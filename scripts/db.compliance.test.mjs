// CHECKED WITH WHOM, AND WHEN — 0342, executed from its file against a real Postgres.
//
// The rules are built the way production built them: 0027's table and seed, the tenant column 0040
// adds to every business table, 0053's verified flag, 0284's dates and its freshness view — all run
// VERBATIM — and then 0342. alert_open_once is the real one, cut from the newest migration that
// defines it, because "the owners are told" is a claim about that function's behaviour, not mine.
//
// What is worth a database here:
//   1. A re-check that says "still true" takes a rule off the list (the freshness view is what
//      v_obligations reads), and one that says "it has changed" does NOT rewrite it — the words a
//      permit rule carries only ever come from someone who names where they got them.
//   2. "Where you checked" is required, everywhere, by the database — the sheet's own guard is a
//      courtesy, and lib/complianceCheck's mirror of it is compiled and held to the functions here.
//   3. The check log is append-only from the app: no grant and no policy lets a client write it.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGS = join(ROOT, "supabase/migrations");
const T = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const S1 = "00000000-0000-0000-0000-0000000000a1";   // an operator who called the county
const AD = "00000000-0000-0000-0000-0000000000ad";   // an owner
const M = "00000000-0000-0000-0000-0000000000b1";    // a member
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
const rows = async (s, p) => (await db.query(s, p)).rows;
const raises = async (s, p) => { try { await db.query(s, p); return null; } catch (e) { return String(e.message || e); } };
const as = async (uid, { staff = false, admin = false, tenant = T } = {}) => db.exec(`
  select set_config('test.uid', '${uid}', false), set_config('test.staff', '${staff ? "on" : "off"}', false),
         set_config('test.admin', '${admin ? "on" : "off"}', false), set_config('test.tenant', '${tenant}', false);`);
const file = (n) => readFileSync(join(MIGS, n), "utf8");

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${S1}'), ('${AD}'), ('${M}');
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.uid', true), ''), '')::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true), 'off') = 'on' $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$
    select coalesce(current_setting('test.admin', true), 'off') = 'on' $$;
  create or replace function public.current_tenant() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.tenant', true), ''), '')::uuid $$;
  -- 0134, verbatim
  create or replace function public.effective_tenant()
  returns uuid language sql stable security definer set search_path = public as $$
    select coalesce(public.current_tenant(), '${T}'::uuid);
  $$;
  create or replace function public.stamp_tenant()
  returns trigger language plpgsql security definer set search_path = public as $$
  begin
    new.tenant_id := coalesce(public.current_tenant(), new.tenant_id, '${T}'::uuid);
    return new;
  end $$;

  create table public.tenants (id uuid primary key);
  insert into public.tenants (id) values ('${T}'), ('${T2}');
  create table public.profiles (id uuid primary key references auth.users(id), display_name text);
  insert into public.profiles (id, display_name) values ('${S1}', 'Dana'), ('${AD}', 'Ryan');
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid,
    applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;
  create table public.alerts (id uuid primary key default gen_random_uuid(),
    severity text not null default 'important', category text, kind text, subject_id uuid,
    title text not null, body text, link text default '/admin', last_seen_at timestamptz,
    ack_at timestamptz, created_at timestamptz not null default now());
`);

// alert_open_once, the real one: the newest migration that defines it, cut out by its own delimiters.
{
  const defining = readdirSync(MIGS).filter((n) => n.endsWith(".sql")).sort()
    .filter((n) => file(n).includes("create or replace function public.alert_open_once("));
  const src = file(defining[defining.length - 1]);
  const at = src.indexOf("create or replace function public.alert_open_once(");
  const end = src.indexOf("end $$;", at) + "end $$;".length;
  await db.exec(src.slice(at, end));
  ok("alert_open_once was cut from its newest definition", defining.length >= 1 && end > at, defining);
}

await db.exec(file("0027_compliance_rules.sql"));
// 0040 adds tenant_id to every business table by a loop that cannot run alone; its effect on this one:
await db.exec(`alter table public.compliance_rules add column if not exists tenant_id uuid references public.tenants(id) default '${T}';
               update public.compliance_rules set tenant_id = '${T}' where tenant_id is null;`);
await db.exec(file("0053_compliance_proposed.sql"));
await db.exec(file("0284_compliance_freshness.sql"));
const MIG = file("0342_checked_with_whom_and_when.sql");
await db.exec(MIG);
console.log("0027 + 0053 + 0284 + 0342 executed against a real Postgres.\n");

const today = (await q1(`select ((now() at time zone 'America/New_York')::date)::text d`)).d;
const ruleId = async (like) => (await q1(`select id from public.compliance_rules where label like $1`, [like])).id;
const rule = (id) => q1(`select label, link, authority, lead_days, lead_basis, verified, verified_on::text, verified_by::text, check_note, active
  from public.compliance_rules where id = $1`, [id]);
const fresh = async (id) => (await q1(`select freshness from public.v_compliance_freshness where id = $1`, [id]))?.freshness ?? null;
const recheck = (id, outcome, against, note = null) => q1(`select public.recheck_compliance_rule($1, $2, $3, $4) r`, [id, outcome, against, note]).then((x) => x.r);
const correct = (id, f) => q1(`select public.correct_compliance_rule($1, $2, $3, $4, $5, $6, $7, $8) r`,
  [id, f.label, f.link ?? null, f.authority ?? null, f.days ?? null, f.basis ?? null, f.against, f.note ?? null]).then((x) => x.r);

// ── 1 · THE SHAPE ──────────────────────────────────────────────────────────────────────────────
ok("compliance_rules says who last confirmed it", !!(await q1(`select 1 x from information_schema.columns where table_name = 'compliance_rules' and column_name = 'verified_by'`)));
const pol = (await rows(`select polname from pg_policy where polrelid = 'public.compliance_checks'::regclass order by 1`)).map((x) => x.polname);
ok("the check log: staff read it, the tenant fences it, and nothing lets a client write it", pol.join() === "compliance_checks_read,tenant isolation", pol);
{
  const g = await q1(`select has_table_privilege('authenticated', 'public.compliance_checks', 'insert') i,
    has_table_privilege('authenticated', 'public.compliance_checks', 'update') u, has_table_privilege('authenticated', 'public.compliance_checks', 'delete') d,
    has_table_privilege('authenticated', 'public.compliance_checks', 'select') s, has_table_privilege('anon', 'public.compliance_checks', 'select') a`);
  ok("…select for authenticated, nothing else, and nothing for anon", g.s && !g.i && !g.u && !g.d && !g.a, g);
}

// ── 2 · STILL TRUE ─────────────────────────────────────────────────────────────────────────────
const undated = await ruleId("Permit + inspection report displayed on site%");
ok("a seeded rule nobody ever dated is on the list before anyone checks it", (await fresh(undated)) === "no date — nobody recorded when this was confirmed", await fresh(undated));
await as(S1, { staff: true });
ok("an operator who checked it: confirmed", (await recheck(undated, "confirmed", "Greenville County health inspector, by phone")) === "confirmed");
let r = await rule(undated);
ok("…dated today, in Eastern time, and says who", r.verified === true && r.verified_on === today && r.verified_by === S1, r);
ok("…the note says when, who and against what — in words", r.check_note.startsWith("Re-checked ") && /by Dana against Greenville County health inspector, by phone\.$/.test(r.check_note), r.check_note);
ok("…and it leaves the list: the freshness v_obligations reads is 'fresh'", (await fresh(undated)) === "fresh", await fresh(undated));
ok("…with its words untouched", r.label === "Permit + inspection report displayed on site", r.label);
const log1 = await q1(`select outcome, checked_on::text d, checked_by::text by, checked_against, before from public.compliance_checks where rule_id = $1`, [undated]);
ok("the check is kept: when, who, against what, and the rule as it stood before",
  log1.outcome === "confirmed" && log1.d === today && log1.by === S1 && log1.before.verified_on === null && log1.before.label === "Permit + inspection report displayed on site", log1);

// ── 3 · IT HAS CHANGED ─────────────────────────────────────────────────────────────────────────
const sc = await ruleId("Event authorization for a temporary/mobile setup%");
const scBefore = await rule(sc);
ok("the SC event rule is on the list as unconfirmed (0284's honest state)", (await fresh(sc)) === "UNVERIFIED — do not rely on it without asking the authority");
ok("'changed' with no word of what changed is refused", /say what has changed/.test(await raises(`select public.recheck_compliance_rule($1, 'changed', 'SCDA, 803-896-0640', null)`, [sc]) ?? ""));
ok("someone told us: changed", (await recheck(sc, "changed", "SCDA, 803-896-0640", "Form 1717 is retired; apply in the SCDA portal 10 business days ahead")) === "changed");
r = await rule(sc);
ok("…the rule's words are NOT rewritten — nobody writes a permit requirement by summary", r.label === scBefore.label && r.lead_days === scBefore.lead_days && r.link === scBefore.link, r);
ok("…it is marked not confirmed, with what was heard, from whom, and by whom",
  r.verified === false && /^CHANGED, per SCDA, 803-896-0640 on .* \(Dana\): Form 1717 is retired; apply in the SCDA portal 10 business days ahead — not to be relied on until an admin corrects the rule\.$/.test(r.check_note), r.check_note);
const al = await rows(`select severity, category, title, body, link, subject_id::text s from public.alerts where kind = 'compliance_changed'`);
ok("…and the owners are told, about this rule", al.length === 1 && al[0].s === sc && al[0].category === "prep" && /^A permit rule has changed — /.test(al[0].title) && /Dana checked it against SCDA/.test(al[0].body), al);
await recheck(sc, "changed", "SCDA, second call", "Confirmed again: SCDA portal, 10 business days");
ok("a second report about the same rule refreshes the one alert — it does not stack", Number((await q1(`select count(*) n from public.alerts where kind = 'compliance_changed' and ack_at is null`)).n) === 1
  && /second call/.test((await q1(`select body from public.alerts where kind = 'compliance_changed'`)).body));

// ── 4 · REFUSED, AND SAID WHY ──────────────────────────────────────────────────────────────────
ok("no source, no check — the thing 0284 removed", /say where you checked it/.test(await raises(`select public.recheck_compliance_rule($1, 'confirmed', '  ', null)`, [undated]) ?? ""));
ok("a third answer is refused", /confirmed or changed/.test(await raises(`select public.recheck_compliance_rule($1, 'probably', 'the county', null)`, [undated]) ?? ""));
await db.exec(`insert into public.compliance_rules (state, label, kind, active, verified, source) values ('TN', 'Agent-proposed: TN temp permit', 'permit', false, false, 'agent-research')`);
const proposal = await ruleId("Agent-proposed: TN temp permit");
ok("an agent's proposal cannot be re-checked onto the checklist — an admin approves it first", /not on the checklist/.test(await raises(`select public.recheck_compliance_rule($1, 'confirmed', 'the county', null)`, [proposal]) ?? ""));
await as(M);
ok("a member cannot record a check", /not authorized/.test(await raises(`select public.recheck_compliance_rule($1, 'confirmed', 'the county', null)`, [undated]) ?? ""));
await as(S1, { staff: true, tenant: T2 });
ok("another tenant's staff cannot reach this tenant's rule", /does not exist/.test(await raises(`select public.recheck_compliance_rule($1, 'confirmed', 'the county', null)`, [undated]) ?? ""));
await as(S1, { staff: true });

// ── 5 · CORRECTED, BY SOMEONE WHO MAY ──────────────────────────────────────────────────────────
const fix = { label: "Event authorization — apply in the SCDA portal >= 10 BUSINESS days out", link: "https://retailfoodregistration.agriculture.sc.gov/registration",
  authority: "South Carolina Department of Agriculture", days: 10, basis: "business", against: "SCDA, 803-896-0640", note: "Form 1717 retired" };
ok("an operator cannot rewrite a rule — 0027's write rule is an owner's or admin's", /owner or admin/.test(await raises(`select public.correct_compliance_rule($1, $2, $3, $4, $5, $6, $7, $8)`,
  [sc, fix.label, fix.link, fix.authority, fix.days, fix.basis, fix.against, fix.note]) ?? ""));
await as(AD, { staff: true, admin: true });
const refusedFix = async (over) => raises(`select public.correct_compliance_rule($1, $2, $3, $4, $5, $6, $7, $8)`,
  [sc, over.label ?? fix.label, fix.link, fix.authority, "days" in over ? over.days : fix.days, "basis" in over ? over.basis : fix.basis, over.against ?? fix.against, fix.note]);
ok("a deadline with no basis is refused", /business or calendar/.test(await refusedFix({ basis: null }) ?? ""));
ok("a basis with no number is refused", /business or calendar/.test(await refusedFix({ days: null }) ?? ""));
ok("a basis that is neither is refused", /business or calendar/.test(await refusedFix({ basis: "weekdays" }) ?? ""));
ok("a negative deadline is refused", /negative/.test(await refusedFix({ days: -3 }) ?? ""));
ok("a rule with no words is refused", /needs its words/.test(await refusedFix({ label: "  " }) ?? ""));
ok("a correction with no source is refused", /say where you checked it/.test(await refusedFix({ against: "x" }) ?? ""));
ok("an owner corrects it from what SCDA said", (await correct(sc, fix)) === "corrected");
r = await rule(sc);
ok("…the words, link, authority and deadline are what the authority said",
  r.label === fix.label && r.link === fix.link && r.authority === fix.authority && r.lead_days === 10 && r.lead_basis === "business", r);
ok("…confirmed, dated today, by the owner", r.verified === true && r.verified_on === today && r.verified_by === AD, r);
ok("…off the list", (await fresh(sc)) === "fresh", await fresh(sc));
ok("…the report that asked for it is answered", Number((await q1(`select count(*) n from public.alerts where kind = 'compliance_changed' and ack_at is null`)).n) === 0);
const fixed = await q1(`select outcome, before from public.compliance_checks where rule_id = $1 and outcome = 'corrected'`, [sc]);
ok("…and what it said before is kept in the check", fixed.before.label === scBefore.label && fixed.before.lead_days === 14 && fixed.before.lead_basis === "calendar", fixed);
ok("three checks on that rule, oldest first: changed, changed, corrected",
  (await rows(`select outcome from public.compliance_checks where rule_id = $1 order by created_at, id`, [sc])).map((x) => x.outcome).join() === "changed,changed,corrected");
ok("clearing a deadline altogether is allowed — a rule with no deadline is a real thing",
  (await correct(sc, { ...fix, days: null, basis: null })) === "corrected" && (await rule(sc)).lead_days === null);

// ── 6 · THE APP'S MIRROR OF THE REFUSALS ───────────────────────────────────────────────────────
const ts = (await import("typescript")).default;
const mod = { exports: {} };
new Function("module", "exports", "require",
  ts.transpileModule(readFileSync(join(ROOT, "lib/complianceCheck.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
)(mod, mod.exports, () => ({}));
const K = mod.exports;
ok("known pair: lib/complianceCheck compiled", typeof K.recheckProblem === "function" && typeof K.correctionProblem === "function");
{
  const cases = [["confirmed", "the county", null], ["confirmed", " ab ", null], ["confirmed", "", null], ["changed", "the county", null],
    ["changed", "the county", "ab"], ["changed", "the county", "new form"], ["changed", "  ", "new form"], ["confirmed", "abc", "  "]];
  const off = [];
  await as(S1, { staff: true });
  for (const [o, a, n] of cases) {
    const dbSays = await raises(`select public.recheck_compliance_rule($1, $2, $3, $4)`, [undated, o, a, n]);
    if ((dbSays === null) !== (K.recheckProblem(o, a, n) === null)) off.push({ o, a, n, db: dbSays, app: K.recheckProblem(o, a, n) });
  }
  ok("known pair: the sheet refuses a re-check exactly when the database would", off.length === 0, off);
}
{
  await as(AD, { staff: true, admin: true });
  const cases = [{}, { days: null }, { basis: null }, { days: null, basis: null }, { label: "abcd" }, { label: "abcde" }, { against: "ab" }, { days: 0 }];
  const off = [];
  for (const over of cases) {
    const c = { ...fix, ...over };
    const dbSays = await raises(`select public.correct_compliance_rule($1, $2, $3, $4, $5, $6, $7, $8)`, [sc, c.label, c.link, c.authority, c.days, c.basis, c.against, c.note]);
    const app = K.correctionProblem({ label: c.label, link: c.link, authority: c.authority, leadDays: c.days, leadBasis: c.basis, checkedAgainst: c.against, note: c.note });
    if ((dbSays === null) !== (app === null)) off.push({ over, db: dbSays, app });
  }
  ok("known pair: the correction form refuses exactly when the database would", off.length === 0, off);
  ok("known pair: the two ways a deadline counts are the table's", JSON.stringify(K.LEAD_BASES) === JSON.stringify(["business", "calendar"])
    && JSON.stringify(K.CHECK_OUTCOMES) === JSON.stringify(["confirmed", "changed", "corrected"]));
  ok("known pair: a deadline is said in its own unit", K.deadlineWords(30, "business") === "30 business days before" && K.deadlineWords(1, "calendar") === "1 calendar day before" && K.deadlineWords(null, null) === null);
}

// The day a check is dated is the ET business day the rest of the app keys on (lib/dates etToday).
// A clock cannot be moved inside this database, so the rule is read from what the database holds:
// at 9 PM in Greenville a UTC date is already tomorrow.
{
  const src = (await rows(`select proname, prosrc from pg_proc where proname in ('recheck_compliance_rule', 'correct_compliance_rule')`));
  ok("a check is dated in Eastern time, in both functions — at 9 PM in Greenville the UTC date is tomorrow",
    src.length === 2 && src.every((x) => /today date := \(now\(\) at time zone 'America\/New_York'\)::date;/.test(x.prosrc)), src.map((x) => x.proname));
}

// ── 7 · WHO MAY CALL WHAT, AND THE LOG STAYS THE LOG ───────────────────────────────────────────
const can = async (role, fn) => (await q1(`select has_function_privilege('${role}', '${fn}', 'execute') v`)).v;
ok("anon cannot record or correct a check", !(await can("anon", "public.recheck_compliance_rule(uuid,text,text,text)")) && !(await can("anon", "public.correct_compliance_rule(uuid,text,text,text,int,text,text,text)")));
ok("authenticated reaches both — each checks is_staff / is_admin itself", (await can("authenticated", "public.recheck_compliance_rule(uuid,text,text,text)")) && (await can("authenticated", "public.correct_compliance_rule(uuid,text,text,text,int,text,text,text)")));
{
  await as(S1, { staff: true });
  await db.exec(`grant select on public.compliance_rules to authenticated`);
  await db.exec(`set role authenticated`);
  const ins = await raises(`insert into public.compliance_checks (rule_id, checked_on, outcome, checked_against, before) values ('${undated}', current_date, 'confirmed', 'made up', '{}'::jsonb)`);
  const upd = await raises(`update public.compliance_checks set checked_against = 'rewritten'`);
  await db.exec(`reset role`);
  ok("a client cannot write a check it did not make", /permission denied/.test(ins ?? ""), ins);
  ok("…or rewrite one that was made", /permission denied/.test(upd ?? ""), upd);
}

// ── 8 · RE-RUNNABLE, AND RECORDED ──────────────────────────────────────────────────────────────
{
  let err = null;
  try { await db.exec(MIG); } catch (e) { err = String(e.message || e); }
  ok("0342 runs twice without error", err === null, err);
  ok("…without a second changelog line", Number((await q1(`select count(*) n from public.changelog where title like 'A permit rule can be re-checked%'`)).n) === 1);
  ok("…and the checks are still there", Number((await q1(`select count(*) n from public.compliance_checks`)).n) >= 5);
  ok("0342 recorded itself", Number((await q1(`select applied_count n from public.schema_migrations where version = '0342_checked_with_whom_and_when'`)).n) === 2);
}

console.log(fail
  ? `CHECKED WITH WHOM, AND WHEN: ${pass} passed, ${fail} FAILED`
  : `CHECKED WITH WHOM, AND WHEN: ${pass} passed, 0 failed`);
await db.close();
process.exit(fail ? 1 : 0);
