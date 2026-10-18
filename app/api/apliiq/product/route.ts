import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { TablesUpdate } from "@/lib/database.types";
import { verifyApliiq, firstSeen, forgetSeen, bodyKey } from "@/lib/apliiq";
import { integrationTenant } from "@/lib/tenantScope";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

/** A price in dollars as cents: a positive amount, or none (never 0 for a price that wasn't given). */
const cents = (v: unknown): number | null => {
  const n = Math.round(Number(v) * 100);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

// APLIIQ → us: "add/update product to store" (0271). Verified by HMAC, idempotent by event id, the
// product is upserted into shop_products by its Apliiq id and BORN HIDDEN (published_at null) — you
// publish it to /shop with one tap. Defensive: a malformed payload is 400'd, never crashes.
//
// R9 (2026-10-16 — the money audit's A10):
//   · The inbox key is the signed body itself (lib/apliiq bodyKey) — never x-apliiq-delivery, a header outside the
//     signature. A captured update sent again with a new one was applied again: an old price, an old picture, put back.
//     The same bytes are answered "deduped"; past the inbox's 30 days the signature's own age refuses them
//     (lib/webhookSignature APLIIQ_MAX_AGE_S).
//   · An update says only what it carries. A sync without a price set the price to $0 — on a product already on sale,
//     where checkout charges the catalog's price — and one without a name renamed it "Merch item". A field left out is
//     left as it is; a new product with no price is born hidden, as every new one is, and checkout refuses an unpriced
//     line (app/api/shop/checkout).
//   · The product is found in, and written to, this deployment's storefront — as every other write here.
//   · A write that failed gives the event back, so Apliiq's retry is applied, not answered "deduped"; the database's
//     own words stay in the logs, not in the answer.
async function post(req: Request) {
  const raw = await req.text();
  if (!verifyApliiq(raw, req.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  const tenant = integrationTenant();

  let p: Record<string, unknown> | null;
  try { p = JSON.parse(raw) as Record<string, unknown> | null; } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const apliiqId = String(p?.Id ?? p?.id ?? p?.productId ?? "").trim().slice(0, 64);
  if (!apliiqId) return NextResponse.json({ ok: false, error: "no product id" }, { status: 400 });

  const eventId = `product:${apliiqId}:${bodyKey(raw)}`;
  if (!(await firstSeen("apliiq", eventId))) return NextResponse.json({ ok: true, deduped: true });

  const name = String(p?.Name ?? p?.title ?? "").trim().slice(0, 200);
  const blurb = p?.Description ?? p?.blurb;
  const price = cents(p?.Price ?? p?.price);
  const costGiven = p?.Cost ?? p?.cost;
  const image = p?.ImagePath ?? p?.image ?? p?.image_url;
  const vs = p?.variants, sizes = p?.Sizes, imgs = p?.images;
  const variants = Array.isArray(vs) ? vs : Array.isArray(sizes) ? sizes : null;
  // What this update carries, and nothing it doesn't.
  const given: TablesUpdate<"shop_products"> = { updated_at: new Date().toISOString() };
  if (name) given.title = name;
  if (blurb != null && String(blurb).trim()) given.blurb = String(blurb).slice(0, 2000);
  if (price != null) given.price_cents = price;
  if (costGiven != null && costGiven !== "" && Number.isFinite(Number(costGiven))) given.cost_cents = Math.max(0, Math.round(Number(costGiven) * 100));
  if (typeof image === "string" && image.trim()) given.image_url = image.trim().slice(0, 1000);
  if (Array.isArray(imgs)) given.images = imgs;
  if (variants) given.variants = variants;

  // Upsert by apliiq id; leave published_at untouched so a re-sync never un-publishes a live product.
  // scoped-by: tenant_id = this deployment's storefront tenant; the Apliiq id is read from the signed body.
  const found = await supabaseAdmin.from("shop_products").select("id").eq("tenant_id", tenant).eq("apliiq_product_id", apliiqId).limit(1);
  if (found.error) { await forgetSeen("apliiq", eventId); return NextResponse.json({ ok: false, error: "not recorded — send it again" }, { status: 503 }); }
  const existing = (found.data ?? [])[0] as { id: string } | undefined;
  const { error } = existing
    // scoped-by: the product just found in this deployment's storefront, by its own id
    ? await supabaseAdmin.from("shop_products").update(given).eq("id", existing.id).eq("tenant_id", tenant)
    // born hidden (published_at defaults null), stamped with this storefront's tenant (0134)
    : await supabaseAdmin.from("shop_products").insert({
        tenant_id: tenant, kind: "merch" as const, apliiq_product_id: apliiqId, title: "Merch item", blurb: null, price_cents: 0, cost_cents: null,
        image_url: null, images: [], variants: [], ...given,
      });
  if (error) { await forgetSeen("apliiq", eventId); return NextResponse.json({ ok: false, error: "not recorded — send it again" }, { status: 500 }); }
  return NextResponse.json({ ok: true, product: apliiqId, created: !existing });
}

export const POST = route("apliiq/product", post);
