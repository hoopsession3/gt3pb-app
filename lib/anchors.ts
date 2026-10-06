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
//
// A PART INSIDE A ROW (2026-10-06, the settings-by-category round). Settings folded rows into one
// row per topic — the pass's sound and this phone's order alerts are parts of Notifications now — and
// each part kept its id, so every link to it still names it. But a part is drawn only while its row
// is open, so there is nothing to find until the row opens. The jump asks lib/settingsLayout which
// row holds the anchor, opens that row first, then looks for the part. (The copy editor's groups
// were the first case of this: the live page's Edit pill links to one, and since Settings' rows
// close at rest the link found nothing.)
//
// WAITING FOR A PART, AND ASKING AGAIN (2026-10-06, the day that round went live). On the live app
// the Edit pill's link opened Brand & customer app and stopped there, short of its copy group: a
// group is drawn only after the row's body has downloaded and the copy has been read, and on a cold
// load that took longer than the 5s the jump waited. A part waits 12s now; a panel still waits 5s.
// And a request to open is asked again while it goes unanswered: a row is drawn before it starts
// listening (React attaches the listener after the paint), so a request sent in that moment was
// lost, and the jump never asked twice. Asking again is safe — a panel only ever opens on its own
// id, and opening an open panel changes nothing.
//
// THE JUMP STANDS DOWN FOR THE PERSON. A wait that long must not pull the page away from someone who
// has started reading: a scroll, a swipe or a key before the jump lands, and it does not happen.

import { settingsHolder } from "./settingsLayout";

/** window event: `detail` is the panel's id. Every <Panel> opens itself on hearing its own id. */
export const OPEN_PANEL_EVENT = "gt3-open-panel";

/** How long a jump looks for a panel, and for a part inside a row (WAITING FOR A PART, above). */
const WAIT_MS = 5000;
const PART_WAIT_MS = 12000;
/** How soon a request to open that has not been answered is asked again. */
const REASK_MS = 500;
/** What says the person has taken the page back (THE JUMP STANDS DOWN, above). */
const TAKEN_BACK = ["wheel", "touchmove", "keydown"] as const;

/**
 * Ask the panel to open, then wait for the page to STOP MOVING before scrolling — three identical
 * measurements 80ms apart — with a deadline (5s for a panel, 12s for a part inside a row) so a screen
 * that never settles still gets its jump. One correction pass after the animation, because a
 * dynamic() body landing mid-scroll moves the target under us; checked once and corrected without
 * animation so it cannot oscillate.
 */
export function scrollToAnchor(anchor?: string): void {
  if (!anchor || typeof window === "undefined") return;
  const holder = settingsHolder(anchor);
  const deadline = Date.now() + (holder ? PART_WAIT_MS : WAIT_MS);
  const asked = new Map<string, number>();
  let lastTop = -1, stable = 0, takenBack = false;

  // Ask a panel to open — and, while it stays shut, again every REASK_MS.
  const askOpen = (id: string) => {
    const now = Date.now();
    if (now - (asked.get(id) ?? -Infinity) < REASK_MS) return;
    asked.set(id, now);
    window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: id }));
  };
  const standDown = () => { takenBack = true; };
  const watch = (on: boolean) => {
    for (const t of TAKEN_BACK) {
      if (on) window.addEventListener(t, standDown, { passive: true });
      else window.removeEventListener(t, standDown);
    }
  };
  watch(true);

  const tick = () => {
    if (takenBack) { watch(false); return; }
    const el = document.getElementById(anchor);
    if (!el) {
      // A part inside a closed row: ask the row that holds it to open, until it is open.
      const row = holder ? document.getElementById(holder) : null;
      if (holder && row && !row.classList.contains("open")) askOpen(holder);
      // The section may not have mounted yet — ?s= hydration and this effect race. Keep looking.
      if (Date.now() < deadline) setTimeout(tick, 80); else watch(false);
      return;
    }
    // The anchor's own panel, if it is one: asked once, and again while it stays shut.
    if (!asked.has(anchor) || (el.classList.contains("mpanel") && !el.classList.contains("open"))) askOpen(anchor);
    const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
    if (top === lastTop) stable += 1; else { stable = 0; lastTop = top; }
    if (stable < 3 && Date.now() < deadline) { setTimeout(tick, 80); return; }

    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
      watch(false);
      if (takenBack) return;
      const r = document.getElementById(anchor)?.getBoundingClientRect();
      if (r && (r.top < -8 || r.top > window.innerHeight * 0.5)) {
        document.getElementById(anchor)?.scrollIntoView({ block: "start" });
      }
    }, 600);
  };
  setTimeout(tick, 80);
}
