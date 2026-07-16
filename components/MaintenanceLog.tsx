"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";

// MAINTENANCE & AUDITS (Settings) — the owner's record of every audit run on the app: what kind, when,
// the prompt used, the result/score, a summary, findings, and a link to the artifact. Opens with a
// health strip (last-run per type · overdue-by-cadence · average score), then a logger, then the
// history. Reads maintenance_log (0198). Admin/owner write; staff read. Fetch state via useAsyncData —
// a failed load is a real error now, not a silent "0 audits logged".
type Audit = {
  id: string; kind: string; title: string; status: "pass" | "warn" | "fail" | "info";
  score: number | null; summary: string | null; prompt: string | null; findings: string | null;
  artifact_url: string | null; ran_on: string; cadence: "once" | "weekly" | "monthly" | "quarterly"; created_at: string;
};
type Draft = Omit<Audit, "id" | "created_at"> & { id?: string };

const KINDS: [string, string][] = [
  ["interop", "Interoperability"], ["a11y", "Accessibility"], ["performance", "Performance"],
  ["security", "Security"], ["cohesion", "UI cohesion"], ["dependency", "Dependencies"],
  ["data", "Data / DB"], ["custom", "Other"],
];
const KIND_LABEL = Object.fromEntries(KINDS);
const STATUSES: ["pass" | "warn" | "fail" | "info", string][] = [["pass", "Pass"], ["warn", "Needs work"], ["fail", "Fail"], ["info", "Info"]];
const CADENCES: [Draft["cadence"], string][] = [["once", "One-off"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"]];
const CADENCE_DAYS: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 90 };

const today = () => new Date().toISOString().slice(0, 10);
const BLANK: Draft = { kind: "custom", title: "", status: "info", score: null, summary: "", prompt: "", findings: "", artifact_url: "", ran_on: today(), cadence: "once" };

function daysAgo(iso: string): string {
  const d = Math.round((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : d < 365 ? `${Math.round(d / 30)}mo ago` : `${Math.round(d / 365)}y ago`;
}
function nextDue(a: Audit): { due: string; overdue: boolean } | null {
  const days = CADENCE_DAYS[a.cadence];
  if (!days) return null;
  const due = new Date(`${a.ran_on}T12:00:00`); due.setDate(due.getDate() + days);
  return { due: due.toISOString().slice(0, 10), overdue: due.getTime() < Date.now() };
}

export default function MaintenanceLog() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [d, setD] = useState<Draft>(BLANK);
  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const loader = useCallback(async (): Promise<Audit[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("maintenance_log").select("*").order("ran_on", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as Audit[]) ?? [];
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const editRow = (a: Audit) => { setD({ ...a, summary: a.summary ?? "", prompt: a.prompt ?? "", findings: a.findings ?? "", artifact_url: a.artifact_url ?? "" }); setComposing(true); };

  const save = async () => {
    if (!supabase || saving) return;
    if (!d.title.trim()) { toast("Give the audit a title", "error"); return; }
    setSaving(true);
    const payload = {
      kind: d.kind, title: d.title.trim().slice(0, 160), status: d.status,
      score: d.score === null || Number.isNaN(d.score) ? null : Math.max(0, Math.min(10, Number(d.score))),
      summary: d.summary?.trim() || null, prompt: d.prompt?.trim() || null, findings: d.findings?.trim() || null,
      artifact_url: d.artifact_url?.trim() || null, ran_on: d.ran_on || today(), cadence: d.cadence,
    };
    const { error } = d.id
      ? await supabase.from("maintenance_log").update(payload).eq("id", d.id)
      : await supabase.from("maintenance_log").insert({ ...payload, created_by: user?.id ?? null });
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    toast(d.id ? "Audit updated" : "Audit logged");
    setD(BLANK); setComposing(false); reload();
  };
  const del = async (a: Audit) => { if (!supabase || (typeof window !== "undefined" && !window.confirm(`Delete "${a.title}"?`))) return; await supabase.from("maintenance_log").delete().eq("id", a.id); reload(); };

  const stats = useMemo(() => {
    const r = board.data ?? [];
    const scored = r.filter((x) => x.score != null);
    const avg = scored.length ? Math.round((scored.reduce((s, x) => s + (x.score || 0), 0) / scored.length) * 10) / 10 : null;
    const overdue = r.filter((x) => nextDue(x)?.overdue).length;
    const lastRun = r.length ? r[0].ran_on : null;
    return { total: r.length, avg, overdue, lastRun };
  }, [board.data]);

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the audit log" emptyTitle="Nothing here yet">
      {(rows) => {
        const shown = rows.filter((a) => filter === "all" || a.kind === filter);
        return (
          <div className="mnt">
            <div className="mnt-kpis">
              <div className="mnt-kpi"><span className="mnt-k-v">{stats.total}</span><span className="mnt-k-l">audits logged</span></div>
              <div className="mnt-kpi"><span className="mnt-k-v">{stats.avg ?? "—"}{stats.avg != null && <small>/10</small>}</span><span className="mnt-k-l">avg score</span></div>
              <div className={`mnt-kpi${stats.overdue ? " warn" : ""}`}><span className="mnt-k-v">{stats.overdue}</span><span className="mnt-k-l">overdue</span></div>
              <div className="mnt-kpi"><span className="mnt-k-v">{stats.lastRun ? daysAgo(stats.lastRun) : "—"}</span><span className="mnt-k-l">last run</span></div>
            </div>

            {!composing ? (
              <button type="button" className="mnt-new" onClick={() => { setD(BLANK); setComposing(true); }}>+ Log an audit</button>
            ) : (
              <div className="mnt-form">
                <div className="prod-grid">
                  <label className="prod-f"><span>Type</span><select value={d.kind} onChange={(e) => set("kind", e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <label className="prod-f"><span>Result</span><select value={d.status} onChange={(e) => set("status", e.target.value as Draft["status"])}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                </div>
                <label className="prod-f" style={{ marginTop: 8 }}><span>Title</span><input value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={160} placeholder="e.g. Lighthouse performance (mobile, top 5)" /></label>
                <div className="prod-grid" style={{ marginTop: 8 }}>
                  <label className="prod-f"><span>Score (0–10, optional)</span><input type="number" min={0} max={10} value={d.score ?? ""} onChange={(e) => set("score", e.target.value === "" ? null : Number(e.target.value))} placeholder="—" /></label>
                  <label className="prod-f"><span>Date run</span><input type="date" value={d.ran_on} onChange={(e) => set("ran_on", e.target.value)} /></label>
                  <label className="prod-f"><span>Re-run</span><select value={d.cadence} onChange={(e) => set("cadence", e.target.value as Draft["cadence"])}>{CADENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                </div>
                <label className="prod-f" style={{ marginTop: 8 }}><span>Summary</span><textarea className="ev-input ev-area" rows={2} value={d.summary ?? ""} onChange={(e) => set("summary", e.target.value)} placeholder="One or two lines: what it found." /></label>
                <label className="prod-f" style={{ marginTop: 8 }}><span>Prompt / how it was run (optional)</span><textarea className="ev-input ev-area" rows={2} value={d.prompt ?? ""} onChange={(e) => set("prompt", e.target.value)} placeholder="The exact audit prompt or command." /></label>
                <label className="prod-f" style={{ marginTop: 8 }}><span>Findings (optional)</span><textarea className="ev-input ev-area" rows={3} value={d.findings ?? ""} onChange={(e) => set("findings", e.target.value)} placeholder="Detail / the ranked list." /></label>
                <label className="prod-f" style={{ marginTop: 8 }}><span>Artifact link (optional)</span><input value={d.artifact_url ?? ""} onChange={(e) => set("artifact_url", e.target.value)} placeholder="https://…" /></label>
                <div className="prod-actions" style={{ marginTop: 12 }}>
                  <button type="button" className="note-arch" onClick={() => { setD(BLANK); setComposing(false); }} disabled={saving}>Cancel</button>
                  <button type="button" className="note-save" onClick={save} disabled={saving || !d.title.trim()}>{saving ? "Saving…" : d.id ? "Update" : "Log it"}</button>
                </div>
              </div>
            )}

            {rows.length > 0 ? (
              <>
                <div className="mnt-filters">
                  <button type="button" className={`mnt-chip${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>All</button>
                  {KINDS.filter(([k]) => rows.some((r) => r.kind === k)).map(([k, l]) => (
                    <button key={k} type="button" className={`mnt-chip${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>{l}</button>
                  ))}
                </div>
                <div className="mnt-list">
                  {shown.map((a) => {
                    const nd = nextDue(a); const isOpen = open === a.id;
                    return (
                      <div key={a.id} className={`mnt-row st-${a.status}${isOpen ? " open" : ""}`}>
                        <button type="button" className="mnt-row-h" onClick={() => setOpen(isOpen ? null : a.id)} aria-expanded={isOpen}>
                          <span className={`mnt-dot st-${a.status}`} />
                          <span className="mnt-row-x">
                            <b>{a.title}</b>
                            <span className="mnt-row-sub">{KIND_LABEL[a.kind] ?? a.kind} · {daysAgo(a.ran_on)}{a.cadence !== "once" ? ` · ${a.cadence}` : ""}{nd?.overdue ? <> · <Icon name="warning" /> overdue</> : ""}</span>
                          </span>
                          {a.score != null && <span className={`mnt-score st-${a.status}`}>{a.score}<small>/10</small></span>}
                          <span className={`mnt-chev${isOpen ? " open" : ""}`} aria-hidden>›</span>
                        </button>
                        {isOpen && (
                          <div className="mnt-body">
                            {a.summary && <p className="mnt-summary">{a.summary}</p>}
                            {a.findings && <div className="mnt-field"><span>Findings</span><p>{a.findings}</p></div>}
                            {a.prompt && <div className="mnt-field"><span>Prompt</span><p className="mnt-mono">{a.prompt}</p></div>}
                            <div className="mnt-meta">
                              {nd && <span>Next due {nd.due}{nd.overdue ? " (overdue)" : ""}</span>}
                              {a.artifact_url && <a href={a.artifact_url} target="_blank" rel="noreferrer">Open artifact <Icon name="externalLink" /></a>}
                              <button type="button" className="mnt-edit" onClick={() => editRow(a)}>Edit</button>
                              <button type="button" className="mnt-del" onClick={() => del(a)}>Delete</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <EmptyState title="Nothing here yet" sub="Log your first audit above to start the record." />
            )}
          </div>
        );
      }}
    </AsyncSection>
  );
}
