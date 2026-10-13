// THE PUSH FUNCTION'S RULES, PURE (2026-10-11, wave 2 · alerts).
//
// Three questions the push function (./index.ts) used to answer inline, each in more than one place:
//
//   1. Which channels does an alert of this severity get?   channelsFor()
//   2. What may a phone show on its lock screen?             newOrderShown(), alertShown(), … (every send)
//   3. Is this change to an alert an escalation?             isEscalation(), stillUnanswered()
//
// And one it never asked (2026-10-12): 4. Whose phone may this alert ring right now?   whoRings()
//
// They live here so a test can run them (scripts/push.policy.test.mjs compiles this file and asks it), and so
// each has one answer. Nothing here reaches the network, the database or Deno: every input is a plain value the
// function already holds. Deployed beside index.ts (the push function is two files now: index.ts imports this).

export type Severity = "critical" | "important" | "fyi";

// ── 1 · FYI STAYS QUIET (2026-10-11) ───────────────────────────────────────────────────────────────────────────
// An fyi reaches the inbox and nothing else: no push, so no sound; no Teams card; no email. Before this the only
// thing severity decided was Teams (skipped for fyi) and email (criticals only), so every fyi still buzzed every
// owner's phone: each shop order, reservation, sign-up and the daily digest.
//
// email: "always" for a critical (the net under push and Teams: a critical can't depend on a subscribed device),
// "asked" for an important — a producer may email it on purpose (a booking lead, a new delivery or reserve: the
// owner's 2026-07-30 ask) — and "never" for an fyi, whoever asks.
export type Channels = { push: boolean; sound: boolean; teams: boolean; email: "never" | "asked" | "always" };

export const CHANNELS: Readonly<Record<Severity, Readonly<Channels>>> = {
  fyi:       { push: false, sound: false, teams: false, email: "never" },
  important: { push: true,  sound: true,  teams: true,  email: "asked" },
  critical:  { push: true,  sound: true,  teams: true,  email: "always" },
};

/** The severity an alert row carries; anything else is the column's own default, 'important' (0050). */
export function severityOf(raw: unknown): Severity {
  return raw === "critical" || raw === "fyi" ? raw : "important";
}

export function channelsFor(raw: unknown): Channels {
  return CHANNELS[severityOf(raw)];
}

/** May this severity send an email? `asked`: the producer wants one for an important. */
export function mayEmail(raw: unknown, asked = false): boolean {
  const e = channelsFor(raw).email;
  return e === "always" || (e === "asked" && asked);
}

// ── 2 · WHAT A LOCKED PHONE MAY SHOW (2026-10-11) ──────────────────────────────────────────────────────────────
// A push is read on a lock screen, by whoever is near the phone. It used to carry the alert's or the order's own
// words: "Ryan - RISE - FLOW - $12.00" for a new order, "<who> paid $32.00 2 days ago" for a stalled one, an office
// order's phone number, a delivery's street and ZIP. Now every push is built here from words that hold no customer
// name, phone, address, email or amount — never from text a producer or a customer wrote. The full text stays in
// the app, where the inbox and the Pass show it to the crew who are signed in.
//
// `tag` names the event: a browser shows one notification per tag, so two orders or two alerts no longer replace
// each other silently, and the same alert sent again (an escalation) is a new tag and rings. `ring`: show it even
// while the app is open on screen (public/sw.js) — a critical, an escalation and a test, which nothing in the app
// would otherwise sound for.
export type Shown = { title: string; body: string; tag: string; ring: boolean };

const BRAND = "GT3 Performance Bar";
const TAP = "Tap to open.";
const idOf = (x: unknown) => (typeof x === "string" && x ? x : "-");

/** A new cup order: how many items, never who or how much. */
export function newOrderShown(order: { id?: unknown; items?: unknown }): Shown {
  const n = Array.isArray(order.items) ? order.items.length : 0;
  return {
    title: "New order",
    body: n > 0 ? `${n} item${n === 1 ? "" : "s"} · tap to open` : "Tap to open the Pass.",
    tag: `order:${idOf(order.id)}`,
    ring: false,   // the Pass chimes for its own orders while it is open
  };
}

/** The order's words where its customer reads them — a copy of lib/orderWords (Deno cannot import it), held to it by
 *  scripts/smoke.cjs — and its number as the bar, Today and the Pass print it (lib/activeOrder orderNo). */
export const ORDER_TAG: Record<string, string> = { preparing: "Being made", ready: "Ready" };
export const ORDER_LINE: Record<string, string> = { preparing: "Being made now.", ready: "Ready — grab it at the window." };
export const orderNoOf = (id: unknown): string => (typeof id === "string" && id ? `#${id.slice(0, 4).toUpperCase()}` : "");

/** The customer's own order moving along — its number and its words, never their name, which their lock screen shows
 *  to the room too. 'done' sends nothing: they already have it in hand. */
export function orderStatusShown(order: { id?: unknown; status?: unknown }): Shown | null {
  const s = typeof order.status === "string" ? order.status : "";
  if (!ORDER_LINE[s]) return null;
  const no = orderNoOf(order.id);
  return { title: no ? `Order ${no} · ${ORDER_TAG[s]}` : ORDER_TAG[s], body: ORDER_LINE[s], tag: `order:${idOf(order.id)}:${s}`, ring: false };
}

/** A member's subscription changing state. */
export function subscriptionShown(sub: { id?: unknown; status?: unknown }): Shown | null {
  const say: Record<string, string> = {
    active: "Your subscription's live — your bottles are ready when you are.",
    past_due: "Your subscription payment didn't go through — update your card to keep your bottles coming.",
  };
  const s = typeof sub.status === "string" ? sub.status : "";
  if (!say[s]) return null;
  return { title: BRAND, body: say[s], tag: `sub:${idOf(sub.id)}:${s}`, ring: false };
}

/** A crew task given to someone, or turned critical. Its label and its event's title are free text — a client's
 *  name lives in either as easily as a chore — so neither is shown. */
export function taskShown(task: { id?: unknown }, becameCritical: boolean): Shown {
  return becameCritical
    ? { title: "Task flagged critical", body: `A task of yours is critical now. ${TAP}`, tag: `task:${idOf(task.id)}`, ring: false }
    : { title: "You're on the crew", body: `A task is yours. ${TAP}`, tag: `task:${idOf(task.id)}`, ring: false };
}

/** The truck went live. A stop's name is public — it is on the Find Us page — so it may be said; nothing else is. */
export function liveShown(stopName: unknown): Shown {
  const at = typeof stopName === "string" && stopName.trim() ? ` at ${stopName.trim().slice(0, 60)}` : "";
  return { title: "GT3 is LIVE", body: `We're pouring${at} — come thru.`, tag: "live", ring: false };
}

/** Cup orders opened for a stop a member asked to be reminded about (0394). The stop's name is public; nothing else. */
export function reminderShown(stopName: unknown, stopId: unknown): Shown {
  const at = typeof stopName === "string" && stopName.trim() ? ` for ${stopName.trim().slice(0, 60)}` : "";
  return { title: "Cup orders are open", body: `Order ahead${at} — your usual is one tap on Today.`, tag: `cups-open:${idOf(stopId)}`, ring: false };
}

/** Prep waiting on someone's sign-off. The event's title can be a client's name, so it is not shown. */
export function signoffShown(req: { id?: unknown }): Shown {
  return { title: "Prep needs your sign-off", body: `Tap to review and approve.`, tag: `signoff:${idOf(req.id)}`, ring: false };
}

// What each kind of alert says on a lock screen: one fixed sentence apiece. A kind not named here says its
// category's words (below), so a new producer is safe before anyone writes it a sentence.
export const KIND_WORDS: Readonly<Record<string, string>> = {
  order_stale: "Orders are waiting on the pass",
  shop_order_new: "New shop order",
  shop_order_stalled: "A paid shop order is still waiting on us",
  fulfillment: "A shop order needs sending by hand",
  reservation_new: "New reservation",
  office_order_new: "New office order",
  office_request: "An office asked for a change",
  office_not_delivered: "An office delivery wasn't made",
  office_standing_orphaned: "A weekly office order stopped",
  office_generation_failed: "Office deliveries didn't generate",
  delivery_held: "A delivery is held for pickup",
  delivery_not_home: "A delivery customer wasn't home",
  email_undelivered: "A customer email didn't arrive",
  ops_incident: "An order needs a hand",
  refund_needed: "A refund is needed",
  refund_unrecorded: "A Square refund isn't recorded here",
  chargeback_open: "A card dispute was opened",
  vendor_pending: "A new venue needs approval",
  compliance_changed: "A permit rule has changed",
  client_error: "The app hit an error",
  error_storm: "Error storm — new-error alerts paused",
  heartbeat_stale: "The uptime check went quiet",
  task_assigned: "A task is yours",
  task_due: "A task is past due",
  thread_reply: "New reply",
  thread_reply_task: "New reply on a task",
  thread_reply_note: "New reply on a note",
  thread_reply_alert: "New reply on an alert",
  content_approved: "Your post was approved",
  content_changes: "Changes requested on your post",
  prep_signoff_request: "Prep needs your sign-off",
  brew_start_window: "A brew window is open",
  brew_start_now: "Time to start a brew",
  brew_at_risk: "A brew is at risk",
  brew_started: "A brew is brewing",
  brew_ready_soon: "A brew is ready in about an hour",
  brew_bottle_now: "Time to bottle a brew",
  brew_overextract: "A brew is over-extracting",
  brew_hold_closing: "A brew's hold window is closing",
  brew_hold_expired: "A brew is past its hold",
  device_test: "Test alert",
};

// The closed category vocabulary (lib/alertKinds), for an alert whose kind has no sentence.
export const CATEGORY_WORDS: Readonly<Record<string, string>> = {
  order: "An order needs you",
  money: "A money alert",
  brew: "A brew alert",
  booking: "A booking alert",
  prep: "A prep alert",
  content: "A content alert",
  task: "A task alert",
  strategy: "A strategy alert",
  system: "A system alert",
};

// Alerts raised with no kind whose titles are fixed sentences in their producers' code — no name, no number, no
// amount in them — and so may be shown as written. Anything else falls to its category's words. A producer that
// rewords one of these loses nothing but the detail: the lock screen says its category instead (a known pair,
// failing safe; scripts/push.policy.test.mjs holds every entry to "nothing a customer typed, no digits, no $").
export const FIXED_TITLES: ReadonlySet<string> = new Set([
  "Paid order didn't record — add it",                    // app/api/checkout
  "Paid order may not have recorded — check the pass",
  "Checkout charge status unknown — check Square",
  "A pre-order may not have saved — check the pass",
  "Paid DELIVERY didn't record — add it",                 // app/api/delivery/checkout
  "DELIVERY order didn't record — add it",
  "Delivery charge status unknown — check Square",
  "New Sunday delivery 🚚",
  "Subscription payment failed",                          // app/api/square/webhook
  "Subscription canceled",
  "Subscription needs reconcile",                         // app/api/subscriptions/create
  "New software subscription",                            // app/api/billing/webhook
  "Customer canceled a paid order — refund needed",       // 0341 cancel_own_order
  "Member canceled a PAID reservation — refund needed",   // 0341 cancel_own_reservation
  "Delivery canceled — refund needed",                    // 0242 cancel_own_delivery
  "Truck went offline",                                   // 0232
  "New booking lead",                                     // ./index.ts, booking_requests
]);

/** What an alert row may say on a locked phone. The row's own words stay in the app. */
export function alertWords(a: { kind?: unknown; category?: unknown; title?: unknown }): string {
  const kind = typeof a.kind === "string" ? a.kind : "";
  if (kind && KIND_WORDS[kind]) return KIND_WORDS[kind];
  const title = typeof a.title === "string" ? a.title.trim() : "";
  if (!kind && FIXED_TITLES.has(title)) return title;
  const cat = typeof a.category === "string" ? a.category : "";
  return CATEGORY_WORDS[cat] ?? CATEGORY_WORDS.system;
}

export function alertShown(a: { id?: unknown; kind?: unknown; category?: unknown; title?: unknown; severity?: unknown }): Shown {
  if (a.kind === "device_test") return deviceTestShown(a);
  const critical = severityOf(a.severity) === "critical";
  return {
    title: `${critical ? "Critical — " : ""}${alertWords(a)}`,
    body: TAP,
    tag: `alert:${idOf(a.id)}`,
    ring: critical,
  };
}

/** The same alert, sent again because nobody picked it up (0373). A new tag, so it rings beside the first. */
export function escalationShown(a: { id?: unknown; kind?: unknown; category?: unknown; title?: unknown }): Shown {
  return {
    title: `Still open — ${alertWords(a)}`,
    body: `Nobody has picked this up in 10 minutes. ${TAP}`,
    tag: `alert:${idOf(a.id)}:again`,
    ring: true,
  };
}

/** "Ring this phone" (0374): the person's own test, so it rings even with the app open in front of them. */
export function deviceTestShown(a: { id?: unknown }): Shown {
  return { title: "Test alert", body: "Alerts reach this phone. Nothing to do.", tag: `test:${idOf(a.id)}`, ring: true };
}

// ── 3 · AN ESCALATION (2026-10-11, 0373) ───────────────────────────────────────────────────────────────────────
// escalate_unacked_criticals() marks a critical nobody acknowledged in ten minutes (escalated_at), and the
// alerts_push_escalation trigger hands the push function that UPDATE. Only the moment escalated_at is first set
// is one; a critical, still unacknowledged, and never a device test (a person's own, shown to nobody else).
type AlertRow = { severity?: unknown; kind?: unknown; ack_at?: unknown; escalated_at?: unknown } | null | undefined;

export function isEscalation(record: AlertRow, old: AlertRow): boolean {
  if (!record || !old) return false;
  return !old.escalated_at && !!record.escalated_at && record.severity === "critical"
    && !record.ack_at && record.kind !== "device_test";
}

// SOMEBODY HAS IT (2026-10-12, 0383). Just before an escalation is sent, the row is read again (./index.ts): one
// acknowledged in the meantime is not sent, nor one somebody has claimed — the first Got it on a team alert, which the
// database keeps on the alert (claimed_by) and the whole team sees. It used to count any alert_reads row, which anyone
// signed in could write for an alert they could not even see. Until 0383 is applied the row has no claimed_by, and
// anyone's Got it (`reads`, the alert's alert_reads rows) is what counts, as it did; a count not read is none.
export function stillUnanswered(now: Record<string, unknown> | null | undefined, reads: number | null = null): boolean {
  if (!now || now.ack_at) return false;
  if ("claimed_by" in now) return !now.claimed_by;
  return !(typeof reads === "number" && reads > 0);
}

// ── 4 · A MUTE AND QUIET HOURS HOLD THE PUSH, NOT THE ALERT (2026-10-12) ───────────────────────────────────────
// Settings › Notifications (components/NotifPrefs; notif_prefs, 0177) promises two things: a muted category's
// alerts stop pinging you, and during quiet hours non-critical alerts "are held into a morning digest instead of
// pinging you". Only the inbox kept either (lib/useMyAlerts hides a muted category and holds the rest in a digest).
// This function never read notif_prefs — ./index.ts had no mention of it — so a muted category, or an important at
// 3 AM inside someone's quiet hours, rang their phone like any other, to everyone peopleFor() named.
//
// Now each person an alert would reach is asked, by these rules, before their devices are:
//   · a critical always rings, mutes and quiet hours notwithstanding — Settings: "Critical alerts always come
//     through" — and so does a device test, which is a critical and the person's own;
//   · an alert in a category the person muted does not ring them (the inbox's rule: the category as written,
//     0232's closed list);
//   · nor does one inside their quiet hours: [start, end) in whole hours, across midnight when start is after end
//     (22 → 7), and no window when either end is unset, out of 0–23, or both are the same hour — lib/useMyAlerts
//     inQuietHours, the inbox's own rule;
//   · the hour is read on the clock of the person's market (profiles.market → markets.timezone; the founding
//     market's, America/New_York, where it is not known or not a zone). Settings says "this phone's clock": a
//     server cannot read a phone's clock, and the crew's phones keep their market's.
// Only the push is held. The alert is written, its inbox line shows (in the digest, in quiet hours), and Teams and
// email are the severity's, as above — a critical is the only alert that emails, and it is never held. A held push
// is not sent later: the alert waits in the inbox, which is where Settings says it surfaces when quiet hours end.
// A team alert is asked person by person, so one person's mute or quiet hours never silence another's phone.
export type NotifPrefsRow = { muted_categories?: unknown; quiet_start?: unknown; quiet_end?: unknown } | null | undefined;
export type Held = "muted" | "quiet hours";

/** The founding market's zone (markets.timezone's default, 0275). */
export const MARKET_ZONE = "America/New_York";

const hourClocks = new Map<string, Intl.DateTimeFormat>();
/** The hour, 0–23, that `at` reads on a time zone's clock. A zone this runtime does not know is the founding
 *  market's. */
export function hourOn(at: Date, timeZone: unknown): number {
  const zone = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : MARKET_ZONE;
  let clock = hourClocks.get(zone);
  if (!clock) {
    try { clock = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }); }
    catch { return zone === MARKET_ZONE ? at.getUTCHours() : hourOn(at, MARKET_ZONE); }
    hourClocks.set(zone, clock);
  }
  const h = Number(clock.formatToParts(at).find((p) => p.type === "hour")?.value);
  return Number.isInteger(h) ? h % 24 : at.getUTCHours();
}

const wholeHour = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 23 ? x : null);

/** Is `hour` inside a quiet window? lib/useMyAlerts inQuietHours: [start, end), across midnight when start > end;
 *  no window when either end is unset (or not an hour), or both are the same hour. */
export function inQuietHours(hour: number, start: unknown, end: unknown): boolean {
  const s = wholeHour(start), e = wholeHour(end);
  if (s === null || e === null || s === e) return false;
  return s < e ? hour >= s && hour < e : hour >= s || hour < e;
}

/** Why this alert's push is held for one person, or null: it rings them. No prefs is no mute and no quiet hours. */
export function pushHeld(a: { severity?: unknown; category?: unknown }, prefs: NotifPrefsRow, at: Date, timeZone?: unknown): Held | null {
  if (severityOf(a.severity) === "critical" || !prefs) return null;
  const muted = Array.isArray(prefs.muted_categories) ? prefs.muted_categories : [];
  if (typeof a.category === "string" && muted.includes(a.category)) return "muted";
  if (inQuietHours(hourOn(at, timeZone), prefs.quiet_start, prefs.quiet_end)) return "quiet hours";
  return null;
}

/** An alert's people, asked one by one at `at`: whose devices it rings now, and whose it holds, and why. */
export function whoRings(
  a: { severity?: unknown; category?: unknown },
  people: { id: string; prefs?: NotifPrefsRow; timeZone?: unknown }[],
  at: Date,
): { ring: string[]; held: { id: string; why: Held }[] } {
  const ring: string[] = [], held: { id: string; why: Held }[] = [];
  for (const p of people) {
    const why = pushHeld(a, p.prefs, at, p.timeZone);
    if (why) held.push({ id: p.id, why }); else ring.push(p.id);
  }
  return { ring, held };
}
