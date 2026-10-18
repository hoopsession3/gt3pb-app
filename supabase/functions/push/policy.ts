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

/** A cup order voided because its stop was called off (crew/stops/cancel, 0391): the stop's name and the reason, both
 *  public on Find Us, and what becomes of the money — never the customer's name (R3b: 0391's notices, the push half). */
export function stopCanceledShown(order: { id?: unknown; paid?: unknown; collected_at?: unknown; payment_status?: unknown }, stopName: unknown, reason: unknown): Shown {
  const no = orderNoOf(order.id);
  const where = typeof stopName === "string" && stopName.trim() ? stopName.trim().slice(0, 60) : "Your stop";
  const why = typeof reason === "string" && reason.trim() ? ` — ${reason.trim().slice(0, 120)}` : "";
  const paid = order.paid === true || !!order.collected_at || order.payment_status === "paid";
  return {
    title: no ? `Order ${no} · Canceled` : "Order canceled",
    body: `${where} was called off${why}. ${paid ? "Your card is being refunded in full." : "Nothing was charged."}`,
    tag: `order:${idOf(order.id)}:void`, ring: false,
  };
}

/** A member's cup order canceled — by the crew at the Pass, or by them (R7, 2026-10-15). A void the crew made said
 *  nothing: the order slipped off the bar and Today, the card refunded or not, and nobody said which. Its number, and
 *  what becomes of the money — paid online, the card is refunded in full; paid at the window, it comes back there; not
 *  paid, nothing was charged — never the customer's name. A stop called off says so instead (stopCanceledShown). */
export function orderVoidShown(order: { id?: unknown; paid?: unknown; collected_at?: unknown; collected_via?: unknown; payment_status?: unknown }): Shown {
  const no = orderNoOf(order.id);
  const atWindow = !!order.collected_at;
  const paid = order.paid === true || atWindow || order.payment_status === "paid";
  // How it was settled at the window says what comes back (R9): the reader is a card, refunded like one; covered — a free
  // cup or credit (0416) — took no money.
  const via = typeof order.collected_via === "string" ? order.collected_via : "";
  return {
    title: no ? `Order ${no} · Canceled` : "Order canceled",
    // The title says Canceled; the body says what becomes of the money, once (R7b: "Canceled —" twice on one lock screen).
    body: via === "covered" ? "Nothing was charged." : via === "card_reader" ? "Your card is being refunded in full."
      : atWindow ? "What you paid at the window comes back there." : paid ? "Your card is being refunded in full." : "Nothing was charged.",
    tag: `order:${idOf(order.id)}:void`, ring: false,
  };
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
  customer_text: "A customer texted us",                       // app/api/sms/inbound (0398): never the words or the number
  text_stop_unrecorded: "A STOP text wasn't recorded",
  text_confirm_failed: "A texts sign-up wasn't confirmed",       // lib/notify sayTextYes (R6): Twilio refused the first text
  ops_incident: "An order needs a hand",
  printer_unclear: "A send to the printer needs checking",     // R9 (0417): no clear answer from Apliiq — never "send it by hand"
  printer_unmatched: "The printer shipped an order we can't match",
  printer_shipped_closed: "The printer shipped an order we'd closed",
  stop_canceled: "A stop was called off",                      // app/api/crew/stops/cancel: never the stop's customers
  office_link_live: "An office payment link may still work",   // app/api/office/cancel (R9): Square didn't confirm it off
  office_paid_twice: "An office order was paid twice",         // app/api/square/webhook (R9)
  square_refused: "Square is refusing card payments",          // lib/squareServer (R9): the token or location, not the cards
  refund_needed: "A refund is needed",
  refund_unrecorded: "A Square refund isn't recorded here",
  chargeback_open: "A card dispute was opened",
  vendor_pending: "A new venue needs approval",
  compliance_changed: "A permit rule has changed",
  client_error: "The app hit an error",
  error_storm: "Error storm — new-error alerts paused",
  heartbeat_stale: "The uptime check went quiet",
  cron_failed: "A scheduled job is failing",                   // 0419 cron_watch: never the job's own words
  cron_stalled: "A scheduled job stopped running",              // 0423 cron_watch
  db_http_failed: "The database's requests are failing",       // 0423/0427 cron_watch: the push function not answering
  push_fault: "Alerts couldn't all go out",                    // ./index.ts sayFaults (R21): never which, nor the words
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

// ── 5 · A PACK HEARS ABOUT ITS DAY (2026-10-14, R5 of the customer audit — 0399) ─────────────────────────────────────
// What a member is told about their pack: the evening-before reminder, the stop's hours or place changed, the crew
// moved the pack or canceled it. The lock screen says the pack's size, the stop's name, its day and hours — what Find Us
// shows anyone — never their name, phone or what it cost. The email and the text say where too: the stop's street, a
// public place. The words are read when the notice goes (./index.ts reads the pack and its stop then), so a stop changed
// twice before it went says how it stands now.
export type PackNoticeKind = "pickup_tomorrow" | "pickup_changed" | "pack_moved" | "pack_canceled";
export type NoticePack = { id?: unknown; size?: unknown; glass?: unknown; drop_date?: unknown; paid?: unknown; payment_status?: unknown };
export type NoticeStop = { name?: unknown; starts_at?: unknown; ends_at?: unknown; location_text?: unknown; address?: unknown } | null | undefined;

const PACKS_URL = "https://app.gt3pb.com/reserve";
const noticeDay = new Intl.DateTimeFormat("en-US", { timeZone: MARKET_ZONE, weekday: "short", month: "short", day: "numeric" });
const noticeClock = new Intl.DateTimeFormat("en-US", { timeZone: MARKET_ZONE, hour: "numeric", minute: "2-digit", hourCycle: "h12" });
const asDate = (x: unknown): Date | null => {
  if (typeof x !== "string" || !x) return null;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? null : d;
};
const said = (x: unknown, max = 80): string | null => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);

/** "11am", "11:30am" — a time on the market's clock. */
export function clockOf(at: Date): string {
  const parts = noticeClock.formatToParts(at);
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  const ap = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase();
  return `${h}${m === "00" ? "" : `:${m}`}${ap}`;
}

/** Where, which day and the hours of a pack's pickup: its stop's, else its drop date's day ("2026-10-24" is that day). */
export function pickupOf(pack: NoticePack, stop: NoticeStop): { where: string | null; street: string | null; day: string | null; hours: string | null } {
  const s = asDate(stop?.starts_at), e = asDate(stop?.ends_at);
  const drop = typeof pack.drop_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pack.drop_date) ? new Date(`${pack.drop_date}T16:00:00Z`) : null;
  return {
    where: said(stop?.name, 60),
    street: said(stop?.address, 120) ?? said(stop?.location_text, 120),
    day: s ? noticeDay.format(s) : drop ? noticeDay.format(drop) : null,
    hours: s ? (e ? `${clockOf(s)}–${clockOf(e)}` : `from ${clockOf(s)}`) : null,
  };
}

const sizeOf = (pack: NoticePack) => (typeof pack.size === "number" && pack.size > 0 ? `${pack.size}-pack` : "pack");
const paidOf = (pack: NoticePack) => pack.paid === true || pack.payment_status === "paid";
const isKind = (k: unknown): k is PackNoticeKind => k === "pickup_tomorrow" || k === "pickup_changed" || k === "pack_moved" || k === "pack_canceled";

/** What the lock screen shows. Null for a kind this does not know: nothing is sent. */
export function packNoticeShown(kind: unknown, pack: NoticePack, stop: NoticeStop): Shown | null {
  if (!isKind(kind)) return null;
  const p = pickupOf(pack, stop), size = sizeOf(pack);
  const when = [p.day, p.hours].filter(Boolean).join(", ");
  const at = p.where ? ` at ${p.where}` : "";
  const tag = `pack:${idOf(pack.id)}:${kind}`;
  if (kind === "pickup_tomorrow") return { title: "Pickup tomorrow", body: `Your ${size}: ${p.hours ? `${p.hours}${at}` : p.where ? `at ${p.where}` : "Find Us has where and when"}.`, tag, ring: false };
  if (kind === "pickup_changed") return { title: "Your pickup changed", body: `Your ${size} is now ${when || "on a new day"}${at}.`, tag, ring: false };
  if (kind === "pack_moved") return { title: "Your pack moved", body: `Your ${size} is now ${when || "on a new day"}${at}.`, tag, ring: false };
  return { title: "Your pack is canceled", body: `Your ${size}${p.day ? ` for ${p.day}` : ""} is canceled. ${paidOf(pack) ? "What you paid is being refunded." : "Nothing was charged."}`, tag, ring: false };
}

/** What the email and the text say: the lock screen's words, where the stop is, and the way to the member's packs. */
export function packNoticeTold(kind: unknown, pack: NoticePack, stop: NoticeStop): { subject: string; text: string; sms: string } | null {
  const shown = packNoticeShown(kind, pack, stop);
  if (!shown) return null;
  const p = pickupOf(pack, stop);
  const street = p.street ? ` (${p.street})` : "";
  const glass = kind === "pickup_tomorrow" && pack.glass === "return" ? "\n\nBringing your empties back: rinse them and bring them along." : "";
  const lines: Record<PackNoticeKind, string> = {
    pickup_tomorrow: `Your ${sizeOf(pack)} is ready for pickup tomorrow${p.day ? `, ${p.day}` : ""}${p.hours ? `, ${p.hours}` : ""}${p.where ? ` at ${p.where}${street}` : ""}.${glass}`,
    pickup_changed: `Your stop changed: your ${sizeOf(pack)} is now picked up ${[p.day, p.hours].filter(Boolean).join(", ") || "on a new day"}${p.where ? ` at ${p.where}${street}` : ""}.`,
    pack_moved: `We moved your ${sizeOf(pack)}: it is now picked up ${[p.day, p.hours].filter(Boolean).join(", ") || "on a new day"}${p.where ? ` at ${p.where}${street}` : ""}.`,
    pack_canceled: shown.body,
  };
  const k = kind as PackNoticeKind;
  return {
    subject: `GT3 — ${shown.title.charAt(0).toLowerCase()}${shown.title.slice(1)}${k === "pickup_tomorrow" && p.where ? `: ${p.where}` : ""}`,
    text: `${lines[k]}\n\nYour packs: ${PACKS_URL}`,
    sms: `GT3: ${shown.title}. ${shown.body} Reply STOP to stop.`.slice(0, 320),
  };
}

/** The number a text goes to — lib/texts e164, line for line (Deno cannot import it; scripts/smoke.cjs holds them
 *  together): a number written with its own + keeps it; ten digits take +1; eleven starting 1 take +. Else none. */
export function textNumber(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+") && digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")) return `+${digits}`;
  if (digits.length === 10 && !/^[01]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1") && !/^1[01]/.test(digits)) return `+${digits}`;
  return null;
}

/** A web device at one of the browsers' push services — the database's push_host_ok (0418), the same list (R9). A row
 *  kept before that rule, at any other address, is not posted to: the post went wherever the row said. */
export function pushHostOk(endpoint: unknown): boolean {
  const m = /^https:\/\/([^/:?#]+)/.exec(String(endpoint ?? ""));
  if (!m) return false;
  return /(^|\.)(googleapis\.com|google\.com|mozilla\.com|apple\.com|windows\.com)$/.test(m[1].toLowerCase());
}

/** How many devices are posted to at once: a go-live ping to every subscriber went to all of them at the same moment. */
export const SEND_AT_ONCE = 25;

// ── 6 · WHAT HAPPENED IS THE DATABASE'S (R10, 2026-10-16 — the 10/10 audit) ──────────────────────────────────────────
// The function is reached with the public key every page carries (0157: the webhook's bearer only gets past the
// platform's gate), so the body it is sent is only ever a pointer: which table, which row. ./index.ts reads that row from
// the database and sends from it; an event the database cannot show is not sent, and each event is sent once
// (push_sent, 0419). These are the rules it asks.

/** The tables whose rows the function reads to see what happened. */
export const EVENT_TABLES: ReadonlySet<string> = new Set([
  "orders", "subscriptions", "booking_requests", "profiles", "delivery_orders", "drop_orders", "event_tasks",
  "live_status", "cup_reminders", "pack_notices", "alerts",
]);

/** A row is news for half an hour: a new order, booking, sign-up or pack told about later than that is not sent — an old
 *  row described again is not news. A clock a minute ahead of the database's is allowed for. */
export const NEWS_MS = 30 * 60_000;
/** The truck going live is news for ten minutes after the database stamped the flip (0419 live_since). */
export const LIVE_NEWS_MS = 10 * 60_000;
export function freshRow(createdAt: unknown, nowMs: number, maxMs: number = NEWS_MS): boolean {
  const t = typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && nowMs - t >= -60_000 && nowMs - t <= maxMs;
}

/** Where a tap or an email's link may go: a path on this site, and nothing else. An alert's link is the crew's and the
 *  database's to write, but an email builds `https://app.gt3pb.com${link}` — "@other.example/x" made that another site
 *  — and the service worker opens what a push names. Anything that is not a plain path is the fallback. */
export function sitePath(link: unknown, fallback = "/"): string {
  return typeof link === "string" && link.length <= 300 && /^\/(?![/\\])[^\s\\]*$/.test(link) ? link : fallback;
}

/** The key an event is sent under, once (push_sent, 0419) — what happened and to which row. The go-live ping is one per
 *  half hour per business: the truck going live twice in a few minutes is one "we're live", and a ping described again
 *  while it is live is not another. */
export function eventKey(table: string, type: string, row: Record<string, unknown>, nowMs: number): string | null {
  const id = typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : "";
  if (!id) return null;
  const k = `${table}:${type}`;
  switch (k) {
    case "orders:INSERT":           return `orders:new:${id}`;
    case "orders:UPDATE":           return typeof row.status === "string" ? `orders:${id}:${row.status}` : null;
    case "subscriptions:UPDATE":    return typeof row.status === "string" ? `subs:${id}:${row.status}` : null;
    case "booking_requests:INSERT": return `book:${id}`;
    case "profiles:INSERT":         return `signup:${id}`;
    case "delivery_orders:INSERT":  return `delivery:new:${id}`;
    case "drop_orders:INSERT":      return `pack:new:${id}`;
    case "event_tasks:UPDATE":      return typeof row.assignee === "string" ? `task:${id}:${row.assignee}:${row.critical ? "critical" : "plain"}` : null;
    case "live_status:UPDATE":      return `live:${typeof row.tenant_id === "string" ? row.tenant_id : "-"}:${Math.floor(nowMs / 1_800_000)}`;
    case "cup_reminders:UPDATE":    return `remind:${id}`;
    case "pack_notices:UPDATE":     return `notice:${id}`;
    case "alerts:INSERT":           return `alert:${id}`;
    case "alerts:UPDATE":           return `alert-again:${id}`;
    default:                        return null;
  }
}

/** lib/texts NOT_US_AREA_CODES, the same list (Deno cannot import it; scripts/push.policy.test.mjs asks both of every
 *  area code): +1 codes that are not a US phone. */
export const NOT_US_AREA_CODES: ReadonlySet<string> = new Set((
  "204 226 236 242 246 249 250 257 263 264 268 273 284 289 306 343 345 354 365 367 368 382 387 403 416 " +
  "418 428 431 437 438 441 450 456 460 468 473 474 500 506 514 519 521 522 523 524 525 526 527 528 529 " +
  "533 544 548 566 577 579 581 584 587 588 600 604 613 622 633 639 644 647 649 655 658 664 672 677 683 " +
  "688 700 705 709 710 721 742 753 758 767 778 780 782 784 800 807 809 819 822 825 829 833 844 849 855 " +
  "866 867 868 869 873 876 877 879 880 881 882 883 884 885 886 887 888 889 900 902 905 942"
).split(" "));

/** A number texted — lib/texts usTextable, line for line (R9; Deno cannot import it, scripts/push.policy.test.mjs holds
 *  them together): a US one only. A yes can only be recorded for one (0418); this holds the send to it too. */
export function usTextable(num: unknown): boolean {
  const m = /^\+1([2-9]\d{2})[2-9]\d{6}$/.exec(String(num ?? ""));
  return !!m && !/^[2-9]11$/.test(m[1]) && !NOT_US_AREA_CODES.has(m[1]);
}

// WHAT A CUSTOMER TURNED OFF (2026-10-14, R6) — lib/customerNotify's two keys, by name (Deno cannot import it;
// scripts/smoke.cjs holds them together), kept in the person's own notif_prefs.muted_categories (0177). Receipts and
// changes to an order (a pack moved or canceled, a stop called off) have no key: they are always said.
export const CUSTOMER_MUTE = { orderUpdates: "order_updates", pickupReminders: "pickup_reminders" } as const;

// A text in plain characters — lib/texts smsPlain, line for line (Deno cannot import it; scripts/smoke.cjs holds them
// together): one ✓, long dash or curly apostrophe made the whole text Unicode, 70 characters a segment instead of 160.
const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
export function smsPlain(text: string): string {
  const swapped = String(text ?? "")
    .replace(/\s*[\u2713\u2714\u2705]/g, "")
    .replace(/\s+\u00B7\s+/g, ", ")
    .replace(/[\u00B7\u2022]/g, "-")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00D7/g, "x")
    .replace(/[\u00A0\u2007\u2009\u200A\u202F]/g, " ");
  let out = "";
  for (const ch of swapped) {
    if (GSM7.includes(ch)) { out += ch; continue; }
    for (const c of ch.normalize("NFD")) if (GSM7.includes(c)) out += c;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/** Night on the market's clock — 9pm to 8am, as lib/texts quietHours: no text goes then (0399 releases nothing then). */
export const textQuiet = (at: Date): boolean => { const h = hourOn(at, MARKET_ZONE); return h >= 21 || h < 8; };

// ── 5 · WHAT LEAVES THE APP (R27, 2026-10-18 — the 10/10 audit, API F17; Ryan: "Order # + link only") ───────────────────
// A Teams card is read in a channel, on every phone the channel reaches; an email sits in mailboxes, and in the mail
// provider's logs, for good. Both carried the alert's own words out of the app — a customer's name, email, phone and
// street, what they ordered, what somebody typed — and a booking's email carried the lead's name, number and notes. Now a
// card and an email say what kind of thing happened (the lock screen's words: alertWords), the number it is about — as
// the Pass prints an order's — and the link; the words themselves stay in the app, behind the crew's sign-in. Every
// sentence below is fixed (scripts/push.function.test.mjs sends made-up names, numbers and streets through each one and
// finds none of them outside).
export const APP_ORIGIN = "https://app.gt3pb.com";
export const STAYS_IN_APP = "What it says is in the app — it isn't sent outside it.";

/** The number an alert is about: its subject's id as the Pass prints an order's (#ABCD); none for a subject that isn't
 *  an id. */
export function refOf(id: unknown): string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? `#${id.slice(0, 4).toUpperCase()}` : "";
}

export type Outside = { line: string; text: string };

/** An alert as a Teams card or an email carries it: the words for its kind, its number, and its link — never its own
 *  title or body. (A critical's email says "Critical — " before the line; the card's colour says it.) */
export function alertOutside(a: { kind?: unknown; category?: unknown; title?: unknown; subject_id?: unknown; link?: unknown }, fallback = "/crew?s=day"): Outside {
  const ref = refOf(a.subject_id);
  return {
    line: `${alertWords(a)}${ref ? ` · ${ref}` : ""}`,
    text: `${STAYS_IN_APP}\n\nOpen it: ${APP_ORIGIN}${sitePath(a.link, fallback)}`,
  };
}

/** A booking lead's email: that one came in, for which day and how many, and when — never who, how to reach them, where,
 *  or what they wrote. `submitted` is the time, as the function words it. */
export function bookingOutside(b: { event_date?: unknown; headcount?: unknown }, submitted: string): { subject: string; text: string } {
  const day = typeof b.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.event_date) ? b.event_date : "";
  const people = typeof b.headcount === "number" && Number.isFinite(b.headcount) && b.headcount > 0 ? Math.round(b.headcount) : 0;
  return {
    subject: `New booking lead${day ? ` — ${day}` : ""}`,
    text: [
      "Someone wants to book GT3PB.",
      "",
      `Submitted: ${submitted} ET`,
      day ? `Event date: ${day}` : null,
      people ? `Headcount: ${people}` : null,
      "",
      "Who they are, how to reach them and what they asked are in the app — they aren't sent outside it.",
      `Manage it: ${APP_ORIGIN}/crew?s=plan`,
    ].filter((l) => l !== null).join("\n"),
  };
}

/** A critical task's email to the person it is on: that it is theirs, and the link — not its label or its event, which
 *  can be a client's name. */
export function taskOutside(nowCritical: boolean): { subject: string; text: string } {
  return {
    subject: nowCritical ? "A task of yours is critical now" : "A critical task is yours",
    text: [`${nowCritical ? "A task you're on is critical now." : "You're on a critical task."} ${STAYS_IN_APP}`, "", `Your day: ${APP_ORIGIN}/crew?s=day`].join("\n"),
  };
}
