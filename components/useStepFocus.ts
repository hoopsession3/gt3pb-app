"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// A NEW STEP IS WHERE FOCUS GOES (R12 — the 10/10 audit's accessibility pass, F5). The buying flows swap one view for
// the next — the shop's grid, product, checkout and receipt; the pack wizard's size, drinks, glass, details and payment;
// the office order's form and its "You're on the Monday route"; Book the bar's form and its "Request received" — and the
// button pressed goes with the view it was in. Focus fell to the page, a screen reader said nothing, and a keyboard
// started again from the top: the merch payment and the office booking succeeded in silence. OrderConfirm already did
// the right thing for the cup checkout (focus its headline, inside the sheet, without a scroll); this is that, for any
// view that replaces another.
//
// `step` is whatever names the view on screen; when it changes (not on the first draw), focus moves to `pick()`'s
// element, else the view's own [data-step-head], else its first heading, inside `scope`. `skip` leaves it to the view
// (a receipt that focuses its own headline). A heading is made focusable for the moment (tabindex -1), never a stop in
// the Tab order.
export function useStepFocus(
  step: unknown,
  scope: RefObject<HTMLElement | null>,
  opts?: { skip?: boolean; pick?: () => HTMLElement | null | undefined },
): void {
  const prev = useRef(step);
  const latest = useRef(opts);
  useLayoutEffect(() => { latest.current = opts; });
  useEffect(() => {
    if (Object.is(prev.current, step)) return;
    prev.current = step;
    const o = latest.current;
    if (o?.skip) return;
    const root = scope.current;
    if (!root) return;
    const el = o?.pick?.() ?? root.querySelector<HTMLElement>("[data-step-head]") ?? root.querySelector<HTMLElement>("h1, h2, h3");
    if (!el) return;
    if (!el.matches("a[href], button, input, select, textarea, [tabindex]")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }, [step, scope]);
}
