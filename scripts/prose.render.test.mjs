// THE COMPONENT, ACTUALLY RENDERED.
//
// lib/prose.ts has 38 assertions and components/Prose.tsx had none, which left the half Ryan can
// see untested: the block→element mapping, the class names the stylesheet keys off, and the claim
// that this thing cannot emit HTML. A parser that is right and a renderer that is wrong looks
// exactly like a renderer that is right, until it is on a phone.
//
// It compiles the REAL .tsx and renders it with react-dom/server. That matters more than it
// sounds: while building this, the before/after preview was drawn by a hand-written mirror of
// Prose.tsx rather than by Prose.tsx, and a mirror agrees with whatever its author believed. That
// is the same failure this repo has already named twice — a fixture that answers differently from
// production is a test that lies.
//
// ── THE ONE THAT MATTERS ───────────────────────────────────────────────────────────────────────
// The input is model output, which means the input is arbitrary, and the whole safety argument for
// this feature is "it builds React elements, never HTML". That argument is worth exactly as much
// as the test below. Hostile strings go in; the output must contain no tag and no executable URL,
// and the characters must come back escaped rather than swallowed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${typeof got === "string" ? got : JSON.stringify(got)}` : "")); } };

// ── compile the real files ─────────────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "prose-render-"));
writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    outDir: join(dir, "out"), jsx: "react-jsx", target: "es2020", module: "commonjs",
    moduleResolution: "node", esModuleInterop: true, skipLibCheck: true,
    baseUrl: ROOT, paths: { "@/*": ["./*"] },
  },
  include: [join(ROOT, "components/Prose.tsx"), join(ROOT, "lib/prose.ts")],
}));
const tsc = spawnSync("npx", ["tsc", "-p", join(dir, "tsconfig.json")], { encoding: "utf8" });
if (tsc.status !== 0) {
  console.log("PROSE RENDER: could not compile components/Prose.tsx");
  console.log(tsc.stdout || tsc.stderr);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

// The compiled component still imports "@/lib/prose" — map the alias the way Next does.
const Module = require("node:module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) {
  if (req === "@/lib/prose") req = join(dir, "out/lib/prose.js");
  return origResolve.call(this, req, ...a);
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const Prose = require(join(dir, "out/components/Prose.js")).default;
const render = (text, className) => renderToStaticMarkup(React.createElement(Prose, { text, className }));

// ── the real reply, verbatim from the screenshot ───────────────────────────────────────────────
const REAL = [
  "For a **Rise batch using 340 g of coffee**, scale linearly from the 2 gal / 560 g spec:",
  "",
  "**Water:** 340 ÷ 560 × 2 gal = **~1.21 gal** (about 1 gal + 1.5 cups)",
  "",
  "**Everything else stays the same:**",
  "- Ratio: 1:13",
  "- Extraction: 20 h cold",
].join("\n");
{
  const h = render(REAL, "oa-msg assistant");
  ok("render: the asterisks are gone and the emphasis is real",
    !h.includes("**") && h.includes("<strong>Rise batch using 340 g of coffee</strong>"), h.slice(0, 120));
  ok("render: the quantity is bold", h.includes("<strong>~1.21 gal</strong>"));
  ok("render: the hyphens became a list", h.includes('<ul class="pr-ul">') && !h.includes("- Ratio"));
  ok("render: every bullet survived", (h.match(/<li>/g) || []).length === 2);
  ok("render: the bubble's own classes are kept so the stylesheet still applies",
    h.startsWith('<div class="pr oa-msg assistant">'), h.slice(0, 60));
  ok("render: paragraphs carry the class the CSS keys off", h.includes('<p class="pr-p">'));
}

// ── the block→element mapping, which only this test covers ─────────────────────────────────────
{
  ok("render: '# ' is h3", render("# One").includes("<h3 class=\"pr-h\">One</h3>"));
  // "## " is what the agent prompts instruct, so it is the level that actually ships.
  ok("render: '## ' — the level the prompts tell the model to use — is h4",
    render("## Two").includes("<h4 class=\"pr-h\">Two</h4>"));
  ok("render: '### ' and deeper collapse to h5", render("#### Four").includes("<h5 class=\"pr-h\">Four</h5>"));
  ok("render: a numbered list keeps the model's starting number",
    render("3. third\n4. fourth").includes('<ol class="pr-ol" start="3">'));
  ok("render: inline code becomes <code>", render("use `1.21 gal`").includes("<code>1.21 gal</code>"));
  // Needs a marker, or the whole thing takes the plain path and there is no <br> to find — which
  // is what the first version of this assertion missed. The plain path's own behaviour is covered
  // below; this is specifically about a MULTI-LINE paragraph inside the structured path.
  ok("render: a paragraph's own line breaks survive as <br> on the structured path",
    (render("**spec** line one\nline two").match(/<br\/?>/g) || []).length === 1,
    render("**spec** line one\nline two"));
}

// ── the plain path must be untouched ───────────────────────────────────────────────────────────
{
  const plain = "We're out of Rise until Thursday.";
  const h = render(plain, "oa-msg assistant");
  ok("render: an answer with no markers takes the plain path", h.includes("pr-plain"));
  ok("render: ...and is a single node with the text intact, as it was before any of this",
    h === `<div class="pr oa-msg assistant pr-plain">We&#x27;re out of Rise until Thursday.</div>`, h);
}

// ── SAFETY. The input is model output; the output must never be markup. ────────────────────────
const HOSTILE = [
  `<script>alert(1)</script>`,
  `<img src=x onerror=alert(1)>`,
  `**<script>alert(1)</script>**`,
  `[tap me](javascript:alert(1))`,
  `[tap me](//evil.example/steal)`,
  `[tap me](https://evil.example)`,
  `<a href="https://evil.example">free coffee</a>`,
  `- <iframe src="https://evil.example"></iframe>`,
  `\`<script>alert(1)</script>\``,
  `## <script>alert(1)</script>`,
  // WITH a marker, so these take the STRUCTURED path rather than falling to pre-wrap text — the
  // plain path is trivially safe and would have been the only thing tested otherwise.
  `**bold** and [tap me](javascript:alert(1))`,
  `**bold** and <img src=x onerror=alert(1)>`,
  `- [tap](//evil.example)`,
  `1. <script>alert(1)</script>`,
];
for (const bad of HOSTILE) {
  const h = render(bad, "oa-msg assistant");
  const label = bad.slice(0, 34).replace(/\n/g, " ");
  ok(`safety: no tag escapes from ${JSON.stringify(label)}`,
    !/<(script|img|iframe|a\s|svg|object|embed)/i.test(h.replace(/<a class="pr-a" href="\/[^"]*">/g, "")), h.slice(0, 130));
  // The invariant is ABOUT HREFS. "javascript:" appearing as escaped text a customer typed is
  // harmless and must survive; "javascript:" inside an href is the whole danger. The first version
  // of this assertion banned the substring, and so failed on inert text that was rendering
  // correctly — a check that cries wolf gets deleted by the next person.
  ok(`safety: no href is executable, from ${JSON.stringify(label)}`,
    ![...h.matchAll(/href="([^"]*)"/g)].some(([, u]) => !/^\/(?!\/)/.test(u)), h.slice(0, 130));
  ok(`safety: the ONLY anchors are ours, from ${JSON.stringify(label)}`,
    (h.match(/<a /g) || []).length === (h.match(/<a class="pr-a" href="\//g) || []).length, h.slice(0, 130));
  // Escaped, not swallowed: a customer who types about a <script> tag must still see their words.
  ok(`safety: the characters survive, escaped, from ${JSON.stringify(label)}`,
    !bad.includes("<") || h.includes("&lt;"), h.slice(0, 130));
}
// The only anchors that may exist are ours, pointing inside the app.
{
  const h = render("ok [the craft page](/craft) fine", "x");
  ok("safety: an internal link IS a real anchor", h.includes('<a class="pr-a" href="/craft">the craft page</a>'));
  const bad = render("no [x](https://evil.example) here", "x");
  ok("safety: an external link is inert text, brackets and all",
    !bad.includes("<a") && bad.includes("[x](https://evil.example)"), bad);
}

rmSync(dir, { recursive: true, force: true });
console.log(`\nPROSE RENDER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
