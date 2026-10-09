"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { canOf } from "@/lib/roles";
import { localToday } from "@/lib/dates";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Sheet, { CloseButton, useUnsaved } from "./Sheet";
import { edited } from "@/lib/formGuard";
import Icon from "./Icon";
import {
  LEAD_BASES, correctRule, correctionProblem, deadlineWords, lastCheckedWords, recheckProblem, recheckRule,
  type LeadBasis,
} from "@/lib/complianceCheck";

// ONE PERMIT RULE, OPENED — and re-checked (2026-10-04, 0342).
//
// A rule that falls due under Needs you used to go to the top of Prep, where nothing about it is,
// and could not be answered anywhere in the app. Its home is here: what it says, who issues it, the
// page to check it against, what to ask, when it was last confirmed — and the answer. Say where you
// checked and whether it still stands, and it is dated today and leaves the list. If the authority
// says something else, it is not rewritten from memory: it stops claiming to be confirmed, says what
// was heard and from whom, and an owner corrects the wording from the same sheet.
//
// The answers appear only when the database can record them: a rule read before 0342 is applied has
// no verified_by key, and that absence is the whole test (the same rule as lib/collect canCollect).

type Rule = {
  id: string; state: string | null; county: string | null; label: string; link: string | null;
  kind: string; critical: boolean; active: boolean; verified: boolean; verified_on: string | null;
  authority: string | null; lead_days: number | null; lead_basis: string | null; check_note: string | null;
  verified_by?: string | null;
};
type Check = { id: string; checked_on: string; outcome: string; checked_against: string; note: string | null; checked_by: string | null };
type Data = { rule: Rule | null; freshness: string | null; checks: Check[] | null; canRecord: boolean };

const OUTCOME_WORD: Record<string, string> = { confirmed: "Still true", changed: "Changed", corrected: "Corrected" };
const KIND_WORD: Record<string, string> = { permit: "Permit", cert: "Certification", inspection: "Inspection", insurance: "Insurance", other: "Requirement" };

export default function ComplianceRuleRecord({ ruleId, onClose }: { ruleId: string; onClose: () => void }) {
  const { profile } = useAuth();
  const can = canOf(profile);

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { rule: null, freshness: null, checks: null, canRecord: false };
    const [r, f, c] = await Promise.all([
      supabase.from("compliance_rules").select("*").eq("id", ruleId).maybeSingle(),
      supabase.from("v_compliance_freshness").select("freshness").eq("id", ruleId).maybeSingle(),
      // arrives-with: 0342 — before it is applied the table does not exist; the history is then
      // simply not shown, and nothing else on the sheet depends on it.
      supabase.from("compliance_checks").select("id, checked_on, outcome, checked_against, note, checked_by").eq("rule_id", ruleId).order("created_at", { ascending: false }).limit(6),
    ]);
    if (r.error) throw new Error(r.error.message);
    const rule = (r.data as Rule | null) ?? null;
    return {
      rule,
      freshness: f.error ? null : ((f.data as { freshness: string } | null)?.freshness ?? null),
      checks: c.error ? null : ((c.data as Check[]) ?? []),
      canRecord: !!rule && "verified_by" in rule,
    };
  }, [ruleId]);
  const state = useAsyncData(loader, [loader]);

  return (
    <Sheet open onClose={onClose} label="Compliance rule"
      header={<div className="cp-head"><b>Compliance rule</b><CloseButton onClick={onClose} /></div>}>
      <AsyncSection state={state} isEmpty={(d) => !d.rule}
        emptyTitle="No such rule" emptySub="It may have been removed, or the link is stale."
        loadingLabel="Loading…" errorTitle="Couldn't load this rule">
        {(d) => <RuleBody key={d.rule!.id} d={d} admin={can.admin} onDone={() => state.reload()} />}
      </AsyncSection>
    </Sheet>
  );
}

function RuleBody({ d, admin, onDone }: { d: Data; admin: boolean; onDone: () => void }) {
  const { toast } = useApp();
  const rule = d.rule!;
  const [against, setAgainst] = useState("");
  const [note, setNote] = useState("");
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // the correction, for an owner or admin
  const [fixing, setFixing] = useState(false);
  const [label, setLabel] = useState(rule.label);
  const [link, setLink] = useState(rule.link ?? "");
  const [authority, setAuthority] = useState(rule.authority ?? "");
  const [leadDays, setLeadDays] = useState(rule.lead_days == null ? "" : String(rule.lead_days));
  const [leadBasis, setLeadBasis] = useState<LeadBasis | "">((rule.lead_basis as LeadBasis | null) ?? "");
  // A source typed for the re-check, or a correction under way: leaving the sheet asks first.
  useUnsaved(!!against.trim() || !!note.trim() || (fixing && edited(
    { label, link, authority, leadDays, leadBasis },
    { label: rule.label, link: rule.link, authority: rule.authority, leadDays: rule.lead_days == null ? "" : String(rule.lead_days), leadBasis: rule.lead_basis },
    ["label", "link", "authority", "leadDays", "leadBasis"])));

  const where = [rule.state ?? "Everywhere", rule.county ? `${rule.county} County` : rule.state ? "statewide" : null].filter(Boolean).join(" · ");
  const deadline = deadlineWords(rule.lead_days, rule.lead_basis);
  const fresh = d.freshness === "fresh";

  const recheck = async (outcome: "confirmed" | "changed") => {
    if (!supabase || busy) return;
    const problem = recheckProblem(outcome, against, note);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(null);
    const res = await recheckRule(supabase, rule.id, outcome, against, note);
    setBusy(false);
    if (res.error) { setErr(`Couldn't record it — ${res.error}`); return; }
    toast(outcome === "confirmed" ? "Checked today — off the list." : "Recorded as changed — the owners have been told.");
    setAgainst(""); setNote(""); setChanged(false);
    onDone();
  };

  const correct = async () => {
    if (!supabase || busy) return;
    const days = leadDays.trim() === "" ? null : Number(leadDays);
    const c = { label, link, authority, leadDays: days, leadBasis: leadBasis || null, checkedAgainst: against, note };
    const problem = correctionProblem(c);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(null);
    const res = await correctRule(supabase, rule.id, c);
    setBusy(false);
    if (res.error) { setErr(`Couldn't save the correction — ${res.error}`); return; }
    toast("Corrected and dated today.");
    setFixing(false); setAgainst(""); setNote("");
    onDone();
  };

  return (
    <>
      <div className="so-id">
        <div className="cp-id-t">
          <b>{KIND_WORD[rule.kind] ?? "Requirement"}{rule.critical ? " · critical" : ""}</b>
          <span>{where}</span>
        </div>
        <span className={`so-pill ${fresh ? "so-carrier" : "so-us"}`}>{fresh ? "Confirmed" : rule.verified ? "Re-check" : "Not confirmed"}</span>
      </div>

      <p className="so-means" style={{ color: "var(--cream)" }}>{rule.label}</p>
      {rule.authority && <p className="pnl-note">Issued by {rule.authority}.</p>}
      {deadline && <p className="pnl-note">Deadline: {deadline} the event.</p>}
      <p className="pnl-note">{lastCheckedWords(rule.verified_on, localToday())}{d.freshness && !fresh ? ` · ${d.freshness}` : ""}.</p>
      {rule.check_note && <p className="evr-owed">{rule.check_note}</p>}
      {rule.link && (
        <a className="cp-go" href={rule.link} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          Check it against the source <Icon name="externalLink" />
        </a>
      )}

      {!rule.active ? (
        <p className="pnl-note" style={{ marginTop: 12 }}>Not on the checklist yet — an owner approves a proposed rule in Prep › Inspection prep first.</p>
      ) : !d.canRecord ? (
        <p className="pnl-note" style={{ marginTop: 12 }}>Recording a re-check arrives with the next database update.</p>
      ) : (
        <div className="crr-form">
          <div className="cp-block-h">Re-check it</div>
          <label className="prod-f"><span>Where did you check it?</span>
            <input className="note-in" value={against} onChange={(e) => setAgainst(e.target.value)} maxLength={300}
              placeholder={rule.authority ? `${rule.authority} — the page, or who you spoke to` : "The agency, the page, or who you spoke to"} />
          </label>
          <label className="prod-f"><span>{changed ? "What did they say is different?" : "Anything to add? (optional)"}</span>
            <textarea className="note-in" rows={changed ? 3 : 2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
          {err && <p className="load-failed" role="alert">{err}</p>}
          <div className="prod-actions" style={{ marginTop: 12 }}>
            {changed
              ? <button type="button" className="note-arch" onClick={() => { setChanged(false); setErr(null); }}>Back</button>
              : <button type="button" className="note-arch" onClick={() => { setChanged(true); setErr(null); }}>It&rsquo;s changed</button>}
            {changed
              ? <button type="button" className="btn-pri" onClick={() => recheck("changed")} disabled={busy}>{busy ? "Saving…" : "Report the change"}</button>
              : <button type="button" className="btn-pri" onClick={() => recheck("confirmed")} disabled={busy}>{busy ? "Saving…" : "Still true — checked today"}</button>}
          </div>
          {changed && <p className="pnl-note">The rule&rsquo;s words stay as they are: it is marked not confirmed, with what you were told, and the owners are asked to correct it.</p>}
        </div>
      )}

      {admin && rule.active && d.canRecord && (
        <>
          <button type="button" className="prep-collapse prep-tool" onClick={() => setFixing((v) => !v)} aria-expanded={fixing}>
            <span className="prep-collapse-l"><b>Correct the rule</b><span>From what the authority said — with where you checked, above</span></span>
            <span className={`ev-chev${fixing ? " open" : ""}`}>›</span>
          </button>
          {fixing && (
            <div className="crr-fix">
              <label className="prod-f"><span>What it requires</span>
                <textarea className="note-in" rows={3} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={400} />
              </label>
              <label className="prod-f"><span>Issued by</span>
                <input className="note-in" value={authority} onChange={(e) => setAuthority(e.target.value)} maxLength={200} />
              </label>
              <label className="prod-f"><span>The page it is checked against</span>
                <input className="note-in" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https://" />
              </label>
              <div className="prod-f"><span>Deadline before the event — leave empty if there is none</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="note-in" inputMode="numeric" value={leadDays} onChange={(e) => setLeadDays(e.target.value.replace(/[^\d]/g, ""))} aria-label="Days" placeholder="days" style={{ width: 90 }} />
                  <div className="ts-chips" role="group" aria-label="Business or calendar days">
                    {LEAD_BASES.map((b) => (
                      <button key={b} type="button" className={`ts-chip${leadBasis === b ? " on" : ""}`} aria-pressed={leadBasis === b} onClick={() => setLeadBasis(leadBasis === b ? "" : b)}>{b} days</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="prod-actions" style={{ marginTop: 12 }}>
                <span />
                <button type="button" className="btn-pri" onClick={correct} disabled={busy}>{busy ? "Saving…" : "Save the correction"}</button>
              </div>
            </div>
          )}
        </>
      )}

      {d.checks && d.checks.length > 0 && (
        <div className="cp-block">
          <div className="cp-block-h">Checks</div>
          {d.checks.map((c) => (
            <p key={c.id} className="pnl-note" style={{ marginTop: 6 }}>
              <b>{new Date(`${c.checked_on}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {OUTCOME_WORD[c.outcome] ?? c.outcome}</b> — against {c.checked_against}{c.note ? `. ${c.note}` : ""}
            </p>
          ))}
        </div>
      )}
    </>
  );
}
