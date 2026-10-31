// WHICH KIND OF PAGE THIS IS — one home for a question the app shell was asking four ways.
//
// Ryan's Academy screenshot, 2026-10-04: a red "Review 1 drink · $10" bar across the bottom of the
// crew's TRAINING page, sitting on the module list. The shell decided where commerce chrome goes
// with three different conditions: the drinks cart bar and the live-order status showed everywhere
// but the console and a share page; the guest concierge and the marketing splash showed everywhere
// but those, /architecture and /academy. So the concierge already knew the Academy was not a shop
// and the cart bar did not — and neither knew about the driver's screen (one-handed, at the wheel),
// the member-card scanner, the owner's playbook, an operator's agreement, a candidate's offer, or the
// TV loop on the truck, which would have shown a guest's open order to a whole queue.
//
//   console    /crew — the operator console, its own nav and chrome
//   share      /built — a read-only partner page: bare, no nav, no commerce
//   work       staff tools and documents outside the console — read, sign, train, drive, scan,
//              and the truck's display loop. No cart, no order status, no concierge, no splash.
//   customer   everything a guest or member orders from or reads on the way to ordering.
//
// A new page is "customer" unless it is added below, which is the safe direction to be wrong in: a
// cart bar where it is not needed is noise, a cart bar missing where someone is ordering is lost money.

export type Surface = "console" | "share" | "work" | "customer";

export const WORK_ROUTES = [
  "/academy", "/architecture", "/driver", "/scan", "/playbook", "/agreement", "/offer", "/display", "/vision",
] as const;

export function surfaceOf(pathname: string | null | undefined): Surface {
  const p = pathname || "/";
  if (p.startsWith("/crew")) return "console";
  if (p.startsWith("/built") || p === "/present" || p.startsWith("/present/")) return "share";   // R52: a private link to the plan
  if (WORK_ROUTES.some((r) => p === r || p.startsWith(`${r}/`))) return "work";
  return "customer";
}

/** The drinks cart bar, a live order's status, the guest concierge and the marketing splash. */
export const showsCommerce = (s: Surface): boolean => s === "customer";

// GT3 HQ (IMS7, 2026-10-31 — Ryan: "distinguish authorized GT3 HQ tools from public customer navigation"). The crew's
// planning tools outside the console — the vision: the roadmap, the plans, the store, the Standard, the library, the menu.
// Still "work" above (no cart, no concierge); what changes is the bar under it. The crew get the HQ bar (back to the
// console, and where they are); anyone else keeps the customer bar, so a guest who lands on /vision can still leave the
// way they came. The bar is not the boundary: the page refuses anyone outside the crew (lib/access staffAccess) and the
// database refuses their reads either way. Choosing a bar only decides which links someone is offered.
/** Which bar a page carries: the console's own, the HQ bar (the vision and anything under it), the customer bar, or none
 *  (a share link). Written like deskRoute below, which it ships beside in every page's bundle (/playbook sits on its weight ceiling). */
export type NavKind = "operator" | "hq" | "customer" | "none";
export const navOf = (pathname: string | null | undefined): NavKind => {
  const p = pathname || "/", s = surfaceOf(p);
  return s === "share" ? "none" : s === "console" ? "operator" : p === "/vision" || p.startsWith("/vision/") ? "hq" : "customer";
};

// THE DESK (2026-10-09, redesign 5, approved by Ryan 2026-10-08). From 1,024 wide in landscape — a laptop, a
// desktop, an iPad on its side — the crew console and an office client's home leave the phone frame: the tab bar
// is a sidebar and the page a canvas of two columns up to 1,240 wide (app/globals.css THE DESK, and the `desk:`
// variant in app/tailwind.css). They are the two places someone works from a big screen for an hour. Every other
// page keeps the frame, and a phone, or an iPad held upright (the 13-inch is 1,032 wide), keeps the layout it has.
// The app meets it on an iPad on its side (2026-10-11: the app installs on an iPad, any way up — scripts/ios.configure.mjs);
// an iPhone stays upright and never does. In the app an iPad's shell fills the glass at any size (components/NativeBridge.css).
// The query is spelled three times — here, in the stylesheet and in the variant — and scripts/smoke.cjs holds the
// three to the same words.
export const DESK_QUERY = "(min-width: 1024px) and (orientation: landscape)";

/** Does this page leave the frame for the desk on a wide screen? The console, /office — and the vision (R53, Ryan:
 *  "be amazing on iPad Pro… and desktop"): the store designer and the plans are worked on from a big screen too. */
export function deskRoute(pathname: string | null | undefined): boolean {
  const p = pathname || "/";
  return surfaceOf(p) === "console" || p === "/office" || p.startsWith("/office/") || p === "/vision" || p.startsWith("/vision/");
}

/** Is the desk drawn right now — a desk page on a wide screen in landscape? On the client only. */
export function deskNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(DESK_QUERY).matches && !!document.querySelector(".app[data-desk]");
}
