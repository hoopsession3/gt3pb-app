// WHERE YOU ARE IN THE VISION, IN ITS ADDRESS (IMS8 P2). The vision's tab, the plan open, its step and the room were
// component state only: no link could open them, Back left the vision, and a "fix it" had nowhere to go and nothing to
// come back to. Now they live in the address (/vision?tab=plans&plan=…&step=money&back=links) — read once on arrival,
// kept up to date as you move — and one function turns an insight's `go` (lib/insight: section + anchor) into a place.
// Only known words and ids pass; anything else is ignored. Pure.
import { isUuid } from "./uuid";

export const VISION_TABS = ["roadmap", "plans", "store", "links", "standard", "library", "food", "menu"] as const;
export type VisionTab = (typeof VISION_TABS)[number];
export const CASE_STEPS = ["plan", "traffic", "room", "money"] as const;
export type CaseStep = (typeof CASE_STEPS)[number];
/** Where a "fix it" came from, so the screen offers the way back (only the publishing studio, for now). */
export const BACK_TO = ["links"] as const;
export type BackTo = (typeof BACK_TO)[number];
export type VisionPlace = { tab: VisionTab; plan: string | null; step: CaseStep | null; room: string | null; back: BackTo | null };

const one = <T extends string>(v: string | null, list: readonly T[]): T | null => (v && (list as readonly string[]).includes(v) ? (v as T) : null);

/** The place an address names; unknown values are dropped, never guessed. */
export function placeOf(search: string): VisionPlace {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const tab = one(q.get("tab"), VISION_TABS) ?? "roadmap";
  const id = (k: string) => { const v = q.get(k); return isUuid(v) ? v.toLowerCase() : null; };
  const plan = tab === "plans" ? id("plan") : null;
  return { tab, plan, step: plan ? one(q.get("step"), CASE_STEPS) : null, room: tab === "store" ? id("room") : null, back: one(q.get("back"), BACK_TO) };
}

/** The address of a place: only what isn't the default is said, in a fixed order. */
export function searchOf(p: Partial<VisionPlace>): string {
  const q = new URLSearchParams();
  const tab = p.tab ?? "roadmap";
  if (tab !== "roadmap") q.set("tab", tab);
  if (tab === "plans" && p.plan) { q.set("plan", p.plan); if (p.step && p.step !== "plan") q.set("step", p.step); }
  if (tab === "store" && p.room) q.set("room", p.room);
  if (p.back) q.set("back", p.back);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** An insight's `go` (lib/insight) as a place in the vision — the one router every "fix it" uses. */
export function placeOfGo(go: { section: string; anchor?: string | null } | null | undefined, back: BackTo | null = null): VisionPlace {
  const a = isUuid(go?.anchor) ? go.anchor.toLowerCase() : null;
  switch (go?.section) {
    case "plans": return { tab: "plans", plan: a, step: null, room: null, back };
    case "money": return { tab: "plans", plan: a, step: a ? "money" : null, room: null, back };
    case "traffic": return { tab: "plans", plan: a, step: a ? "traffic" : null, room: null, back };
    case "store": return { tab: "store", plan: null, step: null, room: a, back };
    case "library": return { tab: "library", plan: null, step: null, room: null, back };
    case "links": return { tab: "links", plan: null, step: null, room: null, back: null };
    case "roadmap": default: return { tab: "roadmap", plan: null, step: null, room: null, back };
  }
}
