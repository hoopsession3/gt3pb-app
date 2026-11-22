// THE RECIPE BOOK, SERVED (0476, 2026-11-20). One answer to "what is the recipe?" for every screen and every assistant:
// the PUBLISHED version of each recipe in public.recipe_versions, over the built-in cookbook in code. A draft or a
// submission never comes back from here — only status = 'published' is read — so Ask GT3 and the recipe screen can't
// disagree, and nothing waiting for review reaches an answer. While 0476 is held (no table yet) or the read fails, the
// built-in cookbook is the answer, unchanged: the app ships ahead of its migration and works the same as before it.
// Server-only (the service key): the caller is checked by the route that asks.
import { COOKBOOK } from "./academyCookbook";
import type { Cookbook } from "./academy";
import { sourceLine, type RecipeBody, type RecipeSource } from "./recipeEdit";
export { sourceLine, type RecipeSource };
import { supabaseAdmin } from "./supabaseAdmin";

export const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000001";


export type PublishedBook = { cookbook: Record<string, RecipeBody>; sources: Record<string, RecipeSource>; publishers: string[]; people: Record<string, string> };

type Row = { id: string; product_key: string; body: RecipeBody; version_no: number | null; published_at: string; decided_by: string | null };

/** The cookbook as published for this business: built-in entries, each replaced by its published version when there is one. */
export async function publishedBook(tenant: string = DEFAULT_TENANT): Promise<PublishedBook> {
  const cookbook: Record<string, RecipeBody> = { ...(COOKBOOK as Record<string, RecipeBody>) };
  const sources: Record<string, RecipeSource> = Object.fromEntries(Object.keys(COOKBOOK).map((k) => [k, { source: "built-in" } as RecipeSource]));
  const publishers: string[] = [];
  const people: Record<string, string> = {};   // owner/admin id → name: who published each version, for the history
  if (!supabaseAdmin) return { cookbook, sources, publishers, people };
  try {
    const db = supabaseAdmin;
    // arrives-with: 0476  — until it is applied the select errors and the built-in cookbook stands (rows = [] on error).
    const { data, error } = await db.from("recipe_versions").select("id, product_key, body, version_no, published_at, decided_by")
      .eq("tenant_id", tenant).eq("status", "published");
    const rows = (error ? [] : (data ?? [])) as unknown as Row[];
    const staff = await db.from("profiles").select("id, display_name, role").eq("tenant_id", tenant).in("role", ["owner", "admin"]);
    const names = new Map<string, string>(((staff.data ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name || "An owner"]));
    publishers.push(...[...names.values()].sort());
    for (const [id, n] of names) people[id] = n;
    for (const r of rows) {
      if (!r.body || typeof r.body !== "object") continue;
      cookbook[r.product_key] = r.body;
      sources[r.product_key] = { source: "published", id: r.id, version: r.version_no, publishedAt: r.published_at, publishedBy: r.decided_by ? names.get(r.decided_by) ?? null : null };
    }
  } catch { /* the table isn't there yet (0476 held), or the read failed: the built-in cookbook stands */ }
  return { cookbook, sources, publishers, people };
}


export type { Cookbook };
