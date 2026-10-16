import { supabase } from "./supabase";

// SIGNING OUT LETS GO OF THIS DEVICE (2026-10-11, 0366 release_push_device). A browser someone signed out of kept
// getting their "your order's ready", for whoever used it next. It is let go of first, while they are still signed
// in (the database lets only its own person do it); it stays subscribed — a guest's "truck is live" ping, nothing of
// theirs. Never holds a sign-out up for more than a second and a half. Its own file, loaded by the sign-out buttons
// (components/AccountSheet, the 3MPIRE page) and nothing else: the auth provider every route carries stays as it was.
//
// AND WHEN THE DATABASE CANNOT LET GO, THE BROWSER DOES (R12b — the 10/10 audit, F4). The release's answer was dropped:
// refused, failed or too slow, the device stayed theirs and the sign-out went on as if it had not. Now a release that
// did not happen unsubscribes this browser instead — an endpoint that is gone takes no one's pushes, which is what a
// sign-out promises. The guest's live ping is asked for again, if wanted.
export async function signOutHere(signOut: () => Promise<void>): Promise<void> {
  const released = await Promise.race([releaseThisDevice(), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]);
  if (!released) await Promise.race([forgetThisDevice(), new Promise((r) => setTimeout(r, 1000))]);
  await signOut();
}

async function subscription(): Promise<PushSubscription | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  return (await (await navigator.serviceWorker.getRegistration())?.pushManager?.getSubscription()) ?? null;
}

/** True when this device holds nothing of theirs any more: released, or never subscribed. */
async function releaseThisDevice(): Promise<boolean> {
  try {
    const sub = await subscription();
    if (!sub?.endpoint) return true;
    if (!supabase) return false;
    const { error } = await supabase.rpc("release_push_device", { p_endpoint: sub.endpoint });
    return !error;
  } catch { return false; /* never hold up a sign-out */ }
}

async function forgetThisDevice(): Promise<void> {
  try { await (await subscription())?.unsubscribe(); } catch { /* the sign-out goes on */ }
}
