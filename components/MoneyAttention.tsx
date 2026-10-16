"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { businessMonthStart, categoryLabel, type SpendCategory } from "@/lib/spend";
import { moneyAttention, attentionCounts, type AttnRow, type ShopWait, type Drift, type BudgetLine } from "@/lib/moneyAttention";
import { etDayKey, etToday } from "@/lib/dates";
import { daysBetween } from "@/lib/dayWords";
import { markInvoicePaid } from "@/lib/collect";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "./kit";
import { useOperatorSection, type OpSection } from "./OperatorNav";
import { goToDest } from "./CrewKpis";
import { useConfirm } from "./ConfirmSheet";
import { useApp } from "./AppProvider";

// NEEDS ATTENTION, ON MONEY (2026-10-15, release 3 of the Plan & Money audit). The money that needs a person, worst
// first, between how the business is doing (Performance, above) and what to do next (below). The rules are
// lib/moneyAttention's; this reads what they need and draws the rows the way My Day's Needs you draws its own
// (components/Owed: the .owed list, a row that is a door, its level and problem in words).
//
// A FAILED READ IS NOT AN EMPTY LIST. "Nothing needs you" is a promise, so any read that fails takes the list down
// with it and says it could not check — the false-empty rule (scripts/falseempty.audit.mjs) — rather than drawing
// the reads that did come back as if they were all there is.

type Board = { rows: AttnRow[] };

export default function MoneyAttention() {
  const { setSection } = useOperatorSection();
  const confirm = useConfirm();
  const { toast } = useApp();
  const [paying, setPaying] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [] };
    const [shop, dsp, inv, drift, spend, cats] = await Promise.all([
      // An order's promise (0407: ship_by, ship_risk) grades its row.
      supabase.from("v_shop_orders").select("id, who, total_cents, age_hours, items, ship_by, ship_risk").eq("waiting_on_us", true),
      supabase.from("square_disputes").select("id, amount_cents, due_at, shop_orders(ship_name, email)").not("state", "in", "(WON,LOST,ACCEPTED)"),
      supabase.from("invoices").select("id, amount_cents, due_at, business_accounts(company)").in("status", ["open", "sent"]).not("due_at", "is", null),
      supabase.from("v_shop_money_drift").select("order_id, who, gap_cents, open_disputes").neq("verdict", "Agrees."),
      supabase.rpc("report_spend", { p_month: businessMonthStart() }),
      supabase.from("spend_categories").select("slug, label, sort, active, receipt_required_over_cents").order("sort"),
    ]);
    const failed = [shop.error, dsp.error, inv.error, drift.error, spend.error, cats.error].find(Boolean);
    if (failed) throw new Error(failed.message);
    const rep = spend.data as { by_category?: BudgetLine[]; error?: string } | null;
    if (!rep || rep.error) throw new Error(rep?.error || "The spend report came back empty.");
    const labels = (cats.data as SpendCategory[] | null) ?? [];
    // Whole days to a date, from the business's today (Eastern, as v_obligations cuts a chargeback's evidence date).
    const today = etToday();
    const daysTo = (day: string | null) => (day ? daysBetween(today, day) : null);
    type DisputeRow = { id: string; amount_cents: number; due_at: string | null; shop_orders: { ship_name: string | null; email: string | null } | null };
    type InvoiceRow = { id: string; amount_cents: number; due_at: string | null; business_accounts: { company: string | null } | null };
    return {
      rows: moneyAttention({
        today,
        waiting: (shop.data as ShopWait[] | null) ?? [],
        disputes: ((dsp.data as unknown as DisputeRow[] | null) ?? []).map((d) => ({
          id: d.id, amount_cents: d.amount_cents, who: d.shop_orders?.ship_name || d.shop_orders?.email || null,
          days_out: daysTo(d.due_at ? etDayKey(new Date(d.due_at)) : null),
        })),
        invoices: ((inv.data as unknown as InvoiceRow[] | null) ?? []).map((v) => ({
          id: v.id, amount_cents: v.amount_cents, who: v.business_accounts?.company ?? null, days_out: daysTo(v.due_at),
        })),
        drift: (drift.data as Drift[] | null) ?? [],
        budgets: rep.by_category ?? [],
        label: (slug) => categoryLabel(slug, labels),
      }),
    };
  }, []);
  const state = useAsyncData<Board>(loader, []);
  const { reload } = state;
  // Redrawn from the database, never edited in place. Of what it reads, only the alerts are in the realtime
  // publication — a stalled order and a chargeback each raise one — so an alert landing is the signal; a purchase
  // logged is SpendBudget's same pair.
  useRealtimeTable(["alerts", "expenses", "budgets"], reload);

  const go = (r: AttnRow) => goToDest({ section: r.go.section as OpSection, anchor: r.go.anchor }, setSection);

  // The same act as My Day's "Paid" (components/Owed): it closes the invoice and its office order (0341), so it asks.
  const paid = async (r: AttnRow) => {
    if (!supabase || !r.invoiceId || paying) return;
    if (!(await confirm({ title: `Mark ${r.title} paid?`, body: "When the money is in. It closes the invoice and marks its office order paid.", confirmLabel: "Mark paid" }))) return;
    setPaying(r.invoiceId);
    const res = await markInvoicePaid(supabase, r.invoiceId);
    setPaying(null);
    if (res.error) { toast(`Couldn't mark it paid — ${res.error}`, "error"); return; }
    toast(res.already ? "Already paid." : "Paid.");
    reload();
  };

  const counts = state.status === "ready" && state.data ? attentionCounts(state.data.rows) : null;
  return (
    <div className="adm-sec" id="money-attention">
      {/* The head stays while the list loads, so nothing under it moves when it arrives; the counts join it then. */}
      <SectionHeader label="Needs attention" right={counts && (counts.critical + counts.urgent + counts.action > 0) ? (
        <span className="owed-n">
          {counts.critical > 0 && <span className="k-count due">{counts.critical} critical</span>}
          {counts.urgent > 0 && <span className="k-count due">{counts.urgent} urgent</span>}
          {counts.action > 0 && <span className="k-count soon">{counts.action} to do</span>}
        </span>
      ) : undefined} />
      <AsyncSection
        state={state}
        isEmpty={(d) => d.rows.length === 0}
        emptyTitle="Nothing needs you here"
        emptySub="No shop order is waiting on us, no chargeback or invoice is late, refunds agree with Square, and every budget is inside its line."
        loadingLabel="Checking what needs you…"
        errorTitle="Couldn't check what needs attention"
        errorSub="This is not the same as nothing needing you — we could not read it just now."
      >
        {({ rows }) => (
          <div className="owed">
            {rows.map((r) => {
              const late = r.level === "critical" || r.level === "urgent" ? " late" : "";
              const body = (
                <>
                  <span className="owed-row-b">
                    <b>{r.title}</b>
                    <i>{r.detail}</i>
                  </span>
                  <span className="owed-age">{r.side}</span>
                </>
              );
              if (!r.invoiceId) return (
                <button type="button" key={r.key} className={`owed-row${late}`} onClick={() => go(r)}>
                  {body}
                  <span className="owed-c" aria-hidden="true">›</span>
                </button>
              );
              return (
                <div key={r.key} className={`owed-row${late}`}>
                  <button type="button" className="task-check" onClick={() => void paid(r)} disabled={paying === r.invoiceId} aria-label={`Paid: ${r.title}`} title="Paid">
                    <span className="task-box" aria-hidden="true">{paying === r.invoiceId ? "…" : null}</span>
                  </button>
                  <button type="button" className="owed-row-go" onClick={() => go(r)}>{body}<span className="owed-c" aria-hidden="true">›</span></button>
                </div>
              );
            })}
          </div>
        )}
      </AsyncSection>
    </div>
  );
}
