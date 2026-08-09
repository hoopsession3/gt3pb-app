"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { isBlank } from "@/lib/formGuard";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { SectionHeader, InfoRow } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";

// THE SHOP · merch manager (0273) — the crew's publish + curation surface for the storefront. Products
// arrive from Apliiq through the staff-only import (server-side, born hidden); here the crew sets the
// retail price, picks the hero mockup, writes the blurb, and flips a product live in /shop. Same house
// pattern as the menu + lessons managers: writes go straight through the browser client under RLS
// `is_staff()`. Publish = stamp published_at; unpublish = clear it. Nothing sells until it's published.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Product = {
  id: string; kind: string; apliiq_product_id: string | null; title: string; public_title: string | null;
  blurb: string | null; price_cents: number; cost_cents: number | null; image_url: string | null;
  images: string[]; variants: any[]; sort: number; published_at: string | null; archived_at: string | null;
};

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export default function MerchManager() {
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loader = useCallback(async (): Promise<Product[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("shop_products")
      .select("id, kind, apliiq_product_id, title, public_title, blurb, price_cents, cost_cents, image_url, images, variants, sort, published_at, archived_at")
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

  const live = products.filter((p) => p.published_at && !p.archived_at).length;

  return (
    <AsyncSection state={board} isEmpty={() => false} emptyTitle="No products yet" errorTitle="Couldn't load the shop">
      {() => (
        <div className="adm-sec">
          <div className="studio-top">
            <SectionHeader label="The Shop · merch" />
            <button type="button" className="btn-sec" onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Sync from Apliiq"}</button>
          </div>
          <div className="h-sub">
            Pull products from Apliiq, then curate. Every import lands <b>hidden</b> — set the retail price, pick the hero mockup,
            and publish when it's ready. {products.length} product{products.length === 1 ? "" : "s"} · {live} live in /shop.
          </div>

          {products.length === 0 && (
            <div className="prod-recipe" style={{ marginTop: 12 }}>
              <div className="insp-lbl">No products yet</div>
              <p className="h-sub" style={{ margin: "4px 0 0" }}>Hit <b>Sync from Apliiq</b> to bring your catalog in. If nothing appears, the Apliiq keys may not be set in the environment yet, or the account has no products.</p>
            </div>
          )}

          {products.map((p) => (
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
  useEffect(() => { setD(p); setPriceStr((p.price_cents / 100).toFixed(2)); }, [p]);

  const published = !!d.published_at && !d.archived_at;
  const dollarsToCents = (s: string) => Math.max(0, Math.round((Number(s) || 0) * 100));

  const save = async () => {
    if (!supabase) return;
    if (isBlank(d.title)) { toast("Give it a title first", "error"); return; }
    const price_cents = dollarsToCents(priceStr);
    const { error } = await supabase.from("shop_products").update({
      title: d.title.trim(), public_title: d.public_title?.trim() || null, blurb: d.blurb,
      price_cents, image_url: d.image_url, sort: d.sort, published_at: d.published_at, archived_at: d.archived_at,
      updated_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (error) toast(`Error: ${error.message}`, "error"); else { toast("Saved"); onSaved(); }
  };
  const togglePublish = () => setD({ ...d, published_at: d.published_at ? null : new Date().toISOString() });
  const toggleArchive = () => setD({ ...d, archived_at: d.archived_at ? null : new Date().toISOString() });

  const margin = (() => {
    const price = dollarsToCents(priceStr);
    if (!d.cost_cents || !price) return null;
    return price - d.cost_cents;
  })();

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
          {(d.images.length > 0) && (
            <div className="prod-recipe">
              <div className="insp-lbl">Mockups from Apliiq — click one to make it the hero</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {d.images.map((src) => (
                  <button type="button" key={src} onClick={() => setD({ ...d, image_url: src })}
                    style={{ padding: 0, border: d.image_url === src ? "2px solid var(--gold2, #B8902F)" : "1px solid var(--line, #ccc)", borderRadius: 8, background: "#fff", cursor: "pointer", lineHeight: 0 }}>
                    <img src={src} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6 }} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="prod-grid">
            <label className="prod-f"><span>Title (internal)</span><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
            <label className="prod-f"><span>Retail price ($)</span><input type="number" step="0.01" min="0" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} /></label>
            <label className="prod-f"><span>Public title (optional)</span><input value={d.public_title ?? ""} onChange={(e) => setD({ ...d, public_title: e.target.value })} placeholder="shown to shoppers" /></label>
            <label className="prod-f"><span>Sort</span><input type="number" value={d.sort} onChange={(e) => setD({ ...d, sort: Number(e.target.value) || 0 })} /></label>
          </div>
          <label className="prod-f"><span>Blurb</span><textarea rows={3} value={d.blurb ?? ""} onChange={(e) => setD({ ...d, blurb: e.target.value })} placeholder="The pitch shoppers read on the product page." /></label>

          <div className="insp-lbl" style={{ marginTop: 4 }}>
            {d.cost_cents != null ? <>Apliiq cost {money(d.cost_cents)}{margin != null && <> · margin <b style={{ color: margin >= 0 ? "inherit" : "var(--oa-red, #B82420)" }}>{money(margin)}</b></>}</> : "Apliiq cost not reported"}
            {d.variants.length > 0 && <> · {d.variants.length} option{d.variants.length === 1 ? "" : "s"}</>}
            {d.apliiq_product_id && <> · Apliiq #{d.apliiq_product_id}</>}
          </div>

          <label className="prod-toggle"><input type="checkbox" checked={published} onChange={togglePublish} disabled={!!d.archived_at} /> Published — visible in /shop{published && d.published_at ? ` (since ${new Date(d.published_at).toLocaleDateString()})` : ""}</label>
          <label className="prod-toggle"><input type="checkbox" checked={!!d.archived_at} onChange={toggleArchive} /> Archived — pulled from the shop entirely</label>
          <div className="prod-actions" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn-pri" onClick={save} disabled={isBlank(d.title)}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
