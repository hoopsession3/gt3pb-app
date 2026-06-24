import { NextResponse } from "next/server";
import { ownerFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canvaEnabled } from "@/lib/canva";
import { webflowEnabled } from "@/lib/webflow";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Live status for the architecture map. Owner-only. Returns ONLY booleans/status strings derived
// from env presence + table existence — never any secret value. Keys match component.key in the manifest.
const TABLES: Record<string, string> = {
  studio: "content_items", brandkit: "brand_kit", brandassets: "brand_assets",
  compliance: "compliance_rules", notes: "meeting_notes", alerts: "alerts",
  audit: "audit_log", inventory: "inventory_items", events: "event_tasks",
};

export async function GET(req: Request) {
  if (!(await ownerFromRequest(req))) return NextResponse.json({ ok: false, error: "owners only" }, { status: 403 });

  const status: Record<string, "live" | "configured" | "staged"> = {};
  // Integrations: configured (code ready) vs live (key present).
  status.anthropic = process.env.ANTHROPIC_API_KEY ? "live" : "configured";
  status.canva = canvaEnabled() ? "live" : "configured";
  status.webflow = webflowEnabled() ? "live" : "configured";
  status.square = process.env.SQUARE_ACCESS_TOKEN ? "live" : "configured";
  status.supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? "live" : "staged";

  // Tables: applied (migration run) → live, else staged.
  if (supabaseAdmin) {
    await Promise.all(Object.entries(TABLES).map(async ([key, table]) => {
      try {
        const { error } = await supabaseAdmin!.from(table).select("*", { count: "exact", head: true });
        status[key] = error ? "staged" : "live";
      } catch { status[key] = "staged"; }
    }));
  }

  return NextResponse.json({ ok: true, status });
}
