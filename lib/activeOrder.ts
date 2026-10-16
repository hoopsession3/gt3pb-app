// THE ORDER IN PROGRESS, AND ITS NUMBER (2026-10-13, R3 of the customer audit).
//
// The order bar (components/OrderStatus), which every page mounts, and Today (lib/today) lead with the same order and
// call it by the same number. These two live apart from lib/today so the bar carries them and nothing else: imported
// from lib/today, the whole of Today's logic rode the chunk every route loads, /privacy and /terms included
// (smoke:ui's weight, R3).

/** An order as Today and the bar read it — the member's own rows (RLS), lib/db's Order or anything shaped like it. */
export type TodayOrder = {
  id: string; items: string[]; status: string; created_at: string;
  total_cents?: number | null; paid?: boolean | null; payment_status?: string | null; collected_at?: string | null;
  ready_from?: string | null; eta_status?: "on_way" | "outside" | "late" | null; stop_id?: string | null;
};

/** The statuses of a cup order still in progress: in, being made, ready at the window. */
export const ACTIVE: ReadonlySet<string> = new Set(["new", "preparing", "ready"]);
const RANK: Record<string, number> = { ready: 3, preparing: 2, new: 1 };

/** The order to lead with: the most advanced of the member's open cup orders (ready, then being made, then in),
 *  the newest first among equals — the one the order bar shows. */
export function leadOrder<T extends TodayOrder>(orders: readonly T[]): T | null {
  const open = orders.filter((o) => ACTIVE.has(o.status));
  if (!open.length) return null;
  return [...open].sort((a, b) => (RANK[b.status] - RANK[a.status]) || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0];
}

/** An order's number as the window calls it — the first four of its id, as the bar and the Pass print it ("#4F2A"). */
export const orderNo = (id: string): string => `#${id.slice(0, 4).toUpperCase()}`;

// WHO CANCELED IT (2026-10-15, R7). A member's canceled order is said once: by the cancel's own answer when they canceled
// it here, by components/Notifications when the crew did. This phone remembers what it canceled itself, for a minute.
const mine = new Map<string, number>();
/** This phone just canceled this order — its own answer says so, and the realtime toast should not say it again. */
export function canceledHere(id: string, now = Date.now()): void { mine.set(id, now); }
/** Whether this phone canceled this order in the last minute. */
export function wasCanceledHere(id: string, now = Date.now()): boolean { const at = mine.get(id); return at !== undefined && now - at < 60_000; }
