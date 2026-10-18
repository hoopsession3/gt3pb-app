// R27 — PROVED JUST NOW, AND WORDS THAT LEAVE THE APP (2026-10-18 — the 10/10 audit, security F7 and API F17; Ryan: "Yes,
// a fresh code", "Order # + link only").
//
// 1 · Deleting an account asked for a session and nothing else: a phone left unlocked, or lent for a minute, could delete
//     its owner's account for good. The delete takes a proof from the last five minutes now — the 8-digit code emailed
//     when they press Delete (which Supabase writes into the session's token with its time: lib/freshProof), or Apple's
//     word, just now, for this account's Apple ID. Run here: lib/freshProof against made-up tokens, and the route as Next
//     runs it, compiled from its TypeScript, with the real lib/apiAuth and lib/accountErase over a stand-in Supabase —
//     every way of proving it, every way of not, and that a refusal asks, marks and deletes nothing.
// 2 · (below) The alert words that go to Teams and email: what the push function sends outside the app.
// (0432 — a covered settle is a free cup, a credit or an owner's reason — is run in db.r27.test.mjs.)
import { generateKeyPairSync, createSign, createHash, randomBytes } from "node:crypto";
import { routeLoader, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { libLoader } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://made-up.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "made-up-public-key" });

const load = libLoader();
const FP = load("lib/freshProof.ts");
const AE = load("lib/accountErase.ts");
ok("compiled: lib/freshProof, lib/accountErase", typeof FP.provedWithin === "function" && typeof FP.claimsOf === "function" && typeof AE.ERASE_WORDS.prove === "string");

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.made-up-signature`;
const NOW = Date.now(), S = Math.floor(NOW / 1000);

// ── 1a · lib/freshProof ─────────────────────────────────────────────────────────────────────────────────────────────
ok("claims: nothing, garbage, two parts, a payload that isn't JSON or isn't an object — none",
  [undefined, null, 42, "", "a.b", "a.b.c", `x.${b64("not json")}.y`, `x.${b64([1, 2])}.y`, `x.${b64("7")}.y`].every((t) => FP.claimsOf(t) === null));
ok("claims: a token's payload, read (base64url, unpadded, any length)", FP.claimsOf(jwt({ sub: "u1", amr: [] }))?.sub === "u1" && FP.claimsOf(jwt({ s: "ab" }))?.s === "ab" && FP.claimsOf(jwt({ s: "abc" }))?.s === "abc");
ok("claims: words beyond ASCII come through whole (UTF-8)", FP.claimsOf(jwt({ name: "Zoë — café" }))?.name === "Zoë — café");
const at = (amr) => FP.provedAt({ amr });
ok("proved at: the latest proof of all — a code, a password, Apple, an authenticator", at([{ method: "password", timestamp: S - 900 }, { method: "otp", timestamp: S - 30 }, { method: "oauth", timestamp: S - 400 }]) === S - 30);
ok("proved at: an anonymous session proves nobody; a method or time that isn't one is passed over",
  at([{ method: "anonymous", timestamp: S }]) === null && at([{ timestamp: S }, { method: "", timestamp: S }, { method: "otp", timestamp: "now" }, { method: "otp", timestamp: Infinity }, null, 7]) === null
  && at([{ method: "anonymous", timestamp: S }, { method: "otp", timestamp: S - 100 }]) === S - 100);
ok("proved at: no amr, or amr as bare names with no times (RFC 8176's form) — none", FP.provedAt({}) === null && at(["otp", "pwd"]) === null && FP.provedAt(null) === null);
const within = (ts, method = "otp") => FP.provedWithin({ amr: [{ method, timestamp: ts }] }, NOW);
ok("proved within five minutes: thirty seconds ago yes; four minutes and fifty yes; five and a half no; an hour no",
  within(S - 30) && within(S - 290) && !within(S - 330) && !within(S - 3600) && FP.PROVED_FOR_S === 300);
ok("proved within: a time a little ahead (the auth service's clock) is taken; one from the future is no proof", within(S + 30) && !within(S + 120) && !within(S + 86400));
ok("proved within: a window asked for is the one used", FP.provedWithin({ amr: [{ method: "otp", timestamp: S - 250 }] }, NOW, 240) === false && FP.provedWithin({ amr: [{ method: "otp", timestamp: S - 250 }] }, NOW, 260) === true);

// ── 1b · the route ──────────────────────────────────────────────────────────────────────────────────────────────────
const U = "0c427000-0000-4000-8000-0000000000a1";
const APPLE_SUB = "001234.feedfacecafe.0427";
const calls = [];
const state = { identities: [{ provider: "email", id: U, identity_data: { sub: U } }], apple: null };
const tokens = new Map();   // bearer → the claims it carries; only these are "checked" by the stand-in auth service
const bearer = (claims) => { const t = jwt({ sub: U, role: "authenticated", ...claims }); tokens.set(t, true); return t; };
const chain = (rows) => {
  const c = { select: () => c, eq: () => c, not: () => c, in: () => c, limit: () => c, is: () => c,
    maybeSingle: async () => ({ data: null, error: null }), then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej) };
  return c;
};
const admin = {
  auth: {
    getUser: async (t) => (tokens.has(t) ? { data: { user: { id: U, email: "sam@example.test" } }, error: null } : { data: { user: null }, error: { message: "invalid JWT", status: 401 } }),
    admin: {
      getUserById: async (id) => { calls.push(["getUserById", id]); return { data: { user: { id, identities: state.identities } }, error: null }; },
      updateUserById: async (id) => { calls.push(["mark", id]); return { data: {}, error: null }; },
      deleteUser: async (id) => { calls.push(["delete", id]); return { data: {}, error: null }; },
    },
  },
  rpc: async (fn) => { calls.push(["rpc", fn]); return { data: fn === "account_erasure_blockers" || fn === "claim_erasure_followups" ? [] : null, error: null }; },
  from: (t) => { calls.push(["from", t]); return chain([]); },
  storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) }) },
};
const shims = {
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": { supabaseAdmin: admin },
  "@supabase/supabase-js": { createClient: () => admin },
  "@/lib/squareServer": { SQUARE_BASE: "https://square.example.test", squareHeaders: () => ({}), squareDeadline: () => undefined },
  "@/lib/apiRoute": { route: (_n, f) => f, isJsonObject: (v) => !!v && typeof v === "object" && !Array.isArray(v) },
  "@/lib/serverAlerts": { raiseAlert: async () => {}, raiseAlertOnce: async () => true },
  // Apple's word, stood in: the token named here is Apple's for APPLE_SUB, made `state.apple.iat`; any other is not.
  "@/lib/appleSignIn": {
    revoke: async () => true, siwaConfigured: () => true,
    verifyIdentityToken: async (t, n) => (state.apple && t === state.apple.idToken && n === state.apple.nonce ? { sub: state.apple.sub ?? APPLE_SUB, email: null, iat: state.apple.iat } : null),
  },
};
const R = routeLoader(shims)("app/api/account/erase/route.ts");
ok("compiled: the erase route, with the real lib/apiAuth, lib/freshProof and lib/accountErase", typeof R.POST === "function" && typeof R.GET === "function");
const send = async (method, token, body) => {
  calls.length = 0;
  const r = await R[method](new Request("https://app.example.test/api/account/erase", {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }));
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j, deleted: calls.some((c) => c[0] === "delete"), marked: calls.some((c) => c[0] === "mark"), asked: calls.filter((c) => c[0] === "rpc").map((c) => c[1]) };
};
const untouched = (r) => !r.deleted && !r.marked && r.asked.length === 0;

const fresh = await send("POST", bearer({ amr: [{ method: "otp", timestamp: S - 20 }] }), { confirm: true });
ok("a code entered twenty seconds ago: the account is deleted", fresh.status === 200 && fresh.j.ok === true && fresh.deleted && fresh.marked, fresh);
const stale = await send("POST", bearer({ amr: [{ method: "otp", timestamp: S - 600 }] }), { confirm: true });
ok("a session whose last proof is ten minutes old: 403, asked to prove it — nothing asked, marked or deleted",
  stale.status === 403 && stale.j.prove === true && stale.j.error === AE.ERASE_WORDS.prove && untouched(stale), stale);
const renewed = await send("POST", bearer({ amr: [{ method: "otp", timestamp: S - 7200 }], iat: S - 5 }), { confirm: true });
ok("a session renewed a moment ago, proved two hours ago: not proof (the renewal is not the person)", renewed.status === 403 && untouched(renewed), renewed);
for (const [why, claims] of [["no amr at all", {}], ["only an anonymous session", { amr: [{ method: "anonymous", timestamp: S }] }],
  ["a proof from the future", { amr: [{ method: "otp", timestamp: S + 3600 }] }], ["amr as bare names", { amr: ["otp"] }]]) {
  const r = await send("POST", bearer(claims), { confirm: true });
  ok(`${why}: 403, nothing touched`, r.status === 403 && r.j.prove === true && untouched(r), r);
}
const pwd = await send("POST", bearer({ amr: [{ method: "password", timestamp: S - 60 }] }), { confirm: true });
ok("a password typed a minute ago proves it too: deleted", pwd.status === 200 && pwd.deleted, pwd);

// A screen with no code step — the iPhone app built before R27 (its screens are its own until a new build is installed),
// or a web page loaded before R27 — shows the 403's words. They ask for a fresh sign-in, and a fresh sign-in is a new
// session whose one proof is that sign-in, just now: the same { confirm: true } it always sent deletes. No door is left
// open for it — nothing here asks which screen is calling.
ok("older screens: the 403's words ask for a fresh sign-in, within the five minutes the delete takes, and say nothing was deleted",
  /Sign out, sign back in/.test(AE.ERASE_WORDS.prove) && /within five minutes/.test(AE.ERASE_WORDS.prove) && FP.PROVED_FOR_S === 5 * 60
  && /Nothing was deleted\.$/.test(AE.ERASE_WORDS.prove));
for (const [how, method] of [["an emailed code", "otp"], ["Apple", "oauth"], ["an emailed link", "magiclink"], ["a password", "password"]]) {
  const again = await send("POST", bearer({ amr: [{ method, timestamp: S - 45 }] }), { confirm: true });
  ok(`older screens: signed in again with ${how} a moment ago, the same { confirm: true } deletes`, again.status === 200 && again.deleted, again);
}

// Apple's word, for an account that signs in with Apple — with a session that proves nothing recent.
const old = { amr: [{ method: "oauth", timestamp: S - 86400 }] };
state.identities = [{ provider: "email", id: U, identity_data: { sub: U } }, { provider: "apple", id: APPLE_SUB, identity_data: { sub: APPLE_SUB } }];
state.apple = { idToken: "apple.token.made-up", nonce: "n".repeat(64), iat: S - 15 };
const apple = await send("POST", bearer(old), { confirm: true, apple: { idToken: state.apple.idToken, nonce: state.apple.nonce } });
ok("Apple's sheet just now, for this account's Apple ID: deleted", apple.status === 200 && apple.deleted, apple);
state.apple = { ...state.apple, sub: "001234.someone.else" };
const notTheirs = await send("POST", bearer(old), { confirm: true, apple: { idToken: state.apple.idToken, nonce: state.apple.nonce } });
ok("Apple's word for another Apple ID: 403 — nothing marked or deleted", notTheirs.status === 403 && !notTheirs.deleted && !notTheirs.marked, notTheirs);
state.apple = { idToken: "apple.token.made-up", nonce: "n".repeat(64), iat: S - 900 };
const oldApple = await send("POST", bearer(old), { confirm: true, apple: { idToken: state.apple.idToken, nonce: state.apple.nonce } });
ok("Apple's word from fifteen minutes ago: 403 (not just now)", oldApple.status === 403 && !oldApple.deleted, oldApple);
state.apple = { idToken: "apple.token.made-up", nonce: "n".repeat(64), iat: null };
const noTime = await send("POST", bearer(old), { confirm: true, apple: { idToken: state.apple.idToken, nonce: state.apple.nonce } });
ok("Apple's word that doesn't say when: 403", noTime.status === 403 && !noTime.deleted, noTime);
state.apple = { idToken: "apple.token.made-up", nonce: "n".repeat(64), iat: S - 15 };
state.identities = [{ provider: "email", id: U, identity_data: { sub: U } }];
const noAppleId = await send("POST", bearer(old), { confirm: true, apple: { idToken: state.apple.idToken, nonce: state.apple.nonce } });
ok("Apple's word for an account with no Apple ID: 403", noAppleId.status === 403 && !noAppleId.deleted, noAppleId);
for (const [why, a] of [["a token Apple didn't make", { idToken: "forged", nonce: "n".repeat(64) }], ["another nonce", { idToken: "apple.token.made-up", nonce: "m".repeat(64) }],
  ["a list", ["apple.token.made-up"]], ["a word", "apple"], ["null", null]]) {
  const r = await send("POST", bearer(old), { confirm: true, apple: a });
  ok(`Apple: ${why} — 403, nothing deleted (and nothing threw)`, r.status === 403 && !r.deleted, r);
}

// What comes before the proof, and what needs none.
const unconfirmed = await send("POST", bearer({ amr: [{ method: "otp", timestamp: S - 20 }] }), { apple: null });
ok("no confirm: 400, as before — the proof isn't asked about", unconfirmed.status === 400 && untouched(unconfirmed), unconfirmed);
const nobody = await send("POST", null, { confirm: true });
ok("no session: 401", nobody.status === 401 && untouched(nobody), nobody);
const forged = await send("POST", jwt({ sub: U, amr: [{ method: "otp", timestamp: S }] }), { confirm: true });
ok("a token the auth service refuses, however fresh its amr says it is: 401 — the claims are read only after the check", forged.status === 401 && untouched(forged), forged);
const look = await send("GET", bearer({ amr: [{ method: "otp", timestamp: S - 7200 }] }));
ok("GET — what deleting would mean — needs no fresh proof", look.status === 200 && Array.isArray(look.j.blockers) && !look.deleted, look);

// lib/appleSignIn says when Apple made the token (R27): the real one, with a key made here.
{
  const AS = load("lib/appleSignIn.ts");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const KEYS = [{ ...publicKey.export({ format: "jwk" }), kid: "R27Kid", alg: "RS256", use: "sig" }];
  const nonce = randomBytes(32).toString("hex");
  const h = b64({ alg: "RS256", kid: "R27Kid" });
  const p = b64({ iss: "https://appleid.apple.com", aud: "com.gt3pb.app", exp: S + 600, iat: S - 7, sub: APPLE_SUB, nonce: createHash("sha256").update(nonce).digest("hex") });
  const t = `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url")}`;
  const got = await AS.verifyIdentityToken(t, nonce, { keys: KEYS, now: NOW });
  ok("lib/appleSignIn: Apple's token, checked, says when Apple made it (iat) beside whose it is", got?.sub === APPLE_SUB && got?.iat === S - 7, got);
}

// ── 1c · the screen ─────────────────────────────────────────────────────────────────────────────────────────────────
// Walked whole in the iPhone app's smoke (scripts/smoke.native.mjs §6, §6f: the code sent, typed, checked, then the
// delete). Here, what that walk can't see.
{
  const { readFileSync } = await import("node:fs");
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const del = code(readFileSync(new URL("../components/DeleteAccount.tsx", import.meta.url), "utf8"));
  ok("screen: the code goes to the account's own email, never making an account, and its link is this device's own ask",
    /markSigninAsked\(\);\s*const \{ error \} = await supabase\.auth\.signInWithOtp\(\{ email, options: \{ shouldCreateUser: false \} \}\)/.test(del));
  ok("screen: the code is checked as an email code, and only a session that came back from it goes on to the delete",
    /await supabase\.auth\.verifyOtp\(\{ email, token, type: "email" \}\)/.test(del) && /if \(error \|\| !data\.session\) \{/.test(del)
    && del.indexOf("takeSigninAsked();") < del.indexOf("await erase(membership, office, undefined, true);"));
  ok("screen: the server's \"prove it\" brings the code's step back with a new code — never a delete without one",
    /if \(r\.status === 403 && j\.prove\) \{[\s\S]*?setPhase\(\{ at: "prove", membership, office \}\);[\s\S]*?await sendCode\(\)/.test(del));
  const p403 = del.indexOf("if (r.status === 403 && j.prove) {"), end403 = del.indexOf("\n      }\n", p403);
  ok("screen: it answers \"prove it\" in its own words, before any failure is shown — the server's are an older screen's (a fresh sign-in)",
    p403 > 0 && end403 > p403 && !del.slice(p403, end403).includes("j.error")
    && p403 < del.indexOf("if (!r.ok) { haptic(\"error\"); setPhase({ at: \"failed\", message: j.error || \"We couldn't delete your account"));
  ok("screen: Apple's sheet is offered only in the iPhone app, to an account with an Apple ID — and first when its email is Apple's relay",
    /const appleHere = !!user\?\.identities\?\.some\(\(i\) => i\.provider === "apple"\) && isNativeApp\(\) && nativePlatform\(\) === "ios";/.test(del)
    && /if \(appleHere && \(relay \|\| !email\)\) \{ await withApple\(membership, office, false\); return; \}/.test(del)
    && /await import\("@\/lib\/appleAuth"\)/.test(del) && !/^import .*appleAuth/m.test(del));
  ok("screen: one tap sends one code (a second tap while the first is starting does nothing), and a new one waits thirty seconds",
    /if \(going\.current\) return;\s*going\.current = true;/.test(del) && /const RESEND_S = 30;/.test(del) && /disabled=\{busy \|\| sending \|\| cooldown > 0\}/.test(del));
  ok("screen: the code field is a one-time code (iPhone offers it from Mail), eight digits, described by the words above it",
    /id="del-code"[\s\S]*?autoComplete="one-time-code"[\s\S]*?aria-describedby="del-code-for"/.test(del) && /const CODE_LEN = 8;/.test(del)
    && /<Said as="p" className="dp-hint" id="del-code-for" quietFirst>/.test(del));
}

console.log(`\nR27 — PROVED JUST NOW: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
