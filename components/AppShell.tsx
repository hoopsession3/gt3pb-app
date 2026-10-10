"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { keepPlace, placeFor, restorePlace, returnToPlace } from "@/lib/appScroll";
import { HELP_EVENTS, type Asked, type HelpEvent } from "@/lib/helpSheets";
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
import FreshTab from "./FreshTab";
import DisplayToggle, { useDisplay, displayClass } from "./DisplayToggle";
import { useTheme } from "@/lib/theme";
import EditModeToggle from "./EditModeToggle";
import ConnectHub from "./ConnectHub";
import FloatRail from "./FloatRail";
import ErrorReporter from "./ErrorReporter";
import MarketingSplash from "./MarketingSplash";
import BroadcastBanner from "./BroadcastBanner";
import TitleBar from "./TitleBar";
import { isNativeApp } from "@/lib/native";
import { surfaceOf, showsCommerce, deskRoute } from "@/lib/surfaces";
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
// Ask us, Connect and Display as sheets — loaded by the first ask, never with the page (lib/helpSheets).
const HelpSheets = dynamic(() => import("./HelpSheets"), { ssr: false });
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
// THE IPHONE APP'S SIDE OF THE PAGE (2026-10-06): the launch screen, the status bar, links out,
// haptics, the keyboard, the session across the background — components/NativeBridge, with its own
// stylesheet. In the app build only. The test is lib/native's APP_BUILD spelled out here on purpose:
// the bundler drops a lazy import only when the condition that guards it is decided in the same file,
// and with the imported constant the web build still emitted NativeBridge and the Capacitor plugins as
// chunks (never loaded, but there) — measured, not assumed. scripts/smoke.cjs holds the two spellings
// to the same words.
const NativeBridge = process.env.NEXT_PUBLIC_GT3_TARGET === "app" ? dynamic(() => import("./NativeBridge"), { ssr: false }) : null;

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

// No browser around the page — the iPhone app, or a PWA opened from the home screen — so nothing answers a
// swipe from the left edge but the app itself (components/SwipeBack). Asked on the client only; the server
// and the first paint say no, and nothing on screen depends on it.
const noSubscribe = () => () => {};
const noBrowser = (): boolean => isNativeApp() || window.matchMedia?.("(display-mode: standalone)").matches === true
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const onServer = () => false;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bodyRef = useRef<HTMLElement>(null);
  const appOnly = useSyncExternalStore(noSubscribe, noBrowser, onServer);
  const { closeDrink, cartCount, coOpen } = useApp();
  // Latched during render (React's "adjust state when an input changes"), not in an effect: once
  // wanted it stays mounted, and an effect would paint one frame without it after the first add.
  const [checkoutWanted, setCheckoutWanted] = useState(false);
  if (!checkoutWanted && (cartCount > 0 || coOpen)) setCheckoutWanted(true);

  // A new screen opens at its top — unless the move was a tab bar tap or a step back through history,
  // which come back to where that screen was left (lib/appScroll, EACH TAB KEEPS ITS PLACE). The key is
  // switched in a layout effect, before the browser reports the scroll the new content causes, so a long
  // page's place is never overwritten by the short page that replaced it.
  const placeKey = useRef(pathname);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onScroll = () => keepPlace(placeKey.current, body.scrollTop);
    // A step through history to another screen; a crew section's step (same path) is ScrollRestore's.
    const onPop = () => { if (window.location.pathname !== placeKey.current) returnToPlace(); };
    body.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => { body.removeEventListener("scroll", onScroll); window.removeEventListener("popstate", onPop); };
  }, []);
  useLayoutEffect(() => {
    placeKey.current = pathname;
    const body = bodyRef.current;
    if (!body) return;
    return restorePlace(body, placeFor(pathname));
  }, [pathname]);
  // Close any open drink sheet on navigation (the prototype's go()).
  useEffect(() => { closeDrink(); }, [pathname, closeDrink]);

  // The menus' sheets, asked for by an event (lib/helpSheets); the first ask loads them.
  const [asked, setAsked] = useState<Asked | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => setAsked((a) => ({ which: e.type as HelpEvent, n: (a?.n ?? 0) + 1 }));
    for (const t of HELP_EVENTS) window.addEventListener(t, onAsk);
    return () => { for (const t of HELP_EVENTS) window.removeEventListener(t, onAsk); };
  }, []);

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
  // THE DESK (lib/surfaces, 2026-10-09): the console and /office leave the frame on a wide screen in landscape —
  // app/tailwind.css (desk-shell) decides when, from this attribute and the width; the markup is the same at every width.
  const desk = deskRoute(pathname);

  // Day mode: the crew console defaults to a light theme for daylight/outdoor use. Persisted.
  // Customer-facing pages are unaffected.
  // ONE HOME (2026-10-06, the settings round): the read and the write live in lib/theme, and the one
  // place to change it is Settings › You › Appearance — Day, Dark, or Auto, which follows the phone.
  // The floating moon that toggled it went with Auto (lib/theme says why).
  const theme = useTheme();

  // Readability prefs (text size / bold / spacing) — applied app-wide as classes on `.app`, redrawn
  // whenever the rail's panel or Settings › You writes them (and from another tab).
  const disp = displayClass(useDisplay());

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
      {/* data-surface says which kind of page this is (lib/surfaces): the console's primary button is gold. */}
      {/* "app desk-shell" is a string of its own so Tailwind's scanner reads desk-shell as a class (inside a template,
          run into ${…}, it was not one, and the shell's utility never built). */}
      <div className={"app desk-shell" + (inAdmin && theme === "day" ? " crew-day" : "") + (disp ? ` ${disp}` : "")} data-surface={surface} data-desk={desk ? "" : undefined}>
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
        {/* THE PAGE STEPS BACK behind a tall sheet, on a phone (lib/sheetStage, 2026-10-08): page-stage (app/tailwind.css). */}
        <main className="body page-stage" ref={bodyRef} id="body" tabIndex={0}>
          {/* The title bar: the screen's name once its own title has scrolled away, and Back in one place. */}
          {!isShare && <TitleBar />}
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
            is there — nav, inset, docked rail — because the column knows how tall it is.
            ONE FLOATING BUTTON (2026-10-06, the settings round): the moon left the dock — day, dark
            and Auto are chosen in Settings › You › Appearance — so quick actions is the console's one. */}
        <div className="fab-dock">
          {inAdmin && <QuickDock />}
          {inAdmin && <OfflineChip />}
          <ServiceWorkerRegister />
        </div>
        {/* An open tab that comes back after a release reloads into it (components/FreshTab). */}
        <FreshTab />
        {inAdmin && <EventCopilot />}
        {inAdmin && <CommandPalette />}
        {/* The edge swipe back: the console's always; elsewhere where no browser gives one (the app, a home-screen PWA). */}
        {!isShare && (inAdmin || appOnly) && <SwipeBack />}
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
        {/* Ask us, Connect and Display as sheets, opened from the header and the menus (on a phone the rail is gone). */}
        {asked && !isShare && <HelpSheets asked={asked} />}
        {customerSurface && <MarketingSplash />}
        <ErrorReporter />
        {NativeBridge && <NativeBridge />}
      </div>
      </RecordProvider>
     </TaskSheetProvider>
     </PromptProvider>
     </ConfirmProvider>
    </OperatorSectionProvider>
  );
}
