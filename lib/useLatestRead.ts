"use client";

import { useCallback, useRef } from "react";

// A SCREEN'S READ: ASKED, THEN ITS ANSWER SET — NEVER AN OLDER ONE OVER A NEWER (R17, 2026-10-17 — the lint ceiling's
// set-state-in-effect).
//
// Forty-odd screens loaded the same way: `const load = useCallback(async () => { … await …; setRows(…) })`, run by an
// effect on mount and on a change, and again after a save. Two things were wrong with it, one the lint saw and one it
// didn't. The lint: an effect calling a function that sets state reads as a cascading render (it cannot tell the state
// is set after an await). Unseen: nothing said which answer was the newest — a slow read for the last stop could land
// after the read for this one and draw the wrong stop's tasks, saying nothing.
//
// Now a load is two halves: `ask` reads (no state), `apply` sets the screen's state with the answer. Reads are numbered as
// they are asked, and an answer is drawn only when it is newer than the one already on the screen: an older one landing
// late is dropped, and one asked earlier that lands first is drawn until the newer one comes. Newer than what is drawn,
// not "the newest asked" — under a stream of asks (a busy feed, a slow signal) the newest asked is always still out, and
// a screen that waited for it would never move (the R17 review). The state is set in the read's own continuation, never
// by the effect that starts it.
//
//   const read = useLatestRead();
//   const load = useCallback(() => read(() => fetchRows(id), (rows) => setRows(rows)), [read, id]);
//   useEffect(() => { load(); }, [load]);
export function useLatestRead(): <T>(ask: () => Promise<T>, apply: (answer: T) => void) => Promise<void> {
  const asked = useRef(0);   // the reads this screen has started, numbered
  const drawn = useRef(0);   // the newest of them whose answer is on the screen
  return useCallback(<T,>(ask: () => Promise<T>, apply: (answer: T) => void): Promise<void> => {
    const mine = ++asked.current;
    return ask().then((answer) => { if (mine > drawn.current) { drawn.current = mine; apply(answer); } });
  }, []);
}
