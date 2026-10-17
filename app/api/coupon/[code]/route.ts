import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { route } from "@/lib/apiRoute";
import { callerIp } from "@/lib/rateLimit";

// public: a read of one code's marketing fields — nothing here that is not already printed on the card in someone's hand
// COUPON LOOKUP (0268) — the public face of ONE code-scoped row in the member_benefits engine
// (0176). The QR landing page reads this to render the offer; nothing here isn't already printed
// on the card in someone's hand. Read-only, marketing-facing fields only, never throws.
async function get(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!supabaseAdmin || !code || code.length > 40) return NextResponse.json({ ok: false }, { status: 404 });
  // Counted (R9 — the abuse audit's eleventh): a code is printed on a card, and a script asking code after code found the
  // ones that weren't. Sixty an address in ten minutes — a person scanning a card asks once, and a table of them on one
  // venue's Wi-Fi stays under — in the store every instance shares. Past it: "couldn't check", never "ended" (the page
  // says so and asks again on a tap). Fails open.
  const ip = callerIp(req);
  const fits = await supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `coupon:${ip}`, p_window_ms: 600_000, p_max: 60 });
  if (fits.data === false) return NextResponse.json({ ok: false, busy: true }, { status: 429 });
  try {
    // scoped-by: member_benefits.code carries a UNIQUE index (verified in production), so this
    // lookup returns at most one row in the whole table — a stricter key than tenant_id. The
    // code is also printed on a card in somebody's hand; nothing here is not already public.
    const { data } = await supabaseAdmin.from("member_benefits")
      .select("code, kind, label, active")
      .eq("scope", "code")
      .ilike("code", code.trim().replace(/[%_\\]/g, (c) => `\\${c}`))
      .maybeSingle();
    if (!data) return NextResponse.json({ ok: false }, { status: 404 });
    return NextResponse.json({ ok: true, code: data.code, kind: data.kind, label: data.label, active: data.active });
  } catch {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
}

export const GET = route("coupon/[code]", get);
