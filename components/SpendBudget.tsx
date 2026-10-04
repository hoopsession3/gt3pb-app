"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { InfoRow } from "@/components/kit";
import EmptyState from "@/components/EmptyState";
import Icon from "@/components/Icon";
import { downloadCsv } from "@/lib/csv";
import { FOUNDING_MARKET, type Market } from "@/lib/markets";
import { receiptGaps, totals, headline, monthLabel, monthKey, categoryLabel, categoryOrder,
         type SpendCategory, type ExpenseRow as SpendRow, type BudgetRow } from "@/lib/spend";
import { moneyPlain, moneyRound } from "@/lib/money";
import { localToday } from "@/lib/dates";
import { attachReceipt as fileReceipt } from "@/lib/receipts";
import { usePrompt } from "@/components/PromptSheet";

// SPEND & BUDGET (0209) — the procurement side of Money. Log what the business spends (optionally to a
// real vendor / event) and track it against a per-category monthly budget. Reads report_spend(); every
// write is staff-gated by RLS. Slots into the Money section next to the revenue KPIs. Fetch state via
// useAsyncData — a failed load is a real error now, not a silent "No spend data yet."
//
// 2026-07-16: this used to only ever show CATEGORY totals (report_spend()'s rollup) — you could log
// an expense but never see the individual row again, so a wrong amount typed in couldn't even be
// found, let alone fixed (the audit's "worse than Goals" finding: at least Goals showed you the
// thing you couldn't edit). The DB already allowed editing/deleting expenses; this adds the list.
//
// 2026-10-04 — REVIEW ONLY. Ryan: "Should you have an open field like this or should it be
// architected differently?" Differently. The five-field form that sat under this report is gone:
// logging a purchase is a capture job that happens at the register with the receipt in hand, so it
// is a sheet (components/LogPurchase) reachable from the quick-actions button anywhere in the
// console, and "Log a purchase" here opens that same sheet. What stays is the month: what was spent,
// against what, on which days, and which receipts are still owed. One empty state instead of three,
// the month in words instead of "2026-10", categories by their labels instead of their slugs, and
// the list windowed on spent_on — the day the money left — which is what report_spend() totals.
type Cat = { category: string; budget_cents: number; spent_cents: number };
type Report = { month: string; total_spent_cents: number; total_budget_cents: number; by_category: Cat[] };
type ExpenseRow = { id: string; amount_cents: number; category: string; description: string | null; vendor_id: string | null; created_at: string; spent_on?: string; market?: string | null; receipt_path?: string | null; voided_at?: string | null };
type Board = { rep: Report | null; vendors: { id: string; name: string }[]; items: ExpenseRow[]; cats: SpendCategory[] };

export default function SpendBudget() {
  const prompt = usePrompt();
  const { toast } = useApp();
  const [editCat, setEditCat] = useState<string | null>(null); const [editVal, setEditVal] = useState("");
  const [editExpId, setEditExpId] = useState<string | null>(null);
  const [ee, setEe] = useState({ amount: "", cat: "supplies", desc: "", vendor: "" });
  const [savingExp, setSavingExp] = useState(false);
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);   // budgets wait behind one button until asked for
  // Budgets are set per city (0292). The panel reads the founding market's until a city switch earns
  // its place here; the capture sheet already files each purchase under its own city.
  const market: Market = FOUNDING_MARKET;
  const [uploading, setUploading] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rep: null, vendors: [], items: [], cats: [] };
    // spent_on, not created_at: the list and report_spend() must agree on what "this month" means.
    // A receipt logged on the 1st for a purchase on the 30th belongs to the month it was spent in.
    const monthStart = `${monthKey(localToday())}-01`;
    const [r, v, e, c] = await Promise.all([
      supabase.rpc("report_spend"),
      supabase.from("vendors").select("id, name").is("archived_at", null).order("name"),
      // 0292: receipt_path, market and voided_at are what make the gap list and the per-city
      // totals possible; without them this panel can only ever show a company-wide guess.
      supabase.from("expenses")
        .select("id, amount_cents, category, description, vendor_id, created_at, spent_on, market, receipt_path, voided_at")
        .gte("spent_on", monthStart).order("spent_on", { ascending: false }).order("created_at", { ascending: false }),
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
  const month = monthKey(localToday());   // local, not UTC: at 9 PM on the 31st it is still this month
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
    setUploading(row.id);
    const why = await fileReceipt(supabase, row, file);
    setUploading(null);
    if (why) { toast(why, "error"); return; }
    toast("Receipt attached"); reload();
  };
  // The capture sheet lives in the quick-actions dock (components/QuickDock → LogPurchase): one form,
  // reachable from every crew screen, and this button is just another way in.
  const logPurchase = () => window.dispatchEvent(new Event("gt3-log-purchase"));
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
    const reason = (await prompt({ title: "Why is this being voided?", hint: "Duplicate, wrong amount, refunded… It goes on the record.", confirmLabel: "Void it" })) ?? "";
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
        const label = (slug: string) => categoryLabel(slug, data.cats);
        const nothingYet = rep.total_spent_cents === 0 && rep.total_budget_cents === 0 && data.items.length === 0;
        const showBudgets = rep.total_spent_cents > 0 || rep.total_budget_cents > 0 || setupOpen;
        return (
          <div className="spb">
            {/* The month in one line, in words: "$412 spent in October · of $1,500 budget". A budget
                of nothing is not "$0 budget" — that reads as a limit of zero. */}
            <div className="spb-head">
              <b>{moneyRound(rep.total_spent_cents)}</b> spent in {monthLabel(rep.month)}
              <span className="spb-sub">{rep.total_budget_cents > 0 ? ` · of ${moneyRound(rep.total_budget_cents)} budget` : " · no budgets set"}</span>
            </div>

            {/* What this panel lets you DO, in one row. Logging opens the capture sheet; budgets are a
                setting you visit, not a wall of "$0 / set budget" rows you scroll past. */}
            <div className="spb-acts">
              <button type="button" className="so-go spb-log" onClick={logPurchase}><Icon name="plus" size={14} /> Log a purchase</button>
              <button type="button" className="btn-sec" onClick={() => setSetupOpen((v) => !v)} aria-expanded={setupOpen}>
                {setupOpen ? "Done with budgets" : rep.total_budget_cents > 0 ? "Edit budgets" : "Set budgets"}
              </button>
            </div>

            {/* ONE empty state. There used to be three — a card, "Nothing logged yet this month." and
                "Nothing spent and no budgets set yet." — saying the same thing in a row. */}
            {nothingYet && !setupOpen && (
              <EmptyState title={`Nothing logged for ${monthLabel(rep.month)} yet.`}
                sub="Log purchases as they happen — from here, or from the quick-actions button on any crew screen, receipt first. Budgets are optional: set them when you want the month measured against something." />
            )}

            {showBudgets && (
            <div className="spb-list k-rows">
              {rep.by_category.map((c) => {
                const pct = c.budget_cents > 0 ? Math.min(100, Math.round((c.spent_cents / c.budget_cents) * 100)) : 0;
                const over = c.budget_cents > 0 && c.spent_cents > c.budget_cents;
                return (
                  <InfoRow
                    key={c.category}
                    name={label(c.category)}
                    trailing={editCat === c.category ? (
                      <input className="spb-bud-in" autoFocus inputMode="decimal" value={editVal} aria-label={`Monthly budget for ${label(c.category)}`}
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

            {/* The rows behind the totals, by the day the money left. */}
            {data.items.length > 0 && (
            <div className="spb-items">
              {/* Export belongs to the list it exports, not to the row of things you do. */}
              <div className="spb-items-top">
                <div className="spb-items-h">{monthLabel(rep.month)} · {data.items.length} {data.items.length === 1 ? "purchase" : "purchases"}</div>
                <button type="button" className="spb-export" onClick={() => downloadCsv("gt3-expenses.csv", data.items.map((x) => ({
                  spent_on: x.spent_on ?? x.created_at.slice(0, 10), amount: moneyPlain(x.amount_cents), category: label(x.category),
                  description: x.description ?? "", receipt: x.receipt_path ? "yes" : "no", voided: x.voided_at ? "yes" : "",
                })))}>Export CSV</button>
              </div>
              {data.items.map((row) => {
                if (editExpId === row.id) {
                  return (
                    <div className="spb-item-edit" key={row.id}>
                      <div className="goal-new-row">
                        <input className="note-in spb-amt" inputMode="decimal" value={ee.amount} onChange={(e) => setEe({ ...ee, amount: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Amount" />
                        <select className="note-in" value={ee.cat} onChange={(e) => setEe({ ...ee, cat: e.target.value })} aria-label="Category">{categoryOrder(data.cats).map((c) => <option key={c.slug} value={c.slug}>{label(c.slug)}</option>)}</select>
                      </div>
                      <div className="goal-new-row">
                        <input className="note-in spb-desc" value={ee.desc} onChange={(e) => setEe({ ...ee, desc: e.target.value })} placeholder="What was it?" aria-label="What was it" />
                        <select className="note-in" value={ee.vendor} onChange={(e) => setEe({ ...ee, vendor: e.target.value })} aria-label="Venue or account"><option value="">Venue or account (optional)</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                      </div>
                      <div className="st-log-btns">
                        <button type="button" className="dops-mini" onClick={() => saveExpense(row.id)} disabled={savingExp}>{savingExp ? "Saving…" : "Save"}</button>
                        <button type="button" className="st-discuss" onClick={() => setEditExpId(null)}>Cancel</button>
                      </div>
                    </div>
                  );
                }
                const vName = vendors.find((v) => v.id === row.vendor_id)?.name;
                const day = row.spent_on ?? row.created_at.slice(0, 10);
                return (
                  <div className="spb-item" key={row.id}>
                    <button type="button" className="spb-item-x" onClick={() => startEditExpense(row)} aria-label={`Edit ${moneyRound(row.amount_cents)} expense`}>
                      <span className="spb-item-main">
                        <b>{moneyRound(row.amount_cents)}</b>
                        <span>{label(row.category)}</span>
                        {row.description && <span className="spb-item-desc">{row.description}</span>}
                        {vName && <span className="spb-item-vendor">{vName}</span>}
                      </span>
                      <span className="spb-item-date">{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
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
            )}

            {/* The month in one sentence, from lib/spend.ts — which leads with the bad news when
                there is bad news rather than opening with "on track" while three categories are over.
                Not said when the empty state above has already said it. */}
            {!nothingYet && <p className={`spb-line${sum.overCategories > 0 || gaps.length > 0 ? " flag" : ""}`}>{line}</p>}

            {gaps.length > 0 && (
              <div className="spb-gaps">
                <p className="insp-lbl">Missing a receipt — biggest first</p>
                <ul>
                  {gaps.slice(0, 5).map((g) => (
                    <li key={g.id}>
                      <b>{moneyRound(g.amount_cents)}</b>
                      <span>{g.description || label(g.category)}</span>
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
          </div>
        );
      }}
    </AsyncSection>
  );
}
