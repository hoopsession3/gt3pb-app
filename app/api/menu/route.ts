import { NextResponse } from "next/server";
import { SQUARE_BASE, squareHeaders, squareDeadline } from "@/lib/squareServer";
import { createClient } from "@supabase/supabase-js";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { type MenuRow } from "@/lib/drinks";
import { readMenuRows } from "@/lib/drinksRead";
import { route } from "@/lib/apiRoute";
import { errorMessage } from "@/lib/errorMessage";

// public: the menu — the same drinks and prices printed at the window.
//
// THE CATALOG IS THE MENU (2026-10-13, R2 of the customer audit). `items` is every product on sale (active rows — a
// guest's read sees no other, 0062's policy), as the Catalog says it: lib/drinks turns them into the cup menu (sold by
// the cup) and into the names the Pass and the history print. `prices` is what it always was — slug → cents for every
// product on sale — because an installed iPhone build reads nothing else and keeps its own list of drinks.
//
// A failed read is not an empty menu: `items` is null and the app shows the code list's menu (lib/drinks seedMenu),
// while Pay asks the Catalog itself before any charge. Not cached anywhere, as before: a drink added in the Catalog is on
// the menu the next time it opens, and the iPhone app's cross-origin answer (next.config appCors) is never an edge copy
// made for the web.

async function get() {
  // 1) the Catalog (a guest's read of the products on sale)
  let items: MenuRow[] | null = null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anon) {
      const sb = createClient(url, anon, { auth: { persistSession: false } });
      const r = await readMenuRows(sb);
      if (!r.error) items = r.rows.filter((p) => p.active !== false);
      // Said in the logs, not swallowed: the app shows the code list's menu while this fails, and nobody would know why.
      else console.error(`menu: the Catalog read failed — ${r.error}`);
    }
  } catch (e) { console.error("menu: the Catalog read threw", e); }
  // Read, and nothing on sale, is an answer: an empty menu, not the code list's ten.
  if (items && !items.length) return NextResponse.json({ prices: {}, items: [], source: "products" });
  if (items && items.length) {
    const prices: Record<string, number> = {};
    for (const p of items) if (p.slug && typeof p.price_cents === "number") prices[p.slug] = p.price_cents;
    return NextResponse.json({ prices, items, source: "products" });
  }

  // 2) Square catalog — prices only, for the code list's drinks
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ prices: {}, items: null });
  // Square has no concept of our slugs, so its items are matched back to one by DISPLAY NAME. For 7
  // of 10 items the lowercased name happens to equal the slug (rise, flow, dusk, tide, forge, hunt,
  // wild), which used to mask this bug: kingme ("KING ME"), maple ("SALTED MAPLE LATTE"), and aide
  // ("NATURE'S AIDE") don't match their slug — so keying this map by name silently missed the live
  // Square price for those 3 and fell through to the stale lib/menu.ts price instead (the docstring
  // above promises `prices` keyed by slug; the old code broke that promise for exactly these 3).
  const nameToSlug: Record<string, DrinkId> = {};
  for (const slug of Object.keys(DRINKS) as DrinkId[]) nameToSlug[DRINKS[slug].n.toLowerCase()] = slug;
  try {
    // The side the app ID names, with the house's Square version and deadline (R14 — F5: this read the retired
    // NEXT_PUBLIC_SQUARE_ENV and asked the sandbox whenever it was unset).
    const res = await fetch(`${SQUARE_BASE}/v2/catalog/list?types=ITEM`, { headers: squareHeaders(token), next: { revalidate: 60 }, signal: squareDeadline() });
    const data = await res.json();
    const prices: Record<string, number> = {};
    for (const obj of data?.objects ?? []) {
      const name = obj?.item_data?.name?.toLowerCase();
      const amount = obj?.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
      const slug = name ? nameToSlug[name] : undefined;
      if (slug && typeof amount === "number") prices[slug] = amount;
    }
    return NextResponse.json({ prices, items: null, source: "square" });
  } catch (e) {
    console.warn(`menu: Square's catalog didn't answer — the code list's prices stand: ${errorMessage(e)}`);
    return NextResponse.json({ prices: {}, items: null });
  }
}

export const GET = route("menu", get);
