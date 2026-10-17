import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./schemaSkew";
import { errorMessage } from "./errorMessage";
import type { Claim, ClaimStore, StoreFailure } from "./chargeOnce";

// THE TABLE UNDER lib/chargeOnce — public.checkout_claims (0371), read and written by the server alone,
// with the service role (the table has RLS on, no policy, and no grant to anon or authenticated).
//
// Any failure to read or to claim refuses the charge: a payment whose claim cannot be written is a payment that could be
// taken twice. THE TABLE MISSING TOO (R14, 2026-10-16 — the 10/10 audit's operations pass, F4). Until 0371 was pasted, a
// missing table ran the checkout without claims — Square's own key the only dedupe — rather than refusing every order
// until somebody opened the SQL editor. 0371 is applied, so a missing table now means something else is wrong — a restore,
// a branch, PostgREST's schema cache not knowing the table — and the guard switched itself off without a word. It refuses
// like any other failure, says so in the platform's log on every refusal, and tells the crew (once every ten minutes from
// each server): the fix is usually PostgREST's reload — NOTIFY pgrst, 'reload schema'.

type Err = { code?: string | null; message?: string | null } | null | undefined;
let toldAt = 0;
const TELL_EVERY_MS = 10 * 60_000;
function failure(e: Err): StoreFailure {
  const missing = isMissingTable(e);
  const error = String(e?.message || e?.code || "failed");
  if (missing) {
    console.error(`[charge-once-off] checkout_claims did not answer as a table (${error.slice(0, 160)}) — every card charge is refused until it does`);
    if (Date.now() - toldAt > TELL_EVERY_MS) {
      toldAt = Date.now();
      // Through lib/serverAlerts, loaded when it is needed: this file stays loadable on its own (the tests compile it
      // without the server's clients).
      void import("./serverAlerts").then((m) => m.raiseAlert({ severity: "critical", category: "money", title: "Checkout can't take payments — its claims table isn't answering",
        body: "Every charge is being refused, safely (nothing is charged), because the table that keeps one charge per checkout (checkout_claims, 0371) did not answer as a table. Usually PostgREST's schema cache: run NOTIFY pgrst, 'reload schema'; in Supabase › SQL editor. If the project was restored or branched, check that 0371 is there." }), () => {});
    }
  }
  return { ok: false, missing, error };
}

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
