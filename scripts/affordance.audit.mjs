// A PROMISE WITH NO DESTINATION — things that look tappable and are not, counted.
//
//   node scripts/affordance.audit.mjs          # count, and fail if either number rose
//   node scripts/affordance.audit.mjs --list   # every site, to read
//
// ── WHY (2026-10-04) ───────────────────────────────────────────────────────────────────────────
// Ryan, on his phone: "Clicking on Greenville Fit Fest today's op does nothing. Strategically look
// for where something is unnecessary information or should have operational functionality … this
// seems 2/10 through the entire app." The card was a <div>. Four read-only reviews of the console
// and the customer app that afternoon found the same shape a hundred and fifty times: a name, a
// chevron, a count or a sentence that promises somewhere to go, and nothing to tap. Each was fixed
// one screen at a time for months (RecordSheet's own header counts fifteen) because nothing
// counted them. This counts the two shapes a parser can see without guessing:
//
//   chevrons    a "›" drawn as the sign for "this goes somewhere" — a text node that is just the
//               glyph or ends in one ("Restock ›"), or an element whose class says chev — with
//               nothing interactive around it;
//   directions  a sentence that sends you to a place in this app in words — "set it in Money →
//               Product economics", "review it in Plan › Vendors" — with no door beside it. The
//               direction is the button that was never built.
//
// "Interactive" is <button>, <a>, <Link>, <RecordLink>, <summary>, <label>, <select>, <input>,
// <textarea>, an element with onClick / href / onPointerDown, or a `{...clickable(…)}` spread
// (lib/a11y). The walk goes up through everything — a chevron in a .map() inside a <button> is
// inside the button — and stops being sure, and so does not count, where a parser cannot follow:
// a prop handed to another component (`right={…}`), or JSX parked in a variable and rendered
// somewhere else in the file.
//
// ── WHAT IT DELIBERATELY DOES NOT COUNT, after reading every hit (2026-10-04) ───────────────────
//   · arrows that mean "becomes" or "then": "5 gal → 4.7 gal servable", "moved Draft → Sent", a
//     situation → what to do in a training module. The arrowRight icon is used that way all over;
//     only "›" and the chev classes mean "go".
//   · separators and gesture art: a breadcrumb's "›" (class *sep*/*crumb*, or inside a nav labelled
//     Breadcrumb) and the swipe-back cue (class *swipe*).
//   · a direction with its door beside it: Studio's "edited in Settings › Copy & wording" sits next
//     to "Open the copy editor". A sentence whose parent element also holds a button is answered.
//   · directions to another product ("right-click the mockup on Apliiq → Copy image address").
//     Only the console's own place names count (PLACES below).
// What it cannot see at all: a NAME that should open a record and is plain text has no glyph. That
// is still a reading job; this number is what may not grow.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Raise nothing. Lower freely. Measured 2026-10-04 after the day's fixes, every site read by hand.
export const CHEVRON_CEILING = 0;
export const DIRECTION_CEILING = 0;

const INTERACTIVE_TAGS = new Set(["button", "a", "Link", "RecordLink", "summary", "label", "select", "input", "textarea"]);
const INTERACTIVE_PROPS = new Set(["onClick", "href", "onPointerDown", "onMouseDown", "onTouchStart"]);
// The console's places (SEC_LABEL, the lanes, and the panels people are sent to by name).
export const PLACES = ["My Day", "Live Ops", "Command", "Readiness", "Plan", "Studio", "Brew", "Assets", "Delivery",
  "Notes", "Money", "Customers", "Team", "Settings", "Service", "Events", "Production", "Brand", "Business", "Today"];
const DIRECTION = new RegExp(`\\b(${PLACES.join("|")})\\s*[→›]\\s*[A-Z]`);
const CHEV = /(^|[\s-])chev(\s|-|$)/;

const tagName = (el) => {
  const t = el.tagName;
  return ts.isIdentifier(t) ? t.text : ts.isPropertyAccessExpression(t) ? t.name.text : t.getText();
};
const attrsOf = (el) => (el.attributes ? el.attributes.properties : []);
const attr = (el, name) => attrsOf(el).find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);
const attrText = (el, name) => { const a = attr(el, name); return a && a.initializer ? a.initializer.getText() : ""; };

function isInteractiveEl(el) {
  if (INTERACTIVE_TAGS.has(tagName(el))) return true;
  for (const a of attrsOf(el)) {
    if (ts.isJsxAttribute(a) && INTERACTIVE_PROPS.has(a.name.getText())) return true;
    if (ts.isJsxSpreadAttribute(a) && /^clickable\(/.test(a.expression.getText())) return true;
  }
  return false;
}
const openingOf = (n) => (ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null);

/** "yes" an interactive element holds it · "no" nothing does · "unknown" the parser cannot follow. */
export function guarded(node) {
  let p = node.parent;
  while (p) {
    const o = openingOf(p);
    if (o && isInteractiveEl(o)) return "yes";
    if (ts.isJsxAttribute(p)) {
      const owner = p.parent?.parent;
      const name = owner && (ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner)) ? tagName(owner) : "";
      if (/^[A-Z]/.test(name)) return "unknown";       // a prop handed to a component we cannot see into
    }
    if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) return "unknown";   // JSX parked for later
    if (ts.isReturnStatement(p) || ts.isArrowFunction(p) || ts.isFunctionDeclaration(p)) {
      // keep climbing: a .map() callback inside a <button> is inside the button
    }
    p = p.parent;
  }
  return "no";
}

/** A separator or gesture art, not a promise: its own class, or a Breadcrumb nav around it. */
function decorative(n) {
  for (let p = n; p; p = p.parent) {
    const o = openingOf(p);
    if (!o) continue;
    if (/sep|crumb|swipe/i.test(attrText(o, "className"))) return true;
    if (/Breadcrumb/.test(attrText(o, "aria-label"))) return true;
  }
  return false;
}

/** A DOOR beside the direction answers it: within the element, its parent or its grandparent, a
 *  control that GOES somewhere — a link, or a button whose class says go/link or that ends in a
 *  chevron or arrow. A <select>, a text box or the card's own Edit button is not that door. */
const GOISH = /(^|[\s-])(go|golink|link|xlink-go|cp-go|lk)(\s|-|$)/;
function isDoor(o, node) {
  const t = tagName(o);
  if (t === "a" || t === "Link" || t === "RecordLink") return true;
  if (!isInteractiveEl(o) || t === "select" || t === "input" || t === "textarea" || t === "label") return false;
  if (GOISH.test(attrText(o, "className").replace(/["'`{}$]/g, " "))) return true;
  const txt = node.getText();
  return /arrowRight|chevronRight|›<\/|›\s*<\/button>|›"\)|→/.test(txt);
}
/** The JSX elements directly inside an element — through `{cond && …}` and `{a ? b : c}`, not into
 *  other elements. A door has to stand beside the sentence, not somewhere deep in the same card. */
function directElements(h) {
  const out = [];
  const dig = (n) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) { out.push(n); return; }
    if (ts.isJsxFragment(n)) { n.children.forEach(dig); return; }
    if (ts.isJsxExpression(n) || ts.isBinaryExpression(n) || ts.isConditionalExpression(n) || ts.isParenthesizedExpression(n)) ts.forEachChild(n, dig);
  };
  const kids = ts.isJsxElement(h) ? h.children : [];
  kids.forEach(dig);
  return out;
}
function hasDoorBeside(el) {
  const up = (n) => { for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p)) return p; return null; };
  const parent = up(el), grand = parent ? up(parent) : null;
  for (const h of [parent, grand].filter(Boolean)) {
    for (const c of directElements(h)) { const o = openingOf(c); if (o && c !== el && isDoor(o, c)) return true; }
  }
  return false;
}

/** The two kinds of promise in one file's source. Exported for scripts/audits.test.mjs. */
export function promisesIn(src, file = "x.tsx") {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const chevrons = [], directions = [];
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n) => {
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, " ").trim();
      // A glyph inside an element whose class already says chev is that element's — counted once, there.
      const host = n.parent && openingOf(n.parent);
      const hostIsChev = host && CHEV.test(attrText(host, "className").replace(/["'`{}$]/g, " "));
      if ((t === "›" || / ›$/.test(t)) && !hostIsChev && !decorative(n) && guarded(n) === "no") chevrons.push({ line: line(n), what: t.slice(-60) });
    }
    const o = openingOf(n);
    if (o) {
      const cls = attrText(o, "className").replace(/["'`{}$]/g, " ");
      const self = isInteractiveEl(o);
      if (CHEV.test(cls) && !self && !decorative(n) && guarded(n) === "no") chevrons.push({ line: line(o), what: cls.trim().slice(0, 50) });
      // a direction: this element's own words (an arrow icon read as "→") name a place, then a page
      if (ts.isJsxElement(n)) {
        // Its OWN words: direct text, an arrow icon read as "→", nothing from the elements inside it —
        // so a sentence is counted once, at the element that says it.
        const own = n.children.map((c) => ts.isJsxText(c) ? c.text
          : (ts.isJsxSelfClosingElement(c) && tagName(c) === "Icon" && /arrowRight|chevronRight/.test(attrText(c, "name"))) ? " → "
          : " ").join("").replace(/\s+/g, " ");
        // Counted at the innermost element that says it, once: an outer element whose own words do
        // not include the direction is not a second site.
        if (DIRECTION.test(own) && !self && guarded(n) === "no" && !hasDoorBeside(n)
            && !directions.some((d) => d.line === line(o) && d.what === own.trim().slice(0, 80))) directions.push({ line: line(o), what: own.trim().slice(0, 80) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { chevrons, directions };
}

export function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.next|\.git|\.smoke|dist)$/.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

export function collect(root = ".") {
  const chevrons = [], directions = [];
  for (const f of [...walk(join(root, "app")), ...walk(join(root, "components"))]) {
    const r = promisesIn(readFileSync(f, "utf8"), f);
    const rel = f.replace(/^\.\//, "");
    for (const c of r.chevrons) chevrons.push({ file: rel, ...c });
    for (const d of r.directions) directions.push({ file: rel, ...d });
  }
  return { chevrons, directions };
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] || "").href) {
  const { chevrons, directions } = collect(".");
  if (process.argv.includes("--list")) {
    console.log("  chevrons with nothing to tap:");
    for (const c of chevrons) console.log(`    ${c.file}:${c.line}  ${c.what}`);
    console.log("  directions written as a sentence instead of a button:");
    for (const d of directions) console.log(`    ${d.file}:${d.line}  ${d.what}`);
  }
  console.log(`AFFORDANCE AUDIT: ${chevrons.length} chevron(s) with nothing to tap · ${directions.length} direction(s) written as a sentence instead of a button`);
  let bad = false;
  const check = (name, n, ceiling) => {
    if (n > ceiling) { console.log(`  ✗ RATCHET: ${name} ${n} > ${ceiling}. Something new promises a destination it does not have — --list names it.`); bad = true; }
    else if (n < ceiling) console.log(`  · ${name} below its ceiling (${n} < ${ceiling}) — lower it to ${n} to lock it in.`);
  };
  check("chevrons", chevrons.length, CHEVRON_CEILING);
  check("directions", directions.length, DIRECTION_CEILING);
  process.exit(bad ? 1 : 0);
}
