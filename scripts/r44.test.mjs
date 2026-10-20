// R44 — GT3 NUTRITION (2026-10-20 — Ryan: "Animation is going to be important for the GT3 nutrition campaign… ensure
// users can track and return to their progress… they get a badge… reference and search… allow the MindNode and Miro
// boards to be recreated… but also allow a static version of it to be downloaded"; the Haptics and Motion Playbook).
//
//   1 · lib/nutrition, compiled: the course order, the next lesson, progress, the Rookie badge, the Today card's pick.
//   2 · the maps: every free map is a public file of the size it says; every Pro map is not public, is kept where its
//       route reads it, and ships with that route; the app's export leaves the files on the web.
//   3 · the Pro route hands a map only to the crew or a member with Pro, and says Pro (not missing) to anyone else.
//   4 · the haptics: one signature feel, the heartbeat (medium, then light 150 ms later), played in one place — where the
//       last Rookie lesson is marked complete — and the course's taps say what they are.
//   5 · the motion: the playbook's recipes are classes; nothing new animates a layout property; Reduce Motion also
//       zeroes delays, so a staggered list is never hidden for its delay.
//   6 · the brand: GT3 Nutrition is the name everywhere a customer reads it; Return to Primal is the course.
//   7 · the sources: the owner's MindNode maps and the Miro boards' words are kept in the repo.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const N = loadTs("lib/nutrition.ts");

// ── 1 · lib/nutrition ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const pillars = [{ id: "P2", slug: "movement", title: "Movement", sort: 20 }, { id: "P1", slug: "nutrition", title: "Nutrition", sort: 10 }];
  const modules = [{ id: "M2", pillar_id: "P1", title: "Micro", sort: 20 }, { id: "M1", pillar_id: "P1", title: "Macro", sort: 10 }, { id: "M3", pillar_id: "P2", title: "Release", sort: 10 }, { id: "MX", pillar_id: "GONE", title: "Orphan", sort: 1 }];
  const L = (id, module_id, slug, sort, tier = "rookie", key_points = []) => ({ id, module_id, slug, title: slug, tier, sort, key_points });
  const lessons = [L("c", "M2", "ruminant-red", 10, "rookie", ["Iron, zinc, B12"]), L("a", "M1", "power-carbs", 10, "rookie", ["Time carbs to movement", "Keep the package"]), L("b", "M1", "steady-energy", 20, "rookie", ["Spikes crash"]), L("d", "M3", "move-to-release", 10, "pro"), L("x", "MX", "orphan", 1)];
  const order = N.courseOrder(pillars, modules, lessons);
  ok("the course is taken pillar by pillar, module by module, lesson by lesson — and a lesson with nowhere to sit is left out",
    order.map((l) => l.id).join() === "a,b,c,d", order.map((l) => l.id));
  ok("the next lesson is the first not done; none when every one is", N.nextLesson(order, new Set(["a"]))?.id === "b" && N.nextLesson(order, new Set(["a", "b", "c", "d"])) === null);
  const p = N.progressOf(order, new Set(["a", "zzz"]));
  ok("progress counts only lessons on the path — a stray id done elsewhere is not progress", p.done === 1 && p.total === 4 && p.pct === 0.25, p);
  ok("an empty course is 0%, never NaN", N.progressOf([], new Set()).pct === 0);
  ok("the Rookie badge: every Rookie lesson done — a Pro lesson not needed — and never on a course with no Rookie lessons",
    N.rookieComplete(order, new Set(["a", "b", "c"])) && !N.rookieComplete(order, new Set(["a", "b"])) && !N.rookieComplete([], new Set()) && !N.rookieComplete(order.filter((l) => l.tier === "pro"), new Set(["d"])));
  ok("the badge's seen-mark is per person", N.badgeSeenKey("u1") !== N.badgeSeenKey("u2"));
  const t1 = N.todayPick("training", order, new Set(), 3);
  ok("Today, a day told: its lesson (Training → Power Carbs), with one of its own key points", t1.kind === "lesson" && t1.lesson.slug === "power-carbs" && ["Time carbs to movement", "Keep the package"].includes(t1.point) && /Training/.test(t1.kicker), t1);
  const t2 = N.todayPick("easy", order.filter((l) => l.slug !== "ruminant-red"), new Set(["a"]), 0);
  ok("…a day whose lesson this reader can't open falls back to their next lesson", t2.kind === "lesson" && t2.lesson.id === "b", t2);
  const tips = [0, 1, 2, 3].map((d) => N.todayPick(null, order, new Set(), d));
  ok("Today, no day told: a key point of the course's own, as the day's tip — a different one each day, back round again",
    tips.every((x) => x.kind === "tip") && new Set(tips.map((x) => x.point)).size === 4 && N.todayPick(null, order, new Set(), 4).point === tips[0].point && N.todayPick(null, order, new Set(), -1).point === tips[3].point);
  ok("…and a course with no lessons shows nothing", N.todayPick(null, [], new Set(), 0).kind === "none");
  ok("the tip turns over at the reader's own midnight", N.dayNumber(new Date(2026, 0, 1, 23, 59)) === 0 && N.dayNumber(new Date(2026, 0, 2, 0, 1)) === 1);
  ok("sizes are said the way a phone shows them", N.sizeLabel(1704735) === "1.7 MB" && N.sizeLabel(264557) === "265 KB" && N.sizeLabel(0) === "");
}

// ── 2 · the maps ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const free = N.MAPS.filter((m) => m.tier === "free"), pro = N.MAPS.filter((m) => m.tier === "pro");
  ok("fifteen maps: Rookie free, the pillars Pro (the owner's call)", N.MAPS.length === 15 && free.every((m) => m.level === "Rookie") && pro.every((m) => m.level !== "Rookie") && pro.length === 4);
  ok("slugs and files are unique", new Set(N.MAPS.map((m) => m.slug)).size === 15 && new Set(N.MAPS.map((m) => m.file)).size === 15);
  const wrongSize = free.filter((m) => !existsSync(join(ROOT, "public/nutrition/maps", m.file)) || statSync(join(ROOT, "public/nutrition/maps", m.file)).size !== m.bytes);
  ok("every free map is a public PDF of exactly the size the row says", wrongSize.length === 0, wrongSize.map((m) => m.file));
  const proWrong = pro.filter((m) => !existsSync(join(ROOT, "content/nutrition/pro", m.file)) || statSync(join(ROOT, "content/nutrition/pro", m.file)).size !== m.bytes || existsSync(join(ROOT, "public/nutrition/maps", m.file)));
  ok("every Pro map is kept in content/nutrition/pro, of the size it says — and is not a public file", proWrong.length === 0, proWrong.map((m) => m.file));
  ok("nothing in public/nutrition that MAPS does not name — no stray file a guest could fetch", readdirSync(join(ROOT, "public/nutrition/maps")).every((f) => free.some((m) => m.file === f)), readdirSync(join(ROOT, "public/nutrition/maps")));
  ok("a free map's address is the public file; a Pro map's, its route", N.mapHref(free[0]) === `/nutrition/maps/${free[0].file}` && N.mapHref(pro[0]) === `/api/nutrition/map/${pro[0].slug}` && N.proMap(pro[0].slug) === pro[0] && N.proMap(free[0].slug) === null && N.proMap("../etc") === null);
  ok("the Pro files ship with their route (next.config outputFileTracingIncludes)", /outputFileTracingIncludes: \{ "\/api\/nutrition\/map\/\*": \["\.\/content\/nutrition\/pro\/\*\*"\] \}/.test(read("next.config.ts")));
  ok("the app's export leaves the maps on the web, and the library links them there", /"public\/nutrition", "public\/googlec1457e9c5896ea60\.html", "app\/\.well-known"\];/.test(read("scripts/build.app.mjs"))
    && /href=\{apiUrl\(mapHref\(m\)\)\} download/.test(read("components/nutrition/MapLibrary.tsx")));
}

// ── 3 · the Pro route ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = code(read("app/api/nutrition/map/[slug]/route.ts"));
  ok("the Pro route: only a named Pro map; a sign-in; the crew or a member with a live Pro row; Pro said, not missing",
    /const map = proMap\(slug\);\s+if \(!map\) return Response\.json\(\{[^}]+\}, \{ status: 404 \}\);/.test(r)
    && /if \(!user\) return Response\.json\(\{[^}]+\}, \{ status: 401 \}\);/.test(r)
    && /const allowed = \(await staffFromRequest\(req\)\) \|\| \(await memberHasPro\(req, user\.id\)\);\s+if \(!allowed\) return Response\.json\(\{ ok: false, error: "This map is part of GT3 Nutrition Pro\." \}, \{ status: 403 \}\);/.test(r)
    && /\.from\("program_access"\)\.select\("tier"\)\.eq\("customer_id", cid\)\.eq\("tier", "pro"\)\.is\("revoked_at", null\)/.test(r)
    && /"Cache-Control": "private, no-store"/.test(r) && /export const GET = route\("nutrition\/map", get\);/.test(r));
  ok("…and reads the file by the map's own name, never the address's", /join\(process\.cwd\(\), "content", "nutrition", "pro", map\.file\)/.test(r) && !/join\([^)]*slug/.test(r));
}

// ── 4 · the haptics ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const H = loadTs("lib/haptics.ts");
  ok("the signature is the heartbeat: medium, then light 150 ms later — on an iPhone and as a vibration",
    JSON.stringify(H.HAPTIC_UIKIT.signature) === JSON.stringify([{ kind: "impact", style: "MEDIUM" }, { kind: "impact", style: "LIGHT", after: 150 }])
    && JSON.stringify(H.HAPTIC_PATTERNS.signature) === JSON.stringify([12, 138, 8]));
  const files = [];
  const walk = (d) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) { if (!/node_modules|\.next|^out$/.test(f)) walk(p); } else if (/\.(tsx?|mjs)$/.test(f)) files.push(p); } };
  walk("components"); walk("app"); walk("lib");
  const users = files.filter((f) => /haptic\("signature"\)/.test(read(f)));
  ok("one signature moment in the whole app — the Rookie badge, where it is earned", users.length === 1 && users[0] === join("components", "PrimalLesson.tsx"), users);
  const les = code(read("components/PrimalLesson.tsx"));
  ok("…played under the finger that marked the last lesson, once per reader on this phone; any other lesson is success, and a failed save is felt and said",
    /if \(error\) \{ haptic\("error"\); setSaveErr\(true\); return; \}/.test(les)
    && /if \(last && !seen\) \{ haptic\("signature"\); setEarnedNow\(true\); \} else haptic\("success"\);/.test(les)
    && /localStorage\.setItem\(badgeSeenKey\(user\.id\), "1"\)/.test(les)
    && /\{saveErr && <p className="pr-note pr-note-err mt-3! mb-0!" role="alert">/.test(les));
  const map = code(read("components/nutrition/CourseMap.tsx"));
  ok("the course map moves like detents: a tick per point, the boundary feel at either end — from a tap or the arrow keys",
    /if \(i < 0 \|\| i >= nodes\.length\) \{ haptic\("boundary"\); return; \}/.test(map) && /if \(i !== sel\) haptic\("selection"\);/.test(map)
    && /e\.key === "ArrowDown"/.test(map) && /e\.key === "ArrowUp"/.test(map) && /<button\s/.test(map) && !/role="button"/.test(map));
  ok("every haptic on the course screens has a visible change with it — the moments that buzz all change what is drawn",
    /haptic\("light"\)/.test(read("components/nutrition/MapLibrary.tsx")) && /setBusy\(m\.slug\)/.test(read("components/nutrition/MapLibrary.tsx")));
}

// ── 5 · the motion ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const css = read("app/globals.css"), kit = read("components/nutrition/nutrition.css");
  ok("the playbook's numbers are the house's tokens: ease-out cubic, 180 ms glow, 520 ms shape, 380 ms stagger, 1.9 s draw, 1.6 s pulse",
    /--ease-out-cubic:cubic-bezier\(\.33,1,\.68,1\);/.test(css) && /--dur-glow:180ms;--dur-shape:520ms;--dur-stagger:380ms;--dur-draw:1\.9s;--dur-pulse:1\.6s;/.test(css));
  ok("the recipes are classes: rise (stagger), pop (shape), draw, pulse (1 → 1.8, .55 → 0), segments (160 ms, 70 ms apart), glow",
    /@keyframes fxPulse\{from\{opacity:\.55;transform:scale\(1\)\}to\{opacity:0;transform:scale\(1\.8\)\}\}/.test(kit)
    && /\.fx-rise\{animation:fxRise var\(--dur-stagger\)/.test(kit) && /\.fx-pop\{animation:fxPop var\(--dur-shape\)/.test(kit)
    && /\.fx-draw \[pathLength\]\{stroke-dasharray:1;stroke-dashoffset:1;animation:fxDraw var\(--dur-draw\)/.test(kit)
    && /animation:fxSeg 160ms var\(--ease-out-cubic\) both;animation-delay:calc\(var\(--i,0\) \* 70ms\)/.test(kit)
    && /\.fx-glow:focus-visible\{transform:translateY\(-2px\);box-shadow:0 0 0 1px color-mix\(in srgb, var\(--glow-c\) 70%, transparent\),0 0 26px/.test(kit));
  ok("the glow is the element's own colour — written out where it is used, since a token would freeze the root's colour", !/var\(--glow\)/.test(css + kit) && /\.nu-lib-row\.pro\{--glow-c:var\(--red-h\)\}/.test(kit));
  ok("Reduce Motion zeroes delays as well as durations — a staggered row is never hidden for its delay",
    /animation-iteration-count:1!important;animation-delay:0s!important;transition-duration:\.001ms!important;transition-delay:0s!important;/.test(css));
  const keyframes = [...kit.matchAll(/@keyframes \w+\{([^]*?)\}\}/g)].map((m) => m[1]);
  ok("the kit animates only transform, opacity and the stroke it draws — nothing that reflows",
    keyframes.length === 5 && keyframes.every((k) => !/(width|height|margin|top|left|padding)\s*:/.test(k)), keyframes);
  ok("the course's progress is segments that fill by scaleX — the old width-animated bar is gone", !/\.pr-bar/.test(css + read("components/nutrition/academy.css")) && /\.fx-segs>i\.on::after\{[^}]*transform-origin:left center/.test(kit));
  ok("…and nothing in the course's styles transitions a layout property", !/transition:[^;}]*(width|height|margin|padding|top|left)/.test(kit));
  ok("the course's stylesheet rides with the course alone — not every route's download",
    !/THE MOTION KIT|nu-today|nu-map/.test(css) && ["components/PrimalAcademy.tsx", "components/PrimalLesson.tsx", "components/nutrition/NutritionToday.tsx"].every((f) => /^import "@\/components\/nutrition\/nutrition\.css";$/m.test(read(f))));
  const academy = read("components/nutrition/academy.css");
  ok("…and so do the course pages' own rules (.primal, .pr-*): out of the house sheet, into academy.css, imported by the two course screens alone",
    !/^\.primal\{|^\.pr-card\{|^\.pr-hero/m.test(css) && /^\.primal\{--accent:var\(--gold2\)\}/m.test(academy) && /^\.pr-card\{--glow-c:/m.test(academy)
    && ["components/PrimalAcademy.tsx", "components/PrimalLesson.tsx"].every((f) => /^import "@\/components\/nutrition\/academy\.css";$/m.test(read(f)))
    && !/academy\.css/.test(read("components/nutrition/NutritionToday.tsx")));
}

// ── 6 · the brand ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const copy = read("lib/copy.ts");
  ok("GT3 Nutrition is the name a customer reads — the masthead, the menu's link, the route title, the page title — and Return to Primal is the course",
    /\{ key: "primal\.eyebrow", default: "GT3 Nutrition" \}/.test(copy) && /\{ key: "menu\.nav_primal", default: "GT3 Nutrition" \}/.test(copy)
    && /\{ key: "primal\.hero_h1", default: "Return to" \}/.test(copy) && /\{ key: "primal\.hero_h1_em", default: "Primal" \}/.test(copy)
    && /primal: "GT3 Nutrition"/.test(read("lib/routeTitles.ts")) && /title: "GT3 Nutrition", \.\.\.pageMeta\("\/primal"\)/.test(read("app/primal/page.tsx")));
  ok("the Today card sits after the rows, in its own chunk, and reads the day again when the stack's sheet closes",
    /const NutritionToday = dynamic\(\(\) => import\("@\/components\/nutrition\/NutritionToday"\)\);/.test(read("components/today/TodayHome.tsx"))
    && /<NutritionToday stamp=\{stack\} \/>/.test(read("components/today/TodayHome.tsx"))
    && /useSyncExternalStore\(noSubscribe, readStack, \(\) => null\)/.test(read("components/nutrition/NutritionToday.tsx")));
}

// ── 7 · the sources ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const mn = readdirSync(join(ROOT, "content/nutrition/source/mindnode")).filter((f) => f.endsWith(".mindnode"));
  ok("the six MindNode maps are kept as the owner made them", mn.length === 6, mn);
  const outl = readdirSync(join(ROOT, "content/nutrition/outlines")).filter((f) => f.endsWith(".md"));
  ok("…each read into an outline the PDFs are built from", outl.length === 6 && mn.every((f) => outl.includes(f.replace(/\.mindnode$/, ".md"))));
  ok("the Miro boards with no export of their own are kept in the owner's words — the Engine and the Rookie hub",
    /Four Pillars To Primal/.test(read("content/nutrition/source/miro-text/return-to-primal-engine.md")) && /Who's Is This For\? Who's A Rookie\?/.test(read("content/nutrition/source/miro-text/return-to-primal-rookie-hub.md")));
}

console.log(`\nr44: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
