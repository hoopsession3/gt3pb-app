import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import AppProvider from "@/components/AppProvider";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.gt3pb.com"),
  title: "GT3 Performance Bar — Only the best for you",
  description: "Whole-food functional beverages — cold-extracted coffee, whole-coconut hydration, and slow-simmered broth, made to order. Order ahead, reserve a drop, and manage your membership.",
  applicationName: "GT3PB",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "GT3PB" },
  manifest: "/manifest.webmanifest",
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
  maximumScale: 5,
  // resizes-content: when the on-screen keyboard opens, the layout viewport shrinks to the visible
  // area, so bottom sheets (qd-sheet) sit ABOVE the keyboard instead of behind it (the "can't reach
  // the Build button" bug).
  interactiveWidget: "resizes-content",
  themeColor: "#15140f",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Warm the connection to Supabase (auth/session + the first data query) so its TLS handshake
            overlaps with the initial render instead of starting only when the auth layer fires. */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <>
            <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
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
            <AppShell>{children}</AppShell>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
