"use client";

import { useCallback, useState } from "react";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { SectionHeader, InfoRow } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { money } from "@/lib/money";
import { nameOf, type CatalogProduct } from "@/lib/catalog";
import Button from "./Button";
import ProductPage from "./ProductPage";

// MENU / PRODUCT manager — the catalog as a managed, relational record. Edit every attribute
// (name, line, price, description, ingredients), set the recipe (which inventory items a serving
// consumes), and toggle active. Price here is what the app charges — card AND cash. Fetch state via
// useAsyncData — a failed load is a real error now, not a silent "No products yet."
//
// A DRINK OPENS ITS OWN PAGE (2026-10-12, the Catalog round, approved). A row used to expand in place into a form whose
// draft the next read of this list overwrote (`useEffect(() => { setD(p); }, [p])` — an 86 on any other row wiped what
// was being typed), whose save won over anybody's newer change without a word, and whose recipe, when it failed to
// read, looked like no recipe at all. Tapping a row opens components/ProductPage now: the same fields and refusals,
// where the drink is sold, its recipe and cost, and its 86s — and the page keeps what is typed, asks before saving over
// somebody else's change, and says when the recipe could not be read. The rules are lib/catalog's.

export default function MenuManager() {
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  // The row as it was when its page opened: if somebody deletes it while the page is open, the page stays, says so,
  // and keeps what was typed, instead of vanishing with it.
  const [opened, setOpened] = useState<CatalogProduct | null>(null);

  // The inventory read moved to the product's page, with the recipe it prices (components/ProductPage).
  const loader = useCallback(async (): Promise<CatalogProduct[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("products").select("*").order("sort");
    if (error) throw new Error(error.message);
    return (data as CatalogProduct[]) ?? [];
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  const products = board.data ?? [];
  const live = openId ? products.find((p) => p.id === openId) ?? null : null;
  const page = live ?? (openId ? opened : null);

  const create = async () => {
    if (!supabase) return;
    const slug = `item-${Math.random().toString(36).slice(2, 7)}`;
    // New products start as an OFF-menu draft with a blank name — they can't be charged from until
    // they're named, priced (> $0) and switched on, so a stray "+ New" click can't put junk on the live menu.
    const { data, error } = await supabase.from("products").insert({ slug, name: "", line: "Activation", price_cents: 0, active: false, sort: (products.at(-1)?.sort ?? 0) + 1 }).select("*").single();
    if (error || !data) { toast(`Couldn't add an item — ${error?.message ?? "nothing came back"}`, "error"); return; }
    await reload();
    setOpened(data as CatalogProduct); setOpenId((data as CatalogProduct).id);
  };
  const open = (p: CatalogProduct) => { setOpened(p); setOpenId(p.id); };
  const close = () => { setOpenId(null); setOpened(null); };
  const deleted = () => { close(); void reload(); };

  // 86 / un-86 in one tap, right from the list — the live menu and every open cart update in
  // realtime, and both checkout paths refuse the item at the database until it's flipped back.
  const toggle86 = async (p: CatalogProduct) => {
    if (!supabase) return;
    const next = !p.sold_out;
    const { error } = await supabase.from("products").update({ sold_out: next }).eq("id", p.id);
    if (error) toast(`Error: ${error.message}`, "error");
    else { toast(next ? `${nameOf(p)} 86'd — marked SOLD OUT on the live menu` : `${nameOf(p)} is back on the menu`); void reload(); }
  };

  return (
    <>
      <AsyncSection state={board} isEmpty={(data) => data.length === 0} emptyTitle="No products yet" emptySub="Run migration 0062, or add one."
        emptyAction={<button type="button" className="btn-sec btn-sm" onClick={create}>+ New item</button>} errorTitle="Couldn't load the menu">
        {() => (
          <div className="adm-sec">
            <div className="studio-top">
              <SectionHeader label="Menu & products" />
              {/* "+New item" just opens a blank draft — it doesn't commit anything, so it's not
                  the primary action (see ProductPage's Save for that). .btn-sec, same tier Studio.tsx
                  uses for its own deliberate-but-not-committing actions. Kept inside .studio-top
                  (not folded into SectionHeader's own `right` slot) on purpose: when this screen is
                  Panel-wrapped (it always is, via app/crew/page.tsx), the CSS rule
                  `.mpanel-body > .adm-sec > .studio-top > .k-sec{display:none}` hides the dupe
                  SectionHeader title but relies on the button staying a SIBLING of .k-sec, not a
                  child of it — moving the button inside SectionHeader's `right` would hide it too. */}
              <button type="button" className="btn-sec btn-sm" onClick={create}>+ New item</button>
            </div>
            <div className="h-sub">The catalog the app charges from — card &amp; cash. Edit every attribute, set each drink&apos;s recipe (the inventory a serving uses), toggle what&apos;s on the menu.</div>
            {products.map((p) => <ProductRow key={p.id} p={p} onOpen={() => open(p)} on86={() => { void toggle86(p); }} />)}
          </div>
        )}
      </AsyncSection>
      {/* Outside the list's own states, keyed by the product: a read of the list never remounts the page. */}
      {page && (
        <ProductPage key={page.id} p={page} gone={!live && board.status === "ready"} onClose={close}
          onFlip={(p) => { void toggle86(p); }} onSaved={() => { void reload(); }} onDeleted={deleted} />
      )}
    </>
  );
}

function ProductRow({ p, onOpen, on86 }: { p: CatalogProduct; onOpen: () => void; on86: () => void }) {
  return (
    <div className="prod">
      {/* Collapsed summary as a kit InfoRow: name (+ the timing dot) on the left; off/sold-out
          badges as nameExtra; line + price + the 86 quick-toggle grouped as trailing, preserving
          the original single-line, right-aligned arrangement (.prod-head used margin-left:auto to
          push line+price to the right of the same row). bodyClick (not onClick) because trailing
          holds its OWN interactive button (86/Back on) — onClick would wrap the entire row,
          86-button included, in one outer <button>, nesting buttons and double-firing clicks.
          Wrapped in .k-rows purely so the existing `.k-rows>.k-row:last-child{border-bottom:0}`
          rule zeroes this row's border. The body opens the drink's page (2026-10-12). */}
      <div className="k-rows">
        <InfoRow
          bodyClick={onOpen}
          ariaLabel={p.name ? `${p.name} — open its page` : "Open the new item's page"}
          name={<>
            {/* was `p.timing ? undefined : undefined` — both branches identical, so the live timing
                field never rendered anything. Daypart colors match the customer pillars. */}
            <span className="prod-dot" data-on={p.timing || undefined} style={{ background: { BEFORE: "#B8902F", DURING: "#3f7d6e", AFTER: "#B82420" }[(p.timing || "").trim().toUpperCase()] }} />
            {p.name}
          </>}
          nameExtra={<>
            {!p.active && <span className="prod-off">off</span>}
            {p.active && p.sold_out && <span className="prod-86tag">SOLD OUT{p.sold_out_at ? ` · ${new Date(p.sold_out_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>}
          </>}
          trailing={<>
            <span className="prod-line">{p.line}</span>
            <span className="prod-px">{money(p.price_cents)}</span>
            {p.active && (
              <Button type="button" kind="secondary" compact className="shrink-0" onClick={on86}>
                {p.sold_out ? "Back on" : "86"}
              </Button>
            )}
          </>}
        />
      </div>
    </div>
  );
}
