// R22 — THE SAME MESSAGE, ONCE (2026-10-18 — the 10/10 audit, API F11; Ryan: "Keep working to improve to a 10").
//
// lib/notify and lib/customerMessage are compiled from their TypeScript and run against a Resend that keeps its
// Idempotency-Keys as Resend says it does (the same key and body answer the first send; another body under the key is a
// 409 invalid_idempotent_request; one still in progress a 409 concurrent_idempotent_requests), a Twilio that answers as
// told, and the made-up database the money routes are tested on (message_sent, 0429, unique on its key). Then the
// stop-cancel route is run twice — the second call as a retry finds the stop called off already — and every customer is
// told once, packs included. Every address and number is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

Object.assign(process.env, {
  RESEND_API_KEY: "re_made_up_key", NOTIFY_FROM_EMAIL: "GT3 <hello@example.test>",
  TWILIO_ACCOUNT_SID: "AC_made_up", TWILIO_AUTH_TOKEN: "made-up-token", TWILIO_FROM_NUMBER: "+18645550100", NEXT_PUBLIC_TEXTS_ON: "1",
});

// ── the providers, as their documentation says they answer ───────────────────────────────────────────────────────────
const resend = { sends: [], keys: new Map(), inProgress: new Map(), asked: [] };   // inProgress: key → asks left before it finishes
const twilio = { sends: [], down: false };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === "https://api.resend.com/emails") {
    const key = init.headers?.["Idempotency-Key"] ?? null;
    resend.asked.push({ key });
    if (key && resend.inProgress.has(key)) {
      const left = resend.inProgress.get(key);
      if (left > 0) { resend.inProgress.set(key, left - 1); return json(409, { name: "concurrent_idempotent_requests", message: "made-up: in progress" }); }
      resend.inProgress.delete(key);   // the first press finished: its send is the key's
      const id = `re_made_up_${resend.sends.length + 1}`;
      resend.sends.push({ key, ...JSON.parse(init.body) });
      resend.keys.set(key, { id, body: init.body });
    }
    if (key && resend.keys.has(key)) {
      const first = resend.keys.get(key);
      return first.body === init.body ? json(200, { id: first.id }) : json(409, { name: "invalid_idempotent_request", message: "made-up: another payload" });
    }
    const id = `re_made_up_${resend.sends.length + 1}`;
    resend.sends.push({ key, ...JSON.parse(init.body) });
    if (key) resend.keys.set(key, { id, body: init.body });
    return json(200, { id });
  }
  if (u.startsWith("https://api.twilio.com/")) {
    if (twilio.down) return new Response("made-up outage", { status: 503 });
    twilio.sends.push(Object.fromEntries(new URLSearchParams(String(init.body))));
    return json(201, { sid: `SM_made_up_${twilio.sends.length}` });
  }
  throw new Error(`unexpected fetch ${u}`);
};

const w = moneyWorld({
  tables: { message_sent: [], customer_messages: [], stops: [], drop_orders: [] },
  // message_sent's own defaults (0429): a claim stamped when made, not sent until marked.
  unique: { message_sent: ["event_key"] },
  rpc: { text_consent_standing: () => true, rate_limit_hit: () => true },
  defaults: { customer_messages: () => ({ id: `cm-${Math.random().toString(36).slice(2, 10)}` }), message_sent: () => ({ claimed_at: new Date().toISOString(), sent_at: null }) },
});
const accounts = { "0c422000-0000-4000-8000-0000000000a1": "sam@example.test", "0c422000-0000-4000-8000-0000000000a2": "ana@example.test" };
w.auth.admin = { getUserById: async (id) => ({ data: { user: accounts[id] ? { id, email: accounts[id] } : null }, error: null }) };

const loader = routeLoader({
  "./supabaseAdmin": { supabaseAdmin: w }, "@/lib/supabaseAdmin": { supabaseAdmin: w },
  "./serverAlerts": { raiseAlert: async () => {} },
});
// Texts at any hour here: the night rule is its own test's (lib/texts quietHours) — this one is about once.
const realTexts = loader("lib/texts.ts");
const texts = { ...realTexts, quietHours: () => false };
const L = routeLoader({
  "./supabaseAdmin": { supabaseAdmin: w }, "@/lib/supabaseAdmin": { supabaseAdmin: w },
  "./serverAlerts": { raiseAlert: async () => {} }, "./texts": texts, "@/lib/texts": texts,
});
const N = L("lib/notify.ts");
const C = L("lib/customerMessage.ts");
const reset = () => { resend.sends.length = 0; resend.keys.clear(); resend.inProgress.clear(); resend.asked.length = 0; twilio.sends.length = 0; twilio.down = false; w.tables.message_sent = []; w.tables.customer_messages = []; };

// ── the key ───────────────────────────────────────────────────────────────────────────────────────────────────────────
ok("onceKey: what happened, named — kept as written where it can be", N.onceKey("order-ready:0c422000-0000-4000-8000-000000000001") === "order-ready:0c422000-0000-4000-8000-000000000001");
ok("onceKey: …anything else made plain, and two hundred characters at most (Resend takes 256)",
  N.onceKey(" a key with spaces/and?odd#chars ") === "a_key_with_spaces_and_odd_chars" && N.onceKey("x".repeat(300)).length === 200);
ok("onceKey: no key is no key — the message goes each time it is asked", N.onceKey("") === null && N.onceKey("   ") === null && N.onceKey(undefined) === null && N.onceKey(null) === null);

// ── email: Resend's key ───────────────────────────────────────────────────────────────────────────────────────────────
{
  reset();
  const a = await N.sendEmail("sam@example.test", "GT3 — order #4F2A is ready", "made-up words", { key: "order-ready:o1" });
  const b = await N.sendEmail("sam@example.test", "GT3 — order #4F2A is ready", "made-up words", { key: "order-ready:o1" });
  ok("email: a key rides as Resend's Idempotency-Key", resend.asked[0]?.key === "order-ready:o1", resend.asked);
  ok("email: the same message twice is one email — the second answered with the first's id", a.ok && b.ok && resend.sends.length === 1 && a.id === b.id, { a, b, sends: resend.sends.length });
  const c = await N.sendEmail("sam@example.test", "GT3 — order #4F2A is ready", "other made-up words", { key: "order-ready:o1" });
  ok("email: the same key in other words (an amount re-read) — not sent, and not called sent: the first send is that call's to say (the R22 review)",
    !c.ok && /not sent: this was asked for once today in other words/.test(c.detail) && resend.sends.length === 1, c);
  resend.inProgress.set("order-ready:o2", 1);
  const t0 = Date.now();
  const d = await N.sendEmail("sam@example.test", "GT3", "made-up", { key: "order-ready:o2" });
  ok("email: a press while the first is still going asks again a moment later, and says what became of the first — sent, its id",
    d.ok && d.id === resend.keys.get("order-ready:o2")?.id && resend.sends.length === 2 && Date.now() - t0 >= 900, { d, waited: Date.now() - t0 });
  resend.inProgress.set("order-ready:o3", 5);
  const e = await N.sendEmail("sam@example.test", "GT3", "made-up", { key: "order-ready:o3" });
  ok("email: …and one still going after two more asks is not confirmed — never 'sent' on another call's word", !e.ok && /not confirmed/.test(e.detail) && resend.sends.length === 2, e);
  await N.sendEmail("sam@example.test", "GT3 — email test", "made-up", {});
  await N.sendEmail("sam@example.test", "GT3 — email test", "made-up");
  ok("email: no key, no Idempotency-Key — a test or a receipt sent again on purpose goes each time",
    resend.sends.length === 4 && resend.asked.slice(-2).every((x) => x.key === null), resend.asked.slice(-2));
}

// ── a text: claimed once in message_sent ─────────────────────────────────────────────────────────────────────────────
{
  reset();
  const tell = (key) => N.notifyCustomer({ phone: "864-555-0142", subject: "GT3", message: "made-up: your pickup day changed", key });
  const a = await tell("stop-canceled:s1:pack:p1");
  const kept = w.tables.message_sent.find((r) => r.event_key === "text:stop-canceled:s1:pack:p1");
  ok("text: the first goes, its key kept (text:<key>) and marked sent", a.sms === "sent" && twilio.sends.length === 1 && !!kept?.sent_at, { a, kept: w.tables.message_sent });
  const b = await tell("stop-canceled:s1:pack:p1");
  ok("text: the same key again is told already — no second text", b.sms === "sent" && /sent once already/.test(b.smsDetail ?? "") && twilio.sends.length === 1, b);
  // A claim another call made a moment ago and hasn't marked: it is going — not sent twice.
  w.tables.message_sent.push({ event_key: "text:stop-canceled:s1:pack:p9", claimed_at: new Date(Date.now() - 30_000).toISOString(), sent_at: null });
  const going = await tell("stop-canceled:s1:pack:p9");
  ok("text: a claim made a moment ago and not yet marked is another call sending it — not texted twice", going.sms === "sent" && /being sent by another call/.test(going.smsDetail ?? "") && twilio.sends.length === 1, going);
  // A claim never marked for two minutes: the call that made it died on the way — this one takes it over.
  w.tables.message_sent.find((r) => r.event_key === "text:stop-canceled:s1:pack:p9").claimed_at = new Date(Date.now() - 180_000).toISOString();
  const over = await tell("stop-canceled:s1:pack:p9");
  ok("text: a claim never marked in two minutes is a call that died — taken over and sent (a text missed is worse than one doubled)",
    over.sms === "sent" && twilio.sends.length === 2 && !!w.tables.message_sent.find((r) => r.event_key === "text:stop-canceled:s1:pack:p9")?.sent_at, over);
  twilio.down = true;
  const c = await tell("stop-canceled:s1:pack:p2");
  ok("text: one that didn't go lets its key go again", c.sms === "failed" && !w.tables.message_sent.some((r) => r.event_key === "text:stop-canceled:s1:pack:p2"), { c, kept: w.tables.message_sent });
  twilio.down = false;
  const d = await tell("stop-canceled:s1:pack:p2");
  ok("text: …so a retry sends it", d.sms === "sent" && twilio.sends.length === 3, d);
  w.fail.message_sent = { insert: { code: "42P01", message: "made-up: relation does not exist" } };
  const e = await tell("stop-canceled:s1:pack:p3");
  ok("text: a ledger that can't be asked (0429 not pasted yet) still texts — a text missed is worse than one doubled", e.sms === "sent" && twilio.sends.length === 4, e);
  await tell(null);
  await tell(null);
  ok("text: no key, no claim — each goes", twilio.sends.length === 6 && w.tables.message_sent.length === 3, { texts: twilio.sends.length, kept: w.tables.message_sent.length });
  const both = await N.notifyCustomer({ phone: "864-555-0142", email: "sam@example.test", subject: "GT3 — delivered", message: "made-up: on the porch", key: "delivered:d1:2026-10-18" });
  const again = await N.notifyCustomer({ phone: "864-555-0142", email: "sam@example.test", subject: "GT3 — delivered", message: "made-up: on the porch", key: "delivered:d1:2026-10-18" });
  ok("both: one key holds the email and the text — told twice, sent once each", both.sms === "sent" && both.email === "sent" && again.sms === "sent" && again.email === "sent"
    && twilio.sends.length === 7 && resend.sends.filter((m) => m.key === "delivered:d1:2026-10-18").length === 1, { both, again });
}

// ── the log keeps one row for one message ─────────────────────────────────────────────────────────────────────────────
{
  reset();
  const t = (msg) => C.tellCustomer({ orderId: "o-made-up-1", email: "ana@example.test", subject: "GT3 — shipped", message: msg, kind: "shipped", key: "shipped:o-made-up-1:1Z-MADE-UP" });
  const a = await t("made-up: on its way");
  const b = await t("made-up: on its way");
  ok("log: the webhook told twice — one email, one row of what the customer was told",
    a.ok && b.ok && resend.sends.length === 1 && w.tables.customer_messages.length === 1 && w.tables.customer_messages[0].provider_id === "re_made_up_1",
    { rows: w.tables.customer_messages.length, sends: resend.sends.length });
  const c = await t("made-up: on its way, the tracking re-read");
  ok("log: …told again in other words, nothing is sent and it is logged as what it was — not sent, and why",
    !c.ok && resend.sends.length === 1 && w.tables.customer_messages.length === 2 && w.tables.customer_messages[1].status === "failed"
      && /other words/.test(w.tables.customer_messages[1].detail ?? ""), { c, rows: w.tables.customer_messages.map((r) => [r.status, r.detail]) });
  await C.tellCustomer({ orderId: "o-made-up-1", email: "ana@example.test", subject: "GT3 — receipt", message: "made-up: receipt", kind: "receipt_resend" });
  await C.tellCustomer({ orderId: "o-made-up-1", email: "ana@example.test", subject: "GT3 — receipt", message: "made-up: receipt", kind: "receipt_resend" });
  ok("log: a receipt the crew sends again on purpose has no key — each send goes, and each is a row", resend.sends.length === 3 && w.tables.customer_messages.length === 4);
}

// ── a stop called off, twice: everyone told once ────────────────────────────────────────────────────────────────────
{
  reset();
  const STOP = "0c422000-0000-4000-8000-00000000005a", SAM = "0c422000-0000-4000-8000-0000000000a1", ANA = "0c422000-0000-4000-8000-0000000000a2";
  w.tables.stops = [{ id: STOP, name: "Made-up Market", starts_at: "2026-10-24T14:00:00Z", cancel_reason: "made-up rain" }];
  w.tables.drop_orders = [
    { id: "0c422000-0000-4000-8000-0000000000d1", stop_id: STOP, canceled_at: null, picked_up: false, user_id: ANA, phone: "864-555-0143", size: 6, paid: true },
    { id: "0c422000-0000-4000-8000-0000000000d2", stop_id: STOP, canceled_at: null, picked_up: false, user_id: null, phone: "864-555-0144", size: 4, paid: false },
  ];
  let calls = 0;
  const alerts = [];
  const cup = { id: "0c422000-0000-4000-8000-0000000000c1", user_id: SAM, items: ["rise"], paid: true, collected_via: null, total_cents: 900, tip_cents: 0, payment_id: "sq-made-up-1" };
  const caller = {
    rpc: async (name) => {
      if (name === "cancel_stop") return { data: { day: "2026-10-24", cups: calls === 0 ? 1 : 0, packs: 2, other_stop_that_day: false, already: calls++ > 0 }, error: null };
      if (name === "void_stop_orders") return { data: { voided: calls === 1 ? [cup] : [], stuck: [] }, error: null };
      return { data: null, error: { code: "PGRST202", message: name } };
    },
  };
  const R = routeLoader({
    "next/server": { NextResponse: NextResponseShim },
    "@/lib/supabaseAdmin": { supabaseAdmin: w },
    "@/lib/apiAuth": { staffFromRequest: async () => true, callerClient: () => caller },
    "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); } },
    "@/lib/notify": N,
    "@/lib/apiRoute": { route: (_n, f) => f, isJsonObject: (v) => !!v && typeof v === "object" && !Array.isArray(v) },
  })("app/api/crew/stops/cancel/route.ts");
  const call = () => R.POST(new Request("https://app.example.test/api/crew/stops/cancel", { method: "POST", body: JSON.stringify({ id: STOP, reason: "made-up rain" }) })).then((r) => r.json());
  const first = await call();
  ok("stop: the first call tells its cup order's member and both packs, and raises the crew's one line",
    first.ok && first.told === 1 && first.packs === 2 && alerts.length === 1
      && resend.sends.some((m) => m.key === `order-canceled:${cup.id}`) && resend.sends.some((m) => m.key === `stop-canceled:${STOP}:pack:0c422000-0000-4000-8000-0000000000d1`)
      && twilio.sends.length === 2, { first, sends: resend.sends.map((m) => m.key), texts: twilio.sends.length });
  const second = await call();
  ok("stop: a retry — nothing left to void — tells the packs again by key, so nobody hears twice, and raises nothing new",
    second.ok && second.already === true && second.packs === 2 && alerts.length === 1 && resend.sends.length === 2 && twilio.sends.length === 2,
    { second, sends: resend.sends.length, texts: twilio.sends.length, alerts: alerts.length });
  // The first call died after the cups were told and before any pack was — what the retry is for.
  reset(); calls = 1;
  w.tables.message_sent = [];
  await N.notifyCustomer({ email: "sam@example.test", subject: "GT3 — your order is canceled", message: "made-up", key: `order-canceled:${cup.id}` });
  const after = await call();
  ok("stop: a first call that died before its packs leaves them to the retry — told now (they never heard)",
    after.ok && after.packs === 2 && twilio.sends.length === 2 && resend.sends.filter((m) => /:pack:/.test(m.key ?? "")).length === 1, { after, texts: twilio.sends.length });
}

// ── every message that names something passes its key ────────────────────────────────────────────────────────────────
{
  const src = (p) => readFileSync(join(ROOT, p), "utf8");
  const pins = [
    ["app/api/notify/route.ts", /key: `order-ready:\$\{o\.id\}`/, "the Pass's ready"],
    ["app/api/notify/route.ts", /key: `order-canceled:\$\{o\.id\}`/, "the Pass's void"],
    ["app/api/notify/route.ts", /key: `delivered:\$\{d\.id\}:\$\{etToday\(\)\}`/, "a porch run's delivered"],
    ["app/api/crew/stops/cancel/route.ts", /key: `order-canceled:\$\{c\.id\}`/, "a stop's cup orders"],
    ["app/api/crew/stops/cancel/route.ts", /key: `stop-canceled:\$\{id\}:pack:\$\{p\.id\}`/, "a stop's packs"],
    ["app/api/orders/cancel/route.ts", /key: channel === "cup" \? `order-canceled:\$\{id\}` : `\$\{channel\}-canceled:\$\{id\}`/, "a member's own cancel"],
    ["app/api/orders/ticket-cancel/route.ts", /key: `order-canceled:\$\{row\.id\}`/, "a ticket's cancel"],
    ["lib/reservePay.ts", /key: `reserve-held:\$\{hold\.id\}`/, "a reserve held"],
    ["lib/reservePay.ts", /key: `reserve-canceled:\$\{c\.id\}`/, "a reserve canceled"],
    ["app/api/reserves/pay/route.ts", /message: c\.message, key: c\.key/, "the reserve pay route passing it on"],
    ["app/api/reserves/cancel/route.ts", /message: c\.message, key: c\.key/, "the reserve cancel route passing it on"],
    ["app/api/reserve/change/route.ts", /key: `pack-changed:\$\{c\.key\}`/, "a pack changed"],
    ["app/api/apliiq/fulfillment/route.ts", /key: `shipped:\$\{o\.id\}:\$\{tracking \|\| "no-tracking"\}`/, "a shipment"],
  ];
  const missing = pins.filter(([p, re]) => !re.test(src(p))).map(([p, , what]) => `${what} (${p})`);
  ok("keys: every message that names something it happened to passes its key", missing.length === 0, missing);
  ok("keys: the crew's resend of a receipt and the email test carry none — a press on purpose goes each time",
    !/key:/.test(src("app/api/shop/receipt/route.ts").match(/tellCustomer\(\{[\s\S]*?\}\);/)?.[0] ?? "x") && /sendEmail\(to, "GT3 — email test", [^)]*\);/.test(src("app/api/notify/route.ts")));
}

console.log(`R22 (the same message, once): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
