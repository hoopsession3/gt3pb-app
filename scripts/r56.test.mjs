// R56 — WHAT THE MARKET SAYS, AND THE PLAN'S SCORE (2026-10-25 — phase D of the investor-ready vision: "continuous AI
// market research with citations, never invented… explainable 0–100 scores, not probabilities").
//
//   1 · Never invented: a finding is kept only when its address is one the web search returned (results or citations);
//       a link the model wrote is dropped, said as dropped, never stored.
//   2 · How old: a reading of the market on a day — stale past ninety days.
//   3 · The score, by hand: six factors on a written rubric, weighted; a factor that can't be judged is left out and
//       said; only accepted research counts; it says it isn't a probability.
//   4 · The wiring: owners and admins only; proposed until accepted; the claim guard; the score beside the money.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const V = loadTs("lib/visionResearch.ts"), S = loadTs("lib/visionScore.ts"), M = loadTs("lib/visionMoney.ts");

// ── 1 · never invented ──────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("addresses compared one way: https, no fragment, no trailing slash, the host lower-cased", V.normUrl("http://WWW.Example.com/a/#x") === "https://www.example.com/a" && V.normUrl("ftp://x") === null && V.normUrl("not a url") === null);
  const blocks = [
    { type: "server_tool_use", name: "web_search" },
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://gym.example/members", title: "Members" }, { type: "web_search_result", url: "https://city.example/permits/" }] },
    { type: "text", text: "…", citations: [{ type: "web_search_result_location", url: "https://news.example/story#p2" }] },
  ];
  const seen = V.searchedUrls(blocks);
  ok("the search's addresses: its results and its citations", seen.size === 3 && seen.has("https://city.example/permits") && seen.has("https://news.example/story"));
  const { kept, dropped } = V.verify([
    { topic: "demand", claim: "The gym has 2,400 members.", figure: "2,400", source_url: "https://gym.example/members" },
    { topic: "rules", claim: "A food permit is required.", source_url: "https://city.example/permits" },
    { topic: "costs", claim: "Rent is $30 a square foot.", source_url: "https://made-up.example/rent" },
    { topic: "vibes", claim: "People love it.", source_url: "https://gym.example/members" },
    { topic: "demand", claim: "", source_url: "https://gym.example/members" },
    { topic: "demand", claim: "The gym has 2,400 members.", source_url: "https://gym.example/members/" },
  ], seen);
  ok("kept: the two whose sources the search returned", kept.length === 2 && kept[0].figure === "2,400" && kept[1].topic === "rules", kept);
  ok("dropped: the made-up address, the unknown topic, the empty claim — each said why", dropped.length === 3 && dropped.some((d) => /search returned/.test(d.why)) && dropped.some((d) => /topics/.test(d.why)));
  ok("…and a repeat of the same claim from the same source is kept once", kept.filter((k) => k.topic === "demand").length === 1);
  ok("no search, nothing kept", V.verify([{ topic: "demand", claim: "x", source_url: "https://gym.example/members" }], new Set()).kept.length === 0);
}

// ── 2 · how old ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const now = Date.parse("2026-10-25T12:00:00Z");
  ok("read 10 days ago: fresh; 91 days: stale", V.age("2026-10-15T12:00:00Z", now).days === 10 && !V.age("2026-10-15T12:00:00Z", now).stale && V.age("2026-07-26T11:00:00Z", now).stale);
  ok("the domain said plainly", V.domainOf("https://www.gym.example/members") === "gym.example");
}

// ── 3 · the score ───────────────────────────────────────────────────────────────────────────────────────────────────
// R59 split the one score into Ryan's five assessments (scripts/r59.test.mjs works them by hand); here only what R56
// promised and still holds: no money, no score; only accepted research counts; never called a probability.
{
  ok("no money yet: no score — not a zero", S.score(M.BLANK, M.project(M.BLANK)).total === null);
  ok("only accepted research counts, and it says it isn't a probability", /r\.status === "accepted"/.test(read("lib/visionScore.ts")) && /not a probability of success/.test(read("lib/visionScore.ts")));
}

// ── 4 · the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = read("app/api/vision/research/route.ts"), panel = read("components/vision/MoneyPanel.tsx"), res = read("components/vision/Research.tsx"), sql = read("supabase/migrations/0450_what_the_market_says.sql");
  ok("the route: owners and admins only", /if \(!\(await adminFromRequest\(req\)\)\) return/.test(r));
  ok("…it holds the findings to the addresses the search returned", /const seen = searchedUrls\(blocks\)/.test(r) && /verify\(raw, seen\)/.test(r));
  ok("…stores them proposed, behind the claim guard", /status: "proposed"/.test(r) && /claimSafeDeep\(f\)/.test(r));
  ok("…and tells the model never to estimate or invent", /Never estimate, never fill a gap from what you know, never invent a number or a source/.test(r));
  ok("0450: https only, the six topics, proposed by default, admin's policy only", /source_url ~ '\^https:\/\/'/.test(sql) && /'proposed','accepted','rejected'/.test(sql) && /"vision research admin"/.test(sql) && !/to anon/.test(sql.replace(/from public, anon, authenticated/, "")));
  ok("the score sits beside the money, per scenario, and only accepted research counts", /<ScoreCard s=\{scores\[on\]\}/.test(panel) && /Assessed readiness score<\/th>/.test(panel));  // IP1.4: the precise name
  ok("each finding shows its source and its age; accepting says which way it bears — a person's reading; reject is a tap", /href=\{x\.source_url\}/.test(res) && /read \{a\.days\} day/.test(res) && /mark\(x\.id, "accepted", "for"\)/.test(res) && /mark\(x\.id, "accepted", "against"\)/.test(res) && /mark\(x\.id, "rejected"\)/.test(res));
  // 0450 is applied (2026-10-28): the research is read plainly, with no "arrives with" path left behind.
  ok("0450 is in: the research reads plainly — no path kept for before it", !/arrives-with: 0450/.test(panel) && !/arrives with the next database update \(0450\)/.test(res));
}

console.log(`R56 — WHAT THE MARKET SAYS, AND THE PLAN'S SCORE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
