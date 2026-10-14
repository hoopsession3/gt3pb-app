import { etDayKey, timeRange } from "./dates";
import { packClosesAt, pickupDayWords } from "./pickupDay";

// A LIMITED RESERVE'S PICKUP (0400, 2026-10-14 — R5 of the customer audit, "Limited Reserve: pay to hold"). A reserve is
// handed over at a stop on the schedule (reserves.stop_id): these are its words, and when it closes. Its own small
// module — the reserve card and its pay sheet, the crew's lists and the reserve routes read it.
//
// It closes by the pack rule (lib/pickupDay, 0397): 24 hours before its stop — the last moment it can be paid for, and
// the last a member can cancel it for a refund. One difference from a pack: a stop called off does not leave a reserve
// open (a pack's customer moves it; a reserve has nowhere to move), so it cannot be paid for until the crew names the
// new pickup (0400 reserve_closes_at, the same rule in SQL).

export type ReserveStop = { name?: string | null; starts_at: string | null; ends_at?: string | null; canceled_at?: string | null } | null | undefined;

/** "Sat, Oct 17 · 11:00am–2:00pm at WineXpress" — as much of it as the stop says. Empty with no stop or no date. */
export function reservePickupWords(stop: ReserveStop): string {
  if (!stop?.starts_at) return "";
  const day = pickupDayWords(etDayKey(new Date(stop.starts_at)));
  const time = timeRange(stop.starts_at, stop.ends_at ?? null);
  const where = stop.name?.trim();
  return `${day}${time ? ` · ${time}` : ""}${where ? ` at ${where}` : ""}`;
}

/** A stop in the crew's pickup list: "Sat, Oct 17 · WineXpress". */
export function reserveStopLabel(stop: ReserveStop): string {
  if (!stop) return "";
  const day = stop.starts_at ? pickupDayWords(etDayKey(new Date(stop.starts_at))) : "No date";
  return `${day} · ${stop.name?.trim() || "Truck stop"}`;
}

/** When a reserve for this pickup stops being paid for or canceled for a refund. Null: no stop, or one called off. */
export function reserveClosesAt(stop: ReserveStop): Date | null {
  if (!stop?.starts_at || stop.canceled_at) return null;
  return packClosesAt(etDayKey(new Date(stop.starts_at)), stop);
}

/** Can a reserve for this pickup be paid for — or canceled for a refund — at `nowMs`? Never with no stop or one called off. */
export function reserveOpen(stop: ReserveStop, nowMs: number = Date.now()): boolean {
  const at = reserveClosesAt(stop);
  return at !== null && nowMs < at.getTime();
}
