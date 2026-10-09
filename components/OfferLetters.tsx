"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "@/components/kit";
import Icon from "@/components/Icon";
import { MARKETS, MARKET_LABEL, toMarket } from "@/lib/markets";
import { homeMarket } from "@/lib/homeMarket";
import OfferLetterPrint, { type LetterRow } from "./OfferLetterPrint";
import {
  ROLE_ACCESS, OFFERABLE_ROLES, toRoleKey, toOfferStatus, isEditable, money, summarize,
  validateOffer, classificationFlags, approvalTally, STATUTORY_FIELDS,
  money as fmtMoney,
  type OfferStatus, type OfferTerms, type RoleKey,
} from "@/lib/offerLetter";
import { startOffer, restateDefaults, forPerson, type OfferPerson, type HouseRow, type OfferContext } from "@/lib/offerDraft";
import { payAtVolumes, DEFAULT_VOLUMES } from "@/lib/dealExplainer";
import { roleLabel } from "@/lib/roles";
import { useConfirm } from "@/components/ConfirmSheet";
import PersonPick, { type PersonValue, type PersonHow } from "./PersonPick";
import { useCrew } from "./useCrew";
import { fullestName } from "@/lib/customerKnown";
import { readParam, dropParam } from "@/lib/urlParam";
import { usePersonFacts, withFacts } from "@/lib/personFacts";

// OFFER LETTERS (0281) — the owner's side of hiring someone.
//
// Three surfaces in one, because they are three views of the same record and splitting them would
// mean three places to keep in step:
//   · WRITE   — the owner drafts. The role picker shows what that role actually reaches.
//   · REVIEW  — a co-owner approves or asks for changes. Nothing sends until they all agree.
//   · TRAIL   — who did what, when. Read-only, and the database is the only thing that writes it.
//
// The screen never decides who may do what: every action here is a security-definer RPC that checks
// again server-side (submit_offer_for_review, decide_on_offer). If this component were wrong, the
// database would still refuse. It is a good front door, not the lock.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = {
  id: string; market: string; candidate_name: string; candidate_email: string; candidate_user_id: string | null; title: string;
  role: string; employment_type: string; base_cents: number | null; rate_per: string | null;
  commission_pct: number | null; starts_on: string | null; reports_to: string | null;
  package: any; notes: string | null; status: string; author_id: string | null;
  normal_hours: string | null; pay_schedule: string | null; pay_method: string | null; deductions: string | null;
  created_at: string; updated_at: string;
};
type Approval = { offer_id: string; approver_id: string; decision: string | null; note: string | null; decided_at: string | null };
type Ev = { id: string; offer_id: string; at: string; kind: string; note: string | null; from_status: string | null; to_status: string | null };
/** A customer with an account who is not on the crew (v_promotable, 0299) — an offer can go to them before they are hired. */
type Member = { id: string; display_name: string | null; email: string | null; market: string | null; customer_name: string | null };
// An offer already settled is not the one to reopen for someone: a new letter is.
const SETTLED = new Set(["declined", "withdrawn", "expired"]);

const STATUS_COPY: Record<OfferStatus, { label: string; tone: "draft" | "wait" | "ok" | "stop" }> = {
  draft:             { label: "Draft",              tone: "draft" },
  in_review:         { label: "With the co-owners", tone: "wait" },
  changes_requested: { label: "Changes asked for",  tone: "stop" },
  approved:          { label: "Approved — ready to send", tone: "ok" },
  sent:              { label: "With the candidate", tone: "wait" },
  countered:         { label: "Countered",          tone: "stop" },
  accepted:          { label: "Accepted",           tone: "ok" },
  declined:          { label: "Declined",           tone: "stop" },
  withdrawn:         { label: "Withdrawn",          tone: "draft" },
  expired:           { label: "Expired",            tone: "draft" },
};

const dollarsToCents = (s: string) => { const n = Number(String(s).replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };
const centsToDollars = (c: number | null | undefined) => (c == null ? "" : String(Math.round(c / 100)));
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function OfferLetters() {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const isOwner = roleOf(profile) === "owner";
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OfferTerms | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<LetterRow | null>(null);

  const loader = useCallback(async () => {
    if (!supabase) return { rows: [] as Row[], approvals: [] as Approval[], events: [] as Ev[], letters: [] as LetterRow[], members: [] as Member[], membersFailed: false };
    const [{ data: rows, error }, { data: ap }, { data: ev }, mem] = await Promise.all([
      supabase.from("offer_letters").select("*").order("updated_at", { ascending: false }),
      supabase.from("offer_approvals").select("offer_id, approver_id, decision, note, decided_at"),
      supabase.from("offer_events").select("id, offer_id, at, kind, note, from_status, to_status").order("at", { ascending: false }),
      // Who an offer can go to besides the crew: customers who already have an account.
      supabase.from("v_promotable").select("id, display_name, email, market, customer_name"),
    ]);
    if (error) throw new Error(error.message);
    // v_offer_letter (0286) carries the market's disclaimer alongside the offer, so the printed
    // letter is one read and cannot disagree with the record it came from.
    const { data: letters } = await supabase.from("v_offer_letter").select("*");
    return { rows: (rows as Row[]) ?? [], approvals: (ap as Approval[]) ?? [], events: (ev as Ev[]) ?? [],
             letters: (letters as LetterRow[]) ?? [],
             // A failed read of the customers is said, not shown as "nobody has an account".
             members: (mem.data as Member[]) ?? [], membersFailed: !!mem.error };
  }, []);
  const board = useAsyncData(loader, []);
  // One identity per load, so the memos below recompute when the board does and not every render.
  const data = board.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const approvals = useMemo(() => data?.approvals ?? [], [data]);
  const events = useMemo(() => data?.events ?? [], [data]);
  const letters = data?.letters ?? [];
  const members = useMemo(() => data?.members ?? [], [data]);

  // ── WHO AN OFFER CAN BE FOR, AND WHAT WE ALREADY KNOW ABOUT THEM ─────────────────────────────
  // The crew (useCrew — everyone but you) and customers with an account, as lib/offerDraft's
  // OfferPerson. A crew member's email is not on the roster; it is read from their customer record
  // when they are picked (lib/personFacts), and fills the letter if nobody has typed one meanwhile.
  const crew = useCrew();
  const people = useMemo<OfferPerson[]>(() => [
    ...crew.filter((c) => c.id !== user?.id).map((c) => ({
      id: c.id, name: c.display_name ?? "", email: null,
      role: c.role, market: homeMarket(c), title: c.title ?? null,
    })),
    ...members.map((m) => ({
      id: m.id, name: fullestName(m.customer_name, m.display_name), email: m.email,
      role: null, market: m.market, title: null,
    })),
  ], [crew, members, user?.id]);
  const personOf = useCallback((id: string | null | undefined): OfferPerson | null =>
    withFacts(id ? people.find((p) => p.id === id) ?? null : null), [people]);
  // The person just picked (or arrived for), whose file is read once to fill what the roster lacks.
  const [fresh, setFresh] = useState<string | null>(null);
  const memberOptions = useMemo(() => members.map((m) => ({ id: m.id, name: fullestName(m.customer_name, m.display_name) || m.email || "Unnamed" })), [members]);
  // The defaults that follow a choice (lib/offerDraft restateDefaults): the house wording from past
  // letters, and who leads the market the offer is for.
  const ctx = useMemo<OfferContext>(() => ({
    history: rows as readonly HouseRow[],
    leadOf: (m, candidate) => {
      const c = crew.find((x) => x.leads_market === m && x.id !== candidate);
      return c ? { id: c.id, name: c.display_name ?? "" } : null;
    },
  }), [rows, crew]);

  const pickFor = useCallback((v: PersonValue, how: PersonHow) => {
    if (how === "type") return;
    setDraft((d) => {
      if (!d) return d;
      const p = v.id ? personOf(v.id) ?? { id: v.id, name: v.name, email: null, role: null, market: null, title: null } : null;
      return restateDefaults(d, forPerson(d, personOf(d.candidateUserId), p), ctx);
    });
    setFresh(v.id);
  }, [personOf, ctx]);

  // What their file adds — a crew member's email, the name they gave in full — fills the letter if
  // it is still for them and the fields still hold what the pick put there.
  usePersonFacts(fresh, (id) => {
    const roster = people.find((p) => p.id === id) ?? null;
    setDraft((d) => (d && roster && d.candidateUserId === id ? forPerson(d, roster, withFacts(roster)) : d));
  });

  // ── ARRIVING FOR SOMEONE: ?offer_for=<their id> ─────────────────────────────────────────────
  // From their page on the crew, or from "Draft their offer letter" right after bringing them on:
  // the letter they already have opens, or a new one starts already for them. Read once (lib/urlParam);
  // acted on the first render that has both lists, so it never guesses from half of them.
  const [arriving, setArriving] = useState<string | null>(() => readParam("offer_for"));
  useEffect(() => { dropParam("offer_for"); }, []);
  const [arrivedNote, setArrivedNote] = useState<string | null>(null);
  if (arriving && board.data && crew.length > 0) {
    setArriving(null);
    const theirs = rows.find((r) => r.candidate_user_id === arriving && !SETTLED.has(r.status));
    const p = people.find((x) => x.id === arriving) ?? null;
    if (theirs) { setOpenId(theirs.id); setDraft(null); }
    else if (p) { const s0 = startOffer(ctx); setOpenId(null); setDraft(restateDefaults(s0, forPerson(s0, null, withFacts(p)), ctx)); setFresh(p.id); }
    else setArrivedNote("That person isn't on the crew or among the customers with an account any more — pick them from the list, or start the offer for someone new.");
  }

  const open = rows.find((r) => r.id === openId) ?? null;
  const openApprovals = useMemo(() => approvals.filter((a) => a.offer_id === openId), [approvals, openId]);
  const openEvents = useMemo(() => events.filter((e) => e.offer_id === openId), [events, openId]);

  // Is the signed-in owner a required approver who hasn't decided yet? That's the only thing that
  // makes the review panel appear, so a co-owner sees exactly what's waiting on them.
  const myApproval = openApprovals.find((a) => a.approver_id === user?.id);
  const awaitingMe = open?.status === "in_review" && myApproval && !myApproval.decision;

  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    toast(ok); board.reload();
  };

  const saveDraft = async () => {
    if (!supabase || !draft) return;
    const v = validateOffer(draft);
    if (!v.ok) { toast(v.problems[0], "error"); return; }
    setBusy(true);
    const patch = {
      market: draft.market, candidate_name: draft.candidateName.trim(), candidate_email: draft.candidateEmail.trim(),
      // Who it is for, by account — what their onboarding steps, the deadlines board and their own
      // copy read (0311, 0320). Nothing wrote it before; it was linked only when they answered.
      candidate_user_id: draft.candidateUserId ?? null,
      title: draft.title.trim(), role: draft.role, employment_type: draft.employmentType,
      base_cents: draft.baseCents, rate_per: draft.baseCents ? draft.ratePer : null,
      commission_pct: draft.commissionPct, starts_on: draft.startOn || null,
      reports_to: draft.reportsTo?.trim() || null, package: draft.package ?? [],
      // 0286 — the four S.C. Code 41-10-30 facts. The submit RPC refuses without them.
      normal_hours: draft.normalHours?.trim() || null, pay_schedule: draft.paySchedule?.trim() || null,
      pay_method: draft.payMethod?.trim() || null, deductions: draft.deductions?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const res = openId
      ? await supabase.from("offer_letters").update(patch).eq("id", openId)
      : await supabase.from("offer_letters").insert({ ...patch, author_id: user?.id ?? null }).select("id").single();
    setBusy(false);
    if ((res as any).error) { toast((res as any).error.message, "error"); return; }
    if (!openId && (res as any).data?.id) setOpenId((res as any).data.id);
    setDraft(null); toast("Saved"); board.reload();
  };

  if (!isOwner) {
    return (
      <div className="ofr">
        <p className="ofr-locked"><Icon name="lock" /> Offer letters are owner-only. They carry someone&rsquo;s pay, and a hiring decision in progress isn&rsquo;t general staff information.</p>
      </div>
    );
  }

  return (
    <div className="ofr">
      {printing && <OfferLetterPrint row={printing} onClose={() => setPrinting(null)} />}
      <SectionHeader label="Offer letters" annotation="write · approve · send" />

      <AsyncSection state={board} loadingLabel="Loading offers…" errorTitle="Couldn’t load offers" emptyTitle="No offers yet">{() => (
       <>
        <div className="ofr-actions">
          <button type="button" className="btn-pri btn-wide" onClick={() => { setOpenId(null); setArrivedNote(null); setDraft(startOffer(ctx)); }}>
            <Icon name="plus" /> New offer
          </button>
        </div>

        {arrivedNote && <p className="ofr-stat-why" role="status">{arrivedNote}</p>}
        {rows.length === 0 && !draft && <p className="ofr-empty">No offers yet. The first one starts with a name and a title.</p>}

        {/* ── the list ── */}
        {rows.length > 0 && (
          <div className="ofr-list">
            {rows.map((r) => {
              const st = STATUS_COPY[toOfferStatus(r.status)];
              const t = approvalTally(approvals.filter((a) => a.offer_id === r.id));
              return (
                <button type="button" key={r.id} className={`ofr-row${openId === r.id ? " on" : ""}`}
                  onClick={() => { setOpenId(openId === r.id ? null : r.id); setDraft(null); }}>
                  <span className="ofr-row-who">
                    <b>{r.candidate_name}</b>
                    <em>{r.title} · {MARKET_LABEL[toMarket(r.market)]}</em>
                  </span>
                  <span className="ofr-row-meta">
                    {r.status === "in_review" && t.total > 0 && (
                      <span className="ofr-tally">{t.approved}/{t.total} approved</span>
                    )}
                    <span className={`ofr-chip ${st.tone}`}>{st.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── the writer ── */}
        {draft && <OfferForm draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => setDraft(null)} busy={busy}
                             onPick={pickFor} members={memberOptions} membersFailed={!!board.data?.membersFailed} ctx={ctx} />}

        {/* ── one offer, opened ── */}
        {open && !draft && (
          <div className="ofr-detail">
            <div className="ofr-letter">
              <p className="ofr-letter-k">The offer</p>
              <p className="ofr-letter-line">{summarize({
                title: open.title, market: toMarket(open.market), baseCents: open.base_cents,
                ratePer: (open.rate_per as any) ?? undefined, commissionPct: open.commission_pct ?? undefined,
                employmentType: open.employment_type as any,
              })}</p>
              <dl className="ofr-facts">
                <div><dt>To</dt><dd>{open.candidate_name} · {open.candidate_email}</dd></div>
                <div><dt>Starts</dt><dd>{open.starts_on ?? "Not set"}</dd></div>
                <div><dt>Reports to</dt><dd>{open.reports_to ?? "Not set"}</dd></div>
                <div><dt>Base</dt><dd>{open.base_cents ? `${money(open.base_cents)}/${open.rate_per === "hour" ? "hr" : "yr"}` : "None"}</dd></div>
                <div><dt>Commission</dt><dd>{open.commission_pct ? `${open.commission_pct}%` : "None"}</dd></div>
                <div><dt>Access granted</dt><dd>{roleLabel(open.role)}</dd></div>
                <div><dt>Normal hours</dt><dd>{open.normal_hours ?? "Not set"}</dd></div>
                <div><dt>Paid</dt><dd>{open.pay_schedule ?? "Not set"}{open.pay_method ? ` · ${open.pay_method}` : ""}</dd></div>
                <div><dt>Deductions</dt><dd>{open.deductions ?? "Not set"}</dd></div>
              </dl>
              <RoleReach role={toRoleKey(open.role)} />
              <PayRange offer={open} />
              <div className="ofr-letter-do">
                <button type="button" className="btn-ter"
                  onClick={() => { const l = letters.find((x) => x.id === open.id); if (l) setPrinting(l); }}
                  disabled={!letters.some((x) => x.id === open.id)}>
                  <Icon name="package" /> View as a letter
                </button>
              </div>
            </div>

            {/* The approving co-owner reads this. 0286 writes a disclaimer_missing event at submit
                when the market has no at-will wording on file; surfacing it here means the gap is
                seen at the moment of the decision rather than found later in the trail. */}
            {openEvents.some((e) => e.kind === "disclaimer_missing") && (
              <div className="ofr-warn">
                <p className="ofr-warn-h"><Icon name="warning" /> No at-will disclaimer on file for {MARKET_LABEL[toMarket(open.market)]}</p>
                <p>
                  South Carolina wants it in underlined capitals on the first page; Georgia needs the
                  sentence so an annual salary doesn&rsquo;t read as a one-year hiring. This
                  doesn&rsquo;t block the offer — it&rsquo;s here so approving it is a decision
                  rather than an oversight. Once your lawyer supplies the sentence, an owner sets it
                  once per market and this goes away.
                </p>
              </div>
            )}

            {/* approvals */}
            {openApprovals.length > 0 && (
              <div className="ofr-panel">
                <h4>Co-owner approval</h4>
                <ul className="ofr-approvals">
                  {openApprovals.map((a) => (
                    <li key={a.approver_id} className={a.decision ?? "pending"}>
                      <span className="ofr-ap-dot" aria-hidden />
                      <span className="ofr-ap-who">{a.approver_id === user?.id ? "You" : "Co-owner"}</span>
                      <span className="ofr-ap-state">
                        {a.decision === "approved" ? "Approved" : a.decision === "changes_requested" ? "Asked for changes" : "Waiting"}
                        {a.decided_at ? ` · ${when(a.decided_at)}` : ""}
                      </span>
                      {a.note && <span className="ofr-ap-note">&ldquo;{a.note}&rdquo;</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* the co-owner's decision */}
            {awaitingMe && <ReviewPanel busy={busy}
              onDecide={(action, note) => rpc("decide_on_offer", { p_id: open.id, p_action: action, p_note: note || null },
                action === "approve" ? "Approved" : "Sent back with your notes")} />}

            {/* the owner's actions */}
            <div className="ofr-do">
              {isEditable(toOfferStatus(open.status)) && (
                <>
                  <button type="button" className="btn-sec" disabled={busy} onClick={() => setDraft({
                    candidateUserId: open.candidate_user_id,
                    candidateName: open.candidate_name, candidateEmail: open.candidate_email, title: open.title,
                    role: toRoleKey(open.role), market: toMarket(open.market),
                    employmentType: open.employment_type === "contractor" ? "contractor" : "employee",
                    baseCents: open.base_cents, ratePer: (open.rate_per as any) ?? "year",
                    commissionPct: open.commission_pct, startOn: open.starts_on, reportsTo: open.reports_to,
                    normalHours: open.normal_hours, paySchedule: open.pay_schedule,
                    payMethod: open.pay_method, deductions: open.deductions,
                    package: Array.isArray(open.package) ? open.package : [],
                  })}>Edit</button>
                  <button type="button" className="btn-pri btn-wide" disabled={busy}
                    onClick={() => rpc("submit_offer_for_review", { p_id: open.id }, "Sent to the co-owners")}>
                    Send for approval <Icon name="arrowRight" />
                  </button>
                </>
              )}
              {open.status === "approved" && (
                <button type="button" className="btn-pri btn-wide" disabled={busy} onClick={async () => {
                  if (!supabase) return;
                  setBusy(true);
                  const { error } = await supabase.from("offer_letters")
                    .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                    .eq("id", open.id);
                  setBusy(false);
                  if (error) { toast(error.message, "error"); return; }
                  toast(`Sent to ${open.candidate_name}`); board.reload();
                }}>Send to {open.candidate_name.split(" ")[0]} <Icon name="arrowRight" /></button>
              )}
              {!["accepted", "declined", "withdrawn", "expired"].includes(open.status) && (
                <button type="button" className="btn-ter" disabled={busy} onClick={async () => {
                  if (!supabase) return;
                  if (!(await confirm({ title: "Withdraw this offer?", body: "It stays on the record.", confirmLabel: "Withdraw" }))) return;
                  setBusy(true);
                  const { error } = await supabase.from("offer_letters").update({ status: "withdrawn", updated_at: new Date().toISOString() }).eq("id", open.id);
                  setBusy(false);
                  if (error) { toast(error.message, "error"); return; }
                  toast("Withdrawn"); board.reload();
                }}>Withdraw</button>
              )}
            </div>

            {/* the trail */}
            {openEvents.length > 0 && (
              <div className="ofr-panel">
                <h4>Record</h4>
                <ol className="ofr-trail">
                  {openEvents.map((e) => (
                    <li key={e.id}>
                      <span className="ofr-tr-k">{e.kind.replace(/_/g, " ")}</span>
                      <span className="ofr-tr-at">{when(e.at)}</span>
                      {e.note && <span className="ofr-tr-note">&ldquo;{e.note}&rdquo;</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
       </>
      )}</AsyncSection>
    </div>
  );
}

// ── what this role actually reaches ──────────────────────────────────────────────────────────────
// The point of the whole screen. A role name is a label; this is the access it grants, audited
// against the live database gates rather than inferred from what the name sounds like.
function RoleReach({ role }: { role: RoleKey }) {
  const a = ROLE_ACCESS[role];
  return (
    <div className={`ofr-reach gate-${a.gate}`}>
      <p className="ofr-reach-h">Signing this gives {roleLabel(role)} access. In practice that means:</p>
      <ul className="ofr-reach-yes">{a.reaches.map((r) => <li key={r}>{r}</li>)}</ul>
      {a.cannot.length > 0 && (
        <ul className="ofr-reach-no">{a.cannot.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
      {a.gate === "staff" && (
        <p className="ofr-reach-warn">
          Every staff role reaches the same data — server, contractor, operator and event manager are
          one and the same to the database. There is no per-market limit: this is access to both cities.
        </p>
      )}
    </div>
  );
}

function ReviewPanel({ onDecide, busy }: { onDecide: (a: "approve" | "request_changes", note: string) => void; busy: boolean }) {
  const [note, setNote] = useState("");
  return (
    <div className="ofr-panel review">
      <h4>Your decision</h4>
      <p className="ofr-review-p">This can&rsquo;t go to the candidate until you and every other owner approve it.</p>
      <textarea className="ofr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="A note (optional — required in spirit if you're asking for changes)" />
      <div className="ofr-do">
        <button type="button" className="btn-sec" disabled={busy} onClick={() => onDecide("request_changes", note)}>Ask for changes</button>
        <button type="button" className="btn-pri btn-wide" disabled={busy} onClick={() => onDecide("approve", note)}>Approve</button>
      </div>
    </div>
  );
}

// WHAT THE OFFER ACTUALLY PAYS.
// "A base and 2% commission" tells a candidate almost nothing. The same three volumes for every
// offer, so two offers can be compared and so nobody reads the best case as the expected one. An
// offer with no commission says so instead of drawing a flat chart nobody needs.
function PayRange({ offer }: { offer: Row }) {
  const pts = payAtVolumes(
    { baseCents: offer.base_cents, ratePer: offer.rate_per, commissionPct: offer.commission_pct },
    DEFAULT_VOLUMES,
  );
  if (!offer.commission_pct) {
    return (
      <p className="ofr-payflat">
        Flat pay — {offer.base_cents ? `${fmtMoney(offer.base_cents)} per ${offer.rate_per === "hour" ? "hour" : "year"}` : "no base set"},
        the same whatever the year does.
      </p>
    );
  }
  const max = Math.max(...pts.map((p) => p.totalCents), 1);
  return (
    <div className="ofr-pay">
      <p className="insp-lbl">What this pays, across a year</p>
      <div className="ofr-pay-rows">
        {pts.map((p) => (
          <div className="ofr-pay-row" key={p.label}>
            <span className="ofr-pay-l">{p.label}</span>
            <span className="ofr-pay-bar"><i style={{ width: `${(p.totalCents / max) * 100}%` }} /></span>
            <span className="ofr-pay-v">{fmtMoney(p.totalCents)}</span>
          </div>
        ))}
      </div>
      <p className="ofr-pay-n">
        Base plus {offer.commission_pct}% of what the market takes in. The middle row is the plan;
        the top one is not a promise.
      </p>
    </div>
  );
}

// ── the writer ───────────────────────────────────────────────────────────────────────────────────
function OfferForm({ draft, setDraft, onSave, onCancel, busy, onPick, members, membersFailed, ctx }: {
  draft: OfferTerms; setDraft: React.Dispatch<React.SetStateAction<OfferTerms | null>>; onSave: () => void; onCancel: () => void; busy: boolean;
  onPick: (v: PersonValue, how: PersonHow) => void; members: readonly { id: string; name: string }[]; membersFailed: boolean;
  ctx: OfferContext;
}) {
  // Every change goes through restateDefaults: a change of role, type or market moves the defaults
  // hanging off it (the house wording, who it reports to) while they are still defaults.
  const patch = (p: Partial<OfferTerms>) => setDraft((d) => d && restateDefaults(d, { ...d, ...p }, ctx));
  const set = <K extends keyof OfferTerms>(k: K, v: OfferTerms[K]) => patch({ [k]: v } as Partial<OfferTerms>);
  const v = validateOffer(draft);
  // Only meaningful when the letter claims "contractor" — the question doesn't exist otherwise.
  const flags = classificationFlags({
    employmentType: draft.employmentType,
    requiresTraining: draft.package?.some((p) => p.included && /training|academy/i.test(p.label)),
    suppliesEquipment: draft.package?.some((p) => p.included && /uniform|gear|equipment/i.test(p.label)),
    baseCents: draft.baseCents,
  });

  return (
    <div className="ofr-form">
      {/* WHO IT IS FOR, FIRST (2026-10-04, the form audit). A typed name linked the letter to nobody:
          the person's own page said "draft their offer letter" under a letter already drafted, and
          the deadlines board could not tell them theirs was expiring. Picking them links it and
          fills in what is on file; someone new is typed, and linked when they answer from the
          account they sign up with. */}
      <label className="prod-f"><span>Who is this for?</span>
        <PersonPick label="Who this offer is for" value={{ id: draft.candidateUserId ?? null, name: draft.candidateName }}
                    onChange={onPick} allowOther={false} allowNone noneLabel="Someone new — not on the app yet"
                    withoutMe matchByName={false} others={members} othersLabel="Customers with an account" /></label>
      <p className="ofr-stat-why" style={{ marginTop: 6 }}>
        {draft.candidateUserId
          ? "Linked to their account: the letter shows on their page and in their own app."
          : "Type their name and the email they will sign up with — the letter reaches them there."}
        {membersFailed && " Couldn't load the customers who have an account just now, so only the crew is listed."}
      </p>
      <div className="prod-grid">
        <label className="prod-f"><span>Name on the letter</span>
          <input value={draft.candidateName} onChange={(e) => set("candidateName", e.target.value)} placeholder="Full name" autoComplete="off" /></label>
        <label className="prod-f"><span>Their email</span>
          <input type="email" value={draft.candidateEmail} onChange={(e) => set("candidateEmail", e.target.value)} placeholder="name@example.com" /></label>
        <label className="prod-f"><span>Title</span>
          <input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Head of Atlanta Ops" /></label>
        <label className="prod-f"><span>Market</span>
          <select value={draft.market} onChange={(e) => set("market", toMarket(e.target.value))}>
            {MARKETS.map((m) => <option key={m} value={m}>{MARKET_LABEL[m]}</option>)}
          </select></label>
      </div>

      <label className="prod-f" style={{ marginTop: 8 }}><span>Access level this grants</span>
        <select value={draft.role} onChange={(e) => set("role", toRoleKey(e.target.value))}>
          {OFFERABLE_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select></label>
      <RoleReach role={draft.role} />

      <div className="prod-grid" style={{ marginTop: 10 }}>
        <label className="prod-f"><span>Employed as</span>
          <select value={draft.employmentType} onChange={(e) => set("employmentType", e.target.value === "contractor" ? "contractor" : "employee")}>
            <option value="employee">Employee (W-2)</option>
            <option value="contractor">Independent contractor (1099)</option>
          </select></label>
        <label className="prod-f"><span>Starts</span>
          <input type="date" value={draft.startOn ?? ""} onChange={(e) => set("startOn", e.target.value || null)} /></label>
        <label className="prod-f"><span>Base pay ($)</span>
          <input inputMode="numeric" value={centsToDollars(draft.baseCents)}
            onChange={(e) => set("baseCents", dollarsToCents(e.target.value))} placeholder="none" /></label>
        <label className="prod-f"><span>Per</span>
          <select value={draft.ratePer ?? "year"} onChange={(e) => set("ratePer", e.target.value as any)}>
            <option value="year">Year</option><option value="hour">Hour</option>
          </select></label>
        <label className="prod-f"><span>Commission (%)</span>
          <input inputMode="decimal" value={draft.commissionPct ?? ""} placeholder="none"
            onChange={(e) => { const n = Number(e.target.value); set("commissionPct", Number.isFinite(n) && e.target.value !== "" ? n : null); }} /></label>
        {/* Starts as whoever leads the market (restateDefaults), and follows the market until changed.
            offer_letters.reports_to is the name the letter prints; a manager not hired yet is typed. */}
        <label className="prod-f"><span>Reports to</span>
          <PersonPick label="Reports to" value={{ id: draft.reportsToId ?? null, name: draft.reportsTo ?? "" }} allowNone noneLabel="Not set"
                      onChange={(v) => patch({ reportsTo: v.name || null, reportsToId: v.id })} /></label>
      </div>

      {/* THE STATUTORY FOUR (0286). South Carolina requires these in writing at the time of hiring —
          every employer, no size threshold — and Greenville is South Carolina. Asked here rather
          than left to a template, because the database refuses the submit without them and the
          co-owner review step is a worse place to discover that. */}
      <div className="ofr-stat">
        <p className="insp-lbl">Required in writing at hire</p>
        <p className="ofr-stat-why">
          South Carolina asks every employer to put the normal hours, the wages, when and where
          someone is paid, and what gets deducted in writing when they&rsquo;re hired
          (S.C.&nbsp;Code&nbsp;41-10-30). Wages are above; these are the rest, and they belong in an
          Atlanta letter too.
        </p>
        <div className="prod-grid">
          {STATUTORY_FIELDS.map((f) => (
            <label className="prod-f" key={f.key} title={f.why}>
              <span>{f.label}</span>
              <input
                value={String((draft as Record<string, unknown>)[f.key] ?? "")}
                onChange={(e) => set(f.key as keyof OfferTerms, (e.target.value || null) as never)}
                placeholder={f.hint}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="ofr-pack">
        <p className="insp-lbl">What they get</p>
        {(draft.package ?? []).map((p, i) => (
          <label key={p.label} className="ofr-pack-row">
            <input type="checkbox" checked={p.included} onChange={(e) => {
              const next = [...(draft.package ?? [])]; next[i] = { ...next[i], included: e.target.checked }; set("package", next);
            }} />
            <span>{p.label}</span>
          </label>
        ))}
      </div>

      {flags.length > 0 && (
        <div className="ofr-flags">
          <p className="ofr-flags-h">This letter says contractor, but {flags.length === 1 ? "one term reads" : `${flags.length} terms read`} like employment</p>
          <ul>{flags.map((f) => <li key={f.key}><b>{f.says}.</b> {f.why}</li>)}</ul>
          <p className="ofr-flags-f">
            Classification is decided by how the work actually happens, not by what the letter calls
            it — and the penalty for getting it wrong is back taxes and back wages. Worth a word with
            an employment attorney before this one goes out.
          </p>
        </div>
      )}

      {!v.ok && (
        <ul className="ofr-problems">{v.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}

      <div className="ofr-do">
        <button type="button" className="btn-ter" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn-pri btn-wide" onClick={onSave} disabled={busy || !v.ok}>Save draft</button>
      </div>
    </div>
  );
}
