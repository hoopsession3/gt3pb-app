// TODAY, BY STATE (2026-10-13, R3 of the customer audit — "the state-aware home", boards 03–06, approved).
//
// Today was the same page whatever the truck was doing: the usual's "Order again" 247 points down, a stamp card, the pack
// pitch and the day generator. With the truck off, Order again opened a checkout that said it was off; with a cup being
// made, the order lived in a bar above the tabs while the page under it still sold the usual. Now the page leads with
// the one thing that is true now, and everything else is a row under it:
//
//   making   a cup order in progress          the order: its number, where it is, On my way / I'm outside
//   open     the truck takes cup orders now   Order again (the usual, priced by the server) — or the first cup
//   closing  packing up within the hour       says so; walk-ups still served
//   later    the next stop's window is shut   the next stop, and when cup orders open
//   none     nothing on the calendar          says so
//   unknown  the truck not read yet           the usual, claiming nothing (as Today always was)
//
// Pure: the page reads (components/today), this decides — so every state is pinned without a phone (scripts/smoke.cjs).

import type { Ordering, OrderingStop } from "./ordering";
import { ACTIVE, leadOrder, type TodayOrder } from "./activeOrder";

// The order in progress and its number live in lib/activeOrder, which the order bar on every page imports alone.
export { leadOrder, orderNo } from "./activeOrder";
export type { TodayOrder } from "./activeOrder";

export type TodayLead<T extends TodayOrder = TodayOrder> =
  | { kind: "unknown" }
  | { kind: "making"; order: T; more: number }
  | { kind: "open"; stop: OrderingStop | null; pouring: boolean; readyFrom: string | null }
  | { kind: "closing"; stop: OrderingStop | null }
  | { kind: "later"; stop: OrderingStop | null; opensAt: string | null }
  | { kind: "none" };


/** What Today leads with. `ordering` null = not read yet (or never readable): the page claims nothing about the truck. */
export function todayLead<T extends TodayOrder>(orders: readonly T[], ordering: Ordering | null): TodayLead<T> {
  const o = leadOrder(orders);
  if (o) return { kind: "making", order: o, more: orders.filter((x) => ACTIVE.has(x.status)).length - 1 };
  if (!ordering) return { kind: "unknown" };
  switch (ordering.state) {
    case "live":
    case "started": return { kind: "open", stop: ordering.stop, pouring: true, readyFrom: null };
    case "ahead": return { kind: "open", stop: ordering.stop, pouring: false, readyFrom: ordering.readyFrom };
    case "closing": return { kind: "closing", stop: ordering.stop };
    case "early": return { kind: "later", stop: ordering.stop, opensAt: ordering.opensAt };
    default: return { kind: "none" };
  }
}

/** The usual: the drinks of the member's last order that was picked up — never a void, never one still in progress
 *  (Today used to take the newest order of any status, so a cancelled order became "your usual"). */
export function usualOf(orders: readonly TodayOrder[]): string[] | null {
  const done = orders.filter((o) => o.status === "done" && Array.isArray(o.items) && o.items.length > 0)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return done.length ? [...done[0].items] : null;
}

/** What Order again would put in the cart now: the usual less what is off the menu, sold out, or not poured at this
 *  stop — the same drinks AppProvider's reorder keeps, so the button never names a drink the cart will not hold. */
export function orderable(items: readonly string[], onMenu: ReadonlySet<string>, soldOut: ReadonlySet<string>, stopMenu: ReadonlySet<string> | null): string[] {
  return items.filter((id) => onMenu.has(id) && !soldOut.has(id) && (!stopMenu || stopMenu.has(id)));
}

/** The drinks in words, a repeat counted once: "FLOW ×2 · TIDE". */
export function drinksWords(items: readonly string[], nameOf: (slug: string) => string): string {
  const n = new Map<string, number>();
  for (const id of items) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n].map(([id, q]) => (q > 1 ? `${nameOf(id)} ×${q}` : nameOf(id))).join(" · ");
}

/** Where an order is, in four steps: in, being made, ready, picked up. */
export const ORDER_STEPS = ["In", "Making", "Ready", "Picked up"] as const;
export function stepOf(status: string): number {
  return status === "done" ? 3 : status === "ready" ? 2 : status === "preparing" ? 1 : 0;
}

const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "numeric", day: "numeric" });
/** A stop's day as the truck keeps it, Eastern: "Sat 10/17". */
export function etDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : ET_DAY.format(d).replace(",", "");
}
