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
  "/academy", "/architecture", "/driver", "/scan", "/playbook", "/agreement", "/offer", "/display",
] as const;

export function surfaceOf(pathname: string | null | undefined): Surface {
  const p = pathname || "/";
  if (p.startsWith("/crew")) return "console";
  if (p.startsWith("/built")) return "share";
  if (WORK_ROUTES.some((r) => p === r || p.startsWith(`${r}/`))) return "work";
  return "customer";
}

/** The drinks cart bar, a live order's status, the guest concierge and the marketing splash. */
export const showsCommerce = (s: Surface): boolean => s === "customer";
