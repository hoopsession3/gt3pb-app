"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// TROUBLESHOOT AI — the field-ops first responder. Something's going wrong at the event/stop RIGHT
// NOW: pick the area, say what's happening, and the agent gives the most likely cause, an ordered
// do-this-now fix, and prevention. Then LOG it (to incident_log, against this event/stop) so the
// post-event recap remembers it — and push the prevention items into prep as follow-up tasks.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SYMPTOMS: { key: string; label: string; icon: string }[] = [
  { key: "power", label: "Power / generator", icon: "⚡" },
  { key: "water", label: "Water / hot water", icon: "🚿" },
  { key: "gas", label: "Nitro / keg / gas", icon: "🛢️" },
  { key: "pos", label: "POS / payments", icon: "💳" },
  { key: "stock", label: "Ran out of stock", icon: "📦" },
  { key: "other", label: "Something else", icon: "🔧" },
];

type Cause = { cause: string; likelihood: string; why?: string };
type Prev = { label: string; critical: boolean; _skip?: boolean };
type Diag = { summary: string; causes: Cause[]; steps: string[]; prevention: Prev[] };

export default function TroubleshootAI({ ownerType, ownerId, title, onClose, onLogged }: { ownerType: "event" | "stop"; ownerId: string; title: string; onClose: () => void; onLogged?: () => void }) {
  const ownerKey = ownerType === "event" ? "event_id" : "stop_id";
  const [symptom, setSymptom] = useState("power");
  const [problem, setProblem] = useState("");
  const [blocker, setBlocker] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [done, setDone] = useState<{ added: number } | null>(null);

  const token = async () => (await supabase!.auth.getSession()).data.session?.access_token;
  const post = async (payload: any) => {
    const t = await token();
    const r = await fetch("/api/agents/troubleshoot", { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ [ownerKey]: ownerId, ...payload }) });
    return r.json();
  };

  const diagnose = async () => {
    if (!supabase || busy || !problem.trim()) return;
    setBusy(true); setErr(null);
    const j = await post({ symptom, problem }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't diagnose."); else setDiag({ summary: j.summary || "", causes: j.causes ?? [], steps: j.steps ?? [], prevention: j.prevention ?? [] });
    setBusy(false);
  };
  const logIt = async () => {
    if (!supabase || !diag || busy) return;
    setBusy(true); setErr(null);
    const j = await post({ commit: { symptom, problem, severity: blocker ? "blocker" : "issue", resolved, diagnosis: diag, prevention: diag.prevention } }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!j.ok) setErr(j.error || "Couldn't log it."); else { setDone({ added: j.added ?? 0 }); onLogged?.(); }
    setBusy(false);
  };
  const togglePrev = (i: number) => setDiag((p) => p ? { ...p, prevention: p.prevention.map((x, j) => j === i ? { ...x, _skip: !x._skip } : x) } : p);
  const keep = diag?.prevention.filter((p) => !p._skip).length ?? 0;

  return (
    <div className="qd-scrim" onClick={onClose}>
      <div className="qd-sheet dp" onClick={(e) => e.stopPropagation()}>
        <div className="dp-head">
          <div className="dp-head-l"><div className="dp-eyebrow">🔧 Troubleshoot · field ops</div><div className="dp-title">{title || "On site"} — what&apos;s wrong?</div></div>
          <button type="button" className="qd-x" onClick={onClose}>✕</button>
        </div>

        <div className="dp-body">
          {done ? (
            <div className="eg-done">
              <div className="eg-done-h">✓ Logged to this {ownerType}&apos;s recap{done.added ? ` · ${done.added} prevention task${done.added === 1 ? "" : "s"} added to prep` : ""}</div>
              <div className="dp-hint" style={{ marginTop: 8 }}>It&apos;s saved against this {ownerType} — you&apos;ll see it in the recap so the same thing doesn&apos;t bite twice.</div>
              <div className="prod-actions" style={{ marginTop: 12 }}><span /><button type="button" className="note-save" onClick={onClose}>Done</button></div>
            </div>
          ) : !diag ? (
            <>
              <div className="ts-chips">
                {SYMPTOMS.map((s) => (
                  <button key={s.key} type="button" className={`ts-chip${symptom === s.key ? " on" : ""}`} onClick={() => setSymptom(s.key)}>
                    <span aria-hidden="true">{s.icon}</span>{s.label}
                  </button>
                ))}
              </div>
              <textarea className="note-in" rows={4} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="What's happening? e.g. Turned the water heater on and it tripped the generator breaker — had to cut the AC to get power back." autoFocus disabled={busy} />
              <label className="ts-toggle"><input type="checkbox" checked={blocker} onChange={(e) => setBlocker(e.target.checked)} /> This is stopping service (blocker)</label>
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="note-save" onClick={diagnose} disabled={busy || !problem.trim()}>{busy ? "Diagnosing…" : "🔧 Diagnose"}</button>
              </div>
            </>
          ) : (
            <>
              {diag.summary && <div className="ts-summary">{diag.summary}</div>}

              {diag.steps.length > 0 && (
                <div className="ts-block">
                  <div className="ts-block-h">Do this now</div>
                  <ol className="ts-steps">{diag.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                </div>
              )}

              {diag.causes.length > 0 && (
                <div className="ts-block">
                  <div className="ts-block-h">Likely cause</div>
                  {diag.causes.map((c, i) => (
                    <div key={i} className={`ts-cause ${c.likelihood}`}>
                      <span className="ts-cause-dot" /><b>{c.cause}</b>{c.why ? <span> — {c.why}</span> : null}
                    </div>
                  ))}
                </div>
              )}

              {diag.prevention.length > 0 && (
                <div className="ts-block">
                  <div className="ts-block-h">Stop it happening again {keep > 0 && <span className="ts-keepn">{keep} → prep</span>}</div>
                  {diag.prevention.map((p, i) => (
                    <button key={i} type="button" className={`eg-row${p._skip ? "" : " on"}`} onClick={() => togglePrev(i)} style={{ ["--c" as string]: p.critical ? "#c4453c" : "#e0892b" }}>
                      <span className="eg-ck">{p._skip ? "○" : "✓"}</span>
                      <span className="eg-main"><b>{p.critical ? "⚠️ " : ""}{p.label}</b><span>{p.critical ? "critical" : "important"} · adds to this {ownerType}&apos;s prep</span></span>
                    </button>
                  ))}
                </div>
              )}

              <label className="ts-toggle"><input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} /> Fixed — mark resolved</label>
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={() => setDiag(null)} disabled={busy}>‹ Back</button>
                <button type="button" className="note-save" onClick={logIt} disabled={busy}>{busy ? "Logging…" : keep > 0 ? `Log + add ${keep} to prep` : "Log to recap"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
