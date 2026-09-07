"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { isBlank } from "@/lib/formGuard";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { SectionHeader, InfoRow } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import MediaStudio from "@/components/MediaStudio";
import { readMedia, toColumns, type MediaItem } from "@/lib/shopMedia";

// THE SHOP · merch manager (0273/0274) — the crew's publish + curation surface for the storefront.
// Products arrive three ways: the in-house studio capsule (seeded), a bulk Apliiq catalog sync, and a
// manual "+ Add product" (paste a real Apliiq product's ID + its mockup image address — the reliable
// path for a custom store, since Apliiq only auto-pushes to Shopify). Writes go straight through the
// browser client under RLS `is_staff()`. Publish = stamp published_at; archived items are tucked away
// behind a toggle. Nothing sells until it's published.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Product = {
  id: string; kind: string; apliiq_product_id: string | null; title: string; public_title: string | null;
  blurb: string | null; price_cents: number; cost_cents: number | null; image_url: string | null;
  images: string[]; variants: any[]; sort: number; published_at: string | null; archived_at: string | null;
  media?: unknown;   // 0278 — [{id,url,kind,poster?,alt?}]; read through lib/shopMedia
};

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
const variantsFrom = (sizes: string, colors: string): any[] => {
  const s = sizes.split(",").map((x) => x.trim()).filter(Boolean);
  const c = colors.split(",").map((x) => x.trim()).filter(Boolean);
  const out: any[] = [];
  if (s.length && c.length) { for (const col of c) for (const sz of s) out.push({ size: sz, color: col }); }
  else if (s.length) s.forEach((sz) => out.push({ size: sz }));
  else if (c.length) c.forEach((col) => out.push({ color: col }));
  return out;
};

export default function MerchManager() {
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [na, setNa] = useState({ title: "", price: "", apliiq: "", image: "", sizes: "", colors: "" });

  const loader = useCallback(async (): Promise<Product[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("shop_products")
      .select("id, kind, apliiq_product_id, title, public_title, blurb, price_cents, cost_cents, image_url, images, variants, sort, published_at, archived_at, media")
      .eq("kind", "merch").order("sort");
    if (error) throw new Error(error.message);
    return ((data as any[]) ?? []).map((p) => ({ ...p, images: Array.isArray(p.images) ? p.images : [], variants: Array.isArray(p.variants) ? p.variants : [] }));
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  const products = board.data ?? [];

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await authedFetch("/api/apliiq/import", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || "Apliiq sync failed", "error"); return; }
      const bits = [d.created ? `${d.created} new` : "", d.updated ? `${d.updated} refreshed` : ""].filter(Boolean).join(" · ");
      toast(d.fetched === 0 ? "Apliiq returned no products yet" : `Synced from Apliiq${bits ? ` — ${bits}` : " — no changes"}`);
      await reload();
    } catch {
      toast("Couldn't reach the sync service", "error");
    } finally {
      setSyncing(false);
    }
  };

  const addProduct = async () => {
    if (!supabase) return;
    if (isBlank(na.title)) { toast("Give it a title", "error"); return; }
    const image = na.image.trim();
    const { error } = await supabase.from("shop_products").insert({
      kind: "merch", title: na.title.trim(),
      price_cents: Math.max(0, Math.round((Number(na.price) || 0) * 100)),
      apliiq_product_id: na.apliiq.trim() || null,
      image_url: image || null, images: image ? [image] : [],
      variants: variantsFrom(na.sizes, na.colors), published_at: null, sort: 100,
    });
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    toast("Added (hidden) — open it to confirm and publish");
    setNa({ title: "", price: "", apliiq: "", image: "", sizes: "", colors: "" }); setShowAdd(false); await reload();
  };

  const archivedCount = products.filter((p) => p.archived_at).length;
  const shown = products.filter((p) => showArchived || !p.archived_at);
  const live = products.filter((p) => p.published_at && !p.archived_at).length;

  return (
    <AsyncSection state={board} isEmpty={() => false} emptyTitle="No products yet" errorTitle="Couldn't load the shop">
      {() => (
        <div className="adm-sec">
          <div className="studio-top">
            <SectionHeader label="The Shop · merch" />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn-sec" onClick={() => setShowAdd((s) => !s)}>{showAdd ? "Close" : "+ Add product"}</button>
              <button type="button" className="btn-sec" onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Sync from Apliiq"}</button>
            </div>
          </div>
          <div className="h-sub">
            {live} live in /shop · {shown.length} shown{archivedCount > 0 ? ` · ${archivedCount} archived` : ""}.
            Curate here — set the retail price, pick the hero mockup, publish. To sell a real Apliiq item, <b>+ Add product</b>
            with its Apliiq ID and mockup address (right-click the mockup on Apliiq → Copy image address).
          </div>

          {showAdd && (
            <div className="prod-recipe" style={{ marginTop: 10 }}>
              <div className="insp-lbl">Add a product</div>
              <div className="prod-grid">
                <label className="prod-f"><span>Title</span><input value={na.title} onChange={(e) => setNa({ ...na, title: e.target.value })} placeholder="GT3 Five-Panel Cap" /></label>
                <label className="prod-f"><span>Retail price ($)</span><input type="number" step="0.01" min="0" value={na.price} onChange={(e) => setNa({ ...na, price: e.target.value })} /></label>
                <label className="prod-f"><span>Apliiq product ID (for POD)</span><input value={na.apliiq} onChange={(e) => setNa({ ...na, apliiq: e.target.value })} placeholder="5888216" /></label>
                <label className="prod-f"><span>Mockup image address</span><input value={na.image} onChange={(e) => setNa({ ...na, image: e.target.value })} placeholder="https://…" /></label>
                <label className="prod-f"><span>Sizes (comma-sep)</span><input value={na.sizes} onChange={(e) => setNa({ ...na, sizes: e.target.value })} placeholder="S, M, L, XL" /></label>
                <label className="prod-f"><span>Colors (comma-sep)</span><input value={na.colors} onChange={(e) => setNa({ ...na, colors: e.target.value })} placeholder="Black, Cream" /></label>
              </div>
              <div className="prod-actions"><button type="button" className="btn-pri" onClick={addProduct} disabled={isBlank(na.title)}>Add (hidden)</button></div>
            </div>
          )}

          {archivedCount > 0 && (
            <label className="prod-toggle" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived ({archivedCount})
            </label>
          )}

          {shown.length === 0 && (
            <div className="prod-recipe" style={{ marginTop: 12 }}>
              <div className="insp-lbl">Nothing here yet</div>
              <p className="h-sub" style={{ margin: "4px 0 0" }}>Use <b>+ Add product</b> to place your first item, or <b>Sync from Apliiq</b> to pull the catalog.</p>
            </div>
          )}

          {shown.map((p) => (
            <MerchRow key={p.id} p={p} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} onSaved={reload} toast={toast} />
          ))}
        </div>
      )}
    </AsyncSection>
  );
}

function MerchRow({ p, open, onToggle, onSaved, toast }: { p: Product; open: boolean; onToggle: () => void; onSaved: () => void; toast: (m: string, t?: any) => void }) {
  const [d, setD] = useState(p);
  const [priceStr, setPriceStr] = useState((p.price_cents / 100).toFixed(2));
  const [media, setMedia] = useState<MediaItem[]>(() => readMedia(p));
  useEffect(() => { setD(p); setPriceStr((p.price_cents / 100).toFixed(2)); setMedia(readMedia(p)); }, [p]);

  const published = !!d.published_at && !d.archived_at;
  const dollarsToCents = (s: string) => Math.max(0, Math.round((Number(s) || 0) * 100));

  const save = async () => {
    if (!supabase) return;
    if (isBlank(d.title)) { toast("Give it a title first", "error"); return; }
    const price_cents = dollarsToCents(priceStr);
    // A hero address typed into the field is media too — fold it in ahead of the uploads rather
    // than letting the two fight over image_url on save.
    const typedHero = (d.image_url || "").trim();
    const merged = typedHero && !media.some((m) => m.url === typedHero)
      ? [{ id: typedHero, url: typedHero, kind: "image" as const }, ...media]
      : media;
    // media is canonical; image_url/images are DERIVED so every pre-0278 reader is untouched.
    const cols = toColumns(merged);
    const { error } = await supabase.from("shop_products").update({
      title: d.title.trim(), public_title: d.public_title?.trim() || null, blurb: d.blurb,
      price_cents, media: cols.media, image_url: cols.image_url, images: cols.images,
      sort: d.sort, published_at: d.published_at, archived_at: d.archived_at,
      updated_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (error) toast(`Error: ${error.message}`, "error"); else { toast("Saved"); onSaved(); }
  };
  // ONE LIFECYCLE, NOT TWO CHECKBOXES. This was a "Published" box and an "Archived" box, and the
  // line above already proves they are one value: published = has a published_at AND no archived_at.
  // Archiving silently unpublished, then disabled the Published box while its date was still set —
  // so you could not see what un-archiving would restore. Three states, one control, and
  // published_at is preserved through an archive so returning to Published means what it says.
  type Life = "hidden" | "published" | "archived";
  const life: Life = d.archived_at ? "archived" : (d.published_at ? "published" : "hidden");
  const setLife = (next: Life) => {
    if (next === "archived") { setD({ ...d, archived_at: new Date().toISOString() }); return; }
    if (next === "published") { setD({ ...d, archived_at: null, published_at: d.published_at ?? new Date().toISOString() }); return; }
    setD({ ...d, archived_at: null, published_at: null });
  };

  const margin = (() => { const price = dollarsToCents(priceStr); if (!d.cost_cents || !price) return null; return price - d.cost_cents; })();

  return (
    <div className={`prod${open ? " open" : ""}`}>
      <div className="k-rows">
        <InfoRow
          bodyClick={onToggle} expanded={open} ariaLabel={`${d.title} — edit product`}
          name={<>
            {d.image_url
              ? <img src={d.image_url} alt="" style={{ width: 26, height: 26, borderRadius: 5, objectFit: "cover", marginRight: 2, verticalAlign: "middle" }} />
              : <span className="prod-dot" style={{ background: "#8a8577" }} />}
            {d.public_title || d.title}
          </>}
          nameExtra={<>{!published && <span className="prod-off">{d.archived_at ? "archived" : "hidden"}</span>}</>}
          trailing={<span className="prod-line">{money(dollarsToCents(priceStr))}</span>}
        />
      </div>
      {open && (
        <div className="prod-body">
          <MediaStudio productId={p.id} value={media} onChange={setMedia} />
          <div className="prod-grid">
            <label className="prod-f"><span>Title (internal)</span><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
            <label className="prod-f"><span>Retail price ($)</span><input type="number" step="0.01" min="0" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} /></label>
            <label className="prod-f"><span>Public title (optional)</span><input value={d.public_title ?? ""} onChange={(e) => setD({ ...d, public_title: e.target.value })} placeholder="shown to shoppers" /></label>
            <label className="prod-f"><span>Sort</span><input type="number" value={d.sort} onChange={(e) => setD({ ...d, sort: Number(e.target.value) || 0 })} /></label>
          </div>
          <label className="prod-f"><span>Or paste an address (an Apliiq mockup, say) — it joins the media above</span><input value={d.image_url ?? ""} onChange={(e) => setD({ ...d, image_url: e.target.value })} placeholder="https://… or /shop/…" /></label>
          <label className="prod-f"><span>Blurb</span><textarea rows={3} value={d.blurb ?? ""} onChange={(e) => setD({ ...d, blurb: e.target.value })} placeholder="The pitch shoppers read on the product page." /></label>

          <div className="insp-lbl" style={{ marginTop: 4 }}>
            {d.cost_cents != null ? <>Apliiq cost {money(d.cost_cents)}{margin != null && <> · margin <b style={{ color: margin >= 0 ? "inherit" : "var(--oa-red, #B82420)" }}>{money(margin)}</b></>}</> : "No POD cost set"}
            {d.variants.length > 0 && <> · {d.variants.length} option{d.variants.length === 1 ? "" : "s"}</>}
            {d.apliiq_product_id ? <> · Apliiq #{d.apliiq_product_id}</> : <> · <span style={{ color: "var(--oa-red, #B82420)" }}>no Apliiq link</span></>}
          </div>

          <label className="prod-f"><span>Visibility</span>
            <select value={life} onChange={(e) => setLife(e.target.value as Life)} aria-label="Product visibility">
              <option value="hidden">Hidden — not in the shop, still editable</option>
              <option value="published">Published — visible in /shop</option>
              <option value="archived">Archived — pulled from the shop entirely</option>
            </select>
          </label>
          {life === "published" && d.published_at && <div className="dp-hint">Live since {new Date(d.published_at).toLocaleDateString()}.</div>}
          {life === "archived" && d.published_at && <div className="dp-hint">Was live since {new Date(d.published_at).toLocaleDateString()} — set back to Published to restore it.</div>}
          <div className="prod-actions" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn-pri" onClick={save} disabled={isBlank(d.title)}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
