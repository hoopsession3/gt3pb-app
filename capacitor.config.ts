import type { CapacitorConfig } from "@capacitor/cli";

// THE IPHONE APP'S SHELL (2026-10-06, the iPhone round) — and the iPad's (2026-10-11: scripts/ios.configure.mjs, 4).
//
// The app is the same screens as the web, built as a static export (`npm run build:app` → out/,
// scripts/build.app.mjs) and bundled inside a native shell, so it opens with no connection and never
// goes blank when a server does. Vercel and Supabase are unchanged: the app calls the same /api
// routes on app.gt3pb.com (lib/native apiUrl) and the same database. `npx cap sync ios` copies out/
// into ios/ (committed; its own .gitignore keeps the copy out of git).
//
// THE NAMES (Ryan, 2026-10-06: "Use these"). appName is the label under the icon — GT3PB, the same as
// the home-screen install (app/layout.tsx, app/manifest.ts). The App Store name, "GT3 Performance Bar",
// is set in App Store Connect. appId is the bundle id; Apple fixes it once the first build is uploaded.
const config: CapacitorConfig = {
  appId: "com.gt3pb.app",
  appName: "GT3PB",
  webDir: "out",
  // The page's own ground (app/layout.tsx themeColor) behind the web view, so a first paint is never
  // a white flash.
  backgroundColor: "#15140f",
  // PINCH TO ZOOM IN THE APP (2026-10-19, R36 — the fresh audit's UX11-07; Ryan: "Allow pinch-zoom"). Left off,
  // Capacitor puts its own delegate on the web view's scroll view, and it answers every pinch with nothing to zoom —
  // whatever the page says. On, the web view zooms as Safari does, and ios/App/App/GT3ViewController (written by
  // scripts/ios.configure.mjs) lets a pinch past the page's maximum-scale=1 (kept: it stops iOS zooming into a tapped
  // field, lib/ios) and lets a zoomed-in page be moved about.
  zoomEnabled: true,
  ios: {
    // The page draws under the status bar and the home indicator and pads itself clear of them with
    // env(safe-area-inset-*) (app/layout.tsx asks for viewport-fit=cover in the app build).
    contentInset: "never",
    // The app scrolls inside <main id="body">, never the page; without this the whole web view would
    // rubber-band when a drag starts on the header or the tab bar — a website's tell.
    scrollEnabled: false,
    // A long press on a link shows the app's own behaviour, not Safari's link preview.
    allowsLinkPreview: false,
    // The page at the device's own width, never iPadOS's desktop mode. THE APP RUNS ON AN IPAD (2026-10-11): left to
    // "recommended", an iPad's web view takes desktop-class browsing — it tells the page it is a Mac and lays it out
    // as a laptop's page — so the page could not tell an iPad from a laptop, nor lay itself out for one. "mobile"
    // keeps the iPad's own user agent and width (820 upright and 1,180 on its side, an 11-inch iPad Air), and the
    // page's own tests choose its layout: a phone's below 520 × 640, one column upright, the desk on its side
    // (lib/surfaces; scripts/smoke.native.mjs opens the crew's screens on an iPad both ways). On an iPhone it is the
    // phone's layout, as it always was.
    preferredContentMode: "mobile",
  },
  plugins: {
    SplashScreen: {
      // The launch screen stays up until the page has drawn — components/NativeBridge hides it then —
      // so the brand screen hands straight to the app with no blank frame between. If the page never
      // gets that far it goes at 3s anyway, onto the app's own charcoal.
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: "#15140f",
      showSpinner: false,
    },
    Keyboard: {
      // The web view itself shrinks above the keyboard (the plugin's default, said here on purpose),
      // so a bottom sheet's field and its button stay in sight — the iPhone app's form of the web's
      // interactive-widget=resizes-content (app/layout.tsx). components/NativeBridge takes the tab bar
      // out of the way while it is up and keeps the field being typed in on screen.
      resize: "native",
    },
    // THE STATUS BAR, FROM THE FIRST FRAME: light text, over the launch screen's charcoal and the app's.
    // components/NativeBridge then follows each screen (dark text over the menu's cream). Two plugins
    // can set it — SystemBars (Capacitor's own) and StatusBar (installed for its tap-to-top) — so both
    // start from the same word and never disagree; StatusBar also keeps the page drawing under the bar.
    SystemBars: {
      style: "DARK",
    },
    StatusBar: {
      style: "DARK",
      overlaysWebView: true,
    },
    // ALERTS (2026-10-11): a notification that lands while the app is open shows as a banner with its sound, as
    // Messages' does — not silently. components/NativeBridge asks for permission when someone turns alerts on
    // (Settings › Notifications), registers the phone, and opens a tapped alert's screen.
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
