// R45 — THE COURSE IS BOUGHT, AND THE PILLARS ARE GIVEN (2026-10-20 — Ryan: "rookies shouldn't be free, only the
// pillars, light, stillness, movement, fuel"; the lessons locked with a preview kept; one GT3 Nutrition purchase opens
// all of it).
//
//   1 · lib/nutrition: a lesson's preview and its full row become one list, each marked open or not; the Today card
//       still has a line for someone who hasn't bought (the lesson's summary), never the key points they haven't bought.
//   2 · the maps: the four pillar maps are the free downloads, first in the library; the Rookie maps are the course's.
//   3 · the screens: progress, Continue and the badge count what a reader can open; a lesson they can't wears a lock and
//       opens to its preview; the locked page says what the lesson covers and the way in; the words say so.
//   4 · search and sharing: the sitemap and a lesson's share card read every lesson's preview, and the table's own read
//       until 0441 is applied.
//   5 · the database, as text: 0441 is additive and goes now; 0442 locks the lessons and is held until GT3 Nutrition is
//       for sale. (scripts/db.r45.test.mjs runs both in Postgres.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const N = loadTs("lib/nutrition.ts");

// ── 1 · lib/nutrition ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const P = (id, slug, sort, summary) => ({ id, module_id: "M1", slug, title: slug, tier: "rookie", sort, summary, est_minutes: 3 });
  const previews = [P("a", "power-carbs", 10, "Carbs that fuel you."), P("b", "steady-energy", 20, "Off the spike."), P("c", "ruminant-red", 30, "  ")];
  const merged = N.mergeLessons(previews, [{ ...P("a", "power-carbs", 10, "Carbs that fuel you."), key_points: ["Time carbs to movement"] }]);
  ok("mergeLessons: every lesson once; the one this reader can open is open and carries its key points; the rest are previews",
    merged.length === 3 && merged.find((l) => l.id === "a").open === true && merged.find((l) => l.id === "a").key_points[0] === "Time carbs to movement"
      && merged.filter((l) => !N.isOpen(l)).map((l) => l.id).join() === "b,c", merged);
  ok("…and with no previews to read (before 0441), what RLS opened is the course, all open",
    N.mergeLessons([], [P("a", "power-carbs", 10, "x")]).every(N.isOpen) && N.isOpen({}) && !N.isOpen({ open: false }));
  const shut = previews.map((l) => ({ ...l, open: false }));
  const day = N.todayPick("training", shut, new Set(), 0);
  ok("the Today card, not bought, a day picked: the day's lesson, its summary as the line — no key point it hasn't bought",
    day.kind === "lesson" && day.lesson.slug === "power-carbs" && day.point === "Carbs that fuel you.", day);
  const tip0 = N.todayPick(null, shut, new Set(), 0), tip1 = N.todayPick(null, shut, new Set(), 1);
  ok("…no day picked: one lesson's summary a day, turning over — a blank summary is never the line",
    tip0.kind === "tip" && tip0.point === "Carbs that fuel you." && tip1.point === "Off the spike." && N.todayPick(null, shut, new Set(), 2).point === "Carbs that fuel you.", [tip0, tip1]);
  const bought = N.todayPick(null, [{ ...previews[0], key_points: ["Keep the package"] }], new Set(), 0);
  ok("…and a buyer still gets the course's own key points", bought.kind === "tip" && bought.point === "Keep the package", bought);
}

// ── 2 · the maps ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const free = N.MAPS.filter((m) => m.tier === "free");
  ok("the free maps are the four pillars — Movement, Stillness, Light, Fuel — and come first in the library",
    free.map((m) => m.slug).join() === "movement,stillness,light,fuel" && N.MAPS.slice(0, 4).every((m) => m.tier === "free"));
  ok("every Rookie map is the course's: served by its route to a buyer or the crew, never a public file",
    N.MAPS.filter((m) => m.level === "Rookie").every((m) => m.tier === "pro" && N.mapHref(m) === `/api/nutrition/map/${m.slug}` && N.proMap(m.slug) === m)
      && N.proMap("movement") === null);
  const lib = read("components/nutrition/MapLibrary.tsx");
  ok("the library says Free on a free map and 'In the course' on a locked one — not Pro",
    /m\.tier === "free" \? `Free · PDF/.test(lib) && /locked \? "In the course"/.test(lib) && !/"Pro"/.test(lib));
  ok("the route says the map is part of GT3 Nutrition", /error: "This map is part of GT3 Nutrition\." \}, \{ status: 403 \}/.test(read("app/api/nutrition/map/[slug]/route.ts")));
}

// ── 3 · the screens ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const rd = read("lib/nutritionRead.ts");
  ok("one read for the course: every preview, and what RLS opens, laid over each other; previews missing is the old course",
    /sb\.rpc\("primal_lesson_previews"\)/.test(rd) && /sb\.from\("primal_lessons"\)\.select\(FULL\)/.test(rd) && /if \(full\.error && prev\.error\) throw/.test(rd)
      && /prev\.error \? \[\]/.test(rd) && /mergeLessons\(previews, opened\)/.test(rd));
  const ac = read("components/PrimalAcademy.tsx");
  ok("the course page reads it, and counts progress, Continue and the badge over the lessons a reader can open",
    /readCourseLessons\(supabase\)/.test(ac) && /const mine = useMemo\(\(\) => order\.filter\(isOpen\), \[order\]\);/.test(ac)
      && /progressOf\(mine, t\.done\)/.test(ac) && /nextLesson\(mine, t\.done\)/.test(ac) && /rookieComplete\(mine, t\.done\)/.test(ac) && /\{mine\.map\(\(l, i\) =>/.test(ac));
  ok("…a lesson not theirs wears a lock ('In the course') and opens to what it covers; the map says how many and links the way in",
    /shut \? <span className="k-tag gold"><Icon name="lock" size=\{11\} \/> In the course<\/span>/.test(ac) && /shut \? "See what it covers" : "Read"/.test(ac)
      && /className="nu-map-unlock"/.test(ac) && /\.nu-map-unlock\{[^}]*min-height:44px/.test(read("components/nutrition/nutrition.css")) && /\.pr-card\.shut::before/.test(read("components/nutrition/academy.css")));
  const map = read("components/nutrition/CourseMap.tsx");
  ok("the course map: a lock on a lesson not yet theirs, 'See what it covers', and no 'Free lesson'",
    /shut \? <Icon name="lock" size=\{9\} \/>/.test(map) && /isOpen\(s\.lesson\) \? "Open the lesson" : "See what it covers"/.test(map) && !/Free lesson/.test(map));
  const today = read("components/nutrition/NutritionToday.tsx");
  ok("the Today card: the lessons a reader can open if any, else the previews — never a mix that sends a buyer to a lock",
    /readCourseLessons\(supabase\)/.test(today) && /const order = open\.length \? open : all;/.test(today) && /shut \? "See the lesson"/.test(today)
      && /lesson\.summary\.trim\(\) !== point/.test(today));
  const ls = read("components/PrimalLesson.tsx");
  ok("a lesson not bought: its preview — level, minutes, title, summary — and the way in; a bad link: the way back",
    /const \{ data: prev \} = await supabase\.rpc\("primal_lesson_previews"\);/.test(ls) && /p\.tier === "pro" \? "Pro lesson" : "Rookie lesson"/.test(ls)
      && /href="\/primal#nu-pro"/.test(ls) && /href="\/primal#nu-library" className="btn-sec">The free pillar maps/.test(ls) && !/Browse free lessons/.test(ls));
  const copy = read("lib/copy.ts");
  ok("the words: no 'free to start', no 'Rookie stays free'; one purchase opens the course; the pillar maps are free",
    !/free to start|Rookie stays free|Rookie lessons are always free/.test(copy) && /opens with one GT3 Nutrition purchase/.test(copy) && /The four pillar maps are free/.test(copy)
      && /\{ key: "primal\.locked_h1_em", default: "moved" \}/.test(copy));
}

// ── 4 · search and sharing ───────────────────────────────────────────────────────────────────────────────────────────
{
  const gr = loadTs("lib/guestRead.ts");
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  // the previews aren't there yet (404 from PostgREST), the table answers
  const before = async (url, init) => { calls.push({ url, init }); return /rpc\/primal_lesson_previews/.test(url) ? json({ message: "not found" }, 404) : json([{ slug: "power-carbs" }]); };
  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stand-in.supabase.co"; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stand-in-public-key";
  try {
    const slugs = await gr.publicLessonSlugs(before);
    ok("the sitemap asks for every lesson's preview first — and, before 0441 is there, the table's own read answers",
      JSON.stringify(slugs) === '["power-carbs"]' && /rpc\/primal_lesson_previews\?select=slug$/.test(calls.at(-2).url) && /primal_lessons\?select=slug&published_at=not\.is\.null/.test(calls.at(-1).url), calls.slice(-2).map((c) => c.url));
    const one = await gr.publicLesson("steady-energy", async (url) => { calls.push({ url }); return json([{ title: "Steady Energy", subtitle: null, summary: "Off the spike." }]); });
    ok("a locked lesson's share card still says what it covers", one?.title === "Steady Energy" && /rpc\/primal_lesson_previews\?select=title,subtitle,summary&slug=eq\.steady-energy&limit=1$/.test(calls.at(-1).url), one);
  } finally {
    if (env.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
    if (env.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.key;
  }
}

// ── 5 · the database, as text ────────────────────────────────────────────────────────────────────────────────────────
{
  const a = read("supabase/migrations/0441_a_lessons_preview_is_anyones.sql");
  const b = read("supabase/migrations/0442_the_course_is_bought_and_the_pillars_are_given.sql");
  ok("0441: the preview — title, subtitle, level, minutes, summary; no body, no key points; live, this tenant; anyone may ask",
    /returns table \(id uuid, module_id uuid, slug text, title text, subtitle text, tier text, est_minutes int, summary text, sort int\)/.test(a)
      && !/l\.body|l\.key_points/.test(a) && /l\.published_at is not null\s+and l\.archived_at is null\s+and l\.tenant_id = public\.effective_tenant\(\)/.test(a)
      && /security definer set search_path = ''/.test(a) && /grant execute on function public\.primal_lesson_previews\(\) to anon, authenticated;/.test(a));
  ok("…and the stack function asks what the lesson's own rule asks before it names a lesson's drinks",
    /create or replace function public\.primal_menu_for_lesson/.test(a) && /l\.tier = 'rookie'\s+or exists/.test(a));
  ok("0442: every lesson is a buyer's (tier pro access), the stack too, and the stack is no longer anon's",
    /create policy "primal lessons read"/.test(b) && !/tier = 'rookie'/.test(b) && (b.replace(/^\s*--.*$/gm, "").match(/pa\.tier = 'pro'/g) || []).length === 3
      && /revoke all on function public\.primal_menu_for_lesson\(uuid\) from public, anon, authenticated;/.test(b));
  ok("both keep every migration's rules: a lock wait first, recorded, the lock wait reset",
    [[a, "0441_a_lessons_preview_is_anyones"], [b, "0442_the_course_is_bought_and_the_pillars_are_given"]].every(([m, n]) =>
      /^set lock_timeout = '5s';$/m.test(m) && m.includes(`select public.record_migration('${n}');`) && /^reset lock_timeout;/m.test(m)));
  const held = JSON.parse(read("supabase/held.json")).held;
  const paste = read("supabase/APPLY_ALL_PENDING.sql");
  ok("0442 is held until GT3 Nutrition is for sale — out of the paste file — and 0441 goes now",
    held.some((h) => h.file === "0442_the_course_is_bought_and_the_pillars_are_given.sql" && /for sale in the Shop/.test(h.until))
      && !/begin;   -- 0442,/.test(paste) && (/begin;   -- 0441,/.test(paste) || !/pending-from: 04[0-3]\d/.test(paste)));
  const pkg = JSON.parse(read("package.json"));
  ok("this file runs with every test, and its database half with the database's", /node scripts\/r44\.test\.mjs && node scripts\/r45\.test\.mjs/.test(pkg.scripts.test)
    && /node scripts\/db\.r45\.test\.mjs/.test(pkg.scripts["db:test"]));
}

console.log(`R45 — THE COURSE IS BOUGHT, THE PILLARS GIVEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
