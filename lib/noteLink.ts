// OPEN THAT NOTE, NOT JUST NOTES (2026-10-12).
//
// The Plan card's "Latest: Oct 5 · 7 days ago — open in Notes" switched to Notes and stopped there, at the top of the
// list, with the note it named somewhere below it, closed; so did assembling a review or a strategy session ("it's in
// Notes") and filing a session's transcript. Every one of them knows exactly which note it means — the card read its
// id, and the three routes return it. This carries the id across the section switch: the asker leaves it here and
// switches; the Notes list (MeetingNotes, app/crew/page.tsx) takes it once it has read its notes — shows the shelf the
// note is on, opens it, scrolls to it and puts focus on its header. A list already on screen hears the ask directly.
//
// Module state rather than the address or storage: an ask lives exactly as long as the page that made it. Nothing
// promised a link to a note that could be pasted elsewhere, and a stale ?note= left on a history entry would reopen a
// note on some later visit nobody asked about.

let pending: string | null = null;
const listeners = new Set<(id: string) => void>();

/** The DOM id a note's card carries, so a jump can land on it. */
export const noteAnchor = (id: string): string => `note-${id}`;

/** Ask the Notes list to open one note — before switching to Notes, or while it is showing. */
export function askOpenNote(id: string | null | undefined): void {
  if (!id) return;
  pending = id;
  for (const hear of [...listeners]) hear(id);
}

/** The note asked for and not opened yet, or null. Read it in a state initializer; clear it once acted on. */
export const pendingNoteAsk = (): string | null => pending;

/** An ask has been acted on. Only the one still pending is forgotten — a newer ask stands. */
export function clearNoteAsk(id: string): void {
  if (pending === id) pending = null;
}

/** Hear asks made while the list is mounted; returns the unsubscribe, for an effect's cleanup. */
export function onNoteAsk(hear: (id: string) => void): () => void {
  listeners.add(hear);
  return () => { listeners.delete(hear); };
}

/** Put focus on a note's header once it is drawn, without scrolling (lib/anchors does the scroll), so a keyboard or a
 *  screen reader lands where the eye does. Gives up after `waitMs`. */
export function focusNoteWhenThere(id: string, waitMs = 3000): void {
  if (typeof document === "undefined") return;
  const until = Date.now() + waitMs;
  const tick = () => {
    const head = document.getElementById(noteAnchor(id))?.querySelector<HTMLElement>(".note-head");
    if (head) { head.focus({ preventScroll: true }); return; }
    if (Date.now() < until) setTimeout(tick, 100);
  };
  setTimeout(tick, 100);
}
