"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { isMissingColumn } from "@/lib/schemaSkew";
import { isSeedSlug, nameFrom } from "@/lib/drinks";
import type { TargetProduct } from "@/lib/benefitText";

// THE PRODUCTS A DISCOUNT CAN NAME (2026-10-04, the form audit). Discount codes and Founding perks
// each carried their own copy of a four-item "Applies to" constant — PerksPanel's own comment said
// sharing it "isn't worth coupling them", and the two copies were the same four items, three of them
// right. Both now read the menu itself, once each, through here: what each product is called, what it
// costs, whether it is on the menu, and whether the checkout sells it by the cup at all (products.cup_orderable since
// 0393, the Catalog's own answer — R2, 2026-10-13; before it, the code list's ten drinks, the only ones Pay sold).
// lib/benefitText decides what a rule can reach.
//
// A failed read is said by the panel (`status === "error"`): with no menu, the whole order and the
// straight-brew family can still be chosen, and no single drink is offered on a guess.

export function useBenefitProducts() {
  const loader = useCallback(async (): Promise<TargetProduct[]> => {
    if (!supabase) return [];
    // arrives-with: 0393 — until cup_orderable is pasted the read without it, and the code list's ten are the cups.
    type Row = { slug: string; name: string | null; price_cents: number | null; active: boolean | null; cup_orderable?: boolean | null };
    const full = await supabase.from("products").select("slug, name, price_cents, active, sort, cup_orderable").order("sort");
    const r: { data: unknown; error: { message: string } | null } = full.error && isMissingColumn(full.error)
      ? await supabase.from("products").select("slug, name, price_cents, active, sort").order("sort")
      : full;
    if (r.error) throw new Error(r.error.message);
    return ((r.data as Row[] | null) ?? []).map((p) => ({
      slug: p.slug,
      name: nameFrom([p], p.slug),
      price_cents: typeof p.price_cents === "number" ? p.price_cents : null,
      active: p.active !== false,
      cup: typeof p.cup_orderable === "boolean" ? p.cup_orderable : isSeedSlug(p.slug),
    }));
  }, []);
  const products = useAsyncData(loader, []);
  // A drink repriced or taken off the menu in Menu & products shows here without a refresh.
  useRealtimeTable("products", products.reload);
  return products;
}
