"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { onSecond, second, strikeClock } from "@/lib/passClock";

// The Pass's two clocks, as hooks (lib/passClock says why there are two).

/** The current second, in ms, for a label that shows a time. Only the component that calls this is drawn on the tick. */
export function useSecond(): number {
  return useSyncExternalStore(onSecond, second, second);
}

/** The board's own clock: the instant it last struck. It strikes at `next(at)` — the next time the board changes with the
 *  time alone (lib/passBoard nextBoardChange) — and between strikes it does not move, so nothing it feeds is drawn again. */
export function useBoardNow(next: (at: number) => number | null): number {
  const [clock] = useState(strikeClock);
  const at = useSyncExternalStore(clock.subscribe, clock.get, clock.get);
  const aim = next(at);
  useEffect(() => { clock.aim(aim); }, [clock, aim]);
  return at;
}
