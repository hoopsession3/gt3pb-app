import { supabase } from "./supabase";

// SIGNING OUT LETS GO OF THIS DEVICE (2026-10-11, 0366 release_push_device). A browser someone signed out of kept
// getting their "your order's ready", for whoever used it next. It is let go of first, while they are still signed
// in (the database lets only its own person do it); it stays subscribed — a guest's "truck is live" ping, nothing of
// theirs. Never holds a sign-out up for more than a second and a half. Its own file, loaded by the sign-out buttons
// (components/AccountSheet, the 3MPIRE page) and nothing else: the auth provider every route carries stays as it was.
export async function signOutHere(signOut: () => Promise<void>): Promise<void> {
  await Promise.race([releaseThisDevice(), new Promise((r) => setTimeout(r, 1500))]);
  await signOut();
}

async function releaseThisDevice(): Promise<void> {
  try {
    if (!supabase || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager?.getSubscription();
    if (sub?.endpoint) await supabase.rpc("release_push_device", { p_endpoint: sub.endpoint });
  } catch { /* never hold up a sign-out */ }
}
