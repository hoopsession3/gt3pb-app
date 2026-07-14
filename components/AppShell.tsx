"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "./AppProvider";
import BottomNav from "./BottomNav";
import OperatorNav, { OperatorSectionProvider } from "./OperatorNav";
import { TaskSheetProvider } from "./TaskSheet";
import QuickDock from "./QuickDock";
import EventCopilot from "./EventCopilot";
import Concierge from "./Concierge";
import CartBar from "./CartBar";
import OrderStatus from "./OrderStatus";
import DrinkSheet from "./DrinkSheet";
import Checkout from "./Checkout";
import Toast from "./Toast";
import Notifications from "./Notifications";
import ServiceWorkerRegister from "./ServiceWorkerRegister";
import DisplayToggle, { readDisplay, displayClass, DISPLAY_KEY } from "./DisplayToggle";
import ConnectHub from "./ConnectHub";
import CommandPalette from "./CommandPalette";
import FloatRail from "./FloatRail";
import SwipeBack from "./SwipeBack";
import ScrollRestore from "./ScrollRestore";
import ErrorReporter from "./ErrorReporter";
import OfflineChip from "./OfflineChip";
import MarketingSplash from "./MarketingSplash";
import BroadcastBanner from "./BroadcastBanner";

// Routes whose page already renders its own visible <h1> — don't add a second one.
const H1_SKIP = new Set(["/truck", "/craft", "/office", "/display"]);
const H1_TITLES: Record<string, string> = {
  menu: "Menu", events: "Events", reserve: "Reserve a pack", book: "Book the truck",
  delivery: "Delivery", scan: "Scan your card", playbook: "Playbook", academy: "Academy",
  architecture: "Architecture", "3mpire": "Your member profile", crew: "Crew console", driver: "Driver run",
};
const routeTitle = (p: string): string => (p === "/" ? "GT3 Performance Bar" : H1_TITLES[p.split("/")[1] || ""] || "GT3 Performance Bar");

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bodyRef = useRef<HTMLElement>(null);
  const { closeDrink } = useApp();

  // Mirror the prototype go(): scroll to top + close any open sheet on navigation.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    closeDrink();
  }, [pathname, closeDrink]);

  // Mobile keyboard: iOS Safari/standalone PWA doesn't shrink the layout viewport when the soft
  // keyboard opens, so bottom-anchored sheets sit behind it (the Plan-a-batch batch-size input was
  // hidden). Track the keyboard inset via visualViewport into --kb (sheets read it in CSS to stay
  // above the keyboard), and nudge a focused input into view once the keyboard has animated.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--kb", `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      // .sheet2 = the canonical <Sheet> every popout renders; .qd-sheet = the documented
      // password-gate exception (see the popout scroll contract). The five legacy sheet
      // classes this used to list no longer exist in the DOM.
      if (el && el.matches?.("input, textarea, select") && el.closest(".sheet2, .qd-sheet")) {
        setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 280);
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); document.removeEventListener("focusin", onFocusIn); };
  }, []);

  // Employee Mode: inside /crew the customer 5-tab nav is replaced by the
  // role-scoped operator console nav (OperatorNav falls back to the customer nav
  // for non-staff so they can still navigate away).
  const inAdmin = pathname.startsWith("/crew");
  // Read-only partner "what we've built" share page — a bare surface: no nav, no concierge, no commerce.
  const isShare = pathname.startsWith("/built");
  // Guest concierge shows on the customer-facing surfaces only (not the crew console, architecture, academy, or a share page).
  const customerSurface = !inAdmin && !isShare && !pathname.startsWith("/architecture") && !pathname.startsWith("/academy");

  // Day mode: the crew console defaults to a light theme for daylight/outdoor use. Persisted;
  // toggle back to dark anytime. Customer-facing pages are unaffected.
  const [theme, setTheme] = useState<"day" | "dark">("day");
  useEffect(() => { const t = typeof window !== "undefined" ? localStorage.getItem("gt3-theme") : null; if (t === "dark" || t === "day") setTheme(t); }, []);
  const toggleTheme = () => { const t = theme === "day" ? "dark" : "day"; setTheme(t); if (typeof window !== "undefined") localStorage.setItem("gt3-theme", t); };

  // Readability prefs (text size / bold / spacing) — applied app-wide as classes on `.app`,
  // re-read live whenever the DisplayToggle writes them. Initialized on first client render.
  const [disp, setDisp] = useState("");
  useEffect(() => {
    const apply = () => setDisp(displayClass(readDisplay()));
    apply();
    window.addEventListener(DISPLAY_KEY, apply);
    window.addEventListener("storage", apply); // cross-tab
    return () => { window.removeEventListener(DISPLAY_KEY, apply); window.removeEventListener("storage", apply); };
  }, []);

  return (
    <OperatorSectionProvider>
     <TaskSheetProvider>
      <div className={`app${inAdmin && theme === "day" ? " crew-day" : ""}${disp ? ` ${disp}` : ""}`}>
        {/* Skip link — first focusable element; keyboard users jump past the chrome to the content. */}
        <a href="#body" className="skip-link">Skip to content</a>
        {/* Live broadcast bar — an operator-published message/ad, shown to every user in real time. */}
        {!isShare && <BroadcastBanner />}
        {/* The one <main> landmark (a11y: landmark-one-main / region). A per-route sr-only <h1> gives
            every screen a level-one heading; pages that render their own visible h1 are skipped. */}
        <main className="body" ref={bodyRef} id="body" tabIndex={-1}>
          {!isShare && !H1_SKIP.has(pathname) && <h1 className="sr-only">{routeTitle(pathname)}</h1>}
          {children}
        </main>
        <DrinkSheet />
        <Checkout />
        <Toast />
        <Notifications />
        {inAdmin || isShare ? null : <OrderStatus />}
        {inAdmin || isShare ? null : <CartBar />}
        {isShare ? null : inAdmin ? <OperatorNav /> : <BottomNav />}
        {inAdmin && <QuickDock />}
        {inAdmin && <EventCopilot />}
        {inAdmin && <CommandPalette />}
        {inAdmin && <SwipeBack />}
        {inAdmin && <ScrollRestore />}
        {inAdmin && <OfflineChip />}
        {inAdmin && <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={theme === "day" ? "Switch to dark" : "Switch to day"}>{theme === "day" ? "🌙" : "☀️"}</button>}
        {/* Every floating tab lives on ONE movable, collapsible right-edge rail. */}
        {!isShare && (
          <FloatRail>
            <DisplayToggle />
            <ConnectHub />
            {customerSurface && <Concierge />}
          </FloatRail>
        )}
        {customerSurface && <MarketingSplash />}
        <ErrorReporter />
        <ServiceWorkerRegister />
      </div>
     </TaskSheetProvider>
    </OperatorSectionProvider>
  );
}
