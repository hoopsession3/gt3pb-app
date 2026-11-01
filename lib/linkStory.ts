// WHO IT'S FOR, AND THE STORY IT TELLS (IMS8 P9 — presets and narrative, deterministic; no AI). Ryan: "Presentation-only
// presets. A narrative assembled from approved facts, with sources tagged and suggested wording separated."
//
//   An AUDIENCE preset (angel, landlord, partner) changes only how things are ordered and shown — which suggestions come
//   first, which way the preview presents — never what's chosen. Nothing is ticked for you (A1).
//   SUGGESTIONS (recommend): plans worth adding, ranked only from recorded facts — an approved money case, a plan a picked
//   plan waits on (its recorded dependency), then the audience's order — each with a one-line reason (≤ 32 characters).
//   THE STORY (storyOf): facts from the response itself, each tagged with where it comes from; and, kept apart and
//   labelled as such, a suggested opening made only of words the response holds (names, never a number it doesn't).
import type { PresentMode } from "./visionPresent";

export const AUDIENCES = ["angel", "landlord", "partner"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_WORD: Record<Audience, string> = { angel: "An investor", landlord: "A landlord", partner: "A partner" };
/** How the preview presents for each (presentation only). */
export const AUDIENCE_MODE: Record<Audience, PresentMode> = { angel: "pitch", landlord: "explore", partner: "explore" };

export type PlanFact = { id: string; name: string; program_id: string | null; shareable?: boolean; phase: number; layout_id?: string | null; deal?: string | null; sqft?: number | null };
export type Suggestion = { id: string; name: string; reason: string };
const PARTNER_DEALS = new Set(["rev_share", "partnership", "license_fee"]);

/** Plans worth adding to a link, ranked only from recorded facts; never chosen for you. */
export function recommend(o: { plans: readonly PlanFact[]; deps: readonly { plan_id: string; needs_plan_id: string }[]; approved: ReadonlySet<string>; picked: readonly string[]; programs: readonly string[]; audience: Audience | null }): Suggestion[] {
  const offered = o.plans.filter((p) => p.shareable !== false && p.program_id && o.programs.includes(p.program_id) && !o.picked.includes(p.id));
  const waitedOn = new Set(o.deps.filter((d) => o.picked.includes(d.plan_id)).map((d) => d.needs_plan_id));
  const aud = (p: PlanFact) => (o.audience === "landlord" ? (p.layout_id ? 0 : p.sqft ? 1 : 2) : o.audience === "partner" ? (p.deal && PARTNER_DEALS.has(p.deal) ? 0 : 1) : 0);
  const why = (p: PlanFact) => (o.approved.has(p.id) ? "Approved money case" : waitedOn.has(p.id) ? "A picked plan waits on it"
    : o.audience === "landlord" && p.layout_id ? "Its room is drawn" : o.audience === "partner" && p.deal && PARTNER_DEALS.has(p.deal) ? "A partnership deal" : `Phase ${p.phase}`);
  return [...offered].sort((a, b) => Number(o.approved.has(b.id)) - Number(o.approved.has(a.id)) || Number(waitedOn.has(b.id)) - Number(waitedOn.has(a.id))
    || aud(a) - aud(b) || a.phase - b.phase || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
    .map((p) => ({ id: p.id, name: p.name, reason: why(p) }));
}

type J = unknown;
type Obj = Record<string, J>;
const obj = (v: J): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: J): J[] => (Array.isArray(v) ? v : []);
const str = (v: J): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export type Fact = { says: string; source: string };
const day = (v: J) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

/** The story the response tells: facts, each with its source; and a suggested opening, apart, made of its own words. */
export function storyOf(payload: J): { facts: Fact[]; suggested: string | null } {
  const p = obj(payload), facts: Fact[] = [];
  const programs = arr(p.programs).map(obj), plans = arr(p.plans).map(obj);
  for (const x of programs) {
    const t = str(x.title); if (!t) continue;
    facts.push({ says: str(x.why) ? `${t}: ${str(x.why)}` : t, source: "Roadmap · the program as written" });
  }
  for (const x of plans) {
    const n = str(x.name); if (!n) continue;
    if (str(x.gate)) facts.push({ says: `${n} goes when: ${str(x.gate)}`, source: `Plans · ${n}'s gate` });
    const m = obj(x.money);
    if (x.money) facts.push({ says: `${n} has an approved money case (version ${m.version ?? "?"}${day(m.approved_at) ? `, approved ${day(m.approved_at)}` : ""}).`, source: `Money · approved version ${m.version ?? "?"}` });
    for (const r of arr(x.research).map(obj)) if (str(r.claim)) facts.push({ says: str(r.claim)!, source: `Research · ${str(r.source_title) ?? str(r.source_url) ?? "a source"}${day(r.retrieved_at) ? `, read ${day(r.retrieved_at)}` : ""}` });
    const next = arr(x.needs).map(obj).filter((nd) => !nd.done_on && str(nd.label)).sort((a, b) => String(a.due_on ?? "9999").localeCompare(String(b.due_on ?? "9999")))[0];
    if (next) facts.push({ says: `Next for ${n}: ${str(next.label)}${day(next.due_on) ? `, by ${day(next.due_on)}` : ""}.`, source: `Needs · ${n}` });
  }
  const names = plans.map((x) => str(x.name)).filter(Boolean) as string[];
  const lead = str(programs[0]?.title);
  const suggested = lead ? `${lead}${names.length ? ` — ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}` : ""}. Here's the plan, as it stands.` : null;
  return { facts, suggested };
}
