// IMS8 P1 — AN INVESTOR'S SCREENS READ ONLY THE LINK (the source side; the data side is db.ims8p1, the browser side the
// /present network walk in the patch's evidence). The link page and its explore view draw only the link's response:
// CaseWords takes the case's risks from it, the Money step reads no money table, the store's Evaluate lens reads no
// Standard results, and a read-only Studio never offers, keeps or clears anyone's local room draft. One mapping
// (toVision) turns a response into what the screens draw, for the investor and for the owner's preview alike.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 300)}` : "")); } };

const present = read("app/present/page.tsx"), plans = read("components/vision/Plans.tsx"), words = read("components/vision/CaseWords.tsx");
const money = read("components/vision/MoneyPanel.tsx"), evaluate = read("components/vision/Evaluate.tsx"), studio = read("components/vision/StoreDesigner.tsx"), vr = read("lib/visionRead.ts");
ok("one mapping: readShared returns toVision(the response); toVision is exported for the owner's preview", /return toVision\(data\);/.test(vr) && /export function toVision\(data: unknown\): Vision \{/.test(vr));
ok("the link page hands the plans the link's own cases, and the store its shared mode", /<Plans [^>]*shared=\{\{ cases: vision\.cases \?\? \{\} \}\}/.test(present) && /<StoreDesigner [^>]*canEdit=\{false\} shared /.test(present));
ok("a plan's case on a link: CaseWords gets the response's risks and can't edit; the money step mounts no MoneyPanel", /<CaseWords plan=\{p\} canEdit=\{canEdit && !shared\} onSaved=\{onSaved\} risks=\{shared \? \(shared\.cases\[p\.id\]\?\.risks \?\? \[\]\) : undefined\} \/>/.test(plans)
  && /\) : shared \? \(/.test(plans) && plans.indexOf(") : shared ? (") < plans.indexOf("<MoneyPanel plan={p}"));
ok("CaseWords: given the risks, it returns them before any read", /if \(risks\) return risks;\n    if \(!supabase\) return \[\];/.test(words));
ok("MoneyPanel: a reader isn't shown the money, so it isn't read", /if \(!canEdit\) return "not-yet";\n    if \(!supabase\)/.test(money));
ok("Evaluate: on a link, the Standard's results aren't read", /if \(!supabase \|\| shared\) return \[\];/.test(evaluate) && /\}, \[key, shared\]\);/.test(evaluate));
ok("the Studio: a read-only view never offers, keeps or clears a local room draft", /useState<KeptDraft \| null>\(\(\) => \(canEdit \? keptFor\(original\) : null\)\)/.test(studio) && /if \(!original \|\| kept \|\| !canEdit\) return;/.test(studio)
  && /setKept\(canEdit \? keptFor\(original\) : null\)/.test(studio) && /shared=\{shared\}/.test(studio));
console.log(`IMS8 P1 — AN INVESTOR'S SCREENS READ ONLY THE LINK (source): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
