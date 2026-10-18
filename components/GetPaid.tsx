"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useRealtimeTable } from "@/lib/realtime";
import { etDayKey, etToday } from "@/lib/dates";
import { dueWord, daysBetween } from "@/lib/dayWords";
import { moneyRound } from "@/lib/money";
import { markInvoicePaid } from "@/lib/collect";
import AsyncSection from "./AsyncSection";
import GoLine from "./GoLine";
import Icon from "./Icon";
import { useConfirm } from "./ConfirmSheet";
import { useAppStable } from "./AppProvider";

// GET PAID (2026-10-15, release 3 of the Plan & Money audit). The panel was two links out — "Refunds & disputes —
// Square Dashboard" and the payment switches — and nothing in it said whether there was a refund, a chargeback or an
// unpaid invoice at all: Square has told us each since 0330 (square_refunds, square_disputes), and the office
// accounts' invoices were in the database since 0187, but no screen listed any of them. Now it lists what Square
// sent and what is owed, in the app:
//   · Owed to you — every open invoice, latest date first, each with "Paid" (mark_invoice_paid, 0341: an owner's or
//     an admin's; it closes the invoice and its office order, so it asks);
//   · Chargebacks — every one still open, with the date its evidence is due; answering one is Square's (the card
//     data never touches this app), so the row says that and the door to it is below;
//   · Refunds — the last 30 days of what Square refunded, as Square tells it.
// A refund is still made in Square, and the payment switches are still Settings'; both doors stay.
//
// The id stays "pay": a voided paid order's refund alert links /crew?s=money&a=pay, and so do Money's own Needs
// attention rows for a chargeback or an invoice.

const SQUARE_SALES = "https://squareup.com/dashboard/sales/transactions";
const OPEN_STATES = ["WON", "LOST", "ACCEPTED"];   // a chargeback in any other state is still open (0330)

type Invoice = { id: string; amount_cents: number; due_at: string | null; terms: string | null; business_accounts: { company: string | null } | null };
type Dispute = { id: string; amount_cents: number; state: string | null; due_at: string | null; reason: string | null };
type Refund = { id: string; amount_cents: number; status: string; reason: string | null; created_at: string };
type Board = { invoices: Invoice[]; disputes: Dispute[]; refunds: Refund[] };

/** Square's dispute state, said: EVIDENCE_REQUIRED → "evidence needed". */
function stateWords(s: string | null): string {
  switch (s) {
    case "INQUIRY_EVIDENCE_REQUIRED": return "the bank is asking";
    case "EVIDENCE_REQUIRED": return "evidence needed";
    case "PROCESSING": return "evidence sent — the bank is deciding";
    default: return s ? s.toLowerCase().replace(/_/g, " ") : "open";
  }
}

/** "Oct 9" — a refund's day, in the phone's time. */
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function GetPaid() {
  const confirm = useConfirm();
  const { toast } = useAppStable();
  const [paying, setPaying] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { invoices: [], disputes: [], refunds: [] };
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [inv, dsp, ref] = await Promise.all([
      supabase.from("invoices").select("id, amount_cents, due_at, terms, business_accounts(company)").in("status", ["open", "sent"]).order("due_at", { ascending: true, nullsFirst: false }),
      supabase.from("square_disputes").select("id, amount_cents, state, due_at, reason").not("state", "in", `(${OPEN_STATES.join(",")})`).order("due_at", { ascending: true, nullsFirst: false }),
      supabase.from("square_refunds").select("id, amount_cents, status, reason, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(20),
    ]);
    const failed = [inv.error, dsp.error, ref.error].find(Boolean);
    if (failed) throw new Error(failed.message);
    return {
      invoices: (inv.data as unknown as Invoice[] | null) ?? [],
      disputes: (dsp.data as Dispute[] | null) ?? [],
      refunds: (ref.data as Refund[] | null) ?? [],
    };
  }, []);
  const state = useAsyncData<Board>(loader, []);
  const { reload } = state;
  useRealtimeTable("alerts", reload);

  const paid = async (inv: Invoice) => {
    if (!supabase || paying) return;
    const who = inv.business_accounts?.company || "this invoice";
    if (!(await confirm({ title: `Mark ${who} — ${moneyRound(inv.amount_cents)} paid?`, body: "When the money is in. It closes the invoice and marks its office order paid.", confirmLabel: "Mark paid" }))) return;
    setPaying(inv.id);
    const res = await markInvoicePaid(supabase, inv.id);
    setPaying(null);
    if (res.error) { toast(`Couldn't mark it paid — ${res.error}`, "error"); return; }
    toast(res.already ? "Already paid." : "Paid.");
    reload();
  };

  // The business's today, Eastern — the day a chargeback's evidence date and an invoice's due date are cut in.
  const today = etToday();
  return (
    <>
      <AsyncSection
        state={state}
        isEmpty={(d) => !d.invoices.length && !d.disputes.length && !d.refunds.length}
        emptyTitle="Nothing owed, disputed or refunded"
        emptySub="No open invoices, no chargebacks, and no refunds in the last 30 days."
        loadingLabel="Reading what Square sent…"
        errorTitle="Couldn't read refunds, chargebacks and invoices"
        errorSub="This is not the same as there being none — we could not read them just now."
      >
        {({ invoices, disputes, refunds }) => (
          <div className="owed">
            {invoices.length > 0 && <div className="rdg-row-h">Owed to you · {moneyRound(invoices.reduce((s, i) => s + i.amount_cents, 0))}</div>}
            {invoices.map((inv) => {
              const days = inv.due_at ? daysBetween(today, inv.due_at) : null;
              return (
                <div key={inv.id} className={`owed-row${days !== null && days < 0 ? " late" : ""}`}>
                  <button type="button" className="task-check" onClick={() => void paid(inv)} disabled={paying === inv.id} aria-label={`Paid: ${inv.business_accounts?.company || "invoice"}, ${moneyRound(inv.amount_cents)}`} title="Paid">
                    <span className="task-box" aria-hidden="true">{paying === inv.id ? "…" : null}</span>
                  </button>
                  <div className="owed-row-go">
                    <span className="owed-row-b">
                      <b>{inv.business_accounts?.company || "An office account"} · {moneyRound(inv.amount_cents)}</b>
                      <i>{inv.terms === "net30" ? "Net 30" : "Net 15"}{days !== null && days < 0 ? " · past its date" : ""}</i>
                    </span>
                    <span className="owed-age">{days === null ? "no date" : dueWord(days)}</span>
                  </div>
                </div>
              );
            })}

            {disputes.length > 0 && <div className="rdg-row-h">Chargebacks · answered in Square</div>}
            {disputes.map((d) => {
              const days = d.due_at ? daysBetween(today, etDayKey(new Date(d.due_at))) : null;
              return (
                <div key={d.id} className={`owed-row${days !== null && days <= 2 ? " late" : ""}`}>
                  <span className="owed-row-b">
                    <b>{moneyRound(d.amount_cents)} · {stateWords(d.state)}</b>
                    <i>{d.due_at ? `Evidence by ${shortDay(d.due_at)}` : "No evidence date from Square"}{d.reason ? ` · ${d.reason.toLowerCase().replace(/_/g, " ")}` : ""}</i>
                  </span>
                  <span className="owed-age">{days === null ? "" : dueWord(days)}</span>
                </div>
              );
            })}

            {refunds.length > 0 && <div className="rdg-row-h">Refunds · the last 30 days</div>}
            {refunds.map((r) => (
              <div key={r.id} className="owed-row">
                <span className="owed-row-b">
                  <b>{moneyRound(r.amount_cents)} refunded</b>
                  <i>{r.status === "COMPLETED" ? "Done in Square" : `Square says ${r.status.toLowerCase()}`}{r.reason ? ` · ${r.reason}` : ""}</i>
                </span>
                <span className="owed-age">{shortDay(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </AsyncSection>
      {/* A refund is made, and a chargeback answered, where the card is: Square. */}
      <a className="adm-golink hit-y-44" style={{ display: "inline-block", marginTop: 10 }} href={SQUARE_SALES} target="_blank" rel="noreferrer">Refund or answer a chargeback — Square <Icon name="externalLink" /></a>
      <GoLine to="settings" anchor="set-pay">Payment settings</GoLine>
    </>
  );
}
