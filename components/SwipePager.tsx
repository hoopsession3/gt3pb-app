"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import type { PageLevel } from "@/lib/gesture";
import type { PagerMotionProps } from "./PagerMotion";

// SWIPE BETWEEN TABS (2026-10-05, the gesture round). Ryan: "swipe left to move forward to the next
// tab". A screen with a row of tabs across its top — the lane's sections (My Day · Live Ops ·
// Command), Plan's Calendar · Events · Route · Leads · Vendors, Studio's views, the shop's two aisles —
// turns its page with a sideways swipe on the content, the way a paged tab strip does on the phone:
// the content follows the finger, a third of the way across (or a flick) turns it, and the next tab
// slides in from the side it was swiped toward. Nothing that way: the content gives like a rubber band
// and settles back.
//
// The screen that renders a <SwipePager> hands it the tab rows it owns (`levels`); a component inside
// the content with a row of its own (Studio's views) offers it with usePagerLevel. Rows nest: `depth`
// 0 is the outermost row; a swipe moves the innermost row that has a tab that way, and at its end the
// row around it (lib/gesture pageStep) — swiping on past Plan's last tab goes to the lane's next
// section. A row is moved the way its own tabs move it (`go`), so the
// address, history and focus behave exactly as a tap does. A strip that scrolls sideways, a field, a
// map or a dialog keeps its own touches (lib/gesture heldBy), and a swipe from the very edge is the
// way back (components/SwipeBack listens first).
//
// This file is the structure — the rows and the box; the finger-following is components/PagerMotion,
// which loads right after the screen is up so the engine is not in a guest's first load.

export type PagerLevel = PageLevel & { go: (key: string) => void };
type Level = PagerLevel;
const Ctx = createContext<((id: string, level: Level | null) => void) | null>(null);
const PagerMotion = dynamic<PagerMotionProps>(() => import("./PagerMotion"), { ssr: false });

/** Offer a row of tabs to the swipe around it. `null` takes it back (a row that is not showing). */
export function usePagerLevel(level: Level | null): void {
  const set = useContext(Ctx);
  const id = useId();
  // Re-offered on every render: the row's current tab and its `go` change as the screen does.
  useEffect(() => { set?.(id, level); });
  useEffect(() => () => set?.(id, null), [set, id]);
}

export default function SwipePager({ levels: own = [], children, className = "" }: {
  /** The tab rows the screen rendering this pager owns; a row not showing is left out (or null). */
  levels?: readonly (Level | null | false)[];
  children: ReactNode;
  className?: string;
}) {
  const offered = useRef(new Map<string, Level>());
  const box = useRef<HTMLDivElement>(null);
  // THE WHOLE SCREEN TURNS THE PAGE. The finger is followed on the screen's scroll container — the
  // header, the tab row, and the empty space under a short page all swipe — and the content moves. A
  // pager that listened on its content alone ended where the content did: on a short page the
  // swipe landed below it, and a browser that pages its history on an unclaimed sideways swipe went
  // back a page instead.
  const surface = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { surface.current = box.current?.closest<HTMLElement>("main") ?? box.current; }, []);
  const set = useCallback((id: string, l: Level | null) => { if (l) offered.current.set(id, l); else offered.current.delete(id); }, []);
  const levels = (): Level[] => [...own.filter((l): l is Level => !!l), ...offered.current.values()];

  return (
    <Ctx.Provider value={set}>
      <div ref={box} className={`swipe-pager${className ? ` ${className}` : ""}`}>{children}</div>
      <PagerMotion box={box} surface={surface} levels={levels} />
    </Ctx.Provider>
  );
}
