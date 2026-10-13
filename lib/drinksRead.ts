import type { SupabaseClient } from "@supabase/supabase-js";
import type { MenuRow } from "./drinks";
import { isMissingColumn } from "./schemaSkew";

// ── THE READ ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// One read of the products the menu shows, for /api/menu, checkout and Ask us. A failed read is an error, never an empty
// menu.
// arrives-with: 0393 — until it is pasted the five new columns are not there (42703); the read asks for the old ones and
// drinkFrom shows the menu as it was. Nothing else is forgiven.
export async function readMenuRows(sb: SupabaseClient, slugs?: readonly string[]): Promise<{ rows: MenuRow[]; error: string | null }> {
  const full = slugs
    ? await sb.from("products").select("slug, name, line, price_cents, sort, what, why, ingredients, excludes, timing, accent, sold_out, active, cup_orderable, caffeine, contains, tag, when_text").in("slug", [...slugs])
    : await sb.from("products").select("slug, name, line, price_cents, sort, what, why, ingredients, excludes, timing, accent, sold_out, active, cup_orderable, caffeine, contains, tag, when_text");
  if (!full.error) return { rows: (full.data ?? []) as MenuRow[], error: null };
  if (!isMissingColumn(full.error)) return { rows: [], error: full.error.message };
  const old = slugs
    ? await sb.from("products").select("slug, name, line, price_cents, sort, what, why, ingredients, excludes, timing, accent, sold_out, active").in("slug", [...slugs])
    : await sb.from("products").select("slug, name, line, price_cents, sort, what, why, ingredients, excludes, timing, accent, sold_out, active");
  return old.error ? { rows: [], error: old.error.message } : { rows: (old.data ?? []) as MenuRow[], error: null };
}
