"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useAppStable } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { SectionHeader } from "@/components/kit";
import { Segmented } from "@/components/controls";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { haptic } from "@/lib/haptics";
import { money } from "@/lib/money";
import {
  FILTERS, availabilityOf, citiesByProduct, emptyLine, filterCounts, flipToast, nameOf, outInLine, rowSpoken, shownGroups, shownRow,
  undoOpen, undoStart, type CatalogFilter, type CatalogProduct, type City86,
} from "@/lib/catalog";
import AsyncSection from "./AsyncSection";
import ProductPage, { AvailSwitch } from "./ProductPage";
import { plainFailure, failureWords } from "@/lib/failureWords";

// MENU / PRODUCT manager — the catalog as a managed, relational record. Edit every attribute
// (name, line, price, description, ingredients), set the recipe (which inventory items a serving
// consumes), and toggle active. Price here is what the app charges — card AND cash. Fetch state via
// useAsyncData — a failed load is a real error now, not a silent "No products yet."
//
// A LIST TO WORK FROM, A PAGE TO EDIT ON (2026-10-12, the Catalog round, approved). Measured on an iPhone 17 with
// eleven drinks, this panel ran 1,976 points: four and a half drinks fit on the first screen, behind a four-line
// paragraph, each drink a card 77 points tall whose way in was its name — 20 points of text — and whose 86 a screen
// reader heard as "86". Now each drink is one row about 56 points tall: its name and its price open its page
// (components/ProductPage — the expander's fields, where it is sold, its recipe and cost, its 86s), and its
// availability switch says "On sale" or "86'd" out loud ("RISE, on sale. Double-tap to 86."). The rows sit under
// their line, with a filter and a search above them; the paragraph is one quiet line. The rules — the words, the
// filter, the version check, the undo window — are lib/catalog's, run by scripts/smoke.cjs (THE CATALOG).
//
// LIVE (2026-10-12). The list read once, so an 86 called from the Pass stayed on sale here until a reload. It reads
// again on every change to products (lib/realtime — which also puts it on the app's refresh: pull to refresh, and
// coming back to the app), and an open product keeps what was typed into it across those reads (ProductPage).
//
// AN 86 IS FOR ONE CITY (2026-10-15, 0408 — Ryan: "Pass: its city. Catalog: all"). The switch here is every city, as it
// was. The Pass's 86 is its own city's (product_86): read beside the list, live, and said on the row ("86'd in
// Greenville") and on the drink's page, and counted under 86'd — so what the Pass ran out of never reads "on sale" here.

const NO_CITIES: readonly City86[] = [];

/** The map without one key — an 86 that has landed (or failed) is no longer on its way. */
const without = <T,>(m: Readonly<Record<string, T>>, id: string): Record<string, T> => {
  const next = { ...m };
  delete next[id];
  return next;
};

export default function MenuManager() {
  const { toast } = useAppStable();
  const [openId, setOpenId] = useState<string | null>(null);
  // The row as it was when its page opened: if somebody deletes it while the page is open, the page stays, says so,
  // and keeps what was typed, instead of vanishing with it.
  const [opened, setOpened] = useState<CatalogProduct | null>(null);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [q, setQ] = useState("");
  // An 86 on its way to the database (shown at once, the way the Pass's board does), and the rows this screen's own
  // writes answered with — newer than the list until it reads again (lib/catalog freshest: the newest version wins).
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [held, setHeld] = useState<Record<string, CatalogProduct>>({});
  // A second tap while the first is still on its way is the same tap (read in the handlers only, never while drawing).
  const flying = useRef(new Set<string>());

  const loader = useCallback(async (): Promise<CatalogProduct[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("products").select("*").order("sort");
    if (error) throw new Error(error.message);
    return (data as CatalogProduct[]) ?? [];
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  // The crew's 86 from the Pass, the 4am reset, another owner's save: each reads the list again, here and now.
  useRealtimeTable("products", reload);
  // Each city's 86s (0408). A read that failed is not "out nowhere": the list says so above the rows.
  const cityLoader = useCallback(async (): Promise<City86[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("product_86").select("product_id, market, sold_out_at, sold_out_by");
    if (error) throw new Error(error.message);
    return (data as City86[]) ?? [];
  }, []);
  const city = useAsyncData(cityLoader, []);
  useRealtimeTable("product_86", city.reload);
  const cities = useMemo(() => citiesByProduct(city.data), [city.data]);

  const products = useMemo(() => (board.data ?? []).map((p) => {
    const row = shownRow(p, pending, held);
    const out = cities.get(p.id);
    return out ? { ...row, outIn: out.map((c) => c.market) } : row;
  }), [board.data, pending, held, cities]);
  const groups = useMemo(() => shownGroups(products, filter, q), [products, filter, q]);
  const counts = useMemo(() => filterCounts(products, q), [products, q]);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const live = openId ? products.find((p) => p.id === openId) ?? null : null;
  const page = live ?? (openId ? opened : null);

  const create = async () => {
    if (!supabase) return;
    const slug = `item-${Math.random().toString(36).slice(2, 7)}`;
    // New products start as an OFF-menu draft with a blank name — they can't be charged from until
    // they're named, priced (> $0) and switched on, so a stray "+ New" click can't put junk on the live menu.
    const { data, error } = await supabase.from("products").insert({ slug, name: "", line: "Activation", price_cents: 0, active: false, sort: (products.at(-1)?.sort ?? 0) + 1 }).select("*").single();
    if (error || !data) { toast(`Couldn't add an item — ${error ? plainFailure(error) : "nothing came back"}`, "error"); return; }
    // A filter on "On sale" would hide the draft it just made; show everything, and open it.
    setFilter("all"); setQ("");
    await reload();
    setOpened(data as CatalogProduct); setOpenId((data as CatalogProduct).id);
  };
  const open = (p: CatalogProduct) => { setOpened(p); setOpenId(p.id); };
  const close = () => { setOpenId(null); setOpened(null); };

  // The undo writes back only over what the 86 wrote: if the Pass changed it again in those seconds, it is theirs.
  const undo = async (row: CatalogProduct, next: boolean, at: number) => {
    if (!supabase || !undoOpen(at) || flying.current.has(row.id)) return;
    flying.current.add(row.id);
    if (next) haptic("toggleOff"); else haptic("toggleOn");
    setPending((m) => ({ ...m, [row.id]: !next }));
    const { data, error } = await supabase.from("products").update({ sold_out: !next }).eq("id", row.id).eq("sold_out", next).select("*");
    const back = (data as CatalogProduct[] | null)?.[0];
    flying.current.delete(row.id);
    setPending((m) => without(m, row.id));
    if (error) { toast(failureWords(error, "Couldn't undo"), "error"); return; }
    if (!back) { toast(`${nameOf(row)} changed again since — nothing to undo`, "info"); void reload(); return; }
    setHeld((m) => ({ ...m, [back.id]: back }));
  };
  // 86 / un-86 in one tap, right from the list — the live menu and every open cart update in
  // realtime, and both checkout paths refuse the item at the database until it's flipped back.
  //
  // DONE, THEN UNDONE IF IT WAS A SLIP (2026-10-12). An 86 is frequent and reversible, so it does not ask first: the
  // switch flips under the finger with the Pass's own feel (components/EightySix: an 86 is toggleOn, back on sale is
  // toggleOff), the write goes, and the toast holds an Undo for the window lib/catalog names (UNDO_MS).
  const flip = async (p: CatalogProduct) => {
    if (!supabase || flying.current.has(p.id)) return;
    flying.current.add(p.id);
    const next = !p.sold_out;
    if (next) haptic("toggleOn"); else haptic("toggleOff");
    setPending((m) => ({ ...m, [p.id]: next }));
    const { data, error } = await supabase.from("products").update({ sold_out: next }).eq("id", p.id).select("*");
    const row = (data as CatalogProduct[] | null)?.[0];
    flying.current.delete(p.id);
    setPending((m) => without(m, p.id));
    if (error || !row) { toast(`Couldn't ${next ? "86" : "put back"} ${nameOf(p)} — ${error ? plainFailure(error) : "the change didn't save"}`, "error"); return; }
    setHeld((m) => ({ ...m, [row.id]: row }));
    const at = undoStart();
    toast(flipToast(nameOf(p), next), "success", { action: { label: "Undo", run: () => { void undo(row, next, at); } } });
  };
  const adopt = (row: CatalogProduct) => setHeld((m) => ({ ...m, [row.id]: row }));
  const deleted = () => { close(); void reload(); };
  const showAll = () => { setFilter("all"); setQ(""); };

  return (
    <>
      <AsyncSection state={board} isEmpty={(data) => data.length === 0} emptyTitle="No products yet" emptySub="Run migration 0062, or add one."
        emptyAction={<button type="button" className="btn-sec btn-sm" onClick={create}>+ New item</button>} errorTitle="Couldn't load the menu">
        {() => (
          <div className="adm-sec">
            <div className="studio-top">
              <SectionHeader label="Menu & products" />
              {/* The search shares the row "+ New item" was alone on (2026-10-12) — the base field, 44pt and 16px. */}
              <input type="search" className="flex-1 appearance-none" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search the menu" aria-label="Search the menu" enterKeyHint="search" autoComplete="off" />
              {/* "+New item" just opens a blank draft — it doesn't commit anything, so it's not
                  the primary action (see ProductPage's Save for that). .btn-sec, same tier Studio.tsx
                  uses for its own deliberate-but-not-committing actions. Kept inside .studio-top
                  (not folded into SectionHeader's own `right` slot) on purpose: when this screen is
                  Panel-wrapped (it always is, via app/crew/page.tsx), the CSS rule
                  `.mpanel-body > .adm-sec > .studio-top > .k-sec{display:none}` hides the dupe
                  SectionHeader title but relies on the button staying a SIBLING of .k-sec, not a
                  child of it — moving the button inside SectionHeader's `right` would hide it too. */}
              <button type="button" className="btn-sec btn-sm shrink-0" onClick={create}>+ New item</button>
            </div>
            {/* The four-line paragraph, as one quiet line (2026-10-12): the panel's own sub says what the list is. */}
            <p className="m-0 mb-3 text-caption text-cream-muted">The app charges these prices, card and cash.</p>
            {city.status === "error" && (
              <p className="cp-line mt-0 mb-3" role="alert">Couldn&apos;t read what the trucks have 86&apos;d in their cities — that is not the same as nothing.{" "}
                <button type="button" className="btn-ter" onClick={() => { void city.reload(); }}>Try again</button></p>
            )}
            <Segmented kind="choice" label="Show" fill value={filter} onChange={(k) => { haptic("selection"); setFilter(k); }}
              options={FILTERS.map((f) => ({ key: f.key, label: <>{f.label}{counts[f.key] > 0 && <span className="k-seg-n">{counts[f.key]}</span>}</> }))} />
            <p className="sr-only" role="status">{`${shown} of ${products.length} shown`}</p>
            {groups.length === 0 ? (
              <p className="cp-line dim mt-3">{emptyLine(filter, q)}{" "}<button type="button" className="btn-ter" onClick={showAll}>Show everything</button></p>
            ) : groups.map((g) => (
              <section key={g.key || "none"} className="mt-4">
                <h3 className="m-0 font-mono text-caption2 font-medium uppercase tracking-eyebrow text-cream-muted">{g.label}</h3>
                <div className="k-rows">
                  {g.items.map((p) => <MenuRow key={p.id} p={p} onOpen={() => open(p)} onFlip={() => { void flip(p); }} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </AsyncSection>
      {/* Outside the list's own states, keyed by the product: a read of the list never remounts the page. */}
      {page && (
        <ProductPage key={page.id} p={page} gone={!live && board.status === "ready"} onClose={close}
          cities={cities.get(page.id) ?? NO_CITIES} onCityBack={() => { void city.reload(); }}
          onFlip={(p) => { void flip(p); }} onSaved={adopt} onDeleted={deleted} />
      )}
    </>
  );
}

/** One product, one row about 56 points tall: the name and the price open its page (a 56-point target, where the name
 *  alone was 20); the switch beside them 86es it. A product off the menu says "Off" where the switch would be. One the
 *  Pass has 86'd in a city says where under its name — the switch is every city's (0408). */
function MenuRow({ p, onOpen, onFlip }: { p: CatalogProduct & { outIn?: readonly string[] }; onOpen: () => void; onFlip: () => void }) {
  const where = p.active && !p.sold_out ? outInLine(p.outIn) : null;
  return (
    <div className="k-row py-0 gap-3">
      <button type="button" onClick={onOpen} aria-label={rowSpoken(p)}
        className="flex-1 min-w-0 min-h-14 flex items-center gap-3 p-0 border-0 bg-transparent text-left text-cream [font:inherit] cursor-pointer appearance-none transition-opacity active:opacity-70">
        <span className="flex-1 min-w-0">
          <span className="block line-clamp-2 break-words font-bold text-callout">{nameOf(p)}</span>
          {where && <span className="block text-footnote text-red-hover">{where}</span>}
        </span>
        <span className="prod-px shrink-0">{money(p.price_cents)}</span>
      </button>
      {availabilityOf(p) === "off"
        ? <span className="w-30 shrink-0 flex justify-end" aria-hidden="true"><span className="k-tag txt">Off</span></span>
        : <AvailSwitch p={p} onFlip={onFlip} />}
    </div>
  );
}
