"use client";

import { useCallback } from "react";
import { SectionHeader } from "@/components/kit";
import { fetchEventPnl, type EventPnlRow } from "@/lib/reports";
import { useOperatorSection } from "./OperatorNav";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";

// Per-event P&L — actual revenue (Square mirror) minus COGS minus fixed event costs from the
// event_economics model. Scaffold: fills in as sales flow against live events. MONEY tab.
// Fetch state via useAsyncData — fetchEventPnl() resolves to null on any failure (no Supabase
// client, or the report_events RPC erroring); that used to fall through to `if (!rows) return
// null`, so a failed report silently vanished with no heading, no hint, nothing. Now it's a real
// error state.

const usd = (cents: number) => (cents < 0 ? "-$" : "$") + Math.round(Math.abs(cents || 0) / 100).toLocaleString();

export default function EventPnlReport() {
  const { setSection } = useOperatorSection();
  // Jump from a P&L row to the event it came from (audit P2: reports were read-only dead-ends).
  const openEvent = (id?: string, kind?: "event" | "stop") => { if (!id) return; try { localStorage.setItem("gt3-prep-open", kind === "stop" ? `stop:${id}` : id); } catch { /* ignore */ } setSection("prep"); };

  const loader = useCallback(async (): Promise<EventPnlRow[]> => {
    const r = await fetchEventPnl();
    if (r === null) throw new Error("Couldn't load the P&L report");
    return r;
  }, []);
  const board = useAsyncData(loader, []);

  return (
    <div className="adm-sec rpt">
      <SectionHeader label="Per-event P&amp;L" annotation="plan vs actual" />
      <AsyncSection state={board} isEmpty={(data) => data.length === 0} emptyTitle="No events yet" errorTitle="Couldn't load the P&L report">
        {(rows) => {
          const anyActual = rows.some((r) => r.actual_cents > 0);
          return (
            <div className="rpt-block">
              {rows.map((r, i) => (
                <button key={i} type="button" className="rpt-pnl rpt-pnl-link" onClick={() => openEvent(r.id, r.kind)} disabled={!r.id}>
                  <div className="rpt-pnl-l">
                    <b>{r.event}{r.id ? <span className="rpt-pnl-go" aria-hidden> ›</span> : null}</b>
                    <span>{r.orders} orders · {Math.round((1 - r.cogs_pct) * 100)}% gross{r.fixed_cents > 0 ? ` · ${usd(r.fixed_cents)} fixed` : ""}</span>
                  </div>
                  <div className="rpt-pnl-r">
                    <div className="rpt-pnl-rev">{usd(r.actual_cents)}</div>
                    <div className={`rpt-pnl-m${r.margin_cents >= 0 ? "" : " neg"}`}>{usd(r.margin_cents)} net</div>
                  </div>
                </button>
              ))}
              <div className="rpt-foot">{anyActual
                ? "Actual revenue (Square) − COGS − fixed event costs (booth / transport / permit / consumables)."
                : "Actuals fill in from Square as you sell at each event; costs come from each event's economics."}</div>
            </div>
          );
        }}
      </AsyncSection>
    </div>
  );
}
