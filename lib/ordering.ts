// THE ORDERING RULE — can a cup be ordered online now, for which stop, and when will it be made
// (2026-10-04). Pure and deterministic: the phone and /api/checkout run this same function on the
// same reads (lib/orderingRead), so the screen and the server cannot disagree about it again.
//
// ── WHY ────────────────────────────────────────────────────────────────────────────────────────
// Before this file the question had three answers, and a fourth question nobody asked:
//
//   · components/useOrderingOpen (the drink sheet and checkout) read the city's own live switch
//     (market_live, 0285) and the next stop's own order-ahead lead when the owner had set one (0191);
//   · app/api/checkout — the authority, asked before any charge — read the live_status SINGLETON and
//     the global lead: never the city's switch, never the stop's lead. An owner who gave a stop a
//     24-hour order-ahead window got a menu that said "Add to order", a checkout that took the card
//     number, and "The truck isn't pouring right now" at Pay;
//   · components/FindUs asked nothing. With nothing on the schedule it still led with "PRE-ORDER ·
//     SKIP THE LINE", and it alone knew the operator's rule that online ordering closes an hour before
//     a stop's close time — a rule the menu, the checkout and the server never enforced;
//   · and none of them knew WHEN the order would be made. Every pre-order was promised "Ready in ~8
//     min" — one placed at 7am for an 11am stop included — and the crew's pass aged it from 7am, so
//     the truck opened to a red ticket and "1 guest past 8 min — step over and reassure".
//
// ── THE STATES ─────────────────────────────────────────────────────────────────────────────────
//   live     the truck is pouring                           open · made now
//   started  a stop is under way, the live switch not flipped open · made now (the missed-toggle grace)
//   ahead    inside the lead window before the next stop     open · made from its start (orders.ready_from)
//   closing  the stop closes within the hour                 closed online · walk-ups still served
//   early    the next stop's window has not opened           closed · opens at start − lead (null: when live)
//   none     nothing scheduled and not live                  closed
//
// The windows themselves are the ones the app already had — 4 hours before a stop by default
// (live_status / the city's preorder_lead_h, 0137/0285), the stop's own lead when the owner set one
// (0191), the 8-hour grace after a start for a stop nobody flipped live (lib/road's), and lead 0 as
// strict live-only. What is new is that there is one copy of them, plus the hour-before-close rule
// FindUs held alone, plus the answer to "when".

import { STOP_DONE_GRACE_MS } from "./road";
import { etWhen } from "./dates";

/** Default lead before a stop (live_status.preorder_lead_h, 0137): cups open 4 hours ahead. */
export const PREORDER_LEAD_MS = 4 * 60 * 60 * 1000;
/** A stop with no close time takes orders until lib/road says it is over — 8 hours past its start. */
export const PREORDER_TAIL_MS = STOP_DONE_GRACE_MS;
/** Online ordering stops an hour before a stop's close time: no orders the crew cannot fill before
 *  packing up (moved here from components/FindUs, which was the only place it was true). */
export const ORDERS_CLOSE_BEFORE_END_MS = 60 * 60 * 1000;

export const preorderLeadMs = (hours: number | null | undefined): number =>
  typeof hours === "number" && Number.isFinite(hours) ? Math.max(0, hours) * 60 * 60 * 1000 : PREORDER_LEAD_MS;

export type OrderingStop = {
  id: string;
  name: string | null;
  starts_at: string;
  ends_at: string | null;
  where: string | null;   // location_text, else address — what Find Us prints under Where
  leadMs: number;         // resolved: the stop's own order-ahead lead, else the city's
  pickup: boolean;        // the stop's pickup switch (0191)
};
export type OrderingState = "live" | "started" | "ahead" | "closing" | "early" | "none";
export type Ordering = {
  state: OrderingState;
  open: boolean;
  stop: OrderingStop | null;   // the stop an order placed now is for (closed: the one it is waiting on)
  opensAt: string | null;      // early: when cup orders open; null = when the truck goes live
  readyFrom: string | null;    // ahead: the stop's start; null = made as soon as it is in
};

// ── a stops row, as the reader fetches it ──────────────────────────────────────────────────────
export type StopRow = {
  id: string; name?: string | null; starts_at?: string | null; ends_at?: string | null;
  location_text?: string | null; address?: string | null;
  order_ahead_enabled?: boolean | null; order_ahead_lead_min?: number | null; pickup_enabled?: boolean | null;
};

/** One stop, with its lead resolved: the owner's per-stop order-ahead lead wins (0191), else the city's. */
export function orderingStop(r: StopRow, cityLeadMs: number): OrderingStop | null {
  if (!r.starts_at) return null;
  const own = r.order_ahead_enabled && r.order_ahead_lead_min != null && Number.isFinite(Number(r.order_ahead_lead_min))
    ? Math.max(0, Number(r.order_ahead_lead_min)) * 60_000 : null;
  return {
    id: r.id, name: r.name?.trim() || null, starts_at: r.starts_at, ends_at: r.ends_at ?? null,
    where: r.location_text?.trim() || r.address?.trim() || null,
    leadMs: own ?? cityLeadMs, pickup: !!r.pickup_enabled,
  };
}

type Span = { s: OrderingStop; start: number; end: number; hasEnd: boolean; close: number };
function span(s: OrderingStop): Span | null {
  const start = Date.parse(s.starts_at);
  if (!Number.isFinite(start)) return null;
  const e = s.ends_at ? Date.parse(s.ends_at) : NaN;
  const hasEnd = Number.isFinite(e) && e > start;
  const end = hasEnd ? e : start + PREORDER_TAIL_MS;
  // A stop shorter than the hour still takes orders up to its start (made from then).
  return { s, start, end, hasEnd, close: hasEnd ? Math.max(start, end - ORDERS_CLOSE_BEFORE_END_MS) : end };
}
// Boundaries kept exactly where they were: a known close time stops orders AT close − 1h (FindUs'
// `now < end − 60 min`); with no close time the grace is inclusive at 8h (preorderWindow's `<=`).
const over = (p: Span, now: number) => (p.hasEnd ? now >= p.end : now > p.end);
const taking = (p: Span, now: number) => (p.hasEnd ? now < p.close : now <= p.close);

const result = (state: OrderingState, stop: OrderingStop | null, extra: Partial<Ordering> = {}): Ordering => ({
  state, open: state === "live" || state === "started" || state === "ahead", stop, opensAt: null, readyFrom: null, ...extra,
});

/**
 * Can a cup be ordered online now? `stops` are the city's stops still on the road (lib/road), any
 * order; `liveStopId` is live_status.current_stop_id — trusted only when it is one of them.
 */
export function orderingNow(nowMs: number, isLive: boolean, stops: readonly OrderingStop[], liveStopId: string | null = null): Ordering {
  const all = stops.map(span).filter((p): p is Span => p !== null);
  const pointer = liveStopId ? all.find((p) => p.s.id === liveStopId) ?? null : null;
  // A live switch left on past the close time of the stop it was flipped at is not a truck pouring:
  // Find Us stops saying Live 45 minutes before that close, and nobody is there to make a cup. Only
  // a real close time does this — with none, the switch is the crew's word, as on Find Us.
  const live = isLive && !(pointer && pointer.hasEnd && nowMs >= pointer.end);
  const road = all.filter((p) => !over(p, nowMs)).sort((a, b) => a.start - b.start);
  const underWay = road.filter((p) => p.start <= nowMs);
  const next = road.find((p) => p.start > nowMs) ?? null;
  // The next stop's own window, opened early: the lead before it has begun.
  const nextOpen = next && next.s.leadMs > 0 && nowMs >= next.start - next.s.leadMs ? next : null;
  const ahead = (p: Span) => result("ahead", p.s, { readyFrom: p.s.starts_at });

  if (live) {
    // Where the truck is: the stop it went live at, else the one under way. Neither → an
    // unscheduled stop, which is still a truck pouring.
    const here = (pointer && road.includes(pointer) ? pointer : null) ?? underWay[0] ?? null;
    if (!here || taking(here, nowMs)) return result("live", here?.s ?? null);
    // Packing up within the hour. The next stop may already be taking orders of its own.
    return nextOpen && nextOpen !== here ? ahead(nextOpen) : result("closing", here.s);
  }

  const cur = underWay[0];
  if (cur) {
    if (cur.s.leadMs <= 0) return result("early", cur.s);   // strict live-only: the switch is the gate
    if (taking(cur, nowMs)) return result("started", cur.s);
    return nextOpen ? ahead(nextOpen) : result("closing", cur.s);
  }
  if (!next) return result("none", null);
  if (next.s.leadMs <= 0) return result("early", next.s);   // opens when the truck goes live
  if (nextOpen) return ahead(nextOpen);
  return result("early", next.s, { opensAt: new Date(next.start - next.s.leadMs).toISOString() });
}

// ── THE OLD QUESTION, KEPT ─────────────────────────────────────────────────────────────────────
// preorderWindow was the rule's previous home (lib/orderAhead). It is a one-stop question now —
// the same function, asked about one stop with no close time — so its answers cannot drift from
// orderingNow's, and the assertions that pinned it still pin this.
export type PreorderWindow = { open: boolean; reason: "live" | "window" | "early" | "none" };
export function preorderWindow(nowMs: number, isLive: boolean, nextStartISO: string | null | undefined, leadMs: number = PREORDER_LEAD_MS): PreorderWindow {
  const stops = nextStartISO ? [{ id: "next", name: null, starts_at: nextStartISO, ends_at: null, where: null, leadMs, pickup: false }] : [];
  const o = orderingNow(nowMs, isLive, stops);
  return { open: o.open, reason: o.state === "live" ? "live" : o.open ? "window" : o.state === "none" ? "none" : "early" };
}

// ── THE WORDS ──────────────────────────────────────────────────────────────────────────────────
// Said once, here, because the server says them too (the 409 and the confirmation email) and a
// promise worded two ways is two promises.

/** When it will be made — the line the confirmation screen and email both lead with. */
export function readyWords(o: Pick<Ordering, "state" | "readyFrom">, nowMs: number = Date.now()): string {
  if (o.state === "ahead" && o.readyFrom) return `We make it when we open — ${etWhen(o.readyFrom, nowMs)}.`;
  return "Ready in ~8 min.";
}

/** The confirmation screen's line under "Order in." — the made-when promise and the money half. The
 *  made-now wording is the one this screen has always used; only an order placed ahead reads new. */
export function confirmWords(readyFrom: string | null | undefined, paid: boolean, nowMs: number = Date.now()): string {
  if (!readyFrom) return paid ? "Ready in ~8 min — we'll have it waiting at the window." : "Ready in ~8 min — pay at the truck when you arrive.";
  return `${readyWords({ state: "ahead", readyFrom }, nowMs)} ${paid ? "It'll be waiting at the window." : "Pay at the truck when you arrive."}`;
}

/** Where to pick it up: the stop and its place, or the truck itself when it is live off-schedule. */
export function pickupWords(o: Pick<Ordering, "stop">): string {
  const s = o.stop;
  // The ZIP comes off, as Find Us takes it off its Where: noise to a person reading a receipt.
  const where = s?.where?.replace(/\s+\d{5}(?:-\d{4})?\s*$/, "").trim() || null;
  return (s && [s.name, where].filter(Boolean).join(" · ")) || "At the truck";
}

/** The ordering line while it is open ahead of a stop; null when the truck is pouring (the page's own line holds). */
export function openWords(o: Ordering, nowMs: number = Date.now()): string | null {
  return o.state === "ahead" && o.readyFrom ? `Order now — we make it when we open, ${etWhen(o.readyFrom, nowMs)}.` : null;
}

/**
 * Why cups cannot be ordered online right now, and when they can. Null when they can. `closing` is
 * the owner's own words for the last hour (site copy findus.cta_closed, whose default this is) —
 * the screens pass it so an edit reaches every one of them; the server says the default. `named:
 * false` leaves the stop's name off, for Find Us, whose headline already is the stop.
 */
export function closedWords(o: Ordering, opts: { nowMs?: number; closing?: string; named?: boolean } = {}): string | null {
  const nowMs = opts.nowMs ?? Date.now();
  switch (o.state) {
    case "closing": return opts.closing || "Online ordering’s closed for today — come see us at the bar before we pack up.";
    case "early": return o.opensAt
      ? `Cup orders open ${etWhen(o.opensAt, nowMs)}${opts.named !== false && o.stop?.name ? ` for ${o.stop.name}` : ""}.`
      : "Cup orders open when the truck goes live.";
    case "none": return "Cup orders open when the next stop is posted.";
    default: return null;
  }
}

/** The server's refusal (409), in the same words the page showed. */
export function refusalWords(o: Ordering, nowMs: number = Date.now()): string {
  const why = closedWords(o, { nowMs }) ?? "The truck isn’t taking cup orders right now.";
  return o.state === "closing" ? why : `${why} Reserve a pack instead.`;
}

// ── THE CREW'S CLOCK ───────────────────────────────────────────────────────────────────────────
// An order placed ahead of a stop is not late until the stop opens. The pass ages every ticket from
// this instant, so a 7am pre-order for an 11am stop reads "for 11:00am" until 11 and "3m" at 11:03.
type Clocked = { created_at: string; ready_from?: string | null };
/** When the clock on an order starts: its stop's opening when it was placed ahead, else when placed. */
export function orderClockFrom(o: Clocked): string {
  return o.ready_from && Date.parse(o.ready_from) > Date.parse(o.created_at) ? o.ready_from : o.created_at;
}
/** Placed ahead, and its stop has not opened yet. */
export const waitingToOpen = (o: Clocked, nowMs: number = Date.now()): boolean =>
  !!o.ready_from && Date.parse(o.ready_from) > nowMs;
/** The pass's badge for a ticket waiting on its stop: "for 11:00am" today, "for Sat at 11:00am" later. */
export function waitingLabel(readyFrom: string, nowMs: number = Date.now()): string {
  const w = etWhen(readyFrom, nowMs);
  return `for ${w.startsWith("today at ") ? w.slice("today at ".length) : w}`;
}
