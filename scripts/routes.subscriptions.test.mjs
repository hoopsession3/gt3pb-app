// A COFFEE SUBSCRIPTION STARTED, RUN (R18, 2026-10-17 — the 10/10 audit, operations F13).
//
// /api/subscriptions/create compiled from its own TypeScript and called with a Request, as Next calls it. Real: the route,
// lib/squareServer (the plan for a pack, Square's verdicts and words), lib/cardGuard, lib/apiAuth. Stood in for: the
// database (scripts/fixtures/moneyWorld) — with subscriptions_one_active (0150's partial unique index: one active, paused,
// pending or past-due subscription a member) as a key on (user_id, one_active), where a row that is not one of those
// carries no one_active; Square (below: customers, cards, subscriptions and their search); the alert writer (a
// recorder). Every name, id and card is made up.
//
// What it holds the route to: one subscription a member, ever reaching Square once; the card saved under the try's own
// key and the subscription started under it; a refusal said in one sentence with the try rolled back; an answer that
// doesn't say kept (the row stamped as asked), the crew told, the member told not to try again — and their next try
// asks Square first; a subscription live at Square never left without its row.
import { readFileSync } from "node:fs";
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

// lib/squareServer reads the plans as it loads.
process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = "L-MADE-UP-LOCATION";
process.env.SQUARE_SUB_PLAN_6 = "PLAN-MADE-UP-6";
process.env.SQUARE_SUB_PLAN_12 = "PLAN-MADE-UP-12";
process.env.SQUARE_SUB_PLAN_18 = "PLAN-MADE-UP-18";

const SAM = "0c416000-0000-4000-8000-0000000000a1", SAM_TOKEN = "made-up-session-token-sam";
const ACTIVE = new Set(["active", "paused", "pending", "past_due"]);
let w, alerts, sq, seq = 0, blocked;
const uuid = () => `5b000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function fresh({ subs = [], customerId = null, enabled = true } = {}) {
  w = moneyWorld({
    tables: {
      live_status: [{ id: 1, subscriptions_enabled: enabled }],
      profiles: [{ id: SAM, display_name: "Sam Example", square_customer_id: customerId }],
      subscriptions: subs.map((r) => ({ id: uuid(), user_id: SAM, square_subscription_id: null, square_asked_at: null, created_at: new Date().toISOString(), ...r, one_active: ACTIVE.has(r.status) ? true : null })),
    },
    unique: { subscriptions: ["id", ["user_id", "one_active"]] },
    defaults: { subscriptions: () => ({ id: uuid(), one_active: true, square_subscription_id: null, square_asked_at: null, created_at: new Date().toISOString() }) },
    rpc: {
      rate_limit_hit: ({ p_bucket }) => !blocked.includes(p_bucket),
      resolve_customer: () => "c0000000-0000-4000-8000-0000000000c1",
    },
    sessions: { [SAM_TOKEN]: { id: SAM, email: "sam@example.test" } },
  });
  w.auth.admin = { getUserById: async (id) => ({ data: { user: id === SAM ? { id, email: "sam@example.test" } : null }, error: null }) };
  alerts = []; blocked = [];
  sq = { calls: [], customers: [], cards: [], subscriptions: [], script: {}, keys: new Map(), onSubscribe: null };
  globalThis.fetch = square;
}
// Square, as lib/squareServer and the route ask it: one answer per idempotency key (a retry is the first answer), and a
// `script` per path for what to do instead: "drop" (no answer), "503", "refuse" (a card's refusal), "garbled" (a 2xx
// that is not JSON).
async function square(url, init = {}) {
  const u = new URL(String(url));
  const body = init.body ? JSON.parse(init.body) : {};
  sq.calls.push({ path: u.pathname, body });
  const answer = (status, b) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const step = sq.script[u.pathname]?.shift?.();
  if (step === "drop") throw new TypeError("fetch failed");
  if (step === "503") return answer(503, { errors: [{ category: "API_ERROR", code: "SERVICE_UNAVAILABLE", detail: "Square is unavailable." }] });
  if (step === "garbled") return answer(200, "<html>not json</html>");
  if (u.pathname === "/v2/subscriptions/search") {
    const ids = body?.query?.filter?.customer_ids ?? [];
    return answer(200, { subscriptions: sq.subscriptions.filter((s) => ids.includes(s.customer_id)) });
  }
  const seen = body.idempotency_key && sq.keys.get(`${u.pathname}|${body.idempotency_key}`);
  if (seen) return answer(seen.status, seen.body);
  let out;
  if (u.pathname === "/v2/customers") {
    const c = { id: `CUST_MADEUP_${sq.customers.length + 1}`, email_address: body.email_address };
    sq.customers.push(c);
    out = { status: 200, body: { customer: c } };
  } else if (u.pathname === "/v2/cards") {
    if (step === "refuse") out = { status: 400, body: { errors: [{ category: "PAYMENT_METHOD_ERROR", code: "CVV_FAILURE", detail: "Card verification code check failed." }] } };
    else { const c = { id: `CARD_MADEUP_${sq.cards.length + 1}`, customer_id: body.card?.customer_id }; sq.cards.push(c); out = { status: 200, body: { card: c } }; }
  } else if (u.pathname === "/v2/subscriptions") {
    const s = { id: `SUB_MADEUP_${sq.subscriptions.length + 1}`, status: "ACTIVE", customer_id: body.customer_id, plan_variation_id: body.plan_variation_id, card_id: body.card_id, charged_through_date: "2026-11-17" };
    sq.subscriptions.push(s);
    out = { status: 200, body: { subscription: s } };
    sq.onSubscribe?.();
    if (step === "lose") { sq.keys.set(`${u.pathname}|${body.idempotency_key}`, out); throw new TypeError("fetch failed: other side closed"); }
  } else throw new Error(`fake Square: unexpected ${u.pathname}`);
  if (body.idempotency_key) sq.keys.set(`${u.pathname}|${body.idempotency_key}`, out);
  return answer(out.status, out.body);
}
const shims = {
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": { get supabaseAdmin() { return w; } },
  "@supabase/supabase-js": { createClient: () => w },
  "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { alerts.push(a); return true; } },
};
fresh();
const route = routeLoader(shims)("app/api/subscriptions/create/route.ts");
const card = () => `cnon:made-up-${Math.random().toString(36).slice(2, 12)}`;
async function post(body, { token = SAM_TOKEN, ip = "203.0.113.31" } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await route.POST(new Request("https://app.example.test/api/subscriptions/create", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const subs = () => w.tables.subscriptions;
const asked = (path) => sq.calls.filter((c) => c.path === path);

// ── a six-pack subscription, start to finish ─────────────────────────────────────────────────────────────────────────
{
  fresh();
  const r = await post({ sourceId: card(), pack: "6" });
  ok("start: 200 ok, active", r.status === 200 && r.json?.ok === true && r.json.status === "active", r);
  const row = subs()[0];
  ok("start: one row — the member's, active, with Square's subscription and card, the stamp cleared", subs().length === 1 && row.user_id === SAM && row.status === "active"
    && row.square_subscription_id === "SUB_MADEUP_1" && row.square_card_id === "CARD_MADEUP_1" && row.square_asked_at === null && row.plan === "coffee_6" && row.current_period_end === "2026-11-17", row);
  ok("start: a Square customer made once, under the member's own key, and kept on the profile", asked("/v2/customers").length === 1 && asked("/v2/customers")[0].body.idempotency_key === `cust-${SAM}`
    && asked("/v2/customers")[0].body.email_address === "sam@example.test" && w.tables.profiles[0].square_customer_id === "CUST_MADEUP_1", asked("/v2/customers"));
  ok("start: the card saved under this try's key; the subscription started under it, on the six-pack's plan, at this location",
    asked("/v2/cards")[0]?.body.idempotency_key === `card-${row.id}` && asked("/v2/subscriptions")[0]?.body.idempotency_key === `sub-${row.id}`
      && asked("/v2/subscriptions")[0].body.plan_variation_id === "PLAN-MADE-UP-6" && asked("/v2/subscriptions")[0].body.location_id === "L-MADE-UP-LOCATION"
      && asked("/v2/subscriptions")[0].body.card_id === "CARD_MADEUP_1" && asked("/v2/subscriptions")[0].body.customer_id === "CUST_MADEUP_1", sq.calls);
  ok("start: leadership hears of new recurring revenue (fyi, money)", alerts.some((a) => a.severity === "fyi" && a.category === "money" && /New subscriber/.test(a.title)), alerts);
  const again = await post({ sourceId: card(), pack: "12" });
  ok("start: a second while one is active — 409 'You already have a subscription', Square never asked", again.status === 409 && /already have a subscription/.test(again.json?.error ?? "")
    && asked("/v2/subscriptions").length === 1 && subs().length === 1, again);
}
{
  fresh({ customerId: "CUST_KEPT_FROM_BEFORE" });
  const r = await post({ sourceId: card(), pack: "18" });
  ok("a member Square already knows: no second customer — the kept one, on the 18-pack's plan", r.status === 200 && asked("/v2/customers").length === 0
    && asked("/v2/cards")[0]?.body.card.customer_id === "CUST_KEPT_FROM_BEFORE" && asked("/v2/subscriptions")[0]?.body.plan_variation_id === "PLAN-MADE-UP-18", sq.calls);
}
{
  fresh({ subs: [{ status: "canceled", square_subscription_id: "SUB_OLD_CANCELED" }] });
  const r = await post({ sourceId: card(), pack: "6" });
  ok("a member whose last one was canceled may start again", r.status === 200 && subs().filter((s) => s.status === "active").length === 1, r);
}

// ── refusals before Square ─────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const none = await post({ sourceId: card(), pack: "6" }, { token: null });
  const badPack = await post({ sourceId: card(), pack: "7" });
  const noCard = await post({ pack: "6" });
  const numCard = await post({ sourceId: 12345, pack: "6" });
  const shapes = await Promise.all(["null", "\"6\""].map((b) => post(b)));
  ok("no sign-in 401; a pack that isn't 6, 12 or 18, no card, or a card that isn't a token 400; a body that isn't one 400 — Square never asked",
    none.status === 401 && badPack.status === 400 && noCard.status === 400 && numCard.status === 400 && shapes.every((x) => x.status === 400) && sq.calls.length === 0 && subs().length === 0,
    [none.status, badPack.status, noCard.status, numCard.status, ...shapes.map((x) => x.status)]);
  blocked = [`card:u:${SAM}`];
  const tries = await post({ sourceId: card(), pack: "6" });
  ok("past this person's card tries: 429 — no row, Square never asked", tries.status === 429 && sq.calls.length === 0 && subs().length === 0, tries);
}
{
  fresh({ enabled: false });
  const r = await post({ sourceId: card(), pack: "6" });
  ok("the owner's switch off: 503 'not available yet' — before the member is even asked", r.status === 503 && sq.calls.length === 0 && subs().length === 0, r);
}

// ── Square says no, or doesn't answer ────────────────────────────────────────────────────────────────────────────
{
  fresh();
  sq.script["/v2/cards"] = ["refuse"];
  const r = await post({ sourceId: card(), pack: "6" });
  ok("the card refused: 400 in one sentence, never Square's reason (a security code) — the try rolled back", r.status === 400 && !/CVV|verification code/i.test(r.json?.error ?? "")
    && /declined/i.test(r.json?.error ?? "") && subs().length === 0 && asked("/v2/subscriptions").length === 0, r);
  const next = await post({ sourceId: card(), pack: "6" });
  ok("…and the member may try again at once", next.status === 200 && subs().length === 1, next);
}
{
  fresh();
  sq.script["/v2/cards"] = ["drop"];
  const r = await post({ sourceId: card(), pack: "6" });
  ok("no answer while saving the card: 503 'try again in a minute' (ours, not the member's mistake) — the try rolled back", r.status === 503 && /couldn't start just now/.test(r.json?.error ?? "") && subs().length === 0, r);
}
{
  fresh();
  sq.script["/v2/customers"] = ["503"];
  const r = await post({ sourceId: card(), pack: "6" });
  ok("billing couldn't be set up (Square's customer refused): 503, nothing charged — the try rolled back", r.status === 503 && /Couldn't set up billing/.test(r.json?.error ?? "") && subs().length === 0 && asked("/v2/cards").length === 0, r);
}
{
  fresh();
  sq.script["/v2/subscriptions"] = ["lose"];
  const r = await post({ sourceId: card(), pack: "6" });
  const row = subs()[0];
  ok("Square started it and the answer was lost: 202 pending, 'don't start another'", r.status === 202 && r.json?.pending === true && /Don't start another/.test(r.json.error ?? ""), r);
  ok("…the row kept, stamped as asked, with no subscription id yet", subs().length === 1 && row.status === "pending" && row.square_asked_at && row.square_subscription_id === null, row);
  ok("…the crew told (critical, money, once for this row)", alerts.some((a) => a.severity === "critical" && a.kind === "subscription_unknown" && a.subjectId === row.id), alerts);
  const soon = await post({ sourceId: card(), pack: "6" });
  ok("the member's next try a minute on: 409 'still confirming' — Square isn't asked to start another", soon.status === 409 && soon.json?.pending === true && asked("/v2/subscriptions").length === 1, soon);
  row.square_asked_at = new Date(Date.now() - 3 * 60_000).toISOString();
  const later = await post({ sourceId: card(), pack: "6" });
  ok("three minutes on: Square is asked what it has — the subscription it started is taken up, the member told they're subscribed", later.status === 200 && later.json?.ok === true
    && /went through at Square/.test(later.json.warn ?? "") && row.square_subscription_id === "SUB_MADEUP_1" && row.status === "active" && row.square_asked_at === null
    && asked("/v2/subscriptions").length === 1 && asked("/v2/subscriptions/search").length === 1, { later, row });
}
{
  fresh();
  sq.script["/v2/subscriptions"] = ["drop"];
  const r = await post({ sourceId: card(), pack: "6" });
  ok("no answer and nothing started: 202 pending, the row stamped", r.status === 202 && subs()[0]?.square_asked_at, r);
  subs()[0].square_asked_at = new Date(Date.now() - 3 * 60_000).toISOString();
  const later = await post({ sourceId: card(), pack: "6" });
  ok("three minutes on: Square has nothing for them — the stamped try goes, this one carries on and starts it", later.status === 200 && later.json?.status === "active"
    && subs().length === 1 && subs()[0].square_subscription_id === "SUB_MADEUP_1" && asked("/v2/subscriptions/search").length === 1, { later, subs: subs() });
}
{
  fresh();
  sq.script["/v2/subscriptions"] = ["drop"];
  await post({ sourceId: card(), pack: "6" });
  subs()[0].square_asked_at = new Date(Date.now() - 3 * 60_000).toISOString();
  sq.script["/v2/subscriptions/search"] = ["503"];
  const r = await post({ sourceId: card(), pack: "6" });
  ok("…and when Square can't be asked about the last try: 503 'give it a minute' — never stepped past unseen", r.status === 503 && r.json?.pending === true && subs().length === 1 && asked("/v2/subscriptions").length === 1, r);
  w.fail.subscriptions = { select: { code: "57014", message: "canceling statement due to statement timeout" } };
  const unread = await post({ sourceId: card(), pack: "6" });
  ok("…and when the tries can't be read: 503 too", unread.status === 503 && unread.json?.pending === true, unread);
}
{
  // Started at Square, then the mirror wouldn't take its id: the row is kept and marked, the crew told — the member is
  // subscribed, never "try again" over a live subscription.
  fresh();
  sq.onSubscribe = () => { w.fail.subscriptions = { update: { code: "XX000", message: "the disk said no" } }; };
  const r = await post({ sourceId: card(), pack: "6" });
  ok("live at Square, the mirror missed: 200 ok, 'you're subscribed — finalizing'", r.status === 200 && r.json?.ok === true && /You're subscribed/.test(r.json.warn ?? ""), r);
  ok("…the row kept, marked active with the subscription's id; the crew told to reconcile (critical, money)", subs().length === 1 && subs()[0].status === "active" && subs()[0].square_subscription_id === "SUB_MADEUP_1"
    && alerts.some((a) => a.severity === "critical" && a.category === "money" && /needs reconcile/.test(a.title)), { subs: subs(), alerts });
}
{
  // R39 (the fresh audit's API11-08): the row taken while Square answered. A retry more than two minutes after this try
  // stamped its row took it for one that died — Square had nothing yet — deleted it and started its own. This try's
  // writes matched nothing and read as success: two live subscriptions, one row.
  fresh();
  let theirs = null;
  sq.onSubscribe = () => {
    const mine = subs()[0];
    w.tables.subscriptions = subs().filter((r) => r !== mine);
    theirs = { id: uuid(), user_id: SAM, status: "pending", plan: "coffee_6", square_subscription_id: null, square_asked_at: new Date().toISOString(), created_at: new Date().toISOString(), one_active: true };
    w.tables.subscriptions.push(theirs);
  };
  const r = await post({ sourceId: card(), pack: "6" });
  ok("the row taken while Square answered: the member is told they're subscribed — never a bare ok over a row that isn't there",
    r.status === 200 && r.json?.ok === true && /You're subscribed/.test(r.json.warn ?? ""), r);
  ok("…the other try's row is left as it was — never named with this try's subscription, nor marked",
    subs().length === 1 && subs()[0] === theirs && theirs.square_subscription_id === null && theirs.status === "pending", subs());
  ok("…and the crew is told, critical, with the Square id, that the member may have two",
    alerts.some((a) => a.severity === "critical" && a.category === "money" && /needs reconcile/.test(a.title) && a.body.includes("SUB_MADEUP_1") && /may have two/.test(a.body)), alerts);
  // Taken up instead: the other try asked Square, found this very subscription, and named the row with it — one
  // subscription, one row. Nothing to reconcile, and nobody is told there may be two.
  fresh();
  sq.onSubscribe = () => {
    const mine = subs()[0];
    Object.assign(mine, { square_subscription_id: "SUB_MADEUP_1", status: "active", square_asked_at: null });
  };
  const taken = await post({ sourceId: card(), pack: "6" });
  ok("…while a row the other try took up with this very subscription is right as it is: ok, subscribed, and no reconcile alert",
    taken.status === 200 && taken.json?.ok === true && taken.json.status === "active" && subs().length === 1 && subs()[0].square_subscription_id === "SUB_MADEUP_1"
      && !alerts.some((a) => /needs reconcile/.test(a.title ?? "")), { taken, subs: subs(), alerts });
  const src = readFileSync(new URL("../app/api/subscriptions/create/route.ts", import.meta.url), "utf8");
  ok("…and the door has the platform's limit every card door has (60 s), under the two minutes a stamp is trusted",
    /^export const maxDuration = 60;$/m.test(src) && /\.eq\("id", rowId\)\.eq\("square_asked_at", stamp\)\.select\("id"\)/.test(src));
}
{
  // A try that died before reaching Square, ten minutes ago, is cleared; one Square was asked about never is.
  fresh({ subs: [{ status: "pending", created_at: new Date(Date.now() - 30 * 60_000).toISOString() }] });
  const r = await post({ sourceId: card(), pack: "6" });
  ok("a stale try that never reached Square is cleared, and this one goes on", r.status === 200 && subs().length === 1 && subs()[0].status === "active", { r, subs: subs() });
}

console.log(`\nA COFFEE SUBSCRIPTION STARTED, RUN (app/api/subscriptions/create): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
