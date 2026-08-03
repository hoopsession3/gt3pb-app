import { supabase } from "./supabase";

// Utilization tracking (0267) — fire-and-forget, never blocks UI, never throws. Signed-in
// activity rides track_user (RPC bumps the caller's own daily row: logins / actions / last
// action). Anonymous visits ride track_guest (a daily counter — no IDs, no PII). Throttles keep
// this to a handful of calls per session, not a firehose.

let lastUser = 0;
export function trackUser(action: string, isLogin = false) {
  if (!supabase) return;
  const now = Date.now();
  if (!isLogin && now - lastUser < 15_000) return;   // action spam guard — 1 per 15s is plenty
  lastUser = now;
  supabase.rpc("track_user", { p_action: action, p_is_login: isLogin }).then(() => {}, () => {});
}

export function trackGuest() {
  if (!supabase || typeof window === "undefined") return;
  try {
    const k = "gt3-guest-ping";
    const last = Number(localStorage.getItem(k) || 0);
    if (Date.now() - last < 60 * 60 * 1000) return;   // one count per device per hour
    localStorage.setItem(k, String(Date.now()));
  } catch { /* private mode — count anyway */ }
  supabase.rpc("track_guest").then(() => {}, () => {});
}
