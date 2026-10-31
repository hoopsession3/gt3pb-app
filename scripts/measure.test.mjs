// A SIZE AS A SOURCE SAYS IT, IN INCHES (IMS7 correctness, lib/measure). Units converted, what was said kept, anything
// else refused with a reason — never digits stripped and called inches. And the intake uses it.
import { loadTs } from "./search.read.mjs";
import { readFileSync } from "node:fs";
const U = loadTs("lib/measure.ts"), I = loadTs("lib/libraryIntake.ts");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };
const inch = (v, u) => { const m = U.toInches(v, u); return m.ok ? m.inches : `refused: ${m.why}`; };

const CASES = [
  // numbers, with and without a unit
  [96, null, 96], [96, "in", 96], [96, "inches", 96], [8, "ft", 96], [8, "feet", 96], [2438.4, "mm", 96], [243.84, "cm", 96], [2.4384, "m", 96],
  [1830, "mm", 72.05], [183, "cm", 72.05], [72.5, null, 72.5], [0.5, "in", 0.5],
  // text: decimals, fractions, units in the text, thousands
  ["72", null, 72], ["72.25", null, 72.25], ["72 1/2", null, 72.5], ["72½", null, 72.5], ["1/2", "in", 0.5], ["6 ft", null, 72], ["6ft", null, 72],
  ["1830 mm", null, 72.05], ["1,830 mm", null, 72.05], ["183cm", null, 72.05], ["1.83 m", null, 72.05], ["96\"", null, 96], ["96″", null, 96], ["8'", null, 96], ["8′", null, 96],
  // mixed feet and inches
  ["6' 2\"", null, 74], ["6 ft 2 in", null, 74], ["6′ 2½″", null, 74.5], ["6 ft 2-1/2 in", null, 74.5], ["6' 0\"", null, 72], ["6 ft 11.5 in", null, 83.5],
  // the same unit said twice agrees
  ["6 ft", "ft", 72], ["96 in", "in", 96],
];
for (const [v, u, want] of CASES) ok(`${JSON.stringify(v)}${u ? ` (${u})` : ""} → ${want}″`, inch(v, u) === want, inch(v, u));
const REFUSED = [
  ["6 ft", "mm", "disagree"], ["96 in", "cm", "disagree"], [96, "yd", "unit not understood"], ["96 yd", null, "unit not understood"], [96, "pcs", "unit not understood"],
  ["about six feet", null, "not a size"], ["60-72 in", null, "not a size"], ["72 x 36", null, "not a size"], ["", null, "no size"], [null, null, "no size"],
  [0, null, "not a positive"], [-5, "in", "not a positive"], ["-5 in", null, "not a size"], [Number.NaN, null, "not a number"], [Number.POSITIVE_INFINITY, null, "not a number"],
  [2500, null, "over 2400"], ["300 ft", null, "over 2400"], ["6 ft 14 in", null, "past 12"], ["1/0", null, "not a"],
];
for (const [v, u, why] of REFUSED) ok(`${JSON.stringify(v)}${u ? ` (${u})` : ""} is refused: ${why}`, String(inch(v, u)).startsWith("refused") && String(inch(v, u)).includes(why), inch(v, u));
const kept = U.toInches("1,830 mm", null), kept2 = U.toInches(8, "ft");
ok("what was said is kept beside the inches", kept.ok && kept.original.value === "1,830 mm" && kept.original.unit === null && kept2.ok && kept2.original.value === "8" && kept2.original.unit === "ft");
ok("two decimals, as the library stores (numeric(7,2))", U.toInches(1, "mm").inches === 0.04 && U.toInches(1000, "mm").inches === 39.37);

// The intake reads sizes through it.
const base = { method: "quoted", source_class: "manufacturer", source_ref: "https://maker.test/p", source_kind: "url" };
const { facts, dropped } = I.toDraftFacts([
  { ...base, field: "w_in", value: "6 ft" }, { ...base, field: "d_in", value: 1830, unit: "mm" }, { ...base, field: "h_in", value: "about 30 in" },
  { ...base, field: "w_in", value: 30, unit: "yd" }, { ...base, field: "cost_cents", value: "$1,890" }, { ...base, field: "cost_cents", value: 189000 },
], { kind: "url", ref: "https://maker.test/p" });
const by = (f) => facts.filter((x) => x.field === f);
ok("the intake: \"6 ft\" is 72″ — not 6″ (the old way)", by("w_in")[0]?.value === 72 && by("w_in")[0].unit === "in" && by("w_in")[0].original_value === "6 ft", by("w_in"));
ok("…1830 mm is 72.05″, its original kept", by("d_in")[0]?.value === 72.05 && by("d_in")[0].original_value === "1830" && by("d_in")[0].original_unit === "mm", by("d_in"));
ok("…\"about 30 in\" and a size in yards are dropped, each with its reason", dropped.some((d) => d.field === "h_in" && /not a size/.test(d.why)) && dropped.some((d) => d.field === "w_in" && /unit not understood/.test(d.why)), dropped);
ok("…a price is a number of cents as given — \"$1,890\" isn't guessed into one", by("cost_cents").length === 1 && by("cost_cents")[0].value === 189000 && dropped.some((d) => d.field === "cost_cents" && /not a price in cents/.test(d.why)));
ok("…facts that aren't sizes carry no original measurement", facts.filter((f) => !["w_in", "d_in", "h_in"].includes(f.field)).every((f) => f.original_value === null && f.original_unit === null));
const src = readFileSync(new URL("../lib/libraryIntake.ts", import.meta.url), "utf8");
ok("no digits stripped and called inches anywhere in the intake", !/replace\(\/\[\^0-9\.\]\/g/.test(src));
ok("the research is asked for sizes as printed, with their unit — GT3 converts", /as the source prints them, with their unit \(in, ft, mm, cm, m\) — GT3 converts them/.test(readFileSync(new URL("../lib/libraryResearch.ts", import.meta.url), "utf8")));
const card = readFileSync(new URL("../components/vision/LibraryIntake.tsx", import.meta.url), "utf8");
ok("a reviewer's correction to a size is read by the Studio's own parser (6′ 2″, 6 2 or 74), never Number()", /if \(\["w_in", "d_in", "h_in"\]\.includes\(field\)\) return parseFtIn\(t\) \?\? t;/.test(card) && !/Number\(fix\[f\.id\]\)/.test(card));
console.log(`A SIZE AS A SOURCE SAYS IT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
