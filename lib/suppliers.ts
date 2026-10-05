// WHO WE BUY FROM — the supplier on a purchase (2026-10-04, the form audit).
//
// Log a purchase had no supplier field, and its placeholder taught the opposite: "Restaurant Depot —
// cups and lids", the supplier typed into the description. That is the exact failure 0298 had to
// repair by hand — Sprouts receipt #840214 read "(no vendor linked)" three times, and a $15.99/lb
// price sat in a sentence where nothing could read it. expenses.vendor_id has existed all along;
// nothing on the capture sheet ever wrote it.
//
// So a purchase names WHO it was bought from by picking a vendor row, the way a stop names its venue.
// The vendor book holds both sides of the business since 0298 (vendors.kind: venue | supplier |
// both); this decides which of its rows are offered on a purchase, and in what order:
//
//   · every supplier (kind supplier or both), and any vendor a recent purchase was actually bought
//     from — a venue that also sells us something is still the same company, and the record says so
//   · the ones this business buys from most in the last 90 days first, then by name
//
// and, for each, the category its purchases have always been filed under — so "Sprouts" can start the
// category at Ingredients when that is all Sprouts has ever been (the sheet says so, and a tap
// changes it). A supplier with a mixed history suggests nothing: a guess is not knowledge.
//
// Pure, so scripts/smoke.cjs holds it to all of that — and the one read both supplier picks draw from
// (the purchase sheet's, the inventory register's), so the two cannot offer different books.

import type { SupabaseClient } from "@supabase/supabase-js";

export type VendorRow = { id: string; name: string; kind: string | null };
export type RecentPurchase = { vendor_id: string | null; category: string | null };
export type Supplier = VendorRow & {
  /** Purchases from them in the window the caller read. */
  uses: number;
  /** The category their purchases are filed under, when their history says so plainly — else null. */
  usual: string | null;
};

export const isSupplierKind = (kind: string | null | undefined): boolean => kind === "supplier" || kind === "both";

/** A category is "usual" for a supplier at two purchases or more, and three in four of them. */
export const USUAL_MIN = 2;
export const USUAL_SHARE = 0.75;

/** Suppliers in the order this business uses them, each with its usual category (or null). */
export function rankSuppliers(vendors: readonly VendorRow[], recent: readonly RecentPurchase[]): Supplier[] {
  const uses = new Map<string, number>();
  const cats = new Map<string, Map<string, number>>();
  for (const p of recent) {
    if (!p.vendor_id) continue;
    uses.set(p.vendor_id, (uses.get(p.vendor_id) ?? 0) + 1);
    const c = (p.category ?? "").trim();
    if (!c) continue;
    const m = cats.get(p.vendor_id) ?? new Map<string, number>();
    m.set(c, (m.get(c) ?? 0) + 1);
    cats.set(p.vendor_id, m);
  }
  const usualOf = (id: string): string | null => {
    const n = uses.get(id) ?? 0;
    const m = cats.get(id);
    if (!m || n < USUAL_MIN) return null;
    let best: string | null = null, top = 0;
    for (const [c, k] of m) if (k > top) { best = c; top = k; }
    return best && top >= USUAL_MIN && top / n >= USUAL_SHARE ? best : null;
  };
  return vendors
    .filter((v) => isSupplierKind(v.kind) || (uses.get(v.id) ?? 0) > 0)
    .map((v) => ({ ...v, uses: uses.get(v.id) ?? 0, usual: usualOf(v.id) }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

/** The supplier a typed name already is — exact, case- and space-insensitive — or null. */
export function supplierNamed(list: readonly Supplier[], typed: string): Supplier | null {
  const t = typed.trim().replace(/\s+/g, " ").toLowerCase();
  if (!t) return null;
  return list.find((s) => s.name.trim().replace(/\s+/g, " ").toLowerCase() === t) ?? null;
}

/** The vendor book a supplier pick is drawn from: every vendor not archived, by name. */
export const readVendorBook = (sb: SupabaseClient) =>
  sb.from("vendors").select("id, name, kind").is("archived_at", null).neq("status", "archived").order("name");
