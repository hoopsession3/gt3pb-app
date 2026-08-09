import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest } from "@/lib/apiAuth";
import { apliiqGet } from "@/lib/apliiq";

export const runtime = "nodejs";

// APLIIQ CATALOG IMPORT (0273) — staff-only. Pulls the product catalog from Apliiq's API server-side
// (the app key + shared secret live ONLY in env — never in the client, never in this repo) and lands
// each product in shop_products, keyed by apliiq_product_id, BORN HIDDEN (published_at = null, the
// 0270 publish gate). Nothing appears in /shop until a human publishes it from the crew Merch view.
//
// Non-destructive on re-run: a product we've already imported keeps the crew's curation (title, retail
// price, blurb, publish state). We only refresh the Apliiq-sourced media — the mockup gallery and the
// wholesale cost — plus fill variants/hero image if the crew hasn't set them. So re-syncing pulls
// fresher mockups without ever clobbering a hand-set price or un-publishing a live product.
//
// NOTE on what this returns: Apliiq's documented GET /Product is the print catalog (blank apparel +
// their stock mockups). GT3-branded mockups require saved *designs* applied to those blanks inside
// Apliiq; once those exist they arrive through this same endpoint. This import is the plumbing — it
// brings back whatever the account's Product API exposes.
/* eslint-disable @typescript-eslint/no-explicit-any */

const asArray = (v: any): any[] => (Array.isArray(v) ? v : []);
const clean = (v: any): string => (v == null ? "" : String(v)).trim();
function pick(o: any, keys: string[]): any {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
}
// Apliiq documents Price as a decimal dollar amount (e.g. 27.99) → store cents.
function toCents(v: any): number {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}
// Walk every place a mockup URL is known to hide and collect the http(s) ones, deduped + capped.
function collectImages(p: any): string[] {
  const out: string[] = [];
  const push = (v: any) => { const s = clean(v); if (/^https?:\/\//i.test(s)) out.push(s); };
  const IMG_KEYS = ["ImagePath", "Image", "ImageUrl", "imageUrl", "Mockup", "MockupUrl", "MockupImage", "PreviewImage", "Thumbnail", "Url", "url"];
  IMG_KEYS.forEach((k) => push(p?.[k]));
  ["Subscriptions", "SubProducts", "Products", "Mockups", "Placements", "Images", "Colors", "Variants", "Views"].forEach((k) =>
    asArray(p?.[k]).forEach((c: any) => IMG_KEYS.forEach((kk) => push(c?.[kk])))
  );
  return [...new Set(out)].slice(0, 12);
}
function labels(list: any, keys: string[]): string[] {
  return asArray(list).map((x) => (typeof x === "string" ? x : clean(pick(x, keys)))).filter(Boolean);
}
function buildVariants(p: any): any[] {
  // Prefer a structured variant/SKU list if Apliiq gives one (carries the ids we need to order).
  const raw = asArray(pick(p, ["Variants", "variants", "SKUs", "Skus", "skus"]));
  if (raw.length) {
    const mapped = raw.slice(0, 120).map((v) => ({
      size: clean(pick(v, ["Size", "size"])) || undefined,
      color: clean(pick(v, ["Color", "color"])) || undefined,
      sku: clean(pick(v, ["SKU", "Sku", "sku"])) || undefined,
      apliiq_variant_id: clean(pick(v, ["Id", "id", "VariantId", "variantId"])) || undefined,
    })).filter((v) => v.size || v.color || v.sku);
    if (mapped.length) return mapped;
  }
  // Else synthesize from Sizes × Colors (labels only — enough for the picker; ids resolve at order time).
  const sizes = labels(pick(p, ["Sizes", "sizes"]), ["Name", "Size", "Value", "Label", "Code"]);
  const colors = labels(pick(p, ["Colors", "colors"]), ["Name", "Color", "Value", "Label", "Code"]);
  const out: any[] = [];
  if (sizes.length && colors.length) {
    for (const c of colors) for (const s of sizes) { if (out.length >= 80) break; out.push({ size: s, color: c }); }
  } else if (sizes.length) sizes.forEach((s) => out.push({ size: s }));
  else if (colors.length) colors.forEach((c) => out.push({ color: c }));
  return out;
}

export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Storage isn't switched on." }, { status: 503 });
  if (!(await staffFromRequest(req))) return NextResponse.json({ error: "Staff only." }, { status: 401 });
  if (!process.env.APLIIQ_APP_KEY || !process.env.APLIIQ_SHARED_SECRET) {
    return NextResponse.json({ error: "Apliiq isn't configured yet (missing env keys)." }, { status: 503 });
  }

  // 1) Pull the catalog server-side.
  let raw: any;
  try {
    raw = await apliiqGet("/Product");
  } catch (e) {
    return NextResponse.json({ error: `Couldn't reach Apliiq: ${String((e as Error)?.message ?? e).slice(0, 140)}` }, { status: 502 });
  }
  const list: any[] = Array.isArray(raw) ? raw : asArray(pick(raw, ["Products", "products", "data", "Data", "items", "Items"]));
  if (list.length === 0) {
    return NextResponse.json({ ok: true, fetched: 0, created: 0, updated: 0, skipped: 0, note: "Apliiq returned no products for this account." });
  }

  // 2) Map into catalog rows, dropping anything without a usable Apliiq id.
  const mapped = list.slice(0, 500).map((p) => {
    const apliiqId = clean(pick(p, ["Id", "id", "ProductId", "productId"]));
    if (!apliiqId) return null;
    const images = collectImages(p);
    return {
      apliiqId,
      title: clean(pick(p, ["Name", "name", "Title", "title"])) || `Apliiq ${apliiqId}`,
      price_cents: toCents(pick(p, ["Price", "price", "RetailPrice", "retailPrice"])),
      cost_cents: toCents(pick(p, ["Cost", "cost", "BaseCost", "WholesalePrice", "basePrice"])) || null,
      image_url: images[0] ?? null,
      images,
      variants: buildVariants(p),
    };
  }).filter(Boolean) as any[];
  if (mapped.length === 0) {
    return NextResponse.json({ ok: true, fetched: list.length, created: 0, updated: 0, skipped: list.length, note: "No products carried an Apliiq id we could key on." });
  }

  // 3) Reconcile against what we already have — key on apliiq_product_id (born-hidden on first sight,
  //    curation-preserving on re-sync). The partial unique index rules out a blind upsert, so we
  //    read-then-write: new rows insert full; known rows only get fresher media + cost.
  const ids = [...new Set(mapped.map((m) => m.apliiqId))];
  const { data: existingRows, error: exErr } = await supabaseAdmin
    .from("shop_products")
    .select("id, apliiq_product_id, image_url, variants")
    .in("apliiq_product_id", ids);
  if (exErr) return NextResponse.json({ error: "Couldn't read the existing catalog." }, { status: 500 });
  const known = new Map((existingRows ?? []).map((r: any) => [r.apliiq_product_id, r]));

  const toInsert: any[] = [];
  let created = 0, updated = 0, skipped = 0;
  for (let i = 0; i < mapped.length; i++) {
    const m = mapped[i];
    const row = known.get(m.apliiqId);
    if (!row) {
      toInsert.push({
        kind: "merch",
        apliiq_product_id: m.apliiqId,
        title: m.title,
        price_cents: m.price_cents,
        cost_cents: m.cost_cents,
        image_url: m.image_url,
        images: m.images,
        variants: m.variants,
        published_at: null, // born hidden — 0270 publish gate
        sort: i,
      });
      continue;
    }
    // Known product: refresh Apliiq-owned media + cost; fill hero/variants only if crew hasn't set them.
    const patch: any = { images: m.images, cost_cents: m.cost_cents, updated_at: new Date().toISOString() };
    if (!row.image_url && m.image_url) patch.image_url = m.image_url;
    if ((!Array.isArray(row.variants) || row.variants.length === 0) && m.variants.length) patch.variants = m.variants;
    const { error: upErr } = await supabaseAdmin.from("shop_products").update(patch).eq("id", row.id);
    if (upErr) skipped++; else updated++;
  }

  if (toInsert.length) {
    const { data: ins, error: insErr } = await supabaseAdmin.from("shop_products").insert(toInsert).select("id");
    if (insErr) return NextResponse.json({ error: `Couldn't save new products: ${insErr.message}`, created, updated, skipped }, { status: 500 });
    created = ins?.length ?? toInsert.length;
  }

  const sample = mapped.slice(0, 6).map((m) => ({ apliiqId: m.apliiqId, title: m.title, price_cents: m.price_cents, hasImage: !!m.image_url, variants: m.variants.length }));
  return NextResponse.json({
    ok: true, fetched: list.length, mapped: mapped.length, created, updated, skipped,
    hint: "Imported hidden. Publish from the crew Merch view to make them live in /shop.", sample,
  });
}
