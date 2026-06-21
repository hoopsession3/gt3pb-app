import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { SQUARE_BASE, squareHeaders, mapSubStatus } from "@/lib/squareServer";

// Pause / resume / cancel the caller's own subscription via Square. The webhook
// reconciles the mirror authoritatively; we update it optimistically for fast UI.
export async function POST(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token || !supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  let body: { action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const action = body.action || "";
  if (!["pause", "resume", "cancel"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const { data: sub } = await supabaseAdmin
    .from("subscriptions").select("square_subscription_id").eq("user_id", user.id).in("status", ["active", "paused", "pending"]).maybeSingle();
  if (!sub?.square_subscription_id) return NextResponse.json({ error: "No active subscription." }, { status: 404 });
  const id = sub.square_subscription_id;

  try {
    const url =
      action === "pause" ? `${SQUARE_BASE}/v2/subscriptions/${id}/pause`
      : action === "resume" ? `${SQUARE_BASE}/v2/subscriptions/${id}/resume`
      : `${SQUARE_BASE}/v2/subscriptions/${id}/cancel`;
    const res = await fetch(url, { method: "POST", headers: squareHeaders(token), body: JSON.stringify({}) });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data?.errors?.[0]?.detail || "Action failed" }, { status: 400 });

    // Optimistic; webhook delivers the authoritative state (e.g. cancel-at-period-end).
    const optimistic = action === "cancel" ? "canceled" : action === "pause" ? "paused" : "active";
    const next = mapSubStatus(data?.subscription?.status);
    await supabaseAdmin.from("subscriptions")
      .update({ status: next === "pending" ? optimistic : next, updated_at: new Date().toISOString() })
      .eq("square_subscription_id", id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 502 });
  }
}
