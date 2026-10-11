// ONE LIST OF WHAT IS DUE (2026-10-11, the dispatch round).
//
// Live Ops' Due next was three cards in the order their days fall: the pickup drop, the Sunday porches, the office
// route. Each folds to one row until its day, so "what leaves the truck next, and is any of it in trouble?" took four
// reads: three cards opened one by one, and the Pass's button for the cups placed ahead. A porch the driver found not
// home was a word inside a folded card; an office stop past its window said nothing at all.
//
// This is that answer as one list, soonest first: every pickup pack, porch, office delivery and cup placed ahead, one
// row each — when, the channel, who or where, how many, and its state and what is wrong, in words (scheduled, held, not
// home, issue, late, unpaid). The cards stay the work; a row opens its card (DUE_CARD), at its own row where the card
// draws one (dueAnchor).
//
// WHY NOT all_orders. The four-channel view (0153 → 0358) is security_invoker, so the crew would read it under the same
// RLS as the tables. But it carries none of what a row says: no due day (only created_at), no name or address, no
// count, no window, no driver's note, no ready_from — and an office delivery joins it only once its day has come, which
// is every row this list is for. Widening it would be a migration for what the cards already read. So the list is built
// from what the cards read — each hands its rows up (onRows) — and the cups placed ahead, which no card reads.
//
// Pure: no React, no Supabase, no clock it was not handed. scripts/duenext.test.mjs runs every function here.
import { isSettled } from "./settled";
import { addDays, clockTime, dayFromKey, etDayKey, weekdayOf } from "./dates";
import { windowHours } from "./office";

export type DueChannel = "pickup" | "porch" | "office" | "cup";
/** The order a tie is broken in on the same minute: the channels' own order on Live Ops, then the pass. */
export const DUE_CHANNELS: readonly DueChannel[] = ["pickup", "porch", "office", "cup"];
/** The channel's word on a row. */
export const CHANNEL_WORD: Record<DueChannel, string> = { pickup: "Pickup", porch: "Porch", office: "Office", cup: "Cup" };
/** What a tap on a row opens, said to a screen reader. */
const OPENS: Record<DueChannel, string> = { pickup: "the pickup drop", porch: "Sunday delivery", office: "the office route", cup: "the Pass" };

/** Each card's id on Live Ops: a row opens its card by it, and so does a link (lib/anchors, ?a=). */
export const DUE_CARD = { pickup: "due-pickup", porch: "due-porch", office: "due-office" } as const;
/** A row's own id inside its card, where the card draws one — a porch, an office stop. */
export const dueAnchor = (channel: "porch" | "office", id: string): string => `${channel}-${id}`;

// ── WHEN A WINDOW OPENS AND CLOSES ─────────────────────────────────────────────────────────────────
// A porch is promised a window in words ("5–8 AM", written by the checkout, 0139's default); an office stop a code
// ('mon_0500_0800', lib/office windowHours reads it out). Both are wall-clock times on the delivery's day where the
// delivery is — Eastern for both markets today (lib/markets MARKET_TZ) — and the Sunday porch run lands on the two
// Sundays a year the clocks change, so the instant is worked out in the zone rather than added to midnight.
const ET = "America/New_York";
const PARTS = new Map<string, Intl.DateTimeFormat>();
function partsIn(ms: number, tz: string): Record<string, number> {
  let f = PARTS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    PARTS.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(ms)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return p;
}
/** How far a zone's clock is from UTC at an instant, in ms (EDT: −4 hours). */
function offsetAt(ms: number, tz: string): number {
  const p = partsIn(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
/** The instant a wall-clock time on a calendar day is, in a zone. Asked twice, so a day the clocks change still lands
 *  on the hour a person would name. */
export function wallAt(day: string, h: number, m: number, tz: string = ET): number {
  const [y, mo, d] = String(day).slice(0, 10).split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  return guess - offsetAt(guess - offsetAt(guess, tz), tz);
}

export type Window = { start: number; end: number };
const to24 = (h: number, half: string) => (h % 12) + (half.toUpperCase() === "PM" ? 12 : 0);
/** A porch's window, as written: "5–8 AM", "5:30–8 AM", "11 AM–2 PM". Null when the words are not a window — and a
 *  window nobody can read is never called late. */
export function porchWindow(day: string, text: string | null | undefined): Window | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i.exec(text ?? "");
  if (!m) return null;
  // A 12-hour clock: every hour here has its AM or PM, so it is 1 to 12, and a minute is under 60.
  const [h1, m1, h2, m2] = [+m[1], +(m[2] ?? 0), +m[4], +(m[5] ?? 0)];
  if (h1 < 1 || h1 > 12 || h2 < 1 || h2 > 12 || m1 > 59 || m2 > 59) return null;
  const endH = to24(h2, m[6]);
  // "5–8 AM" says AM once, for both. "11–2 PM" is 11 in the morning: a start after its end took the end's half wrongly.
  let startH = to24(h1, m[3] ?? m[6]);
  if (!m[3] && startH * 60 + m1 > endH * 60 + m2) startH = to24(h1, "AM");
  return { start: wallAt(day, startH, m1), end: wallAt(day, endH, m2) };
}
/** An office stop's window, from its code ('mon_0500_0800' — the day, then 24-hour start and end), in Eastern time. */
export function officeWindow(day: string, code: string | null | undefined): Window | null {
  const m = /^[a-z]{3}_(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(code ?? "");
  if (!m) return null;
  return { start: wallAt(day, +m[1], +m[2]), end: wallAt(day, +m[3], +m[4]) };
}

// ── WHAT EACH CARD HANDS UP ────────────────────────────────────────────────────────────────────────
// The columns each card already selects (select("*")), named — the list reads nothing else.
export type FeedStatus = "loading" | "ready" | "error";
export type PackIn = {
  id: string; name: string; size: number; drop_date: string; stage?: string | null; picked_up: boolean; canceled_at?: string | null;
  paid?: boolean | null; payment_id?: string | null; payment_status?: string | null; collected_at?: string | null; collected_via?: string | null;
};
export type PorchIn = {
  id: string; name: string;
  delivery_date: string; delivery_window?: string | null; pack_size: number; status: string; payment_status: string;
  driver_note?: string | null; canceled_at?: string | null;
};
export type OfficeIn = {
  id: string; company: string;
  delivery_date: string; delivery_window: string | null; gallons: number; status: string;
  payment_status: string; billing_terms: string; canceled_at?: string | null;
};
export type CupIn = {
  id: string; customer: string | null; items: readonly string[] | null; status: string; ready_from: string | null;
  paid?: boolean | null; payment_id?: string | null; payment_status?: string | null; collected_at?: string | null;
};
/** The drop the pickup board is working (lib/dropDate nextDropDay): its ET day, and its stop's start when it came from one. */
export type PickupFeed = { status: FeedStatus; day: string | null; at: string | null; rows: readonly PackIn[] };
/** The Sunday card's run, and the undelivered porches it carries from earlier runs. */
export type PorchFeed = { status: FeedStatus; run: readonly PorchIn[]; earlier: readonly PorchIn[] };
/** The office route: every stop up to its next delivery day, an overdue one first. */
export type OfficeFeed = { status: FeedStatus; rows: readonly OfficeIn[] };
export type CupFeed = { status: FeedStatus; rows: readonly CupIn[] };
export type DueFeeds = { pickup: PickupFeed; porch: PorchFeed; office: OfficeFeed; cup: CupFeed };
export const NO_FEEDS: DueFeeds = {
  pickup: { status: "loading", day: null, at: null, rows: [] },
  porch: { status: "loading", run: [], earlier: [] },
  office: { status: "loading", rows: [] },
  cup: { status: "loading", rows: [] },
};

// ── STATES AND WHAT IS WRONG, IN WORDS ─────────────────────────────────────────────────────────────
// A row's first word is where it is (scheduled, brewed, out for delivery, reserved…); what follows is what needs a
// person (late, unpaid). A held or not-home porch is both at once: it is where it is because something went wrong.
// The tone only colours a word that is already there.
export type FlagTone = "crit" | "warn" | "plain";
export type DueFlag = { word: string; tone: FlagTone };
const flag = (word: string, tone: FlagTone = "plain"): DueFlag => ({ word, tone });

/** The driver's "Not home" (components/DriverRun writes status 'issue' with this note). Any other issue is an issue. */
export const notHome = (o: Pick<PorchIn, "status" | "driver_note">): boolean => o.status === "issue" && /^not home/i.test(o.driver_note ?? "");

/** Past its window and not yet at the door: still scheduled, brewed or out. Held, not home and delivered are outcomes,
 *  not lateness — and a window nobody can read is never called late. The Sunday card says it on the porch's row too. */
export function porchLate(o: Pick<PorchIn, "status" | "delivery_date" | "delivery_window">, nowMs: number): boolean {
  if (o.status !== "received" && o.status !== "brewed" && o.status !== "out_for_delivery") return false;
  const w = porchWindow(o.delivery_date, o.delivery_window);
  return !!w && nowMs > w.end;
}

export function porchFlags(o: PorchIn, nowMs: number): DueFlag[] {
  const f: DueFlag[] = [];
  if (o.status === "held_for_pickup") f.push(flag("held", "warn"));
  else if (o.status === "issue") f.push(flag(notHome(o) ? "not home" : "issue", "warn"));
  else {
    f.push(flag(o.status === "brewed" ? "brewed" : o.status === "out_for_delivery" ? "out for delivery" : "scheduled"));
    if (porchLate(o, nowMs)) f.push(flag("late", "crit"));
  }
  if (o.payment_status === "refunded") f.push(flag("refunded", "warn"));
  else if (o.payment_status !== "paid") f.push(flag("unpaid", "warn"));
  return f;
}

/** Office money that is owed now: a prepaid stop not yet paid, or a payment that failed. A net-terms stop is invoiced
 *  after it is delivered (components/OfficeOrders, MONEY AFTER THE CUTOFF) — not unpaid before then. */
export const officeUnpaid = (o: Pick<OfficeIn, "billing_terms" | "payment_status">): boolean =>
  o.payment_status === "failed" || (o.billing_terms === "prepaid" && o.payment_status === "pending");

/** Past its window and not logged — delivered and not delivered are both logged. The office route says it on the row. */
export function officeLate(o: Pick<OfficeIn, "status" | "delivery_date" | "delivery_window" | "canceled_at">, nowMs: number): boolean {
  if (o.canceled_at || o.status === "delivered" || o.status === "issue") return false;
  const w = officeWindow(o.delivery_date, o.delivery_window);
  return !!w && nowMs > w.end;
}

export function officeFlags(o: OfficeIn, nowMs: number): DueFlag[] {
  const f: DueFlag[] = [];
  if (o.status === "issue") f.push(flag("not delivered", "warn"));
  else {
    f.push(flag(o.status === "brewed" ? "brewed" : o.status === "out_for_delivery" ? "on the way" : o.status === "held_for_pickup" ? "held" : "scheduled"));
    if (officeLate(o, nowMs)) f.push(flag("late", "crit"));
  }
  if (officeUnpaid(o)) f.push(flag("unpaid", "warn"));
  return f;
}

const PACK_WORD: Record<string, string> = { reserved: "reserved", preparing: "preparing", ready: "ready", en_route: "en route" };
export function packFlags(o: PackIn): DueFlag[] {
  const f = [flag(PACK_WORD[o.stage ?? "reserved"] ?? "reserved")];
  if (!isSettled(o)) f.push(flag("unpaid", "warn"));
  return f;
}

export function cupFlags(o: CupIn): DueFlag[] {
  const f = [flag(o.status === "preparing" ? "preparing" : o.status === "ready" ? "ready" : "scheduled")];
  if (!isSettled(o)) f.push(flag("unpaid", "warn"));
  return f;
}

// ── ONE ROW EACH ───────────────────────────────────────────────────────────────────────────────────
export type DueRow = {
  key: string;            // channel:id — unique across the list
  channel: DueChannel;
  id: string;
  day: string;            // the ET business day it is due
  at: number | null;      // the instant it is due from; null = sometime that day (sorts after that day's timed rows)
  time: string;           // "5–8 AM", "11:00am" — empty when only the day is known
  who: string;            // who it is for: a name, or the office's company
  count: string;          // "12 bottles", "5 gal", "6-pack", "2 drinks"
  flags: DueFlag[];
  card: string | null;    // the Live Ops card it opens (DUE_CARD); null = the Pass
  anchor: string | null;  // its own row inside that card, when the card draws one
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The drop's packs still to hand over: not picked up, not canceled, on the drop the board is working. */
export function pickupRows(feed: PickupFeed): DueRow[] {
  if (!feed.day) return [];
  const at = feed.at ? Date.parse(feed.at) : null;
  return feed.rows
    .filter((o) => o.drop_date === feed.day && !o.canceled_at && !o.picked_up && o.stage !== "picked_up")
    .map((o) => ({
      key: `pickup:${o.id}`, channel: "pickup", id: o.id, day: feed.day as string,
      at: at !== null && Number.isFinite(at) ? at : null, time: feed.at ? clockTime(feed.at) : "",
      who: o.name, count: `${o.size}-pack`, flags: packFlags(o), card: DUE_CARD.pickup, anchor: null,
    }));
}

/** The run's porches not yet delivered, and the ones carried from earlier runs (held, not home) until someone moves them. */
export function porchRows(feed: PorchFeed, nowMs: number): DueRow[] {
  const seen = new Set<string>();
  return [...feed.earlier, ...feed.run]
    .filter((o) => !o.canceled_at && o.status !== "delivered" && !seen.has(o.id) && (seen.add(o.id), true))
    .map((o) => {
      const w = porchWindow(o.delivery_date, o.delivery_window);
      return {
        key: `porch:${o.id}`, channel: "porch" as const, id: o.id, day: o.delivery_date,
        at: w ? w.start : null, time: (o.delivery_window ?? "").trim(),
        who: o.name, count: plural(o.pack_size, "bottle", "bottles"),
        flags: porchFlags(o, nowMs), card: DUE_CARD.porch, anchor: dueAnchor("porch", o.id),
      };
    });
}

/** The route's stops not yet delivered — an overdue one stays until it is logged. */
export function officeRows(feed: OfficeFeed, nowMs: number): DueRow[] {
  return feed.rows
    .filter((o) => !o.canceled_at && o.status !== "delivered")
    .map((o) => {
      const w = officeWindow(o.delivery_date, o.delivery_window);
      return {
        key: `office:${o.id}`, channel: "office" as const, id: o.id, day: o.delivery_date,
        at: w ? w.start : null, time: windowHours(o.delivery_window),
        who: o.company, count: `${Math.round(Number(o.gallons))} gal`,
        flags: officeFlags(o, nowMs), card: DUE_CARD.office, anchor: dueAnchor("office", o.id),
      };
    });
}

/** Cups placed ahead whose time has not come. The minute it comes the ticket is the pass's, and it leaves this list —
 *  nothing in the database changes then, which is why the list is handed the clock. */
export function cupRows(feed: CupFeed, nowMs: number): DueRow[] {
  return feed.rows
    .filter((o) => o.status !== "done" && o.status !== "void" && !!o.ready_from && Date.parse(o.ready_from) > nowMs)
    .map((o) => {
      const at = Date.parse(o.ready_from as string);
      return {
        key: `cup:${o.id}`, channel: "cup" as const, id: o.id, day: etDayKey(new Date(at)), at, time: clockTime(o.ready_from),
        who: o.customer?.trim() || "Guest", count: plural(o.items?.length ?? 0, "drink", "drinks"),
        flags: cupFlags(o), card: null, anchor: null,
      };
    });
}

/** Soonest first: by day; inside a day the timed rows in clock order, then the ones due sometime that day; a tie on
 *  the minute goes in the channels' order, then by name. A row carried from an earlier day is the first thing on it. */
export function byDue(a: DueRow, b: DueRow): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if ((a.at === null) !== (b.at === null)) return a.at === null ? 1 : -1;
  if (a.at !== null && b.at !== null && a.at !== b.at) return a.at - b.at;
  if (a.channel !== b.channel) return DUE_CHANNELS.indexOf(a.channel) - DUE_CHANNELS.indexOf(b.channel);
  return a.who.localeCompare(b.who) || a.id.localeCompare(b.id);
}

export type DueList = { rows: DueRow[]; failed: DueChannel[]; loading: DueChannel[] };
/** The whole list, and which channels could not be read — a read that failed is never shown as nothing due. */
export function dueList(feeds: DueFeeds, nowMs: number): DueList {
  const rows = [...pickupRows(feeds.pickup), ...porchRows(feeds.porch, nowMs), ...officeRows(feeds.office, nowMs), ...cupRows(feeds.cup, nowMs)].sort(byDue);
  const failed = DUE_CHANNELS.filter((c) => feeds[c].status === "error");
  const loading = DUE_CHANNELS.filter((c) => feeds[c].status === "loading");
  return { rows, failed, loading };
}

// ── THE WORDS ON A ROW ─────────────────────────────────────────────────────────────────────────────
const MD = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
/** "Sun, Oct 18" — a day key's weekday and date, read from local noon so no zone can move it. */
export const dayAndDate = (day: string): string => `${weekdayOf(day, "short")}, ${MD.format(dayFromKey(day))}`;
/** "Today", "Tomorrow", "Yesterday", "Sat" inside the week ahead, "Sun, Oct 4" otherwise — the business day's words. */
export function dueDay(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  const diff = Math.round((dayFromKey(day).getTime() - dayFromKey(today).getTime()) / 864e5);
  return diff > 1 && diff < 7 ? weekdayOf(day, "short") : dayAndDate(day);
}

/** The day in the row's lead column, which holds about eight letters: "Today", "Tomorrow", "Sat" inside the week ahead,
 *  else the date ("Oct 4") — yesterday included. The whole day is read aloud (dueLabel). */
export function dueLead(day: string, today: string): string {
  const d = dueDay(day, today);
  return d === "Yesterday" || d.includes(", ") ? MD.format(dayFromKey(day)) : d;
}

/** The row read aloud: when, the channel, who, how many, its words — and where a tap takes you. */
export function dueLabel(r: DueRow, today: string): string {
  const when = `${dueDay(r.day, today)}${r.time ? ` ${r.time}` : ""}`;
  return `${[when, CHANNEL_WORD[r.channel], r.who, r.count, r.flags.map((f) => f.word).join(", ")].filter(Boolean).join(" · ")}. Opens ${OPENS[r.channel]}.`;
}

/** The channels a failed read is about, as a sentence: "the porches and the office route". */
const FEED_WORD: Record<DueChannel, string> = { pickup: "the pickups", porch: "the porches", office: "the office route", cup: "the cups placed ahead" };
export function feedsWord(cs: readonly DueChannel[]): string {
  const w = cs.map((c) => FEED_WORD[c]);
  return w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}
