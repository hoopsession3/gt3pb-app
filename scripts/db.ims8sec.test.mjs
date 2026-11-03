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
ok("course_status is a definer that checks the caller itself (crew no longer read program_access directly)", (await q1(`select prosecdef from pg_proc where proname = 'course_status'`)).prosecdef === true);
ok("…signed out: refused (no grant)", (await status(null, C1)).code === "42501");
ok("…the admin sees the note too (owners and admins)", (await status(RAE, C1)).rows[0]?.note === "a gift");

// direct reads of program_access: a customer's own, or an owner's/admin's — never the crew's of everyone
const PATU = "0c473000-0000-4000-8000-0000000000a6";
await q(`insert into auth.users (id, email) values ($1, 'pat@example.test')`, [PATU]);
await q(`update public.customers set user_id = $2 where id = $1`, [C1, PATU]);
const rd = async (who) => (await as(who, `select customer_id, note from public.program_access`));
const rCrew = await rd(KAY), rOwn = await rd(ALEX), rPat = await rd(PATU), rOla = await rd(OLA), rAnon = await rd(null);
ok("program_access read directly: the crew see no one's row (was every customer's, with the owner's note)", rCrew.rows.length === 0 && !rCrew.code, rCrew);
ok("…the owner reads the business's rows, not another business's", rOwn.rows.length === 1 && rOwn.rows[0].customer_id === C1, rOwn);
ok("…the customer reads their own", rPat.rows.length === 1 && rPat.rows[0].customer_id === C1, rPat);
ok("…another business's owner reads only theirs", rOla.rows.length === 1 && rOla.rows[0].customer_id === C2, rOla);
ok("…signed out: nothing", rAnon.rows.length === 0, rAnon);

const before = await q1(`select revoked_at, source from public.program_access where customer_id = $1`, [C1]);
const crewUpd = await as(KAY, `update public.program_access set revoked_at = now() where customer_id = $1 returning id`, [C1]);
const crewIns = await as(KAY, `insert into public.program_access (customer_id, tier, source) values ($1, 'rookie', 'comp') returning id`, [C1]);
const crewDel = await as(KAY, `delete from public.program_access where customer_id = $1 returning id`, [C1]);
const after = await q1(`select revoked_at, source from public.program_access where customer_id = $1`, [C1]);
ok("crew can no longer take the course back or give it by writing the table (was: any crew member)", crewUpd.rows.length === 0 && crewIns.code && crewDel.rows.length === 0 && JSON.stringify(before) === JSON.stringify(after), { crewUpd, crewIns, crewDel });
ok("…nor through the door: course_give / course_take_back refuse crew (42501)", (await as(KAY, `select public.course_take_back($1)`, [C1])).code === "42501");
const xGive = await as(OLA, `select public.course_give($1, 'from elsewhere') r`, [C1]);
const xTake = await as(OLA, `select public.course_take_back($1)`, [C1]);
const pa = await q1(`select revoked_at, source, note, (select count(*)::int from public.program_access where customer_id = $1) n from public.program_access where customer_id = $1`, [C1]);
ok("another business's owner can't give our customer the course (PT404) and taking it back does nothing (revoked 0)", xGive.code === "PT404" && xTake.rows[0]?.course_take_back?.revoked === 0 && pa.n === 1 && pa.revoked_at === null && pa.note === "a gift", { xGive, xTake, pa });
ok("…the owner, through the door: taken back", !(await as(ALEX, `select public.course_take_back($1)`, [C1])).code && !!(await q1(`select revoked_at from public.program_access where customer_id = $1`, [C1]))?.revoked_at);

// ── shop orders: changed through their doors ───────────────────────────────────────────────────────────────────────
const SO = (await q1(`insert into public.shop_orders (email, ship_name, total_cents, status, tenant_id) values ('pat@example.test', 'Pat Student', 3200, 'paid', $1) returning id`, [T1])).id;
await q(`insert into public.shop_order_items (order_id, title, qty, unit_cents) values ($1, 'Tee', 1, 3200)`, [SO]).catch(() => {});
const soBefore = await q1(`select status, total_cents, ship_name from public.shop_orders where id = $1`, [SO]);
const cU = await as(KAY, `update public.shop_orders set ship_name = 'Somewhere Else', note = 'changed' where id = $1 returning id`, [SO]);   // columns no trigger guards — the policy alone decides
const cI = await as(KAY, `insert into public.shop_orders (email, total_cents, status) values ('x@example.test', 1, 'paid') returning id`);
const cD = await as(KAY, `delete from public.shop_orders where id = $1 returning id`, [SO]);
const cItem = await as(KAY, `update public.shop_order_items set title = 'Something else' where order_id = $1 returning order_id`, [SO]);
ok("crew can't write an order directly (update / insert / delete — was FOR ALL to any crew member)", cU.rows.length === 0 && !!cI.code && cD.rows.length === 0 && JSON.stringify(soBefore) === JSON.stringify(await q1(`select status, total_cents, ship_name from public.shop_orders where id = $1`, [SO])), { cU, cI, cD });
ok("…nor its line items", cItem.rows.length === 0 && !(await q(`select 1 from public.shop_order_items where order_id = $1 and title = 'Something else'`, [SO])).length && (await q(`select 1 from public.shop_order_items where order_id = $1`, [SO])).length === 1, cItem);
const cRead = await as(KAY, `select who, ship_name, total_cents from public.v_shop_orders where id = $1`, [SO]);
ok("…the crew still read the order for the alert-opened record (who, where, what)", cRead.rows.length === 1 && cRead.rows[0].ship_name === "Pat Student", cRead);
const cStatus = await as(KAY, `select (public.set_shop_order_status($1, 'needs_fulfillment', 'checked')).status s`, [SO]);
ok("…and still move it through its door (set_shop_order_status)", cStatus.rows[0]?.s === "needs_fulfillment", cStatus);
const xMove = await as(OLA, `select public.set_shop_order_status($1, 'canceled', 'x')`, [SO]);
ok("…another business's owner can't move it (found by this test: 0417 locked by id alone)", !!xMove.code && (await q1(`select status from public.shop_orders where id = $1`, [SO])).status === "needs_fulfillment", xMove);
const fI = await as(KAY, `insert into public.merch_fulfillments (order_id, tracking_number) values ($1, 'FAKE123') returning id`, [SO]);
ok("crew can't write a shipment nobody shipped (merch_fulfillments is the printer webhook's)", !!fI.code || fI.rows.length === 0, fI);
ok("…an owner can't either, from a session", !!(await as(ALEX, `insert into public.merch_fulfillments (order_id, tracking_number) values ($1, 'FAKE124') returning id`, [SO])).code);
ok("…nor delete an order from a session (no permissive delete left; none did)", (await as(ALEX, `delete from public.shop_orders where id = $1 returning id`, [SO])).rows.length === 0 && !!(await q1(`select id from public.shop_orders where id = $1`, [SO])));

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
ok("…nor inserted or deleted from a session", !!(await as(ALEX, `insert into public.std_research_runs (intake_id, tenant_id) values ($1, $2) returning id`, [intake, T1])).code && !!(await as(ALEX, `delete from public.std_research_runs where id = $1 returning id`, [run])).code);
ok("…nor the budget row inserted from a session", !!(await as(ALEX, `insert into public.std_research_budget (tenant_id, daily_cents) values ($1, 999999)`, [T2])).code);
ok("the budget is the owner's: an admin can't raise it", (await as(RAE, `update public.std_research_budget set daily_cents = daily_cents * 10 returning daily_cents`)).code !== null);

// ── a link's door, limited per address ──────────────────────────────────────────────────────────────────────────────
const LINK = (await q1(`insert into public.vision_shares (label, published, tenant_id) values ('Throttle test', '{}'::jsonb, $1) returning token, id`, [T1]));
const open1 = async (ip) => { await db.exec(`select set_config('request.headers', '${JSON.stringify(ip ? { "cf-connecting-ip": ip } : {})}', false)`); return as(null, `select public.vision_shared($1) v`, [LINK.token]); };
const first = await open1("203.0.113.7");
ok("a live link opens for someone outside", !first.code, first);
let refused = null, n = 1;
for (; n < 70 && !refused; n++) { const r = await open1("203.0.113.7"); if (r.code) refused = { n: n + 1, code: r.code }; }
ok("…the 61st open from one address in ten minutes is refused (PT429)", refused?.n === 61 && refused.code === "PT429", refused);
ok("…and isn't counted on the link (opens stop at 60)", (await q1(`select opens from public.vision_shares where id = $1`, [LINK.id])).opens === 60);
ok("…another address still opens it", !(await open1("198.51.100.4")).code);
ok("…IPv6 neighbours share one /64 bucket", (await (async () => { for (let i = 0; i < 60; i++) await open1(`2001:db8:1:2::${(i % 9) + 1}`); return (await open1("2001:db8:1:2:ffff::1")).code; })()) === "PT429");
const miss = await open1("203.0.113.7").then(() => as(null, `select public.vision_shared($1) v`, ["x".repeat(40)]));
ok("a wrong token is still PT404 (and, being a raise, isn't counted — the database can't limit guesses)", miss.code === "PT404", miss);
ok("no address header: no limit (0436's rule)", !(await open1(null)).code);
await db.exec(`select set_config('request.headers', '', false)`);
ok("opens is documented as raw door calls, not engagement", /not engagement/i.test((await q1(`select col_description('public.vision_shares'::regclass, (select attnum from pg_attribute where attrelid = 'public.vision_shares'::regclass and attname = 'opens')::int) d`)).d ?? ""));

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
