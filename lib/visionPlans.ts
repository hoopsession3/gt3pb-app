// PLANS — EVERY WAY IN (R53, phase A; Ryan, 2026-10-25: "maybe it's not a full brick and mortar, maybe it's a bar that's
// rented out from a gym… lease versus buy, versus space, versus partnering with a coffee shop that already has the
// standards… our recipe on a menu… multiple plans built out and saved… each plan its own database record").
//
// A program (the first store) holds plans — each a way in, in a phase, with a gate that says when it goes, what it needs
// before it can (the requirements are its milestones too), what it waits on, and its own room when it has one. Pure:
// the words, the order, what a plan is waiting on, whether a new wait would make a loop, and the side-by-side rows.
// The money (phase B), the traffic (C), the research and scores (D) and the investor case (E) hang off the same record.
import type { Ask, Layout } from "./vision";
import { askTotals, roomStats } from "./vision";
import { localToday } from "./dates";

export const FORMATS = ["gym_bar", "kiosk", "partner_menu", "pop_up", "storefront_lease", "storefront_buy", "shared_space", "other"] as const;
export type Format = (typeof FORMATS)[number];
/** What each way in is, said plainly; `room`: it has a room of ours to lay out (a menu at a partner's has none). */
export const FORMAT: Record<Format, { name: string; mark: string; room: boolean; says: string }> = {
  gym_bar:          { name: "A bar inside a gym",       mark: "🏋️", room: true,  says: "A small GT3 bar in a gym's space — a crowd that already moves." },
  kiosk:            { name: "A kiosk",                  mark: "🛖", room: true,  says: "A counter and a cooler where people pass: an office lobby, a market, a campus." },
  partner_menu:     { name: "On a partner café's menu", mark: "🤝", room: false, says: "Our recipe and our name on a café that meets the standard — their room." },
  pop_up:           { name: "A pop-up",                 mark: "⛺", room: true,  says: "A short stay somewhere new — a test before a lease." },
  storefront_lease: { name: "A leased storefront",      mark: "🏪", room: true,  says: "Our own room on a lease." },
  storefront_buy:   { name: "A storefront we own",      mark: "🏛️", room: true,  says: "Our own room, the building bought." },
  shared_space:     { name: "A shared space",           mark: "🏢", room: true,  says: "A corner of someone else's place — a coworking floor, a studio, a market hall." },
  other:            { name: "Another way",              mark: "◆",  room: true,  says: "" },
};

export const PLAN_STATUSES = ["exploring", "validating", "ready", "go", "live", "paused", "no_go"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_STATUS: Record<PlanStatus, { word: string; tone: "" | "ok" | "gold" | "warn" | "crit" | "blue" }> = {
  exploring:  { word: "Exploring",  tone: "" },
  validating: { word: "Validating", tone: "blue" },
  ready:      { word: "Ready",      tone: "gold" },
  go:         { word: "Go",         tone: "ok" },
  live:       { word: "Live",       tone: "ok" },
  paused:     { word: "Paused",     tone: "warn" },
  no_go:      { word: "No-go",      tone: "crit" },
};
/** A plan that has gone ahead: what waits on it no longer waits. */
export const isUnderway = (s: PlanStatus) => s === "go" || s === "live";

export const DEALS = ["tbd", "lease", "buy", "sublease", "rev_share", "license_fee", "partnership", "none"] as const;
export type Deal = (typeof DEALS)[number];
export const DEAL_WORD: Record<Deal, string> = {
  tbd: "Deal to be set", lease: "Lease", buy: "Buy", sublease: "Sublease", rev_share: "Revenue share", license_fee: "License fee",
  partnership: "Partnership", none: "No deal needed",
};

export const NEED_KINDS = ["financing", "site", "permit", "equipment", "hiring", "demand", "partner", "build", "other"] as const;
export type NeedKind = (typeof NEED_KINDS)[number];
export const NEED_WORD: Record<NeedKind, string> = {
  financing: "Financing", site: "Site", permit: "Permit", equipment: "Equipment", hiring: "Hiring", demand: "Demand",
  partner: "Partner", build: "Build", other: "Other",
};

export type Plan = {
  id: string; program_id: string; name: string; format: Format; phase: number; status: PlanStatus; sqft: number | null; deal: Deal;
  place: string | null; summary: string | null; why: string | null; gate: string | null; layout_id: string | null; shareable: boolean; sort: number;
  /** R58, 0452: when it opened, and which order channel records its sales — for actual against the plan. */
  opened_on?: string | null; actual_channel?: string | null;
  /** R60, 0453: how often its research is checked again (0 = never), and when it last ran. */
  research_every_days?: number; research_last_at?: string | null;
  /** R61, 0454: who it's for, the market it serves, how it stands apart — in Ryan's words. */
  customer?: string | null; market?: string | null; positioning?: string | null;
};
export type Need = { id?: string; plan_id: string; label: string; kind: NeedKind; owner: string | null; due_on: string | null; done_on: string | null; note: string | null; sort: number };
export type Dep = { plan_id: string; needs_plan_id: string };

/** A program's plans in their phases: phase, then their order, then their name. */
export function phases(plans: readonly Plan[]): { phase: number; plans: Plan[] }[] {
  const by = new Map<number, Plan[]>();
  for (const p of [...plans].sort((a, b) => a.phase - b.phase || a.sort - b.sort || a.name.localeCompare(b.name))) {
    if (!by.has(p.phase)) by.set(p.phase, []);
    by.get(p.phase)!.push(p);
  }
  return [...by.entries()].map(([phase, ps]) => ({ phase, plans: ps }));
}

/** What a plan is still waiting on: the plans it needs that haven't gone ahead (go or live), nearest first. */
export function waitingOn(plan: Plan, plans: readonly Plan[], deps: readonly Dep[]): Plan[] {
  return deps.filter((d) => d.plan_id === plan.id)
    .map((d) => plans.find((p) => p.id === d.needs_plan_id))
    .filter((p): p is Plan => !!p && !isUnderway(p.status))
    .sort((a, b) => a.phase - b.phase);
}

/** Would `plan` waiting on `needs` close a loop? (0448 refuses it too — PT409; the screen says so before asking.) */
export function wouldLoop(deps: readonly Dep[], plan: string, needs: string): boolean {
  if (plan === needs) return true;
  const seen = new Set<string>(), stack = [needs];
  while (stack.length) {
    const at = stack.pop()!;
    if (at === plan) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const d of deps) if (d.plan_id === at) stack.push(d.needs_plan_id);
  }
  return false;
}

/** How far along its needs are: done of all, and the next undone one due (or the first undone). */
export function needsProgress(needs: readonly Need[]): { done: number; all: number; next: Need | null; late: number } {
  const open = needs.filter((n) => !n.done_on);
  const today = localToday();   // the operator's day: a need due today isn't late until tomorrow, wherever they are
  const dated = open.filter((n) => n.due_on).sort((a, b) => a.due_on!.localeCompare(b.due_on!));
  return { done: needs.length - open.length, all: needs.length, next: dated[0] ?? open.sort((a, b) => a.sort - b.sort)[0] ?? null,
    late: open.filter((n) => n.due_on && n.due_on < today).length };
}

/** Square feet, said: "1,200 sq ft", or what to set. */
export const sqftWords = (p: Pick<Plan, "sqft" | "layout_id">, room?: Layout | null) =>
  p.sqft ? `${p.sqft.toLocaleString("en-US")} sq ft` : room ? `${roomStats(room).sqft.toLocaleString("en-US")} sq ft (its room)` : "Size to be set";

/** The side-by-side: one row per question, one column per plan — the same questions of every way in. */
export type CompareRow = { label: string; cells: string[]; differs: boolean };
export function compareRows(plans: readonly Plan[], ctx: { layouts: readonly Layout[]; asks: readonly Ask[]; needs: readonly Need[]; deps: readonly Dep[]; all: readonly Plan[] }): CompareRow[] {
  const roomOf = (p: Plan) => ctx.layouts.find((l) => l.id === p.layout_id) ?? null;
  const row = (label: string, f: (p: Plan) => string): CompareRow => { const cells = plans.map(f); return { label, cells, differs: new Set(cells).size > 1 }; };
  return [
    row("Phase", (p) => `Phase ${p.phase}`),
    row("Way in", (p) => FORMAT[p.format].name),
    row("Where", (p) => p.place || "—"),
    row("Size", (p) => sqftWords(p, roomOf(p))),
    row("Deal", (p) => DEAL_WORD[p.deal]),
    row("Status", (p) => PLAN_STATUS[p.status].word),
    row("Seats", (p) => { const r = roomOf(p); return r ? String(roomStats(r).seats) : FORMAT[p.format].room ? "No room drawn yet" : "Theirs"; }),
    row("Needs done", (p) => { const n = needsProgress(ctx.needs.filter((x) => x.plan_id === p.id)); return n.all ? `${n.done} of ${n.all}${n.late ? ` · ${n.late} late` : ""}` : "None listed"; }),
    row("Waits on", (p) => waitingOn(p, ctx.all, ctx.deps).map((w) => w.name).join(", ") || "Nothing"),
    row("Capital asked", (p) => { const t = askTotals(ctx.asks.filter((a) => a.plan_id === p.id)); return t.total ? `$${Math.round(t.total / 100).toLocaleString("en-US")}` : t.unset ? "Being priced" : "None asked"; }),
    row("Goes when", (p) => p.gate || "Gate to be set"),
  ];
}

/** A room for a plan sized from its square feet: a 3 : 4 rectangle, on whole feet, inside the designer's limits. */
export function roomFor(sqft: number | null): { width_in: number; depth_in: number } {
  if (!sqft || sqft <= 0) return { width_in: 360, depth_in: 480 };
  const w = Math.sqrt((sqft * 144 * 3) / 4);
  const clamp = (v: number) => Math.min(2400, Math.max(96, Math.round(v / 12) * 12));
  return { width_in: clamp(w), depth_in: clamp((w * 4) / 3) };
}
