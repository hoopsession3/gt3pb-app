// IMS7-B — THE VISUAL CATALOG. Each card's picture, best first: the accepted image, else a source's undecided one (said
// as theirs), else an honest placeholder; its box held while it loads; a picture that won't load falls back, never a
// broken image. Keeping our own copies is a server step, said as pending.
import { readFileSync } from "node:fs";
import { loadTs } from "./search.read.mjs";
const V = loadTs("lib/libraryReview.ts");
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };
const lib = read("components/vision/Library.tsx"), css = read("components/vision/library.css");
const I = (o) => ({ field: "image_url", review: "pending", method: "quoted", source_class: "manufacturer", source_ref: "https://www.maker.test/p", value: "https://cdn.maker.test/a.jpg", ...o });

ok("the ladder: the accepted image first", /const src = a\.image_url \? \{ url: a\.image_url, from: null as string \| null \} : pic \? \{ url: pic\.url, from: pic\.from \} : null;/.test(lib));
ok("…then a source's undecided picture, read with the library (pending image findings only)", /\.eq\("field", "image_url"\)\.eq\("review", "pending"\)/.test(lib) && /pics: picsOf\(/.test(lib));
ok("…chosen by the review's own rule: https, never an inference, never a rejected one", V.imageFor([I({})])?.from === "maker.test" && V.imageFor([I({ method: "inferred", source_class: "ai_inference" })]) === null && V.imageFor([I({ value: "http://x.test/a.jpg" })]) === null && V.imageFor([I({ review: "rejected" })]) === null);
ok("…said as the source's, not decided, not verified as the product", /`\$\{a\.name\} — \$\{src\.from\}'s picture, not decided yet`/.test(lib) && /\$\{pic\.from\}'s picture, not decided yet — not verified as this exact product\./.test(lib));
ok("…else the honest placeholder", /No picture yet — a placeholder, not the product\./.test(lib));
ok("a picture that won't load falls back to the placeholder — never a broken image", /onError=\{\(\) => setBroken\(src\.url\)\}/.test(lib) && /if \(!src \|\| broken === src\.url\) return <span className=\{big \? "xl-ph xl-img-big" : "xl-ph"\}/.test(lib));
ok("its box is held while it loads: a ratio, and the image's own size said", /\.xl-img\{[^}]*aspect-ratio:4\/3/.test(css) && /\.xl-img-big\{aspect-ratio:16\/9\}/.test(css) && /width=\{400\} height=\{big \? 225 : 300\}/.test(lib));
ok("lazy, decoded off the main thread", /loading="lazy" decoding="async" width=/.test(lib));
ok("the same picture on the card and in the overview", /<Picture a=\{a\} pic=\{d\.pics\.get\(a\.id\)\} \/>/.test(lib) && /<Picture a=\{a\} pic=\{pic\} big \/>/.test(lib));
ok("our own copies are said as pending, not pretended", /keeping our own copy needs a server step not built \(said, pending\)/.test(lib));
console.log(`IMS7-B — THE VISUAL CATALOG: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
