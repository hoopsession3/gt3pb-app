"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { StrategyThread } from "./StrategyCollab";

// PIPELINE — the sales funnel (0165). Vendor (the account) × deal (from the owner's catalog,
// gated per vendor type) × rep × stage. The owner articulates what's on the table in the Deal
// catalog; reps can only attach an ACTIVE deal that matches the account's type. Collaboration
// rides the existing engines: per-opportunity threads, rep-assignment pings via the alerts spine.

export const VENDOR_TYPES = ["gym", "corporate", "cafe", "venue", "school", "market", "other"] as const;
const STAGES = [
  { key: "prospect", label: "Prospects" },
  { key: "first_attempt", label: "First attempt" },
  { key: "talking", label: "In conversation" },
  { key: "proposal", label: "Proposal sent" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;
type Stage = (typeof STAGES)[number]["key"];

type Deal = { id: string; title: string; blurb: string | null; vendor_type: string; price_label: string | null; active: boolean; sort: number };
type Vendor = { id: string; name: string; vendor_type: string | null; archived_at?: string | null };
type Opp = {
  id: string; vendor_id: string; deal_id: string | null; rep_id: string | null; stage: Stage;
  value_cents: number | null; next_step: string | null; next_step_at: string | null;
  lost_reason: string | null; created_at: string;
  vendors: { name: string; vendor_type: string | null } | null;
  deals: { title: string } | null;
};
type Staff = { id: string; display_name: string | null };

const money = (c: number | null) => (c == null ? "" : `$${(c / 100).toLocaleString()}`);

export default function PipelinePanel({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [opps, setOpps] = useState<Opp[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);   // expanded opportunity
  const [threadId, setThreadId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [no, setNo] = useState({ vendorId: "", newVendor: "", newType: "gym", dealId: "", repId: "", value: "", nextStep: "" });
  const [nd, setNd] = useState({ title: "", vendor_type: "gym", price_label: "", blurb: "" });

  const load = useCallback(async () => {
    if (!supabase) return;
    const [o, d, v, st] = await Promise.all([
      supabase.from("opportunities").select("id, vendor_id, deal_id, rep_id, stage, value_cents, next_step, next_step_at, lost_reason, created_at, vendors(name, vendor_type), deals(title)").order("created_at", { ascending: false }),
      supabase.from("deals").select("id, title, blurb, vendor_type, price_label, active, sort").order("sort").order("created_at"),
      supabase.from("vendors").select("id, name, vendor_type, archived_at").is("archived_at", null).order("name"),
      supabase.from("profiles").select("id, display_name").neq("role", "member").order("display_name"),
    ]);
    if (o.data) setOpps(o.data as unknown as Opp[]);
    if (d.data) setDeals(d.data as Deal[]);
    if (v.data) setVendors(v.data as Vendor[]);
    if (st.data) setStaff(st.data as Staff[]);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["opportunities", "deals", "vendors"], load);

  const firstName = (uid: string | null) => (staff.find((s) => s.id === uid)?.display_name || "").trim().split(/\s+/)[0] || null;
  const patch = async (id: string, p: Record<string, unknown>) => {
    if (!supabase) return;
    setOpps((prev) => prev.map((o) => (o.id === id ? { ...o, ...p } as Opp : o)));
    const { error } = await supabase.from("opportunities").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); load(); }
  };

  const setStage = async (o: Opp, stage: Stage) => {
    const p: Record<string, unknown> = { stage };
    if (stage === "won") p.won_at = new Date().toISOString();
    if (stage === "lost") { p.lost_at = new Date().toISOString(); const r = typeof window !== "undefined" ? window.prompt("What lost it? (one line, for the record)") : null; if (r?.trim()) p.lost_reason = r.trim(); }
    await patch(o.id, p);
    if (stage === "won") toast("Won — nice. Book it in Plan › Events when dates land.");
  };

  const assignRep = async (o: Opp, uid: string) => {
    await patch(o.id, { rep_id: uid || null });
    if (uid && uid !== user?.id) {
      raiseAlertClient({ severity: "important", category: "booking", title: `Pipeline: ${o.vendors?.name ?? "an account"} is yours`.slice(0, 140), body: o.deals?.title ? `Deal: ${o.deals.title}` : "Pick the deal and make first contact.", link: "/crew?s=pipeline", targetUserId: uid });
    }
  };

  // Reps can only attach an ACTIVE deal that matches the account's vendor type — the owner's gate.
  const dealsFor = (vendorType: string | null | undefined) => deals.filter((d) => d.active && (!vendorType || d.vendor_type === vendorType));

  const addOpp = async () => {
    if (!supabase || !user) return;
    let vendorId = no.vendorId;
    if (!vendorId && no.newVendor.trim()) {
      const { data, error } = await supabase.from("vendors").insert({ name: no.newVendor.trim(), vendor_type: no.newType }).select("id").single();
      if (error) { toast(`Couldn't add the account — ${error.message}`, "error"); return; }
      vendorId = (data as { id: string }).id;
    }
    if (!vendorId) { toast("Pick an account or add a new one", "error"); return; }
    const { error } = await supabase.from("opportunities").insert({
      vendor_id: vendorId, deal_id: no.dealId || null, rep_id: no.repId || null,
      value_cents: no.value ? Math.round(Number(no.value) * 100) : null,
      next_step: no.nextStep.trim() || null, created_by: user.id,
    });
    if (error) { toast(`Couldn't add — ${error.message}`, "error"); return; }
    if (no.repId && no.repId !== user.id) {
      const vn = vendors.find((v) => v.id === vendorId)?.name ?? no.newVendor;
      raiseAlertClient({ severity: "important", category: "booking", title: `Pipeline: ${vn} is yours`.slice(0, 140), body: "New opportunity — make first contact.", link: "/crew?s=pipeline", targetUserId: no.repId });
    }
    setAdding(false); setNo({ vendorId: "", newVendor: "", newType: "gym", dealId: "", repId: "", value: "", nextStep: "" });
    toast("On the board"); load();
  };

  const addDeal = async () => {
    if (!supabase || !nd.title.trim()) return;
    const { error } = await supabase.from("deals").insert({ title: nd.title.trim(), vendor_type: nd.vendor_type, price_label: nd.price_label.trim() || null, blurb: nd.blurb.trim() || null, sort: deals.length });
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setNd({ title: "", vendor_type: "gym", price_label: "", blurb: "" });
    toast("Deal's on the table"); load();
  };
  const toggleDeal = async (d: Deal) => {
    if (!supabase) return;
    await supabase.from("deals").update({ active: !d.active }).eq("id", d.id);
    load();
  };

  const newVendorType = no.vendorId ? (vendors.find((v) => v.id === no.vendorId)?.vendor_type ?? null) : no.newType;
  const openOpps = opps.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const wonValue = opps.filter((o) => o.stage === "won").reduce((s, o) => s + (o.value_cents ?? 0), 0);
  const overdue = (o: Opp) => o.next_step_at && o.next_step_at < new Date().toISOString().slice(0, 10) && o.stage !== "won" && o.stage !== "lost";

  const card = (o: Opp) => (
    <div key={o.id} className={`pipe-card${overdue(o) ? " late" : ""}`}>
      <button type="button" className="pipe-head" onClick={() => setOpenId(openId === o.id ? null : o.id)} aria-expanded={openId === o.id}>
        <span className="pipe-name"><b>{o.vendors?.name ?? "Account"}</b>{o.vendors?.vendor_type && <i className="pipe-type">{o.vendors.vendor_type}</i>}</span>
        <span className="pipe-meta">
          {o.deals?.title ? <span className="pipe-deal">{o.deals.title}</span> : <span className="pipe-deal none">no deal attached</span>}
          {o.value_cents != null && <span className="pipe-val">{money(o.value_cents)}</span>}
          {o.rep_id && <span className="pipe-rep">{firstName(o.rep_id)}</span>}
        </span>
        <span className={`ev-chev${openId === o.id ? " open" : ""}`} aria-hidden="true">›</span>
      </button>
      {(o.next_step || overdue(o)) && openId !== o.id && (
        <div className="pipe-next">{overdue(o) ? "⚠ " : "→ "}{o.next_step ?? "next step overdue"}{o.next_step_at ? ` · ${new Date(`${o.next_step_at}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</div>
      )}
      {openId === o.id && (
        <div className="pipe-body">
          <div className="pipe-grid">
            <label>Stage
              <select value={o.stage} onChange={(e) => setStage(o, e.target.value as Stage)}>
                {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label>Rep
              <select value={o.rep_id ?? ""} onChange={(e) => assignRep(o, e.target.value)}>
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name || "Unnamed"}</option>)}
              </select>
            </label>
            <label>Deal <i>(for {o.vendors?.vendor_type ?? "this type"})</i>
              <select value={o.deal_id ?? ""} onChange={(e) => patch(o.id, { deal_id: e.target.value || null })}>
                <option value="">None yet</option>
                {dealsFor(o.vendors?.vendor_type).map((d) => <option key={d.id} value={d.id}>{d.title}{d.price_label ? ` · ${d.price_label}` : ""}</option>)}
              </select>
            </label>
            <label>Value $
              <input inputMode="decimal" defaultValue={o.value_cents != null ? String(o.value_cents / 100) : ""} onBlur={(e) => patch(o.id, { value_cents: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} placeholder="500" />
            </label>
            <label>Next step
              <input defaultValue={o.next_step ?? ""} onBlur={(e) => (e.target.value.trim() || null) !== o.next_step && patch(o.id, { next_step: e.target.value.trim() || null })} placeholder="Call back Tuesday, send the one-pager…" />
            </label>
            <label>By
              <input type="date" value={o.next_step_at ?? ""} onChange={(e) => patch(o.id, { next_step_at: e.target.value || null })} />
            </label>
          </div>
          {o.stage === "lost" && o.lost_reason && <div className="pipe-lost">Lost: {o.lost_reason}</div>}
          <button type="button" className="st-discuss" onClick={() => setThreadId(threadId === o.id ? null : o.id)} aria-expanded={threadId === o.id}>💬 {threadId === o.id ? "Close" : "Discuss"}</button>
          {threadId === o.id && <StrategyThread k={`opp:${o.id}`} label={`Pipeline: ${o.vendors?.name ?? "opportunity"}`} />}
        </div>
      )}
    </div>
  );

  return (
    <div className="adm-sec">
      <div className="sec">Pipeline{openOpps.length > 0 && <span className="adm-pill">{openOpps.length} open</span>}</div>
      <p className="h-sub" style={{ marginBottom: 12 }}>Every account, its deal, its rep, its next step. Won so far: <b>{money(wonValue) || "$0"}</b>.</p>

      {/* The owner's table — what reps are allowed to offer, per account type. */}
      {isAdmin && (
        <>
          <button type="button" className="prep-collapse" onClick={() => setCatalogOpen((v) => !v)} aria-expanded={catalogOpen}>
            <span className="prep-collapse-l"><b>🗂 Deal catalog · {deals.filter((d) => d.active).length} live</b><span>what reps can offer — per account type; inactive deals disappear from their pickers</span></span>
            <span className={`ev-chev${catalogOpen ? " open" : ""}`}>›</span>
          </button>
          {catalogOpen && (
            <div className="pipe-catalog">
              {VENDOR_TYPES.filter((t) => deals.some((d) => d.vendor_type === t)).map((t) => (
                <div key={t}>
                  <div className="dv-sub" style={{ margin: "8px 0 4px", textTransform: "capitalize" }}>{t}</div>
                  {deals.filter((d) => d.vendor_type === t).map((d) => (
                    <div key={d.id} className={`pipe-dealrow${d.active ? "" : " off"}`}>
                      <span className="pipe-dealrow-t"><b>{d.title}</b>{d.price_label && ` · ${d.price_label}`}{d.blurb && <i> — {d.blurb}</i>}</span>
                      <button type="button" className="lane-pin" onClick={() => toggleDeal(d)}>{d.active ? "Live" : "Off"}</button>
                    </div>
                  ))}
                </div>
              ))}
              <div className="pipe-grid" style={{ marginTop: 10 }}>
                <label>New deal<input value={nd.title} onChange={(e) => setNd({ ...nd, title: e.target.value })} placeholder="Gym fridge partnership" maxLength={80} /></label>
                <label>For
                  <select value={nd.vendor_type} onChange={(e) => setNd({ ...nd, vendor_type: e.target.value })}>
                    {VENDOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label>Terms<input value={nd.price_label} onChange={(e) => setNd({ ...nd, price_label: e.target.value })} placeholder="$500/mo · rev share 20%" maxLength={40} /></label>
                <label>One-liner<input value={nd.blurb} onChange={(e) => setNd({ ...nd, blurb: e.target.value })} placeholder="What the account gets" maxLength={120} /></label>
              </div>
              <button type="button" className="dops-mini" style={{ marginTop: 8 }} onClick={addDeal} disabled={!nd.title.trim()}>Put it on the table</button>
            </div>
          )}
        </>
      )}

      {!loaded && <div className="dops-empty">Loading the board…</div>}
      {loaded && opps.length === 0 && <div className="h-sub">Nothing in the pipeline yet — add the first account below.</div>}

      {STAGES.map((s) => {
        const rows = opps.filter((o) => o.stage === s.key);
        if (rows.length === 0) return null;
        return (
          <div key={s.key} className="pipe-stage">
            <div className="dops-up-h">{s.label} · {rows.length}</div>
            {rows.map(card)}
          </div>
        );
      })}

      {adding ? (
        <div className="goal-new">
          <div className="pipe-grid">
            <label>Account
              <select value={no.vendorId} onChange={(e) => setNo({ ...no, vendorId: e.target.value })}>
                <option value="">＋ New account…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.vendor_type ? ` (${v.vendor_type})` : ""}</option>)}
              </select>
            </label>
            {!no.vendorId && (
              <>
                <label>Name<input value={no.newVendor} onChange={(e) => setNo({ ...no, newVendor: e.target.value })} placeholder="Iron Works Gym" maxLength={80} /></label>
                <label>Type
                  <select value={no.newType} onChange={(e) => setNo({ ...no, newType: e.target.value })}>
                    {VENDOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </>
            )}
            <label>Deal <i>({newVendorType ?? "pick a type"})</i>
              <select value={no.dealId} onChange={(e) => setNo({ ...no, dealId: e.target.value })}>
                <option value="">Pick later</option>
                {dealsFor(newVendorType).map((d) => <option key={d.id} value={d.id}>{d.title}{d.price_label ? ` · ${d.price_label}` : ""}</option>)}
              </select>
            </label>
            <label>Rep
              <select value={no.repId} onChange={(e) => setNo({ ...no, repId: e.target.value })}>
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name || "Unnamed"}</option>)}
              </select>
            </label>
            <label>Value $<input inputMode="decimal" value={no.value} onChange={(e) => setNo({ ...no, value: e.target.value })} placeholder="500" /></label>
            <label>First step<input value={no.nextStep} onChange={(e) => setNo({ ...no, nextStep: e.target.value })} placeholder="Walk in, ask for the manager" maxLength={120} /></label>
          </div>
          <div className="st-log-btns">
            <button type="button" className="dops-mini" onClick={addOpp}>Add to the pipeline</button>
            <button type="button" className="st-discuss" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="dl-card st-build" onClick={() => setAdding(true)}>
          <b>＋ New opportunity</b>
          <span>An account, a deal from the table, a rep, a first step.</span>
        </button>
      )}
    </div>
  );
}
