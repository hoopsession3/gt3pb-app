// R25 — EVERY STATUS LINE IS HEARD, A DRINK ADDED DRAWS ONLY THE CART, AND THE SPLASH'S "3" IS THE SIZE IT IS DRAWN
// (2026-10-18 — the 10/10 audit, accessibility F12, performance F19 and F14; Ryan: "Keep working to improve to a 10").
//
// (1) components/Said is compiled from its TypeScript and drawn with react-dom/server: the words where they were, the class
//     and the style kept, no live region of its own (the app's one, components/Announcer, says them). The twenty-nine lines
//     that were put on the page already holding their words — counted by scripts/spoken.audit.mjs, held at zero — are each
//     drawn by it now, their buttons left outside what is said.
// (2) The shell reads nothing that changes with the cart (CartChrome does, and only it), and the four providers it wraps
//     the app in hand their readers one value per change — the lint rule that says so held at zero.
// (3) The splash's "3" is the master exported at 960 wide, never redrawn; the outline "3" is one file wherever it is drawn,
//     the brand kit's own bytes.
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const src = (p) => readFileSync(join(ROOT, p), "utf8");

// ── (1) Said, drawn ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const compile = (rel, shims) => {
    const out = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const mod = { exports: {} };
    new Function("module", "exports", "require", out)(mod, mod.exports, (s) => (s in shims ? shims[s] : require(s)));
    return mod.exports;
  };
  const said = [];
  const Said = compile("components/Said.tsx", { "./Announcer": { announce: (w, how) => said.push([w, how]) } }).default;
  const html = renderToStaticMarkup(React.createElement("p", { className: "load-failed" },
    React.createElement(Said, { as: "span", assertive: true, className: "x", style: { marginTop: 4 } }, "Couldn’t load the notes."), " ",
    React.createElement("button", { type: "button" }, "Try again")));
  ok("Said draws its words where they were, with its class and its style, and no live region of its own — the button outside them",
    html === '<p class="load-failed"><span class="x" style="margin-top:4px">Couldn’t load the notes.</span> <button type="button">Try again</button></p>', html);
  const { collect, UNHEARD_BASELINE } = await import("./spoken.audit.mjs");
  ok("no status line is put on the page already holding its words (scripts/spoken.audit.mjs, held at zero)", UNHEARD_BASELINE === 0 && collect(ROOT).length === 0, collect(ROOT).slice(0, 3));
  ok("…and the audit runs with the others", JSON.parse(src("package.json")).scripts.audit.includes("node scripts/spoken.audit.mjs"));
  // The lines the round moved, each by its words: the failures said assertively, the rest politely, the buttons outside.
  const lines = [
    ["components/pass/ThePass.tsx", '<Said as="div" className="adm-attn" assertive>'],
    ["components/pass/ThePass.tsx", '<Said as="span"><b>{moreLine(more)}</b> not on the board yet.</Said> <button'],
    ["components/crew/DueList.tsx", '<Said as="span" assertive>Couldn&rsquo;t load {feedsWord(list.failed)} — this is not &ldquo;nothing due&rdquo;.</Said>{" "}'],
    ["components/Checkout.tsx", '<Said as="span">These are the menu&apos;s prices — we couldn&apos;t check yours just now. Pay checks before your card is charged.</Said>{" "}'],
    ["components/OrderFunnel.tsx", '<Said as="div" className="oa-day cursor-default active:transform-none">'],
    ["components/OrderFunnel.tsx", '<Said as="span" className="contents"><span className="oa-code-tag">{codeClean}</span>'],
    ["app/crew/page.tsx", '<Said as="span" assertive>Couldn&apos;t load the notes — this is not &ldquo;no notes&rdquo;.</Said>{" "}'],
    ["app/crew/page.tsx", '<Said as="p" className="adm-hud-line" assertive>Couldn&apos;t read the sales yet — trying again.</Said>'],
    ["app/3mpire/page.tsx", '<Said as="span" assertive>We couldn&apos;t load your card just now.</Said>'],
    ["components/MediaStudio.tsx", '<Said as="p" className="ms-busy">'],
  ];
  const missing = lines.filter(([f, l]) => !src(f).includes(l)).map(([f]) => f);
  ok("the lines moved to Said keep their words, classes and places — failures assertive", missing.length === 0, missing);
}

// ── (2) a drink added draws only the cart ───────────────────────────────────────────────────────────────────────────────
{
  const shell = src("components/AppShell.tsx");
  const body = (name) => { const i = shell.indexOf(`function ${name}(`); const j = shell.indexOf("\n}\n", i); return i < 0 ? "" : shell.slice(i, j); };
  const appShell = body("AppShell"), cart = body("CartChrome");
  ok("the shell reads only what never changes with the cart; CartChrome alone reads the cart",
    /const \{ toast \} = useAppStable\(\);/.test(appShell) && !/\buseApp\(\)/.test(appShell) && /\buseApp\(\)/.test(cart) && (shell.match(/\buseApp\(\)/g) || []).length === 1, { appShell: appShell.slice(0, 200) });
  ok("…which holds the drink and checkout sheets, the latch that keeps Checkout once wanted, and the close on a new page — where the shell had them",
    /if \(!checkoutWanted && \(cartCount > 0 \|\| coOpen\)\) setCheckoutWanted\(true\);/.test(cart) && /useEffect\(\(\) => \{ closeDrink\(\); \}, \[pathname, closeDrink\]\);/.test(cart)
      && /<Fence name="drink"/.test(cart) && /<Fence name="checkout"/.test(cart) && appShell.indexOf("</main>") < appShell.indexOf("<CartChrome />") && appShell.indexOf("<CartChrome />") < appShell.indexOf('<Fence name="announcer">'));
  const memo = { "components/OperatorSection.tsx": "const value = useMemo(() => ({ section, setSection, back, canGoBack, groupId, setGroupId: setGroup }), [section, setSection, back, canGoBack, groupId, setGroup]);",
    "components/TaskSheet.tsx": "const value = useMemo(() => ({ openTask }), [openTask]);",
    "components/RecordSheet.tsx": "const value = useMemo(() => ({ openRecord, closeRecord }), [openRecord, closeRecord]);",
    "components/Crumbs.tsx": "const value = useMemo(() => ({ crumbs, push, remove }), [crumbs, push, remove]);" };
  const unmemo = Object.entries(memo).filter(([f, l]) => !src(f).includes(l) || !/Provider value=\{value\}>/.test(src(f))).map(([f]) => f);
  ok("the four providers the shell wraps the app in hand their readers one value per change", unmemo.length === 0, unmemo);
  const { ZERO } = await import("./lint.ratchet.mjs");
  ok("…and a provider's value made new each render is a lint error held at zero, in every .tsx",
    ZERO.includes("react/jsx-no-constructed-context-values") && /files: \["\*\*\/\*\.tsx"\],\s+rules: \{ "react\/jsx-no-constructed-context-values": "error" \}/.test(src("eslint.config.mjs")));
}

// ── (3) the splash's "3", and the outline "3" ───────────────────────────────────────────────────────────────────────────
{
  const png = readFileSync(join(ROOT, "public/brand/gt3-3-960.png"));
  const dims = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];
  const [w, h] = dims(png), [mw, mh] = dims(readFileSync(join(ROOT, "public/brand/gt3-3.png")));
  ok("the splash's 3 is the master exported at 960 wide, its shape kept — and under half the bytes",
    w === 960 && h === Math.round((mh * 960) / mw) && png.subarray(1, 4).toString() === "PNG" && statSync(join(ROOT, "public/brand/gt3-3-960.png")).size < statSync(join(ROOT, "public/brand/gt3-3.png")).size * 0.6, { w, h, mw, mh });
  const splash = src("components/MarketingSplash.tsx");
  ok("…drawn with its size given, and the master left for the brand kit",
    splash.includes('<img className="spl-three" src="/brand/gt3-3-960.png" width={960} height={1271} alt="" />') && !splash.includes('src="/brand/gt3-3.png"'));
  const css = src("app/globals.css"), code = ["app/globals.css", "components/StatusCard.tsx"].map(src).join("\n");
  ok("the outline 3 is one file wherever it is drawn — the loading mark, the card and the watermarks — and the brand kit's own bytes",
    !code.includes("3_outline_cream.svg") && (css.match(/\/brand\/3-outline\.svg/g) || []).length === 7
      && readFileSync(join(ROOT, "public/brand/3-outline.svg")).equals(readFileSync(join(ROOT, "public/brand/3_outline_cream.svg"))));
}

console.log(`\nR25 — EVERY STATUS LINE HEARD, A DRINK DRAWS ONLY THE CART, THE SPLASH'S 3 THE SIZE IT IS DRAWN: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
