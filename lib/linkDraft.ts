// THE LINK IN PROGRESS (IMS8 P7 — the studio's draft, pure). Every choice, the step it's on, the confirmations given and
// the fingerprint they were given against — kept in this tab only (sessionStorage, never sent; IMS8 P2), so a "fix it"
// elsewhere in the vision and Back return to it as it was. Nothing is chosen for a new link (IMS8 A1), and what goes to
// the database is only what's visibly ticked (toPublish).
import { inScope } from "./sharePreview";
import type { LinkDraft as PublishDraft } from "./sharePublish";

export const STEPS = ["choose", "review", "preview", "share"] as const;
export type Step = (typeof STEPS)[number];
export const STEP_WORD: Record<Step, string> = { choose: "Choose", review: "Review", preview: "Preview", share: "Share" };
export const ENDS = [{ key: "never", label: "Until I turn it off", days: 0 }, { key: "7", label: "7 days", days: 7 }, { key: "30", label: "30 days", days: 30 }, { key: "90", label: "90 days", days: 90 }] as const;

export type StudioDraft = { label: string; money: boolean; ends: string; programs: string[]; rooms: string[]; plans: string[]; needs: string[]; cases: string[]; research: string[];
  step: Step; confirmed: string[]; reviewed: string | null };
export const EMPTY: StudioDraft = { label: "", money: false, ends: "30", programs: [], rooms: [], plans: [], needs: [], cases: [], research: [], step: "choose", confirmed: [], reviewed: null };
export const DRAFT_KEY = "gt3.vision.linkDraft.v1";
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
export function readDraft(): StudioDraft | null {
  try {
    const j = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") as Partial<StudioDraft> | null;
    if (!j || typeof j !== "object") return null;
    return { label: typeof j.label === "string" ? j.label.slice(0, 80) : "", money: j.money === true, ends: typeof j.ends === "string" ? j.ends : "30",
      programs: strs(j.programs), rooms: strs(j.rooms), plans: strs(j.plans), needs: strs(j.needs), cases: strs(j.cases), research: strs(j.research),
      step: (STEPS as readonly string[]).includes(j.step as string) ? (j.step as Step) : "choose", confirmed: strs(j.confirmed), reviewed: typeof j.reviewed === "string" ? j.reviewed : null };
  } catch { return null; }
}
export function writeDraft(d: StudioDraft) {
  try {
    const empty = !d.label.trim() && !d.money && d.ends === "30" && !d.programs.length && !d.rooms.length && !d.plans.length && !d.needs.length && !d.cases.length && !d.research.length;
    if (empty) sessionStorage.removeItem(DRAFT_KEY); else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch { /* storage refused: the draft lives on screen only */ }
}
/** What the database is asked to publish, from the draft — only what's visibly ticked (A1: a plan under a program since
 *  unticked isn't carried; money and research only for plans carried). */
export function toPublish(d: StudioDraft, plans: readonly { id: string; program_id?: string | null }[], isOwner: boolean): PublishDraft {
  const scope = inScope(plans, d.programs, d.plans, d.needs);
  const days = ENDS.find((e) => e.key === d.ends)?.days ?? 30;
  return { label: d.label.trim(), show_asks: d.money, days, program_ids: d.programs, layout_ids: d.rooms, plan_ids: scope.plans, need_plans: scope.needs,
    ...(isOwner ? { money_plans: d.cases.filter((id) => scope.plans.includes(id)), research_plans: d.research.filter((id) => scope.plans.includes(id)) } : {}) };
}

