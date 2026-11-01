// IMS8 P2 — WHERE YOU ARE IN THE VISION, IN ITS ADDRESS; A LINK IN PROGRESS SURVIVES A DETOUR. lib/visionNav reads and
// writes the place (tab, plan, step, room, the way back) and turns an insight's `go` into a place — the one router every
// "fix it" uses; the vision keeps the address current; the Links draft is kept in this tab while it's being made.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const N = loadTs("lib/visionNav.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 300)}` : "")); } };
const P = "0c46b000-0000-4000-8000-0000000000aa", R = "0c46b000-0000-4000-8000-0000000000bb";

ok("no address: the roadmap", JSON.stringify(N.placeOf("")) === JSON.stringify({ tab: "roadmap", plan: null, step: null, room: null, back: null }));
ok("a plan's money, opened from a link in progress", JSON.stringify(N.placeOf(`?tab=plans&plan=${P}&step=money&back=links`)) === JSON.stringify({ tab: "plans", plan: P, step: "money", room: null, back: "links" }));
ok("a room", N.placeOf(`?tab=store&room=${R}`).room === R);
ok("unknown words and malformed ids are dropped, never guessed", JSON.stringify(N.placeOf("?tab=admin&plan=1;drop&step=x&back=evil")) === JSON.stringify({ tab: "roadmap", plan: null, step: null, room: null, back: null })
  && N.placeOf(`?tab=plans&plan=${P}&step=evil`).step === null && N.placeOf(`?tab=roadmap&plan=${P}`).plan === null);
for (const p of [{ tab: "roadmap" }, { tab: "links" }, { tab: "plans", plan: P }, { tab: "plans", plan: P, step: "money", back: "links" }, { tab: "store", room: R }])
  ok(`the address round-trips: ${JSON.stringify(p)}`, JSON.stringify(N.placeOf(N.searchOf(p))) === JSON.stringify({ tab: "roadmap", plan: null, step: null, room: null, back: null, ...p, step: p.step ?? null, ...(p.plan ? {} : { plan: null }) }));
ok("an insight's go → a place: a plan's money, with the way back", JSON.stringify(N.placeOfGo({ section: "money", anchor: P }, "links")) === JSON.stringify({ tab: "plans", plan: P, step: "money", room: null, back: "links" }));
ok("…a room; the library; anything unknown → the roadmap", N.placeOfGo({ section: "store", anchor: R }).room === R && N.placeOfGo({ section: "library" }).tab === "library" && N.placeOfGo({ section: "nope" }).tab === "roadmap" && N.placeOfGo(null).tab === "roadmap");
ok("…a go into the links themselves never carries a way back to them", N.placeOfGo({ section: "links" }, "links").back === null);

// IMS8 P7: the draft moved with the studio into lib/linkDraft (read in components/vision/LinkStudio).
const app = read("components/vision/VisionApp.tsx"), plans = read("components/vision/Plans.tsx"), sh = read("lib/linkDraft.ts") + read("components/vision/LinkStudio.tsx");
ok("the vision reads its place from the address once, and a tab it can't edit falls back to the roadmap", /useState<VisionPlace>\(\(\) => \{\n    const p = placeOf\(typeof window === "undefined" \? "" : window\.location\.search\);\n    return !canEdit && EDIT_TABS\.includes\(p\.tab\) \? \{ \.\.\.p, tab: "roadmap" \} : p;/.test(app));
ok("…keeps the address current without a reload, and follows Back", /window\.history\.replaceState\(window\.history\.state, "", want\)/.test(app) && /window\.addEventListener\("popstate", back\)/.test(app));
ok("…opens the plan and step the address names, and says which are open", /initialCase=\{place\.plan\} initialStep=\{place\.step\} onCase=\{onCase\}/.test(app) && /useState<string \| null>\(initialCase\)/.test(plans) && /useState<Step>\(initialStep \?\? "plan"\)/.test(plans));
ok("…and offers the way back to a link in progress", /place\.back === "links" && tab !== "links"/.test(app) && /‹ Back to your link/.test(app));
ok("the Links draft is kept in this tab only (sessionStorage), read once, never sent; empty isn't kept; refused storage keeps nothing", /sessionStorage\.getItem\(DRAFT_KEY\)/.test(sh) && /useState<StudioDraft>\(\(\) => readDraft\(\) \?\? EMPTY\)/.test(sh)
  && /if \(empty\) sessionStorage\.removeItem\(DRAFT_KEY\); else sessionStorage\.setItem\(DRAFT_KEY, JSON\.stringify\(d\)\);/.test(sh) && /catch \{ \/\* storage refused/.test(sh) && !/localStorage/.test(sh));
console.log(`IMS8 P2 — WHERE YOU ARE, IN THE ADDRESS; A LINK IN PROGRESS SURVIVES A DETOUR: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
