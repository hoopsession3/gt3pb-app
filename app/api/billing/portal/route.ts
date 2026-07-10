import { NextResponse } from "next/server";
import { ownerFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// SOFTWARE BILLING — Stripe customer portal (update card, cancel, invoices) for the caller's
// tenant. Owner-gated, dormant until STRIPE_SECRET_KEY exists. Self-serve billing management is
// table stakes for "software people pay for" — nobody emails support to update a card.
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 503 });
  if (!(await ownerFromRequest(req))) return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const tenant = await tenantFromRequest(req);
  if (!tenant || !supabaseAdmin) return NextResponse.json({ error: "No tenant." }, { status: 400 });

  const { data: t } = await supabaseAdmin.from("tenants").select("stripe_customer_id").eq("id", tenant).maybeSingle();
  if (!t?.stripe_customer_id) return NextResponse.json({ error: "No billing on file." }, { status: 400 });

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ customer: t.stripe_customer_id, return_url: `${origin}/crew` }).toString(),
  });
  const session = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) return NextResponse.json({ error: session.error?.message ?? "Stripe error." }, { status: 502 });
  return NextResponse.json({ url: session.url });
}
