import type { Metadata } from "next";
import PrimalLesson from "@/components/PrimalLesson";
import { PRIVATE_META, lessonDescription, lessonPath, publicMeta } from "@/lib/seo";
import { publicLesson } from "@/lib/guestRead";

// WHAT A LESSON TELLS SEARCH (R42 — the standards' "Search and sharing", lib/seo). Asked as a guest (lib/guestRead), so
// the database's own rule decides: a lesson anyone may read names itself, its one-liner and its address, and is listed
// (app/sitemap); a member's lesson, or one that isn't published, says noindex — a stranger would find its unlock path,
// not the lesson. A read that fails says neither: the page as it was, never noindex for a moment's outage.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const lesson = await publicLesson(slug);
  if (lesson === undefined) return { title: "Return to Primal" };
  if (lesson === null) return { title: "Return to Primal", ...PRIVATE_META };
  return { title: lesson.title, ...publicMeta(lessonPath(slug), lessonDescription(lesson), "article") };
}

export default async function PrimalLessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PrimalLesson slug={slug} />;
}
