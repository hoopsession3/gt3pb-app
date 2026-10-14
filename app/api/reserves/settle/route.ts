import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest } from "@/lib/apiAuth";
import { settleByHand } from "@/lib/reservePay";
import { reserveSteps } from "@/lib/reserveSteps";
import { isUuid } from "@/lib/uuid";
import { route } from "@/lib/apiRoute";

// SETTLE A RESERVE WHOSE PAYMENT NEVER ANSWERED (0400, 2026-10-14 — R5 of the customer audit). Staff only. A claim left
// pending — Square's answer to its charge never came, and the crew were told — is settled with the payment in front of
// them: Paid (Square's payment id, which its refund will need: the one the checkout heard, else the one pasted from
// Square) or Not charged (the bottles back on the shelf). The decisions are lib/reservePay.settleByHand's.
const PAYMENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Settling isn't switched on yet." }, { status: 503 });
  if (!(await staffFromRequest(req))) return NextResponse.json({ error: "Crew only." }, { status: 403 });
  let body: { id?: unknown; outcome?: unknown; paymentId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = isUuid(body.id) ? body.id : "";
  const outcome = body.outcome === "paid" || body.outcome === "not_charged" ? body.outcome : null;
  if (!id || !outcome) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const db = supabaseAdmin;
  // arrives-with: 0400 — until it is pasted a claim has no key and nothing is ever pending: the read answers with an
  // error, and the claim is said not to be here (404) — there is nothing to settle.
  // scoped-by: one claim by its id, for the crew (staffFromRequest above) — its key, its bottles and their price.
  const { data: c } = await db.from("reserve_claims").select("idempotency_key, qty, reserve:reserves(price_cents)").eq("id", id).maybeSingle();
  const claim = c as { idempotency_key: string | null; qty: number; reserve: { price_cents: number } | null } | null;
  if (!claim) return NextResponse.json({ error: "That claim isn't here.", gone: true }, { status: 404 });
  // What the checkout itself kept under the claim's key (0371): the amount it went to charge, and Square's payment when it
  // heard of one.
  // scoped-by: checkout_claims.idempotency_key is UNIQUE (0371) and the key is this claim's own.
  const kept = claim.idempotency_key
    ? ((await db.from("checkout_claims").select("amount_cents, payment_id").eq("idempotency_key", claim.idempotency_key).maybeSingle()).data as { amount_cents: number | null; payment_id: string | null } | null)
    : null;
  const typed = typeof body.paymentId === "string" && PAYMENT_ID.test(body.paymentId.trim()) ? body.paymentId.trim() : null;
  const res = await settleByHand({
    steps: reserveSteps(db), claimId: id, outcome,
    priceCents: kept?.amount_cents ?? claim.qty * (claim.reserve?.price_cents ?? 0),
    paymentId: kept?.payment_id ?? typed,
  });
  return NextResponse.json(res.body, { status: res.status });
}

export const POST = route("reserves/settle", post);
