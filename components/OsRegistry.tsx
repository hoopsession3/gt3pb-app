"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "@/components/kit";
import InlineCreate from "./InlineCreate";
import Icon from "@/components/Icon";
import { useCrew } from "./useCrew";
import { streamOwner } from "@/lib/portfolio";
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
  last_audited: string | null; sort: number;
};
type Audit = { id: string; workstream_id: string; week_of: string; total: number };

const dotClass = (h: number, status: string) => status === "parked" ? "park" : h >= 10 ? "green" : h >= 8 ? "amber" : "red";
const nice = (iso: string | null) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const daysSince = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 864e5) : null;
// THE AUDIT WALKS THE STREAMS THE LINE COUNTS (2026-10-12). Opened from the overdue line, the Monday audit goes through
// the streams that line counts as due — not parked, last audited seven or more days ago or never — by the line's own
// sum, so "3 of 10 are due" and the audit's "1 of 3" agree. scripts/smoke.cjs holds the two to the same words.
const dueNow = (r: Ws) => r.status !== "parked" && (daysSince(r.last_audited) ?? 99) >= 7;

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
    const [w, a] = await Promise.all([
      supabase.from("os_workstreams").select("*").order("sort"),
      supabase.from("workstream_audits").select("id, workstream_id, week_of, total").order("week_of", { ascending: false }).limit(40),
    ]);
    if (w.error) throw new Error(w.error.message);
    return { rows: (w.data as Ws[]) ?? [], recent: (a.data as Audit[]) ?? [] };
  }, []);
  const state = useAsyncData(loader, []);
  const { reload } = state;
  useRealtimeTable(["os_workstreams", "workstream_audits"], reload);

  // THE AUDIT IS A WALK, FULL SCREEN (2026-10-12, Release 2 — Ryan chose it over the smaller sheet fix). It was a
  // half-height sheet with one stream in it and no way on to the next. Now it walks the streams due, in the list's order
  // (components/MondayAudit): from the overdue line it starts at the first; from a row, at that stream — which joins the
  // walk if it is not due itself. The walk is fixed as it opens, so a save that makes a stream no longer due does not
  // move the others under the auditor's thumb.
  const [walk, setWalk] = useState<{ ids: string[]; start: number } | null>(null);
  const openFlow = (at?: Ws) => {
    const q = auditQueue(state.data?.rows ?? [], dueNow, at?.id);
    if (q.ids.length) setWalk(q);
  };
  const openAudit = (w: Ws) => openFlow(w);

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
          // screen. It is one line above the rows now: how many are overdue and when the last ran.
          const lastRun = rows.map((r) => r.last_audited).filter(Boolean).sort().pop() ?? null;
          const overdue = active.filter((r) => (daysSince(r.last_audited) ?? 99) >= 7).length;
          return (
            <>
              <SectionHeader label="The portfolio" annotation="ten workstreams · audited Mondays"
                right={<span className={`k-tag ${mean >= 8 ? "ok" : "warn"}`}>mean {mean.toFixed(1)}</span>} />
              {overdue > 0 && (
                <p className="osr-due flex items-start gap-2 mt-2.5 mb-0.5 px-3 py-2.5 border border-line2 rounded-lg font-sans text-footnote leading-[1.45] text-cream" role="status">
                  <Icon name="warning" />
                  <span>{overdue === active.length ? "The Monday audit is overdue" : `${overdue} of ${active.length} workstreams are due an audit`}{lastRun ? ` — last run ${nice(lastRun)}, ${daysSince(lastRun)} days ago` : " — none has been run yet"}.{isAdmin && <> <button type="button" className="btn-ter" onClick={() => openFlow()}>Start the audit</button></>}</span>
                </p>
              )}
              {/* THE ROWS ARE THE PAGE'S, NOT CARDS ON IT (2026-10-07). Each was a card filled with a
                  see-through black made for the night console — on the cream day theme every one
                  turned muddy grey — and led with its score in a coin, which read as a rank. The name
                  leads now, the owner starts the line under it, and the score sits at the end with a
                  dot that says its band: 10 green, 8–9 gold, below 8 red. Rows sit on the page with a
                  hairline between them, in both themes. */}
              <div className="osr-rows">
                {rows.map((w) => (
                  <button key={w.id} type="button" className={`osr-row${w.status === "parked" ? " parked" : ""}`} onClick={() => isAdmin && openAudit(w)} disabled={!isAdmin} aria-label={`${w.name}, ${w.status === "parked" ? "parked" : `${w.health} of 10`}${isAdmin ? " — audit it" : ""}`}>
                    <span className="osr-main">
                      <span className="osr-name">{w.name}{w.status === "blocked" && <i className="osr-flag">blocked</i>}{w.status === "parked" && <i className="osr-flag park">parked by decision</i>}</span>
                      {w.status !== "parked" && (
                        <span className="osr-next"><b className="osr-who">{ownerName(w)}</b> · {w.next_action ?? "no next action — that's a 0 on criterion 2"}{w.due ? ` · ${nice(w.due)}` : ""}</span>
                      )}
                      {w.blocker && w.status !== "parked" && <span className="osr-block"><Icon name="warning" /> {w.blocker}</span>}
                      {owesDecision(w) && <span className="osr-owes">⚖ two weeks below 8 — log kill / pause / recover in the ledger (Plan › Operating rhythm)</span>}
                    </span>
                    <span className={`osr-score ${dotClass(w.health, w.status)}`} aria-hidden="true">{w.status === "parked" ? "parked" : <><i />{w.health}<small>/10</small></>}</span>
                  </button>
                ))}
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
