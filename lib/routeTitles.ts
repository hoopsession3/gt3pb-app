// WHAT EACH SCREEN IS CALLED, SHORT — and where it sits (2026-10-08, the navigation round: redesign 2,
// approved).
//
// The title bar names the screen you are on once its own heading has scrolled away ("Money", "Academy"),
// and the ‹ at its left names the screen Back goes to ("‹ Menu") — the way every iPhone app's navigation
// bar does. Both read the names here: a screen's address is enough to name it, so a name never depends on
// what happened to be drawn when you left it. Short on purpose: a back label shares a 44pt bar with a
// title, and Apple's own are a word or two.
//
// The crew's sections are named here too (SECTION_TITLE): the console's heading, its guide and its trail
// each wrote the same sixteen names out themselves, three copies that had already begun to differ.

/** A crew section's name: its heading, its guide's row, the bar's title and a back label to it. Keyed by
 *  components/OperatorSection's OpSection (written out here so this file needs nothing but itself). */
export const SECTION_TITLE: Readonly<Record<string, string>> = {
  day: "My Day", now: "Live Ops", ask: "Ask GT3", command: "Command", prep: "Readiness", plan: "Plan", studio: "Studio",
  brew: "Brew", garage: "Assets", driver: "Delivery", notes: "Notes", money: "Money", catalog: "Catalog",
  customers: "Customers", team: "Team", settings: "Settings",
};

/** Every other screen, by its first path segment. The tabs' names are the tab bar's. */
const ROUTE_TITLE: Readonly<Record<string, string>> = {
  "": "Today", truck: "Find Us", events: "Find Us", menu: "Menu", shop: "Shop", "3mpire": "3MPIRE",
  book: "Book the bar", craft: "Our craft", reserve: "Reserve", delivery: "Delivery", primal: "Primal",
  academy: "Academy", agreement: "Agreement", offer: "Your offer", architecture: "System map", scan: "Scan",
  playbook: "Playbook", privacy: "Privacy", terms: "Terms", office: "Your GT3", driver: "Delivery run",
  display: "Display", built: "Partner share", crew: "Crew",
};

/** The tab bar's own screens. A tab is where a way through the app starts: it has no Back of its own. */
export const TAB_ROOTS: readonly string[] = ["/", "/truck", "/events", "/menu", "/shop", "/3mpire"];

/** Screens that had their own ‹ to a fixed place before the bar carried Back (2026-10-08): reached with no
 *  screen before them in this visit — a link in an email, the app opened on one — Back still goes there. */
const UP: Readonly<Record<string, string>> = {
  academy: "/3mpire", agreement: "/3mpire", architecture: "/3mpire", offer: "/", scan: "/crew",
};

const first = (path: string): string => (path.split("?")[0].split("#")[0].split("/")[1] ?? "");
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The screen at `path` (a pathname, with its query when it has one), named. */
export function titleOf(path: string): string {
  const seg = first(path);
  if (seg === "crew") {
    const s = new URLSearchParams(path.split("?")[1] ?? "").get("s");
    if (s && own(SECTION_TITLE, s)) return SECTION_TITLE[s];
  }
  return own(ROUTE_TITLE, seg) ? ROUTE_TITLE[seg] : "Back";
}

/** A tab bar screen: no Back, no title bar of its own. */
export function isTabRoot(pathname: string): boolean {
  return TAB_ROOTS.includes(pathname.split("?")[0] || "/");
}

/** Where Back goes from `pathname` when nothing came before it in this visit, or null. */
export function upOf(pathname: string): string | null {
  const seg = first(pathname);
  return own(UP, seg) ? UP[seg] : null;
}
