"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Sheet, { CloseButton, LeaveButton } from "@/components/Sheet";
import { Segmented, type SegOption } from "@/components/controls";
import Icon from "@/components/Icon";
import { useConfirm } from "@/components/ConfirmSheet";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useCrew } from "./useCrew";
import PersonPick, { type PersonHow, type PersonValue } from "./PersonPick";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { dayFromKey, localToday, weekStartKey } from "@/lib/dates";
import { haptic } from "@/lib/haptics";
import { streamOwner } from "@/lib/portfolio";
import {
  CRITERIA, SCALE, allScored, auditState, changedDetails, detailsOf, draftKey, draftOf, dropDraft, dueWarning, keepDraft,
  lastWeekOf, loadDraft, nextInWalk, noteShown, primaryLabel, restoreDraft, runningWords, saveVerdict, scoreTotal, scoredCount,
  tapScore, thisWeekOf, wasScore, weekSummary, withNextAction,
  type AuditDetails, type AuditForm, type AuditStream, type CriterionKey, type DraftStore, type Score, type Scores, type StreamStatus, type WeekLine,
} from "@/lib/mondayAudit";

// THE MONDAY AUDIT, FULL SCREEN (2026-10-12, Release 2 — Ryan chose it over the smaller sheet fix).
//
// The audit was a sheet over Command that asked for twelve things and opened at half height — its top at 420 of an
// iPhone 17's 874 — so it showed the explanation and two fields and no score. It is the whole screen now, and it walks:
// every stream due an audit, one after another ("3 of 10 · D2C Delivery Ops · Ryan", a bar of how many are done, Skip),
// opened from the "audit is overdue" line or from a stream's row, which starts it at that stream. The five criteria come
// first, one row each: the name and last week's score as a quiet "was 2", its rule said once, and the kit's segmented
// control at 44 points, where the chosen score tapped again clears it. Then the next action and its date, the blocker,
// and the note — asked for once all five are scored, where it saves. The footer keeps the running total in words beside
// "Save and next"; Return in a one-line field does the same. After the last stream, the week: each stream's total and
// band, and who owes the ledger a decision under the two-week rule as it stands today. The rules are lib/mondayAudit's.
//
// It is the house Sheet, drawn full screen on a phone (app/tailwind.css osr-flow) and never opened half (detents off):
// the safe areas, the keyboard (the sheet stands above it, and a field tapped scrolls into view — components/AppShell),
// Escape and Back, focus given back to what opened it, the pull, Reduce Motion (the house's own guard) and "Discard your
// changes?" are the Sheet's, as on every sheet in the app. The phone's text size zooms it as it zooms the page — every
// sheet's head, body and foot take the page's step now (app/globals.css, R6), so this one needs no zoom of its own.
// What is written is kept on this phone until it is saved (the draft), so leaving asks only when the phone could not.
//
// THE SAVE IS THE SHEET'S, WORD FOR WORD — unchanged until Release 3 replaces it, with the owner's yes: all five scored
// writes the week's row in workstream_audits (one per stream and day) and then the stream; none scored writes the stream
// alone; partial scoring blocks it. Who may audit is unchanged too: owners and admins open this (the row and the line
// are theirs alone), and the tables' policies hold the writes to admins (0264).

type Recent = { workstream_id: string; week_of: string; total: number };
type History = Recent & Partial<Record<CriterionKey, number | null>>;
type Done = "saved" | "skipped" | "removed";
/** The stream on screen: what it opened with, and the form over it. */
type Page = { id: string; base: AuditDetails; scores: Scores; draft: AuditForm; kept: boolean };

/** This phone's storage — none where touching it throws (storage turned off for the site). */
const phone = (): DraftStore | null => { try { return window.localStorage; } catch { return null; } };
const NONE: AuditDetails = { name: "", owner: { id: null, name: "" }, next_action: "", due: "", blocker: "", status: "active" };
/** A stream as the page opens on it: its details, and over them the draft this phone kept for it this week. */
function pageFor(w: AuditStream | undefined, id: string, me: string | null, day: string): Page {
  const base = w ? detailsOf(w, day) : NONE;
  const { scores, form } = restoreDraft(base, w ? loadDraft(phone(), draftKey(me, id), weekStartKey(day)) : null);
  return { id, base, scores, draft: form, kept: true };
}
const niceDay = (key: string) => dayFromKey(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const SCORE_OPTIONS: SegOption<"" | "0" | "1" | "2">[] = SCALE.map((v) => ({ key: String(v) as "0" | "1" | "2", label: String(v) }));

export default function MondayAudit({ rows, recent, ids, start, onReload, onClose }: {
  /** The portfolio, live (its list order). */
  rows: AuditStream[];
  /** Its audits, newest first, live — this week's totals and the two-week rule read them, as the list does. */
  recent: Recent[];
  /** The walk, fixed as it opened (lib/mondayAudit auditQueue), and where it starts. */
  ids: string[];
  start: number;
  onReload: () => void;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const { user } = useAuth();
  const { toast } = useApp();
  const crew = useCrew();
  const me = user?.id ?? null;
  // The day the walk opened: what this week, a draft's week and the next action's seven days count from.
  const [day] = useState(localToday);
  const week = weekStartKey(day);
  const [walk, setWalk] = useState(ids);
  const [done, setDone] = useState<Record<string, Done>>({});
  const [summary, setSummary] = useState(false);
  // The streams with a draft kept on this phone, read as the week's summary opens.
  const [drafts, setDrafts] = useState<string[]>([]);
  const [page, setPage] = useState<Page>(() => pageFor(rows.find((r) => r.id === ids[start]), ids[start], me, day));
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState("");
  // The audits this walk saved, counted from the moment each is saved — the list's read catches up a moment later, and
  // the week's summary (its totals, the two-week rule) must not say a stream just scored was not.
  const [mine, setMine] = useState<Recent[]>([]);
  const audits = [...mine, ...recent.filter((a) => !mine.some((m) => m.workstream_id === a.workstream_id && m.week_of === a.week_of))];
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // LAST WEEK, TO READ AGAINST: each criterion's score at the stream's audit before this week. The list reads totals
  // only; this reads the five, for the streams in the walk, as the walk opens. Not loaded, the audit still saves.
  const histLoader = useCallback(async (): Promise<History[]> => {
    if (!supabase || !walk.length) return [];
    const { data, error } = await supabase.from("workstream_audits")
      .select("workstream_id, week_of, total, c_owner, c_next, c_blockers, c_artifacts, c_signal")
      .in("workstream_id", walk).lt("week_of", week).order("week_of", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return (data as History[]) ?? [];
  }, [walk, week]);
  const hist = useAsyncData(histLoader, [histLoader]);

  const auditing = rows.find((r) => r.id === page.id) ?? null;
  const { scores, draft, base } = page;
  const total = scoreTotal(scores);
  const anyScored = scoredCount(scores) > 0;
  const scored = allScored(scores);
  const hasOwner = !!draft.owner.id || !!draft.owner.name.trim();
  const unsaved = !summary && draftOf(scores, draft, base, week) !== null;
  const verdict = saveVerdict(scores, draft.note, changedDetails(draft, base).length > 0);
  // Why the button is held, said under the total — and by Return, which would otherwise do nothing (lib/formGuard).
  const why = !auditing ? "This stream is no longer in the portfolio — skip to the next."
    : verdict.why ?? (!draft.name.trim() ? "Name the workstream to save." : !hasOwner ? "Pick an owner, under Details, to save." : null);
  const thisWeek = thisWeekOf(audits, page.id, day)?.total ?? null;
  const last = nextInWalk(walk, walk.indexOf(page.id), (id) => id === page.id || !!done[id]) === null;
  const state = auditState({ unsaved, kept: page.kept, scored: scoredCount(scores), detailsOnly: verdict.kind === "details", thisWeek });
  const lastWeek = hist.data ? lastWeekOf(hist.data, page.id, day) : null;
  const warn = dueWarning(draft.due, day);

  // ── moving through the form ──
  /** The form moved: keep what moved on this phone (or forget it, when nothing has), and say whether it could. */
  const edit = (next: { scores?: Scores; draft?: AuditForm; base?: AuditDetails }) => {
    const p = { ...page, ...next };
    setPage({ ...p, kept: keepDraft(phone(), draftKey(me, p.id), draftOf(p.scores, p.draft, p.base, week)) });
  };
  const set = (patch: Partial<AuditForm>) => edit({ draft: { ...draft, ...patch } });
  const tap = (key: CriterionKey, label: string, v: Score) => {
    const next = tapScore(scores, key, v);
    setSaid(next[key] === undefined ? `${label} cleared` : "");
    edit({ scores: next });
  };
  // An old typed name resolved to the crew member it spells is the stream as it stands, not an edit (PersonPick's
  // "match"): it moves what the stream opened with as well, so it keeps no draft and asks nothing before leaving.
  const pickOwner = (v: PersonValue, how: PersonHow) => {
    if (how === "match") edit({ draft: { ...draft, owner: v }, base: { ...base, owner: v } });
    else set({ owner: v });
  };

  // ── moving through the walk ──
  const go = (list: string[], i: number) => {
    setSummary(false);
    setPage(pageFor(rows.find((r) => r.id === list[i]), list[i], me, day));
  };
  const openWeek = () => {
    const store = phone();
    setDrafts(rows.filter((r) => loadDraft(store, draftKey(me, r.id), week) !== null).map((r) => r.id));
    setSummary(true);
  };
  /** On from a stream done with — saved, skipped or removed: the next not yet done, or the week once none is left. */
  const advance = (id: string, how: Done) => {
    const nowDone = { ...done, [id]: how };
    setDone(nowDone);
    const n = nextInWalk(walk, walk.indexOf(id), (x) => !!nowDone[x]);
    if (n === null) openWeek();
    else go(walk, n);
  };
  // Skip keeps the draft on this phone; where the phone could not keep it, the Sheet asks first (LeaveButton).
  const skip = () => { if (!saving) advance(page.id, "skipped"); };
  /** From the week, back to a stream — one not in the walk joins it in the list's place. */
  const revisit = (id: string) => {
    const list = walk.includes(id) ? walk : rows.filter((r) => walk.includes(r.id) || r.id === id).map((r) => r.id);
    const nowDone = { ...done };
    delete nowDone[id];
    setWalk(list);
    setDone(nowDone);
    go(list, list.indexOf(id));
  };
  /** From the week, back through the streams skipped, from the first. */
  const again = () => {
    const first = walk.findIndex((id) => done[id] === "skipped");
    const nowDone: Record<string, Done> = {};
    for (const [id, how] of Object.entries(done)) if (how !== "skipped") nowDone[id] = how;
    setDone(nowDone);
    if (first >= 0) go(walk, first);
  };
  const close = () => {
    if (unsaved && page.kept) toast("Draft kept on this phone — the audit opens on it next time");
    onClose();
  };

  // ── the save ──
  // Everything is editable in place, no restart (2026-08-03, Ryan): one form saves two ways — score all five and it's a
  // Monday AUDIT (history row + health), score none and it's a DETAILS edit (rename, re-own, re-date, re-status — nothing
  // else moves). Partial scoring blocks the save so a half-audit can never masquerade as either.
  const save = async () => {
    if (!supabase || !auditing || saving || (anyScored && !scored) || !draft.name.trim() || !hasOwner) return;
    setSaving(true);
    const today = localToday();
    // THE PERSON, NOT ONLY THEIR NAME (2026-10-04, the form audit). 0307 added owner_user_id and its
    // changelog said owners "are now picked from the crew" — but this save wrote only the text, so
    // re-owning a stream left owner_user_id on the PREVIOUS person, every stream added here had
    // none, and v_workstream_owners and v_obligations (which read the id) answered for the wrong
    // person. Both columns are written now, from one pick.
    const details = {
      name: draft.name.trim().slice(0, 80), owner: draft.owner.name.trim().slice(0, 40), owner_user_id: draft.owner.id, status: draft.status,
      next_action: draft.next_action.trim() || null, due: draft.due || null, blocker: draft.blocker.trim() || null,
    };
    // A WEEK'S AUDIT IS A RECORD (2026-10-15, 0405 — Release 3 of the Today, Command, Audit & Catalog audit). The audit
    // and the stream are one save in the database now (save_workstream_audit): both, or neither, filed under the week's
    // Monday (Eastern), and refused in words — not written — when someone saved this stream after this page read it.
    // It wrote them in two (the history row under the phone's day, then the stream), and a second save the same day
    // overwrote a colleague's without a word.
    let week = weekStartKey(today);
    const { data, error } = await supabase.rpc("save_workstream_audit", {
      p_workstream: auditing.id, p_seen: auditing.updated_at ?? null, p_details: details,
      p_scores: scored ? { c_owner: scores.c_owner, c_next: scores.c_next, c_blockers: scores.c_blockers, c_artifacts: scores.c_artifacts, c_signal: scores.c_signal } : null,
      p_note: scored ? draft.note.trim() || null : null,
    });
    if (error) { setSaving(false); haptic("error"); toast(`Couldn't save — ${error.message}`, "error"); return; }
    const r = (data ?? {}) as { ok?: boolean; code?: string; words?: string; week_of?: string };
    if (!r.ok) {
      setSaving(false); haptic("error");
      toast(r.words || "Couldn't save — try again.", "error");
      // A colleague's newer save is read in, never overwritten unread: the list reloads with theirs, this form keeps
      // what was typed, and the next save is checked against theirs.
      if (r.code === "changed") onReload();
      return;
    }
    if (r.week_of) week = r.week_of;
    setSaving(false);
    toast(!scored ? "Stream updated" : total >= 10 ? `${draft.name}: 10 — green` : total >= 8 ? `${draft.name}: ${total} — amber watch` : `${draft.name}: ${total} — named in this week's review`);
    // ON, NOT OUT (2026-10-12): saved, the stream's draft goes and the walk moves to the next stream due, where the
    // sheet closed and the next one had to be found on the list again.
    dropDraft(phone(), draftKey(me, auditing.id));
    if (scored) setMine((m) => [{ workstream_id: auditing.id, week_of: week, total }, ...m.filter((a) => a.workstream_id !== auditing.id || a.week_of !== week)]);
    onReload();
    advance(auditing.id, "saved");
  };
  const submit = () => {
    if (saving) return;
    if (why) { haptic("boundary"); toast(why, "info"); return; }
    void save();
  };
  // RETURN SAVES AND MOVES ON (2026-10-12): in a one-line field, as the twelve's log sheet's Return logs (KpiBoard).
  const onReturn = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };
  const removeStream = async () => {
    if (!supabase || !auditing) return;
    if (!(await confirm({ title: `Remove “${auditing.name}” from the portfolio?`, body: "Only a stream never audited can be removed — one with history is parked, and keeps its record. Parking by decision is usually the better move.", confirmLabel: "Remove", danger: true }))) return;
    const { error } = await supabase.from("os_workstreams").delete().eq("id", auditing.id);
    // A stream with audit history keeps it (0405: on delete restrict) — the record is parked, not deleted.
    if (error?.code === "23503") { toast("It has audit history, so it stays on the record — set its status to Parked instead.", "error"); return; }
    if (error) { toast(`Couldn't remove — ${error.message}`, "error"); return; }
    toast("Removed from the portfolio");
    dropDraft(phone(), draftKey(me, auditing.id));
    onReload();
    advance(auditing.id, "removed");
  };

  // A NEW STREAM IS SAID BY GOING THERE (VoiceOver): its heading takes the focus — "4 of 10 · Wholesale · Kayla" is read
  // — and the page starts at its top. The week's summary is announced the same way.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    bodyRef.current?.scrollTo({ top: 0 });
  }, [page.id, summary]);

  const owner = auditing ? streamOwner(auditing, crew) : null;
  const heading = summary ? `The week of ${niceDay(week)}`
    : `${walk.indexOf(page.id) + 1} of ${walk.length} · ${auditing ? `${auditing.name} · ${owner ?? "no owner yet"}` : "no longer in the portfolio"}`;
  const doneCount = walk.filter((id) => done[id]).length;
  const lines = summary ? weekSummary(rows, audits, day, walk.filter((id) => done[id] === "skipped")) : [];
  const skippedCount = walk.filter((id) => done[id] === "skipped").length;
  const owing = lines.filter((l) => l.owes).length;
  const kind = auditing ? verdict.kind : null;

  const header = (
    <div>
      <div className="note-lux-head gap-3">
        <span className="note-lux-eyb">Monday audit</span>
        <span className="ml-auto flex items-center gap-4">
          {/* 44 points across as well as tall: "Skip" alone is 40 wide (2026-10-12, measured at integration). */}
          {!summary && <LeaveButton className="btn-ter min-w-11" onClick={skip} disabled={saving}>Skip</LeaveButton>}
          <CloseButton onClick={close} label="Close the audit" />
        </span>
      </div>
      <h2 ref={titleRef} tabIndex={-1} className="m-0 mt-1 font-sans text-title3 font-bold leading-tight text-cream outline-none">{heading}</h2>
      {/* How far the walk is: a segment a stream — gold saved, dim skipped, bright the one on screen. */}
      <div className="mt-3 flex gap-1" role="progressbar" aria-label="Streams done" aria-valuemin={0} aria-valuemax={walk.length}
        aria-valuenow={doneCount} aria-valuetext={`${doneCount} of ${walk.length} done`}>
        {walk.map((id) => (
          <span key={id} className={`h-1 min-w-0 flex-1 rounded-pill${done[id] === "saved" ? " bg-gold2" : done[id] ? " bg-cream-dim" : !summary && id === page.id ? " bg-cream" : " bg-line2"}`} />
        ))}
      </div>
    </div>
  );

  const footer = summary ? (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <p className="osr-total m-0 min-w-0 flex-1 basis-40">{lines.filter((l) => l.total !== null).length} of {lines.filter((l) => !l.parked).length} scored this week</p>
      {skippedCount > 0 && <button type="button" className="btn-sec" onClick={again}>Back to the {skippedCount} skipped</button>}
      <button type="button" className="btn-pri" onClick={close}>Done</button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-40">
        <p className="osr-total m-0" aria-live="polite">{runningWords(scores)}</p>
        {why && <p className="m-0 mt-0.5 font-sans text-caption leading-snug text-cream-muted">{why}</p>}
      </div>
      <button type="button" className="btn-pri" disabled={saving || !!why} onClick={submit}>{saving ? "Saving…" : primaryLabel({ kind, last, thisWeek })}</button>
    </div>
  );

  return (
    <Sheet open onClose={close} label="Monday audit" className="osr-flow" detents={false} bodyRef={bodyRef}
      dirty={!summary && unsaved && !page.kept} header={header} footer={footer}>
      {summary ? (
        <div className="osr-audit pb-2">
          <p className="h-sub">{owing === 0 ? "" : `${owing} ${owing === 1 ? "stream owes" : "streams owe"} the ledger a decision. `}Tap a stream to go back to it.</p>
          <div className="osr-rows">
            {lines.map((l) => <WeekRow key={l.id} l={l} draft={drafts.includes(l.id)} onOpen={() => revisit(l.id)} />)}
          </div>
          <p className="h-sub">⚖ Below 8 two weeks running owes the ledger a kill, pause or recover decision.</p>
        </div>
      ) : !auditing ? (
        <div className="osr-audit pb-2"><p className="h-sub">This workstream is no longer in the portfolio.</p></div>
      ) : (
        <div className="osr-audit pb-2">
          {state && (
            <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-footnote leading-snug text-cream-muted">
              <span className={`k-tag${state.word === "Scored" ? " ok" : " gold"}`}>{state.word}</span>{state.line}
            </p>
          )}
          <p className="h-sub">The score says where attention goes this week. Below 8 is named in the review; below 8 two weeks running owes the ledger a kill, pause or recover decision. A second tap on a score clears it.</p>
          {hist.status === "error" && <p className="m-0 font-sans text-footnote text-cream-muted">Last week&apos;s scores didn&apos;t load — the audit still saves.</p>}
          <div>
            {CRITERIA.map((c) => <Criterion key={c.key} c={c} value={scores[c.key]} was={wasScore(lastWeek, c.key)} onTap={(v) => tap(c.key, c.label, v)} />)}
          </div>
          <label className="prod-f"><span>Next action</span>
            <input className="note-in" value={draft.next_action} onChange={(e) => set(withNextAction(draft, e.target.value, day))} onKeyDown={onReturn} enterKeyHint="go" placeholder="The one move this week" /></label>
          <div>
            <label className="prod-f"><span>Due</span>
              <input type="date" className="note-in" value={draft.due} onChange={(e) => set({ due: e.target.value })} /></label>
            {warn && <p className="m-0 mt-1.5 flex items-start gap-1.5 font-sans text-footnote leading-snug text-warn"><Icon name="warning" />{warn}</p>}
          </div>
          <label className="prod-f"><span>Blocker</span>
            <input className="note-in" value={draft.blocker} onChange={(e) => set({ blocker: e.target.value })} onKeyDown={onReturn} enterKeyHint="go" placeholder="What's stuck, if anything" /></label>
          {noteShown(scores, draft.note) && (
            <label className="prod-f"><span>Audit note — why it isn&apos;t a 10{scored ? "" : " · saves with all five scored"}</span>
              <input className="note-in" value={draft.note} onChange={(e) => set({ note: e.target.value })} onKeyDown={onReturn} enterKeyHint="go" placeholder="One line, plain" /></label>
          )}
          <p className="note-lux-eyb m-0 mt-2">Details</p>
          <label className="prod-f"><span>Workstream</span>
            <input className="note-in" value={draft.name} onChange={(e) => set({ name: e.target.value })} onKeyDown={onReturn} enterKeyHint="go" maxLength={80} /></label>
          {/* The label used to read "Owner — exactly one name", which is an invariant a text
              box cannot keep: spell it differently the second time and the workstream belongs
              to nobody while still looking owned. It picks from the crew (0307 added
              owner_user_id beside the text column and backfilled the unambiguous matches) —
              through PersonPick, the one person pick list, which keeps the id AND the name.
              Someone with no account is still a valid owner — that is what "Someone else…"
              keeps the text box for — and it says plainly that it links to no one. */}
          <label className="prod-f"><span>Owner</span>
            <PersonPick label="Workstream owner" value={draft.owner} allowNone noneLabel="Nobody yet" onChange={pickOwner} /></label>
          <div>
            <label className="prod-f"><span>Status</span>
              <select className="note-in" value={draft.status} onChange={(e) => set({ status: e.target.value as StreamStatus })}>
                <option value="active">Active</option><option value="blocked">Blocked</option><option value="parked">Parked</option>
              </select></label>
            <p className="m-0 mt-1.5 font-sans text-footnote leading-snug text-cream-muted">Parked by decision is fine — stalled without one is not.</p>
          </div>
          <button type="button" className="btn-del osr-remove" onClick={removeStream}>Remove from the portfolio</button>
          <p className="sr-only" aria-live="polite">{said}</p>
        </div>
      )}
    </Sheet>
  );
}

/** One criterion, one row: its name with last week's score, its rule, and 0 · 1 · 2 — a radio group VoiceOver names
 *  by the criterion and last week's score. The chosen score tapped again clears it (the control's re-tap). At a large
 *  text size the control drops under the words rather than squeezing them. */
function Criterion({ c, value, was, onTap }: { c: (typeof CRITERIA)[number]; value: Score | undefined; was: Score | null; onTap: (v: Score) => void }) {
  const pick = (k: string) => onTap(Number(k) as Score);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 font-sans text-subhead font-bold leading-snug text-cream">
          {c.label}{was !== null && <span className="font-sans text-caption font-normal text-cream-dim">was {was}</span>}
        </p>
        <p className="m-0 mt-0.5 font-sans text-footnote leading-snug text-cream-muted">{c.hint}</p>
      </div>
      <Segmented kind="choice" size="lg" label={was !== null ? `${c.label}, was ${was}` : c.label} options={SCORE_OPTIONS}
        value={value === undefined ? "" : (String(value) as "0" | "1" | "2")} onChange={pick} onReselect={pick} />
    </div>
  );
}

/** A stream in the week's summary: its total and band this week — or skipped, parked, not scored — and whether it
 *  owes the ledger a decision under the two-week rule. The list's own row (.osr-row), so the week reads as the list does. */
function WeekRow({ l, draft, onOpen }: { l: WeekLine; draft: boolean; onOpen: () => void }) {
  const line = [
    l.total !== null ? `${l.total} of 10 · ${l.band}` : l.parked ? "Parked" : l.skipped ? "Skipped — not scored this week" : "Not scored this week",
    draft ? "draft kept on this phone" : "",
  ].filter(Boolean).join(" · ");
  return (
    <button type="button" className={`osr-row${l.parked ? " parked" : ""}`} onClick={onOpen}
      aria-label={`${l.name} — ${line}${l.owes ? " — owes the ledger a decision" : ""}. Open it in the audit`}>
      <span className="osr-main">
        <span className="osr-name">{l.name}{l.parked && <i className="osr-flag park">parked</i>}</span>
        <span className="osr-next">{line}</span>
        {l.owes && <span className="osr-owes">⚖ Owes the ledger a decision</span>}
      </span>
      {l.total !== null && <span className={`osr-score${l.band === "green" ? " green" : l.band === "amber" ? " amber" : " red"}`} aria-hidden="true"><i />{l.total}<small>/10</small></span>}
    </button>
  );
}
