// IMS8 P7 — THE PUBLISHING STUDIO. Choose → Review → Preview → Share, one dominant action each, in a footer that clears
// the safe area. Three bands that look different; only what the database refuses (enforced, approval) or an unticked
// confirmation stops you — suggestions never do. Confirmations are kept only for the response they were given against;
// the review is read again on return, never assumed. The step is announced and focused; nothing moves for reduced motion.
// The draft (lib/linkDraft) is this tab's only: read and written here against a stand-in sessionStorage.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const LD = loadTs("lib/linkDraft.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };

// The draft, in this tab.
const store = new Map();
globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
LD.writeDraft(LD.EMPTY);
ok("an empty draft isn't kept", !store.has(LD.DRAFT_KEY));
const d = { ...LD.EMPTY, label: "Upstate", programs: ["p1"], cases: ["a"], step: "review", confirmed: ["asks_unset:link:link"], reviewed: "f".repeat(32) };
LD.writeDraft(d);
ok("a draft is kept whole — choices, the step, the confirmations and the fingerprint they were given against — and read back as it was", JSON.stringify(LD.readDraft()) === JSON.stringify(d), LD.readDraft());
store.set(LD.DRAFT_KEY, JSON.stringify({ label: 42, step: "publish-now", programs: ["p1", 7], confirmed: "all" }));
ok("…a tampered draft is read defensively: unknown step → Choose, wrong types dropped, nothing confirmed", JSON.stringify(LD.readDraft()) === JSON.stringify({ ...LD.EMPTY, programs: ["p1"] }), LD.readDraft());
store.set(LD.DRAFT_KEY, "{not json");
ok("…an unreadable one is no draft", LD.readDraft() === null);
globalThis.sessionStorage = { getItem: () => { throw new Error("refused"); }, setItem: () => { throw new Error("refused"); }, removeItem: () => { throw new Error("refused"); } };
ok("…storage refused: nothing kept, nothing thrown", LD.readDraft() === null && (() => { try { LD.writeDraft(d); return true; } catch { return false; } })());
ok("four steps, in order, said in words", JSON.stringify(LD.STEPS) === JSON.stringify(["choose", "review", "preview", "share"]) && LD.STEP_WORD.share === "Share");

// The studio.
const st = read("components/vision/LinkStudio.tsx"), css = read("components/vision/vision.css"), app = read("components/vision/VisionApp.tsx"), sh = read("components/vision/Shares.tsx");
ok("only what the database refuses blocks Review — enforced and approval; suggestions never", /const blocked = before\.filter\(\(f\) => f\.cls === "enforced" \|\| f\.cls === "approval"\);/.test(st) && /onClick=\{\(\) => void runReview\(\)\} disabled=\{busy \|\| blocked\.length > 0\}/.test(st));
ok("…and only an unticked confirmation blocks Preview and Share", /const allConfirmed = !!review && review\.material\.every\(\(id\) => d\.confirmed\.includes\(id\)\);/.test(st)
  && /set\(\{ step: "preview" \}\)\} disabled=\{busy \|\| !review \|\| !allConfirmed\}/.test(st) && /void share\(\)\} disabled=\{busy \|\| !review \|\| !allConfirmed\}/.test(st) && /if \(!supabase \|\| !review \|\| busy \|\| !allConfirmed\) return;/.test(st));
ok("the material findings are the server's ids, each a checkbox in the amber band, said in words (or plainly when unknown)", /review\.material\.map\(\(id, i\) => \(\n?\s*<label key=\{id\} className="prod-toggle ls-check"><input type="checkbox" checked=\{d\.confirmed\.includes\(id\)\}/.test(st) && /<legend className="font-sans font-bold">Confirm before sharing<\/legend>/.test(st));
ok("…published with exactly those ids, after every one is ticked", /publishLink\(supabase, null, pub, review, review\.material\)/.test(st));
ok("confirmations stand only for the response they were given against (a new fingerprint clears them)", /confirmed: x\.reviewed === r\.fingerprint \? x\.confirmed\.filter\(\(id\) => r\.material\.includes\(id\)\) : \[\]/.test(st));
ok("a change after review goes back to Choose, and the old review is dropped", /const edit = \(p: Partial<StudioDraft>\) => \{ set\(\{ \.\.\.p, step: "choose" \}\); setReview\(null\); \};/.test(st));
ok("back from a fix (or a reload) on a later step: the review is read again, never assumed", /if \(!resumed\.current && d\.step !== "choose" && !review\) \{ resumed\.current = true; void runReview\(d\.step\); \}/.test(st) && /Reading it again — the review is never assumed/.test(st));
ok("one verdict, at most three findings before \"more\", worth-a-look items with a way to fix them", /<div className=\{ready\.band === "cant" \? "ls-verdict cant" : ready\.band === "confirm" \? "ls-verdict confirm" : "ls-verdict ready"\}><b>\{ready\.verdict\}<\/b><\/div>/.test(st) && /look\.slice\(0, Math\.max\(0, 3 - material\.length\)\)/.test(st) && /suggestions never stop you sharing/.test(st) && /onGo\(f\.go!\)/.test(st));
ok("a fix goes to the place its finding names, with the way back to the link", /const goTo = useCallback\(\(g: \{ section: string; anchor\?: string \| null \}\) => setPlace\(placeOfGo\(g, "links"\)\), \[\]\);/.test(app) && /onGo=\{goTo\}/.test(app) && /onGo=\{onGo\}/.test(sh));
ok("the fingerprint line: the same response the link will send, and when it was checked", /The same response the link will send · checked/.test(st));
ok("Preview: the investor view of the reviewed response itself, and every field inspected", /<Present vision=\{toVision\(review\.payload\)\}/.test(st) && /<LinkPreview payload=\{review\.payload\} \/>/.test(st));
ok("Share says the contract: exactly what was reviewed; later edits wait; turning it off is at once", /It sends exactly what you reviewed\. Edits you make after sharing wait until you review and share it again/.test(st) && /turning it off works at once/.test(st));
ok("the step is announced (a live region) and its heading takes focus", /<p className="sr-only" aria-live="polite">\{`Step \$\{n\} of 4, \$\{STEP_WORD\[step\]\}\./.test(st) && /<h2 ref=\{head\} tabIndex=\{-1\}/.test(st) && /head\.current\?\.focus\(\)/.test(st));
ok("the footer: one dominant action, sticky, clear of the safe area; inputs scroll clear of it; no motion when reduced", /\.ls-foot\{position:sticky;bottom:0;[^}]*padding:10px 14px calc\(10px \+ env\(safe-area-inset-bottom,0px\)\)/.test(css) && /\.ls input,\.ls select,\.ls textarea\{scroll-margin-bottom:120px\}/.test(css) && /prefers-reduced-motion:reduce\)\{\.ls \*\{transition:none!important;animation:none!important\}/.test(css)
  && (st.match(/className="btn-pri"/g) ?? []).length === 4);
ok("the three bands look different (red with a lock, amber, green)", /\.ls-verdict\.cant\{[^}]*--tone-crit/.test(css) && /\.ls-verdict\.confirm\{[^}]*--tone-warn/.test(css) && /\.ls-verdict\.ready\{[^}]*--tone-ok/.test(css) && /🔒/.test(st));
console.log(`IMS8 P7 — THE PUBLISHING STUDIO: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
