"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "./Icon";
import { useRecord } from "./RecordSheet";
import { gapFix, sortGaps, stageLabel } from "@/lib/eventRecord";

// WHAT THE EVENT LIST CANNOT TELL YOU (0314).
//
// v_event_gaps names every way an event row contradicts itself or the calendar. Put on the events
// screen because that is where somebody would act on it, and above the list because a list sorted
// by date will never surface "this one is still marked confirmed five weeks after it happened" —
// it just puts it in the past, where nobody scrolls.
//
// Archived events are excluded by the view: an archived mistake is filed, not outstanding. That
// distinction is why this reads as four things to chase rather than a wall of red — running it
// against production the first time turned up nine problems, and five of them were already filed.

type Row = {
  event_id: string; title: string; day: string | null; stage: string | null;
  phase: string | null; gap: string; detail: string; severity: string;
};

export default function EventGaps() {
  const { openRecord } = useRecord();
  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("v_event_gaps")
      .select("event_id, title, day, stage, phase, gap, detail, severity");
    if (error) throw new Error(error.message);
    return sortGaps((data as Row[]) ?? []);
  }, []);
  const state = useAsyncData<Row[]>(loader, []);

  return (
    <AsyncSection state={state}
      isEmpty={(rows) => rows.length === 0}
      emptyTitle="Every event agrees with itself"
      emptySub="No blank titles, no missing dates, no duplicates, nothing finished before it happened and nothing still being planned after its day."
      loadingLabel="Checking the events…" errorTitle="Couldn't check the events">
      {(rows) => (
        <div className="evg">
          <p className="so-head due">
            {rows.length === 1 ? "1 event needs sorting." : `${rows.length} things need sorting across your events.`}
          </p>
          <div className="so-rows">
            {rows.map((r) => (
              <button type="button" key={`${r.event_id}:${r.gap}`} className="so-row"
                      onClick={() => openRecord("event", r.event_id)}>
                <span className={`evg-sev sev-${r.severity}`} aria-hidden="true" />
                <span className="so-row-b">
                  <b>{r.title}</b>
                  <i>{r.detail} {gapFix(r.gap)}</i>
                </span>
                <span className="so-row-m">
                  <b>{stageLabel(r.stage)}</b>
                  <i>{r.day ?? "no date"}</i>
                </span>
                <span className="so-row-c" aria-hidden="true"><Icon name="arrowRight" /></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </AsyncSection>
  );
}
