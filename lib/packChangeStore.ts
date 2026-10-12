// public.pack_change_* (0388) as lib/packChange's store — the server's service-role client, one RPC per step. A step
// that cannot be made throws: the change stays where it was, and the next request with its key finishes it or tells
// the crew (lib/packChange).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Begin, Change, ChangeState, PackChangeStore } from "./packChange";

/** The function or table is not there: 0388 is not pasted yet. */
export const packChangeMissing = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42P01" || e.code === "42883"
    || (/pack_change_|drop_order_changes/.test(String(e.message ?? "")) && /does not exist|could not find/i.test(String(e.message ?? ""))));

export function packChangeStore(sb: SupabaseClient): PackChangeStore {
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw Object.assign(new Error(`${fn}: ${error.message}`), { code: error.code });
    return data as T;
  };
  return {
    begin: (a) => rpc<Begin>("pack_change_begin", {
      p_key: a.key, p_order: a.order, p_user: a.user, p_after: a.after, p_new_total: a.newTotal, p_pay_now: a.payNow, p_expected_diff: a.expectedDiff,
    }),
    moved: (key, m) => rpc<boolean>("pack_change_moved", {
      p_key: key, p_charge_payment_id: m.chargePaymentId, p_refunds: m.refunds, p_by_hand: m.byHand, p_outcome: m.outcome,
    }),
    end: (key, state, outcome) => rpc<boolean>("pack_change_end", { p_key: key, p_state: state, p_outcome: outcome }),
    apply: (key, who) => rpc<{ state: ChangeState | "missing"; change?: Change; name?: string | null; phone?: string | null }>("pack_change_apply", {
      p_key: key, p_name: who?.name ?? null, p_phone: who?.phone ?? null,
    }),
    refunded: (key, r) => rpc<boolean>("pack_change_refunded", { p_key: key, p_refund: r }),
    answer: async (key, a) => { await rpc<null>("pack_change_answer", { p_key: key, p_status: a.status, p_answer: a.body }); },
  };
}
