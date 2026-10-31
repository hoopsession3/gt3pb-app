// IMS7-F — INVESTOR-SAFE INTELLIGENCE. An investor sees only the readiness the investor view already shows, through the
// contract, in fixed words; nothing the investor pages load can reach recipes, ratios, the library, supplier prices,
// internal notes or unaccepted research — checked on the pages' whole import graph and on the share function itself.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 600)}` : ""}`); } };
const X = loadTs("lib/investorView.ts"), S = loadTs("lib/visionScore.ts"), I = loadTs("lib/insight.ts");

// ── 1 · the readiness an investor sees ──
const B = (key, status, o = {}) => ({ key, kind: "x", says: `ENGINE SAYS ${key}`, effect: "x", criterion: null, status, acknowledged: null, need: null, remedy: S.REMEDY[key], ...o });
const sc = (blockers) => ({ total: 62, readiness: "internal", says: "", coverage: 70, blockers, open: 0, method: S.SCORE_METHOD.version, assessments: {}, actions: [] });
const r = X.investorReadiness(sc([B("demand_unvalidated", "open"), B("no_downside", "in_remediation"), B("costs_unpriced", "acceptance_lapsed"),
  B("evidence_against", "risk_accepted", { acknowledged: { key: "evidence_against", note: "OWNER'S PRIVATE NOTE — supplier quote $4,200", at: "2026-10-20", reviewBy: "2026-12-01" } })]), { kind: "plan", id: "p" });
ok("still to close: open, being worked on, and a lapsed acceptance — in the engine's own words", r.open.join("|") === ["Demand isn't validated", "No downside case", "Startup costs not priced"].map((w) => w.toLowerCase()).join("|"), r.open);
ok("…accepted as a risk: said as accepted, never as resolved", r.accepted.join() === "research weighs against the plan" && r.insights.find((i) => i.rule === "evidence_against").state === "risk_accepted");
ok("…the readiness stage in its policy word", r.readiness === S.READINESS_WORD.internal);
ok("fixed words only: no owner's note, no engine free text, no dollar figure", !JSON.stringify(r).includes("PRIVATE") && !JSON.stringify(r).includes("ENGINE SAYS") && !/\$\d/.test(JSON.stringify(r)));
ok("…each insight reduced to identity, level, words, state and method version", r.insights.every((i) => Object.keys(i).sort().join() === "basis,id,level,rule,state,words" && i.basis.version === S.SCORE_METHOD.version && i.basis.asOf === null));
ok("nothing else is investor-visible in the contract: Advisor, room, library, money, alerts", (() => {
  const others = [I.fromSpace({ ids: ["a"], level: "error", words: "w", check: "door", source: "detected" }, { kind: "layout", id: "r" }),
    I.fromMoney({ key: "dispute:d", level: "critical", title: "t", detail: "d", side: "s", go: { section: "m" } }),
    I.fromAlert({ id: "a", severity: "critical", category: "money", title: "t", created_at: "2026-10-30T00:00:00Z" }),
    ...I.fromLibrary({ id: "m", name: "x", status: "candidate" }, { blockers: ["b"], pending: 2 })];
  return I.visibleTo(others, ["investor"]).length === 0; })());
const slide = read("components/vision/CaseSlide.tsx");
ok("the pitch's readiness line asks the investor view — one rule, not its own filter", /const \{ open, accepted \} = investorReadiness\(sc, \{ kind: "plan", id: "case" \}\);/.test(slide) && !/sc\.blockers\.filter\(\(x\) => x\.status !== "risk_accepted"\)/.test(slide));

// ── 2 · what the investor pages can reach ──
const ENTRY = ["app/present/page.tsx", "components/vision/Present.tsx", "components/vision/CaseSlide.tsx", "components/vision/CaseWords.tsx"];
const FORBID = /lib\/(academyCookbook|strategyContent|academyLessons|experienceLibrary|libraryResearch|libraryReview|libraryIntake|planFixtures|anthropic|serverAlerts|moneyAttention)\b|components\/vision\/(Library|LibraryIntake|FoodLab|MenuStudio|Standard|ThingInsight)\b/;
const resolve = (from, spec) => {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? join(dirname(join(ROOT, from)), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(c) && !c.endsWith("/")) { try { readdirSync(c); } catch { return c.slice(ROOT.length); } }
  return null;
};
const seen = new Set(), reached = [];
const walk = (f) => {
  if (seen.has(f)) return; seen.add(f); reached.push(f);
  const src = read(f);
  // Type-only imports are erased from the bundle: they carry no code and no text, so they are not followed.
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s(?!type\s)[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1] ?? m[2]; const to = resolve(f, spec);
    if (!to || !/\.(ts|tsx)$/.test(to)) continue;
    // A chunk loaded only where it's drawn, behind the editing gate, is listed rather than followed (checked below).
    if (m[2] && GATED.has(`${f}→${to}`)) { gated.push(`${f}→${to}`); continue; }
    walk(to);
  }
};
const GATED = new Set(["components/vision/StoreDesigner.tsx→components/vision/LibraryLink.tsx", "components/vision/StoreDesigner.tsx→components/vision/ThingInsight.tsx",
  "components/vision/MoneyPanel.tsx→components/vision/FixturesInPlan.tsx"]);
const gated = [];
for (const e of ENTRY) walk(e);
const bad = reached.filter((f) => FORBID.test(f));
ok(`the investor pages' whole import graph (${reached.length} files) reaches no recipe, lesson, strategy, library, research, supplier or HQ-only module`, reached.length > 10 && bad.length === 0, bad);
const des = read("components/vision/StoreDesigner.tsx"), gate = des.indexOf("if (!canEdit) {", des.indexOf("function Inspector("));
ok("…the library and the Studio's one line load only where drawn, and are drawn only in the editing inspector (never for a link's viewer)",
  /const LibraryLink = dynamic\(\(\) => import\("\.\/LibraryLink"\), \{ ssr: false \}\);/.test(des) && /const ThingInsight = dynamic\(\(\) => import\("\.\/ThingInsight"\), \{ ssr: false \}\);/.test(des)
  && gate > 0 && des.indexOf("<ThingInsight", gate) > gate && des.indexOf("<LibraryLink", gate) > gate && (des.match(/<ThingInsight /g) ?? []).length === 1 && (des.match(/<LibraryLink /g) ?? []).length === 1, gated);
const mp = read("components/vision/MoneyPanel.tsx");
ok("…the room's fixture reconciliation loads only inside the owners' money panel (past its own gate)", /const FixturesInPlan = dynamic\(\(\) => import\("\.\/FixturesInPlan"\), \{ ssr: false \}\);/.test(mp) && mp.indexOf("<FixturesInPlan") > mp.indexOf("if (!canEdit) return"));
const present = read("app/present/page.tsx");
ok("…and a link's viewer gets the Studio read-only", /<StoreDesigner[^>]*canEdit=\{false\}/.test(present), present.match(/<StoreDesigner[^>]*>/)?.[0]);

// ── 3 · what the share function sends ──
const migs = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const last = migs.filter((f) => /function public\.vision_shared\(p_token text\)/.test(read(`supabase/migrations/${f}`))).at(-1);
const sqlAll = read(`supabase/migrations/${last}`);
const i0 = sqlAll.indexOf("function public.vision_shared(p_token text)");
const fn = sqlAll.slice(i0, sqlAll.indexOf("$$;", sqlAll.indexOf("$$", i0) + 2));
ok(`the share function (its latest, ${last}) reads no recipe, library, research draft, Standard or AI table`, !/food_recipes|std_|academy|ai_usage|vision_plan_money\b|alerts/.test(fn), (fn.match(/food_recipes|std_\w+|academy\w*|ai_usage|vision_plan_money\b|alerts/g) ?? []));
ok("…its research is accepted findings only, as pinned", /r\.status = 'accepted' and r\.retrieved_at <= s\.pinned_at/.test(fn));
ok("…its money is the approved version in force when the link was pinned, only where an owner chose to show it — trimmed at the door (0463)", /'money', case when v\.id = any\(s\.money_plans\) and pv\.id is not null then jsonb_build_object\('baseline', public\.vision_share_baseline\(pv\.baseline\)/.test(fn));
ok("…built from named fields at the database (an allow-list): a line keeps its named fields — never source, notes, the library link — and a scenario's fixtures map is never named", /'uses', public\.vision_share_list\(v -> 'uses', array\['id','label','category','qty','unitCents','confidence','on'\]\)/.test(sqlAll)
  && !/'source'|'notes'|'libraryId'|'fixtures'/.test(sqlAll.slice(sqlAll.indexOf("create or replace function public.vision_share_keep"), sqlAll.indexOf("revoke all on function public.vision_share_keep")))
  && /revoke all on function public\.vision_share_baseline\(jsonb\) from public, anon, authenticated;/.test(sqlAll));
ok("…and a room carries no notes", !/'notes', l\.notes/.test(fn));
ok("…a placed thing carries no library link (no asset, no supplier, no price)", /'id', i\.id, 'kind', i\.kind, 'label', i\.label/.test(fn) && !/library_id/.test(fn));
ok("…a plan's needs carry their label, never the note", /'needs', coalesce\(\(select jsonb_agg\(jsonb_build_object\('label', n\.label, 'kind', n\.kind, 'due_on', n\.due_on, 'done_on', n\.done_on, 'sort', n\.sort\)/.test(fn) && !/n\.note/.test(fn));
// Held at the data boundary by 0463 (its own Postgres test, db.ims7sec, calls the link as anon — new, previously issued,
// expired, revoked, wrong and short tokens, another business). As a second layer, the screens never draw them either:
ok("…and no investor screen draws a startup line's source, notes or library link", ![slide, read("components/vision/Present.tsx"), read("components/vision/CaseWords.tsx")].some((s) => /\b(u|l|line|x)\.(source|notes|libraryId)\b/.test(s)));
console.log(`IMS7-F — INVESTOR-SAFE INTELLIGENCE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
