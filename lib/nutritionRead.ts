// GT3 NUTRITION — THE COURSE'S LESSONS, AS THIS READER MAY SEE THEM (R45).
//
// Two reads, laid over each other (lib/nutrition mergeLessons): every live lesson's preview (primal_lesson_previews,
// 0441 — title, subtitle, level, minutes, summary; anyone's), and the lessons this reader may open in full (primal_lessons
// through RLS — a GT3 Nutrition buyer's and the crew's once the course is bought, 0442). A lesson in the first and not
// the second is a preview: `open: false`, shown with what it covers and a lock. Before 0441 is applied the previews
// aren't there to read, and the list is what RLS opens — exactly the course as it was.
import type { supabase as client } from "@/lib/supabase";
import { mergeLessons, type LessonLite } from "@/lib/nutrition";

export type CourseLesson = LessonLite & { subtitle: string | null; key_points: string[] };

const FULL = "id, module_id, slug, title, subtitle, tier, est_minutes, summary, key_points, sort";

export async function readCourseLessons(sb: NonNullable<typeof client>): Promise<CourseLesson[]> {
  const [prev, full] = await Promise.all([
    sb.rpc("primal_lesson_previews"),
    sb.from("primal_lessons").select(FULL).order("sort"),
  ]);
  if (full.error && prev.error) throw new Error(full.error.message);
  const previews = (prev.error ? [] : ((prev.data ?? []) as unknown as LessonLite[]));
  const opened = (full.error ? [] : ((full.data ?? []) as unknown as LessonLite[]));
  return mergeLessons(previews, opened).map((l) => {
    const r = l as LessonLite & { subtitle?: string | null };
    return { ...r, subtitle: r.subtitle ?? null, key_points: Array.isArray(r.key_points) ? r.key_points : [] };
  });
}
