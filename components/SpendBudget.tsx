"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";

// SPEND & BUDGET (0209) — the procurement side of Money. Log what the business spends (optionally to a
// real vendor / event) and track it against a per-category monthly budget. Reads report_spend(); every
// write is staff-gated by RLS. Slots into the Money section next to the revenue KPIs.
type Cat = { category: string; budget_cents: number; spent_cents: number };
type Report = { month: string; total_spent_cents: number; total_budget_cents: number; by_category: Cat[] };
const money = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;

export default function SpendBudget() {
  const { toast } = useApp();
  const [rep, setRep] = useState<Report | null>(null);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [amount, setAmount] = useState(""); const [cat, setCat] = useState("supplies");
  const [desc, setDesc] = useState(""); const [vendor, setVendor] = useState(""); const [busy, setBusy] = useState(false);
  const [editCat, setEditCat] = useState<string | null>(null); const [editVal, setEditVal] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.rpc("report_spend");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRep(data && !(data as any).error ? (data as Report) : null);
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (supabase) supabase.from("vendors").select("id, name").is("archived_at", null).order("name").then(({ data }) => setVendors((data as any) ?? []));
  }, [load]);
  useRealtimeTable(["expenses", "budgets"], load);

  const addExpense = async () => {
    if (!supabase || busy) return;
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { toast("Enter an amount", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("expenses").insert({ amount_cents: cents, category: cat, description: desc.trim() || null, vendor_id: vendor || null });
    setBusy(false);
    if (error) { toast(`Couldn't add — ${error.message}`, "error"); return; }
    setAmount(""); setDesc(""); setVendor(""); toast("Expense logged"); load();
  };
  const saveBudget = async (category: string) => {
    if (!supabase) return;
    const cents = Math.round(parseFloat(editVal) * 100);
    setEditCat(null);
    if (!Number.isFinite(cents) || cents < 0) return;
    await supabase.from("budgets").upsert({ category, monthly_limit_cents: cents, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,category" });
    load();
  };

  if (!rep) return <div className="spb-empty">No spend data yet.</div>;
  return (
    <div className="spb">
      <div className="spb-head"><b>{money(rep.total_spent_cents)}</b> spent<span className="spb-sub"> of {money(rep.total_budget_cents)} budget · {rep.month}</span></div>
      <div className="spb-list">
        {rep.by_category.map((c) => {
          const pct = c.budget_cents > 0 ? Math.min(100, Math.round((c.spent_cents / c.budget_cents) * 100)) : 0;
          const over = c.budget_cents > 0 && c.spent_cents > c.budget_cents;
          return (
            <div key={c.category} className="spb-row">
              <div className="spb-row-h">
                <span className="spb-cat">{c.category}</span>
                {editCat === c.category ? (
                  <input className="spb-bud-in" autoFocus inputMode="decimal" value={editVal}
                    onChange={(e) => setEditVal(e.target.value.replace(/[^0-9.]/g, ""))}
                    onBlur={() => saveBudget(c.category)} onKeyDown={(e) => { if (e.key === "Enter") saveBudget(c.category); }} />
                ) : (
                  <button type="button" className="spb-bud" onClick={() => { setEditCat(c.category); setEditVal(c.budget_cents ? String(c.budget_cents / 100) : ""); }}>
                    {money(c.spent_cents)} / {c.budget_cents ? money(c.budget_cents) : "set budget"}
                  </button>
                )}
              </div>
              <span className="spb-bar"><span className={over ? "over" : ""} style={{ width: `${c.budget_cents > 0 ? pct : 0}%` }} /></span>
            </div>
          );
        })}
      </div>
      <div className="spb-add">
        <input className="note-in spb-amt" inputMode="decimal" placeholder="$0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount" />
        <select className="note-in" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">{rep.by_category.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}</select>
        <input className="note-in spb-desc" placeholder="What for?" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Description" />
        <select className="note-in" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor"><option value="">Vendor (optional)</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <button type="button" className="note-save" onClick={addExpense} disabled={busy}>{busy ? "…" : "Log expense"}</button>
      </div>
    </div>
  );
}
