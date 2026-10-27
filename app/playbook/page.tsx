"use client";

import { useState } from "react";
import { useAuth, roleOf } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import type { GtmPlay, Playbook } from "@/lib/strategy";
import { authedFetch } from "@/lib/authedFetch";
import { useAsyncData } from "@/lib/useAsyncData";
import { failureWords } from "@/lib/failureWords";
import Skeleton from "@/components/Skeleton";
import { StrategyThread, DecisionLog, PlayBuilder, useDrafts } from "@/components/StrategyCollab";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";
import dynamic from "next/dynamic";
import Icon from "@/components/Icon";
import { useConfirm } from "@/components/ConfirmSheet";
import { useAppStable } from "@/components/AppProvider";
import Link from "next/link";
// The sign-in is for a visitor who is signed out — staff signed in never download it (2026-10-09).
const SignIn = dynamic(() => import("@/components/SignIn"));

// THE PLAYBOOK — the whole strategy on one owner screen, and now a working document: every block
// and play carries a live discussion thread (owners get pinged), the guided builder walks you
// through building or overhauling a play, and governance is enforced by shape — an append-only
// decision log and locked who-changes-what rules. Content renders from /api/playbook (lib/strategyContent, traced to
// the locked strategy doc); collaboration state lives in Supabase (0140). Owner/admin only.

const STATUS_LABEL = { active: "ACTIVE", planning: "PLANNING", "phase-2": "PHASE 2" } as const;
const keyFor = (name: string) => "gtm:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default function PlaybookPage() {
  const { profile, enabled, user, ready } = useAuth();
  if (!enabled) return null;
  // Signed out, the page names itself and signs in (2026-10-09, round 2) — it said "Owners only" with no way in.
  if (ready && !user) return <SignIn context={{ title: "The Playbook.", sub: "Sign in with an owner or admin account." }} />;
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
  return <PlaybookScreen role={role} />;
}

// The playbook itself comes from /api/playbook (IP0 containment, 2026-10-27): it no longer ships in this page's JavaScript,
// and the route answers owners and admins only. Kept in memory for the visit, never in storage.
async function loadPlaybook(): Promise<Playbook> {
  const r = await authedFetch("/api/playbook");
  if (r.status === 401) throw new Error("The playbook is for owners and admins — sign in with one of those accounts.");
  const j = (await r.json().catch(() => null)) as { ok?: boolean; playbook?: Playbook } | null;
  if (!r.ok || !j?.ok || !j.playbook) throw new Error("Couldn't read the playbook just now.");
  return j.playbook;
}

function PlaybookScreen({ role }: { role: string }) {
  const confirm = useConfirm();
  const { toast } = useAppStable();
  const [open, setOpen] = useState<string | null>(null); // which thread is open
  const [builder, setBuilder] = useState<null | { prefill: GtmPlay | null }>(null);
  const { drafts, reload, retire } = useDrafts();
  const state = useAsyncData(loadPlaybook, []);
  if (state.status === "error") return <section className="screen" id="s-playbook"><Masthead eyebrow="The Playbook" right={<AccountPill />} /><p className="load-failed">{failureWords(state.error as Error, "Couldn't read the playbook")}</p></section>;
  if (!state.data) return <section className="screen" id="s-playbook"><Masthead eyebrow="The Playbook" right={<AccountPill />} /><Skeleton variant="row" count={5} /></section>;
  const { rev: STRATEGY_REV, core: STRATEGY_CORE, plays: GTM_PLAYS, governance: GOVERNANCE, flywheel: FLYWHEEL } = state.data;
  // A render function, not a component (R13 — F13): declared inside the screen, a component is a new type every render,
  // so pressing Discuss rebuilt the button it was pressed on — focus fell to the page and the open thread's draft went.
  const discuss = (k: string, label: string) => (
    <>
      <button type="button" className="st-discuss" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}><Icon name="chat" /> {open === k ? "Close" : "Discuss"}</button>
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

      <SectionHeader label="The Foundations" annotation="locked · tap Discuss to talk it through" />
      {STRATEGY_CORE.map((b) => (
        <div className="pb-block" key={b.h}>
          <div className="pb-block-h">{b.h}</div>
          {b.lines.map((l, i) => <p key={i} className="pb-line">{l}</p>)}
          {discuss("core:" + b.h.toLowerCase().replace(/[^a-z0-9]+/g, "-"), b.h)}
        </div>
      ))}

      <SectionHeader label="Growth Plays" annotation="projected ROI · where the app runs it" />
      {builder ? (
        <PlayBuilder prefill={builder.prefill} onDone={() => { setBuilder(null); reload(); }} />
      ) : (
        <>
          <button type="button" className="btn-pri btn-wide" onClick={() => setBuilder({ prefill: null })}><Icon name="plus" /> Build a play</button>
          <p className="k-sub">Seven guided steps — name it, aim it, plan it, put honest numbers on it, wire it to the app. Saves as a draft for discussion.</p>
        </>
      )}
      {drafts.map((d) => (
        <div className="pb-play st-draft" key={d.id}>
          <div className="pb-play-top">
            <b>{d.name}</b>
            <span className="k-tag gold">Draft{d.overhauls ? " · overhaul" : ""}</span>
          </div>
          {d.overhauls && <p className="dl-sub">Overhauls: {d.overhauls}</p>}
          <p className="pb-line">{d.what}</p>
          {(d.projected_revenue || d.payback) && <p className="pb-roi"><b>{[d.projected_revenue, d.payback && `payback ${d.payback}`].filter(Boolean).join(" · ")}</b></p>}
          {d.in_app && <p className="pb-inapp">{d.in_app}</p>}
          <p className="st-when">drafted by {d.author_name?.split(" ")[0] || "an owner"}</p>
          {discuss("draft:" + d.id, `Draft: ${d.name}`)}
          {/* The retire the query has been filtering for since day one. */}
          <button type="button" className="btn-sec btn-sm btn-wide mt-2"
                  onClick={async () => { if (await confirm({ title: `Retire “${d.name}”?`, body: "It comes off the playbook. The draft and anything said about it are kept.", confirmLabel: "Retire" })) { const why = await retire(d.id); toast(why ? `Couldn't retire it — ${why}` : `“${d.name}” retired`, why ? "error" : undefined); } }}>
            Retire this draft
          </button>
        </div>
      ))}
      {GTM_PLAYS.map((p) => (
        <div className="pb-play" key={p.name}>
          <div className="pb-play-top">
            <b>{p.name}</b>
            <span className={`k-tag${p.status === "active" ? " ok" : p.status === "planning" ? " gold" : ""}`}>{STATUS_LABEL[p.status]}</span>
          </div>
          <p className="pb-line">{p.what}</p>
          <p className="pb-roi"><b>{p.roi}</b> · payback {p.payback}</p>
          <p className="pb-inapp">{p.inApp}</p>
          <div className="st-row">
            {discuss(keyFor(p.name), p.name)}
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
        Deeper cuts: <Link href="/architecture">the live architecture map</Link> (owner) · <Link href="/built/gt3-built-k7m9x4q2">the partner one-pager</Link> (safe to show) ·
        the numbers behind every play recompute daily in <b>Money</b>.
      </div>
      <ClosingBeat />
    </section>
  );
}
