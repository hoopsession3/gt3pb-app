import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { apliiqGet } from "@/lib/apliiq";

export const runtime = "nodejs";
// The heavy-route default this codebase already uses everywhere else (agents/*, transcribe, …).
// It was absent here, which is almost certainly WHY the 500 cap existed: somebody bounded the
// wall-clock by throwing data away rather than by bounding the work. Bound the work instead.
export const maxDuration = 60;

// How many ids one PostgREST `.in()` may carry. The filter travels in the URL, so a 1,583-id list
// is a request nothing will accept — chunked, not capped.
const ID_CHUNK = 200;
// How many row updates may be in flight at once. Sequential was fine for 500 and is not fine for
// 1,583; unbounded parallelism is how you take the database down instead of the clock.
const WRITE_CONCURRENCY = 8;

/** Run `work` over `items` with a fixed number of workers. Preserves nothing but the side effects. */
async function pool<T>(items: T[], n: number, work: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await work(items[idx]); }
  }));
}

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
  // R-002: staff-gated, so unlike the two Apliiq WEBHOOKS this one has a caller and the caller is
  // the right scope. tenantFromRequest, not the integration constant.
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ error: "No tenant on this session." }, { status: 401 });
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
  //
  // THE WHOLE CATALOG, NOT THE FIRST 500. This said `list.slice(0, 500)` and reported
  // `fetched: 1583, mapped: 500` without a word about the 1,083 it threw away. Apliiq returns the
  // catalog alphabetically, so the import stopped dead at "Heavyweight T Shirt" — every product
  // from I to Z was invisible, and the only way to discover that was to count the letters in the
  // rows it did import. A GT3 design named "Motion on Tap Tee" or "TH3 Cap" would never have
  // appeared, and the response would still have said ok: true.
  //
  // A limit is still sensible — a runaway catalog should not become an unbounded write — but a
  // limit that is SILENT is a lie. It is now far above any real catalog, and if it ever bites, the
  // response says so in `dropped` and `truncated`, which the crew view surfaces.
  const MAX_PRODUCTS = 5000;
  const dropped = Math.max(0, list.length - MAX_PRODUCTS);
  const mapped = list.slice(0, MAX_PRODUCTS).map((p) => {
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
  // CHUNKED. A PostgREST `.in()` puts every id in the URL, so one call carrying 1,583 of them is a
  // request that never arrives. With the old cap this was 500 and got away with it.
  const known = new Map<string, any>();
  for (let s = 0; s < ids.length; s += ID_CHUNK) {
    const { data: rows, error: exErr } = await supabaseAdmin
      .from("shop_products")
      .select("id, apliiq_product_id, image_url, variants").eq("tenant_id", tenant)
      .in("apliiq_product_id", ids.slice(s, s + ID_CHUNK));
    if (exErr) return NextResponse.json({ error: "Couldn't read the existing catalog." }, { status: 500 });
    for (const r of (rows ?? []) as any[]) known.set(r.apliiq_product_id, r);
  }

  const toInsert: any[] = [];
  const toUpdate: { row: any; m: any }[] = [];
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
    // COLLECTED, not written here. One write per loop iteration was fine at 500 and is not fine at
    // 1,583 sequential round trips — that clock is what the old cap was really protecting.
    toUpdate.push({ row, m });
  }

  await pool(toUpdate, WRITE_CONCURRENCY, async ({ row, m }) => {
    const patch: any = { images: m.images, cost_cents: m.cost_cents, updated_at: new Date().toISOString() };
    if (!row.image_url && m.image_url) patch.image_url = m.image_url;
    if ((!Array.isArray(row.variants) || row.variants.length === 0) && m.variants.length) patch.variants = m.variants;
    // scoped-by: row.id came from the tenant-filtered read above, and the tenant filter is repeated
    // here anyway — that read is now forty lines away and a later edit could move it.
    const { error: upErr } = await supabaseAdmin!.from("shop_products").update(patch).eq("id", row.id).eq("tenant_id", tenant);
    if (upErr) skipped++; else updated++;
  });

  if (toInsert.length) {
    // Chunked for the same reason the read is. Partial progress is kept rather than lost: a failure
    // halfway through still reports what actually landed.
    for (let s = 0; s < toInsert.length; s += ID_CHUNK) {
      const batch = toInsert.slice(s, s + ID_CHUNK);
      const { data: ins, error: insErr } = await supabaseAdmin.from("shop_products").insert(batch).select("id");
      if (insErr) return NextResponse.json({ error: `Couldn't save new products: ${insErr.message}`, created, updated, skipped }, { status: 500 });
      created += ins?.length ?? batch.length;
    }
  }

  // WHAT CAME BACK, not only what was kept. The old response returned six alphabetically-first
  // samples, which is exactly how "it stopped at H" stayed invisible: every sample was a number or
  // a "1/2-Zip", and nothing said the alphabet ran out. firstTitle/lastTitle name the range the
  // import actually covered, and withArt answers the question underneath all of this — how many of
  // these products carry a mockup at all, i.e. how many are real designs rather than blanks.
  const sample = mapped.slice(0, 6).map((m) => ({ apliiqId: m.apliiqId, title: m.title, price_cents: m.price_cents, hasImage: !!m.image_url, variants: m.variants.length }));
  const withArt = mapped.filter((m) => !!m.image_url).length;
  return NextResponse.json({
    ok: true,
    fetched: list.length, examined: mapped.length, dropped, truncated: dropped > 0,
    created, updated, skipped, withArt,
    firstTitle: mapped[0]?.title ?? null, lastTitle: mapped[mapped.length - 1]?.title ?? null,
    hint: dropped > 0
      ? `Imported hidden. ${dropped} product(s) past the ${MAX_PRODUCTS} ceiling were NOT examined — this response is incomplete.`
      : "Imported hidden. Publish from the crew Merch view to make them live in /shop.",
    sample,
  });
}
