"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "./Icon";
import { useRecord } from "./RecordSheet";
import { sortGaps } from "@/lib/eventRecord";
import type { RecordKind } from "@/lib/records";

// WHAT A LIST CANNOT TELL YOU (0314 for events, 0315 for stops).
//
// A gap view names every way a row contradicts itself or the calendar. This renders one, and it is
// deliberately ONE component rather than two near-identical ones — EventGaps was written first and
// StopGaps would have been a copy with three strings changed. Copy-drift between near-identical
// surfaces is the thing this whole audit is about; writing the second copy would have been the
// clearest possible way to miss the point.
//
// It sits ABOVE the list it belongs to, because a list sorted by date will never surface "still
// marked confirmed five weeks after it happened" — it files that in the past, where nobody scrolls.

export type GapConfig = {
  /** the security_invoker view to read */
  view: string;
  /** the column on that view holding the record id */
  idColumn: string;
  /** which record sheet a row opens */
  kind: RecordKind;
  /** the diagnosis is in the view; the fix sentence comes from the entity's own vocabulary */
  fix: (gap: string | null | undefined) => string;
  /** optional: mark the gaps a customer can see */
  guestFacing?: (gap: string | null | undefined) => boolean;
  /** the second column: what to show on the right of each row */
  right: (row: Row) => { top: string; bottom: string };
  one: string;
  many: (n: number) => string;
  emptyTitle: string;
  emptySub: string;
};

export type Row = Record<string, unknown> & {
  gap: string; detail: string; severity: string;
};

export default function RecordGaps({ cfg }: { cfg: GapConfig }) {
  const { openRecord } = useRecord();
  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from(cfg.view).select("*");
    if (error) throw new Error(error.message);
    return sortGaps((data as Row[]) ?? []);
  }, [cfg.view]);
  const state = useAsyncData<Row[]>(loader, [cfg.view]);

  return (
    <AsyncSection state={state}
      isEmpty={(rows) => rows.length === 0}
      emptyTitle={cfg.emptyTitle} emptySub={cfg.emptySub}
      loadingLabel="Checking…" errorTitle="Couldn't run the check">
      {(rows) => (
        <div className="evg">
          <p className="so-head due">{rows.length === 1 ? cfg.one : cfg.many(rows.length)}</p>
          <div className="so-rows">
            {rows.map((r) => {
              const id = String(r[cfg.idColumn] ?? "");
              const right = cfg.right(r);
              return (
                <button type="button" key={`${id}:${r.gap}`} className="so-row"
                        onClick={() => id && openRecord(cfg.kind, id)}>
                  <span className={`evg-sev sev-${r.severity}`} aria-hidden="true" />
                  <span className="so-row-b">
                    <b>
                      {String(r.name ?? r.title ?? "—")}
                      {cfg.guestFacing?.(r.gap) && <span className="str-guest">guests see this</span>}
                    </b>
                    <i>{r.detail} {cfg.fix(r.gap)}</i>
                  </span>
                  <span className="so-row-m">
                    <b>{right.top}</b>
                    <i>{right.bottom}</i>
                  </span>
                  <span className="so-row-c" aria-hidden="true"><Icon name="arrowRight" /></span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </AsyncSection>
  );
}
