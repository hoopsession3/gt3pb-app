// IMS8 SECURITY REVIEW (0473, in Postgres, through the real doors — for review, not applied). Ryan, 2026-11-03:
// "course_students: … Restrict fields and access to that purpose; test cross-business access and unauthorized crew …
// std_research_settle: determine whether a caller can under-report costs or bypass the budget … Reconcile the earlier
// claim that link creation requires aal2 with the finding that neither owner has MFA. State the exact enforced policy and
// verify that required step-up cannot be bypassed." Every person is made up; logs print no token.
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 500)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c473000-0000-4000-8000-0000000000b2";
const ALEX = "0c473000-0000-4000-8000-0000000000a1";   // owner, business 1
const RAE = "0c473000-0000-4000-8000-0000000000a2";    // admin, business 1
const KAY = "0c473000-0000-4000-8000-0000000000a3";    // crew (server), business 1
const SAM = "0c473000-0000-4000-8000-0000000000a4";    // a member, business 1
const OLA = "0c473000-0000-4000-8000-0000000000a5";    // owner, business 2

const db = await fullSchema({});
const q = async (s, p) => (await db.query(s, p)).rows, q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-business', 'Other business') on conflict do nothing; commit;`);
for (const [id, role, t] of [[ALEX, "owner", T1], [RAE, "admin", T1], [KAY, "server", T1], [SAM, "member", T1], [OLA, "owner", T2]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-2)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
}
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false); select set_config('request.jwt.claims', '', false);`);
const as = async (who, sql, params, aal = "aal1") => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  const sub = who && who !== "service" ? who : "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); select set_config('request.jwt.claim.role', '${role}', false);
    select set_config('request.jwt.claims', '${JSON.stringify({ sub, role, aal })}', false); set role ${role};`);
  try { return { rows: (await db.query(sql, params)).rows, code: null }; } catch (e) { return { rows: [], code: e.code ?? "?", error: String(e.message) }; } finally { await root(); }
};

// ── the course ───────────────────────────────────────────────────────────────────────────────────────────────────────
const C1 = (await q1(`insert into public.customers (name, email, tenant_id) values ('Pat Student', 'pat@example.test', $1) returning id`, [T1])).id;
const C2 = (await q1(`insert into public.customers (name, email, tenant_id) values ('Other Student', 'other@example.test', $1) returning id`, [T2])).id;
ok("an owner gives the course (course_give)", !(await as(ALEX, `select public.course_give($1, 'a gift') r`, [C1])).code);
await q(`insert into public.program_access (customer_id, tier, source, tenant_id) values ($1, 'pro', 'comp', $2)`, [C2, T2]);

const list = async (who) => (await as(who, `select customer_id, email, note from public.course_students()`));
const own = await list(ALEX), adm = await list(RAE), crew = await list(KAY), mem = await list(SAM), other = await list(OLA);
ok("the students list, with emails: the owner and the admin of the business", own.rows.length === 1 && own.rows[0].email === "pat@example.test" && adm.rows.length === 1, { own, adm });
ok("…crew: nothing (was everyone's name, email, payment and note)", crew.rows.length === 0 && !crew.code, crew);
ok("…a member: nothing", mem.rows.length === 0, mem);
ok("…another business's owner: only their own student, never ours", other.rows.length === 1 && other.rows[0].customer_id === C2, other);
ok("…signed out: refused", (await list(null)).code === "42501");

const status = async (who, c) => (await as(who, `select source, note, paid_cents, done, total from public.course_status($1)`, [c]));
const sCrew = await status(KAY, C1), sOwn = await status(ALEX, C1);
ok("one customer's course line for the crew's customer record: how and when, no note, no payment, no email", sCrew.rows.length === 1 && sCrew.rows[0].source === "comp" && sCrew.rows[0].note === null && !("email" in sCrew.rows[0]), sCrew);
ok("…the owner sees the note", sOwn.rows[0]?.note === "a gift", sOwn);
ok("…another business's owner can't read our customer's line", (await status(OLA, C1)).rows.length === 0);
ok("…nor our crew theirs", (await status(KAY, C2)).rows.length === 0);
ok("…a member (not crew) reads no one's", (await status(SAM, C1)).rows.length === 0);
ok("course_status is not a privileged function (invoker)", (await q1(`select prosecdef from pg_proc where proname = 'course_status'`)).prosecdef === false);

const before = await q1(`select revoked_at, source from public.program_access where customer_id = $1`, [C1]);
const crewUpd = await as(KAY, `update public.program_access set revoked_at = now() where customer_id = $1 returning id`, [C1]);
const crewIns = await as(KAY, `insert into public.program_access (customer_id, tier, source) values ($1, 'rookie', 'comp') returning id`, [C1]);
const crewDel = await as(KAY, `delete from public.program_access where customer_id = $1 returning id`, [C1]);
const after = await q1(`select revoked_at, source from public.program_access where customer_id = $1`, [C1]);
ok("crew can no longer take the course back or give it by writing the table (was: any crew member)", crewUpd.rows.length === 0 && crewIns.code && crewDel.rows.length === 0 && JSON.stringify(before) === JSON.stringify(after), { crewUpd, crewIns, crewDel });
ok("…nor through the door: course_give / course_take_back refuse crew (42501)", (await as(KAY, `select public.course_take_back($1)`, [C1])).code === "42501");
ok("…the owner, through the door: taken back", !(await as(ALEX, `select public.course_take_back($1)`, [C1])).code && !!(await q1(`select revoked_at from public.program_access where customer_id = $1`, [C1]))?.revoked_at);

// ── the research bill ────────────────────────────────────────────────────────────────────────────────────────────────
const intake = (await q1(`insert into public.std_intakes (kind, input, request_hash, tenant_id) values ('describe', 'a bench', repeat('a', 64), $1) returning id`, [T1])).id;
const reserve = await as(ALEX, `select public.std_research_reserve($1, 'light') run`, [intake]);
const run = reserve.rows[0]?.run;
ok("an owner reserves a run against the day's budget", !!run && !reserve.code, reserve);
const reserved = Number((await q1(`select reserved_cents from public.std_research_runs where id = $1`, [run])).reserved_cents);
ok("the browser's settle is gone (it took the cost as the caller said it)", (await as(ALEX, `select public.std_research_settle($1, '{}'::jsonb, 0, 'done', null)`, [run])).code === "42883");
const usage = JSON.stringify({ searches: 1, fetches: 1, input_tokens: 1000, output_tokens: 100 });
const K1 = "0c473000-0000-4000-8000-00000000c001", K2 = "0c473000-0000-4000-8000-00000000c002";
const settle = (who, tenant, r, cents, key, u = usage) => as(who, `select public.std_research_settle_server($1, $2, $3::jsonb, $4, 'done', null, $5) c`, [tenant, r, u, cents, key]);
ok("…the server's settle: refused to an owner's or admin's own session, and to the signed out", (await settle(ALEX, T1, run, 0, K1)).code === "42501" && (await settle(RAE, T1, run, 0, K1)).code === "42501" && (await settle(null, T1, run, 0, K1)).code === "42501");
ok("…refused for a run of another business", (await settle("service", T2, run, 5, K1)).code === "PT404");
const s1 = await settle("service", T1, run, 7.5, K1);
ok("the server settles the run once, at the cost it computed from the model's usage", Number(s1.rows[0]?.c) === 7.5, s1);
ok("…the same settle again (a retry): the same answer, nothing changed", Number((await settle("service", T1, run, 99, K1)).rows[0]?.c) === 7.5 && Number((await q1(`select charged_cents from public.std_research_runs where id = $1`, [run])).charged_cents) === 7.5);
ok("…any other settle of it: refused (PT409)", (await settle("service", T1, run, 0, K2)).code === "PT409");
ok("…the run's own record can't be rewritten from a session (select only)", (await as(ALEX, `update public.std_research_runs set charged_cents = 0 where id = $1 returning id`, [run])).code === "42501");
const run2 = (await as(ALEX, `select public.std_research_reserve($1, 'light') run`, [intake])).rows[0]?.run;
const s2 = await settle("service", T1, run2, 0, K2, JSON.stringify({ searches: 1 }));
ok("usage the model didn't fully report: charged the full reservation, recorded 'unreported'", Number(s2.rows[0]?.c) === reserved && (await q1(`select outcome from public.std_research_runs where id = $1`, [run2])).outcome === "unreported", s2);
ok("the budget is the owner's: an admin can't raise it", (await as(RAE, `update public.std_research_budget set daily_cents = daily_cents * 10 returning daily_cents`)).code !== null);

// ── the second step on a link (exact policy: is_admin = owner/admin AND (aal2 OR (no verified authenticator AND the
//    business doesn't require one))) ─────────────────────────────────────────────────────────────────────────────────
const review = (who, aal) => as(who, `select public.vision_share_review(null, '{}'::jsonb) r`, [], aal);
ok("an owner with no authenticator, the business not requiring one: may review a link on a plain sign-in (aal1)", !(await review(ALEX, "aal1")).code);
await q(`insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, 'made-up', 'verified')`, [ALEX]);
ok("…once they have an authenticator: refused on a sign-in without its code (PT403)", (await review(ALEX, "aal1")).code === "PT403");
ok("…and allowed on one with it (aal2)", !(await review(ALEX, "aal2")).code);
ok("…publish asks the same (refused at aal1)", (await as(ALEX, `select public.vision_share_publish(null, '{"label":"x"}'::jsonb, 'f', '{}')`, [], "aal1")).code === "PT403");
ok("the requirement can't be switched off without the code (require_two_step at aal1: 42501)", (await as(ALEX, `select public.require_two_step(false)`, [], "aal1")).code === "42501");
ok("…nor written directly (no grant on two_step_settings)", (await as(ALEX, `insert into public.two_step_settings (tenant_id, required) values ($1, false)`, [T1], "aal2")).code === "42501");
ok("…nor the authenticator removed from a session (auth's tables aren't the API's)", (await as(ALEX, `delete from auth.mfa_factors where user_id = $1`, [ALEX], "aal1")).code === "42501");
await q(`insert into public.two_step_settings (tenant_id, required) values ($1, true) on conflict (tenant_id) do update set required = true`, [T1]);
ok("a business that requires it: an admin with no authenticator is refused even on a plain sign-in", (await review(RAE, "aal1")).code === "PT403");

console.log(`IMS8 SECURITY REVIEW (0473, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
