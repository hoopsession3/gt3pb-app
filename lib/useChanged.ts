"use client";

import { useState } from "react";

// A VALUE THAT IS NEW SINCE THE LAST RENDER (R17, 2026-10-17 — the lint ceiling's set-state-in-effect).
//
// "Seed the editable copy from each fresh load" was an effect — `useEffect(() => { if (state.data) setX(state.data) },
// [state.data])` — so every load drew the screen twice, the first time with the old copy. React's own answer is to
// adjust state while rendering when a value changes: this says, during render, whether `value` is a different one (by
// identity) from the last render's, and the caller sets its state right there. React throws that render away and draws
// it again with the new state before anything is shown — one render, never a stale one.
//
//   if (useChanged(state.data) && state.data) setRows(state.data);
//
// A FUNCTION IS A VALUE HERE (found by the R17 chain's smoke:native, React's error #301). useState and its setter CALL a
// function they are handed — as a lazy first value, as an updater — so StatusCard's `draw` was painted during render and
// the copy kept what it returned, which never equalled `draw`: every render set state again, and React gave up after
// 25. Held and set as `() => value`, any value — a callback included — is kept as itself and compared, never called.
export function useChanged<T>(value: T): boolean {
  const [seen, setSeen] = useState<T>(() => value);
  if (Object.is(seen, value)) return false;
  setSeen(() => value);
  return true;
}
