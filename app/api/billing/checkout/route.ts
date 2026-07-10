import { NextResponse } from "next/server";
import { ownerFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// SOFTWARE BILLING — start a Stripe Checkout for the caller's tenant (an operator subscribing to
// No Noise). Owner-gated; dormant until STRIPE_SECRET_KEY + STRIPE_PRICE_PRO exist (the Google
// Wallet precedent: real infrastructure, env-switched). Uses Stripe's REST API directly via fetch —
// no SDK dependency, same as the rest of this repo's integrations (Square, Google Wallet).
//
// client_reference_id carries the tenant id; the webhook (billing/webhook) writes the result back
// onto public.tenants. GT3 itself is 'founder' and never comes through here.
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRICE_PRO;
  if (!key || !price) return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 503 });
  if (!(await ownerFromRequest(req))) return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const tenant = await tenantFromRequest(req);
  if (!tenant || !supabaseAdmin) return NextResponse.json({ error: "No tenant." }, { status: 400 });

  const { data: t } = await supabaseAdmin.from("tenants").select("slug, plan, stripe_customer_id").eq("id", tenant).maybeSingle();
  if (!t) return NextResponse.json({ error: "No tenant." }, { status: 400 });
  if (t.plan === "founder") return NextResponse.json({ error: "Founding tenant — nothing to buy." }, { status: 400 });

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: tenant,
    success_url: `${origin}/crew?billing=success`,
    cancel_url: `${origin}/crew?billing=canceled`,
    ...(t.stripe_customer_id ? { customer: t.stripe_customer_id } : {}),
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const session = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) return NextResponse.json({ error: session.error?.message ?? "Stripe error." }, { status: 502 });
  return NextResponse.json({ url: session.url });
}
