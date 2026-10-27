// THE ACADEMY'S LESSONS, CLASSED (IP0b, 2026-10-28 — Ryan: "Academy lesson classification: public, internal or
// restricted"). Pure, and safe for a browser: names and classes only, no content.
//
//   public      — none. The staff Academy is training; GT3's public teaching is the customer Academy (primal_lessons, 0272),
//                 gated in the database already.
//   internal    — staff training: served to staff by app/api/academy/lesson.
//   restricted  — process specifics (extraction, the nitro system, the cold-brew line): the recipe audience, the same
//                 decision as the cookbook's (D1). Staff today.
// Proposed by the 2026-10-28 audit from each lesson's figures (ratios, temperatures, times, pressures). Food safety's
// figures are the health code's, not GT3's process: internal. Ryan confirms or moves any lesson here.
import type { LessonClass } from "./academy";

export const RESTRICTED_LESSONS = ["coffee-science", "nitro-mastery", "coldbrew-power-mastery"] as const;
export function lessonClass(slug: string): LessonClass {
  return (RESTRICTED_LESSONS as readonly string[]).includes(slug) ? "restricted" : "internal";
}
