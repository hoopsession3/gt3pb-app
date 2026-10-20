// GT3 NUTRITION — the course's shape, its downloadable maps, and the arithmetic of a reader's progress (R44).
//
// GT3 Nutrition is the brand; Return to Primal is its course. The lessons live in the database (primal_pillars →
// primal_modules → primal_lessons, 0272), read through RLS: every lesson is a member's — one GT3 Nutrition purchase
// opens the whole course (0441) — and anyone may read its preview (primal_lesson_previews: title, summary, minutes), so
// the map, the Today card and a locked lesson's page show what the course holds before it is bought.
// This file is pure — the course screens, the Today card and the tests all ask it, and it reads nothing itself.
//
// THE MAPS. The owner built the course as Miro boards and MindNode maps; each one is kept in content/nutrition/source
// (the app is the source of truth now, so a cheaper Miro plan loses nothing). A reader downloads a static copy of a
// map to zoom and search it, the way the Rookie board always offered ("All framework and systems are downloadable PDF
// files"). The four pillar maps — Movement, Stillness, Light, Fuel — are free and served as public files; the Rookie
// maps are the course's, served by app/api/nutrition/map only to a member or the crew (the owner's call, 2026-10-20:
// "rookies shouldn't be free, only the pillars").

export type MapTier = "free" | "pro";

/** One downloadable map. `file` is its name under public/nutrition/maps (free) or content/nutrition/pro (the course's). */
export type NutritionMap = {
  slug: string;
  title: string;
  blurb: string;
  tier: MapTier;
  level: "Rookie" | "Engine" | "Pillar";
  file: string;
  bytes: number;
};

export const MAPS: readonly NutritionMap[] = [
  { slug: "movement", title: "Return to Primal · Movement", blurb: "Stabilization, expansion, activation — and the movement loop.", tier: "free", level: "Pillar", file: "movement.pdf", bytes: 255037 },
  { slug: "stillness", title: "Return to Primal · Stillness", blurb: "Stillness as an intentional weapon, stage by stage.", tier: "free", level: "Pillar", file: "stillness.pdf", bytes: 277033 },
  { slug: "light", title: "Return to Primal · Light", blurb: "How light sets your rhythm, energy and sleep.", tier: "free", level: "Pillar", file: "light.pdf", bytes: 221864 },
  { slug: "fuel", title: "Return to Primal · Fuel", blurb: "Fuel as a signal: what to build, burn and store.", tier: "free", level: "Pillar", file: "fuel.pdf", bytes: 280131 },
  { slug: "rookie-hub", title: "Return to Primal · Rookie", blurb: "The whole Rookie path on one board: who it's for, the FAQ, and where to start.", tier: "pro", level: "Rookie", file: "return-to-primal-rookie.pdf", bytes: 1704735 },
  { slug: "seven-steps", title: "Go Animal-Based in 7 Steps", blurb: "The seven steps to make it a lifestyle, not a diet.", tier: "pro", level: "Rookie", file: "seven-steps-animal-based.pdf", bytes: 67858 },
  { slug: "animal-based-diet", title: "Animal-Based Diet", blurb: "The animal-based operating system, automated.", tier: "pro", level: "Rookie", file: "animal-based-diet.pdf", bytes: 836678 },
  { slug: "ruminant-meat", title: "Ruminant (Red) Meat Explained", blurb: "Why ruminant meat and its broth anchor the plate.", tier: "pro", level: "Rookie", file: "ruminant-meat-explained.pdf", bytes: 70860 },
  { slug: "raw-dairy", title: "Raw Dairy Explained", blurb: "What raw dairy brings, and how to start.", tier: "pro", level: "Rookie", file: "raw-dairy-explained.pdf", bytes: 358187 },
  { slug: "power-carbs", title: "Power Carbs Explained", blurb: "The carbs your body knows how to use, and how to stack them.", tier: "pro", level: "Rookie", file: "power-carbs-explained.pdf", bytes: 83264 },
  { slug: "vitamins-minerals", title: "Vitamins and Minerals Explained", blurb: "Each one: what it does, when you're low, best sources.", tier: "pro", level: "Rookie", file: "vitamins-minerals-explained.pdf", bytes: 86834 },
  { slug: "amino-acids", title: "Amino Acids Explained", blurb: "Essential and conditional amino acids, and where they come from.", tier: "pro", level: "Rookie", file: "amino-acids-explained.pdf", bytes: 87793 },
  { slug: "sugar-cravings", title: "Break Sugar Cravings in 7 Days", blurb: "A day-by-day system for the habit that's hardest to break.", tier: "pro", level: "Rookie", file: "break-sugar-cravings.pdf", bytes: 68918 },
  { slug: "meal-stacking", title: "Meal Stacking for Rookies", blurb: "Build a plate by the feeling you want from it.", tier: "pro", level: "Rookie", file: "meal-stacking-for-rookies.pdf", bytes: 264557 },
  { slug: "meal-stacking-kids", title: "Meal Stacking for Kids", blurb: "The same system for picky eaters.", tier: "pro", level: "Rookie", file: "meal-stacking-for-kids.pdf", bytes: 142796 },
];

/** Where a map is downloaded from: a free map is a public file; a course map asks the server, which checks membership. */
export function mapHref(m: Pick<NutritionMap, "tier" | "file" | "slug">): string {
  return m.tier === "free" ? `/nutrition/maps/${m.file}` : `/api/nutrition/map/${m.slug}`;
}

/** A course (paid) map by its slug — the only maps app/api/nutrition/map serves. */
export function proMap(slug: string): NutritionMap | null {
  return MAPS.find((m) => m.tier === "pro" && m.slug === slug) ?? null;
}

/** "1.7 MB" / "264 KB" — said beside a download, so nobody taps a big file on a phone without knowing. */
export function sizeLabel(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

// ── a reader's progress ───────────────────────────────────────────────────────────────────────────────────────────

export type PillarLite = { id: string; slug: string; title: string; sort: number };
export type ModuleLite = { id: string; pillar_id: string; title: string; sort: number };
export type LessonLite = { id: string; module_id: string; slug: string; title: string; tier: "rookie" | "pro"; sort: number; key_points?: string[]; summary?: string | null; est_minutes?: number | null; open?: boolean };

/** A lesson this reader may open — its full row came back. A preview (primal_lesson_previews) is `open: false`. */
export const isOpen = (l: Pick<LessonLite, "open">): boolean => l.open !== false;

/** The course as previews, with the lessons this reader can open laid over them: one list, every lesson in it, each
 *  marked open or not. A full row wins over its preview (it carries the key points). */
export function mergeLessons(previews: readonly LessonLite[], full: readonly LessonLite[]): LessonLite[] {
  const byId = new Map<string, LessonLite>(previews.map((l) => [l.id, { ...l, open: false }]));
  for (const l of full) byId.set(l.id, { ...byId.get(l.id), ...l, open: true });
  return [...byId.values()];
}

/** The lessons in the order the course is taken: pillar by pillar, module by module, lesson by lesson. A lesson whose
 *  module or pillar this reader cannot see is left out (it has nowhere to sit on the path). */
export function courseOrder(pillars: readonly PillarLite[], modules: readonly ModuleLite[], lessons: readonly LessonLite[]): LessonLite[] {
  const pSort = new Map(pillars.map((p) => [p.id, p.sort]));
  const mOf = new Map(modules.map((m) => [m.id, m]));
  const key = (l: LessonLite): [number, number, number] | null => {
    const m = mOf.get(l.module_id);
    if (!m || !pSort.has(m.pillar_id)) return null;
    return [pSort.get(m.pillar_id) as number, m.sort, l.sort];
  };
  return lessons
    .map((l) => ({ l, k: key(l) }))
    .filter((x): x is { l: LessonLite; k: [number, number, number] } => x.k !== null)
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.l.title.localeCompare(b.l.title))
    .map((x) => x.l);
}

/** The lesson to open next: the first on the path not yet done. Null when every lesson on it is done. */
export function nextLesson(order: readonly LessonLite[], done: ReadonlySet<string>): LessonLite | null {
  return order.find((l) => !done.has(l.id)) ?? null;
}

export type Progress = { done: number; total: number; pct: number };
/** How far along a set of lessons is — the course, a pillar, a module. Lessons the reader cannot see do not count. */
export function progressOf(lessons: readonly LessonLite[], done: ReadonlySet<string>): Progress {
  const total = lessons.length;
  const n = lessons.filter((l) => done.has(l.id)).length;
  return { done: n, total, pct: total ? n / total : 0 };
}

/** The Rookie badge is earned when every Rookie lesson on the path is done — never on an empty course. */
export function rookieComplete(order: readonly LessonLite[], done: ReadonlySet<string>): boolean {
  const rookie = order.filter((l) => l.tier === "rookie");
  return rookie.length > 0 && rookie.every((l) => done.has(l.id));
}

/** The device's note that this reader has seen the badge earned — the heartbeat plays once, not on every visit. */
export const badgeSeenKey = (userId: string): string => `gt3.nutrition.badge.${userId}`;

// ── the Today card ────────────────────────────────────────────────────────────────────────────────────────────────

/** The day the Daily Stack asks about (lib/dailyStack DAYS). */
export type StackDay = "training" | "deep" | "easy";

/** Which lesson fits which day, by slug — the owner's three starter lessons. A slug the course does not have (or a day
 *  with none) falls back to the reader's next lesson. */
export const DAY_LESSON: Readonly<Record<StackDay, string>> = { training: "power-carbs", deep: "steady-energy", easy: "ruminant-red" };
export const DAY_KICKER: Readonly<Record<StackDay, string>> = { training: "Training today", deep: "Deep work today", easy: "An easy day" };

export type TodayPick =
  | { kind: "lesson"; lesson: LessonLite; kicker: string; point: string | null }
  | { kind: "tip"; lesson: LessonLite; point: string }
  | { kind: "none" };

/** Days since 2026-01-01 in the reader's own calendar — the tip of the day turns over at their midnight. */
export function dayNumber(now: Date): number {
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((local - Date.UTC(2026, 0, 1)) / 86_400_000);
}

/** One lesson matched to the day the reader picked, or — with no day — one of the course's own key points as the day's
 *  tip, turning over daily. A reader who hasn't bought the course is offered the same lessons as previews: their
 *  summaries are the line, and the card opens the preview that sells it. */
export function todayPick(day: StackDay | null, order: readonly LessonLite[], done: ReadonlySet<string>, dayNo: number): TodayPick {
  if (!order.length) return { kind: "none" };
  if (day) {
    const lesson = order.find((l) => l.slug === DAY_LESSON[day]) ?? nextLesson(order, done) ?? order[0];
    const pts = (lesson.key_points ?? []).filter(Boolean);
    return { kind: "lesson", lesson, kicker: DAY_KICKER[day], point: pts.length ? pts[((dayNo % pts.length) + pts.length) % pts.length] : (lesson.summary?.trim() || null) };
  }
  let tips = order.flatMap((l) => (l.key_points ?? []).filter(Boolean).map((point) => ({ lesson: l, point })));
  // Nobody's bought the course: its key points aren't theirs to read, but every lesson's summary is — the day's line is
  // one of those, turning over daily, and the card opens the lesson's preview.
  if (!tips.length) tips = order.filter((l) => l.summary && l.summary.trim()).map((l) => ({ lesson: l, point: (l.summary as string).trim() }));
  if (!tips.length) return { kind: "lesson", lesson: nextLesson(order, done) ?? order[0], kicker: "From GT3 Nutrition", point: null };
  const t = tips[((dayNo % tips.length) + tips.length) % tips.length];
  return { kind: "tip", lesson: t.lesson, point: t.point };
}
