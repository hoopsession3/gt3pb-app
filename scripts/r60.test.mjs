// R60 — RESEARCH ON A SCHEDULE, WITH CHANGE DETECTION (2026-10-25 — Ryan: "research should refresh on demand and through
// configurable scheduled checks, with change detection and alerts when material findings affect an initiative").
//
//   1 · Due: a schedule set, and never run or run longer ago than it.
//   2 · What's new: a source and claim already stored for the plan, in any state, isn't stored again.
//   3 · The wiring: a scheduled call that isn't due spends nothing; a run stamps when it ran; something new raises one
//       quiet alert to whoever set the schedule; the console runs one due check a visit, in the background.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const V = loadTs("lib/visionResearch.ts");
const NOW = Date.parse("2026-10-25T12:00:00Z");
{
  ok("never scheduled: never due", !V.isDue({ research_every_days: 0, research_last_at: null }, NOW));
  ok("scheduled, never run: due", V.isDue({ research_every_days: 30, research_last_at: null }, NOW));
  ok("every 30 days, run 29 days ago: not yet; 30 days ago: due", !V.isDue({ research_every_days: 30, research_last_at: "2026-09-26T12:00:01Z" }, NOW) && V.isDue({ research_every_days: 30, research_last_at: "2026-09-25T12:00:00Z" }, NOW));
  const known = [{ source_url: "https://gym.example/members", claim: "The gym has 2,400 members." }];
  const found = [{ source_url: "http://GYM.example/members/", claim: "  the gym has 2,400 members. " }, { source_url: "https://gym.example/members", claim: "Members grew 10% this year." }];
  const n = V.novel(found, known);
  ok("the same source and claim, written another way, isn't new; a new claim from the same source is", n.length === 1 && n[0].claim === "Members grew 10% this year.", n);
  ok("nothing known: everything is new", V.novel(found, []).length === 2);
}
{
  const r = read("app/api/vision/research/route.ts"), app = read("components/vision/VisionApp.tsx"), res = read("components/vision/Research.tsx"), sql = read("supabase/migrations/0453_research_on_a_schedule.sql");
  ok("0453: never by default; 30, 60 or 90 days only", /research_every_days smallint not null default 0/.test(sql) && /research_every_days in \(0, 30, 60, 90\)/.test(sql));
  ok("a scheduled call that isn't due spends nothing", /if \(scheduled && !isDue\(p\)\) return/.test(r) && r.indexOf("!isDue(p)") < r.indexOf("callClaude({"));
  ok("only what's new is stored", /const fresh = novel\(safe, /.test(r) && /insert\(fresh\.map/.test(r));
  ok("a run stamps when it ran", /research_last_at: new Date\(\)\.toISOString\(\)/.test(r));
  ok("something new on a schedule: one quiet alert to whoever set it", /if \(scheduled && fresh\.length\) await raiseAlert\(\{ severity: "fyi", category: "strategy"/.test(r) && /targetUserId: p\.research_by/.test(r));
  ok("the console runs one due check a visit, owners and admins only", /\{canEdit && <DueChecks plans=\{v\.plans\} \/>\}/.test(app) && /plans\.find\(\(p\) => isDue\(p\)\)/.test(app) && /started\.current = true/.test(app));
  ok("the schedule is set beside the research, and says how it runs", /Check it again/.test(res) && /it runs when an owner or admin opens the vision, and finds only what's new/.test(res));
}
console.log(`R60 — RESEARCH ON A SCHEDULE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
