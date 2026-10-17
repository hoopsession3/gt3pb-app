import type { SupabaseClient } from "@supabase/supabase-js";

// AN EVENT'S TAKINGS, COUNTED WHERE THEY ARE (R20, 2026-10-17 — the 10/10 audit, performance F6). The crew console's
// live-event instrument (app/crew EventHUD) read every order and every Square sale of the live event — on every change to
// an order or a sale, and every fifteen seconds — to add up three numbers: a festival's thousand cups was a thousand rows
// a read. The database adds them up now (0426, event_totals) and answers the three. Until 0426 is pasted the rows are
// read and added here, by the same rule (totalsFromRows) — but for what only the database sees whole: the other app
// payments a Square sale may be (a pack's, the shop's, a reserve's…) and the refunds, which the screen's reads never had.

export type EventTotals = { cents: number; orders: number; firstAt: string | null };

type OrderRow = { total_cents?: number | null; paid?: boolean | null; status?: string | null; payment_id?: string | null; created_at?: string | null };
type SaleRow = { amount_cents?: number | null; square_payment_id?: string | null; created_at?: string | null };

/** The instrument's rule — report_sales' (the R20 review): paid orders not voided, and Square's sales that are no app
 *  payment's own (an order's — a voided ticket's too — and, where the caller knows them, `notOwn`: a pack's, a delivery's,
 *  an office order's, the shop's, a reserve's, a pack change's charge), less `refundedCents`; how many sales; when the
 *  first was. Pure. */
export function totalsFromRows(orders: readonly OrderRow[], sales: readonly SaleRow[], opts: { notOwn?: ReadonlySet<string>; refundedCents?: number } = {}): EventTotals {
  const kept = orders.filter((o) => o.status !== "void");
  const linked = new Set(orders.map((o) => o.payment_id).filter((p): p is string => !!p));
  const own = sales.filter((s) => !s.square_payment_id || (!linked.has(s.square_payment_id) && !opts.notOwn?.has(s.square_payment_id)));
  const cents = kept.filter((o) => o.paid).reduce((a, o) => a + (Number(o.total_cents) || 0), 0)
    + own.reduce((a, s) => a + (Number(s.amount_cents) || 0), 0) - (Number(opts.refundedCents) || 0);
  const times = [...kept.map((o) => o.created_at), ...own.map((s) => s.created_at)].filter((t): t is string => !!t).sort();
  return { cents, orders: kept.length + own.length, firstAt: times[0] ?? null };
}

/** The live event's takings — null when they couldn't be read (the instrument keeps what it shows: never $0 for "no
 *  answer"). */
export async function eventTotals(sb: Pick<SupabaseClient, "rpc" | "from">, eventId: string): Promise<EventTotals | null> {
  const r = await sb.rpc("event_totals", { p_event: eventId });
  if (!r.error && r.data && typeof r.data === "object") {
    const d = r.data as { cents?: unknown; orders?: unknown; first_at?: unknown };
    return { cents: Number(d.cents) || 0, orders: Number(d.orders) || 0, firstAt: typeof d.first_at === "string" ? d.first_at : null };
  }
  const code = String((r.error as { code?: string } | null)?.code ?? "");
  if (code !== "PGRST202" && code !== "42883") return null;   // a failure, not a function still on its way
  // arrives-with: 0426 — until event_totals is pasted, the rows are read and added up here, by the same rule.
  const [ords, sales] = await Promise.all([
    sb.from("orders").select("total_cents, paid, status, payment_id, created_at").eq("event_id", eventId),
    sb.from("event_sales").select("amount_cents, square_payment_id, created_at").eq("event_id", eventId),
  ]);
  if (ords.error || sales.error) return null;
  return totalsFromRows((ords.data ?? []) as OrderRow[], (sales.data ?? []) as SaleRow[]);
}
