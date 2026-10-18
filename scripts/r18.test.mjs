// R18 — THE 10/10 AUDIT'S OPERATIONS AND SECURITY REMAINDERS, RUN (2026-10-17).
//
//   · every answer the database refused is reported at the browser client's door (lib/failureReport's
//     reportFailingAnswers, lib/supabase) — a read through lib/useLatestRead, an inline read, a write, a function call —
//     once per kind, code and words a page load, whichever door said it first (operations F17);
//   · what a sign-in that ran out, or a database that can't be reached, is: not a bug of ours (lib/failureClass);
//   · an address being typed goes in a POST's body, never a query string a request log keeps — the route, run
//     (app/api/address; security F10).
//
// The modules are compiled from their TypeScript and run as they are; supabase-js itself is run against a stand-in for
// PostgREST, so the door is proved on the client the app uses. Nothing here talks to Supabase.
import { createClient } from "@supabase/supabase-js";
import { NextResponseShim, routeLoader } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const settle = async (n = 8) => { for (let k = 0; k < n; k++) await new Promise((r) => setImmediate(r)); };

// A fresh failureReport each time — its "once a page load" memory is the module's own.
const fresh = () => {
  const FR = routeLoader()("lib/failureReport.ts");
  const sent = [];
  FR.setFailureSender((m) => sent.push(m));
  return { FR, sent };
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const BASE = "https://db.example.test";

// ── lib/failureClass: a sign-in that ran out, a database that can't be reached ─────────────────────────────────────────
{
  const FC = routeLoader()("lib/failureClass.ts");
  ok("class: a token that had run out is the session's, whatever code PostgREST gives it",
    FC.failureClass({ code: "PGRST303", message: "JWT expired" }) === "session" && FC.failureClass({ code: "PGRST301", message: "JWT expired" }) === "session"
      && FC.failureClass({ code: "PGRST303", message: "JWT issued at future" }) === "session");
  ok("class: …and is not reported — the next ask carries a fresh one", FC.reportable({ code: "PGRST303", message: "JWT expired" }) === null && FC.reportable({ code: "PGRST301", message: "JWT expired" }) === null);
  ok("class: a token that is not ours at all is still permission, and reported", FC.reportable({ code: "PGRST301", message: "JWSError JWSInvalidSignature" }) === "permission");
  ok("class: a database that can't be reached is the network's, not a bug — PGRST000, PGRST001, PGRST002",
    ["PGRST000", "PGRST001", "PGRST002"].every((code) => FC.failureClass({ code, message: "Database client error. Retrying the connection." }) === "network" && FC.reportable({ code, message: "x" }) === null));
  ok("class: R13's kinds stand — a missing column, a grant, a refusal, no signal",
    FC.reportable({ code: "42703", message: "column a does not exist" }) === "schema" && FC.reportable({ code: "42501", message: "permission denied" }) === "permission"
      && FC.reportable({ code: "P0001", message: "That stop is closed." }) === null && FC.reportable({ message: "Failed to fetch" }) === null);
  // R18 review: the app's own functions say no with codes of their own (counted in supabase/migrations: PT404 ×25,
  // PT409 ×18, PT429, P0002 ×11, 28000 ×10, 55000 ×8, and 42501 ×54 with a sentence) — refusals, never reports.
  const own = [
    { code: "PT404", message: "That order isn't there." }, { code: "PT409", message: "That stop already closed." }, { code: "PT429", message: "Too many tries." },
    { code: "P0002", message: "No such pack." }, { code: "28000", message: "Sign in to change a delivery." }, { code: "55000", message: "That week is closed." },
    { code: "42501", message: "staff only" }, { code: "42501", message: "Only the crew can log a delivery." }, { code: "42501", message: "not_allowed" },
  ];
  ok("class: the app's own refusals — PT4xx, P0002, 28000, 55000, a 42501 in a sentence — are refusals, not reported",
    own.every((e) => FC.failureClass(e) === "refusal" && FC.reportable(e) === null), own.map((e) => `${e.code}:${FC.failureClass(e)}`));
  ok("class: a 42501 in Postgres's own words is still a grant or a row rule, and reported",
    FC.reportable({ code: "42501", message: "permission denied for table orders" }) === "permission"
      && FC.reportable({ code: "42501", message: 'new row violates row-level security policy for table "notes"' }) === "permission"
      && FC.reportable({ code: "42501", message: "permission denied for function cron_watch" }) === "permission");
  ok("class: no free connection in time (PGRST003) is the network's too",
    FC.failureClass({ code: "PGRST003", message: "Timed out acquiring connection from connection pool." }) === "network" && FC.reportable({ code: "PGRST003", message: "x" }) === null);
  ok("class: a coded answer nobody has named (an internal error) is still 'other' — the screen's reader reports it",
    FC.reportable({ code: "XX000", message: "internal error" }) === "other" && FC.reportable({ code: "PGRST100", message: "failed to parse filter" }) === "other");
  ok("class (review): a deadlock is two writers taking locks in different orders — ours, reported; a PT5xx is not a person's refusal",
    FC.reportable({ code: "40P01", message: "deadlock detected" }) === "other" && FC.reportable({ code: "PT500", message: "x" }) === "other");
}

// ── lib/failureReport: once per kind, code and words, whichever door says it ───────────────────────────────────────────
{
  const { FR, sent } = fresh();
  FR.reportFailure("load", { code: "42703", message: "column events.eta does not exist" }, "events");
  FR.reportFailure("load", { code: "42703", message: "column events.eta does not exist" });
  ok("once: the door's report and the screen's own reader's are one report", sent.length === 1 && sent[0] === "[load: events] schema 42703 — column events.eta does not exist", sent);
  FR.reportFailure("call", { code: "PGRST202", message: "Could not find the function public.office_home without parameters in the schema cache" }, "office_home()");
  ok("once: a database function's failure is said as a call", sent[1] === "[call: office_home()] schema PGRST202 — Could not find the function public.office_home without parameters in the schema cache", sent[1]);
  for (let i = 0; i < 10; i++) FR.reportFailure("load", { code: "42703", message: `column t.c${i} does not exist` }, "t");
  ok("once: still at most MAX_PER_LOAD a page load", sent.length === FR.MAX_PER_LOAD, sent.length);
}

// ── the door: what PostgREST refused, said as it arrives ───────────────────────────────────────────────────────────────
{
  const { FR, sent } = fresh();
  const answers = [];
  const stand = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    answers.push(`${method} ${url.pathname}`);
    if (url.pathname === "/rest/v1/events") return json(400, { code: "42703", message: "column events.eta does not exist", details: null, hint: "secret-detail-never-sent" });
    if (url.pathname === "/rest/v1/rpc/office_home") return json(404, { code: "PGRST202", message: "Could not find the function public.office_home without parameters in the schema cache" });
    if (url.pathname === "/rest/v1/alerts" && method === "PATCH") return json(403, { code: "42501", message: "permission denied for table alerts" });
    if (url.pathname === "/rest/v1/profiles") return json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
    if (url.pathname === "/rest/v1/stops") return json(401, { code: "PGRST303", message: "JWT expired" });
    if (url.pathname === "/rest/v1/orders") return json(409, { code: "23505", message: "duplicate key value violates unique constraint" });
    if (url.pathname === "/rest/v1/menu") return new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    if (url.pathname === "/rest/v1/rpc/claim_reserve") return json(403, { code: "42501", message: "staff only" });
    if (url.pathname === "/rest/v1/rpc/internal_boom") return json(500, { code: "XX000", message: "internal error" });
    if (url.pathname === "/rest/v1/rpc/parse_me") return json(400, { code: "PGRST100", message: "failed to parse filter" });
    if (url.pathname === "/rest/v1/rpc/ambiguous") return json(400, { code: "42702", message: "column reference \"id\" is ambiguous" });
    if (url.pathname === "/rest/v1/rpc/deadlocked") return json(409, { code: "40P01", message: "deadlock detected" });
    if (url.pathname === "/auth/v1/token") return json(400, { code: "invalid_grant", message: "Invalid login credentials" });
    if (url.pathname === "/rest/v1/down") throw new TypeError("Failed to fetch");
    return json(200, [{ id: 1 }]);
  };
  const door = FR.reportFailingAnswers(stand);

  const r1 = await door(`${BASE}/rest/v1/events?select=eta&id=eq.0b1e-private-value`, { method: "GET" });
  await settle();
  ok("door: a read the database refused is reported — the table by name, the code, the words", sent[0] === "[load: events] schema 42703 — column events.eta does not exist", sent);
  ok("door: …never a value from the request, nor the database's details", !sent.join(" ").includes("0b1e-private-value") && !sent.join(" ").includes("secret-detail"), sent);
  const body = await r1.json();
  ok("door: the caller still reads the answer whole — the door read a copy", body.code === "42703" && r1.status === 400, body);

  await door(`${BASE}/rest/v1/rpc/office_home`, { method: "POST", body: "{}" });
  await door(`${BASE}/rest/v1/alerts?id=eq.1`, { method: "PATCH", body: "{}" });
  await settle();
  ok("door: a function the database doesn't have is said as a call", sent[1] === "[call: office_home()] schema PGRST202 — Could not find the function public.office_home without parameters in the schema cache", sent[1]);
  ok("door: a write a grant refused is said as a save", sent[2] === "[save: alerts] permission 42501 — permission denied for table alerts", sent[2]);

  const n = sent.length;
  await door(`${BASE}/rest/v1/profiles?select=*&code=eq.WRONG`, { method: "GET", headers: { Accept: "application/vnd.pgrst.object+json" } });
  await door(`${BASE}/rest/v1/stops?select=*`);
  await door(`${BASE}/rest/v1/orders`, { method: "POST", body: "{}" });
  await settle();
  ok("door: no such row for .single(), a token that ran out and a person's refusal are not reported", sent.length === n, sent.slice(n));
  // R18 review: the door hears answers a screen asked for knowing they may fail, and says itself — so it says the kinds
  // that are never a person's: schema, permission, and a coded answer that is always a bug of ours (a 5xx, class 42, 21000,
  // a deadlock, XX…). A coded "other" in a 4xx is the screen's own reader's to report.
  await door(`${BASE}/rest/v1/rpc/claim_reserve`, { method: "POST", body: "{}" }).then(() => null);
  await door(`${BASE}/rest/v1/rpc/parse_me`, { method: "GET" }).then(() => null);
  await settle();
  ok("door: a function's own 'staff only' (42501 in a sentence) and a 4xx it can't name are not said at the door", sent.length === n, sent.slice(n));
  FR.reportFailure("call", { code: "PGRST100", message: "failed to parse filter" }, "parse_me()");
  ok("door: …the screen's own reader still reports the coded 'other'", sent.at(-1) === "[call: parse_me()] other PGRST100 — failed to parse filter", sent.at(-1));
  sent.length = n;
  {
    const fresh2 = fresh();   // a page load of its own: the one above is near its MAX_PER_LOAD
    const door2 = fresh2.FR.reportFailingAnswers(stand);
    await door2(`${BASE}/rest/v1/rpc/internal_boom`, { method: "POST", body: "{}" });
    await door2(`${BASE}/rest/v1/rpc/ambiguous`, { method: "POST", body: "{}" });
    await door2(`${BASE}/rest/v1/rpc/deadlocked`, { method: "POST", body: "{}" });
    await settle();
    ok("door (review): an internal error (5xx), an ambiguous column (42702) and a deadlock (40P01) are said at the door — always ours",
      fresh2.sent.length === 3 && fresh2.sent.some((m) => /XX000/.test(m)) && fresh2.sent.some((m) => /42702/.test(m)) && fresh2.sent.some((m) => /40P01/.test(m)), fresh2.sent);
  }
  const html = await door(`${BASE}/rest/v1/menu?select=*`);
  await settle();
  ok("door: an answer that isn't the database's words (a gateway's page) is passed on, unreported, unbroken", sent.length === n && html.status === 502 && (await html.text()).includes("Bad gateway"));
  await door(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", body: "{}" });
  await settle();
  ok("door: sign-in's answers are its own door's to say", sent.length === n);
  const okAnswer = await door(`${BASE}/rest/v1/anything?select=*`);
  ok("door: an answer that is ok is handed on untouched", okAnswer.status === 200 && JSON.stringify(await okAnswer.json()) === '[{"id":1}]');
  let rejected = null;
  try { await door(`${BASE}/rest/v1/down`); } catch (e) { rejected = e.message; }
  ok("door: no signal is still the caller's to see — the failure is passed on, never swallowed", rejected === "Failed to fetch", rejected);
  const quiet = fresh();
  quiet.FR.setFailureSender(null);
  const unsent = quiet.FR.reportFailingAnswers(stand);
  const r = await unsent(`${BASE}/rest/v1/events?select=eta`);
  await settle();
  ok("door: before the app installs the sender, nothing is said and nothing breaks", r.status === 400);
}

// ── the door under supabase-js, as lib/supabase builds it ──────────────────────────────────────────────────────────────
{
  const { FR, sent } = fresh();
  const stand = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/rest/v1/events") return json(400, { code: "42703", message: "column events.eta does not exist", details: null, hint: null });
    if (url.pathname === "/rest/v1/rpc/stale_content_count") return json(404, { code: "PGRST202", message: "Could not find the function public.stale_content_count without parameters in the schema cache", details: null, hint: null });
    if (url.pathname === "/rest/v1/notes") return json(403, { code: "42501", message: 'new row violates row-level security policy for table "notes"', details: null, hint: null });
    return json(200, []);
  };
  const db = createClient(BASE, "made-up-public-key-for-tests", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: FR.reportFailingAnswers(stand) } });
  const a = await db.from("events").select("id, eta");
  const b = await db.rpc("stale_content_count");
  const c = await db.from("notes").insert({ body: "x" });
  await settle();
  ok("supabase-js: the caller still gets its { error } — the code and the words, as before", a.error?.code === "42703" && b.error?.code === "PGRST202" && c.error?.code === "42501", [a.error, b.error, c.error]);
  ok("supabase-js: an inline read nobody reports is reported at the door", sent.includes("[load: events] schema 42703 — column events.eta does not exist"), sent);
  ok("supabase-js: a function call through .rpc() too", sent.includes("[call: stale_content_count()] schema PGRST202 — Could not find the function public.stale_content_count without parameters in the schema cache"), sent);
  ok("supabase-js: and a write a row rule refused", sent.includes('[save: notes] permission 42501 — new row violates row-level security policy for table "notes"'), sent);
  // A screen whose own reader reports the same failure (lib/useAsyncData) adds nothing.
  FR.reportFailure("load", a.error);
  ok("supabase-js: the screen's own report of it is the same report", sent.filter((m) => m.includes("column events.eta")).length === 1, sent);
}

// ── app/api/address: what is typed goes in the body ────────────────────────────────────────────────────────────────
{
  const asked = [], limits = [];
  let over = null;
  const admin = { rpc: async (fn, a) => { limits.push(a.p_bucket); return { data: over === a.p_bucket ? false : true, error: null }; } };
  const maps = {
    mapsConfigured: () => true,
    callerKey: () => "caller-hash",
    suggest: async (q) => { asked.push(["suggest", q]); return [{ line1: "12 Main St", line2: "Raleigh, NC", pick: "/v1/search?q=12+Main" }]; },
    resolve: async (p) => { asked.push(["resolve", p]); return { street: "12 Main St", city: "Raleigh", state: "NC", zip: "27601", formatted: "12 Main St, Raleigh, NC 27601" }; },
  };
  const R = routeLoader({ "next/server": { NextResponse: NextResponseShim }, "@/lib/supabaseAdmin": { supabaseAdmin: admin }, "@/lib/appleMaps": maps })("app/api/address/route.ts");
  const post = (body) => R.POST(new Request("https://app.example.test/api/address", { method: "POST", headers: { "content-type": "application/json" }, body }));
  ok("address: the route answers a POST, and still a GET (iPhone builds made before R18)", typeof R.POST === "function" && typeof R.GET === "function");

  const a = await post(JSON.stringify({ q: "12 Main\u0007 St   Raleigh" }));
  const aj = await a.json();
  ok("address: a POST's { q } is what is searched — cleaned, as the GET's was", a.status === 200 && asked.at(-1)?.[0] === "suggest" && asked.at(-1)[1] === "12 Main St Raleigh" && aj.results?.length === 1, [a.status, asked.at(-1), aj]);
  ok("address: …after the caller's own limit, then the app's", JSON.stringify(limits.slice(-2)) === JSON.stringify(["address:caller-hash", "address:all"]), limits);
  const p = await post(JSON.stringify({ pick: "/v1/search?q=12+Main" }));
  ok("address: a POST's { pick } is what is resolved", (await p.json()).address?.zip === "27601" && asked.at(-1)?.[0] === "resolve" && asked.at(-1)[1] === "/v1/search?q=12+Main", asked.at(-1));
  const n = asked.length, l = limits.length;
  const short = await (await post(JSON.stringify({ q: "12 " }))).json();
  ok("address: fewer than four letters asks nobody — not Apple, not the limiter", short.results?.length === 0 && asked.length === n && limits.length === l);
  const bad = await Promise.all([post("null"), post("[1,2]"), post('"12 Main"'), post("{not json")].map(async (r) => (await r).status));
  ok("address: a body that isn't an object is a 400, never a 500", bad.every((s) => s === 400) && asked.length === n, bad);
  const typed = await post(JSON.stringify({ q: 12345678 }));
  ok("address: a q that isn't words is no search", (await typed.json()).results?.length === 0 && asked.length === n);
  over = "address:caller-hash";
  const busy = await post(JSON.stringify({ q: "12 Main St" }));
  ok("address: past the caller's forty a minute — 429, and the app's thousand is never asked", busy.status === 429 && limits.at(-1) === "address:caller-hash" && asked.length === n, [busy.status, limits.slice(-2)]);
  over = null;
  const g = await R.GET(new Request("https://app.example.test/api/address?q=12+Main+St"));
  ok("address: the old GET answers the same", g.status === 200 && asked.at(-1)?.[1] === "12 Main St", asked.at(-1));
}

// ── lib/reports salesWindowStart: the cash line counts the report's own days (DB F4) ─────────────────────────────────
{
  const R = routeLoader({ "./supabase": { supabase: null } })("lib/reports.ts");
  const at = (iso) => Date.parse(iso);
  ok("window: 11:30 pm Eastern in October, one day — from Eastern midnight that day (04:00Z), never UTC's midnight an hour on",
    R.salesWindowStart(1, at("2026-10-17T23:30:00-04:00")) === "2026-10-17T04:00:00.000Z", R.salesWindowStart(1, at("2026-10-17T23:30:00-04:00")));
  ok("window: thirty days back from an October evening — Eastern midnight of September 18",
    R.salesWindowStart(30, at("2026-10-17T21:00:00-04:00")) === "2026-09-18T04:00:00.000Z", R.salesWindowStart(30, at("2026-10-17T21:00:00-04:00")));
  ok("window: in winter the day starts at 05:00Z", R.salesWindowStart(1, at("2026-12-01T20:00:00-05:00")) === "2026-12-01T05:00:00.000Z", R.salesWindowStart(1, at("2026-12-01T20:00:00-05:00")));
  ok("window: across the clock change (seven days back from November 3 is October 28, still EDT)", R.salesWindowStart(7, at("2026-11-03T12:00:00-05:00")) === "2026-10-28T04:00:00.000Z", R.salesWindowStart(7, at("2026-11-03T12:00:00-05:00")));
  ok("window: nothing or nonsense is one day", R.salesWindowStart(0, at("2026-10-17T12:00:00-04:00")) === "2026-10-17T04:00:00.000Z" && R.salesWindowStart(NaN, at("2026-10-17T12:00:00-04:00")) === "2026-10-17T04:00:00.000Z");
}

// ── components/ErrorReporter: the database's failures never spend the crash cap (R18 review) ───────────────────────────
{
  const posted = [];
  const g = globalThis;
  const keep = { window: g.window, fetch: g.fetch, navigator: Object.getOwnPropertyDescriptor(g, "navigator") };
  g.window = { location: { href: "https://app.example.test/crew", origin: "https://app.example.test", pathname: "/crew", search: "", hash: "" } };
  Object.defineProperty(g, "navigator", { value: { userAgent: "test", onLine: true, sendBeacon: (_u, b) => { posted.push(b); return true; } }, configurable: true });
  try {
    const ER = routeLoader({ react: { useEffect: () => {} }, "@/lib/native": { APP_BUILD: false, apiUrl: (p) => p }, "@/lib/reportUrl": { shareableUrl: (l) => l.href } })("components/ErrorReporter.tsx");
    for (let i = 0; i < 12; i++) ER.reportClientError({ message: `[load: t${i}] schema 42703 — column t.c${i} does not exist`, failure: true });
    ER.reportClientError({ message: "TypeError: x is undefined", stack: "TypeError\n    at Pass (pass.js:1:2)" });
    ok("reporter: a page whose reads all failed still says the crash that followed — failures are capped by lib/failureReport, not here",
      posted.length === 13, posted.length);
    for (let i = 0; i < 12; i++) ER.reportClientError({ message: `crash ${i}`, stack: `E\n    at f${i} (a.js:1:1)` });
    ok("reporter: crashes still stop at eight a page load", posted.length === 13 + 7, posted.length);
  } finally {
    g.window = keep.window; g.fetch = keep.fetch;
    if (keep.navigator) Object.defineProperty(g, "navigator", keep.navigator); else delete g.navigator;
  }
}

// ── lib/rateLimit limitAddress: an IPv6 caller is its /64 (R18 review) ─────────────────────────────────────────────────
{
  const RL = routeLoader()("lib/rateLimit.ts");
  const req = (xff) => new Request("https://x.test/", { headers: xff ? { "x-forwarded-for": xff } : {} });
  ok("limit address: IPv4 as it is; the platform's first entry; none is 'anon'",
    RL.callerIp(req(" 9.8.7.6 , 10.0.0.1")) === "9.8.7.6" && RL.callerIp(req("")) === "anon" && RL.callerIp(req(null)) === "anon");
  ok("limit address: two addresses in one IPv6 /64 are one caller",
    RL.limitAddress("2001:db8:1:2:aaaa::1") === "2001:db8:1:2::/64" && RL.limitAddress("2001:0DB8:0001:0002:ffff:ffff:ffff:fffe") === "2001:db8:1:2::/64");
  ok("limit address: …and the next /64 is another", RL.limitAddress("2001:db8:1:3::1") === "2001:db8:1:3::/64");
  ok("limit address: shortened forms, a zone, brackets — the same /64",
    RL.limitAddress("2001:db8::1") === "2001:db8:0:0::/64" && RL.limitAddress("[2001:db8:1:2::9]") === "2001:db8:1:2::/64" && RL.limitAddress("fe80::1%eth0") === "fe80:0:0:0::/64" && RL.limitAddress("::1") === "0:0:0:0::/64");
  ok("limit address: an IPv4 address written as IPv6 is its IPv4 — dotted, or in hex (review)",
    RL.limitAddress("::ffff:203.0.113.9") === "203.0.113.9" && RL.limitAddress("::ffff:c000:201") === "192.0.2.1" && RL.limitAddress("::FFFF:CB00:7109") === "203.0.113.9");
  ok("limit address (review): a port after an IPv4 address is dropped; a quad that isn't an address is kept as it came, never lumped into one bucket",
    RL.limitAddress("203.0.113.9:4431") === "203.0.113.9" && RL.limitAddress("999.1.1.1") === "999.1.1.1" && RL.limitAddress("2001:db8::1.2.3.999") === "2001:db8::1.2.3.999"
      && RL.limitAddress("2001:db8:1:2:1.2.3.4::") === "2001:db8:1:2:1.2.3.4::" && RL.limitAddress("64:ff9b::192.0.2.33") === "64:ff9b:0:0::/64");
  ok("limit address: what isn't an address is kept as it came (and once made a /64, stays one)",
    RL.limitAddress("not-an-address") === "not-an-address" && RL.limitAddress("1:2:3") === "1:2:3" && RL.limitAddress("2001:db8:1:2::/64") === "2001:db8:1:2::/64");
  const EI = routeLoader({ "./supabaseAdmin": { supabaseAdmin: null }, "./serverAlerts": { raiseAlert: async () => {}, raiseAlertOnce: async () => {} } })("lib/errorIntake.ts");
  ok("limit address: a browser's share of new errors is its /64's", EI.addressBucket("2001:db8:1:2::77") === EI.addressBucket("2001:db8:1:2:9::1") && EI.addressBucket("203.0.113.9") === "client-errors:new:203.0.113.9");
  // R18 review: a page's refused reads have their own share — six, a page load's most — apart from its crashes' five.
  const asked = [];
  const admin = { rpc: async (fn, a) => { asked.push({ fn, ...a }); return { data: fn === "bump_client_error" ? false : true, error: null }; },
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: "0c418000-0000-4000-8000-0000000000e1" }, error: null }) }) }) }) };
  const deps = { admin, raiseAlert: async () => {}, raiseAlertOnce: async () => true };
  await EI.fileError({ message: "[load: events] schema 42703 — column events.eta does not exist", url: "https://app.example.test/crew", ua: "t", browser: true, ip: "203.0.113.9", failure: true }, deps);
  await EI.fileError({ message: "TypeError: x is undefined", url: "https://app.example.test/crew", ua: "t", browser: true, ip: "203.0.113.9" }, deps);
  // An address's shares only — not the pools every address shares (R24: the refusals have a pool of their own, client-errors:new:db).
  const shares = asked.filter((a) => a.fn === "rate_limit_hit" && /^client-errors:new:|^client-errors:new:db:/.test(a.p_bucket) && a.p_bucket !== "client-errors:new:db").map((a) => `${a.p_bucket}/${a.p_max}`);
  ok("limit address (review): a database failure spends its own share (six), a crash the crashes' (five) — never each other's",
    JSON.stringify(shares) === JSON.stringify(["client-errors:new:db:203.0.113.9/6", "client-errors:new:203.0.113.9/5"]), shares);
}

// ── lib/fileType: what kind of file this is, by what was said and then by its name (R18 review) ──────────────────────
{
  const FT = routeLoader()("lib/fileType.ts");
  ok("file type: what the file was handed over as, without its parameters", FT.fileType({ type: "Video/MP4; codecs=avc1", name: "a.mp4" }) === "video/mp4");
  ok("file type: none said, or only 'some bytes' — its name says (any case)",
    FT.fileType({ type: "", name: "Clip.MOV" }) === "video/quicktime" && FT.fileType({ type: "application/octet-stream", name: "notes.md" }) === "text/markdown"
      && FT.fileType({ type: "", name: "IMG_0001.HEIC" }) === "image/heic");
  ok("file type: another name for what the extension says is the extension's type — a real Excel sheet stays one",
    FT.fileType({ type: "application/vnd.ms-excel", name: "sales.csv" }) === "text/csv" && FT.fileType({ type: "application/vnd.ms-excel", name: "sales.xls" }) === "application/vnd.ms-excel"
      && FT.fileType({ type: "text/x-markdown", name: "a.md" }) === "text/markdown" && FT.fileType({ type: "image/jpg", name: "a.jpg" }) === "image/jpeg"
      && FT.fileType({ type: "video/x-m4v", name: "Trip.m4v" }) === "video/mp4");   // Safari's name for an iPhone .m4v (the third pass)
  ok("file type: a type said is never overruled by a name that disagrees", FT.fileType({ type: "image/png", name: "photo.jpg" }) === "image/png");
  ok("file type: neither saying — nothing", FT.fileType({ type: "", name: "README" }) === "" && FT.fileType({ type: "application/octet-stream", name: "x.bin" }) === "" && FT.fileType({}) === "");
}

// ── lib/bucketTakes: what each bucket takes, said before a byte goes up — and the same as the database's (R18 review) ──
{
  const BT = routeLoader()("lib/bucketTakes.ts");
  const MB = 1024 * 1024;
  ok("bucket: a file past the size is refused in a person's words",
    BT.bucketRefusal("brand", { size: 13 * MB, type: "image/png" }) === "That file is over 12 MB — pick a smaller one." && BT.bucketRefusal("brand", { size: 12 * MB, type: "image/png" }) === null);
  ok("bucket: a type it doesn't take is refused, saying what it takes",
    BT.bucketRefusal("avatars", { size: 1, type: "image/avif" }) === "That kind of file can't go here — it takes a photo (JPEG, PNG, WebP, HEIC or GIF)."
      && BT.bucketRefusal("note-files", { size: 1, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }) === "That kind of file can't go here — it takes a picture, a PDF or a text file.");
  ok("bucket: a wildcard takes the family; a type with parameters is its type",
    BT.bucketRefusal("content", { size: 1, type: "video/mp4;codecs=avc1" }) === null && BT.bucketRefusal("brand", { size: 1, type: "image/heic" }) === null
      && BT.bucketRefusal("receipts", { size: 1, type: "application/pdf" }) === null);
  ok("bucket (review): a type the phone didn't name is read from the file's name; Excel's name for a .csv is a .csv; with neither, it's said in words",
    BT.bucketRefusal("intake", { size: 1, type: "", name: "notes.md" }) === null && BT.bucketRefusal("intake", { size: 1, type: "application/vnd.ms-excel", name: "sales.csv" }) === null
      && BT.bucketRefusal("intake", { size: 1, type: "application/vnd.ms-excel", name: "sales.xls" }) === "That kind of file can't go here — it takes a picture, a PDF or a text file."
      && BT.bucketRefusal("intake", { size: 1, type: "" }) === "We couldn't tell what kind of file that is — this takes a picture, a PDF or a text file.");
  ok("bucket (review): the shop takes its picker's types, type for type — no SVG, no HEIC most browsers can't show",
    BT.bucketRefusal("shop", { size: 1, type: "image/svg+xml", name: "logo.svg" }) !== null && BT.bucketRefusal("shop", { size: 1, type: "image/heic" }) !== null
      && BT.bucketRefusal("shop", { size: 1, type: "", name: "clip.mov" }) === null && BT.bucketRefusal("shop", { size: 1, type: "image/avif" }) === null);
  ok("bucket: a bucket with no limits of its own is not judged here", BT.bucketRefusal("somewhere-else", { size: 10 ** 12, type: "x/y" }) === null);
  // The same as the database's own: 0421 (avatars, vip), 0423 (the rest), 0292 (a receipt's size).
  const { readFileSync, readdirSync } = await import("node:fs");
  const mig = (prefix) => readFileSync(new URL(`../supabase/migrations/${readdirSync(new URL("../supabase/migrations/", import.meta.url)).find((f) => f.startsWith(prefix))}`, import.meta.url), "utf8");
  const db = {};
  for (const sql of [mig("0421_"), mig("0423_")]) {
    for (const m of sql.matchAll(/update storage\.buckets set (?:file_size_limit = (\d+),\s*)?allowed_mime_types = array\[([^\]]*)\]\s*where id (?:= '([\w-]+)'|in \(([^)]*)\))/g)) {
      const ids = m[3] ? [m[3]] : m[4].split(",").map((x) => x.trim().replace(/'/g, ""));
      for (const id of ids) db[id] = { size: m[1] ? Number(m[1]) : (db[id]?.size ?? null), types: m[2].split(",").map((x) => x.trim().replace(/'/g, "")) };
    }
  }
  db.receipts.size ??= Number(/values \('receipts', 'receipts', false, (\d+)\)/.exec(mig("0292_"))[1]);
  const lib = Object.fromEntries(Object.entries(BT.BUCKET_TAKES).map(([k, v]) => [k, { size: v.maxBytes, types: [...v.types] }]));
  ok("bucket: the app's table is the database's — every bucket, its size and its types (0421, 0423, 0292)",
    JSON.stringify(Object.keys(lib).sort()) === JSON.stringify(Object.keys(db).sort())
      && Object.keys(db).every((k) => lib[k].size === db[k].size && JSON.stringify(lib[k].types) === JSON.stringify(db[k].types)), { lib, db });
}

console.log(`R18 — WHAT THE DATABASE REFUSED IS SAID AT ITS DOOR, WHAT IS TYPED STAYS OUT OF THE ADDRESS: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
