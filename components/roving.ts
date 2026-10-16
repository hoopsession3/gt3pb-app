import type { KeyboardEvent } from "react";

// ONE TAB STOP, ARROWS INSIDE (R12 — the 10/10 audit, F7). A group of choices — a radio group, a tab list — is one stop in
// the Tab order (the chosen one, tabIndex 0; the rest -1), and ← → ↑ ↓ Home End move along it, choosing as they go, the
// way every tab bar and segmented control behaves. The kit's Segmented does this itself; this is for the hand-built rows.
// Called from the group's onKeyDown with how many options there are, where the choice is, and what choosing one does —
// which returns false when the choice can't be taken now (a save still out), and focus then stays where it is.
//
// WITHOUT `choose`, THE ARROWS ONLY LOOK. A choice that writes to the server and changes what someone gets — a
// customer's tier, when cup orders open — is not made by passing over it: the arrows move focus, and Space or Enter
// chooses, as an iPhone's segmented control does under Full Keyboard Access.
export function rovingKeys(e: KeyboardEvent<HTMLElement>, count: number, at: number, choose?: (i: number) => void | boolean): void {
  if (count < 1) return;
  const opts = e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"],[role="tab"]');
  const focused = Array.prototype.indexOf.call(opts, document.activeElement) as number;
  const from = !choose && focused >= 0 ? focused : at >= 0 ? at : 0;
  const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (from + 1) % count
    : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (from - 1 + count) % count
    : e.key === "Home" ? 0 : e.key === "End" ? count - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  if (choose && choose(to) === false) return;
  opts[to]?.focus();
}

/** The option's place in the Tab order: the chosen one (or the first, when none is) is the group's one stop. */
export const rovingTab = (i: number, at: number): 0 | -1 => (i === (at >= 0 ? at : 0) ? 0 : -1);
