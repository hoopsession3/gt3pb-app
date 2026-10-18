// R28 — TWO-STEP FOR THE OWNERS AND ADMINS (0433), IN POSTGRES (2026-10-18 — the 10/10 audit, security F6; Ryan: "Yes,
// owner/admin").
//
// The whole schema to 0432 is loaded, then 0433 — twice — and the two gates every owner and admin power asks (is_admin,
// is_owner) are asked as the people who call them, on sign-ins with and without the second step (the token's aal):
// nothing changes for anyone without an authenticator; one who set one up is an owner or admin only on a sign-in that gave
// its code, and crew on one that didn't; a business that requires it holds every owner and admin to it; turning that on
// is an owner's, on a sign-in with its code, so it can't lock its owner out; and a server, a member and the server's own
// role are as they were. The money's own door (report_sales) is asked as well, to see the gate hold where it is used.
// Every person is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M433 = readFileSync(join(ROOT, "supabase/migrations/0433_two_step_for_the_owners_and_admins.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const ALEX = "0c433000-0000-4000-8000-0000000000c1";   // an owner
const RAE = "0c433000-0000-4000-8000-0000000000c2";    // an admin
const KAY = "0c433000-0000-4000-8000-0000000000b1";    // crew (server)
const SAM = "0c433000-0000-4000-8000-0000000000a1";    // a member

const t0 = Date.now();
const db = await fullSchema({ before: "0433" });
console.log(`the schema to 0432 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);
  select set_config('request.jwt.claims', '', false);`);
// As PostgREST calls it: the role, and the token's claims — aal1 or aal2 as GoTrue writes it.
const as = async (who, aal, sql, params) => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  const sub = who && who !== "service" ? who : "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); select set_config('request.jwt.claim.role', '${role}', false);
    select set_config('request.jwt.claims', '${JSON.stringify({ sub, role, aal })}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null, code: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);
for (const [id, role, name] of [[ALEX, "owner", "Alex Rivera"], [RAE, "admin", "Rae Kim"], [KAY, "server", "Kay Lin"], [SAM, "member", "Sam Ito"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
}
const gates = async (who, aal) => (await as(who, aal, `select public.is_admin() a, public.is_owner() o, public.is_staff() s`)).rows[0];
const money = async (who, aal) => (await as(who, aal, `select public.report_sales(7) r`)).rows[0]?.r;
const factor = (who, status = "verified") => q(`insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, 'made-up authenticator', $2)`, [who, status]);

// ── before 0433 ────────────────────────────────────────────────────────────────────────────────────────────────────
await factor(ALEX);
const before = await gates(ALEX, "aal1");
ok("before 0433: an owner who set up an authenticator is an owner on a sign-in that never gave its code", before.a === true && before.o === true, before);

await db.exec(M433);
await db.exec(M433);
ok("0433 pasted twice: recorded twice, the two gates ask the one question", (await q1(`select applied_count::int n from public.schema_migrations where version = '0433_two_step_for_the_owners_and_admins'`)).n === 2
  && (await q(`select proname from pg_proc where proname in ('is_admin', 'is_owner') and prosrc like '%two_step_ok%'`)).length === 2);

// ── an authenticator set up: owner and admin on a sign-in that gave its code ──────────────────────────────────────────
{
  const one = await gates(ALEX, "aal1"), two = await gates(ALEX, "aal2");
  ok("an owner with an authenticator, on a sign-in without its code: not an owner, not an admin — still crew", one.a === false && one.o === false && one.s === true, one);
  ok("…on a sign-in with its code: owner and admin", two.a === true && two.o === true && two.s === true, two);
  const m1 = await money(ALEX, "aal1"), m2 = await money(ALEX, "aal2");
  ok("…and the money's own door says so: refused without the code, the report with it", m1?.error === "unauthorized" && m2 && !m2.error, { m1, m2: m2 ? Object.keys(m2).slice(0, 4) : m2 });
  const raeFree = await gates(RAE, "aal1");
  ok("an admin with no authenticator, nobody requiring one: an admin as before", raeFree.a === true && raeFree.o === false, raeFree);
  await factor(RAE, "unverified");
  const raeHalf = await gates(RAE, "aal1");
  ok("an authenticator set up but never proven with a code (unverified) asks nothing yet", raeHalf.a === true, raeHalf);
  const kay = await gates(KAY, "aal1"), sam = await gates(SAM, "aal1");
  ok("a server and a member are as they were", kay.a === false && kay.o === false && kay.s === true && sam.a === false && sam.s === false, { kay, sam });
}

// ── what the app asks ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const s1 = (await as(ALEX, "aal1", `select public.two_step_state() s`)).rows[0]?.s;
  const s2 = (await as(ALEX, "aal2", `select public.two_step_state() s`)).rows[0]?.s;
  const sk = (await as(KAY, "aal1", `select public.two_step_state() s`)).rows[0]?.s;
  ok("two_step_state: an owner with an authenticator, without its code — enrolled, not given, not ok; with it — ok",
    s1?.leader === true && s1.owner === true && s1.enrolled === true && s1.given === false && s1.required === false && s1.ok === false && s2?.given === true && s2.ok === true, { s1, s2 });
  ok("two_step_state: crew are not leaders, and it says nothing more of anyone (no factor's id, no secret)",
    sk?.leader === false && Object.keys(s1).sort().join() === "enrolled,given,leader,ok,owner,required", { sk, keys: Object.keys(s1) });
  const anon = await as(null, null, `select public.two_step_state() s`);
  ok("a guest can't ask it", /permission denied/.test(anon.error ?? ""), anon);
}

// ── required: no lockout ──────────────────────────────────────────────────────────────────────────────────────────
{
  const byAdmin = await as(RAE, "aal2", `select public.require_two_step(true) r`);
  const noCode = await as(ALEX, "aal1", `select public.require_two_step(true) r`);
  ok("requiring it is an owner's on a sign-in with their code: an admin can't, an owner without the code can't",
    byAdmin.code === "42501" && noCode.code === "42501" && !(await q1(`select count(*)::int n from public.two_step_settings`)).n, { byAdmin: byAdmin.error, noCode: noCode.error });
  // An owner who never set up an authenticator can't turn it on either — the on switch can't lock its owner out.
  await q(`update public.profiles set role = 'owner' where id = $1`, [RAE]);
  const bare = await as(RAE, "aal2", `select public.require_two_step(true) r`);
  ok("…nor an owner with no authenticator of their own, whatever their token says (the factor is asked as well)", bare.code === "42501", bare.error);
  await q(`update public.profiles set role = 'admin' where id = $1`, [RAE]);

  const on = await as(ALEX, "aal2", `select public.require_two_step(true) r`);
  ok("the owner, with their code: required — and kept, with who and when", on.rows[0]?.r?.required === true
    && (await q1(`select required, set_by from public.two_step_settings where tenant_id = $1`, [T1]))?.set_by === ALEX, on);
  const rae = await gates(RAE, "aal1");
  ok("required: an admin with no authenticator is crew until they set one up — never locked out of the app, only of the powers",
    rae.a === false && rae.s === true && (await as(RAE, "aal1", `select public.two_step_state() s`)).rows[0]?.s?.required === true, rae);
  await q(`update auth.mfa_factors set status = 'verified' where user_id = $1`, [RAE]);
  const raeSet = await gates(RAE, "aal2");
  ok("…and once they have, an admin on a sign-in with its code", raeSet.a === true, raeSet);
  const owner2 = await gates(ALEX, "aal2");
  ok("the owner who required it is an owner on their sign-in with its code — not locked out", owner2.o === true && owner2.a === true, owner2);
  const off = await as(ALEX, "aal2", `select public.require_two_step(false) r`);
  ok("…and turns it off the same way", off.rows[0]?.r?.required === false && (await gates(RAE, "aal1")).a === false /* RAE has one now: still asked */, off);
}

// ── the server, and nobody writes the setting by hand ─────────────────────────────────────────────────────────────
{
  const svc = await as("service", null, `select public.is_admin() a, public.two_step_ok() t`);
  ok("the server's own role: no person, no owner's powers — and the question answers without one", svc.rows[0]?.a === false && svc.rows[0]?.t === true, svc);
  const write = await as(ALEX, "aal2", `insert into public.two_step_settings (tenant_id, required) values ($1, false)`, [T1]);
  const read = await as(ALEX, "aal2", `select required from public.two_step_settings`);
  ok("the setting is written only by require_two_step, and read only through the question", /permission denied/.test(write.error ?? "") && /permission denied/.test(read.error ?? ""), { write: write.error, read: read.error });
  const meta = await q1(`select c.relrowsecurity as rls, has_function_privilege('anon', 'public.require_two_step(boolean)', 'execute') as anon_req,
      has_function_privilege('anon', 'public.two_step_state()', 'execute') as anon_state,
      (select count(*)::int from pg_proc where proname = 'two_step_ok' and 'search_path=""' = any(proconfig)) as pinned
    from pg_class c where c.oid = 'public.two_step_settings'::regclass`);
  ok("row security on; no guest asks or sets it; the question's path pinned", meta.rls === true && meta.anon_req === false && meta.anon_state === false && meta.pinned === 1, meta);
  ok("the changelog says it once", (await q1(`select count(*)::int n from public.changelog where title = 'Two-step sign-in for owners and admins'`)).n === 1);
}

await db.close();
console.log(`\nR28 — TWO-STEP FOR THE OWNERS AND ADMINS (0433): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
