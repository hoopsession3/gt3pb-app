import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyApliiq } from "@/lib/apliiq";

export const runtime = "nodejs";

// APLIIQ → us: "product search" (0271). Apliiq asks whether we carry a product so its UI can link a
// design to ours. Verified by HMAC; returns matching merch rows in a simple shape. Read-only.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyApliiq(raw, req.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  const url = new URL(req.url);
  let term = url.searchParams.get("search") || "";
  if (!term) { try { term = String(JSON.parse(raw || "{}")?.search ?? ""); } catch { /* */ } }

  let q = supabaseAdmin.from("shop_products").select("apliiq_product_id, title, price_cents, image_url")
    .eq("kind", "merch").is("archived_at", null);
  if (term.trim()) q = q.ilike("title", `%${term.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { data, error } = await q.limit(50);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    products: ((data ?? []) as any[]).map((r) => ({
      id: r.apliiq_product_id, name: r.title, price: (r.price_cents ?? 0) / 100, image: r.image_url,
    })),
  });
}
