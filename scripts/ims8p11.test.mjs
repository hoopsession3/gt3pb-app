// IMS8 P11 — STATUS THAT TELLS THE TRUTH; DISCLOSURE A PERSON CAN READ. The studio never says a link is ready while a
// confirmation is owed ("Needs confirmation", then "Ready to publish" once the server answers again with the same response);
// Preview is open before confirmations; Create waits for them. The inspector counts text fields and shows a few to
// recognise them by, tells included, excluded and worked-out apart, and keeps the diagnostics to itself. A flagged passage
// is shown in full, located, and the existing flows' confirm sheet says the same.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const SP = loadTs("lib/sharePreview.ts"), PR = loadTs("lib/publishReadiness.ts"), PUB = loadTs("lib/sharePublish.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };

ok("the bands say Can't share yet · Needs confirmation · Ready to publish — never \"reviewed\"", JSON.stringify(PR.BAND_WORD) === JSON.stringify({ cant: "Can't share yet", confirm: "Needs confirmation", ready: "Ready to publish" }));
const P = "0c47a000-0000-4000-8000-0000000000a1", L = "0c47a000-0000-4000-8000-0000000000b1";
const payload = { label: "L", show_asks: true, programs: [{ id: P, title: "The first store", summary: "One store in a gym.", why: "Internal: call Dana at 518-555-0134." }],
  asks: [{ program_id: P, plan_id: null, label: "Build-out", amount_cents: null, state: "open", note: null, sort: 1 }],
  plans: [{ id: L, program_id: P, name: "Gym bar", gate: "Gym signs.", needs: [{ label: "Choose the gym", due_on: "2026-12-01", done_on: null }], money: { version: 1, baseline: { scenarios: { base: { uses: [] } } } }, research: [], risks: [] }],
  layouts: [{ id: "0c47a000-0000-4000-8000-0000000000c1", name: "Storefront", width_in: 240, depth_in: 360, items: [] }] };
const tf = SP.textFields(payload);
ok("text fields are counted as such, with up to three to recognise them by (the shortest of each category)", tf.fields === 9 && tf.examples.length === 3 && tf.examples[0].title === "Roadmap programs" && tf.examples[0].text === "The first store", tf);
ok("…and the sentence says \"text fields\", never \"pieces of your writing\"", /— and 9 text fields written by you or your team/.test(SP.sendsSentence(payload)) && !/pieces of/.test(read("lib/sharePreview.ts")));
const der = SP.derivedOf(payload);
ok("what's worked out on their screen is said apart, only where the response supports it", der.length === 5 && /^From Gym bar's approved money:/.test(der[0]) && der.some((x) => /being priced, never \$0/.test(x)) && SP.derivedOf({ plans: [], asks: [], layouts: [] }).length === 0, der);
const lp = read("components/vision/LinkPreview.tsx");
ok("the inspector: Included, Worked out on their screen, Not included, and Diagnostics (fingerprint, check time, the response)", ["<b className=\"font-sans mt-1\">Included</b>", "Worked out on their screen</b> · not sent as text", "Not included</b>", "Diagnostics</b> · the response, exactly", "fingerprint {diag.fingerprint.slice(0, 12)}"].every((x) => lp.includes(x)));
const rev = { payload, fingerprint: "f".repeat(32), material: [`internal_words:program:${P}:0123456789ab`], latest: {}, private_names: [] };
const c = PUB.toConfirm(rev);
ok("the existing flows' confirm sheet shows the flagged passage in full and where it is", /“Internal: call Dana at 518-555-0134\.” — Roadmap program · The first store · why — says "internal"/.test(c.words[0]) && /exactly as written/.test(c.words[0]), c.words);
const st = read("components/vision/LinkStudio.tsx");
ok("the studio's status line: Needs confirmation (how many to go) · Checking · Ready to publish", /`Needs confirmation · \$\{review!\.material\.filter\(\(id\) => !d\.confirmed\.includes\(id\)\)\.length\} to go`/.test(st) && /"Ready to publish"/.test(st) && /Checking it's still what you reviewed…/.test(st));
ok("Create says what it waits for", /status === "needs" \? "Confirm above to create" : status === "checking" \? "Checking…" : "Create the link"/.test(st));
ok("…and Create is shut until the server has validated this review: the button and share() both wait for Ready", /disabled=\{busy \|\| status !== "ready"\}/.test(st) && /if \(!supabase \|\| !review \|\| busy \|\| status !== "ready"\) return;/.test(st) && /const status: .*validated === review\.fingerprint \? "ready"/.test(st));
ok("no permission is said in the database's words", !/database|refuses|PT40|PT42/i.test(st.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /[>"`]/.test(l) && !/import /.test(l)).join("\n").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")));
console.log(`IMS8 P11 — STATUS THAT TELLS THE TRUTH; DISCLOSURE A PERSON CAN READ: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
