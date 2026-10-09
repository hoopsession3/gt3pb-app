"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { useSiteCopy } from "@/lib/copy";
import { returnToPlace, scrollToTop } from "@/lib/appScroll";
import { haptic } from "@/lib/haptics";

// The nav tells the truth about who you are. Members: Today first — their home. Guests: the truck
// IS home (first tab), and the last slot is the door ("Join") instead of a Today tab that would
// only bounce them. Four slots either way, no dead tabs. Shop is the take-home store — bottle-pack
// reserve + merch capsule under one roof; it took the slot the standalone Reserve tab used to hold
// (that pack flow now lives inside Shop's "Bottles" aisle; /reserve stays live for existing links).
//
// ── THE NAV THAT MOVED UNDER YOUR THUMB (2026-10-02) ───────────────────────────────────────────
// Measured on production at 390px: on every public route, for every guest, the three shared tabs
// slid one slot to the left a quarter second after paint (layout shift 0.0087, the only shift on
// 19 of 23 routes). The server cannot know who is reading, so it rendered the member shape — Today
// first — and once the session resolved to "nobody" React re-rendered the guest shape. A tab you
// were about to tap was a different tab by the time you did.
//
// Now BOTH identity tabs are always in the DOM and CSS decides which one shows, from one attribute
// on <html>: data-viewer="guest" hides Today, anything else hides Join. app/layout.tsx sets that
// attribute in an inline script BEFORE first paint, from the one thing the browser already knows —
// whether a Supabase session is stored — so the first paint is already the right shape, and the
// effect below only corrects the hint once the session has actually been read (a stored session
// that turned out to be expired is the one case that still moves, once). No row of tabs is ever
// re-ordered by React. The three parts are this file, the script in app/layout.tsx and the two
// `html[data-viewer]` rules in globals.css; scripts/smoke.ui.mjs plants and clears the stored
// session and checks the shape at first paint both ways.
const TODAY = {
  href: "/", key: "today", label: "Today", for: "member",
  icon: <><path d="M12 3l9 7v11H3V10z" /><path d="M9 21v-7h6v7" /></>,
};
const CORE = [
  // Truck + Events collapsed into ONE road (field_ops) — /events renders the same surface,
  // so both old tab destinations stay live for links in the wild.
  { href: "/truck", key: "find", label: "Find Us", for: "all",
    icon: <><path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" /><circle cx="7" cy="17" r="1.6" /><circle cx="18" cy="17" r="1.6" /></> },
  { href: "/menu", key: "menu", label: "Menu", for: "all",
    icon: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" /></> },
  { href: "/shop", key: "shop", label: "Shop", for: "all",
    icon: <><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.5" /></> },
];
const JOIN = {
  href: "/3mpire", key: "join", label: "Join", for: "guest",
  icon: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4" /></>,
};
const TABS = [TODAY, ...CORE, JOIN];

export default function BottomNav() {
  const pathname = usePathname();
  const { ready, enabled, user } = useAuth();
  const t = useSiteCopy();
  // The hint on <html> was set before paint from storage; this is the session's own answer, applied
  // once it exists. Same value in the common case — a no-op. Without Supabase (a build with no
  // database) nobody is a guest, exactly as before.
  useEffect(() => {
    if (!enabled || !ready) return;
    document.documentElement.dataset.viewer = user ? "member" : "guest";
  }, [enabled, ready, user]);
  return (
    <nav className="nav" aria-label="Primary">
      {TABS.map((tab) => {
        const on = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          // The tab for the screen you are on, tapped again, goes back to its top (lib/appScroll). Another
          // tab is a choice changed: the selection tick (2026-10-05, the haptics round), and that tab opens
          // where it was left (2026-10-08, EACH TAB KEEPS ITS PLACE).
          <Link key={tab.key} href={tab.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined} data-for={tab.for}
            onClick={(e) => { if (pathname === tab.href) { e.preventDefault(); scrollToTop(); return; } returnToPlace(); if (!on) haptic("selection"); }}>
            <span className="ti">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                {tab.icon}
              </svg>
            </span>
            {/* Labels inside a <Link> → plain t(), keyed by the tab's stable key (nav.today/find/…). */}
            <span className="tl leading-none">{t(`nav.${tab.key}`)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
