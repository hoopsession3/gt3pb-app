// THE PUSH FUNCTION, RUN (R21, 2026-10-18 — the 10/10 audit, operations F12). Until now only its rules file
// (policy.ts — scripts/push.policy.test.mjs) ran here; index.ts, the part that reads the database, picks the devices and
// talks to Apple, the browsers' push services, Teams, Resend and Twilio, was read as text. Here it is compiled from its
// own TypeScript and called with a Request, as the database's webhook calls it. Real: index.ts and policy.ts, and an
// ES256 key made for this run (Apple's token is signed and checked). Stood in for: Deno (its env and serve), the
// database (scripts/fixtures/moneyWorld), web-push, and fetch — Teams, Resend, Apple and Twilio answering as told.
// Every name, address, key and token is made up.
//
// What it holds the function to: a row it is told about is read from the database, sent to the right devices, once;
// a phone or browser that is gone is deleted and one device's own refusal is logged; and everything that is OURS to
// put right — Teams refusing a card, a mail not taken, Apple refusing our key, a read or a write that failed — is said:
// in the log, and in a 502 that names it (cron_watch reads those answers), after everything that could go, went. No
// answer or log line carries an address (Teams' webhook and Twilio's account path are keys).
import ts from "typescript";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { routeLoader, moneyWorld } from "./fixtures/moneyWorld.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const realLog = console.log, realError = console.error, realWarn = console.warn;
const ok = (n, c, got) => { if (c) pass++; else { fail++; realLog(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

// THE CLOCK: noon in Greenville on a Saturday. A text's quiet hours are 9pm–8am Eastern, and every row's stamp is
// measured against now — so now is held still.
const NOW = Date.parse("2026-10-24T16:00:00Z");
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
const ago = (ms) => new RealDate(NOW - ms).toISOString();

// Deno, as the function uses it.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const TEAMS = "made-up-teams.example.test";
const ENV = {
  SUPABASE_URL: "https://db.example.test", SUPABASE_SERVICE_ROLE_KEY: "made-up-service-role-key",
  VAPID_PUBLIC: "made-up-vapid-public", VAPID_PRIVATE: "made-up-vapid-private",
  TEAMS_WEBHOOK_URL: `https://${TEAMS}/webhookb2/made-up-secret-path`,
  RESEND_API_KEY: "made-up-resend-key", NOTIFY_FROM_EMAIL: "GT3 <alerts@example.test>",
  APNS_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }), APNS_KEY_ID: "MADEUPKEY1", APNS_TEAM_ID: "MADEUPTEAM",
};
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };

// The database, a fresh one each case; auth.users as the admin API answers it.
let w;
const users = new Map();
let lookupFails = false;
const client = new Proxy({}, {
  get: (_, k) => k === "auth"
    ? { admin: { getUserById: async (id) => {
        if (lookupFails) throw new Error("fetch failed");
        const email = users.get(id);
        return email ? { data: { user: { id, email } }, error: null } : { data: { user: null }, error: { message: "User not found" } };
      } } }
    : w[k],
});

// web-push: every push asked of a browser's push service, answered as the case says (a status ≥ 300 is a refusal).
const pushed = [];
let webAnswer = () => 201;
const webpushFake = {
  setVapidDetails() {},
  async sendNotification(sub, payload, opts) {
    pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), timeout: opts?.timeout });
    const status = webAnswer(sub.endpoint);
    if (status >= 300) throw Object.assign(new Error(`Received unexpected response code ${status} from ${sub.endpoint}`), { statusCode: status });
    return { statusCode: status, body: "", headers: {} };
  },
};

// fetch: Teams, Resend, Apple and Twilio, each answering as the case says.
const outbound = [];
let answer = {};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  outbound.push({ host: u.host, path: u.pathname, init, body: typeof init.body === "string" ? init.body : init.body ? String(init.body) : "" });
  const a = answer[u.host];
  if (!a) throw new Error(`nothing here answers ${u.host}`);
  return a(u, init);
};
const sent = (host) => outbound.filter((o) => o.host === host);

// The log, read.
const logged = [];
console.error = (...a) => logged.push(["error", a.join(" ")]);
console.warn = (...a) => logged.push(["warn", a.join(" ")]);

const load = routeLoader({ "npm:web-push@3.6.7": webpushFake, "npm:@supabase/supabase-js@2.108.2": { createClient: () => client } });
load("supabase/functions/push/index.ts");
ok("loads: the function hands Deno.serve its door", typeof handler === "function");

const FOUNDING = "00000000-0000-0000-0000-000000000001";
const OWNER = "c0000000-0000-4000-8000-0000000000a1", CREW = "c0000000-0000-4000-8000-0000000000a2", MEMBER = "c0000000-0000-4000-8000-0000000000a3";
const ORDER = "0d000000-0000-4000-8000-000000000001", ALERT = "a1000000-0000-4000-8000-000000000001";
const PACK = "9a000000-0000-4000-8000-000000000001", STOP = "5d000000-0000-4000-8000-000000000001", NOTICE = "9b000000-0000-4000-8000-000000000001";
const TOKEN = (n) => `${"ab".repeat(31)}0${n}`;
const web = (n, extra = {}) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/made-up-${n}`, p256dh: "made-up-p256dh-0000", auth: "made-up-auth", platform: null,
  tenant_id: FOUNDING, is_admin: false, wants_live: false, user_id: null, ...extra });
const phone = (n, extra = {}) => ({ endpoint: `apns:${TOKEN(n)}`, p256dh: null, auth: null, platform: "apns", tenant_id: FOUNDING, is_admin: false, wants_live: false, user_id: null, ...extra });
const apple = (status, reason) => () => new Response(reason ? JSON.stringify({ reason }) : "", { status });

function fresh(tables = {}) {
  w = moneyWorld({
    tables: {
      push_sent: [], alerts: [], push_subscriptions: [], notif_prefs: [], markets: [],
      profiles: [
        { id: OWNER, role: "owner", tenant_id: FOUNDING, display_name: "Made-up Owner", market: null },
        { id: CREW, role: "admin", tenant_id: FOUNDING, display_name: "Made-up Crew", market: null },
        { id: MEMBER, role: "member", tenant_id: FOUNDING, display_name: "Made-up Member", market: null },
      ],
      admin_emails: [{ email: "owner@example.test" }, { email: "crew@example.test" }],
      ...tables,
    },
    unique: { push_sent: ["event_key"] },
    rpc: {
      text_consent_standing: () => true,
      // 0336's alert_open_once as the function uses it: one open line per kind and subject, refreshed while it stands.
      alert_open_once: (a, world) => {
        const open = world.tables.alerts.find((x) => x.kind === a.p_kind && (x.subject_id ?? null) === (a.p_subject ?? null) && !x.ack_at);
        if (open) { Object.assign(open, { title: a.p_title ?? open.title, body: a.p_body ?? open.body }); return open.id; }
        const row = { id: `line-${world.tables.alerts.length + 1}`, kind: a.p_kind, subject_id: a.p_subject ?? null, severity: a.p_severity, category: a.p_category,
          title: a.p_title, body: a.p_body, link: a.p_link, reopen_after: a.p_reopen_after, ack_at: null, created_at: new RealDate(NOW).toISOString() };
        world.tables.alerts.push(row);
        return row.id;
      },
    },
  });
  pushed.length = 0; outbound.length = 0; logged.length = 0;
  webAnswer = () => 201;
  answer = {
    [TEAMS]: () => new Response("1", { status: 200 }),
    "api.resend.com": () => new Response(JSON.stringify({ id: "made-up-email" }), { status: 200 }),
    "api.push.apple.com": () => new Response("", { status: 200 }),
    "api.twilio.com": () => new Response("{}", { status: 201 }),
  };
  users.clear(); users.set(OWNER, "owner@example.test"); users.set(CREW, "crew@example.test"); users.set(MEMBER, "member@example.test");
  lookupFails = false;
  delete ENV.TEXTS_ON; delete ENV.TWILIO_ACCOUNT_SID; delete ENV.TWILIO_AUTH_TOKEN; delete ENV.TWILIO_FROM_NUMBER;
}
async function post(body, method = "POST") {
  const r = await handler(new Request("https://fn.example.test/functions/v1/push", method === "GET" ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, text: await r.text() };
}
// A fault is said by the function itself (the R21 review): one open push_fault line in the inbox naming it, and the
// answer 200 in the same words — a 502 only when that line couldn't be written.
const faultLines = () => w.tables.alerts.filter((a) => a.kind === "push_fault" && !a.ack_at);
const faulted = (r) => r.status === 200 && faultLines().length === 1 && faultLines()[0].body.includes(r.text.split(" — but ")[1] ?? "<none>");
const noAddress = (s) => !/https?:\/\//.test(s) && !/made-up-secret-path|ACmadeup|abababab/.test(s);
const everythingSaid = () => [...logged.map((l) => l[1])];

const SRC = readFileSync(join(ROOT, "supabase/functions/push/index.ts"), "utf8");
const VERSION = (SRC.match(/const PUSH_VERSION = "([^"]+)";/) || [])[1];

// ── 1 · THE DOOR ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const got = await post(null, "GET");
  ok("door: a GET answers which build this is, and nothing else", got.status === 200 && JSON.parse(got.text).version === VERSION && !!VERSION, got);
  ok("door: a body naming no table it sends for is skipped", (await post({ type: "INSERT", table: "secrets", record: { id: "x" } })).text === "skip");
  ok("door: …and one naming no row", (await post({ type: "INSERT", table: "orders", record: null })).text === "skip");
  ok("door: a row the database doesn't have is not sent", (await post({ type: "INSERT", table: "orders", record: { id: ORDER } })).text === "skip: not in the database" && !pushed.length);
  fresh({ orders: [{ id: ORDER, created_at: ago(60_000), tenant_id: FOUNDING, status: "new" }] });
  w.fail.orders = { select: { error: { code: "57014", message: "canceling statement due to statement timeout" } } };
  const lost = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("door: a row that couldn't be READ is not a row that isn't there — a 500 that says so, and the log says it too",
    lost.status === 500 && lost.text === "err: the orders row could not be read (57014)" && !pushed.length
    && logged.some(([lv, l]) => lv === "error" && l === "[push] failed: the orders row could not be read (57014)"), { lost, logged });
  fresh();
  w.from = () => { throw new Error(`fetch failed for https://db.example.test/rest/v1/orders?id=eq.1&key=made-up-secret-path with ${ENV.SUPABASE_SERVICE_ROLE_KEY}`); };
  const crash = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("door: anything thrown inside is a 500 in the function's own words — with no address and no key in it",
    crash.status === 500 && crash.text === "err: fetch failed for (an address) with (a key)" && everythingSaid().every((l) => noAddress(l) && !l.includes(ENV.SUPABASE_SERVICE_ROLE_KEY)), { crash, logged });
}

// ── 2 · A NEW ORDER, TO THE CREW'S DEVICES, ONCE ─────────────────────────────────────────────────────────────────────
const orderWorld = (devices) => ({ orders: [{ id: ORDER, created_at: ago(60_000), tenant_id: FOUNDING, user_id: MEMBER, status: "new", items: [] }], push_subscriptions: devices });
{
  fresh(orderWorld([web(1, { is_admin: true, user_id: CREW }), phone(1, { is_admin: true, user_id: CREW }), web(2, { user_id: MEMBER }),
    web(3, { is_admin: true, user_id: CREW, tenant_id: "00000000-0000-0000-0000-000000000002" })]));
  const got = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  const toApple = sent("api.push.apple.com");
  ok("order: sent to this business's crew devices — the browser and the iPhone — and not the member's, nor another business's",
    got.status === 200 && got.text === "ok" && pushed.length === 1 && pushed[0].endpoint.endsWith("made-up-1") && toApple.length === 1 && toApple[0].path === `/3/device/${TOKEN(1)}`, { got, pushed, toApple: toApple.length });
  ok("order: a tap opens the Pass, and the lock screen names no customer", pushed[0]?.payload.url === "/crew?s=now&a=kitchen-pass" && !/Made-up|member@/.test(JSON.stringify(pushed[0]?.payload)));
  ok("order: kept as sent (push_sent) — told again, it is not sent twice", w.tables.push_sent.length === 1 && w.tables.push_sent[0].event_key === `orders:new:${ORDER}`
    && (await post({ type: "INSERT", table: "orders", record: { id: ORDER } })).text === "skip: not news, or sent already" && pushed.length === 1 && sent("api.push.apple.com").length === 1);
  // Apple's request: our topic, an alert that expires in the hour, and a token signed ES256 by the team's key.
  const h = toApple[0]?.init.headers ?? {};
  const [head64, claims64, sig64] = String(h.authorization ?? "").replace(/^bearer /, "").split(".");
  const dec = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  const verified = !!sig64 && createVerify("SHA256").update(`${head64}.${claims64}`).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig64, "base64url"));
  ok("order: Apple is asked with our topic, an hour to live, and a token signed ES256 by the team's key (kid, iss)",
    h["apns-topic"] === "com.gt3pb.app" && h["apns-push-type"] === "alert" && Number(h["apns-expiration"]) === Math.floor(NOW / 1000) + 3600
    && verified && dec(head64).alg === "ES256" && dec(head64).kid === "MADEUPKEY1" && dec(claims64).iss === "MADEUPTEAM", { verified, h: Object.keys(h) });
  ok("order: no call out waits for ever — Apple's request carries a deadline, and the browser's push is given ten seconds",
    toApple[0]?.init.signal instanceof AbortSignal && pushed[0]?.timeout === 10_000);
  fresh({ ...orderWorld([web(1, { is_admin: true })]), orders: [{ id: ORDER, created_at: ago(45 * 60_000), tenant_id: FOUNDING, status: "new" }] });
  ok("order: told an hour late it is not news, and not sent", (await post({ type: "INSERT", table: "orders", record: { id: ORDER } })).text === "skip: not news, or sent already" && !pushed.length);
}

// ── 3 · WHOSE REFUSAL IT IS: APPLE ───────────────────────────────────────────────────────────────────────────────────
{
  fresh(orderWorld([phone(1, { is_admin: true }), phone(2, { is_admin: true }), phone(3, { is_admin: true }), phone(4, { is_admin: true })]));
  answer["api.push.apple.com"] = (u) => u.pathname.endsWith(TOKEN(1)) ? apple(410, "Unregistered")() : u.pathname.endsWith(TOKEN(2)) ? apple(400, "BadDeviceToken")()
    : u.pathname.endsWith(TOKEN(3)) ? apple(400, "DeviceTokenNotForTopic")() : apple(200)();
  const got = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("apple: a phone that is gone is deleted — Unregistered, and a development build's token", got.status === 200 && got.text === "ok"
    && w.tables.push_subscriptions.map((s) => s.endpoint).join() === `apns:${TOKEN(3)},apns:${TOKEN(4)}`, { got, left: w.tables.push_subscriptions.map((s) => s.endpoint) });
  ok("apple: …a token for another app is that phone's: kept and logged, never a fault (a wrong topic of ours would have deleted every phone)",
    logged.some(([lv, l]) => lv === "warn" && l === "[push] apns: HTTP 400 DeviceTokenNotForTopic (one phone)") && !faultLines().length, logged);

  fresh(orderWorld([phone(1, { is_admin: true }), phone(2, { is_admin: true })]));
  answer["api.push.apple.com"] = apple(403, "InvalidProviderToken");
  const key = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("apple: Apple refusing OUR key is a fault — said once in the inbox, however many phones; both phones kept",
    faulted(key) && key.text === "ok — but apns: HTTP 403 InvalidProviderToken" && w.tables.push_subscriptions.length === 2
    && logged.filter(([lv, l]) => lv === "error" && l === "[push] apns: HTTP 403 InvalidProviderToken").length === 2, { key, logged });

  fresh(orderWorld([phone(1, { is_admin: true })]));
  answer["api.push.apple.com"] = apple(429, "TooManyRequests");
  const fast = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("apple: one phone sent to too fast (429) is that phone's — logged, not a fault", fast.status === 200 && logged.some(([lv, l]) => lv === "warn" && /apns: HTTP 429/.test(l)), { fast, logged });

  fresh(orderWorld([phone(1, { is_admin: true })]));
  answer["api.push.apple.com"] = (u) => { throw new TypeError(`error sending request for url (${u.href})`); };
  const down = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("apple: Apple unreachable is a fault — said without the address (the phone's token is in it)",
    faulted(down) && down.text === "ok — but apns: error sending request for url ((an address))" && everythingSaid().every(noAddress), { down, logged });
}

// ── 4 · WHOSE REFUSAL IT IS: THE BROWSERS ────────────────────────────────────────────────────────────────────────────
{
  fresh(orderWorld([web(1, { is_admin: true }), web(2, { is_admin: true })]));
  webAnswer = (e) => (e.endsWith("made-up-1") ? 410 : 201);
  const gone = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("browsers: a subscription that is gone (410) is deleted; the rest still go", gone.text === "ok" && w.tables.push_subscriptions.map((s) => s.endpoint.slice(-1)).join() === "2" && pushed.length === 2);

  fresh(orderWorld([web(1, { is_admin: true }), web(2, { is_admin: true })]));
  webAnswer = (e) => (e.endsWith("made-up-1") ? 403 : 201);
  const one = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("browsers: one browser refusing (a subscription made under another key) is that browser's — logged, not a fault, never with its address",
    one.status === 200 && one.text === "ok" && logged.some(([lv, l]) => lv === "warn" && l === "[push] web push: HTTP 403 (one device)") && everythingSaid().every(noAddress), { one, logged });

  fresh(orderWorld([web(1, { is_admin: true }), web(2, { is_admin: true }), web(3, { is_admin: true })]));
  webAnswer = () => 403;
  const all = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("browsers: three or more refusing, and none taking it, is no device's doing — a fault", faulted(all) && all.text === "ok — but web push: every browser refused it (HTTP 403)", all);

  fresh(orderWorld([web(1, { is_admin: true }), web(2, { is_admin: true }), web(3, { is_admin: true })]));
  webAnswer = (e) => (e.endsWith("made-up-1") ? 401 : 403);
  const mixed = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("browsers: …whatever each service calls it (Mozilla 401, Google 403) — every code named", faulted(mixed) && mixed.text === "ok — but web push: every browser refused it (HTTP 401, HTTP 403)", mixed);

  fresh(orderWorld([web(1, { is_admin: true })]));
  webAnswer = () => 401;
  const sig = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("browsers: one browser's 401 is that subscription's (Mozilla's answer to another key) — logged, not a fault (the R21 review)",
    sig.status === 200 && sig.text === "ok" && !faultLines().length && logged.some(([lv, l]) => lv === "warn" && l === "[push] web push: HTTP 401 (one device)"), { sig, logged });

  fresh(orderWorld([web(1, { is_admin: true })]));
  webAnswer = () => 413;
  const big = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("browsers: a payload too large for the push service (413) is ours — a fault at once", faulted(big) && big.text === "ok — but web push: HTTP 413", big);

  fresh(orderWorld([web(1, { is_admin: true }), { ...web(9, { is_admin: true }), endpoint: "https://evil.example.test/collect" }]));
  await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("browsers: a row at no browser's push service is never posted to (R9)", pushed.length === 1 && pushed[0].endpoint.endsWith("made-up-1"));
}

// ── 5 · AN ALERT: TEAMS, EMAIL, THE PEOPLE IT REACHES ────────────────────────────────────────────────────────────────
const alertRow = (extra = {}) => ({ id: ALERT, created_at: ago(30_000), severity: "important", category: "system", kind: "cron_failed",
  title: "A scheduled job is failing — made-up-job", body: "Made-up body.", link: "/crew?s=settings", tenant_id: FOUNDING, target_user_id: null, ...extra });
const leaders = () => [web(1, { user_id: OWNER }), web(2, { user_id: CREW }), web(3, { user_id: MEMBER })];
{
  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  const got = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  const card = sent(TEAMS)[0];
  ok("alert: an important one is a Teams card and a push to the business's leadership — not a member's phone",
    got.text === "ok" && sent(TEAMS).length === 1 && JSON.parse(card?.body ?? "{}").themeColor === "A97C3F" && pushed.map((p) => p.endpoint.slice(-1)).sort().join() === "1,2"
    && !sent("api.resend.com").length, { got, pushed: pushed.map((p) => p.endpoint) });

  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  answer[TEAMS] = () => new Response("Connector retired", { status: 410 });
  const teams = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: a card Teams didn't take is a fault (R21: it was dropped unread) — and the pushes still went",
    faulted(teams) && teams.text === "ok — but teams: HTTP 410" && pushed.length === 2 && logged.some(([lv, l]) => lv === "error" && l === "[push] teams: HTTP 410"), { teams, logged });

  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  answer[TEAMS] = (u) => { throw new TypeError(`error sending request for url (${u.href})`); };
  const wire = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: Teams unreachable is said — never in the error's words, which carry the webhook's address (its key)",
    faulted(wire) && wire.text === "ok — but teams: could not be reached" && everythingSaid().every(noAddress), { wire, logged });

  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  ENV.TEAMS_WEBHOOK_URL = `${TEAMS}/webhookb2/made-up-secret-path`;   // pasted without its https://
  answer[TEAMS] = () => { throw new TypeError(`Invalid URL: '${ENV.TEAMS_WEBHOOK_URL}'`); };
  const bare = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ENV.TEAMS_WEBHOOK_URL = `https://${TEAMS}/webhookb2/made-up-secret-path`;
  ok("alert: …nor when the address was pasted without https:// (fetch's Invalid URL repeats it whole — the R21 review)",
    bare.text === "ok — but teams: could not be reached" && everythingSaid().every(noAddress) && !/made-up-secret-path/.test(JSON.stringify(w.tables.alerts)), { bare, logged });

  fresh({ alerts: [alertRow({ severity: "critical" })], push_subscriptions: leaders() });
  await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  const mail = JSON.parse(sent("api.resend.com")[0]?.body ?? "{}");
  ok("alert: a critical emails the admin list — the first on To, the rest BCC", mail.to?.join() === "owner@example.test" && mail.bcc?.join() === "crew@example.test" && /Open it: https:\/\/app\.gt3pb\.com\/crew\?s=settings/.test(mail.text), mail);

  fresh({ alerts: [alertRow({ severity: "critical" })], push_subscriptions: leaders() });
  answer["api.resend.com"] = () => new Response(JSON.stringify({ statusCode: 422, name: "validation_error", message: "made-up words about owner@example.test" }), { status: 422 });
  const refused = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: a mail Resend refused is a fault in Resend's own name for it — never its message, which can carry an address",
    faulted(refused) && refused.text === "ok — but admin email: Resend 422 validation_error" && !everythingSaid().some((l) => /owner@/.test(l)), { refused, logged });

  fresh({ alerts: [alertRow({ severity: "critical" })], push_subscriptions: leaders() });
  w.fail.admin_emails = { select: { error: { code: "42P01", message: "relation does not exist" } } };
  const list = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: an admin list that couldn't be read is a fault, not nobody to tell", faulted(list) && list.text === "ok — but admin email: the list could not be read (42P01)", list);

  fresh({ alerts: [alertRow({ severity: "critical", target_user_id: OWNER })], push_subscriptions: leaders() });
  await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: a critical with its own person emails them alone, and pushes to their devices alone",
    JSON.parse(sent("api.resend.com")[0]?.body ?? "{}").to?.join() === "owner@example.test" && !JSON.parse(sent("api.resend.com")[0]?.body ?? "{}").bcc && pushed.map((p) => p.endpoint.slice(-1)).join() === "1");

  fresh({ alerts: [alertRow({ severity: "critical", target_user_id: OWNER })], push_subscriptions: leaders() });
  lookupFails = true;
  const fell = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: …and when their address can't be looked up, the admin list gets it — a critical never goes cold",
    fell.text === "ok" && JSON.parse(sent("api.resend.com")[0]?.body ?? "{}").bcc?.join() === "crew@example.test", fell);

  fresh({ alerts: [alertRow({ severity: "fyi" })], push_subscriptions: leaders() });
  const fyi = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: an fyi stays in the inbox — no card, no mail, no push", fyi.text === "ok: fyi stays in the inbox" && !outbound.length && !pushed.length);

  fresh({ alerts: [alertRow({ kind: "device_test", target_user_id: CREW })], push_subscriptions: leaders() });
  const test = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: 'Ring this phone' rings that person's devices alone — no Teams, no mail", test.text === "ok" && !sent(TEAMS).length && pushed.map((p) => p.endpoint.slice(-1)).join() === "2");

  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  w.fail.profiles = { select: { error: { code: "57014" } } };
  const who = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: a leadership that couldn't be read is a fault, not nobody to ring", faulted(who) && who.text === "ok — but people: the leadership could not be read (57014)" && !pushed.length, who);

  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  w.fail.push_subscriptions = { select: { error: { code: "57014" } } };
  const devs = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: a device list that couldn't be read is a fault, not no devices — Teams still had its card",
    faulted(devs) && devs.text === "ok — but devices: the list could not be read (57014)" && sent(TEAMS).length === 1, devs);

  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  w.fail.push_sent = { insert: { error: { code: "42501", message: "permission denied" } } };
  const once = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: a sent-once key that couldn't be kept still sends (a push missed is worse than one doubled) — and says so",
    faulted(once) && once.text === "ok — but sent once: the event's key could not be kept (42501)" && pushed.length === 2, once);

  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  answer[TEAMS] = () => new Response("", { status: 500 });
  webAnswer = () => 413;
  const two = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: two faults are both named, in the order they happened — one line in the inbox", faulted(two) && two.text === "ok — but teams: HTTP 500; web push: HTTP 413", two);

  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  answer[TEAMS] = () => new Response("", { status: 500 });
  await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  await post({ type: "INSERT", table: "alerts", record: { id: "a1000000-0000-4000-8000-000000000002" } }).catch(() => null);
  w.tables.alerts.push({ ...alertRow({ id: "a1000000-0000-4000-8000-000000000003" }) });
  await post({ type: "INSERT", table: "alerts", record: { id: "a1000000-0000-4000-8000-000000000003" } });
  const line = faultLines();
  ok("alert: a fault that keeps happening is one line, refreshed — not one a send; it reopens no sooner than six hours after a Got it",
    line.length === 1 && line[0].title === "Alerts couldn't all go out" && line[0].severity === "important" && line[0].reopen_after === "6 hours"
      && /^The push service couldn't do all it was asked\. The last time: teams: HTTP 500\.$/.test(line[0].body), line);

  fresh({ alerts: [alertRow()], push_subscriptions: leaders() });
  answer[TEAMS] = () => new Response("", { status: 500 });
  w.fail["rpc:alert_open_once"] = { call: { error: { code: "57014", message: "canceling statement due to statement timeout" } } };
  const unsaid = await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  ok("alert: a fault line that couldn't be written is a 502 naming the fault — for cron_watch to read (0427)",
    unsaid.status === 502 && unsaid.text === "ok — but teams: HTTP 500" && !faultLines().length && logged.some(([, l]) => l === "[push] the fault line could not be written (57014)"), { unsaid, logged });
}

// ── 5b · WHAT LEAVES THE APP (R27, 2026-10-18 — the 10/10 audit, API F17; Ryan: "Order # + link only") ──────────────
// A card and an email carry the kind's words, the number it is about and the link — never the alert's own title or
// body. Made-up names, emails, phones, streets and items are sent through, and looked for outside.
{
  const PII = ["Dana Whitfield", "dana@example.test", "864-555-0142", "14 Made-up Lane", "Rise and Flow", "made-up-job", "Made-up body"];
  const none = (x) => PII.every((w) => !JSON.stringify(x).includes(w));
  const paid = alertRow({ severity: "critical", kind: null, category: "money", title: "Paid order didn't record — add it",
    body: "A card payment succeeded (sq-pay-1, $12.00) but the order didn't save. Name: Dana Whitfield. dana@example.test, 864-555-0142, 14 Made-up Lane. Items: Rise and Flow.",
    subject_id: "3f2a9c10-0000-4000-8000-000000000001", link: "/crew?s=now" });
  fresh({ alerts: [paid], push_subscriptions: leaders() });
  await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  const card = JSON.parse(sent(TEAMS)[0]?.body ?? "{}"), mail = JSON.parse(sent("api.resend.com")[0]?.body ?? "{}");
  ok("R27 alert: the Teams card says the kind and the order's number, and links to it — none of the alert's own words",
    card.title === "🔴 Paid order didn't record — add it · #3F2A" && card.summary === "Paid order didn't record — add it · #3F2A"
    && /What it says is in the app — it isn't sent outside it\./.test(card.text) && /Open it: https:\/\/app\.gt3pb\.com\/crew\?s=now/.test(card.text) && none(card), card);
  ok("R27 alert: the critical's email — the kind, the number, the link — and nothing the alert said",
    mail.subject === "Critical — Paid order didn't record — add it · #3F2A" && /Open it: https:\/\/app\.gt3pb\.com\/crew\?s=now/.test(mail.text) && none(mail), mail);
  ok("R27 alert: …while the inbox keeps every word — it is the app's own", w.tables.alerts.some((a) => a.id === ALERT && /Dana Whitfield/.test(a.body)));

  fresh({ alerts: [alertRow({ title: "A scheduled job is failing — made-up-job", body: "Made-up body. dana@example.test" })], push_subscriptions: leaders() });
  await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  const kinded = JSON.parse(sent(TEAMS)[0]?.body ?? "{}");
  ok("R27 alert: a kind with its own words is said in them — its title's job name and its body stay in the app; no subject, no number",
    kinded.title === "🟠 A scheduled job is failing" && none(kinded) && /Open it: https:\/\/app\.gt3pb\.com\/crew\?s=settings/.test(kinded.text), kinded);

  fresh({ alerts: [alertRow({ severity: "critical", kind: null, category: "order", title: "Dana Whitfield's order is late", body: "Made-up body.", link: "https://evil.example.test/x", subject_id: "square" })], push_subscriptions: leaders() });
  await post({ type: "INSERT", table: "alerts", record: { id: ALERT } });
  const named = JSON.parse(sent(TEAMS)[0]?.body ?? "{}"), namedMail = JSON.parse(sent("api.resend.com")[0]?.body ?? "{}");
  ok("R27 alert: a title that isn't a fixed sentence is its category's words; a subject that isn't an id gives no number; a link off this site is the day's",
    named.title === "🔴 An order needs you" && namedMail.subject === "Critical — An order needs you" && none([named, namedMail])
    && /Open it: https:\/\/app\.gt3pb\.com\/crew\?s=day/.test(namedMail.text) && !/evil/.test(JSON.stringify([named, namedMail])), { named, namedMail });
}

// ── 6 · A BOOKING, A SIGN-UP: THE INBOX LINE AND THE MAIL ────────────────────────────────────────────────────────────
{
  const BOOK = "b0000000-0000-4000-8000-000000000001";
  fresh({ booking_requests: [{ id: BOOK, created_at: ago(60_000), name: "Made-up Person", email: "person@example.test", tenant_id: FOUNDING }] });
  const got = await post({ type: "INSERT", table: "booking_requests", record: { id: BOOK } });
  ok("booking: an inbox line (category booking) and an email to the admin list", got.text === "ok: booking" && w.tables.alerts.length === 1 && w.tables.alerts[0].category === "booking" && sent("api.resend.com").length === 1, got);
  // R27 (API F17): the email says a lead came in, the day, how many, and when — who, how to reach them, where and what
  // they wrote stay in the app (the inbox line keeps them).
  fresh({ booking_requests: [{ id: BOOK, created_at: ago(60_000), name: "Dana Whitfield", email: "dana@example.test", phone: "864-555-0142",
    location_text: "14 Made-up Lane, Greenville", notes: "Gate code 4411", event_date: "2026-11-07", headcount: 40, tenant_id: FOUNDING }] });
  await post({ type: "INSERT", table: "booking_requests", record: { id: BOOK } });
  const lead = JSON.parse(sent("api.resend.com")[0]?.body ?? "{}");
  ok("R27 booking: the email — a lead, its day and headcount, the link — and not who, their email or phone, the place or their notes",
    lead.subject === "New booking lead — 2026-11-07" && /Event date: 2026-11-07/.test(lead.text) && /Headcount: 40/.test(lead.text)
    && /Manage it: https:\/\/app\.gt3pb\.com\/crew\?s=plan/.test(lead.text)
    && ["Dana Whitfield", "dana@example.test", "864-555-0142", "Made-up Lane", "Gate code"].every((x) => !JSON.stringify(lead).includes(x))
    && /Dana Whitfield/.test(w.tables.alerts[0]?.body ?? ""), { lead, inbox: w.tables.alerts[0]?.body });
  // R29 (API F1, 0434): a lead kept past the hour's ceiling is announced to nobody — no inbox line, no mail, no push; the
  // door that kept it tells the crew once an hour that a burst came. Its row read like any other (quiet false) still rings.
  fresh({ booking_requests: [{ id: BOOK, created_at: ago(60_000), name: "Made-up Person", email: "person@example.test", tenant_id: FOUNDING, quiet: true }] });
  const hushed = await post({ type: "INSERT", table: "booking_requests", record: { id: BOOK } });
  ok("R29 booking: a lead kept quiet (part of a burst) — no inbox line, no email, nothing pushed",
    hushed.text === "skip: quiet — part of a burst, told once" && w.tables.alerts.length === 0 && !sent("api.resend.com").length && !sent(TEAMS).length, hushed);
  fresh({ booking_requests: [{ id: BOOK, created_at: ago(60_000), name: "Made-up Person", email: "person@example.test", tenant_id: FOUNDING, quiet: false }] });
  const rings = await post({ type: "INSERT", table: "booking_requests", record: { id: BOOK } });
  ok("R29 booking: …one that isn't quiet is announced as ever (and the body's own claim of quiet is not read — the row is)",
    rings.text === "ok: booking" && w.tables.alerts.length === 1, rings);
  fresh({ booking_requests: [{ id: BOOK, created_at: ago(60_000), name: "Made-up Person", email: "person@example.test", tenant_id: FOUNDING }] });
  const told = await post({ type: "INSERT", table: "booking_requests", record: { id: BOOK, quiet: true } });
  ok("R29 booking: …a webhook body that says quiet can't hush a lead the database holds as loud", told.text === "ok: booking" && w.tables.alerts.length === 1, told);
  fresh({ booking_requests: [{ id: BOOK, created_at: ago(60_000), name: "Made-up Person", tenant_id: FOUNDING }] });
  w.fail.alerts = { insert: { error: { code: "23514", message: "violates check constraint" } } };
  const lost = await post({ type: "INSERT", table: "booking_requests", record: { id: BOOK } });
  ok("booking: an inbox line the database refused is a fault — the mail still went", faulted(lost) && lost.text === 'ok: booking — but inbox: "New booking lead" could not be written (23514)' && sent("api.resend.com").length === 1, lost);
  fresh({ profiles: [{ id: MEMBER, role: "member", tenant_id: FOUNDING, display_name: "Made-up Member", created_at: ago(60_000) }] });
  const join = await post({ type: "INSERT", table: "profiles", record: { id: MEMBER } });
  ok("sign-up: an fyi line in the inbox and nothing else (no mail)", join.text === "ok: signup" && w.tables.alerts[0]?.severity === "fyi" && !sent("api.resend.com").length, join);
  // R27 (API F17): a critical task's email says it is theirs and links to their day — never its label, which can name a
  // client, nor its event's title.
  const TASK = "e7000000-0000-4000-8000-000000000001";
  fresh({ event_tasks: [{ id: TASK, assignee: CREW, critical: true, label: "Call Dana Whitfield at 864-555-0142", event_id: null, meeting_note_id: null }] });
  const task = await post({ type: "UPDATE", table: "event_tasks", record: { id: TASK, assignee: CREW }, old_record: { id: TASK, assignee: null, critical: true } });
  const taskMail = JSON.parse(sent("api.resend.com")[0]?.body ?? "{}");
  ok("R27 task: a critical task's email — that it is theirs, to them alone, and their day's link — never its label",
    task.status === 200 && taskMail.to?.join() === "crew@example.test" && taskMail.subject === "A critical task is yours"
    && /Your day: https:\/\/app\.gt3pb\.com\/crew\?s=day/.test(taskMail.text) && !/Dana|864-555/.test(JSON.stringify(taskMail)), { task, taskMail });
  fresh({ event_tasks: [{ id: TASK, assignee: CREW, critical: true, label: "Call Dana Whitfield", event_id: null }] });
  await post({ type: "UPDATE", table: "event_tasks", record: { id: TASK, assignee: CREW }, old_record: { id: TASK, assignee: CREW, critical: false } });
  ok("R27 task: …and one of theirs turned critical says so, in the same few words",
    JSON.parse(sent("api.resend.com")[0]?.body ?? "{}").subject === "A task of yours is critical now" && !/Dana/.test(sent("api.resend.com")[0]?.body ?? ""));
}

// ── 7 · A PACK HEARS ABOUT ITS DAY: PUSH, EMAIL, TEXT, AND WHAT WENT WRITTEN BACK ───────────────────────────────────
const packWorld = (extra = {}) => ({
  drop_orders: [{ id: PACK, user_id: MEMBER, size: 6, glass: "return", drop_date: "2026-10-25", stop_id: STOP, paid: true, payment_status: "paid", phone: "+18645550100" }],
  stops: [{ id: STOP, name: "Made-up Market", starts_at: "2026-10-25T15:00:00Z", ends_at: "2026-10-25T18:00:00Z", location_text: null, address: "1 Made-up St, Greenville, SC" }],
  pack_notices: [{ id: NOTICE, pack_id: PACK, kind: "pickup_tomorrow", sent_at: ago(60_000) }],
  push_subscriptions: [web(1, { user_id: MEMBER })],
  ...extra,
});
const notice = () => w.tables.pack_notices[0];
{
  fresh(packWorld());
  const got = await post({ type: "UPDATE", table: "pack_notices", record: { id: NOTICE }, old_record: { id: NOTICE, sent_at: null } });
  ok("pack: the member's device, their own email, no text while texts are off — and what went is written on the notice",
    got.text === "ok" && pushed.length === 1 && JSON.parse(sent("api.resend.com")[0]?.body ?? "{}").to?.join() === "member@example.test"
    && notice().pushed === 1 && notice().emailed === true && notice().texted === "off", { got, notice: notice() });

  fresh(packWorld());
  Object.assign(ENV, { TEXTS_ON: "1", TWILIO_ACCOUNT_SID: "ACmadeup0000", TWILIO_AUTH_TOKEN: "made-up-twilio-token", TWILIO_FROM_NUMBER: "+18645550199" });
  answer["api.twilio.com"] = (u) => { throw new TypeError(`error sending request for url (${u.href})`); };
  const wire = await post({ type: "UPDATE", table: "pack_notices", record: { id: NOTICE }, old_record: { id: NOTICE, sent_at: null } });
  ok("pack: a text that couldn't be sent is the notice's to say — never in the error's words (Twilio's address carries the account)",
    wire.status === 200 && notice().texted === "failed" && notice().detail === "Twilio could not be reached" && everythingSaid().every(noAddress), { wire, notice: notice(), logged });

  fresh(packWorld());
  Object.assign(ENV, { TEXTS_ON: "1", TWILIO_ACCOUNT_SID: "ACmadeup0000", TWILIO_AUTH_TOKEN: "made-up-twilio-token", TWILIO_FROM_NUMBER: "+18645550199" });
  answer["api.twilio.com"] = () => new Response("{}", { status: 401 });
  const keys = await post({ type: "UPDATE", table: "pack_notices", record: { id: NOTICE }, old_record: { id: NOTICE, sent_at: null } });
  ok("pack: Twilio refusing our keys is a fault (the account's), and the notice still says what went",
    faulted(keys) && keys.text === "ok — but texts: Twilio 401 — the account's keys" && notice().texted === "failed" && notice().detail === "Twilio 401", { keys, notice: notice() });

  fresh(packWorld());
  Object.assign(ENV, { TEXTS_ON: "1", TWILIO_ACCOUNT_SID: "ACmadeup0000", TWILIO_AUTH_TOKEN: "made-up-twilio-token", TWILIO_FROM_NUMBER: "+18645550199" });
  answer["api.twilio.com"] = () => new Response("{}", { status: 400 });
  const num = await post({ type: "UPDATE", table: "pack_notices", record: { id: NOTICE }, old_record: { id: NOTICE, sent_at: null } });
  ok("pack: Twilio refusing the member's number is the notice's, not a fault", num.status === 200 && notice().detail === "Twilio 400", { num, notice: notice() });

  fresh(packWorld());
  w.fail.pack_notices = { update: { error: { code: "42501" } } };
  const back = await post({ type: "UPDATE", table: "pack_notices", record: { id: NOTICE }, old_record: { id: NOTICE, sent_at: null } });
  ok("pack: what went, not written back, is a fault — after everything went", faulted(back) && back.text === "ok — but notice: what went could not be written back (42501)" && pushed.length === 1, back);

  fresh(packWorld());
  w.fail.drop_orders = { select: { error: { code: "57014" } } };
  const unread = await post({ type: "UPDATE", table: "pack_notices", record: { id: NOTICE }, old_record: { id: NOTICE, sent_at: null } });
  ok("pack: a pack that couldn't be read is a notice lost — a 500 — not 'no pack'", unread.status === 500 && unread.text === "err: the pack could not be read (57014)" && !pushed.length, unread);

  fresh(packWorld({ notif_prefs: [{ user_id: MEMBER, muted_categories: ["pickup_reminders"] }] }));
  const muted = await post({ type: "UPDATE", table: "pack_notices", record: { id: NOTICE }, old_record: { id: NOTICE, sent_at: null } });
  ok("pack: pickup reminders off — nothing goes, and the notice says why", muted.text === "skip: pickup reminders off" && !pushed.length && notice().detail === "pickup reminders off (Notifications)", { muted, notice: notice() });
  fresh(packWorld({ notif_prefs: [{ user_id: MEMBER, muted_categories: ["pickup_reminders"] }] }));
  w.fail.pack_notices = { update: { error: { code: "42501" } } };
  const why = await post({ type: "UPDATE", table: "pack_notices", record: { id: NOTICE }, old_record: { id: NOTICE, sent_at: null } });
  ok("pack: …and that why, not written back, is a fault", faulted(why) && why.text === "skip: pickup reminders off — but notice: why nothing went could not be written back (42501)", why);
}

// ── 8 · THE KEY APPLE TAKES, UNUSABLE ────────────────────────────────────────────────────────────────────────────────
{
  // A module of its own (a token is kept by the module that signed it), with a key that is no key.
  const load2 = routeLoader({ "npm:web-push@3.6.7": webpushFake, "npm:@supabase/supabase-js@2.108.2": { createClient: () => client } });
  const keep = ENV.APNS_PRIVATE_KEY, before = handler;
  ENV.APNS_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5IGF0IGFsbA==\n-----END PRIVATE KEY-----";
  load2("supabase/functions/push/index.ts");
  fresh(orderWorld([phone(1, { is_admin: true }), phone(2, { is_admin: true }), web(1, { is_admin: true })]));
  const bad = await post({ type: "INSERT", table: "orders", record: { id: ORDER } });
  ok("apple: a key that can't be used is a fault, said once — never the key — and the browsers still had theirs",
    faulted(bad) && /^ok — but apns: /.test(bad.text) && bad.text.split("apns:").length === 2 && !/bm90IGEga2V5/.test(bad.text + everythingSaid().join()) && pushed.length === 1 && !sent("api.push.apple.com").length, { bad, logged });
  ENV.APNS_PRIVATE_KEY = keep; handler = before;
}

// ── 9 · WHICH BUILD THIS IS ──────────────────────────────────────────────────────────────────────────────────────────
// PUSH_VERSION names this code: change index.ts or policy.ts (their code — comments are not counted) and this asks for a
// NEW name, added to the end of scripts/fixtures/push.version.json with the code's fingerprint; a name already there
// keeps the fingerprint it was given (the R21 review: re-recording one under the old name would have let verify:prod
// call a stale deploy current). verify:prod asks the deployed function for its name and fails while it is not this one.
{
  const canon = (rel) => ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile(rel, readFileSync(join(ROOT, rel), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS));
  const fnv = (s) => { let h = 0xcbf29ce484222325n; for (const c of Buffer.from(s, "utf8")) { h ^= BigInt(c); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return h.toString(10); };
  const code = canon("supabase/functions/push/index.ts").replace(/const PUSH_VERSION = "[^"]*";/, 'const PUSH_VERSION = "";') + "\n" + canon("supabase/functions/push/policy.ts");
  const rec = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/push.version.json"), "utf8"));
  const list = Array.isArray(rec.versions) ? rec.versions : [];
  const last = list[list.length - 1] ?? {};
  const names = list.map((v) => v.version);
  ok("version: PUSH_VERSION names this code — the last entry of scripts/fixtures/push.version.json, with this code's fingerprint",
    !!VERSION && last.version === VERSION && last.fingerprint === fnv(code),
    last.version === VERSION ? `the code changed under ${VERSION}: give PUSH_VERSION a new name and add { version, fingerprint: "${fnv(code)}" } to the end of the list`
      : { last, now: { version: VERSION, fingerprint: fnv(code) } });
  ok("version: …every name once, and none of them taken back", names.length >= 1 && new Set(names).size === names.length && list.every((v) => /^\d{4}-\d{2}-\d{2} /.test(v.version) && /^\d+$/.test(v.fingerprint)), list);
  const vp = readFileSync(join(ROOT, "scripts/verify.prod.mjs"), "utf8");
  ok("version: …and verify:prod asks the deployed function for it — with the anon JWT its door checks (verify_jwt); a publishable key, which that door refuses whatever is deployed, is said and not judged",
    /functions\/v1\/push/.test(vp) && vp.includes('const PUSH_VERSION = "([^"]+)";') && vp.includes('else if (!key.startsWith("eyJ")) console.log(')
      && vp.indexOf('else if (!key.startsWith("eyJ"))') < vp.indexOf("functions/v1/push`"));
}

console.error = realError; console.warn = realWarn; globalThis.Date = RealDate;
console.log(`THE PUSH FUNCTION, RUN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
