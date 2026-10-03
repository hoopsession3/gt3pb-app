// JUMPING TO A PANEL — one home (2026-10-03).
//
// The crew console is one page of sections, and many things point INTO it: an alert's "Open", a
// Settings deep link (?s=settings&a=set-errors), a KPI tile. Two of those used scrollToAnchor in
// app/crew/page.tsx — which asks the panel to open, waits for the page to stop moving, then scrolls.
// The third, the Readiness tiles in components/CrewKpis.tsx, had its own copy: a bare
// scrollIntoView 120ms after writing to localStorage. The <Panel> only reads that key on mount, so
// the board it pointed at stayed collapsed, and scrolling a closed accordion header near the end of
// the page to the top takes the page as far as it goes — the bottom. Ryan: "I clicked on each
// metric and it just scrolled to the bottom."
//
// Now there is one way to point at a panel, and it is this file: the event name every <Panel>
// listens for, and the jump that dispatches it.

/** window event: `detail` is the panel's id. Every <Panel> opens itself on hearing its own id. */
export const OPEN_PANEL_EVENT = "gt3-open-panel";

/**
 * Ask the panel to open, then wait for the page to STOP MOVING before scrolling — three identical
 * measurements 80ms apart — with a 5s deadline so a screen that never settles still gets its jump.
 * One correction pass after the animation, because a dynamic() body landing mid-scroll moves the
 * target under us; checked once and corrected without animation so it cannot oscillate.
 */
export function scrollToAnchor(anchor?: string): void {
  if (!anchor || typeof window === "undefined") return;
  const deadline = Date.now() + 5000;
  let lastTop = -1, stable = 0, asked = false;

  const tick = () => {
    const el = document.getElementById(anchor);
    if (!el) {
      // The section may not have mounted yet — ?s= hydration and this effect race. Keep looking.
      if (Date.now() < deadline) setTimeout(tick, 80);
      return;
    }
    if (!asked) {
      asked = true;
      window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: anchor }));
    }
    const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
    if (top === lastTop) stable += 1; else { stable = 0; lastTop = top; }
    if (stable < 3 && Date.now() < deadline) { setTimeout(tick, 80); return; }

    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
      const r = document.getElementById(anchor)?.getBoundingClientRect();
      if (r && (r.top < -8 || r.top > window.innerHeight * 0.5)) {
        document.getElementById(anchor)?.scrollIntoView({ block: "start" });
      }
    }, 600);
  };
  setTimeout(tick, 80);
}
