// WHAT A VIEWER SEES AS BOXES — measured in a real browser, not guessed from the stylesheet.
//
// Shared by scripts/design.ratchet.mjs (the gate) and anyone who wants a number. Everything here
// runs INSIDE the page via page.evaluate, so it reads computed style and layout, which is the only
// honest answer to "is this a box": a rule in globals.css may be overridden, scoped, or never
// matched; the painted result cannot be.
//
// A BOX is an element the eye reads as a separate object: a visible border, a shadow, or a fill
// that differs from what is behind it. Radius on its own is invisible without one of those, so it
// does not count — a `border-radius` on a transparent div is not a box. Elements under 40×24 px
// (dots, badges, icons) are not boxes either; they are marks.
//
// LEAF DEPTH is the number — for every innermost box, how many boxes sit around it. A list row at
// depth 4 means the viewer sees a box, in a box, in a box, in a box, before reading one line.
export const MEASURE = `(() => {
  const alpha = (c) => { const m = c && c.match(/rgba?\\(([^)]+)\\)/); if (!m) return c && c !== "transparent" ? 1 : 0; const p = m[1].split(",").map(Number); return p.length === 4 ? p[3] : 1; };
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; };
  const fillBehind = (el) => { let p = el.parentElement; while (p) { const c = getComputedStyle(p).backgroundColor; if (alpha(c) > 0.05) return c; p = p.parentElement; } return null; };
  const isBox = (el) => {
    if (!vis(el)) return false;
    const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 24) return false;
    const cs = getComputedStyle(el);
    const bordered = ["Top", "Left", "Bottom", "Right"].some((s) => parseFloat(cs["border" + s + "Width"]) > 0 && cs["border" + s + "Style"] !== "none" && alpha(cs["border" + s + "Color"]) > 0.05);
    const outlined = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && alpha(cs.outlineColor) > 0.05;
    const shadow = cs.boxShadow && cs.boxShadow !== "none";
    const filled = alpha(cs.backgroundColor) > 0.05 && cs.backgroundColor !== fillBehind(el);
    return bordered || outlined || shadow || filled;
  };
  const root = document.querySelector(".screen") || document.body;
  const boxes = [...root.querySelectorAll("*")].filter(isBox);
  const set = new Set(boxes);
  const depthOf = (el) => { let d = 0, p = el.parentElement; while (p && p !== document.body) { if (set.has(p)) d++; p = p.parentElement; } return d; };
  const leaves = boxes.filter((b) => !boxes.some((o) => o !== b && b.contains(o)));
  const hist = {};
  let max = 0;
  const rows = leaves.map((l) => {
    const d = depthOf(l) + 1; // the leaf itself is a box too
    hist[d] = (hist[d] || 0) + 1; if (d > max) max = d;
    return { depth: d, cls: String(l.className || l.tagName).slice(0, 44), text: (l.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 40) };
  }).sort((a, b) => b.depth - a.depth);

  // The accidental frame: the section body painting an outline while script-focused.
  const op = document.querySelector(".op-trans");
  const opCs = op && getComputedStyle(op);
  const frame = !!(op && document.activeElement === op && opCs.outlineStyle !== "none" && parseFloat(opCs.outlineWidth) > 0 && alpha(opCs.outlineColor) > 0.05);

  // The rail: how much of the viewport's width it covers when expanded.
  const rail = document.querySelector(".rail");
  const railFrac = rail ? +(rail.getBoundingClientRect().width / innerWidth).toFixed(2) : 0;

  // The smallest text in the agenda list — the primary calendar view on a phone.
  let minFont = 99;
  for (const el of root.querySelectorAll(".cal-list *")) { if (!vis(el) || !(el.innerText || "").trim()) continue; const f = parseFloat(getComputedStyle(el).fontSize); if (f < minFont) minFont = f; }

  return { viewport: innerWidth + "x" + innerHeight, boxes: boxes.length, leafBoxes: leaves.length, maxLeafDepth: max, leafDepthHistogram: hist, deepest: rows.slice(0, 8), frameOnSectionBody: frame, railWidthFraction: railFrac, minAgendaFontPx: minFont === 99 ? null : minFont };
})()`;

export async function measurePage(page) {
  return page.evaluate(MEASURE);
}
