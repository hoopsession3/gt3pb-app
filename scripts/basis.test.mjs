// IMS7 (0470) — A PRICE SAYS WHAT KIND OF PRICE IT IS, ON SCREEN. The library's words for the five bases, a cost recorded
// as actual before them said so until a person chooses its basis, and the Manage form's choices.
import { readFileSync } from "node:fs";
import { loadTs } from "./search.read.mjs";
const L = loadTs("lib/experienceLibrary.ts");
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };
const A = (o) => L.toAsset({ id: "a", name: "x", category: "seating", status: "candidate", cost_cents: 189000, cost_unit: "each", ...o });
const mig = read("supabase/migrations/0470_a_price_says_what_kind.sql"), lib = read("components/vision/Library.tsx");
ok("the bases are the database's, in the same order of certainty", L.COST_BASES.join() === "estimated,listed,quoted,actual,scenario" && L.COST_BASES.every((b) => mig.includes(`'${b}'`)));
ok("each said in words: a published price is a listed price; actual is paid", L.costWords(A({ cost_basis: "listed" })).endsWith("· listed price") && L.costWords(A({ cost_basis: "actual" })).endsWith("· actual (paid)") && L.costWords(A({ cost_basis: "quoted" })).endsWith("· quoted"));
ok("a basis the library doesn't know reads as not said, never as actual", L.costWords(A({ cost_basis: "paid" })).endsWith("· basis not said"));
ok("a cost flagged before the four bases says so, beside its basis", /recorded as actual from a published price — say what it is$/.test(L.costWords(A({ cost_basis: "actual", cost_basis_flag: "actual_from_a_listing" }))) && /say which$/.test(L.costWords(A({ cost_basis: "actual", cost_basis_flag: "actual_paid_or_quoted" }))));
ok("…an unknown flag is no flag", L.toAsset({ id: "a", name: "x", category: "seating", status: "candidate", cost_basis_flag: "x" }).cost_basis_flag === null);
ok("Manage offers the five, plainly — and no longer \"paid or quoted\" as one", /<option value="listed">Listed \(a published price\)<\/option><option value="quoted">Quoted \(offered to GT3\)<\/option><option value="actual">Actual \(paid\)<\/option>/.test(lib) && !/paid or quoted\)<\/option>/.test(lib));
ok("…choosing the basis is what clears the flag (the database lets a person clear it, never set it)", /setBasisSaid\(true\)/.test(lib) && /\.\.\.\(basisSaid \? \{ cost_basis_flag: null \} : \{\}\)/.test(lib) && /new\.cost_basis_flag is not null and new\.cost_basis_flag is distinct from old\.cost_basis_flag and auth\.uid\(\) is not null/.test(mig));
ok("…and a flagged cost is said in Manage, with what to do", /This cost was \{FLAG_WORD\[a\.cost_basis_flag\]\}: choose its basis below and save\./.test(lib));
ok("a researched price is never accepted as actual", /cost_basis = case f\.source_class when 'ai_inference' then 'estimated' when 'gt3' then 'quoted' else 'listed' end/.test(mig) && !/then 'actual'/.test(mig.slice(mig.indexOf("create or replace function public.std_accept_facts"))));
console.log(`A PRICE SAYS WHAT KIND OF PRICE IT IS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
