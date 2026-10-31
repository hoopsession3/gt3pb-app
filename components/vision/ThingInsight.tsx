"use client";

import { useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { toAsset } from "@/lib/experienceLibrary";
import { toInputs, type Inputs } from "@/lib/visionMoney";
import { thingSays, type LibAsset, type PlanRef } from "@/lib/planFixtures";
import type { Finding } from "@/lib/spatial/evaluate";
import type { Item, Layout } from "@/lib/vision";
import type { Plan } from "@/lib/visionPlans";

// THE ONE LINE (IMS7-E). A thing picked in the Studio says, in one line, the most useful thing GT3's engines already know
// about it — the room's checks (lib/spatial), the library's status and size (lib/experienceLibrary, 0461), and whether
// its cost is in the plans this room belongs to (lib/planFixtures) — through the insight contract, so the same thing is
// said the same way everywhere. Under it, three short facts: does its size match the library, is GT3's approval
// complete, is its cost in the plan. The rest is one tap away, never a panel. Owners and admins (who read the library
// and the money); the crew's details stay as they were.

type Got = { asset: LibAsset | null; blockers: string[]; pending: number; plans: { plan: PlanRef; base: Inputs }[] };

export default function ThingInsight({ item, room, found, plans }: { item: Item; room: Layout; found: readonly Finding[]; plans: readonly Plan[] }) {
  const mine = useMemo(() => plans.filter((p) => p.layout_id === room.id), [plans, room.id]);
  const lib = item.library_id ?? null;
  const load = useCallback(async (): Promise<Got> => {
    if (!supabase) return { asset: null, blockers: [], pending: 0, plans: [] };
    const sb = supabase;
    const [a, b, f, m] = await Promise.all([
      lib ? sb.from("std_materials").select("*").eq("id", lib).maybeSingle() : Promise.resolve({ data: null, error: null }),
      lib ? sb.rpc("std_material_blockers", { p_id: lib }) : Promise.resolve({ data: [], error: null }),
      lib ? sb.from("std_asset_facts").select("id", { count: "exact", head: true }).eq("material_id", lib).eq("review", "pending") : Promise.resolve({ count: 0, error: null }),
      mine.length ? sb.from("vision_plan_money").select("plan_id, scenarios").in("plan_id", mine.map((p) => p.id)) : Promise.resolve({ data: [], error: null }),
    ]);
    const err = a.error ?? b.error ?? f.error ?? m.error;
    if (err) throw new Error(err.message);
    const money = new Map(((m.data ?? []) as { plan_id: string; scenarios?: { base?: Partial<Inputs> } }[]).map((r) => [r.plan_id, toInputs(r.scenarios?.base)]));
    return { asset: a.data ? (toAsset(a.data as Record<string, unknown>) as LibAsset) : null, blockers: (b.data ?? []) as string[],
      pending: (f as { count?: number | null }).count ?? 0, plans: mine.map((p) => ({ plan: { id: p.id, name: p.name, status: p.status }, base: money.get(p.id) ?? toInputs({}) })) };
  }, [lib, mine]);
  const got = useAsyncData(load, [lib, mine.map((p) => p.id).join()]);

  const g = got.data;
  const { top, more, all, facts } = thingSays({ item, room, found, asset: g?.asset ?? null, named: lib, loaded: !!g, blockers: g?.blockers ?? [], pending: g?.pending ?? 0, plans: g?.plans ?? [] });

  // The line already says it isn't approved: the facts don't say it again. An action ends with its own stop.
  const shown = top?.engine === "library" && top.rule === "status" ? facts.filter((f) => !/approved/i.test(f)) : facts;
  const action = top?.action ? top.action.replace(/\.+$/, "") : null;
  if (got.error) return <p className="vz-card-s" role="status">Couldn&apos;t check it against the library and the plan just now.</p>;
  if (!top && !facts.length) return null;
  return (
    <div className="vz-thing flex flex-col gap-1" aria-label={`What GT3 knows about ${item.label || "this"}`}>
      {/* The Studio's own finding styles (one red: what the room's checks already call serious). */}
      {top && <p className={top.level === "stop" ? "vz-issue error" : top.level === "look" ? "vz-issue warn" : "vz-card-s"}><b className="font-sans">{top.words}</b>{action ? <span className="vz-card-s"> {action}.</span> : null}</p>}
      {shown.length > 0 && <p className="vz-card-s">{shown.join(" · ")}</p>}
      {more > 0 && (
        <details>
          <summary className="vz-card-s cursor-pointer py-1">{more} more</summary>
          <ul className="vz-card-s flex flex-col gap-1 pl-4 list-disc">{all.slice(1).map((i) => <li key={i.id}>{i.words}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
