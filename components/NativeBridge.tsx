"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { BROWSER_CLOSED_EVENT, isNativeApp, lessonHref, nativePlatform, WEB_ORIGIN } from "@/lib/native";
import { setNativeHaptics, type UIKitStep } from "@/lib/haptics";
import { saveFromUrl, setNativeDevice, type GT3DevicePlugin } from "@/lib/deviceActions";
import { opensOutside as linkOut } from "@/lib/nativeLinks";
import { appleCredentialState, appleSession, markAppleSession } from "@/lib/appleAuth";
import { NATIVE_PUSH_ON, alertTarget, keepAppDevice, setNativePush, type AppAlertState } from "@/lib/nativePush";
import { setAppBuild } from "@/lib/heartbeat";
import { isStaff } from "@/lib/roles";
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

/** Where a link should open instead of inside the app, or null (lib/nativeLinks): the web, in the in-app browser. */
const opensOutside = (url: string): string | null => linkOut(url, window.location, WEB_ONLY, WEB_ORIGIN);

export default function NativeBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const { signInWithUrl, user, ready, profile } = useAuth();
  // The device token Apple gave this phone for alerts (lib/nativePush), kept for whoever is signed in — below.
  const [pushToken, setPushToken] = useState<string | null>(null);
  // The phone's half is in (the GT3Device bridge is set, below): what asks the phone something waits for it.
  const [deviceReady, setDeviceReady] = useState(false);
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

      // THE KEYBOARD'S BAR (2026-10-08, the iPhone chrome round, approved): the keyboard plugin hides the
      // ‹ › Done bar above the keyboard unless told otherwise, so a number pad had no way to close but a tap
      // somewhere else, and a long form had no Next. An iPhone keyboard on a web form has that bar. The one
      // call is made through registerPlugin, not the plugin's package: importing that would bring its types,
      // which say capacitor.config.ts's resize: "native" in an enum's words instead.
      const Keyboard = registerPlugin<{ setAccessoryBarVisible(o: { isVisible: boolean }): Promise<void> }>("Keyboard");
      void Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => {});

      // Haptics: one step of a feel at a time (lib/haptics owns the table).
      const IMPACT = { LIGHT: ImpactStyle.Light, MEDIUM: ImpactStyle.Medium, HEAVY: ImpactStyle.Heavy } as const;
      const NOTE = { SUCCESS: NotificationType.Success, WARNING: NotificationType.Warning, ERROR: NotificationType.Error } as const;
      setNativeHaptics((step: UIKitStep) => {
        if (step.kind === "impact") void Haptics.impact({ style: IMPACT[step.style] });
        else if (step.kind === "notification") void Haptics.notification({ type: NOTE[step.type] });
        else void Haptics.selectionStart().then(() => Haptics.selectionChanged()).then(() => Haptics.selectionEnd());
      });
      undo.push(() => setNativeHaptics(null));

      // Save, share, print, add to the calendar or to Wallet, sign in with Apple: the phone's own sheets
      // (lib/deviceActions).
      const device = registerPlugin<GT3DevicePlugin>("GT3Device");
      setNativeDevice({
        keepFile: (o) => device.keepFile(o),
        printPage: (o) => device.printPage(o),
        addEvent: (o) => device.addEvent(o),
        addPass: (o) => device.addPass(o),
        signInWithApple: (o) => device.signInWithApple(o),
        appleCredentialState: (o) => device.appleCredentialState(o),
        openSettings: () => device.openSettings(),
        share: (o) => Share.share(o),
      });
      undo.push(() => setNativeDevice(null));
      setDeviceReady(true);

      // WHICH BUILD THIS PHONE RUNS (2026-10-11): the app's version and build, for Live Ops' list of the devices on the
      // Pass (lib/heartbeat). Its own errand: a phone that cannot say leaves the build blank, and nothing waits on it.
      void App.getInfo().then(({ version, build }) => setAppBuild(`${version} (${build})`), () => {});
      undo.push(() => setAppBuild(null));

      // ALERTS (2026-10-11): the phone's own notifications, through Apple (APNs) — a browser's push cannot reach an
      // app. Only once they are live (lib/nativePush NATIVE_PUSH_ON: the push function holds APNs' key). Asked for
      // from Settings › Notifications or the profile (components/AppAlerts); registered again on every launch once
      // allowed, since Apple may hand the phone a new token; a tapped alert opens the screen it is about.
      // Its own errand: nothing after it waits on it, and nothing in it can stop the rest — the links, window.open, the
      // launch screen (2026-10-11, the review: a build without the plugin would have skipped them all, silently).
      if (NATIVE_PUSH_ON) void (async () => {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        if (cancelled) return;
        const said = (r: string): AppAlertState => (r === "granted" ? "granted" : r === "denied" ? "denied" : "prompt");
        const state = async (): Promise<AppAlertState> => {
          try { return said((await PushNotifications.checkPermissions()).receive); } catch { return "unavailable"; }
        };
        const registered = await PushNotifications.addListener("registration", ({ value }) => setPushToken(value));
        const opened = await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
          const to = alertTarget((notification.data as { url?: unknown } | undefined)?.url);
          if (to) router.push(to);
        });
        // Left before this errand finished: its listeners go now, as the rest of the bridge's already went.
        if (cancelled) { void registered.remove(); void opened.remove(); return; }
        undo.push(() => { void registered.remove(); void opened.remove(); });
        setNativePush({
          state,
          enable: async () => {
            try {
              const answer = said((await PushNotifications.requestPermissions()).receive);
              if (answer === "granted") await PushNotifications.register();
              return answer;
            } catch { return "unavailable"; }
          },
        });
        undo.push(() => setNativePush(null));
        if ((await state()) === "granted") void PushNotifications.register().catch(() => {});
      })().catch(() => { /* alerts are optional; never the app */ });

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
      // The sheet closed: a screen that sent someone out to finish something there (Outlook's consent) reads again.
      // A listener that can't be had costs only that: what follows (window.open, the app's links, the launch screen)
      // never waits on it — the outer catch would have skipped all of it (2026-10-11, the review).
      const finished = await Browser.addListener("browserFinished", () => window.dispatchEvent(new Event(BROWSER_CLOSED_EVENT))).catch(() => null);
      if (finished) undo.push(() => { void finished.remove(); });
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
        // A PASSWORD RESET IS THE RESET'S SCREEN, NOT A SIGN-IN (2026-10-11, the review). The page opens again with the
        // link's tokens in its address, so the auth client says PASSWORD_RECOVERY and "set a new password" comes up, as
        // in a browser — a session set from here (signInWithUrl) said only "signed in", and the reset was skipped.
        if (/type=recovery/.test(u.hash + u.search)) { window.location.replace(`/${u.hash}`); return; }
        // A sign-in link's tokens ride in the address's hash (the client's implicit flow). A ?code= on a GT3 page is that
        // page's own (/reserve?code=…): it was read as a sign-in and opened nothing.
        if (/access_token=|refresh_token=|type=signup|type=magiclink/.test(u.hash + u.search)) { void signInWithUrl(url); return; }
        const lesson = /^\/primal\/l\/([^/]+)\/?$/.exec(u.pathname);
        if (lesson) { router.push(lessonHref(decodeURIComponent(lesson[1]))); return; }
        if (WEB_ONLY.some((p) => u.pathname.startsWith(p))) { void Browser.open({ url: u.href }); return; }
        // The console's old address (/admin, in alerts' links and their emails) is read as its new one, as a tapped
        // alert's is (lib/nativePush alertTarget): the app holds no /admin, and its router showed the home screen.
        router.push(alertTarget(`${u.pathname}${u.search}${u.hash}`) ?? "/");
      });
      undo.push(() => { void opened.remove(); });

      // The page has drawn: let the launch screen go.
      requestAnimationFrame(() => requestAnimationFrame(() => { void SplashScreen.hide({ fadeOutDuration: 200 }); }));
    })().catch(() => { /* a missing plugin must never take the page down */ });

    return () => { cancelled = true; for (const u of undo.reverse()) u(); };
  }, [router, signInWithUrl]);

  // STOPPED USING SIGN IN WITH APPLE FOR GT3 IN SETTINGS? Then signed out here too (Apple's TN3194) — asked once the
  // phone's half is in, and each time the app comes back to the front. Only on Apple's own "revoked", and only for a
  // session this phone got from Apple (lib/appleAuth markAppleSession): an account with an Apple identity that signed in
  // here with its email code stays signed in (2026-10-11, the review — it was signed out on every return). The sign-out
  // is this phone's alone ("local"): the web, and any other phone, keep their sessions. It lives here, in the app's own
  // bridge, so none of it rides in a web page.
  const uid = user?.id ?? null;
  const appleUser = (user?.identities ?? []).find((i) => i.provider === "apple")?.identity_data?.sub as string | undefined;
  useEffect(() => {
    // Nobody signed in, or somebody else: an older Apple session's mark goes with it. (Not before the session is known:
    // a launch reads no one for a moment.)
    if (ready && appleSession() !== uid) markAppleSession(null);
  }, [ready, uid]);
  useEffect(() => {
    if (!appleUser || !uid || !deviceReady) return;
    let live = true;
    const ask = () => {
      if (document.visibilityState !== "visible" || appleSession() !== uid) return;
      void appleCredentialState(appleUser).then((state) => {
        if (!live || state !== "revoked" || appleSession() !== uid) return;
        markAppleSession(null);
        void supabase?.auth.signOut({ scope: "local" });
      });
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => { live = false; document.removeEventListener("visibilitychange", ask); };
  }, [appleUser, uid, deviceReady]);

  // This phone, kept for whoever is signed in now — again when someone signs in or out, or joins the crew (lib/nativePush
  // keepAppDevice, 0367): the order that is ready reaches its own person's phone, a phone someone signed out of is
  // nobody's, and only the crew's phones hear of new orders (0365). The database does all of it, whoever had the phone.
  const staff = isStaff(profile);
  useEffect(() => {
    if (pushToken && ready) void keepAppDevice(pushToken);
  }, [pushToken, ready, uid, staff]);

  // A new screen: look at what is under the status bar again.
  useEffect(() => { restyle.current?.(); }, [pathname]);

  // In <body>, outside the app's column, so nothing the column does to its own layers moves it.
  return onPhone ? createPortal(<div className="native-bar" aria-hidden="true" />, document.body) : null;
}
