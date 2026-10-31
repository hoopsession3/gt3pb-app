// IMS6 A3 — THE LIBRARY, VISUAL FIRST, REVIEW BY EXCEPTION: the review's order and its "safe rest" (the database's own line,
// said first on screen), a fact said with its source, the picture only a source's own, and the screens' wiring — discover
// first, the full form one action away, intake as Ask → Research → Review, manual entry as the Advanced way.
import { readFileSync } from "node:fs";
import { loadTs } from "./search.read.mjs";
const V = loadTs("lib/libraryReview.ts");
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };
const F = (id, field, value, o = {}) => ({ id, field, value, unit: null, source_class: "manufacturer", source_kind: "url", source_ref: "https://www.maker.test/t", source_title: "Spec", source_locator: "Specifications", method: "quoted", confidence: "high", risk: "low", review: "pending", retrieved_at: "2026-10-31T10:00:00Z", ...o });
const facts = [F("a", "maker", "Test Maker"), F("b", "w_in", 96), F("c", "w_in", 94, { source_class: "supplier" }), F("d", "composition", "Solid oak", { risk: "high" }),
  F("e", "claim", "Non-toxic", { source_class: "supplier", risk: "high" }), F("f", "finishes", "Oil", { method: "inferred", source_class: "ai_inference", source_ref: null }), F("g", "cost_cents", 189000, { unit: "each" }), F("h", "supplier", "Shop", { confidence: "low" })];
const conflicts = new Set(["w_in"]);
const order = V.reviewOrder(facts, conflicts);
ok("exceptions first: conflicts, then claims, health and safety, inferences", order.slice(0, 5).map((x) => x.f.id).join() === "b,c,e,d,f", order.map((x) => x.f.id));
ok("…each says why it's decided alone", order[0].why.includes("sources disagree") && order[2].why.includes("a claim, not proven") && order[2].why.includes("a seller's word") && order[4].why.includes("inferred, no source says it"));
const safe = V.safeRest(facts, conflicts).map((x) => x.id).join();
ok("the safe rest: sourced, low risk, no disagreement, not low confidence", safe === "a,g", safe);
ok("a size in feet and inches, a price in dollars, its source named with where in it", V.factWords(F("x", "w_in", 96)).value === "8′" && V.factWords(F("y", "cost_cents", 189000, { unit: "each" })).value === "$1,890.00 each" && V.factWords(F("z", "maker", "M")).source === "the maker's specification — Spec, maker.test, Specifications (quoted)");
ok("an inference is said as the AI's", /GT3's AI, inferred/.test(V.factWords(facts[5]).source));
ok("the picture: a source's own https image, said as theirs", V.imageFor([F("i", "image_url", "https://cdn.maker.test/ct.jpg")])?.from === "maker.test");
ok("…never an inferred one, a rejected one, or a plain http link", V.imageFor([F("i", "image_url", "https://x.test/a.jpg", { method: "inferred", source_class: "ai_inference" }), F("j", "image_url", "https://x.test/b.jpg", { review: "rejected" }), F("k", "image_url", "http://x.test/c.jpg")]) === null);

const lib = read("components/vision/Library.tsx"), intake = read("components/vision/LibraryIntake.tsx"), css = read("components/vision/library.css"), mig = read("supabase/migrations/0462_gt3_researches_a_human_decides.sql"), takes = read("lib/bucketTakes.ts");
ok("discover first: one search, category chips, one Filters action — not four open filters", /aria-label="Search the library"/.test(lib) && /role="group" aria-label="Categories"/.test(lib) && />Filters\{active\.length/.test(lib) && /\{filters && \(/.test(lib));
ok("…active filters said, and one Reset", /\{list\.length\} shown/.test(lib) && /onClick=\{\(\) => setF\(\{\}\)\}>Reset/.test(lib));
ok("…assets as picture cards: the image lazy, or an honest placeholder", /className="xl-cards"/.test(lib) && /loading="lazy" decoding="async"/.test(lib) && /a placeholder, not the product/.test(lib) && /\.xl-cards\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,150px\),1fr\)\)/.test(css));
ok("inspect: status in a line, evidence, size, makings, pillars as intent, cost with its basis, supplier", ["<dt>Status</dt>", "<dt>Evidence</dt>", "<dt>Size</dt>", "<dt>Made of</dt>", "(intent, not an assessment)", "<dt>Cost</dt>", "<dt>Supplier</dt>"].every((t) => lib.includes(t)));
ok("the full form is one action away (Manage), never the first thing seen", /\{manage && <Detail a=\{shown\}/.test(lib) && /useState\(false\)/.test(lib));
ok("add: Ask first (link, find it for me, upload); entering it by hand is Advanced", /\{ key: "url", label: "Paste a link" \}, \{ key: "describe", label: "Find it for me" \}, \{ key: "upload", label: "Upload" \}/.test(intake) && /Advanced: enter it by hand/.test(intake) && /adding === "ask" && <Ask/.test(lib) && /setAdding\(adding \? null : "ask"\)/.test(lib));
ok("…it calls the research route as the signed-in person", /authedFetch\("\/api\/library\/intake"/.test(intake));
ok("…an upload goes to the private intake folder under the business", /bucket: "library-intake", file, prefix: `\$\{prof\.tenant_id\}\/uploads`/.test(intake) && /"library-intake": \{ maxBytes: 20 \* MB/.test(takes) && /'library-intake', 'library-intake', false, 20971520/.test(mig));
ok("the draft card: exceptions first, the safe rest as one action, and what it still needs", /To decide · \{order\.length\}/.test(intake) && /Accept the safe rest \(\{safe\.length\}\)/.test(intake) && /Still needed for the Standard/.test(intake) && /p_bulk: true/.test(intake));
ok("…a correction is its own decision, with the original kept", /p_corrections: fix\[f\.id\]\?\.trim\(\)/.test(intake) && /p_bulk: false/.test(intake));
ok("…and it stays a candidate: nothing here qualifies or approves", /It stays a candidate/.test(intake) && !/status: "approved"|status: "qualified"/.test(intake));
ok("the picture on the card is labelled as the source's, not verified as the exact product", /not verified as this exact product/.test(intake) && /not verified as this exact product/.test(lib));
console.log(`IMS6 A3 — THE LIBRARY, VISUAL FIRST: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
