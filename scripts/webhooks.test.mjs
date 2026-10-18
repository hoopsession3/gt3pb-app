// EVERY INBOUND WEBHOOK PROVES WHO SENT IT — lib/webhookSignature and the routes on top of it, run (2026-10-11, wave 2).
//
// Six doors take requests with no session: Square, Resend (Svix), Stripe, Apliiq and Twilio (texts sent to us, 2026-10-14)
// sign theirs; the inbound-email door (notes/inbound) carries a shared token. Each must answer a missing or wrong signature with 401 and act on
// nothing, and let a correctly signed one through. The checks are compiled from lib/webhookSignature.ts and asked
// directly; then each route file is compiled and called with a Request, as Next calls it — its own code, with its
// database, alerts and error intake stood in for by recorders (nothing here talks to Supabase, Square, Stripe,
// Resend, Apliiq or Twilio). Every secret, key, token and signature below is made up for this file.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

// A file of the app, compiled. `@/x` and `./x` resolve inside the repo; anything named in `shims` is stood in for.
function loader(shims = {}) {
  const cache = new Map();
  const load = (rel) => {
    if (cache.has(rel)) return cache.get(rel).exports;
    const mod = { exports: {} };
    cache.set(rel, mod);
    const out = ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function("module", "exports", "require", out)(mod, mod.exports, (spec) => {
      if (Object.prototype.hasOwnProperty.call(shims, spec)) return shims[spec];
      if (spec === "crypto" || spec === "node:crypto") return nodeRequire("node:crypto");
      if (spec.startsWith("@/")) return load(`${spec.slice(2)}.ts`);
      if (spec.startsWith("./")) return load(join(dirname(rel), `${spec.slice(2)}.ts`));
      throw new Error(`unexpected import ${spec} in ${rel}`);
    });
    return mod.exports;
  };
  return load;
}

const W = loader()("lib/webhookSignature.ts");
ok("compiled: lib/webhookSignature", typeof W.squareSignatureOk === "function" && typeof W.svixSignatureOk === "function"
  && typeof W.stripeSignatureOk === "function" && typeof W.apliiqSignatureOk === "function" && typeof W.twilioSignatureOk === "function"
  && typeof W.tokenOk === "function");

// ── the made-up secrets, and each provider's signature computed here independently, from its documentation ────────
const SQ_KEY = "made-up-square-signature-key-for-tests", SQ_URL = "https://app.example.test/api/square/webhook";
const sqSign = (body, url = SQ_URL, key = SQ_KEY) => createHmac("sha256", key).update(url + body).digest("base64");
const SVIX_SECRET = "whsec_" + Buffer.from("made-up svix secret, for tests only").toString("base64");
const svixSign = (id, t, body, secret = SVIX_SECRET) =>
  createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${t}.${body}`).digest("base64");
const STRIPE_SECRET = "whsec_made_up_stripe_secret_for_tests";
const stripeSign = (t, body, secret = STRIPE_SECRET) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
const APLIIQ_SECRET = "made-up-apliiq-shared-secret";
const apliiqHeader = (body, { rts = String(Math.floor(Date.now() / 1000)), appid = "app-test", state = "nonce1234", secret = APLIIQ_SECRET } = {}) =>
  `x-apliiq-auth ${rts}:${createHmac("sha256", secret).update(appid + rts + state + (body ? Buffer.from(body).toString("base64") : "")).digest("base64")}:${appid}:${state}`;
// Twilio: HMAC-SHA1 of the URL set on the number followed by each form field, name then value, in name order — base64.
const TW_TOKEN = "made-up-twilio-auth-token", TW_URL = "https://app.example.test/api/sms/inbound";
const twSign = (params, url = TW_URL, token = TW_TOKEN) =>
  createHmac("sha1", token).update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
const now = Math.floor(Date.now() / 1000);

// ── 1 · the checks ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const body = JSON.stringify({ type: "payment.updated", event_id: "evt-test-1" });
  ok("square: a correct signature over the registered URL and the raw body passes", W.squareSignatureOk(body, sqSign(body), SQ_KEY, SQ_URL));
  ok("square: missing, empty, or for another body, URL or key — refused",
    !W.squareSignatureOk(body, null, SQ_KEY, SQ_URL) && !W.squareSignatureOk(body, "", SQ_KEY, SQ_URL)
    && !W.squareSignatureOk(body + " ", sqSign(body), SQ_KEY, SQ_URL) && !W.squareSignatureOk(body, sqSign(body, "https://elsewhere.test/hook"), SQ_KEY, SQ_URL)
    && !W.squareSignatureOk(body, sqSign(body, SQ_URL, "another-key"), SQ_KEY, SQ_URL));
  ok("square: with no key or no URL configured, nothing passes", !W.squareSignatureOk(body, sqSign(body), "", SQ_URL) && !W.squareSignatureOk(body, sqSign(body), SQ_KEY, ""));
  // THE DEFECT, QUOTED: the route's old compare, characters then bytes.
  const sig = sqSign(body), forged = "é" + sig.slice(1);
  let threw = null;
  try { const crypto = nodeRequire("node:crypto"); void (forged.length === sig.length && crypto.timingSafeEqual(Buffer.from(forged), Buffer.from(sig))); }
  catch (e) { threw = e?.code ?? String(e); }
  ok("square, before: the old compare threw on a forged header the right length in characters — the route answered a forgery with a 500",
    forged.length === sig.length && threw === "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH", threw);
  ok("square, now: the same forgery is refused, without a throw", W.squareSignatureOk(body, forged, SQ_KEY, SQ_URL) === false);
}
{
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "em_TEST" } });
  const h = (sig, t = String(now), id = "msg_TEST1") => ({ id, timestamp: t, signature: sig });
  ok("svix: a correct v1 signature passes", W.svixSignatureOk(body, h(`v1,${svixSign("msg_TEST1", now, body)}`), SVIX_SECRET, now));
  ok("svix: during a secret rotation the header carries two; the matching one may come second",
    W.svixSignatureOk(body, h(`v1,${svixSign("msg_TEST1", now, body, "whsec_" + Buffer.from("the old secret").toString("base64"))} v1,${svixSign("msg_TEST1", now, body)}`), SVIX_SECRET, now));
  ok("svix: missing headers, a wrong secret, another body, another message id — refused",
    !W.svixSignatureOk(body, h(null), SVIX_SECRET, now) && !W.svixSignatureOk(body, { id: null, timestamp: String(now), signature: "v1,x" }, SVIX_SECRET, now)
    && !W.svixSignatureOk(body, h(`v1,${svixSign("msg_TEST1", now, body, "whsec_" + Buffer.from("not ours").toString("base64"))}`), SVIX_SECRET, now)
    && !W.svixSignatureOk(body + "x", h(`v1,${svixSign("msg_TEST1", now, body)}`), SVIX_SECRET, now)
    && !W.svixSignatureOk(body, h(`v1,${svixSign("msg_TEST1", now, body)}`, String(now), "msg_OTHER"), SVIX_SECRET, now));
  ok("svix: a signature without its v1, prefix is not one", !W.svixSignatureOk(body, h(svixSign("msg_TEST1", now, body)), SVIX_SECRET, now));
  ok("svix: replayed six minutes later, or stamped six minutes ahead — refused (Svix's five-minute window)",
    !W.svixSignatureOk(body, h(`v1,${svixSign("msg_TEST1", now - 360, body)}`, String(now - 360)), SVIX_SECRET, now)
    && !W.svixSignatureOk(body, h(`v1,${svixSign("msg_TEST1", now + 360, body)}`, String(now + 360)), SVIX_SECRET, now)
    && W.svixSignatureOk(body, h(`v1,${svixSign("msg_TEST1", now - 240, body)}`, String(now - 240)), SVIX_SECRET, now));
  ok("svix: a timestamp that is not a number is refused", !W.svixSignatureOk(body, h(`v1,${svixSign("msg_TEST1", "soon", body)}`, "soon"), SVIX_SECRET, now));
  ok("svix: no secret configured — nothing passes", !W.svixSignatureOk(body, h(`v1,${svixSign("msg_TEST1", now, body)}`), "", now));
}
{
  const body = JSON.stringify({ id: "evt_TEST", type: "customer.subscription.updated", data: { object: {} } });
  ok("stripe: a correct v1 passes", W.stripeSignatureOk(body, `t=${now},v1=${stripeSign(now, body)}`, STRIPE_SECRET, now));
  ok("stripe: rolling a secret, Stripe signs with both — the match may come FIRST (the old parser kept only the last v1)",
    W.stripeSignatureOk(body, `t=${now},v1=${stripeSign(now, body)},v1=${stripeSign(now, body, "whsec_the_old_one")}`, STRIPE_SECRET, now));
  const oldParse = (header) => Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2))).v1;
  ok("stripe, before: the old parser read that header's v1 as the old secret's — a real event refused",
    oldParse(`t=${now},v1=${stripeSign(now, body)},v1=${stripeSign(now, body, "whsec_the_old_one")}`) === stripeSign(now, body, "whsec_the_old_one"));
  ok("stripe: missing, wrong, another body, no t, no v1, a v0 alone — refused",
    !W.stripeSignatureOk(body, null, STRIPE_SECRET, now) && !W.stripeSignatureOk(body, `t=${now},v1=${stripeSign(now, body, "whsec_nope")}`, STRIPE_SECRET, now)
    && !W.stripeSignatureOk(body + " ", `t=${now},v1=${stripeSign(now, body)}`, STRIPE_SECRET, now) && !W.stripeSignatureOk(body, `v1=${stripeSign(now, body)}`, STRIPE_SECRET, now)
    && !W.stripeSignatureOk(body, `t=${now}`, STRIPE_SECRET, now) && !W.stripeSignatureOk(body, `t=${now},v0=${stripeSign(now, body)}`, STRIPE_SECRET, now));
  ok("stripe: signed more than five minutes ago — refused", !W.stripeSignatureOk(body, `t=${now - 301},v1=${stripeSign(now - 301, body)}`, STRIPE_SECRET, now));
  ok("stripe: an odd-length or non-hex v1 is refused, not thrown", !W.stripeSignatureOk(body, `t=${now},v1=abc`, STRIPE_SECRET, now) && !W.stripeSignatureOk(body, `t=${now},v1=${"z".repeat(64)}`, STRIPE_SECRET, now));
}
{
  const body = JSON.stringify({ external_id: "order-test", TrackingNumber: "TRACK-TEST" });
  ok("apliiq: a correct x-apliiq-auth passes, with the scheme word or without", W.apliiqSignatureOk(body, apliiqHeader(body), APLIIQ_SECRET)
    && W.apliiqSignatureOk(body, apliiqHeader(body).replace(/^x-apliiq-auth /, ""), APLIIQ_SECRET));
  ok("apliiq: missing, short, wrong secret, another body — refused",
    !W.apliiqSignatureOk(body, null, APLIIQ_SECRET) && !W.apliiqSignatureOk(body, "x-apliiq-auth 1:2:3", APLIIQ_SECRET)
    && !W.apliiqSignatureOk(body, apliiqHeader(body, { secret: "not-ours" }), APLIIQ_SECRET) && !W.apliiqSignatureOk(body + "x", apliiqHeader(body), APLIIQ_SECRET));
  ok("apliiq: no secret configured — closed", !W.apliiqSignatureOk(body, apliiqHeader(body), ""));
  // R9: the signed RTS has an age. A week, and an hour ahead for a fast clock — inside the inbox's 30 days.
  const weekS = W.APLIIQ_MAX_AGE_S, at = (rts) => apliiqHeader(body, { rts: String(rts) });
  ok("apliiq: the window is a week, inside the inbox's 30 days", weekS === 7 * 24 * 3600 && W.APLIIQ_MAX_AHEAD_S === 3600, [weekS, W.APLIIQ_MAX_AHEAD_S]);
  ok("apliiq: signed six days ago, or a minute ahead — passes", W.apliiqSignatureOk(body, at(now - 6 * 86400), APLIIQ_SECRET, now) && W.apliiqSignatureOk(body, at(now + 60), APLIIQ_SECRET, now));
  ok("apliiq: signed eight days ago, or two hours ahead — refused, though the signature is right",
    !W.apliiqSignatureOk(body, at(now - 8 * 86400), APLIIQ_SECRET, now) && !W.apliiqSignatureOk(body, at(now + 7200), APLIIQ_SECRET, now));
  ok("apliiq: RTS in milliseconds reads as the same time — fresh passes, stale refused",
    W.apliiqSignatureOk(body, at(now * 1000), APLIIQ_SECRET, now) && !W.apliiqSignatureOk(body, at((now - 8 * 86400) * 1000), APLIIQ_SECRET, now));
  ok("apliiq: an RTS that reads as no time can only be Apliiq's own format — let through, as before",
    W.apliiqSignatureOk(body, at("rts-word"), APLIIQ_SECRET, now));
}
{
  // Twilio's own worked example (its "Webhooks security" page): token 12345, this URL and these five fields sign to this.
  const doc = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  const DOC_URL = "https://mycompany.com/myapp.php?foo=1&bar=2", DOC_SIG = "0/KCTR6DLpKmkAf8muzZqo1nDgQ=";
  ok("twilio: the documented example — token 12345 over its URL and fields — passes", W.twilioSignatureOk(doc, DOC_SIG, "12345", DOC_URL));
  ok("twilio: the field order on the wire does not matter (signed in name order)",
    W.twilioSignatureOk({ To: doc.To, From: doc.From, Digits: doc.Digits, Caller: doc.Caller, CallSid: doc.CallSid }, DOC_SIG, "12345", DOC_URL));
  ok("twilio: another token, URL, field value, an added field, or a missing one — refused",
    !W.twilioSignatureOk(doc, DOC_SIG, "12346", DOC_URL) && !W.twilioSignatureOk(doc, DOC_SIG, "12345", DOC_URL.replace("foo=1", "foo=2"))
    && !W.twilioSignatureOk({ ...doc, Digits: "1235" }, DOC_SIG, "12345", DOC_URL) && !W.twilioSignatureOk({ ...doc, Body: "STOP" }, DOC_SIG, "12345", DOC_URL)
    && !W.twilioSignatureOk({ CallSid: doc.CallSid, Caller: doc.Caller, Digits: doc.Digits, From: doc.From }, DOC_SIG, "12345", DOC_URL));
  ok("twilio: missing or empty header, no token, no URL — refused; a non-ASCII forgery is refused, not thrown",
    !W.twilioSignatureOk(doc, null, "12345", DOC_URL) && !W.twilioSignatureOk(doc, "", "12345", DOC_URL)
    && !W.twilioSignatureOk(doc, DOC_SIG, "", DOC_URL) && !W.twilioSignatureOk(doc, DOC_SIG, "12345", "")
    && W.twilioSignatureOk(doc, "é" + DOC_SIG.slice(1), "12345", DOC_URL) === false);
  const p = { From: "+18645550100", To: "+18645550199", Body: "STOP", MessageSid: "SM-made-up" };
  ok("twilio: this file's signer agrees with the check (so the route tests below sign as Twilio does)", W.twilioSignatureOk(p, twSign(p), TW_TOKEN, TW_URL));
}
ok("token: equal passes; different, missing, or with no secret set does not",
  W.tokenOk("made-up-token", "made-up-token") && !W.tokenOk("made-up-tokeN", "made-up-token") && !W.tokenOk(null, "made-up-token")
  && !W.tokenOk("", "") && !W.tokenOk("é", "x") && !W.tokenOk("made-up-token", undefined));

// ── 2 · the routes, run ──────────────────────────────────────────────────────────────────────────────────────────
// Stand-ins: NextResponse.json is a Response; the service-role client records each call and answers "nothing there";
// the alert raisers and the error intake record what they are asked. lib/apiRoute, lib/squareServer, lib/money and
// lib/webhookSignature are the real files.
// (A class, so a route may also answer `new NextResponse(text, init)` — the inbound-text route answers TwiML.)
class NextResponseShim extends Response {
  static json(body, init) { return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } }); }
}
const nextServer = { NextResponse: NextResponseShim };
function world({ rpc: answer = () => ({ data: null, error: null }), table: tableAnswer = () => ({ data: null, error: null, count: 0 }), lasts = true } = {}) {
  const calls = [], alerts = [], filed = [], rpcs = [];
  const rpc = async (name, args) => { rpcs.push({ name, args }); return answer(name, args); };
  const from = (table) => {
    const steps = [];
    calls.push({ table, steps });
    const chain = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (res, rej) => Promise.resolve(tableAnswer(table, steps)).then(res, rej);
        return (...args) => { steps.push([String(prop), ...args]); return chain; };
      },
    });
    return chain;
  };
  const shims = {
    "next/server": nextServer,
    "@/lib/supabaseAdmin": { supabaseAdmin: { from, rpc } },
    "./supabaseAdmin": { supabaseAdmin: { from, rpc } },
    // refusalLasts (R32 — API11-04): whether a failed signature has lasted (three in the hour, none verified in a day) —
    // its own rules are run below, from lib/serverAlerts; here it answers as each case says.
    "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { alerts.push(a); return true; }, refusalLasts: async () => lasts },
    "./errorIntake": { fileError: async (e) => { filed.push(e); return true; } },
    "./apliiqOrder": { buildOrderPayload: () => ({}) },
    "./errorMessage": { errorMessage: (e) => String(e) },
  };
  return { calls, alerts, filed, rpcs, shims, wrote: () => rpcs.length > 0 || calls.some((c) => c.steps.some(([m]) => ["insert", "update", "upsert", "delete"].includes(m))) };
}
const withEnv = async (env, fn) => {
  const before = {};
  for (const k of Object.keys(env)) { before[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(env)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
};
const post = async (mod, url, headers, body) => {
  const res = await mod.POST(new Request(url, { method: "POST", headers, body }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, type: res.headers.get("content-type") ?? "" };
};

// Square
await withEnv({ SQUARE_WEBHOOK_SIGNATURE_KEY: SQ_KEY, SQUARE_WEBHOOK_URL: SQ_URL }, async () => {
  // The route says each refusal in the platform's log (R14); the test keeps its own output to its checks.
  const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
  const run = async (headers, body, opts = {}) => quiet(async () => { const w = world(opts); const r = await post(loader(w.shims)("app/api/square/webhook/route.ts"), SQ_URL, headers, body); return { ...r, w }; });
  const body = JSON.stringify({ type: "unknown.event", event_id: "evt-sq-test" });
  const none = await run({}, body), wrong = await run({ "x-square-hmacsha256-signature": sqSign(body, SQ_URL, "not-the-key") }, body);
  ok("square route: no signature → 401, nothing read or written", none.status === 401 && none.w.calls.length === 0, none.status);
  ok("square route: a wrong signature → 401, nothing written", wrong.status === 401 && wrong.w.calls.length === 0, wrong.status);
  const forged = await run({ "x-square-hmacsha256-signature": "é" + sqSign(body).slice(1) }, body);
  ok("square route: a forged header with a non-ASCII character → 401, not a 500 filed as a crash", forged.status === 401 && forged.w.filed.length === 0, { status: forged.status, filed: forged.w.filed.length });
  const tampered = await run({ "x-square-hmacsha256-signature": sqSign(body) }, body.replace("unknown", "subscription"));
  ok("square route: a body changed after signing → 401", tampered.status === 401 && !tampered.w.wrote());
  // R14 (2026-10-17 — the 10/10 audit, F15): a refusal is said. An event shaped like Square's whose signature fails tells
  // the crew (raiseAlertOnce — one open alert however many arrive): a rotated key or a changed address. A stranger's post
  // — no signature, or not shaped like Square's — is a forgery's 401 and tells no one.
  const sqShaped = JSON.stringify({ merchant_id: "ML-TEST", type: "payment.updated", event_id: "evt-sig-1" });
  const rotated = await quiet(() => run({ "x-square-hmacsha256-signature": sqSign(sqShaped, SQ_URL, "a-rotated-key") }, sqShaped));
  const sigAlert = rotated.w.alerts.find((a) => a.kind === "webhook_signature");
  ok("square route (R14): a Square-shaped event whose signature fails → 401, and the crew is told (critical, money, once while it lasts)",
    rotated.status === 401 && !!sigAlert && sigAlert.severity === "critical" && sigAlert.category === "money" && sigAlert.subjectId === "square" && !rotated.w.wrote(), rotated.w.alerts);
  // R32 (API11-04): …only once it lasts — a stranger's Square-shaped post with a wrong signature, before that, is the log's.
  const stranger = await quiet(() => run({ "x-square-hmacsha256-signature": sqSign(sqShaped, SQ_URL, "a-strangers-guess") }, sqShaped, { lasts: false }));
  ok("square route (R32): a Square-shaped bad signature that hasn't lasted (a stranger's post) → 401, and tells no one",
    stranger.status === 401 && stranger.w.alerts.length === 0, stranger.w.alerts);
  ok("square route (R14): …a post with no signature, or one not shaped like Square's, tells no one",
    none.w.alerts.length === 0 && wrong.w.alerts.length === 0 && forged.w.alerts.length === 0, { none: none.w.alerts, wrong: wrong.w.alerts });
  // What threw is kept with the event, in its own words, and Square is answered 500 so it sends the event again.
  const threw = await quiet(async () => {
    const w = world({ table: (table) => { if (table === "subscriptions") throw new Error("connection reset by peer"); return { data: null, error: null }; } });
    const tb = JSON.stringify({ type: "subscription.updated", event_id: "evt-throw-1", data: { object: { subscription: { id: "sq-sub-1", status: "ACTIVE" } } } });
    const r = await post(loader(w.shims)("app/api/square/webhook/route.ts"), SQ_URL, { "x-square-hmacsha256-signature": sqSign(tb) }, tb);
    return { ...r, w };
  });
  const noted = threw.w.calls.filter((c) => c.table === "webhook_events").flatMap((c) => c.steps).find(([m, v]) => m === "update" && typeof v?.error === "string");
  ok("square route (R14): what threw is kept with the event in its own words (not \"processing threw\" alone), and Square is answered 500 to send it again",
    threw.status === 500 && noted?.[1]?.error === "processing threw: connection reset by peer", { status: threw.status, noted });
  const good = await run({ "x-square-hmacsha256-signature": sqSign(body) }, body);
  ok("square route: correctly signed → 200, and it records the event (the inbox insert, 0230)",
    good.status === 200 && good.w.calls.some((c) => c.table === "webhook_events" && c.steps.some(([m]) => m === "insert")), { status: good.status, json: good.json });

  // R9 (0417): a shop order refunded in parts. $5 recorded; Square has now given back $5 and $5. The second refund alone
  // equals what is recorded — it used to say nothing; all of what went back is $10, and the alert says the $5 missing.
  const refundRun = async (recorded, completed) => {
    const w = world({ table: (table, steps) => {
      const m = steps.map(([x]) => x);
      if (table === "shop_orders" && m.includes("select")) return { data: { id: "6f1c2b8e-5d4a-4c3b-9a21-0e8f7d6c5b4a", refund_amount_cents: recorded, ship_name: "Ana Ruiz", email: null }, error: null };
      if (table === "square_refunds" && m.includes("select")) return { data: completed.map((c) => ({ amount_cents: c })), error: null };
      return { data: null, error: null };
    } });
    const rb = JSON.stringify({ type: "refund.updated", event_id: `evt-rf-${recorded}-${completed.join("-")}`, data: { object: { refund: { id: "rf-2", payment_id: "sq-pay-1", status: "COMPLETED", amount_money: { amount: completed[completed.length - 1] } } } } });
    const r = await post(loader(w.shims)("app/api/square/webhook/route.ts"), SQ_URL, { "x-square-hmacsha256-signature": sqSign(rb) }, rb);
    return { ...r, w };
  };
  const parts = await refundRun(500, [500, 500]);
  const said = parts.w.alerts.find((a) => a.kind === "refund_unrecorded");
  ok("square route: a second part refunded in Square is summed with the first — $10 back, $5 recorded, the $5 missing is said",
    parts.status === 200 && !!said && /refunded \$10\.00 in Square, and this order records \$5\.00\. Record the other \$5\.00 on the order/.test(said.body), said?.body);
  const square = await refundRun(1000, [500, 500]);
  ok("square route: …and once the order records all of it, nothing is said", square.status === 200 && !square.w.alerts.some((a) => a.kind === "refund_unrecorded"), square.w.alerts);

  // R9 review: an office link paid when its order is already paid by hand, or canceled.
  const linkRun = async (bo) => {
    const w = world({ table: (table, steps) => {
      const m = steps.map(([x]) => x);
      if (table === "events") return { data: null, error: null };
      if (table === "business_orders" && m.includes("select")) return { data: bo, error: null };
      return { data: null, error: null };
    } });
    const pb = JSON.stringify({ type: "payment.updated", event_id: `evt-pay-${bo.payment_status}-${bo.canceled_at ? "c" : "o"}`, data: { object: { payment: { id: "sq-link-pay-77", status: "COMPLETED", order_id: "sq-order-9", amount_money: { amount: 13500 } } } } });
    const r = await post(loader(w.shims)("app/api/square/webhook/route.ts"), SQ_URL, { "x-square-hmacsha256-signature": sqSign(pb) }, pb);
    return { ...r, w, wroteOrder: w.calls.some((c) => c.table === "business_orders" && c.steps.some(([x]) => x === "update")) };
  };
  const twice = await linkRun({ id: "b0000000-0000-4000-8000-000000000001", company: "Acme", payment_status: "paid", payment_id: null, canceled_at: null });
  ok("square route: a link paid on an order already paid by hand is asked about — and left on no order, so its refund comes off walk-up, not the office's",
    twice.status === 200 && !twice.wroteOrder && twice.w.alerts.some((a) => a.kind === "office_paid_twice" && /ending ay-77|ending pay-77/.test(a.body)), { wrote: twice.wroteOrder, alerts: twice.w.alerts.map((a) => a.body) });
  const gone = await linkRun({ id: "b0000000-0000-4000-8000-000000000002", company: "Acme", payment_status: "paid", payment_id: null, canceled_at: "2026-10-16T12:00:00Z" });
  const flag = gone.w.alerts.find((a) => a.kind === "refund_needed");
  ok("square route: a link paid on a canceled order raises its own refund flag, keyed by the payment — never folded into the cancel's",
    gone.status === 200 && !!flag && flag.subjectId === "office-pay:sq-link-pay-77" && flag.severity === "critical", flag);

  // R20 (API F16): a subscription's alerts are keyed by it — Square sending the event twice at once is one line.
  const subRun = async (b) => { const w = world(); const r = await post(loader(w.shims)("app/api/square/webhook/route.ts"), SQ_URL, { "x-square-hmacsha256-signature": sqSign(b) }, b); return { ...r, w }; };
  const canceled = await subRun(JSON.stringify({ type: "subscription.updated", event_id: "evt-sub-cx", data: { object: { subscription: { id: "sq-sub-77", status: "CANCELED" } } } }));
  const cx = canceled.w.alerts.find((a) => a.title === "Subscription canceled");
  ok("square route: a subscription canceled is said keyed by the subscription (kind subscription_canceled)", canceled.status === 200 && cx?.kind === "subscription_canceled" && cx?.subjectId === "sq-sub-77", cx);
  const declined = await subRun(JSON.stringify({ type: "invoice.payment_failed", event_id: "evt-inv-fail", data: { object: { invoice: { subscription_id: "sq-sub-78" } } } }));
  const df = declined.w.alerts.find((a) => a.title === "Subscription payment failed");
  ok("square route: a subscription's payment failed is said keyed by it (critical, kind subscription_payment_failed)", declined.status === 200 && df?.kind === "subscription_payment_failed" && df?.subjectId === "sq-sub-78" && df?.severity === "critical", df);
});
await withEnv({ SQUARE_WEBHOOK_SIGNATURE_KEY: undefined, SQUARE_WEBHOOK_URL: undefined }, async () => {
  const w = world();
  const body = "{}";
  const said = console.error; console.error = () => {};
  const r = await post(loader(w.shims)("app/api/square/webhook/route.ts"), SQ_URL, { "x-square-hmacsha256-signature": sqSign(body) }, body);
  console.error = said;
  ok("square route: with its key unset it refuses every event (503), as it always has", r.status === 503 && w.calls.length === 0, r.status);
  const off = w.alerts.find((a) => a.kind === "webhook_off");
  ok("square route (R14): …and says so — the crew is told once while it lasts (critical, money), naming what is not set and no value",
    !!off && off.severity === "critical" && off.category === "money" && off.subjectId === "square" && /SQUARE_WEBHOOK_SIGNATURE_KEY/.test(off.body) && /SQUARE_WEBHOOK_URL/.test(off.body), off);
});

// Resend (Svix)
await withEnv({ RESEND_WEBHOOK_SECRET: SVIX_SECRET }, async () => {
  const run = async (headers, body) => { const w = world(); const r = await post(loader(w.shims)("app/api/resend/webhook/route.ts"), "https://app.example.test/api/resend/webhook", headers, body); return { ...r, w }; };
  const body = JSON.stringify({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: "em_TEST", bounce: { type: "hard", message: "made up" } } });
  const t = String(Math.floor(Date.now() / 1000));
  const signed = (sig, ts = t) => ({ "svix-id": "msg_TEST", "svix-timestamp": ts, "svix-signature": sig });
  const none = await run({}, body);
  ok("resend route: no svix headers → 401, nothing written", none.status === 401 && none.w.calls.length === 0, none.status);
  const wrong = await run(signed(`v1,${svixSign("msg_TEST", t, body, "whsec_" + Buffer.from("not ours").toString("base64"))}`), body);
  ok("resend route: a wrong signature → 401", wrong.status === 401 && wrong.w.calls.length === 0, wrong.status);
  const stale = String(Number(t) - 600);
  const replay = await run(signed(`v1,${svixSign("msg_TEST", stale, body)}`, stale), body);
  ok("resend route: a correctly signed event replayed ten minutes on → 401", replay.status === 401 && replay.w.calls.length === 0, replay.status);
  const good = await run(signed(`v1,${svixSign("msg_TEST", t, body)}`), body);
  ok("resend route: correctly signed → through the gate (200), and it looks the message up",
    good.status === 200 && good.w.calls.some((c) => c.table === "customer_messages"), { status: good.status, json: good.json });
});
await withEnv({ RESEND_WEBHOOK_SECRET: undefined }, async () => {
  const w = world();
  const r = await post(loader(w.shims)("app/api/resend/webhook/route.ts"), "https://app.example.test/api/resend/webhook", {}, "{}");
  ok("resend route: with its secret unset it refuses every event (503), as it always has", r.status === 503 && w.calls.length === 0, r.status);
});

// Stripe
await withEnv({ STRIPE_WEBHOOK_SECRET: STRIPE_SECRET }, async () => {
  const run = async (headers, body) => { const w = world(); const r = await post(loader(w.shims)("app/api/billing/webhook/route.ts"), "https://app.example.test/api/billing/webhook", headers, body); return { ...r, w }; };
  const body = JSON.stringify({ id: "evt_TEST", type: "invoice.created", data: { object: {} } });
  const t = Math.floor(Date.now() / 1000);
  const none = await run({}, body);
  ok("billing route: no Stripe-Signature → 401 (it said 400), nothing written", none.status === 401 && none.w.calls.length === 0, none.status);
  const wrong = await run({ "stripe-signature": `t=${t},v1=${stripeSign(t, body, "whsec_not_ours")}` }, body);
  ok("billing route: a wrong signature → 401", wrong.status === 401 && wrong.w.calls.length === 0, wrong.status);
  const rolled = await run({ "stripe-signature": `t=${t},v1=${stripeSign(t, body)},v1=${stripeSign(t, body, "whsec_old")}` }, body);
  ok("billing route: signed with the new and the old secret while one is rolled → through (200)", rolled.status === 200 && rolled.w.calls.some((c) => c.table === "webhook_events"), rolled.status);
});
await withEnv({ STRIPE_WEBHOOK_SECRET: undefined }, async () => {
  const w = world();
  const r = await post(loader(w.shims)("app/api/billing/webhook/route.ts"), "https://app.example.test/api/billing/webhook", {}, JSON.stringify({ id: "evt_FORGED", type: "checkout.session.completed", data: { object: { client_reference_id: "x" } } }));
  ok("billing route: with STRIPE_WEBHOOK_SECRET unset it stays dormant as it was — 200, and it reads and writes nothing (a decision for the owner, not this change)",
    r.status === 200 && w.calls.length === 0 && w.alerts.length === 0, { status: r.status, calls: w.calls.length });
});

// The inbound-email door (a token, not a signature)
await withEnv({ NOTES_INBOUND_SECRET: "made-up-notes-token", NOTES_INBOUND_FROM: undefined }, async () => {
  const run = async (token) => {
    const w = world();
    const url = `https://app.example.test/api/notes/inbound${token === null ? "" : `?token=${encodeURIComponent(token)}`}`;
    const r = await post(loader(w.shims)("app/api/notes/inbound/route.ts"), url, { "content-type": "application/json" }, JSON.stringify({ from: "someone@example.test", subject: "A note", text: "Made-up text." }));
    return { ...r, w };
  };
  const none = await run(null), wrong = await run("made-up-notes-tokeN"), good = await run("made-up-notes-token");
  ok("notes inbound: no token or a wrong one → 401, nothing written", none.status === 401 && wrong.status === 401 && !none.w.wrote() && !wrong.w.wrote(), [none.status, wrong.status]);
  ok("notes inbound: the right token → the note is written", good.status === 200 && good.w.calls.some((c) => c.table === "meeting_notes" && c.steps.some(([m]) => m === "insert")), good.status);
  // R18 (security F10): the token in a header, never the address — Basic (a webhook URL's notes:<secret>@) or Bearer.
  const byHeader = async (authorization, token = null) => {
    const w = world();
    const url = `https://app.example.test/api/notes/inbound${token === null ? "" : `?token=${encodeURIComponent(token)}`}`;
    const r = await post(loader(w.shims)("app/api/notes/inbound/route.ts"), url, { "content-type": "application/json", authorization }, JSON.stringify({ from: "someone@example.test", subject: "A note", text: "Made-up text." }));
    return { ...r, w };
  };
  const basic = (pair) => `Basic ${Buffer.from(pair).toString("base64")}`;
  const hb = await byHeader(basic("notes:made-up-notes-token")), hbear = await byHeader("Bearer made-up-notes-token");
  ok("notes inbound: the token as Basic auth (a webhook URL's notes:<secret>@) or Bearer → written, nothing in the address",
    hb.status === 200 && hb.w.wrote() && hbear.status === 200 && hbear.w.wrote(), [hb.status, hbear.status]);
  const hw = await byHeader(basic("notes:made-up-notes-tokeN")), hnone = await byHeader(basic("made-up-notes-token")), hjunk = await byHeader("Basic %%%not-base64%%%");
  ok("notes inbound: a wrong Basic, one with no user part, or one that isn't base64 → 401, nothing written",
    [hw, hnone, hjunk].every((x) => x.status === 401 && !x.w.wrote()), [hw.status, hnone.status, hjunk.status]);
  // Either one opens it (R18 review): a provider's own Authorization header beside a ?token= webhook set up before R18
  // doesn't shut it out — and a wrong token in both places still does.
  const otherHeaderGoodQuery = await byHeader("Bearer the-providers-own-header", "made-up-notes-token");
  ok("notes inbound: a header that isn't the token beside the right one in the address → written (either one opens it)",
    otherHeaderGoodQuery.status === 200 && otherHeaderGoodQuery.w.wrote(), otherHeaderGoodQuery.status);
  const goodHeaderWrongQuery = await byHeader(basic("notes:made-up-notes-token"), "made-up-notes-tokeN");
  ok("notes inbound: the right header beside a wrong ?token= → written", goodHeaderWrongQuery.status === 200 && goodHeaderWrongQuery.w.wrote(), goodHeaderWrongQuery.status);
  const bothWrong = await byHeader("Bearer made-up-notes-tokeN", "made-up-notes-tokeN");
  ok("notes inbound: wrong in the header and wrong in the address → 401, nothing written", bothWrong.status === 401 && !bothWrong.w.wrote(), bothWrong.status);

  // R20 (API F16): once a message — the mail's own id kept, hashed, in the webhook inbox — and a note's length kept.
  const inbox = new Map();   // id → { processed_at, received_at }, shared by the deliveries below as the database would be
  const mailWorld = () => world({ table: (table, steps) => {
    if (table !== "webhook_events") return { data: null, error: null, count: 0 };
    const [m, arg] = steps[0] ?? [];
    const id = steps.find(([k]) => k === "eq")?.[2];
    if (m === "insert") { if (inbox.has(arg.id)) return { data: null, error: { code: "23505", message: "duplicate key" } }; inbox.set(arg.id, { processed_at: null, received_at: new Date().toISOString() }); return { data: null, error: null }; }
    if (m === "select") return { data: inbox.has(id) ? { processed_at: inbox.get(id).processed_at } : null, error: null };
    if (m === "update" && "processed_at" in arg) { inbox.get(id).processed_at = arg.processed_at; return { data: null, error: null }; }
    if (m === "update" && "received_at" in arg) {   // the take-over: only an unmarked row, older than the stamp asked
      const row = inbox.get(id), before = steps.find(([k, col]) => k === "lt" && col === "received_at")?.[2];
      const unmarked = steps.some(([k, col, v]) => k === "is" && col === "processed_at" && v === null);
      if (!row || !unmarked || row.processed_at || !(row.received_at < before)) return { data: [], error: null };
      row.received_at = arg.received_at; return { data: [{ id }], error: null };
    }
    return { data: null, error: null };
  } });
  const mail = async (fields, token = "made-up-notes-token") => {
    const w = mailWorld();
    const r = await post(loader(w.shims)("app/api/notes/inbound/route.ts"), "https://app.example.test/api/notes/inbound",
      { "content-type": "application/json", authorization: `Bearer ${token}` }, JSON.stringify({ from: "someone@example.test", subject: "A note", ...fields }));
    const notes = w.calls.filter((c) => c.table === "meeting_notes" && c.steps.some(([m]) => m === "insert"));
    return { ...r, w, notes };
  };
  const first = await mail({ text: "Made-up text.", MessageID: "made-up-0001@mail.example.test" });
  const again = await mail({ text: "Made-up text.", MessageID: "made-up-0001@mail.example.test" });
  ok("notes inbound: a mail delivered twice is one note — the second is thanked and not written",
    first.status === 200 && first.notes.length === 1 && again.status === 200 && again.json?.replay === true && again.notes.length === 0, [first.json, again.json, again.notes.length]);
  ok("notes inbound: the inbox keeps the mail's id hashed — never the id itself, nor the mail",
    [...inbox.keys()].every((k) => /^notes:[0-9a-f]{40}$/.test(k)) && first.w.calls.filter((c) => c.table === "webhook_events").every((c) => c.steps.every(([m, a]) => m !== "insert" || a.payload === null)));
  const row1 = inbox.get([...inbox.keys()][0]);
  row1.processed_at = null; row1.received_at = new Date().toISOString();   // its twin, still being written
  const twin = await mail({ text: "Made-up text.", MessageID: "made-up-0001@mail.example.test" });
  ok("notes inbound (review): a copy whose twin is still being written is told to come back (409) — not written twice",
    twin.status === 409 && twin.json?.retry === true && twin.notes.length === 0, [twin.status, twin.json]);
  row1.received_at = new Date(Date.now() - 5 * 60_000).toISOString();     // as if that delivery died before it marked the mail
  const died = await mail({ text: "Made-up text.", MessageID: "made-up-0001@mail.example.test" });
  ok("notes inbound: …a mail whose earlier delivery died before it was marked is written — by the one copy that takes it over",
    died.status === 200 && died.notes.length === 1 && !!row1.processed_at, died.json);
  row1.processed_at = null; row1.received_at = new Date(Date.now() - 5 * 60_000).toISOString();
  const [r1, r2] = await Promise.all([mail({ text: "Made-up text.", MessageID: "made-up-0001@mail.example.test" }), mail({ text: "Made-up text.", MessageID: "made-up-0001@mail.example.test" })]);
  ok("notes inbound (review): two retries after a death, together: one writes, the other comes back",
    [r1, r2].filter((r) => r.status === 200 && r.notes.length === 1).length === 1 && [r1, r2].filter((r) => r.status === 409 && r.notes.length === 0).length === 1, [r1.status, r2.status]);
  const pm1 = await mail({ text: "Sent twice.", MessageID: "pm-delivery-aaa", Headers: [{ Name: "Message-ID", Value: "<made-up-0004@mail.example.test>" }] });
  const pm2 = await mail({ text: "Sent twice.", MessageID: "pm-delivery-bbb", Headers: [{ Name: "message-id", Value: "<made-up-0004@mail.example.test>" }] });
  ok("notes inbound (review): the mail's own Message-ID header comes before Postmark's id for the delivery — one mail sent on twice is one note",
    pm1.notes.length === 1 && pm2.json?.replay === true && pm2.notes.length === 0, [pm1.json, pm2.json]);
  const sg = await mail({ text: "From SendGrid.", headers: "Received: by mx.example.test\nMessage-ID: <made-up-0002@mail.example.test>\nSubject: A note" });
  const sg2 = await mail({ text: "From SendGrid.", headers: "Received: by mx.example.test\nmessage-id: <made-up-0002@mail.example.test>" });
  ok("notes inbound: SendGrid's raw headers give the id too (any case)", sg.notes.length === 1 && sg2.json?.replay === true && sg2.notes.length === 0, [sg.json, sg2.json]);
  const noId = await mail({ text: "No id at all." }), noId2 = await mail({ text: "No id at all." });
  ok("notes inbound: a mail with no id is written each time, as before", noId.notes.length === 1 && noId2.notes.length === 1);
  const long = await mail({ text: "x".repeat(80_000) });
  const kept = long.notes[0]?.steps.find(([m]) => m === "insert")?.[1];
  ok("notes inbound: a note is kept to 50,000 characters", long.status === 200 && kept?.body?.length === 50_000, kept?.body?.length);
  const wrongToken = await mail({ text: "x", MessageID: "made-up-0003@mail.example.test" }, "made-up-notes-tokeN");
  ok("notes inbound: a wrong token touches no inbox", wrongToken.status === 401 && wrongToken.w.calls.length === 0);
});

// Apliiq (lib/apliiq reads its secret when it loads, so each world loads it with the env it needs)
await withEnv({ APLIIQ_SHARED_SECRET: APLIIQ_SECRET }, async () => {
  const run = async (headers, body) => { const w = world(); const r = await post(loader(w.shims)("app/api/apliiq/search/route.ts"), "https://app.example.test/api/apliiq/search", headers, body); return { ...r, w }; };
  const body = JSON.stringify({ search: "cap" });
  const none = await run({}, body), wrong = await run({ authorization: apliiqHeader(body, { secret: "not-ours" }) }, body);
  ok("apliiq route: unsigned or wrongly signed → 401, nothing read", none.status === 401 && wrong.status === 401 && none.w.calls.length === 0 && wrong.w.calls.length === 0, [none.status, wrong.status]);
  const good = await run({ authorization: apliiqHeader(body) }, body);
  ok("apliiq route: correctly signed → through the gate (200), and it searches the catalog", good.status === 200 && good.w.calls.some((c) => c.table === "shop_products"), good.status);
});
await withEnv({ APLIIQ_SHARED_SECRET: undefined }, async () => {
  const w = world();
  const body = "{}";
  const r = await post(loader(w.shims)("app/api/apliiq/search/route.ts"), "https://app.example.test/api/apliiq/search", { authorization: apliiqHeader(body) }, body);
  ok("apliiq route: with its secret unset it is closed (401), as it always has been", r.status === 401 && w.calls.length === 0, r.status);
});

// Sending an order to Apliiq (R9, 0417): not taken is not the same as no answer. A refusal — or a connection that never
// opened — is "refused": nothing at the printer. A timeout, a reset, a 5xx, a 409, a 2xx with no id is "unclear": Apliiq
// may have it, and the order waits for the crew to look. Run against a stand-in fetch; nothing here talks to Apliiq.
await withEnv({ APLIIQ_SHARED_SECRET: APLIIQ_SECRET, APLIIQ_APP_KEY: "app-test" }, async () => {
  const w = world();
  const A = loader({ ...w.shims, "./apliiqOrder": { buildOrderPayload: () => ({ ok: true, payload: { id: "o-1" }, skus: [] }) } })("lib/apliiq.ts");
  const order = { id: "o-1", ship: {}, items: [] };
  const answer = (status, body) => async () => new Response(body === undefined ? "" : JSON.stringify(body), { status });
  const thrown = (e) => async () => { throw e; };
  const netErr = (code) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const run = (f) => A.submitOrderToApliiq(order, f);
  const [ok200, noId, s500, s502, s409, s408, s400, s422, s429, dns, refused, connTimeout, aborted, reset] = await Promise.all([
    run(answer(200, { Id: 4471023 })), run(answer(200, {})), run(answer(500, { error: "x" })), run(answer(502)), run(answer(409, { error: "exists" })),
    run(answer(408)), run(answer(400, { error: "sku" })), run(answer(422)), run(answer(429)),
    run(thrown(netErr("ENOTFOUND"))), run(thrown(netErr("ECONNREFUSED"))), run(thrown(netErr("UND_ERR_CONNECT_TIMEOUT"))),
    run(thrown(timeout)), run(thrown(netErr("ECONNRESET"))),
  ]);
  ok("apliiq send: a 2xx with their id is the only success, and carries it", ok200.ok === true && ok200.apliiqOrderId === "4471023", ok200);
  ok("apliiq send: a 2xx with no id, a 5xx, a 409 or a 408 is unclear — Apliiq may have it",
    [noId, s500, s502, s409, s408].every((r) => r.ok === false && r.unclear === true), [noId, s500, s502, s409, s408].map((r) => r.unclear));
  ok("apliiq send: a 400, 422 or 429 is a refusal — nothing there, safe to send again once fixed",
    [s400, s422, s429].every((r) => r.ok === false && !r.unclear) && /Apliiq 400 — /.test(s400.error), [s400, s422, s429].map((r) => r.unclear));
  ok("apliiq send: a connection that never opened (no address, refused, connect timeout) never reached them — refused",
    [dns, refused, connTimeout].every((r) => r.ok === false && !r.unclear), [dns, refused, connTimeout].map((r) => r.unclear));
  ok("apliiq send: a timeout or a reset mid-request may have reached them — unclear",
    [aborted, reset].every((r) => r.ok === false && r.unclear === true), [aborted, reset].map((r) => r.unclear));
  let init = null;
  await A.submitOrderToApliiq(order, async (_u, i) => { init = i; return new Response(JSON.stringify({ Id: 1 }), { status: 200 }); });
  ok("apliiq send: it waits no longer than its timeout (an abort signal on the request), well inside the two-minute claim",
    init?.signal instanceof AbortSignal && A.APLIIQ_SUBMIT_TIMEOUT_MS === 25_000 && init?.method === "POST", { signal: !!init?.signal, ms: A.APLIIQ_SUBMIT_TIMEOUT_MS });
});

// Apliiq's shipping update and product sync (R9, the money audit's A10): the order found by each id in its own query,
// checked for its shape; the inbox keyed on the signed body, never on x-apliiq-delivery; a delivered order not walked
// back; a product update that says only what it carries.
{
  const TEN = "00000000-0000-0000-0000-0000000000aa", OID = "6f1c2b8e-5d4a-4c3b-9a21-0e8f7d6c5b4a";
  const stateful = ({ order = null, product = null } = {}) => {
    const seen = new Set(), updates = [], inserts = [];
    const w = world({ table: (table, steps) => {
      const m = steps.map(([x]) => x), arg = (k) => (steps.find(([x]) => x === k) ?? [])[1];
      if (table === "webhook_events" && m.includes("insert")) {
        const id = arg("insert").id;
        if (seen.has(id)) return { data: null, error: { code: "23505" } };
        seen.add(id); return { data: null, error: null };
      }
      if (table === "webhook_events" && m.includes("delete")) { seen.delete(steps.find(([x]) => x === "eq")[2]); return { data: null, error: null }; }
      if (table === "shop_orders" && m.includes("select")) return { data: m.includes("maybeSingle") ? order : order ? [order] : [], error: null };
      if (table === "shop_products" && m.includes("select")) return { data: product ? [product] : [], error: null };
      if (m.includes("update")) { updates.push({ table, patch: arg("update"), steps }); return { data: null, error: null }; }
      if (m.includes("insert")) { inserts.push({ table, row: arg("insert") }); return { data: null, error: null }; }
      if (table === "merch_fulfillments" || table === "shop_order_items") return { data: [], error: null };
      return { data: null, error: null };
    } });
    const shims = { ...w.shims, "@/lib/tenantScope": { integrationTenant: () => TEN },
      "@/lib/notify": { accountEmail: async () => null }, "@/lib/customerMessage": { tellCustomer: async () => ({ ok: true }) },
      "@/lib/receipt": { shippedNotice: () => ({ subject: "s", text: "t" }) } };
    return { w, seen, updates, inserts, load: loader(shims) };
  };
  const send = (load, file, body, headers = {}) => post(load(file), `https://app.example.test/${file}`, { authorization: apliiqHeader(body), ...headers }, body);
  await withEnv({ APLIIQ_SHARED_SECRET: APLIIQ_SECRET }, async () => {
    const FF = "app/api/apliiq/fulfillment/route.ts", PR = "app/api/apliiq/product/route.ts";
    const body = JSON.stringify({ external_id: OID, OrderId: "4471023", TrackingNumber: "1Z999AA10123456784" });
    const a = stateful({ order: { id: OID, user_id: null, email: null, status: "needs_fulfillment", apliiq_order_id: null } });
    const first = await send(a.load, FF, body, { "x-apliiq-delivery": "delivery-1" });
    const look = a.w.calls.find((c) => c.table === "shop_orders" && c.steps.some(([x]) => x === "select"));
    const patch = a.updates.find((u) => u.table === "shop_orders")?.patch ?? {};
    ok("apliiq shipping: found by our id in its own query, scoped to the storefront — never a pasted filter",
      first.status === 200 && look?.steps.some(([x, k, v]) => x === "eq" && k === "id" && v === OID) && look.steps.some(([x, k, v]) => x === "eq" && k === "tenant_id" && v === TEN)
      && !a.w.calls.some((c) => c.steps.some(([x]) => x === "or")), { status: first.status, look: look?.steps });
    ok("apliiq shipping: shipped, Apliiq's id kept where the order had none, and an unclear send's marks come off",
      patch.status === "shipped" && patch.apliiq_order_id === "4471023" && patch.apliiq_submit_unknown_at === null && patch.apliiq_submit_started_at === null, patch);
    const again = await send(a.load, FF, body, { "x-apliiq-delivery": "delivery-2" });
    ok("apliiq shipping: the same signed call with a new x-apliiq-delivery is answered deduped — shipped and emailed once",
      again.status === 200 && again.json?.deduped === true && a.updates.filter((u) => u.table === "shop_orders").length === 1, { again: again.json, updates: a.updates.length });

    const b = stateful({ order: { id: OID, user_id: null, email: null, status: "needs_fulfillment", apliiq_order_id: null } });
    const forged = await send(b.load, FF, JSON.stringify({ OrderId: "1,id.neq.0", TrackingNumber: "X" }));
    ok("apliiq shipping: an id with a filter's punctuation names no order — 400, nothing read", forged.status === 400 && !b.w.calls.some((c) => c.table === "shop_orders"), forged.status);

    const c = stateful({ order: { id: OID, user_id: null, email: null, status: "delivered", apliiq_order_id: "4471023" } });
    await send(c.load, FF, body);
    const cp = c.updates.find((u) => u.table === "shop_orders")?.patch ?? {};
    ok("apliiq shipping: a delivered order is not walked back to shipped, and its Apliiq id is not replaced", !("status" in cp) && !("apliiq_order_id" in cp), cp);

    const d = stateful({ order: null });
    const lost = await send(d.load, FF, body);
    ok("apliiq shipping: no order carries it — 404 for Apliiq's retry, nothing marked seen, the crew told once",
      lost.status === 404 && d.seen.size === 0 && d.w.alerts.some((x) => x.kind === "printer_unmatched"), { status: lost.status, seen: d.seen.size, alerts: d.w.alerts.map((x) => x.kind) });

    const e = stateful({ order: { id: OID, user_id: null, email: null, status: "needs_fulfillment", apliiq_order_id: null } });
    const stale = await post(e.load(FF), "https://app.example.test/x", { authorization: apliiqHeader(body, { rts: String(now - 8 * 86400) }) }, body);
    ok("apliiq shipping: a correctly signed call from eight days ago is refused (401), nothing read", stale.status === 401 && e.w.calls.length === 0, stale.status);

    const prodBody = JSON.stringify({ Id: "P-7781", Name: "Six-Panel Cap" });
    const f = stateful({ product: { id: "row-1" } });
    const synced = await send(f.load, PR, prodBody, { "x-apliiq-delivery": "p-1" });
    const pp = f.updates.find((u) => u.table === "shop_products");
    ok("apliiq product: an update without a price leaves the price alone — never $0 over a live product",
      synced.status === 200 && pp && !("price_cents" in pp.patch) && pp.patch.title === "Six-Panel Cap" && pp.steps.some(([x, k, v]) => x === "eq" && k === "tenant_id" && v === TEN), pp?.patch);
    const resent = await send(f.load, PR, prodBody, { "x-apliiq-delivery": "p-2" });
    ok("apliiq product: the same signed body with a new delivery header is deduped — an old price can't be put back",
      resent.json?.deduped === true && f.updates.filter((u) => u.table === "shop_products").length === 1, resent.json);
    const g = stateful({ product: null });
    await send(g.load, PR, JSON.stringify({ Id: "P-9", Name: "Beanie", Price: "28.00" }));
    const born = g.inserts.find((i) => i.table === "shop_products")?.row ?? {};
    ok("apliiq product: a new one is born hidden, in this storefront, at the price it carried",
      born.tenant_id === TEN && born.price_cents === 2800 && !("published_at" in born) && born.title === "Beanie", born);
  });
}

// Twilio — a text sent to the GT3 number (app/api/sms/inbound, R5 of the customer audit: a recorded yes, STOP honoured)
const text = (Body, extra = {}) => ({ ToCountry: "US", From: "+18645550100", To: "+18645550199", Body, MessageSid: "SM-made-up-1", NumMedia: "0", ...extra });
const form = (params) => new URLSearchParams(params).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const twiml = (r) => r.status === 200 && r.type.startsWith("text/xml") && /<Response><\/Response>/.test(r.text);
await withEnv({ TWILIO_AUTH_TOKEN: TW_TOKEN, TWILIO_WEBHOOK_URL: TW_URL, NEXT_PUBLIC_APP_URL: undefined }, async () => {
  const run = async (params, { sig = twSign(params), at = TW_URL, rpc, raw } = {}) => {
    const w = world(rpc ? { rpc } : {});
    const headers = sig === null ? { ...FORM } : { ...FORM, "x-twilio-signature": sig };
    const r = await post(loader(w.shims)("app/api/sms/inbound/route.ts"), at, headers, raw ?? form(params));
    return { ...r, w };
  };
  const stop = text("STOP");
  const none = await run(stop, { sig: null });
  ok("sms inbound: unsigned → 401, nothing recorded, no alert", none.status === 401 && !none.w.wrote() && none.w.alerts.length === 0, none.status);
  const wrong = await run(stop, { sig: twSign(stop, TW_URL, "not-the-token") });
  ok("sms inbound: signed with another token → 401, nothing recorded", wrong.status === 401 && !wrong.w.wrote(), wrong.status);
  const elsewhere = await run(stop, { sig: twSign(stop, "https://elsewhere.test/api/sms/inbound") });
  ok("sms inbound: signed for another URL → 401", elsewhere.status === 401 && !elsewhere.w.wrote(), elsewhere.status);
  const tampered = await run(stop, { raw: form(text("START")) });
  ok("sms inbound: a STOP's signature on a START (the text changed after signing) → 401", tampered.status === 401 && !tampered.w.wrote(), tampered.status);
  const proxied = await run(stop, { at: "http://internal.example.test/api/sms/inbound" });
  ok("sms inbound: the URL checked is the one set on the number, not the one the request reached the app on (Vercel's proxy)",
    twiml(proxied) && proxied.w.rpcs.length === 1, proxied.status);

  const s = await run(stop);
  const said = s.w.rpcs[0];
  ok("sms inbound: STOP → the number's yes is withdrawn (say_text_consent: no, 'stop_text', no member) and the reply is empty TwiML",
    twiml(s) && s.w.rpcs.length === 1 && said?.name === "say_text_consent" && said.args.p_phone === "+18645550100" && said.args.p_yes === false
    && said.args.p_source === "stop_text" && said.args.p_user === null && s.w.alerts.length === 0, { status: s.status, rpcs: s.w.rpcs });
  const stops = await Promise.all(["stop", "Stop.", " unsubscribe ", "CANCEL", "End", "quit", "STOPALL", "Stop all", "Revoke", "OPTOUT"].map((b) => run(text(b))));
  ok("sms inbound: every word carriers treat as STOP — any case, a full stop or spaces around it — withdraws the yes",
    stops.every((r) => twiml(r) && r.w.rpcs.length === 1 && r.w.rpcs[0].args.p_yes === false && r.w.alerts.length === 0), stops.map((r) => r.w.rpcs.length));
  const starts = await Promise.all(["START", "yes", "Unstop"].map((b) => run(text(b))));
  ok("sms inbound: START / YES / UNSTOP → the yes stands again ('start_text')",
    starts.every((r) => twiml(r) && r.w.rpcs.length === 1 && r.w.rpcs[0].args.p_yes === true && r.w.rpcs[0].args.p_source === "start_text"), starts.map((r) => r.w.rpcs));
  const help = await run(text("HELP"));
  ok("sms inbound: HELP → nothing recorded, no alert, an empty reply (Twilio's own HELP answer is the one sent)", twiml(help) && !help.w.wrote() && help.w.alerts.length === 0);
  const lost = await run(stop, { rpc: () => ({ data: null, error: { message: 'relation "public.text_consents" does not exist' } }) });
  const crit = lost.w.alerts[0];
  ok("sms inbound: a STOP that could not be recorded → a critical alert to the crew naming the number, and still an empty reply",
    twiml(lost) && lost.w.alerts.length === 1 && crit.severity === "critical" && crit.kind === "text_stop_unrecorded" && crit.body.includes("(864) 555-0100"), lost.w.alerts);
  const person = await run(text("Running 10 min late, can you hold my pack?"));
  const a = person.w.alerts[0];
  ok("sms inbound: a person writing → the crew hear it (customer_text: the number, the words, and that this inbox can't text back); nothing recorded",
    twiml(person) && person.w.rpcs.length === 0 && person.w.alerts.length === 1 && a.kind === "customer_text" && a.severity === "important"
    && a.title === "Text from (864) 555-0100" && a.body.startsWith("Running 10 min late, can you hold my pack?") && a.body.includes("can't text back"), person.w.alerts);
  // R15 (API F16): one text is one line — keyed by its MessageSid, Twilio's second delivery folds into the first.
  ok("sms inbound (R15): a person's text is raised once per message — keyed by Twilio's MessageSid",
    a.subjectId === "twilio:SM-made-up-1", a.subjectId);
  const unkeyed = await run(text("No sid on this one", { MessageSid: "" }));
  ok("sms inbound (R15): …and a text with no MessageSid is still heard", unkeyed.w.alerts.length === 1 && !unkeyed.w.alerts[0].subjectId, unkeyed.w.alerts);
  const sentence = await run(text("please stop by at 5"));
  ok("sms inbound: 'stop' inside a sentence is a person writing, not a STOP", sentence.w.rpcs.length === 0 && sentence.w.alerts[0]?.kind === "customer_text", sentence.w.rpcs);
  const blank = await run(text("   "));
  ok("sms inbound: an empty text (a picture alone) → no alert, nothing recorded", twiml(blank) && !blank.w.wrote() && blank.w.alerts.length === 0);
  const odd = await run(text("STOP", { From: "GT3-SHORTCODE" }));
  ok("sms inbound: a sender that is not a phone number → nothing recorded, an empty reply", twiml(odd) && !odd.w.wrote() && odd.w.alerts.length === 0);
  const long = await run(text("x".repeat(2000)));
  ok("sms inbound: a long text reaches the crew cut to 600 characters", !!long.w.alerts[0]?.body.startsWith("x".repeat(600) + "\n\n"), long.w.alerts[0]?.body.length);
});
await withEnv({ TWILIO_AUTH_TOKEN: TW_TOKEN, TWILIO_WEBHOOK_URL: undefined, NEXT_PUBLIC_APP_URL: "https://app.example.test/" }, async () => {
  const w = world();
  const p = text("STOP");
  const r = await post(loader(w.shims)("app/api/sms/inbound/route.ts"), TW_URL, { ...FORM, "x-twilio-signature": twSign(p) }, form(p));
  ok("sms inbound: with no TWILIO_WEBHOOK_URL the app's own URL + /api/sms/inbound is the one checked (its trailing / not doubled)", r.status === 200 && w.rpcs.length === 1, r.status);
});
for (const env of [{ TWILIO_AUTH_TOKEN: undefined, TWILIO_WEBHOOK_URL: TW_URL }, { TWILIO_AUTH_TOKEN: TW_TOKEN, TWILIO_WEBHOOK_URL: undefined, NEXT_PUBLIC_APP_URL: undefined }]) {
  await withEnv(env, async () => {
    const w = world();
    const p = text("STOP");
    const r = await post(loader(w.shims)("app/api/sms/inbound/route.ts"), TW_URL, { ...FORM, "x-twilio-signature": twSign(p) }, form(p));
    ok(`sms inbound: with ${env.TWILIO_AUTH_TOKEN ? "no URL" : "no auth token"} set it answers 503 and records nothing (until the number is registered)`,
      r.status === 503 && !w.wrote() && w.alerts.length === 0, r.status);
  });
}

console.log(`EVERY WEBHOOK PROVES WHO SENT IT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
