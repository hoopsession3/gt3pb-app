"use client";

import CountUp from "./CountUp";
import { useEffect, useRef, type ReactNode } from "react";
import Icon from "@/components/Icon";

export type ReceiptRow = { label: string; value: string };

// ORDER CONFIRM — the one "you're in" screen every purchase flow renders after a successful order:
// crest + animated total + itemized receipt + primary CTA (+ optional secondary "not now"). Cup,
// pickup, and delivery each hand-rolled their own version before this — cup's was a flat checkmark
// with no total or receipt, pickup/delivery already had this exact shape (OrderFunnel's dl-done).
// One component now, reused by all three — the "you're in" moment reads identically everywhere.
export default function OrderConfirm({
  title, sub, totalCents, totalLabel = "paid", rows, warn, note, aside, ctaLabel, onCta, secondaryLabel, onSecondary,
}: {
  title: string;
  sub?: string;
  totalCents: number;
  totalLabel?: string; // eyebrow over the big number — "paid" ONLY when money actually moved
  rows: ReceiptRow[];
  warn?: string;
  note?: string; // quiet what-to-do-next line (e.g. bring your empties) — informational, not an alert
  aside?: ReactNode; // one quiet offer above the button (the cup checkout's "Ping me when it's ready", R7)
  ctaLabel: string;
  onCta: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  // Said when it appears (R7b): the button that was pressed is gone, and focus with it — VoiceOver heard nothing of "Order
  // #4F2A is in". Focus moves to the headline, inside the sheet, so the screen reader reads where things stand.
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // From the top (the re-audit of R7b): the sheet kept the scroll Pay was tapped at, so on an iPhone SE the crest and the
    // headline sat above the fold and the screen opened on the receipt.
    head.current?.closest(".sheet2-body")?.scrollTo({ top: 0 });
    head.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="dl-step dl-done">
      <div className="dl-crest"><span><Icon name="check" /></span></div>
      <h2 ref={head} tabIndex={-1} className="dl-h serif dl-done-h">{title}</h2>
      {sub && <p className="dl-done-sub">{sub}</p>}
      <div className="dl-done-total" data-eyebrow={totalLabel}><CountUp cents={totalCents} /></div>
      {rows.length > 0 && (
        <div className="dl-receipt">
          {rows.map((r, i) => <div className="dl-receipt-row" key={i}><span>{r.label}</span><b>{r.value}</b></div>)}
        </div>
      )}
      {warn && <p className="dl-err" role="alert">{warn}</p>}
      {note && <p className="dl-notebox">{note}</p>}
      {aside}
      <button type="button" className="btn-pri btn-wide mt-4" onClick={onCta}>{ctaLabel}</button>
      {secondaryLabel && onSecondary && <button type="button" className="sub-link" onClick={onSecondary}>{secondaryLabel}</button>}
    </div>
  );
}
