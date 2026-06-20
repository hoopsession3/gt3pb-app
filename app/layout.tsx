import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppProvider from "@/components/AppProvider";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "GT3 Performance Bar",
  description: "Whole-food functional beverages. Nothing toxic. The daily front door to GT3PB.",
  applicationName: "GT3 Performance Bar",
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
  themeColor: "#15140f",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
