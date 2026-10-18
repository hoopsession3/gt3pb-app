// R24 — A SESSION IS TAKEN ONLY WHERE SUPABASE PUTS ONE, AN ASK IS USED ONCE, AND A RETRY TELLS WHO WAS MISSED
// (2026-10-18 — the 10/10 audit, security F8, API F23 and API F11; Ryan: "Keep working to improve to a 10").
//
// (1) Supabase's own auth client (@supabase/auth-js, the version the app runs) is started in a made-up browser at a
//     made-up address, as lib/supabase starts it: first with its default reading — which takes a session from the query
//     string, and before the fragment (the hole) — then with lib/linkSignin's: the query refused, the fragment taken, and
//     a session's tokens found in the query taken out of the address as the page opens.
// (2) An ask for a sign-in lasts an hour, and is used up by the sign-in that comes of it.
// (3) The stop-cancel route is run against the made-up database the money routes are tested on: a first call voids its
//     cups and dies having told only one of them; the retry tells the one it missed, and nobody twice.
// Every address, account and token is made up.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const src = (p) => readFileSync(join(ROOT, p), "utf8");

// ── a browser, made up: an address, its history, its storage ──────────────────────────────────────────────────────────
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)), removeItem: (k) => void store.delete(k) };
function browser(href) {
  const at = new URL(href);
  globalThis.window = {
    location: { get href() { return at.href; }, get hash() { return at.hash; }, set hash(h) { at.hash = h; }, get search() { return at.search; }, get pathname() { return at.pathname; } },
    history: { state: null, replaceState: (_s, _t, u) => { at.href = new URL(u, at.href).href; } },
    addEventListener() {}, removeEventListener() {},
    localStorage,
  };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = localStorage;
  return at;
}
const leaveBrowser = () => { delete globalThis.window; delete globalThis.document; delete globalThis.localStorage; };

// ── (1) the auth client, as the page opens ─────────────────────────────────────────────────────────────────────────────
// Supabase's own auth client, as the app's supabase-js carries it (its GoTrueClient is @supabase/auth-js's).
const { GoTrueClient } = require("@supabase/supabase-js");
const AUTH = "https://made-up-project.example.test/auth/v1";
const PEOPLE = { "made-up-their-token": { id: "0c424000-0000-4000-8000-00000000000a", email: "someone-else@example.test" },
  "made-up-my-token": { id: "0c424000-0000-4000-8000-00000000000b", email: "me@example.test" } };
const asked = [];
const authFetch = async (url, init = {}) => {
  const u = String(url);
  const token = String(new Headers(init.headers).get("authorization") || "").replace(/^Bearer /, "");
  asked.push({ u, token });
  if (u === `${AUTH}/user` && PEOPLE[token]) return new Response(JSON.stringify({ ...PEOPLE[token], aud: "authenticated", role: "authenticated" }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ msg: "made-up: not here" }), { status: 401, headers: { "content-type": "application/json" } });
};
const savedChannel = globalThis.BroadcastChannel;
globalThis.BroadcastChannel = undefined;   // one tab: nothing to tell another
let opened = 0;   // a storage key each: one client per made-up page, as a page has
async function open(href, detectSessionInUrl) {
  store.clear(); asked.length = 0;
  const at = browser(href);
  const client = new GoTrueClient({ url: AUTH, headers: {}, storageKey: `made-up-auth-${++opened}`, storage: localStorage, autoRefreshToken: false, persistSession: true,
    detectSessionInUrl, flowType: "implicit", fetch: authFetch });
  await client.initialize();
  const { data } = await client.getSession();
  return { email: data.session?.user?.email ?? null, at, asked: asked.slice() };
}
const TOKENS = (who) => `access_token=${who}&refresh_token=made-up-refresh&expires_in=3600&token_type=bearer&type=magiclink`;
const ld = routeLoader({});
const LS = ld("lib/linkSignin.ts");
const ours = (url) => LS.answerInFragmentOnly(url);
{
  const hole = await open(`https://app.example.test/?${TOKENS("made-up-their-token")}`, true);
  ok("the hole, as it was: the client's default reading takes a session from the query string — someone else's, with no notice (the notice reads the fragment)",
    hole.email === "someone-else@example.test" && !LS.carriesSession(hole.at.hash), hole);
  const shut = await open(`https://app.example.test/?${TOKENS("made-up-their-token")}`, ours);
  ok("shut: with lib/linkSignin's reading, a session in the query string is no session — and the auth service is never even asked who it is",
    shut.email === null && !shut.asked.some((a) => a.token === "made-up-their-token"), shut);
  const mine = await open(`https://app.example.test/#${TOKENS("made-up-my-token")}`, ours);
  ok("…while a link's session in the fragment, where Supabase puts it, signs in — and leaves the address", mine.email === "me@example.test" && mine.at.hash === "", mine);
  const both = await open(`https://app.example.test/?${TOKENS("made-up-their-token")}#${TOKENS("made-up-my-token")}`, ours);
  ok("…and one carrying both (the query winning, in the client's own merge) is refused whole, not read as the query's",
    both.email === null && !both.asked.some((a) => a.token === "made-up-their-token"), both);
  const oops = await open(`https://app.example.test/?error=access_denied&error_code=otp_expired#${TOKENS("made-up-my-token")}`, ours);
  ok("…an error in the query string is not the link's either", oops.email === null, oops);
  const plain = await open("https://app.example.test/menu?code=SUMMER", ours);
  ok("…and an ordinary address is left alone (no session, nothing asked)", plain.email === null && plain.asked.length === 0, plain);
}
{
  ok("answerInFragmentOnly: the fragment's session or its error, and nothing of the kind in the query",
    LS.answerInFragmentOnly(new URL(`https://a.test/#${TOKENS("x")}`)) && LS.answerInFragmentOnly(new URL("https://a.test/#error=access_denied&error_code=otp_expired"))
      && !LS.answerInFragmentOnly(new URL(`https://a.test/?${TOKENS("x")}`)) && !LS.answerInFragmentOnly(new URL("https://a.test/?refresh_token=y#access_token=x"))
      && !LS.answerInFragmentOnly(new URL("https://a.test/#code=1")) && !LS.answerInFragmentOnly(new URL("https://a.test/")));
  ok("withoutQueryTokens: a session's tokens out of the query, everything else kept — and null when there are none",
    LS.withoutQueryTokens(`https://a.test/menu?code=SUMMER&${TOKENS("x")}#keep`) === "https://a.test/menu?code=SUMMER&type=magiclink#keep"
      && LS.withoutQueryTokens("https://a.test/menu?code=SUMMER") === null && LS.withoutQueryTokens("not a url") === null);
  // As the page opens: lib/linkSignin, loaded before the client, takes the tokens out of the address it finds.
  const at = browser(`https://app.example.test/order?x=1&${TOKENS("made-up-their-token")}`);
  routeLoader({})("lib/linkSignin.ts");
  ok("as the page opens, a session's tokens in the query are taken out of the address — out of its history and whatever it is copied into",
    at.href === "https://app.example.test/order?x=1&type=magiclink", at.href);
  const sup = src("lib/supabase.ts");
  ok("lib/supabase reads an address with lib/linkSignin's rule, imported before the client is made",
    sup.includes("detectSessionInUrl: (url) => answerInFragmentOnly(url),") && sup.indexOf('import { answerInFragmentOnly } from "./linkSignin";') < sup.indexOf("createClient<Database>(url"));
}

// ── (2) an ask lasts an hour, and one sign-in ──────────────────────────────────────────────────────────────────────────
{
  browser("https://app.example.test/");
  store.clear();
  const t0 = Date.parse("2026-10-18T12:00:00Z");
  LS.markSigninAsked(t0);
  ok("an ask lasts an hour: asked at 59 minutes, not at 61", LS.ASKED_FOR_MS === 3_600_000 && LS.signinAskedHere(t0 + 59 * 60_000) && !LS.signinAskedHere(t0 + 61 * 60_000));
  ok("…and is used up by the sign-in that comes of it: a second link in that hour is said", LS.takeSigninAsked(t0 + 60_000) === true && LS.takeSigninAsked(t0 + 120_000) === false && !LS.signinAskedHere(t0 + 120_000));
  ok("…a link nobody asked for here is said at once", LS.takeSigninAsked(t0) === false);
  const ap = src("components/AuthProvider.tsx");
  ok("AuthProvider uses the ask up wherever a sign-in comes of it — the link as the page opens, the iPhone app's link, the code — and \"That's me\" asks nothing new",
    ap.includes('if (!takeSigninAsked()) { setLinkNotice(u.email ?? "another account"); noticePending.current = true; }') && ap.includes("const notice = !takeSigninAsked();")
      && /if \(error\) chooseAsked\.current = asked;\s+else takeSigninAsked\(\);/.test(ap) && !/onKeep=\{\(\) => \{ markSigninAsked\(\)/.test(ap) && !/signinAskedHere\(\)/.test(ap));
}
leaveBrowser();
globalThis.BroadcastChannel = savedChannel;

// ── (3) a stop called off: the retry tells the cup customer the first call missed ─────────────────────────────────────────
{
  const resend = { sends: [], keys: new Map(), down: new Set() };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u !== "https://api.resend.com/emails") throw new Error(`unexpected fetch ${u}`);
    const body = JSON.parse(init.body), key = init.headers?.["Idempotency-Key"] ?? null;
    if (resend.down.has(body.to?.[0] ?? body.to)) return new Response("made-up outage", { status: 503 });
    if (key && resend.keys.has(key)) {
      const first = resend.keys.get(key);
      return first.body === init.body ? Response.json({ id: first.id }) : Response.json({ name: "invalid_idempotent_request" }, { status: 409 });
    }
    const id = `re_made_up_${resend.sends.length + 1}`;
    resend.sends.push({ key, to: body.to });
    if (key) resend.keys.set(key, { id, body: init.body });
    return Response.json({ id });
  };
  Object.assign(process.env, { RESEND_API_KEY: "re_made_up_key", NOTIFY_FROM_EMAIL: "GT3 <hello@example.test>" });
  const STOP = "0c424000-0000-4000-8000-00000000005a";
  const SAM = "0c424000-0000-4000-8000-0000000000a1", ANA = "0c424000-0000-4000-8000-0000000000a2", BEA = "0c424000-0000-4000-8000-0000000000a3";
  const CANCELED = "2026-10-18T13:00:00.000Z";
  const cup = (n, user_id, extra = {}) => ({ id: `0c424000-0000-4000-8000-0000000000c${n}`, user_id, items: ["rise"], paid: false, collected_via: null, total_cents: 900, tip_cents: 0, payment_id: null, stop_id: STOP, status: "void", status_changed_at: "2026-10-18T13:00:05.000Z", ...extra });
  const sam = cup(1, SAM), ana = cup(2, ANA), guest = cup(3, null), bea = cup(4, BEA, { status_changed_at: "2026-10-18T12:40:00.000Z" });   // Bea's was voided on the Pass, before
  const w = moneyWorld({
    tables: { stops: [{ id: STOP, name: "Made-up Market", starts_at: "2026-10-24T14:00:00Z", cancel_reason: "made-up rain", canceled_at: CANCELED }],
      orders: [sam, ana, guest, bea], drop_orders: [], message_sent: [], customer_messages: [] },
    unique: { message_sent: ["event_key"] },
    rpc: { text_consent_standing: () => true, rate_limit_hit: () => true },
  });
  const accounts = { [SAM]: "sam@example.test", [ANA]: "ana@example.test", [BEA]: "bea@example.test" };
  w.auth.admin = { getUserById: async (id) => ({ data: { user: accounts[id] ? { id, email: accounts[id] } : null }, error: null }) };
  const L = routeLoader({ "./supabaseAdmin": { supabaseAdmin: w }, "@/lib/supabaseAdmin": { supabaseAdmin: w }, "./serverAlerts": { raiseAlert: async () => {} } });
  const N = L("lib/notify.ts");
  let calls = 0;
  const alerts = [];
  const caller = {
    rpc: async (name) => {
      if (name === "cancel_stop") return { data: { day: "2026-10-24", cups: calls === 0 ? 3 : 0, packs: 0, other_stop_that_day: true, already: calls++ > 0 }, error: null };
      if (name === "void_stop_orders") return { data: { voided: calls === 1 ? [sam, ana, guest] : [], stuck: [] }, error: null };
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
  resend.down.add("ana@example.test");   // the first call reaches Sam, and not Ana
  const first = await call();
  ok("a first call voids three cups and tells Sam — Ana's email doesn't go (the provider down), the guest has no address",
    first.ok && first.cups === 3 && resend.sends.length === 1 && resend.sends[0].key === `order-canceled:${sam.id}` && alerts.length === 1, { first, sends: resend.sends });
  resend.down.clear();
  const second = await call();
  ok("the retry reads the stop's cups voided since it was called off, and tells Ana — Sam hears nothing twice, Bea's (the Pass's, before) is not this stop's to tell",
    second.ok && second.already === true && second.retold === 2 && resend.sends.length === 2 && resend.sends[1].key === `order-canceled:${ana.id}`
      && !resend.sends.some((m) => m.key === `order-canceled:${bea.id}`) && alerts.length === 1, { second, sends: resend.sends });
  const third = await call();
  ok("a third call tells nobody", third.ok && resend.sends.length === 2, { third, sends: resend.sends.length });
  // A read that fails is said to the crew, never "already canceled".
  calls = 1;
  w.fail = { orders: { select: { code: "PGRST000", message: "made-up: no answer" } } };
  const blind = await call();
  ok("a retry that can't read the cups back says so to the crew — critical — instead of \"Already canceled.\"",
    blind.ok && blind.already !== true && alerts.length === 2 && alerts[1].severity === "critical" && /couldn't be read again just now/.test(alerts[1].body), { blind, alert: alerts[1] });
  w.fail = {};
}

// ── (4) the watcher, watched, and the push webhooks counted: the lists, and what /api/health says (0430) ─────────────────
{
  const { readdirSync } = await import("node:fs");
  // Every migration's cron.schedule and cron.unschedule, in order, comments aside: the jobs alive at the end, each with
  // the migration that made it (the first of its life).
  const alive = new Map();
  for (const f of readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const text = src(`supabase/migrations/${f}`).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    for (const m of text.matchAll(/cron\.(un)?schedule\(\s*'([^']+)'/g)) { if (m[1]) alive.delete(m[2]); else if (!alive.has(m[2])) alive.set(m[2], f.replace(/\.sql$/, "")); }
  }
  const { CRON_JOBS, PUSH_HOOKS } = routeLoader({})("lib/opsWatch.ts");
  const want = JSON.stringify([...alive].sort((a, b) => a[0].localeCompare(b[0])));
  ok(`lib/opsWatch names every job the migrations made, with the migration that made it — no more, no fewer (${alive.size})`,
    JSON.stringify(CRON_JOBS) === want && alive.has("cron-watch"), { have: CRON_JOBS.length, want: alive.size, diff: [...alive].filter(([j, m]) => !CRON_JOBS.some(([a, b]) => a === j && b === m)).slice(0, 5) });

  // The push webhooks, held to production's security snapshot: each named is there and on; and every push_ trigger there
  // that no migration makes (a dashboard webhook) is named — one added in the dashboard is added to the list.
  const snap = JSON.parse(src("supabase/schema.security.json"));
  const migText = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => src(`supabase/migrations/${f}`)).join("\n");
  const inSnap = (h) => (snap.g || []).find(([t, n]) => `${t}.${n}` === h);
  ok(`every push webhook lib/opsWatch names (${PUSH_HOOKS.length}) is in production's snapshot, switched on`,
    PUSH_HOOKS.length >= 13 && PUSH_HOOKS.every((h) => inSnap(h) && inSnap(h)[2] !== "D"), PUSH_HOOKS.filter((h) => !inSnap(h) || inSnap(h)[2] === "D"));
  const unnamed = (snap.g || []).filter(([t, n]) => !t.includes(".") && /^push_/.test(n) && !new RegExp(`\\b${n}\\b`).test(migText) && !PUSH_HOOKS.includes(`${t}.${n}`));
  ok("…and every push_ trigger in production that no migration makes is named there (a dashboard webhook is never left out)", unnamed.length === 0, unnamed);

  let answer = { data: null, error: null };
  const asked = [];
  const admin = {
    from: () => ({ select: () => Promise.resolve({ error: null, count: 1 }), upsert: () => Promise.resolve({ error: null }) }),
    rpc: (name, args) => { asked.push({ name, args }); return Promise.resolve(answer); },
  };
  const H = routeLoader({ "next/server": { NextResponse: NextResponseShim }, "@/lib/supabaseAdmin": { supabaseAdmin: admin } })("app/api/health/route.ts");
  const health = async (path = "/api/health") => (await H.GET(new Request(`https://app.example.test${path}`))).json();
  delete process.env.HEALTH_PROBE_SECRET;
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  answer = { data: { watched_at: ago(7), active: 33, missing: 0, hooks_off: 0 }, error: null };
  const fine = await health();
  ok("health: the watcher finished seven minutes ago, nothing is missing, every hook on — both ok, their ages and counts said, nothing named",
    fine.ok === true && fine.cron?.ok === true && fine.cron.watched_min === 7 && fine.cron.missing === 0 && JSON.stringify(Object.keys(fine.cron).sort()) === '["missing","ok","watched_min"]'
      && fine.hooks?.ok === true && fine.hooks.off === 0 && JSON.stringify(Object.keys(fine.hooks).sort()) === '["off","ok"]', fine);
  ok("health: it asks for exactly lib/opsWatch's jobs, each with its migration, and its hooks", asked.at(-1)?.name === "ops_alive" && asked.at(-1).args.p_jobs.length === CRON_JOBS.length
    && asked.at(-1).args.p_from.length === CRON_JOBS.length && asked.at(-1).args.p_jobs[0] === CRON_JOBS[0][0] && asked.at(-1).args.p_from[0] === CRON_JOBS[0][1]
    && JSON.stringify(asked.at(-1).args.p_hooks) === JSON.stringify(PUSH_HOOKS));
  answer = { data: { watched_at: ago(3), active: 33, missing: 0, hooks_off: 1 }, error: null };
  const hookOff = await health();
  ok("health: a push webhook off — hooks not ok, the count said; the scheduled jobs still ok", hookOff.hooks?.ok === false && hookOff.hooks.off === 1 && hookOff.cron?.ok === true, hookOff);
  answer = { data: { watched_at: ago(31), active: 33, missing: 0 }, error: null };
  const stale = await health();
  ok("health: thirty-one minutes since the watcher finished — cron not ok, while the app itself is", stale.ok === true && stale.cron?.ok === false && stale.cron.watched_min === 31, stale);
  answer = { data: { watched_at: null, active: 0, missing: 0 }, error: null };
  const never = await health();
  ok("health: a watcher that never finished — not ok, and no age made up", never.cron?.ok === false && never.cron.watched_min === null, never);
  answer = { data: { watched_at: ago(3), active: 31, missing: 2 }, error: null };
  ok("health: two jobs missing — not ok, the count said", (await health()).cron?.missing === 2 && (await health()).cron.ok === false);
  answer = { data: null, error: { code: "PGRST202", message: "made-up: no such function" } };
  const before = await health();
  ok("health: before 0430 is pasted — cron and hooks null (not measured), never a failure of the probe", before.ok === true && before.cron === null && before.hooks === null, before);
  admin.rpc = () => Promise.reject(new Error("made-up: the network went"));
  ok("health: a question that throws is not measured either", (await health()).cron === null && (await health()).hooks === null);
  const vp = src("scripts/verify.prod.mjs");
  ok("verify:prod fails the half-hourly check when the scheduled jobs don't run or a push webhook is off, says why, and judges nothing it wasn't told",
    vp.includes("cron.ok === true,") && vp.includes('if (cron === undefined) console.log("  · cron: production') && vp.includes('else if (cron === null) console.log("  · cron: not measured')
      && vp.includes("hooks.ok === true,") && vp.includes('if (hooks === undefined) console.log("  · hooks: production') && vp.includes('else if (hooks === null) console.log("  · hooks: not measured')
      && vp.indexOf("THE WATCHER, WATCHED") < vp.indexOf("// ── 2. CURRENT"));
}

// ── (5) a crash filed, whoever spent the hour (operations F1's last) ──────────────────────────────────────────────────────
{
  const EI = routeLoader({ "./supabaseAdmin": { supabaseAdmin: null }, "./serverAlerts": { raiseAlert: async () => {}, raiseAlertOnce: async () => {} } })("lib/errorIntake.ts");
  const intake = () => {
    const rows = [], counts = {}, seen = new Set();
    const admin = {
      rpc: async (fn, a) => {
        if (fn === "bump_client_error") return { data: seen.has(a.p_fingerprint) };
        if (fn === "rate_limit_hit") { counts[a.p_bucket] = (counts[a.p_bucket] || 0) + 1; return { data: counts[a.p_bucket] <= a.p_max }; }
        throw new Error(`unexpected rpc ${fn}`);
      },
      from: () => ({ insert: (row) => { seen.add(row.fingerprint); rows.push(row); return { select: () => ({ single: async () => ({ data: { id: `0c424000-0000-4000-8000-${String(rows.length).padStart(12, "0")}` }, error: null }) }) }; } }),
    };
    const deps = { admin, raiseAlert: async () => {}, raiseAlertOnce: async () => true };
    let n = 0;
    const file = (ip, extra = {}) => EI.fileError({ message: `made-up error ${++n}`, url: "/menu", ua: "Safari", browser: true, ip, ...extra }, deps);
    return { file, rows, counts };
  };
  ok("the shares: a browser's crashes a hundred and twenty an hour, the database's refusals sixty of their own, an address five and six",
    EI.NEW_ROWS.max === 120 && EI.NEW_FAILURE_ROWS.max === 60 && EI.NEW_FAILURE_ROWS.bucket !== EI.NEW_ROWS.bucket && EI.NEW_ROWS_PER_ADDRESS.max === 5 && EI.NEW_FAILURES_PER_ADDRESS.max === 6);
  ok("whose pool: a browser's refusal the refusals', its crash the crashes', a route's own throw the server's",
    EI.budgetsFor({ browser: true, ua: "Safari", failure: true }).rows === EI.NEW_FAILURE_ROWS && EI.budgetsFor({ browser: true, ua: "Safari" }).rows === EI.NEW_ROWS
      && EI.budgetsFor({ ua: "server" }).rows === EI.SERVER_ROWS && EI.budgetsFor({ ua: "server", browser: true, failure: true }).rows === EI.NEW_FAILURE_ROWS);
  ok("an IPv6 caller's share is its /56: two /64s of one block are one share, the next block another — an IPv4 address its own",
    EI.addressBucket("2001:db8:1:200::1") === EI.addressBucket("2001:db8:1:2ff:abcd::9") && EI.addressBucket("2001:db8:1:200::1") !== EI.addressBucket("2001:db8:1:300::1")
      && EI.addressBucket("2001:db8:1:200::1") === "client-errors:new:2001:db8:1:200::/56" && EI.addressBucket("203.0.113.9") === "client-errors:new:203.0.113.9"
      && EI.addressBucket("2001:db8:1:2ff::1", true) === "client-errors:new:db:2001:db8:1:200::/56");
  const t = intake();
  // Six addresses each send their five made-up crashes and their six refusals — what blinded the hour before.
  for (let a = 1; a <= 6; a++) { for (let i = 0; i < 6; i++) await t.file(`198.51.100.${a}`); for (let i = 0; i < 7; i++) await t.file(`198.51.100.${a}`, { failure: true }); }
  const real = await t.file("203.0.113.77", { message: "TypeError: the real crash" });
  ok("six addresses' shares spent, crashes and refusals both — a real crash from a seventh still files", real === true && t.rows.some((r) => r.message === "TypeError: the real crash"), { real, rows: t.rows.length });
  // An IPv6 caller with a /56 to spend (256 /64s) gets one share, not 256.
  const u = intake();
  for (let i = 0; i < 40; i++) await u.file(`2001:db8:9:${(0x4500 + i).toString(16)}::1`);
  ok("one /56, forty /64s of it, forty made-up crashes: five filed — not forty", u.rows.length === 5, u.rows.length);
  // The refusals fill their own pool and never the crashes'.
  const v = intake();
  for (let a = 1; a <= 12; a++) for (let i = 0; i < 6; i++) await v.file(`192.0.2.${a}`, { failure: true });
  ok("seventy-two refusals from twelve addresses: sixty filed, and the crashes' pool untouched", v.rows.length === 60 && !v.counts[EI.NEW_ROWS.bucket], { rows: v.rows.length, crashes: v.counts[EI.NEW_ROWS.bucket] });
  ok("…and a crash after them files", (await v.file("192.0.2.200")) === true);
}

console.log(`\nR24 — A SESSION WHERE SUPABASE PUTS ONE, AN ASK USED ONCE, A RETRY TELLS WHO WAS MISSED, THE WATCHER WATCHED: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
