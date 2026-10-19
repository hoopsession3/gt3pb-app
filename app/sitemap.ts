import type { MetadataRoute } from "next";
import { SITEMAP_PATHS, absolute, lessonPath } from "@/lib/seo";
import { publicLessonSlugs } from "@/lib/guestRead";

// THE PUBLIC PAGES, LISTED (R42 — the standards' "Search and sharing", lib/seo). Every page a guest may find, at its
// canonical address, and every lesson anyone may read (lib/guestRead: asked as a guest, so a lesson only a member may
// open is never listed). Made again at most hourly; with no database (a CI build) it is the pages alone. No lastModified:
// a deploy's date on every page is no news to a search engine. The web's alone: the app build leaves it out.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lessons = await publicLessonSlugs();
  return [...SITEMAP_PATHS, ...lessons.map(lessonPath)].map((p) => ({ url: absolute(p) }));
}
