"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "./AppProvider";
import BottomNav from "./BottomNav";
import { OperatorSectionProvider } from "./OperatorSection";
import { TaskSheetProvider } from "./TaskSheet";
import { RecordProvider } from "./RecordSheet";
import { ConfirmProvider } from "./ConfirmSheet";
import { PromptProvider } from "./PromptSheet";
import CartBar from "./CartBar";
import OrderStatus from "./OrderStatus";
import DrinkSheet from "./DrinkSheet";
import Toast from "./Toast";
import Notifications from "./Notifications";
import ServiceWorkerRegister from "./ServiceWorkerRegister";
import DisplayToggle, { readDisplay, displayClass, DISPLAY_KEY } from "./DisplayToggle";
import EditModeToggle from "./EditModeToggle";
import ConnectHub from "./ConnectHub";
import FloatRail from "./FloatRail";
import ErrorReporter from "./ErrorReporter";
import MarketingSplash from "./MarketingSplash";
import BroadcastBanner from "./BroadcastBanner";
import { surfaceOf, showsCommerce } from "@/lib/surfaces";
import { holdFocusZoom } from "@/lib/ios";
import dynamic from "next/dynamic";

// CODE-SPLIT WHAT A GUEST NEVER SEES (2026-10-02). Measured on the built /menu at phone width: the
// staff console's dock, copilot and command palette — and the concierge chat with its dictation
// hook — rode in the shared bundle of every public page, because this file imported them
// statically and rendered them behind `inAdmin &&`. A condition in JSX does not keep code out of
// a chunk; only a lazy import does. These load when they are first rendered, with SSR intact, so
// the markup is the same and nothing flashes. scripts/smoke.ui.mjs holds the weight of every
// public route to a ceiling so the next static import of a staff feature fails there, by name.
const OperatorNav = dynamic(() => import("./OperatorNav"));
const QuickDock = dynamic(() => import("./QuickDock"));
const EventCopilot = dynamic(() => import("./EventCopilot"));
const CommandPalette = dynamic(() => import("./CommandPalette"));
const SwipeBack = dynamic(() => import("./SwipeBack"));
const PullToRefresh = dynamic(() => import("./PullToRefresh"));
// CHECKOUT, WHEN THERE IS SOMETHING TO CHECK OUT (2026-10-04). It rode in every route's first load
// — the pay sheet, its card form, its receipt, and a fetch of /api/menu on mount — for every guest
// reading the privacy policy or finding the truck, most of whom never open it. It mounts once the
// cart has a drink in it (so its code is warm long before the cart bar is tapped) or the moment
// something opens it, and then stays mounted: its confirmation outlives the cart it clears.
const Checkout = dynamic(() => import("./Checkout"));
const ScrollRestore = dynamic(() => import("./ScrollRestore"));
const OfflineChip = dynamic(() => import("./OfflineChip"));
const Concierge = dynamic(() => import("./Concierge"));

// Routes whose page already renders its own visible <h1> — don't add a second one.
// "/crew" joined this list 2026-07-29: the console's op-head-t now renders as a real per-section
// <h1> (was a plain div — 17 sections, 1 static sr-only h1 that never reflected which one you were
// in). Without this skip, that would stack a second, stale "Crew console" h1 behind it on every screen.
// Routes that render their own real <h1>. Anything NOT in here gets a screen-reader-only one
// injected below — and four routes were getting BOTH: "/", /playbook, /privacy and /terms each
// have a visible heading of their own plus the injected one, so assistive tech announced two
// page titles. Found by counting headings across every route, not by reading one of them.
const H1_SKIP = new Set(["/", "/truck", "/craft", "/office", "/display", "/events", "/academy", "/crew", "/primal", "/shop", "/playbook", "/privacy", "/terms"]);
const H1_TITLES: Record<string, string> = {
  menu: "Menu", events: "Events", reserve: "Reserve a pack", book: "Book the bar",
  delivery: "Delivery", scan: "Scan your card", playbook: "Playbook", academy: "Academy",
  architecture: "Architecture", "3mpire": "Your member profile", crew: "Crew console", driver: "Driver run",
};
const routeTitle = (p: string): string => (p === "/" ? "GT3 Performance Bar" : H1_TITLES[p.split("/")[1] || ""] || "GT3 Performance Bar");

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bodyRef = useRef<HTMLElement>(null);
  const { closeDrink, cartCount, coOpen } = useApp();
  // Latched during render (React's "adjust state when an input changes"), not in an effect: once
  // wanted it stays mounted, and an effect would paint one frame without it after the first add.
  const [checkoutWanted, setCheckoutWanted] = useState(false);
  if (!checkoutWanted && (cartCount > 0 || coOpen)) setCheckoutWanted(true);

  // Mirror the prototype go(): scroll to top + close any open sheet on navigation.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    closeDrink();
  }, [pathname, closeDrink]);

  // NO ZOOM ON A TAPPED FIELD (2026-10-06): an iPhone zoomed into every form's 15px fields and stayed
  // zoomed, cutting the screen off on the right. lib/ios says why and how; this applies it on every
  // screen, again after each navigation in case the head is rewritten. Anywhere but an iPhone it is a
  // no-op.
  useEffect(() => { holdFocusZoom(); }, [pathname]);

  // Mobile keyboard: iOS Safari/standalone PWA doesn't shrink the layout viewport when the soft
  // keyboard opens, so bottom-anchored sheets sit behind it (the Plan-a-batch batch-size input was
  // hidden). Track the keyboard inset via visualViewport into --kb (sheets read it in CSS to stay
  // above the keyboard), and nudge a focused input into view once the keyboard has animated.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb", `${kb}px`);
      // Keyboard up on iOS: Safari pans the page so its input-accessory bar lands exactly where
      // the bottom nav sits — tabs + float rail ghosting through the OS chrome (Ryan's 2026-07-30
      // booking-form screenshots: "overlapping CSS"). Hide both while typing; neither is tappable
      // under the keyboard anyway. CSS uses visibility so the flex layout doesn't reflow mid-pan.
      root.classList.toggle("kb-open", kb > 60);
    };
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
  // Which kind of page this is decides the chrome — one rule, in lib/surfaces (2026-10-04: the cart
  // bar and the concierge used to disagree about whether the Academy was a shop).
  const surface = surfaceOf(pathname);
  const inAdmin = surface === "console";
  // Read-only partner "what we've built" share page — a bare surface: no nav, no concierge, no commerce.
  const isShare = surface === "share";
  // Commerce chrome (cart bar, order status, concierge, splash) on the pages people order from only.
  const customerSurface = showsCommerce(surface);

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
     {/* "Are you sure?" and "say why" from anywhere — the two sheets that replace window.confirm()
         and window.prompt(). OUTERMOST on purpose: TaskSheetProvider and RecordProvider render their
         sheets as siblings after {children}, so a provider nested inside them would be invisible to
         exactly the sheets that ask the most (delete a task, archive an event). Stacking is not a
         concern of nesting — every Sheet portals into .app, and the one that mounts last paints on
         top, which is always the question being asked. */}
     <ConfirmProvider>
     <PromptProvider>
     <TaskSheetProvider>
      {/* Records open from anywhere (?r=kind:id). Inside TaskSheetProvider so a task sheet can open
          the person it is assigned to, and so both live above every screen that prints a name. */}
      <RecordProvider>
      <div className={`app${inAdmin && theme === "day" ? " crew-day" : ""}${disp ? ` ${disp}` : ""}`}>
        {/* Skip link — first focusable element; keyboard users jump past the chrome to the content. */}
        <a href="#body" className="skip-link">Skip to content</a>
        {/* Live broadcast bar — an operator-published message/ad, shown to every user in real time. */}
        {!isShare && <BroadcastBanner />}
        {/* The one <main> landmark (a11y: landmark-one-main / region). A per-route sr-only <h1> gives
            every screen a level-one heading; pages that render their own visible h1 are skipped. */}
        {/* tabIndex 0, not -1 (2026-10-02): .body is the scroll container, so a keyboard user has
            to be able to focus it to scroll it. On a page with no focusable content inside — the
            privacy policy — -1 left them with no way to read past the first screen, which axe
            reports as scrollable-region-focusable the moment that route was scanned. The skip
            link still lands here. */}
        <main className="body" ref={bodyRef} id="body" tabIndex={0}>
          {!isShare && !H1_SKIP.has(pathname) && !pathname.startsWith("/primal/") && <h1 className="sr-only">{routeTitle(pathname)}</h1>}
          {children}
        </main>
        <DrinkSheet />
        {checkoutWanted && <Checkout />}
        <Toast />
        <Notifications />
        {customerSurface ? <OrderStatus /> : null}
        {customerSurface ? <CartBar /> : null}
        {isShare ? null : inAdmin ? <OperatorNav /> : <BottomNav />}
        {/* THE FLOATING TIER SITS ON THE CHROME, NOT ON A NUMBER (2026-10-04).
            The theme toggle, the quick-actions button, the offline chip and the update prompt were
            each position:fixed at a guess — `calc(var(--navh, 68px) + 16px)` — and --navh was never
            set anywhere. The crew nav is 87px tall before an iPhone adds its home-indicator inset
            (121px with it), and the docked rail can sit under or over it, so the guess put the moon
            on the Today tab and the sparkles on More — Ryan's Live Ops screenshot, measured
            2026-10-04: 1,242–2,646 px² of each tab covered in three of four phone states.
            Now they ride a zero-height row of the app column, ordered after the page and before
            the rail and the nav (app/globals.css .fab-dock), and float 16px above whatever chrome
            is there — nav, inset, docked rail — because the column knows how tall it is. */}
        <div className="fab-dock">
          {inAdmin && <QuickDock />}
          {inAdmin && <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={theme === "day" ? "Switch to dark" : "Switch to day"}>{theme === "day" ? "🌙" : "☀️"}</button>}
          {inAdmin && <OfflineChip />}
          <ServiceWorkerRegister />
        </div>
        {inAdmin && <EventCopilot />}
        {inAdmin && <CommandPalette />}
        {inAdmin && <SwipeBack />}
        {inAdmin && <PullToRefresh />}
        {inAdmin && <ScrollRestore />}
        {/* Every floating tab lives on ONE movable, collapsible right-edge rail. */}
        {!isShare && (
          <FloatRail>
            <DisplayToggle />
            <EditModeToggle />
            <ConnectHub />
            {customerSurface && <Concierge />}
          </FloatRail>
        )}
        {customerSurface && <MarketingSplash />}
        <ErrorReporter />
      </div>
      </RecordProvider>
     </TaskSheetProvider>
     </PromptProvider>
     </ConfirmProvider>
    </OperatorSectionProvider>
  );
}
