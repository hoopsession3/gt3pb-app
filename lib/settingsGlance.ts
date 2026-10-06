// WHAT A SETTINGS ROW SAYS IT IS SET TO (2026-10-06, the settings round; by category the same day).
//
// Settings is a list of rows, closed at rest, the way a phone's Settings is. Each row says what it
// holds (the line under its title) and, where that is one fact, what it is set to right now — on the
// right, the way a phone says "Wi-Fi … Home ›". So an owner reads "Checkout & payments — Pay at pickup
// only" without opening anything, and opens the row only to change it.
//
// These are the words for those values, one function per row, so the words have one home and the
// smoke holds each to its cases. A row whose state is not one fact (the menu, the codes, the copy)
// shows no value. A value not read yet is null — the row shows nothing until it is; a read that failed
// is UNREAD, "Couldn’t read". Never a guess: "Off" for a switch nobody could read is a lie.

import { money } from "./money";
import { OFFICE } from "./office";
import { TEXT_SIZE_WORDS } from "./textSize";
import type { ThemeChoice } from "./theme";

export type Glance = { text: string; warn?: boolean } | null;

/** A row whose value could not be read says so — not nothing, which reads as "still loading", and never
 *  a guess. The row's own panel says why when it is opened. */
export const UNREAD: Glance = { text: "Couldn’t read", warn: true };

/** Checkout & payments: how a guest can pay right now. `card` is whether card checkout is set up
 *  (the Square keys, lib/square); `pickup` is live_status.pay_at_pickup (null: not read). */
export function payGlance(card: boolean, pickup: boolean | null | undefined): Glance {
  if (pickup == null) return null;
  if (card && pickup) return { text: "Card + pay at pickup" };
  if (card) return { text: "Card only" };
  if (pickup) return { text: "Pay at pickup only" };
  return { text: "No way to pay", warn: true };
}

/** The cup-ordering dial's words for a lead, in hours — the dial's buttons and its row both say these. */
export const leadLabel = (h: number): string => (h === 0 ? "Live only" : `${h}h before`);

/** Ordering & delivery: when cup pre-orders open (live_status.preorder_lead_h; 0 is live only) and
 *  office delivery's price a gallon — the row's two facts, the dial's first. An unset lead reads as 4,
 *  as the ordering rule does (lib/ordering); an unset price as the form's default (lib/office). */
export function orderingGlance(hours: number | null | undefined, priceCents: number | null | undefined, read: boolean): Glance {
  if (!read) return null;
  return { text: `${leadLabel(hours ?? 4)} · ${money(priceCents ?? OFFICE.pricePerGallonCents)}/gal` };
}

/** The founder digest's cadences, in the words its buttons and its row both use. */
export type DigestCadence = "off" | "daily" | "weekly";
export const DIGEST_LABELS: Record<DigestCadence, string> = { off: "Off", daily: "Daily", weekly: "Weekly" };

/** The founder digest's cadence (live_status.digest_cadence; daily when unset, as its panel reads it). */
export function digestGlance(cadence: string | null | undefined, read: boolean): Glance {
  if (!read) return null;
  return { text: DIGEST_LABELS[cadence === "off" || cadence === "weekly" ? cadence : "daily"] };
}

/** The three looks in words — Appearance's buttons (components/YouPrefs) and the Display row's value
 *  both say these. Here, with Settings' other words, not in lib/theme: every page loads lib/theme. */
export const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = { day: "Day", dark: "Dark", auto: "Auto" };

/** Display on this phone: the look (lib/theme) and the text size (components/DisplayToggle's preference). */
export function displayGlance(d: { scale: number; bold: boolean; roomy: boolean }, look: ThemeChoice): Glance {
  return { text: [THEME_LABELS[look] ?? THEME_LABELS.day, TEXT_SIZE_WORDS[d.scale] ?? TEXT_SIZE_WORDS[0], d.bold ? "bold" : "", d.roomy ? "roomy" : ""].filter(Boolean).join(" · ") };
}

/** "10pm", "7am" — the hour alone, for a value that has to fit beside a title. */
export const hourShort = (h: number): string => `${h % 12 || 12}${h >= 12 ? "pm" : "am"}`;

/** Notifications: how many categories are muted, and the quiet window when one is set. Null: not read. */
export function notifyGlance(muted: readonly string[] | null, quietStart: number | null, quietEnd: number | null): Glance {
  if (muted === null) return null;
  // The same rule the inbox keeps (lib/useMyAlerts.inQuietHours): both ends set, and not the same hour.
  const quiet = quietStart != null && quietEnd != null && quietStart !== quietEnd ? `${hourShort(quietStart)}–${hourShort(quietEnd)}` : null;
  if (muted.length && quiet) return { text: `${muted.length} muted · quiet ${quiet}` };
  if (muted.length) return { text: `${muted.length} muted` };
  if (quiet) return { text: `Quiet ${quiet}` };
  return { text: "All on" };
}

/** Lane owners: how many of the lanes have one. */
export function lanesGlance(owned: number, total: number): Glance {
  if (total === 0) return null;
  return { text: owned === total ? "All owned" : `${owned} of ${total} owned`, warn: owned === 0 };
}

/** Outlook's sync, from /api/outlook/status. Null: not read (a refusal is not "not connected"). */
export function outlookGlance(s: { configured: boolean; connected: boolean } | null): Glance {
  if (!s) return null;
  return { text: s.connected ? "Connected" : s.configured ? "Not connected" : "Not set up" };
}
