import type { SupabaseClient } from "@supabase/supabase-js";
import { apiUrl } from "./native";
import { nativeDevice, outcomeOf, type AppleCredential, type AppleState, type Outcome } from "./deviceActions";

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
  return {};
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
