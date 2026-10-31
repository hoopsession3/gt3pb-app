// ONE SIZE FORMATTER (IMS7). Feet and inches are said by lib/vision's ftIn everywhere — the Studio, the space checks and the
// library. The library had its own copy that split feet before rounding: 23.5″ read "1′ 12″", 143.6″ "11′ 12″" (live from
// IMS5b; research facts arrive as decimals). Tested at the rounding boundaries, and the copy kept from coming back.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadTs } from "./search.read.mjs";
const V = loadTs("lib/vision.ts");
const L = loadTs("lib/experienceLibrary.ts");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };

const CASES = [
  [0, "0″"], [0.49, "0″"], [0.5, "1″"], [8, "8″"], [11, "11″"], [11.49, "11″"], [11.5, "1′"], [11.6, "1′"], [12, "1′"],
  [12.49, "1′"], [12.5, "1′ 1″"], [23.49, "1′ 11″"], [23.5, "2′"], [24, "2′"], [30, "2′ 6″"], [96, "8′"], [143.5, "12′"],
  [143.6, "12′"], [150, "12′ 6″"], [1199.5, "100′"],
];
for (const [v, want] of CASES) ok(`ftIn(${v}) = ${want}`, V.ftIn(v) === want, V.ftIn(v));
for (const [v, want] of CASES) ok(`the library says ${v} as ${want}, the same as the Studio`, L.inches(v) === want, L.inches(v));
ok("never twelve inches", CASES.every(([v]) => !/(^|\s)12″/.test(L.inches(v))));
ok("an unknown size is said unknown, never 0″", L.inches(null) === "—" && L.inches(undefined) === "—" && L.inches(Number.NaN) === "—" && L.inches(Number.POSITIVE_INFINITY) === "—");
ok("a whole size in the library", L.sizeWords({ w_in: 23.5, d_in: 30, h_in: null }) === "2′ × 2′ 6″ × —", L.sizeWords({ w_in: 23.5, d_in: 30, h_in: null }));
ok("…and nothing given is said so", L.sizeWords({ w_in: null, d_in: null, h_in: null }) === "Size not said");
ok("typed back, a said size is the same size", CASES.filter(([v]) => v >= 1).every(([v, s]) => V.parseFtIn(s) === Math.round(v)));

// No second formatter: no line outside lib/vision.ts turns inches into feet AND inches (÷12 or %12 with ″). The plan's
// ruler, which only ever labels whole feet every 4′ (v % 48 === 0), is not a size and isn't one.
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p); } else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
walk(new URL("../lib", import.meta.url).pathname); walk(new URL("../components", import.meta.url).pathname);
const copies = files.filter((p) => !p.endsWith("lib/vision.ts")).filter((p) => readFileSync(p, "utf8").split("\n").some((l) => /[/%]\s*12\b/.test(l) && l.includes("″")));
ok("one formatter: no copy of ftIn elsewhere", copies.length === 0, copies);
console.log(`ONE SIZE FORMATTER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
