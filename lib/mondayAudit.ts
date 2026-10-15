import { addDays, weekStartKey } from "./dates";
import { daysBetween } from "./dayWords";
import { edited } from "./formGuard";

// THE MONDAY AUDIT, WALKED (2026-10-12, Release 2 — the full-screen audit Ryan chose over the smaller sheet fix).
//
// WHY. The audit was a sheet that asked for twelve things and opened at half height (lib/sheetStage: its top at 420 of
// an iPhone 17's 874), so the explanation and two fields showed and no score did. Its note was written only with a full
// five-score save, and "Save details" dropped a typed one without a word. A tapped score could not be taken back, so one
// stray tap held "Save details" until all five were scored. The chips stood 34 points tall. The next-action rule, the
// blocker rule and "parked by decision" were each said twice; there was no last week to read against; and it opened one
// stream at a time, with no way on to the next. components/MondayAudit is the walk now: full screen, stream after
// stream. These are its rules, pure, so scripts/smoke.cjs holds each one to its answers.
//
// UNCHANGED, ON PURPOSE: the five criteria and their 0–2 scale, the total and its bands, the two-week rule and its
// words, and who may audit (owners and admins). The database's side of the audit — one all-or-nothing save, filing by
// Monday, weeks that lock, a stream with history parked rather than deleted — is 0405 (2026-10-15, Release 3):
// components/MondayAudit saves through save_workstream_audit.

// ── THE FIVE, EACH RULE SAID ONCE ────────────────────────────────────────────────────────────────────────────────────
// Moved here from components/OsRegistry as they stood (0264's rubric). The rule beside each criterion is the only place
// it is said: the fields below the five no longer repeat the next-action and blocker rules in their labels.
export const CRITERIA = [
  { key: "c_owner",     label: "Owner",       hint: "Exactly one name. Shared ownership scores zero." },
  { key: "c_next",      label: "Next action", hint: "Specific, dated, no more than 7 days out." },
  { key: "c_blockers",  label: "Blockers",    hint: "None stale past 7 days without escalation." },
  { key: "c_artifacts", label: "Artifacts",   hint: "Latest version linked. No unversioned edits in the wild." },
  { key: "c_signal",    label: "Signal",      hint: "A linked KPI or gate has moved since the last audit." },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];
export type Score = 0 | 1 | 2;
export type Scores = Partial<Record<CriterionKey, Score>>;
/** The scale, 0 to 2 points a criterion — five of them make the ten. */
export const SCALE: readonly Score[] = [0, 1, 2];
const isScore = (v: unknown): v is Score => v === 0 || v === 1 || v === 2;

// ── A SCORE TAKEN BACK (2026-10-12) ─────────────────────────────────────────────────────────────────────────────────
// A chip, once tapped, stayed chosen: one stray tap held the details save until all five were scored, and the only way
// out was Cancel. The chosen value tapped again clears it — the segmented control's re-tap (components/controls).
/** A tap on a criterion's value: sets it, or clears it when it was already the one chosen. */
export function tapScore(s: Scores, key: CriterionKey, v: Score): Scores {
  const next: Scores = { ...s };
  if (next[key] === v) delete next[key];
  else next[key] = v;
  return next;
}
export const scoredCount = (s: Scores): number => CRITERIA.filter((c) => isScore(s[c.key])).length;
export const allScored = (s: Scores): boolean => scoredCount(s) === CRITERIA.length;
/** The total, out of 10. Unscored criteria add nothing — a total is only ever saved with all five scored. */
export const scoreTotal = (s: Scores): number => CRITERIA.reduce((n, c) => n + (s[c.key] ?? 0), 0);

// ── THE BANDS AND THE RUNNING TOTAL, IN WORDS ───────────────────────────────────────────────────────────────────────
export type Band = "green" | "amber" | "red";
/** 10 green · 8–9 amber · under 8 red — the band the list's dot draws (components/OsRegistry dotClass). */
export const bandOf = (total: number): Band => (total >= 10 ? "green" : total >= 8 ? "amber" : "red");

/** The footer's running total: "8 of 10 · amber" once all five are scored, what it stands at on the way there. */
export function runningWords(s: Scores): string {
  const n = scoredCount(s), total = scoreTotal(s);
  if (n === 0) return "Not scored yet";
  if (n < CRITERIA.length) return `${total} so far · ${CRITERIA.length - n} to score`;
  return `${total} of 10 · ${bandOf(total)}`;
}

// ── WHAT A SAVE WILL BE, OR WHY IT CAN'T BE ─────────────────────────────────────────────────────────────────────────
// All five scored is a Monday audit (a history row and the stream's health); none scored is a details save (the stream
// alone, no score this week). Partial scoring still blocks the save, by design: a half-audit must never pass for either.
// THE NOTE SAVES WHERE IT IS ASKED FOR (2026-10-12): it belongs to the audit row, so it is asked for once all five are
// scored. A note typed and then left behind by clearing the scores stays in sight, and the save that would drop it is
// refused with the reason — the sheet's "Save details" dropped it without a word.
export type SaveVerdict = { kind: "audit" | "details"; why: null } | { kind: null; why: string };
export function saveVerdict(s: Scores, note: string, changed: boolean): SaveVerdict {
  const n = scoredCount(s);
  if (n === CRITERIA.length) return { kind: "audit", why: null };
  if (n > 0) return { kind: null, why: "Score all five, or clear them to save the details alone." };
  if (note.trim()) return { kind: null, why: "The note saves with a score — score all five, or clear the note." };
  if (changed) return { kind: "details", why: null };
  return { kind: null, why: "Score all five — or skip to the next stream." };
}
/** The audit note is shown once all five are scored — and while it holds words, so nothing typed is hidden. */
export const noteShown = (s: Scores, note: string): boolean => allScored(s) || note.trim() !== "";

/** The button's words. A details save says plainly that it carries no score, or that this week's stands. */
export function primaryLabel(o: { kind: SaveVerdict["kind"]; last: boolean; thisWeek: number | null }): string {
  if (o.kind === "details") return o.thisWeek !== null ? "Save details — this week's score stands" : "Save details — no score this week";
  return o.last ? "Save and finish" : "Save and next";
}

// ── THE NEXT ACTION'S DATE ───────────────────────────────────────────────────────────────────────────────────────────
/** Criterion 2's seven days. */
export const NEXT_ACTION_DAYS = 7;
/** A next action with no date is dated this many days out — the furthest the rule allows. */
export const defaultDue = (today: string): string => addDays(today, NEXT_ACTION_DAYS);
/** A warning, never a block: a date past seven days out. */
export function dueWarning(due: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const n = daysBetween(today, due);
  return n > NEXT_ACTION_DAYS ? `${n} days out — more than seven.` : null;
}

// ── THE STREAM'S DETAILS, AS THE FORM HOLDS THEM ─────────────────────────────────────────────────────────────────────
export type StreamStatus = "active" | "blocked" | "parked";
/** os_workstreams (0264, 0307), as far as the audit reads it. */
export type AuditStream = {
  id: string; name: string; owner: string | null; owner_user_id: string | null; status: StreamStatus;
  health: number; next_action: string | null; due: string | null; blocker: string | null; last_audited: string | null;
  /** When the stream last changed (0405): what the save is checked against, so a colleague's newer save is not overwritten. */
  updated_at?: string | null;
};
export type AuditDetails = { name: string; owner: { id: string | null; name: string }; next_action: string; due: string; blocker: string; status: StreamStatus };
/** The form: the details and the audit note (the shape the sheet's `draft` had). */
export type AuditForm = AuditDetails & { note: string };

/** The details a stream opens with. The owner is the person it is linked to (0307), not a spelling of them. A next
 *  action with no date opens dated seven days out. */
export function detailsOf(w: AuditStream, today: string): AuditDetails {
  const next_action = w.next_action ?? "";
  return {
    name: w.name, owner: { id: w.owner_user_id ?? null, name: w.owner ?? "" },
    next_action, due: w.due ?? (next_action.trim() ? defaultDue(today) : ""), blocker: w.blocker ?? "", status: w.status,
  };
}
/** A next action typed where there was none, with no date yet, is dated seven days out; a date set is left alone. */
export function withNextAction<D extends AuditDetails>(d: D, next_action: string, today: string): D {
  const dated = !d.due && !d.next_action.trim() && next_action.trim() ? defaultDue(today) : d.due;
  return { ...d, next_action, due: dated };
}

const DETAIL_KEYS = ["name", "owner", "next_action", "due", "blocker", "status"] as const;
const flat = (d: AuditDetails) => ({ name: d.name, owner_id: d.owner.id, owner: d.owner.name, next_action: d.next_action, due: d.due, blocker: d.blocker, status: d.status });
/** The details moved off what the stream opened with — lib/formGuard's sense of a change: blank and missing are the
 *  same nothing, spaces at the ends are not a change, and the owner is the person and the name together. */
export function changedDetails(now: AuditDetails, was: AuditDetails): (keyof AuditDetails)[] {
  const a = flat(now), b = flat(was);
  return DETAIL_KEYS.filter((k) => edited(a, b, k === "owner" ? ["owner_id", "owner"] : [k]));
}

// ── THE DRAFT, KEPT ON THE PHONE (2026-10-12) ───────────────────────────────────────────────────────────────────────
// A stream's audit is kept on this phone as it is written — per person, per stream — so the app closing (iOS ends a web
// view it has not shown for a while), a Skip or a Close loses nothing: the stream opens on it again, until it is saved.
// It holds only what moved: the scores, the note, and the details changed (so a detail someone else changes meanwhile
// is not written back over with what the stream said when the draft began). It is this week's: a draft from an earlier
// week is not restored — its scores were for that week. Nothing to keep is no draft at all.
export const DRAFT_KEY_PREFIX = "gt3-audit-draft";
/** Where a stream's draft is kept: one key per person, per stream. */
export const draftKey = (userId: string | null | undefined, streamId: string): string => `${DRAFT_KEY_PREFIX}:${userId || "signed-out"}:${streamId}`;

export type PhoneDraft = { v: 1; week: string; scores: Scores; details: Partial<AuditDetails>; note: string };

/** The draft for a form: what moved off `base`, filed under `week` (its Monday); null when nothing has. */
export function draftOf(scores: Scores, form: AuditForm, base: AuditDetails, week: string): PhoneDraft | null {
  const kept: Scores = {};
  for (const c of CRITERIA) { const v = scores[c.key]; if (isScore(v)) kept[c.key] = v; }
  const changed = changedDetails(form, base);
  if (!Object.keys(kept).length && !changed.length && !form.note.trim()) return null;
  const details: Partial<AuditDetails> = {};
  for (const k of changed) Object.assign(details, { [k]: form[k] });
  return { v: 1, week, scores: kept, details, note: form.note };
}

const STATUSES: readonly string[] = ["active", "blocked", "parked"];
const isText = (v: unknown): v is string => typeof v === "string";
/** A stored draft, read back: this week's only, every value checked — one off the scale, or of the wrong kind, is left
 *  behind and the rest comes back. Unreadable, another week's, or empty once checked: null. */
export function readDraft(raw: string | null | undefined, week: string): PhoneDraft | null {
  if (!raw) return null;
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (o.v !== 1 || o.week !== week) return null;
  const scores: Scores = {};
  const s = (o.scores && typeof o.scores === "object" ? o.scores : {}) as Record<string, unknown>;
  for (const c of CRITERIA) if (isScore(s[c.key])) scores[c.key] = s[c.key] as Score;
  const details: Partial<AuditDetails> = {};
  const x = (o.details && typeof o.details === "object" ? o.details : {}) as Record<string, unknown>;
  for (const k of ["name", "next_action", "due", "blocker"] as const) if (isText(x[k])) details[k] = x[k] as string;
  const ow = x.owner as { id?: unknown; name?: unknown } | undefined;
  if (ow && typeof ow === "object" && (ow.id === null || isText(ow.id)) && isText(ow.name)) details.owner = { id: ow.id as string | null, name: ow.name };
  if (isText(x.status) && STATUSES.includes(x.status)) details.status = x.status as StreamStatus;
  const note = isText(o.note) ? o.note : "";
  if (!Object.keys(scores).length && !Object.keys(details).length && !note.trim()) return null;
  return { v: 1, week, scores, details, note };
}

/** The form a stream opens with: its details, and over them the draft kept for it, if any. */
export function restoreDraft(base: AuditDetails, d: PhoneDraft | null): { scores: Scores; form: AuditForm } {
  return { scores: { ...(d?.scores ?? {}) }, form: { ...base, ...(d?.details ?? {}), note: d?.note ?? "" } };
}

/** localStorage, or a stand-in (the smoke's). */
export type DraftStore = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

/** Keep a stream's draft — or forget it, when there is nothing left to keep. False when the phone refused (a private
 *  window, a full disk, storage turned off): the page says so, and leaving asks first. Never throws. */
export function keepDraft(store: DraftStore | null | undefined, key: string, d: PhoneDraft | null): boolean {
  if (!store) return d === null;
  try {
    if (d) store.setItem(key, JSON.stringify(d));
    else store.removeItem(key);
    return true;
  } catch { return false; }
}
/** A stream's draft for this week. One that cannot come back (another week's, unreadable) is cleared as it is read. */
export function loadDraft(store: DraftStore | null | undefined, key: string, week: string): PhoneDraft | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    const d = readDraft(raw, week);
    if (raw && !d) store.removeItem(key);
    return d;
  } catch { return null; }
}
/** A saved stream's draft goes: what it held is in the database now. */
export function dropDraft(store: DraftStore | null | undefined, key: string): void {
  try { store?.removeItem(key); } catch { /* nothing kept to drop */ }
}

// ── THE THREE STATES, EACH NAMED ON SCREEN ───────────────────────────────────────────────────────────────────────────
// Draft: written here, not saved — kept on this phone. Details only: a draft with details changed and no score, which
// saves as the stream alone. Scored: all five saved for the week. Untouched and unscored this week, nothing is said.
export type AuditState = { word: "Draft" | "Details only" | "Scored"; line: string };
export function auditState(o: { unsaved: boolean; kept: boolean; scored: number; detailsOnly: boolean; thisWeek: number | null }): AuditState | null {
  const where = o.kept ? "kept on this phone until you save" : "this phone couldn't keep it — save before you leave";
  if (o.unsaved && o.detailsOnly) return { word: "Details only", line: `${o.thisWeek !== null ? `This week's ${o.thisWeek} stands` : "No score this week"} · ${where}` };
  if (o.unsaved) return { word: "Draft", line: `${where[0].toUpperCase()}${where.slice(1)}` };
  if (o.thisWeek !== null) return { word: "Scored", line: `${o.thisWeek} of 10 · ${bandOf(o.thisWeek)} — saved for the week` };
  return null;
}

// ── THE WALK ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The streams the walk goes through: those due (the list's own rule, handed in), in the list's order — and the one it
 *  was opened at, which joins the walk in its place when it is not due itself. It starts there. */
export function auditQueue<S extends { id: string }>(rows: readonly S[], due: (r: S) => boolean, at?: string | null): { ids: string[]; start: number } {
  const ids = rows.filter((r) => due(r) || r.id === at).map((r) => r.id);
  return { ids, start: Math.max(0, at ? ids.indexOf(at) : 0) };
}
/** On from `from`: the next stream not yet done, past the end and round to the first; null when every one is done. */
export function nextInWalk(ids: readonly string[], from: number, done: (id: string) => boolean): number | null {
  for (let step = 1; step <= ids.length; step++) {
    const i = (from + step) % ids.length;
    if (!done(ids[i])) return i;
  }
  return null;
}

// ── LAST WEEK, AND THIS ONE ──────────────────────────────────────────────────────────────────────────────────────────
// An audit is filed under the day it was saved (week_of; Release 3 files it by Monday). This week is from its Monday.
type Filed = { workstream_id: string; week_of: string };
/** A stream's audit before this week — the newest; `history` newest first, as the audits are read. */
export function lastWeekOf<A extends Filed>(history: readonly A[], streamId: string, today: string): A | null {
  const monday = weekStartKey(today);
  return history.find((a) => a.workstream_id === streamId && a.week_of < monday) ?? null;
}
/** A stream's audit filed this week, if there is one — the newest. */
export function thisWeekOf<A extends Filed>(history: readonly A[], streamId: string, today: string): A | null {
  const monday = weekStartKey(today);
  return history.find((a) => a.workstream_id === streamId && a.week_of >= monday) ?? null;
}
/** What a criterion scored last time, or null — audits before the in-app one (0264's seed) kept totals alone. */
export function wasScore(a: Partial<Record<CriterionKey, number | null>> | null, key: CriterionKey): Score | null {
  const v = a ? a[key] : null;
  return isScore(v) ? v : null;
}

// ── THE TWO-WEEK RULE, AS THE LIST COMPUTES IT ──────────────────────────────────────────────────────────────────────
/** Below 8 two weeks running owes the ledger a kill, pause or recover decision: an active stream whose latest two audits
 *  are both under 8. Word for word the list's own (components/OsRegistry owesDecision); `recent` newest first. */
export function owesDecision(w: { id: string; status: string }, recent: readonly { workstream_id: string; total: number }[]): boolean {
  const mine = recent.filter((a) => a.workstream_id === w.id).slice(0, 2);
  return w.status === "active" && mine.length >= 2 && mine.every((a) => a.total < 8);
}

// ── THE WEEK, SUMMED UP ──────────────────────────────────────────────────────────────────────────────────────────────
export type WeekLine = { id: string; name: string; parked: boolean; total: number | null; band: Band | null; skipped: boolean; owes: boolean };
/** Every stream in the list's order: this week's total and band where it was scored, skipped and parked said as such,
 *  and whether it owes the ledger a decision under the two-week rule — counted from the audits as they stand today. */
export function weekSummary<S extends { id: string; name: string; status: string }>(
  rows: readonly S[], recent: readonly (Filed & { total: number })[], today: string, skipped: readonly string[],
): WeekLine[] {
  return rows.map((w) => {
    const a = thisWeekOf(recent, w.id, today);
    return { id: w.id, name: w.name, parked: w.status === "parked", total: a ? a.total : null, band: a ? bandOf(a.total) : null, skipped: skipped.includes(w.id), owes: owesDecision(w, recent) };
  });
}
