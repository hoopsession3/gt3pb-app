"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "@/components/kit";
import Icon from "@/components/Icon";
import { MARKETS, MARKET_LABEL, toMarket, type Market } from "@/lib/markets";
import DealExplainer from "./DealExplainer";
import { useOptions } from "./useOptions";
import {
  computeSplit, project, bestFundingForOperator, summarize,
  TIERS, TIER, nextTier, STAGES, STAGE_LABEL, STATUS_LABEL,
  nextStatuses, isEditable, toStatus, toTier, toStage, validateProposal,
  SCOPE_BASIS, SCOPE_BASIS_LABEL, HOURS_BASIS, HOURS_BASIS_LABEL,
  toScopeBasis, toHoursBasis, scopeSentence,
  type DealTerms, type AgreementStatus, type ScopeBasis, type HoursBasis,
} from "@/lib/operatorDeal";
import { moneyRound } from "@/lib/money";

// OPERATOR DEAL — build, price and negotiate a market operator's agreement.
//
// The slider is the point. Who funds supplies is the one genuinely negotiable variable, because it
// is who carries the capital and the risk, so it moves the operator's share with it — GT3 funding
// everything sits at 35/45/20, the operator funding everything at 65/15/20, and the midpoint is
// exactly the agreed 50/30/20. All of that math lives in lib/operatorDeal.ts and is unit-tested;
// this screen only renders it.
//
// It shows TWO numbers for the operator, always: their share of commissions, and what they actually
// keep after funding their share of supplies. A term nobody can evaluate is a term nobody should sign.
/* eslint-disable @typescript-eslint/no-explicit-any */


const DEFAULT_PACKAGE = [
  { label: "Trailer / rig for the market", included: true },
  { label: "Opening equipment package", included: true },
  { label: "Brand, app and ordering system", included: true },
  { label: "Academy training + certification", included: true },
  { label: "Corporate pipeline tooling", included: true },
  { label: "Launch marketing support", included: false },
  { label: "Vehicle", included: false },
];

type Row = {
  id: string; market: string; operator_name: string; operator_email: string | null;
  operator_user_id: string | null; status: string; tier: string; stage: string;
  supply_funding: number; operator_pct: number; royalty_pct: number; market_pct: number;
  package: any[]; notes: string | null; created_at: string;
  // 0309 — what they DO, on what basis, and until when
  covers: string[]; scope_basis: string; scope_until: string | null;
  hours_basis: string; hours_note: string | null;
  // 0309 — execution, on both sides
  signed_name: string | null; signed_at: string | null;
  countersigned_name: string | null; countersigned_at: string | null;
  version: number; supersedes_id: string | null;
};
type Extra = { integrity: string; hours_total: number; hours_on_interim_work: number; days_worked: number };

/**
 * `mine` — THE OPERATOR'S OWN COPY.
 *
 * sign_agreement and respond_to_agreement both deliberately permit
 * `operator_user_id = auth.uid()`: the operator signs for themselves, and answers for themselves.
 * Neither could be called by an operator, because this component — their only caller anywhere in
 * the app — is mounted inside /crew's `money` section, and ROLE_SECTIONS.operator is
 * day, now, prep, plan, brew, garage, notes, driver. There is no money.
 *
 * So the person the whole screen was built for could not open it. Production has one account in
 * the operator role today, and one operator agreement.
 *
 * The fix is a prop, not a second screen. Widening `money` to operators would hand them expenses,
 * budgets, invoices, offer letters and the P&L to solve a scoping problem. A parallel
 * "my agreement" component would be a second implementation of a signing flow, which is the one
 * thing this codebase is most careful about. `mine` filters to their own row and drops the
 * authoring affordances; everything they can do to it is the same code an owner uses.
 *
 * RLS already allows the read — 0277 gives operator_agreements a select policy on
 * `operator_user_id = auth.uid()`. This adds no reach; it opens a door to reach the app already had.
 */
export default function OperatorDeal({ mine = false }: { mine?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const meId = user?.id ?? null;

  const loader = useCallback(async (): Promise<{ rows: Row[]; extra: Record<string, Extra> }> => {
    if (!supabase) return { rows: [], extra: {} };
    if (mine && !meId) return { rows: [], extra: {} };
    // Integrity and hours come from the two views rather than being recomputed here, so the screen
    // and the database can never disagree about whether a signature still matches its terms.
    const [a, integ, hrs] = await Promise.all([
      (mine
        ? supabase.from("operator_agreements")
            .select("id, market, operator_name, operator_email, operator_user_id, status, tier, stage, supply_funding, operator_pct, royalty_pct, market_pct, package, notes, created_at, supply_sourcing, supply_price_basis, equity_eligible, equity_scope, covers, scope_basis, scope_until, hours_basis, hours_note, signed_name, signed_at, countersigned_name, countersigned_at, version, supersedes_id")
            .eq("operator_user_id", meId)
            .order("created_at", { ascending: false })
        : supabase.from("operator_agreements")
            .select("id, market, operator_name, operator_email, operator_user_id, status, tier, stage, supply_funding, operator_pct, royalty_pct, market_pct, package, notes, created_at, supply_sourcing, supply_price_basis, equity_eligible, equity_scope, covers, scope_basis, scope_until, hours_basis, hours_note, signed_name, signed_at, countersigned_name, countersigned_at, version, supersedes_id")
            .order("created_at", { ascending: false })),
      supabase.from("v_agreement_integrity").select("id, integrity"),
      supabase.from("v_agreement_hours").select("agreement_id, hours_total, hours_on_interim_work, days_worked"),
    ]);
    if (a.error) throw new Error(a.error.message);
    const extra: Record<string, Extra> = {};
    ((integ.data as any[]) ?? []).forEach((r) => {
      extra[r.id] = { ...(extra[r.id] ?? { hours_total: 0, hours_on_interim_work: 0, days_worked: 0 }), integrity: r.integrity };
    });
    ((hrs.data as any[]) ?? []).forEach((r) => {
      extra[r.agreement_id] = { integrity: extra[r.agreement_id]?.integrity ?? "not signed yet",
        hours_total: Number(r.hours_total) || 0, hours_on_interim_work: Number(r.hours_on_interim_work) || 0,
        days_worked: Number(r.days_worked) || 0 };
    });
    const rows = ((a.data as any[]) ?? []).map((r) => ({
      ...r, package: Array.isArray(r.package) ? r.package : [], covers: Array.isArray(r.covers) ? r.covers : [],
    })) as Row[];
    return { rows, extra };
  }, [mine, meId]);
  const board = useAsyncData<{ rows: Row[]; extra: Record<string, Extra> }>(loader, [mine, meId]);
  const { reload } = board;
  const rows = board.data?.rows ?? [];
  const extra = board.data?.extra ?? {};

  const createDraft = async () => {
    if (!supabase) return;
    setBusy(true);
    const split = computeSplit({ supplyFunding: 50, stage: "ramp", tier: "associate" });
    const { data, error } = await supabase.from("operator_agreements").insert({
      // Was hardcoded to atlanta, so every new agreement started in the wrong market and somebody
      // had to notice. MARKETS is the list; its first entry is the sane default.
      market: MARKETS[0], operator_name: "New operator", status: "draft",
      tier: "associate", stage: "ramp", supply_funding: 50,
      operator_pct: split.operatorPct, royalty_pct: split.royaltyPct, market_pct: split.marketPct,
      package: DEFAULT_PACKAGE, created_by: user?.id ?? null,
    }).select("id").maybeSingle();
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    setCreating(false);
    setOpenId((data as any)?.id ?? null);
    reload();
  };

  return (
    <AsyncSection state={board} isEmpty={() => false} emptyTitle="No agreements yet" errorTitle="Couldn't load agreements">
      {() => (
        <div className="adm-sec">
          <div className="studio-top">
            <SectionHeader
              label={mine ? "Your agreement" : "Operator agreements"}
              annotation={mine ? (rows.length === 1 ? "1 version" : `${rows.length} versions`) : `${rows.length} on file`} />
            {!mine && (
              <button type="button" className="btn-sec" onClick={createDraft} disabled={busy || creating}>
                {busy ? "Creating…" : "+ New agreement"}
              </button>
            )}
          </div>
          <div className="h-sub">
            {mine
              ? "What you have agreed to with GT3, and what it pays. Accept it, ask for changes, counter it, or sign it — whichever it is waiting on. Every move is kept."
              : "Build the deal on the slider, see what the operator actually takes home, then send it for their response. They can accept, ask for changes, or counter — every move is kept."}
          </div>

          {rows.length === 0 && (
            <div className="prod-recipe" style={{ marginTop: 12 }}>
              <div className="insp-lbl">{mine ? "Nothing on file yet" : "Nothing on file"}</div>
              <p className="h-sub" style={{ margin: "4px 0 0" }}>
                {mine
                  ? "There is no operator agreement in your name. When GT3 drafts one and sends it, it appears here for you to read and respond to."
                  : "Start one for your head of Atlanta ops — the default lands on the agreed 50/30/20."}
              </p>
            </div>
          )}

          {rows.map((r) => (
            <AgreementRow
              key={r.id} row={r} open={mine ? true : openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onSaved={reload} toast={toast} meId={meId}
              extra={extra[r.id]}
            />
          ))}
        </div>
      )}
    </AsyncSection>
  );
}

function AgreementRow({ row, open, onToggle, onSaved, toast, meId, extra }: {
  row: Row; open: boolean; onToggle: () => void; onSaved: () => void;
  toast: (m: string, t?: any) => void; meId: string | null; extra?: Extra;
}) {
  const status = toStatus(row.status);
  const [d, setD] = useState({
    operatorName: row.operator_name, operatorEmail: row.operator_email ?? "",
    market: toMarket(row.market), tier: toTier(row.tier), stage: toStage(row.stage),
    supplyFunding: Number(row.supply_funding) || 50,
    pkg: row.package.length ? row.package : DEFAULT_PACKAGE,
    notes: row.notes ?? "",
    covers: row.covers ?? [],
    scopeBasis: toScopeBasis(row.scope_basis),
    scopeUntil: row.scope_until ?? "",
    hoursBasis: toHoursBasis(row.hours_basis),
  });
  const [busy, setBusy] = useState(false);
  // Worked example the numbers are shown against. Editable, because the honest answer to "should I
  // fund supplies" depends entirely on how big the supply bill actually is.
  const [rev, setRev] = useState("12000");
  const [sup, setSup] = useState("3000");

  const terms: DealTerms = { supplyFunding: d.supplyFunding, stage: d.stage, tier: d.tier };
  const split = computeSplit(terms);
  const proj = useMemo(
    () => project(terms, (Number(rev) || 0) * 100, (Number(sup) || 0) * 100),
    [terms.supplyFunding, terms.stage, terms.tier, rev, sup] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const best = useMemo(
    () => bestFundingForOperator(terms, (Number(rev) || 0) * 100, (Number(sup) || 0) * 100),
    [terms.stage, terms.tier, rev, sup] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const editable = isEditable(status);
  const isMine = !!meId && row.operator_user_id === meId;
  const up = nextTier(d.tier);

  const save = async (extra: Record<string, unknown> = {}) => {
    if (!supabase) return;
    const v = validateProposal({ market: d.market, operatorName: d.operatorName, terms });
    if (!v.ok) { toast(v.error, "error"); return; }
    // The database refuses this too. Saying it here means the person reads a sentence instead of a
    // constraint name — and this is the field the whole interim idea rests on.
    if (d.scopeBasis === "interim" && !d.scopeUntil.trim()) {
      toast("Say what ends the interim cover — that condition is the reason someone agrees to it.", "error"); return;
    }
    setBusy(true);
    const { error } = await supabase.from("operator_agreements").update({
      operator_name: d.operatorName.trim(), operator_email: d.operatorEmail.trim() || null,
      market: d.market, tier: d.tier, stage: d.stage, supply_funding: d.supplyFunding,
      operator_pct: split.operatorPct, royalty_pct: split.royaltyPct, market_pct: split.marketPct,
      package: d.pkg, notes: d.notes.trim() || null, updated_at: new Date().toISOString(),
      covers: d.covers, scope_basis: d.scopeBasis,
      scope_until: d.scopeBasis === "interim" ? d.scopeUntil.trim() : null,
      hours_basis: d.hoursBasis,
      ...extra,
    }).eq("id", row.id);
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    toast("Saved"); onSaved();
  };

  const advance = async (to: AgreementStatus) => {
    await save({ status: to, ...(to === "sent" ? { sent_at: new Date().toISOString() } : {}) });
  };

  // The operator's own response goes through the RPC — it can move status and record what they said,
  // and it cannot touch a single term.
  const respond = async (action: "accept" | "request_changes" | "counter", preset?: string) => {
    if (!supabase) return;
    // A preset comes from the explainer, where the operator has already said what they want by
    // moving the slider — asking them to retype it in a prompt box would be the worse experience.
    const note = preset ?? (typeof window !== "undefined"
      ? window.prompt(action === "accept" ? "Anything to note with your acceptance? (optional)" : "What would you like changed?") ?? ""
      : "");
    if (action !== "accept" && !note.trim()) { toast("Say what you'd like changed so it's on the record.", "error"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("respond_to_agreement", { p_id: row.id, p_action: action, p_note: note.trim() || null });
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    toast(action === "accept" ? "Accepted — thank you" : "Sent back to GT3"); onSaved();
  };

  return (
    <div className={`prod${open ? " open" : ""}`}>
      <div className="k-rows">
        <button type="button" className="k-row tap" onClick={onToggle} aria-expanded={open} style={{ width: "100%" }}>
          <span className="k-lead">{MARKET_LABEL[d.market]}</span>
          <span className="k-bd">
            <span className="k-nm">{row.operator_name}</span>
            <span className="k-sub">{TIER[toTier(row.tier)].label} · {row.operator_pct}/{row.royalty_pct}/{row.market_pct}</span>
          </span>
          <span className={`od-status od-${status}`}>{STATUS_LABEL[status]}</span>
        </button>
      </div>

      {open && (
        <div className="prod-body">
          {/* ── who ── */}
          <div className="prod-grid">
            <label className="prod-f"><span>Operator</span>
              <input value={d.operatorName} disabled={!editable} onChange={(e) => setD({ ...d, operatorName: e.target.value })} />
            </label>
            <label className="prod-f"><span>Their email</span>
              <input value={d.operatorEmail} disabled={!editable} onChange={(e) => setD({ ...d, operatorEmail: e.target.value })} placeholder="so they can be linked to it" />
            </label>
            <label className="prod-f"><span>Market</span>
              <select value={d.market} disabled={!editable} onChange={(e) => setD({ ...d, market: toMarket(e.target.value) })}>
                {MARKETS.map((m) => <option key={m} value={m}>{MARKET_LABEL[m]}</option>)}
              </select>
            </label>
            <label className="prod-f"><span>Stage</span>
              <select value={d.stage} disabled={!editable} onChange={(e) => setD({ ...d, stage: toStage(e.target.value) })}>
                {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
            </label>
          </div>

          {/* ── the slider ── */}
          <div className="prod-recipe" style={{ marginTop: 12 }}>
            <div className="insp-lbl">Who funds supplies</div>
            <input
              className="od-slider" type="range" min={0} max={100} step={5}
              value={d.supplyFunding} disabled={!editable}
              onChange={(e) => setD({ ...d, supplyFunding: Number(e.target.value) })}
              aria-label="Share of supply cost the operator funds"
            />
            <div className="od-ends">
              <span>GT3 funds it all</span>
              <b>{d.supplyFunding}% operator</b>
              <span>Operator funds it all</span>
            </div>

            <div className="od-split" role="img" aria-label={`Operator ${split.operatorPct}%, royalty ${split.royaltyPct}%, market ${split.marketPct}%`}>
              <span className="od-seg od-op" style={{ width: `${split.operatorPct}%` }} />
              <span className="od-seg od-roy" style={{ width: `${split.royaltyPct}%` }} />
              <span className="od-seg od-mkt" style={{ width: `${split.marketPct}%` }} />
            </div>
            <div className="od-legend">
              <span><i className="od-k od-op" />Operator <b>{split.operatorPct}%</b></span>
              <span><i className="od-k od-roy" />GT3 royalty <b>{split.royaltyPct}%</b></span>
              <span><i className="od-k od-mkt" />Back into the market <b>{split.marketPct}%</b></span>
            </div>
            {d.stage === "ramp" && (
              <div className="od-note">
                Ramp: no royalty until the market is profitable — that share stays in the market.
              </div>
            )}
          </div>

          {/* ── what it means in money ── */}
          <div className="prod-recipe" style={{ marginTop: 10 }}>
            <div className="insp-lbl">What that means on a real month</div>
            <div className="prod-grid">
              <label className="prod-f"><span>Monthly revenue ($)</span>
                <input type="number" value={rev} onChange={(e) => setRev(e.target.value)} />
              </label>
              <label className="prod-f"><span>Monthly supplies ($)</span>
                <input type="number" value={sup} onChange={(e) => setSup(e.target.value)} />
              </label>
            </div>
            <div className="od-figs">
              <div><b>{moneyRound(proj.operatorGrossCents)}</b><span>Operator share</span></div>
              <div><b>−{moneyRound(proj.operatorSuppliesCents)}</b><span>Supplies they fund</span></div>
              <div className="od-fig-key"><b>{moneyRound(proj.operatorNetCents)}</b><span>Operator keeps</span></div>
              <div><b>{moneyRound(proj.royaltyCents)}</b><span>GT3 royalty</span></div>
              <div><b>{moneyRound(proj.marketCents)}</b><span>Into the market</span></div>
            </div>
            {best !== d.supplyFunding && editable && (
              <div className="od-note">
                At this supply bill the operator keeps most at <b>{best}%</b> funding.{" "}
                <button type="button" className="btn-ter" onClick={() => setD({ ...d, supplyFunding: best })}>Set it there</button>
              </div>
            )}
          </div>

          {/* ── tier / next level ── */}
          <div className="prod-recipe" style={{ marginTop: 10 }}>
            <div className="insp-lbl">Level</div>
            <div className="od-tiers">
              {TIERS.map((t) => (
                <button key={t} type="button" disabled={!editable}
                  className={`gl-chip${d.tier === t ? " on" : ""}`}
                  onClick={() => setD({ ...d, tier: t })}>
                  {TIER[t].label}{TIER[t].uplift ? ` +${TIER[t].uplift}` : ""}
                </button>
              ))}
            </div>
            <div className="od-note">
              {up
                ? <>To reach <b>{TIER[up].label}</b>: {TIER[up].advance}</>
                : <>{TIER[d.tier].advance}</>}
            </div>
          </div>

          {/* ── WHAT THEY ACTUALLY DO ──
              The agreement had no duties field at all: it recorded what an operator earns and never
              what they cover. Ryan's case is the common one — an operator who is also brewing and
              also driving, because the market cannot yet fund either specialist. That is not a
              different role, it is the same role holding extra work on a stated basis, and the
              condition that gives it back is the part worth writing down. */}
          <ScopeBlock d={d} setD={setD} editable={editable} />

          {/* ── the package ── */}
          <div className="prod-recipe" style={{ marginTop: 10 }}>
            <div className="insp-lbl">What they get</div>
            {d.pkg.map((p: any, i: number) => (
              <label className="prod-toggle" key={i}>
                <input type="checkbox" checked={!!p.included} disabled={!editable}
                  onChange={(e) => setD({ ...d, pkg: d.pkg.map((x: any, j: number) => j === i ? { ...x, included: e.target.checked } : x) })} />
                {p.label}
              </label>
            ))}
          </div>

          <label className="prod-f" style={{ marginTop: 10 }}><span>Notes / special terms</span>
            <textarea rows={3} value={d.notes} disabled={!editable} onChange={(e) => setD({ ...d, notes: e.target.value })} />
          </label>

          <div className="insp-lbl" style={{ marginTop: 8 }}>{summarize(terms, d.market)}</div>

          {/* ── hours invested ── */}
          <HoursBlock agreementId={row.id} covers={d.covers} basis={d.hoursBasis} extra={extra}
                      canLog={isMine || editable} toast={toast} onSaved={onSaved} />

          {/* ── signing ── */}
          <SignBlock row={row} status={status} isMine={isMine} integrity={extra?.integrity}
                     toast={toast} onSaved={onSaved} />

          {/* ── actions ── */}
          <div className="prod-actions" style={{ flexWrap: "wrap" }}>
            {editable && <button type="button" className="btn-pri" onClick={() => save()} disabled={busy}>{busy ? "Saving…" : "Save"}</button>}
            {/* WAS: filtered to sent | active | ended, and FLOW.sent holds none of those — so a sent
                agreement showed no buttons at all, under a note telling you to move it back to draft.
                The owner-side moves are listed explicitly instead. "active" is gone on purpose: an
                agreement becomes active by being countersigned, not by a status update. */}
            {nextStatuses(status).filter((s) => s === "sent" || s === "draft" || s === "ended").map((s) => (
              <button key={s} type="button" className="btn-sec" onClick={() => advance(s)} disabled={busy}>
                {s === "sent" ? (status === "draft" ? "Send to operator" : "Send it back") :
                 s === "draft" ? "Back to draft" : "End it"}
              </button>
            ))}
            {(status === "active" || status === "signed" || status === "accepted") && (
              <button type="button" className="btn-sec" disabled={busy} onClick={async () => {
                if (!supabase) return;
                const why = typeof window !== "undefined"
                  ? window.prompt("Why is this being replaced? (goes on the record of the old version)") : "";
                if (why === null) return;
                setBusy(true);
                const { error } = await supabase.rpc("supersede_agreement", { p_id: row.id, p_why: why || null });
                setBusy(false);
                if (error) { toast(error.message, "error"); return; }
                toast("Version " + (Number(row.version) + 1) + " drafted — the old one is ended and linked.");
                onSaved();
              }}>Draft a new version</button>
            )}
            {isMine && (status === "sent" || status === "countered") && (
              <>
                <button type="button" className="btn-pri" onClick={() => respond("accept")} disabled={busy}>Accept</button>
                <button type="button" className="btn-sec" onClick={() => respond("request_changes")} disabled={busy}>Request changes</button>
                <button type="button" className="btn-sec" onClick={() => respond("counter")} disabled={busy}>Counter</button>
              </>
            )}
          </div>
          {!editable && !isMine && (
            <div className="od-note">Terms are locked once an agreement has been agreed. Move it back to draft to renegotiate.</div>
          )}

          {/* The operator's own view of their own agreement. Shown for their record whatever its
              status — understanding what you signed matters after you sign it too — and the counter
              affordance only appears while a counter is still possible. */}
          {isMine && (
            <DealExplainer
              row={row as any}
              onCounter={status === "sent" || status === "countered"
                ? (note) => respond("counter", note)
                : undefined}
            />
          )}

          <Trail agreementId={row.id} />
        </div>
      )}
    </div>
  );
}

// The record of who moved what, and what they said about it.
function Trail({ agreementId }: { agreementId: string }) {
  const loader = useCallback(async () => {
    if (!supabase) return [];
    const { data } = await supabase.from("operator_agreement_events")
      .select("id, at, kind, note, from_status, to_status")
      .eq("agreement_id", agreementId).order("at", { ascending: false }).limit(12);
    return (data as any[]) ?? [];
  }, [agreementId]);
  const board = useAsyncData<any[]>(loader, []);
  const events = board.data ?? [];
  if (!events.length) return null;
  return (
    <div className="prod-recipe" style={{ marginTop: 10 }}>
      <div className="insp-lbl">History</div>
      {events.map((e) => (
        <div className="od-ev" key={e.id}>
          <span className="od-ev-k">{e.kind}</span>
          <span className="od-ev-t">
            {new Date(e.at).toLocaleDateString()}
            {e.from_status && e.to_status && e.from_status !== e.to_status ? ` · ${e.from_status} → ${e.to_status}` : ""}
          </span>
          {e.note && <span className="od-ev-n">“{e.note}”</span>}
        </div>
      ))}
    </div>
  );
}

// ── SCOPE ─────────────────────────────────────────────────────────────────────────────────────────
// Chips, not a multi-select, because this is a short closed list someone reads rather than searches,
// and because the sentence underneath is the thing being agreed to — a row of chips is not a
// sentence. The vocabulary comes from option_sets (0306/0309), so Ryan adds "roasting" from the
// Lists panel without a deploy.
function ScopeBlock({ d, setD, editable }: { d: any; setD: (v: any) => void; editable: boolean }) {
  const acts = useOptions("agreement_activity");
  const labelOf = (k: string) => acts.find((a) => a.value === k)?.label ?? k;
  const toggle = (k: string) =>
    setD({ ...d, covers: d.covers.includes(k) ? d.covers.filter((x: string) => x !== k) : [...d.covers, k] });

  return (
    <div className="prod-recipe od-scope" style={{ marginTop: 10 }}>
      <div className="insp-lbl">What this operator covers</div>
      <div className="ts-chips" style={{ marginTop: 6 }}>
        {acts.map((a) => {
          const on = d.covers.includes(a.value);
          return (
            <button key={a.value} type="button" className={`ts-chip${on ? " on" : ""}`}
                    disabled={!editable} aria-pressed={on} onClick={() => toggle(a.value)}>
              {on && <><Icon name="check" /> </>}{a.label}
            </button>
          );
        })}
      </div>

      <div className="od-basis">
        {SCOPE_BASIS.map((b) => (
          <button key={b} type="button" className={`od-basis-b${d.scopeBasis === b ? " on" : ""}`}
                  disabled={!editable} aria-pressed={d.scopeBasis === b}
                  onClick={() => setD({ ...d, scopeBasis: b as ScopeBasis })}>
            {SCOPE_BASIS_LABEL[b]}
          </button>
        ))}
      </div>

      {d.scopeBasis === "interim" && (
        <label className="prod-f" style={{ marginTop: 8 }}>
          <span>What ends it <i>— the condition, not a date</i></span>
          <input value={d.scopeUntil} disabled={!editable} maxLength={240}
                 placeholder="until Atlanta covers its own costs and funds a dedicated driver"
                 onChange={(e) => setD({ ...d, scopeUntil: e.target.value })} />
        </label>
      )}

      <label className="prod-f" style={{ marginTop: 8 }}>
        <span>Hours logged against this are <i>— say what they count toward</i></span>
        <select value={d.hoursBasis} disabled={!editable}
                onChange={(e) => setD({ ...d, hoursBasis: e.target.value as HoursBasis })}>
          {HOURS_BASIS.map((h) => <option key={h} value={h}>{HOURS_BASIS_LABEL[h]}</option>)}
        </select>
      </label>

      {/* The sentence, from the same pure function the printed agreement uses. */}
      <div className="od-note" style={{ marginTop: 8 }}>
        {scopeSentence(d.covers, d.scopeBasis, d.scopeUntil, labelOf)}
      </div>
    </div>
  );
}

// ── HOURS ─────────────────────────────────────────────────────────────────────────────────────────
// Nothing in this app recorded hours before 0309 — not one column anywhere. The split that matters
// is not the total: it is how much of it was the interim brewing and driving the agreement calls
// temporary, because that is the number the conversation is actually about.
function HoursBlock({ agreementId, covers, basis, extra, canLog, toast, onSaved }: {
  agreementId: string; covers: string[]; basis: HoursBasis; extra?: Extra;
  canLog: boolean; toast: (m: string, t?: any) => void; onSaved: () => void;
}) {
  const acts = useOptions("agreement_activity");
  const mine = acts.filter((a) => covers.includes(a.value));
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [act, setAct] = useState("");
  const [hrs, setHrs] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (basis === "not_tracked" && !(extra?.hours_total)) return null;

  const log = async () => {
    if (!supabase || busy) return;
    const n = Number(hrs);
    if (!act) { toast("Pick what the hours were for.", "error"); return; }
    if (!Number.isFinite(n) || n <= 0 || n > 24) { toast("Hours has to be between 0 and 24.", "error"); return; }
    setBusy(true);
    const { error } = await supabase.from("agreement_hours")
      .insert({ agreement_id: agreementId, on_date: on, activity: act, hours: n, note: note.trim() || null });
    setBusy(false);
    if (error) {
      // The unique key is the useful error here — say what it means rather than showing the constraint.
      toast(/duplicate|unique/i.test(error.message)
        ? "There is already an entry for that activity on that day — edit it rather than adding a second."
        : error.message, "error");
      return;
    }
    setHrs(""); setNote(""); setOpen(false);
    toast("Logged"); onSaved();
  };

  return (
    <div className="prod-recipe" style={{ marginTop: 10 }}>
      <div className="insp-lbl">Hours invested</div>
      <div className="od-hours">
        <span><b>{(extra?.hours_total ?? 0).toLocaleString()}</b> hours</span>
        <span><b>{extra?.days_worked ?? 0}</b> days</span>
        {(extra?.hours_on_interim_work ?? 0) > 0 && (
          <span className="od-hours-interim">
            <b>{(extra?.hours_on_interim_work ?? 0).toLocaleString()}</b> on interim brewing &amp; driving
          </span>
        )}
      </div>
      <div className="od-note" style={{ marginTop: 4 }}>{HOURS_BASIS_LABEL[basis]}.</div>

      {canLog && (open ? (
        <div className="od-hours-form">
          <label className="prod-f"><span>Day</span>
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
          <label className="prod-f"><span>What for</span>
            <select value={act} onChange={(e) => setAct(e.target.value)}>
              <option value="">Pick one…</option>
              {(mine.length ? mine : acts).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select></label>
          <label className="prod-f"><span>Hours</span>
            <input inputMode="decimal" value={hrs} placeholder="6.5"
                   onChange={(e) => setHrs(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          <label className="prod-f"><span>Note (optional)</span>
            <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="prod-actions">
            <button type="button" className="note-arch" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="note-save" disabled={busy} onClick={log}>{busy ? "…" : "Log it"}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="tm-hire-open" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
          Log hours <span className="ev-chev" aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  );
}

// ── SIGNING ───────────────────────────────────────────────────────────────────────────────────────
// 0281 said it plainly and it was true of 0277 too: this app recorded agreement, not execution.
// Accepting was a click. Nothing at all recorded the company side.
//
// Both signatures are typed names, by an authenticated account, at a time, against a SHA-256 of the
// exact terms. The digest is the part that matters: a name on a row somebody can still edit looks
// like proof and is not. Change a term afterwards and the line below says so.
function SignBlock({ row, status, isMine, integrity, toast, onSaved }: {
  row: Row; status: AgreementStatus; isMine: boolean; integrity?: string;
  toast: (m: string, t?: any) => void; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const altered = integrity === "ALTERED SINCE SIGNING";

  const call = async (fn: "sign_agreement" | "countersign_agreement") => {
    if (!supabase || busy) return;
    if (!name.trim()) { toast("Type your full name to sign.", "error"); return; }
    setBusy(true);
    const { error } = await supabase.rpc(fn, { p_id: row.id, p_typed_name: name.trim() });
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    setName("");
    toast(fn === "sign_agreement" ? "Signed — GT3 countersigns next." : "Countersigned. This agreement is now active.");
    onSaved();
  };

  if (status === "draft" || status === "sent" || status === "changes_requested" || status === "countered") return null;

  return (
    <div className={`prod-recipe od-sign${altered ? " altered" : ""}`} style={{ marginTop: 10 }}>
      <div className="insp-lbl">Signatures</div>

      <div className="od-sig-rows">
        <div className="od-sig">
          <span className="od-sig-who">{row.operator_name}</span>
          {row.signed_at
            ? <span className="od-sig-done"><Icon name="check" /> {row.signed_name} · {new Date(row.signed_at).toLocaleDateString()}</span>
            : <span className="od-sig-wait">not signed</span>}
        </div>
        <div className="od-sig">
          <span className="od-sig-who">For GT3 Performance Bar</span>
          {row.countersigned_at
            ? <span className="od-sig-done"><Icon name="check" /> {row.countersigned_name} · {new Date(row.countersigned_at).toLocaleDateString()}</span>
            : <span className="od-sig-wait">not countersigned</span>}
        </div>
      </div>

      {/* THE WHOLE POINT OF STORING A DIGEST. Without this line the signature above is decoration. */}
      {row.signed_at && (
        <div className={`od-integrity${altered ? " bad" : ""}`}>
          {altered
            ? <><Icon name="warning" /> These terms have changed since {row.signed_name} signed. Draft a new version rather than treating this as executed.</>
            : <><Icon name="check" /> Matches the terms {row.signed_name} signed.</>}
        </div>
      )}

      {((isMine && status === "accepted") || (!row.countersigned_at && status === "signed")) && (
        <div className="od-sign-form">
          <label className="prod-f">
            <span>{status === "accepted" ? "Type your full name to sign" : "Type your full name to countersign for GT3"}</span>
            <input value={name} maxLength={80} autoComplete="off"
                   placeholder={status === "accepted" ? row.operator_name : "Your name"}
                   onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" className="btn-pri" disabled={busy || !name.trim()}
                  onClick={() => call(status === "accepted" ? "sign_agreement" : "countersign_agreement")}>
            {busy ? "…" : status === "accepted" ? "Sign" : "Countersign & activate"}
          </button>
          <p className="od-note">
            Typing your name here records it against a fingerprint of these exact terms. It is a record
            of agreement, not a substitute for whatever execution your counsel requires.
          </p>
        </div>
      )}
    </div>
  );
}
