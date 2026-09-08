"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { InfoRow } from "@/components/kit";
import Icon from "@/components/Icon";
import { downloadCsv } from "@/lib/csv";
import { MARKETS, MARKET_LABEL, FOUNDING_MARKET, toMarket, type Market } from "@/lib/markets";
import { receiptGaps, totals, headline, type SpendCategory, type ExpenseRow as SpendRow, type BudgetRow } from "@/lib/spend";
import { moneyRound } from "@/lib/money";

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
type ExpenseRow = { id: string; amount_cents: number; category: string; description: string | null; vendor_id: string | null; created_at: string; spent_on?: string; market?: string | null; receipt_path?: string | null; voided_at?: string | null };
type Board = { rep: Report | null; vendors: { id: string; name: string }[]; items: ExpenseRow[]; cats: SpendCategory[] };

export default function SpendBudget() {
  const { toast } = useApp();
  const [amount, setAmount] = useState(""); const [cat, setCat] = useState("supplies");
  const [desc, setDesc] = useState(""); const [vendor, setVendor] = useState(""); const [busy, setBusy] = useState(false);
  const [editCat, setEditCat] = useState<string | null>(null); const [editVal, setEditVal] = useState("");
  const [editExpId, setEditExpId] = useState<string | null>(null);
  const [ee, setEe] = useState({ amount: "", cat: "supplies", desc: "", vendor: "" });
  const [savingExp, setSavingExp] = useState(false);
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);   // zero-state: category list waits behind one prompt
  const [market, setMarket] = useState<Market>(FOUNDING_MARKET);
  const [uploading, setUploading] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rep: null, vendors: [], items: [], cats: [] };
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [r, v, e, c] = await Promise.all([
      supabase.rpc("report_spend"),
      supabase.from("vendors").select("id, name").is("archived_at", null).order("name"),
      // 0292: receipt_path, market and voided_at are what make the gap list and the per-city
      // totals possible; without them this panel can only ever show a company-wide guess.
      supabase.from("expenses")
        .select("id, amount_cents, category, description, vendor_id, created_at, spent_on, market, receipt_path, voided_at")
        .gte("created_at", monthStart.toISOString()).order("created_at", { ascending: false }),
      supabase.from("spend_categories").select("slug, label, sort, active, receipt_required_over_cents").order("sort"),
    ]);
    if (r.error) throw new Error(r.error.message);
    if (v.error) throw new Error(v.error.message);
    if (e.error) throw new Error(e.error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rep = r.data && !(r.data as any).error ? (r.data as Report) : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { rep, vendors: (v.data as any) ?? [], items: (e.data as ExpenseRow[]) ?? [],
             cats: (c.data as SpendCategory[]) ?? [] };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable(["expenses", "budgets"], reload);
  const vendors = board.data?.vendors ?? [];
  const cats = board.data?.cats ?? [];
  const items = board.data?.items ?? [];

  // The honest read of the month, computed from the same tested module the tests use rather than
  // re-derived in JSX. gaps is the list an accountant would ask for.
  const month = new Date().toISOString().slice(0, 7);
  const spendRows = items as unknown as SpendRow[];
  const gaps = receiptGaps(spendRows, cats);
  const sum = totals(month, spendRows, [] as BudgetRow[], cats, null);
  const line = headline({ ...sum, budgetCents: board.data?.rep?.total_budget_cents ?? 0,
    remainingCents: (board.data?.rep?.total_budget_cents ?? 0) - sum.spentCents,
    overCategories: (board.data?.rep?.by_category ?? []).filter((c) => c.budget_cents > 0 && c.spent_cents > c.budget_cents).length });

  // A receipt goes straight into the PRIVATE receipts bucket (0292) under the expense's own id, so
  // the path is derivable and two people cannot overwrite each other.
  const attachReceipt = async (row: ExpenseRow, file: File) => {
    if (!supabase) return;
    if (file.size > 20 * 1024 * 1024) { toast("That file is over 20MB — photograph it instead of scanning it.", "error"); return; }
    setUploading(row.id);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${row.market ?? FOUNDING_MARKET}/${row.id}.${ext}`;
    const up = await supabase.storage.from("receipts").upload(path, file, { upsert: true });
    if (up.error) { setUploading(null); toast(up.error.message, "error"); return; }
    const { error } = await supabase.from("expenses")
      .update({ receipt_path: path, receipt_uploaded_at: new Date().toISOString() }).eq("id", row.id);
    setUploading(null);
    if (error) { toast(error.message, "error"); return; }
    toast("Receipt attached"); reload();
  };

  const addExpense = async () => {
    if (!supabase || busy) return;
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { toast("Enter an amount", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("expenses").insert({ amount_cents: cents, category: cat, description: desc.trim() || null, vendor_id: vendor || null, market });
    setBusy(false);
    if (error) { toast(`Couldn't add — ${error.message}`, "error"); return; }
    setAmount(""); setDesc(""); setVendor(""); toast("Expense logged"); reload();
  };
  const saveBudget = async (category: string) => {
    if (!supabase) return;
    const raw = editVal.trim();
    const cents = Math.round(parseFloat(raw) * 100);
    setEditCat(null);
    // 0292 replaced the old (tenant, category) unique key with (tenant, market, category,
    // effective_from), so a budget belongs to a month instead of being rewritten in place. Upserting
    // against the retired constraint would have failed outright the moment 0292 landed. A change
    // saved today takes effect from the first of this month and leaves earlier months alone.
    const from = new Date(); from.setDate(1);
    const month = from.toISOString().slice(0, 10);

    // CLEARING THE FIELD MEANS THERE IS NO BUDGET, NOT A BUDGET OF ZERO.
    //
    // Before 0308 this had no way out. An empty box fell through the isFinite check and did
    // nothing, so a budget set on the wrong category stayed forever; and typing 0 set a limit of
    // zero, which is worse than nothing — every dollar spent then reads as over budget, in red, on
    // a category nobody meant to cap. Both spellings of "I did not mean to set this" now remove
    // this month's row, and whatever earlier month's budget applies takes over again.
    if (raw === "" || cents === 0) {
      let q = supabase.from("budgets").delete().eq("category", category).eq("effective_from", month);
      q = market ? q.eq("market", market) : q.is("market", null);
      const { error } = await q;
      // The delete is admin-only after 0308 — say so rather than failing silently.
      if (error) { toast(`Couldn't clear it — ${error.message}`, "error"); return; }
      toast(`No budget on ${category} this month.`);
      reload();
      return;
    }
    if (!Number.isFinite(cents) || cents < 0) return;
    await supabase.from("budgets").upsert(
      { category, market, monthly_limit_cents: cents, effective_from: month,
        updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,market,category,effective_from" },
    );
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
  // 0292: expenses are never deleted. A book of record that can lose a row is not a record, so the
  // database refuses the delete and this voids instead — the row stays, with who and why on it, and
  // leaves every total. The reason is required, because a void with no reason is a delete.
  const voidExpense = async (id: string) => {
    if (!supabase) return;
    const reason = typeof window !== "undefined"
      ? window.prompt("Why is this being voided? (duplicate, wrong amount, refunded…)") ?? ""
      : "";
    if (!reason.trim()) { toast("Say why — it goes on the record.", "error"); return; }
    const { error } = await supabase.rpc("void_expense", { p_id: id, p_reason: reason.trim() });
    if (error) { toast(error.message, "error"); return; }
    setConfirmDelId(null);
    toast("Voided — the record stays");
    reload();
  };

  return (
    <AsyncSection state={board} isEmpty={(data) => data.rep === null} emptyTitle="No spend data yet" errorTitle="Couldn't load spend & budget">
      {(data) => {
        const rep = data.rep;
        if (!rep) return null;
        return (
          <div className="spb">
            <div className="spb-head"><b>{moneyRound(rep.total_spent_cents)}</b> spent<span className="spb-sub"> of {moneyRound(rep.total_budget_cents)} budget · {rep.month}</span>
              {data.items.length > 0 && <button type="button" className="dops-mini spb-export" onClick={() => downloadCsv("gt3-expenses.csv", data.items.map((x) => ({
                when: x.created_at, amount: (x.amount_cents / 100).toFixed(2), category: x.category, description: x.description ?? "",
              })))}>Export CSV</button>}
            </div>
            {/* Zero-state (2026-08-01 audit): eight identical "$0 / set budget" flatlines rendered
                emptiness as furniture. Until anything is spent or budgeted, ONE prompt stands in
                for the wall — tap it and the full category list opens for setup. */}
            {rep.total_spent_cents === 0 && rep.total_budget_cents === 0 && !setupOpen ? (
              <button type="button" className="dl-card st-build" onClick={() => setSetupOpen(true)}>
                <b>No spend logged, no budgets set</b>
                <span>Tap to open the categories and set your first budget — or just log the first expense below.</span>
              </button>
            ) : (<></>)}
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
            {(rep.total_spent_cents > 0 || rep.total_budget_cents > 0 || setupOpen) && (
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
                        {moneyRound(c.spent_cents)} / {c.budget_cents ? moneyRound(c.budget_cents) : "set budget"}
                      </button>
                    )}
                    meta={<span className="spb-bar"><span className={over ? "over" : ""} style={{ width: `${c.budget_cents > 0 ? pct : 0}%` }} /></span>}
                  />
                );
              })}
            </div>
            )}

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
                    <button type="button" className="spb-item-x" onClick={() => startEditExpense(row)} aria-label={`Edit ${moneyRound(row.amount_cents)} expense`}>
                      <span className="spb-item-main">
                        <b>{moneyRound(row.amount_cents)}</b>
                        <span style={{ textTransform: "capitalize" }}>{row.category}</span>
                        {row.description && <span className="spb-item-desc">{row.description}</span>}
                        {vName && <span className="spb-item-vendor">{vName}</span>}
                      </span>
                      <span className="spb-item-date">{new Date(row.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    </button>
                    {row.voided_at ? (
                      <span className="spb-void" title="Voided — kept on the record">voided</span>
                    ) : row.receipt_path ? (
                      <span className="spb-rcpt has" title={row.receipt_path}><Icon name="check" size={12} /> receipt</span>
                    ) : (
                      <label className={`spb-rcpt want${uploading === row.id ? " busy" : ""}`}>
                        {uploading === row.id ? "…" : "+ receipt"}
                        <input type="file" accept="image/*,application/pdf" capture="environment"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) attachReceipt(row, f); e.currentTarget.value = ""; }} />
                      </label>
                    )}
                    {confirmDelId === row.id ? (
                      <span className="spb-item-confirm">
                        <button type="button" className="st-discuss goal-archive" onClick={() => voidExpense(row.id)}>Void it</button>
                        <button type="button" className="st-discuss" onClick={() => setConfirmDelId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="spb-item-del" onClick={() => setConfirmDelId(row.id)} aria-label={`Void ${moneyRound(row.amount_cents)} expense`}><Icon name="close" size={12} /></button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* The month in one sentence, from lib/spend.ts — which leads with the bad news when
                there is bad news rather than opening with "on track" while three categories are over. */}
            <p className={`spb-line${sum.overCategories > 0 || gaps.length > 0 ? " flag" : ""}`}>{line}</p>

            {gaps.length > 0 && (
              <div className="spb-gaps">
                <p className="insp-lbl">Missing a receipt — biggest first</p>
                <ul>
                  {gaps.slice(0, 5).map((g) => (
                    <li key={g.id}>
                      <b>{moneyRound(g.amount_cents)}</b>
                      <span>{g.description || g.category}</span>
                      <em>{g.spent_on ?? ""}</em>
                    </li>
                  ))}
                </ul>
                {gaps.length > 5 && <p className="spb-gaps-more">and {gaps.length - 5} more</p>}
                <p className="spb-gaps-why">
                  This is the list your accountant asks for. Photograph the receipt with the button
                  on each row — it stores privately, not on a public link.
                </p>
              </div>
            )}

            <div className="spb-add">
              <input className="note-in spb-amt" inputMode="decimal" placeholder="$0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount" />
              <select className="note-in" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">{rep.by_category.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}</select>
              <input className="note-in spb-desc" placeholder="What for?" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Description" />
              <select className="note-in" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor"><option value="">Vendor (optional)</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
              {/* 0292: spend belongs to a city. Without this every expense lands in Greenville and
                  the two markets share one number, which is what the report used to do. */}
              <select className="note-in" value={market} onChange={(e) => setMarket(toMarket(e.target.value))} aria-label="City">
                {MARKETS.map((m) => <option key={m} value={m}>{MARKET_LABEL[m]}</option>)}
              </select>
              <button type="button" className="note-save" onClick={addExpense} disabled={busy}>{busy ? "…" : "Log expense"}</button>
            </div>
          </div>
        );
      }}
    </AsyncSection>
  );
}
