// IMS7-A — THE LIBRARY, INSPECTED IN PARTS. The inspector is a sheet in three parts (Overview · Review (n) · Manage), the
// review grouped by what needs an eye, a seller's claim kept as their claim and never the specification, the copy plain — and the Primal governance words all still there.
import { readFileSync } from "node:fs";
import { loadTs } from "./search.read.mjs";
const V = loadTs("lib/libraryReview.ts");
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };
const lib = read("components/vision/Library.tsx"), intake = read("components/vision/LibraryIntake.tsx"), css = read("components/vision/library.css");
const mig = read("supabase/migrations/0462_gt3_researches_a_human_decides.sql");
const smoke = read("scripts/smoke.console.mjs");

// ── the inspector ──
ok("inspect is a sheet over the library, named for the asset — the list stays where it was", /<Sheet open onClose=\{onClose\} label=\{a\.name\}/.test(lib) && !/<section className="mpanel p-3 flex flex-col gap-3" aria-label=\{`\$\{shown\.name\} — inspect`\}>/.test(lib));
ok("…its head: the name, the category and the status, and a close", /<b>\{a\.name\}<\/b><span className="vz-card-s">\{CATEGORY_WORD\[a\.category\]\} · \{STATUS_WORD\[a\.status\]\}<\/span>/.test(lib) && /<CloseButton onClick=\{onClose\} \/>/.test(lib));
ok("three parts: Overview, Review (n) only when there are findings, Manage", /\{ key: "overview" as const, label: "Overview" \}, \.\.\.\(pending \? \[\{ key: "review" as const, label: `Review · \$\{pending\}` \}\] : \[\]\), \{ key: "manage" as const, label: "Manage" \}/.test(lib));
ok("…it opens on the overview, whatever is waiting — review is never opened for you", /const openOne = \(id: string, to: Part = "overview"\)/.test(lib) && /onClick=\{\(\) => openOne\(a\.id\)\}/.test(lib) && /const shown: Part = part === "review" && !pending \? "overview" : part;/.test(lib));
ok("…the overview says how many findings wait, one tap from them", /\{pending\} finding\{pending === 1 \? "" : "s"\} to decide/.test(lib));
ok("…a new asset entered by hand opens on Manage", /openOne\(id, "manage"\)/.test(lib));
ok("…closing it with Manage edits typed and not saved asks first", /useUnsaved\(Object\.keys\(draft\)\.length > 0 \|\|/.test(lib));
ok("…the parts are a choice (Segmented), tapped, not a swipe row", /<Segmented label=\{`\$\{a\.name\} — part`\} kind="choice"/.test(lib));
ok("…the console smoke opens the draft through its Review part", /clicks: \["Library", "Fixture bench", "Review"\], drawn: "\.xl-draft \.xl-facts"/.test(smoke));

// ── the review ──
ok("the review is grouped: one at a time (the exceptions), then safe to accept together", /One at a time · \{alone\.length\}/.test(intake) && /Safe to accept together · \{safe\.length\}/.test(intake) && intake.indexOf("One at a time") < intake.indexOf("Safe to accept together"));
ok("…the bulk action sits with what it accepts, and says what that is", /Sourced, low risk, and no source disagrees\./.test(intake) && intake.indexOf("Safe to accept together") < intake.indexOf("Accept the safe rest ("));
ok("a seller's claim is kept as their claim — never 'accepted' like a measured width", /\? <button type="button" className="btn-sec btn-sm" onClick=\{\(\) => void call\("std_accept_facts", \{ p_ids: \[f\.id\], p_corrections: \{\}, p_bulk: false \}, "Kept as their claim/.test(intake) && />Keep as their claim<\/button>/.test(intake) && /Kept as their claim — not verified, and not evidence\./.test(intake));
ok("…it can't be corrected into something else (that would be rewriting their word)", /\{!claim && !\(f\.id in fix\) && <button/.test(intake));
ok("…or discarded, kept on the record", /claim \? "Discard" : "Reject"/.test(intake));
ok("…said as theirs", /<b className="font-sans">They claim<\/b> “\{w\.value\}”/.test(intake));
ok("…kept apart from the specification", /const spec = accepted\.filter\(\(x\) => x\.field !== "claim"\), claims = accepted\.filter\(\(x\) => x\.field === "claim"\);/.test(intake) && /Their claims, not verified · \{claims\.length\}/.test(intake) && /Its specification · \{spec\.length\}/.test(intake));
const specCols = (mig.match(/spec_cols text\[\] := array\[([^\]]*)\]/) ?? [])[1] ?? "";
ok("…and the database agrees: keeping a claim writes no specification column", specCols.length > 0 && !specCols.includes("'claim'") && /if f\.field in \('w_in','d_in','h_in'\)/.test(mig) && /elsif f\.field = 'cost_cents'/.test(mig));
ok("…nor can it go in with the safe rest (a claim is a reason to decide alone)", V.whyAlone({ field: "claim", method: "quoted", source_class: "supplier", confidence: "high", risk: "high" }, new Set()).includes("a claim, not proven"));

// (Prices: one formatter, lib/money — the correctness patch's, tested in scripts/dims.test; not repeated here.)

// ── plain words, the governance kept ──
ok("no developer words left: no 'standard depth', 'charged in full', 'it researches within its budget'", !/standard depth|charged in full|within its budget/.test(intake));
ok("…the research said plainly: a quick look, a standard search, a deep search, and what it cost", /"A quick look"/.test(intake) && /"A deep search"/.test(intake) && /"A standard search"/.test(intake) && /cost \$\{r\.charged_cents\.toFixed\(2\)\}¢/.test(intake));
ok("the governance words are all still said", [/Unknown is never approved\. Nothing here is a certification\./, /\(intent, not an assessment\)/, /not verified as this exact product/, /a placeholder, not the product/].every((r) => r.test(lib)) && /It stays a candidate/.test(intake) && /never approves anything/.test(intake) && /not verified as this exact product/.test(intake));
ok("one colour for what needs an eye (the warning amber) — no red anywhere in the library", !/--red|--danger|#b82420|signal-red|text-red/i.test(css + lib + intake));
console.log(`IMS7-A — THE LIBRARY, INSPECTED IN PARTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
