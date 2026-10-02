// WHAT A VIEWER SEES AS BOXES — measured in a real browser, not guessed from the stylesheet.
//
// Shared by scripts/design.ratchet.mjs (the Plan fixture), scripts/smoke.ui.mjs (every public
// route at phone width) and anyone who wants a number. Everything here runs INSIDE the page via
// page.evaluate, so it reads computed style and layout, which is the only honest answer to "is
// this a box": a rule in globals.css may be overridden, scoped, or never matched; the painted
// result cannot be.
//
// A BOX is an element the eye reads as a separate object: a visible border, outline or shadow, or
// a fill that differs from what is behind it. Radius on its own is invisible without one of those,
// so it does not count — a `border-radius` on a transparent div is not a box. Elements under 40×24
// px (dots, badges, icons) are not boxes either; they are marks.
//
// LEAF DEPTH is the number — for every innermost box, how many boxes sit around it. A list row at
// depth 4 means the viewer sees a box, in a box, in a box, in a box, before reading one line.
//
// THE OTHER NUMBERS (2026-10-01, "audit every page for structure, fluidity, friction"):
//   overflowX     — the page is wider than the phone: something does not wrap or has a min-width.
//   smallestTap   — the smallest interactive target's short side, px. Under 44 is a miss on a thumb.
//   smallestText  — the smallest visible text, px. Under 11 is below any phone floor.
//   fixedOverlays — fixed/sticky elements over the content at rest: each one is a thing the page
//                   cannot scroll away from.
//   headings      — h1 count and h2 count: one h1 and a real outline, or a screen reader has none.
//   nestedScroll  — scroll containers inside scroll containers: a trap for a thumb on a phone.
export const MEASURE = `(() => {
  const alpha = (c) => { const m = c && c.match(/rgba?\\(([^)]+)\\)/); if (!m) return c && c !== "transparent" ? 1 : 0; const p = m[1].split(",").map(Number); return p.length === 4 ? p[3] : 1; };
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; };
  const onScreenish = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > -4000 && r.top < innerHeight + 4000; };
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
  const root = document.querySelector(".screen") || document.querySelector("main") || document.body;
  const all = [...root.querySelectorAll("*")];
  const boxes = all.filter(isBox);
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

  // The rail, expanded: how much of the viewport it covers, and whether it sits over the content's
  // tap targets. On a phone (2026-10-02) it is a toolbar docked above the nav, not a stack at the
  // right edge, so WIDTH stopped being the number — a full-width bar is the point — and AREA plus
  // "what it covers" is. A docked bar covers whatever is scrolled under it, which is why the
  // scroll container gets padding when it is open; covered targets are counted only for the
  // interactive elements that could not be scrolled clear (the fixed ones).
  const rail = document.querySelector(".rail");
  const rr = rail ? rail.getBoundingClientRect() : null;
  const railArea = rr ? +((rr.width * rr.height) / (innerWidth * innerHeight)).toFixed(3) : 0;
  const railCoversFixed = rr ? [...document.querySelectorAll("a,button")].filter((el) => !rail.contains(el) && vis(el) && getComputedStyle(el).position === "fixed").filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left < rr.right && r.right > rr.left && r.top < rr.bottom && r.bottom > rr.top; }).length : 0;

  // The smallest text in the agenda list — the primary calendar view on a phone.
  let minFont = 99;
  for (const el of root.querySelectorAll(".cal-list *")) { if (!vis(el) || !(el.innerText || "").trim()) continue; const f = parseFloat(getComputedStyle(el).fontSize); if (f < minFont) minFont = f; }

  // ── route-level numbers ──
  // Overflow that can actually be SCROLLED TO. A container with overflow-x:hidden can report a
  // scrollWidth wider than its box (the brand watermark sits 21% past the right edge on purpose)
  // and no thumb will ever reach it; only auto/scroll/visible containers count.
  let overflowX = Math.max(0, document.documentElement.scrollWidth - innerWidth);
  for (const el of document.querySelectorAll("body, body *")) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll|visible)/.test(cs.overflowX)) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth >= innerWidth - 2) overflowX = Math.max(overflowX, el.scrollWidth - el.clientWidth);
  }
  let smallestTap = 999, smallestTapWhat = "";
  for (const el of document.querySelectorAll("a[href],button,[role=button],input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea,[tabindex]:not([tabindex='-1'])")) {
    // a checkbox/radio is styled by its label's hit area, which this cannot see; measured elsewhere
    if (!vis(el) || !onScreenish(el)) continue;
    const r = el.getBoundingClientRect(); const s = Math.min(r.width, r.height);
    if (r.bottom <= 0 || r.right <= 0) continue; // parked off-screen on purpose (the skip link) — not a target until focused
    if (s > 0 && s < smallestTap) { smallestTap = +s.toFixed(1); smallestTapWhat = (el.getAttribute("aria-label") || el.innerText || el.className || el.tagName).toString().trim().replace(/\\s+/g, " ").slice(0, 36); }
  }
  let smallestText = 99, smallestTextWhat = "";
  for (const el of all) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const f = parseFloat(getComputedStyle(el).fontSize);
    if (f < smallestText) { smallestText = f; smallestTextWhat = (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 36); }
  }
  let fixedOverlays = 0;
  for (const el of document.querySelectorAll("body *")) { const cs = getComputedStyle(el); if ((cs.position === "fixed" || cs.position === "sticky") && vis(el) && el.getBoundingClientRect().height > 8) fixedOverlays++; }
  const headings = { h1: document.querySelectorAll("h1").length, h2: document.querySelectorAll("h2").length };
  let nestedScroll = 0;
  const scrollers = [...document.querySelectorAll("body *")].filter((el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4 && vis(el); });
  for (const s of scrollers) { let p = s.parentElement; while (p) { if (scrollers.includes(p)) { nestedScroll++; break; } p = p.parentElement; } }

  return {
    viewport: innerWidth + "x" + innerHeight, boxes: boxes.length, leafBoxes: leaves.length, maxLeafDepth: max, leafDepthHistogram: hist, deepest: rows.slice(0, 8),
    frameOnSectionBody: frame, railAreaFraction: railArea, railCoversFixed, minAgendaFontPx: minFont === 99 ? null : minFont,
    overflowX, smallestTap: smallestTap === 999 ? null : smallestTap, smallestTapWhat, smallestText: smallestText === 99 ? null : smallestText, smallestTextWhat, fixedOverlays, headings, nestedScroll,
  };
})()`;

export async function measurePage(page) {
  return page.evaluate(MEASURE);
}
