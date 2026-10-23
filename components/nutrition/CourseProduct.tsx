"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppStable } from "@/components/AppProvider";
import { failureWords } from "@/lib/failureWords";
import { money, moneyPlain } from "@/lib/money";
import { COURSE_TIER } from "@/lib/nutritionBuy";

// GT3 NUTRITION, THE PRODUCT (R48 — the owner had no way to change the course's price or take it off sale: it isn't
// merch, so the merch editor never listed it). Its price and whether it's on sale, an owner's or an admin's (the
// database's "shop products admin write", 0382) and in the Activity log (0445). Hidden takes the buy button off the
// course page and the course's row off the Shop at once; buyers keep what they bought.

type Row = { id: string; price_cents: number; published_at: string | null };

export default function CourseProduct({ canEdit }: { canEdit: boolean }) {
  const { toast } = useAppStable();
  const loader = useCallback(async (): Promise<Row | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.from("shop_products").select("id, price_cents, published_at")
      .eq("kind", "program_tier").eq("program_tier", COURSE_TIER).is("archived_at", null).order("sort").limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Row | null) ?? null;
  }, []);
  const board = useAsyncData<Row | null>(loader, []);
  const row = board.data;
  const [price, setPrice] = useState<string | null>(null);
  const [onSale, setOnSale] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  if (board.status === "loading") return <div className="crm-note">The course — loading…</div>;
  if (board.status === "error") return <div className="crm-note">The course — couldn&apos;t load. <button type="button" className="btn-ter" onClick={() => void board.reload()}>Try again</button></div>;
  if (!row) return <div className="crm-note">GT3 Nutrition isn&apos;t in the catalog yet.</div>;
  const typed = price ?? moneyPlain(row.price_cents);
  const live = onSale ?? !!row.published_at;
  const cents = Math.round(Number(typed) * 100);
  const changed = cents !== row.price_cents || live !== !!row.published_at;

  const save = async () => {
    if (!supabase || busy) return;
    if (!Number.isFinite(cents) || cents < 100) { toast("A price of at least $1", "error"); return; }
    setBusy(true);
    const { data, error } = await supabase.from("shop_products")
      .update({ price_cents: cents, published_at: live ? (row.published_at ?? new Date().toISOString()) : null, updated_at: new Date().toISOString() })
      .eq("id", row.id).select("id");
    setBusy(false);
    if (error || !data?.length) { toast(error ? failureWords(error, "Couldn't save the course") : "Only an owner or an admin changes the course", "error"); return; }
    toast(live ? `GT3 Nutrition — ${money(cents)}, on sale` : "GT3 Nutrition — off sale (buyers keep it)");
    setPrice(null); setOnSale(null); void board.reload();
  };

  return (
    <div className="crm-tier flex-col items-start gap-2 mb-3" aria-label="GT3 Nutrition, the product">
      <span className="crm-tier-l">The course</span>
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2 w-full">
          <label className="prod-f flex-[0_0_120px]"><span>Price ($)</span>
            <input inputMode="decimal" value={typed} onChange={(e) => setPrice(e.target.value)} aria-label="Course price in dollars" />
          </label>
          <label className="prod-f flex-[1_1_140px]"><span>Visibility</span>
            <select value={live ? "live" : "hidden"} onChange={(e) => setOnSale(e.target.value === "live")} aria-label="Course visibility">
              <option value="live">Live</option>
              <option value="hidden">Hidden</option>
            </select>
          </label>
          <button type="button" className="btn-pri btn-sm" onClick={save} disabled={!changed || busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      ) : (
        <div className="crm-note mt-0">{money(row.price_cents)} · {row.published_at ? "on sale" : "off sale"}</div>
      )}
      <div className="crm-note mt-0">{live ? "On sale — the buy button is on the course page and the course is on the Shop." : "Off sale — no buy button, not on the Shop. Buyers keep it."}</div>
    </div>
  );
}
