"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { haptic } from "@/lib/haptics";
import { windowHours } from "@/lib/office";
import { byDate, calendarMonths, cutoffLabel, dayLabel, deliveryState, monthGrid, monthLabel, type OfficeDelivery } from "@/lib/officeStatus";

// YOUR CALENDAR (2026-10-07, Phase 2A-2 — the mock's screen A). The six weeks the schedule keeps, as a
// month: every delivery day marked, a skip hollow, today underlined. A delivery day is a button — it opens
// that delivery's change sheet — and says everything to a screen reader (the day, the gallons, the
// state, when changes close); a day with nothing on it is only a number. The months run from this one
// to the last delivery's; the page's realtime reload redraws it the moment the crew or a colleague
// changes something.

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export default function OfficeCalendar({ agenda, today, now, onPick }: {
  agenda: OfficeDelivery[];
  today: string;
  now: number;
  onPick: (d: OfficeDelivery) => void;
}) {
  const months = calendarMonths(agenda, today);
  const first = agenda.find((d) => !d.canceled)?.date ?? today;
  const [i, setI] = useState(() => Math.max(0, months.findIndex((m) => `${m.year}-${String(m.month0 + 1).padStart(2, "0")}` === first.slice(0, 7))));
  const at = Math.min(i, months.length - 1);
  const { year, month0 } = months[at];
  const days = byDate(agenda);
  const go = (by: number) => { haptic("selection"); setI(Math.min(months.length - 1, Math.max(0, at + by))); };

  return (
    <div className="flex flex-col gap-2 mt-2">
      <div className="flex items-center gap-2">
        <h3 className="m-0 flex-1 font-sans font-bold text-body text-cream">{monthLabel(year, month0)}</h3>
        {/* the kit's round button, written out: the kit's module carries its segmented control too, which
            only the change sheet uses — this page loads without it (scripts/design.ratchet.mjs WEIGHT) */}
        <button type="button" className={`k-icon-btn${at === 0 ? " invisible" : ""}`} onClick={() => go(-1)} aria-label="Previous month" title="Previous month"><Icon name="chevronLeft" /></button>
        <button type="button" className={`k-icon-btn${at === months.length - 1 ? " invisible" : ""}`} onClick={() => go(1)} aria-label="Next month" title="Next month"><Icon name="chevronRight" /></button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center" aria-hidden="true">
        {WEEKDAYS.map((w, k) => <span key={k} className="font-mono text-caption2 tracking-[.12em] text-cream-dim">{w}</span>)}
      </div>
      {monthGrid(year, month0).map((week) => (
        <div key={week[0].key} className="grid grid-cols-7 gap-y-1 text-center">
          {week.map((c) => {
            const on = c.inMonth ? days[c.key] : undefined;
            const past = c.key < today;
            if (!on?.length) {
              return <span key={c.key} className={`mx-auto grid place-items-center size-11 rounded-pill font-sans text-subhead tabular-nums${c.inMonth ? (past ? " text-cream-dim" : " text-cream-muted") : " invisible"}${c.key === today ? " underline decoration-2 underline-offset-4 decoration-gold2" : ""}`}>{c.day}</span>;
            }
            const d = on.find((x) => !x.canceled) ?? on[0];
            const st = deliveryState(d);
            const live = !d.canceled;
            const cut = cutoffLabel(d.cutoff_at, d.market, now);
            const say = `${dayLabel(d.date, true)}: ${Math.round(d.gallons)} gallons, ${windowHours(d.window)}, ${st.label.toLowerCase()}${live && cut && !cut.closed && st.key === "scheduled" ? `. Changes close ${cut.when}` : ""}${on.length > 1 ? ` — ${on.length} deliveries` : ""}`;
            return (
              <button key={c.key} type="button" onClick={() => { haptic("light"); onPick(d); }} aria-label={say}
                className={`mx-auto relative grid place-items-center size-11 rounded-pill font-sans font-bold text-subhead tabular-nums cursor-pointer border ${
                  live ? (st.key === "delivered" ? "bg-card border-line2 text-cream-muted" : "bg-gold2 border-gold2 text-char") : "bg-transparent border-dashed border-cream-dim text-cream-muted line-through"}${c.key === today ? " underline decoration-2 underline-offset-4" : ""}`}>
                {c.day}
              </button>
            );
          })}
        </div>
      ))}
      <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-caption text-cream-muted">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-pill bg-gold2" aria-hidden="true" /> Delivery</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-pill border border-dashed border-cream-dim" aria-hidden="true" /> Skipped</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-pill bg-card border border-line2" aria-hidden="true" /> Delivered</span>
        <span className="text-cream-dim">Tap a day to change it</span>
      </p>
    </div>
  );
}
