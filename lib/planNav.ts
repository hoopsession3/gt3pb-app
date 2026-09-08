// PLAN NAV — the one way to land on a Plan sub-tab.
//
// Plan has five sub-tabs. As of this file they ARE addressable: `/crew?s=plan&t=route` is a real,
// pasteable link, mirroring the `?s=` the section itself has always used. Before that, the tab was a
// localStorage handoff and nothing else, so a Plan tab could not be linked, bookmarked or sent to
// anybody — and SEVEN places wrote that handoff by hand, in six files:
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

/** The query parameter that ADDRESSES a Plan tab, mirroring the section's own `?s=`. */
export const PLAN_TAB_PARAM = "t";

/** A real, pasteable link to one Plan tab. Not `?a=` — that parameter is an anchor. */
export const planTabHref = (tab: PlanTab): string => `/crew?s=plan&${PLAN_TAB_PARAM}=${tab}`;

/** The tab a URL asks for, or null. Strict: an unknown value falls through to the default. */
export function planTabFromUrl(href?: string): PlanTab | null {
  try {
    const v = new URL(href ?? window.location.href).searchParams.get(PLAN_TAB_PARAM);
    return isPlanTab(v) ? v : null;
  } catch { return null; }
}

/**
 * Put the tab in the URL without adding a history entry — the same replaceState the section does
 * for `?s=`, for the same reason: it labels the entry you are already on so the link is copyable
 * and native back still works.
 */
export function stampPlanTab(tab: PlanTab): void {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    if (!u.pathname.startsWith("/crew")) return;
    if (u.searchParams.get(PLAN_TAB_PARAM) === tab) return;
    u.searchParams.set(PLAN_TAB_PARAM, tab);
    window.history.replaceState(window.history.state, "", u.pathname + u.search);
  } catch { /* a URL we cannot parse is not worth a crash */ }
}

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
  try { localStorage.setItem(PLAN_TAB_KEY, tab); } catch { /* private mode — the URL still carries it */ }
  if (opts.setSection) {
    // Staying put: stamp the URL so the tab is addressable from here on, then tell the listener —
    // it is the only thing that will notice, since no navigation happens.
    stampPlanTab(tab);
    window.dispatchEvent(new Event(PLAN_TAB_EVENT));
    opts.setSection("plan");
    // The tab's contents mount after the section switch; scroll once they exist.
    if (opts.anchor) {
      setTimeout(() => document.getElementById(opts.anchor!)?.scrollIntoView({ behavior: "smooth", block: "start" }), 260);
    }
    return;
  }
  // Leaving: do NOT dispatch — the page about to be destroyed would eat the handoff. The URL is
  // the message now, which is the whole point of ?t=: it survives the load, and it can be pasted.
  window.location.href = planTabHref(tab);
}
