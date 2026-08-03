import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// COUPON LOOKUP (0268) — the public face of ONE code-scoped row in the member_benefits engine
// (0176). The QR landing page reads this to render the offer; nothing here isn't already printed
// on the card in someone's hand. Read-only, marketing-facing fields only, never throws.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!supabaseAdmin || !code || code.length > 40) return NextResponse.json({ ok: false }, { status: 404 });
  try {
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
