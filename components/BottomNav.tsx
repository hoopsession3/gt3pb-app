"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", key: "today", label: "Today",
    icon: <><path d="M12 3l9 7v11H3V10z" /><path d="M9 21v-7h6v7" /></> },
  { href: "/truck", key: "truck", label: "Truck",
    icon: <><path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" /><circle cx="7" cy="17" r="1.6" /><circle cx="18" cy="17" r="1.6" /></> },
  { href: "/menu", key: "menu", label: "Menu",
    icon: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" /></> },
  { href: "/events", key: "events", label: "Events",
    icon: <><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></> },
  { href: "/reserve", key: "reserve", label: "Reserve",
    icon: <><path d="M4 5h16v14H4z" /><path d="M4 9h16M9 3v4M15 3v4" /><circle cx="9" cy="14" r="1.4" /><circle cx="13" cy="14" r="1.4" /></> },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <div className="nav">
      {TABS.map((t) => {
        const on = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link key={t.key} href={t.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
            <span className="ti">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                {t.icon}
              </svg>
            </span>
            <span className="tl">{t.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
