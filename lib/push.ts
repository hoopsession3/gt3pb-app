import { supabase } from "./supabase";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Subscribe this device to background web push and store the subscription so the
// Supabase Edge Function can reach it (admins → new orders/bookings; members → their order).
export async function subscribePush(userId: string | null, isAdmin: boolean) {
  try {
    if (!VAPID_PUBLIC || !supabase) return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
    }
    const j = sub.toJSON();
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return;
    await supabase.from("push_subscriptions").upsert(
      { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: userId, is_admin: isAdmin },
      { onConflict: "endpoint" }
    );
    // Keep ONE active device per user. Reinstalls / different browsers mint new
    // endpoints, and stale ones otherwise pile up so every order update fans out to
    // all of them — that's the duplicate-notification spam. This collapses to current.
    if (userId) {
      await supabase.from("push_subscriptions").delete().eq("user_id", userId).neq("endpoint", j.endpoint);
    }
  } catch { /* push optional; never block the UI */ }
}
