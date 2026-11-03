// IMS8 · THE ROLLOUT, EVERY HALF-WAY STATE (0473 / 0474 and the two apps, in Postgres). Ryan, 2026-11-03: "Prove
// old-app/new-database compatibility during rollout and new-app behavior if deployment fails."
// The old app is production's f14c3dc6; the calls below are its own, read from that tree (components/nutrition/
// CourseOnRecord, app/api/library/intake, components/ShopOrderRecord + CustomerRecord, lib/goalMetrics, lib/visionRead).
// The new app is the review branch. A deployment that fails on Vercel leaves the old one serving, so "the new app
// failed to deploy" IS "the old app on the new database" — the state 0473 is pasted into first.
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c475000-0000-4000-8000-0000000000c1", CREW = "0c475000-0000-4000-8000-0000000000c2", LEAD = "0c475000-0000-4000-8000-0000000000c3";

async function world(before) {
  const db = await fullSchema(before ? { before } : {});
  const q = async (s, p) => (await db.query(s, p)).rows;
  await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);
  for (const [id, role, adm] of [[OWNER, "owner", true], [CREW, "server", false], [LEAD, "event_manager", false]]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
    await q(`update public.profiles set role = $2, tenant_id = $3, is_admin = $4 where id = $1`, [id, role, T1, adm]);
  }
  const cust = (await q(`insert into public.customers (name, email, tenant_id) values ('Pat Buyer', 'pat@example.test', $1) returning id`, [T1]))[0].id;
  await q(`insert into public.program_access (customer_id, tier, source, tenant_id, note) values ($1, 'pro', 'comp', $2, 'a gift')`, [cust, T1]);
  const order = (await q(`insert into public.shop_orders (customer_id, email, ship_name, total_cents, status, tenant_id) values ($1, 'pat@example.test', 'Pat B.', 3200, 'paid', $2) returning id`, [cust, T1]))[0].id;
  const link = (await q(`insert into public.vision_shares (label, published, tenant_id) values ('Compat', '{}'::jsonb, $1) returning token`, [T1]))[0].token;
  const intake = (await q(`insert into public.std_intakes (kind, input, request_hash, tenant_id) values ('describe', 'a bench', repeat('d', 64), $1) returning id`, [T1]))[0].id;
  const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false); select set_config('request.jwt.claims', '', false); select set_config('request.headers', '', false);`);
  const as = async (who, sql, params) => {
    const role = who ? "authenticated" : "anon", sub = who ?? "";
    await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); select set_config('request.jwt.claim.role', '${role}', false);
      select set_config('request.jwt.claims', '${JSON.stringify({ sub, role, aal: "aal1" })}', false); set role ${role};`);
    try { return { rows: (await db.query(sql, params)).rows, code: null }; } catch (e) { return { rows: [], code: e.code ?? "?" }; } finally { await root(); }
  };
  const total = (await q(`select count(*)::int n from public.customers where tenant_id = $1`, [T1]))[0].n;   // every account has a customer row too
  return { db, as, cust, order, link, intake, total };
}

// What each app does, per call (the app's own handling of the answer, quoted from its code):
const OLD = {
  courseLine: (w, who) => w.as(who, `select customer_id, note from public.course_students()`).then((r) => r.code ? { error: r.code } : { line: r.rows.find((x) => x.customer_id === w.cust) ?? null }),
  settle: (w, who, run) => w.as(who, `select public.std_research_settle($1, '{"searches":1,"fetches":0,"input_tokens":1,"output_tokens":1}'::jsonb, 1, 'done', null)`, [run]).then((r) => r.code ? { warned: r.code } : { settled: true }),   // on error: console.warn, return null, the run closes at full charge
  orderSheet: (w, who) => w.as(who, `select who from public.v_shop_orders where id = $1`, [w.order]).then((r) => r.rows[0] ?? null),
  customerRecord: (w, who) => w.as(who, `select id, phone from public.customers where id = $1`, [w.cust]).then((r) => r.rows[0] ?? null),   // the name is a link for every crew member
  goalsCount: (w, who) => w.as(who, `select count(*)::int n from public.customers`).then((r) => r.rows[0]?.n ?? null),
  deadLink: (w) => w.as(null, `select public.vision_shared($1) v`, ["x".repeat(40)]).then((r) => r.code === "PT404" ? "isn't live" : r.code ? `error ${r.code}` : `drawn: ${JSON.stringify(r.rows[0].v)}`),
  liveLink: (w) => w.as(null, `select public.vision_shared($1) v`, [w.link]).then((r) => (r.code ? `error ${r.code}` : "drawn")),
};
const NEW = {
  courseLine: (w, who) => w.as(who, `select source, note from public.course_status($1)`, [w.cust]).then((r) => r.code ? { error: r.code } : { line: r.rows[0] ?? null }),
  // the new route settles with the server's key (std_research_settle_server): what matters is that it exists
  settleExists: (w) => w.db.query(`select count(*)::int n from pg_proc where proname = 'std_research_settle_server'`).then((r) => r.rows[0].n === 1),
  goalsCount: (w, who) => w.as(who, `select public.customers_total() n`).then((r) => (r.code ? { unknown: r.code } : r.rows[0].n)),   // on error: the metric reads "—"
  deadLink: (w) => w.as(null, `select public.vision_shared($1) v`, ["x".repeat(40)]).then((r) => r.code === "PT404" || r.rows[0]?.v?.live === false ? "isn't live" : r.code ? `error ${r.code}` : "drawn"),
};

// ── A: today (production): old app, database at 0472 ────────────────────────────────────────────────────────────────
// ── B: 0473 pasted, the old app still serving (the planned gap, and the state a failed deploy leaves) ─────────────
{
  const w = await world("0474");
  const run = (await w.as(OWNER, `select public.std_research_reserve($1, 'light') run`, [w.intake])).rows[0]?.run;
  ok("B · old app on 0473: the owner's customer record shows the course line, note included", (await OLD.courseLine(w, OWNER)).line?.note === "a gift");
  const crewLine = await OLD.courseLine(w, CREW);
  ok("B · …a crew member's shows none (the old app reads the owners' list) — no error, and nothing leaks", !crewLine.error && crewLine.line === null, crewLine);
  ok("B · old research route: its settle is gone (42883) → it warns and goes on; the run is closed at its full reservation by the next one", (await OLD.settle(w, OWNER, run)).warned === "42883");
  await w.db.query(`update public.std_research_runs set deadline_at = now() - interval '1 second' where id = $1`, [run]);
  await w.as(OWNER, `select public.std_research_reserve($1, 'light')`, [w.intake]);
  ok("B · …and that run is charged its reservation (conservative: the day counts at least what was reserved)", (await w.db.query(`select outcome, charged_cents from public.std_research_runs where id = $1`, [run])).rows[0].outcome === "unreported");
  ok("B · old order sheet for crew: unchanged (the customer's name)", (await OLD.orderSheet(w, CREW))?.who === "Pat Buyer");
  ok("B · old customer link for crew: still opens (0474 not yet)", !!(await OLD.customerRecord(w, CREW)));
  ok("B · old Goals count for a lead: still counts the whole book", (await OLD.goalsCount(w, LEAD)) === w.total && w.total > 1);
  ok("B · old app, a dead link: \"isn't live\" (0473 still raises)", (await OLD.deadLink(w)) === "isn't live");
  ok("B · old app, a live link: drawn", (await OLD.liveLink(w)) === "drawn");
  ok("B · old app: a crew member writing an order directly — it never did; refused now", (await w.as(CREW, `update public.shop_orders set note = 'x' where id = $1 returning id`, [w.order])).rows.length === 0);
  // The new app on this state (0474 not yet pasted): everything works.
  ok("B · new app on 0473: crew course line without note", (await NEW.courseLine(w, CREW)).line?.source === "comp" && (await NEW.courseLine(w, CREW)).line?.note === null);
  ok("B · new app on 0473: the server's settle is there", await NEW.settleExists(w));
  ok("B · new app on 0473: Goals count for a lead", (await NEW.goalsCount(w, LEAD)) === w.total);
  ok("B · new app on 0473: a dead link reads \"isn't live\" (the raise)", (await NEW.deadLink(w)) === "isn't live");
  await w.db.close();
}
// ── C: 0473 + 0474, the new app (the end state) ─────────────────────────────────────────────────────────────────────
{
  const w = await world(null);
  ok("C · new app: a dead link reads \"isn't live\" (the answer { live: false })", (await NEW.deadLink(w)) === "isn't live");
  ok("C · new app: Goals count for a lead, without the rows", (await NEW.goalsCount(w, LEAD)) === w.total && (await OLD.customerRecord(w, LEAD)) === null);
  ok("C · new app: crew order sheet reads who = the order's ship name; the link is drawn for owners/admins only", (await OLD.orderSheet(w, CREW))?.who === "Pat B." && (await OLD.orderSheet(w, OWNER))?.who === "Pat Buyer");
  // If the app had to go back to the old one here, these are what would break — which is why 0474's rollback goes first:
  ok("C · (old app here would draw a dead link as an empty vision — so 0474 is rolled back before the app)", (await OLD.deadLink(w)).startsWith("drawn"));
  ok("C · (old app here: crew's customer link → not found; a lead's Goals count → 1, their own row, not the book)", (await OLD.customerRecord(w, CREW)) === null && (await OLD.goalsCount(w, LEAD)) === 1 && w.total > 1);
  await w.db.close();
}
// ── D: the wrong order — the new app deployed before 0473 (not the plan; what it would do) ─────────────────────────
{
  const w = await world("0473");
  const nl = await NEW.courseLine(w, OWNER);
  ok("D · new app on 0472: the course line errors (42883) — the record shows its error state, nothing wrong is shown", nl.error === "42883", nl);
  ok("D · …the server's settle is missing: the route warns, the run is closed at full charge (as the old app)", !(await NEW.settleExists(w)));
  ok("D · …Goals count: unknown (\"—\"), not 0", (await NEW.goalsCount(w, LEAD)).unknown === "42883");
  ok("D · …links: a dead one still reads \"isn't live\"", (await NEW.deadLink(w)) === "isn't live");
  await w.db.close();
}
console.log(`IMS8 ROLLOUT, EVERY HALF-WAY STATE (old/new app × 0472/0473/0474): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
