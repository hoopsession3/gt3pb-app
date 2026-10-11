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

// Subscribe this device to background web push and keep its subscription where the push function reaches it
// (the crew's devices → new orders; everyone's → their own order; anyone's → "the truck is live").
//
// THE DATABASE KEEPS IT (2026-10-11, 0366 keep_push_device). This page used to write the row itself — an upsert on
// the endpoint, then a delete of the person's other devices — and never read the answer. A guest's write could not
// succeed (the row is nobody's, and nobody may read it), so "Ping me when the truck goes live" said on and kept
// nothing; and a browser someone else had signed in on refused the next person, whose own devices the delete then
// took away. The database writes the device for whoever is signed in now — or nobody — and keeps one browser each.
//   crew        asks for the pass's alerts (new orders) on this device; never takes them away (0366), and only the
//               crew can have them (0365);
//   wantsLive   (0257) in or out of the public "truck is live" ping; left as it was when not given.
// The answer is whether the device is kept: a screen that says "on" says it only then.
export async function subscribePush(crew: boolean, opts?: { wantsLive?: boolean }): Promise<boolean> {
  try {
    if (!VAPID_PUBLIC || !supabase) return false;
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    if (Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
    }
    const j = sub.toJSON();
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return false;
    const { error } = await supabase.rpc("keep_push_device", {
      p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
      p_crew: crew || null, p_wants_live: opts?.wantsLive ?? null,
    });
    return !error;
  } catch { return false; /* push optional; never block the UI */ }
}
