"use client";

import { useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { toAsset, BASIS_WORD } from "@/lib/experienceLibrary";
import { moneyRound } from "@/lib/money";
import { fixtureCosts, type FixtureStatus, type LibAsset } from "@/lib/planFixtures";
import type { FixtureRecon, Inputs } from "@/lib/visionMoney";
import type { Layout } from "@/lib/vision";

// THE ROOM'S FIXTURES, RECONCILED BY A PERSON (IMS7-D). Under "What the money buys": the library assets placed in this
// plan's room, each with the library's price and its basis, and what this scenario says about it — unreviewed, its own
// line, inside the allowance, an extra cost, or not this plan's. Five figures kept apart: the plan's own allowance, what's
// identified, what's unknown, the potential variance, and what's confirmed extra. Nothing is added to the plan's
// number: answering here is saved with the scenario (Save), and the money engine's totals don't read it. Owners and
// admins only — the money panel already is.

const STATUS_WORD: Record<FixtureStatus, string> = {
  unreviewed: "Not reviewed", named_line: "Its own line", in_allowance: "In the allowance", incremental: "Extra cost", excluded: "Not this plan's",
};

export default function FixturesInPlan({ i, set, room }: { i: Inputs; set: (p: Partial<Inputs>) => void; room: Layout | null }) {
  const ids = useMemo(() => [...new Set((room?.items ?? []).map((x) => x.library_id).filter((x): x is string => !!x))].sort(), [room]);
  const load = useCallback(async (): Promise<Map<string, LibAsset>> => {
    if (!supabase || !ids.length) return new Map();
    const { data, error } = await supabase.from("std_materials").select("*").in("id", ids);
    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as Record<string, unknown>[]).map((r) => { const a = toAsset(r); return [a.id, a as LibAsset]; }));
  }, [ids]);
  const got = useAsyncData(load, [ids.join()]);
  if (!room || !ids.length) return null;
  if (got.error) return <p className="vz-card-s" role="status">Couldn&apos;t read the room&apos;s library assets just now — the plan&apos;s figures are unchanged.</p>;
  if (!got.data) return <p className="vz-card-s">Reading the room&apos;s fixtures…</p>;
  const c = fixtureCosts(room.items, got.data, i.uses, i.fixtures ?? {});
  const f = c.figures;
  const answer = (id: string, v: FixtureRecon | "") => {
    const next = { ...(i.fixtures ?? {}) };
    if (v) next[id] = v; else delete next[id];
    set({ fixtures: Object.keys(next).length ? next : undefined });
  };
  const basisLine = (Object.entries(f.identified.byBasis) as [keyof typeof f.identified.byBasis, number][]).filter(([, n]) => n > 0)
    .map(([b, n]) => `${moneyRound(n)} ${b === "unsaid" ? "basis not said" : BASIS_WORD[b]}`).join(" · ");
  return (
    <details className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <summary className="font-sans font-bold text-subhead cursor-pointer py-2">Fixtures in its room · {c.rows.length}{c.notInPlan ? ` · ${c.notInPlan} to review` : ""}</summary>
      <dl className="xl-specs">
        <dt>Allowance</dt><dd>{moneyRound(f.allowance.cents)} — the plan&apos;s Equipment &amp; fixtures{f.allowance.unpriced ? `, ${f.allowance.unpriced} line${f.allowance.unpriced === 1 ? "" : "s"} unpriced` : ""}</dd>
        <dt>Identified</dt><dd>{f.identified.cents ? `${moneyRound(f.identified.cents)}${basisLine ? ` (${basisLine})` : ""}` : "None priced yet"}</dd>
        <dt>Unknown</dt><dd>{f.unknown ? `${f.unknown} without a price${c.needsQuantity ? " or a quantity" : ""} — not counted as $0` : "None"}</dd>
        <dt>Variance</dt><dd>{f.variance == null ? "Nothing to compare yet" : f.variance > 0 ? `May be ${moneyRound(f.variance)} over the allowance` : `Within the allowance by ${moneyRound(-f.variance)}`}</dd>
        <dt>Confirmed extra</dt><dd>{f.incremental ? `${moneyRound(f.incremental)} — beside the plan's number, not in it` : "None"}</dd>
      </dl>
      <ul className="flex flex-col gap-2">
        {c.rows.map((r) => (
          <li key={r.asset.id} className="flex flex-wrap items-end gap-2 justify-between">
            <span className="flex flex-col min-w-0"><b className="font-sans">{r.asset.name}{r.placed > 1 ? ` × ${r.placed}` : ""}</b>
              <span className="vz-card-s">{r.libraryCents != null ? `${moneyRound(r.libraryCents)} · ${r.basis ? BASIS_WORD[r.basis] : "basis not said"}` : r.noFigure === "needs_quantity" ? `Priced per ${r.unit} — needs a quantity` : "No price in the library"}{r.conflict ? " · also marked here; counted once, as its line" : ""}</span></span>
            {r.status === "named_line"
              ? <span className="vz-card-s">{STATUS_WORD.named_line}: {i.uses.filter((u) => r.lines.includes(u.id)).map((u) => u.label || "a line").join(", ")}</span>
              : <label className="prod-f"><span className="sr-only">What this plan says about {r.asset.name}</span>
                  <select value={i.fixtures?.[r.asset.id] ?? ""} onChange={(e) => answer(r.asset.id, e.target.value as FixtureRecon | "")}>
                    <option value="">{STATUS_WORD.unreviewed}</option><option value="in_allowance">{STATUS_WORD.in_allowance}</option>
                    <option value="incremental">{STATUS_WORD.incremental}</option><option value="excluded">{STATUS_WORD.excluded}</option>
                  </select></label>}
          </li>
        ))}
      </ul>
      {c.strayRecon.length > 0 && <p className="vz-card-s">{c.strayRecon.length} answer{c.strayRecon.length === 1 ? " is" : "s are"} kept for assets no longer in the room — not counted.</p>}
      <p className="vz-card-s">Nothing here changes the plan&apos;s figures. Saved with this scenario.</p>
    </details>
  );
}
