"use client";

import { useCallback, useLayoutEffect, useRef, type FocusEvent } from "react";
import type { Order } from "@/lib/db";

// FOCUS STAYS ON THE BOARD (2026-10-11, the KDS program, wave 2). A ticket that moves to the next lane is drawn there
// anew, and the button that moved it goes with the old one: focus fell to the page under the Pass, so a keyboard or a
// screen reader started again from the top, behind the dialog. Now focus that was on a ticket follows it — to its new
// lane, or the tray — and a ticket that left the board (voided, or picked up past the tray) hands it to the heading of
// the lane it left.
//
// Only focus that was really there is followed: on the ticket when its action began, or in a sheet that ticket opened
// (its menu, the void's question, Collect). An iPhone does not focus a tapped button, so a finger's tap moves no focus
// and paints no ring (WebKit draws one for a script's focus with no pointer behind it — app/globals.css .op-trans).

type Lane = "scheduled" | "new" | "preparing" | "ready" | "done";

/** `board` goes on the board's root element; `orders` is the board's list (its change is when the board is drawn). */
export function useFollowFocus(orders: readonly Order[]) {
  const board = useRef<HTMLDivElement>(null);
  // The ticket focus was last inside, on the board; the ticket whose action is under way with focus on it; and, once it
  // moves, where to put focus after the board is drawn.
  const lastIn = useRef<string | null>(null);
  const armed = useRef<string | null>(null);
  const follow = useRef<{ id: string; lane: Lane } | null>(null);

  /** On the board root: remember which ticket focus is in (a sheet's focus, drawn elsewhere, is not the board's). */
  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => {
    const t = e.target;
    if (!(t instanceof Element) || !board.current?.contains(t)) return;
    lastIn.current = t.closest("[data-ticket]")?.getAttribute("data-ticket") ?? null;
  }, []);

  /** An action on `o` begins: follow it if focus is on its ticket, or in a sheet raised from it. */
  const arm = useCallback((o: Order) => {
    const a = document.activeElement;
    const onIt = a instanceof Element && !!board.current?.contains(a) && !!a.closest(`[data-ticket="${o.id}"]`);
    const fromIt = a instanceof Element && !board.current?.contains(a) && !!a.closest(".sheet2") && lastIn.current === o.id;
    armed.current = onIt || fromIt ? o.id : null;
  }, []);

  /** `o` is about to move out of `lane`: if its action was armed, focus follows once the board is drawn. */
  const land = useCallback((o: Order, lane: Lane) => {
    if (armed.current === o.id) follow.current = { id: o.id, lane };
    armed.current = null;
  }, []);

  useLayoutEffect(() => {
    const f = follow.current, root = board.current;
    if (!f || !root) return;
    follow.current = null;
    const t = root.querySelector<HTMLElement>(`[data-ticket="${f.id}"]`)
      ?? root.querySelector<HTMLElement>(`[data-lane="${f.lane}"] .kds-stage-h`)
      ?? root;
    t.focus({ preventScroll: false });
  }, [orders]);

  return { board, onFocus, arm, land };
}
