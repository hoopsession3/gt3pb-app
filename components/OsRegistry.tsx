"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { isMissingTable } from "@/lib/schemaSkew";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "@/components/kit";
import InlineCreate from "./InlineCreate";
import Icon from "@/components/Icon";
import { useCrew } from "./useCrew";
import { streamOwner, portfolioHead, freshnessOf, streamException, riskOrder } from "@/lib/portfolio";
import { useEtDay } from "@/lib/useEtDay";
import { auditQueue } from "@/lib/mondayAudit";

// The Monday audit loads when it is opened, not with Command (components/MondayAudit says what it is).
const MondayAudit = dynamic(() => import("./MondayAudit"), { ssr: false });

/* eslint-disable @typescript-eslint/no-explicit-any */
// THE WORKSTREAM REGISTRY (0264, 2026-08-03) — "the one place to manage every component and
// stream." Ten workstreams, one accountable owner each, audited every Monday on the Executive
// OS rubric: Owner · Next action · Blockers · Artifacts · Signal, 2 points each. The score is a
// search function for where management attention goes this week — not a grade. House rules,
// encoded: 10 green · 8–9 amber watch · below 8 gets named in the weekly review · below 8 two
// weeks running demands a kill / pause / recover decision IN THE LEDGER · parked-by-decision is
// legal, stalled-without-a-decision is not.

type Ws = {
  id: string; name: string; owner: string; owner_user_id: string | null; status: "active" | "blocked" | "parked";
  health: number; next_action: string | null; due: string | null; blocker: string | null;
  last_audited: string | null; sort: number; updated_at?: string | null;
};
type Audit = { workstream_id: string; week_of: string; total: number };

const dotClass = (h: number, status: string) => status === "parked" ? "park" : h >= 10 ? "green" : h >= 8 ? "amber" : "red";

export default function OsRegistry() {
  const { profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = !!profile?.is_admin || ["owner", "admin"].includes(String((profile as any)?.role ?? ""));
  const crew = useCrew();
  // The person is the id (0307); the text is what prints when the person has no account. A linked
  // owner reads by their CURRENT name, so a rename on the crew roster renames them here too. The rule
  // is lib/portfolio's, because a milestone's workstream pick on the board says the same owner.
  const ownerName = (w: Ws) => streamOwner(w, crew);

  const loader = useCallback(async (): Promise<{ rows: Ws[]; recent: Audit[] }> => {
    if (!supabase) return { rows: [], recent: [] };
    // EIGHT WEEKS A STREAM (2026-10-15, 0405): each stream's own last eight weekly totals (v_workstream_weeks). The 40
    // newest audits across the portfolio could leave a stream audited less often with none to show. Until 0405 is
    // pasted the view is not there, and the 40 newest are read, as before.
    const [w, v] = await Promise.all([
      supabase.from("os_workstreams").select("*").order("sort"),
      // arrives-with: 0405
      supabase.from("v_workstream_weeks").select("workstream_id, week_of, total").order("week_of", { ascending: false }),
    ]);
    if (w.error) throw new Error(w.error.message);
    const a = v.error && isMissingTable(v.error)
      ? await supabase.from("workstream_audits").select("workstream_id, week_of, total").order("week_of", { ascending: false }).limit(40)
      : v;
    return { rows: (w.data as Ws[]) ?? [], recent: (a.data as Audit[]) ?? [] };
  }, []);
  const state = useAsyncData(loader, []);
  const { reload } = state;
  useRealtimeTable(["os_workstreams", "workstream_audits"], reload);
  // The business's day, kept current (lib/useEtDay): how old a score is and how late a next action is are
  // read against it as the list is drawn, so a screen left open past midnight says the new day's truth.
  const today = useEtDay();

  // THE AUDIT IS A WALK, FULL SCREEN (2026-10-12, Release 2 — Ryan chose it over the smaller sheet fix). It was a
  // half-height sheet with one stream in it and no way on to the next. Now it walks the streams due, in the list's order
  // (components/MondayAudit): from the overdue line it starts at the first; from a row, at that stream — which joins the
  // walk if it is not due itself. The walk is fixed as it opens, so a save that makes a stream no longer due does not
  // move the others under the auditor's thumb.
  const [walk, setWalk] = useState<{ ids: string[]; start: number } | null>(null);
  // THE WALK IS THE PAGE'S ORDER, AND "DUE" IS THE HEAD'S WORD (2026-10-12, at integration of the audit and Command
  // rounds). A stream is due an audit when the head would not call its score Current (lib/portfolio freshnessOf: a
  // week old or more, or never scored — the rule the overdue line counted by), parked ones aside; the walk takes the streams in the order the rows are drawn
  // (riskOrder), so the page, its button and the audit's "1 of N" agree.
  const dueNow = (r: Ws) => r.status !== "parked" && freshnessOf(r.last_audited, today) !== "current";
  const openFlow = (at: Ws | undefined, ordered: Ws[]) => {
    const q = auditQueue(ordered, dueNow, at?.id);
    if (q.ids.length) setWalk(q);
  };

  const addStream = async (name: string) => {
    if (!supabase || !name.trim()) return;
    const { error } = await supabase.from("os_workstreams").insert({ name: name.trim().slice(0, 80), owner: "", health: 0, sort: 1000 });
    if (error) { toast(String(error.message).includes("unique") ? "That workstream already exists" : `Couldn't add — ${error.message}`, "error"); return; }
    toast("Added — open it to set the owner and next action"); reload();
  };

  return (
    <div className="adm-sec" id="os-registry">
      <AsyncSection state={state} isEmpty={({ rows }) => rows.length === 0} emptyTitle="No workstreams yet" loadingLabel="Loading the portfolio…" errorTitle="Couldn't load the portfolio">
        {({ rows, recent }) => {
          const active = rows.filter((r) => r.status !== "parked");
          const mean = active.length ? (active.reduce((s, r) => s + r.health, 0) / active.length) : 0;
          // Two-week rule: latest two audits both below 8 → the stream owes the ledger a decision.
          const owesDecision = (w: Ws) => {
            const mine = recent.filter((a) => a.workstream_id === w.id).slice(0, 2);
            return w.status === "active" && mine.length >= 2 && mine.every((a) => a.total < 8);
          };
          // ONE STALE FACT, SAID ONCE (2026-10-07, Ryan: "Ewww"). Every row carried its own "64d" in the
          // warning colour — the same fact, that the Monday audit had not run, nine times down the
          // screen. It became one line above the rows: how many were overdue and when the last ran.
          // DATED IN THE HEAD (2026-10-12, the Command audit, approved). That line still sat under "MEAN 7.0" —
          // the Aug 2 seed's own average on Oct 12, drawn like a fresh audit's. The number is dated where it is
          // said now, "7.0 · assessed Aug 2", with how current it is in a word beside it, Current, Due or Stale
          // (lib/portfolio portfolioHead): the stale fact, said once, in the head. Still no row counts its days;
          // a stale score is drawn in the quiet ink. The mean is the rule above, unchanged.
          const head = portfolioHead(mean, rows, today);
          const fresh = head.state === "current" || head.state === "due";
          const ordered = riskOrder(rows, { today, owes: owesDecision });
          const dueCount = ordered.filter(dueNow).length;
          return (
            <>
              <SectionHeader label="The portfolio"
                right={<>
                  <span className={`k-tag txt${!fresh ? "" : mean >= 8 ? " ok" : " warn"}`}>{head.state && <span className="sr-only">Portfolio mean </span>}{head.score}</span>
                  {head.word && <span className={`k-tag txt${head.state === "current" ? " ok" : head.state === "due" ? " gold" : " warn"}`}>{head.word}</span>}
                </>} />
              {/* THE AUDIT STARTS WHERE THE HEAD SAYS IT IS DUE (2026-10-12, at integration). The overdue line that held
                  "Start the audit" went into the head as a word (Current, Due, Stale); the action stays, under it, only
                  for the people who audit and only while a stream is due — and it walks those streams in the order
                  the rows are drawn. */}
              {isAdmin && dueCount > 0 && (
                <button type="button" className="btn-ter self-start mt-1" onClick={() => openFlow(undefined, ordered)}>
                  Start the Monday audit · {dueCount} due ›
                </button>
              )}
              {/* THE ROWS ARE THE PAGE'S, NOT CARDS ON IT (2026-10-07). Each was a card filled with a
                  see-through black made for the night console — on the cream day theme every one
                  turned muddy grey — and led with its score in a coin, which read as a rank. The name
                  leads now and the score sits at the end with a dot that says its band: 10 green, 8–9
                  gold, below 8 red. Rows sit on the page with a hairline between them, in both themes.
                  ONE LINE, ONLY WHEN SOMETHING IS WRONG (2026-10-12, the Command audit, approved). A row
                  drew its next action, its blocker and the two-week rule on lines of their own; it draws
                  its owner beside its name now, and at most one line under it — the problem that most
                  needs a leader (lib/portfolio streamException), from the row as loaded. The blocker is
                  still written in the audit sheet. The rows come risk first (lib/portfolio riskOrder):
                  stale or never scored, then an open problem, then the lowest score; parked last. */}
              <div className="osr-rows">
                {ordered.map((w) => {
                  const parked = w.status === "parked";
                  const age = freshnessOf(w.last_audited, today);
                  const line = streamException(w, { today, owesDecision: owesDecision(w) });
                  const who = ownerName(w);
                  return (
                    <button key={w.id} type="button" className={`osr-row${parked ? " parked" : ""}`} onClick={() => isAdmin && openFlow(w, ordered)} disabled={!isAdmin}
                      aria-label={`${w.name}${parked ? "" : who ? `, owned by ${who}` : ", no owner"}, ${parked ? "parked by decision" : `${w.health} of 10${age === "stale" ? ", a stale score" : age === "due" ? ", due a new score" : ""}`}${line ? `. ${line.say}` : ""}${isAdmin ? ". Opens its audit" : ""}`}>
                      <span className="osr-main">
                        <span className="osr-name">{w.name}{!parked && <span className="osr-next">{who ?? "no owner"}</span>}{w.status === "blocked" && <i className="osr-flag">blocked</i>}{parked && <i className="osr-flag park">parked by decision</i>}</span>
                        {line && (line.kind === "decision"
                          ? <span className="osr-owes truncate">⚖ {line.text}</span>
                          : <span className="osr-block">{line.kind === "blocker" && <Icon name="warning" />}<span className="min-w-0 truncate">{line.text}</span></span>)}
                      </span>
                      <span className={`osr-score ${dotClass(w.health, w.status)}${!parked && (age === "stale" || age === "never") ? " text-cream-muted!" : ""}`} aria-hidden="true">{parked ? "parked" : <><i />{w.health}<small>/10</small></>}</span>
                    </button>
                  );
                })}
              </div>
              {/* THE PAGE AT REST IS A READ VIEW (2026-10-10, the Command fold): adding a workstream is the board's
                  name-first create (components/InlineCreate), as an initiative and a milestone are — it was a field
                  left open above the rows. The method that stood over them — how the score is read — is where the
                  score is given, the Monday audit's sheet. */}
              {isAdmin && <InlineCreate label="+ Workstream" placeholder="Workstream name" className="btn-ter self-start mt-2" onCreate={addStream} />}
            </>
          );
        }}
      </AsyncSection>

      {walk && state.data && (
        <MondayAudit rows={state.data.rows} recent={state.data.recent} ids={walk.ids} start={walk.start} onReload={reload} onClose={() => setWalk(null)} />
      )}
    </div>
  );
}
