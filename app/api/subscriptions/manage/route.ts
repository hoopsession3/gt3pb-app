import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { SQUARE_BASE, squareHeaders, mapSubStatus, squareDeadline } from "@/lib/squareServer";
import { route } from "@/lib/apiRoute";

// Pause / resume / cancel the caller's own subscription via Square. The webhook
// reconciles the mirror authoritatively; we update it optimistically for fast UI.
async function post(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token || !supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  let body: { action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });   // a literal null is valid JSON (R10b): a 400, not a TypeError's 500
  const action = body.action || "";
  if (!["pause", "resume", "cancel"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const { data: sub, error: subError } = await supabaseAdmin
    .from("subscriptions").select("square_subscription_id").eq("user_id", user.id).in("status", ["active", "paused", "pending", "past_due"]).maybeSingle();
  // A read that failed is not "no subscription" (R39 — the fresh audit's API11-06): it says so, and nothing changes.
  if (subError) return NextResponse.json({ error: "We couldn't read your subscription just now — try again in a moment. Nothing was changed." }, { status: 503 });
  if (!sub?.square_subscription_id) return NextResponse.json({ error: "No active subscription." }, { status: 404 });
  const id = sub.square_subscription_id;

  try {
    const url =
      action === "pause" ? `${SQUARE_BASE}/v2/subscriptions/${id}/pause`
      : action === "resume" ? `${SQUARE_BASE}/v2/subscriptions/${id}/resume`
      : `${SQUARE_BASE}/v2/subscriptions/${id}/cancel`;
    const res = await fetch(url, { method: "POST", headers: squareHeaders(token), body: JSON.stringify({}), signal: squareDeadline() });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data?.errors?.[0]?.detail || "Action failed" }, { status: 400 });

    // Optimistic; webhook delivers the authoritative state. Square cancels at
    // period-end and still returns status ACTIVE, so for cancel we honor the
    // member's intent directly rather than trusting the synchronous status.
    const optimistic = action === "cancel" ? "canceled" : action === "pause" ? "paused" : "active";
    const next = mapSubStatus(data?.subscription?.status);
    const written = action === "cancel" ? "canceled" : next === "pending" ? optimistic : next;
    // scoped-by: `id` was read above with .eq("user_id", user.id), so it is provably this
    // caller's own subscription. The update keys off that verified id, not off anything the
    // request supplied — the ownership check is two statements up, where a regex cannot see it.
    const mirrored = await supabaseAdmin.from("subscriptions")
      .update({ status: written, updated_at: new Date().toISOString() })
      .eq("square_subscription_id", id);
    // Square has it either way, and its webhook brings the mirror round; a mirror that missed is said in the log (R12b, F4).
    if (mirrored.error) console.error(`subscriptions: ${action} done at Square for ${id}, but the mirror wasn't updated — ${mirrored.error.message}`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 502 });
  }
}

export const POST = route("subscriptions/manage", post);
