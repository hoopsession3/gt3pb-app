"use client";

import { useCallback, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import Sheet, { CloseButton, LeaveButton } from "@/components/Sheet";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "@/components/kit";
import Icon from "@/components/Icon";
import { money } from "@/lib/money";
import { useConfirm } from "@/components/ConfirmSheet";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { governing, cadenceDays, logDone } from "@/lib/upkeep";
import { addDays, localToday } from "@/lib/dates";
import { errorMessage } from "@/lib/errorMessage";
import PersonPick, { usePersonMe, type PersonValue } from "./PersonPick";

// ASSET MAINTENANCE — upkeep log for the gear. Each asset shows its last service and what's due next
// (or overdue); tap to see the full history and log a new service/repair/clean/inspection. Staff-gated
// via RLS. Lives under the gear library. Fetch state via useAsyncData — a failed load is a real error
// now, not an empty "No assets yet" painted before the first request even resolves.
//
// ── DUE MEANS THE LATEST WORD, AND DONE IS ONE TAP (2026-10-04) ──────────────────────────────────
// This panel called an asset due by the EARLIEST next date any of its entries ever set, so once one
// old entry's date had passed the asset read DUE forever, whatever was logged after it — while My
// Day's list (v_obligations) went by the most recent entry. Both read lib/upkeep's governing() now.
// An overdue asset gets "Done today", the same write My Day's row makes; the log sheet starts from
// the job that is due (its kind, its words, its steps) and puts the next date the same distance
// ahead, so an entry no longer leaves the schedule behind by leaving that box empty. And a save
// that fails says so and keeps the sheet — it used to close as if it had worked.

type Asset = { id: string; name: string; make_model: string | null; brand: string | null };
type Log = { id: string; asset_id: string; kind: string; performed_on: string; summary: string; how_to: string | null; next_due_on: string | null; cost_cents: number | null; performed_by: string | null; created_at: string | null };
type Board = { assets: Asset[]; logs: Log[] };

// vocab: asset_maintenance.kind
const KINDS = ["service", "repair", "clean", "inspect", "calibrate", "note"];
const KIND_ICON: Record<string, ReactNode> = { service: <Icon name="wrench" />, repair: <Icon name="wrench" />, clean: "🧽", inspect: <Icon name="search" />, calibrate: "🎚️", note: "📝" };
const fmt = (s: string | null) => s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function AssetMaintenance() {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<{ asset: Asset; from: Log | null } | null>(null);
  const [doing, setDoing] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { assets: [], logs: [] };
    const [a, l] = await Promise.all([
      supabase.from("assets").select("id, name, make_model, brand").order("name"),
      supabase.from("asset_maintenance").select("id, asset_id, kind, performed_on, summary, how_to, next_due_on, cost_cents, performed_by, created_at").order("performed_on", { ascending: false }),
    ]);
    if (a.error) throw new Error(a.error.message);
    if (l.error) throw new Error(l.error.message);
    return { assets: (a.data as Asset[]) ?? [], logs: (l.data as Log[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;

  const delLog = async (id: string) => {
    if (!supabase) return;
    if (!(await confirm({ title: "Delete this maintenance record?", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await supabase.from("asset_maintenance").delete().eq("id", id);
    if (error) { toast(`Couldn't delete it — ${error.message}`, "error"); return; }
    reload();
  };
  // The same write My Day's "Done today" makes (lib/upkeep logDone), from the entry that governs.
  const doneToday = async (a: Asset, due: Log) => {
    if (!supabase || doing) return;
    setDoing(a.id);
    const res = await logDone(supabase, due.id, localToday(), { userId: user?.id ?? null, name: profile?.display_name ?? null });
    setDoing(null);
    if (res.error === null) { toast(res.already ? `${a.name} — already logged for today.` : `${a.name} — ${res.kind} logged for today.`); reload(); }
    else toast(`Couldn't log it — ${res.error}`, "error");
  };

  return (
    <AsyncSection state={board} isEmpty={(data) => data.assets.length === 0} emptyTitle="No assets yet" emptySub="Add gear in the library first." errorTitle="Couldn't load maintenance">
      {(data) => {
        const { logs } = data;
        const tdy = localToday();
        const statusOf = (id: string) => {
          const mine = logs.filter((x) => x.asset_id === id);
          const last = mine[0]?.performed_on ?? null;
          // The entry that governs (lib/upkeep) — v_obligations' rule, so this panel and My Day agree.
          const due = governing(mine);
          const nextDue = due?.next_due_on ?? null;
          const overdue = !!nextDue && nextDue < tdy;
          return { last, nextDue, overdue, due, count: mine.length };
        };
        // sort: overdue first, then soonest-due, then by name
        const sorted = [...data.assets].sort((a, b) => {
          const sa = statusOf(a.id), sb = statusOf(b.id);
          if (sa.overdue !== sb.overdue) return sa.overdue ? -1 : 1;
          if (sa.nextDue && sb.nextDue) return sa.nextDue.localeCompare(sb.nextDue);
          if (sa.nextDue) return -1; if (sb.nextDue) return 1;
          return a.name.localeCompare(b.name);
        });
        const overdueCount = data.assets.filter((a) => statusOf(a.id).overdue).length;

        return (
          <div className="adm-sec">
            <SectionHeader label="Asset maintenance" />
            {overdueCount > 0 && <span className="k-count due ml-2">{overdueCount} due</span>}
            <div className="pnl-note" style={{ marginBottom: 8 }}>Upkeep log for the gear — last service, what&apos;s due next, full history. Tap an asset to log a service or see its record.</div>
            <div className="brew-list">
              {sorted.map((a) => {
                const s = statusOf(a.id); const open = openId === a.id;
                const mine = logs.filter((x) => x.asset_id === a.id);
                return (
                  <div key={a.id} className={`am-card${s.overdue ? " overdue" : ""}`}>
                    <button type="button" className="am-head" onClick={() => setOpenId(open ? null : a.id)} aria-expanded={open}>
                      <span className="am-head-main"><b>{a.name}</b><span>{[a.make_model || a.brand, s.last ? `last ${fmt(s.last)}` : "no log yet", s.nextDue ? `${s.overdue ? "overdue" : "due"} ${fmt(s.nextDue)}` : null].filter(Boolean).join(" · ")}</span></span>
                      {s.overdue ? <span className="am-flag">DUE</span> : s.nextDue ? <span className="am-flag soon">{fmt(s.nextDue)}</span> : null}
                      <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
                    </button>
                    {open && (
                      <div className="am-body">
                        {mine.length === 0 ? <div className="dp-hint" style={{ margin: "4px 0" }}>No maintenance logged yet.</div> : (
                          <div className="am-log">
                            {mine.map((m) => (
                              <div key={m.id} className="am-row">
                                <span className="am-row-k">{KIND_ICON[m.kind] || "•"}</span>
                                <span className="am-row-main">
                                  <b>{m.summary}</b>
                                  <span>{fmt(m.performed_on)}{m.performed_by ? ` · ${m.performed_by}` : ""}{m.cost_cents != null ? ` · ${money(m.cost_cents)}` : ""}{m.next_due_on ? ` · next ${fmt(m.next_due_on)}` : ""}</span>
                                  {m.how_to && (
                                    <details className="am-how"><summary>How to do this</summary>
                                      <div className="am-how-steps">{m.how_to.split("\n").map((s) => s.trim()).filter(Boolean).map((s, i) => <div key={i}>{s}</div>)}</div>
                                    </details>
                                  )}
                                </span>
                                <button type="button" className="am-row-x" onClick={() => delLog(m.id)} aria-label="Delete record"><Icon name="close" /></button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="str-drift-b">
                          {s.overdue && s.due && cadenceDays(s.due) != null && (
                            <button type="button" className="so-move" onClick={() => doneToday(a, s.due!)} disabled={doing === a.id}>{doing === a.id ? "…" : "Done today"}</button>
                          )}
                          <button type="button" className="brew-pack-btn" onClick={() => setLogFor({ asset: a, from: s.due })}>+ Log maintenance</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {logFor && <LogSheet asset={logFor.asset} from={logFor.from} onClose={() => setLogFor(null)} onSaved={() => { setLogFor(null); reload(); }} />}
          </div>
        );
      }}
    </AsyncSection>
  );
}

function LogSheet({ asset, from, onClose, onSaved }: { asset: Asset; from: Log | null; onClose: () => void; onSaved: () => void }) {
  // It starts from the job that is due — its kind, its words, its steps — and puts the next date the
  // same distance ahead of the day it was done. Change the kind and it is a different job: no date.
  const gap = from ? cadenceDays(from) : null;
  const [kind, setKind] = useState(from?.kind ?? "service");
  const [summary, setSummary] = useState(from?.summary ?? "");
  const [performedOn, setPerformedOn] = useState(localToday());
  const [nextDue, setNextDue] = useState(gap ? addDays(localToday(), gap) : "");
  const [nextTouched, setNextTouched] = useState(false);
  const [cost, setCost] = useState("");
  // WHO DID IT starts as you (2026-10-04, the form audit) — "Done today" on this same panel already
  // records your name — picked from the crew, or "Someone else…" for an outside shop.
  const me = usePersonMe();
  const [who, setWho] = useState<PersonValue>(me);
  const [howTo, setHowTo] = useState(from?.how_to ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rhythm = gap && from && kind === from.kind ? gap : null;
  const onDone = (v: string) => { setPerformedOn(v); if (!nextTouched && rhythm && v) setNextDue(addDays(v, rhythm)); };
  const onKind = (k: string) => { setKind(k); if (!nextTouched) setNextDue(gap && from && k === from.kind ? addDays(performedOn || localToday(), gap) : ""); };
  const save = async () => {
    if (!supabase || !summary.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("asset_maintenance").insert({
        asset_id: asset.id, kind, summary: summary.trim(), how_to: howTo.trim() || null, performed_on: performedOn || localToday(),
        next_due_on: nextDue || null, cost_cents: cost ? Math.round(parseFloat(cost) * 100) : null,
        performed_by: who.name.trim() || null, created_by: user?.id ?? null,
      });
      if (error) throw error;
      onSaved();
    } catch (e) {
      setErr(`Couldn't save it — ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} label="Maintenance log"
      dirty={summary.trim() !== (from?.summary ?? "").trim() || howTo.trim() !== (from?.how_to ?? "").trim() || !!cost.trim() || nextTouched}
      header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Log · {asset.name}</b><CloseButton onClick={onClose} /></div>}>
          <div className="ts-chips">
            {KINDS.map((k) => <button key={k} type="button" className={`ts-chip${kind === k ? " on" : ""}`} onClick={() => onKind(k)}>{KIND_ICON[k]} {k}</button>)}
          </div>
          <input className="note-in" style={{ marginTop: 10 }} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was done? e.g. Replaced CO2 regulator, cleaned lines" autoFocus />
          <div className="prod-grid" style={{ marginTop: 10 }}>
            <label className="prod-f"><span>Done on</span><input type="date" value={performedOn} onChange={(e) => onDone(e.target.value)} /></label>
            <label className="prod-f"><span>{rhythm ? `Next due — every ${rhythm} day${rhythm === 1 ? "" : "s"}` : "Next due (optional)"}</span><input type="date" value={nextDue} onChange={(e) => { setNextTouched(true); setNextDue(e.target.value); }} /></label>
            <label className="prod-f"><span>Cost (optional)</span><input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" /></label>
            <label className="prod-f"><span>Done by</span><PersonPick label="Done by" value={who} onChange={setWho} allowNone noneLabel="Not recorded" /></label>
          </div>
          <label className="prod-f" style={{ marginTop: 8 }}><span>How-to / steps (optional — one per line)</span><textarea className="note-in" rows={3} value={howTo} onChange={(e) => setHowTo(e.target.value)} placeholder="Steps to do this next time" /></label>
          {err && <p className="load-failed" role="alert">{err}</p>}
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <LeaveButton className="note-arch" onClick={onClose}>Cancel</LeaveButton>
            <button type="button" className="note-save" onClick={save} disabled={busy || !summary.trim()}>{busy ? "Saving…" : "Log it"}</button>
          </div>
    </Sheet>
  );
}
