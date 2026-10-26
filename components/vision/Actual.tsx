"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStable } from "@/components/AppProvider";
import { failureWords } from "@/lib/failureWords";
import { haptic } from "@/lib/haptics";
import { localToday } from "@/lib/dates";
import Said from "@/components/Said";
import { CHANNELS, CHANNEL_WORD, readLedger, type Channel } from "@/lib/orderLedger";
import { dollars, type Model } from "@/lib/visionMoney";
import { actualMonths, againstPlan, type ActualMonth } from "@/lib/visionActual";
import type { Plan } from "@/lib/visionPlans";

// ACTUAL AGAINST THE PLAN (R58, 0452). A plan that has opened says when, and which order channel records its sales; its
// real months come from the order ledger and sit beside what the baseline projected — month by month, and to date over
// the complete months. Actual is marked as actual; a month still running says "so far".
const LIMIT = 5000;

export default function ActualPanel({ plan, model, against }: { plan: Plan; model: Model; against: string }) {
  const { toast } = useAppStable();
  const [opened, setOpened] = useState(plan.opened_on ?? "");
  const [channel, setChannel] = useState(plan.actual_channel ?? "");
  const [saved, setSaved] = useState({ opened: plan.opened_on ?? "", channel: plan.actual_channel ?? "" });
  const [busy, setBusy] = useState(false);
  const [months, setMonths] = useState<ActualMonth[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dirty = opened !== saved.opened || channel !== saved.channel;

  const save = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    // arrives-with: 0452
    const { error } = await supabase.from("vision_plans").update({ opened_on: opened || null, actual_channel: channel || null }).eq("id", plan.id);
    setBusy(false);
    if (error) { toast(failureWords(error, "Couldn't save when it opened"), "error"); return; }
    setSaved({ opened, channel }); setMonths(null); haptic("success"); toast("Saved — when it opened and where its sales are.");
  };
  const read = async () => {
    if (!supabase || busy || !saved.opened || !saved.channel) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      const { lines, failed } = await readLedger(supabase, { fromIso: new Date(`${saved.opened}T00:00:00`).toISOString(), limit: LIMIT });
      if (failed.includes(saved.channel as Channel)) { setErr(`Couldn't read ${CHANNEL_WORD[saved.channel as Channel]} — nothing to compare yet.`); return; }
      const mine = lines.filter((l) => l.channel === saved.channel);
      if (mine.length >= LIMIT) setNote(`Read the latest ${LIMIT.toLocaleString("en-US")} orders — older months may be short.`);
      setMonths(actualMonths(lines, saved.channel, saved.opened, localToday()));
    } catch (e) { setErr(failureWords(e as Error, "Couldn't read the sales")); } finally { setBusy(false); }
  };
  const vs = months && model.ok ? againstPlan(months, model) : null;
  return (
    <div className="vz-insp mpanel mb-0 flex flex-col gap-2 p-3.5">
      <b className="font-sans text-subhead">Actual against the plan</b>
      <p className="vz-card-s">Once it has opened: the real months, from the order ledger, beside {against}.</p>
      <div className="prod-grid stack-sm mt-0">
        <label className="prod-f"><span>It opened on</span><input type="date" value={opened} onChange={(e) => setOpened(e.target.value)} /></label>
        <label className="prod-f"><span>Its sales are</span><select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">Not set</option>{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_WORD[c]}</option>)}</select></label>
      </div>
      <div className="vz-row">
        {dirty && <button type="button" className="btn-pri btn-sm" onClick={() => void save()} disabled={busy}>Save</button>}
        {!dirty && saved.opened && saved.channel && <button type="button" className="btn-sec btn-sm" onClick={() => void read()} disabled={busy}>{busy ? "Reading…" : months ? "Read it again" : "Read the actual"}</button>}
      </div>
      <Said as="p" className="vz-card-s">{note ?? ""}</Said>
      {err && <Said as="p" className="vz-issue warn">{err}</Said>}
      {months && !model.ok && <p className="vz-card-s">Set the money to compare against it.</p>}
      {vs && (vs.rows.length === 0 ? <p className="vz-card-s">It hasn&apos;t opened yet.</p> : (
        <>
          <p className="vz-card-s">{vs.toDate.months ? `To date, ${vs.toDate.months} full month${vs.toDate.months === 1 ? "" : "s"}: ${dollars(vs.toDate.actual)} actual against ${dollars(vs.toDate.projected)} projected — ${vs.toDate.diff >= 0 ? "ahead by" : "behind by"} ${dollars(Math.abs(vs.toDate.diff))}${vs.toDate.pct != null ? ` (${vs.toDate.pct >= 0 ? "+" : ""}${vs.toDate.pct.toFixed(0)}%)` : ""}.` : "No full month yet — the first one is still running."}</p>
          <div className="vz-cmp-wrap" role="region" aria-label="Actual against the plan, month by month" tabIndex={0}>
            <table className="vz-cmp vz-num">
              <thead><tr><th scope="col">Month</th><th scope="col">Projected</th><th scope="col">Actual</th><th scope="col">Difference</th></tr></thead>
              <tbody>{vs.rows.map((r) => (
                <tr key={r.m}><th scope="row">{r.m}{r.complete ? "" : " (so far)"}</th><td>{dollars(r.projected)}</td><td>{dollars(r.actual)}</td><td>{r.complete ? `${r.diff >= 0 ? "+" : ""}${dollars(r.diff)}` : "—"}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      ))}
    </div>
  );
}
