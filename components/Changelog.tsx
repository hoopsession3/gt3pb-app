"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";

// CHANGELOG — "What we've built": the human-readable, categorized record of every improvement shipped,
// so a cofounder (or any leader) can see the whole build without reading git. Newest first, grouped by
// month, filterable by category, with the headline changes starred. Reads changelog (0200); admins can
// log a new entry. This is the institutional memory — the "how GT3 got built" a business shouldn't keep
// only in one founder's head.
type Entry = {
  id: string; title: string; category: string; area: string | null;
  summary: string; shipped_on: string; highlight: boolean;
};
type Draft = Omit<Entry, "id"> & { id?: string };

// category → label + accent (Keep-a-Changelog vocabulary, extended for this business)
const CATS: Record<string, { label: string; c: string }> = {
  feature: { label: "New", c: "#6aa05c" },
  improvement: { label: "Improved", c: "#5b8fb0" },
  fix: { label: "Fixed", c: "#e0892b" },
  security: { label: "Security", c: "#c4453c" },
  brand: { label: "Brand", c: "#9b6bd8" },
  growth: { label: "Growth", c: "#3f9d7e" },
  money: { label: "Money", c: "#C8A661" },
  ops: { label: "Ops", c: "#4f8a8b" },
  design: { label: "Design", c: "#c77fa6" },
};
const CAT_KEYS = Object.keys(CATS);
const AREAS = ["Ordering", "Studio", "Pipeline", "Money", "Crew", "Brand", "Membership", "Delivery", "AI", "Ops", "Alerts", "Garage"];

const today = () => new Date().toISOString().slice(0, 10);
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (iso: string) => new Date(`${iso}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const BLANK: Draft = { title: "", category: "feature", area: "", summary: "", shipped_on: today(), highlight: false };

export default function Changelog() {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const isAdmin = !!(profile?.is_admin);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState<string>("all");   // "all" | "highlight" | a category key
  const [composing, setComposing] = useState(false);
  const [d, setD] = useState<Draft>(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setRows([]); return; }
    const { data } = await supabase.from("changelog").select("*").order("shipped_on", { ascending: false }).order("created_at", { ascending: false });
    setRows((data as Entry[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const r = rows ?? [];
    const thisMonth = monthKey(today());
    return { total: r.length, month: r.filter((x) => monthKey(x.shipped_on) === thisMonth).length, highlights: r.filter((x) => x.highlight).length };
  }, [rows]);

  const shown = (rows ?? []).filter((r) => filter === "all" || (filter === "highlight" ? r.highlight : r.category === filter));
  // group the filtered set by month, preserving the newest-first order
  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const r of shown) { const k = monthKey(r.shipped_on); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return [...m.entries()];
  }, [shown]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!supabase || saving) return;
    if (!d.title.trim() || !d.summary.trim()) { toast("Add a title and a one-line summary", "error"); return; }
    setSaving(true);
    const payload = { title: d.title.trim().slice(0, 160), category: d.category, area: d.area?.trim() || null, summary: d.summary.trim(), shipped_on: d.shipped_on || today(), highlight: !!d.highlight };
    const { error } = await supabase.from("changelog").insert({ ...payload, created_by: user?.id ?? null });
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    toast("Logged"); setD(BLANK); setComposing(false); load();
  };

  if (rows === null) return <div className="chg-empty">Loading…</div>;
  const presentCats = CAT_KEYS.filter((k) => (rows ?? []).some((r) => r.category === k));

  return (
    <div className="chg">
      <p className="chg-lead">Everything we&apos;ve shipped — how GT3 got built, newest first. Every improvement, categorized, so anyone on the team can see the whole story.</p>

      <div className="chg-kpis">
        <div className="chg-kpi"><span className="chg-k-v">{stats.total}</span><span className="chg-k-l">shipped</span></div>
        <div className="chg-kpi"><span className="chg-k-v">{stats.month}</span><span className="chg-k-l">this month</span></div>
        <div className="chg-kpi"><span className="chg-k-v">{stats.highlights}</span><span className="chg-k-l">headliners</span></div>
      </div>

      {isAdmin && (!composing ? (
        <button type="button" className="chg-new" onClick={() => { setD(BLANK); setComposing(true); }}>+ Log an update</button>
      ) : (
        <div className="chg-form">
          <label className="prod-f"><span>What shipped</span><input value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={160} placeholder="e.g. Live deal ROI what-if" /></label>
          <div className="prod-grid" style={{ marginTop: 8 }}>
            <label className="prod-f"><span>Category</span><select value={d.category} onChange={(e) => set("category", e.target.value)}>{CAT_KEYS.map((k) => <option key={k} value={k}>{CATS[k].label}</option>)}</select></label>
            <label className="prod-f"><span>Area</span><input list="chg-areas" value={d.area ?? ""} onChange={(e) => set("area", e.target.value)} placeholder="Pipeline" /><datalist id="chg-areas">{AREAS.map((a) => <option key={a} value={a} />)}</datalist></label>
            <label className="prod-f"><span>Shipped</span><input type="date" value={d.shipped_on} onChange={(e) => set("shipped_on", e.target.value)} /></label>
          </div>
          <label className="prod-f" style={{ marginTop: 8 }}><span>One-line summary (the why / the impact)</span><textarea className="ev-input ev-area" rows={2} value={d.summary} onChange={(e) => set("summary", e.target.value)} placeholder="What it does and why it matters, in plain language." /></label>
          <label className="chg-hl"><input type="checkbox" checked={d.highlight} onChange={(e) => set("highlight", e.target.checked)} /> Headline change (star it)</label>
          <div className="prod-actions" style={{ marginTop: 10 }}>
            <button type="button" className="note-arch" onClick={() => { setD(BLANK); setComposing(false); }} disabled={saving}>Cancel</button>
            <button type="button" className="note-save" onClick={save} disabled={saving || !d.title.trim() || !d.summary.trim()}>{saving ? "Saving…" : "Log it"}</button>
          </div>
        </div>
      ))}

      <div className="chg-filters">
        <button type="button" className={`chg-chip${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>All</button>
        <button type="button" className={`chg-chip${filter === "highlight" ? " on" : ""}`} onClick={() => setFilter("highlight")}>★ Headliners</button>
        {presentCats.map((k) => (
          <button key={k} type="button" className={`chg-chip${filter === k ? " on" : ""}`} onClick={() => setFilter(k)} style={filter === k ? { borderColor: CATS[k].c, color: CATS[k].c } : undefined}>{CATS[k].label}</button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="chg-empty">Nothing logged in this view yet.</div>
      ) : groups.map(([mk, items]) => (
        <div key={mk} className="chg-month">
          <div className="chg-month-h">{monthLabel(mk)} <span>{items.length}</span></div>
          {items.map((e) => (
            <div key={e.id} className={`chg-row${e.highlight ? " hl" : ""}`}>
              <span className="chg-cat" style={{ background: CATS[e.category]?.c || "#888" }}>{CATS[e.category]?.label || e.category}</span>
              <span className="chg-body">
                <span className="chg-title">{e.highlight && <span className="chg-star" aria-label="headline">★</span>}{e.title}</span>
                <span className="chg-summary">{e.summary}</span>
                <span className="chg-meta">{e.area ? <span className="chg-area">{e.area}</span> : null}<span className="chg-date">{dayLabel(e.shipped_on)}</span></span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
