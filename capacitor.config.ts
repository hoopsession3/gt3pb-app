import type { CapacitorConfig } from "@capacitor/cli";

// THE IPHONE APP'S SHELL (2026-10-06, the iPhone round).
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
  ios: {
    // The page draws under the status bar and the home indicator and pads itself clear of them with
    // env(safe-area-inset-*) (app/layout.tsx asks for viewport-fit=cover in the app build).
    contentInset: "never",
    // The app scrolls inside <main id="body">, never the page; without this the whole web view would
    // rubber-band when a drag starts on the header or the tab bar — a website's tell.
    scrollEnabled: false,
    // A long press on a link shows the app's own behaviour, not Safari's link preview.
    allowsLinkPreview: false,
    // A phone's layout, always.
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
  },
};

export default config;
