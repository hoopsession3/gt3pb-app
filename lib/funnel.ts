import { supabase } from "@/lib/supabase";

// Privacy-respecting funnel tracking. Records ONLY that "someone reached step X of funnel Y" — no
// user id, no IP, no name, no persistent cookie. A per-visit random token (sessionStorage, cleared
// when the tab closes) lets the report order steps within one attempt without identifying anyone or
// tracking across sessions. Fire-and-forget: analytics must NEVER break or slow a real flow, so every
// call is guarded and the insert is not awaited. Server writes go to funnel_events (0199).
export type Funnel = "order" | "reserve" | "delivery" | "signup" | "office";

function sessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let s = sessionStorage.getItem("gt3_fs");
    if (!s) { s = Math.random().toString(36).slice(2, 12); sessionStorage.setItem("gt3_fs", s); }
    return s;
  } catch { return null; }
}

export function trackFunnel(funnel: Funnel, step: string): void {
  if (!supabase || typeof window === "undefined") return;
  try {
    void supabase.from("funnel_events").insert({ funnel, step: step.slice(0, 40), session: sessionToken() });
  } catch { /* never surface an analytics failure into a checkout/signup flow */ }
}
