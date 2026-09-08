// PLAN NAV — the one way to land on a Plan sub-tab.
//
// Plan has five sub-tabs and they are NOT addressable by URL. `?s=plan` gets you to the section;
// which tab you land on comes from a localStorage handoff (`gt3-plan-tab`) that the section consumes
// on mount, plus an event for the case where you are already on Plan and no section change fires.
// That is a real mechanism and it works. The problem was that three places knew it differently:
//
//   1. crew/page.tsx alertDest    writes the localStorage key directly
//   2. CompanyCalendar goPlanTab  writes it, fires the event, calls setSection, scrolls
//   3. StopRecord                 <a href="/crew?s=plan&a=vendors">  — and this one was WRONG
//
// The third is the interesting one, because it looks exactly like the other deep links in this app
// and it is not one. `?a=` is an ANCHOR: crew/page.tsx reads it and calls scrollToAnchor. There is
// no element with id "vendors" anywhere, because VendorsAdmin only mounts when the vendors tab is
// already selected — so the link landed you on the Plan calendar and did nothing else. No error, no
// empty state, nothing to notice. That is the failure lib/records.ts named when this audit started:
// "A link that half-works is worse than one that plainly does not."
//
// So the mechanism lives here once. A fourth caller gets it right by importing it, and the deep-link
// check in scripts/smoke.cjs makes sure nobody hand-writes a `?a=` at an anchor that does not exist.

export const PLAN_TABS = ["calendar", "events", "vendors", "route", "leads"] as const;
export type PlanTab = (typeof PLAN_TABS)[number];

export const isPlanTab = (v: unknown): v is PlanTab =>
  typeof v === "string" && (PLAN_TABS as readonly string[]).includes(v);

/** The handoff crew/page.tsx consumes on mount. One spelling, in one place. */
export const PLAN_TAB_KEY = "gt3-plan-tab";
/** Fired so the jump also works when you are ALREADY on Plan and no section change happens. */
export const PLAN_TAB_EVENT = "gt3-plan-tab-set";

/** The href for a Plan tab from outside the crew route. Not `?a=` — that parameter is an anchor. */
export const planTabHref = (): string => "/crew?s=plan";

/**
 * Land on a Plan sub-tab.
 *
 * `setSection` is optional on purpose. Inside the crew route, pass it and the jump is instant with
 * no reload. From a sheet or another route, leave it out and it is a hard navigation to ?s=plan,
 * with the section consuming the handoff as it mounts.
 *
 * ── THE EVENT IS ONLY FOR THE IN-PAGE JUMP ────────────────────────────────────────────────────
 * The first version fired the event in BOTH cases, and the hard-navigation path silently did not
 * work: pressing "Edit the venue instead" landed on the Plan CALENDAR.
 *
 * Because crew/page.tsx's listener CONSUMES the handoff — it reads the key, deletes it, and calls
 * setPlanTab. Firing the event before a full page load means the page being destroyed eats the
 * handoff; the fresh load then finds nothing and falls back to the default tab. The key was gone
 * and the tab was wrong, which is exactly what production showed.
 *
 * So: dispatch only when we are STAYING on this page. When we are leaving, the write is the whole
 * message and the next mount reads it.
 *
 * Worth saying plainly — the deep-link gate added alongside this passed the whole time. A static
 * check proves a link points at something real. It cannot prove that pressing it works.
 */
export function goPlanTab(
  tab: PlanTab,
  opts: { setSection?: (s: "plan") => void; anchor?: string } = {},
): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PLAN_TAB_KEY, tab); } catch { /* private mode — the nav still works */ }
  if (opts.setSection) {
    // Staying put: the listener is the only thing that will notice, so it has to be told.
    window.dispatchEvent(new Event(PLAN_TAB_EVENT));
    opts.setSection("plan");
    // The tab's contents mount after the section switch; scroll once they exist.
    if (opts.anchor) {
      setTimeout(() => document.getElementById(opts.anchor!)?.scrollIntoView({ behavior: "smooth", block: "start" }), 260);
    }
    return;
  }
  // Leaving: do NOT dispatch. The next mount reads the key.
  window.location.href = planTabHref();
}
