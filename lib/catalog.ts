// THE MENU'S RULES, WRITTEN ONCE (2026-10-12, the Catalog round).
//
// Measured on an iPhone 17 with eleven drinks, Catalog › Menu & products was 1,976 points long: four and a half
// drinks on the first screen, behind a four-line paragraph, each drink a card 77 points tall whose way in was its
// name — 20 points of text — and whose 86 button a screen reader heard as "86". It read the products once and never
// again, so an 86 called from the Pass did not show until a reload; any reload (an 86 on another row) wiped an open
// row's unsaved edits; the last save won with no word to whoever it overwrote; and a recipe that failed to read
// looked exactly like a drink with no recipe.
//
// What the screen decides lives here, apart from React and the network, so a test can run it (scripts/smoke.cjs,
// THE CATALOG): what a row's switch says and what VoiceOver hears, which products a filter and a search show and
// under which line, whether a save would land on somebody else's newer change (products.updated_at is the version —
// 0062's touch trigger moves it on every write, an 86 included), how long an 86 can be undone, what the change log
// (0260's admin_audit) says about a drink's 86s, and which event and stop menus pour it. The screen is
// components/MenuManager (the list) and components/ProductPage (one product).

import { clockTime, etDayKey, etWhen } from "./dates";
import { isSeedSlug } from "./drinks";
import { MARKET_LABEL, type Market } from "./markets";
import { money, moneyPlain } from "./money";

/** A products row, as the Catalog reads it (select *). */
export type CatalogProduct = {
  id: string; slug: string; name: string; line: string | null; price_cents: number; active: boolean; sort: number;
  sold_out: boolean; sold_out_at: string | null; sold_out_by: string | null;
  what: string | null; why: string | null; ingredients: string[] | null; excludes: string[] | null; timing: string | null;
  bulk_orderable?: boolean | null; bulk_tier?: string | null; bulk_price_cents?: number | null;
  // 0393 (R2 — the Catalog is the menu): sold by the cup, caffeine, contains, the menu row's tag, when to drink it.
  // Absent on a row read before it is pasted.
  cup_orderable?: boolean | null; caffeine?: boolean | null; contains?: string[] | null; tag?: string | null; when_text?: string | null;
  updated_at: string;
};

// ── THE SWITCH ───────────────────────────────────────────────────────────────────────────────────────────────────────
// A row's 86 was a button whose whole name was "86". It is the row's availability switch now: on is "On sale", off is
// "86'd", and a product off the menu altogether has no switch (an 86 is "sold out today"; off the menu is active =
// false, set on the product's page and saved — 0130's split).

/** What a product is to somebody who wants one: on sale, 86'd for the day, or off the menu altogether. 86'd is in every
 *  city (sold_out, the Catalog's switch) or in some (outIn — the cities the Pass has sold it out in, 0408). */
export type Availability = "on" | "86" | "off";
export function availabilityOf(p: { active: boolean; sold_out: boolean; outIn?: readonly string[] | null }): Availability {
  if (!p.active) return "off";
  return p.sold_out || (p.outIn?.length ?? 0) > 0 ? "86" : "on";
}

// ── AN 86 IN ONE CITY (2026-10-15, 0408 — Ryan: "Pass: its city. Catalog: all") ─────────────────────────────────────
// The Pass's 86 sells an item out in its own city (product_86); the Catalog's switch is every city (products.sold_out).
// The Catalog says both: the switch is every city's, and a city's 86 is said beside it — on the row, on the page and in
// the history — so the list never calls a drink on sale that a truck has run out of without saying where.
export type City86 = { product_id: string; market: string; sold_out_at: string | null; sold_out_by: string | null };
/** A city as the screen names it: "Greenville". */
export const cityName = (m: string): string => MARKET_LABEL[m as Market] ?? m;
/** Cities as a sentence names them: "Greenville", "Greenville and Atlanta". Empty when there are none. */
const citiesWords = (markets: readonly string[] | null | undefined): string => {
  const names = [...new Set(markets ?? [])].map(cityName);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};
/** The row's line: "86'd in Greenville", "86'd in Greenville and Atlanta". Null when it is out in no city. */
export function outInLine(markets: readonly string[] | null | undefined): string | null {
  const where = citiesWords(markets);
  return where ? `86'd in ${where}` : null;
}
/** The page's status beside the switch, which is every city's: "On sale, except in Greenville." Null when it is out in
 *  no city. */
export function exceptLine(markets: readonly string[] | null | undefined): string | null {
  const where = citiesWords(markets);
  return where ? `On sale, except in ${where}.` : null;
}
/** The page's line for one city: "86'd in Greenville today at 2:14pm by Kayla." */
export function cityOutLine(c: Pick<City86, "market" | "sold_out_at" | "sold_out_by">, names: Readonly<Record<string, string>>, nowMs: number = Date.now()): string {
  const when = c.sold_out_at ? ` ${etWhen(c.sold_out_at, nowMs)}` : "";
  const who = c.sold_out_by ? ` by ${names[c.sold_out_by] || "Staff"}` : "";
  return `86'd in ${cityName(c.market)}${when}${who}.`;
}
/** Each product's cities, from the product_86 rows: id → its rows, the oldest 86 first. */
export function citiesByProduct(rows: readonly City86[] | null | undefined): Map<string, City86[]> {
  const by = new Map<string, City86[]>();
  for (const r of rows ?? []) { const a = by.get(r.product_id) ?? []; a.push(r); by.set(r.product_id, a); }
  for (const a of by.values()) a.sort((x, y) => (x.sold_out_at ?? "").localeCompare(y.sold_out_at ?? "") || x.market.localeCompare(y.market));
  return by;
}

/** A draft that has no name yet is still somebody's row ("+ New item" makes it blank on purpose). */
export const nameOf = (p: { name?: string | null }): string => (p.name ?? "").trim() || "New item";

export const SWITCH_WORDS = { on: "On sale", out: "86'd" } as const;
export const switchWords = (soldOut: boolean): string => (soldOut ? SWITCH_WORDS.out : SWITCH_WORDS.on);

/** What VoiceOver hears on the switch: its name, and then — after the pause it leaves for a hint — what a double-tap
 *  does. The state is in the name on purpose: "RISE, on sale", not a bare "86". */
export function switchSpoken(name: string, soldOut: boolean): { label: string; hint: string } {
  return soldOut
    ? { label: `${name}, 86'd, sold out today`, hint: "Double-tap to put it back on sale." }
    : { label: `${name}, on sale`, hint: "Double-tap to 86." };
}
/** The switch's name and hint as one line: "RISE, on sale. Double-tap to 86." */
export function spokenLine(name: string, soldOut: boolean): string {
  const s = switchSpoken(name, soldOut);
  return `${s.label}. ${s.hint}`;
}

/** The row's own button, which opens the product: name, line, price — and "off the menu" when it is, since an off
 *  row has no switch to say so. */
export function rowSpoken(p: { name?: string | null; line?: string | null; price_cents: number; active: boolean; sold_out?: boolean; outIn?: readonly string[] | null }): string {
  const where = p.active && !p.sold_out ? outInLine(p.outIn) ?? "" : "";
  return [nameOf(p), (p.line ?? "").trim(), money(p.price_cents), p.active ? where : "off the menu"].filter(Boolean).join(", ");
}

/** The toast an 86 or an un-86 leaves, with Undo beside it. */
export const flipToast = (name: string, to86: boolean): string =>
  (to86 ? `${name} 86'd — sold out on the live menu` : `${name} is back on sale`);

// ── THE UNDO ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// An 86 is frequent and it is undone by a second tap, so it does not ask first: it is done, and the toast holds an
// Undo. The toast keeps an action on screen for 5 seconds (components/AppProvider, "a toast with something to do
// stays long enough to reach for it"); the undo honours the same window, so an Undo tapped on a toast that outlived
// it does nothing. And it is conditional on the row still holding what the 86 wrote — if the Pass flipped it back in
// those seconds, the undo changes nothing and says so.
// The clock is read here, where the window is defined, and only from a tap — the one that 86'd and the one on Undo.
export const UNDO_MS = 5000;
/** The moment an 86 landed: when its undo window opens. */
export const undoStart = (): number => Date.now();
/** True while an Undo for an 86 that landed at `at` may still act. */
export const undoOpen = (at: number, now: number = Date.now()): boolean => now >= at && now - at < UNDO_MS;

// ── THE FILTER AND THE SEARCH ────────────────────────────────────────────────────────────────────────────────────────
export type CatalogFilter = "all" | "on" | "86" | "off";
export const FILTERS: readonly { key: CatalogFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "on", label: "On sale" }, { key: "86", label: "86'd" }, { key: "off", label: "Off" },
];
export const inFilter = (p: { active: boolean; sold_out: boolean; outIn?: readonly string[] | null }, f: CatalogFilter): boolean =>
  f === "all" || availabilityOf(p) === f;

/** Words as a search compares them: no accents, one apostrophe, one case, single spaces. */
export function searchKey(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019`]/g, "'")
    .toLowerCase().replace(/\s+/g, " ").trim();
}
/** Every word typed must appear in the product's name, line or slug — "salted latte" finds SALTED MAPLE LATTE. */
export function matchesSearch(p: { name?: string | null; line?: string | null; slug?: string | null }, q: string): boolean {
  const words = searchKey(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = searchKey([p.name, p.line, p.slug].join(" "));
  return words.every((w) => hay.includes(w));
}

export type LineGroup<T> = { key: string; label: string; items: T[] };
/** The products a filter and a search show, under their line — lines in the order the menu first reaches them
 *  (products.sort), the products in theirs. One line however it is cased, named and placed as the whole menu first
 *  has it, whatever the filter leaves; a product with no line is under "No line". */
export function shownGroups<T extends { active: boolean; sold_out: boolean; outIn?: readonly string[] | null; name?: string | null; line?: string | null; slug?: string | null }>(
  products: readonly T[], f: CatalogFilter, q: string,
): LineGroup<T>[] {
  const lines = new Map<string, { label: string; at: number }>();
  for (const p of products) {
    const label = (p.line ?? "").trim();
    const key = searchKey(label);
    if (!lines.has(key)) lines.set(key, { label: label || "No line", at: lines.size });
  }
  const byKey = new Map<string, LineGroup<T>>();
  for (const p of products) {
    if (!inFilter(p, f) || !matchesSearch(p, q)) continue;
    const key = searchKey((p.line ?? "").trim());
    let g = byKey.get(key);
    if (!g) { g = { key, label: lines.get(key)?.label ?? "No line", items: [] }; byKey.set(key, g); }
    g.items.push(p);
  }
  return [...byKey.values()].sort((a, b) => (lines.get(a.key)?.at ?? 0) - (lines.get(b.key)?.at ?? 0));
}
/** A filter's count is the rows it would show — with the search as typed. */
export function filterCounts(products: readonly { active: boolean; sold_out: boolean; outIn?: readonly string[] | null; name?: string | null; line?: string | null; slug?: string | null }[], q: string): Record<CatalogFilter, number> {
  const n: Record<CatalogFilter, number> = { all: 0, on: 0, "86": 0, off: 0 };
  for (const p of products) {
    if (!matchesSearch(p, q)) continue;
    n.all++;
    n[availabilityOf(p)]++;
  }
  return n;
}
/** What an empty list says, so a filter or a search that hides everything is never mistaken for an empty menu. */
export function emptyLine(f: CatalogFilter, q: string): string {
  const typed = q.trim();
  if (typed) return `Nothing on the menu matches “${typed}”${f === "all" ? "" : ` under ${FILTERS.find((x) => x.key === f)?.label}`}.`;
  return f === "86" ? "Nothing is 86'd." : f === "off" ? "Nothing is off the menu." : f === "on" ? "Nothing is on sale." : "No products yet.";
}

// ── THE VERSION ──────────────────────────────────────────────────────────────────────────────────────────────────────
// products.updated_at is set by 0062's touch trigger on every update — a save, an 86, the 4am reset — so it is the
// row's version, and no migration is needed to have one. PostgREST writes it to the microsecond
// ("2026-10-12T14:03:22.123456+00:00", trailing zeros dropped); a JavaScript Date keeps milliseconds, so two writes
// in one millisecond would read as one version. Versions are compared here in microseconds, which a number holds
// exactly for the next two centuries.
const STAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
/** A timestamp's microseconds since 1970, or null for one that is not a timestamp. */
export function versionMicros(ts: string | null | undefined): number | null {
  const m = STAMP.exec((ts ?? "").trim());
  if (!m) return null;
  let zone = (m[4] ?? "Z").toUpperCase();
  if (zone !== "Z") zone = zone.length === 3 ? `${zone}:00` : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (Number.isNaN(ms)) return null;
  return ms * 1000 + Number((m[3] ?? "").padEnd(6, "0").slice(0, 6));
}
/** One version, however it was written. Two that cannot be read are the same only as the same string. */
export function sameVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = versionMicros(a), y = versionMicros(b);
  if (x == null || y == null) return !!a && a === b;
  return x === y;
}
/** True when `a` is a later version than `b`. */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = versionMicros(a), y = versionMicros(b);
  return x != null && (y == null || x > y);
}
/** The row to show: the list's, unless this screen holds a newer one of its own (the answer to its own write, before
 *  the list has read again). Whichever is newer wins — somebody else's later change included. */
export function freshest<T extends { updated_at: string | null }>(listed: T, held: T | null | undefined): T {
  return held && isNewer(held.updated_at, listed.updated_at) ? held : listed;
}
/** A list row as the screen shows it: the freshest version, with an 86 still on its way to the database on top. */
export function shownRow<T extends { id: string; sold_out: boolean; updated_at: string | null }>(
  p: T, pending: Readonly<Record<string, boolean>>, held: Readonly<Record<string, T>>,
): T {
  const row = freshest(p, held[p.id]);
  return p.id in pending ? { ...row, sold_out: pending[p.id] } : row;
}

// ── THE PAGE'S DRAFT ─────────────────────────────────────────────────────────────────────────────────────────────────
// The fields a product's page edits — the inline expander's, every one (2026-10-12: the same fields and the same two
// validations). The draft holds what is typed as typed: the comma lists used to be re-split on every keystroke, so a
// comma typed at the end vanished before the next word could follow it; the price was a number box that could not hold
// "7." on its way to "7.50".
// Since 2026-10-13 (R2, 0393) the page also edits what the menu shows that had no column: sold by the cup, caffeine (said
// yes or no, or not said), what it contains, the row's tag and when to drink it. The description is the menu's "what it
// is", one line per row.
export const PAGE_FIELDS = ["name", "price_cents", "line", "timing", "what", "why", "ingredients", "excludes", "active", "bulk_orderable", "bulk_tier", "cup_orderable", "caffeine", "contains", "tag", "when_text"] as const;
export type PageField = (typeof PAGE_FIELDS)[number];
/** Caffeine as the page's control says it: not said, yes, none. */
export type CaffeineChoice = "" | "yes" | "no";
export type Draft = {
  name: string; price: string; line: string; timing: string; what: string; why: string; ingredients: string; excludes: string;
  active: boolean; bulk_orderable: boolean; bulk_tier: string;
  cup_orderable: boolean; caffeine: CaffeineChoice; contains: string; tag: string; when_text: string;
};
export type Values = {
  name: string; price_cents: number; line: string; timing: string; what: string; why: string; ingredients: string[]; excludes: string[];
  active: boolean; bulk_orderable: boolean; bulk_tier: string;
  cup_orderable: boolean; caffeine: boolean | null; contains: string[]; tag: string; when_text: string;
};
type DraftSource = Pick<CatalogProduct, "name" | "price_cents" | "line" | "timing" | "what" | "why" | "ingredients" | "excludes" | "active" | "bulk_orderable" | "bulk_tier"
  | "cup_orderable" | "caffeine" | "contains" | "tag" | "when_text">;

const list = (text: string): string[] => text.split(",").map((s) => s.trim()).filter(Boolean);
/** Dollars as typed → cents: "7.5", "$7.50" and "7" are 750, 750 and 700; what is not a number is $0. */
export function priceCents(text: string): number {
  const n = Number(String(text ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export function draftOf(p: DraftSource): Draft {
  return {
    name: p.name ?? "", price: moneyPlain(p.price_cents), line: p.line ?? "", timing: p.timing ?? "", what: p.what ?? "", why: p.why ?? "",
    ingredients: (p.ingredients ?? []).join(", "), excludes: (p.excludes ?? []).join(", "),
    active: !!p.active, bulk_orderable: !!p.bulk_orderable, bulk_tier: p.bulk_tier || "premium",
    cup_orderable: p.cup_orderable !== false, caffeine: p.caffeine === true ? "yes" : p.caffeine === false ? "no" : "",
    contains: (p.contains ?? []).join(", "), tag: p.tag ?? "", when_text: p.when_text ?? "",
  };
}
/** What a draft saves, the way the expander saved it: the name trimmed, the price in whole cents, the lists split. */
export function valuesOf(d: Draft): Values {
  return {
    name: d.name.trim(), price_cents: priceCents(d.price), line: d.line, timing: d.timing, what: d.what, why: d.why,
    ingredients: list(d.ingredients), excludes: list(d.excludes),
    active: d.active, bulk_orderable: d.bulk_orderable, bulk_tier: d.bulk_tier || "premium",
    cup_orderable: d.cup_orderable, caffeine: d.caffeine === "yes" ? true : d.caffeine === "no" ? false : null,
    contains: list(d.contains), tag: d.tag.trim(), when_text: d.when_text.trim(),
  };
}
// Blank and missing are one nothing and spaces at the ends are not a change (lib/formGuard's edited(), the same rule).
const said = (v: unknown): string =>
  v == null ? "" : typeof v === "string" ? v.trim() : Array.isArray(v) ? JSON.stringify(v) : String(v);
/** The page's fields that differ between two sets of values. */
export function changedFields(a: Values, b: Values): PageField[] {
  return PAGE_FIELDS.filter((f) => said(a[f]) !== said(b[f]));
}
/** What a save writes: only the fields this page changed from the version it opened — so a save over somebody
 *  else's change to another field keeps theirs. */
export function patchOf(draft: Draft, base: DraftSource): Partial<Values> {
  const now = valuesOf(draft);
  const out: Record<string, unknown> = {};
  for (const f of changedFields(now, valuesOf(draftOf(base)))) out[f] = now[f];
  return out as Partial<Values>;
}
/** The expander's two refusals, word for word. */
export function invalid(v: Pick<Values, "name" | "active" | "price_cents">): string | null {
  if (!v.name.trim()) return "Give it a name first";
  if (v.active && !(Number(v.price_cents) > 0)) return "Set a price above $0 before putting it on the menu";
  return null;
}

// ── A SAVE OVER SOMEBODY ELSE'S CHANGE ───────────────────────────────────────────────────────────────────────────────
// The save is an update conditional on the version the page opened (`.eq("updated_at", base.updated_at)`). When it
// matches nothing, the row is read again and this decides:
//   gone    the row was deleted;
//   save    same version — nothing moved, so a refusal was the database's (say so; do not loop);
//   rebase  the version moved, but nothing this page shows changed — an 86 from the Pass, the 4am reset — so the save
//           goes over the newer version without asking;
//   ask     somebody changed a field this page shows: "Someone changed RISE since you opened it — Reload or Save anyway".
export type SaveVerdict = "gone" | "save" | "rebase" | "ask";
export function saveVerdict(base: CatalogProduct, latest: CatalogProduct | null | undefined): SaveVerdict {
  if (!latest) return "gone";
  if (sameVersion(base.updated_at, latest.updated_at)) return "save";
  return changedFields(valuesOf(draftOf(base)), valuesOf(draftOf(latest))).length ? "ask" : "rebase";
}

const FIELD_WORDS: Record<PageField, string> = {
  name: "the name", price_cents: "the price", line: "the line", timing: "the timing", what: "the description", why: "the why",
  ingredients: "the ingredients", excludes: "what it's free of", active: "whether it's on the menu",
  bulk_orderable: "the delivery pack setting", bulk_tier: "the bulk tier",
  cup_orderable: "whether it's sold by the cup", caffeine: "the caffeine", contains: "what it contains", tag: "the tag", when_text: "when to drink it",
};
const and = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** The question, in words: who changed what, and what each answer does with it. */
export function conflictWords(name: string, base: CatalogProduct, latest: CatalogProduct, draft: Draft): { title: string; body: string } {
  const was = valuesOf(draftOf(base));
  const theirs = changedFields(valuesOf(draftOf(latest)), was);
  const mine = changedFields(valuesOf(draft), was);
  const both = theirs.filter((f) => mine.includes(f));
  const what = and(theirs.map((f) => FIELD_WORDS[f]));
  return {
    title: `Someone changed ${name} since you opened it`,
    body: `They changed ${what || "it"}. `
      + (both.length ? `Save anyway puts your ${and(both.map((f) => FIELD_WORDS[f].replace(/^the /, "")))} over theirs` : "Save anyway keeps theirs and adds your edits")
      + "; Reload shows theirs and drops your edits.",
  };
}

// ── THE 86, AS THE CHANGE LOG HAS IT ─────────────────────────────────────────────────────────────────────────────────
// The product holds its current 86 only (0130: sold_out_at and sold_out_by, cleared on un-86). The history is in the
// change log: 0260's trigger writes a line for every products update — whoever made it, crew included, and the 4am
// reset with nobody behind it — with the row before and after. The page reads the lines whose diff names sold_out and
// takes the flag from each side; nothing is inferred that the log does not say. A city's 86 (0408) is a line of its own
// table, product_86, in the same shape, with its city on it: "86'd in Greenville today at 2:14pm · Kayla".
export type AuditRow = { created_at: string; actor: string | null; was86: unknown; is86: unknown; city?: unknown };
export type Flip = { at: string; actor: string | null; to86: boolean; market?: string | null };
export function flipsFrom(rows: readonly AuditRow[] | null | undefined): Flip[] {
  return (rows ?? [])
    .filter((r) => typeof r.was86 === "boolean" && typeof r.is86 === "boolean" && r.was86 !== r.is86)
    .map((r) => ({ at: r.created_at, actor: r.actor, to86: r.is86 === true, market: typeof r.city === "string" && r.city ? r.city : null }))
    .sort((a, b) => (versionMicros(b.at) ?? 0) - (versionMicros(a.at) ?? 0));
}
/** pg_cron runs the reset at 08:00 UTC (0130); a flip back on sale with nobody behind it, then, is the reset. */
export function isDailyReset(f: Flip): boolean {
  if (f.actor || f.to86) return false;
  const d = new Date(f.at);
  return d.getUTCHours() === 8 && d.getUTCMinutes() < 10;
}
export function flipWho(f: Flip, names: Readonly<Record<string, string>>): string {
  if (f.actor) return names[f.actor] || "Staff";
  return isDailyReset(f) ? "the daily reset" : "the system";
}
/** "86'd today at 2:14pm · Ryan", "Back on sale Mon, Oct 12 at 4:00am · the daily reset" — the business's clock — and a
 *  city's: "86'd in Greenville today at 2:14pm · Kayla". */
export function flipLine(f: Flip, names: Readonly<Record<string, string>>, nowMs: number = Date.now()): string {
  return `${f.to86 ? "86'd" : "Back on sale"}${f.market ? ` in ${cityName(f.market)}` : ""} ${etWhen(f.at, nowMs)} · ${flipWho(f, names)}`;
}
/** The current 86, from the product itself: "86'd today at 2:14pm by Ryan." Null when it is on sale. */
export function soldOutLine(p: Pick<CatalogProduct, "sold_out" | "sold_out_at" | "sold_out_by">, names: Readonly<Record<string, string>>, nowMs: number = Date.now()): string | null {
  if (!p.sold_out) return null;
  const when = p.sold_out_at ? ` ${etWhen(p.sold_out_at, nowMs)}` : "";
  const who = p.sold_out_by ? ` by ${names[p.sold_out_by] || "Staff"}` : "";
  return `86'd${when}${who}.`;
}
/** The next 08:00 UTC — when every 86 clears (0130's schedule). */
export function nextResetAt(nowMs: number): string {
  const d = new Date(nowMs);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0, 0);
  return new Date(t > nowMs ? t : t + 864e5).toISOString();
}
/** "Every 86 clears at 4:00am." — 4 in the summer, 3 in the winter, as the Eastern clock reads 08:00 UTC. */
export const resetLine = (nowMs: number = Date.now()): string => `Every 86 clears at ${clockTime(nextResetAt(nowMs))}.`;

// ── WHERE IT IS SOLD: THE EVENT AND STOP MENUS ───────────────────────────────────────────────────────────────────────
// An event's or a stop's menu is event_menu_items (0173): one row per product slug, owned by an event or a stop.
// What is coming up is what is not archived, not completed, and not before today (the business's day); a menu with no
// date yet still counts, last.
export type MenuLink = {
  event_id: string | null; stop_id: string | null;
  events?: { title: string | null; day: string | null; archived_at: string | null; completed_at: string | null } | null;
  stops?: { name: string | null; starts_at: string | null; archived_at: string | null; completed_at: string | null } | null;
};
export type MenuStop = { kind: "event" | "stop"; id: string; name: string; day: string | null };
export function upcomingMenus(rows: readonly MenuLink[] | null | undefined, today: string): MenuStop[] {
  const out: MenuStop[] = [];
  for (const r of rows ?? []) {
    if (r.event_id && r.events) {
      const e = r.events;
      if (e.archived_at || e.completed_at) continue;
      const day = e.day ? e.day.slice(0, 10) : null;
      if (day && day < today) continue;
      out.push({ kind: "event", id: r.event_id, name: (e.title ?? "").trim() || "Untitled event", day });
    } else if (r.stop_id && r.stops) {
      const s = r.stops;
      if (s.archived_at || s.completed_at) continue;
      const at = s.starts_at ? new Date(s.starts_at) : null;
      const day = at && !Number.isNaN(at.getTime()) ? etDayKey(at) : null;
      if (day && day < today) continue;
      out.push({ kind: "stop", id: r.stop_id, name: (s.name ?? "").trim() || "Unnamed stop", day });
    }
  }
  return out.sort((a, b) => (a.day ?? "9999-12-31").localeCompare(b.day ?? "9999-12-31") || a.name.localeCompare(b.name));
}

// ── A RECIPE THAT DID NOT READ ───────────────────────────────────────────────────────────────────────────────────────
// The recipe is what COGS and the inventory deduction are built on, so an empty list is a claim: "this drink uses
// nothing". The expander dropped a failed read (`if (!error) setComps(…)`) and showed whatever was there — on first
// open, nothing. A failed read says so now, in these words, with Try again.
export const RECIPE_READ_FAILED = "Couldn't read the recipe — this is not an empty recipe.";
export const RECIPE_REREAD_FAILED = "Couldn't read the recipe again — what is shown may be out of date.";

// ── WHAT PAY REFUSES (2026-10-12, C3 of the customer audit, approved) ───────────────────────────────────────────────
// Checkout let a drink through when its products row was missing, on purpose — "a catalog gap must not brick checkout" —
// and priced it from Square or the code. So a drink deleted in the Catalog stayed on sale, and a drink taken off the
// menu (active = false) was refused as "just sold out", the wrong reason. The Catalog is the menu's authority: a drink
// is sold only while it has a row that is on the menu, and Pay says which reason is true. The 86 words are the ones
// Pay always said, byte for byte. A cart of good drinks is refused nothing (null).
// SOLD BY THE CUP (2026-10-13, R2 — the Catalog is the menu): a product on sale that is not sold by the cup (Salted Latte,
// a pack add-on) is refused for what it is, not as "unknown". Before 0393 adds cup_orderable a row has no such field,
// and only the code list's ten drinks were ever cups — so that is the answer until it is pasted.
export type CartRow = { slug: string; sold_out: boolean | null; active: boolean | null; cup_orderable?: boolean | null };
const cupOf = (r: CartRow): boolean => (typeof r.cup_orderable === "boolean" ? r.cup_orderable : isSeedSlug(r.slug));
export function cartRefusal(slugs: readonly string[], rows: readonly CartRow[], nameOf: (slug: string) => string): string | null {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const uniq = [...new Set(slugs)];
  const gone = uniq.filter((s) => { const r = bySlug.get(s); return !r || r.active === false; }).map(nameOf);
  const notCup = uniq.filter((s) => { const r = bySlug.get(s); return !!r && r.active !== false && !cupOf(r); }).map(nameOf);
  const out = uniq.filter((s) => { const r = bySlug.get(s); return !!r && r.active !== false && cupOf(r) && !!r.sold_out; }).map(nameOf);
  if (!gone.length && !notCup.length && !out.length) return null;
  const said: string[] = [];
  if (gone.length) said.push(`${gone.join(" · ")} ${gone.length === 1 ? "isn't" : "aren't"} on the menu any more`);
  if (notCup.length) said.push(`${notCup.join(" · ")} ${notCup.length === 1 ? "isn't" : "aren't"} sold by the cup`);
  if (out.length) said.push(`${out.join(" · ")} just sold out`);
  return `${said.join(", and ")} — remove ${gone.length + notCup.length + out.length === 1 ? "it" : "them"} and try again.`;
}

// A STOP'S MENU (2026-10-13, R2): a stop with a menu set (stop_menu, 0393) sells what it pours and nothing else. null = no
// menu set, which limits nothing. Refused by name, with the stop's name: the customer can fix it before paying.
export function offStopMenu(slugs: readonly string[], menu: readonly string[] | null): string[] {
  if (!menu) return [];
  const pours = new Set(menu);
  return [...new Set(slugs)].filter((s) => !pours.has(s));
}
export function stopMenuRefusal(names: readonly string[], stopName: string | null): string | null {
  if (!names.length) return null;
  const where = (stopName ?? "").trim() || "this stop";
  return `${names.join(" · ")} ${names.length === 1 ? "isn't" : "aren't"} poured at ${where} — remove ${names.length === 1 ? "it" : "them"} and try again.`;
}
/** A products read that failed is not an empty menu: Pay waits rather than sell what it could not check. */
export const MENU_UNCHECKED = "We couldn't check the menu — give it another tap in a moment.";
