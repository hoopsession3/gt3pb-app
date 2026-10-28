// READING AND WRITING THE VISION (R52, 0447). The console reads the four tables (staff, under RLS); a shared link reads
// vision_shared(token) — the one door for someone outside — and both arrive as the same shape (Vision), so the board,
// the store and the presenter draw them the same way.
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedKind, type Ask, type Item, type Layout, type Pillar, type Program } from "./vision";
import { DEALS, FORMATS, NEED_KINDS, PLAN_STATUSES, type Dep, type Need, type Plan } from "./visionPlans";
import { toCase, type PlanCase } from "./visionCaseData";

/** `plansReady`: 0448 is in (R53). Until it is, the plans read is absent, not failed — the roadmap and the room still
 *  show, and the Plans tab says what's waiting. `expiresAt`: a link's end, when it has one. */
export type Vision = {
  programs: Program[]; asks: Ask[]; layouts: Layout[]; plans: Plan[]; needs: Need[]; deps: Dep[];
  label?: string; showAsks: boolean; plansReady: boolean; expiresAt?: string | null;
  /** The investor case per plan (R57): its approved baseline and accepted research — on a link only where an owner chose. */
  cases?: Record<string, PlanCase>;
};

type Row = Record<string, unknown>;
const pillarsOf = (v: unknown): Pillar[] => (Array.isArray(v) ? v.filter((p): p is Pillar => ["stillness", "light", "fuel", "movement"].includes(p as string)) : []);
const n = (v: unknown, d = 0) => (v == null || v === "" ? d : Number(v));

export const toProgram = (r: Row): Program => ({
  id: String(r.id), lane: String(r.lane ?? "Business"), title: String(r.title ?? ""), summary: (r.summary as string) ?? null, why: (r.why as string) ?? null,
  pillars: pillarsOf(r.pillars), horizon: (["now", "next", "later"].includes(r.horizon as string) ? r.horizon : "next") as Program["horizon"],
  status: (["idea", "planned", "building", "live", "paused"].includes(r.status as string) ? r.status : "planned") as Program["status"],
  start_on: (r.start_on as string) ?? null, target_on: (r.target_on as string) ?? null, emoji: (r.emoji as string) ?? null,
  layout_id: (r.layout_id as string) ?? null, sort: n(r.sort),
});
export const toAsk = (r: Row): Ask => ({
  id: r.id ? String(r.id) : undefined, program_id: String(r.program_id), plan_id: r.plan_id ? String(r.plan_id) : null, label: String(r.label ?? ""), amount_cents: n(r.amount_cents),
  state: (["open", "committed", "funded"].includes(r.state as string) ? r.state : "open") as Ask["state"], note: (r.note as string) ?? null, sort: n(r.sort),
});
export const toItem = (r: Row): Item => ({
  id: String(r.id), kind: String(r.kind), label: (r.label as string) ?? null, x_in: n(r.x_in), y_in: n(r.y_in),
  rot: ([0, 90, 180, 270].includes(n(r.rot)) ? n(r.rot) : 0) as Item["rot"], w_in: n(r.w_in, 36), d_in: n(r.d_in, 36), h_in: n(r.h_in, 36),
  why: (r.why as string) ?? null, pillars: pillarsOf(r.pillars), sort: n(r.sort),
});
export const toLayout = (r: Row, items: Item[]): Layout => ({
  id: String(r.id), name: String(r.name ?? "Store"), width_in: n(r.width_in, 360), depth_in: n(r.depth_in, 480), ceiling_in: n(r.ceiling_in, 132),
  notes: (r.notes as string) ?? null, items: items.filter((i) => allowedKind(i.kind)),
});

const oneOf = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d);
export const toPlan = (r: Row): Plan => ({
  id: String(r.id), program_id: String(r.program_id), name: String(r.name ?? ""), format: oneOf(FORMATS, r.format, "other"),
  phase: Math.min(9, Math.max(1, n(r.phase, 1))), status: oneOf(PLAN_STATUSES, r.status, "exploring"), sqft: r.sqft == null ? null : n(r.sqft),
  deal: oneOf(DEALS, r.deal, "tbd"), place: (r.place as string) ?? null, summary: (r.summary as string) ?? null, why: (r.why as string) ?? null,
  gate: (r.gate as string) ?? null, layout_id: (r.layout_id as string) ?? null, shareable: r.shareable !== false, sort: n(r.sort),
  opened_on: (r.opened_on as string) ?? null, actual_channel: (r.actual_channel as string) ?? null,
  research_every_days: n(r.research_every_days), research_last_at: (r.research_last_at as string) ?? null,
  customer: (r.customer as string) ?? null, market: (r.market as string) ?? null, positioning: (r.positioning as string) ?? null,
});
export const toNeed = (r: Row, planId?: string): Need => ({
  id: r.id ? String(r.id) : undefined, plan_id: planId ?? String(r.plan_id), label: String(r.label ?? ""), kind: oneOf(NEED_KINDS, r.kind, "other"),
  owner: (r.owner as string) ?? null, due_on: (r.due_on as string) ?? null, done_on: (r.done_on as string) ?? null, note: (r.note as string) ?? null, sort: n(r.sort),
});
/** The console's read: everything, as staff see it. A refused read is an error, never an empty plan. */
export async function readVision(sb: SupabaseClient): Promise<Vision> {
  const [p, a, l, i] = await Promise.all([
    sb.from("vision_programs").select("*").order("horizon").order("sort").order("created_at"),
    sb.from("vision_asks").select("*").order("sort").order("created_at"),
    sb.from("store_layouts").select("*").order("created_at"),
    sb.from("store_items").select("*").order("sort").order("created_at"),
  ]);
  const err = p.error ?? a.error ?? l.error ?? i.error;
  if (err) throw new Error(err.message);
  const [pl, nd, dp] = await Promise.all([
    sb.from("vision_plans").select("*").order("phase").order("sort").order("created_at"),
    sb.from("vision_plan_needs").select("*").order("sort").order("created_at"),
    sb.from("vision_plan_deps").select("plan_id, needs_plan_id"),
  ]);
  const planErr = pl.error ?? nd.error ?? dp.error;
  if (planErr) throw new Error(planErr.message);   // 0448 is applied (2026-10-25): the plans are always there
  const items = ((i.data ?? []) as Row[]).map((r) => ({ ...toItem(r), layout_id: String(r.layout_id) }));
  return {
    programs: ((p.data ?? []) as Row[]).map(toProgram),
    asks: ((a.data ?? []) as Row[]).map(toAsk),
    layouts: ((l.data ?? []) as Row[]).map((r) => toLayout(r, items.filter((it) => it.layout_id === String(r.id)))),
    plans: ((pl.data ?? []) as Row[]).map(toPlan),
    needs: ((nd.data ?? []) as Row[]).map((r) => toNeed(r)),
    deps: ((dp.data ?? []) as Row[]).map((r) => ({ plan_id: String(r.plan_id), needs_plan_id: String(r.needs_plan_id) })),
    showAsks: true, plansReady: true,
  };
}

/** A shared link's read: vision_shared(token), the one door for someone outside. A link that isn't live says so. */
export async function readShared(sb: SupabaseClient, token: string): Promise<Vision> {
  const { data, error } = await sb.rpc("vision_shared", { p_token: token });
  if (error) throw new Error(/live/i.test(error.message) ? "This link isn't live — ask whoever sent it for a new one." : error.message);
  const j = (data ?? {}) as { label?: string; show_asks?: boolean; expires_at?: string | null; programs?: Row[]; asks?: Row[];
    plans?: (Row & { needs?: Row[]; waits_on?: string[]; money?: Row | null; research?: Row[] | null; risks?: Row[] | null })[]; layouts?: (Row & { items?: Row[] })[] };
  // 0451: a plan's case, where the link was given it — before 0451 no plan carries one, and the link shows none.
  const cases: Record<string, PlanCase> = {};
  for (const r of j.plans ?? []) { const c = toCase(r.money as Parameters<typeof toCase>[0], r.research ?? [], r.risks ?? []); if (c) cases[String(r.id)] = c; }
  // A link reads only the plans marked to show (0448); before 0448 the door had none, and says nothing of them.
  const plans = (j.plans ?? []).map((r) => ({ ...toPlan(r), shareable: true }));
  return {
    label: j.label, showAsks: j.show_asks !== false, expiresAt: j.expires_at ?? null, plansReady: true,
    plans,
    needs: (j.plans ?? []).flatMap((r) => (r.needs ?? []).map((x) => toNeed(x, String(r.id)))),
    deps: (j.plans ?? []).flatMap((r) => (r.waits_on ?? []).map((w) => ({ plan_id: String(r.id), needs_plan_id: String(w) }))),
    programs: (j.programs ?? []).map(toProgram),
    asks: (j.asks ?? []).map(toAsk),
    layouts: (j.layouts ?? []).map((l) => toLayout(l, (l.items ?? []).map(toItem))),
    cases,
  };
}

/** The designer's save: what changed between the room as read and the room as drawn — the deleted, then the rest upserted. */
export function itemDiff(before: readonly Item[], after: readonly Item[]): { remove: string[]; upsert: Item[] } {
  const was = new Map(before.map((i) => [i.id, JSON.stringify(i)]));
  const now = new Set(after.map((i) => i.id));
  return { remove: before.filter((i) => !now.has(i.id)).map((i) => i.id), upsert: after.filter((i) => was.get(i.id) !== JSON.stringify(i)) };
}

export async function saveLayout(sb: SupabaseClient, layout: Layout, before: readonly Item[]): Promise<string | null> {
  const { error: le } = await sb.from("store_layouts").update({ name: layout.name, width_in: layout.width_in, depth_in: layout.depth_in, ceiling_in: layout.ceiling_in, notes: layout.notes, updated_at: new Date().toISOString() }).eq("id", layout.id);
  if (le) return le.message;
  const { remove, upsert } = itemDiff(before, layout.items);
  if (remove.length) { const { error } = await sb.from("store_items").delete().in("id", remove); if (error) return error.message; }
  if (upsert.length) {
    const { error } = await sb.from("store_items").upsert(upsert.map((i, k) => ({
      id: i.id, layout_id: layout.id, kind: i.kind, label: i.label, x_in: i.x_in, y_in: i.y_in, rot: i.rot, w_in: i.w_in, d_in: i.d_in, h_in: i.h_in,
      why: i.why, pillars: i.pillars, sort: i.sort || k + 1, updated_at: new Date().toISOString(),
    })));
    if (error) return error.message;
  }
  return null;
}

/** The investor cases the owners and admins can present in the room (R57): every plan with an approved baseline, and
 *  its accepted research and its risks. */
export async function readCases(sb: SupabaseClient): Promise<Record<string, PlanCase>> {
  const m = await sb.from("vision_plan_money").select("plan_id, baseline, baseline_at").not("baseline", "is", null);
  if (m.error) throw new Error(m.error.message);
  const r = await sb.from("vision_research").select("plan_id, topic, claim, figure, source_url, source_title, published, bearing, retrieved_at").eq("status", "accepted");
  if (r.error) throw new Error(r.error.message);
  const found = (r.data ?? []) as Row[];
  const k = await sb.from("vision_plan_risks").select("*");
  if (k.error) throw new Error(k.error.message);
  const risks = (k.data ?? []) as Row[];
  const out: Record<string, PlanCase> = {};
  for (const row of (m.data ?? []) as Row[]) {
    const id = String(row.plan_id);
    const c = toCase({ baseline: row.baseline as { scenarios?: Record<string, unknown> }, approved_at: (row.baseline_at as string) ?? null }, found.filter((f) => String(f.plan_id) === id), risks.filter((x) => String(x.plan_id) === id));
    if (c) out[id] = c;
  }
  return out;
}
