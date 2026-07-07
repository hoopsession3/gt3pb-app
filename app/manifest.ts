import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "GT3 — No Noise",
    short_name: "No Noise",
    description:
      "No Noise — your GT3 home. Cold-extracted coffee, whole-food hydration, and slow-simmered fuel, prepared to order.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#15140f",
    theme_color: "#15140f",
    orientation: "portrait",
    lang: "en-US",
    dir: "ltr",
    categories: ["food", "lifestyle", "health"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Menu", short_name: "Menu", url: "/menu", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Find the truck", short_name: "Truck", url: "/truck", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Events", short_name: "Events", url: "/events", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
