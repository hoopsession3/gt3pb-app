"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { failureWords } from "@/lib/failureWords";
import { NO_ROOM, toInputs, type Inputs, type Structure } from "@/lib/visionMoney";
import { ASSUMED_SERVE_SEC, capacity } from "@/lib/visionRoom";
import { advise, type PlanState } from "@/lib/visionAdvisor";
import { needsProgress, waitingOn, type Dep, type Need, type Plan } from "@/lib/visionPlans";
import { toRisk, type Risk } from "@/lib/visionRisks";
import type { Research } from "@/lib/visionResearch";
import type { Layout } from "@/lib/vision";

// WHAT TO DO NEXT (R61). The advisor across every plan with money: a short ranked list — stops first — each an action,
// the plan, and why in that plan's own numbers. Owners and admins (the money is theirs). Tap a line to open the plan.
type Row = { plan_id: string; scenarios: Record<string, unknown>; structure: Structure; baseline: { scenarios?: Record<string, unknown>; structure?: Structure } | null };
type RRow = Pick<Research, "plan_id" | "topic" | "status" | "bearing" | "retrieved_at">;
type Loaded = { money: Row[]; research: RRow[]; risks: Risk[] } | "not-yet";

export default function Advisor({ plans, needs, deps, layouts, onOpen }: { plans: Plan[]; needs: Need[]; deps: Dep[]; layouts: Layout[]; onOpen: (planId: string) => void }) {
  const load = useCallback(async (): Promise<Loaded> => {
    if (!supabase) return "not-yet";
    const m = await supabase.from("vision_plan_money").select("plan_id, scenarios, structure, baseline");
    if (m.error) throw new Error(m.error.message);
    // arrives-with: 0450
    const r = await supabase.from("vision_research").select("plan_id, topic, status, bearing, retrieved_at");
    // arrives-with: 0454
    const k = await supabase.from("vision_plan_risks").select("*");
    return { money: (m.data ?? []) as unknown as Row[], research: r.error ? [] : ((r.data ?? []) as unknown as RRow[]), risks: k.error ? [] : ((k.data ?? []) as Record<string, unknown>[]).map((x) => toRisk(x)) };
  }, []);
  const state = useAsyncData(load, []);
  const [all, setAll] = useState(false);
  const advice = useMemo(() => {
    if (!state.data || state.data === "not-yet") return [];
    const d = state.data;
    const states: PlanState[] = d.money.flatMap((row) => {
      const plan = plans.find((p) => p.id === row.plan_id);
      if (!plan) return [];
      const src = row.baseline?.scenarios ? row.baseline : row;
      const i: Inputs = toInputs((src.scenarios as Record<string, unknown>)?.base as Partial<Inputs>);
      const room = layouts.find((l) => l.id === plan.layout_id) ?? null;
      const mine = needs.filter((n) => n.plan_id === plan.id);
      return [{ plan, i, structure: (src.structure ?? { kind: "none" }) as Structure, ctx: room ? { counterPerHour: capacity(room, i.serveSec ?? ASSUMED_SERVE_SEC).counterPerHour } : NO_ROOM,
        research: d.research.filter((x) => x.plan_id === plan.id), risks: d.risks.filter((x) => x.plan_id === plan.id), status: plan.status,
        waitingOn: waitingOn(plan, plans, deps).map((w) => w.name), progress: { needs: { done: needsProgress(mine).done, all: mine.length }, waitingOn: waitingOn(plan, plans, deps).map((w) => w.name) } }];
    });
    return advise(states);
  }, [state.data, plans, needs, deps, layouts]);
  if (state.data === "not-yet" || (state.data && advice.length === 0)) return null;
  if (!state.data) return state.status === "error" ? <p className="load-failed">{failureWords(state.error as Error, "Couldn't read the plans' money")}</p> : null;
  const shown = all ? advice : advice.slice(0, 4);
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <b className="font-sans text-subhead">What to do next</b>
      <p className="vz-card-s">From each plan&apos;s own numbers — the approved baseline where there is one. What would mislead a decision comes first.</p>
      {shown.map((a, k) => (
        <button key={k} type="button" className="vz-advice" onClick={() => onOpen(a.planId)}>
          <span className={a.level === "stop" ? "k-tag warn" : "k-tag"}>{a.level === "stop" ? "First" : "Next"}</span>
          <span><b>{a.plan}:</b> {a.action}</span>
          <em>{a.words}</em>
        </button>
      ))}
      {advice.length > 4 && <button type="button" className="btn-ter self-start" onClick={() => setAll((v) => !v)}>{all ? "Fewer" : `All ${advice.length}`}</button>}
    </div>
  );
}
