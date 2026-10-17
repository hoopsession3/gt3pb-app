// R18 — A STAFF INVITE WAITS FOR A PROVEN ADDRESS, MONEY KEEPS ITS DOORS, A JOB THAT STOPPED IS SAID, RUN IN POSTGRES
// (2026-10-17; Ryan: "Keep working to improve to a 10").
//
//   0423  claim_team_invites + invite_email_proven + claim_invites_on_proof (the security pass, SEC1); money_columns_guard
//         on shop orders, their lines, jug counts and expenses (database F2); business_day() where current_date stood
//         (database F4); cron_watch says a job that stopped and requests the database sent that failed (database F8,
//         operations F11); the public buckets' types and sizes (SEC3); four foreign-key indexes (database F19).
//
// What is run here is the whole schema up to 0422, the findings reproduced on it, then 0423 — twice — as the roles that
// call it. Every person, address and order is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M423 = readFileSync(join(ROOT, "supabase/migrations/0423_an_invite_waits_for_a_proven_address_money_keeps_its_doors_a_stopped_job_is_said.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c423000-0000-4000-8000-0000000000c1";   // the owner who invites
const CREW = "0c423000-0000-4000-8000-0000000000c2";    // an operator on the crew
const ADMIN = "0c423000-0000-4000-8000-0000000000c3";   // an admin
const MEMBER = "0c423000-0000-4000-8000-0000000000a1";  // a customer

const t0 = Date.now();
const db = await fullSchema({ before: "0423" });
console.log(`the schema to 0422 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
for (const [id, role, name] of [[OWNER, "owner", "Alex Rivera"], [CREW, "operator", "Kim Lee"], [ADMIN, "admin", "Dana Cole"], [MEMBER, "member", "Sam Ito"]]) {
  await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4, is_admin = ($2 in ('owner', 'admin')) where id = $1`, [id, role, T1, name]);
}
const invite = (email, role = "operator") => q(`insert into public.team_invites (email, role, invited_by, tenant_id) values ($1, $2, $3, $4) returning id`, [email, role, OWNER, T1]);
const signUp = async (email, { password = "", confirmed = false } = {}) =>
  (await q1(`insert into auth.users (email, encrypted_password, email_confirmed_at) values ($1, $2, case when $3 then now() else null end) returning id`, [email, password, confirmed])).id;
const prove = (id) => q(`update auth.users set email_confirmed_at = now() where id = $1`, [id]);
const roleOf = async (id) => (await q1(`select role from public.profiles where id = $1`, [id]))?.role ?? null;
const claimedBy = async (email) => (await q1(`select claimed_by::text c from public.team_invites where email = $1 order by created_at desc limit 1`, [email]))?.c ?? null;
const passwordOf = async (id) => (await q1(`select encrypted_password p from auth.users where id = $1`, [id])).p;

// ── before 0423: the findings, reproduced ─────────────────────────────────────────────────────────────────────────────
{
  await invite("kai@example.test");
  const kai = await signUp("kai@example.test", { password: "a-strangers-hash" });
  ok("before 0423: an account made with an invited address and a password, never proven, held the invite's role at once",
    (await roleOf(kai)) === "operator" && (await claimedBy("kai@example.test")) === kai);
  const so = await as("service", `insert into public.shop_orders (email, subtotal_cents, total_cents, status, tenant_id) values ('sam@example.test', 4200, 4200, 'paid', $1) returning id`, [T1]);
  const edit = await as(CREW, `update public.shop_orders set refund_amount_cents = 4200, status = 'refunded' where id = $1 returning id`, [so.rows[0].id]);
  ok("before 0423: any crew role rewrote a shop order's refund and status straight through the API", !so.error && !edit.error && edit.rows.length === 1, [so.error, edit.error]);
  const ex = await as(CREW, `insert into public.expenses (category, description, amount_cents, created_by) values ('supplies', 'ice', 1500, $1) returning id`, [CREW]);
  const exEdit = await as(CREW, `update public.expenses set amount_cents = 15 where id = $1 returning id`, [ex.rows[0]?.id]);
  ok("before 0423: …and an expense's amount", !ex.error && !exEdit.error && exEdit.rows.length === 1, [ex.error, exEdit.error]);
  ok("before 0423: market_live asked current_date (the UTC calendar)", /CURRENT_DATE/i.test((await q1(`select pg_get_viewdef('public.market_live') d`)).d));
}

await db.exec(M423);
await db.exec(M423);   // a second run changes nothing
// 0423 loads on the schema to 0422, and loads again — a throw above fails this file; a milestone, not counted as a check.

// ── a staff invite waits for a proven address ────────────────────────────────────────────────────────────────────────
{
  await invite("lee@example.test");
  const lee = await signUp("lee@example.test", { password: "a-strangers-hash" });
  ok("0423: an account made with an invited address and a password is a member until the address is proven — the invite waits",
    (await roleOf(lee)) === "member" && (await claimedBy("lee@example.test")) === null);
  await prove(lee);
  ok("0423: …proven (the emailed code or link), the invite is claimed and the role given", (await roleOf(lee)) === "operator" && (await claimedBy("lee@example.test")) === lee);
  ok("0423: …and the password set before the proof is gone — the stranger who set it is not in", (await passwordOf(lee)) === "");

  await invite("mo@example.test", "event_manager");
  const mo = await signUp("mo@example.test");
  ok("0423: a code sign-in (no password) waits too", (await roleOf(mo)) === "member" && (await claimedBy("mo@example.test")) === null);
  await prove(mo);
  ok("0423: …and is claimed the moment the code proves the address", (await roleOf(mo)) === "event_manager" && (await claimedBy("mo@example.test")) === mo);

  await invite("ana@example.test");
  const ana = await signUp("ana@example.test", { confirmed: true });
  ok("0423: an address a provider vouched for, with no password (Sign in with Apple), claims at sign-up", (await roleOf(ana)) === "operator" && (await claimedBy("ana@example.test")) === ana);

  await invite("raj@example.test");
  const raj = await signUp("raj@example.test", { password: "a-hash", confirmed: true });
  ok("0423: a password account that arrived already 'confirmed' (no proof asked) does not take the invite — it waits for an owner",
    (await roleOf(raj)) === "member" && (await claimedBy("raj@example.test")) === null && (await passwordOf(raj)) === "a-hash");

  const zoe = await signUp("zoe@example.test", { password: "zoes-own-hash" });
  await prove(zoe);
  ok("0423: with no invite waiting, proving an address keeps its password (only an invite's address is protected)", (await passwordOf(zoe)) === "zoes-own-hash" && (await roleOf(zoe)) === "member");

  const again = await q1(`select public.claim_team_invites($1, 'lee@example.test') n`, [lee]);
  ok("0423: an invite already claimed is not claimed again", Number(again.n) === 0 && (await roleOf(lee)) === "operator");
  const call = await as(MEMBER, `select public.claim_team_invites($1, 'nobody@example.test')`, [MEMBER]);
  ok("0423: the claim is not a door anyone can call (signed in or not)", /permission denied/i.test(call.error ?? "") && /permission denied/i.test((await as(null, `select public.claim_team_invites($1, 'x@example.test')`, [MEMBER])).error ?? ""), call.error);
  ok("0423: an existing crew role is never lowered by a claim", (await q1(`select public.claim_team_invites($1, 'kim@example.test') n`, [CREW])) && (await roleOf(CREW)) === "operator");
}

// ── the money on a shop order, a jug count and an expense keeps its doors ────────────────────────────────────────────
{
  const so = await as("service", `insert into public.shop_orders (email, subtotal_cents, total_cents, status, tenant_id) values ('nia@example.test', 3000, 3000, 'paid', $1) returning id`, [T1]);
  ok("0423: the checkout (the server) still makes a shop order", !so.error, so.error);
  const id = so.rows[0].id;
  const make = await as(CREW, `insert into public.shop_orders (email, subtotal_cents, total_cents, status, tenant_id) values ('x@example.test', 1, 1, 'paid', $1)`, [T1]);
  ok("0423: a page cannot make a shop order", make.code === "42501", make);
  for (const [col, val] of [["total_cents", 1], ["refund_amount_cents", 3000], ["status", "'refunded'"], ["payment_id", "'pay_fake'"], ["user_id", `'${MEMBER}'`]]) {
    const r = await as(CREW, `update public.shop_orders set ${col} = ${val} where id = $1`, [id]);
    ok(`0423: a crew page cannot change a shop order's ${col}`, r.code === "42501" && r.error.includes(col), r);
  }
  const note = await as(CREW, `update public.shop_orders set note = 'left at the side door' where id = $1 returning id`, [id]);
  ok("0423: …a note on it still writes as before", !note.error && note.rows.length === 1, note.error);
  const adm = await as(ADMIN, `update public.shop_orders set refund_amount_cents = 500 where id = $1 returning id`, [id]);
  ok("0423: an admin can correct one", !adm.error && adm.rows.length === 1, adm.error);

  const line = await as("service", `insert into public.shop_order_items (order_id, title, qty, unit_cents, cost_cents) values ($1, 'GT3 tee', 1, 3000, 1200) returning id`, [id]);
  ok("0423: the checkout still writes its lines", !line.error, line.error);
  const lineMake = await as(CREW, `insert into public.shop_order_items (order_id, title, qty, unit_cents) values ($1, 'free tee', 9, 0)`, [id]);
  const linePrice = await as(CREW, `update public.shop_order_items set unit_cents = 1 where id = $1`, [line.rows[0].id]);
  ok("0423: a page cannot add a line or change its price", lineMake.code === "42501" && linePrice.code === "42501", [lineMake, linePrice]);

  const jug = await as(CREW, `insert into public.jug_ledger (jugs_out, jugs_in, note) values (5, 0, 'hand count')`);
  ok("0423: a page cannot write a jug count (the delivery's door does)", jug.code === "42501", jug);
  const jugRow = await as("service", `insert into public.jug_ledger (jugs_out, jugs_in, balance_after) values (3, 0, 3) returning id`);
  const jugEdit = await as(CREW, `update public.jug_ledger set jugs_in = 3 where id = $1`, [jugRow.rows[0].id]);
  ok("0423: …nor change one", !jugRow.error && jugEdit.code === "42501", [jugRow.error, jugEdit]);

  const ex = await as(CREW, `insert into public.expenses (category, description, amount_cents, created_by) values ('supplies', 'cups', 2400, $1) returning id`, [CREW]);
  ok("0423: the crew still log a purchase", !ex.error && ex.rows.length === 1, ex.error);
  const eid = ex.rows[0].id;
  const voidedNew = await as(CREW, `insert into public.expenses (category, amount_cents, created_by, voided_at) values ('supplies', 100, $1, now())`, [CREW]);
  ok("0423: …but not one logged already voided", voidedNew.code === "42501", voidedNew);
  for (const [col, val] of [["amount_cents", 24], ["spent_on", "current_date - 40"], ["voided_at", "now()"], ["created_by", `'${ADMIN}'`]]) {
    const r = await as(CREW, `update public.expenses set ${col} = ${val} where id = $1`, [eid]);
    ok(`0423: a crew page cannot change an expense's ${col}`, r.code === "42501", r);
  }
  const desc = await as(CREW, `update public.expenses set description = 'cups, 16 oz', receipt_path = 'r/1.jpg' where id = $1 returning id`, [eid]);
  ok("0423: …its words and its receipt still write", !desc.error && desc.rows.length === 1, desc.error);
  const voided = await as(CREW, `select (public.void_expense($1, 'logged twice')).voided_at is not null v`, [eid]);
  ok("0423: voiding goes through its own door (void_expense), for the crew as before", !voided.error && voided.rows[0].v === true, voided.error);
  const ex2 = await as(CREW, `insert into public.expenses (category, amount_cents, created_by) values ('supplies', 900, $1) returning id`, [CREW]);
  const fix = await as(ADMIN, `update public.expenses set amount_cents = 990 where id = $1 returning amount_cents`, [ex2.rows[0].id]);
  ok("0423: Money's spend editor (an owner or admin) still corrects an amount", !fix.error && fix.rows[0]?.amount_cents === 990, fix.error);

  ok("0423: the guard stands on the eight money tables", (await n(`select count(*) n from pg_trigger where tgname = 'a_money_columns_guard'`)) === 8);
  const pack = await as(CREW, `update public.drop_orders set paid = true where false`);
  ok("0423: 0420's four tables keep their guard (the function was rewritten, not narrowed)", !pack.error
    && /'drop_orders' +then array\['paid'/.test((await q1(`select prosrc from pg_proc where proname = 'money_columns_guard'`)).prosrc), pack.error);
}

// ── the business day where the calendar was still UTC ────────────────────────────────────────────────────────────────
{
  const def = async (sql) => (await q1(sql)).d;
  const ml = await def(`select pg_get_viewdef('public.market_live') d`), ao = await def(`select pg_get_viewdef('public.all_orders') d`);
  ok("0423: market_live and all_orders ask business_day(), not the UTC calendar", /business_day\(\)/.test(ml) && !/CURRENT_DATE/i.test(ml) && /business_day\(\)/.test(ao) && !/CURRENT_DATE/i.test(ao));
  const ro = await def(`select prosrc d from pg_proc where proname = 'respond_to_offer'`), eb = await def(`select prosrc d from pg_proc where proname = 'account_erasure_blockers'`);
  ok("0423: respond_to_offer and account_erasure_blockers ask business_day() too", /business_day\(\)/.test(ro) && !/current_date/.test(ro) && (eb.match(/business_day\(\)/g) || []).length === 2 && !/current_date/.test(eb));
  ok("0423: market_live stays readable signed out (its grants kept)", !(await as(null, `select market from public.market_live limit 1`)).error);
  const today = (await q1(`select public.business_day()::text d`)).d;
  await q(`insert into public.markets (slug, name, opens_on) values ('test-today', 'Test Today', $1::date), ('test-tomorrow', 'Test Tomorrow', $1::date + 1) on conflict (slug) do update set opens_on = excluded.opens_on`, [today]);
  const live = await q(`select market, pre_launch from public.market_live where market in ('test-today', 'test-tomorrow') order by market`);
  ok("0423: a city opening on the business day is open, one opening tomorrow is still to come", JSON.stringify(live.map((r) => r.pre_launch)) === "[false,true]", live);
}

// ── a job that stopped, and a request the database sent that failed, are said ────────────────────────────────────────
{
  const job = async (name) => (await q1(`insert into cron.job (jobname, schedule, command) values ($1, '*/10 * * * *', 'select 1') returning jobid`, [name])).jobid;
  const ran = (jobid, minutesAgo, status = "succeeded") => q(`insert into cron.job_run_details (jobid, status, return_message, start_time, end_time)
    values ($1, $2, '', now() - make_interval(mins => $3), now() - make_interval(mins => $3) + interval '1 second')`, [jobid, status, minutesAgo]);
  const stopped = await job("stopped-job"), fine = await job("fine-job"), daily = await job("daily-job"), young = await job("young-job");
  for (const m of [120, 130, 140, 150]) await ran(stopped, m);   // every ten minutes, then nothing for two hours
  for (const m of [5, 15, 25]) await ran(fine, m);
  for (const m of [20 * 60, 44 * 60, 68 * 60]) await ran(daily, m);   // once a day, last 20 hours ago
  for (const m of [300, 310]) await ran(young, m);                     // two runs: too few to know its rhythm
  const said = Number((await q1(`select public.cron_watch() n`)).n);
  const stalled = await q(`select title, body, severity, category, link from public.alerts where kind = 'cron_stalled' and ack_at is null`);
  ok("0423: a job that started every ten minutes and has gone two hours without starting is said, once",
    stalled.length === 1 && stalled[0].title === "A scheduled job stopped running — stopped-job" && /every 10 minutes/.test(stalled[0].body)
      && /ET\.$/.test(stalled[0].body) && stalled[0].severity === "important" && stalled[0].category === "system" && said >= 1, stalled);
  ok("0423: a job on its rhythm, a daily one inside three days, and one with too few runs to know are not", stalled.every((a) => !/fine-job|daily-job|young-job/.test(a.title)));
  await q(`select public.cron_watch()`);
  ok("0423: watched again, it is still one alert (alert_open_once)", (await n(`select count(*) n from public.alerts where kind = 'cron_stalled' and ack_at is null`)) === 1);

  ok("0423: nothing the database sent has failed → nothing said", (await n(`select count(*) n from public.alerts where kind = 'db_http_failed'`)) === 0);
  await q(`insert into net._http_response (id, status_code, timed_out, error_msg, created) values (1, 200, false, null, now() - interval '2 minutes'),
    (2, 500, false, null, now() - interval '90 minutes')`);
  await q(`select public.cron_watch()`);
  ok("0423: a success, and a failure an hour and a half ago, are not said", (await n(`select count(*) n from public.alerts where kind = 'db_http_failed'`)) === 0);
  await q(`insert into net._http_response (id, status_code, timed_out, error_msg, created) values (3, 401, false, null, now() - interval '3 minutes'),
    (4, null, true, null, now() - interval '1 minute')`);
  await q(`select public.cron_watch()`);
  const http = await q(`select title, body from public.alerts where kind = 'db_http_failed' and ack_at is null`);
  ok("0423: requests that failed in the last twenty minutes are one alert, counting them and saying the last",
    http.length === 1 && http[0].title === "Requests the database sends are failing — 2 in 20 minutes" && /The last said: timed out\.$/.test(http[0].body), http);
  ok("0423: cron_watch is not a door anyone can call", /permission denied/i.test((await as(MEMBER, `select public.cron_watch()`)).error ?? ""));
}

// ── what a public bucket takes, and the indexes ──────────────────────────────────────────────────────────────────────
{
  const b = await q(`select id, file_size_limit::bigint s, allowed_mime_types t from storage.buckets where id in ('content', 'shop', 'brand', 'training') order by id`);
  const by = Object.fromEntries(b.map((r) => [r.id, r]));
  ok("0423: content takes images and videos up to 100 MB", Number(by.content?.s) === 104857600 && JSON.stringify(by.content?.t) === '["image/*","video/*"]', by.content);
  ok("0423: the shop takes its own list of types (lib/shopMedia), up to 100 MB", Number(by.shop?.s) === 104857600 && by.shop?.t?.length === 8 && by.shop.t.includes("video/quicktime") && !by.shop.t.includes("image/svg+xml"), by.shop);
  ok("0423: brand and training take images up to 12 MB", ["brand", "training"].every((k) => Number(by[k]?.s) === 12582912 && JSON.stringify(by[k]?.t) === '["image/*"]'), [by.brand, by.training]);
  ok("0423: the four foreign keys the alerts and money doors walk are indexed",
    (await n(`select count(*) n from pg_indexes where indexname in ('orders_collected_by_idx', 'drop_orders_collected_by_idx', 'loyalty_ledger_by_user_idx', 'alerts_ack_by_idx')`)) === 4);
  ok("0423: recorded in the ledger", (await n(`select count(*) n from public.schema_migrations where version like '0423_%'`)) === 1);
}

console.log(`\nR18 — 0423, IN POSTGRES: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
