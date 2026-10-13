import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { nextDrop, dropDateKey } from "@/lib/orderAhead";
import { packClosesAt, packIsOpen, pickupDayWords, type PackStop } from "@/lib/pickupDay";
import { route } from "@/lib/apiRoute";
import { isSettled } from "@/lib/settled";

// MOVE a reservation to another pickup day — the customer's self-service reschedule.
// Same authority as /api/reserve: the target day must be one of the truck's real upcoming drops
// (or the Saturday fallback) and still open; the order must be the caller's, untouched by the
// crew (not preparing/picked up), and its CURRENT drop must also still be open — once a drop
// closes we may already be brewing that pack, so a move becomes a call-the-truck matter.
async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Not available yet." }, { status: 503 });

  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to manage your packs." }, { status: 401 });

  let body: { id?: string; toDate?: string; stopId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = typeof body.id === "string" ? body.id : "";
  const toDate = typeof body.toDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.toDate) ? body.toDate : "";
  if (!id || !toDate) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const stopId = typeof body.stopId === "string" ? body.stopId : "";

  // THE DAY TO MOVE TO (R5, 0397): one of the truck's real upcoming stops — the same read as /api/reserve — the stop on it
  // the pack will be picked up at (the one the customer named, else the day's first), and when its drop closes: 24 hours
  // before that stop (lib/pickupDay, the one rule). With no stop on the schedule at all, the Saturday cadence.
  // NOT marked scoped-by, deliberately. This reads the PUBLIC schedule — the same upcoming stops any guest already sees on
  // Find Us — so it leaks nothing today. But it IS unscoped, and with a second market it would offer a Greenville
  // customer Atlanta's drop dates. It stays counted until it is actually fixed.
  const { data: nextStops } = await supabaseAdmin.from("stops").select("id, starts_at")
    .is("archived_at", null).is("canceled_at", null).neq("status", "done").not("starts_at", "is", null)
    .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(6);
  const upcoming = (nextStops ?? []) as { id: string; starts_at: string }[];
  const onDay = upcoming.filter((st) => dropDateKey(new Date(st.starts_at)) === toDate);
  const target = onDay.find((st) => st.id === stopId) ?? onDay[0] ?? null;
  const fallback = upcoming.length === 0 ? nextDrop() : null;
  const toCloses = target ? packClosesAt(toDate, target) : fallback && dropDateKey(fallback.sat) === toDate ? fallback.cutoff : null;
  if (!toCloses) return NextResponse.json({ error: "That day isn't on the pickup schedule." }, { status: 400 });
  if (Date.now() > toCloses.getTime()) return NextResponse.json({ error: "Ordering for that day has closed — pick a later one." }, { status: 400 });

  // A tenant filter would be WEAKER here, not stronger: it would let one member move another
  // member's pack. The right scope for a customer's own row is the customer, and the check is the
  // line below — order.user_id !== user.id returns 404. A post-read check is invisible to a regex,
  // which is why this is said rather than filtered. The marker goes last so it sits directly above
  // the access it describes; four lines up, the audit could not see it.
  // arrives-with: 0397 — stop_id is read here; until it is pasted this read fails and the move says try again.
  // scoped-by: order.user_id !== user.id, two lines below, 404s anything that is not the caller's
  const { data: order } = await supabaseAdmin.from("drop_orders")
    .select("id, user_id, drop_date, stop_id, size, glass, name, paid, payment_status, picked_up, stage, canceled_at").eq("id", id).maybeSingle();
  if (!order || order.user_id !== user.id) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.canceled_at) return NextResponse.json({ error: "That order was canceled." }, { status: 400 });
  if (order.picked_up || (order.stage && order.stage !== "reserved")) {
    return NextResponse.json({ error: "The crew already has this pack in motion — ask at the truck to move it." }, { status: 400 });
  }
  if (order.drop_date === toDate && (!target || order.stop_id === target.id)) return NextResponse.json({ ok: true, toDate });
  // Its own drop must still be open — once it closes we may already be brewing it. Its STOP says when (lib/pickupDay):
  // a stop called off never closes it, so the customers its text told to move their pack can. It used to look the day up
  // in the schedule, find a canceled stop gone from it, fall back to "three days before at 6pm" and refuse them.
  // scoped-by: stop_id is the caller's own pack's (the 404 above); stops are the public schedule.
  const { data: cur } = order.stop_id
    ? await supabaseAdmin.from("stops").select("starts_at, canceled_at").eq("id", order.stop_id).maybeSingle()
    : { data: null };
  if (!packIsOpen(order.drop_date, cur as PackStop)) {
    return NextResponse.json({ error: "This pack's drop has closed — we may already be brewing it. Ask at the truck." }, { status: 400 });
  }

  // scoped-by: unreachable with someone else's id — the 404 above. The user_id is repeated on the
  // write anyway, because that guard is twenty-five lines up and a later edit could move it.
  // The stop goes with the day (0397): the one named, or the day's first; none — the database links the day's.
  const { error } = await supabaseAdmin.from("drop_orders").update({ drop_date: toDate, stop_id: target?.id ?? null }).eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't move it — try again." }, { status: 500 });

  // FYI the crew: the drop rollups recalc live, but brew planning likes to know a pack walked.
  await raiseAlert({
    severity: "fyi", category: "order", kind: "pack_moved", subjectId: id, title: "Pack moved to another drop",
    body: `${order.name} moved a ${order.size}-pack (${isSettled(order) ? "paid" : "pay at pickup"}) from ${pickupDayWords(order.drop_date)} to ${pickupDayWords(toDate)}.`,
    link: "/crew?s=now",
  });
  return NextResponse.json({ ok: true, toDate });
}

export const POST = route("reserve/move", post);
