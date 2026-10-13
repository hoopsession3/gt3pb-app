// THE DAILY STACK, TWO QUESTIONS (2026-10-13, R4 of the customer audit — "Daily Stack 2", decision (a), approved).
//
// The stack asked five questions and six flags about sleep, soreness, energy, the gut and the joints, then answered
// with three drinks, a "science" paragraph each — iron, zinc, minerals — and a fake 850 ms "Reading your inputs…".
// It asked about symptoms and answered with products, and it added drinks whatever the truck could make.
//
// Now: what the day is (training, deep work, an easy one) and whether caffeine is in it, and an optional fine-tune of
// preferences — warm, light, savory. Nothing about how anyone feels. The drinks are the Catalog's (lib/drinks): a slot
// is the drinks the Catalog says are for before, during or after, by the cup, on the menu, not sold out and on the
// stop's menu; "Not today" keeps only the drinks the Catalog says have no caffeine — one it says nothing about is not
// offered as caffeine-free. The order of preference inside a slot is this file's; a drink added in the Catalog joins
// the end of its slot. Pure: the sheet, the tests and nothing else.

import type { Drink, When } from "./drinks";
import { waitingLabel, type Ordering } from "./ordering";

export type Day = "training" | "deep" | "easy";
export type Pref = "warm" | "light" | "savory";
export type StackAnswers = { day: Day; caffeine: boolean; prefs: readonly Pref[] };
export type Slot = "before" | "during" | "after";

export const DAYS: readonly [Day, string][] = [["training", "Training"], ["deep", "Deep work"], ["easy", "Easy"]];
export const CAFFEINE: readonly [boolean, string][] = [[true, "Yes"], [false, "Not today"]];
export const PREFS: readonly [Pref, string][] = [["warm", "Warm"], ["light", "Light"], ["savory", "Savory"]];
export const SLOT_WORD: Readonly<Record<Slot, string>> = { before: "Before", during: "During", after: "After" };
const SLOT_WHEN: Readonly<Record<Slot, When>> = { before: "BEFORE", during: "DURING", after: "AFTER" };

/** The slots a day asks for, in the order they are drunk. */
export function slotsFor(a: StackAnswers): Slot[] {
  const savory = a.prefs.includes("savory"), light = a.prefs.includes("light");
  const out: Slot[] = [];
  if (a.caffeine) out.push("before");
  if (a.day === "training" || a.day === "deep" || !a.caffeine || light) out.push("during");
  if (a.day === "training" || savory) out.push("after");
  return out;
}

/** Who goes first in a slot, by the answers — the drinks this file knows by name; the Catalog's others follow. */
function preferred(slot: Slot, a: StackAnswers): string[] {
  const warm = a.prefs.includes("warm"), light = a.prefs.includes("light");
  if (slot === "before") {
    const base = a.day === "deep" ? ["flow", "kingme", "rise"] : a.day === "training" ? ["flow", "rise", "kingme"] : ["rise", "flow", "kingme"];
    return warm ? ["dusk", "maple", ...base] : [...base, "dusk", "maple"];
  }
  if (slot === "during") return a.day === "training" && !light ? ["tide", "aide"] : ["aide", "tide"];
  // after
  if (light) return ["wild", "hunt", "forge"];
  return a.day === "training" ? ["forge", "hunt", "wild"] : ["hunt", "forge", "wild"];
}

/** Why this drink, for this day — preferences and timing in plain words, never a claim about the body. */
function whyOf(slot: Slot, d: Drink, a: StackAnswers): string {
  const warm = a.prefs.includes("warm"), light = a.prefs.includes("light");
  if (slot === "before") {
    if (warm && (d.slug === "dusk" || d.slug === "maple")) return "A warmer, spiced cup";
    return a.day === "training" ? "Before the session" : a.day === "deep" ? "For the deep work" : "To open the day";
  }
  // A preference changes the drink, not when it is for: a training day's drinks are the session's, light or not.
  if (slot === "during") return a.day === "training" ? "Through the session" : "Light, through the day";
  if (light && d.slug === "wild") return a.day === "training" ? "The lighter broth, after the session" : "The lighter broth, for after";
  return a.day === "training" ? "Savory, after the session" : "Savory, for after";
}

export type Pick = { slot: Slot; drink: Drink; why: string };
export type Stack = {
  picks: Pick[];
  /** A slot the day asked for that nothing on the menu fills now — said, not skipped silently. */
  missing: Slot[];
  /** Every pick's price, when the Catalog says each one. */
  cents: number | null;
};

/** What the truck can make now, for this day. `soldOut` and `stopMenu` are what the menu and checkout read. */
export function stackFor(a: StackAnswers, menu: readonly Drink[], soldOut: ReadonlySet<string>, stopMenu: ReadonlySet<string> | null): Stack {
  const can = (d: Drink) => d.cup && d.active && !d.soldOut && !soldOut.has(d.slug) && (!stopMenu || stopMenu.has(d.slug));
  const picks: Pick[] = [], missing: Slot[] = [];
  for (const slot of slotsFor(a)) {
    const inSlot = menu.filter((d) => d.when === SLOT_WHEN[slot] && can(d) && (a.caffeine || d.caffeine === false));
    const order = preferred(slot, a);
    const rank = (d: Drink) => { const i = order.indexOf(d.slug); return i < 0 ? order.length + d.sort : i; };
    const d = [...inSlot].sort((x, y) => rank(x) - rank(y))[0];
    if (d) picks.push({ slot, drink: d, why: whyOf(slot, d, a) });
    else missing.push(slot);
  }
  const cents = picks.length && picks.every((p) => typeof p.drink.priceCents === "number")
    ? picks.reduce((s, p) => s + (p.drink.priceCents as number), 0) : null;
  return { picks, missing, cents };
}

/** A slot nobody can fill now, in a line: "Nothing for before on the menu right now." */
export function missingWords(slots: readonly Slot[]): string {
  if (!slots.length) return "";
  const w = slots.map((s) => SLOT_WORD[s].toLowerCase());
  return `Nothing for ${w.length === 1 ? w[0] : `${w.slice(0, -1).join(", ")} or ${w[w.length - 1]}`} on the menu right now.`;
}

export type StackButton = { kind: "add" | "preorder" | "save"; label: string };
/** The button follows the truck (lib/ordering): order now, pre-order for when it opens, or keep it for the next stop.
 *  Before the first read lands it is optimistic, as every ordering surface is — Pay holds the gate either way. */
export function stackButton(o: Ordering | null, cents: number | null, money: (c: number) => string, nowMs: number = Date.now()): StackButton {
  const priced = cents !== null ? ` · ${money(cents)}` : "";
  if (!o || o.state === "live" || o.state === "started") return { kind: "add", label: `Add to order${priced}` };
  if (o.state === "ahead" && o.readyFrom) return { kind: "preorder", label: `Pre-order ${waitingLabel(o.readyFrom, nowMs)}` };
  return { kind: "save", label: "Save for the next stop" };
}

// ── THE ANSWERS STAY ON THE PHONE ──────────────────────────────────────────────────────────────────────────────
// Read back the next time the sheet opens, never sent anywhere. Parsed strictly: anything else is no answer.
export const STACK_KEY = "gt3-stack";
export function parseAnswers(raw: string | null | undefined): StackAnswers | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { day?: unknown; caffeine?: unknown; prefs?: unknown };
    const day = DAYS.find(([k]) => k === v.day)?.[0];
    if (!day || typeof v.caffeine !== "boolean") return null;
    const prefs = Array.isArray(v.prefs) ? PREFS.map(([k]) => k).filter((k) => (v.prefs as unknown[]).includes(k)) : [];
    return { day, caffeine: v.caffeine, prefs };
  } catch { return null; }
}
