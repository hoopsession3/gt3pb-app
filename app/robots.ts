import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

// WHAT A CRAWLER MAY READ (R42 — the standards' "Search and sharing", lib/seo): everything, and where the list is.
//   · Every page, so it can read a page's own noindex — a page a crawler is kept out of can't tell it not to list it.
//   · The API too: a page's words arrive from it (the menu from /api/menu), and a search engine that draws the page
//     must be let read them, or it lists the stand-in. Its answers are never listed: each says noindex in its headers
//     (next.config.ts, X-Robots-Tag).
// The sitemap names the public pages. The web's alone: the app build leaves it out.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/" }], sitemap: `${SITE}/sitemap.xml` };
}
