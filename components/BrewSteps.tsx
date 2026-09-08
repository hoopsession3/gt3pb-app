"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Sheet from "@/components/Sheet";
import Icon from "@/components/Icon";

// BREW STEPS — the sheet you actually brew from.
//
// The method has existed on every recipe since 0079 and was rendered in exactly one place: the
// PLANNING result, as a flat <ol> before the batch existed. Once the batch was real and it was time
// to brew, there was Start, Adjust, Batch log and Bottle loadout — and nowhere that said what to do.
//
// So this is not a restyle of an existing screen; it is the screen that was missing. What it adds
// over an <ol>: this run's real quantities beside the steps, a tick that persists (0300), and a live
// countdown on the extraction. A cold extraction runs twelve to twenty hours and whoever starts it
// is often not whoever finishes it, so "where did we get to" has to survive a phone going to sleep.

type Step = { id: string; step_no: number; step_text: string; done_at: string | null };
type Ing = { name: string; qty: number | string; unit?: string | null };
type Batch = {
  id: string; recipe_name: string | null; batch_gal: number; status: string;
  ready_at: string | null; vessel: string | null; scaled: Ing[] | null;
};

// A step that is a wait rather than an action — the one the countdown belongs on.
const isWait = (t: string) => /extract|steep|brew for|hold|rest|bloom/i.test(t);

const remaining = (target: string | null, now: number) => {
  if (!target) return null;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return "ready";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m left` : `${m}m left`;
};

export default function BrewSteps({ batch, onClose, onChanged }: { batch: Batch; onClose: () => void; onChanged?: () => void }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("ensure_batch_steps", { p_batch_id: batch.id });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSteps(((data as Step[]) ?? []).slice().sort((a, b) => a.step_no - b.step_no));
  }, [batch.id]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (s: Step) => {
    if (!supabase) return;
    const next = !s.done_at;
    // Optimistic: a tap on a wet phone in a prep kitchen should not wait on a round-trip.
    setSteps((xs) => xs.map((x) => (x.id === s.id ? { ...x, done_at: next ? new Date().toISOString() : null } : x)));
    const { error } = await supabase.rpc("set_batch_step", { p_batch_id: batch.id, p_step_no: s.step_no, p_done: next });
    if (error) {
      setSteps((xs) => xs.map((x) => (x.id === s.id ? { ...x, done_at: s.done_at } : x)));
      setErr(error.message);
      return;
    }
    onChanged?.();
  };

  const ings = Array.isArray(batch.scaled) ? batch.scaled.filter((i) => i?.name) : [];
  const doneCount = steps.filter((s) => s.done_at).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <Sheet
      open
      onClose={onClose}
      label="Brew steps"
      header={
        <div style={{ display: "flex", alignItems: "center" }}>
          <div className="dp-head-l">
            <div className="dp-eyebrow"><Icon name="clock" /> Brew · step by step</div>
            <div className="dp-title">{batch.recipe_name || "Batch"} · {batch.batch_gal} gal</div>
          </div>
          <button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose} title="Close"><Icon name="close" /></button>
        </div>
      }
    >
      <div className="bs">
        {err && <div className="brew-oprow warn" role="alert">{err}<button type="button" onClick={() => setErr(null)}>Dismiss</button></div>}

        {steps.length > 0 && (
          <div className="bs-prog">
            <span className="bs-prog-t">{doneCount} of {steps.length} done</span>
            <span className="bs-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
          </div>
        )}

        {/* What you need, for THIS run — the scaled list, not the recipe's reference quantities. */}
        {ings.length > 0 && (
          <section className="bs-need">
            <h3>What you need{batch.vessel ? ` · ${batch.vessel}` : ""}</h3>
            <ul>
              {ings.map((i, n) => (
                <li key={n}><b>{i.qty}{i.unit ? ` ${i.unit}` : ""}</b><span>{i.name}</span></li>
              ))}
            </ul>
          </section>
        )}

        {loading && <div className="h-sub">Loading the method…</div>}
        {!loading && steps.length === 0 && (
          <div className="h-sub">This batch has no method on it — its recipe has none, or the recipe is gone.</div>
        )}

        <ol className="bs-steps">
          {steps.map((s) => {
            const done = !!s.done_at;
            const wait = isWait(s.step_text);
            const left = wait ? remaining(batch.ready_at, now) : null;
            return (
              <li key={s.id} className={`bs-step${done ? " done" : ""}`}>
                <button type="button" onClick={() => toggle(s)}
                        aria-pressed={done}
                        aria-label={`${done ? "Undo" : "Done"}: step ${s.step_no}, ${s.step_text}`}>
                  <span className="bs-n" aria-hidden="true">{done ? <Icon name="check" /> : s.step_no}</span>
                  <span className="bs-t">
                    {s.step_text}
                    {left && <i className={`bs-timer${left === "ready" ? " ready" : ""}`}>{left === "ready" ? "Extraction complete" : left}</i>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </Sheet>
  );
}
