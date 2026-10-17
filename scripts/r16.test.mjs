// R16 (2026-10-17 — the 10/10 audit's front end and the rest of its doors), run.
//
//   1. A sign-in the auth service couldn't check, at the thirty-one doors that read a session with userFromRequest
//      (API F13's rest): lib/apiAuth's three answers, lib/apiRoute's 503 for the fourth, and three real doors — paying
//      for a reserve, changing texts, cancelling an order — answering it with nothing done.
//   2. The lint ratchet's rules held at zero (scripts/lint.ratchet.mjs): each one fails on its first hit.
// The money routes run whole in scripts/routes.{money,shop,delivery,reserve}.test.mjs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { routeLoader, moneyWorld, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { countFrom, verdict, CEILING, ZERO } from "./lint.ratchet.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 500)}` : "")); } };

const SAM = "0c416000-0000-4000-8000-0000000000a1";
const TOKENS = { good: "made-up-token-good", refused: "made-up-token-refused", down: "made-up-token-down", fivehundred: "made-up-token-503", thrown: "made-up-token-throws" };
let w, filed;
// What the database says to a caller asking a definer function as themselves (is_staff, current_tenant, …).
const asCaller = (bearer, fn) => {
  if (bearer === TOKENS.good) return { data: fn === "current_tenant" ? "00000000-0000-0000-0000-000000000001" : true, error: null, status: 200 };
  if (bearer === TOKENS.refused) return { data: null, error: { code: "PGRST301", message: "JWT expired" }, status: 401 };
  if (bearer === TOKENS.down) return { data: null, error: { code: "", message: "TypeError: fetch failed" }, status: 0 };
  if (bearer === TOKENS.fivehundred) return { data: null, error: { code: "PGRST002", message: "Could not query the database for the schema cache" }, status: 503 };
  if (bearer === TOKENS.thrown) return new TypeError("the client threw");
  return { data: false, error: null, status: 200 };
};
function fresh() {
  w = moneyWorld({
    tables: { reserves: [], orders: [], drop_orders: [], text_consents: [], customers: [] },
    rpc: { rate_limit_hit: () => true },
    sessions: {
      [TOKENS.good]: { id: SAM, email: "sam@example.test" },
      [TOKENS.down]: "down",
      [TOKENS.thrown]: new TypeError("fetch failed"),
    },
  });
  // A 503 from the auth service itself: an AuthApiError with a 5xx status, as supabase-js reports one.
  const getUser = w.auth.getUser;
  w.auth.getUser = async (t) => (t === TOKENS.fivehundred
    ? { data: { user: null }, error: Object.assign(new Error("upstream connect error"), { name: "AuthApiError", status: 503 }) }
    : getUser(t));
  filed = [];
}
const shims = {
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": { get supabaseAdmin() { return w; } },
  // A client on the caller's own token (lib/apiAuth callerClient): its rpc answers from `asCaller`, keyed by the token, as
  // postgrest-js answers — a failed fetch is status 0, the database's own failure a 5xx, a refused token a 401.
  "@supabase/supabase-js": { createClient: (url, anon, opts) => {
    const bearer = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer /, "");
    return bearer ? { rpc: async (fn) => { const a = asCaller(bearer, fn); if (a instanceof Error) throw a; return a; } } : w;
  } },
  "@/lib/errorIntake": { fileError: async (e) => { filed.push(e); } },
  "@/lib/serverAlerts": { raiseAlert: async () => {}, raiseAlertOnce: async () => true },
  "@/lib/notify": { accountEmail: async () => "sam@example.test", whoAsked: async () => "a member", notifyCustomer: async () => ({ sms: "off", email: "sent" }),
    sayTextConsent: async () => ({ ok: true, standing: true }), sayTextYes: async () => ({ ok: true, standing: true }) },
};
fresh();
const load = routeLoader(shims);
const A = load("lib/apiAuth.ts"), R = load("lib/apiRoute.ts"), S = load("lib/signInUnchecked.ts");
const req = (token, body = {}) => new Request("https://app.example.test/api/x", { method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const errLines = [];
const realError = console.error;
console.error = (...a) => { errLines.push(a.join(" ")); };

// ── 1. userFromRequest's answers ────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  const u = await A.userFromRequest(req(TOKENS.good));
  ok("auth: a good bearer is the person — the id and the verified email", u?.id === SAM && u.email === "sam@example.test", u);
  ok("auth: no bearer is no session (null)", (await A.userFromRequest(req(null))) === null);
  ok("auth: a bearer the service refused (401) is no session (null) — as it always was", (await A.userFromRequest(req(TOKENS.refused))) === null);
  for (const [what, t] of [["the network (status 0)", TOKENS.down], ["a 503 from the service", TOKENS.fivehundred], ["a client that threw", TOKENS.thrown]]) {
    let threw = null;
    try { await A.userFromRequest(req(t)); } catch (e) { threw = e; }
    ok(`auth: a bearer the service couldn't check — ${what} — throws SignInUnchecked, never null`, S.isSignInUnchecked(threw) && threw.name === "SignInUnchecked", String(threw));
  }
}

// ── 1b. the wrapper's answer ────────────────────────────────────────────────────────────────────────────────────────
{
  fresh();
  errLines.length = 0;
  const door = R.route("made-up/door", async (r) => { const u = await A.userFromRequest(r); return NextResponseShim.json({ who: u?.id ?? null }); });
  const res = await door(req(TOKENS.down));
  const body = await res.json();
  ok("wrapper: a sign-in that couldn't be checked is a 503 with the words — 'nothing was changed' — and the flag the page can read",
    res.status === 503 && body.error === S.SIGN_IN_UNCHECKED_ANY && body.signInUnchecked === true && /nothing was changed/.test(body.error), { status: res.status, body });
  ok("wrapper: …filed as no crash (an auth blip would file one per door), and said in one log line naming the door",
    filed.length === 0 && errLines.filter((l) => l.startsWith("[sign-in-unchecked]") && l.includes("made-up/door")).length === 1, { filed, errLines });
  const fine = await door(req(TOKENS.good));
  ok("wrapper: the same door with a sign-in that checks answers as itself", fine.status === 200 && (await fine.json()).who === SAM);
  const crash = await R.route("made-up/crash", async () => { throw new Error("a real bug"); })(req(null));
  ok("wrapper: any other throw is still a 500, filed", crash.status === 500 && filed.length === 1 && filed[0].url === "/api/made-up/crash", { status: crash.status, filed });
}

// ── 1c. three real doors ────────────────────────────────────────────────────────────────────────────────────────────
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://made-up.supabase.example";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "made-up-anon";
process.env.NEXT_PUBLIC_TEXTS_ON = "1";
process.env.SQUARE_ACCESS_TOKEN = "made-up-square-access-token";
process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID = "L-MADE-UP-LOCATION";
const RESERVE = "a5000000-0000-4000-8000-000000000001";
const doors = [
  ["paying for a reserve", "app/api/reserves/pay/route.ts", { reserveId: RESERVE, qty: 1, sourceId: "cnon:made-up", idempotencyKey: "made-up-key-0001" }, /Reserves are for members/],
  ["changing texts", "app/api/account/texts/route.ts", { phone: "864-555-0142", on: true }, /Sign in to change your texts/],
  ["cancelling an order", "app/api/orders/cancel/route.ts", { channel: "packs", id: "d5000000-0000-4000-8000-000000000001" }, /Sign in to cancel/],
];
for (const [what, file, body, signIn] of doors) {
  const door = load(file);
  fresh();
  globalThis.fetch = async () => { throw new Error("no network in this test"); };
  const down = await door.POST(req(TOKENS.down, body));
  const said = await down.json();
  const wrote = w.calls.filter((c) => c.rpc || (c.op && c.op !== "select"));
  ok(`door, ${what}: a sign-in that couldn't be checked — 503, 'nothing was changed', and nothing was`, down.status === 503 && said.signInUnchecked === true && wrote.length === 0, { status: down.status, said, wrote });
  fresh();
  const none = await door.POST(req(null, body));
  ok(`door, ${what}: no sign-in at all is still told to sign in (401)`, none.status === 401 && signIn.test((await none.json()).error ?? ""), none.status);
}
// ── 1e. the crew's four gates: a database that didn't answer is not a "no" ──────────────────────────────────────────
for (const [gate, fn, yes] of [["staffFromRequest", "is_staff", true], ["adminFromRequest", "is_admin", true], ["ownerFromRequest", "is_owner", true],
  ["tenantFromRequest", "current_tenant", "00000000-0000-0000-0000-000000000001"]]) {
  fresh();
  const no = gate === "tenantFromRequest" ? null : false;
  ok(`${gate}: the caller the database says yes to is ${JSON.stringify(yes)}`, (await A[gate](req(TOKENS.good))) === yes);
  ok(`${gate}: no bearer is ${JSON.stringify(no)}; a token it refused (401) is ${JSON.stringify(no)}, as always`, (await A[gate](req(null))) === no && (await A[gate](req(TOKENS.refused))) === no);
  for (const [what, t] of [["a fetch that failed (status 0)", TOKENS.down], ["the database's 503", TOKENS.fivehundred], ["a client that threw", TOKENS.thrown]]) {
    let threw = null;
    try { await A[gate](req(t)); } catch (e) { threw = e; }
    ok(`${gate}: ${what} throws SignInUnchecked — never "${fn} said no"`, S.isSignInUnchecked(threw), String(threw));
  }
}
{
  fresh();
  const door = load("app/api/team/welcome/route.ts");
  const down = await door.GET(req(TOKENS.down));
  ok("door, the crew's guide (a staff gate): a database that didn't answer — 503, not 'the crew's guide is for the crew'",
    down.status === 503 && (await down.json()).signInUnchecked === true, down.status);
  const refused = await door.GET(req(TOKENS.refused));
  ok("…and a token it refused is still refused (401)", refused.status === 401, refused.status);
}

console.error = realError;

// ── 1d. every door that reads a session is exported through the wrapper ───────────────────────────────────────────
{
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e === "route.ts") files.push(p); } };
  walk(join(ROOT, "app/api"));
  const readers = files.filter((f) => /userFromRequest\(/.test(readFileSync(f, "utf8")));
  const bare = readers.filter((f) => /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(readFileSync(f, "utf8")));
  ok(`doors: the ${readers.length} that read a session with userFromRequest export every handler through route() — so its throw is always answered`,
    readers.length >= 30 && bare.length === 0, bare.map((f) => relative(ROOT, f)));
  // Four staff tools read the person only to sign their name to a job or to file a draft under their city — each after
  // its own staff gate (staffFromRequest), which is what decides the door. For them a sign-in that couldn't be read is
  // no name on the job, not a refusal.
  const swallowed = readers.filter((f) => /userFromRequest\(req\)\.catch\(/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f)).sort();
  const gatedFirst = swallowed.every((f) => {
    const src = readFileSync(join(ROOT, f), "utf8");
    const gate = src.indexOf("staffFromRequest(req)"), read = src.indexOf("userFromRequest(req).catch(");
    return gate > 0 && gate < read;
  });
  ok("doors: the four that swallow it (.catch) are staff tools, each behind its staff gate first — the person read only to sign a job or pick their city",
    JSON.stringify(swallowed) === JSON.stringify(["app/api/agents/eventprep/route.ts", "app/api/agents/inspection/route.ts", "app/api/agents/intake/route.ts", "app/api/agents/inventory/route.ts"])
      && gatedFirst, swallowed);
}

// ── 2. the lint rules held at zero ─────────────────────────────────────────────────────────────────────────────────
{
  const file = (rules) => ({ filePath: "x.tsx", errorCount: rules.length, warningCount: 0, messages: rules.map((ruleId) => ({ ruleId, severity: 2 })) });
  const held = ["react-hooks/rules-of-hooks", "react-hooks/purity", "react-hooks/refs", "react-hooks/immutability", "react-hooks/preserve-manual-memoization",
    "@typescript-eslint/no-explicit-any", "react/no-unescaped-entities"];
  // R17 added an eighth (set-state-in-effect) and took the ceilings down; scripts/r17.test.mjs holds those. What R16 set
  // still stands: its seven at zero, and ceilings no higher than it left them.
  ok("lint: the seven rules R14 and R16 hold at zero are still the ratchet's", held.every((r) => ZERO.includes(r)), ZERO);
  for (const rule of held) {
    const c = countFrom(JSON.stringify([file([rule])]));
    ok(`lint: one ${rule} fails the gate under any ceiling`, !verdict(c, { errors: 100, warnings: 100 }, ZERO).ok);
  }
  ok("lint: the ceilings are no higher than R16 left them — 89 errors, 51 warnings", CEILING.errors <= 89 && CEILING.warnings <= 51, CEILING);
  const debt = countFrom(JSON.stringify([file(["@next/next/no-img-element"])]));
  ok("lint: a rule not held at zero passes under a ceiling only at the ceiling's count", !verdict(debt, { errors: 2, warnings: 0 }, ZERO).ok && verdict(debt, { errors: 1, warnings: 0 }, ZERO).ok);
}

console.log(`\nR16 — A SIGN-IN THAT COULDN'T BE CHECKED, AT EVERY DOOR; THE LINT RULES HELD AT ZERO: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
