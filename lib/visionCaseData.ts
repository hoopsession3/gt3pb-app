// THE INVESTOR CASE, AS READ (R57; split out for the presenter's weight). The shape a plan's case arrives in — from a link
// (vision_shared) or in the room (readCases) — with nothing of the engine in it, so the presenter's first chunk carries
// no money model; the case slide (its own lazy chunk) runs the engine on it (lib/visionCase.figuresOf).
import type { Scenario, Structure } from "./visionMoney";
import type { Bearing, Topic } from "./visionResearch";
import { toRisk, type Risk } from "./visionRisks";

export type CaseFinding = { topic: Topic; claim: string; figure: string | null; source_url: string; source_title: string | null; published: string | null; retrieved_at: string; bearing: Bearing | null };
/** The approved baseline's scenarios as stored (read whole by the engine when computed), its structure and the rest. */
export type PlanCase = { scenarios: Record<Scenario, Record<string, unknown>>; structure: Structure; approvedAt: string | null;
  /** BP2a (0458): which approved version a link shows — null in the room, where the latest is read. */
  version?: number | null; research: CaseFinding[]; risks: Risk[];
  /** IP1.3: the owner's acknowledgements of open readiness blockers, approved with the baseline (0449's guard: owners only). */
  acknowledged: Acknowledgement[] };
/** An acknowledgement as stored in the baseline (shape kept here so this file stays free of the score). */
export type Acknowledgement = { key: string; note: string; at?: string | null };
/** The acknowledgements in a stored baseline, read defensively: a key and a written reason, or nothing. */
export function acksOf(raw: unknown): Acknowledgement[] {
  return Array.isArray(raw) ? raw.filter((a) => a && typeof a === "object" && typeof (a as Acknowledgement).key === "string" && typeof (a as Acknowledgement).note === "string" && (a as Acknowledgement).note.trim())
    .map((a) => ({ key: (a as Acknowledgement).key, note: (a as Acknowledgement).note.trim().slice(0, 500), at: typeof (a as Acknowledgement).at === "string" ? (a as Acknowledgement).at : null })).slice(0, 20) : [];
}

type Raw = { baseline?: { scenarios?: Record<string, unknown>; structure?: Structure; acknowledged?: unknown } | null; approved_at?: string | null; version?: number | null } | null | undefined;
/** A baseline as stored (0449's baseline: {scenarios, structure}) and its findings, read whole; null without a baseline. */
export function toCase(raw: Raw, research: readonly Record<string, unknown>[] = [], risks: readonly Record<string, unknown>[] = []): PlanCase | null {
  const b = raw?.baseline;
  if (!b || typeof b !== "object") return null;
  const sc = (b.scenarios ?? {}) as Record<string, unknown>;
  const one = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  return {
    scenarios: { conservative: one(sc.conservative), base: one(sc.base), upside: one(sc.upside) },
    structure: b.structure ?? { kind: "none" }, approvedAt: raw?.approved_at ?? null, version: typeof raw?.version === "number" ? raw.version : null, risks: risks.map((r) => toRisk(r, "")), acknowledged: acksOf(b.acknowledged),
    research: research.filter((r) => typeof r.source_url === "string" && /^https:\/\//.test(r.source_url as string) && typeof r.claim === "string").map((r) => ({
      topic: r.topic as Topic, claim: String(r.claim), figure: (r.figure as string) ?? null, source_url: String(r.source_url),
      source_title: (r.source_title as string) ?? null, published: (r.published as string) ?? null, retrieved_at: String(r.retrieved_at ?? ""), bearing: (["for", "against", "neutral"].includes(r.bearing as string) ? r.bearing : null) as Bearing | null,
    })),
  };
}
