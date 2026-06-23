/* eslint-disable @typescript-eslint/no-explicit-any */
// Assets bridge → reads the GT3 `assets` table in Postgres (system-of-record as of 0041;
// migrated off the read-only Notion bridge). Staff-only. Returns the same shape the Gear &
// manuals panel already consumes, so the UI is unchanged. select("*") (not a narrow projection)
// to stay clear of the PostgREST cache quirk we hit on event_approvals.

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
  const { data, error } = await sb.from("assets").select("*");
  if (error) return Response.json({ enabled: true, error: error.message, items: [] });

  const rank: Record<string, number> = { "GT3 Performance Bar": 0, "GT3 Brew": 1, "Shared": 2 };
  const items = (data ?? [])
    .map((a: any) => ({
      id: a.id,
      name: a.name || "—",
      makeModel: a.make_model ?? "",
      brand: a.brand ?? null,
      category: a.category ?? [],
      useCase: a.use_case ?? "",
      manual: a.manual_url ?? null,
      kbStatus: a.kb_status ?? null,
      qty: typeof a.qty === "number" ? a.qty : null,
      notionUrl: a.notion_url ?? null,
    }))
    .sort((x: any, y: any) => (rank[x.brand] ?? 3) - (rank[y.brand] ?? 3) || x.name.localeCompare(y.name));

  return Response.json({ enabled: true, items });
}
