// IMS7-0467 — THE APP'S SIDE OF "A LINK SENDS WHAT IT WAS GIVEN". The pre-share preview sorts the database's own answer
// into categories and shows every piece of free text (and anything it can't file, under "Anything else"); a risk
// acceptance keeps its review date, so the score sees it — with its rules unchanged (a reason AND a calendar review date;
// lapsed after it) — while every financial figure stays what it was; the Links tab picks plans and their needs per link
// and asks the database what a link sends. Logs carry counts and key names only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const PV = loadTs("lib/sharePreview.ts"), DATA = loadTs("lib/visionCaseData.ts"), CASE = loadTs("lib/visionCase.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 500)}` : "")); } };

// ── The preview ─────────────────────────────────────────────────────────────────────────────────────────────────────
const W = (w) => `WORDS-${w}`;
const scen = { ordersPerDay: 110, avgOrderCents: 900, uses: [{ id: "l1", label: W("line"), category: "equipment", qty: 1, unitCents: 1000, confidence: "quoted", on: "2026-10-01" }],
  channels: [{ kind: "local", reach: 3000, convertPct: 4, costCents: 0, startMonth: 1 }], mix: [{ key: "cold-brew", label: W("product"), sharePct: 100, priceCents: 600, unitCostCents: 100, packagingCents: 10 }], demandFrom: "typed" };
const payload = { label: W("who"), show_asks: true, expires_at: null, pinned_at: "2026-11-01T00:00:00Z",
  programs: [{ id: "p1", lane: W("lane"), title: W("program"), summary: W("program-summary"), why: W("program-why"), pillars: ["fuel"], horizon: "now", status: "live", start_on: null, target_on: null, emoji: "x", layout_id: null, sort: 0 }],
  asks: [{ program_id: "p1", plan_id: null, label: W("ask"), amount_cents: 500000, state: "open", note: W("ask-note"), sort: 0 }],
  plans: [{ id: "a", program_id: "p1", name: W("plan"), format: "gym_bar", phase: 1, status: "planned", sqft: 400, deal: "rev_share", place: W("place"), summary: W("plan-summary"), why: W("plan-why"), gate: W("gate"), layout_id: null, sort: 0,
    customer: W("customer"), market: W("market"), positioning: W("positioning"), needs: [{ label: W("need"), kind: "permit", due_on: null, done_on: null, sort: 0 }], waits_on: ["b"],
    money: { baseline: { scenarios: { base: scen, conservative: scen, upside: scen }, structure: { kind: "none" }, acknowledged: [{ key: "no_downside", note: W("ack"), at: "2026-10-20", reviewBy: "2026-12-01" }] }, approved_at: "2026-10-30", version: 2 },
    research: [{ topic: "demand", claim: W("claim"), figure: W("figure"), source_url: "https://x.example/a", source_title: W("source"), bearing: "for", retrieved_at: "2026-10-01" }],
    risks: [{ kind: "risk", words: W("risk"), likelihood: "medium", impact: "high", mitigation: W("mitigation"), status: "open" }] }],
  layouts: [{ id: "r1", name: W("room"), width_in: 360, depth_in: 480, ceiling_in: 132, items: [{ id: "i1", kind: "bar", label: W("thing"), x_in: 1, y_in: 1, rot: 0, w_in: 1, d_in: 1, h_in: 1, why: W("thing-why"), pillars: ["fuel"], sort: 0 }] }] };
const p = PV.previewOf(payload);
const sec = (k) => p.sections.find((s) => s.key === k);
ok("every category is named, with how many", ["link", "programs", "plans", "needs", "asks", "money", "research", "risks", "rooms"].every((k) => sec(k)) && sec("plans").count === 1 && sec("needs").count === 1 && sec("research").count === 1, p.sections.map((s) => [s.key, s.count]));
const allWords = Object.values(payload).length && JSON.stringify(payload).match(/WORDS-[a-z-]+/g);
const shown = p.sections.flatMap((s) => s.texts).join(" | ");
ok("every piece of free text in the response is shown, word for word", [...new Set(allWords)].every((w) => shown.includes(w)), [...new Set(allWords)].filter((w) => !shown.includes(w)));
ok("…filed where it belongs (a need under needs, a reason under money, a mitigation under risks, a thing's why under rooms)", sec("needs").texts.includes(W("need")) && sec("money").texts.includes(W("ack")) && sec("risks").texts.includes(W("mitigation")) && sec("rooms").texts.includes(W("thing-why")));
ok("…the amount asked is said with the ask", sec("asks").texts.some((t) => t.startsWith(W("ask")) && t.endsWith("$5,000")));
ok("ids, dates and fixed words aren't shown as anyone's writing; nothing is left over", p.other.length === 0 && !shown.includes("2026-10-01") && !shown.includes("gym_bar"), p.other);
const extra = PV.previewOf({ ...payload, plans: [{ ...payload.plans[0], newField: "SOMETHING-NEW" }], surprise: { deep: ["ALSO-NEW"] } });
ok("text the preview doesn't know where to file is shown under \"Anything else\" — never hidden", extra.other.includes("SOMETHING-NEW") && extra.other.includes("ALSO-NEW"));
ok("an empty or malformed response previews as nothing, without a throw", PV.previewOf(null).sections.length === 0 && PV.previewOf("x").sections.length === 0 && PV.previewOf({ plans: "x", asks: 7 }).sections.length === 0);

// ── The risk acceptance: kept, and its rules unchanged ──────────────────────────────────────────────────────────────
const a = DATA.acksOf([{ key: "k", note: " reason ", at: "2026-10-20", reviewBy: "2026-12-01" }, { key: "k2", note: "r", reviewBy: "soon" }, { key: "k3", note: "r", reviewBy: "2026-13-45" }, { key: "k4", note: "  " }, "junk"]);
ok("acksOf keeps the review date (it dropped it — no acceptance ever counted)", a[0].reviewBy === "2026-12-01" && a[0].note === "reason");
ok("…a review date that isn't a calendar date is not kept: that risk stays open", a.find((x) => x.key === "k2").reviewBy === null && a.find((x) => x.key === "k3").reviewBy === null && !a.some((x) => x.key === "k4"));
// A real case: the base scenario's blockers, then one of them accepted through the stored baseline, as a link reads it.
const baseScen = { ...scen, uses: [...scen.uses, { id: "l2", label: "Unpriced", category: "equipment", qty: 1, unitCents: null }] };
const raw = (acks) => ({ baseline: { scenarios: { base: baseScen, conservative: baseScen, upside: baseScen }, structure: { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 }, acknowledged: acks }, approved_at: "2026-10-30", version: 2 });
const open = CASE.figuresOf(DATA.toCase(raw([]), [], []));
const key = open.scores.base.blockers.find((x) => x.status === "open")?.key;
ok("the case has an open blocker to accept (so the next checks mean something)", !!key, open.scores.base.blockers.map((x) => x.status));
const ack = (reviewBy) => CASE.figuresOf(DATA.toCase(raw([{ key, note: "Disclosed: we present with this open.", at: "2026-10-20", reviewBy }]), [], []));
const far = ack("2099-12-31"), past = ack("2020-01-01"), junk = ack("whenever");
ok("accepted with a reason and a review date: the score says so (risk_accepted) — on a link as in the app", far.scores.base.blockers.find((x) => x.key === key).status === "risk_accepted" && far.scores.base.blockers.find((x) => x.key === key).acknowledged?.reviewBy === "2099-12-31");
ok("…past its review date: lapsed, not accepted", past.scores.base.blockers.find((x) => x.key === key).status === "acceptance_lapsed");
ok("…with a malformed review date: still open (the requirement isn't weakened)", junk.scores.base.blockers.find((x) => x.key === key).status === "open");
ok("…without a reason: never accepted", CASE.figuresOf(DATA.toCase(raw([{ key, note: "", reviewBy: "2099-12-31" }]), [], [])).scores.base.blockers.find((x) => x.key === key).status === "open");
const money = (f) => JSON.stringify({ m: f.models, b: f.base, i: f.irrPct, inv: f.inv });
ok("every financial figure — each month of each scenario, the trace, IRR, the investor's return — identical, accepted or not", money(open) === money(far) && money(far) === money(past) && money(open) === money(junk));
ok("…and what changes is only that blocker's status (and the open count and stage it sets), nothing else in the score", (() => { const strip = (s) => JSON.stringify({ ...s, blockers: s.blockers.filter((x) => x.key !== key), open: undefined, readiness: undefined, stage: undefined });
  return strip(open.scores.base) === strip(far.scores.base); })());
ok("the score's acceptance rule itself is untouched (a reason and a review date)", /a\.key === b\.key && a\.note\.trim\(\) && a\.reviewBy/.test(read("lib/visionScore.ts")));

// ── The Links tab ───────────────────────────────────────────────────────────────────────────────────────────────────
const sh = read("components/vision/Shares.tsx"), lp = read("components/vision/LinkPreview.tsx");
ok("a link's plans and their needs are chosen per link, and saved with it — when it's made and when it's changed", /\.\.\.\(canPick \? \{ plan_ids: scope\.plans, need_plans: scope\.needs \} : \{\}\) \};/.test(sh) && /update\(\{ program_ids: pickPrograms, layout_ids: pickRooms, \.\.\.\(plans \? .*inScope\(plans, pickPrograms, pickPlans, pickNeeds\)\) : \{\}\) \}\)/.test(sh));
ok("…nothing ticked by default (not every plan marked to show, not every plan of a program)", /useState<string\[\]>\(\[\]\);\n  const \[pickNeeds, setPickNeeds\] = useState<string\[\]>\(\[\]\);/.test(sh));
// IMS8 A1 (Ryan: "nothing selected by default; clear selections after successful Create; preserve the draft on failure").
ok("A1: a new link starts with nothing chosen — no programs, rooms, plans, needs, and the asks off", /const \[money, setMoney\] = useState\(false\);/.test(sh) && /const \[pickPrograms, setPickPrograms\] = useState<string\[\]>\(\[\]\);/.test(sh)
  && /const \[pickRooms, setPickRooms\] = useState<string\[\]>\(\[\]\);/.test(sh) && !/shownPlans\.map\(\(p\) => p\.(program_id|layout_id)\)/.test(sh));
const mk = sh.slice(sh.indexOf("const make = async"), sh.indexOf("const off = async"));
ok("A1: a link made clears every choice (label, asks, lifetime, programs, rooms, plans, needs, the preview) — the next link inherits nothing", /setLabel\(""\); setMoney\(false\); setEnds\("30"\); setPickPrograms\(\[\]\); setPickRooms\(\[\]\); setPickPlans\(\[\]\); setPickNeeds\(\[\]\); setPeek\(false\);/.test(mk));
ok("A1: a failure keeps the draft — it returns before anything is cleared", mk.indexOf('if (error) { toast(failureWords(error, "Couldn\'t make the link"), "error"); return; }') > 0 && mk.indexOf('if (error) {') < mk.indexOf("setPickPrograms([])"));
ok("A1: what's sent is what's visibly ticked — make, preview and changing a link all go through inScope", /plan_ids: scope\.plans, need_plans: scope\.needs/.test(mk) && /plan_ids: scope\.plans, need_plans: scope\.needs, show_asks: money \} satisfies Draft/.test(sh) && /inScope\(plans, pickPrograms, pickPlans, pickNeeds\)/.test(sh));
{ const P = [{ id: "a", program_id: "p1" }, { id: "b", program_id: "p1" }, { id: "c", program_id: "p2" }, { id: "d", program_id: null }];
  const r1 = PV.inScope(P, ["p1"], ["a", "c", "d"], ["a", "c", "b"]);
  ok("A1: inScope — a plan under an unticked program, or with no program, isn't carried; needs only of carried plans", JSON.stringify(r1) === JSON.stringify({ plans: ["a"], needs: ["a"] }), r1);
  ok("A1: inScope — unticking every program carries nothing", JSON.stringify(PV.inScope(P, [], ["a", "b"], ["a"])) === JSON.stringify({ plans: [], needs: [] })); }
ok("…only plans marked to show, under a program ticked, are offered", /const under = \(plans \?\? \[\]\)\.filter\(\(p\) => p\.program_id && pickPrograms\.includes\(p\.program_id\)\);/.test(sh) && /const shownPlans = plans\.filter\(\(p\) => p\.shareable\);/.test(sh));
ok("the money and research chooser lists only the plans the link shows", /CaseChooser share=\{s\} plans=\{shownPlans\.filter\(\(p\) => !canPick \|\| \(s\.plan_ids \?\? \[\]\)\.includes\(p\.id\)\)\}/.test(sh));
ok("the preview asks the database (vision_share_preview), for a draft and for a live link, and is loaded only on asking", /supabase\.rpc\("vision_share_preview", \{ p_share: share \?\? null, p_draft: share \? null : draft \?\? null \}\)/.test(lp)
  && /const LinkPreview = dynamic\(\(\) => import\("\.\/LinkPreview"\), \{ ssr: false \}\);/.test(sh) && /<LinkPreview draft=/.test(sh) && /<LinkPreview share=\{share\.id\} \/>/.test(sh));
ok("before 0467 is pasted the Links tab reads and works as it did (no plan picking, no preview)", /setCanPick\(false\)/.test(sh) && /canPick && peek/.test(sh));

console.log(`IMS7-0467 — THE APP'S SIDE (preview, risk acceptance, the Links tab): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
