"use client";

import { useEffect, useState } from "react";
import { InfoRow } from "@/components/kit";
import Icon from "@/components/Icon";

// GTM DEFINITION — the one place the go-to-market motion is stated, so both founders operate from
// the same definition instead of a text thread. Internal (crew) surface. The two anchors today:
//   • Mondays = small-business delivery day (the repeatable market motion)
//   • Aug 1 = internal readiness goal (the milestone we're driving to)
// Content is intentionally a constant — a GTM definition is stable, not live data. Editing it in-app
// (a config row) is a deliberate fast-follow, not worth a customer-facing migration today.
//
// Rows are kit <InfoRow>s. An anchor becomes tappable ONLY when the parent supplies its handler
// (onOpenSchedule / onOpenInitiative): those rows get button semantics + a trailing caret. Without a
// handler the row renders as plain, non-interactive info — no caret, no pointer, no false affordance.

const READINESS = { label: "Aug 1", iso: "2026-08-01", note: "Internal readiness goal" };

type GtmCardProps = {
  /** Open the small-business delivery-day schedule. Omit to render the "Mondays" row as plain, non-interactive info. */
  onOpenSchedule?: () => void;
  /** Open the internal readiness initiative. Omit to render the "Aug 1" row as plain, non-interactive info. */
  onOpenInitiative?: () => void;
};

export default function GtmCard({ onOpenSchedule, onOpenInitiative }: GtmCardProps) {
  // Clock read client-side only — /crew is prerendered, so a render-time new Date() would mismatch
  // the browser on hydration (React #418). null on SSR + first client render, then filled by effect.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

  const days = now ? Math.ceil((new Date(`${READINESS.iso}T00:00:00`).getTime() - now.getTime()) / 86400000) : null;
  const count = days == null ? "" : days > 1 ? `${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : "reached";

  // Trailing caret — the interactive affordance. Rendered ONLY on rows that carry a handler.
  const caret = <span aria-hidden style={{ color: "var(--cream-m)", fontSize: 16, lineHeight: 1 }}>›</span>;

  // Readiness count badge — unchanged content/logic; lives in the trailing slot alongside the caret.
  const countBadge = count
    ? <span className={`gtm-count${days != null && days <= 7 ? " near" : ""}`}>{count}</span>
    : null;
  const initiativeTrailing = countBadge || onOpenInitiative
    ? <>{countBadge}{onOpenInitiative ? caret : null}</>
    : undefined;

  return (
    <div className="gtm" role="group" aria-label="Go-to-market">
      <div className="gtm-eyb">Go-to-market</div>
      <div className="k-rows">
        <InfoRow
          name={<><span className="gtm-ic" aria-hidden><Icon name="calendar" /></span>Mondays</>}
          sub="Small-business delivery day"
          onClick={onOpenSchedule}
          ariaLabel={onOpenSchedule ? "Open delivery-day schedule" : undefined}
          trailing={onOpenSchedule ? caret : undefined}
        />
        <InfoRow
          name={<><span className="gtm-ic" aria-hidden><Icon name="target" /></span>{READINESS.label}</>}
          sub={READINESS.note}
          onClick={onOpenInitiative}
          ariaLabel={onOpenInitiative ? "Open readiness initiative" : undefined}
          trailing={initiativeTrailing}
        />
      </div>
    </div>
  );
}
