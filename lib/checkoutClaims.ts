import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./schemaSkew";
import { errorMessage } from "./errorMessage";
import type { Claim, ClaimStore, StoreFailure } from "./chargeOnce";

// THE TABLE UNDER lib/chargeOnce — public.checkout_claims (0371), read and written by the server alone,
// with the service role (the table has RLS on, no policy, and no grant to anon or authenticated).
//
// arrives-with: 0371 — until it is pasted every read and claim here reports the table missing, and
// lib/chargeOnce runs the checkout without claims, as it ran before them (Square's own key the only
// dedupe), rather than refusing every order until somebody opens the SQL editor. Only that error is
// forgiven (lib/schemaSkew.isMissingTable). Any other failure to read or to claim refuses the charge:
// a payment whose claim cannot be written is a payment that could be taken twice.

type Err = { code?: string | null; message?: string | null } | null | undefined;
const failure = (e: Err): StoreFailure => ({ ok: false, missing: isMissingTable(e), error: String(e?.message || e?.code || "failed") });

export function checkoutClaims(db: SupabaseClient): ClaimStore {
  return {
    async read(key) {
      try {
        const { data, error } = await db.from("checkout_claims").select("state, card, amount_cents, payment_id, status, answer, note, updated_at").eq("idempotency_key", key).maybeSingle();
        if (error) return failure(error);
        return { ok: true, claim: (data as Claim | null) ?? null };
      } catch (e) {
        return failure({ message: errorMessage(e) });
      }
    },

    async claim(key, row, at) {
      try {
        const { error } = await db.from("checkout_claims").insert({
          idempotency_key: key, channel: row.channel, card: row.card, amount_cents: row.amountCents,
          state: "started", created_at: at, updated_at: at,
        });
        if (!error) return { ok: true, claimed: true };
        if (error.code === "23505") return { ok: true, claimed: false };
        return failure(error);
      } catch (e) {
        return failure({ message: errorMessage(e) });
      }
    },

    async move(key, to, at, from) {
      const values: Record<string, unknown> = { state: to.state, updated_at: at };
      if (to.paymentId !== undefined) values.payment_id = to.paymentId;
      if (to.answer) { values.status = to.answer.status; values.answer = to.answer.body; }
      if (to.note !== undefined) values.note = to.note.slice(0, 300);
      // Once more on a failure: a lost "done" leaves the next retry hearing "still confirming" until the
      // claim is old enough to be taken for dead. A conditional move is not repeated blind — if the first
      // landed and only its answer was lost, the second finds the claim moved and says so (false).
      for (let tries = from ? 1 : 2; tries > 0; tries--) {
        try {
          let q = db.from("checkout_claims").update(values).eq("idempotency_key", key);
          if (from) q = q.eq("state", from.state).eq("updated_at", from.updated_at);
          const { data, error } = await q.select("state");
          if (!error) return Array.isArray(data) && data.length > 0;
        } catch { /* below */ }
      }
      return false;
    },

    async release(key) {
      try {
        const { error } = await db.from("checkout_claims").delete().eq("idempotency_key", key).eq("state", "started");
        // Said in the log (R12b, F4); a claim left behind still expires into "couldn't confirm" — the slow way, not a wrong one.
        if (error) console.warn(`checkout: couldn't release claim ${key} — it expires on its own: ${error.message}`);
      } catch { /* a claim left behind expires into "couldn't confirm" — the slow way, not a wrong one */ }
    },
  };
}
