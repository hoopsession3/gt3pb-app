import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest } from "@/lib/apiAuth";
import { notifyCustomer, emailEnabled, smsEnabled } from "@/lib/notify";

// LIFECYCLE PINGS the crew fires from the boards — the customer can't be expected to sit in the
// app. order_ready: the pass advanced an order to Ready (walk-up/pre-orders carry no phone, so
// this reaches the member's account email). delivered: a Sunday porch run outcome (delivery
// orders carry a phone — SMS + email). Staff-gated; env-gated senders no-op until keys land.
export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!emailEnabled() && !smsEnabled()) return NextResponse.json({ ok: true, skipped: "no provider keys yet" });

  let kind = "", id = "";
  try { ({ kind = "", id = "" } = await req.json()); } catch { /* */ }
  if (!id || !["order_ready", "delivered"].includes(kind)) {
    return NextResponse.json({ ok: false, error: "kind + id required" }, { status: 400 });
  }

  const emailOf = async (userId: string | null): Promise<string | null> => {
    if (!userId) return null;
    const { data } = await supabaseAdmin!.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  };

  try {
    if (kind === "order_ready") {
      const { data: o } = await supabaseAdmin.from("orders").select("id, customer, user_id").eq("id", id).maybeSingle();
      if (!o) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      const first = (o.customer || "").split(" ")[0];
      const sent = await notifyCustomer({
        email: await emailOf(o.user_id),
        subject: "GT3 — your order is ready",
        message: `GT3: ${first ? `${first}, ` : ""}your order is ready at the window — come grab it while it's fresh.`,
      });
      return NextResponse.json({ ok: true, ...sent });
    }
    // delivered
    const { data: d } = await supabaseAdmin.from("delivery_orders")
      .select("id, name, phone, user_id, refill_count").eq("id", id).maybeSingle();
    if (!d) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const first = (d.name || "").split(" ")[0];
    const sent = await notifyCustomer({
      phone: d.phone,
      email: await emailOf(d.user_id),
      subject: "GT3 — delivered",
      message: `GT3: ${first ? `${first}, ` : ""}your bottles are on the porch${Number(d.refill_count) > 0 ? " — we took your empties" : ""}. Fresh 7 days from today.`,
    });
    return NextResponse.json({ ok: true, ...sent });
  } catch {
    return NextResponse.json({ ok: false, error: "notify failed" }, { status: 502 });
  }
}
