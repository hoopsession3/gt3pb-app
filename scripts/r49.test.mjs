// R49 — THE CONSOLE ON EVERY PHONE, AND ITS HISTORY ON ONE SCREEN (2026-10-23 — Ryan: "were you able to audit a
// smokescreen test on the backend pages for all devices, iPhone [too]?"; "some stuff seems bigger than the others. Is
// it right?"; "audits across all consoles… 10 out of 10… no regression ever").
//
//   1 · the phone check: scripts/smoke.console.mjs, on a stand-in database (scripts/fixtures/fakebase.mjs), in verify.
//   2 · what it found, fixed: the menu's squeezed search, a warning cut off a line, fields past their panel, cut
//       placeholders and copy, rows that didn't line up, uneven tiles, targets under 24px.
//   3 · the Activity log: both trails (lib/activity), searched and narrowed by what and who; 0446's nine tables.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const css = read("app/globals.css");

// ── 1 · the phone check ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const s = read("scripts/smoke.console.mjs");
  const pkg = JSON.parse(read("package.json"));
  ok("it runs in verify — after the signed-in smoke, before the iPhone app's build — and CI says so",
    /npm run smoke:authed && npm run smoke:console && npm run build:app/.test(pkg.scripts.verify) && pkg.scripts["smoke:console"] === "node scripts/smoke.console.mjs"
      && /smoke:authed && smoke:console && build:app/.test(read(".github/workflows/ci.yml")));
  ok("three phones — iPhone 17, iPhone SE, iPhone 17 Pro Max — and every section the owner opens",
    /\{ key: "iphone-17", w: 402, h: 874, dpr: 3 \}/.test(s) && /\{ key: "iphone-se", w: 375, h: 667, dpr: 2 \}/.test(s) && /\{ key: "iphone-17-pro-max", w: 440, h: 956, dpr: 3 \}/.test(s)
      && /"day", "now", "command", "prep", "plan", "studio", "brew", "garage", "notes", "driver", "money", "catalog", "customers", "team", "settings"/.test(s));
  ok("each section is checked as drawn and again with every panel open",
    /section\.mpanel > button\.mpanel-h\[aria-expanded='false'\]/.test(s) && /panels open · every read and write answered/.test(s));
  ok("what fails it: the wall, a refused read, a page error, anything sideways, a word cut off, rows out of line, a target under 24px, type off the scale",
    /the console, signed in/.test(s) && /every read and write the screen made, answered/.test(s) && /no error on the page/.test(s) && /nothing sideways/.test(s)
      && /no word cut off by its box/.test(s) && /a list's rows line up/.test(s) && /every tap target at least 24 by 24 \(WCAG 2\.5\.8\)/.test(s)
      && /\[11, 12, 13, 15, 16, 17, 20, 22, 28, 34\]/.test(s));
  ok("no credential anywhere: a made-up key, an unsigned token for a made-up owner, the build's own folder, tsconfig put back",
    /const ANON = "fixture-anon-not-a-key";/.test(s) && /alg: "none"/.test(s) && /GT3_DIST_DIR: DIST/.test(s) && /delete ENV\.SUPABASE_SERVICE_ROLE_KEY;/.test(s)
      && /writeFileSync\("tsconfig\.json", tsconfig\);/.test(s) && /distDir: process\.env\.GT3_DIST_DIR \|\| "\.next"/.test(read("next.config.ts"))
      && /\/\.next-console\//.test(read(".gitignore")) && /\/\.smoke-console\//.test(read(".gitignore")));
  const f = read("scripts/fixtures/fakebase.mjs");
  ok("the stand-in answers as the database does: every read as the signed-in owner under RLS, a refusal its own 4xx, recorded",
    /set local role authenticated/.test(f) && /request\.jwt\.claim\.sub/.test(f) && /failures\.push\(/.test(f) && /PGRST116/.test(f) && /fullSchema/.test(f));
}

// ── 2 · what it found, fixed ─────────────────────────────────────────────────────────────────────────────────────────
{
  ok("a list's search takes its own row and the buttons wrap under it (the menu's search was squeezed to 26px)",
    /\.studio-top\{display:flex;flex-wrap:wrap;/.test(css) && /\.studio-top > input\[type=search\]\{flex:1 1 calc\(100% - 110px\);min-width:0\}/.test(css));
  ok("form pairs share the width evenly and stack on a phone where they can't (a date ran 218px past its panel)",
    /\.prod-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(css) && /@media \(max-width:480px\)\{\.prod-grid\.stack-sm\{grid-template-columns:minmax\(0,1fr\)\}\}/.test(css)
      && (read("components/BroadcastEditor.tsx").match(/className="prod-grid stack-sm"/g) ?? []).length === 2);
  ok("a warning is never the part of a line that's cut: a code's line wraps, a drink's flag wraps, the initiative's date comes first",
    /\.k-rsub:has\(\.codes-warn\)\{white-space:normal\}/.test(css) && /\.cogs-nm\{overflow-wrap:anywhere\}/.test(css) && /\.cogs-meta\{display:flex;flex-wrap:wrap/.test(css) && !/\.cogs-name\{[^}]*white-space:nowrap/.test(css)
      && /status=\{lead \? <><span className=\{leadDays != null && leadDays < 0 \? "text-warn" : undefined\}>\{leadWhen\}<\/span>\{leadName\}\{leadRest\}<\/> : "None active"\}/.test(read("components/CommandBoard.tsx")));
  ok("tiles sit even: the shop's order tiles a 2×2 grid, App health's four two by two on an SE",
    /<div className="grid grid-cols-2 min-\[560px\]:grid-cols-4 gap-2 mb-3">/.test(read("components/ShopOrders.tsx")) && /<div className="mnt-kpis max-\[389px\]:grid-cols-2">/.test(read("components/MaintenanceLog.tsx")));
  ok("Funnels' window is the kit's segmented control, as Sales' is — not chips of its own",
    /<Segmented label="Window" kind="choice" size="sm"/.test(read("components/FunnelReport.tsx")) && !/fn-day/.test(read("components/FunnelReport.tsx")) && !/\.fn-day/.test(css));
  ok("Events' P&L rows: the chevron follows the name, the missing costs said short (the sentence is under the list)",
    /name=\{<span>\{r\.event\}\{id \? <span className="rpt-pnl-go" aria-hidden>/.test(read("components/EventPnlReport.tsx")) && /const assumed = r\.costs_saved === false \? " · costs not saved" : "";/.test(read("components/EventPnlReport.tsx")));
  ok("merch rows line up: the photo tile never shrinks for a long title", (read("components/MerchManager.tsx").match(/width: 26, height: 26, flexShrink: 0/g) ?? []).length === 2);
  ok("words fit their fields: shorter hints, a long copy line in a box that grows (and keeps the cursor), the splash's pair wraps",
    /placeholder="Their email"/.test(read("components/nutrition/CourseStudents.tsx")) && /placeholder="Search students"/.test(read("components/nutrition/CourseStudents.tsx"))
      && /placeholder="\/reserve"/.test(read("components/BroadcastEditor.tsx")) && /placeholder="e\.g\. Flow cacao per gallon"/.test(read("components/AiTraining.tsx"))
      && /placeholder="Search orders" aria-label="Search order history"/.test(read("app/crew/page.tsx"))
      && /\(m\.default \?\? ""\)\.length > 26/.test(read("components/SiteCopyEditor.tsx")) && /if \(e\.key === "Enter"\) e\.preventDefault\(\);/.test(read("components/SiteCopyEditor.tsx"))
      && /\.goal-new-row\{display:flex;flex-wrap:wrap;gap:8px\}/.test(css));
  ok("the lessons' new-lesson picker has its own row, and its words say what's free now (the four pillars)",
    /onChange=\{\(e\) => setNewMod\(e\.target\.value\)\} className="basis-full!"/.test(read("components/LessonsManager.tsx"))
      && /The four pillars are free; every other lesson opens with GT3 Nutrition\./.test(read("components/LessonsManager.tsx")) && !/Rookie is free/.test(read("components/LessonsManager.tsx")));
  ok("small controls reach 24px where a finger lands, their look unchanged; a row's tappable body is the row's height",
    /\.spb-bud::after,\.pbd-group-t::after,\.rhythm-last::after,\.rec-link::after,\.st-discuss::after,\.sc-view-live::after\{content:"";position:absolute;inset:-8px -4px\}/.test(css)
      && /\.pbd-check\{flex:0 0 auto;width:24px;height:24px;/.test(css) && /\.k-bd\[role=button\]\{align-self:stretch;[^}]*min-height:44px\}/.test(css) && /\.prod-toggle\{[^}]*min-height:32px/.test(css));
}

// ── 3 · the Activity log ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const A = loadTs("lib/activity.ts");
  ok("a change said as 0260 says it: what moved, timestamps left out, a long value cut short",
    A.diffWords({ status: "new", total_cents: 1400, updated_at: "a" }, { status: "ready", total_cents: 1400, updated_at: "b" }) === "status: new → ready"
      && A.diffWords({ note: null }, { note: "x".repeat(60) }) === `note: ∅ → ${"x".repeat(39)}…` && A.diffWords(null, { a: 1 }) === null);
  const lines = A.mergeTrails(
    [{ id: 1, actor: "u1", action: "UPDATE", table_name: "shop_products", row_pk: "p1", summary: "published_at: x → ∅", created_at: "2026-10-23T10:00:00Z" }],
    [{ id: 7, actor: "u2", op: "UPDATE", table_name: "event_tasks", row_id: "t1", old_data: { title: "Prep", done: false }, new_data: { title: "Prep", done: true }, at: "2026-10-23T11:00:00Z" },
     { id: 8, actor: "u2", op: "UPDATE", table_name: "event_tasks", row_id: "t1", old_data: { updated_at: "a" }, new_data: { updated_at: "b" }, at: "2026-10-23T12:00:00Z" },
     { id: 9, actor: null, op: "INSERT", table_name: "orders", row_id: "o1", old_data: null, new_data: { customer: "Kim" }, at: "2026-10-23T09:00:00Z" }]);
  ok("both trails, one list, newest first — a touch that changed only a timestamp is no line",
    JSON.stringify(lines.map((l) => l.key)) === '["l7","a1","l9"]' && lines[0].summary === "done: false → true" && lines[0].title === "Prep" && lines[2].title === "Kim", lines);
  ok("search: every typed word in who, what, the thing or the change",
    A.lineMatches(lines[0], "Dev", "dev prep") && A.lineMatches(lines[1], "Ryan", "shop product") && !A.lineMatches(lines[1], "Ryan", "prep") && A.lineMatches(lines[2], "System", ""));
  ok("named on the screen: the new kinds of thing", A.labelOf("event_tasks") === "Prep task" && A.labelOf("business_orders") === "Office order" && A.labelOf("some_table") === "some table");
  const t = read("components/AuditTrail.tsx");
  ok("the screen reads both trails, is searched and narrowed by what and who, says how much is shown, and exports what's shown",
    /supabase\.from\("admin_audit"\)/.test(t) && /supabase\.from\("audit_log"\)/.test(t) && /type="search".*aria-label="Search the activity log"/.test(t)
      && /aria-label="What changed"/.test(t) && /aria-label="Who changed it"/.test(t) && /downloadCsv\("gt3-change-log\.csv", shown\.map/.test(t) && /of the last \$\{lines\.length\} changes/.test(t));
  const m = read("supabase/migrations/0446_every_list_the_console_edits_keeps_its_history.sql");
  ok("0446: nine tables under 0042's trail — customers and the bottle proofs left out, on purpose, and why",
    /array\['invoices', 'broadcasts', 'event_tasks', 'events', 'stops', 'shoots', 'shots', 'business_orders', 'todos'\]/.test(m) && /public\.audit_row\(\)/.test(m)
      && /NOT HERE, ON PURPOSE: customers and vip_verifications/.test(m) && /select public\.record_migration\('0446_every_list_the_console_edits_keeps_its_history'\);/.test(m));
  const A2 = await import(join(ROOT, "scripts/console.audit.mjs"));
  ok("the console audit counts either trail as history, and the Activity log is 4/4", A2.auditedTables().has("event_tasks") && A2.auditedTables().has("orders") && A2.FLOOR.activity === "4/4");
}

console.log(`R49 — THE CONSOLE ON EVERY PHONE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
