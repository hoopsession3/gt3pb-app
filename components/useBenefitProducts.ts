"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { DRINKS, type DrinkId } from "@/lib/menu";
import type { TargetProduct } from "@/lib/benefitText";

// THE PRODUCTS A DISCOUNT CAN NAME (2026-10-04, the form audit). Discount codes and Founding perks
// each carried their own copy of a four-item "Applies to" constant — PerksPanel's own comment said
// sharing it "isn't worth coupling them", and the two copies were the same four items, three of them
// right. Both now read the menu itself, once each, through here: what each product is called, what it
// costs, whether it is on the menu, and whether the checkout sells it by the cup at all (lib/menu's
// DRINKS — /api/checkout refuses anything else). lib/benefitText decides what a rule can reach.
//
// A failed read is said by the panel (`status === "error"`): with no menu, the whole order and the
// straight-brew family can still be chosen, and no single drink is offered on a guess.

export function useBenefitProducts() {
  const loader = useCallback(async (): Promise<TargetProduct[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("products").select("slug, name, price_cents, active, sort").order("sort");
    if (error) throw new Error(error.message);
    return ((data as { slug: string; name: string | null; price_cents: number | null; active: boolean | null }[]) ?? []).map((p) => ({
      slug: p.slug,
      name: (p.name ?? "").trim() || DRINKS[p.slug as DrinkId]?.n || p.slug,
      price_cents: typeof p.price_cents === "number" ? p.price_cents : null,
      active: p.active !== false,
      cup: Object.prototype.hasOwnProperty.call(DRINKS, p.slug),
    }));
  }, []);
  const products = useAsyncData(loader, []);
  // A drink repriced or taken off the menu in Menu & products shows here without a refresh.
  useRealtimeTable("products", products.reload);
  return products;
}
