"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { InfoRow } from "@/components/kit";
import Icon from "@/components/Icon";

// SPEND & BUDGET (0209) — the procurement side of Money. Log what the business spends (optionally to a
// real vendor / event) and track it against a per-category monthly budget. Reads report_spend(); every
// write is staff-gated by RLS. Slots into the Money section next to the revenue KPIs. Fetch state via
// useAsyncData — a failed load is a real error now, not a silent "No spend data yet."
//
// 2026-07-16: this used to only ever show CATEGORY totals (report_spend()'s rollup) — you could log
// an expense but never see the individual row again, so a wrong amount typed in couldn't even be
// found, let alone fixed (the audit's "worse than Goals" finding: at least Goals showed you the
// thing you couldn't edit). The DB already allowed editing/deleting expenses; this adds the list.
type Cat = { category: string; budget_cents: number; spent_cents: number };
type Report = { month: string; total_spent_cents: number; total_budget_cents: number; by_category: Cat[] };
type ExpenseRow = { id: string; amount_cents: number; category: string; description: string | null; vendor_id: string | null; created_at: string };
type Board = { rep: Report | null; vendors: { id: string; name: string }[]; items: ExpenseRow[] };
const money = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;

export default function SpendBudget() {
  const { toast } = useApp();
  const [amount, setAmount] = useState(""); const [cat, setCat] = useState("supplies");
  const [desc, setDesc] = useState(""); const [vendor, setVendor] = useState(""); const [busy, setBusy] = useState(false);
  const [editCat, setEditCat] = useState<string | null>(null); const [editVal, setEditVal] = useState("");
  const [editExpId, setEditExpId] = useState<string | null>(null);
  const [ee, setEe] = useState({ amount: "", cat: "supplies", desc: "", vendor: "" });
  const [savingExp, setSavingExp] = useState(false);
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rep: null, vendors: [], items: [] };
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [r, v, e] = await Promise.all([
      supabase.rpc("report_spend"),
      supabase.from("vendors").select("id, name").is("archived_at", null).order("name"),
      supabase.from("expenses").select("id, amount_cents, category, description, vendor_id, created_at")
        .gte("created_at", monthStart.toISOString()).order("created_at", { ascending: false }),
    ]);
    if (r.error) throw new Error(r.error.message);
    if (v.error) throw new Error(v.error.message);
    if (e.error) throw new Error(e.error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rep = r.data && !(r.data as any).error ? (r.data as Report) : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { rep, vendors: (v.data as any) ?? [], items: (e.data as ExpenseRow[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable(["expenses", "budgets"], reload);
  const vendors = board.data?.vendors ?? [];

  const addExpense = async () => {
    if (!supabase || busy) return;
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { toast("Enter an amount", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("expenses").insert({ amount_cents: cents, category: cat, description: desc.trim() || null, vendor_id: vendor || null });
    setBusy(false);
    if (error) { toast(`Couldn't add — ${error.message}`, "error"); return; }
    setAmount(""); setDesc(""); setVendor(""); toast("Expense logged"); reload();
  };
  const saveBudget = async (category: string) => {
    if (!supabase) return;
    const cents = Math.round(parseFloat(editVal) * 100);
    setEditCat(null);
    if (!Number.isFinite(cents) || cents < 0) return;
    await supabase.from("budgets").upsert({ category, monthly_limit_cents: cents, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,category" });
    reload();
  };

  const startEditExpense = (row: ExpenseRow) => {
    setEditExpId(row.id);
    setConfirmDelId(null);
    setEe({ amount: String(row.amount_cents / 100), cat: row.category, desc: row.description ?? "", vendor: row.vendor_id ?? "" });
  };
  const saveExpense = async (id: string) => {
    if (!supabase || savingExp) return;
    const cents = Math.round(parseFloat(ee.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { toast("Enter an amount", "error"); return; }
    setSavingExp(true);
    const { error } = await supabase.from("expenses").update({
      amount_cents: cents, category: ee.cat, description: ee.desc.trim() || null, vendor_id: ee.vendor || null,
    }).eq("id", id);
    setSavingExp(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setEditExpId(null);
    toast("Expense updated");
    reload();
  };
  // Two taps, not a native confirm() — tap the ✕, the row swaps to a real Confirm/Cancel pair.
  const deleteExpense = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) { toast(`Couldn't delete — ${error.message}`, "error"); return; }
    setConfirmDelId(null);
    toast("Expense deleted");
    reload();
  };

  return (
    <AsyncSection state={board} isEmpty={(data) => data.rep === null} emptyTitle="No spend data yet" errorTitle="Couldn't load spend & budget">
      {(data) => {
        const rep = data.rep;
        if (!rep) return null;
        return (
          <div className="spb">
            <div className="spb-head"><b>{money(rep.total_spent_cents)}</b> spent<span className="spb-sub"> of {money(rep.total_budget_cents)} budget · {rep.month}</span></div>
            {/* Kit InfoRow replaces the ad-hoc .spb-row/.spb-row-h markup: category → name (a bare
                inline textTransform:capitalize style stands in for the old .spb-cat rule, since
                k-nm doesn't capitalize on its own — same fix Studio's version list makes via a
                scoped CSS rule; done inline here since this pass only touches this file), the
                spent/budget figure (button ↔ inline edit input, unchanged) → trailing, and the
                % bar → meta. The bar keeps its exact width%/over-budget logic; it now renders at
                the body column's width instead of full row bleed, same trade-off every other
                migrated list in this app already makes for its meta content (e.g. WorkloadBoard's
                own bar rides InfoRow's trailing). No data, state, or calculations changed below —
                presentation only. */}
            <div className="spb-list k-rows">
              {rep.by_category.map((c) => {
                const pct = c.budget_cents > 0 ? Math.min(100, Math.round((c.spent_cents / c.budget_cents) * 100)) : 0;
                const over = c.budget_cents > 0 && c.spent_cents > c.budget_cents;
                return (
                  <InfoRow
                    key={c.category}
                    name={<span style={{ textTransform: "capitalize" }}>{c.category}</span>}
                    trailing={editCat === c.category ? (
                      <input className="spb-bud-in" autoFocus inputMode="decimal" value={editVal}
                        onChange={(e) => setEditVal(e.target.value.replace(/[^0-9.]/g, ""))}
                        onBlur={() => saveBudget(c.category)} onKeyDown={(e) => { if (e.key === "Enter") saveBudget(c.category); }} />
                    ) : (
                      <button type="button" className="spb-bud" onClick={() => { setEditCat(c.category); setEditVal(c.budget_cents ? String(c.budget_cents / 100) : ""); }}>
                        {money(c.spent_cents)} / {c.budget_cents ? money(c.budget_cents) : "set budget"}
                      </button>
                    )}
                    meta={<span className="spb-bar"><span className={over ? "over" : ""} style={{ width: `${c.budget_cents > 0 ? pct : 0}%` }} /></span>}
                  />
                );
              })}
            </div>

            {/* The individual rows behind the category totals above — logged, but until now never
                shown again, so a typo'd amount couldn't be found, let alone fixed. Scoped to this
                calendar month, matching report_spend()'s own window. */}
            <div className="spb-items">
              <div className="spb-items-h">This month's expenses{data.items.length > 0 && ` · ${data.items.length}`}</div>
              {data.items.length === 0 ? (
                <p className="h-sub" style={{ margin: "2px 2px 10px" }}>Nothing logged yet this month.</p>
              ) : data.items.map((row) => {
                if (editExpId === row.id) {
                  return (
                    <div className="spb-item-edit" key={row.id}>
                      <div className="goal-new-row">
                        <input className="note-in spb-amt" inputMode="decimal" value={ee.amount} onChange={(e) => setEe({ ...ee, amount: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Amount" />
                        <select className="note-in" value={ee.cat} onChange={(e) => setEe({ ...ee, cat: e.target.value })} aria-label="Category">{rep.by_category.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}</select>
                      </div>
                      <div className="goal-new-row">
                        <input className="note-in spb-desc" value={ee.desc} onChange={(e) => setEe({ ...ee, desc: e.target.value })} placeholder="What for?" aria-label="Description" />
                        <select className="note-in" value={ee.vendor} onChange={(e) => setEe({ ...ee, vendor: e.target.value })} aria-label="Vendor"><option value="">Vendor (optional)</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                      </div>
                      <div className="st-log-btns">
                        <button type="button" className="dops-mini" onClick={() => saveExpense(row.id)} disabled={savingExp}>{savingExp ? "Saving…" : "Save"}</button>
                        <button type="button" className="st-discuss" onClick={() => setEditExpId(null)}>Cancel</button>
                      </div>
                    </div>
                  );
                }
                const vName = vendors.find((v) => v.id === row.vendor_id)?.name;
                return (
                  <div className="spb-item" key={row.id}>
                    <button type="button" className="spb-item-x" onClick={() => startEditExpense(row)} aria-label={`Edit ${money(row.amount_cents)} expense`}>
                      <span className="spb-item-main">
                        <b>{money(row.amount_cents)}</b>
                        <span style={{ textTransform: "capitalize" }}>{row.category}</span>
                        {row.description && <span className="spb-item-desc">{row.description}</span>}
                        {vName && <span className="spb-item-vendor">{vName}</span>}
                      </span>
                      <span className="spb-item-date">{new Date(row.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    </button>
                    {confirmDelId === row.id ? (
                      <span className="spb-item-confirm">
                        <button type="button" className="st-discuss goal-archive" onClick={() => deleteExpense(row.id)}>Confirm</button>
                        <button type="button" className="st-discuss" onClick={() => setConfirmDelId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="spb-item-del" onClick={() => setConfirmDelId(row.id)} aria-label={`Delete ${money(row.amount_cents)} expense`}><Icon name="close" size={12} /></button>
                    )}
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
      }}
    </AsyncSection>
  );
}
