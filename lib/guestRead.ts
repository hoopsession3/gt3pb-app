// A GUEST'S READ, FROM THE SERVER (R42 — the standards' "Search and sharing").
//
// What a page tells search and a share card before any script runs — the menu's drinks, a lesson's title, the lessons
// the sitemap lists — is read on the server, as a guest: the public key the browser already has, so the database's own
// rules (row-level security) decide what a stranger may see, exactly as they do for the page itself. Kept for
// `revalidate` seconds in Next's data cache, so a page made from it is remade at most that often.
//
// Never a throw. null when there is nothing to ask (no database configured — a CI or app build) or the read failed or
// timed out; a caller tells "nothing public" (an empty list) from "couldn't read" (null).
import type { MenuRow } from "./drinks";

export async function guestRead<T>(path: string, opts: { revalidate: number; timeoutMs?: number }, get: typeof fetch = fetch): Promise<T[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await get(`${url.replace(/\/+$/, "")}/rest/v1/${path}`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      next: { revalidate: opts.revalidate },
    });
    if (!r.ok) return null;
    const rows: unknown = await r.json();
    return Array.isArray(rows) ? (rows as T[]) : null;
  } catch {
    return null;
  }
}

// ── THE MENU ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// The products on sale, as /api/menu reads them (lib/drinksRead's columns): a guest's read sees no other (0062's policy),
// and an inactive row is dropped here too, as there. Read again at most every minute — the phone reads its own the moment
// the page opens (components/AppProvider), so this is the page's first paint and what search reads, never a price paid.
export const MENU_COLUMNS = "slug,name,line,price_cents,sort,what,why,ingredients,excludes,timing,accent,sold_out,active,cup_orderable,caffeine,contains,tag,when_text";
export async function catalogForGuests(get?: typeof fetch): Promise<MenuRow[] | null> {
  const rows = await guestRead<MenuRow>(`products?select=${MENU_COLUMNS}`, { revalidate: 60 }, get);
  return rows ? rows.filter((p) => p && typeof p.slug === "string" && p.active !== false) : null;
}

// ── THE LESSONS ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Published rookie lessons are anyone's (0272's "primal lessons read"); a pro lesson is a member's, and a guest's read
// never returns it — so the sitemap lists, and a lesson's page tells search about, only what a stranger may read.
const LESSON_LIVE = "published_at=not.is.null&archived_at=is.null";

/** Every lesson anyone may read, by slug, once each, in the course's order. Read hourly; [] when it can't be read. */
export async function publicLessonSlugs(get?: typeof fetch): Promise<string[]> {
  const rows = await guestRead<{ slug?: unknown }>(`primal_lessons?select=slug&${LESSON_LIVE}&order=sort`, { revalidate: 3600 }, get);
  return [...new Set((rows ?? []).map((r) => r?.slug).filter((s): s is string => typeof s === "string" && s.length > 0))];
}

export type PublicLesson = { title: string; subtitle: string | null; summary: string | null };
/** One lesson as a stranger may read it: the lesson; null when it isn't one anyone may read (a member's, unpublished,
 *  gone); undefined when the database couldn't be asked. */
export async function publicLesson(slug: string, get?: typeof fetch): Promise<PublicLesson | null | undefined> {
  const rows = await guestRead<Partial<PublicLesson>>(
    `primal_lessons?select=title,subtitle,summary&slug=eq.${encodeURIComponent(slug)}&${LESSON_LIVE}&limit=1`, { revalidate: 600, timeoutMs: 3000 }, get);
  if (rows === null) return undefined;
  const r = rows[0];
  if (!r || typeof r.title !== "string" || !r.title.trim()) return null;
  return { title: r.title.trim(), subtitle: typeof r.subtitle === "string" ? r.subtitle : null, summary: typeof r.summary === "string" ? r.summary : null };
}
