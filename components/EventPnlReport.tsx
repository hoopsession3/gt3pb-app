"use client";

import { useCallback } from "react";
import { SectionHeader, InfoRow } from "@/components/kit";
import { fetchEventPnl, type EventPnlRow } from "@/lib/reports";
import { useRecord } from "./RecordSheet";
import { prepHandoffKey, prepHandoffValue } from "@/lib/eventRecord";
import { useOperatorSection } from "./OperatorNav";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { moneyRound } from "@/lib/money";

// Per-event P&L — actual revenue (Square mirror) minus COGS minus fixed event costs from the
// event_economics model. Scaffold: fills in as sales flow against live events. MONEY tab.
// Fetch state via useAsyncData — fetchEventPnl() resolves to null on any failure (no Supabase
// client, or the report_events RPC erroring); that used to fall through to `if (!rows) return
// null`, so a failed report silently vanished with no heading, no hint, nothing. Now it's a real
// error state. Since 2026-10-12 fetchEventPnl throws on a failure itself — the function's own "unauthorized" included,
// which used to come back as an object, pass for the rows and break .some() — so the loader is the fetch.
//
// THE NET IS AN ESTIMATE, AND SAYS WHAT IT ASSUMED (2026-10-12, 0384). Every row's net is sales less ingredients at a
// cost percentage and less the fixed costs saved for the event — and for an event with no saved costs that is the menu's
// blended percentage and nothing else, no booth, no travel, no permit. It printed "$412 net" either way. It reads
// "est. net" now, and a row with no saved costs names what stood in for them (report_events' costs_saved).


export default function EventPnlReport() {
  const { setSection } = useOperatorSection();
  const { openRecord } = useRecord();
  // Jump from a P&L row to the thing it came from (audit P2: reports were read-only dead-ends).
  // An event opens its record (0314) — which is the right destination for a money screen, since the
  // record carries what it took and whether the cost assumptions are even set. A stop still goes to
  // the prep hub until the stop record lands.
  const openEvent = (id?: string, kind?: "event" | "stop") => {
    if (!id) return;
    if (kind === "stop") {
      try { localStorage.setItem(prepHandoffKey, prepHandoffValue("stop", id)); } catch { /* ignore */ }
      setSection("prep");
      return;
    }
    openRecord("event", id);
  };

  const loader = useCallback((): Promise<EventPnlRow[]> => fetchEventPnl(), []);
  const board = useAsyncData(loader, []);

  return (
    <div className="adm-sec rpt">
      <SectionHeader label="Per-event P&amp;L" annotation="plan vs actual" />
      <AsyncSection state={board} isEmpty={(data) => data.length === 0} emptyTitle="No events yet" errorTitle="Couldn't load the P&L report"
        errorSub="This is not zero — we could not read the events' takings and costs just now.">
        {(rows) => {
          const anyActual = rows.some((r) => r.actual_cents > 0);
          const anyAssumed = rows.some((r) => r.costs_saved === false);
          return (
            <div className="rpt-block">
              {/* Kit InfoRow replaces the ad-hoc .rpt-pnl button: event → name, the tap-through
                  chevron → nameExtra (still sits right next to the name, only shown when the row
                  is actually linkable), orders/gross%/fixed → meta. Revenue + net margin stay a
                  bespoke stacked pair inside trailing — k-tr lays its children out in a row, so
                  the two numbers that need to stack vertically (as they did before) still need
                  their own wrapper; .rpt-pnl-r/-rev/-m are unchanged, just relocated. A row with
                  no linkable id gets no onClick at all — same as the old disabled button: no
                  handler, no tap cursor, no navigation — so InfoRow renders it as a plain
                  non-interactive div instead of a button. No data fetching, calculations, or
                  navigation logic below changed — presentation only. */}
              <div className="k-rows">
                {rows.map((r, i) => {
                  const id = r.id;
                  // No saved costs: the net is the menu's blend and nothing fixed — say so on the row it is true of.
                  // Said short on the row (R49 — the long sentence, on every row, took four lines of each on a phone); the
                  // note under the list says what stood in for them.
                  const assumed = r.costs_saved === false ? " · costs not saved" : "";
                  return (
                    <InfoRow
                      key={i}
                      // The chevron follows the last word (R49: as the row's extra it sat at the far edge when a name wrapped).
                      name={<span>{r.event}{id ? <span className="rpt-pnl-go" aria-hidden>{"\u00a0›"}</span> : null}</span>}
                      meta={`${r.orders} orders · ${Math.round((1 - r.cogs_pct) * 100)}% gross${r.fixed_cents > 0 ? ` · ${moneyRound(r.fixed_cents)} fixed` : ""}${assumed}`}
                      trailing={
                        <div className="rpt-pnl-r">
                          <div className="rpt-pnl-rev">{moneyRound(r.actual_cents)}</div>
                          <div className={`rpt-pnl-m${r.margin_cents >= 0 ? "" : " neg"}`}>{moneyRound(r.margin_cents)} est. net</div>
                        </div>
                      }
                      onClick={id ? () => openEvent(id, r.kind) : undefined}
                    />
                  );
                })}
              </div>
              <div className="rpt-foot">{anyActual
                ? "Est. net = actual sales (Square) − ingredients at the event's cost % − the fixed costs saved for it (booth / transport / permit / consumables). Crew time is not in it."
                : "Actuals fill in from Square as you sell at each event; costs come from each event's economics."}
                {anyAssumed ? " An event with no saved costs uses the menu's blended ingredient cost and nothing fixed — save its economics to replace them." : ""}</div>
            </div>
          );
        }}
      </AsyncSection>
    </div>
  );
}
