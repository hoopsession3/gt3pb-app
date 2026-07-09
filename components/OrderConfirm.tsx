"use client";

import CountUp from "./CountUp";

export type ReceiptRow = { label: string; value: string };

// ORDER CONFIRM — the one "you're in" screen every purchase flow renders after a successful order:
// crest + animated total + itemized receipt + primary CTA (+ optional secondary "not now"). Cup,
// pickup, and delivery each hand-rolled their own version before this — cup's was a flat checkmark
// with no total or receipt, pickup/delivery already had this exact shape (OrderFunnel's dl-done).
// One component now, reused by all three — the "you're in" moment reads identically everywhere.
export default function OrderConfirm({
  title, sub, totalCents, rows, warn, ctaLabel, onCta, secondaryLabel, onSecondary,
}: {
  title: string;
  sub?: string;
  totalCents: number;
  rows: ReceiptRow[];
  warn?: string;
  ctaLabel: string;
  onCta: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="dl-step dl-done">
      <div className="dl-crest"><span>✓</span></div>
      <h2 className="dl-h dl-done-h">{title}</h2>
      {sub && <p className="dl-done-sub">{sub}</p>}
      <div className="dl-done-total"><CountUp cents={totalCents} /></div>
      {rows.length > 0 && (
        <div className="dl-receipt">
          {rows.map((r, i) => <div className="dl-receipt-row" key={i}><span>{r.label}</span><b>{r.value}</b></div>)}
        </div>
      )}
      {warn && <p className="dl-err" role="alert">{warn}</p>}
      <button type="button" className="oa-cta" style={{ marginTop: 16 }} onClick={onCta}>{ctaLabel}</button>
      {secondaryLabel && onSecondary && <button type="button" className="sub-link" onClick={onSecondary}>{secondaryLabel}</button>}
    </div>
  );
}
