// THE INVESTOR CASE, AS READ (R57; split out for the presenter's weight). The shape a plan's case arrives in — from a link
// (vision_shared) or in the room (readCases) — with nothing of the engine in it, so the presenter's first chunk carries
// no money model; the case slide (its own lazy chunk) runs the engine on it (lib/visionCase.figuresOf).
import type { Scenario, Structure } from "./visionMoney";
import type { Bearing, Topic } from "./visionResearch";
import { toRisk, type Risk } from "./visionRisks";

export type CaseFinding = { topic: Topic; claim: string; figure: string | null; source_url: string; source_title: string | null; published: string | null; retrieved_at: string; bearing: Bearing | null };
/** The approved baseline's scenarios as stored (read whole by the engine when computed), its structure and the rest. */
export type PlanCase = { scenarios: Record<Scenario, Record<string, unknown>>; structure: Structure; approvedAt: string | null; research: CaseFinding[]; risks: Risk[] };

type Raw = { baseline?: { scenarios?: Record<string, unknown>; structure?: Structure } | null; approved_at?: string | null } | null | undefined;
/** A baseline as stored (0449's baseline: {scenarios, structure}) and its findings, read whole; null without a baseline. */
export function toCase(raw: Raw, research: readonly Record<string, unknown>[] = [], risks: readonly Record<string, unknown>[] = []): PlanCase | null {
  const b = raw?.baseline;
  if (!b || typeof b !== "object") return null;
  const sc = (b.scenarios ?? {}) as Record<string, unknown>;
  const one = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  return {
    scenarios: { conservative: one(sc.conservative), base: one(sc.base), upside: one(sc.upside) },
    structure: b.structure ?? { kind: "none" }, approvedAt: raw?.approved_at ?? null, risks: risks.map((r) => toRisk(r, "")),
    research: research.filter((r) => typeof r.source_url === "string" && /^https:\/\//.test(r.source_url as string) && typeof r.claim === "string").map((r) => ({
      topic: r.topic as Topic, claim: String(r.claim), figure: (r.figure as string) ?? null, source_url: String(r.source_url),
      source_title: (r.source_title as string) ?? null, published: (r.published as string) ?? null, retrieved_at: String(r.retrieved_at ?? ""), bearing: (["for", "against", "neutral"].includes(r.bearing as string) ? r.bearing : null) as Bearing | null,
    })),
  };
}
