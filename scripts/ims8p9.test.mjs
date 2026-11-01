// IMS8 P9 — WHO IT'S FOR, AND THE STORY IT TELLS (deterministic; no AI). An audience preset orders suggestions and how the
// preview presents — never what's chosen. Suggestions are ranked only from recorded facts (an approved money case, a
// plan a picked plan waits on, then the audience's order), each with a reason of 32 characters or fewer, and added only
// by a tap. The story is the response's own facts, each tagged with its source; a suggested opening, made only of names
// the response holds, is kept apart and labelled as not sent.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const S = loadTs("lib/linkStory.ts"), LD = loadTs("lib/linkDraft.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };

const plans = [
  { id: "a", name: "Gym bar", program_id: "p", phase: 1, layout_id: null, deal: "lease", sqft: 400 },
  { id: "b", name: "Storefront", program_id: "p", phase: 3, layout_id: "r", deal: "lease", sqft: 1200 },
  { id: "c", name: "Office cart", program_id: "p", phase: 2, layout_id: null, deal: "rev_share", sqft: null },
  { id: "d", name: "Hidden", program_id: "p", phase: 1, shareable: false },
  { id: "e", name: "Elsewhere", program_id: "q", phase: 1 },
];
const base = { plans, deps: [], approved: new Set(), picked: [], programs: ["p"], audience: null };
const ids = (l) => l.map((x) => x.id).join("");
ok("only plans marked to show, under a chosen program, not already picked", ids(S.recommend(base)) === "acb" && ids(S.recommend({ ...base, picked: ["a"] })) === "cb", ids(S.recommend(base)));
ok("an approved money case ranks first, said so", (() => { const r = S.recommend({ ...base, approved: new Set(["b"]) }); return r[0].id === "b" && r[0].reason === "Approved money case"; })());
ok("…then a plan a picked plan waits on (its recorded dependency)", (() => { const r = S.recommend({ ...base, picked: ["a"], deps: [{ plan_id: "a", needs_plan_id: "b" }] }); return r[0].id === "b" && r[0].reason === "A picked plan waits on it"; })());
ok("an audience changes the order, never the set", ids(S.recommend({ ...base, audience: "landlord" })) === "bac" && ids(S.recommend({ ...base, audience: "partner" })) === "cab"
  && [...ids(S.recommend({ ...base, audience: "landlord" }))].sort().join("") === [...ids(S.recommend(base))].sort().join(""));
ok("every reason is one line of 32 characters or fewer", ["angel", "landlord", "partner", null].every((a) => S.recommend({ ...base, audience: a, approved: new Set(["c"]) }).every((x) => x.reason.length <= 32)));
ok("…and the same facts give the same order every time", ids(S.recommend({ ...base, audience: "partner" })) === ids(S.recommend({ ...base, audience: "partner" })));
ok("a preset is presentation only: the draft's audience never reaches what's published", !("audience" in LD.toPublish({ ...LD.EMPTY, audience: "angel", programs: ["p"] }, plans, true)));

const payload = { label: "L", programs: [{ id: "p", title: "The first store", why: "People train here every day." }],
  plans: [{ id: "a", name: "Gym bar", gate: "Gym signs.", money: { version: 2, approved_at: "2026-10-30T10:00:00Z" }, research: [{ claim: "1,200 members a day.", source_title: "Gym count", retrieved_at: "2026-10-01" }],
    needs: [{ label: "Health permit", due_on: null, done_on: null }, { label: "Choose the gym", due_on: "2026-12-01", done_on: null }, { label: "Lease", due_on: "2026-11-01", done_on: "2026-10-01" }] }], asks: [], layouts: [] };
const st = S.storyOf(payload);
ok("the story is the response's facts, each tagged with its source", JSON.stringify(st.facts) === JSON.stringify([
  { says: "The first store: People train here every day.", source: "Roadmap · the program as written" },
  { says: "Gym bar goes when: Gym signs.", source: "Plans · Gym bar's gate" },
  { says: "Gym bar has an approved money case (version 2, approved Oct 30, 2026).", source: "Money · approved version 2" },
  { says: "1,200 members a day.", source: "Research · Gym count, read Oct 1, 2026" },
  { says: "Next for Gym bar: Choose the gym, by Dec 1, 2026.", source: "Needs · Gym bar" },
]), st.facts);
ok("…the suggested opening is apart, made only of names the response holds — no number it doesn't", st.suggested === "The first store — Gym bar. Here's the plan, as it stands." && !/\d/.test(st.suggested));
ok("…and an empty response tells no story", JSON.stringify(S.storyOf({ programs: [], plans: [] })) === JSON.stringify({ facts: [], suggested: null }));
const ls = read("components/vision/LinkStudio.tsx");
ok("in the studio: suggestions are added only by a tap; the preset only orders and presents", /onClick=\{\(\) => edit\(\{ plans: \[\.\.\.d\.plans, x\.id\] \}\)\}>Add<\/button>/.test(ls) && /onClick=\{\(\) => set\(\{ audience: d\.audience === a \? null : a \}\)\}/.test(ls) && /initialMode=\{d\.audience \? AUDIENCE_MODE\[d\.audience\] : "pitch"\}/.test(ls));
ok("…the suggested wording is labelled as not sent", /Suggested wording — yours to change; it isn&apos;t sent/.test(ls));
console.log(`IMS8 P9 — WHO IT'S FOR, AND THE STORY IT TELLS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
