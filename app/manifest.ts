import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GT3 Performance Bar",
    short_name: "GT3PB",
    description: "Whole-food functional beverages. Nothing toxic. The daily front door to GT3PB.",
    start_url: "/",
    display: "standalone",
    background_color: "#15140f",
    theme_color: "#15140f",
    orientation: "portrait",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
