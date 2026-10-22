// GT3 NUTRITION'S STUDENTS (R47 — Ryan: "how can i see the users… a member's profile should show if they enrolled and
// all of the other stuff… industry standard"). Pure: the students panel (components/nutrition/CourseStudents), the
// course on a customer's record (components/nutrition/CourseOnRecord) and the tests read the same rows the same way.
// The rows are course_students() (0444): every customer who has or had the course, how they got it, how far along.
import { moneyPlain } from "./money";

export type Student = {
  customer_id: string; name: string | null; email: string | null; user_id: string | null;
  source: string; granted_at: string; revoked_at: string | null; order_id: string | null; paid_cents: number | null; note: string | null;
  done: number; total: number; rookie_done: number; rookie_total: number; last_done_at: string | null;
};

export const isLive = (s: Pick<Student, "revoked_at">): boolean => !s.revoked_at;

/** How they got it, in a word. */
export function howWord(s: Pick<Student, "source" | "revoked_at">): string {
  if (s.revoked_at) return "Taken back";
  return s.source === "purchase" ? "Bought" : s.source === "comp" ? "Given" : s.source;
}

/** "2 of 3 lessons" — or that there's nothing to take yet. */
export function progressWords(s: Pick<Student, "done" | "total">): string {
  if (!s.total) return "No lessons live yet";
  return `${s.done} of ${s.total} lesson${s.total === 1 ? "" : "s"}`;
}

export const rookieEarned = (s: Pick<Student, "rookie_done" | "rookie_total">): boolean => s.rookie_total > 0 && s.rookie_done >= s.rookie_total;

export type CourseKpis = {
  students: number; bought: number; given: number; takenBack: number;
  revenueCents: number; revenue30Cents: number; sold30: number;
  started: number; finished: number; badge: number; avgPct: number;
};

/** The numbers a course owner looks at first. Live students only, except "taken back"; revenue is what bought it. */
export function courseKpis(rows: readonly Student[], now: Date = new Date()): CourseKpis {
  const live = rows.filter(isLive);
  const since = now.getTime() - 30 * 86_400_000;
  const bought = rows.filter((s) => s.source === "purchase");
  const pct = live.map((s) => (s.total ? s.done / s.total : 0));
  return {
    students: live.length,
    bought: live.filter((s) => s.source === "purchase").length,
    given: live.filter((s) => s.source !== "purchase").length,
    takenBack: rows.length - live.length,
    revenueCents: bought.filter(isLive).reduce((n, s) => n + (s.paid_cents ?? 0), 0),
    revenue30Cents: bought.filter((s) => isLive(s) && Date.parse(s.granted_at) >= since).reduce((n, s) => n + (s.paid_cents ?? 0), 0),
    sold30: bought.filter((s) => Date.parse(s.granted_at) >= since).length,
    started: live.filter((s) => s.done > 0).length,
    finished: live.filter((s) => s.total > 0 && s.done >= s.total).length,
    badge: live.filter(rookieEarned).length,
    avgPct: pct.length ? Math.round((pct.reduce((a, b) => a + b, 0) / pct.length) * 100) : 0,
  };
}

/** Search a name or an email, and a filter by how they got it. */
export function filterStudents(rows: readonly Student[], q: string, how: "all" | "bought" | "given" | "back"): Student[] {
  const ql = q.trim().toLowerCase();
  return rows.filter((s) =>
    (how === "all" ? isLive(s) : how === "back" ? !isLive(s) : isLive(s) && (how === "bought" ? s.source === "purchase" : s.source !== "purchase"))
    && (!ql || (s.name ?? "").toLowerCase().includes(ql) || (s.email ?? "").toLowerCase().includes(ql)));
}

/** The export: one row per student, the columns an email tool or a bookkeeper reads. */
export function studentsCsv(rows: readonly Student[]): Record<string, string | number>[] {
  return rows.map((s) => ({
    name: s.name ?? "", email: s.email ?? "", how: howWord(s), since: s.granted_at.slice(0, 10), paid: s.paid_cents != null ? moneyPlain(s.paid_cents) : "",
    lessons_done: s.done, lessons_live: s.total, rookie_badge: rookieEarned(s) ? "yes" : "no", last_lesson: s.last_done_at ? s.last_done_at.slice(0, 10) : "", note: s.note ?? "",
  }));
}
