// A PAID ORDER CAN STOP MOVING AND NOBODY HEARS — 0329, executed from its file against a real Postgres.
//
// The claim: an order this app says is waiting on US, that has not moved in a day, raises exactly one
// critical alert naming the customer — and keeps being exactly one while it stays stuck.
//
// The order that caused this was refused by Apliiq ("cannot be imported… will not be fulfilled") and
// the app never learned. It cannot learn: the rejection is an email to the account owner and there is
// no webhook. So the only honest signal available is the clock, and the only way that signal is worth
// having is if it does not turn into the flood 0327 just finished removing.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = "00000000-0000-0000-0000-000000000001";
const U1 = "11111111-1111-1111-1111-111111111111";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const rows = async (s) => (await db.query(s)).rows;

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  insert into auth.users (id, email) values ('${U1}', 'ryan@example.com');
  create role anon; create role authenticated; create role service_role;
  create publication supabase_realtime;
  create or replace function auth.uid() returns uuid language sql stable as $$ select '${U1}'::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
  create schema if not exists cron;
  create or replace function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create table public.profiles (id uuid primary key, role text default 'owner');
  create table public.tenants (id uuid primary key default gen_random_uuid());
  insert into public.tenants (id) values ('${T}');
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz default now(), note text, applied_count int default 1, evidence text);
  create or replace function public.record_migration(p_version text, p_note text default null)
    returns void language sql as $$
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, coalesce(nullif(substring(p_version from '^[0-9]{4}'), '')::int, 0), now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 $$;
  create table public.audit_log (id bigint generated always as identity primary key, tenant_id uuid,
    table_name text, op text, row_id uuid, actor uuid, old_data jsonb, new_data jsonb,
    at timestamptz default now());
  create or replace function public.audit_row() returns trigger language plpgsql as $$
  begin
    insert into public.audit_log(tenant_id, table_name, op, row_id, actor, old_data, new_data)
    values (null, tg_table_name, tg_op, coalesce(new.id, old.id), auth.uid(),
      case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
      case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
    return null; end $$;

  create table public.customers (id uuid primary key default gen_random_uuid(),
    user_id uuid, name text, phone text, email text, tenant_id uuid);
  create table public.shop_products (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) default '${T}',
    kind text not null default 'merch' check (kind in ('merch','program_tier')),
    apliiq_product_id text, title text not null, blurb text,
    price_cents int not null default 0 check (price_cents >= 0),
    cost_cents int check (cost_cents is null or cost_cents >= 0),
    image_url text, images jsonb not null default '[]'::jsonb,
    variants jsonb not null default '[]'::jsonb, program_tier text,
    published_at timestamptz, public_title text, sort int not null default 0,
    archived_at timestamptz, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now());
  create table public.shop_orders (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) default '${T}',
    customer_id uuid references public.customers(id) on delete set null,
    user_id uuid references auth.users(id) on delete set null,
    email text, payment_id text,
    subtotal_cents int not null default 0, total_cents int not null default 0,
    ship_name text, ship_address jsonb,
    status text not null default 'paid'
      check (status in ('paid','needs_fulfillment','submitted','in_production','shipped','delivered','refunded','canceled')),
    apliiq_order_id text, benefit_code text, note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now());
  create table public.shop_order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.shop_orders(id) on delete cascade,
    product_id uuid references public.shop_products(id) on delete set null,
    title text not null, variant jsonb, qty int not null default 1 check (qty > 0),
    unit_cents int not null default 0, cost_cents int);
  create table public.merch_fulfillments (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.shop_orders(id) on delete cascade,
    carrier text, tracking_number text, tracking_url text,
    shipped_at timestamptz, created_at timestamptz not null default now());

  -- 0157's fan-out trigger calls supabase_functions.http_request, which PGlite does not have. The
  -- double records each call instead of making it, so a test can COUNT the pushes an owner's phone
  -- would have received — the cost that matters when a migration restates rows already in the inbox.
  create schema if not exists supabase_functions;
  create table public.test_pushes (alert_id uuid, at timestamptz default now());
  create or replace function supabase_functions.http_request() returns trigger language plpgsql as $$
  begin insert into public.test_pushes (alert_id) values (new.id); return new; end $$;
`);

// The real files, in the order production saw them. 0174 is what gives an alert `kind` and
// `subject_id` — the two columns this whole design turns on. 0327 adds occurrences/last_seen_at.
// 0328 is the view that owns "who is waiting", which 0329 reads instead of re-deriving. 0157 (the
// fan-out and per-person reads), 0255 (the heartbeat table), 0258 (the sweep) and 0336
// (alert_open_once, loaded further down) are here because 0340 stands on all of them.
for (const f of [
  "0050_alerts.sql",
  "0157_alert_spine.sql",
  "0174_actionable_alerts.sql",
  "0255_ops_heartbeat_watchdog.sql",
  "0258_alert_autoexpire.sql",
  "0313_a_paid_order_nobody_can_see.sql",
  "0327_an_alert_that_cries_wolf.sql",
  "0328_who_is_waiting_had_two_answers.sql",
  "0329_a_paid_order_can_stop_moving_and_nobody_hears.sql",
]) await db.exec(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));

const mkOrder = async (status, hoursAgo, who, cents) => {
  const c = (await q1(`insert into public.customers (name, tenant_id) values ('${who}', '${T}') returning id`)).id;
  const o = (await q1(`
    insert into public.shop_orders (tenant_id, customer_id, status, total_cents, created_at, updated_at)
    values ('${T}', '${c}', '${status}', ${cents}, now() - interval '${hoursAgo} hours', now())
    returning id`)).id;
  await db.exec(`insert into public.shop_order_items (order_id, title, qty, unit_cents)
                 values ('${o}', 'GT3 6-Panel Cap', 1, ${cents})`);
  return o;
};
const run = async (h = 24) => (await q1(`select public.shop_order_stall_watchdog(${h}) as n`)).n;
const alerts = async () => rows(`select id, title, body, severity, occurrences, last_seen_at, subject_id, ack_at
                                   from public.alerts where kind = 'shop_order_stalled' order by created_at`);

// ── a fresh order is not a problem ─────────────────────────────────────────────────────────────
{
  await mkOrder("paid", 1, "Fresh Freddy", 3200);
  const n = await run(24);
  ok("a one-hour-old paid order raises nothing", n === 0 && (await alerts()).length === 0, n);
}

// ── the cap's exact state: submitted, overnight ────────────────────────────────────────────────
const capId = await mkOrder("submitted", 25, "Ryan", 3200);
{
  const n = await run(24);
  const a = await alerts();
  ok("a 25h 'submitted' order raises one alert", n === 1 && a.length === 1, { n, len: a.length });
  ok("it is critical", a[0]?.severity === "critical", a[0]?.severity);
  ok("it is keyed to that order", a[0]?.subject_id === capId, a[0]?.subject_id);
  ok("occurrences starts at 1", Number(a[0]?.occurrences) === 1, a[0]?.occurrences);
  ok("the body names the customer", /Ryan/.test(a[0]?.body ?? ""), a[0]?.body?.slice(0, 60));
  ok("the body names the money", /32\.00/.test(a[0]?.body ?? ""), a[0]?.body?.slice(0, 80));
  ok("the body names what they bought", /6-Panel Cap/.test(a[0]?.body ?? ""));
  ok("the body says sent, not accepted", /not that the printer accepted it/.test(a[0]?.body ?? ""));
  ok("the title carries the age", /has not moved in \d+ hours/.test(a[0]?.title ?? ""), a[0]?.title);
}

// ── the 0327 lesson, applied to a new watchdog ─────────────────────────────────────────────────
{
  const before = (await alerts())[0];
  await run(24); await run(24); await run(24);
  const a = await alerts();
  ok("three more runs add no rows", a.length === 1, a.length);
  ok("and do NOT inflate the counter — a continuous stall is one episode",
    Number(a[0].occurrences) === 1, a[0].occurrences);
  ok("but last_seen_at moves, so the row is not mistaken for stale",
    new Date(a[0].last_seen_at) >= new Date(before.last_seen_at));
}

// ── whose problem it is, is the view's decision and not this function's ────────────────────────
{
  await mkOrder("in_production", 300, "Printer Pete", 5000);
  await mkOrder("delivered", 400, "Done Dana", 5000);
  await mkOrder("refunded", 400, "Refund Rita", 5000);
  await mkOrder("canceled", 400, "Cancel Carl", 5000);
  await mkOrder("shipped", 400, "Shipped Sam", 5000);
  const n = await run(24);
  ok("an order at the printer is not ours to chase", n === 0, n);
  ok("and neither are closed or in-transit ones", (await alerts()).length === 1, (await alerts()).length);
}

// ── two stuck orders are two lines, not one overwritten ────────────────────────────────────────
{
  await mkOrder("needs_fulfillment", 48, "Second Sam", 6800);
  const n = await run(24);
  const a = await alerts();
  ok("a second stalled order opens its own alert", n === 1 && a.length === 2, { n, len: a.length });
  ok("keyed to different orders", a[0].subject_id !== a[1].subject_id);
}

// ── acknowledging means "tell me again if it happens" ──────────────────────────────────────────
{
  await db.exec(`update public.alerts set ack_at = now() where kind = 'shop_order_stalled' and subject_id = '${capId}'`);
  const n = await run(24);
  const mine = (await alerts()).filter((a) => a.subject_id === capId);
  ok("an acked alert does not suppress the next one", n === 1, n);
  ok("the order now has two rows: one cleared, one open", mine.length === 2, mine.length);
  ok("exactly one of them is open", mine.filter((a) => a.ack_at === null).length === 1);
}

// ── the guard against turning this into noise ──────────────────────────────────────────────────
{
  const fresh = await mkOrder("paid", 0, "Brand New Bella", 1000);
  const n = await run(0);            // 0 would mean "alert the instant an order is paid"
  const got = (await alerts()).filter((a) => a.subject_id === fresh);
  ok("stale_hours 0 is clamped, so a brand-new order is still not stalled", got.length === 0, n);
}

// ── the migration recorded itself (the 0304 contract) ──────────────────────────────────────────
{
  const r = await q1(`select version, seq from public.schema_migrations
                       where version = '0329_a_paid_order_can_stop_moving_and_nobody_hears'`);
  ok("0329 is in the ledger", !!r, r);
  ok("with the seq its filename implies", Number(r?.seq) === 329, r?.seq);
}

// ── 0331: THE LINK THAT WENT NOWHERE ───────────────────────────────────────────────────────────
// 0329's alert pointed at a `shop` section. There isn't one — the shop is a panel inside `money`.
// Every alert above was raised carrying that link, which is what makes the second assertion here
// the one that matters: re-emitting the function does nothing for a row already in the inbox.
{
  const before = await rows(`select id, link from public.alerts where kind = 'shop_order_stalled'`);
  ok("0329's alerts were raised with the broken link", before.length > 0 && before.every((a) => a.link === "/crew?s=shop"),
    before.map((a) => a.link));

  await db.exec(readFileSync(join(ROOT, "supabase/migrations/0331_a_deep_link_nothing_was_checking.sql"), "utf8"));

  const after = await rows(`select id, link from public.alerts where kind = 'shop_order_stalled'`);
  ok("the rows already in the inbox are corrected",
    after.length === before.length && after.every((a) => a.link === "/crew?s=money&a=shoporders"),
    after.map((a) => a.link));

  // And the function itself, so the NEXT one is right too.
  await db.exec(`update public.alerts set ack_at = now() where kind = 'shop_order_stalled'`);
  await run(24);
  const fresh = await rows(`select link from public.alerts where kind = 'shop_order_stalled' and ack_at is null`);
  ok("and a freshly raised alert uses the link that exists", fresh.length > 0 && fresh.every((a) => a.link === "/crew?s=money&a=shoporders"),
    fresh.map((a) => a.link));

  ok("0331 recorded itself",
    Number((await q1(`select count(*) n from public.schema_migrations
                       where version = '0331_a_deep_link_nothing_was_checking'`))?.n) === 1);
}

// ── 0340: THE TITLE THAT STOPPED AT TWELVE HOURS ───────────────────────────────────────────────
// Ryan's inbox, 2026-10-04: "A paid order has not moved in 12 hours" over a body reading 119, about
// the same order, and "Ryan paid 32.00" with no dollar sign. Reproduced first, against the function
// production was running (0331's), then fixed by 0340's own file — which restates the rows already
// there by running the producer once, so the assertions below are about rows written BEFORE the fix.
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0336_the_guard_that_matched_on_a_sentence.sql"), "utf8"));
{
  const open = async (id) => q1(`select id, title, body, severity, occurrences, ack_at, ack_by
                                   from public.alerts where kind = 'shop_order_stalled' and subject_id = '${id}' and ack_at is null`);
  await db.exec(`update public.alerts set ack_at = now() where kind = 'shop_order_stalled'`);
  await db.exec(`update public.shop_orders set status = 'delivered'`);   // earlier orders are not this story

  // THE SCREENSHOT. Raised the night it was twelve hours old, then left to sit.
  const shot = await mkOrder("submitted", 12, "Ryan", 3200);
  await run(12);
  await db.exec(`update public.shop_orders set created_at = now() - interval '119 hours' where id = '${shot}'`);
  await run(24);
  const was = await open(shot);
  ok("0331: the title froze at the age the alert was raised", /in 12 hours$/.test(was?.title ?? ""), was?.title);
  ok("0331: …while the body counted on, about the same order", /119 hours/.test(was?.body ?? ""), was?.body?.slice(0, 120));
  ok("0331: …and the money had no dollar sign", /paid 32\.00/.test(was?.body ?? "") && !/\$32/.test(was?.body ?? ""));

  // A STALL THAT WAS RESOLVED. Raised, then the order moved to the printer. Under 0331 nothing ever
  // closes it: "Got it" on a broadcast is a per-person read (0157) and 0258 never expires a critical.
  const moved = await mkOrder("needs_fulfillment", 30, "Dana", 5000);
  await run(24);
  await db.exec(`update public.shop_orders set status = 'in_production' where id = '${moved}'`);
  await run(24);
  ok("0331: an alert for an order that has since moved stays open for ever", !!(await open(moved)));

  // A PAID ORDER — never sent anywhere — told "this app sent it".
  const paidOnly = await mkOrder("paid", 30, "Paula", 4500);
  await run(24);
  ok("0331: an order still marked Paid is described as sent, which it never was",
    /this app sent it/.test((await open(paidOnly))?.body ?? ""));

  const pushesBefore = Number((await q1(`select count(*) n from public.test_pushes`)).n);
  await db.exec(readFileSync(join(ROOT, "supabase/migrations/0340_three_things_the_inbox_still_said.sql"), "utf8"));
  ok("0340 applies against a real Postgres", true);

  // ── the restatement, by the migration alone ──
  const now = await open(shot);
  ok("0340: the open row is restated in place — same row, not a second one",
    now?.id === was?.id, { before: was?.id, after: now?.id });
  ok("0340: the title says what the view measures, in the shop's words, with the dollar sign",
    now?.title === "Ryan paid $32.00 4 days ago — still waiting on us", now?.title);
  ok("0340: the body leads with what was bought", /^1x GT3 6-Panel Cap\. /.test(now?.body ?? ""), now?.body);
  ok("0340: …names the status the way the shop panel does",
    (now?.body ?? "").includes('The shop shows it as "Sent, not confirmed"'), now?.body);
  ok("0340: …and says what sent means, and where a refusal goes",
    /went to Apliiq on \w{3}, \w{3} \d{1,2} and nothing has come back since/.test(now?.body ?? "")
    && /emailing the account owner/.test(now?.body ?? ""), now?.body);
  ok("0340: the body carries no second age to contradict the title", !/\d+ hours/.test(now?.body ?? ""), now?.body);
  ok("0340: still critical, still one episode", now?.severity === "critical" && Number(now?.occurrences) === 1, now);

  const shut = await q1(`select ack_at, ack_by from public.alerts
                          where kind = 'shop_order_stalled' and subject_id = '${moved}' order by created_at desc limit 1`);
  ok("0340: the alert for the order that moved is closed by the mechanism, not a person",
    shut?.ack_at !== null && shut?.ack_by === null, shut);
  const paidNow = (await open(paidOnly))?.body ?? "";
  ok("0340: a Paid order is told the truth: nothing has gone to the printer",
    paidNow.includes('"Paid": the card cleared and nothing has gone to the printer') && !/sent it/.test(paidNow), paidNow);
  const pushesAfter = Number((await q1(`select count(*) n from public.test_pushes`)).n);
  ok("0340: restating the inbox pushed nobody's phone again", pushesAfter === pushesBefore, pushesAfter - pushesBefore);

  // ── and from now on ──
  await db.exec(`update public.shop_orders set created_at = now() - interval '143 hours' where id = '${shot}'`);
  await run(24);
  ok("0340: a day later the TITLE moves with the body — the 12-over-119 split cannot recur",
    (await open(shot))?.title === "Ryan paid $32.00 5 days ago — still waiting on us", (await open(shot))?.title);

  const needs = await mkOrder("needs_fulfillment", 26, "Nadia", 123456789);
  await run(24);
  const nb = await open(needs);
  ok("0340: thousands are grouped, the way every other money sentence here writes them",
    nb?.title === "Nadia paid $1,234,567.89 1 day ago — still waiting on us", nb?.title);
  ok("0340: Needs fulfilment says so, in the panel's spelling",
    (nb?.body ?? "").includes('"Needs fulfilment": paid, and the printer was never reached or never asked'), nb?.body);

  // 0329's contract, kept: acknowledging means "tell me again".
  await db.exec(`update public.alerts set ack_at = now() where kind = 'shop_order_stalled' and subject_id = '${needs}'`);
  ok("0340: an alert acknowledged while its order is still stuck opens again on the next run",
    (await run(24)) === 1 && !!(await open(needs)));

  // The cap moves: its alert closes on the next run, and only its alert.
  await db.exec(`update public.shop_orders set status = 'in_production' where id = '${shot}'`);
  await run(24);
  ok("0340: when the order finally moves, its alert closes itself", !(await open(shot)));
  ok("0340: …and the other stuck orders keep theirs", !!(await open(needs)) && !!(await open(paidOnly)));

  // ── THE KNOWN PAIR: the age in the alert and the age in the shop panel ─────────────────────────
  // shop_age_words is a mirror of lib/shopOrder.ts ageLabel. A mirror nobody compares is the drift
  // this repo keeps finding, so the real TypeScript is compiled here and both are run over every
  // hour from -2 to 1000. Rounding instead of flooring would have said "5 days" in the alert and
  // "the oldest for 4 days" in the queue headline, about the same order.
  const ts = (await import("typescript")).default;
  const mod = { exports: {} };
  new Function("module", "exports", "require",
    ts.transpileModule(readFileSync(join(ROOT, "lib/shopOrder.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  )(mod, mod.exports, () => ({}));
  const ageLabel = mod.exports.ageLabel;
  ok("known pair: lib/shopOrder's ageLabel was compiled and found", typeof ageLabel === "function");
  const sqlAges = await rows(`select h, public.shop_age_words(h) w from generate_series(-2, 1000) h`);
  const off = sqlAges.filter((r) => r.w !== ageLabel(r.h)).map((r) => `${r.h}h: sql "${r.w}" vs ts "${ageLabel(r.h)}"`);
  ok("known pair: shop_age_words and ageLabel agree for every hour from -2 to 1000",
    sqlAges.length === 1003 && off.length === 0, off.slice(0, 5));
  ok("known pair: …and on a missing age", (await q1(`select public.shop_age_words(null) w`)).w === ageLabel(null));

  ok("0340 recorded itself", Number((await q1(`select count(*) n from public.schema_migrations
                                                where version = '0340_three_things_the_inbox_still_said'`)).n) === 1);
}

console.log(fail
  ? `A PAID ORDER THAT STOPS MOVING: ${pass} passed, ${fail} FAILED`
  : `A PAID ORDER THAT STOPS MOVING: ${pass} passed, 0 failed`);
console.log("0313 + 0327 + 0328 + 0329 + 0331 + 0340 executed against a real Postgres.\n");
process.exit(fail ? 1 : 0);
