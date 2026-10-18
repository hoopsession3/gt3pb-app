import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { cardTryRefusal, callerAddress } from "@/lib/cardGuard";
import { raiseAlert } from "@/lib/serverAlerts";
import { benefitsForUser, acceptedCode } from "@/lib/benefits";
import { notifyCustomer, accountEmail } from "@/lib/notify";
import { chargeCard, refundPayment, safeIdemKey } from "@/lib/squareServer";
import { packPick, offeredDays, requestedDay, packCents } from "@/lib/packOrder";
import { packIsOpen, PICKUP_STOPS_READ, type PackStop } from "@/lib/pickupDay";
import { changePack, diffFor, type After, type Money, type Tell, type Who } from "@/lib/packChange";
import { packChangeStore } from "@/lib/packChangeStore";
import { isUuid } from "@/lib/uuid";
import { route, isJsonObject } from "@/lib/apiRoute";
import { packRoad, PACK_ROAD_WORDS } from "@/lib/packRoad";
import { errorMessage } from "@/lib/errorMessage";

// A minute at most (R10b — the 10/10 audit; reserves/pay's rule): a claim still "started" two minutes on is taken for a
// request that died (lib/packChange IN_FLIGHT_MS), so no request may outlive it — Square is asked with a 20-second
// deadline (lib/squareServer squareDeadline) and the platform stops this at sixty.
export const maxDuration = 60;

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
  if (!isJsonObject(body)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const id = isUuid(body.id) ? body.id : "";
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const quote = body.quote === true;
  const key = safeIdemKey(body.idempotencyKey);
  const sourceId = typeof body.sourceId === "string" && body.sourceId ? body.sourceId : null;
  // A card try, counted at every card door (R9, lib/cardGuard); a quote, or a change with no card, is not one.
  const payer = { userId: user.id, ip: callerAddress(req) };   // their tries, and a card Square refuses them (R32)
  const cardRefusal = sourceId && !quote ? await cardTryRefusal(sb, payer) : null;
  if (cardRefusal) return NextResponse.json({ error: cardRefusal, charged: false }, { status: 429 });

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  const money: Money | null = token && locationId ? {
    charge: async ({ amountCents, key: k, note }) => sourceId
      ? chargeCard({ token, locationId, sourceId, amountCents, note, idempotencyKey: k, buyerEmail: await accountEmail(user.id), who: payer })
      : { ok: false as const, error: "Add a card to pay the difference." },
    refund: ({ paymentId, amountCents, key: k, reason }) => refundPayment({ token, paymentId, amountCents, idempotencyKey: k, reason }),
  } : null;
  const tell: Tell = {
    crew: (a) => raiseAlert({ severity: a.severity, category: a.category, kind: a.kind, subjectId: a.subjectId, title: a.title, body: a.body, link: "/crew?s=now" }),
    customer: async (c, words, phone) => {
      // Once per change (R22, lib/notify onceKey): the change's own key, which a retried press carries too.
      await notifyCustomer({ phone, email: await accountEmail(user.id), subject: `GT3 — your ${c.after.size}-pack is changed`, message: words, key: `pack-changed:${c.key}` });
    },
  };
  const store = packChangeStore(sb);
  const run = async (a: { after: After; who: Who; newTotal: number; payNow: boolean; expectedDiff: number }) => {
    try {
      const out = await changePack({ store, money, tell, now: Date.now, key, order: id, user: user.id, ...a });
      return NextResponse.json(out.body, { status: out.status });
    } catch (e) {
      // A step could not be written. If the change had begun, the next request with this key finishes it or tells the
      // crew (lib/packChange); the page keeps its key and card token for exactly that. Said in the platform's log (R18):
      // a 502 nobody hears of is a failure nobody can find — the pack and the step's words, never the card.
      console.error(`[pack-change-step] ${JSON.stringify({ order: id, error: errorMessage(e, 200) })}`);
      return NextResponse.json({ pending: true, error: "Couldn't confirm your change — tap again in a moment. Nothing is charged twice." }, { status: 502 });
    }
  };

  // ONE KEY, ONE CHANGE — asked first. A retry of a change already begun hears what became of it, before the day's
  // cutoff or the pack is checked again: the world may have moved on while the first answer was lost.
  if (!quote && typeof body.idempotencyKey === "string") {
    // scoped-by: the key is the caller's page's own (8–45 characters, unguessable); pack_change_begin answers a key only
    // for the pack and the member it was begun for.
    const { data: seen, error } = await sb.from("drop_order_changes").select("key").eq("key", key).maybeSingle();
    // A read that failed is not "never begun" (R14): a change begun under this key may be waiting on its answer.
    if (error) return NextResponse.json({ pending: true, error: "Couldn't check on your change just now — tap again in a moment. Nothing is charged twice." }, { status: 503 });
    if (seen) return run({ after: EMPTY_AFTER, who: { name: said(body.name, 80), phone: said(body.phone, 40) }, newTotal: 0, payNow: false, expectedDiff: 0 });
  }

  const p = packPick(body);
  if ("error" in p) return NextResponse.json({ error: p.error }, { status: p.status });

  // NOT marked scoped-by, as in /api/reserve/move: the public schedule, unscoped until a second market is real.
  const { data: nextStops } = await sb.from("stops").select("starts_at, market")
    .is("archived_at", null).is("canceled_at", null).neq("status", "done").not("starts_at", "is", null)
    .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(PICKUP_STOPS_READ);
  // A city held closed, or not open yet, takes no pack at its stops (0412, R7b re-audit — lib/packRoad): a pack there can
  // still be canceled from My packs; it is not changed into a new order there.
  const road = await packRoad(sb, (nextStops ?? []) as { starts_at: string; market?: string | null }[]);
  if (road.error !== null) return NextResponse.json({ error: PACK_ROAD_WORDS.unread }, { status: 503 });
  const day = requestedDay(body.dropDate);
  // The Saturday cadence (no stop left) is the founding city's: offered only while that city takes orders.
  const noneTaking = !road.taking.length && road.foundingHeld;
  const cutoff = noneTaking ? undefined : offeredDays(road.taking).get(day);
  if (!cutoff) {
    const heldDay = noneTaking || ((nextStops ?? []) as { starts_at: string; market?: string | null }[]).some((st) => requestedDay(st.starts_at) === day && road.heldCity(st));
    return NextResponse.json({ error: heldDay
      ? "That stop's city isn't taking orders right now — you can still cancel the pack from My packs."
      : "That pickup day just changed — refresh to see the current stops." }, { status: 409 });
  }
  if (Date.now() > cutoff.getTime()) return NextResponse.json({ error: "That drop has closed — pick the next pickup day." }, { status: 400 });

  // scoped-by: order.user_id !== user.id, below, 404s anything that is not the caller's
  const read = await sb.from("drop_orders")
    .select("id, user_id, drop_date, stop_id, total_cents, paid, benefit_code, canceled_at, picked_up, stage, collected_at").eq("id", id).maybeSingle();
  // A read that failed is not "not found" (R14): it says so, and nothing changes.
  if (read.error) return NextResponse.json({ error: "Couldn't read that pack just now — try again." }, { status: 503 });
  const order = read.data as ChangedPack | null;
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
