"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Sheet from "./Sheet";
import Icon from "./Icon";

// ONE PERSON, ONE PLACE (0311).
//
// Ryan: "I should be able to click on employee and manage everything… everything still seems so
// complex in fields, it feels so cluster minded."
//
// The complaint is not that there are too many fields. It is that there was no CENTRE for them to
// sit around. A crew member was spread across seven surfaces — the roster row, the utilization
// list, the org chart, the workload board, an agreement in Money, an offer letter in Money, and a
// course path in the Academy — and the one place you could tap a staff member opened Points,
// Credit and Founding. Loyalty fields. On an employee.
//
// So this is the centre. Everything the app knows about one human, in the order somebody actually
// needs it: where their onboarding got to, then what they have agreed to, then what they have
// done, then the controls. Loyalty is last, because for a staff member it is the least of it.
//
// ORDERED BY WHO IS WAITING. The onboarding block leads with which SIDE owes the next step,
// because "waiting on them" and "waiting on you" are completely different situations and the
// second is the only one you can act on. That distinction is the whole answer to "I can't find
// where to resume it".

type Person = {
  user_id: string; display_name: string | null; role: string; market: string | null;
  leads_market: string | null; referral_code: string | null; is_driver: boolean;
  steps_done: number; steps_total: number; waiting_on_you: number; waiting_on_them: number;
  next_step: string | null; next_step_owed_by: string | null; fully_onboarded: boolean;
  agreement_id: string | null; agreement_status: string | null;
  agreement_scope_basis: string | null; agreement_scope_until: string | null;
  agreement_covers: string | null;
  hours_total: number | null; hours_on_interim_work: number | null;
  last_seen_at: string | null; active_days_30: number;
};
type Step = { step: string; step_order: number; label: string; owed_by: string; done: boolean; detail: string };
type Data = { person: Person | null; steps: Step[] };

// Where each unfinished step is actually finished. Steps owed by THEM get no link on purpose —
// offering a button that does not do the thing is worse than saying plainly that it is their move.
const GO_TO: Record<string, { href: string; cta: string }> = {
  offer:     { href: "/crew?s=money&a=offers", cta: "Draft their offer letter" },
  agreement: { href: "/crew?s=money",          cta: "Open their agreement" },
  academy:   { href: "/crew?s=team",           cta: "Assign their Academy path" },
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const initials = (n: string | null) =>
  (n ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

export default function CrewPerson({ userId, onClose, onChanged }: {
  userId: string; onClose: () => void; onChanged?: () => void;
}) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [showLoyalty, setShowLoyalty] = useState(false);

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { person: null, steps: [] };
    const [p, s] = await Promise.all([
      supabase.from("v_crew_person").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("v_crew_onboarding_steps").select("step, step_order, label, owed_by, done, detail")
        .eq("user_id", userId).order("step_order"),
    ]);
    if (p.error) throw new Error(p.error.message);
    return { person: (p.data as Person) ?? null, steps: (s.data as Step[]) ?? [] };
  }, [userId]);
  const state = useAsyncData<Data>(loader, [userId]);
  const reload = state.reload;

  const setMarket = async (market: string) => {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ market: market || null }).eq("id", userId);
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    toast(market ? `Market set to ${market}` : "Market cleared");
    reload(); onChanged?.();
  };

  return (
    <Sheet open onClose={onClose} label="Crew member"
      header={<div className="cp-head">
        <b>Crew member</b>
        <button type="button" className="qd-x" onClick={onClose} title="Close"><Icon name="close" /></button>
      </div>}>
      <AsyncSection state={state} isEmpty={({ person }) => !person}
        emptyTitle="Nobody here" emptySub="That account is no longer on the crew."
        loadingLabel="Loading…" errorTitle="Couldn't load this person">
        {({ person, steps }) => {
          const p = person!;
          const pct = p.steps_total > 0 ? Math.round((Number(p.steps_done) / Number(p.steps_total)) * 100) : 0;
          const first = (p.display_name ?? "They").trim().split(/\s+/)[0];
          return (
            <>
              {/* who ─────────────────────────────────────────────────────────────────────── */}
              <div className="cp-id">
                <span className="cp-av">{initials(p.display_name)}</span>
                <div className="cp-id-t">
                  <b>{p.display_name?.trim() || "Unnamed"}</b>
                  <span>{p.role}{p.market ? ` · ${p.market}` : ""}{p.leads_market ? ` · leads ${p.leads_market}` : ""}</span>
                </div>
                {p.is_driver && <span className="cp-tag" title="Delivery driver"><Icon name="compass" /> Driver</span>}
              </div>

              {/* ONBOARDING — the answer to "where do I resume" ───────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h">
                  <span>Onboarding</span>
                  <b>{p.steps_done} of {p.steps_total}</b>
                </div>
                <div className="cp-bar"><span style={{ width: `${pct}%` }} /></div>

                {p.fully_onboarded ? (
                  <p className="cp-next ok"><Icon name="check" /> {first} is fully set up.</p>
                ) : (
                  <p className={`cp-next${p.next_step_owed_by === "them" ? " them" : ""}`}>
                    <b>Next:</b> {p.next_step}
                    {" · "}
                    {p.next_step_owed_by === "them"
                      ? <i>waiting on {first}</i>
                      : <i>waiting on you</i>}
                  </p>
                )}

                <div className="cp-steps">
                  {steps.map((s) => {
                    const go = !s.done && s.owed_by === "you" ? GO_TO[s.step] : null;
                    return (
                      <div key={s.step} className={`cp-step${s.done ? " done" : ""}`}>
                        <span className="cp-step-k">{s.done ? <Icon name="check" /> : <i className="cp-dot" />}</span>
                        <span className="cp-step-b">
                          <b>{s.label}</b>
                          <i>{s.detail}{!s.done && s.owed_by === "them" ? " · their move" : ""}</i>
                        </span>
                        {go && <a className="cp-step-go" href={go.href}>{go.cta} <span aria-hidden="true">›</span></a>}
                      </div>
                    );
                  })}
                </div>

                {/* The market step is the one thing fixable without leaving, so it is. */}
                {!p.market && (
                  <label className="prod-f" style={{ marginTop: 10 }}>
                    <span>Set their market</span>
                    <input defaultValue="" placeholder="atlanta" disabled={busy}
                           onBlur={(e) => { const v = e.target.value.trim(); if (v) setMarket(v); }} />
                  </label>
                )}
              </div>

              {/* what they agreed to ─────────────────────────────────────────────────────── */}
              {p.agreement_id ? (
                <div className="cp-block">
                  <div className="cp-block-h"><span>Their agreement</span><b>{p.agreement_status}</b></div>
                  {p.agreement_covers
                    ? <p className="cp-line">Covers {p.agreement_covers}
                        {p.agreement_scope_basis === "interim" && p.agreement_scope_until
                          ? <> — interim, {p.agreement_scope_until}</> : null}.</p>
                    : <p className="cp-line dim">No duties recorded on it yet.</p>}
                  <p className="cp-line">
                    <b>{Number(p.hours_total ?? 0).toLocaleString()}</b> hours logged
                    {Number(p.hours_on_interim_work ?? 0) > 0 &&
                      <> · <b>{Number(p.hours_on_interim_work).toLocaleString()}</b> on interim brewing &amp; driving</>}
                  </p>
                  <a className="cp-go" href="/crew?s=money">Open it in Money <span aria-hidden="true">›</span></a>
                </div>
              ) : (p.role === "operator" || p.role === "event_manager") && (
                <div className="cp-block">
                  <div className="cp-block-h"><span>Their agreement</span><b className="dim">none</b></div>
                  <p className="cp-line dim">
                    {first} holds {p.leads_market ? `market lead over ${p.leads_market}` : `the ${p.role} role`} with
                    nothing on paper.
                  </p>
                  <a className="cp-go" href="/crew?s=money">Draft one <span aria-hidden="true">›</span></a>
                </div>
              )}

              {/* what they've done ───────────────────────────────────────────────────────── */}
              <div className="cp-block">
                <div className="cp-block-h"><span>Activity</span><b>{ago(p.last_seen_at)}</b></div>
                <p className="cp-line">
                  {Number(p.active_days_30) > 0
                    ? <><b>{p.active_days_30}</b> active day{Number(p.active_days_30) === 1 ? "" : "s"} in the last 30.</>
                    : <span className="dim">Never signed in. The account exists; nobody has used it.</span>}
                </p>
              </div>

              {/* loyalty, last, because for staff it is the least of it ───────────────────── */}
              <button type="button" className="tm-hire-open" style={{ marginTop: 10 }}
                      onClick={() => setShowLoyalty((v) => !v)} aria-expanded={showLoyalty}>
                Loyalty &amp; credit <span className={`ev-chev${showLoyalty ? " open" : ""}`} aria-hidden="true">›</span>
              </button>
              {showLoyalty && (
                <p className="cp-line dim" style={{ marginTop: 8 }}>
                  Points, credit and Founding status live on the roster row below — they are customer
                  fields, and this person is crew. Open the roster if you need them.
                </p>
              )}
            </>
          );
        }}
      </AsyncSection>
    </Sheet>
  );
}
