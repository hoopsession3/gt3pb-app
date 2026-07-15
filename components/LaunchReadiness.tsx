"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import InlineCreate from "./InlineCreate";
import { SectionHeader } from "@/components/kit";

// LAUNCH READINESS — the go/no-go board. Distinct from milestone progress ("are the deliverables
// done?"): this is the gating checklist ("is it actually safe to launch?"). Each critical check is
// ready / at-risk / blocked; the verdict rolls up (any critical blocked → NO-GO, any at-risk → AT
// RISK, all ready → GO). Reads readiness_checks (0207) for the nearest launch initiative. Admins tap
// a row to cycle its status. General — any initiative with checks gets a board.
type Init = { id: string; title: string; target_date: string | null; emoji: string | null };
type Status = "ready" | "at_risk" | "blocked";
type Check = { id: string; initiative_id: string; label: string; category: string | null; status: Status; critical: boolean; note: string | null; sort: number };

const daysTo = (iso: string) => Math.round((new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 864e5);
const NEXT: Record<Status, Status> = { ready: "at_risk", at_risk: "blocked", blocked: "ready" };
const ST: Record<Status, { t: string; c: string }> = {
  ready: { t: "Ready", c: "rdy-ok" }, at_risk: { t: "At risk", c: "rdy-warn" }, blocked: { t: "Blocked", c: "rdy-bad" },
};

export default function LaunchReadiness() {
  const { profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = !!profile?.is_admin;
  const [inits, setInits] = useState<Init[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safe = async (p: PromiseLike<{ data: any[] | null }>): Promise<any[]> => { try { return (await p).data ?? []; } catch { return []; } };
    const [ini, chk] = await Promise.all([
      safe(supabase.from("initiatives").select("id, title, target_date, emoji").neq("status", "done")),
      safe(supabase.from("readiness_checks").select("id, initiative_id, label, category, status, critical, note, sort").order("sort")),
    ]);
    setInits(ini as Init[]); setChecks(chk as Check[]); setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["readiness_checks", "initiatives"], load);

  // The launch we're gating = the initiative that has checks, with the soonest target_date.
  const launch = useMemo(() => {
    const withChecks = inits.filter((i) => checks.some((c) => c.initiative_id === i.id));
    const pool = withChecks.length ? withChecks : inits;
    return pool.slice().sort((a, b) => (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"))[0] ?? null;
  }, [inits, checks]);

  const rows = useMemo(() => checks.filter((c) => launch && c.initiative_id === launch.id).slice().sort((a, b) => a.sort - b.sort), [checks, launch]);

  const cycle = async (c: Check) => {
    if (!supabase || !isAdmin) return;
    const ns = NEXT[c.status];
    setChecks((p) => p.map((x) => (x.id === c.id ? { ...x, status: ns } : x)));
    await supabase.from("readiness_checks").update({ status: ns, updated_at: new Date().toISOString() }).eq("id", c.id);
  };
  const addCheck = async (label: string) => {
    if (!supabase || !launch) return;
    const { error } = await supabase.from("readiness_checks").insert({ initiative_id: launch.id, label, sort: rows.length * 10 + 10 });
    if (error) toast(`Couldn't add — ${error.message}`, "error"); else load();
  };

  if (!loaded || !launch) return null;
  const crit = rows.filter((r) => r.critical);
  const verdict: "go" | "at-risk" | "no-go" | "none" =
    crit.some((r) => r.status === "blocked") ? "no-go" : crit.some((r) => r.status === "at_risk") ? "at-risk" : crit.length ? "go" : "none";
  const V = { go: { t: "GO", c: "rdy-ok" }, "at-risk": { t: "AT RISK", c: "rdy-warn" }, "no-go": { t: "NO-GO", c: "rdy-bad" }, none: { t: "—", c: "" } }[verdict];
  const readyN = crit.filter((r) => r.status === "ready").length;
  const cd = launch.target_date != null ? daysTo(launch.target_date) : null;

  return (
    <div className="rdy">
      <SectionHeader label="Launch readiness" annotation={`${launch.emoji ? `${launch.emoji} ` : ""}${launch.title}`} />
      <div className="rdy-verdict" style={{ alignItems: "center", marginBottom: 10 }}>
        <span className={`k-chip rdy-st ${V.c}`} style={{ fontSize: 15, letterSpacing: ".04em", cursor: "default" }}>{V.t}</span>
        <div className="rdy-verdict-sub">{readyN}/{crit.length} critical ready{cd != null ? ` · ${cd > 0 ? `${cd}d out` : cd === 0 ? "today" : `${-cd}d past`}` : ""}</div>
      </div>
      <div className="rdy-list">
        {rows.map((c) => (
          <button key={c.id} type="button" className="rdy-check" onClick={() => cycle(c)} disabled={!isAdmin} title={isAdmin ? "Tap to change status" : undefined}>
            <span className="rdy-label">{c.label}{!c.critical && <span className="rdy-opt">optional</span>}</span>
            {c.category && <span className="rdy-cat">{c.category}</span>}
            <span className={`k-chip rdy-st ${ST[c.status].c}`} style={{ cursor: "inherit" }}>{ST[c.status].t}</span>
          </button>
        ))}
      </div>
      {isAdmin && <InlineCreate label="+ Readiness check" placeholder="What has to be true to launch?" className="cmd-add" onCreate={addCheck} />}
    </div>
  );
}
