// IMS6 A2 — LIBRARY INTAKE: depth by risk, a run's worst case inside its ceiling, matching before making, and found
// values reduced to draft facts (sourced, labelled, never repaired by guessing). No network.
import { loadTs } from "./search.read.mjs";
const I = loadTs("lib/libraryIntake.ts");
const P = loadTs("lib/aiPricing.ts");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };
const B = { per_run_cents: 25, per_run_searches: 5, per_run_fetches: 3, per_run_tokens: 60000 };
const SONNET = "claude-sonnet-4-6", HAIKU = "claude-haiku-4-5-20251001";

// depth
ok("a finish, paint, floor or food-contact item is researched deep", ["paint", "flooring", "food_contact", "cleaning", "coating"].every((c) => I.depthFor(c, 0) === "deep"));
ok("furniture standard, a sign light", I.depthFor("furniture", 0) === "standard" && I.depthFor("signage", 0) === "light");
ok("missing required evidence raises it a step", I.depthFor("signage", 2) === "standard" && I.depthFor("furniture", 1) === "deep");

// the ceiling
for (const depth of ["light", "standard", "deep"]) for (const model of [SONNET, HAIKU]) {
  const p = I.planFor(depth, B, model);
  ok(`${depth} on ${model.split("-")[1]}: its worst case fits 25¢`, !!p && p.worstCents <= 25, p);
}
const deep = I.planFor("deep", B, SONNET);
ok("deep on Sonnet is shrunk to fit (searches first), not let through", deep.searches < 5 || deep.fetchTokens < 12000, deep);
ok("the worst case counts every search at $10 per 1,000 and every capped token", Math.abs(I.worstCents({ model: SONNET, searches: 1, fetches: 0, fetchTokens: 0, maxOutput: 0, pdfPages: 0, images: 0 }) - (1 + (I.PROMPT_TOKENS + I.SEARCH_RESULT_TOKENS_ALLOWANCE) * 3 / 1e4)) < 1e-9);
ok("a budget too small for anything useful plans nothing", I.planFor("standard", { ...B, per_run_cents: 1 }, SONNET) === null);
ok("never more searches than the budget allows", I.planFor("deep", { ...B, per_run_searches: 1 }, HAIKU).searches === 1);
ok("the pricing is GT3's own table", !!P.PRICING[SONNET] && !!P.PRICING[HAIKU]);

for (const depth of ["light", "standard", "deep"]) {
  const p = I.planFor(depth, B, SONNET, { pdf: true });
  ok(`${depth} with an uploaded PDF: its pages counted, the worst case still fits`, !!p && p.pdfPages > 0 && p.worstCents <= 25, p);
}
ok("a photo is counted too", I.planFor("standard", B, SONNET, { image: true }).images === 1);

// matching
ok("a URL normalised: no www, tracking, fragment or trailing slash", I.normUrl("https://www.Maker.test/tables/oak/?utm_source=x&size=8#top") === "maker.test/tables/oak?size=8");
ok("…and only https", I.normUrl("http://maker.test/x") === null);
const known = [
  { id: "k1", name: "Oak Community Table", maker: "Test Maker", product_ref: "CT-96", source_url_norm: "maker.test/tables/oak", w_in: 96, d_in: 36, h_in: 30, finishes: "Natural oil", composition: "Solid white oak" },
  { id: "k2", name: "Bench", maker: "Other", product_ref: "B1", source_url_norm: null, w_in: 60, d_in: 16, h_in: 18, finishes: null, composition: null },
];
ok("the same page is the same asset", I.matchAsset({ url: "https://maker.test/tables/oak/" }, known)[0]?.kind === "same");
ok("the same maker and product number is the same asset", I.matchAsset({ maker: "test maker", product_ref: "ct 96" }, known)[0]?.id === "k1");
ok("…in another finish it's a variant (its own record)", I.matchAsset({ maker: "Test Maker", product_ref: "CT-96", finishes: "Hardwax, ebonised" }, known)[0]?.kind === "variant");
ok("…in another formulation too", I.matchAsset({ maker: "Test Maker", product_ref: "CT-96", composition: "Oak veneer on MDF" }, known)[0]?.kind === "variant");
ok("the same name and size is offered as similar, never assumed", I.matchAsset({ name: "oak community table", w_in: 95, d_in: 36 }, known)[0]?.kind === "similar");
ok("a different size isn't", I.matchAsset({ name: "oak community table", w_in: 72 }, known).length === 0);

// draft facts
const ctx = { kind: "url", ref: "https://maker.test/tables/oak" };
const { facts, dropped } = I.toDraftFacts([
  { field: "w_in", value: "96 in", method: "quoted", source_class: "manufacturer", quote: "Width 96\"" },
  { field: "maker", value: "Test Maker", method: "quoted", source_class: "manufacturer" },
  { field: "finishes", value: "Natural oil", method: "inferred", source_class: "manufacturer" },
  { field: "food_contact", value: "Food safe", method: "quoted", source_class: "supplier", source_ref: "https://shop.test/x" },
  { field: "composition", value: "Solid oak", method: "extracted", source_class: "manufacturer" },
  { field: "warranty", value: "5 years", method: "quoted", source_class: "manufacturer" },
  { field: "h_in", value: "tall", method: "quoted", source_class: "manufacturer" },
  { field: "supplier", value: "Shop", method: "quoted", source_class: "supplier", source_ref: null },
  { field: "image_url", value: "http://maker.test/a.jpg", method: "quoted", source_class: "manufacturer" },
  { field: "cost_cents", value: 189000, method: "quoted", source_class: "manufacturer", source_ref: "http://maker.test/price" },
  { field: "d_in", value: 36, source_class: "manufacturer" },
], ctx);
const by = (f) => facts.find((x) => x.field === f);
ok("a number read from words is a number", by("w_in")?.value === 96);
ok("a source comes from the page when the fact names none", by("maker")?.source_ref === ctx.ref);
ok("an inference is the AI's, whatever it claimed, and points to no source", by("finishes")?.source_class === "ai_inference" && by("finishes").source_ref === null && by("finishes").method === "inferred");
ok("a seller's safety statement is a claim to verify, high risk", by("claim")?.source_class === "supplier" && by("claim").risk === "high" && !by("food_contact"));
ok("what it's made of is high risk", by("composition")?.risk === "high");
ok("dropped, each with why: an unknown field, a non-number, a non-https link or source, no method", ["warranty", "h_in", "image_url", "cost_cents", "d_in"].every((f) => dropped.some((d) => d.field === f)), dropped);
ok("nothing is invented to fill a gap", facts.length === 6 && !facts.some((f) => f.field === "h_in"));
ok("a supplier fact with no source at all falls back to the page it came from", by("supplier")?.source_ref === ctx.ref);
const nothing = I.toDraftFacts([{ field: "maker", value: "X", method: "quoted", source_class: "manufacturer" }], { kind: "description", ref: null });
ok("a description gives no source: only inferences survive from it", nothing.facts.length === 0 && nothing.dropped[0]?.why === "no source to point to");

// what's missing
const miss = I.missingFor(facts, [{ code: "S-1", title: "Finish emissions", mandatory: true, categories: ["furniture"] }, { code: "F-1", title: "Food contact", mandatory: true, categories: ["serviceware"] }, { code: "L-1", title: "Glare", mandatory: false, categories: [] }], "furniture");
ok("the card says what's missing: fields and the category's mandatory evidence", miss.fields.includes("h_in") && miss.fields.includes("image_url") && miss.evidence.join() === "S-1 Finish emissions", miss);

console.log(`IMS6 A2 — LIBRARY INTAKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
