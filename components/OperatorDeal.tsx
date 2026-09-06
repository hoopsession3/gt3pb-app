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
import {
  computeSplit, project, bestFundingForOperator, summarize,
  TIERS, TIER, nextTier, STAGES, STAGE_LABEL, STATUS_LABEL,
  nextStatuses, isEditable, toStatus, toTier, toStage, validateProposal,
  type DealTerms, type AgreementStatus,
} from "@/lib/operatorDeal";

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

const money = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;

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
};

export default function OperatorDeal() {
  const { user } = useAuth();
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("operator_agreements")
      .select("id, market, operator_name, operator_email, operator_user_id, status, tier, stage, supply_funding, operator_pct, royalty_pct, market_pct, package, notes, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data as any[]) ?? []).map((r) => ({ ...r, package: Array.isArray(r.package) ? r.package : [] }));
  }, []);
  const board = useAsyncData<Row[]>(loader, []);
  const { reload } = board;
  const rows = board.data ?? [];

  const createDraft = async () => {
    if (!supabase) return;
    setBusy(true);
    const split = computeSplit({ supplyFunding: 50, stage: "ramp", tier: "associate" });
    const { data, error } = await supabase.from("operator_agreements").insert({
      market: "atlanta", operator_name: "New operator", status: "draft",
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
            <SectionHeader label="Operator agreements" annotation={`${rows.length} on file`} />
            <button type="button" className="btn-sec" onClick={createDraft} disabled={busy || creating}>
              {busy ? "Creating…" : "+ New agreement"}
            </button>
          </div>
          <div className="h-sub">
            Build the deal on the slider, see what the operator actually takes home, then send it for their
            response. They can accept, ask for changes, or counter — every move is kept.
          </div>

          {rows.length === 0 && (
            <div className="prod-recipe" style={{ marginTop: 12 }}>
              <div className="insp-lbl">Nothing on file</div>
              <p className="h-sub" style={{ margin: "4px 0 0" }}>
                Start one for your head of Atlanta ops — the default lands on the agreed 50/30/20.
              </p>
            </div>
          )}

          {rows.map((r) => (
            <AgreementRow
              key={r.id} row={r} open={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onSaved={reload} toast={toast} meId={user?.id ?? null}
            />
          ))}
        </div>
      )}
    </AsyncSection>
  );
}

function AgreementRow({ row, open, onToggle, onSaved, toast, meId }: {
  row: Row; open: boolean; onToggle: () => void; onSaved: () => void;
  toast: (m: string, t?: any) => void; meId: string | null;
}) {
  const status = toStatus(row.status);
  const [d, setD] = useState({
    operatorName: row.operator_name, operatorEmail: row.operator_email ?? "",
    market: toMarket(row.market), tier: toTier(row.tier), stage: toStage(row.stage),
    supplyFunding: Number(row.supply_funding) || 50,
    pkg: row.package.length ? row.package : DEFAULT_PACKAGE,
    notes: row.notes ?? "",
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
    setBusy(true);
    const { error } = await supabase.from("operator_agreements").update({
      operator_name: d.operatorName.trim(), operator_email: d.operatorEmail.trim() || null,
      market: d.market, tier: d.tier, stage: d.stage, supply_funding: d.supplyFunding,
      operator_pct: split.operatorPct, royalty_pct: split.royaltyPct, market_pct: split.marketPct,
      package: d.pkg, notes: d.notes.trim() || null, updated_at: new Date().toISOString(),
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
  const respond = async (action: "accept" | "request_changes" | "counter") => {
    if (!supabase) return;
    const note = typeof window !== "undefined"
      ? window.prompt(action === "accept" ? "Anything to note with your acceptance? (optional)" : "What would you like changed?") ?? ""
      : "";
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
              <div><b>{money(proj.operatorGrossCents)}</b><span>Operator share</span></div>
              <div><b>−{money(proj.operatorSuppliesCents)}</b><span>Supplies they fund</span></div>
              <div className="od-fig-key"><b>{money(proj.operatorNetCents)}</b><span>Operator keeps</span></div>
              <div><b>{money(proj.royaltyCents)}</b><span>GT3 royalty</span></div>
              <div><b>{money(proj.marketCents)}</b><span>Into the market</span></div>
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

          {/* ── actions ── */}
          <div className="prod-actions" style={{ flexWrap: "wrap" }}>
            {editable && <button type="button" className="btn-pri" onClick={() => save()} disabled={busy}>{busy ? "Saving…" : "Save"}</button>}
            {nextStatuses(status).filter((s) => s === "sent" || s === "active" || s === "ended").map((s) => (
              <button key={s} type="button" className="btn-sec" onClick={() => advance(s)} disabled={busy}>
                {s === "sent" ? "Send to operator" : s === "active" ? "Make it active" : "End it"}
              </button>
            ))}
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
