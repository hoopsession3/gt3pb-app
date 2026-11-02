// IMS8 P12 — THE WHOLE PRESENTATION, ON EVERY SCREEN; THE PROPOSITION FROM APPROVED FACTS. The investor's four questions —
// what's funded, how much and for what, the terms, what's still to happen — answered only from what the link holds; an ask
// is its amount, "Being priced" or "None needed"; the structure is said as modeled in the approved case, not an offer.
// Nothing on a slide is cut without being counted (More); the room is said to be a planning layout to scale from its
// recorded size. Device parity is the walk's (the same text on a phone and a desktop); this holds the rules.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const PR = loadTs("lib/proposition.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 500)}` : "")); } };

const uses = [{ id: "l1", label: "Bar", category: "equipment", qty: 1, unitCents: 1200000 }, { id: "l2", label: "Sign", category: "launch", qty: 1, unitCents: null }, { id: "l3", label: "Walls", category: "buildout", qty: 2, unitCents: 500000 }, { id: "l4", label: "Reserve", category: "reserve", qty: 1, unitCents: 3000000 }];
const v = {
  programs: [{ id: "p", title: "The first store" }],
  plans: [{ id: "a", program_id: "p", name: "Gym bar", phase: 1, sort: 1, gate: "Gym signs." }, { id: "b", program_id: "p", name: "Storefront", phase: 3, sort: 2, gate: null }],
  asks: [{ program_id: "p", plan_id: "a", label: "Build-out", amount_cents: 1500000, state: "open" }, { program_id: "p", plan_id: null, label: "Equipment", amount_cents: null, state: "open" }, { program_id: "p", plan_id: null, label: "Permits", amount_cents: 0, state: "committed" }],
  needs: [{ plan_id: "a", label: "Health permit", due_on: null, done_on: null, sort: 2 }, { plan_id: "a", label: "Choose the gym", due_on: "2026-12-01", done_on: null, sort: 1 }, { plan_id: "a", label: "Lease", due_on: "2026-10-01", done_on: "2026-10-01", sort: 3 }],
  deps: [{ plan_id: "b", needs_plan_id: "a" }],
  cases: { a: { scenarios: { base: { uses } }, structure: { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 }, approvedAt: "2026-10-30T10:00:00Z", version: 2, research: [], risks: [], acknowledged: [] } },
};
const p = PR.propositionOf(v);
ok("what's funded: the program and its plans, in phase order", JSON.stringify(p.funded) === JSON.stringify([{ program: "The first store", plans: ["Gym bar (phase 1)", "Storefront (phase 3)"] }]));
ok("how much: each ask its amount, Being priced, or None needed — and the totals keep them apart", JSON.stringify(p.sought.map((a) => a.amount)) === JSON.stringify(["$15,000", "Being priced", "None needed"])
  && p.soughtTotal.specified === 1500000 && p.soughtTotal.beingPriced === 1 && p.soughtTotal.noneNeeded === 1, p);
ok("how it's used: every category of the approved case's lines, in the model's order, with what isn't priced said", JSON.stringify(p.uses[0].lines.map((x) => [x.word, x.cents, x.unpriced])) === JSON.stringify([["Equipment & fixtures", 1200000, 0], ["Construction & build-out", 1000000, 0], ["Marketing & launch", 0, 1], ["Working-capital reserve", 3000000, 0]]), p.uses[0].lines);
ok("…all four categories, none dropped; total of the priced lines; one unpriced", p.uses[0].lines.length === 4 && p.uses[0].total === 5200000 && p.uses[0].unpriced === 1);
ok("terms: the structure modeled in the approved case, from its own numbers, with its version", p.terms[0].says === "$40,000 for 6% of sales until 1.5× ($60,000) is repaid" && p.terms[0].version === 2 && p.terms[0].approved === "Oct 30, 2026", p.terms);
ok("…every structure is said from its own fields; none invents a figure", PR.termsWords({ kind: "loan", amountCents: 5000000, aprPct: 9, termMonths: 36 }) === "A loan of $50,000 at 9% a year over 36 months" && PR.termsWords({ kind: "none" }) === "No terms in the approved case");
ok("what's still to happen: the gate, every open need soonest first (done ones out), what each plan waits on", JSON.stringify(p.milestones) === JSON.stringify([{ plan: "Gym bar", gate: "Gym signs.", needs: [{ label: "Choose the gym", due: "Dec 1, 2026" }, { label: "Health permit", due: null }], waitsOn: [] }, { plan: "Storefront", gate: null, needs: [], waitsOn: ["Gym bar"] }]), p.milestones);
const none = PR.propositionOf({ programs: [{ id: "p", title: "X" }], plans: [], asks: [], needs: [], deps: [], cases: {} });
ok("a link with nothing to answer with asks nothing: no uses, no terms, no milestones", !none.has.sought && !none.has.uses && !none.has.terms && !none.has.milestones);

const present = read("components/vision/Present.tsx"), cs = read("components/vision/CaseSlide.tsx");
ok("the proposition slide follows the cover when the link holds anything to answer it with", /\.\.\.\(pr\.has\.sought \|\| pr\.has\.uses \|\| pr\.has\.terms \|\| pr\.has\.milestones \? \[\{ kind: "proposition" as const \}\] : \[\]\)/.test(present) && /\{s\.kind === "proposition" && <Proposition vision=\{vision\} \/>\}/.test(present));
{ const prop = read("components/vision/Proposition.tsx");
  ok("…its terms are said as modeled — a plan, not an offer", /a plan, not an offer\. Terms are agreed separately\./.test(prop) && /<h3>Terms modeled<\/h3>/.test(prop));
  ok("…the slide is its own chunk, loaded when shown; the presenter decides with the light half only (no money model in /present's bundle)", /const Proposition = dynamic\(\(\) => import\("\.\/Proposition"\)/.test(present) && !/lib\/proposition"/.test(present) && !/^import .*visionMoney/m.test(read("lib/propositionHas.ts"))); }
{ const H = loadTs("lib/propositionHas.ts");
  const same = [v, { programs: [{ id: "p", title: "X" }], plans: [], asks: [], needs: [], deps: [], cases: {} }].every((x) => JSON.stringify(H.propositionHas(x)) === JSON.stringify(PR.propositionOf(x).has));
  ok("whether the slide exists is exactly what the proposition can answer", same); }
ok("nothing on a slide is cut without being counted: needs, research and risks show the rest on asking", /<More items=\{next\} first=\{4\}/.test(present) && /<More items=\{c\.research\} first=\{8\} word="findings"/.test(cs) && /<More items=\{risks\} first=\{3\}/.test(cs)
  && /const risks = keyRisks\(c\.risks, Infinity\);/.test(cs) && !/research\.slice\(0, 8\)/.test(cs) && !/\.slice\(0, 4\)\.map|\.slice\(0, 4\);/.test(present));
ok("More says how many it hides and opens them all, the same on every screen", /`Show \$\{items\.length - first\} more \$\{word\}`/.test(read("components/vision/More.tsx")) && /aria-expanded=\{all\}/.test(read("components/vision/More.tsx")));
{ const ml = cs.slice(cs.indexOf("function MonthList("), cs.indexOf("function", cs.indexOf("function MonthList(") + 10));
  ok("every month: the phone's list and the desktop's table carry the same figures — raised, in, costs, equipment, investor, the end, against the reserve", /Raised before opening day/.test(ml) && /<th scope="col">Against the reserve<\/th>/.test(ml) && /equipment \{dollars\(r\.capex\)\}/.test(ml) && /raised \$\{dollars\(r\.opening\)\}/.test(ml) && /investor \{dollars\(r\.toInvestor\)\}/.test(ml)); }
console.log(`IMS8 P12 — THE WHOLE PRESENTATION; THE PROPOSITION FROM APPROVED FACTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
