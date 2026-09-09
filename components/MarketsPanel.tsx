"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, roleOf } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "@/components/kit";
import Icon from "./Icon";
import Field from "./Field";

// MARKETS — the readiness engine, finally on a screen.
//
// ── WHAT THIS EXISTS FOR ───────────────────────────────────────────────────────────────────────
// 0296 and 0297 built v_market_readiness: one row per market per check, across Launch, Crew,
// Compliance, Prep, Equipment, Packaging, item classification and batch accounting, each with its
// own status, its own plain-English detail, and a `blocking` flag — rolled up by
// v_market_readiness_summary into can_open. It is the richest "can this city open?" construct in
// the schema and NOTHING IN THE APP READ IT. Not one component.
//
// Five setter RPCs were in the same state: set_market_live, set_market_opens_on,
// set_market_office_terms, set_market_offer_disclaimer and set_market_lead all shipped with their
// authorization written and no caller anywhere. Opening Atlanta was a SQL-editor operation, and
// the answer to "why can't we open yet?" was a query nobody could run from a phone.
//
// (set_market_lead now lives on the person, in CrewPerson — leadership is a fact about a human,
// not a setting on a city, and putting it in both places would be two homes for one rule.)
//
// ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
// It does not recompute readiness. Every status, every sentence and every count comes from the
// view, so the screen and the database cannot disagree about whether a city can open. The one
// thing this file decides is the order to show them in.
//
// It also does NOT expose set_market_office_terms, and that omission is deliberate. Corporate
// delivery pricing has two homes: live_status.office_price_cents (company-wide, id=1) and
// markets.office_price_cents (per market, 0282). Every reader in the application — OfficeOrder via
// useOfficeSettings, and app/api/office which prices the order server-side — reads the SINGLETON.
// Nothing anywhere reads the per-market column. So a control here would let an owner change a
// number, show them a success toast, and change no price for any customer.
//
// That is the same defect this whole round exists to fix, so shipping it would be absurd. The
// per-market override needs a reader before it needs an editor; until then the existing
// "Office delivery · price & minimum" panel in this same section is the one true home, and one
// home is the point. Recorded here so nobody adds the control without checking who reads it.

type Check = {
  market: string; area: string; check_name: string;
  status: "ready" | "blocked" | "unknown"; detail: string; blocking: boolean;
};
type Summary = {
  market: string; blocked: number; unknown: number; ready: number;
  advisories: number; can_open: boolean;
};
type Market = {
  slug: string; name: string; region: string | null; state: string | null;
  active: boolean; is_live: boolean | null; opens_on: string | null;
  offer_disclaimer: string | null;
};
type Data = { markets: Market[]; checks: Check[]; summary: Record<string, Summary> };

const dayStr = (iso?: string | null) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;

// The status word is always rendered. Colour alone is not a status — a person who cannot see the
// difference between the two greens still has to be able to read this screen.
const STATUS_WORD: Record<Check["status"], string> = {
  ready: "Ready", blocked: "Blocked", unknown: "Not recorded",
};

export default function MarketsPanel() {
  const { profile } = useAuth();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const isOwner = roleOf(profile) === "owner";

  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { markets: [], checks: [], summary: {} };
    const [m, c, s] = await Promise.all([
      supabase.from("markets")
        .select("slug, name, region, state, active, is_live, opens_on, offer_disclaimer")
        .order("name"),
      supabase.from("v_market_readiness").select("market, area, check_name, status, detail, blocking"),
      supabase.from("v_market_readiness_summary").select("market, blocked, unknown, ready, advisories, can_open"),
    ]);
    if (m.error) throw new Error(m.error.message);
    if (c.error) throw new Error(c.error.message);
    const summary: Record<string, Summary> = {};
    ((s.data as Summary[]) ?? []).forEach((r) => { summary[r.market] = r; });
    return { markets: (m.data as Market[]) ?? [], checks: (c.data as Check[]) ?? [], summary };
  }, []);
  const state = useAsyncData<Data>(loader, []);
  const reload = state.reload;

  const call = async (fn: string, args: Record<string, unknown>, ok: string) => {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    // The RPCs refuse in sentences — "That market opens on 2026-12-01. Move the opening date first
    // if you mean to go live early." Show what they said rather than a generic failure.
    if (error) { toast(error.message, "error"); return; }
    toast(ok);
    setEditing(null);
    reload();
  };

  return (
    <AsyncSection state={state} isEmpty={({ markets }) => markets.length === 0}
      emptyTitle="No markets" emptySub="Every city GT3 operates in lives here."
      loadingLabel="Reading readiness…" errorTitle="Couldn't load markets">
      {({ markets, checks, summary }) => (
        <div className="adm-sec">
          <SectionHeader label="Markets" annotation={`${markets.length} on file`} />
          <div className="h-sub">
            Whether a city can open, and why not. Every line comes from the readiness view, so this
            screen and the database always agree.
          </div>

          {markets.map((mk) => {
            const sum = summary[mk.slug];
            const mine = checks.filter((c) => c.market === mk.slug);
            const blockers = mine.filter((c) => c.blocking && c.status !== "ready");
            const open = openId === mk.slug;
            return (
              <div key={mk.slug} className="prod-recipe" style={{ marginTop: 12 }}>
                <button type="button" className="tm-open" aria-expanded={open}
                        onClick={() => setOpenId(open ? null : mk.slug)}>
                  <span>
                    <b>{mk.name}</b>
                    {mk.region ? <> · {mk.region}</> : null}
                  </span>
                  <span className="ev-chev" aria-hidden="true">{open ? "⌄" : "›"}</span>
                </button>

                {/* The headline, in words. "can_open" is the view's own verdict, not ours. */}
                <p className="cp-line">
                  {sum?.can_open
                    ? <><b>{mk.is_live ? "Open and live." : "Ready to open."}</b>{" "}
                        {sum.advisories > 0 && <span className="dim">{sum.advisories} advisor{sum.advisories === 1 ? "y" : "ies"} outstanding.</span>}</>
                    : <><b>Cannot open yet</b> — {blockers.length} check{blockers.length === 1 ? "" : "s"} outstanding.</>}
                </p>

                {/* Blockers first and always visible; the rest behind the toggle. What is wrong is
                    the reason somebody opened this screen. */}
                {blockers.map((c) => (
                  <div key={c.check_name} className="cp-step">
                    <span className="cp-step-k"><i className="cp-dot" /></span>
                    <span className="cp-step-b">
                      <b>{c.check_name} · {STATUS_WORD[c.status]}</b>
                      <i>{c.detail}</i>
                    </span>
                  </div>
                ))}

                {open && (
                  <>
                    {mine.filter((c) => !(c.blocking && c.status !== "ready")).map((c) => (
                      <div key={c.check_name} className={`cp-step${c.status === "ready" ? " done" : ""}`}>
                        <span className="cp-step-k">
                          {c.status === "ready" ? <Icon name="check" /> : <i className="cp-dot" />}
                        </span>
                        <span className="cp-step-b">
                          <b>{c.check_name} · {STATUS_WORD[c.status]}</b>
                          <i>{c.detail}</i>
                        </span>
                      </div>
                    ))}

                    <div className="cp-block-h" style={{ marginTop: 14 }}>
                      <span>Settings</span>
                      <b>{mk.is_live ? "Live" : "Not live"}</b>
                    </div>

                    {isOwner ? (
                      <>
                        <p className="cp-line">
                          <button type="button" className="cp-inline-act" disabled={busy}
                                  onClick={() => call("set_market_live", { p_market: mk.slug, p_live: !mk.is_live },
                                                      mk.is_live ? `${mk.name} is no longer taking orders.` : `${mk.name} is live.`)}>
                            {mk.is_live ? `Take ${mk.name} offline` : `Put ${mk.name} live`}
                          </button>
                        </p>

                        <label className="prod-f">
                          <span>Opens on</span>
                          <input type="date" defaultValue={mk.opens_on ?? ""} disabled={busy}
                                 onBlur={(e) => {
                                   const v = e.target.value || null;
                                   if (v === (mk.opens_on ?? null)) return;
                                   call("set_market_opens_on", { p_market: mk.slug, p_opens_on: v },
                                        v ? `${mk.name} opens ${dayStr(v)}.` : `${mk.name} has no opening date.`);
                                 }} />
                        </label>

                        <div className="cp-block-h" style={{ marginTop: 12 }}>
                          <span>Offer letter disclaimer</span>
                          <b>{mk.offer_disclaimer ? "On file" : "Missing"}</b>
                        </div>
                        {editing === `disc:${mk.slug}` ? (
                          <Disclaimer mk={mk} busy={busy} onCancel={() => setEditing(null)}
                                      onSave={(text) =>
                                        call("set_market_offer_disclaimer", { p_market: mk.slug, p_text: text },
                                             text.trim() ? `Disclaimer saved for ${mk.name}.` : `Disclaimer cleared for ${mk.name}.`)} />
                        ) : (
                          <p className="cp-line dim">
                            {mk.offer_disclaimer
                              ? "Every offer letter for this market prints it on the first page."
                              : "No disclaimer on file. Offer letters for this market print a block saying so where it belongs — deliberately, because a letter that looks finished and is not is worse. This is counsel's text, not ours to invent."}
                            {" "}
                            <button type="button" className="cp-inline-act" onClick={() => setEditing(`disc:${mk.slug}`)}>
                              {mk.offer_disclaimer ? "Change" : "Add it"}
                            </button>
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="cp-line dim">
                        Market settings — going live, opening dates, corporate terms and the offer
                        disclaimer — are owner decisions.
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AsyncSection>
  );
}

function Disclaimer({ mk, busy, onSave, onCancel }: {
  mk: Market; busy: boolean; onSave: (text: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(mk.offer_disclaimer ?? "");
  return (
    <div style={{ marginTop: 8 }}>
      <Field
        label={`At-will disclaimer for ${mk.name}`}
        kind="multiline"
        rows={4}
        value={text}
        disabled={busy}
        onChange={setText}
        placeholder="Paste the text your lawyer drafted for this state."
        hint="S.C. Code 41-1-110 wants this in underlined capitals on the first page. The letter renders it that way; the words are counsel's."
      />
      <div className="prod-actions">
        <button type="button" className="btn-pri" disabled={busy} onClick={() => onSave(text)}>
          {busy ? "Saving…" : "Save disclaimer"}
        </button>
        <button type="button" className="btn-sec" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
