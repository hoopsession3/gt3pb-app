// THE MENU IS THE CATALOG (2026-10-13, R2 of the customer frontend audit, "One catalog", approved).
//
// The menu customers order from was ten drinks typed into lib/menu.ts, and the Catalog (products) set two things about
// them: the price and whether one was 86'd. A drink added in the Catalog never reached the menu and Pay refused it as
// "Unknown item"; the words on the menu were the code's, or the owner's edits saved as page copy, so the Catalog's own
// descriptions said something else — NATURE'S AIDE's line said lime juice while its ingredient list said mineral water.
//
// Now a drink is its products row. Every screen that shows one — the menu, the drink sheet, the cart, checkout, the
// Pass, the truck's board, the order history, Ask us — asks here, and gets the same answer:
//
//   drinkFrom(row, slug)   the row — everything it says, once 0393 is pasted; before it, a code-list drink is the code
//                          list's words with the Catalog's price and 86 (the menu exactly as it was);
//   menuOf(rows)           the drinks on the cup menu: on sale (active) and sold by the cup (cup_orderable), in order;
//   sectionsOf(drinks)     grouped under their line (Activation, Hydration, Fuel), in the order the drinks come;
//   seedMenu()             the code list as a menu — what the app shows when the Catalog can't be read, never empty.
//
// Pure, so the server, the phone and the tests run it alike. The read is lib/drinksRead (server and Catalog screens only:
// it stays out of the bundle every page carries).

import { DRINKS, MENU, type DrinkDetail } from "./menu";

export type When = "BEFORE" | "DURING" | "AFTER";

/** A drink as every screen shows it. */
export type Drink = {
  slug: string;
  name: string;
  line: string;                // the menu section it sits under
  sort: number;
  priceCents: number | null;   // the Catalog's price; null when no row says one
  lines: string[];             // what it is, one per row
  why: string;
  has: string[];               // in the bottle
  no: string[];                // never
  when: When | null;
  whenText: string;
  tag: string | null;          // "Start here", "Nitro"
  dot: string;                 // the tasting dot (products.accent)
  grad: string;                // the swatch (Today, the day generator)
  caffeine: boolean | null;    // null = not said; the menu never guesses
  contains: string[] | null;   // null = not said
  soldOut: boolean;
  cup: boolean;                // sold by the cup
  active: boolean;
};

/** A products row as the menu reads it. The last five columns arrive with 0393. */
export type MenuRow = {
  slug: string; name: string | null; line: string | null; price_cents: number | null; sort: number | null;
  what: string | null; why: string | null; ingredients: string[] | null; excludes: string[] | null; timing: string | null;
  accent: string | null; sold_out: boolean | null; active: boolean | null;
  cup_orderable?: boolean | null; caffeine?: boolean | null; contains?: string[] | null; tag?: string | null; when_text?: string | null;
};

/** The section a code-list drink sits under, by when it's for — the menu's three pillars. */
const SEED_LINE: Record<When, string> = { BEFORE: "Activation", DURING: "Hydration", AFTER: "Fuel" };
/** A section's subtitle until the owner writes his own (site_copy menu.line.<name>.sub). */
export const LINE_SUB: Readonly<Record<string, string>> = { Activation: "Before the work", Hydration: "During the work", Fuel: "After the work" };
/** The copy key of a section's subtitle — keyed by its name, so reordering sections moves no words. */
export const lineSubKey = (line: string): string => `menu.line.${line}.sub`;

const SEED = DRINKS as Readonly<Record<string, DrinkDetail | undefined>>;
/** Is this one of the ten drinks the code list knows? */
export const isSeedSlug = (slug: string): boolean => Object.prototype.hasOwnProperty.call(DRINKS, slug);
/** The code list's order, as sorts: Activation 10…, Hydration 20…, Fuel 30… — the Catalog's own numbers (0062, 0393). */
const SEED_SORT: Readonly<Record<string, number>> = Object.fromEntries(MENU.flatMap((sec, i) => sec.rows.map((id, j) => [id, (i + 1) * 10 + j])));
const UNSORTED = 1000;
const NO_DOT = "#8A7F6A";

const said = (s: string | null | undefined): string | null => { const t = (s ?? "").trim(); return t ? t : null; };
const listOf = (a: readonly string[] | null | undefined): string[] => (Array.isArray(a) ? a.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
const whenOf = (v: unknown): When | null => (v === "BEFORE" || v === "DURING" || v === "AFTER" ? v : null);
const pxCents = (px: string | undefined): number | null => {
  const n = px ? Math.round(parseFloat(px.replace(/[$,\s]/g, "")) * 100) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const priceOf = (row: MenuRow | null | undefined): number | null =>
  typeof row?.price_cents === "number" && row.price_cents > 0 ? row.price_cents : null;

/** Did this row come back with 0393's columns? Then the Catalog says everything; before, only the price and the 86. */
const fullRow = (row: MenuRow | null | undefined): boolean => !!row && "cup_orderable" in row;

/** One drink. Once 0393 is pasted the Catalog's row says everything — a field the owner clears is clear on the menu too,
 *  not the code list's words coming back. Before it (or with no row at all) a code-list drink is the menu exactly as it
 *  was: the code list's words with the Catalog's price and 86. A slug neither knows is still a drink — its name is the
 *  slug, it says nothing it doesn't know, and nobody can order it (no row, no cup). */
export function drinkFrom(row: MenuRow | null | undefined, slug: string): Drink {
  const seed = isSeedSlug(slug) ? SEED[slug] : undefined;
  const live = { priceCents: priceOf(row), soldOut: !!row?.sold_out, active: row ? row.active !== false : !!seed };
  if (!fullRow(row)) {
    if (seed) {
      return {
        slug, name: seed.n, line: SEED_LINE[seed.when], sort: SEED_SORT[slug] ?? UNSORTED, ...live,
        lines: [...seed.lines], why: seed.why, has: [...seed.has], no: [...seed.no], when: seed.when, whenText: seed.whenT,
        tag: seed.tag ?? null, dot: seed.dot, grad: seed.grad, caffeine: null, contains: null, cup: true,
      };
    }
    // Before 0393 no product outside the code list was ever a cup.
    return {
      slug, name: said(row?.name) ?? slug, line: said(row?.line) ?? "More", sort: typeof row?.sort === "number" ? row.sort : UNSORTED, ...live,
      lines: [], why: "", has: [], no: [], when: whenOf(row?.timing), whenText: "", tag: null,
      dot: said(row?.accent) ?? NO_DOT, grad: `linear-gradient(140deg, ${said(row?.accent) ?? NO_DOT}, ${said(row?.accent) ?? NO_DOT})`,
      caffeine: null, contains: null, cup: false,
    };
  }
  const r = row as MenuRow;
  const dot = said(r.accent) ?? seed?.dot ?? NO_DOT;
  const when = whenOf(said(r.timing));
  const what = said(r.what);
  return {
    slug,
    name: said(r.name) ?? seed?.n ?? slug,
    line: said(r.line) ?? (when ? SEED_LINE[when] : "More"),
    sort: typeof r.sort === "number" ? r.sort : SEED_SORT[slug] ?? UNSORTED,
    ...live,
    lines: what ? what.split("\n").map((l) => l.trim()).filter(Boolean) : [],
    why: said(r.why) ?? "",
    has: listOf(r.ingredients),
    no: listOf(r.excludes),
    when,
    whenText: said(r.when_text) ?? "",
    tag: said(r.tag),
    dot,
    grad: seed?.grad ?? `linear-gradient(140deg, ${dot}, ${dot})`,
    caffeine: typeof r.caffeine === "boolean" ? r.caffeine : null,
    contains: Array.isArray(r.contains) ? listOf(r.contains) : null,
    cup: r.cup_orderable !== false,
  };
}

/** The price to show when the Catalog's isn't known — the code list's, then nothing. Never a crash. */
export const fallbackCents = (slug: string): number | null => pxCents(SEED[slug]?.px);

const bySort = (a: Drink, b: Drink): number => a.sort - b.sort || a.name.localeCompare(b.name);

/** The cup menu: drinks on sale and sold by the cup, in the Catalog's order. 86'd drinks stay (they say "Sold out"). */
export function menuOf(rows: readonly MenuRow[]): Drink[] {
  return rows.map((r) => drinkFrom(r, r.slug)).filter((d) => d.active && d.cup).sort(bySort);
}

/** The code list as a menu — what shows when the Catalog can't be read. Pay still asks the Catalog. */
export function seedMenu(): Drink[] {
  return Object.keys(DRINKS).map((slug) => drinkFrom(null, slug)).sort(bySort);
}

export type Section = { line: string; drinks: Drink[] };
/** A line as the Catalog groups it — "activation", " Activation " and "Activation" are one (lib/catalog's search key). */
const lineKey = (line: string): string => line.trim().toLowerCase().replace(/\s+/g, " ");
/** Drinks grouped under their line; a section sits where its first drink does, and is named as that drink says it. */
export function sectionsOf(drinks: readonly Drink[]): Section[] {
  const out: (Section & { key: string })[] = [];
  for (const d of [...drinks].sort(bySort)) {
    const key = lineKey(d.line);
    const s = out.find((x) => x.key === key);
    if (s) s.drinks.push(d); else out.push({ key, line: d.line.trim(), drinks: [d] });
  }
  return out.map(({ line, drinks }) => ({ line, drinks }));
}

/** A name for an order line: the Catalog's, the code list's, or the slug — what the Pass and the history print. */
export function nameFrom(rows: readonly Pick<MenuRow, "slug" | "name">[] | null | undefined, slug: string, live?: ReadonlyMap<string, string>): string {
  return said(rows?.find((r) => r.slug === slug)?.name) ?? live?.get(slug) ?? (isSeedSlug(slug) ? SEED[slug]?.n : undefined) ?? slug;
}

/** The drink sheet's pillar line: "Activation · Before the work". */
export const pillarOf = (line: string, sub: string): string => (sub.trim() ? `${line} · ${sub.trim()}` : line);

/** Words for a drink's caffeine and contents, for the sheet: nothing when the Catalog doesn't say. The contents are
 *  the owner's words as he wrote them ("Goat milk · Coconut"), under the sheet's own "Contains" label. */
export function factsOf(d: Pick<Drink, "caffeine" | "contains">): { caffeine: string | null; contains: string | null } {
  return {
    caffeine: d.caffeine === true ? "Caffeine" : d.caffeine === false ? "No caffeine" : null,
    contains: d.contains && d.contains.length ? d.contains.join(" · ") : null,
  };
}
