import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import AppProvider from "@/components/AppProvider";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.gt3pb.com"),
  title: "GT3 Performance Bar — Only the best for you",
  description: "Whole-food functional beverages. Nothing toxic. Only the best for you — order, reserve, and your membership.",
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
  // pinch-zoom left enabled (WCAG 1.4.4) — the prototype locked it, but a shipped PWA shouldn't
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
