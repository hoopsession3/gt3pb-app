import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { nextDrop, dropForStop, dropDateKey } from "@/lib/orderAhead";

// MOVE a reservation to another pickup day — the customer's self-service reschedule.
// Same authority as /api/reserve: the target day must be one of the truck's real upcoming drops
// (or the Saturday fallback) and still open; the order must be the caller's, untouched by the
// crew (not preparing/picked up), and its CURRENT drop must also still be open — once a drop
// closes we may already be brewing that pack, so a move becomes a call-the-truck matter.
export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Not available yet." }, { status: 503 });

  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to manage your packs." }, { status: 401 });

  let body: { id?: string; toDate?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = typeof body.id === "string" ? body.id : "";
  const toDate = typeof body.toDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.toDate) ? body.toDate : "";
  if (!id || !toDate) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // The offered-days map — identical construction to /api/reserve so the two can't disagree.
  const { data: nextStops } = await supabaseAdmin.from("stops").select("starts_at")
    .is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
    .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(6);
  const offered = new Map<string, Date>();
  for (const st of nextStops ?? []) {
    const at = (st as { starts_at: string }).starts_at;
    offered.set(dropDateKey(new Date(at)), dropForStop(at).cutoff);
  }
  if (offered.size === 0) { const fb = nextDrop(); offered.set(dropDateKey(fb.sat), fb.cutoff); }

  const cutoff = offered.get(toDate);
  if (!cutoff) return NextResponse.json({ error: "That day isn't on the pickup schedule." }, { status: 400 });
  if (Date.now() > cutoff.getTime()) return NextResponse.json({ error: "Ordering for that day has closed — pick a later one." }, { status: 400 });

  const { data: order } = await supabaseAdmin.from("drop_orders")
    .select("id, user_id, drop_date, size, glass, name, paid, picked_up, stage, canceled_at").eq("id", id).maybeSingle();
  if (!order || order.user_id !== user.id) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.canceled_at) return NextResponse.json({ error: "That order was canceled." }, { status: 400 });
  if (order.picked_up || (order.stage && order.stage !== "reserved")) {
    return NextResponse.json({ error: "The crew already has this pack in motion — ask at the truck to move it." }, { status: 400 });
  }
  if (order.drop_date === toDate) return NextResponse.json({ ok: true, toDate });
  // Current drop must still be open: same day − 3 days at 18:00 rule the drop resolver uses.
  const cur = new Date(`${order.drop_date}T12:00:00`);
  const curCutoff = new Date(cur); curCutoff.setDate(cur.getDate() - 3); curCutoff.setHours(18, 0, 0, 0);
  if (Date.now() > curCutoff.getTime()) {
    return NextResponse.json({ error: "This pack's drop has closed — we may already be brewing it. Ask at the truck." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("drop_orders").update({ drop_date: toDate }).eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't move it — try again." }, { status: 500 });

  // FYI the crew: the drop rollups recalc live, but brew planning likes to know a pack walked.
  await raiseAlert({
    severity: "fyi", category: "order", title: "Pack moved to another drop",
    body: `${order.name} moved a ${order.size}-pack (${order.paid ? "paid" : "pay at pickup"}) from ${order.drop_date} to ${toDate}.`,
    link: "/crew?s=now",
  });
  return NextResponse.json({ ok: true, toDate });
}
