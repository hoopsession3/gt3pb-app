import { NextResponse } from "next/server";
import { ownerFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Live business KPIs for the owner-only Progress view. Owner-gated. Returns counts + sums only
// (no PII, no secrets), computed in one round-trip by progress_kpis() (migration 0069).
export async function GET(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "owners only" }, { status: 403 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "no admin client" }, { status: 503 });

  const { data, error } = await supabaseAdmin.rpc("progress_kpis");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, kpis: data as Record<string, number> });
}
