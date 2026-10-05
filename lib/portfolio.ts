// THE PORTFOLIO, AS THE REST OF THE APP READS IT — os_workstreams (0264): the named workstreams on
// Command, one owner each, audited every Monday. Not lib/streams: that is work_streams (0159), the
// lanes the nav, goals and the calendar are filed to. 0264 kept the two apart on purpose.
//
// What lives here is what more than one screen needs to say about a workstream: who owns it, which
// workstream some words already spell, and — since 0350 — what a milestone's chip on the board
// prints. The milestone sheet's pick is lib/milestonePick, loaded with the sheet. Pure, so
// scripts/smoke.cjs runs it.

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
