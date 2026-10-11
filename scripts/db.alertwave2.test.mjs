// WAVE 2 · ALERTS — 0372, 0373 and 0374, executed from their files against the whole schema (every migration before
// them, in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does.
//
//   0372  a raise while the same alert is open is counted on its line, not written again — so it does not push again
//   0373  a critical nobody acknowledges in ten minutes is sent again, once, to its people and every admin and owner
//   0374  "Ring this phone": a real alert to the signed-in person's own devices, once a minute, shown to nobody else
//
// Each defect is shown first on the schema as production has it, then fixed. Pushes are counted at the one door they
// all go through: supabase_functions.http_request, the trigger function 0157 calls (and 0373 calls again). PGlite has
// no pg_net, so the stand-in records each call — the alert, INSERT or UPDATE, and which trigger — instead of making it.
// Time passes the way db.alertnoise has it pass: every stored clock that matters is moved back.
//
// MODELED from production as measured: Supabase's default grants (every table in public to anon and authenticated —
// RLS is what stands between them and the rows — and every new function executable by both, 0366/0367).
// NOT MODELED: the push function itself (Deno, the network) — what it does with each call is
// scripts/push.policy.test.mjs's; pg_cron (cron.schedule is the schema fixture's recorder: the job and its schedule
// are checked, and each run is the function called by hand); Realtime (it asks the same SELECT policies tested here).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F372 = "0372_an_alert_already_open_is_counted_not_sent_again.sql";
const F373 = "0373_a_critical_nobody_picks_up_rings_the_owners_again.sql";
const F374 = "0374_ring_this_phone.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0a1e7700-0000-4000-8000-0000000000f2";
const OWNER = "0a1e7700-0000-4000-8000-0000000000a1", ADMIN = "0a1e7700-0000-4000-8000-0000000000a2",
  MANAGER = "0a1e7700-0000-4000-8000-0000000000a3", SERVER = "0a1e7700-0000-4000-8000-0000000000a4",
  MEMBER = "0a1e7700-0000-4000-8000-0000000000a5", OTHER = "0a1e7700-0000-4000-8000-0000000000b1";
const ORDER_A = "0a1e7700-0000-4000-8000-00000000c0a1", TASK = "0a1e7700-0000-4000-8000-00000000c0b1", BREW = "0a1e7700-0000-4000-8000-00000000c0c1";

const t0 = Date.now();
const db = await fullSchema({ before: "0372" });
console.log(`the schema before 0372 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const num = async (s, p) => Number(Object.values((await q1(s, p)) ?? { n: NaN })[0]);
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
// As a person, through PostgREST's roles: { rows, error, code, detail }.
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null, code: null, detail: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null, detail: e.detail ?? null }; }
  finally { await root(); }
};

// ── the world ────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(`
  -- Supabase's own defaults, as production has them (0366/0367 measured the function half): RLS is the only guard.
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  -- The door every push goes through, recorded instead of called.
  create table public.test_pushes (n bigserial primary key, alert_id uuid, op text, trig text, at timestamptz default now());
  create or replace function supabase_functions.http_request() returns trigger language plpgsql security definer as $$
  begin
    if TG_TABLE_NAME = 'alerts' then insert into public.test_pushes (alert_id, op, trig) values (new.id, TG_OP, TG_NAME); end if;
    return new;
  end $$;
`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on';
  insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar'); commit;`);
for (const [id, role, tenant] of [[OWNER, "owner", T1], [ADMIN, "admin", T1], [MANAGER, "event_manager", T1], [SERVER, "server", T1], [MEMBER, "member", T1], [OTHER, "owner", T2]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, tenant, `Made-up ${role}`]);
}
// Devices: the owner's browser, the admin's iPhone app, the server's browser, the other business's owner. The
// manager and the member have none.
for (const [uid, endpoint, platform, tenant] of [[OWNER, "https://push.example.test/owner", "web", T1], [ADMIN, `apns:${"ab".repeat(32)}`, "apns", T1],
  [SERVER, "https://push.example.test/server", "web", T1], [OTHER, "https://push.example.test/other", "web", T2]]) {
  await db.query(`insert into public.push_subscriptions (endpoint, platform, p256dh, auth, user_id, is_admin, tenant_id)
    values ($1, $2, $3, $4, $5, true, $6)`, [endpoint, platform, platform === "web" ? "B".repeat(87) : null, platform === "web" ? "a".repeat(22) : null, uid, tenant]);
}

const pushes = () => num(`select count(*) n from public.test_pushes`);
const pushesOf = (id) => num(`select count(*) n from public.test_pushes where alert_id = $1`, [id]);
const raise = (a) => db.query(`insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id, escalate_after_min)
  values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, '${T1}'::uuid), $10)`,
  [a.severity ?? "important", a.category ?? "order", a.kind ?? null, a.subject ?? null, a.title ?? "t", a.body ?? null, a.link ?? "/crew", a.target ?? null, a.tenant ?? null, a.window ?? null]);
const lines = (kind, subject) => q(`select id, severity, title, body, occurrences, last_seen_at, ack_at, ack_by, target_user_id, tenant_id, created_at, escalated_at
  from public.alerts where kind = $1 and subject_id is not distinct from $2 order by created_at, id`, [kind, subject ?? null]);
const open = async (kind, subject) => (await lines(kind, subject)).filter((l) => l.ack_at === null);
const age = (id, by) => db.query(`update public.alerts set created_at = created_at - $2::interval, last_seen_at = last_seen_at - $2::interval where id = $1`, [id, by]);

// ── BEFORE 0372 · 0373 · 0374: the defects, on the schema as production has it ─────────────────────────────────────
{
  const p0 = await pushes();
  await raise({ severity: "critical", category: "money", kind: "refund_needed", subject: ORDER_A, title: "Voided a PAID order — refund needed", body: "first" });
  await raise({ severity: "critical", category: "money", kind: "refund_needed", subject: ORDER_A, title: "Voided a PAID order — refund needed", body: "second" });
  ok("before 0372: the same refund raised twice while the first is open is two lines in the inbox",
    (await open("refund_needed", ORDER_A)).length === 2, await lines("refund_needed", ORDER_A));
  ok("before 0372: …and two pushes — the INSERT is what rings (0157), and both were INSERTs", (await pushes()) === p0 + 2, (await pushes()) - p0);

  let refused = null;
  try { await raise({ category: "delivery", title: "New delivery order" }); } catch (e) { refused = String(e.message || e); }
  ok("before: the push function's own \"New delivery order\" alert (category 'delivery') is refused by 0232 — it has never been written, so its push never came",
    /alerts_category_canon/.test(refused ?? ""), refused);
  let refusedDrop = null;
  try { await raise({ category: "drop", title: "New reserve" }); } catch (e) { refusedDrop = String(e.message || e); }
  ok("before: …nor \"New reserve\" (category 'drop')", /alerts_category_canon/.test(refusedDrop ?? ""), refusedDrop);

  // 0174's escalation: thirty minutes, a lane owner, and no lane has one.
  await raise({ severity: "critical", category: "money", kind: "chargeback_open", subject: ORDER_A, title: "A card dispute was opened" });
  const cb = (await open("chargeback_open", ORDER_A))[0];
  await age(cb.id, "40 minutes");
  const p1 = await pushes();
  const sent = await num(`select public.escalate_unacked_criticals() n`);
  const after = (await lines("chargeback_open", ORDER_A));
  ok("before 0373: a critical nobody answered for forty minutes is marked escalated…", after[0].escalated_at !== null, after);
  ok("before 0373: …and nothing is sent to anyone: no lane has an owner (0159 seeds none), so no critical has ever escalated",
    sent === 0 && after.length === 1 && (await pushes()) === p1, { sent, rows: after.length, pushes: (await pushes()) - p1 });
  ok("before 0373: and anyone the API lets in could run it",
    (await q1(`select has_function_privilege('anon', 'public.escalate_unacked_criticals()', 'execute') a`)).a === true);
  ok("before 0374: there is no way to ring your own phone", (await q1(`select to_regprocedure('public.ring_my_devices()') r`)).r === null);
  await db.exec(`delete from public.alerts where kind = 'chargeback_open'`);
}

// ── 0372 · AN ALERT ALREADY OPEN IS COUNTED, NOT SENT AGAIN ──────────────────────────────────────────────────────────
{
  const sql372 = MIG(F372);
  const p0 = await pushes();
  await db.exec(sql372);
  ok("0372 applies to the whole schema", true);
  const two = await lines("refund_needed", ORDER_A);
  const kept = two.filter((l) => l.ack_at === null);
  ok("0372: the two lines already open become one — the newest stays open, carrying both counts",
    kept.length === 1 && kept[0].id === two[1].id && Number(kept[0].occurrences) === 2, two);
  ok("0372: …the other closed by the mechanism (ack_by null) and kept for history, and applying it rang nobody",
    two[0].ack_at !== null && two[0].ack_by === null && (await pushes()) === p0, { first: two[0], pushes: (await pushes()) - p0 });

  // A repeat raise while it is open.
  const line = kept[0];
  await age(line.id, "5 minutes");
  const p1 = await pushes();
  await raise({ severity: "critical", category: "money", kind: "refund_needed", subject: ORDER_A, title: "Voided a PAID order — refund needed", body: "the latest words" });
  const now1 = await lines("refund_needed", ORDER_A);
  const o1 = now1.filter((l) => l.ack_at === null);
  ok("0372: raised again while open — still one open line, and no new row at all", o1.length === 1 && o1[0].id === line.id && now1.length === 2, now1);
  ok("0372: …it counts the raise, says the latest words, and says when it was last raised",
    Number(o1[0].occurrences) === 3 && o1[0].body === "the latest words" && Date.now() - new Date(o1[0].last_seen_at).getTime() < 60_000, o1[0]);
  ok("0372: …and nothing rang — no push, no Teams card, no email: those all fan out from an INSERT", (await pushes()) === p1, (await pushes()) - p1);
  ok("0372: the line keeps its first raise's time — the age of the problem", new Date(o1[0].created_at).getTime() < Date.now() - 4 * 60_000);

  // Acknowledged, then raised: a new first raise.
  await db.exec(`update public.alerts set ack_at = now(), ack_by = '${OWNER}' where id = '${line.id}'`);
  const p2 = await pushes();
  await raise({ severity: "critical", category: "money", kind: "refund_needed", subject: ORDER_A, title: "Voided a PAID order — refund needed", body: "again" });
  const o2 = await open("refund_needed", ORDER_A);
  ok("0372: once someone acknowledged it, the next raise is a new line and rings — counting is not silencing",
    o2.length === 1 && o2[0].id !== line.id && Number(o2[0].occurrences) === 1 && (await pushes()) === p2 + 1, { o2, pushes: (await pushes()) - p2 });

  // One line per person: a producer that writes the same kind and subject to several people in one INSERT.
  const p3 = await pushes();
  await db.query(`insert into public.alerts (severity, category, kind, subject_id, title, target_user_id)
    values ('important', 'prep', 'prep_signoff_request', $1, 'Prep needs your sign-off', $2),
           ('important', 'prep', 'prep_signoff_request', $1, 'Prep needs your sign-off', $3),
           ('important', 'prep', 'prep_signoff_request', $1, 'Prep needs your sign-off', $4)`, [TASK, OWNER, ADMIN, MANAGER]);
  ok("0372: a sign-off request to three approvers in one insert is three lines and three pushes — each person is owed their own",
    (await open("prep_signoff_request", TASK)).length === 3 && (await pushes()) === p3 + 3, { lines: (await open("prep_signoff_request", TASK)).length, pushes: (await pushes()) - p3 });
  await raise({ kind: "prep_signoff_request", subject: TASK, category: "prep", title: "Prep needs your sign-off", target: ADMIN, body: "asked again" });
  const signoffs = await open("prep_signoff_request", TASK);
  ok("0372: …asked again of one of them, that person's line counts it; the other two are untouched",
    signoffs.length === 3 && Number(signoffs.find((l) => l.target_user_id === ADMIN).occurrences) === 2
    && signoffs.filter((l) => l.target_user_id !== ADMIN).every((l) => Number(l.occurrences) === 1) && (await pushes()) === p3 + 3, signoffs);

  // No key, no fold.
  const p4 = await pushes();
  await raise({ severity: "critical", category: "money", title: "Paid order didn't record — add it", body: "Made-up A" });
  await raise({ severity: "critical", category: "money", title: "Paid order didn't record — add it", body: "Made-up B" });
  ok("0372: an alert with no kind has no key — two are two lines (nothing here matches on a sentence, 0336)",
    (await num(`select count(*) n from public.alerts where kind is null and title = 'Paid order didn''t record — add it' and ack_at is null`)) === 2 && (await pushes()) === p4 + 2);
  await raise({ severity: "critical", category: "money", kind: "ops_incident", title: "Paid shop order didn't record — add it", body: "order one" });
  await raise({ severity: "critical", category: "money", kind: "ops_incident", title: "Paid shop order didn't record — add it", body: "order two" });
  ok("0372: a kind with no subject is not folded either — two paid orders that did not save are two orders, each owed its line",
    (await open("ops_incident", null)).length === 2 && (await pushes()) === p4 + 4);

  // One business's line is not another's.
  const p5 = await pushes();
  await raise({ severity: "important", category: "order", kind: "delivery_held", subject: ORDER_A, title: "Delivery held — pickup queue", tenant: T1 });
  await raise({ severity: "important", category: "order", kind: "delivery_held", subject: ORDER_A, title: "Delivery held — pickup queue", tenant: T2 });
  const held = await open("delivery_held", ORDER_A);
  ok("0372: the same key in another business is that business's own line", held.length === 2 && new Set(held.map((l) => l.tenant_id)).size === 2 && (await pushes()) === p5 + 2, held);
  const asOther = await as(OTHER, `insert into public.alerts (severity, category, kind, subject_id, title, tenant_id)
    values ('important', 'order', 'delivery_held', $1, 'Delivery held — pickup queue', $2)`, [ORDER_A, T1]);
  const held2 = await open("delivery_held", ORDER_A);
  ok("0372: a raise by someone signed in to the other business folds into THEIR line — whatever tenant it names (0134 stamps theirs)",
    asOther.error === null && held2.length === 2 && Number(held2.find((l) => l.tenant_id === T2).occurrences) === 2
    && Number(held2.find((l) => l.tenant_id === T1).occurrences) === 1 && (await pushes()) === p5 + 2, { asOther, held2 });

  // Louder and quieter.
  const p6 = await pushes();
  await raise({ severity: "fyi", category: "order", kind: "shop_order_new", subject: TASK, title: "New shop order 🧢", body: "quiet" });
  const fyiLine = (await open("shop_order_new", TASK))[0];
  await raise({ severity: "critical", category: "order", kind: "shop_order_new", subject: TASK, title: "New shop order 🧢", body: "loud" });
  const loud = await lines("shop_order_new", TASK);
  const loudOpen = loud.filter((l) => l.ack_at === null);
  ok("0372: a louder raise is not folded into a quieter line — the quiet line closes (the mechanism) and the louder one is written",
    loud.length === 2 && loudOpen.length === 1 && loudOpen[0].severity === "critical" && loud[0].id === fyiLine.id && loud[0].ack_at !== null && loud[0].ack_by === null, loud);
  ok("0372: …carrying the count, and it rings", Number(loudOpen[0].occurrences) === 2 && (await pushesOf(loudOpen[0].id)) === 1);
  await raise({ severity: "fyi", category: "order", kind: "shop_order_new", subject: TASK, title: "New shop order 🧢", body: "quiet again" });
  const after = await open("shop_order_new", TASK);
  ok("0372: a quieter raise folds into the louder line, which stays critical — a line does not change class under the person reading it",
    after.length === 1 && after[0].id === loudOpen[0].id && after[0].severity === "critical" && Number(after[0].occurrences) === 3 && after[0].body === "quiet again"
    && (await pushes()) === p6 + 2, after);

  // A raise folding into a line the raiser cannot read.
  await raise({ severity: "important", category: "task", kind: "thread_reply_task", subject: TASK, title: "Someone replied", body: "one", target: OWNER });
  const reply = (await open("thread_reply_task", TASK))[0];
  const p7 = await pushes();
  const byServer = await as(SERVER, `insert into public.alerts (severity, category, kind, subject_id, title, body, target_user_id)
    values ('important', 'task', 'thread_reply_task', $1, 'A server replied', 'two', $2)`, [TASK, OWNER]);
  const replies = await open("thread_reply_task", TASK);
  const seen = await as(SERVER, `select id from public.alerts where id = $1`, [reply.id]);
  ok("0372: a crew member's second reply to the owner folds into the owner's line — a line the crew member cannot read",
    byServer.error === null && replies.length === 1 && Number(replies[0].occurrences) === 2 && replies[0].body === "two" && (await pushes()) === p7, { byServer, replies });
  ok("0372: …and still cannot read it (0157's rules are unchanged)", seen.error === null && seen.rows.length === 0, seen);

  // Nobody the insert policy refuses can fold. Postgres checks that policy after BEFORE triggers, and a folded raise
  // is never inserted — so the trigger must ask first, or a stranger could rewrite an open line's words through it.
  const refund = (await open("refund_needed", ORDER_A))[0];
  const p7b = await pushes();
  const forge = (uid) => as(uid, `insert into public.alerts (severity, category, kind, subject_id, title, body)
    values ('critical', 'money', 'refund_needed', $1, 'Refund needed', 'REWRITTEN')`, [ORDER_A]);
  const byAnon = await forge(null), byMember = await forge(MEMBER);
  const after7 = (await open("refund_needed", ORDER_A))[0];
  ok("0372: a stranger's or a customer's \"raise\" of an open line is refused by the insert policy, as before — not folded into it",
    /row-level security/i.test(byAnon.error ?? "") && /row-level security/i.test(byMember.error ?? ""), { byAnon, byMember });
  ok("0372: …and the line is untouched: same words, same count, nothing rang",
    after7.id === refund.id && after7.body === refund.body && Number(after7.occurrences) === Number(refund.occurrences) && (await pushes()) === p7b, { before: refund, after: after7 });

  // alert_open_once keeps working through it.
  const p8 = await pushes();
  await db.exec(`select public.alert_open_once('heartbeat_stale', null, 'important', 'system', 'The uptime check went quiet', 'one', '/crew')`);
  await db.exec(`select public.alert_open_once('heartbeat_stale', null, 'important', 'system', 'The uptime check went quiet', 'two', '/crew')`);
  const hb = await open("heartbeat_stale", null);
  ok("0372: alert_open_once still opens one line (it rings) and refreshes it (it does not)", hb.length === 1 && hb[0].body === "two" && (await pushes()) === p8 + 1, hb);
  await db.exec(`select public.alert_open_once('compliance_changed', '${TASK}', 'important', 'prep', 'A permit rule has changed — x', 'b1', '/crew?s=prep')`);
  await raise({ severity: "important", category: "prep", kind: "compliance_changed", subject: TASK, title: "A permit rule has changed — x", body: "b2" });
  const cc = await open("compliance_changed", TASK);
  ok("0372: a plain raise of a line alert_open_once opened folds into it", cc.length === 1 && Number(cc[0].occurrences) === 2 && cc[0].body === "b2" && (await pushes()) === p8 + 2, cc);

  // Who may call it, how it is defined, and running it twice.
  const g = await q1(`select has_function_privilege('authenticated', 'public.alert_fold_repeat()', 'execute') a,
                             has_function_privilege('anon', 'public.alert_fold_repeat()', 'execute') b,
                             (select prosecdef from pg_proc where proname = 'alert_fold_repeat') d,
                             (select coalesce(proconfig::text, '') from pg_proc where proname = 'alert_fold_repeat') c`);
  ok("0372: the fold is nobody's to call — a trigger's, definer, search_path pinned", g.a === false && g.b === false && g.d === true && /search_path=public/.test(g.c), g);
  const before = { rows: await num(`select count(*) n from public.alerts`), pushes: await pushes(), refund: (await open("refund_needed", ORDER_A))[0] };
  let rerun = null;
  try { await db.exec(sql372); } catch (e) { rerun = String(e.message || e); }
  ok("0372 run again: no error, nothing folded twice, no ring, one changelog line",
    rerun === null && (await num(`select count(*) n from public.alerts`)) === before.rows && (await pushes()) === before.pushes
    && Number((await open("refund_needed", ORDER_A))[0].occurrences) === Number(before.refund.occurrences)
    && (await num(`select count(*) n from public.changelog where title = 'An alert that is already open is counted, not sent again'`)) === 1, rerun);
}

// ── 0369, AFTER 0372: the pass alert still rings until the pass is clear, exactly as db.alertnoise has it ───────────
{
  await db.exec(`delete from public.alerts where kind = 'order_stale'; delete from public.orders;`);
  const later = (mins) => db.exec(`
    update public.orders set created_at = created_at - interval '${mins} minutes', ready_from = ready_from - interval '${mins} minutes';
    update public.alerts set created_at = created_at - interval '${mins} minutes', last_seen_at = last_seen_at - interval '${mins} minutes',
                             ack_at = ack_at - interval '${mins} minutes' where kind = 'order_stale';`);
  const run = () => num(`select public.alert_stale_orders(10) n`);
  const cron = async (mins) => { for (let m = 5; m <= mins; m += 5) { await later(5); await run(); } };
  const stale = () => lines("order_stale", null);
  await db.query(`insert into public.orders (items, total_cents, status, created_at) values ('{rise}', 900, 'new', now() - interval '12 minutes')`);
  const p0 = await pushes();
  await run();
  ok("0369 after 0372: a ticket ten minutes in rings once", (await open("order_stale", null)).length === 1 && (await pushes()) === p0 + 1);
  const first = (await open("order_stale", null))[0];
  await cron(10);
  ok("0369 after 0372: five and ten minutes on, the open line is refreshed, not repeated — no push",
    (await open("order_stale", null)).length === 1 && (await open("order_stale", null))[0].id === first.id && (await pushes()) === p0 + 1);
  await cron(5);
  const o15 = await open("order_stale", null);
  ok("0369 after 0372: fifteen minutes after it rang and still waiting, it rings again — a new line, a new push, one open",
    o15.length === 1 && o15[0].id !== first.id && (await pushes()) === p0 + 2 && (await stale()).length === 2, { o15, pushes: (await pushes()) - p0 });
  await cron(60);
  ok("0369 after 0372: an hour more rings four times, a quarter hour apart, one line open", (await pushes()) === p0 + 6 && (await open("order_stale", null)).length === 1, (await pushes()) - p0);
  await db.exec(`update public.alerts set ack_at = now(), ack_by = '${OWNER}' where kind = 'order_stale' and ack_at is null`);
  const pAck = await pushes();
  await cron(10);
  ok("0369 after 0372: acknowledged, it stays down until fifteen minutes after it rang (0174's cooldown)", (await open("order_stale", null)).length === 0 && (await pushes()) === pAck);
  await cron(5);
  ok("0369 after 0372: …then rings again while tickets wait", (await open("order_stale", null)).length === 1 && (await pushes()) === pAck + 1);
  await db.exec(`update public.orders set status = 'done'`);
  await run();
  ok("0369 after 0372: an empty pass closes the line, with no push", (await open("order_stale", null)).length === 0 && (await pushes()) === pAck + 1);
}

// ── 0373 · A CRITICAL NOBODY PICKS UP RINGS THE OWNERS AGAIN ─────────────────────────────────────────────────────────
let serverTask = null;   // the server's own task alert, read again in the 0374 block
{
  const sql373 = MIG(F373);
  // A critical raised before the escalation existed, half an hour ago and never marked: live, so it may ring once.
  await db.exec(`delete from public.alerts where severity = 'critical'`);
  await db.exec(sql373);
  ok("0373 applies to the whole schema", true);
  const trig = await q(`select tgname, pg_get_triggerdef(oid) d from pg_trigger where tgrelid = 'public.alerts'::regclass and tgname in ('alerts_push_fanout', 'alerts_push_escalation') order by tgname`);
  const callOf = (d) => (/EXECUTE FUNCTION .*$/.exec(d) ?? [""])[0];
  ok("0373: the escalation goes through 0157's door — the same function, with the same arguments, read from the fan-out itself",
    trig.length === 2 && callOf(trig[0].d) !== "" && callOf(trig[0].d) === callOf(trig[1].d), trig.map((t) => t.tgname));
  ok("0373: …on an update of escalated_at, from nothing to a time, of an unacknowledged critical that is not a device test",
    /AFTER UPDATE OF escalated_at ON public\.alerts FOR EACH ROW WHEN \(\(\(old\.escalated_at IS NULL\) AND \(new\.escalated_at IS NOT NULL\) AND \(new\.severity = 'critical'::text\) AND \(new\.ack_at IS NULL\) AND \(new\.kind IS DISTINCT FROM 'device_test'::text\)\)\)/.test(trig.find((t) => t.tgname === "alerts_push_escalation")?.d ?? ""),
    trig.find((t) => t.tgname === "alerts_push_escalation")?.d);
  ok("0373: pg_cron runs it every minute", (await q1(`select schedule from cron.job where jobname = 'escalate-criticals'`))?.schedule === "* * * * *");
  const g = await q1(`select has_function_privilege('anon', 'public.escalate_unacked_criticals()', 'execute') a,
                             has_function_privilege('authenticated', 'public.escalate_unacked_criticals()', 'execute') b`);
  ok("0373: nobody the API lets in can run it", g.a === false && g.b === false, g);

  const mk = async (a) => { await raise(a); return (await lines(a.kind, a.subject ?? null)).at(-1); };
  const esc = () => num(`select public.escalate_unacked_criticals() n`);
  const escPushes = (id) => num(`select count(*) n from public.test_pushes where alert_id = $1 and op = 'UPDATE' and trig = 'alerts_push_escalation'`, [id]);

  const broadcast = await mk({ severity: "critical", category: "money", kind: "refund_needed", subject: ORDER_A, title: "Voided a PAID order — refund needed" });
  await age(broadcast.id, "9 minutes");
  ok("0373: nine minutes in, nothing yet", (await esc()) === 0 && (await escPushes(broadcast.id)) === 0);
  await age(broadcast.id, "2 minutes");
  const n1 = await esc();
  const b1 = (await lines("refund_needed", ORDER_A)).at(-1);
  ok("0373: eleven minutes in and nobody has it — marked escalated and sent again, once, through the door",
    n1 === 1 && b1.escalated_at !== null && b1.ack_at === null && (await escPushes(broadcast.id)) === 1, { n1, b1 });
  ok("0373: …the same line, marked — nothing inserted, the inbox does not grow", (await lines("refund_needed", ORDER_A)).length === 1);
  ok("0373: the next run sends nothing more: sent again once", (await esc()) === 0 && (await escPushes(broadcast.id)) === 1);
  await db.exec(`update public.alerts set escalated_at = now() where id = '${broadcast.id}'`);
  ok("0373: marking it again by hand does not send it again (only the first mark is the door)", (await escPushes(broadcast.id)) === 1);

  // Acknowledged: by the row, or — on a broadcast — by anyone's Got it.
  const acked = await mk({ severity: "critical", category: "money", kind: "refund_unrecorded", subject: ORDER_A, title: "x" });
  await db.exec(`update public.alerts set ack_at = now(), ack_by = '${OWNER}' where id = '${acked.id}'`);
  await age(acked.id, "11 minutes");
  const read = await mk({ severity: "critical", category: "money", kind: "chargeback_open", subject: ORDER_A, title: "A card dispute was opened" });
  const gotIt = await as(MANAGER, `insert into public.alert_reads (alert_id, user_id) values ($1, $2)`, [read.id, MANAGER]);
  await age(read.id, "11 minutes");
  const n2 = await esc();
  ok("0373: acknowledged before ten minutes — not sent", (await escPushes(acked.id)) === 0);
  ok("0373: a broadcast someone tapped Got it on is acknowledged — the read row says somebody has it — not sent",
    gotIt.error === null && (await escPushes(read.id)) === 0 && n2 === 0, { gotIt, n2 });

  // Which criticals.
  const imp = await mk({ severity: "important", category: "order", kind: "delivery_not_home", subject: ORDER_A, title: "x" });
  const task = await mk({ severity: "critical", category: "task", kind: "task_assigned", subject: TASK, title: "Assigned to you: x", target: SERVER });
  serverTask = task.id;
  const brew = await mk({ severity: "critical", category: "brew", kind: "brew_start_now", subject: BREW, title: "⏰ Start RISE now", target: SERVER, window: 30 });
  const old = await mk({ severity: "critical", category: "system", kind: "client_error", subject: TASK, title: "App error — a screen crashed" });
  for (const a of [imp, task, brew]) await age(a.id, "11 minutes");
  await age(old.id, "13 hours");
  const n3 = await esc();
  ok("0373: an important is not escalated — only a critical", (await escPushes(imp.id)) === 0);
  ok("0373: a task given to someone and flagged critical is theirs — not sent up to the owner who assigned it", (await escPushes(task.id)) === 0);
  ok("0373: a person's own critical that carries a window (the brew ladder's start-now) is", (await escPushes(brew.id)) === 1 && n3 === 1, n3);
  ok("0373: one raised more than twelve hours ago is history, not an alarm — not sent", (await escPushes(old.id)) === 0);

  // The brew ladder's own "🔁 Still open" copy waits 20–30 minutes for an alert 0373 marks at ten.
  await age(brew.id, "25 minutes");
  const before = await num(`select count(*) n from public.alerts where kind = 'brew_start_now' and subject_id = $1`, [BREW]);
  await db.exec(`select public.brew_due_alerts()`);
  ok("0373: the brew ladder's re-ping finds the alarm already escalated and writes no second line",
    (await num(`select count(*) n from public.alerts where kind = 'brew_start_now' and subject_id = $1`, [BREW])) === before, before);

  // A device test is never escalated.
  const dt = await db.query(`insert into public.alerts (severity, category, kind, title, target_user_id) values ('critical', 'system', 'device_test', 'Test alert', $1) returning id`, [SERVER]);
  const dtId = dt.rows[0].id;
  await age(dtId, "11 minutes");
  await esc();
  await db.exec(`update public.alerts set escalated_at = now() where id = '${dtId}'`);
  ok("0373: a device test is never escalated — not by the run, and a mark by hand does not open the door",
    (await escPushes(dtId)) === 0 && (await q1(`select escalated_at from public.alerts where id = $1`, [dtId])).escalated_at !== null);

  let rerun = null;
  const pBefore = await pushes();
  try { await db.exec(sql373); } catch (e) { rerun = String(e.message || e); }
  ok("0373 run again: no error, one escalation trigger, the job once, no ring, the changelog lines once each",
    rerun === null && (await num(`select count(*) n from pg_trigger where tgname = 'alerts_push_escalation'`)) === 1
    && (await num(`select count(*) n from cron.job where jobname = 'escalate-criticals'`)) === 1 && (await pushes()) === pBefore
    && (await num(`select count(*) n from public.changelog where title in ('A critical nobody picks up rings the owners again', 'FYI alerts stay in the inbox', 'A locked phone shows what happened, not who')`)) === 3, rerun);
}

// ── 0374 · RING THIS PHONE ───────────────────────────────────────────────────────────────────────────────────────────
{
  const sql374 = MIG(F374);
  await db.exec(`delete from public.alerts where kind = 'device_test'`);
  await db.exec(sql374);
  ok("0374 applies to the whole schema", true);
  const ring = (uid) => as(uid, `select public.ring_my_devices() as n`);
  const tests = (uid) => q(`select id, severity, category, title, link, target_user_id, created_by, tenant_id, ack_at, ack_by, created_at
    from public.alerts where kind = 'device_test' and target_user_id = $1 order by created_at, id`, [uid]);

  const p0 = await pushes();
  const r1 = await ring(SERVER);
  const t1 = await tests(SERVER);
  ok("0374: someone on the crew with a phone kept for them rings it — the answer is how many devices it went to",
    r1.error === null && Number(r1.rows[0].n) === 1 && t1.length === 1, { r1, t1 });
  ok("0374: …a real alert: critical, kind device_test, theirs, in their business, opening Settings › Notifications",
    t1[0].severity === "critical" && t1[0].target_user_id === SERVER && t1[0].created_by === SERVER && t1[0].tenant_id === T1
    && t1[0].link === "/crew?s=settings&a=set-notify", t1[0]);
  ok("0374: …through the door every alert uses — one push, to be sent to their devices alone (supabase/functions/push)",
    (await pushes()) === p0 + 1 && (await pushesOf(t1[0].id)) === 1);

  const r2 = await ring(SERVER);
  ok("0374: a second press inside the minute is refused with how long to wait — 429, a refusal, never a server error",
    r2.code === "PT429" && /try again in \d+ seconds?\./.test(r2.error ?? "") && Number(r2.detail) >= 1 && Number(r2.detail) <= 60, r2);
  ok("0374: …and writes nothing, rings nothing", (await tests(SERVER)).length === 1 && (await pushes()) === p0 + 1);
  await db.exec(`update public.alerts set created_at = created_at - interval '61 seconds' where kind = 'device_test'`);
  const r3 = await ring(SERVER);
  const t3 = await tests(SERVER);
  ok("0374: a minute on it rings again, and the last test closes first (the mechanism) — one open at most",
    r3.error === null && t3.length === 2 && t3[0].ack_at !== null && t3[0].ack_by === null && t3[1].ack_at === null && (await pushes()) === p0 + 2, { r3, t3 });

  const none = await ring(MANAGER);
  ok("0374: someone with no device kept for them is told 0, and nothing is written", none.error === null && Number(none.rows[0].n) === 0 && (await tests(MANAGER)).length === 0, none);
  const member = await ring(MEMBER);
  ok("0374: a customer cannot ring from here — the crew only (42501, a 403)", member.code === "42501" && /crew/.test(member.error ?? ""), member);
  const anon = await ring(null);
  ok("0374: nor anyone signed out — not even allowed to call it", anon.error !== null && /permission denied/i.test(anon.error), anon);
  const gr = await q1(`select has_function_privilege('anon', 'public.ring_my_devices()', 'execute') a,
                              has_function_privilege('authenticated', 'public.ring_my_devices()', 'execute') b,
                              has_function_privilege('authenticated', 'public.close_device_tests()', 'execute') c,
                              (select prosecdef from pg_proc where proname = 'ring_my_devices') d,
                              (select coalesce(proconfig::text, '') from pg_proc where proname = 'ring_my_devices') e`);
  ok("0374: signed-in callers only; the two-minute close is the cron's alone; definer with search_path pinned",
    gr.a === false && gr.b === true && gr.c === false && gr.d === true && /search_path=public/.test(gr.e), gr);

  // Never shown to anyone else.
  const mine = t3[1].id;
  const ownerSees = await as(OWNER, `select id from public.alerts where id = $1`, [mine]);
  const managerSees = await as(MANAGER, `select id from public.alerts where kind = 'device_test'`);
  const selfSees = await as(SERVER, `select id from public.alerts where id = $1`, [mine]);
  ok("0374: the owner — who reads every alert, other people's too (0157) — cannot read someone's device test", ownerSees.error === null && ownerSees.rows.length === 0, ownerSees);
  ok("0374: …nor can any other leader; its person can", managerSees.rows.length === 0 && selfSees.rows.length === 1, { managerSees, selfSees });
  const ownerTask = await as(OWNER, `select id from public.alerts where id = $1`, [serverTask]);
  ok("0374: every other alert reads as before — the owner still sees the server's task alert", ownerTask.rows.length === 1, ownerTask);
  const ownerAcks = await as(OWNER, `update public.alerts set ack_at = now() where id = $1 returning id`, [mine]);
  ok("0374: nobody else can acknowledge it (or touch it at all)", ownerAcks.error === null && ownerAcks.rows.length === 0 && (await q1(`select ack_at from public.alerts where id = $1`, [mine])).ack_at === null, ownerAcks);
  const selfAcks = await as(SERVER, `update public.alerts set ack_at = now(), ack_by = $2 where id = $1 returning id`, [mine, SERVER]);
  ok("0374: its person can — Got it works on their own test", selfAcks.error === null && selfAcks.rows.length === 1, selfAcks);
  const forged = await as(SERVER, `insert into public.alerts (severity, category, kind, title, target_user_id) values ('critical', 'system', 'device_test', 'Test alert', $1)`, [SERVER]);
  const forgedOther = await as(OWNER, `insert into public.alerts (severity, category, kind, title, target_user_id) values ('critical', 'system', 'device_test', 'Test alert', $1)`, [SERVER]);
  ok("0374: nobody writes a device test through the API — not for themselves past the minute, not at someone else — only ring_my_devices does",
    /row-level security/i.test(forged.error ?? "") && /row-level security/i.test(forgedOther.error ?? ""), { forged, forgedOther });
  const other = await as(OTHER, `select id from public.alerts where kind = 'device_test'`);
  ok("0374: …and another business sees none of it", other.rows.length === 0);

  // Two minutes, then it clears itself.
  await db.exec(`update public.alerts set ack_at = null, ack_by = null where id = '${mine}'`);
  await db.exec(`update public.alerts set created_at = now() - interval '90 seconds' where id = '${mine}'`);
  ok("0374: a minute and a half on, it is still open", (await num(`select public.close_device_tests() n`)) === 0 && (await q1(`select ack_at from public.alerts where id = $1`, [mine])).ack_at === null);
  await db.exec(`update public.alerts set created_at = now() - interval '121 seconds' where id = '${mine}'`);
  const closed = await num(`select public.close_device_tests() n`);
  const row = await q1(`select ack_at, ack_by from public.alerts where id = $1`, [mine]);
  ok("0374: two minutes on it is acknowledged by the mechanism (ack_by null) and kept", closed === 1 && row.ack_at !== null && row.ack_by === null, { closed, row });
  ok("0374: pg_cron closes them every minute", (await q1(`select schedule from cron.job where jobname = 'device-tests-close'`))?.schedule === "* * * * *");

  // Escalation never takes one, even an old one nobody closed.
  await db.exec(`update public.alerts set ack_at = null, escalated_at = null, created_at = now() - interval '20 minutes' where id = '${mine}'`);
  await db.exec(`select public.escalate_unacked_criticals()`);
  ok("0374 with 0373: a device test nobody closed is never escalated to anyone",
    (await q1(`select escalated_at from public.alerts where id = $1`, [mine])).escalated_at === null);

  let rerun = null;
  try { await db.exec(sql374); } catch (e) { rerun = String(e.message || e); }
  ok("0374 run again: no error, three policies, the job once, the changelog line once",
    rerun === null && (await num(`select count(*) n from pg_policy where polrelid = 'public.alerts'::regclass and polname like 'a device test%'`)) === 3
    && (await num(`select count(*) n from cron.job where jobname = 'device-tests-close'`)) === 1
    && (await num(`select count(*) n from public.changelog where title = 'Ring this phone'`)) === 1, rerun);
}

// ── every migration records itself ────────────────────────────────────────────────────────────────────────────────
for (const f of [F372, F373, F374]) {
  const v = f.replace(/\.sql$/, "");
  ok(`${v.slice(0, 4)} recorded itself, once per run`, (await num(`select applied_count n from public.schema_migrations where version = $1`, [v])) === 2);
}

console.log(`WAVE 2 · ALERTS: ${pass} passed, ${fail} failed`);
console.log(`${F372.slice(0, 4)} + ${F373.slice(0, 4)} + ${F374.slice(0, 4)} executed against the whole schema in PGlite.\n`);
process.exit(fail ? 1 : 0);
