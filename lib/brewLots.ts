// THE COFFEE A BREW WAS MADE FROM (2026-10-05, the form audit, part 3d · 0349).
//
// Start brew asked for the coffee lot in a text box — "origin · roast date, for traceability" — and
// since 0347 every bag that comes in through Log purchase is a lot on file, with its city, supplier,
// the day it came and what a pound cost. This is the rule for naming one on a batch: which lots are
// offered and in what order, which one the sheet opens on, what a lot is called, and what naming it
// will do — said before the brewer taps Start.
//
// Pure, so scripts/smoke.cjs holds it. Which line is the coffee and what a gram is are lib/brewMath's
// (isCoffee, gramsPerUnit) — the database states the same two rules for the draw (0349), and the
// tests hold both languages to one answer.

import { gramsPerUnit, isCoffee, scaleIngredients, type SizingIngredient } from "./brewMath";
import { agoWord, dateWithYear, daysBetween } from "./dayWords";
import { qtyWords } from "./receiving";

/** A delivery on file, as the brew sheets read it (inventory_lots, with its supplier's name). */
export type BrewLot = {
  id: string; market: string; item_name: string; lot_code: string | null;
  received_on: string; qty_received: number; unit: string | null;
  vendor: string | null; created_at?: string | null;
};

/** The slice of a batch these rules read. */
export type LotBatch = {
  id: string; status: string; batch_gal: number; recipe_id?: string | null;
  coffee_lot_id?: string | null; brew_started_at?: string | null; created_at?: string | null;
  scaled?: SizingIngredient[] | null;
};
export type LotRecipe = { id: string; base_water_gal: number; ingredients: SizingIngredient[] | null };

/** What a batch says about its coffee: a lot on file (id), or words only — a bag that never came in
 *  through the app. `text` is what the production log prints either way. */
export type LotValue = { id: string | null; text: string };

/** "Org Ethiopia Coffee (bulk), lot SPROUTS-840214" — or the day it came, when it has no code. The
 *  words a batch keeps, so they carry the year and do not move with the reader's device. */
export function lotLabel(l: Pick<BrewLot, "item_name" | "lot_code" | "received_on">): string {
  const code = (l.lot_code ?? "").trim();
  if (code) return `${l.item_name}, lot ${code}`;
  const when = dateWithYear(l.received_on);
  return when ? `${l.item_name}, received ${when}` : l.item_name;
}

/** A batch's coffee, in grams — its stored list, else its recipe scaled to its size. Null when there
 *  is no coffee line or it is not weighed. */
export function coffeeGrams(b: Pick<LotBatch, "scaled" | "batch_gal" | "recipe_id">, recipes: readonly LotRecipe[] = []): number | null {
  let lines: SizingIngredient[] | null = Array.isArray(b.scaled) && b.scaled.length ? b.scaled : null;
  if (!lines) {
    const r = recipes.find((x) => x.id === b.recipe_id);
    if (r && Number(r.base_water_gal) > 0) lines = scaleIngredients(r.ingredients, Number(b.batch_gal) / Number(r.base_water_gal));
  }
  const line = (lines ?? []).find((i) => isCoffee(i?.name));
  const per = gramsPerUnit(line?.unit);
  const qty = Number(line?.qty);
  return line && per !== null && Number.isFinite(qty) && qty > 0 ? qty * per : null;
}

/** Grams as an amount of a shelf's unit, or null when the unit is not a weight. */
export const inUnit = (grams: number, unit: string | null | undefined): number | null => {
  const per = gramsPerUnit(unit);
  return per ? grams / per : null;
};

/** A batch that has been brewed — it took its coffee. Planned has not; discarded never happened. */
const brewed = (b: Pick<LotBatch, "status">) => b.status !== "planned" && b.status !== "discarded";

export type LotUse = { brews: number; grams: number; unknown: number; last: string | null };

/** What the brews that named each lot took from it, by their recipes — not by any count of the bag. */
export function lotUse(batches: readonly LotBatch[], recipes: readonly LotRecipe[] = []): Map<string, LotUse> {
  const out = new Map<string, LotUse>();
  for (const b of batches) {
    if (!b.coffee_lot_id || !brewed(b)) continue;
    const u = out.get(b.coffee_lot_id) ?? { brews: 0, grams: 0, unknown: 0, last: null };
    u.brews += 1;
    const g = coffeeGrams(b, recipes);
    if (g === null) u.unknown += 1; else u.grams += g;
    const at = b.brew_started_at || b.created_at || null;
    if (at && (!u.last || at > u.last)) u.last = at;
    out.set(b.coffee_lot_id, u);
  }
  return out;
}

/** By their recipes, the brews that named it have taken all of it. Unknowable for a lot that is not
 *  counted by weight, or when a brew's coffee was not weighed — never claimed then. */
export function usedUp(l: BrewLot, use: LotUse | undefined): boolean {
  if (!use || use.unknown > 0) return false;
  const held = inUnit(use.grams, l.unit);
  return held !== null && held >= Number(l.qty_received) - 1e-9;
}

// Code-unit order, not localeCompare: these are ISO keys, and a key compares the same everywhere.
const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
const newestFirst = (a: BrewLot, b: BrewLot) => desc(a.received_on, b.received_on) || desc(String(a.created_at ?? ""), String(b.created_at ?? ""));

/** The city's lots: coffee shelves first — by the shelf's name, lib/brewMath's rule — then the rest of
 *  what came in, each newest first. Another city's bag is never offered (the database refuses it). */
export function lotChoices(lots: readonly BrewLot[], market: string | null | undefined): { coffee: BrewLot[]; other: BrewLot[] } {
  const here = lots.filter((l) => l.market === market).slice().sort(newestFirst);
  return { coffee: here.filter((l) => isCoffee(l.item_name)), other: here.filter((l) => !isCoffee(l.item_name)) };
}

/**
 * The lot Start brew opens on. The bag the city's last brew named, unless its recipes say it is
 * gone — a bag runs across brews, and the one in the bin is the one last opened. With no brew to go
 * on, the city's one coffee lot that is not used up; with two or more there is a real choice, and
 * the sheet asks rather than guessing which is in the bin. Null: ask.
 */
export function defaultLot(lots: readonly BrewLot[], market: string | null | undefined, use: ReadonlyMap<string, LotUse>): string | null {
  const here = lots.filter((l) => l.market === market);
  const named = here.filter((l) => use.get(l.id)?.last);
  const last = named.sort((a, b) => desc(String(use.get(a.id)?.last), String(use.get(b.id)?.last)))[0];
  if (last && !usedUp(last, use.get(last.id))) return last.id;
  const open = here.filter((l) => isCoffee(l.item_name) && !usedUp(l, use.get(l.id)));
  return open.length === 1 ? open[0].id : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What naming this lot will do, said before Start: what the lot is, what the brews that named it
 * took, and whether this batch's coffee comes off it when the batch logs what it used — or why not.
 * The why-nots are the database's (0349): not a coffee shelf by its name; not counted by weight.
 * `today` is a YYYY-MM-DD key (lib/dates.localToday) so the harness can pin it. Before 0349 is in
 * the database (`linkable` false) the batch keeps only the lot's name, and the line says so rather
 * than promising a draw that cannot happen yet. A batch that has already logged what it used
 * (`logged`) had its draw then: naming a lot now changes the record, not the shelf. In a batch's own
 * log the use is the OTHER brews' (`others`) — the batch is not counted against itself.
 */
export function lotNote(l: BrewLot, use: LotUse | undefined, o: { needGrams: number | null; today: string; linkable?: boolean; logged?: boolean; others?: boolean }): string {
  const { needGrams, today, linkable = true, logged = false, others = false } = o;
  const from = l.vendor ? ` from ${l.vendor}` : "";
  const ago = agoWord(daysBetween(l.received_on, today));
  const used = use && use.unknown === 0 ? inUnit(use.grams, l.unit) : null;
  const brews = !use ? (others ? "no other brew has named it" : "no brew has named it yet")
    : `${use.brews} ${others ? "other " : ""}brew${use.brews === 1 ? "" : "s"} so far${usedUp(l, use) ? " — by their recipes, all of it" : used !== null ? `, about ${qtyWords(round2(used), l.unit)}` : ""}`;
  const facts = `${qtyWords(Number(l.qty_received), l.unit)}${from}${ago ? `, received ${ago}` : ""} · ${brews}.`;
  if (!linkable) return `${facts} The batch keeps its name; the link to the delivery arrives with the next database update.`;
  if (!isCoffee(l.item_name)) return `${facts} Not a coffee shelf by its name — the batch keeps the lot, but its coffee won't come off it.`;
  if (gramsPerUnit(l.unit) === null) {
    return `${facts} Counted in ${l.unit?.trim() || "no unit"}, not by weight — the batch keeps the lot, but its coffee can't come off it.`;
  }
  if (logged) return `${facts} This batch has already logged what it used — naming the lot now changes its record, not the shelf.`;
  const need = needGrams !== null ? inUnit(needGrams, l.unit) : null;
  return `${facts} This batch's ${need !== null ? qtyWords(round2(need), l.unit) : "coffee"} comes off it when the batch logs what it used.`;
}

/** The words for a lot that is not on file. */
export const TYPED_NOTE = "Not linked to a delivery — the batch keeps these words, and no coffee comes off a shelf.";
