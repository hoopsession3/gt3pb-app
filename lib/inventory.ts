import type { EventRow } from "./db";
import { authedFetch } from "./authedFetch";

// Live inventory (from /api/inventory → GT3 — Inventory in Notion). Turns the Event
// Brief's "ingredient pull" from an estimate into have-vs-need with low-stock flags.

export interface InvItem {
  id: string;
  name: string;
  qty: number | null;
  onHand: number | null;      // effective on-hand: ledger balance when we have one, else static qty (0205)
  eventReady: number | null;
  reorderPoint: number | null;
  status: string | null;
  unit: string | null;
  category: string | null;
  useCases: string[];
  requiredFor: string[];
  critical: boolean;
  reorderLink: string | null;
  vendor: string | null;
  notes: string | null;
}
export interface InventoryResp { enabled: boolean; items: InvItem[]; error?: string }

export async function fetchInventory(): Promise<InventoryResp> {
  try {
    const r = await authedFetch("/api/inventory", { cache: "no-store" });
    return (await r.json()) as InventoryResp;
  } catch {
    return { enabled: false, items: [] };
  }
}

// event menu flags → Notion "Event Use Case" values
const MENU_USECASE: Record<string, string> = {
  menu_nitro: "Nitro",
  menu_bottles: "Bottles",
  menu_nature_aid: "Hydration",
  menu_salted_maple: "Coffee Service",
  menu_broth: "Coffee Service",
};

// the use-cases an event draws on (its menu + always-on setup/cleaning + power)
export function eventUseCases(e: EventRow): string[] {
  const set = new Set<string>(["Setup/Booth", "Cleaning"]);
  (Object.keys(MENU_USECASE) as string[]).forEach((k) => { if (e[k as keyof EventRow]) set.add(MENU_USECASE[k]); });
  if (e.power_available) set.add("Power");
  return [...set];
}

const isOnHand = (it: InvItem) => it.status == null || it.status === "On Hand" || it.status === "In Transit";
const relevantTo = (it: InvItem, cases: Set<string>) =>
  it.useCases.some((u) => cases.has(u)) || it.requiredFor.includes("All Events") || it.critical;
// Reorder math runs on effective on-hand (ledger balance when we have one, else static qty) so real
// logged consumption — not just hand-edits — trips the threshold. Mirrors the 0205 inventory_status view.
export const effOnHand = (it: InvItem) => it.onHand ?? it.qty;
const isLow = (it: InvItem) => { const q = effOnHand(it); return q != null && it.reorderPoint != null && q <= it.reorderPoint; };

export interface InvCheck { relevant: InvItem[]; low: InvItem[]; out: InvItem[]; onHandCount: number }
export function inventoryForEvent(items: InvItem[], e: EventRow): InvCheck {
  const cases = new Set(eventUseCases(e));
  const relevant = items.filter((it) => isOnHand(it) && relevantTo(it, cases));
  const low = relevant.filter(isLow);
  const out = relevant.filter((it) => { const q = effOnHand(it); return q != null && q <= 0; });
  return { relevant, low, out, onHandCount: relevant.length };
}

// Roll-up across a set of (upcoming) events: items below reorder point relevant to
// ANY of them — deduped by name, out-of-stock first. Drives the Overview restock list.
export function rollupLowStock(items: InvItem[], events: EventRow[]): InvItem[] {
  const cases = new Set<string>();
  events.forEach((e) => eventUseCases(e).forEach((c) => cases.add(c)));
  const low = items.filter((it) => isOnHand(it) && relevantTo(it, cases) && isLow(it));
  const seen = new Set<string>();
  const outFirst = (it: InvItem) => ((effOnHand(it) ?? 0) <= 0 ? 1 : 0);
  return low
    .filter((it) => (seen.has(it.name) ? false : (seen.add(it.name), true)))
    .sort((a, b) => outFirst(b) - outFirst(a) || a.name.localeCompare(b.name));
}
