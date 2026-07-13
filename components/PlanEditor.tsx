"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { isBlank } from "@/lib/formGuard";
import { supabase } from "@/lib/supabase";

// MEMBERSHIP PLAN editor — manage subscription tiers in-app (was SQL-only). CRUD on subscription_plans.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Plan = { key: string; label: string; price_cents: number; period_days: number; active: boolean };

export default function PlanEditor() {
  const { toast } = useApp();
  const [plans, setPlans] = useState<Plan[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("subscription_plans").select("*").order("price_cents");
    setPlans((data as Plan[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!supabase) return;
    const key = prompt("Plan key (lowercase id, e.g. 'pro')")?.trim().toLowerCase();
    if (!key) return;
    const { error } = await supabase.from("subscription_plans").insert({ key, label: "", price_cents: 0, period_days: 14, active: false });
    if (error) toast(`Error: ${error.message}`, "error"); else load();
  };

  return (
    <div className="adm-sec">
      <div className="studio-top">
        <div className="sec" style={{ margin: 0 }}>Membership plans</div>
        <button type="button" className="rdy-run" onClick={add}>+ New plan</button>
      </div>
      <div className="h-sub">The tiers members can subscribe to — name, price, billing period, on/off.</div>
      {plans.map((p) => <PlanRow key={p.key} p={p} onSaved={load} toast={toast} />)}
      {plans.length === 0 && <div className="h-sub" style={{ marginTop: 12 }}>No plans yet — add one.</div>}
    </div>
  );
}

function PlanRow({ p, onSaved, toast }: { p: Plan; onSaved: () => void; toast: (m: string, t?: any) => void }) {
  const [d, setD] = useState(p);
  useEffect(() => { setD(p); }, [p]);
  const dirty = d.label !== p.label || d.price_cents !== p.price_cents || d.period_days !== p.period_days || d.active !== p.active;

  const save = async () => {
    if (!supabase) return;
    if (isBlank(d.label)) { toast("Name the plan first", "error"); return; }
    if (d.active && !(Number(d.price_cents) > 0)) { toast("Set a price above $0 before activating the plan", "error"); return; }
    const { error } = await supabase.from("subscription_plans").update({ label: d.label.trim(), price_cents: Math.round(Number(d.price_cents) || 0), period_days: Math.round(Number(d.period_days) || 1), active: d.active }).eq("key", p.key);
    if (error) toast(`Error: ${error.message}`, "error"); else { toast("Saved"); onSaved(); }
  };
  const del = async () => {
    if (!supabase || !window.confirm(`Delete plan "${d.label}"?`)) return;
    const { error } = await supabase.from("subscription_plans").delete().eq("key", p.key);
    if (error) toast(`Error: ${error.message}`, "error"); else onSaved();
  };

  return (
    <div className="prod">
      <div className="prod-body" style={{ borderTop: "none", paddingTop: 13 }}>
        <div className="prod-head" style={{ padding: 0, cursor: "default" }}>
          <span className="prod-n">{p.label}</span>
          <span className="prod-line">{p.key}{!p.active ? " · off" : ""}</span>
          <span className="prod-px">${(p.price_cents / 100).toFixed(2)}/{p.period_days}d</span>
        </div>
        <div className="prod-grid">
          <label className="prod-f"><span>Name</span><input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></label>
          <label className="prod-f"><span>Price ($)</span><input type="number" step="0.50" value={(d.price_cents / 100).toString()} onChange={(e) => setD({ ...d, price_cents: Math.round((Number(e.target.value) || 0) * 100) })} /></label>
          <label className="prod-f"><span>Billing period (days)</span><input type="number" value={d.period_days} onChange={(e) => setD({ ...d, period_days: Number(e.target.value) || 1 })} /></label>
          <label className="prod-toggle" style={{ marginTop: 22 }}><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Active</label>
        </div>
        <div className="prod-actions">
          <button type="button" className="note-arch" onClick={del}>Delete</button>
          <button type="button" className="note-save" onClick={save} disabled={!dirty || isBlank(d.label) || (d.active && !(Number(d.price_cents) > 0))}>Save</button>
        </div>
      </div>
    </div>
  );
}
