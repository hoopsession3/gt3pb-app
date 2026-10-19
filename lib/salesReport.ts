import type { SupabaseClient } from "@supabase/supabase-js";

// THE WEEK'S MONEY, READ ONE WAY ON THE SERVER (R39 — the fresh audit's API11-07). The founder digest and the week's
// review added revenue up in the route: each table in one read (PostgREST stops at 1,000 rows), a read that failed
// counted as $0, and the walk-ups matched against at most 1,000 app payments of each kind. report_sales (0420) is the one
// sum Money and Home read — reconciled, refunds taken off, on the business's days — and it is asked here as the person
// who asked (lib/apiAuth callerClient), so its own is_admin() decides, as on their screens. Server-only.

export type SalesReport = {
  revenueCents: number;
  byChannel: { walkup: number; cup: number; packs: number; delivery: number; office: number; shop: number; reserve: number };
};

const cents = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : Number.NaN;

/** report_sales over the last `days` business days, as the caller — or null when it couldn't be read: no caller, an
 *  error, a refusal ({ error: "unauthorized" }), or an answer not in its shape. Unknown is never $0. Pure but for the call. */
export async function salesReport(sb: Pick<SupabaseClient, "rpc"> | null, days: number): Promise<SalesReport | null> {
  if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("report_sales", { p_days: days });
    if (error || !data || typeof data !== "object" || Array.isArray(data) || "error" in data) return null;
    const d = data as { revenue_cents?: unknown; by_channel?: Record<string, unknown> | null };
    const c = d.by_channel ?? {};
    const byChannel = {
      walkup: cents(c.square_walkup), cup: cents(c.cup), packs: cents(c.packs), delivery: cents(c.delivery),
      office: cents(c.office), shop: cents(c.shop), reserve: cents(c.reserve),
    };
    const revenueCents = cents(d.revenue_cents);
    if (!Number.isFinite(revenueCents) || Object.values(byChannel).some((v) => !Number.isFinite(v))) return null;
    return { revenueCents, byChannel };
  } catch {
    return null;
  }
}
