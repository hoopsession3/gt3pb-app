import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import AppProvider from "@/components/AppProvider";
import AppShell from "@/components/AppShell";
import OfflineBanner from "@/components/OfflineBanner";
import { APP_BUILD } from "@/lib/native";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.gt3pb.com"),
  title: "GT3 Performance Bar — Only the best for you",
  description: "Whole-food functional beverages — cold-extracted coffee, whole-coconut hydration, and slow-simmered broth, made to order. Order ahead, reserve a drop, and manage your membership.",
  applicationName: "GT3PB",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "GT3PB" },
  // The web app's install manifest; the iPhone app is installed from the App Store and has none.
  ...(APP_BUILD ? {} : { manifest: "/manifest.webmanifest" }),
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom is ALLOWED (WCAG 1.4.4 / SC 1.4.4 — disabling it is a hard failure axe flags on every
  // page). It was previously locked because a stray pinch scaled the layout and clipped chrome (avatar,
  // float rail, Reserve CTA); if that resurfaces, fix it in CSS (the layout should tolerate zoom) rather
  // than by disabling scaling. The in-app Display controls (rail → AA: text size, bold, spacing) remain
  // as a complementary reflow path, not a substitute for browser zoom.
  // On an iPhone only, lib/ios (holdFocusZoom) swaps this for maximum-scale=1 once the page is up: iOS
  // keeps the pinch whatever the limit says and drops only its zoom into a tapped field under 16px,
  // which never zoomed back out (2026-10-06). Everywhere else this 5 stands.
  maximumScale: 5,
  // resizes-content: when the on-screen keyboard opens, the layout viewport shrinks to the visible
  // area, so bottom sheets (qd-sheet) sit ABOVE the keyboard instead of behind it (the "can't reach
  // the Build button" bug).
  interactiveWidget: "resizes-content",
  themeColor: "#15140f",
  // THE APP DRAWS EDGE TO EDGE (2026-10-06, the iPhone round). In the iPhone app the page runs under
  // the status bar and the home indicator, as a native app does, and pads itself clear of them with
  // the env(safe-area-inset-*) values app/globals.css already uses (31 places) — which a page only
  // receives when it says viewport-fit=cover. The web's viewport is unchanged.
  ...(APP_BUILD ? { viewportFit: "cover" as const } : {}),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* The iPhone app's security policy (next.config.ts: an export has no server to send one). */}
        {APP_BUILD && process.env.NEXT_PUBLIC_GT3_APP_CSP ? <meta httpEquiv="Content-Security-Policy" content={process.env.NEXT_PUBLIC_GT3_APP_CSP} /> : null}
        {/* Stop iOS Safari from auto-inflating text (some calendar rows rendered huge on iPhone).
            This MUST live in a raw <style> — the CSS-module minifier strips `text-size-adjust`
            from globals.css, so the rule never reaches the browser from there. Inline it survives. */}
        <style dangerouslySetInnerHTML={{ __html: "html{-webkit-text-size-adjust:100%;-moz-text-size-adjust:100%;text-size-adjust:100%}" }} />
        {/* Warm the connection to Supabase (auth/session + the first data query) so its TLS handshake
            overlaps with the initial render instead of starting only when the auth layer fires. */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <>
            <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
            {/* Who is reading, before first paint (components/BottomNav.tsx: THE NAV THAT MOVED
                UNDER YOUR THUMB). The server cannot know; the browser already does — supabase-js
                keeps the session under sb-<ref>-auth-token in localStorage. A stored session paints
                the member nav, none paints the guest nav, and BottomNav's effect corrects the hint
                once the session has really been read. Inline + pre-hydration on purpose, like the
                style probe below: the whole point is to be right before React runs. Only emitted
                when Supabase is configured — without it nobody is a guest, and the attribute is
                absent, which the CSS reads as the member shape. */}
            <script
              dangerouslySetInnerHTML={{
                __html: `try{var m=Object.keys(localStorage).some(function(k){return /^sb-.+-auth-token$/.test(k)});document.documentElement.setAttribute("data-viewer",m?"member":"guest")}catch(e){}`,
              }}
            />
          </>
        )}
        {/* Style probe — heals the "raw HTML" render. If the app stylesheet failed to load
            (stale PWA shell pointing at a purged fingerprinted CSS, a cached 404, a deploy-
            boundary race), --cream never applies. One hard reload fetches fresh HTML with a
            valid CSS link; the sessionStorage flag stops a loop when we're genuinely offline.
            Inline + pre-hydration on purpose: a dead stylesheet throws no JS error, so the
            error-boundary self-heal (app/error.tsx) never sees it. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `addEventListener("load",function(){try{if(getComputedStyle(document.documentElement).getPropertyValue("--cream").trim())return;if(sessionStorage.getItem("gt3-css-reload"))return;sessionStorage.setItem("gt3-css-reload","1");location.reload();}catch(e){}});`,
          }}
        />
      </head>
      <body>
        <AuthProvider>
          <AppProvider>
            <OfflineBanner />
            <AppShell>{children}</AppShell>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
