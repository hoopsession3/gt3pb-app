"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useSiteCopy } from "@/lib/copy";

// The nav tells the truth about who you are. Members: Today first — their home. Guests: the truck
// IS home (first tab), and the last slot is the door ("Join") instead of a Today tab that would
// only bounce them. Four slots either way, no dead tabs. Shop is the take-home store — bottle-pack
// reserve + merch capsule under one roof; it took the slot the standalone Reserve tab used to hold
// (that pack flow now lives inside Shop's "Bottles" aisle; /reserve stays live for existing links).
const TODAY = {
  href: "/", key: "today", label: "Today",
  icon: <><path d="M12 3l9 7v11H3V10z" /><path d="M9 21v-7h6v7" /></>,
};
const CORE = [
  // Truck + Events collapsed into ONE road (field_ops) — /events renders the same surface,
  // so both old tab destinations stay live for links in the wild.
  { href: "/truck", key: "find", label: "Find Us",
    icon: <><path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" /><circle cx="7" cy="17" r="1.6" /><circle cx="18" cy="17" r="1.6" /></> },
  { href: "/menu", key: "menu", label: "Menu",
    icon: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" /></> },
  { href: "/shop", key: "shop", label: "Shop",
    icon: <><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.5" /></> },
];
const JOIN = {
  href: "/3mpire", key: "join", label: "Join",
  icon: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4" /></>,
};

export default function BottomNav() {
  const pathname = usePathname();
  const { ready, enabled, user } = useAuth();
  const t = useSiteCopy();
  const guest = enabled && ready && !user;
  const tabs = guest ? [...CORE, JOIN] : [TODAY, ...CORE];
  return (
    <nav className="nav" aria-label="Primary">
      {tabs.map((tab) => {
        const on = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link key={tab.key} href={tab.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
            <span className="ti">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                {tab.icon}
              </svg>
            </span>
            {/* Labels inside a <Link> → plain t(), keyed by the tab's stable key (nav.today/find/…). */}
            <span className="tl">{t(`nav.${tab.key}`)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
