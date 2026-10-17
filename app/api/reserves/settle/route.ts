import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { adminFromRequest } from "@/lib/apiAuth";
import { findPaymentByReference, getPayment } from "@/lib/squareServer";
import { settleByHand } from "@/lib/reservePay";
import { reserveSteps } from "@/lib/reserveSteps";
import { checkoutClaims } from "@/lib/checkoutClaims";
import { isUuid } from "@/lib/uuid";
import { route, isJsonObject } from "@/lib/apiRoute";
import type { Claim } from "@/lib/chargeOnce";

// SETTLE A RESERVE WHOSE PAYMENT NEVER ANSWERED (0400, 2026-10-14 — R5 of the customer audit). An owner or an admin
// only: it says money was or was not taken. A claim left pending — Square's answer to its charge never came, and the crew
// were told — is settled with Square asked first: Paid takes the payment the checkout heard of, else the one Square has
// under the checkout's key (found among the payments made while it ran), else one pasted from Square and checked there;
// Not charged puts the bottles back on the shelf, and is refused when Square has a payment under the key. Not while its
// checkout may still be going. The decisions are lib/reservePay.settleByHand's.
const PAYMENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

async function post(req: Request) {
  if (!(await adminFromRequest(req))) return NextResponse.json({ error: "Only an owner or an admin settles a payment." }, { status: 403 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Settling isn't switched on yet." }, { status: 503 });
  let body: { id?: unknown; outcome?: unknown; paymentId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const id = isUuid(body.id) ? body.id : "";
  const outcome = body.outcome === "paid" || body.outcome === "not_charged" ? body.outcome : null;
  if (!id || !outcome) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const raw = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
  if (raw && !PAYMENT_ID.test(raw)) return NextResponse.json({ error: "That doesn't look like a Square payment ID — copy it again from the payment's page." }, { status: 400 });

  const db = supabaseAdmin;
  // A read that failed is not "that claim isn't here" (R14): it says it couldn't read, and the crew tries again.
  // scoped-by: one claim by its id, for an owner or an admin (adminFromRequest above) — its key, its bottles and their price.
  const { data: c, error: cErr } = await db.from("reserve_claims").select("idempotency_key, qty, reserve:reserves(price_cents)").eq("id", id).maybeSingle();
  if (cErr) return NextResponse.json({ error: "Couldn't read that claim just now — try again." }, { status: 503 });
  const claim = c as { idempotency_key: string | null; qty: number; reserve: { price_cents: number } | null } | null;
  if (!claim) return NextResponse.json({ error: "That claim isn't here.", gone: true }, { status: 404 });
  // What the checkout itself kept under the claim's key (0371): where it got to, the amount it went to charge, and
  // Square's payment when it heard of one. A failed read is not "nothing kept" — that would let a paid claim be marked
  // Not charged — so it refuses (a table PostgREST does not know included, since 0371 is applied: R14).
  let checkout: (Pick<Claim, "state" | "amount_cents" | "payment_id" | "updated_at"> & { created_at: string | null }) | null = null;
  if (claim.idempotency_key) {
    // scoped-by: checkout_claims.idempotency_key is UNIQUE (0371) and the key is this claim's own.
    const k = await db.from("checkout_claims").select("state, amount_cents, payment_id, created_at, updated_at").eq("idempotency_key", claim.idempotency_key).maybeSingle();
    if (k.error) return NextResponse.json({ error: "Couldn't read its checkout just now — try again." }, { status: 503 });
    checkout = (k.data as typeof checkout) ?? null;
  }
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  const res = await settleByHand({
    steps: reserveSteps(db), claims: checkoutClaims(db), now: () => Date.now(), claimId: id, outcome,
    checkout, priceCents: claim.qty * (claim.reserve?.price_cents ?? 0), typedPaymentId: raw || null,
    lookup: token ? (paymentId) => getPayment({ token, paymentId }) : null,
    search: token && locationId ? (reference, fromIso, toIso) => findPaymentByReference({ token, locationId, reference, fromIso, toIso }) : null,
  });
  return NextResponse.json(res.body, { status: res.status });
}

export const POST = route("reserves/settle", post);
