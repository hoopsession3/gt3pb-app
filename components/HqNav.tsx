"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import BottomNav from "./BottomNav";
import Gt3Mark from "./Gt3Mark";
import { staffAccess } from "@/lib/access";
import { navOf } from "@/lib/surfaces";
import { haptic } from "@/lib/haptics";
import { scrollToTop } from "@/lib/appScroll";

// THE HQ BAR (IMS7, 2026-10-31). The vision — the roadmap, the plans, the store, the Standard, the library — is the crew's
// planning headquarters, and it sat on the customer bar (Today · Find us · Menu · Shop · Join), so the crew planning a
// location were offered the cart's way out and a guest's tabs. The crew now get the HQ bar: back to the console, and
// where they are. Anyone else keeps the customer bar — a guest or a member who lands on /vision can still leave the way
// they came — and, while who they are is still loading, the customer bar too, so nobody outside the crew is ever shown an
// HQ link. The bar is not the boundary: the page refuses anyone outside the crew (staffAccess) and the database their
// reads. Same shape and chrome as the console's bar (nav.nav.opnav: gold on the crew's dark, a sidebar on the desk).
const TABS = [
  { href: "/crew", key: "console", label: "Console",
    icon: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></> },
  { href: "/vision", key: "vision", label: "The vision",
    icon: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></> },
] as const;

/** Is this the vision (lib/surfaces navOf)? Asked here, not in OperatorNav, which never reads the route itself (smoke.cjs). */
export const useHqBar = () => navOf(usePathname()) === "hq";

export default function HqNav() {
  const pathname = usePathname() || "/";
  const { user, profile, profileStatus, enabled } = useAuth();
  // Each of lib/access's verdicts, named: only "allow" is the crew. "wait" (the profile not known yet) and "failed" (it
  // couldn't be read) aren't denials — and a bar refuses nobody: they keep the customer bar until the crew is known, while
  // the page itself says it's checking, or that it couldn't (app/vision). "deny" and "anon" keep it too.
  const access = enabled ? staffAccess(!!user, profileStatus, profile) : "anon";
  switch (access) {
    case "allow": break;
    case "wait": case "failed": case "deny": case "anon": return <BottomNav />;
  }
  return (
    <nav className="nav opnav desk-sidebar" aria-label="GT3 HQ">
      <div className="hidden desk:flex items-center gap-2.5 min-h-11 px-3 mb-4" aria-hidden="true">
        <Gt3Mark tone="cream" className="font-display text-title3 tracking-[.3px] text-cream" />
        <span className="font-sans font-semibold text-caption tracking-eyebrow uppercase text-cream-muted">GT3 HQ</span>
      </div>
      {TABS.map((tab) => {
        const on = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.key} href={tab.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}
            onClick={(e) => { if (on && pathname === tab.href) { e.preventDefault(); scrollToTop(); return; } haptic("selection"); }}>
            <span className="ti flex h-[26px] items-start justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{tab.icon}</svg>
            </span>
            <span className="tl min-h-[11px] whitespace-nowrap leading-none">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
