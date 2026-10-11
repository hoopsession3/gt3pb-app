// RING THIS PHONE — what the button says after a press (2026-10-11, wave 2 · alerts).
//
// The database sends the alert (0374 ring_my_devices: a critical, kind device_test, to the signed-in person's own
// devices, once a minute) and answers how many devices it went to, or refuses in words. This turns that answer into
// the one line the button shows (components/RingThisPhone). Pure, so scripts/smoke.cjs can ask it every answer.

/** What supabase.rpc("ring_my_devices") hands back. */
export type RingAnswer = { data?: unknown; error?: { code?: string | null; message?: string | null } | null };
export type RingWords = { sent: boolean; say: string };

export const RING_IDLE = "Sends a test alert to your own phone — nobody else sees it — so you can hear that alerts reach you.";

export function ringWords(r: RingAnswer): RingWords {
  const e = r.error;
  if (e) {
    const code = String(e.code ?? "");
    const msg = String(e.message ?? "").trim();
    // A session that lapsed reaches the database signed out, and is refused the call itself — Postgres's words, not ours.
    if (code === "42501" && /^permission denied/i.test(msg)) return { sent: false, say: "Sign in again to ring your phone." };
    // The database's own sentence: a second press inside the minute (PT429, with how long to wait), or someone it
    // will not ring for (42501: not on the crew).
    if ((code === "PT429" || code === "42501") && msg) return { sent: false, say: msg };
    // PostgREST's "no such function": 0374 is not in this database yet.
    if (code === "PGRST202" || code === "42883") return { sent: false, say: "Ringing a phone from here isn't switched on yet." };
    return { sent: false, say: "Couldn't ring your phone — try again." };
  }
  const n = typeof r.data === "number" ? r.data : Number.NaN;
  if (!Number.isInteger(n) || n < 0) return { sent: false, say: "Couldn't ring your phone — try again." };
  if (n === 0) return { sent: false, say: "Nothing to ring yet — turn on alerts on this phone first." };
  return { sent: true, say: n === 1 ? "Sent — your phone should ring now." : `Sent to your ${n} devices — they should ring now.` };
}
