"use client";

import { useState } from "react";
import { useAuth, roleOf } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import { STRATEGY_CORE, GTM_PLAYS, GOVERNANCE, FLYWHEEL, STRATEGY_REV, type GtmPlay } from "@/lib/strategy";
import { StrategyThread, DecisionLog, PlayBuilder, useDrafts } from "@/components/StrategyCollab";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";

// THE PLAYBOOK — the whole strategy on one owner screen, and now a working document: every block
// and play carries a live discussion thread (owners get pinged), the guided builder walks you
// through building or overhauling a play, and governance is enforced by shape — an append-only
// decision log and locked who-changes-what rules. Content renders from lib/strategy (traced to
// the locked strategy doc); collaboration state lives in Supabase (0140). Owner/admin only.

const STATUS_LABEL = { active: "ACTIVE", planning: "PLANNING", "phase-2": "PHASE 2" } as const;
const keyFor = (name: string) => "gtm:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default function PlaybookPage() {
  const { profile, enabled } = useAuth();
  const [open, setOpen] = useState<string | null>(null); // which thread is open
  const [builder, setBuilder] = useState<null | { prefill: GtmPlay | null }>(null);
  const { drafts, reload } = useDrafts();
  if (!enabled) return null;
  const role = roleOf(profile);
  if (role !== "owner" && role !== "admin") {
    return (
      <section className="screen" id="s-playbook">
        <Masthead eyebrow="The Playbook" right={<AccountPill />} />
        <h2 className="dl-h">Owners only</h2>
        <p className="dl-sub">The playbook is the business itself — sign in with an owner or admin account.</p>
      </section>
    );
  }
  const Discuss = ({ k, label }: { k: string; label: string }) => (
    <>
      <button type="button" className="st-discuss" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>💬 {open === k ? "Close" : "Discuss"}</button>
      {open === k && <StrategyThread k={k} label={label} />}
    </>
  );

  return (
    <section className="screen" id="s-playbook">
      <Masthead eyebrow="The Playbook" right={<AccountPill />} />

      <h1 className="k-title">How GT3 wins.</h1>
      <p className="k-cap">{STRATEGY_REV} · lives in GT3-Brew-Business-Strategy.md — this page renders it, never forks it</p>

      <SectionHeader label="The Flywheel" annotation="how one guest compounds" />
      <ol className="pb-loop">
        {FLYWHEEL.map((s, i) => <li key={i}><span className="pb-loop-n">{i + 1}</span><span>{s}</span></li>)}
      </ol>

      <SectionHeader label="The Foundations" annotation="locked · tap 💬 to talk it through" />
      {STRATEGY_CORE.map((b) => (
        <div className="pb-block" key={b.h}>
          <div className="pb-block-h">{b.h}</div>
          {b.lines.map((l, i) => <p key={i} className="pb-line">{l}</p>)}
          <Discuss k={"core:" + b.h.toLowerCase().replace(/[^a-z0-9]+/g, "-")} label={b.h} />
        </div>
      ))}

      <SectionHeader label="Growth Plays" annotation="projected ROI · where the app runs it" />
      {builder ? (
        <PlayBuilder prefill={builder.prefill} onDone={() => { setBuilder(null); reload(); }} />
      ) : (
        <>
          <button type="button" className="btn-pri" onClick={() => setBuilder({ prefill: null })}>＋ Build a play</button>
          <p className="k-sub">Seven guided steps — name it, aim it, plan it, put honest numbers on it, wire it to the app. Saves as a draft for discussion.</p>
        </>
      )}
      {drafts.map((d) => (
        <div className="pb-play st-draft" key={d.id}>
          <div className="pb-play-top">
            <b>{d.name}</b>
            <span className="pb-status planning">DRAFT{d.overhauls ? " · OVERHAUL" : ""}</span>
          </div>
          {d.overhauls && <p className="dl-sub">Overhauls: {d.overhauls}</p>}
          <p className="pb-line">{d.what}</p>
          {(d.projected_revenue || d.payback) && <p className="pb-roi"><b>{[d.projected_revenue, d.payback && `payback ${d.payback}`].filter(Boolean).join(" · ")}</b></p>}
          {d.in_app && <p className="pb-inapp">{d.in_app}</p>}
          <p className="st-when">drafted by {d.author_name?.split(" ")[0] || "an owner"}</p>
          <Discuss k={"draft:" + d.id} label={`Draft: ${d.name}`} />
        </div>
      ))}
      {GTM_PLAYS.map((p) => (
        <div className="pb-play" key={p.name}>
          <div className="pb-play-top">
            <b>{p.name}</b>
            <span className={`pb-status ${p.status}`}>{STATUS_LABEL[p.status]}</span>
          </div>
          <p className="pb-line">{p.what}</p>
          <p className="pb-roi"><b>{p.roi}</b> · payback {p.payback}</p>
          <p className="pb-inapp">{p.inApp}</p>
          <div className="st-row">
            <Discuss k={keyFor(p.name)} label={p.name} />
            {!builder && <button type="button" className="st-discuss" onClick={() => setBuilder({ prefill: p })}>⟳ Overhaul</button>}
          </div>
        </div>
      ))}

      <SectionHeader label="Governance" annotation="how this document stays true" />
      {GOVERNANCE.map((b) => (
        <div className="pb-block" key={b.h}>
          <div className="pb-block-h">{b.h}</div>
          {b.lines.map((l, i) => <p key={i} className="pb-line">{l}</p>)}
        </div>
      ))}

      <SectionHeader label="The Decision Log" annotation="append-only · the institution’s memory" />
      <DecisionLog canWrite={role === "owner" || role === "admin"} />

      <div className="pb-foot">
        Deeper cuts: <a href="/architecture">the live architecture map</a> (owner) · <a href="/built/gt3-built-k7m9x4q2">the partner one-pager</a> (safe to show) ·
        the numbers behind every play recompute daily in <b>Money</b>.
      </div>
      <ClosingBeat />
    </section>
  );
}
