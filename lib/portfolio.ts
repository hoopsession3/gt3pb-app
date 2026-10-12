// THE PORTFOLIO, AS THE REST OF THE APP READS IT — os_workstreams (0264): the named workstreams on
// Command, one owner each, audited every Monday. Not lib/streams: that is work_streams (0159), the
// lanes the nav, goals and the calendar are filed to. 0264 kept the two apart on purpose.
//
// What lives here is what more than one screen needs to say about a workstream: who owns it, which
// workstream some words already spell, and — since 0350 — what a milestone's chip on the board
// prints. The milestone sheet's pick is lib/milestonePick, loaded with the sheet. Pure, so
// scripts/smoke.cjs runs it. Since 2026-10-12, how old the portfolio's scores are, the one line a
// stream gets when it has a problem, and the order Command lists the streams in (below).

import { dayFromKey } from "./dates";
import { daysBetween, dueWord } from "./dayWords";

export type PortfolioStream = {
  id: string;
  name: string;
  owner: string | null;
  owner_user_id: string | null;
  status: string;            // os_workstreams.status: active · blocked · parked (0264)
  blocker?: string | null;
  sort?: number;
};

/** A milestone's workstream as the board has it: the link (0350) and the words. */
export type MilestoneStreamRef = { workstream: string | null; workstream_id?: string | null };

/** Who owns a workstream, by name: the crew member it is linked to (0307), by their CURRENT name —
 *  a rename on the roster renames them here — else the name typed for someone with no account. */
export function streamOwner(s: Pick<PortfolioStream, "owner" | "owner_user_id">, crew: readonly { id: string; display_name: string | null }[]): string | null {
  const linked = s.owner_user_id ? crew.find((c) => c.id === s.owner_user_id)?.display_name?.trim() : "";
  return linked || s.owner?.trim() || null;
}

// Postgres's btrim takes spaces, and only spaces, off the ends; String.trim would take tabs and line
// breaks too, and then the two rules would disagree on a word with a tab in it.
const fold = (s: string) => s.replace(/^ +| +$/g, "").toLowerCase();

/** The one workstream these words already spell, ignoring case and the spaces around them — or null
 *  when none does, or more than one. 0350's backfill is this rule in SQL, and
 *  scripts/fixtures/workstream-words.json holds the two to the same answers. */
export function matchStream<S extends { name: string }>(words: string | null | undefined, streams: readonly S[]): S | null {
  const w = fold(String(words ?? ""));
  if (!w) return null;
  const hits = streams.filter((s) => fold(s.name) === w);
  return hits.length === 1 ? hits[0] : null;
}

/** What a milestone's chip on the board prints: a linked milestone by its workstream's current name
 *  (the words, if the portfolio did not load); words that link to nothing as themselves, marked so. */
export function milestoneStream(m: MilestoneStreamRef, streams: readonly PortfolioStream[]): { text: string; linked: boolean } | null {
  const words = m.workstream?.trim() || null;
  if (m.workstream_id) {
    const s = streams.find((x) => x.id === m.workstream_id);
    const text = s?.name ?? words;
    return text ? { text, linked: true } : null;
  }
  return words ? { text: words, linked: false } : null;
}

// ── HOW OLD THE SCORES ARE, SAID ONCE (2026-10-12, the Command audit, approved) ───────────────────
// On Oct 12 Command read "MEAN 7.0" — exactly the average of the scores seeded on Aug 2, drawn the way
// a fresh audit's would be, with one overdue line under it the only sign. The number is dated now, once:
// "7.0 · assessed Aug 2", and beside it how current it is, in a word — Current (scored within a week),
// Due (8 to 13 days), Stale (two weeks or more) — read from each stream's last_audited. A mean is as old
// as its oldest score, so the oldest decides the word, and a spread of dates is said as one. Parked
// streams are out of it, as they are out of the mean. A stale score is drawn in the quiet ink on its row
// (components/OsRegistry); no row counts its own days — ONE STALE FACT, SAID ONCE (2026-10-07) stands.
// The score, the mean and the bands are 0264's and do not change here: this only says how old they are.

/** current · due · stale — and never, for a stream that has not been scored at all. */
export type Freshness = "current" | "due" | "stale" | "never";
/** Scored this many days ago or fewer: Current. */
export const CURRENT_DAYS = 7;
/** Scored this many days ago or more: Stale. Between the two: Due. */
export const STALE_DAYS = 14;
export const FRESHNESS_WORD: Record<Freshness, string> = { current: "Current", due: "Due", stale: "Stale", never: "Never scored" };

const dayOf = (v: string | null | undefined): string | null => {
  const d = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};
/** "Aug 2" — en-US, as a kept date is (lib/dayWords dateWithYear), so it does not move with the device. */
const shortDay = (key: string) => dayFromKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** How current one stream's score is on `today` (a YYYY-MM-DD key). */
export function freshnessOf(lastAudited: string | null | undefined, today: string): Freshness {
  const day = dayOf(lastAudited);
  if (!day) return "never";
  const age = daysBetween(day, today);
  return age <= CURRENT_DAYS ? "current" : age < STALE_DAYS ? "due" : "stale";
}

export type ScoredRow = { status: string; last_audited: string | null };

/** The portfolio's number, dated once: the oldest and newest days its non-parked scores were given on, and
 *  how current the oldest is. `never` when no non-parked stream has been scored. */
export function portfolioFreshness(rows: readonly ScoredRow[], today: string): { state: Freshness; from: string | null; to: string | null } {
  const days = rows.filter((r) => r.status !== "parked").map((r) => dayOf(r.last_audited)).filter((d): d is string => !!d).sort();
  if (!days.length) return { state: "never", from: null, to: null };
  return { state: freshnessOf(days[0], today), from: days[0], to: days[days.length - 1] };
}

/** The portfolio's head: `score` is the mean the list has always shown (`mean`, computed where it always was,
 *  components/OsRegistry), to one place, dated — "7.0 · assessed Aug 2", or "assessed Aug 2–Oct 5" over a
 *  spread — and `word` says how current it is. All parked: there is nothing to score, and it says that. */
export function portfolioHead(mean: number, rows: readonly ScoredRow[], today: string): { score: string; state: Freshness | null; word: string } {
  if (!rows.some((r) => r.status !== "parked")) return { score: "all parked", state: null, word: "" };
  const f = portfolioFreshness(rows, today);
  const when = !f.from || !f.to ? "not assessed yet" : f.from === f.to ? `assessed ${shortDay(f.from)}` : `assessed ${shortDay(f.from)}–${shortDay(f.to)}`;
  return { score: `${mean.toFixed(1)} · ${when}`, state: f.state, word: FRESHNESS_WORD[f.state] };
}

// ── OPEN PROBLEMS, ONE LINE EACH, READ LIVE (2026-10-12, the Command audit, approved) ─────────────
// A row carried a line for its next action, another for its blocker and a third for the two-week rule —
// up to four lines a stream, ten streams, 910 points of a 2,979-point screen. A stream gets at most one
// line under its name now, and only when something is wrong, read from the row as loaded (no read of its
// own; the app's refresh refreshes it). When more than one thing is wrong, the line says the one that
// most needs a leader:
//   never     no score at all — its 0 is not an assessment, and the mean counts it;
//   decision  below 8 two audits running: the ledger is owed kill, pause or recover (0264's two-week
//             rule, computed where it always was and handed in — it is the score's rule, not this one's);
//   blocker   the blocker as written, as the row always said it;
//   late      the next action's date has passed: "Next action 3 days late".
// A parked stream has none: parked by decision is legal. Blockers are still written where they always
// were, in the stream's audit sheet.

export type ExceptionKind = "never" | "decision" | "blocker" | "late";
/** `text` is the row's line; `say` is the same for a screen reader, with what the eye gets from the row. */
export type StreamException = { kind: ExceptionKind; text: string; say: string };
export type ExceptionRow = ScoredRow & { due: string | null; blocker?: string | null };

/** The one line a stream gets under its name, or null when nothing is wrong. */
export function streamException(w: ExceptionRow, o: { today: string; owesDecision: boolean }): StreamException | null {
  if (w.status === "parked") return null;
  if (freshnessOf(w.last_audited, o.today) === "never") return { kind: "never", text: "Never scored", say: "Never scored — its 0 is not an audit yet" };
  if (o.owesDecision) {
    return { kind: "decision", text: "Two weeks below 8 — log kill, pause or recover",
      say: "Two weeks below 8 — the ledger is owed a kill, pause or recover decision, in Plan › Operating rhythm" };
  }
  const blocker = String(w.blocker ?? "").trim();
  if (blocker) return { kind: "blocker", text: blocker, say: `Blocked: ${blocker}` };
  const due = dayOf(w.due);
  if (due && due < o.today) {
    const text = `Next action ${dueWord(daysBetween(o.today, due))}`;
    return { kind: "late", text, say: text };
  }
  return null;
}

// ── RISK FIRST (2026-10-12, the Command audit; the order approved by the owner) ───────────────────
// The ten were listed by their sort column, so the stream that most needed a leader could be ninth. They
// are listed by where attention is owed now: first a stream whose score is stale or was never given, then
// one with an open problem (its line above, or a status of Blocked), then the lowest score; a tie keeps
// the list's own order. Parked streams keep their place at the end, in their own order. No score moves —
// only the order does.

export type RiskRow = ExceptionRow & { health: number };

/** The streams in the order Command lists them. `owes` is the two-week rule, as the list computes it. */
export function riskOrder<T extends RiskRow>(rows: readonly T[], o: { today: string; owes: (w: T) => boolean }): T[] {
  const keyed = rows.map((w, i) => {
    const fresh = freshnessOf(w.last_audited, o.today);
    const line = streamException(w, { today: o.today, owesDecision: o.owes(w) });
    return { w, i, parked: w.status === "parked", old: fresh === "stale" || fresh === "never", problem: line !== null || w.status === "blocked" };
  });
  keyed.sort((a, b) => Number(a.parked) - Number(b.parked)
    || (a.parked ? a.i - b.i : 0)
    || Number(b.old) - Number(a.old)
    || Number(b.problem) - Number(a.problem)
    || a.w.health - b.w.health
    || a.i - b.i);
  return keyed.map((k) => k.w);
}
