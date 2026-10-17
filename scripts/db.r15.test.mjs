// R15 — AN OFFICE BOOKING ONCE, A STUCK SQUARE EVENT SAID, THE TENANT ASKED ONCE A QUERY, RUN IN POSTGRES (2026-10-17;
// Ryan: "Keep working to improve to a 10").
//
//   0422  business_orders.idempotency_key (one booking per person and key); watch_webhook_inbox() (a Square event left
//         unprocessed for half an hour is one critical alert); every "tenant isolation" policy asks effective_tenant()
//         once a query, not once a row — the same rule.
//
// What is run here is the whole schema up to 0421, the findings reproduced on it, then 0422 — twice — as the roles that
// call it. Every person, office and event is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M422 = readFileSync(join(ROOT, "supabase/migrations/0422_a_booking_once_a_stuck_event_said_the_tenant_asked_once.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const SAM = "0c422000-0000-4000-8000-0000000000a1";    // a member who books for an office
const NIA = "0c422000-0000-4000-8000-0000000000a2";    // another member
const ALEX = "0c422000-0000-4000-8000-0000000000c1";   // an owner

const t0 = Date.now();
const db = await fullSchema({ before: "0422" });
console.log(`the schema to 0421 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const n = async (s, p) => Number((await q1(s, p)).n);
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
const as = async (who, sql, params) => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`select set_config('request.jwt.claim.sub', '${who && who !== "service" ? who : ""}', false);
    select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
  grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;
  alter role service_role bypassrls;`);
for (const [id, role, name] of [[SAM, "member", "Sam Ito"], [NIA, "member", "Nia Park"], [ALEX, "owner", "Alex Rivera"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4, is_admin = ($2 in ('owner', 'admin')) where id = $1`, [id, role, T1, name]);
}
// A booking as the route makes it (the service role): a one-off, prepaid, three gallons.
const book = (who, key) => as("service", `insert into public.business_orders (user_id, company, contact_name, contact_phone, address_street, address_city, address_zip,
    delivery_date, gallons, subtotal_cents, total_cents, billing_terms, tenant_id${key === undefined ? "" : ", idempotency_key"})
    values ($1, 'Acme Dental', 'Dee Ross', '8645550100', '1 Main St', 'Greenville', '29601', current_date + 4, 3, 13500, 13500, 'prepaid', '${T1}'${key === undefined ? "" : ", $2"}) returning id`,
  key === undefined ? [who] : [who, key]);
const inbox = (id, minutesAgo, { processed = false, provider = "square", error = null } = {}) => q(`insert into public.webhook_events (id, provider, type, received_at, processed_at, error)
  values ($1, $2, 'refund.updated', now() - make_interval(mins => $3), case when $4 then now() else null end, $5)`, [id, provider, minutesAgo, processed, error]);
const unwrapped = () => n(`select count(*) n from pg_policy where polname = 'tenant isolation' and pg_get_expr(polqual, polrelid) !~* 'select'`);
const isolation = () => n(`select count(*) n from pg_policy where polname = 'tenant isolation'`);

// ── before 0422: the findings, reproduced ──────────────────────────────────────────────────────────────────────────
const policiesBefore = await isolation();
{
  const a = await book(SAM), b = await book(SAM);
  ok("before 0422: the same booking sent twice made two office orders (nothing to say it was one)", !a.error && !b.error && a.rows[0].id !== b.rows[0].id, [a.error, b.error]);
  ok("before 0422: nothing watched the webhook inbox", (await n(`select count(*) n from pg_proc where proname = 'watch_webhook_inbox'`)) === 0);
  ok("before 0422: every tenant isolation policy called effective_tenant() for each row it looked at", policiesBefore > 100 && (await unwrapped()) === policiesBefore,
    { policies: policiesBefore, unwrapped: await unwrapped() });
  // (kept: an office order is a permanent record — guard_permanent_record refuses its delete)
}

await db.exec(M422);
await db.exec(M422);   // a second run changes nothing
// 0422 loads on the schema to 0421, and loads again — a throw above fails this file; a milestone, not counted as a check.

// ── an office booking, once ──────────────────────────────────────────────────────────────────────────────────────
{
  const key = "bk-0c422-first-try";
  const a = await book(SAM, key), again = await book(SAM, key);
  ok("0422: a booking with its key is made", !a.error && a.rows.length === 1, a.error);
  ok("0422: …the same person and key again is refused as the same booking (23505 — the route answers with the first)", again.code === "23505", again);
  ok("0422: the same key from someone else is their own booking", !(await book(NIA, key)).error);
  const loose = [await book(SAM), await book(SAM)];
  ok("0422: a booking with no key (the old app) is made as before, any number of times", loose.every((r) => !r.error), loose.map((r) => r.error));
  const short = await book(SAM, "short");
  ok("0422: a key is 8 to 80 characters", short.code === "23514", short);
  ok("0422: there is one booking for Sam's key", (await n(`select count(*) n from public.business_orders where user_id = $1 and idempotency_key = $2`, [SAM, key])) === 1);
}

// ── an event Square sent and we didn't finish, said ──────────────────────────────────────────────────────────────
{
  const watch = async () => Number((await q1(`select public.watch_webhook_inbox() n`)).n);
  const stuckAlerts = () => q(`select severity, category, title, body, link from public.alerts where kind = 'webhook_stuck' and ack_at is null`);
  await inbox("evt-fresh", 10);
  await inbox("evt-done", 90, { processed: true });
  await inbox("evt-old-week", 60 * 24 * 8);
  await inbox("SMtwilio-1", 90, { provider: "twilio" });
  ok("0422: nothing waiting half an hour → nothing said (a fresh event, a processed one, one past a week, another provider's)", (await watch()) === 0 && (await stuckAlerts()).length === 0);
  await inbox("evt-stuck-1", 45, { error: "processing threw: connection reset by peer" });
  const first = await watch();
  const said = await stuckAlerts();
  ok("0422: a Square event unprocessed for 45 minutes → one critical money alert, saying how many, since when, and the last error",
    first === 1 && said.length === 1 && said[0].severity === "critical" && said[0].category === "money" && /1 waiting/.test(said[0].title)
      && /connection reset by peer/.test(said[0].body) && said[0].link === "/crew?s=money&a=pay", said);
  await inbox("evt-stuck-2", 40);
  const second = await watch();
  const now = await stuckAlerts();
  ok("0422: the next watch with two waiting keeps ONE open alert, its words current", second === 2 && now.length === 1 && /2 waiting/.test(now[0].title), now);
  ok("0422: the watch is the scheduler's — no API role can call it",
    !(await q1(`select has_function_privilege('anon', 'public.watch_webhook_inbox()', 'execute') a`)).a
      && !(await q1(`select has_function_privilege('authenticated', 'public.watch_webhook_inbox()', 'execute') a`)).a);
  ok("0422: it runs every ten minutes", (await n(`select count(*) n from cron.job where jobname = 'webhook-watch' and schedule = '*/10 * * * *' and command like '%watch_webhook_inbox()%'`)) === 1);
}

// ── the tenant, asked once a query ───────────────────────────────────────────────────────────────────────────────
{
  ok("0422: every tenant isolation policy asks effective_tenant() in a sub-select — none per row, none lost",
    (await unwrapped()) === 0 && (await isolation()) === policiesBefore, { unwrapped: await unwrapped(), policies: await isolation(), before: policiesBefore });
  const shape = await q1(`select p.polpermissive, p.polcmd, pg_get_expr(p.polqual, p.polrelid) q, pg_get_expr(p.polwithcheck, p.polrelid) c
    from pg_policy p where p.polname = 'tenant isolation' and p.polrelid = 'public.alerts'::regclass`);
  ok("0422: …still restrictive, still every command, the same rule for reads and writes",
    shape.polpermissive === false && shape.polcmd === "*" && /effective_tenant/.test(shape.q) && shape.q === shape.c, shape);
  // The rule's answer, unchanged: an owner of the founding business sees its alerts and not another's.
  const guard = (await q(`select tgname from pg_trigger where tgfoid = 'public.guard_second_tenant()'::regprocedure`)).map((r) => r.tgname);
  for (const t of guard) await db.exec(`alter table public.tenants disable trigger "${t}"`);
  await q(`insert into public.tenants (id, slug, name) values ($1, 'made-up-second', 'A made-up second business') on conflict (id) do nothing`, [T2]);
  for (const t of guard) await db.exec(`alter table public.tenants enable trigger "${t}"`);
  await q(`insert into public.alerts (severity, category, title, tenant_id) values ('important', 'system', 'Made-up: the founding business', $1), ('important', 'system', 'Made-up: another business', $2)`, [T1, T2]);
  const seen = await as(ALEX, `select title from public.alerts where title like 'Made-up:%' order by title`);
  ok("0422: an owner still sees their own business's alerts and not another's (the rule's answer is the same)",
    !seen.error && seen.rows.length === 1 && seen.rows[0].title === "Made-up: the founding business", seen);
  const plan = await as(ALEX, `explain select title from public.alerts`);
  const text = plan.rows.map((r) => Object.values(r)[0]).join("\n");
  ok("0422: …and the planner asks the tenant once for the query (an InitPlan), not once a row", !plan.error && /InitPlan/i.test(text), text.slice(0, 400));
}

console.log(`\nR15 DB — A BOOKING ONCE, A STUCK EVENT SAID, THE TENANT ASKED ONCE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
