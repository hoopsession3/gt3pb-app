import { es256Jwt } from "./appleKey";

// SIGN IN WITH APPLE, THE SERVER'S HALF (2026-10-11, Ryan: "you have permission to do anything").
//
// The iPhone app signs in with Apple's own sheet (native/ios/GT3Device.swift signInWithApple) and hands Supabase the
// identity token (components/AppleSignIn → lib/appleAuth → signInWithIdToken); Supabase checks it against the app's bundle id
// (the Apple provider, Client IDs: com.gt3pb.app). That much needs nothing here. What does: Apple expects an app that
// lets people delete their account to revoke the tokens Sign in with Apple gave it when they do (TN3194, "Handling
// account deletions and revoking tokens for Sign in with Apple"). Revoking takes a refresh token, and a refresh token
// is had only by trading the one-time authorization code the sheet returns, within five minutes, for one:
//
//   · exchangeCode — the code, traded at Apple's /auth/token for the refresh token (and the id token that names whose
//                    it is, so app/api/auth/apple can hold it to the signed-in person's own Apple identity);
//   · revoke       — the refresh token, revoked at /auth/revoke (app/api/account/erase, before the account goes).
//
// Both are signed with a client secret: an ES256 JWT made from the Sign in with Apple key (APPLE_SIWA_KEY_ID, its .p8 in
// APPLE_SIWA_PRIVATE_KEY, pasted into Vercel by Ryan) for the team (APPLE_TEAM_ID, or the Maps key's APPLE_MAPS_TEAM_ID —
// one team). With the key unset nothing is traded or revoked, and deleting an account says how to stop using the Apple
// ID with GT3 from the iPhone's Settings instead (TN3194's own fallback).
const APPLE = "https://appleid.apple.com";
export const APPLE_CLIENT_ID = "com.gt3pb.app";

const teamId = () => process.env.APPLE_TEAM_ID || process.env.APPLE_MAPS_TEAM_ID || "";

export function siwaConfigured(): boolean {
  return Boolean(process.env.APPLE_SIWA_KEY_ID && process.env.APPLE_SIWA_PRIVATE_KEY && teamId());
}

/** Apple's client secret: five minutes is plenty for the one call it is made for. */
function clientSecret(): string {
  const now = Math.floor(Date.now() / 1000);
  return es256Jwt({ kid: process.env.APPLE_SIWA_KEY_ID }, { iss: teamId(), iat: now, exp: now + 300, aud: APPLE, sub: APPLE_CLIENT_ID }, process.env.APPLE_SIWA_PRIVATE_KEY ?? "");
}

/** An authorization code as Apple writes them: letters, digits, dots, dashes and underscores. */
export function isAppleCode(code: unknown): code is string {
  return typeof code === "string" && /^[A-Za-z0-9._-]{16,600}$/.test(code);
}

/** The id token's claims. It came straight from Apple over TLS in answer to our own signed request, so it is read,
 *  not re-verified; `sub` is the Apple user it names. */
function claimsOf(idToken: string): { sub?: string } {
  try { return JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string }; }
  catch { return {}; }
}

/** The one-time code, traded for the refresh token revocation needs, and whose Apple ID it is. */
export async function exchangeCode(code: string): Promise<{ refreshToken: string; appleUser: string } | null> {
  const body = new URLSearchParams({ client_id: APPLE_CLIENT_ID, client_secret: clientSecret(), code, grant_type: "authorization_code" });
  const r = await fetch(`${APPLE}/auth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string };
  const appleUser = j.id_token ? claimsOf(j.id_token).sub : undefined;
  return j.refresh_token && appleUser ? { refreshToken: j.refresh_token, appleUser } : null;
}

/** Revoke what Sign in with Apple gave GT3 for this person. True when Apple says it is done. */
export async function revoke(refreshToken: string): Promise<boolean> {
  const body = new URLSearchParams({ client_id: APPLE_CLIENT_ID, client_secret: clientSecret(), token: refreshToken, token_type_hint: "refresh_token" });
  const r = await fetch(`${APPLE}/auth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10000) });
  return r.ok;
}

// THE IDENTITY TOKEN, CHECKED HERE (2026-10-15, A3 of the account audit). Joining an Apple ID to a member's account
// deletes the empty account that Apple ID made (app/api/account/link-apple, lib/appleLink) — so before anything is deleted,
// the token that says "this Apple ID is mine" is checked the way Supabase will check it: Apple's signature (its published
// keys, RS256), Apple as the issuer, this app as the audience, not expired, and the nonce the phone asked Apple with (the
// SHA-256 of the page's own, in hex — native/ios/GT3Device.swift). Supabase checks it again when it links.
export type AppleJwk = { kid: string; kty: string; alg?: string; n: string; e: string; use?: string };
let keyCache: { keys: AppleJwk[]; at: number } | null = null;

async function appleKeys(): Promise<AppleJwk[]> {
  if (keyCache && Date.now() - keyCache.at < 60 * 60 * 1000) return keyCache.keys;
  const r = await fetch(`${APPLE}/auth/keys`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) return keyCache?.keys ?? [];
  const j = (await r.json().catch(() => ({}))) as { keys?: AppleJwk[] };
  keyCache = { keys: Array.isArray(j.keys) ? j.keys : [], at: Date.now() };
  return keyCache.keys;
}

/** Apple's `sub` for the person, when the identity token is Apple's, for this app, current, and made for this nonce;
 *  null otherwise. `keys` and `now` stand in for Apple's published keys and the clock in tests. */
export async function verifyIdentityToken(token: unknown, rawNonce: unknown,
  opts: { keys?: AppleJwk[]; now?: number } = {}): Promise<{ sub: string; email: string | null } | null> {
  if (typeof token !== "string" || typeof rawNonce !== "string" || !rawNonce || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header: { alg?: string; kid?: string }, claims: { iss?: string; aud?: string | string[]; exp?: number; iat?: number; sub?: string; nonce?: string; email?: string };
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  const jwk = (opts.keys ?? (await appleKeys())).find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) return null;
  const { createPublicKey, verify, createHash } = await import("node:crypto");
  let signed = false;
  try {
    const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
    signed = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  } catch { return null; }
  if (!signed) return null;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const nonce = createHash("sha256").update(rawNonce, "utf8").digest("hex");
  if (claims.iss !== APPLE || !aud.includes(APPLE_CLIENT_ID)) return null;
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.iat === "number" && claims.iat > now + 300) return null;
  if (claims.nonce !== nonce || typeof claims.sub !== "string" || !claims.sub) return null;
  return { sub: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}
