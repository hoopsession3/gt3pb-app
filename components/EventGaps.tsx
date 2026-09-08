"use client";

import RecordGaps, { type GapConfig, type Row } from "./RecordGaps";
import { gapFix, stageLabel } from "@/lib/eventRecord";

// The events half of the gap check. All of the rendering lives in RecordGaps — this file is the
// entity's vocabulary and nothing else, which is what stopped the stop version from being a copy
// of this one with three strings changed.
const CFG: GapConfig = {
  view: "v_event_gaps",
  idColumn: "event_id",
  kind: "event",
  fix: gapFix,
  right: (r: Row) => ({
    top: stageLabel(r.stage as string | null),
    bottom: (r.day as string | null) ?? "no date",
  }),
  one: "1 event needs sorting.",
  many: (n) => `${n} things need sorting across your events.`,
  emptyTitle: "Every event agrees with itself",
  emptySub: "No blank titles, no missing dates, no duplicates, nothing finished before it happened and nothing still being planned after its day.",
};

export default function EventGaps() {
  return <RecordGaps cfg={CFG} />;
}
