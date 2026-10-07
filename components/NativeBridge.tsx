"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { isNativeApp, lessonHref, nativePlatform, WEB_ORIGIN } from "@/lib/native";
import { setNativeHaptics, type UIKitStep } from "@/lib/haptics";
import { saveFromUrl, setNativeDevice, type GT3DevicePlugin } from "@/lib/deviceActions";
import { scrollToTop } from "@/lib/appScroll";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import "./NativeBridge.css";

// THE IPHONE APP'S SIDE OF THE PAGE (2026-10-06, the iPhone round). Mounted by AppShell in the app
// build only (AppShell guards it in lib/native APP_BUILD's own words), so none of this — nor any
// Capacitor plugin, nor its stylesheet (./NativeBridge.css) — is in the web build. It does nothing in a
// plain browser (a test run of the app build): every step below asks isNativeApp() first. What it
// does, once, when the app starts:
//
//   · THE LAUNCH SCREEN goes when the page has drawn (or at 3s if it never does: capacitor.config.ts),
//     so the brand screen hands straight to the app with no blank frame between.
//   · THE STATUS BAR follows the page under it: light text over the app's charcoal, dark text over a
//     light screen (the menu, the shop, the crew's Day look) — read from what is painted at the top of
//     the screen after every move between screens and every change of look, never from a list. Its own
//     ground (.native-bar, ./NativeBridge.css) is painted in that colour, so a screen's words scrolling
//     up pass under it rather than under the clock.
//   · THE KEYBOARD: the web view shrinks above it (capacitor.config.ts, resize "native"); while it is
//     up the tab bar leaves the layout (html[data-kb], ./NativeBridge.css) as a native tab bar does, and
//     once the view has shrunk the field being typed in is brought into sight.
//   · A TAP ON THE STATUS BAR goes to the top, as in every iPhone app — the app scrolls inside
//     <main id="body">, which the phone's own status-bar tap never reaches (lib/appScroll).
//   · LINKS OUT open in an in-app browser sheet (SFSafariViewController), not by leaving the app — and so
//     does a link to a page only the web serves; a maps, phone, mail or text link goes to the phone's
//     own app, as it always would.
//   · HAPTICS: every feel plays through the phone's haptic engine (lib/haptics UIKIT table).
//   · SAVE, SHARE, PRINT, ADD TO THE CALENDAR OR TO WALLET use the phone's own sheets (lib/deviceActions
//     says which, and why the web's ways do nothing here): the share sheet, and the app's own plugin,
//     GT3Device (native/ios/GT3Device.swift). A link that saves a file — <a download>, a post's photo —
//     hands the file to the share sheet.
//   · SIGNED IN STAYS SIGNED IN: Supabase refreshes the session on a timer, and a phone freezes
//     timers in the background, so the timer stops when the app goes away and starts when it comes
//     back — Supabase's own advice for apps.
//   · A GT3 LINK THAT OPENS THE APP (a Universal Link, once its domain file is live) lands on the same
//     screen in the app — a lesson on the app's own lesson page, a page only the web serves in the
//     in-app browser — and a sign-in link completes the sign-in here.

const MAPS = /^https:\/\/(maps\.apple\.com|maps\.google\.|www\.google\.[^/]+\/maps|goo\.gl\/maps)/;

// What ground is painted at the top of the screen? The topmost element there with a solid one says (a
// sheet's scrim, then the screen, then the shell): its background colour, or the colour a gradient
// starts from — the crew's Day look and the cream screens are gradients that fall from the top. The
// status bar's own ground (pointer-events:none) is not hit, so it never reads itself. A colour is read
// back through a 1px canvas, so whatever form the engine computes it in — rgb(), color(srgb …) — comes
// back as plain bytes.
const FIRST_COLOUR = /(rgba?\([^)]*\)|color\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|#[0-9a-f]{3,8}\b)/i;
const BLACK = { r: 0, g: 0, b: 0 };   // nothing solid: the page's own black (body)
let swatch: CanvasRenderingContext2D | null | undefined;
function groundAtTop(): { r: number; g: number; b: number } {
  if (swatch === undefined) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    swatch = c.getContext("2d", { willReadFrequently: true });
  }
  if (!swatch) return BLACK;
  const bytes = (colour: string) => {
    swatch!.clearRect(0, 0, 1, 1);
    swatch!.fillStyle = "rgba(0, 0, 0, 0)";
    swatch!.fillStyle = colour;
    swatch!.fillRect(0, 0, 1, 1);
    return swatch!.getImageData(0, 0, 1, 1).data;
  };
  for (const el of document.elementsFromPoint(window.innerWidth / 2, 4)) {
    const cs = getComputedStyle(el);
    let [r, g, b, a] = bytes(cs.backgroundColor);
    if (a < 128 && cs.backgroundImage.includes("gradient(")) {
      const first = cs.backgroundImage.match(FIRST_COLOUR)?.[1];
      if (first) [r, g, b, a] = bytes(first);
    }
    if (a < 128) continue;
    return { r, g, b };
  }
  return BLACK;
}
const isLight = ({ r, g, b }: { r: number; g: number; b: number }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;

const FIELD = "input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable=\"true\"]";

// Pages only the web serves — the ones the app's export leaves out (scripts/build.app.mjs LEAVE_OUT
// tells this list to the build): a partner's one-pager, a printed code's landing page, a lesson's web
// address. A link to one opens the web's page in the in-app browser, never the app's home screen.
const WEB_ONLY = (process.env.NEXT_PUBLIC_GT3_WEB_ONLY ?? "").split(",").filter(Boolean);

/** Where a link should open instead of inside the app, or null: the web, in the in-app browser. */
function opensOutside(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;             // tel:, mailto:, sms: — the phone's own apps
  if (MAPS.test(url)) return null;                          // Maps opens the Maps app
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.origin !== window.location.origin) return u.href;   // another site
  if (WEB_ONLY.some((p) => u.pathname.startsWith(p))) return `${WEB_ORIGIN}${u.pathname}${u.search}${u.hash}`;
  return null;
}

export default function NativeBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const { signInWithUrl } = useAuth();
  // Set once the plugins are in: looks again at what is under the status bar.
  const restyle = useRef<(() => void) | null>(null);
  // The status bar's own ground, drawn on a phone only. Known at once: this component is mounted in
  // the browser alone (AppShell loads it with ssr:false), after Capacitor's bridge was injected.
  const [onPhone] = useState(() => isNativeApp());

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    const undo: Array<() => void> = [];
    document.documentElement.dataset.native = nativePlatform();

    (async () => {
      const [{ SplashScreen }, { Browser }, { App }, { Haptics, ImpactStyle, NotificationType }, { Share }, { SystemBars, SystemBarsStyle, registerPlugin }] = await Promise.all([
        import("@capacitor/splash-screen"),
        import("@capacitor/browser"),
        import("@capacitor/app"),
        import("@capacitor/haptics"),
        import("@capacitor/share"),
        import("@capacitor/core"),
      ]);
      if (cancelled) return;

      // Haptics: one step of a feel at a time (lib/haptics owns the table).
      const IMPACT = { LIGHT: ImpactStyle.Light, MEDIUM: ImpactStyle.Medium, HEAVY: ImpactStyle.Heavy } as const;
      const NOTE = { SUCCESS: NotificationType.Success, WARNING: NotificationType.Warning, ERROR: NotificationType.Error } as const;
      setNativeHaptics((step: UIKitStep) => {
        if (step.kind === "impact") void Haptics.impact({ style: IMPACT[step.style] });
        else if (step.kind === "notification") void Haptics.notification({ type: NOTE[step.type] });
        else void Haptics.selectionStart().then(() => Haptics.selectionChanged()).then(() => Haptics.selectionEnd());
      });
      undo.push(() => setNativeHaptics(null));

      // Save, share, print, add to the calendar or to Wallet: the phone's own sheets (lib/deviceActions).
      const device = registerPlugin<GT3DevicePlugin>("GT3Device");
      setNativeDevice({
        keepFile: (o) => device.keepFile(o),
        printPage: (o) => device.printPage(o),
        addEvent: (o) => device.addEvent(o),
        addPass: (o) => device.addPass(o),
        share: (o) => Share.share(o),
      });
      undo.push(() => setNativeDevice(null));

      // The status bar's text follows the page under it: looked at once the new screen has painted,
      // and again when its entrance has settled.
      let lastLight: boolean | null = null;
      const root = document.documentElement;
      const followPage = () => {
        const ground = groundAtTop();
        root.style.setProperty("--native-bar", `rgb(${ground.r} ${ground.g} ${ground.b})`);
        const light = isLight(ground);
        if (light === lastLight) return;
        lastLight = light;
        void SystemBars.setStyle({ style: light ? SystemBarsStyle.Light : SystemBarsStyle.Dark });
      };
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const look = () => {
        requestAnimationFrame(() => requestAnimationFrame(followPage));
        clearTimeout(settleTimer);
        settleTimer = setTimeout(followPage, 400);
      };
      restyle.current = look;
      undo.push(() => { restyle.current = null; clearTimeout(settleTimer); });
      look();
      const mo = new MutationObserver(look);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      const shell = document.querySelector(".app");
      if (shell) mo.observe(shell, { attributes: true, attributeFilter: ["class"] });
      undo.push(() => mo.disconnect());

      // Once a screen has scrolled, the status bar's ground softens its lower edge (iOS's scroll edge).
      const body = document.getElementById("body");
      let scrolled = false;
      const onScroll = () => {
        const now = (body?.scrollTop ?? 0) > 2;
        if (now !== scrolled) { scrolled = now; root.toggleAttribute("data-scrolled", now); }
      };
      body?.addEventListener("scroll", onScroll, { passive: true });
      undo.push(() => { body?.removeEventListener("scroll", onScroll); root.removeAttribute("data-scrolled"); });

      // The keyboard. The plugin says it is coming, then shrinks the web view a moment later.
      const kbUp = () => { root.dataset.kb = "up"; };
      const kbDown = () => { delete root.dataset.kb; };
      const keepFieldInSight = () => {
        if (root.dataset.kb !== "up") return;
        const el = document.activeElement as HTMLElement | null;
        if (!el?.matches?.(FIELD)) return;
        const r = el.getBoundingClientRect();
        if (r.top < 72 || r.bottom > window.innerHeight - 12) el.scrollIntoView({ block: "center" });
      };
      window.addEventListener("keyboardWillShow", kbUp);
      window.addEventListener("keyboardWillHide", kbDown);
      window.addEventListener("resize", keepFieldInSight);
      undo.push(() => {
        window.removeEventListener("keyboardWillShow", kbUp);
        window.removeEventListener("keyboardWillHide", kbDown);
        window.removeEventListener("resize", keepFieldInSight);
        kbDown();
      });

      // A tap on the status bar: to the top. The status-bar plugin's native half fires statusTap on
      // window (it is installed for that alone; its script is never needed).
      const onStatusTap = () => scrollToTop();
      window.addEventListener("statusTap", onStatusTap);
      undo.push(() => window.removeEventListener("statusTap", onStatusTap));

      // Links out — and links to a page only the web serves: an in-app browser sheet. A link that saves a
      // file (<a download>: a post's photo) would go nowhere in a web view; its file goes to the share sheet.
      const onClick = (e: MouseEvent) => {
        if (e.defaultPrevented || e.button !== 0) return;
        const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        if (a.hasAttribute("download")) {
          if (!/^https:\/\//i.test(a.href)) return;
          e.preventDefault();
          void saveFromUrl(a.href, a.getAttribute("download") || undefined);
          return;
        }
        const to = opensOutside(a.href);
        if (!to) return;
        e.preventDefault();
        void Browser.open({ url: to });
      };
      document.addEventListener("click", onClick, true);
      undo.push(() => document.removeEventListener("click", onClick, true));
      const webOpen = window.open;
      window.open = ((url?: string | URL, target?: string, features?: string) => {
        const to = url ? opensOutside(new URL(String(url), window.location.href).href) : null;
        if (to) { void Browser.open({ url: to }); return null; }
        return webOpen.call(window, url, target, features);
      }) as typeof window.open;
      undo.push(() => { window.open = webOpen; });

      // Signed in stays signed in across the background.
      const life = await App.addListener("appStateChange", ({ isActive }) => {
        if (!supabase) return;
        if (isActive) void supabase.auth.startAutoRefresh();
        else void supabase.auth.stopAutoRefresh();
      });
      undo.push(() => { void life.remove(); });

      // A GT3 link that opened the app: the same screen here; a sign-in link signs in here.
      const opened = await App.addListener("appUrlOpen", ({ url }) => {
        let u: URL;
        try { u = new URL(url); } catch { return; }
        if (u.origin !== WEB_ORIGIN) return;
        if (/access_token=|refresh_token=|[?&]code=|type=recovery|type=signup|type=magiclink/.test(u.hash + u.search)) { void signInWithUrl(url); return; }
        const lesson = /^\/primal\/l\/([^/]+)\/?$/.exec(u.pathname);
        if (lesson) { router.push(lessonHref(decodeURIComponent(lesson[1]))); return; }
        if (WEB_ONLY.some((p) => u.pathname.startsWith(p))) { void Browser.open({ url: u.href }); return; }
        router.push(`${u.pathname}${u.search}`);
      });
      undo.push(() => { void opened.remove(); });

      // The page has drawn: let the launch screen go.
      requestAnimationFrame(() => requestAnimationFrame(() => { void SplashScreen.hide({ fadeOutDuration: 200 }); }));
    })().catch(() => { /* a missing plugin must never take the page down */ });

    return () => { cancelled = true; for (const u of undo.reverse()) u(); };
  }, [router, signInWithUrl]);

  // A new screen: look at what is under the status bar again.
  useEffect(() => { restyle.current?.(); }, [pathname]);

  // In <body>, outside the app's column, so nothing the column does to its own layers moves it.
  return onPhone ? createPortal(<div className="native-bar" aria-hidden="true" />, document.body) : null;
}
