// WHICH SIDE OF THE APP A STAFF MEMBER WAS LAST ON — the one home for it.
//
// ── WHY (2026-10-02) ───────────────────────────────────────────────────────────────────────────
// Ryan, three screenshots: "3 screens to get to crew mode". The PWA starts at "/", the member
// home, for everyone — so the owner opened his own app onto the customer Today every single time,
// then avatar → /3mpire → avatar → sheet → scroll → "Switch to Crew Mode". Crew → customer was one
// tap ("Customer view" in the crew header); customer → crew was four and a scroll.
//
// The fix is not a shortcut, it is memory: a staff member opens the app where they left it. Enter
// the console and it remembers "crew"; tap Customer view and it remembers "customer". Today reads
// it once on mount and sends a staff member straight to /crew when that is where they were.
// Members never have a mode and never see this; a deep link to any other route is untouched.
//
// localStorage, not the profile row: this is a per-device preference (the owner's phone opens to
// crew; the shared iPad at the truck can stay on the customer side), it must work offline, and it
// is nobody's business but the device's. Every read and write is wrapped — a private window or
// cleared site data must leave the app on the customer side, never throwing.
export type AppMode = "crew" | "customer";
const KEY = "gt3-mode";

export function readMode(): AppMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "crew" || v === "customer" ? v : null;
  } catch { return null; }
}

export function rememberMode(mode: AppMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* a device that cannot remember opens on the customer side */ }
}
