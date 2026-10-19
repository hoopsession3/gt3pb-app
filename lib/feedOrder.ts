// THE FEED'S ORDER, WITHOUT A DRAG (R35, 2026-10-18 — the fresh audit's UX11-09). The Studio's feed preview was ordered
// by dragging one tile onto another, and only that: an owner on an iPad with a keyboard, with VoiceOver, with a switch,
// or with one finger in the iPhone app (where an HTML drag may never start) could not plan the feed. A piece moves to
// the first place, one earlier or one later — from its tile's long-press menu and from the piece itself — and where it
// landed is said ("Moved to 3 of 12"). Dragging stays, as the shortcut.

export type FeedMove = "first" | "earlier" | "later";

/** The feed's ids with one piece moved, or null when it can't move that way (already first, already last, not in the
 *  feed). Pure. */
export function movedFeed(ids: readonly string[], id: string, to: FeedMove): string[] | null {
  const at = ids.indexOf(id);
  if (at < 0) return null;
  const dest = to === "first" ? 0 : to === "earlier" ? at - 1 : at + 1;
  if (dest < 0 || dest >= ids.length || dest === at) return null;
  const next = ids.slice();
  next.splice(at, 1);
  next.splice(dest, 0, id);
  return next;
}

/** The moves a piece can make from where it is, in the order a menu lists them. Pure. */
export function feedMoves(ids: readonly string[], id: string): { key: FeedMove; label: string }[] {
  const at = ids.indexOf(id);
  if (at < 0 || ids.length < 2) return [];
  const moves: { key: FeedMove; label: string }[] = [];
  if (at > 1) moves.push({ key: "first", label: "Move to first" });
  if (at > 0) moves.push({ key: "earlier", label: "Move earlier" });
  if (at < ids.length - 1) moves.push({ key: "later", label: "Move later" });
  return moves;
}

/** Where a piece is, in words: "3 of 12". Pure. */
export function placeWords(ids: readonly string[], id: string): string {
  const at = ids.indexOf(id);
  return at < 0 ? "" : `${at + 1} of ${ids.length}`;
}
