// LIVE OPS, AT A GLANCE (2026-10-12, the Live Ops round — the owner approved its six items on 2026-10-12).
//
// Measured on an iPhone 17 on a quiet day, the truck off the road: about 425 points of status cards before Due next.
// The Pass's card said "The pass is clear · 2 86'd — tap to work"; the truck's was ~195 points (OFFLINE, the next stop,
// Go live, two lines of links); a line when this phone could not ring; the Devices card; then Due next, where "Nothing
// due next." sat over the pickup drop. The truck said OFFLINE before its first read, said it again when that read failed,
// and kept whatever it last knew when a later read failed.
//
// Now the truck and the Pass are one row each (components/crew/LiveControl, components/crew/LiveOpsRows): a dot, one
// line saying the state in words, and the one action it needs. What each row says in each state and who may go live are
// decided here — pure, no React, no Supabase, no clock it was not handed — so scripts/smoke.cjs runs every state.
import { clockTime, etDayKey } from "./dates";
import { dueDay } from "./dueNext";

// ── WHO MAY GO LIVE: THE DATABASE'S OWN TEST ─────────────────────────────────────────────────────────────────────────
// Go live, Go offline and the truck's map dot call admin_set_live (0124), admin_set_offline (0022) and
// admin_set_truck_pos (0022); a truck stop is written under "admin write stops" (0003); Make it live calls
// admin_set_event_live (0024). Each asks public.is_admin(), and is_admin() (0035, not redefined since) is
// `role in ('admin','owner') or is_admin = true` on the caller's profile. Live Ops drew Go live for every manager, so an
// event manager's tap ended in "Go live failed — your account isn't an owner/admin." The controls show on the same
// test, read off the stored profile the way the database reads it. Not lib/roles canOf: roleOf reads a known role before
// the legacy flag, so an event manager whose is_admin flag is set — whom the database lets go live — would lose the
// button (the same reason Command's briefing reads profile.role, not isOwner).
export type LiveProfile = { role?: string | null; is_admin?: boolean | null } | null | undefined;
export const mayGoLive = (p: LiveProfile): boolean => !!p && (p.role === "owner" || p.role === "admin" || p.is_admin === true);

// ── A STOP'S TIME, IN WORDS ──────────────────────────────────────────────────────────────────────────────────────────
export type StopLite = { name?: string | null; starts_at?: string | null; ends_at?: string | null; lat?: number | null; lng?: number | null };
export const stopName = (s: StopLite | null | undefined): string => s?.name?.trim() || "Untitled location";

const at = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** "Today 11:00am", "Tomorrow 9:30am", "Sat 11:00am", "Sun, Oct 18 11:00am" — the business day as Due next says it
 *  (lib/dueNext dueDay, Eastern) and the stop's clock. An undated stop: "no date yet". */
export function whenWords(iso: string | null | undefined, nowMs: number): string {
  const t = at(iso);
  if (!Number.isFinite(t)) return "no date yet";
  return `${dueDay(etDayKey(new Date(t)), etDayKey(new Date(nowMs)))} ${clockTime(iso)}`;
}

/** "12 min", "1 h", "1 h 5 min". */
export function spanWords(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** THE LIVE STOP'S MINUTES. live_status keeps no time the truck went live (0019, 0022), so the minutes are the stop's
 *  own: before its start (live early) "starts in 10 min"; then until its end, "42 min left" — and "closed 12 min ago"
 *  once that has passed with the truck still live, which is `late`; with no end, "40 min in" since the start. Neither
 *  time: nothing. */
export function liveClock(s: StopLite | null | undefined, nowMs: number): { words: string; late: boolean } {
  const start = at(s?.starts_at), end = at(s?.ends_at);
  if (Number.isFinite(start) && start > nowMs) return { words: `starts in ${spanWords(Math.ceil((start - nowMs) / 60_000))}`, late: false };
  if (Number.isFinite(end)) {
    return end > nowMs
      ? { words: `${spanWords(Math.ceil((end - nowMs) / 60_000))} left`, late: false }
      : { words: `closed ${spanWords(Math.max(1, Math.floor((nowMs - end) / 60_000)))} ago`, late: true };
  }
  if (Number.isFinite(start)) return { words: `${spanWords(Math.max(1, Math.floor((nowMs - start) / 60_000)))} in`, late: false };
  return { words: "", late: false };
}

// ── A ROW, IN WORDS ──────────────────────────────────────────────────────────────────────────────────────────────────
// A row's dot repeats its words and never stands alone: idle (nothing happening), on (the truck is live), busy (orders
// on the Pass), warn (something to look at), fail (a read that did not answer).
export type RowTone = "idle" | "on" | "busy" | "warn" | "fail";
export type RowSays = { tone: RowTone; text: string };

// ── THE TRUCK'S ROW ──────────────────────────────────────────────────────────────────────────────────────────────────
// The truck is live or off the road — never OFFLINE, which it said before it had read anything and again when the read
// failed. A read that did not answer, the first or any later one, is said: "Couldn't read the truck", and Try again.
/** A read's state: still reading, did not answer (the first time or any later one), or answered. */
export type ReadState = "loading" | "failed" | "ready";
export type TruckRead = ReadState;
export type TruckIn = { read: TruckRead; live: boolean; at?: StopLite | null; next?: StopLite | null; nowMs: number };

export function truckSays(t: TruckIn): RowSays {
  if (t.read === "failed") return { tone: "fail", text: "Couldn't read the truck" };
  if (t.read === "loading") return { tone: "idle", text: "Checking the truck…" };
  if (t.live) {
    const c = liveClock(t.at, t.nowMs);
    return { tone: c.late ? "warn" : "on", text: `Live${t.at ? ` at ${stopName(t.at)}` : ""}${c.words ? ` · ${c.words}` : ""}` };
  }
  if (t.next) return { tone: "idle", text: `Off the road · next: ${stopName(t.next)} · ${whenWords(t.next.starts_at, t.nowMs)}` };
  return { tone: "idle", text: "Off the road · no stop ahead" };
}

/** The row's one action: Try again for anyone; Go live, Go offline and Plan the next stop (which writes a stop) only for
 *  who the database lets do them (mayGoLive). */
export type TruckAction = "retry" | "go-live" | "go-offline" | "plan" | null;
export function truckAction(t: TruckIn, canLive: boolean): TruckAction {
  if (t.read === "failed") return "retry";
  if (t.read === "loading" || !canLive) return null;
  if (t.live) return "go-offline";
  return t.next ? "go-live" : "plan";
}

// ── THE PASS'S ROW ───────────────────────────────────────────────────────────────────────────────────────────────────
// Clear: "Pass clear · 2 86'd · 2 phones can ring". Busy: "3 on the Pass · 1 ahead". The phones are lib/heartbeat
// passPhones' counts (a manager's: crew_devices answers no one else); a phone can ring when it has the Pass open with its
// orders feed connected — the test 0376's watchdog makes, so this row and its pass_unwatched alert agree. Trouble with a
// phone joins the line as words — "1 reconnecting", "this phone can't ring" (Live Ops' alerts-off line, which was a line
// of its own) — and the phones' rows are one tap away. Busy names the phones only when something is wrong with them.
export type PassPhonesIn = { onPass: number; ringing: number; reconnecting: number; notConnected: number };
export type PassIn = {
  read: ReadState; pass: number; ahead: number; out: number;
  /** null: not known here (not a manager, or not read yet); "failed": the read did not answer. */
  phones: PassPhonesIn | "failed" | null;
  /** This phone's order alerts are off and could be on (components/DeviceAlerts useAlertsOffHere). */
  thisPhoneOff: boolean;
};

const phones = (n: number) => `${n} ${n === 1 ? "phone" : "phones"}`;

export function passSays(p: PassIn): RowSays & { trouble: boolean } {
  const parts: string[] = [];
  const busy = p.read === "ready" && p.pass > 0;
  if (p.read === "failed") parts.push("Couldn't count the Pass");
  else if (p.read === "loading") parts.push("Checking the Pass…");
  else if (busy) { parts.push(`${p.pass} on the Pass`); if (p.ahead > 0) parts.push(`${p.ahead} ahead`); }
  else { parts.push("Pass clear"); if (p.out > 0) parts.push(`${p.out} 86'd`); }

  const trouble: string[] = [];
  let ring: string | null = null;
  let deaf = false;
  if (p.phones === "failed") trouble.push("couldn't check the phones");
  else if (p.phones) {
    const ph = p.phones;
    ring = ph.ringing > 0 ? `${phones(ph.ringing)} can ring` : ph.onPass === 0 ? "no phone on the Pass" : "no phone can ring";
    if (ph.reconnecting > 0) trouble.push(`${ph.reconnecting} reconnecting`);
    if (ph.notConnected > 0) trouble.push(`${ph.notConnected} not connected`);
    deaf = busy && ph.ringing === 0;
  }
  if (p.thisPhoneOff) trouble.push("this phone can't ring");
  const isTrouble = trouble.length > 0 || deaf;
  if (ring && (!busy || isTrouble)) parts.push(ring);
  parts.push(...trouble);
  const tone: RowTone = p.read === "failed" ? "fail" : isTrouble ? "warn" : busy ? "busy" : "idle";
  return { tone, text: parts.join(" · "), trouble: isTrouble };
}
