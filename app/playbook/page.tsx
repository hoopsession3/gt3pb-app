"use client";

import { useAuth, roleOf } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import Gt3Mark from "@/components/Gt3Mark";
import { STRATEGY_CORE, GTM_PLAYS, FLYWHEEL, STRATEGY_REV } from "@/lib/strategy";

// THE PLAYBOOK — the whole strategy on one owner screen: what we believe (core blocks), how a
// customer compounds (the flywheel), and every growth play with its projected ROI and the exact
// place in the app that runs it. Content lives in lib/strategy (traced to the locked strategy
// doc); this page only renders it. Owner/admin only — this is the business, not the menu.

const STATUS_LABEL = { active: "ACTIVE", planning: "PLANNING", "phase-2": "PHASE 2" } as const;

export default function PlaybookPage() {
  const { profile, enabled } = useAuth();
  if (!enabled) return null;
  const role = roleOf(profile);
  if (role !== "owner" && role !== "admin") {
    return (
      <section className="screen" id="s-playbook">
        <div className="toprow"><div className="eyb">Playbook</div><AccountPill /></div>
        <h2 className="dl-h">Owners only</h2>
        <p className="dl-sub">The playbook is the business itself — sign in with an owner or admin account.</p>
      </section>
    );
  }

  return (
    <section className="screen" id="s-playbook">
      <div className="toprow"><div className="eyb">The Playbook</div><AccountPill /></div>

      <div className="pb-mast">
        <Gt3Mark tone="cream" />
        <div className="pb-mast-t">
          <h1>How GT3 wins.</h1>
          <span className="pb-rev">{STRATEGY_REV} · lives in GT3-Brew-Business-Strategy.md — this page renders it, never forks it</span>
        </div>
      </div>

      {/* the flywheel — one loop, six turns, every feature on it */}
      <div className="dchapter"><span className="dchn">The Flywheel</span><span className="dchw">how one guest compounds</span></div>
      <div className="dchrule" />
      <ol className="pb-loop">
        {FLYWHEEL.map((s, i) => <li key={i}><span className="pb-loop-n">{i + 1}</span><span>{s}</span></li>)}
      </ol>

      <div className="dchapter"><span className="dchn">The Foundations</span><span className="dchw">locked</span></div>
      <div className="dchrule" />
      {STRATEGY_CORE.map((b) => (
        <div className="pb-block" key={b.h}>
          <div className="pb-block-h">{b.h}</div>
          {b.lines.map((l, i) => <p key={i} className="pb-line">{l}</p>)}
        </div>
      ))}

      <div className="dchapter"><span className="dchn">Growth Plays</span><span className="dchw">projected ROI · where the app runs it</span></div>
      <div className="dchrule" />
      {GTM_PLAYS.map((p) => (
        <div className="pb-play" key={p.name}>
          <div className="pb-play-top">
            <b>{p.name}</b>
            <span className={`pb-status ${p.status}`}>{STATUS_LABEL[p.status]}</span>
          </div>
          <p className="pb-line">{p.what}</p>
          <p className="pb-roi"><b>{p.roi}</b> · payback {p.payback}</p>
          <p className="pb-inapp">{p.inApp}</p>
        </div>
      ))}

      <div className="pb-foot">
        Deeper cuts: <a href="/architecture">the live architecture map</a> (owner) · <a href="/built/gt3-built-k7m9x4q2">the partner one-pager</a> (safe to show) ·
        the numbers behind every play recompute daily in <b>Money</b>.
      </div>
      <div className="signoff">Pure Signal. No Noise.</div>
    </section>
  );
}
