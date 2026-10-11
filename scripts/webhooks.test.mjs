// EVERY INBOUND WEBHOOK PROVES WHO SENT IT — lib/webhookSignature and the routes on top of it, run (2026-10-11, wave 2).
//
// Five doors take requests with no session: Square, Resend (Svix), Stripe and Apliiq sign theirs; the inbound-email
// door (notes/inbound) carries a shared token. Each must answer a missing or wrong signature with 401 and act on
// nothing, and let a correctly signed one through. The checks are compiled from lib/webhookSignature.ts and asked
// directly; then each route file is compiled and called with a Request, as Next calls it — its own code, with its
// database, alerts and error intake stood in for by recorders (nothing here talks to Supabase, Square, Stripe,
// Resend or Apliiq). Every secret, key, token and signature below is made up for this file.
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
  && typeof W.stripeSignatureOk === "function" && typeof W.apliiqSignatureOk === "function" && typeof W.tokenOk === "function");

// ── the made-up secrets, and each provider's signature computed here independently, from its documentation ────────
const SQ_KEY = "made-up-square-signature-key-for-tests", SQ_URL = "https://app.example.test/api/square/webhook";
const sqSign = (body, url = SQ_URL, key = SQ_KEY) => createHmac("sha256", key).update(url + body).digest("base64");
const SVIX_SECRET = "whsec_" + Buffer.from("made-up svix secret, for tests only").toString("base64");
const svixSign = (id, t, body, secret = SVIX_SECRET) =>
  createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${t}.${body}`).digest("base64");
const STRIPE_SECRET = "whsec_made_up_stripe_secret_for_tests";
const stripeSign = (t, body, secret = STRIPE_SECRET) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
const APLIIQ_SECRET = "made-up-apliiq-shared-secret";
const apliiqHeader = (body, { rts = "1760180000", appid = "app-test", state = "nonce1234", secret = APLIIQ_SECRET } = {}) =>
  `x-apliiq-auth ${rts}:${createHmac("sha256", secret).update(appid + rts + state + (body ? Buffer.from(body).toString("base64") : "")).digest("base64")}:${appid}:${state}`;
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
}
ok("token: equal passes; different, missing, or with no secret set does not",
  W.tokenOk("made-up-token", "made-up-token") && !W.tokenOk("made-up-tokeN", "made-up-token") && !W.tokenOk(null, "made-up-token")
  && !W.tokenOk("", "") && !W.tokenOk("é", "x") && !W.tokenOk("made-up-token", undefined));

// ── 2 · the routes, run ──────────────────────────────────────────────────────────────────────────────────────────
// Stand-ins: NextResponse.json is a Response; the service-role client records each call and answers "nothing there";
// the alert raisers and the error intake record what they are asked. lib/apiRoute, lib/squareServer, lib/money and
// lib/webhookSignature are the real files.
const nextServer = { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } }) } };
function world() {
  const calls = [], alerts = [], filed = [];
  const from = (table) => {
    const steps = [];
    calls.push({ table, steps });
    const chain = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (res, rej) => Promise.resolve({ data: null, error: null, count: 0 }).then(res, rej);
        return (...args) => { steps.push([String(prop), ...args]); return chain; };
      },
    });
    return chain;
  };
  const shims = {
    "next/server": nextServer,
    "@/lib/supabaseAdmin": { supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } },
    "./supabaseAdmin": { supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } },
    "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); }, raiseAlertOnce: async (a) => { alerts.push(a); return true; } },
    "./errorIntake": { fileError: async (e) => { filed.push(e); return true; } },
    "./apliiqOrder": { buildOrderPayload: () => ({}) },
    "./errorMessage": { errorMessage: (e) => String(e) },
  };
  return { calls, alerts, filed, shims, wrote: () => calls.some((c) => c.steps.some(([m]) => ["insert", "update", "upsert", "delete"].includes(m))) };
}
const withEnv = async (env, fn) => {
  const before = {};
  for (const k of Object.keys(env)) { before[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(env)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
};
const post = async (mod, url, headers, body) => {
  const res = await mod.POST(new Request(url, { method: "POST", headers, body }));
  let json = null; try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
};

// Square
await withEnv({ SQUARE_WEBHOOK_SIGNATURE_KEY: SQ_KEY, SQUARE_WEBHOOK_URL: SQ_URL }, async () => {
  const run = async (headers, body) => { const w = world(); const r = await post(loader(w.shims)("app/api/square/webhook/route.ts"), SQ_URL, headers, body); return { ...r, w }; };
  const body = JSON.stringify({ type: "unknown.event", event_id: "evt-sq-test" });
  const none = await run({}, body), wrong = await run({ "x-square-hmacsha256-signature": sqSign(body, SQ_URL, "not-the-key") }, body);
  ok("square route: no signature → 401, nothing read or written", none.status === 401 && none.w.calls.length === 0, none.status);
  ok("square route: a wrong signature → 401, nothing written", wrong.status === 401 && wrong.w.calls.length === 0, wrong.status);
  const forged = await run({ "x-square-hmacsha256-signature": "é" + sqSign(body).slice(1) }, body);
  ok("square route: a forged header with a non-ASCII character → 401, not a 500 filed as a crash", forged.status === 401 && forged.w.filed.length === 0, { status: forged.status, filed: forged.w.filed.length });
  const tampered = await run({ "x-square-hmacsha256-signature": sqSign(body) }, body.replace("unknown", "subscription"));
  ok("square route: a body changed after signing → 401", tampered.status === 401 && !tampered.w.wrote());
  const good = await run({ "x-square-hmacsha256-signature": sqSign(body) }, body);
  ok("square route: correctly signed → 200, and it records the event (the inbox insert, 0230)",
    good.status === 200 && good.w.calls.some((c) => c.table === "webhook_events" && c.steps.some(([m]) => m === "insert")), { status: good.status, json: good.json });
});
await withEnv({ SQUARE_WEBHOOK_SIGNATURE_KEY: undefined, SQUARE_WEBHOOK_URL: undefined }, async () => {
  const w = world();
  const body = "{}";
  const r = await post(loader(w.shims)("app/api/square/webhook/route.ts"), SQ_URL, { "x-square-hmacsha256-signature": sqSign(body) }, body);
  ok("square route: with its key unset it refuses every event (503), as it always has", r.status === 503 && w.calls.length === 0, r.status);
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

console.log(`EVERY WEBHOOK PROVES WHO SENT IT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
