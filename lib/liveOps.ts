// LIVE OPS, AT A GLANCE (2026-10-12, the Live Ops round — the owner approved its six items on 2026-10-12).
//
// Measured on an iPhone 17 on a quiet day, the truck off the road: about 425 points of status cards before Due next.
// The Pass's card said "The pass is clear · 2 86'd — tap to work"; the truck's was ~195 points (OFFLINE, the next stop,
// Go live, two lines of links); a line when this phone could not ring; the Devices card; then Due next, where "Nothing
// due next." sat over the pickup drop. The truck said OFFLINE before its first read, said it again when that read failed,
// and kept whatever it last knew when a later read failed.
//
// Now the truck and the Pass are one row each (components/crew/LiveControl, components/crew/LiveOpsRows): a dot, one
// line saying the state in words, and the one action it needs. An alert that is hurting service right now leads the
// screen as one line. What each row says in each state, which alerts are service's, who may go live, what Go live checks
// first and where the pickup drop sits in Due next are decided here — pure, no React, no Supabase, no clock it was not
// handed — so scripts/smoke.cjs runs every state.
import { clockTime, etDayKey } from "./dates";
import { dueDay } from "./dueNext";
import { flagIsToday } from "./home";
import { stopIsDue } from "./road";

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

// ── THE EXCEPTION LINE: ONLY WHAT IS HURTING SERVICE NOW ─────────────────────────────────────────────────────────────
// One row at the top of Live Ops, and only for an alert that affects service right now:
//   order_stale       tickets past their promise (alert_stale_orders, 0369) — opens the Pass;
//   pass_unwatched    no phone on the Pass that can ring (pass_watchdog, 0376) — opens the Pass, where a phone picks it up;
//   a paid cup order that didn't record — /api/checkout raises it with no kind, because the order it is about does not
//                     exist (app/api/checkout/route.ts, "Paid order didn't record — add it"), so its title is its only
//                     name. Its words (the payment, the items) are in the alert, and there is no record to open: it
//                     opens the inbox, on the alert.
// Merch (a paid shop order that didn't record), a reservation or a porch that didn't (Saturday's and Sunday's, not the
// window's now), money, admin and every other alert stay in the bell and in Money. It reads the bell's own list (the
// open alerts lib/useMyAlerts gives the header: one a teammate has claimed is not counted there, and not here) and,
// like the bell, what was true today (lib/home flagIsToday). A critical leads; then the newest.
export const EXCEPTION_KINDS: readonly string[] = ["order_stale", "pass_unwatched"];
export const PAID_ORDER_UNRECORDED = "Paid order didn't record — add it";
export type FlagLike = { kind?: string | null; title: string; severity: string; created_at: string; last_seen_at?: string | null };

export const isServiceException = (f: FlagLike): boolean =>
  (!!f.kind && EXCEPTION_KINDS.includes(f.kind)) || f.title.trim() === PAID_ORDER_UNRECORDED;

/** Where a tap on the line goes: the Pass for the Pass's own alerts, the inbox for the one with no record. */
export const exceptionOpens = (f: FlagLike): "pass" | "inbox" => (f.kind && EXCEPTION_KINDS.includes(f.kind) ? "pass" : "inbox");

export function serviceExceptions<T extends FlagLike>(flags: readonly T[], todayKey: string): T[] {
  const rank = (s: string) => (s === "critical" ? 0 : s === "important" ? 1 : 2);
  const when = (f: FlagLike) => f.last_seen_at ?? f.created_at;
  return flags
    .filter((f) => isServiceException(f) && flagIsToday({ created_at: f.created_at, last_seen_at: f.last_seen_at ?? null }, todayKey))
    .sort((a, b) => rank(a.severity) - rank(b.severity) || when(b).localeCompare(when(a)));
}

/** The line's words and its accessible name: the leading alert's title, how many more, and where a tap goes. */
export function exceptionSays(list: readonly FlagLike[]): { title: string; more: string; opens: "pass" | "inbox"; label: string } | null {
  const first = list[0];
  if (!first) return null;
  const more = list.length > 1 ? `and ${list.length - 1} more` : "";
  const opens = exceptionOpens(first);
  return { title: first.title, more, opens, label: `${first.title}${more ? `, ${more}` : ""}. Opens ${opens === "pass" ? "the Pass" : "your inbox, on the alert"}.` };
}

// ── GO LIVE, CHECKED FIRST ───────────────────────────────────────────────────────────────────────────────────────────
// Go live opens a sheet (components/crew/GoLiveSheet) that says, each in words with a plain yes or no:
//   due     the stop is due now — its day is today, or it started inside lib/road's grace (stopIsDue) — and its window;
//   pass    a phone has the Pass open with its orders feed connected (lib/heartbeat passPhones: ringing);
//   alerts  that phone's order alerts are on, so a new order reaches it with the Pass out of sight;
//   map     the stop has its map pin. The map guests see is Find Us's picture of the stop's own pin (components/FindUs
//           StopMap); the truck's moving dot (live_status.truck_lat/lng) is drawn by no customer page since the route map
//           went (b6af016, 2026-10-10), and going offline clears it, so before going live it is never set and a check of
//           it could only ever say no.
// Then what going live does: "Go live and tell N people", N being how many asked on Find Us to hear when the truck goes
// live (0257's wants_live; the push function pings them on the flip, supabase/functions/push) — counted by the database
// (live_ping_count, 0385), which never shows anyone's subscription. The checks inform and never block: with one that is
// not a yes, the button says "Go live anyway".
export type CheckKey = "due" | "pass" | "alerts" | "map";
/** One check: its question, its answer in a word (the tag on its row), and what is true, in a sentence. */
export type Check = { key: CheckKey; ok: boolean | null; title: string; word: "Yes" | "No" | "Checking" | "Not known"; says: string };
export type PreflightIn = {
  stop: StopLite; nowMs: number;
  /** lib/heartbeat passPhones' counts; null while the phones are read, "failed" when that read did not answer. */
  phones: { onPass: number; ringing: number; ringingAlertsOn: number } | "failed" | null;
  /** live_ping_count's answer; null while it is asked, "failed" when it did not answer (or 0385 is not pasted yet). */
  heard: number | "failed" | null;
};

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const yes = (key: CheckKey, title: string, says: string): Check => ({ key, ok: true, title, word: "Yes", says });
const no = (key: CheckKey, title: string, says: string): Check => ({ key, ok: false, title, word: "No", says });
const unknown = (key: CheckKey, title: string, failed: boolean): Check =>
  ({ key, ok: null, title, word: failed ? "Not known" : "Checking", says: failed ? "Couldn't check the phones" : "" });

export const CHECK_TITLE: Record<CheckKey, string> = {
  due: "The stop is due now",
  pass: "A phone is on the Pass",
  alerts: "Its order alerts are on",
  map: "Its map pin is set",
};

export function preflight(p: PreflightIn): { checks: Check[]; allOk: boolean; confirm: string; tells: string } {
  const T = CHECK_TITLE;
  const due = stopIsDue(p.stop.starts_at, new Date(p.nowMs));
  const ends = clockTime(p.stop.ends_at);
  const span = `${whenWords(p.stop.starts_at, p.nowMs)}${ends ? `–${ends}` : ""}`;
  const checks: Check[] = [
    due ? yes("due", T.due, span) : no("due", T.due, p.stop.starts_at ? `It's on the road for ${span}` : "It has no date yet"),
  ];
  const ph = p.phones;
  if (ph === null || ph === "failed") {
    checks.push(unknown("pass", T.pass, ph === "failed"), unknown("alerts", T.alerts, ph === "failed"));
  } else {
    checks.push(ph.ringing > 0 ? yes("pass", T.pass, `${phones(ph.ringing)} connected`)
      : no("pass", T.pass, ph.onPass > 0 ? `${ph.onPass} on the Pass, none connected` : "Nobody has the Pass open"));
    checks.push(ph.ringingAlertsOn > 0 ? yes("alerts", T.alerts, "A new order reaches it even with the Pass out of sight")
      : no("alerts", T.alerts, ph.ringing === 0 ? "There's no phone on the Pass to ring" : "It rings only while the Pass is open on its screen"));
  }
  const pinned = Number.isFinite(p.stop.lat ?? NaN) && Number.isFinite(p.stop.lng ?? NaN);
  checks.push(pinned ? yes("map", T.map, "Find Us shows it on the map") : no("map", T.map, "No pin yet — Find Us shows its address only"));

  const allOk = checks.every((c) => c.ok === true);
  const n = p.heard;
  const tells = typeof n === "number"
    ? n > 0 ? `Going live tells ${people(n)} who asked on Find Us to hear when the truck is live.` : "Nobody has asked on Find Us to hear when the truck is live yet."
    : n === "failed" ? "Couldn't count who asked on Find Us to hear — they're still told." : "Counting who asked on Find Us to hear…";
  const confirm = !allOk ? "Go live anyway" : typeof n === "number" && n > 0 ? `Go live and tell ${people(n)}` : "Go live";
  return { checks, allOk, confirm, tells };
}

// ── THE PICKUP DROP, A ROW OF DUE NEXT ───────────────────────────────────────────────────────────────────────────────
// The drop's own card sat under Due next's list, so on a quiet day "Nothing due next." stood directly over "Pickup drop ·
// This Sat · no reservations yet". The card is a row of the list now (components/crew/DueList), in the list's order —
// lib/dueNext byDue's day, then a timed row before one due sometime that day, then the time — and ahead of its own packs,
// which share its day and time. This is where it goes among the rows the list shows.
export function dropSlot(rows: readonly { day: string; at: number | null }[], drop: { day: string | null; at: number | null }): number {
  if (!drop.day) return rows.length;
  const d = drop.day;
  const before = (r: { day: string; at: number | null }) =>
    r.day !== d ? r.day < d
      : (r.at === null) !== (drop.at === null) ? r.at !== null
      : r.at !== null && drop.at !== null && r.at < drop.at;
  const i = rows.findIndex((r) => !before(r));
  return i === -1 ? rows.length : i;
}
