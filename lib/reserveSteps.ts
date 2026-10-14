import type { SupabaseClient } from "@supabase/supabase-js";
import { isClosed, isGone, refusalText } from "./refusal";
import { isMissingFunction } from "./schemaSkew";
import { errorMessage } from "./errorMessage";
import type { ClaimState, Done, Held, ReserveClaimRow, ReserveSteps } from "./reservePay";

// THE DATABASE UNDER lib/reservePay — 0400's functions and reserve_claims, with the service role (the routes are the
// only callers: hold_reserve, settle_reserve and release_reserve are the server's alone).
//
// arrives-with: 0400 — until it is pasted hold_reserve is not there, and a hold says reserving by card is not switched
// on yet (503) instead of taking anybody's money; the claim's new columns are read nowhere a phone draws from.
//
// A refusal is the database's own sentence (lib/refusal): gone → 404, closed or sold out → 409, anything else it will
// not take → 400. An answer that does not say — the network, a timeout — may still have made the hold, so it is read
// back by its key before it is called a failure.

const COLS = "id, reserve_id, user_id, qty, state, idempotency_key, payment_id, paid_cents, refunded_cents";
const OFF = "Reserving with a card isn't switched on yet — check back shortly.";

type DbError = { code?: string | null; message?: string | null } | null | undefined;
const failed = (e: DbError): Done => ({ ok: false, error: refusalText(e) ?? String(e?.message || e?.code || "it didn't answer") });

export function reserveSteps(db: SupabaseClient): ReserveSteps {
  return {
    async paidUnder(key, userId) {
      // scoped-by: idempotency_key carries a UNIQUE index (0400) and the read is the caller's own (user_id) — one row at most.
      const { data, error } = await db.from("reserve_claims").select(COLS).eq("idempotency_key", key).eq("user_id", userId).maybeSingle();
      return error ? null : ((data as ReserveClaimRow | null) ?? null);
    },

    async hold({ userId, reserveId, qty, key }): Promise<Held> {
      let error: DbError = null;
      try {
        const res = await db.rpc("hold_reserve", { p_user: userId, p_reserve: reserveId, p_qty: qty, p_key: key });
        error = res.error;
        const d = res.data as { id?: string; qty?: number; amount_cents?: number; again?: boolean; state?: ClaimState } | null;
        if (!error && d?.id) return { ok: true, id: d.id, qty: Number(d.qty) || qty, amountCents: Number(d.amount_cents) || 0, again: !!d.again, state: d.state ?? "pending" };
      } catch (e) {
        error = { message: errorMessage(e) };
      }
      if (isMissingFunction(error)) return { ok: false, answer: { status: 503, body: { error: OFF, off: true } } };
      const words = refusalText(error);
      if (words) return { ok: false, answer: { status: isGone(error) ? 404 : isClosed(error) ? 409 : 400, body: { error: words, ...(isGone(error) ? { gone: true } : {}) } } };
      // The answer did not say. The hold may be there: read it back by its key — the member's own, still pending.
      // scoped-by: idempotency_key is UNIQUE (0400) and the read is the caller's own rows (user_id).
      const back = await db.from("reserve_claims").select("id, qty, state, reserve:reserves(price_cents)")
        .eq("idempotency_key", key).eq("user_id", userId).eq("state", "pending").maybeSingle();
      const row = back.data as { id: string; qty: number; state: ClaimState; reserve: { price_cents: number } | null } | null;
      if (row?.reserve) return { ok: true, id: row.id, qty: row.qty, amountCents: row.qty * row.reserve.price_cents, again: true, state: row.state };
      return { ok: false, answer: { status: 502, body: { error: "We couldn't hold your bottles just now — nothing was charged. Try again.", code: "NOT_HELD" } } };
    },

    async settle(claimId, paymentId, paidCents) {
      try {
        const { error } = await db.rpc("settle_reserve", { p_claim: claimId, p_payment_id: paymentId, p_paid_cents: paidCents });
        return error ? failed(error) : { ok: true };
      } catch (e) {
        return { ok: false, error: errorMessage(e, 160) };
      }
    },

    async release(claimId, reason, refundedCents) {
      try {
        const { error } = await db.rpc("release_reserve", { p_claim: claimId, p_reason: reason, p_refunded_cents: refundedCents });
        return error ? failed(error) : { ok: true };
      } catch (e) {
        return { ok: false, error: errorMessage(e, 160) };
      }
    },

    async claim(claimId) {
      // scoped-by: the claim's own id; the routes check whose it is (the member's own, or the crew's) before acting on it.
      const { data, error } = await db.from("reserve_claims")
        .select(`${COLS}, reserve:reserves(name, stop:stops(name, starts_at, ends_at, canceled_at))`).eq("id", claimId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const c = data as unknown as ReserveClaimRow;
      // When its pickup closes, by the database's one rule (0400 reserve_closes_at) — what the member may cancel until.
      const closes = await db.rpc("reserve_closes_at", { p_reserve: c.reserve_id });
      if (closes.error) throw new Error(closes.error.message);
      return { ...c, closes_at: (closes.data as string | null) ?? null };
    },
  };
}
