import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest, userFromRequest } from "@/lib/apiAuth";
import { refundPayment } from "@/lib/squareServer";
import { raiseAlert } from "@/lib/serverAlerts";
import { accountEmail, notifyCustomer, whoAsked } from "@/lib/notify";
import { cancelReserve, type Tell } from "@/lib/reservePay";
import { reserveSteps } from "@/lib/reserveSteps";
import { isUuid } from "@/lib/uuid";
import { route } from "@/lib/apiRoute";
import type { Answer } from "@/lib/chargeOnce";

// CANCEL A LIMITED RESERVE, AND GIVE THE MONEY BACK (0400, 2026-10-14 — R5 of the customer audit). The member's own,
// until its pickup closes (24 hours before the stop; any time once the pickup was called off); the crew's (`crew: true`,
// staff only), any time. The decisions are lib/reservePay's: the refund first, to the card that paid, under a key of the
// claim's own (a cancel sent twice is refunded once) — refused or unknown, the claim stands and the crew are told — then
// the bottles back on the shelf (0400 release_reserve), and the member and the crew told.
const reply = (a: Answer) => NextResponse.json(a.body, { status: a.status });

async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Canceling isn't switched on yet." }, { status: 503 });
  let body: { id?: unknown; crew?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = isUuid(body.id) ? body.id : "";
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  let by: { userId: string } | { crew: true };
  if (body.crew === true) {
    if (!(await staffFromRequest(req))) return NextResponse.json({ error: "Crew only." }, { status: 403 });
    by = { crew: true };
  } else {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Sign in to cancel your reserve." }, { status: 401 });
    by = { userId: user.id };
  }

  // Whose it is — for the crew's line and the member's email. lib/reservePay refuses a member's cancel of anybody else's.
  const db = supabaseAdmin;
  // scoped-by: one claim by its id, read for its owner only; lib/reservePay.cancelReserve checks the caller is that owner (or the crew) before anything moves.
  const { data: owner } = await db.from("reserve_claims").select("user_id").eq("id", id).maybeSingle();
  const ownerId = (owner as { user_id: string | null } | null)?.user_id ?? null;
  const email = ownerId ? await accountEmail(ownerId) : null;
  const who = ownerId ? await whoAsked(null, ownerId) : "a member whose account is gone";
  const tell: Tell = {
    crew: (a) => raiseAlert({ severity: a.severity, category: a.category, kind: a.kind, title: a.title, body: a.body, subjectId: a.subjectId, link: a.link }),
    customer: async (c) => { await notifyCustomer({ email, subject: c.subject, message: c.message }); },
  };
  const token = process.env.SQUARE_ACCESS_TOKEN;

  return reply(await cancelReserve({
    steps: reserveSteps(db), tell, now: () => Date.now(), claimId: id, by, who,
    refund: token
      ? (r) => refundPayment({ token, paymentId: r.paymentId, amountCents: r.amountCents, idempotencyKey: r.key, reason: r.reason })
      : null,
  }));
}

export const POST = route("reserves/cancel", post);
