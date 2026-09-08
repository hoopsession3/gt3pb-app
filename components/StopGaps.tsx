"use client";

import RecordGaps, { type GapConfig, type Row } from "./RecordGaps";
import { isGuestFacing, nameDriftAdvice, stopGapFix, stopStatusLabel } from "@/lib/stopRecord";

// The stops half. Three lines of vocabulary on top of the shared renderer.
//
// The one thing this half has that the events half does not: guestFacing. Three of a stop's eight
// problems are visible to somebody looking up where the truck is — a stale name, a missing pin, and
// a stop still flagged live after its window closed. Those get marked, because "the crew will
// notice eventually" and "a customer is looking at it right now" deserve different urgency.
const CFG: GapConfig = {
  view: "v_stop_gaps",
  idColumn: "stop_id",
  kind: "stop",
  fix: stopGapFix,
  guestFacing: isGuestFacing,
  // 0316: the name question is the one gap whose sentence depends on the ROW, not the rule. The
  // view now carries canonical_name, and the words come from the same function the record sheet
  // uses — so the list and the sheet cannot say different things about the same stop.
  perRow: (r: Row) =>
    r.gap === "name_drift"
      ? nameDriftAdvice(r.name as string | null, r.canonical_name as string | null)
      : null,
  right: (r: Row) => ({
    top: stopStatusLabel(r.status as string | null),
    bottom: r.starts_at ? new Date(String(r.starts_at)).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "no date",
  }),
  one: "1 stop needs sorting.",
  many: (n) => `${n} things need sorting across your stops.`,
  emptyTitle: "Every stop agrees with itself",
  emptySub: "Every stop is pinned, dated, linked to its venue and carrying the venue's current name — so what guests see matches what you meant.",
};

export default function StopGaps() {
  return <RecordGaps cfg={CFG} />;
}
