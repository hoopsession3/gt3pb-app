"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "./Icon";
import { useRecord } from "./RecordSheet";
import { gapFix, stageLabel } from "@/lib/eventRecord";
import { isGuestFacing, nameDriftAdvice, stopGapFix, stopStatusLabel } from "@/lib/stopRecord";
import { relativeDay } from "@/lib/dates";

// ONE LIST FOR THE WHOLE SCHEDULE (0324).
//
// ── WHAT THIS REPLACED ─────────────────────────────────────────────────────────────────────────
// EventGaps on the Events tab and StopGaps on the Route tab: the same panel, the same component,
// the same sentence pattern, once per tab, each with its own headline and its own tab badge.
// Measured in production before writing this — 5 rows for 3 stops, 4 rows for 3 events. Nine rows
// describing six actual problems, split across two screens you have to flip between.
//
// Two things were wrong and they are different mistakes:
//
//   ONE CONSTRUCT SHOWN TWICE. The renderer was already shared on purpose (RecordGaps' header says
//   so). Sharing the code while the product still showed it twice fixed the maintenance cost and
//   none of the experience. An event and a stop are the same thing to whoever is scanning: a dated
//   commitment the truck has to show up to.
//
//   ONE SUBJECT LISTED SEVERAL TIMES. "Wine Express — Five Forks" appeared twice — its venue name
//   drifted AND it has no recap. Two true facts, one venue, and the list read like a duplicate.
//   The VIEW is right to report both (a gap is a gap); it is the READER's job to say them under one
//   heading. That is the whole difference between "nine problems" and "six things to fix".
//
// ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
// It does not decide anything. Every diagnosis, severity and date is v_schedule_gaps'; the fix
// sentences come from each entity's own vocabulary (lib/eventRecord, lib/stopRecord), which is also
// what the record sheet says when you open it — so the list and the sheet cannot disagree about the
// same row. All this file chooses is the grouping and the order.

type Row = {
  kind: "event" | "stop";
  subject_id: string; subject: string | null;
  on_date: string | null; at: string | null;
  state: string | null; phase: string | null;
  gap: string; detail: string; severity: string;
  canonical_name: string | null;
};

type Group = { key: string; kind: Row["kind"]; subject: string; rows: Row[]; worst: number };

const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const rank = (s: string) => SEV_RANK[s] ?? 3;

// Each kind keeps its own words. A stop's status vocabulary is not an event's stage vocabulary, and
// flattening them into one set of labels would be the same mistake as flattening the two lists.
const VOCAB = {
  event: { fix: gapFix, state: stageLabel, guestFacing: () => false },
  stop: { fix: stopGapFix, state: stopStatusLabel, guestFacing: isGuestFacing },
} as const;

export default function ScheduleGaps() {
  const { openRecord } = useRecord();

  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("v_schedule_gaps")
      .select("kind, subject_id, subject, on_date, at, state, phase, gap, detail, severity, canonical_name");
    if (error) throw new Error(error.message);
    return (data as Row[]) ?? [];
  }, []);
  const state = useAsyncData<Row[]>(loader, []);

  return (
    <AsyncSection
      state={state}
      isEmpty={(rows) => rows.length === 0}
      emptyTitle="The schedule agrees with itself"
      emptySub="Every event and every stop is dated, pinned, carrying its venue's current name, and nothing is still being planned after the day it happened."
      loadingLabel="Checking the schedule…"
      errorTitle="Couldn't run the check"
      errorSub="This is not the same as nothing being wrong — we could not read it just now."
    >
      {(rows) => {
        // One entry per SUBJECT, its problems gathered underneath. Ordered worst-first, then by
        // date, so what is both urgent and imminent leads — a list sorted by date alone files
        // "still marked confirmed five weeks later" in the past, where nobody scrolls.
        const byId = new Map<string, Group>();
        for (const r of rows) {
          const key = `${r.kind}:${r.subject_id}`;
          const g = byId.get(key) ?? { key, kind: r.kind, subject: r.subject ?? "—", rows: [], worst: 9 };
          g.rows.push(r);
          g.worst = Math.min(g.worst, rank(r.severity));
          byId.set(key, g);
        }
        const groups = [...byId.values()].sort((a, b) =>
          a.worst - b.worst ||
          (a.rows[0].on_date ?? "").localeCompare(b.rows[0].on_date ?? "") ||
          a.subject.localeCompare(b.subject));

        // The count is SUBJECTS, not rows. Saying "9" when there are six things to open would be
        // the old two-panel arithmetic wearing one headline.
        const n = groups.length;
        const problems = rows.length;

        return (
          <div className="evg">
            <p className="so-head due">
              {n === 1 ? "1 thing needs sorting." : `${n} things need sorting across your schedule.`}
              {problems > n && <span className="dim"> {problems} problems in all.</span>}
            </p>
            <div className="so-rows">
              {groups.map((g) => {
                const v = VOCAB[g.kind];
                const first = g.rows[0];
                return (
                  <button type="button" key={g.key} className="so-row"
                          onClick={() => openRecord(g.kind, first.subject_id)}>
                    <span className={`evg-sev sev-${first.severity}`} aria-hidden="true" />
                    <span className="so-row-b">
                      <b>
                        {g.subject}
                        {/* The space matters: without it the accessible name reads as one token. */}
                        {g.rows.some((r) => v.guestFacing(r.gap)) && <>{" "}<span className="str-guest">guests see this</span></>}
                      </b>
                      {g.rows.map((r) => {
                        // 0316's rule, kept: the name question is the one gap whose sentence depends
                        // on the ROW rather than the rule, and the row carries both names.
                        const said = r.kind === "stop" && r.gap === "name_drift"
                          ? nameDriftAdvice(r.subject, r.canonical_name) : null;
                        return (
                          <i key={r.gap}>
                            {g.rows.length > 1 && <span className="sg-b" aria-hidden="true">· </span>}
                            {said?.detail ?? r.detail} {said?.fix ?? v.fix(r.gap)}
                          </i>
                        );
                      })}
                    </span>
                    <span className="so-row-m">
                      <b>{v.state(first.state)}</b>
                      <i>{first.on_date ? relativeDay(first.on_date) : "no date"}</i>
                    </span>
                    <span className="so-row-c" aria-hidden="true"><Icon name="arrowRight" /></span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      }}
    </AsyncSection>
  );
}
