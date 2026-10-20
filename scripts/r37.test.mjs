// R37 — A WAY BACK WITHOUT THE AUTHENTICATOR (2026-10-19 — the fresh audit's UX11-10; Ryan: "Recovery codes").
//
// Two-step (0433) held every owner's and admin's power to an authenticator's code, and the only way back from a lost one
// was another owner, or the database's dashboard — the business's only owner had neither. Now:
//   1 · lib/recoveryCodes: ten one-time codes a person can read off paper (no 0, O, 1, I or L), kept as scrypt hashes with
//       their own salt, compared in constant time — run here, not read.
//   2 · /api/two-step/codes: ten made on a sign-in that gave the authenticator's code (asked as the caller — 0433's
//       two_step_state), the new kept before the old go, nothing stored but hashes, nothing cached; counted for Settings.
//   3 · /api/two-step/recover: a code, on a sign-in proved in the last few minutes, is used once and takes the lost
//       authenticator off through Supabase's own admin door — and the owners and admins are told. A failure after the
//       code is marked gives it back, and says so only when it was.
//   4 · the client's doors (lib/twoStep), the screens' words, the paste file, and /api/book's before-0434 insert gone.
// The table itself (0438) is run in db.r37.test.mjs; the screens are drawn and tapped in behaviour.test.mjs.
// Every person, address and code here is made up (203.0.113.0/24 and 198.51.100.0/24 are documentation ranges).
import { readFileSync } from "node:fs";
import { randomUUID, scryptSync } from "node:crypto";
import { routeLoader, NextResponseShim, moneyWorld } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

// ── 1 · the codes themselves ─────────────────────────────────────────────────────────────────────────────────────────
const RC = routeLoader({})("lib/recoveryCodes.ts");
{
  const A = RC.RECOVERY_ALPHABET;
  ok("the alphabet: 31 characters, none misread on paper or a screen (no 0, O, 1, I or L)", A.length === 31 && new Set(A).size === 31 && !/[0O1IL]/.test(A));
  const ten = RC.makeCodes();
  const shape = new RegExp(`^[${A}]{5}-[${A}]{5}$`);
  ok("ten codes, no two alike, each as shown: five, a dash, five", ten.length === 10 && new Set(ten).size === 10 && ten.every((c) => shape.test(c)), ten);
  const drawn = Array.from({ length: 400 }, () => RC.makeCode()).join("").replace(/-/g, "");
  ok("…drawn from the whole alphabet (4,000 characters cover all 31), about 50 bits a code", new Set(drawn).size === 31 && Math.log2(31 ** 10) > 49);
  ok("typed as a person types it — lower case, a space for the dash, spaces around — it is the same code",
    RC.codeOf("abcde 23456") === "ABCDE23456" && RC.looksLikeCode("abcde 23456") && RC.looksLikeCode(" ABCDE-23456 "));
  ok("…and what can't be one is said so before anything is asked: nine characters, eleven, an O, a 1, nothing, a number",
    ["ABCDE-2345", "ABCDE-234567", "ABCDE-2345O", "ABCD1-23456", "", null, undefined, 1234567890].every((t) => !RC.looksLikeCode(t)));
  const [c0, c1] = ten;
  const h1 = RC.hashCode(c0), h2 = RC.hashCode(c0);
  ok("kept as a hash with its own salt — s1$<16-byte salt>$<32-byte hash> — never the code: the same code twice keeps two hashes",
    /^s1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/.test(h1) && h1 !== h2 && !h1.includes(c0) && !h1.includes(RC.codeOf(c0)), h1);
  const [, salt, hash] = h1.split("$");
  ok("scrypt at its stated cost (N 16384, r 8, p 1, 32 bytes), over the code's letters and digits",
    scryptSync(RC.codeOf(c0), Buffer.from(salt, "base64url"), 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url") === hash);
  ok("a code matches its hash — typed in lower case with a space too — and another code doesn't",
    RC.codeMatches(c0, h1) && RC.codeMatches(c0, h2) && RC.codeMatches(c0.toLowerCase().replace("-", " "), h1) && !RC.codeMatches(c1, h1));
  ok("a kept value that isn't a hash is no match, and never a throw",
    ["", "s1$", "s1$$", `s2$${salt}$${hash}`, `s1$${salt}$${hash.slice(0, 20)}`, c0, null, undefined].every((k) => { try { return RC.codeMatches(c0, k) === false; } catch { return false; } }));
  const src = code(read("lib/recoveryCodes.ts"));
  ok("compared in constant time — the app's one compare, lib/webhookSignature's sameBytes — at the hash's own length; drawn with the platform's CSPRNG (randomInt, randomBytes)",
    /return sameBytes\(got\.toString\("base64url"\), h\);/.test(src) && /if \(Buffer\.from\(h, "base64url"\)\.length !== KEY\) return false;/.test(src)
    && /import \{ sameBytes \} from "\.\/webhookSignature";/.test(src) && /randomInt\(RECOVERY_ALPHABET\.length\)/.test(src)
    && /randomBytes\(16\)/.test(src) && !/Math\.random/.test(src));
}

// ── the world the two doors meet: Supabase's auth (sessions, the admin door's factors), the table, the limiter ─────────
const ME = "0c438000-0000-4000-8000-0000000000a1";    // an owner, with an authenticator
const YOU = "0c438000-0000-4000-8000-0000000000a2";   // an admin, with one of their own
const NEW = "0c438000-0000-4000-8000-0000000000a3";   // no authenticator
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const nowS = () => Math.floor(Date.now() / 1000);
// A bearer as GoTrue writes one (made up, unsigned — the auth service is stood in for, and it is what checks a token).
const bearer = (sub, aal, provedAgoS) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub, role: "authenticated", aal,
  amr: [{ method: "password", timestamp: nowS() - provedAgoS }, ...(aal === "aal2" ? [{ method: "totp", timestamp: nowS() - 20 }] : [])] })}.made-up`;
const T = {
  meFresh1: bearer(ME, "aal1", 60), meFresh2: bearer(ME, "aal2", 60), meStale1: bearer(ME, "aal1", 3600),
  youFresh2: bearer(YOU, "aal2", 60), newFresh1: bearer(NEW, "aal1", 60), newClaims2: bearer(NEW, "aal2", 60),
};
const counts = {};
const w = moneyWorld({
  tables: {
    two_step_recovery_codes: [],
    profiles: [{ id: ME, display_name: "Alex Rivera" }, { id: YOU, display_name: "" }, { id: NEW, display_name: "Sam Ito" }],
  },
  defaults: { two_step_recovery_codes: () => ({ id: randomUUID(), made_at: new Date().toISOString(), used_at: null }) },
  sessions: Object.fromEntries(Object.entries(T).map(([k, t]) => [t, { id: k.startsWith("me") ? ME : k.startsWith("you") ? YOU : NEW, email: `${k}@example.test` }])),
  rpc: {
    // rate_limit_hit as 0154/0419 count it: true under the cap, a try over it refused and not counted.
    rate_limit_hit: (a) => { const n = counts[a.p_bucket] ?? 0; if (n >= a.p_max) return false; counts[a.p_bucket] = n + 1; return true; },
  },
});
// Supabase's admin door to a person's second steps (GoTrue's /admin/users/{id}/factors), stood in for.
const factors = {};
const adminCalls = [];
const adminFail = { list: null, delete: [] };
w.auth.admin = { mfa: {
  async listFactors({ userId }) {
    adminCalls.push(["list", userId]);
    if (adminFail.list) return { data: null, error: adminFail.list };
    return { data: { factors: (factors[userId] ?? []).map((f) => ({ ...f })) }, error: null };
  },
  async deleteFactor({ id, userId }) {
    adminCalls.push(["delete", userId, id]);
    const e = adminFail.delete.shift();
    if (e) return { data: null, error: e };
    factors[userId] = (factors[userId] ?? []).filter((f) => f.id !== id);
    return { data: { id }, error: null };
  },
} };
const resetFactors = () => {
  factors[ME] = [{ id: "f-me-totp", factor_type: "totp", status: "verified" }, { id: "f-me-phone", factor_type: "phone", status: "verified" }];
  factors[YOU] = [{ id: "f-you-totp", factor_type: "totp", status: "verified" }];
  factors[NEW] = [];
};
resetFactors();
// The caller's own client (lib/apiAuth callerClient): two_step_state asked with THEIR bearer, answered from it.
const stateAsked = [];
let stateDown = false;
const claimsOfBearer = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
const createClient = (_url, _key, opts) => {
  const token = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer /, "");
  return {
    rpc: async (fn) => {
      stateAsked.push([fn, token]);
      if (stateDown) return { data: null, error: { message: "TypeError: fetch failed" } };
      if (fn !== "two_step_state") return { data: null, error: { message: `no ${fn}` } };
      const cl = claimsOfBearer(token);
      const enrolled = (factors[cl.sub] ?? []).some((f) => f.factor_type === "totp" && f.status === "verified");
      return { data: { leader: true, owner: cl.sub === ME, enrolled, given: enrolled && cl.aal === "aal2", required: false, ok: true }, error: null };
    },
  };
};
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://made-up.supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "made-up-anon-key";
const alerts = [];
const L = routeLoader({
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": { supabaseAdmin: w },
  // route() as a pass-through; isJsonObject as lib/apiRoute writes it (scripts/smoke.cjs holds it to that line).
  "@/lib/apiRoute": { route: (_n, f) => f, isJsonObject: (b) => b !== null && typeof b === "object" && !Array.isArray(b) },
  "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); } },
  "@supabase/supabase-js": { createClient },
});
const CODES = L("app/api/two-step/codes/route.ts");
const RECOVER = L("app/api/two-step/recover/route.ts");
ok("compiled: both doors, with the real lib/apiAuth, lib/freshProof, lib/rateLimit, lib/schemaSkew and lib/recoveryCodes",
  typeof CODES.GET === "function" && typeof CODES.POST === "function" && typeof RECOVER.POST === "function");
const ask = async (fn, token, body, ip = "203.0.113.7") => {
  const headers = { "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await fn(new Request("https://app.example.test/api/two-step/x", { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }));
  return { status: res.status, j: await res.json(), cache: res.headers.get("cache-control") };
};
const rowsOf = (who) => w.tables.two_step_recovery_codes.filter((r) => r.user_id === who);
const unused = (who) => rowsOf(who).filter((r) => r.used_at == null);
/** A table write that fails, the nth of its kind from now (1 = the next): PostgREST's answer, not a throw. */
const failNth = (op, n, error) => {
  const real = w.from;
  let seen = 0;
  w.from = (t) => {
    const q = real(t);
    if (t !== "two_step_recovery_codes") return q;
    const was = q[op];
    q[op] = (...a) => {
      seen++;
      if (seen === n) { w.from = real; const out = { then: (res) => Promise.resolve({ data: null, error, count: null }).then(res) }; const chain = new Proxy(out, { get: (o, k) => (k === "then" ? o.then : () => chain) }); return chain; }
      return was.apply(q, a);
    };
    return q;
  };
  return () => { w.from = real; };
};

// ── 2 · /api/two-step/codes ──────────────────────────────────────────────────────────────────────────────────────────
let mine = [];
{
  const none = await ask(CODES.POST, null, {});
  ok("making codes: signed out → 401, nothing made", none.status === 401 && w.tables.two_step_recovery_codes.length === 0, none);
  const aal1 = await ask(CODES.POST, T.meFresh1, {});
  ok("…a sign-in that hasn't given the authenticator's code (a password alone, phished) → 403, said what to do — nothing made",
    aal1.status === 403 && aal1.j.error === RC.RECOVERY_WORDS.giveCode && rowsOf(ME).length === 0, aal1);
  const noneSet = await ask(CODES.POST, T.newClaims2, {});
  ok("…an account with no authenticator, whatever its token claims → 403 — codes are for a second step that exists",
    noneSet.status === 403 && rowsOf(NEW).length === 0, noneSet);
  ok("…asked of the database as the caller — 0433's two_step_state with their own bearer, not the server's key",
    stateAsked.length === 2 && stateAsked.every(([fn]) => fn === "two_step_state") && stateAsked[0][1] === T.meFresh1 && stateAsked[1][1] === T.newClaims2, stateAsked.map(([f]) => f));
  stateDown = true;
  const down = await ask(CODES.POST, T.meFresh2, {});
  stateDown = false;
  ok("…the database not answering who they are → 503, nothing made — never read as yes", down.status === 503 && /nothing was changed/.test(down.j.error) && rowsOf(ME).length === 0, down);

  // YOU's codes, which nothing of ME's may touch.
  const yours = await ask(CODES.POST, T.youFresh2, {});
  ok("YOU (another person) makes theirs", yours.status === 200 && rowsOf(YOU).length === 10, yours.status);
  const made = await ask(CODES.POST, T.meFresh2, {});
  mine = made.j.codes ?? [];
  const kept = rowsOf(ME);
  ok("on a sign-in that gave the code: ten codes, shown in this one answer, never cached (no-store)",
    made.status === 200 && made.j.ok === true && mine.length === 10 && new Set(mine).size === 10 && made.cache === "no-store", made);
  ok("…ten rows for the caller alone, each the hash of one of the ten (in the order made) — no code kept as itself, in any column",
    kept.length === 10 && kept.every((r) => r.user_id === ME && r.used_at == null && /^s1\$/.test(r.code_hash))
    && mine.every((c, i) => RC.codeMatches(c, kept[i].code_hash)) && !RC.codeMatches(mine[0], kept[1].code_hash)
    && !JSON.stringify(w.tables.two_step_recovery_codes).match(new RegExp(mine.map((c) => `${c}|${RC.codeOf(c)}`).join("|"))), kept.length);
  const firstIds = kept.map((r) => r.id).sort().join();
  const again = await ask(CODES.POST, T.meFresh2, {});
  ok("made again: the ten before stop working — gone, used or not — and the new ten are the only ones",
    again.status === 200 && rowsOf(ME).length === 10 && rowsOf(ME).map((r) => r.id).sort().join() !== firstIds
    && !rowsOf(ME).some((r) => RC.codeMatches(mine[0], r.code_hash)) && again.j.codes.every((c, i) => RC.codeMatches(c, rowsOf(ME)[i].code_hash)), rowsOf(ME).length);
  ok("…and YOU's ten are untouched by ME's making", rowsOf(YOU).length === 10 && unused(YOU).length === 10, rowsOf(YOU).length);
  const ins = w.calls.filter((c) => c.table === "two_step_recovery_codes" && c.op === "insert").at(-1);
  const del = w.calls.filter((c) => c.table === "two_step_recovery_codes" && c.op === "delete").at(-1);
  ok("…the new kept first, then the old taken — scoped to the caller, less the ten just made",
    w.calls.indexOf(ins) < w.calls.indexOf(del) && del.ops.some(([o, c, v]) => o === "eq" && c === "user_id" && v === ME)
    && del.ops.some(([o, c, op]) => o === "not" && c === "id" && op === "in"), del?.ops);
  mine = again.j.codes;

  // The failures, each leaving what was there.
  const before = rowsOf(ME).map((r) => r.id).sort().join();
  w.fail.two_step_recovery_codes = { insert: { code: "57014", message: "canceling statement due to statement timeout" } };
  const insFail = await ask(CODES.POST, T.meFresh2, {});
  ok("the insert refused → 500, \"nothing was changed\" — and nothing was: the ten before still work",
    insFail.status === 500 && /nothing was changed/.test(insFail.j.error) && !insFail.j.codes && rowsOf(ME).map((r) => r.id).sort().join() === before, insFail);
  w.fail.two_step_recovery_codes = { delete: { code: "57014", message: "canceling statement due to statement timeout" } };
  const delFail = await ask(CODES.POST, T.meFresh2, {});
  ok("the old ten not taken → the new ten undone: 500, nothing changed, no codes shown — the ten before still the only ones",
    delFail.status === 500 && /nothing was changed/.test(delFail.j.error) && !delFail.j.codes && rowsOf(ME).map((r) => r.id).sort().join() === before, { delFail, n: rowsOf(ME).length });
  w.fail.two_step_recovery_codes = { delete: { sticky: true, error: { code: "57014", message: "canceling statement due to statement timeout" } } };
  const bothFail = await ask(CODES.POST, T.meFresh2, {});
  delete w.fail.two_step_recovery_codes;
  ok("…and the undo refused too → said to make them again (no codes shown); the next made take every one of them away",
    bothFail.status === 500 && /Make them again/.test(bothFail.j.error) && !bothFail.j.codes && rowsOf(ME).length === 20, { bothFail, n: rowsOf(ME).length });
  const healed = await ask(CODES.POST, T.meFresh2, {});
  ok("…made again: ten, the twenty before gone", healed.status === 200 && rowsOf(ME).length === 10, rowsOf(ME).length);
  mine = healed.j.codes;

  // Counted, for Settings & privacy.
  ok("counting: signed out → 401", (await ask(CODES.GET, null)).status === 401);
  const left = await ask(CODES.GET, T.meStale1);
  ok("counting: the caller's unused codes — on any sign-in, the authenticator's code or not — never cached",
    left.status === 200 && left.j.left === 10 && left.cache === "no-store", left);
  rowsOf(ME)[0].used_at = new Date().toISOString();
  ok("…a used one isn't counted, and nobody else's are", (await ask(CODES.GET, T.meFresh1)).j.left === 9 && (await ask(CODES.GET, T.newFresh1)).j.left === 0);
  rowsOf(ME)[0].used_at = null;
  w.fail.two_step_recovery_codes = { select: { code: "08006", message: "connection failure" } };
  const broke = await ask(CODES.GET, T.meFresh1);
  delete w.fail.two_step_recovery_codes;
  // 0438 is in production (R45 retired the paths that waited for it): the table is always there, so a read that fails is
  // a failure.
  ok("…any other failure to count is a failure (500), not \"none\"", broke.status === 500 && broke.j.left === undefined, broke);
}

// ── 3 · /api/two-step/recover ────────────────────────────────────────────────────────────────────────────────────────
{
  const asks = () => counts[`recover:${ME}`] ?? 0;
  const out = await ask(RECOVER.POST, null, { code: mine[0] });
  ok("using a code: signed out → 401", out.status === 401, out);
  const stale = await ask(RECOVER.POST, T.meStale1, { code: mine[0] });
  ok("…on a sign-in proved an hour ago → 403 with prove — sign in again first; nothing read, no try spent, the code unused",
    stale.status === 403 && stale.j.prove === true && stale.j.error === RC.RECOVERY_WORDS.fresh && asks() === 0 && unused(ME).length === 10
    && !adminCalls.length, stale);
  for (const [bad, why] of [["hello", "a word"], ["ABCDE-2345", "nine characters"], [{ nope: 1 }, "no code in it"], ["", "nothing"]]) {
    const r = await ask(RECOVER.POST, T.meFresh1, typeof bad === "string" ? { code: bad } : bad);
    ok(`…what can't be a code (${why}) → 400, said what one looks like — no try spent`, r.status === 400 && r.j.error === RC.RECOVERY_WORDS.notCode && asks() === 0, r);
  }
  const junk = await ask(RECOVER.POST, T.meFresh1, "{not json");
  ok("…a body that isn't JSON → 400, never a crash", junk.status === 400, junk);
  for (const [raw, why] of [["null", "a literal null"], ['["ABCDE-23456"]', "a list"], ['"ABCDE-23456"', "a bare string"]]) {
    const r = await ask(RECOVER.POST, T.meFresh1, raw);
    ok(`…a body that is ${why}, not an object (isJsonObject) → 400 — never a 500 and an alert; no try spent`, r.status === 400 && asks() === 0, r);
  }

  let n0 = asks();
  const wrong = await ask(RECOVER.POST, T.meFresh1, { code: "ABCDE-23456" });
  ok("a code that isn't one of theirs → 422, said plainly — one try spent; nothing taken off, nobody told",
    wrong.status === 422 && wrong.j.error === RC.RECOVERY_WORDS.wrong && asks() === n0 + 1 && !adminCalls.length && !alerts.length, wrong);
  const theirs = (await ask(CODES.POST, T.youFresh2, {})).j.codes;
  const crossed = await ask(RECOVER.POST, T.meFresh1, { code: theirs[0] });
  ok("…another person's real code is no code of theirs (each person's codes, read by their own verified id)",
    crossed.status === 422 && unused(YOU).length === 10 && !adminCalls.length, crossed);

  const typed = mine[3].toLowerCase().replace("-", " ");
  const used = await ask(RECOVER.POST, T.meFresh1, { code: typed });
  const row = rowsOf(ME).find((r) => RC.codeMatches(mine[3], r.code_hash));
  ok("one of their codes, as typed (lower case, a space): 200 — nine left, the answer never cached",
    used.status === 200 && used.j.ok === true && used.j.left === 9 && used.j.removed === 1 && used.cache === "no-store", used);
  ok("…the code is used up (marked), the other nine unused", row?.used_at != null && unused(ME).length === 9);
  ok("…the authenticator off through Supabase's admin door — the caller's own, the TOTP only (a phone factor stays)",
    JSON.stringify(adminCalls) === JSON.stringify([["list", ME], ["delete", ME, "f-me-totp"]]) && factors[ME].map((f) => f.id).join() === "f-me-phone", adminCalls);
  ok("…and the owners and admins told: who, what came off, what to do if it wasn't them — linked to Team",
    alerts.length === 1 && alerts[0].title === "A recovery code was used" && alerts[0].severity === "important" && alerts[0].category === "system"
    && alerts[0].link === "/crew?s=team" && /^Alex Rivera used a two-step recovery code/.test(alerts[0].body) && /take their owner or admin role away in Team/.test(alerts[0].body)
    && !alerts[0].body.includes(mine[3]), alerts);
  ok("…with the mark before the admin door (used once, whatever comes after)",
    (() => { const i = w.calls.findIndex((c) => c.table === "two_step_recovery_codes" && c.op === "update"); return i >= 0 && w.calls[i].ops.some(([o, c]) => o === "is" && c === "used_at"); })());

  adminCalls.length = 0; alerts.length = 0;
  const twice = await ask(RECOVER.POST, T.meFresh1, { code: mine[3] });
  ok("the same code again → 422 — it worked once", twice.status === 422 && twice.j.error === RC.RECOVERY_WORDS.wrong && !adminCalls.length && !alerts.length, twice);

  // Nothing to take off now (it came off above): the code is given back, nobody told.
  const nothing = await ask(RECOVER.POST, T.meFresh1, { code: mine[4] });
  ok("no authenticator on the account (taken off, or turned off since) → 409, said — the code given back, nobody told",
    nothing.status === 409 && nothing.j.error === `${RC.RECOVERY_WORDS.nothingOn} — your code wasn't used.` && unused(ME).length === 9
    && !adminCalls.some(([k]) => k === "delete") && !alerts.length, nothing);
  factors[ME] = [{ id: "f-me-half", factor_type: "totp", status: "unverified" }];
  const half = await ask(RECOVER.POST, T.meFresh1, { code: mine[4] });
  ok("…an authenticator set up and never proved is none either", half.status === 409 && unused(ME).length === 9 && !adminCalls.some(([k]) => k === "delete"), half);

  // The failures after the mark.
  resetFactors(); adminCalls.length = 0;
  adminFail.list = { message: "fetch failed", status: 0 };
  const listDown = await ask(RECOVER.POST, T.meFresh1, { code: mine[4] });
  adminFail.list = null;
  ok("Supabase's admin door not answering → 503 — \"your code wasn't used\", and it wasn't (given back)",
    listDown.status === 503 && /your code wasn't used/.test(listDown.j.error) && unused(ME).length === 9 && factors[ME].length === 2, listDown);
  adminFail.delete.push({ message: "Internal Server Error", status: 500 });
  const delDown = await ask(RECOVER.POST, T.meFresh1, { code: mine[4] });
  ok("…the authenticator not taken off → 503, the code given back, nobody told",
    delDown.status === 503 && /couldn't take your authenticator off just now — your code wasn't used/.test(delDown.j.error) && unused(ME).length === 9 && !alerts.length, delDown);
  adminFail.list = { message: "fetch failed", status: 0 };
  const undo = failNth("update", 2, { code: "57014", message: "canceling statement due to statement timeout" });
  const logged = [], quiet = console.error;
  console.error = (m) => logged.push(String(m));   // the give-back refused is said in the platform's log — expected here
  const spent = await ask(RECOVER.POST, T.meFresh1, { code: mine[4] });
  console.error = quiet; undo(); adminFail.list = null;
  ok("…and when the give-back is refused too, it never says the code wasn't used: it's spent, and said so",
    spent.status === 503 && /that code is used up, so use another of yours/.test(spent.j.error) && !/wasn't used/.test(spent.j.error) && unused(ME).length === 8
    && logged.length === 1 && /couldn't be given back/.test(logged[0]) && !mine.some((m) => logged[0].includes(m)), { spent, logged });
  factors[ME] = [{ id: "f-me-a", factor_type: "totp", status: "verified" }, { id: "f-me-b", factor_type: "totp", status: "verified" }];
  adminFail.delete.push(null, { message: "Internal Server Error", status: 500 });
  const partial = await ask(RECOVER.POST, T.meFresh1, { code: mine[5] });
  ok("…two authenticators, the second not taken off → 503, said as part done — the code stays used (one came off)",
    partial.status === 503 && /Only part of that went through/.test(partial.j.error) && unused(ME).length === 7 && factors[ME].map((f) => f.id).join() === "f-me-b", partial);

  // Taken just now by another tap: the mark finds the row already used. (A fresh hour of tries: the ten above spent it.)
  resetFactors(); adminCalls.length = 0; counts[`recover:${ME}`] = 0;
  const target = rowsOf(ME).find((r) => RC.codeMatches(mine[6], r.code_hash));
  const realFrom = w.from;
  w.from = (t) => {
    const q = realFrom(t);
    if (t === "two_step_recovery_codes") { const upd = q.update; q.update = (v) => { if (v.used_at) target.used_at = new Date().toISOString(); w.from = realFrom; return upd.call(q, v); }; }
    return q;
  };
  const raced = await ask(RECOVER.POST, T.meFresh1, { code: mine[6] });
  w.from = realFrom;
  ok("two taps of one code at once: the second finds it used (the mark asks used_at is null) → 409 — nothing taken off",
    raced.status === 409 && /used just now/.test(raced.j.error) && !adminCalls.length, raced);

  // A name the alert can say, or the team's word for nobody in particular.
  const youCode = theirs[1];
  const fromYou = await ask(RECOVER.POST, T.youFresh2, { code: youCode }, "198.51.100.9");
  ok("an admin with no name on their profile: told as \"Someone on the team\"", fromYou.status === 200 && /^Someone on the team used/.test(alerts.at(-1)?.body ?? ""), { fromYou, a: alerts.at(-1) });

  // Ten tries an hour for a person, thirty for an address.
  counts[`recover:${ME}`] = 10;
  const limited = await ask(RECOVER.POST, T.meFresh1, { code: mine[7] });
  ok("the eleventh try in the hour → 429, \"too many tries\" — nothing read, the code unused",
    limited.status === 429 && limited.j.error === RC.RECOVERY_WORDS.tooMany && unused(ME).some((r) => RC.codeMatches(mine[7], r.code_hash)), limited);
  counts[`recover:${ME}`] = 0;
  counts["recover-ip:203.0.113.7"] = 30;
  const crowd = await ask(RECOVER.POST, T.meFresh1, { code: mine[7] });
  counts["recover-ip:203.0.113.7"] = 0;
  ok("…and thirty from one address, whoever is asking → 429", crowd.status === 429, crowd);
  w.fail.two_step_recovery_codes = { select: { code: "08006", message: "connection failure" } };
  const broke = await ask(RECOVER.POST, T.meFresh1, { code: mine[7] });
  delete w.fail.two_step_recovery_codes;
  ok("…any other failure to read is a failure (500, nothing changed), not \"none\"", broke.status === 500 && /nothing was changed/.test(broke.j.error), broke);
  const noCodes = await ask(RECOVER.POST, T.newFresh1, { code: mine[7] });
  ok("an account with no codes at all → 422, said who can help instead", noCodes.status === 422 && /Supabase \(Authentication → Users\)/.test(noCodes.j.error), noCodes);
}

// ── 4 · the client's doors, the screens' words, the paste, /api/book ──────────────────────────────────────────────────
{
  const ts = code(read("lib/twoStep.ts"));
  ok("lib/twoStep: makeRecoveryCodes POSTs /api/two-step/codes, recoveryCodesLeft GETs it, recoverWithCode POSTs /api/two-step/recover — each with the sign-in's bearer (authedFetch)",
    /authedFetch\("\/api\/two-step\/codes", \{ method: "POST" \}\)/.test(ts) && /authedFetch\("\/api\/two-step\/codes"\)/.test(ts)
    && /authedFetch\("\/api\/two-step\/recover", \{ method: "POST"/.test(ts));
  ok("…and a route's words reach the screen through failureOr — never raw", (ts.match(/failureOr\(typeof j\?\.error === "string" \? j\.error : null,/g) || []).length === 2);
  const tsp = code(read("components/TwoStepPrompt.tsx"));
  ok("the code screen offers the way back where it's needed — \"Lost your authenticator?\" and, on its own line under the words, a recovery code's button (44pt)",
    /<p className="dp-hint">\s*Lost your authenticator\?[^<]*<\/p>\s*<button type="button" className="auth-link min-h-11 inline-flex items-center" onClick=\{\(\) => \{ setMode\("recover"\); setErr\(""\); \}\} disabled=\{busy\}>Use a recovery code<\/button>/.test(tsp));
  ok("…its field says what it is, takes what a person types (no autocorrect, capitals), and is held to a code's length",
    /aria-label="Recovery code"/.test(tsp) && /autoComplete="off" autoCapitalize="characters"/.test(tsp) && /autoCorrect="off" spellCheck=\{false\}/.test(tsp) && /maxLength=\{20\}/.test(tsp));
  ok("…used: never the console (the session is ended everywhere) — Sign in again",
    /if \(mode === "recovered"\)/.test(tsp) && /onClick=\{\(\) => void signOut\(\)\}>Sign in again<\/button>/.test(tsp) && !/setMode\("recovered"\);\s*onDone\(\)/.test(tsp));
  const setup = code(read("components/TwoStepSetup.tsx"));
  ok("setup makes the ten as it turns on, and shows them before the console opens (onDone waits for \"I've saved them\")",
    /const made = await makeRecoveryCodes\(\);/.test(setup) && /if \("codes" in made\) \{ setCodesCopied\(false\); setStep\(\{ at: "codes", codes: made\.codes, state \}\); return; \}/.test(setup)
    && /setStep\(\{ at: "on", state: step\.state, left: codes\.length \}\); carryOn\(\);/.test(setup));
  ok("…the ten are a list with a name, copied in one tap; Settings says how many are left and makes new ones",
    /<ol ref=\{codesRef\} aria-label="Your ten recovery codes" className="mt-3 mb-0 p-0 list-none grid grid-cols-2 /.test(setup) && /Copy all ten/.test(setup) && /\$\{left\} of 10 left — each works once/.test(setup)
    && />Make new codes<\/button>/.test(setup));
  const paste = read("supabase/APPLY_ALL_PENDING.sql");
  // R45: production's ledger holds 0438 (applied with 0439 and 0440), so the paste moved on without it.
  ok("0438 is production's now, out of the paste file — and 0376 and 0424 are still held back",
    !/0438_a_way_back_without_the_authenticator/.test(paste)
    && !/select public\.record_migration\('0376/.test(paste) && !/select public\.record_migration\('0424/.test(paste));
  const book = code(read("app/api/book/route.ts"));
  ok("/api/book: 0434 is in production, so one insert — the before-the-paste second one, which announced a burst's lead after all, is gone",
    (book.match(/\.from\("booking_requests"\)\.insert\(/g) || []).length === 1 && !/\/quiet\/\.test\(error\.message/.test(book));
  const pkg = JSON.parse(read("package.json"));
  ok("these run with every test, and 0438's own in db:test",
    /node scripts\/behaviour\.test\.mjs && node scripts\/r37\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/db\.r37\.test\.mjs/.test(pkg.scripts["db:test"]));
}

console.log(`\nR37 — A WAY BACK WITHOUT THE AUTHENTICATOR: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
