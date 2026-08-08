import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyApliiq, firstSeen } from "@/lib/apliiq";

export const runtime = "nodejs";

// APLIIQ → us: "add/update product to store" (0271). Verified by HMAC, idempotent by event id, the
// product is upserted into shop_products by its Apliiq id and BORN HIDDEN (published_at null) — you
// publish it to /shop with one tap. Defensive: a malformed payload is 400'd, never crashes.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyApliiq(raw, req.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let p: any;
  try { p = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const apliiqId = String(p?.Id ?? p?.id ?? p?.productId ?? "").trim();
  if (!apliiqId) return NextResponse.json({ ok: false, error: "no product id" }, { status: 400 });

  const eventId = req.headers.get("x-apliiq-delivery") || `product:${apliiqId}:${p?.updated_at ?? p?.UpdatedAt ?? ""}`;
  if (!(await firstSeen("apliiq", eventId))) return NextResponse.json({ ok: true, deduped: true });

  const priceCents = Math.round(Number(p?.Price ?? p?.price ?? 0) * 100) || 0;
  const costCents = p?.Cost != null || p?.cost != null ? Math.round(Number(p.Cost ?? p.cost) * 100) : null;
  const row = {
    kind: "merch" as const,
    apliiq_product_id: apliiqId,
    title: String(p?.Name ?? p?.title ?? "Merch item").slice(0, 200),
    blurb: (p?.Description ?? p?.blurb ?? null) ? String(p.Description ?? p.blurb).slice(0, 2000) : null,
    price_cents: priceCents,
    cost_cents: costCents,
    image_url: p?.ImagePath ?? p?.image ?? p?.image_url ?? null,
    images: Array.isArray(p?.images) ? p.images : [],
    variants: Array.isArray(p?.variants) ? p.variants : Array.isArray(p?.Sizes) ? p.Sizes : [],
    updated_at: new Date().toISOString(),
  };
  // Upsert by apliiq id; leave published_at untouched so a re-sync never un-publishes a live product.
  const { data: existing } = await supabaseAdmin.from("shop_products").select("id").eq("apliiq_product_id", apliiqId).maybeSingle();
  const { error } = existing
    ? await supabaseAdmin.from("shop_products").update(row).eq("id", (existing as any).id)
    : await supabaseAdmin.from("shop_products").insert(row);   // born hidden (published_at defaults null)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, product: apliiqId, created: !existing });
}
