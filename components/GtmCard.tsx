"use client";

import { useEffect, useState } from "react";

// GTM DEFINITION — the one place the go-to-market motion is stated, so both founders operate from
// the same definition instead of a text thread. Internal (crew) surface. The two anchors today:
//   • Mondays = small-business delivery day (the repeatable market motion)
//   • Aug 1 = internal readiness goal (the milestone we're driving to)
// Content is intentionally a constant — a GTM definition is stable, not live data. Editing it in-app
// (a config row) is a deliberate fast-follow, not worth a customer-facing migration today.

const READINESS = { label: "Aug 1", iso: "2026-08-01", note: "Internal readiness goal" };

export default function GtmCard() {
  // Clock read client-side only — /crew is prerendered, so a render-time new Date() would mismatch
  // the browser on hydration (React #418). null on SSR + first client render, then filled by effect.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

  const days = now ? Math.ceil((new Date(`${READINESS.iso}T00:00:00`).getTime() - now.getTime()) / 86400000) : null;
  const count = days == null ? "" : days > 1 ? `${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : "reached";

  return (
    <div className="gtm" role="group" aria-label="Go-to-market">
      <div className="gtm-eyb">Go-to-market</div>
      <div className="gtm-rows">
        <div className="gtm-row">
          <span className="gtm-ic" aria-hidden>🗓️</span>
          <span className="gtm-main"><b>Mondays</b><span>Small-business delivery day</span></span>
        </div>
        <div className="gtm-row">
          <span className="gtm-ic" aria-hidden>🎯</span>
          <span className="gtm-main"><b>{READINESS.label}</b><span>{READINESS.note}</span></span>
          {count && <span className={`gtm-count${days != null && days <= 7 ? " near" : ""}`}>{count}</span>}
        </div>
      </div>
    </div>
  );
}
