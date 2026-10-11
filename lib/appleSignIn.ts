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
