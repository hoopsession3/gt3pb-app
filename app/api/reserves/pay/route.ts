import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { cardTryFits, callerAddress, CARD_TRIES_WORDS } from "@/lib/cardGuard";
import { chargeCard, safeIdemKey } from "@/lib/squareServer";
import { raiseAlert } from "@/lib/serverAlerts";
import { accountEmail, notifyCustomer, whoAsked } from "@/lib/notify";
import { checkoutClaims } from "@/lib/checkoutClaims";
import { payReserve, type ReserveForPay, type Tell } from "@/lib/reservePay";
import { reserveSteps } from "@/lib/reserveSteps";
import { isUuid } from "@/lib/uuid";
import { route, isJsonObject } from "@/lib/apiRoute";
import type { Answer } from "@/lib/chargeOnce";

// PAY FOR A LIMITED RESERVE (0400, 2026-10-14 — R5 of the customer audit; decided 2026-10-13: charged like packs, no
// timer, a full refund on a cancel before the cutoff). Members only. The decisions are lib/reservePay's, in the pack
// checkout's order: a key paid under already is answered first, then the checkout claims (lib/chargeOnce), the
// reserve's checks, the key claimed, the bottles held (0400 hold_reserve), the card charged once. This route reads the
// reserve and hands over the database (lib/reserveSteps), Square and who is told.
const reply = (a: Answer) => NextResponse.json(a.body, { status: a.status });
// A minute at most. The checkout claims take a request still "started" two minutes on to have died (lib/chargeOnce
// IN_FLIGHT_MS), and a claim settled by hand trusts that (lib/reservePay.settleByHand): a request still waiting on Square
// past it could be answered after its claim was let go. Square answers in seconds.
export const maxDuration = 60;

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Reserving isn't switched on yet." }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Reserves are for members — sign in to reserve." }, { status: 401 });

  let body: { reserveId?: unknown; qty?: unknown; sourceId?: unknown; idempotencyKey?: unknown; expectedCents?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const reserveId = isUuid(body.reserveId) ? body.reserveId : "";
  if (!reserveId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const key = safeIdemKey(body.idempotencyKey);
  const sourceId = typeof body.sourceId === "string" && body.sourceId ? body.sourceId : null;
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (sourceId && (!token || !locationId)) return NextResponse.json({ error: "Card checkout isn't switched on yet." }, { status: 503 });
  // A card try, counted at every card door (R9, lib/cardGuard) — before the reserve is read or a key is claimed.
  if (sourceId && !(await cardTryFits(supabaseAdmin, { userId: user.id, ip: callerAddress(req) }))) return NextResponse.json({ error: CARD_TRIES_WORDS, charged: false }, { status: 429 });

  // The reserve, with its pickup (0400).
  const db = supabaseAdmin;
  // scoped-by: one reserve by its id — a live reserve is shown to anyone (RLS 0014) — and nothing here writes it; the hold is the member's own.
  const withStop = await db.from("reserves").select("id, name, price_cents, status, stock_remaining, stop_id, stop:stops(name, starts_at, ends_at, canceled_at)").eq("id", reserveId).maybeSingle();
  if (withStop.error) return NextResponse.json({ error: "Couldn't read that reserve just now — try again." }, { status: 503 });
  const reserve = (withStop.data as unknown as ReserveForPay | null) ?? null;

  // Read before the card is asked, so a failure reading it is a failure before anything was charged.
  const email = user.email ?? (await accountEmail(user.id));
  const who = await whoAsked(null, user.id);
  const tell: Tell = {
    crew: (a) => raiseAlert({ severity: a.severity, category: a.category, kind: a.kind, title: a.title, body: a.body, subjectId: a.subjectId, link: a.link }),
    // Email, best-effort (lib/notify): a reserve carries no phone, so nothing is texted.
    customer: async (c) => { await notifyCustomer({ email, subject: c.subject, message: c.message }); },
  };

  return reply(await payReserve({
    steps: reserveSteps(db), claims: checkoutClaims(db), tell, now: () => Date.now(),
    userId: user.id, who, key, reserve, qty: body.qty, expectedCents: body.expectedCents, sourceId,
    // buyerEmail → Square emails the receipt. The key goes as the payment's idempotency key and its reference_id.
    charge: (amountCents, note) => chargeCard({ token: token!, locationId: locationId!, sourceId: sourceId!, amountCents, note, idempotencyKey: key, buyerEmail: email }),
  }));
}

export const POST = route("reserves/pay", post);
