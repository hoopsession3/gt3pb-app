// A LINK'S STATE, FROM ITS RECORDS (IMS8 P8). Ryan: "states from records, not guesses." Off (revoked — final, 0468),
// Ended (its date passed), Live, and Live but changed since it was shared: what the link sends (its published revision,
// 0472) differs from what sharing it now would send — the server's review says so by fingerprint, never a guess here.
// A newer approval than the link's pin is said apart (the money stays as approved until an owner moves it). And what
// changed, in words: the writing added and taken away, per category, between the two responses. Pure.
import { previewOf } from "./sharePreview";

export type LinkPhase = "off" | "ended" | "live" | "changed";
export const PHASE_WORD: Record<LinkPhase, string> = { off: "Off", ended: "Ended", live: "Live", changed: "Changed since shared" };
export type LinkRecord = { revoked_at: string | null; expires_at?: string | null; published_at?: string | null };

/** The state, from the record and (for a live link) the server's review: `changed` is its own flag, or null if unread. */
export function linkPhase(s: LinkRecord, changed: boolean | null = null, now = Date.now()): { phase: LinkPhase; word: string; live: boolean; ends: string | null } {
  if (s.revoked_at) return { phase: "off", word: PHASE_WORD.off, live: false, ends: null };
  if (s.expires_at && Date.parse(s.expires_at) <= now) return { phase: "ended", word: PHASE_WORD.ended, live: false, ends: null };
  const days = s.expires_at ? Math.ceil((Date.parse(s.expires_at) - now) / 86400000) : null;
  const ends = days == null ? null : days <= 1 ? "ends within a day" : `ends in ${days} days`;
  const phase: LinkPhase = changed ? "changed" : "live";
  return { phase, word: PHASE_WORD[phase], live: true, ends };
}

export type Change = { title: string; added: string[]; removed: string[] };
/** What changed between what a link sends (`was`) and what sharing it now would send (`now`): writing added and taken away,
 *  per category, word for word; counts that moved without words (a number, a room's size) said as "changed". */
export function changesBetween(was: unknown, now: unknown): { changes: Change[]; numbersOnly: boolean } {
  const a = previewOf(was), b = previewOf(now);
  const keys = [...new Set([...a.sections.map((s) => s.key), ...b.sections.map((s) => s.key)])];
  const changes: Change[] = [];
  for (const k of keys) {
    const x = a.sections.find((s) => s.key === k), y = b.sections.find((s) => s.key === k);
    const before = x?.texts ?? [], after = y?.texts ?? [];
    const added = after.filter((t) => !before.includes(t)), removed = before.filter((t) => !after.includes(t));
    if (added.length || removed.length || (x?.count ?? 0) !== (y?.count ?? 0)) changes.push({ title: (y ?? x)!.title, added, removed });
  }
  const strip = (p: unknown) => { const { pinned_at, expires_at, ...rest } = (p ?? {}) as Record<string, unknown>; void pinned_at; void expires_at; return JSON.stringify(rest); };
  return { changes, numbersOnly: changes.length === 0 && strip(was) !== strip(now) };
}
