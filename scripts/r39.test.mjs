// R39 — THE SERVER ANSWERS WHAT IS TRUE (2026-10-19 — the fresh audit's API11-06 to -12; Ryan: "Keep working to improve
// to a 10").
//
//   1 · the Stripe billing webhook writes the subscription as it stands at Stripe, not as one event said — so the order
//       events arrive in decides nothing; without the key to ask with, a cancel is final (API11-09).
//   2 · a read that failed is no answer on the doors that move money or a pack (API11-06): a move with the schedule
//       unread, a subscription unread, a receipt with its order, lines or tracking unread — each waits, says so, and
//       changes nothing. (The checkout's switch, /api/reserve's schedule and switch, and the office's price and account
//       are run in routes.money.test and routes.reserve.test; the subscription's race in routes.subscriptions.test.)
//   3 · a deadline on the server's own database calls (lib/dbDeadline, API11-10): aborted when it runs past, a caller's
//       own signal still heard; every server client and the error filer use it.
//   4 · the week's money read as Money reads it (lib/salesReport, API11-07): the digest and the week's review ask
//       report_sales as the person who asked, and a sum that couldn't be read is said, never $0.
//   5 · the wallet doors name no setting to whoever knocks (API11-11).
//   6 · 0439, the claims' sweep, as text (it is run in db.r39.test.mjs); the paste file; this file run.
// Every person, business, card and id here is made up.
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { routeLoader, NextResponseShim, moneyWorld } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
const realFetch = globalThis.fetch;

const SAM = "0c439000-0000-4000-8000-0000000000a1", SAM_TOKEN = "made-up-session-token-sam";
// lib/apiAuth asks the database as the caller (callerClient): a made-up project and key, answered by the stand-in.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://made-up-project.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "made-up-key-for-tests-only";
const T1 = "00000000-0000-4000-8000-0000000000a1";
let w, alerts, sent;
const shimsFor = (extra = {}) => ({
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": { get supabaseAdmin() { return w; } },
  "@supabase/supabase-js": { createClient: () => w },
  "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { alerts.push(a); return true; } },
  ...extra,
});
async function call(route, method, url, { body, token = SAM_TOKEN, headers = {} } = {}) {
  const h = { "content-type": "application/json", "x-forwarded-for": "203.0.113.39", ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  const res = await route[method](new Request(url, { method, headers: h, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

// ── 1 · the billing webhook: the subscription as it stands (API11-09) ───────────────────────────────────────────────
{
  const SECRET = "whsec_made_up_for_this_test_only";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  const route = routeLoader(shimsFor())("app/api/billing/webhook/route.ts");
  const fresh = (status = "canceled") => {
    w = moneyWorld({
      tables: { tenants: [{ id: T1, plan: "pro", billing_status: status, stripe_subscription_id: "sub_MADEUP_1", current_period_end: null }], webhook_events: [] },
      unique: { webhook_events: ["id"] },
    });
    alerts = [];
  };
  let stripe = null, asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push({ url: String(url), auth: init?.headers?.Authorization ?? null });
    if (stripe === "drop") throw new TypeError("fetch failed");
    if (typeof stripe === "number") return new Response(JSON.stringify({ error: { message: "made up" } }), { status: stripe });
    return new Response(JSON.stringify(stripe), { status: 200, headers: { "content-type": "application/json" } });
  };
  let seq = 0;
  const send = async (type, object) => {
    const payload = JSON.stringify({ id: `evt_MADEUP_${++seq}`, type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", SECRET).update(`${t}.${payload}`).digest("hex");
    return call(route, "POST", "https://app.example.test/api/billing/webhook", { body: payload, token: null, headers: { "stripe-signature": `t=${t},v1=${sig}` } });
  };
  const tenant = () => w.tables.tenants[0];

  // With the API key: Stripe is asked, and its answer is written.
  process.env.STRIPE_SECRET_KEY = "sk_test_made_up_for_this_test_only";
  fresh("canceled"); asked = [];
  stripe = { id: "sub_MADEUP_1", status: "canceled", current_period_end: 1790000000 };
  const late = await send("customer.subscription.updated", { id: "sub_MADEUP_1", status: "active", cancel_at_period_end: true, current_period_end: 1789000000 });
  ok("an 'active' update retried after the cancel: Stripe is asked how the subscription stands — canceled — and that is written; the business stays off Pro",
    late.status === 200 && tenant().billing_status === "canceled" && asked.length === 1 && asked[0].url === "https://api.stripe.com/v1/subscriptions/sub_MADEUP_1"
      && asked[0].auth === "Bearer sk_test_made_up_for_this_test_only", { late, tenant: tenant(), asked });
  ok("…with the period Stripe gives, not the event's", tenant().current_period_end === new Date(1790000000 * 1000).toISOString(), tenant());
  fresh("active"); asked = [];
  stripe = { id: "sub_MADEUP_1", status: "past_due", items: { data: [{ current_period_end: 1791000000 }] } };
  const due = await send("customer.subscription.updated", { id: "sub_MADEUP_1", status: "active" });
  ok("an event that says active while Stripe says past due: past due is written, and the owners told once",
    due.status === 200 && tenant().billing_status === "past_due" && alerts.filter((a) => a.kind === "software_subscription_past_due").length === 1, { due, tenant: tenant(), alerts });
  fresh("active"); asked = [];
  stripe = 503;
  const down = await send("customer.subscription.deleted", { id: "sub_MADEUP_1" });
  ok("Stripe not answering: 500 — Stripe retries — and nothing is written from a guess", down.status === 500 && tenant().billing_status === "active" && alerts.length === 0, { down, tenant: tenant() });
  stripe = "drop";
  const dropped = await send("customer.subscription.updated", { id: "sub_MADEUP_1", status: "canceled" });
  ok("…nor when the call drops", dropped.status === 500 && tenant().billing_status === "active", dropped);
  stripe = 404;
  const gone = await send("customer.subscription.deleted", { id: "sub_MADEUP_1" });
  ok("gone at Stripe (404): it was deleted — canceled is written", gone.status === 200 && tenant().billing_status === "canceled", { gone, tenant: tenant() });

  // Without the key: the event as it says, but a cancel is final.
  delete process.env.STRIPE_SECRET_KEY;
  fresh("canceled"); asked = [];
  const old = await send("customer.subscription.updated", { id: "sub_MADEUP_1", status: "active" });
  ok("unasked (no API key): an older 'active' after the cancel doesn't lift it — 200, nothing to retry, nothing said, Stripe never asked",
    old.status === 200 && tenant().billing_status === "canceled" && alerts.length === 0 && asked.length === 0, { old, tenant: tenant(), alerts });
  fresh("canceled");
  const lateDue = await send("customer.subscription.updated", { id: "sub_MADEUP_1", status: "past_due" });
  ok("…nor an older 'past due' after it — and the owners aren't told a canceled business is past due",
    lateDue.status === 200 && tenant().billing_status === "canceled" && alerts.length === 0, { lateDue, alerts });
  fresh("active");
  const cancel = await send("customer.subscription.deleted", { id: "sub_MADEUP_1" });
  ok("…while a cancel itself is written as before", cancel.status === 200 && tenant().billing_status === "canceled", cancel);
  fresh("active");
  const stranger = await send("customer.subscription.updated", { id: "sub_MADEUP_NOBODY", status: "active" });
  ok("…and an event for a subscription no business has yet is a 500 — Stripe retries until its checkout lands", stranger.status === 500, stranger);
  globalThis.fetch = realFetch;
  delete process.env.STRIPE_WEBHOOK_SECRET;
}

// ── 2 · a read that failed is no answer (API11-06) ──────────────────────────────────────────────────────────────────
{
  // /api/reserve/move: the schedule unread.
  const PACK = "d5390000-0000-4000-8000-000000000001", STOP = "5d390000-0000-4000-8000-000000000001";
  w = moneyWorld({
    tables: {
      stops: [{ id: STOP, starts_at: new Date(Date.now() + 72 * 3600_000).toISOString(), market: "greenville", archived_at: null, canceled_at: null, status: "scheduled" }],
      market_live: [{ market: "greenville", pre_launch: false, opens_on: null, held_closed: false }],
      drop_orders: [{ id: PACK, user_id: SAM, drop_date: "2099-01-02", stop_id: null, size: 6, glass: "return", name: "Dee", paid: true, payment_status: "paid", picked_up: false, stage: null, canceled_at: null }],
    },
    sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" } },
  });
  alerts = [];
  const move = routeLoader(shimsFor())("app/api/reserve/move/route.ts");
  w.fail.stops = { select: { code: "XX000", message: "the pool ran dry" } };
  const before = JSON.stringify(w.tables.drop_orders[0]);
  const r = await call(move, "POST", "https://app.example.test/api/reserve/move", { body: { id: PACK, toDate: "2099-01-09" } });
  ok("a pack moved with the schedule unread: 503, 'your pack hasn't moved' — never the Saturday cadence in its place; the pack as it was",
    r.status === 503 && /couldn't check the pickup schedule/.test(r.json?.error ?? "") && /hasn't moved/.test(r.json.error) && JSON.stringify(w.tables.drop_orders[0]) === before, r);
}
{
  // /api/subscriptions/manage: the subscription unread.
  process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
  w = moneyWorld({ tables: { subscriptions: [{ id: randomUUID(), user_id: SAM, square_subscription_id: "SUB_MADEUP_9", status: "active" }] }, sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" } } });
  alerts = [];
  const squareAsked = [];
  globalThis.fetch = async (url) => { squareAsked.push(String(url)); return new Response("{}", { status: 200 }); };
  const manage = routeLoader(shimsFor())("app/api/subscriptions/manage/route.ts");
  w.fail.subscriptions = { select: { code: "57014", message: "canceling statement due to statement timeout" } };
  const r = await call(manage, "POST", "https://app.example.test/api/subscriptions/manage", { body: { action: "cancel" } });
  ok("a cancel with the subscription unread: 503, 'nothing was changed' — never 'No active subscription'; Square never asked",
    r.status === 503 && /couldn't read your subscription/.test(r.json?.error ?? "") && /Nothing was changed/.test(r.json.error) && squareAsked.length === 0, { r, squareAsked });
  globalThis.fetch = realFetch;
}
{
  // /api/shop/receipt: a receipt is sent whole or not at all.
  const ORDER = "5b390000-0000-4000-8000-000000000001";
  const fresh = () => {
    w = moneyWorld({
      tables: {
        shop_orders: [{ id: ORDER, tenant_id: T1, email: "dee@example.test", user_id: null, ship_name: "Dee Example", total_cents: 3200, status: "paid" }],
        shop_order_items: [{ order_id: ORDER, title: "Made-up Cap", qty: 1, unit_cents: 3200 }],
        merch_fulfillments: [{ order_id: ORDER, tracking_number: "1ZMADEUP", tracking_url: "https://example.test/track", created_at: "2026-10-18T12:00:00Z" }],
      },
      rpc: { is_staff: () => true, current_tenant: () => T1, is_admin: () => true },
      sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" } },
    });
    alerts = []; sent = [];
  };
  fresh();
  const receipt = routeLoader(shimsFor({
    "@/lib/notify": { accountEmail: async () => null },
    "@/lib/customerMessage": { tellCustomer: async (m) => { sent.push(m); return { ok: true, email: "sent" }; } },
  }))("app/api/shop/receipt/route.ts");
  const send = () => call(receipt, "POST", "https://app.example.test/api/shop/receipt", { body: { id: ORDER } });
  const good = await send();
  ok("a receipt sent again: its lines and its tracking, to the order's address", good.status === 200 && sent.length === 1 && sent[0].email === "dee@example.test", { good, sent });
  for (const [table, what] of [["shop_orders", "the order"], ["shop_order_items", "its lines"], ["merch_fulfillments", "its tracking"]]) {
    fresh();
    w.fail[table] = { select: { code: "XX000", message: "the pool ran dry" } };
    const r = await send();
    ok(`a receipt with ${what} unread: 503, 'no receipt was sent' — never one telling a customer they bought nothing, or that a shipped box hasn't`,
      r.status === 503 && /No receipt was sent/.test(r.json?.error ?? "") && sent.length === 0, { r, sent });
  }
}

// ── 3 · a deadline on the server's own database calls (API11-10) ───────────────────────────────────────────────────
{
  const D = routeLoader({})("lib/dbDeadline.ts");
  ok("the deadline: 15 seconds, under every route's 60", D.DB_DEADLINE_MS === 15_000);
  let seen = null;
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    seen = init?.signal ?? null;
    seen?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
  });
  const t0 = Date.now();
  // Node's AbortSignal.timeout doesn't hold the process open (a server's own work does): this wait does, for the test.
  const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("still waiting"), ms))]);
  const hung = await within(D.deadlineFetch(60)("https://db.example.test/rest/v1/orders").then(() => "answered", (e) => e.name), 3000);
  ok("a database that never answers is given up on at the deadline — an abort the client says as no answer, not a hang to the platform's 504",
    hung === "AbortError" && Date.now() - t0 < 2000 && seen instanceof AbortSignal, { hung, ms: Date.now() - t0 });
  const mine = new AbortController();
  const p = within(D.deadlineFetch(60_000)("https://db.example.test/rest/v1/orders", { signal: mine.signal }).then(() => "answered", (e) => e.name), 3000);
  mine.abort();
  ok("…and a signal the caller passes still ends the call first", (await p) === "AbortError");
  globalThis.fetch = async () => new Response("[]", { status: 200 });
  const quick = await D.deadlineFetch(60)("https://db.example.test/rest/v1/orders");
  ok("…while a call that answers in time is the answer", quick.status === 200);
  globalThis.fetch = realFetch;
  const admin = code(read("lib/supabaseAdmin.ts")), auth = code(read("lib/apiAuth.ts"));
  ok("every server client takes it: the service role's, the caller's own (lib/apiAuth), and the four routes that make their own",
    /createClient<Database>\(url, serviceKey, \{ global: \{ fetch: deadlineFetch\(\) \}/.test(admin) && /global: \{ headers: \{ Authorization: `Bearer \$\{token\}` \}, fetch: deadlineFetch\(\) \}/.test(auth)
      && ["app/api/orders/cancel/route.ts", "app/api/assets/route.ts", "app/api/inventory/route.ts", "app/api/menu/route.ts"].every((f) => /fetch: deadlineFetch\(\)/.test(code(read(f)))));
  const inst = code(read("instrumentation.ts"));
  ok("…and the server's error filer: each of its four calls to the database carries the deadline",
    /const soon = \(\) => AbortSignal\.timeout\(DB_DEADLINE_MS\);/.test(inst) && (inst.match(/signal: soon\(\)/g) || []).length === 4 && (inst.match(/fetch\(`\$\{base\}\/rest\/v1\//g) || []).length === 4);
}

// ── 4 · the week's money, as Money counts it (API11-07) ─────────────────────────────────────────────────────────────
{
  const S = routeLoader({})("lib/salesReport.ts");
  const report = { revenue_cents: 182300, by_channel: { square_walkup: 41000, cup: 98000, packs: 25200, delivery: 0, office: 13500, shop: 3200, reserve: 1400 } };
  const asked = [];
  const sb = (answer) => ({ rpc: async (name, args) => { asked.push([name, args]); return answer; } });
  const r = await S.salesReport(sb({ data: report, error: null }), 7);
  ok("report_sales asked for the days given, read into cents by channel — the shop and the reserves among them",
    asked[0]?.[0] === "report_sales" && asked[0][1].p_days === 7 && r?.revenueCents === 182300 && r.byChannel.walkup === 41000 && r.byChannel.shop === 3200 && r.byChannel.reserve === 1400, r);
  const nulls = await Promise.all([
    S.salesReport(null, 7),
    S.salesReport(sb({ data: null, error: { code: "57014", message: "timeout" } }), 7),
    S.salesReport(sb({ data: { error: "unauthorized" }, error: null }), 7),
    S.salesReport(sb({ data: { revenue_cents: "lots" }, error: null }), 7),
    S.salesReport({ rpc: async () => { throw new TypeError("fetch failed"); } }, 7),
  ]);
  ok("…and no answer when it couldn't be read — no caller, an error, a refusal, a shape it never answers with, a throw: null, never $0", nulls.every((x) => x === null), nulls);

  // The digest, run: as the owner who pressed it.
  const leaders = [{ id: SAM, role: "owner" }];
  const fresh = (sales) => {
    w = moneyWorld({
      tables: { profiles: leaders, incident_log: [], alerts: [], readiness_checks: [], customers: [] },
      rpc: { is_admin: () => true, rate_limit_hit: () => true, report_sales: sales },
      sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" } },
    });
    alerts = []; sent = [];
  };
  fresh(() => report);
  const digest = routeLoader(shimsFor({
    "@/lib/notify": {
      accountEmail: async () => "sam@example.test", emailEnabled: () => true,
      sendEmail: async (to, subject, body) => { sent.push({ to, subject, body }); return { ok: true }; },
      notifyCustomer: async () => ({ sms: "off" }),
    },
  }))("app/api/cron/digest/route.ts");
  const d = await call(digest, "POST", "https://app.example.test/api/cron/digest", { body: {} });
  ok("the digest: Money's sum for the week — $1,823 — every channel on its line, the shop and the reserves the old sum left out",
    d.status === 200 && /^Revenue 7d \$1,823/.test(d.json?.summary ?? "") && /Revenue \(last 7 days, reconciled\): \$1,823/.test(sent[0]?.body ?? "")
      && /walk-up \$410 · cup \$980 · pack \$252 · delivery \$0 · office \$135 · shop \$32 · reserve \$14/.test(sent[0].body)
      && w.calls.some((c) => c.rpc === "report_sales" && c.args?.p_days === 7), { d, body: sent[0]?.body });
  fresh(() => ({ error: { code: "57014", message: "canceling statement due to statement timeout" } }));
  const unread = await call(digest, "POST", "https://app.example.test/api/cron/digest", { body: {} });
  ok("…and with the sum unread, it says so — 'couldn't be read', a dash in the headline — never $0 to the founders",
    unread.status === 200 && /^Revenue 7d — /.test(unread.json?.summary ?? "") && /couldn't be read just now/.test(sent[0]?.body ?? "") && !/\$0\b/.test(sent[0]?.body ?? ""), { unread, body: sent[0]?.body });
  const dg = code(read("app/api/cron/digest/route.ts"));
  ok("…no table summed in the route any more, no 60-day id list", !/async function sum\(/.test(dg) && !/since60d|864e5/.test(dg) && /const report = await salesReport\(callerClient\(req\), 7\);/.test(dg));
  const wr = code(read("app/api/agents/weekreview/route.ts"));
  ok("the week's review: this week report_sales(7), the week before the fourteen less the seven, as the person running it — and unread said, never $0",
    /salesReport\(callerClient\(req\), 7\),\s*salesReport\(callerClient\(req\), 14\),/.test(wr) && /const priorCents = revThis && revPrior \? revPrior\.revenueCents - revThis\.revenueCents : null;/.test(wr)
      && /couldn't be read just now — open Money for it\./.test(wr) && !/async function (sum|revenue)\(/.test(wr));
}

// ── 5 · the wallet doors name no setting (API11-11) ─────────────────────────────────────────────────────────────────
{
  for (const k of ["APPLE_PASS_TYPE_ID", "APPLE_TEAM_ID", "APPLE_PASS_CERT", "APPLE_PASS_KEY", "APPLE_WWDR", "GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_CLASS_SUFFIX", "GOOGLE_WALLET_SA_EMAIL", "GOOGLE_WALLET_SA_KEY"]) delete process.env[k];
  w = moneyWorld({});
  const apple = routeLoader(shimsFor())("app/api/wallet/pass/route.ts"), google = routeLoader(shimsFor())("app/api/wallet/google/route.ts");
  const a = await call(apple, "GET", "https://app.example.test/api/wallet/pass", { token: null });
  const g = await call(google, "GET", "https://app.example.test/api/wallet/google", { token: null });
  const named = /[A-Z][A-Z0-9]+_[A-Z0-9_]{3,}/;
  ok("the wallet doors, not switched on: 503 in a sentence, naming no setting to whoever knocked",
    a.status === 503 && a.json?.error === "Apple Wallet isn't switched on yet." && g.status === 503 && g.json?.error === "Google Wallet isn't switched on yet."
      && !named.test(JSON.stringify(a.json)) && !named.test(JSON.stringify(g.json)), { a, g });
}

// ── 6 · 0439 as text, the paste file, this file run ─────────────────────────────────────────────────────────────────
{
  const m = read("supabase/migrations/0439_a_checkouts_key_is_kept_as_long_as_it_can_matter.sql");
  ok("0439: the sweep keeps every unsettled key — only done ones go, after 90 days, or 7 for a check that found nothing",
    /delete from public\.checkout_claims\s+where state = 'done'/.test(m) && /updated_at < now\(\) - interval '90 days'/.test(m)
      && /updated_at < now\(\) - interval '7 days' and coalesce\(amount_cents, 0\) = 0 and answer ->> 'checked' = 'true'/.test(m));
  ok("…the service role's alone, nightly, its search path pinned, its read on an index of the settled keys' age",
    /revoke all on function public\.sweep_checkout_claims\(\) from public, anon, authenticated;/.test(m) && /grant execute on function public\.sweep_checkout_claims\(\) to service_role;/.test(m)
      && /cron\.schedule\('checkout-claims-sweep', '41 7 \* \* \*', \$q\$select public\.sweep_checkout_claims\(\)\$q\$\)/.test(m) && /security invoker set search_path = public/.test(m)
      && /create index if not exists checkout_claims_settled_idx on public\.checkout_claims \(updated_at\) where state = 'done';/.test(m));
  ok("…and it waits five seconds for a lock, records itself, and says where its changelog is",
    /^set lock_timeout = '5s';$/m.test(m) && /select public\.record_migration\('0439_a_checkouts_key_is_kept_as_long_as_it_can_matter'\);/.test(m) && /^-- changelog: none/m.test(m));
  const paste = read("supabase/APPLY_ALL_PENDING.sql");
  ok("the paste file holds 0438 and 0439, each its own transaction", /^-- pending-from: 0439$/m.test(paste) && /^-- pending-count: 2$/m.test(paste)
    && /begin;   -- 0438,/.test(paste) && /begin;   -- 0439,/.test(paste));
  const pkg = JSON.parse(read("package.json"));
  ok("this file runs with every test, and 0439's own with the database's", /node scripts\/r38\.test\.mjs && node scripts\/r39\.test\.mjs/.test(pkg.scripts.test)
    && /node scripts\/db\.r37\.test\.mjs && node scripts\/db\.r39\.test\.mjs/.test(pkg.scripts["db:test"]));
}

console.log(`\nR39 — THE SERVER ANSWERS WHAT IS TRUE: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
