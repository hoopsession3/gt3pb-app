// JOINING AN APPLE ID TO THE ACCOUNT IT BELONGS TO — every branch of lib/appleLink, and the identity-token check in
// lib/appleSignIn, against stand-ins (A3 of the account audit).
//
// The finding, as a sentence: Sign in with Apple can hide the email behind a relay address that matches nobody's, so a
// member who joined with their email and then tapped Continue with Apple got a second, empty account, and nothing linked
// the two. Now the member proves both — the email account by its code (they are signed in to it), the Apple ID by a fresh
// identity token — and the empty account is folded in. What is real is compiled from lib/: appleLink (the decisions) and
// appleSignIn.verifyIdentityToken (Apple's signature, issuer, audience, expiry and nonce, against a key made here and
// published as Apple publishes its own). What is stood in for: Supabase's admin API and its linking, and 0403's two
// questions — which scripts/db.applelink.test.mjs runs for real. Nothing here talks to Apple or Supabase.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateKeyPairSync, createSign, createHash, randomBytes } from "node:crypto";
import { libLoader } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const AS = load("lib/appleSignIn.ts"), AL = load("lib/appleLink.ts");
ok("compiled: lib/appleSignIn, lib/appleLink", typeof AS.verifyIdentityToken === "function" && typeof AL.linkApple === "function");

// ── 1 · the identity token: Apple's, for this app, current, for this nonce ─────────────────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "AppleKid1", alg: "RS256", use: "sig" };
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEYS = [jwk];
const NOW = Date.parse("2026-10-15T15:00:00Z");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const NONCE = randomBytes(32).toString("hex");
const SUB = "001234.0a1b2c3d4e5f.1015";
function token(claims = {}, { kid = "AppleKid1", alg = "RS256", key = privateKey } = {}) {
  const h = b64({ alg, kid }), p = b64({ iss: "https://appleid.apple.com", aud: "com.gt3pb.app", exp: NOW / 1000 + 600, iat: NOW / 1000 - 5,
    sub: SUB, nonce: sha(NONCE), email: "x7k2pq9abc@privaterelay.appleid.com", ...claims });
  const sig = createSign("RSA-SHA256").update(`${h}.${p}`).sign(key).toString("base64url");
  return `${h}.${p}.${sig}`;
}
const check = (t, n = NONCE, now = NOW) => AS.verifyIdentityToken(t, n, { keys: KEYS, now });
ok("token: Apple's, for this app, current, made for this nonce — its sub and email", (await check(token()))?.sub === SUB && (await check(token()))?.email === "x7k2pq9abc@privaterelay.appleid.com");
ok("token: another nonce — refused (the phone asked Apple with the SHA-256 of the page's own)", (await check(token(), randomBytes(32).toString("hex"))) === null);
ok("token: the raw nonce itself in the token, not its hash — refused", (await check(token({ nonce: NONCE }))) === null);
ok("token: expired — refused", (await check(token({ exp: NOW / 1000 - 1 }))) === null);
ok("token: issued in the future — refused", (await check(token({ iat: NOW / 1000 + 3600 }))) === null);
ok("token: for another app — refused; this app among several audiences — taken", (await check(token({ aud: "com.example.other" }))) === null && (await check(token({ aud: ["com.example.other", "com.gt3pb.app"] })))?.sub === SUB);
ok("token: from someone who isn't Apple — refused", (await check(token({ iss: "https://evil.example" }))) === null);
ok("token: signed with another key under Apple's key id — refused", (await check(token({}, { key: other.privateKey }))) === null);
const t0 = token(); const [th, , ts] = t0.split(".");
ok("token: its claims changed after signing (a different sub) — refused", (await check(`${th}.${b64({ ...JSON.parse(Buffer.from(t0.split(".")[1], "base64url")), sub: "001234.someone.else" })}.${ts}`)) === null);
ok("token: a key id Apple doesn't publish — refused", (await check(token({}, { kid: "NotApples" }))) === null);
ok("token: not RS256 (alg none, HS256) — refused", (await check(`${b64({ alg: "none", kid: "AppleKid1" })}.${t0.split(".")[1]}.`)) === null
  && (await check(token({}, { alg: "HS256" }))) === null);
ok("token: nothing, garbage, no nonce — refused", (await check("")) === null && (await check("a.b")) === null && (await check("not.a.token")) === null
  && (await AS.verifyIdentityToken(token(), "", { keys: KEYS, now: NOW })) === null && (await AS.verifyIdentityToken(null, NONCE, { keys: KEYS, now: NOW })) === null);

// ── 2 · the join, every branch ──────────────────────────────────────────────────────────────────────────────────────
const CASEY = "u-casey", APPLE_ACCT = "u-apple-empty", RORY = "u-rory";
function world(over = {}) {
  const calls = [];
  const s = {
    tokenOk: true, sub: SUB,
    identities: { [CASEY]: [{ provider: "email", sub: CASEY }], [APPLE_ACCT]: [{ provider: "apple", sub: SUB }], [RORY]: [{ provider: "email", sub: RORY }, { provider: "apple", sub: "001234.rory" }] },
    owner: APPLE_ACCT,            // who the Apple ID opens now
    unused: true, deleteOk: true, tokens: { [APPLE_ACCT]: "r.apple" },
    links: [],                    // what each link call answers, in order (default: by state)
    manual: true,
    ...over,
  };
  const steps = {
    async verify(t, n) { calls.push(["verify"]); return s.tokenOk && t === "TOKEN" && n === NONCE ? { sub: s.sub } : null; },
    async identitiesOf(id) { calls.push(["identities", id]); return s.identities[id] ?? null; },
    async link(jwt) {
      calls.push(["link", jwt]);
      if (s.links.length) return s.links.shift();
      if (!s.manual) return { ok: false, code: "manual_linking_disabled", message: "Manual linking is disabled" };
      if (s.owner && s.owner !== "caller") return { ok: false, code: "identity_already_exists", message: "Identity is already linked to another user" };
      s.owner = "caller"; return { ok: true };
    },
    async accountForApple(sub) { calls.push(["accountForApple", sub]); return s.owner === "caller" ? CASEY : s.owner; },
    async unused(id) { calls.push(["unused", id]); return s.unused; },
    async moveAppleToken(from, to) {
      calls.push(["move", from, to]);
      if (s.tokens[to] || !s.tokens[from]) return false;
      s.tokens[to] = s.tokens[from]; delete s.tokens[from]; return true;
    },
    async deleteAccount(id) { calls.push(["delete", id]); if (!s.deleteOk) return { ok: false, error: "Database error deleting user" }; delete s.identities[id]; if (s.owner === id) s.owner = null; return { ok: true }; },
  };
  return { s, steps, calls, names: () => calls.map((c) => c[0]) };
}
const link = (w, caller = CASEY) => AL.linkApple({ id: caller, jwt: `jwt-${caller}` }, "TOKEN", NONCE, w.steps);

{
  const w = world({ tokenOk: false });
  const a = await link(w);
  ok("join: a token that isn't Apple's — 400, and nothing else asked", a.status === 400 && a.body.code === "token" && w.names().join() === "verify", { a, calls: w.names() });
}
{
  const w = world({ owner: null });
  const a = await link(w);
  ok("join: an Apple ID nobody has used — linked first time, nothing deleted", a.status === 200 && a.body.ok && a.body.joined === false && !w.names().includes("delete") && w.calls.find((c) => c[0] === "link")?.[1] === "jwt-u-casey", { a, calls: w.names() });
}
{
  const w = world();
  const a = await link(w);
  ok("join: the Apple ID made an empty account — its token moves across, it is deleted, and the link is made: joined",
    a.status === 200 && a.body.joined === true && w.names().join() === "verify,identities,link,accountForApple,identities,unused,move,delete,link"
    && w.s.tokens[CASEY] === "r.apple" && !w.s.tokens[APPLE_ACCT] && !w.s.identities[APPLE_ACCT], { a, calls: w.names() });
  ok("join: the token moved before the delete — so deleting the empty account queues no revoke (0404)", w.names().indexOf("move") < w.names().indexOf("delete"));
}
{
  const w = world({ unused: false });
  const a = await link(w);
  ok("join: the Apple ID's account has orders or rewards — 409, in words, and nothing moved or deleted",
    a.status === 409 && a.body.code === "used" && /Ask us at the truck/.test(a.body.error) && !w.names().includes("move") && !w.names().includes("delete"), { a, calls: w.names() });
}
{
  const w = world();
  w.s.identities[APPLE_ACCT] = [{ provider: "apple", sub: SUB }, { provider: "email", sub: APPLE_ACCT }];
  const a = await link(w);
  ok("join: the Apple ID's account also signs in with an email — not folded in (409), nothing deleted", a.status === 409 && a.body.code === "linked_elsewhere" && !w.names().includes("delete"), { a, calls: w.names() });
}
{
  const w = world({ manual: false });
  const a = await link(w);
  ok("join: manual linking switched off in Supabase — 503, said plainly, and nothing deleted", a.status === 503 && a.body.code === "off" && !w.names().includes("delete") && !w.names().includes("move"), { a, calls: w.names() });
}
{
  const w = world({ links: [{ ok: false, code: "unexpected_failure", message: "x" }] });
  const a = await link(w);
  ok("join: Supabase fails some other way — 502, try again, nothing deleted", a.status === 502 && a.body.code === "busy" && !w.names().includes("delete"), { a, calls: w.names() });
}
{
  const w = world({ deleteOk: false });
  const a = await link(w);
  ok("join: the empty account can't be deleted — 502, and its Apple token goes back where it was",
    a.status === 502 && a.body.code === "busy" && w.s.tokens[APPLE_ACCT] === "r.apple" && !w.s.tokens[CASEY] && w.names().filter((n) => n === "link").length === 1, { a, calls: w.names(), tokens: w.s.tokens });
}
{
  const w = world({ tokens: { [APPLE_ACCT]: "r.apple", [CASEY]: "r.casey.own" }, deleteOk: false });
  const a = await link(w);
  ok("join: the member already had a token of their own — nothing moved, so nothing is moved back over theirs",
    a.status === 502 && w.s.tokens[CASEY] === "r.casey.own" && w.s.tokens[APPLE_ACCT] === "r.apple" && w.calls.filter((c) => c[0] === "move").length === 1, { calls: w.calls, tokens: w.s.tokens });
}
{
  const w = world();
  w.s.links = [{ ok: false, code: "identity_already_exists", message: "" }, { ok: false, code: "unexpected_failure", message: "" }];
  const a = await link(w);
  ok("join: deleted, but the second link fails — 502 saying how to finish (Settings & privacy), the empty account gone",
    a.status === 502 && a.body.code === "finish" && /Settings & privacy/.test(a.body.error) && !w.s.identities[APPLE_ACCT], { a, calls: w.names() });
  const again = await link(w);
  ok("join: and finishing from Settings links it, nothing in the way now", again.status === 200 && again.body.ok, again);
}
{
  const w = world();
  w.s.identities[CASEY] = [{ provider: "email", sub: CASEY }, { provider: "apple", sub: SUB }];
  const a = await link(w);
  ok("join: already this account's Apple ID — 200, already, nothing asked of Supabase", a.status === 200 && a.body.already === true && !w.names().includes("link"), { a, calls: w.names() });
}
{
  const w = world();
  const a = await link(w, RORY);
  ok("join: an account with a different Apple ID — 409, said plainly", a.status === 409 && a.body.code === "other_apple" && !w.names().includes("link"), { a, calls: w.names() });
}
{
  const w = world();
  w.s.identities["u-phone"] = [{ provider: "phone", sub: "u-phone" }];
  const a = await link(w, "u-phone");
  ok("join: an account that doesn't sign in with an email — not this way: it has no code to prove (409)", a.status === 409 && a.body.code === "not_email" && !w.names().includes("link"), a);
  w.s.identities["u-apple-only"] = [{ provider: "apple", sub: "001234.someone" }];
  const b = await link(w, "u-apple-only");
  ok("join: an Apple-only account can't take a second Apple ID (409)", b.status === 409 && b.body.code === "other_apple", b);
  const c = await link(w, "u-unknown");
  ok("join: an account whose identities can't be read — 503, nothing asked of Supabase", c.status === 503 && c.body.code === "busy", c);
}
{
  const w = world();
  w.s.identities["u-new"] = [{ provider: "email", sub: "u-new" }];
  w.steps.accountForApple = async () => null;   // the empty account went between the two asks
  const a = await link(w, "u-new");
  ok("join: the account went between the two asks — 502, nothing deleted (asking again links it)", a.status === 502 && !w.names().includes("delete"), a);
}

// ── 3 · the route hands lib/appleLink the real steps ─────────────────────────────────────────────────────────────────
const rt = readFileSync(join(ROOT, "app/api/account/link-apple/route.ts"), "utf8");
ok("route: signed in, the token's shape checked, rate limited per person, and lib/appleLink deciding",
  /const user = await userFromRequest\(req\);/.test(rt) && /p_bucket: `apple-link:\$\{user\.id\}`/.test(rt) && /\/\^\[0-9a-f\]\{32,128\}\$\/\.test\(body\.nonce\)/.test(rt)
  && /const answer = await linkApple\(\{ id: user\.id, jwt \}, idToken, nonce, steps\);/.test(rt) && /export const POST = route\("account\/link-apple", post\);/.test(rt));
ok("route: Supabase links it with the member's own session (manual linking), and the token is checked here first",
  /\/auth\/v1\/token\?grant_type=id_token/.test(rt) && /link_identity: true/.test(rt) && /Authorization: `Bearer \$\{callerJwt\}`/.test(rt)
  && /verify: \(token, raw\) => verifyIdentityToken\(token, raw\)/.test(rt));
ok("route: 0403's two questions, and the token moved only to an account without one",
  /admin\.rpc\("account_for_apple", \{ p_sub: sub \}\)/.test(rt) && /admin\.rpc\("account_unused", \{ p_user: id \}\)/.test(rt)
  && /if \(theirs\) return false;/.test(rt) && /admin\.auth\.admin\.deleteUser\(id\)/.test(rt));

console.log(`\nAPPLE LINK: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
