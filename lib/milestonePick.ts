// FILING A MILESTONE TO A WORKSTREAM — the pick in components/MilestoneSheet (2026-10-05, the form
// audit, part 3e · 0350): where it starts, what it lists, what saving writes, and the line under it.
// Loaded with the sheet, which an admin opens from a milestone's ⋯ — not with the board. What the
// rest of the app reads about a workstream (its owner, the words that spell it, a milestone's chip) is
// lib/portfolio's. Pure, so scripts/smoke.cjs runs it.
import { type MilestoneStreamRef, type PortfolioStream, matchStream } from "./portfolio";

/** The pick's two groups, in the portfolio's own order: the streams in play, then the parked ones. */
export function streamChoices<S extends PortfolioStream>(streams: readonly S[]): { open: S[]; parked: S[] } {
  const ordered = [...streams].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  return { open: ordered.filter((s) => s.status !== "parked"), parked: ordered.filter((s) => s.status === "parked") };
}

/** The pick's value for "the words this milestone already has, which link to nothing". */
export const KEPT_WORDS = "__kept";

/** Where the pick starts: the linked stream; else the one stream the words spell (saving links it,
 *  as PersonPick resolves an old typed name); else the words themselves; else nothing. */
export function startingPick(m: MilestoneStreamRef, streams: readonly PortfolioStream[]): string {
  if (m.workstream_id) return m.workstream_id;
  const words = m.workstream?.trim();
  if (!words) return "";
  return matchStream(words, streams)?.id ?? KEPT_WORDS;
}

/** What saving the pick writes — only what changed. The words ride with the link (the database
 *  rewrites them to the stream's name anyway, 0350), so a database without 0350 keeps the name.
 *  Without 0350, words that already spell the picked stream are left as they are: 0350 links them. */
export function streamPatch(pick: string, m: MilestoneStreamRef, streams: readonly PortfolioStream[], linkable: boolean): { workstream_id?: string | null; workstream?: string | null } {
  if (pick === KEPT_WORDS) return {};
  if (!pick) return m.workstream_id || m.workstream?.trim() ? { workstream_id: null, workstream: null } : {};
  if (pick === m.workstream_id) return {};
  const s = streams.find((x) => x.id === pick);
  if (!s) return {};
  if (!linkable && matchStream(m.workstream, streams)?.id === s.id) return {};
  return { workstream_id: s.id, workstream: s.name };
}

/** The line under the pick: what filing the milestone there means, or why it cannot be filed yet. */
export function streamNote(o: {
  pick: string;
  m: MilestoneStreamRef;
  streams: readonly PortfolioStream[];
  failed: string | null;
  linkable: boolean;
  owner: (s: PortfolioStream) => string | null;
}): string | null {
  const words = o.m.workstream?.trim() || null;
  if (o.failed) return `Couldn't load the portfolio — ${o.failed}. The milestone keeps what it has.`;
  if (o.pick === KEPT_WORDS) return `“${words}” was typed before the portfolio and links to no workstream — pick the one it belongs to.`;
  if (!o.pick) return o.streams.length ? null : "Nothing in the portfolio yet — add a workstream above, then file this to it.";
  const s = o.streams.find((x) => x.id === o.pick);
  if (!s) return `${words ? `“${words}”` : "That workstream"} is not in the portfolio any more — pick where it belongs now.`;
  const who = o.owner(s);
  const owns = who ? `${who} owns ${s.name}.` : `Nobody owns ${s.name} yet.`;
  const state = s.status === "parked" ? " Parked by decision." : s.status === "blocked" ? (s.blocker?.trim() ? ` Blocked — ${s.blocker.trim()}.` : " Blocked.") : "";
  if (!o.linkable) return `${owns}${state} The milestone keeps the name; the link arrives with the next database update.`;
  const before = o.m.workstream_id || !words ? ""
    : matchStream(words, o.streams)?.id === s.id ? `“${words}” is ${s.name} in the portfolio — saving links it. `
    : `Saving files it to ${s.name} in place of “${words}”. `;
  return `${before}${owns}${state}`;
}
