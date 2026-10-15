import type { SupabaseClient } from "@supabase/supabase-js";
import { apiUrl } from "./native";
import { authedFetch } from "./authedFetch";
import { nativeDevice, outcomeOf, type AppleCredential, type AppleState, type Outcome } from "./deviceActions";

/** Said when a sign-in with Apple made a new account (appleSignInFlow, below); components/AppleLink listens — and, loaded
 *  after it was said (it is loaded lazily), takes it when it mounts: the question waits here, in memory, for one take. */
export const FRESH_APPLE = "gt3-apple-fresh";
export type FreshApple = { idToken: string; nonce: string; at: number };
let freshApple: FreshApple | null = null;
/** The first Apple sign-in waiting to be asked about, once — gone after eight minutes, as Apple's token nearly is. */
export function takeFreshApple(): FreshApple | null {
  const f = freshApple;
  freshApple = null;
  return f && Date.now() - f.at < 8 * 60_000 ? f : null;
}

// SIGN IN WITH APPLE, THE PAGE'S HALF (2026-10-11, the iPhone app). Only the app's own code reads this — the button
// (components/AppleSignIn, loaded only in the app) and the bridge (components/NativeBridge, built only into the app) —
// so the auth provider every route carries has none of it.
//
// Apple's own sheet (GT3Device signInWithApple) with a fresh nonce each try: the phone asks Apple with its SHA-256,
// Apple signs that into the identity token, and Supabase checks the token against this nonce and the app's bundle id
// (the Apple provider, Client IDs: com.gt3pb.app). Then two things Apple gives only once, kept while they can be:
//   · the name — the greeting's, when the account's name is still the one made from the email (handle_new_user, 0280:
//     a relay address made "X7k2pq9abc"); a name someone chose is left as it is;
//   · the authorization code — traded by the server for the token deleting the account revokes (app/api/auth/apple).
//     The sign-in never waits on it.
export async function appleSignInFlow(supabase: SupabaseClient, reloadProfile: (uid: string) => Promise<void>): Promise<{ error?: string; cancelled?: boolean }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const { outcome, credential } = await appleSignIn(nonce);
  if (outcome === "cancelled") return { cancelled: true };
  if (outcome !== "done" || !credential) {
    return { error: outcome === "unsupported" ? "Sign in with Apple isn't available here — use your email." : "Sign in with Apple didn't finish. Try again, or use your email." };
  }
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken, nonce });
  if (error || !data.session) return { error: error?.message ?? "Sign in with Apple didn't finish. Try again, or use your email." };
  const session = data.session;
  markAppleSession(session.user.id);
  const given = credential.givenName?.trim();
  if (given) {
    const { data: prof } = await supabase.from("profiles").select("display_name").eq("id", session.user.id).maybeSingle();
    // Postgres initcap, as handle_new_user wrote it: each run of letters and digits capitalized, the rest lower.
    const madeUp = (session.user.email ?? "").split("@")[0].toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
    const current = ((prof?.display_name as string | null) ?? "").trim();
    if (!current || current === madeUp) {
      await supabase.from("profiles").update({ display_name: given.slice(0, 60) }).eq("id", session.user.id);
      await reloadProfile(session.user.id);
    }
  }
  if (credential.authorizationCode) {
    void fetch(apiUrl("/api/auth/apple"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ code: credential.authorizationCode }),
    }).catch(() => undefined);
  }
  // A FIRST APPLE SIGN-IN (2026-10-15, A3 of the account audit): an account this sign-in just made, with nothing but the
  // Apple identity on it. Hide My Email gives a relay address that matches nobody's, so this may be a member who joined
  // with their email — components/AppleLink asks, right now, and joins the two if so. The identity token goes with the
  // question, in memory only (never stored): joining needs Apple's word that the Apple ID is theirs.
  const made = Date.parse(session.user.created_at ?? "");
  const appleOnly = (session.user.identities ?? []).every((i) => i.provider === "apple");
  if (appleOnly && Number.isFinite(made) && Date.now() - made < 2 * 60_000 && typeof window !== "undefined") {
    freshApple = { idToken: credential.identityToken, nonce, at: Date.now() };
    window.dispatchEvent(new Event(FRESH_APPLE));
  }
  return {};
}

/** Apple's word that an Apple ID is the person's: its sheet, a fresh nonce, the identity token — for joining that Apple ID
 *  to the account they are signed in to (lib/appleLink). Nothing signs in. */
export async function appleIdentity(): Promise<{ idToken: string; nonce: string } | { cancelled: true } | { error: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const { outcome, credential } = await appleSignIn(nonce);
  if (outcome === "cancelled") return { cancelled: true };
  if (outcome !== "done" || !credential) return { error: outcome === "unsupported" ? "Sign in with Apple isn't available here." : "Apple didn't finish. Try again." };
  return { idToken: credential.identityToken, nonce };
}

/** Join the Apple ID to the account signed in now (app/api/account/link-apple), then read the session again so it knows
 *  its new identity. */
export async function linkAppleHere(supabase: SupabaseClient, apple: { idToken: string; nonce: string }): Promise<{ ok: true; joined: boolean } | { error: string }> {
  let r: Response;
  try {
    r = await authedFetch("/api/account/link-apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: apple.idToken, nonce: apple.nonce }),
    });
  } catch {
    return { error: "You're offline. Connect, then try again." };
  }
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; joined?: boolean; error?: string };
  if (!r.ok || !j.ok) return { error: j.error || "Sign in with Apple couldn't be linked just now. Try again in a minute." };
  await supabase.auth.refreshSession().catch(() => undefined);
  return { ok: true, joined: !!j.joined };
}

/** Apple's sheet (GT3Device.signInWithApple), in the iPhone app only. `nonce` is a fresh one the caller keeps for
 *  Supabase; the phone asks Apple with its SHA-256, which Apple signs into the identity token. */
export async function appleSignIn(nonce: string): Promise<{ outcome: Outcome; credential?: AppleCredential }> {
  const device = nativeDevice();
  if (typeof window === "undefined" || !device) return { outcome: "unsupported" };
  try {
    const credential = await device.signInWithApple({ nonce });
    return credential?.identityToken ? { outcome: "done", credential } : { outcome: "failed" };
  } catch (e) {
    return { outcome: outcomeOf(e) };
  }
}

// THE SESSION APPLE GAVE, ON THIS PHONE (2026-10-11, the review). Apple's "revoked" is about Sign in with Apple, not
// about the account: Supabase links an Apple identity to the email account with the same address, so someone who
// turned Sign in with Apple off for GT3 in Settings and then signed in with their email code still has an Apple
// identity — and was signed out each time they came back to the app. Only a session this phone got from Apple ends
// when Apple says so; the mark is that session's user, and it goes with it (components/NativeBridge clears it when
// nobody, or somebody else, is signed in).
const APPLE_SESSION = "gt3_apple_session";
export function markAppleSession(uid: string | null): void {
  try { if (uid) localStorage.setItem(APPLE_SESSION, uid); else localStorage.removeItem(APPLE_SESSION); } catch { /* storage may be blocked */ }
}
/** The user whose session on this phone came from Sign in with Apple, if one did. */
export function appleSession(): string | null {
  try { return localStorage.getItem(APPLE_SESSION); } catch { return null; }
}

/** Whether this Apple user still lets GT3 in — null where nothing can say (the web, or the phone did not answer). */
export async function appleCredentialState(user: string): Promise<AppleState | null> {
  const device = nativeDevice();
  if (typeof window === "undefined" || !device) return null;
  try {
    return (await device.appleCredentialState({ user })).state ?? null;
  } catch {
    return null;
  }
}
