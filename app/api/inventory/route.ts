/* eslint-disable @typescript-eslint/no-explicit-any */
// Inventory bridge → reads the GT3 `inventory_items` table in Postgres (system-of-record as of
// 0041; migrated off the read-only Notion bridge). Staff-only. Same shape the event-prep
// have-vs-need + restock logic already consumes, so callers are unchanged.

import { createClient } from "@supabase/supabase-js";
import { staffFromRequest } from "@/lib/apiAuth";

export async function GET(req: Request) {
  if (!(await staffFromRequest(req))) return Response.json({ enabled: false, items: [], error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!url || !anon || !token) return Response.json({ enabled: false, items: [] });

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.from("inventory_items").select("*");
  if (error) return Response.json({ enabled: true, error: error.message, items: [] });

  const num = (v: any) => (typeof v === "number" ? v : v == null ? null : Number(v));
  const items = (data ?? []).map((r: any) => ({
    name: r.name || "—",
    qty: num(r.qty),
    eventReady: num(r.qty_event_ready),
    reorderPoint: num(r.reorder_point),
    status: r.status ?? null,
    unit: r.unit ?? null,
    category: r.category ?? null,
    useCases: r.use_cases ?? [],
    requiredFor: r.required_for ?? [],
    critical: r.critical ?? false,
    reorderLink: r.reorder_link ?? null,
  }));

  return Response.json({ enabled: true, items });
}
