import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { benefitsForUser, acceptedCode } from "@/lib/benefits";
import { notifyCustomer, accountEmail } from "@/lib/notify";
import { chargeCard, refundPayment, safeIdemKey } from "@/lib/squareServer";
import { packPick, offeredDays, requestedDay, packCents } from "@/lib/packOrder";
import { packIsOpen, type PackStop } from "@/lib/pickupDay";
import { changePack, diffFor, type After, type Money, type Tell, type Who } from "@/lib/packChange";
import { packChangeStore, packChangeMissing } from "@/lib/packChangeStore";
import { isUuid } from "@/lib/uuid";
import { route } from "@/lib/apiRoute";
import { isMissingColumn } from "@/lib/schemaSkew";

// CHANGE A RESERVED PACK IN PLACE (0388, 2026-10-12 — C5 of the customer audit, approved). The pack itself changes —
// size, flavors, glass, day, name, phone — and only the difference moves: more is charged to a card, less is refunded
// to the card that paid, the same price moves nothing (lib/packChange). Same authority as /api/reserve: the pack is
// read and priced here (lib/packOrder), never from the page; the day must be on the schedule and open; and the pack's
// own drop must still be open, as /api/reserve/move asks.
//
//   { quote: true, ... }   what this change would move, nothing written: { paid, wasCents, newCents, diffCents }
//   { ...the pack, expectedDiffCents, idempotencyKey, sourceId? }   the change; refused when the difference is not
//                          what the page was shown (0388's begin decides it again, under the pack's lock)

const notOn = () => NextResponse.json({ error: "Changing a pack isn't switched on yet — cancel it and reserve the new one." }, { status: 503 });
type ChangedPack = { id: string; user_id: string; drop_date: string; stop_id?: string | null; total_cents: number | null; paid: boolean | null; benefit_code: string | null; canceled_at: string | null; picked_up: boolean | null; stage: string | null; collected_at: string | null };
const EMPTY_AFTER: After = { size: 0, glass: "return", mix: {}, drop_date: "", total_cents: 0, benefit_code: null };
const said = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function post(req: Request) {
  if (!supabaseAdmin) return notOn();
  const sb = supabaseAdmin;
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to change your pack." }, { status: 401 });

  let body: {
    id?: unknown; quote?: unknown; idempotencyKey?: unknown; sourceId?: unknown; expectedDiffCents?: unknown; code?: unknown;
    name?: unknown; phone?: unknown; size?: unknown; glass?: unknown; mix?: unknown; dropDate?: unknown;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = isUuid(body.id) ? body.id : "";
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const quote = body.quote === true;
  const key = safeIdemKey(body.idempotencyKey);
  const sourceId = typeof body.sourceId === "string" && body.sourceId ? body.sourceId : null;

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  const money: Money | null = token && locationId ? {
    charge: async ({ amountCents, key: k, note }) => sourceId
      ? chargeCard({ token, locationId, sourceId, amountCents, note, idempotencyKey: k, buyerEmail: await accountEmail(user.id) })
      : { ok: false as const, error: "Add a card to pay the difference." },
    refund: ({ paymentId, amountCents, key: k, reason }) => refundPayment({ token, paymentId, amountCents, idempotencyKey: k, reason }),
  } : null;
  const tell: Tell = {
    crew: (a) => raiseAlert({ severity: a.severity, category: a.category, kind: a.kind, subjectId: a.subjectId, title: a.title, body: a.body, link: "/crew?s=now" }),
    customer: async (c, words, phone) => {
      await notifyCustomer({ phone, email: await accountEmail(user.id), subject: `GT3 — your ${c.after.size}-pack is changed`, message: words });
    },
  };
  const store = packChangeStore(sb);
  const run = async (a: { after: After; who: Who; newTotal: number; payNow: boolean; expectedDiff: number }) => {
    try {
      const out = await changePack({ store, money, tell, now: Date.now, key, order: id, user: user.id, ...a });
      return NextResponse.json(out.body, { status: out.status });
    } catch (e) {
      if (packChangeMissing(e as { code?: string; message?: string })) return notOn();
      // A step could not be written. If the change had begun, the next request with this key finishes it or tells the
      // crew (lib/packChange); the page keeps its key and card token for exactly that.
      return NextResponse.json({ pending: true, error: "Couldn't confirm your change — tap again in a moment. Nothing is charged twice." }, { status: 502 });
    }
  };

  // ONE KEY, ONE CHANGE — asked first. A retry of a change already begun hears what became of it, before the day's
  // cutoff or the pack is checked again: the world may have moved on while the first answer was lost.
  if (!quote && typeof body.idempotencyKey === "string") {
    // arrives-with: 0388 — until it is pasted the read errors, and the route says changing a pack isn't switched on yet.
    // scoped-by: the key is the caller's page's own (8–45 characters, unguessable); pack_change_begin answers a key only
    // for the pack and the member it was begun for.
    const { data: seen, error } = await sb.from("drop_order_changes").select("key").eq("key", key).maybeSingle();
    if (error && packChangeMissing(error)) return notOn();
    if (seen) return run({ after: EMPTY_AFTER, who: { name: said(body.name, 80), phone: said(body.phone, 40) }, newTotal: 0, payNow: false, expectedDiff: 0 });
  }

  const p = packPick(body);
  if ("error" in p) return NextResponse.json({ error: p.error }, { status: p.status });

  // NOT marked scoped-by, as in /api/reserve/move: the public schedule, unscoped until a second market is real.
  const { data: nextStops } = await sb.from("stops").select("starts_at")
    .is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
    .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(6);
  const offered = offeredDays(nextStops as { starts_at: string }[] | null);
  const day = requestedDay(body.dropDate);
  const cutoff = offered.get(day);
  if (!cutoff) return NextResponse.json({ error: "That pickup day just changed — refresh to see the current stops." }, { status: 409 });
  if (Date.now() > cutoff.getTime()) return NextResponse.json({ error: "That drop has closed — pick the next pickup day." }, { status: 400 });

  // arrives-with: 0397 — stop_id is read here. Until it is pasted the column is not there (lib/schemaSkew): the pack is
  // read without it, as before, and its own drop is judged by its day.
  // scoped-by: order.user_id !== user.id, below, 404s anything that is not the caller's
  const withStop = await sb.from("drop_orders")
    .select("id, user_id, drop_date, stop_id, total_cents, paid, benefit_code, canceled_at, picked_up, stage, collected_at").eq("id", id).maybeSingle();
  const order = (withStop.error && isMissingColumn(withStop.error)
    // scoped-by: the same row, read again without the column 0397 adds — the 404 below decides, as above
    ? (await sb.from("drop_orders").select("id, user_id, drop_date, total_cents, paid, benefit_code, canceled_at, picked_up, stage, collected_at").eq("id", id).maybeSingle()).data
    : withStop.data) as ChangedPack | null;
  if (!order || order.user_id !== user.id) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.canceled_at) return NextResponse.json({ error: "That pack was canceled." }, { status: 409 });
  if (order.collected_at) return NextResponse.json({ error: "This pack was paid at the window — the crew can change it." }, { status: 409 });
  if (order.picked_up || (order.stage && order.stage !== "reserved")) {
    return NextResponse.json({ error: "The crew already has this pack in motion — ask at the truck to change it." }, { status: 409 });
  }
  // Its own drop must still be open, by its STOP (lib/pickupDay, R5 / 0397): a stop called off never closes it, so a pack
  // whose stop the truck called off can be changed — it used to find the stop gone from the schedule and refuse.
  // scoped-by: stop_id is the caller's own pack's (the 404 above); stops are the public schedule.
  const { data: cur } = order.stop_id
    ? await sb.from("stops").select("starts_at, canceled_at").eq("id", order.stop_id).maybeSingle()
    : { data: null };
  if (!packIsOpen(String(order.drop_date), cur as PackStop)) {
    return NextResponse.json({ error: "This pack's drop has closed — we may already be brewing it. Ask at the truck." }, { status: 409 });
  }

  // The new price, as /api/reserve prices a pack: the code asked for, or the one the pack was reserved with.
  const asked = typeof body.code === "string" && body.code.trim() ? body.code.trim() : null;
  const code = asked ?? (order.benefit_code as string | null);
  const benefits = await benefitsForUser(user.id, code);
  const newTotal = packCents(p.pick.size, p.pick.glass, benefits);
  const paid = order.paid === true;
  const was = Number(order.total_cents) || 0;

  if (quote) {
    return NextResponse.json({ ok: true, quote: { paid, wasCents: was, newCents: newTotal, diffCents: diffFor({ paid, total_cents: was }, newTotal, false) } });
  }

  const expected = typeof body.expectedDiffCents === "number" && Number.isFinite(body.expectedDiffCents) ? Math.round(body.expectedDiffCents) : null;
  if (expected === null) return NextResponse.json({ error: "Refresh and confirm the change again." }, { status: 400 });
  const payNow = !paid && sourceId !== null;
  if ((payNow || expected > 0) && !sourceId) return NextResponse.json({ error: "Add a card to pay the difference." }, { status: 400 });
  if ((payNow || expected > 0) && !money) return NextResponse.json({ error: "Card checkout isn't switched on yet." }, { status: 503 });

  const after: After = { size: p.pick.size, glass: p.pick.glass, mix: p.pick.mix, drop_date: day, total_cents: newTotal, benefit_code: acceptedCode(benefits, code) };
  return run({ after, who: { name: p.pick.name, phone: p.pick.phone }, newTotal, payNow, expectedDiff: expected });
}

export const POST = route("reserve/change", post);
