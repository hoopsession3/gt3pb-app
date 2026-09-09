"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";

// WHAT IS OVERDUE — the answer the owner home could not give.
//
// Reads v_obligations (0320) and nothing else. Every row, every sentence and every date comes from
// the view, so this screen cannot disagree with the database about what is late. The only decisions
// made here are the order and how many to show before folding.
//
// Deliberately NOT a count of everything. "17 obligations" is a number; "the nitro tap is 69 days
// past its service date" is a thing somebody can act on. So the list leads with the individual
// overdue items, worst first, and the totals live behind them rather than in front.
//
// The three deadline families that already have cron sweepers — event tasks, brew batches and
// reserve holds — are absent by design (see 0320's header). They reach a phone through the alert
// spine; showing them here too would tell somebody twice.

type Row = {
  source: string; subject_id: string; area: string; kind: string;
  title: string; detail: string; due_on: string; days_out: number;
  severity: "overdue" | "soon" | "upcoming"; route: string; market: string | null;
};

const SHOW = 5;

const ageWord = (d: number) =>
  d < 0 ? `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} late`
  : d === 0 ? "due today"
  : `in ${d} day${d === 1 ? "" : "s"}`;

export default function Owed({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);

  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("v_obligations")
      .select("source, subject_id, area, kind, title, detail, due_on, days_out, severity, route, market")
      .neq("severity", "upcoming")
      .order("due_on", { ascending: true })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data as Row[]) ?? [];
  }, []);
  const state = useAsyncData<Row[]>(loader, []);

  return (
    <AsyncSection
      state={state}
      isEmpty={(rows) => rows.length === 0}
      // An empty attention list is the system working, and should read that way rather than as an
      // absence of data.
      emptyTitle="Nothing overdue"
      emptySub="Equipment service, permits, certifications, offers, invoices, agreements, goals and to-dos are all inside their dates."
      loadingLabel="Checking what's owed…"
      errorTitle="Couldn't check what's overdue"
      errorSub="This is not the same as nothing being overdue — we could not read it just now."
    >
      {(rows) => {
        const late = rows.filter((r) => r.severity === "overdue");
        const soon = rows.filter((r) => r.severity === "soon");
        const shown = open ? rows : rows.slice(0, compact ? 3 : SHOW);
        return (
          <div className="owed">
            <div className="owed-head">
              <span className="owed-k">Owed</span>
              <b>
                {late.length > 0
                  ? `${late.length} overdue`
                  : `${soon.length} due soon`}
                {late.length > 0 && soon.length > 0 && <span className="dim"> · {soon.length} due soon</span>}
              </b>
            </div>

            {shown.map((r) => (
              <a key={`${r.source}:${r.subject_id}`} className={`owed-row${r.severity === "overdue" ? " late" : ""}`} href={r.route}>
                <span className="owed-row-b">
                  <b>{r.title}</b>
                  <i>{r.kind} · {r.detail}</i>
                </span>
                {/* The word, not just the colour — a red row that does not say "late" is a colour. */}
                <span className="owed-age">{ageWord(Number(r.days_out))}</span>
                <span className="owed-c" aria-hidden="true">›</span>
              </a>
            ))}

            {rows.length > shown.length && (
              <button type="button" className="owed-more" onClick={() => setOpen(true)}>
                Show the other {rows.length - shown.length} <span aria-hidden="true">›</span>
              </button>
            )}
            {open && rows.length > (compact ? 3 : SHOW) && (
              <button type="button" className="owed-more" onClick={() => setOpen(false)}>Show fewer</button>
            )}
          </div>
        );
      }}
    </AsyncSection>
  );
}
