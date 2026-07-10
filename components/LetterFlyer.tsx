"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadToBucket } from "@/lib/uploads";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";

// LETTER FLYER — 10 generic, fully-editable announcement templates, drawn on canvas so they're
// pixel-identical every time. Unlike the poster Road Flyer, these carry NO preset GT3 saying — you
// write the announcement. The only fixed brand line is the tagline "Pure Signal. No Noise." The
// core content is vertically centered, so every style renders cleanly in any social format
// (Post 4:5, Square 1:1, Story 9:16, Landscape 16:9).
const BASE_M = 64;
const INK = "#15120D", RED = "#B82420", CREAM = "#F5F1E8", GOLD = "#A97C3F", GOLD_LT = "#C8A661";
const cm = (a: number) => `rgba(245,241,232,${a})`;
const mc = (a: number) => `rgba(21,18,13,${a})`;
// Crop box (fractions of gt3pb-handle.png) isolating the red "GT3" — we draw THESE pixels, never a redraw.
const LOGO = { fx: 0.035, fy: 0.05, fw: 0.93, fh: 0.5 };

type Style = { id: string; name: string; note: string };
const STYLES: Style[] = [
  { id: "letterhead", name: "Letterhead", note: "classic · centered" },
  { id: "memo", name: "Memo", note: "typewriter · TO / FROM" },
  { id: "editorial", name: "Editorial", note: "magazine · italic" },
  { id: "notice", name: "Notice", note: "framed · formal" },
  { id: "telegram", name: "Telegram", note: "vintage · STOP" },
  { id: "card", name: "Card", note: "charcoal · gilded" },
  { id: "manifesto", name: "Manifesto", note: "bold · statement" },
  { id: "gilded", name: "Gilded", note: "opulent · warm" },
  { id: "minimal", name: "Minimal", note: "quiet · airy" },
  { id: "bulletin", name: "Bulletin", note: "red banner · urgent" },
];

type Fmt = { id: string; label: string; w: number; h: number };
const FORMATS: Fmt[] = [
  { id: "portrait", label: "Post 4:5", w: 1080, h: 1350 },
  { id: "square", label: "Square 1:1", w: 1080, h: 1080 },
  { id: "story", label: "Story 9:16", w: 1080, h: 1920 },
  { id: "landscape", label: "Landscape 16:9", w: 1920, h: 1080 },
];

type Fields = { kicker: string; headline: string; body: string; signoff: string; date: string };
const DEFAULTS: Fields = {
  kicker: "Announcement",
  headline: "A Note From GT3",
  body: "We have something to share. Add your message here — what's changing, when it takes effect, and anything worth knowing.\nKeep it plain, and let it breathe.",
  signoff: "— Ryan & Kayla, GT3 Performance Bar",
  date: "",
};

type Ctx = CanvasRenderingContext2D;
type Img = HTMLImageElement | null;
/* eslint-disable @typescript-eslint/no-explicit-any */
const ls = (c: Ctx, v: string) => { (c as any).letterSpacing = v; };

// ── shared canvas primitives ──
const rr = (c: Ctx, x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
const wrapText = (c: Ctx, text: string, maxW: number) => {
  const words = (text || "").split(" "); const lines: string[] = []; let cur = "";
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
};
const eyebrow = (c: Ctx, t: string, x: number, y: number, color: string, align: CanvasTextAlign = "left", sp = 4, size = 21) => {
  c.save(); ls(c, `${sp}px`); c.font = `500 ${size}px 'DM Mono', monospace`; c.fillStyle = color; c.textAlign = align;
  c.fillText((t || "").toUpperCase(), x, y); c.restore(); ls(c, "0px"); c.textAlign = "left";
};
const fitDisp = (c: Ctx, t: string, maxSize: number, maxW: number, tr = -1) => {
  c.save(); ls(c, `${tr}px`); c.font = `900 ${maxSize}px 'Archivo Black', system-ui`; const w = c.measureText(t || "").width; c.restore(); ls(c, "0px");
  return w > maxW ? Math.max(40, Math.floor(maxSize * (maxW / w))) : maxSize;
};
const goldHead = (c: Ctx, y: number, size: number) => { const g = c.createLinearGradient(0, y - size, 0, y + 8); g.addColorStop(0, GOLD_LT); g.addColorStop(.5, GOLD); g.addColorStop(1, "#8a6531"); return g; };
// the REAL GT3 logo, cropped from the asset — never redrawn. chip = cream backing for the red field.
const gtLogo = (c: Ctx, logo: Img, cx: number, cy: number, h: number, chip: boolean, W: number) => {
  if (!logo || !logo.width) return null;
  const sx = LOGO.fx * logo.width, sy = LOGO.fy * logo.height, sw = LOGO.fw * logo.width, sh = LOGO.fh * logo.height;
  let dh = h, dw = sw * (dh / sh); const maxW = W - 2 * BASE_M - 100; if (dw > maxW) { const k = maxW / dw; dw *= k; dh *= k; }
  if (chip) { c.fillStyle = CREAM; rr(c, cx - dw / 2 - 18, cy - dh / 2 - 12, dw + 36, dh + 24, 12); c.fill(); }
  c.drawImage(logo, sx, sy, sw, sh, cx - dw / 2, cy - dh / 2, dw, dh);
  return dw / 2;
};
const emblem = (c: Ctx, logo: Img, cx: number, cy: number, h: number, dark: boolean, W: number, chip = false) => {
  const hw = gtLogo(c, logo, cx, cy, h, chip, W); if (hw != null) return hw;
  c.save(); ls(c, "-2px"); c.font = `900 ${h * .8}px 'Archivo Black', system-ui`; c.textAlign = "center"; c.textBaseline = "middle";
  const w = c.measureText("GT3").width; c.fillStyle = dark ? CREAM : RED; c.fillText("GT3", cx, cy);
  c.restore(); ls(c, "0px"); c.textAlign = "left"; c.textBaseline = "alphabetic"; return w / 2;
};
const crestRow = (c: Ctx, logo: Img, cx: number, cy: number, h: number, lineColor: string, dark: boolean, W: number, chip: boolean, ml: number) => {
  const hw = emblem(c, logo, cx, cy, h, dark, W, chip);
  c.strokeStyle = lineColor; c.lineWidth = 1.5; c.beginPath();
  c.moveTo(ml + 6, cy); c.lineTo(cx - hw - 20, cy); c.moveTo(cx + hw + 20, cy); c.lineTo(W - ml - 6, cy); c.stroke();
  return hw;
};
// measured paragraph height (px) for a given line-height
const paraH = (c: Ctx, text: string, font: string, maxW: number, lh: number) => {
  c.font = font; let h = 0;
  for (const p of (text || "").split("\n")) { if (!p.trim()) { h += lh * .55; continue; } h += wrapText(c, p.trim(), maxW).length * lh; h += lh * .34; }
  return h;
};
// draw a paragraph from a TOP y (not baseline); returns bottom y
const paraTop = (c: Ctx, text: string, x: number, top: number, maxW: number, font: string, size: number, lh: number, color: string, align: CanvasTextAlign = "left") => {
  c.font = font; c.fillStyle = color; c.textAlign = align;
  const ax = align === "center" ? x + maxW / 2 : align === "right" ? x + maxW : x;
  let y = top + size * .82;
  for (const p of (text || "").split("\n")) { if (!p.trim()) { y += lh * .55; continue; } for (const l of wrapText(c, p.trim(), maxW)) { c.fillText(l, ax, y); y += lh; } y += lh * .34; }
  c.textAlign = "left"; return y - size * .82;
};
const capLines = (c: Ctx, text: string, size: number, maxW: number, tr: number) => {
  c.save(); ls(c, `${tr}px`); c.font = `900 ${size}px 'Archivo Black', system-ui`;
  const words = (text || "").toUpperCase().split(" "); const lines: string[] = []; let cur = "";
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); c.restore(); ls(c, "0px"); return lines;
};
// the one fixed brand line — same lockup as the poster flyer footer
const footerMark = (c: Ctx, logo: Img, dark: boolean, W: number, H: number, ml: number) => {
  c.fillStyle = dark ? cm(.28) : "rgba(200,166,97,.5)"; c.fillRect(ml, H - 150, W - 2 * ml, 1.5); c.textAlign = "left";
  if (logo && logo.width) {
    const sx = LOGO.fx * logo.width, sy = LOGO.fy * logo.height, sw = LOGO.fw * logo.width, sh = LOGO.fh * logo.height;
    const dh = 40, dw = sw * (dh / sh), y = Math.round(H - 96 - dh / 2); c.drawImage(logo, sx, sy, sw, sh, ml, y, dw, dh);
  } else { c.font = "900 38px 'Archivo Black', system-ui"; c.fillStyle = dark ? CREAM : RED; c.fillText("GT3", ml, H - 74); }
  c.textAlign = "right"; c.font = "900 28px 'Archivo Black', system-ui"; c.fillStyle = dark ? CREAM : INK; c.fillText("PURE SIGNAL.", W - ml, H - 98);
  c.fillStyle = RED; c.fillText("NO NOISE.", W - ml, H - 64); c.textAlign = "left";
};
// center a content block of height CH between topY and botY → returns start TOP y
const centerY = (topY: number, botY: number, CH: number) => topY + Math.max(16, (botY - topY - CH) / 2);

// ── the 10 letter layouts, format-fluid (core content vertically centered) ──
function drawStyle(c: Ctx, logo: Img, id: string, F: Fields, W: number, H: number) {
  // cap the text column and center it — keeps line lengths sane on wide (16:9) canvases
  const CW = Math.min(W - 2 * BASE_M, 1120), M = (W - CW) / 2;
  c.textBaseline = "alphabetic"; c.textAlign = "left"; ls(c, "0px");
  const dark = id === "card";
  const paper = dark ? INK : id === "gilded" ? "#efe7d6" : id === "telegram" ? "#f1ead9" : CREAM;
  const ink = dark ? CREAM : INK;
  c.fillStyle = paper; c.fillRect(0, 0, W, H);
  const footTop = H - 172, signY = H - 205;

  if (id === "letterhead") {
    const cy = Math.max(120, Math.min(158, H * .13)); crestRow(c, logo, W / 2, cy, 60, GOLD, dark, W, false, M);
    eyebrow(c, F.kicker, W / 2, cy + 66, GOLD, "center", 6);
    if (F.date) eyebrow(c, F.date, W - M - 6, cy + 66, mc(.5), "right", 3, 18);
    c.strokeStyle = GOLD; c.lineWidth = 1.5; c.strokeRect(M - 20, 44, W - 2 * (M - 20), H - 88);
    const topY = cy + 96, bodyH = paraH(c, F.body, "400 31px Inter, system-ui", CW - 60, 44), CH = 76 + 40 + 50 + bodyH;
    const y = centerY(topY, signY - 40, CH);
    c.font = "italic 600 76px Fraunces, Georgia, serif"; c.fillStyle = ink; c.textAlign = "center"; c.fillText(F.headline, W / 2, y + 62); c.textAlign = "left";
    c.fillStyle = RED; c.fillRect(W / 2 - 40, y + 108, 80, 4);
    paraTop(c, F.body, M + 30, y + 150, CW - 60, "400 31px Inter, system-ui", 31, 44, ink);
    c.font = "italic 600 34px Fraunces, Georgia, serif"; c.fillStyle = ink; c.textAlign = "right"; c.fillText(F.signoff, W - M - 30, signY); c.textAlign = "left";
    footerMark(c, logo, dark, W, H, M); return;
  }
  if (id === "memo") {
    c.font = "900 52px 'Archivo Black', system-ui"; c.fillStyle = INK; c.fillText("MEMORANDUM", M, 132);
    emblem(c, logo, W - M - 70, 112, 54, false, W);
    c.fillStyle = INK; c.fillRect(M, 160, CW, 4);
    const rows: [string, string][] = [["TO", "Everyone"], ["FROM", F.signoff.replace(/^—\s*/, "")], ["DATE", F.date || "—"], ["RE", F.kicker]];
    let y = 224;
    for (const [k, v] of rows) { c.save(); ls(c, "2px"); c.font = "500 26px 'DM Mono', monospace"; c.fillStyle = mc(.5); c.fillText(k.padEnd(6), M, y); c.restore(); c.fillStyle = INK; c.font = "500 27px 'DM Mono', monospace"; c.fillText(v, M + 150, y); y += 46; }
    c.strokeStyle = mc(.5); c.lineWidth = 1.5; c.beginPath(); c.moveTo(M, y + 4); c.lineTo(W - M, y + 4); c.stroke(); c.beginPath(); c.moveTo(M, y + 10); c.lineTo(W - M, y + 10); c.stroke();
    const topY = y + 30, bodyH = paraH(c, F.body, "400 30px Inter, system-ui", CW, 44), CH = 54 + 40 + bodyH;
    const cy2 = centerY(topY, footTop, CH);
    c.font = "700 46px Inter, system-ui"; c.fillStyle = INK; c.fillText(F.headline, M, cy2 + 46);
    paraTop(c, F.body, M, cy2 + 94, CW, "400 30px Inter, system-ui", 30, 44, mc(.75));
    footerMark(c, logo, false, W, H, M); return;
  }
  if (id === "editorial") {
    eyebrow(c, F.kicker, M, 116, RED, "left", 5);
    emblem(c, logo, W - M - 58, 104, 50, false, W);
    c.fillStyle = mc(.85); c.fillRect(M, 142, CW, 3);
    c.font = "italic 600 90px Fraunces, Georgia, serif"; const hl = wrapText(c, F.headline, CW);
    const body = F.body.replace(/\n/g, " "), bodyH = paraH(c, body, "400 32px Inter, system-ui", CW, 46), CH = hl.length * 92 + 50 + bodyH;
    const y = centerY(170, signY - 30, CH);
    c.font = "italic 600 90px Fraunces, Georgia, serif"; c.fillStyle = INK; c.textAlign = "left"; let hy = y + 78; for (const l of hl) { c.fillText(l, M, hy); hy += 92; }
    c.fillStyle = RED; c.fillRect(M, hy - 38, 90, 5);
    c.font = "700 118px Georgia, serif"; c.fillStyle = RED; c.fillText(body[0] || "", M, hy + 118); const dcw = c.measureText(body[0] || "").width + 16;
    c.font = "400 32px Inter, system-ui"; c.fillStyle = mc(.8); const first = wrapText(c, body.slice(1), CW - dcw); let yy = hy + 70; let i = 0;
    for (; i < first.length && i < 2; i++) { c.fillText(first[i], M + dcw, yy); yy += 46; }
    paraTop(c, first.slice(i).join(" "), M, yy - 24, CW, "400 32px Inter, system-ui", 32, 46, mc(.8));
    c.font = "italic 600 32px Fraunces, Georgia, serif"; c.fillStyle = INK; c.fillText(F.signoff, M, signY);
    footerMark(c, logo, false, W, H, M); return;
  }
  if (id === "notice") {
    c.strokeStyle = GOLD; c.lineWidth = 3; c.strokeRect(M - 24, 40, W - 2 * (M - 24), H - 80); c.strokeStyle = GOLD_LT; c.lineWidth = 1; c.strokeRect(M - 12, 52, W - 2 * (M - 12), H - 104);
    ([[M - 24, 40], [W - (M - 24), 40], [M - 24, H - 40], [W - (M - 24), H - 40]] as const).forEach(([x, y]) => { c.fillStyle = GOLD; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); });
    const cy = Math.max(112, Math.min(150, H * .12)); emblem(c, logo, W / 2, cy, 56, false, W);
    eyebrow(c, `· ${F.kicker} ·`, W / 2, cy + 80, RED, "center", 6, 24);
    c.font = "italic 600 64px Fraunces, Georgia, serif"; const hl = wrapText(c, F.headline, CW - 80);
    const bodyH = paraH(c, F.body, "400 31px Inter, system-ui", CW - 160, 46), CH = hl.length * 68 + 40 + bodyH;
    const y = centerY(cy + 108, signY - 20, CH);
    c.font = "italic 600 64px Fraunces, Georgia, serif"; c.fillStyle = INK; c.textAlign = "center"; let hy = y + 56; for (const l of hl) { c.fillText(l, W / 2, hy); hy += 68; } c.textAlign = "left";
    c.strokeStyle = GOLD; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W / 2 - 70, hy); c.lineTo(W / 2 + 70, hy); c.stroke(); c.fillStyle = GOLD; c.beginPath(); c.arc(W / 2, hy, 5, 0, 7); c.fill();
    paraTop(c, F.body, W / 2 - (CW - 160) / 2, hy + 22, CW - 160, "400 31px Inter, system-ui", 31, 46, mc(.72), "center");
    if (F.date) eyebrow(c, F.date, W / 2, signY, mc(.5), "center", 3, 20);
    footerMark(c, logo, false, W, H, M); return;
  }
  if (id === "telegram") {
    c.strokeStyle = INK; c.lineWidth = 3; c.beginPath(); c.moveTo(M, 90); c.lineTo(W - M, 90); c.stroke(); c.lineWidth = 1.5; c.beginPath(); c.moveTo(M, 98); c.lineTo(W - M, 98); c.stroke();
    emblem(c, logo, W / 2, 158, 50, false, W);
    eyebrow(c, "GT3 TELEGRAM", W / 2, 232, INK, "center", 8, 28);
    eyebrow(c, `${F.date || "—"}  —  PRIORITY`, W / 2, 272, mc(.55), "center", 3, 19);
    c.strokeStyle = mc(.4); c.lineWidth = 1; c.beginPath(); c.moveTo(M, 298); c.lineTo(W - M, 298); c.stroke();
    const tel = `${F.headline}. ${F.body.replace(/\n/g, " ")}`.toUpperCase().replace(/\.\s*/g, " STOP ").trim();
    c.save(); ls(c, "1px"); c.font = "500 30px 'DM Mono', monospace"; const lines = wrapText(c, tel, CW); c.restore(); ls(c, "0px");
    const CH = lines.length * 46 + 60, y = centerY(320, footTop, CH);
    c.save(); ls(c, "1px"); c.font = "500 30px 'DM Mono', monospace"; c.fillStyle = INK; let ly = y + 30; for (const l of lines) { c.fillText(l, M, ly); ly += 46; } c.restore(); ls(c, "0px");
    c.font = "500 26px 'DM Mono', monospace"; c.fillStyle = mc(.6); c.fillText(F.signoff.toUpperCase(), M, ly + 22);
    footerMark(c, logo, false, W, H, M); return;
  }
  if (id === "card") {
    c.strokeStyle = "rgba(200,166,97,.6)"; c.lineWidth = 1.5; c.strokeRect(M - 18, 46, W - 2 * (M - 18), H - 92);
    const cy = Math.max(128, Math.min(168, H * .14)); crestRow(c, logo, W / 2, cy, 58, "rgba(200,166,97,.55)", true, W, false, M);
    eyebrow(c, F.kicker, W / 2, cy + 66, GOLD_LT, "center", 6);
    c.font = "italic 600 62px Fraunces, Georgia, serif"; const hl = wrapText(c, F.headline, CW - 40);
    const bodyH = paraH(c, F.body, "400 31px Inter, system-ui", CW - 140, 46), CH = hl.length * 66 + 38 + bodyH;
    const y = centerY(cy + 96, signY - 20, CH);
    c.font = "italic 600 62px Fraunces, Georgia, serif"; c.fillStyle = CREAM; c.textAlign = "center"; let hy = y + 54; for (const l of hl) { c.fillText(l, W / 2, hy); hy += 66; } c.textAlign = "left";
    c.strokeStyle = GOLD; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W / 2 - 60, hy - 2); c.lineTo(W / 2 + 60, hy - 2); c.stroke();
    paraTop(c, F.body, W / 2 - (CW - 140) / 2, hy + 22, CW - 140, "400 31px Inter, system-ui", 31, 46, cm(.72), "center");
    c.font = "italic 600 32px Fraunces, Georgia, serif"; c.fillStyle = GOLD_LT; c.textAlign = "center"; c.fillText(F.signoff, W / 2, signY); c.textAlign = "left";
    footerMark(c, logo, true, W, H, M); return;
  }
  if (id === "manifesto") {
    emblem(c, logo, M + 52, 112, 52, false, W); eyebrow(c, F.kicker, M + 96, 120, RED, "left", 5);
    const hs = fitDisp(c, F.headline, 120, CW, -2), lines = capLines(c, F.headline, hs, CW, -2), lh = Math.round(hs * 1.02);
    const bodyH = paraH(c, F.body, "400 34px Inter, system-ui", CW, 48), CH = lines.length * lh + 40 + bodyH;
    const y = centerY(150, signY - 20, CH);
    c.save(); ls(c, "-2px"); c.font = `900 ${hs}px 'Archivo Black', system-ui`; c.fillStyle = INK; let hy = y + hs * .86; for (const l of lines) { c.fillText(l, M, hy); hy += lh; } c.restore(); ls(c, "0px");
    c.fillStyle = RED; c.fillRect(M, hy - lh + hs * .9, 180, 10);
    paraTop(c, F.body, M, hy - lh + hs * .9 + 30, CW, "400 34px Inter, system-ui", 34, 48, mc(.8));
    c.font = "700 30px Inter, system-ui"; c.fillStyle = INK; c.fillText(F.signoff, M, signY);
    footerMark(c, logo, false, W, H, M); return;
  }
  if (id === "gilded") {
    c.strokeStyle = GOLD; c.lineWidth = 3; c.strokeRect(M - 26, 38, W - 2 * (M - 26), H - 76); c.strokeStyle = GOLD_LT; c.lineWidth = 1; c.strokeRect(M - 16, 48, W - 2 * (M - 16), H - 96);
    ([[M - 26, 38], [W - (M - 26), 38], [M - 26, H - 38], [W - (M - 26), H - 38]] as const).forEach(([x, y]) => { c.fillStyle = GOLD; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); });
    const cy = Math.max(120, Math.min(158, H * .13)); emblem(c, logo, W / 2, cy, 56, false, W);
    eyebrow(c, F.kicker, W / 2, cy + 82, GOLD, "center", 6);
    c.font = "italic 600 66px Fraunces, Georgia, serif"; const hl = wrapText(c, F.headline, CW - 80);
    const bodyH = paraH(c, F.body, "400 31px Inter, system-ui", CW - 160, 46), CH = hl.length * 68 + 40 + bodyH;
    const y = centerY(cy + 108, signY - 20, CH);
    c.font = "italic 600 66px Fraunces, Georgia, serif"; c.fillStyle = goldHead(c, y + 120, 66); c.textAlign = "center"; let hy = y + 58; for (const l of hl) { c.fillText(l, W / 2, hy); hy += 68; } c.textAlign = "left";
    c.strokeStyle = GOLD; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W / 2 - 90, hy); c.lineTo(W / 2 - 14, hy); c.moveTo(W / 2 + 14, hy); c.lineTo(W / 2 + 90, hy); c.stroke(); c.fillStyle = GOLD; c.beginPath(); c.arc(W / 2, hy, 5, 0, 7); c.fill();
    paraTop(c, F.body, W / 2 - (CW - 160) / 2, hy + 22, CW - 160, "400 31px Inter, system-ui", 31, 46, mc(.7), "center");
    c.font = "italic 600 32px Fraunces, Georgia, serif"; c.fillStyle = GOLD; c.textAlign = "center"; c.fillText(F.signoff, W / 2, signY); c.textAlign = "left";
    footerMark(c, logo, false, W, H, M); return;
  }
  if (id === "minimal") {
    const M2 = M + 46;
    emblem(c, logo, M2 + 40, 112, 44, false, W);
    if (F.date) eyebrow(c, F.date, W - M2, 116, mc(.45), "right", 3, 18);
    c.strokeStyle = mc(.25); c.lineWidth = 1; c.beginPath(); c.moveTo(M2, 158); c.lineTo(W - M2, 158); c.stroke();
    const hs = fitDisp(c, F.headline, 72, W - 2 * M2, -1), lines = capLines(c, F.headline, hs, W - 2 * M2, -1), lh = Math.round(hs * 1.08);
    const bodyH = paraH(c, F.body, "400 32px Inter, system-ui", W - 2 * M2 - 120, 48), CH = lines.length * lh + 34 + bodyH;
    const y = centerY(180, signY - 40, CH);
    c.save(); ls(c, "-1px"); c.font = `900 ${hs}px 'Archivo Black', system-ui`; c.fillStyle = INK; let hy = y + hs * .86; for (const l of lines) { c.fillText(l, M2, hy); hy += lh; } c.restore(); ls(c, "0px");
    paraTop(c, F.body, M2, hy - lh + hs * .9 + 24, W - 2 * M2 - 120, "400 32px Inter, system-ui", 32, 48, mc(.6));
    eyebrow(c, F.signoff, M2, signY, mc(.55), "left", 2, 20);
    c.fillStyle = mc(.2); c.fillRect(M2, H - 150, W - 2 * M2, 1); c.textAlign = "left";
    if (logo && logo.width) { const sx = LOGO.fx * logo.width, sy = LOGO.fy * logo.height, sw = LOGO.fw * logo.width, sh = LOGO.fh * logo.height; const dh = 34, dw = sw * (dh / sh); c.drawImage(logo, sx, sy, sw, sh, M2, H - 92 - dh / 2, dw, dh); }
    eyebrow(c, "Pure Signal. No Noise.", W - M2, H - 84, mc(.5), "right", 2, 20); return;
  }
  if (id === "bulletin") {
    const bh = Math.max(150, Math.min(210, H * .16));
    c.fillStyle = RED; c.fillRect(0, 0, W, bh);
    eyebrow(c, F.kicker, M, bh * .56, cm(.75), "left", 6, 26);
    emblem(c, logo, W - M - 72, bh * .5, 58, false, W, true);
    c.font = "900 44px 'Archivo Black', system-ui"; c.fillStyle = CREAM; c.fillText("GT3 · PERFORMANCE BAR", M, bh * .8);
    const hs = fitDisp(c, F.headline, 88, CW, -1), lines = capLines(c, F.headline, hs, CW, -1), lh = Math.round(hs * 1.04);
    const bodyH = paraH(c, F.body, "400 33px Inter, system-ui", CW, 48), CH = lines.length * lh + 34 + bodyH;
    const y = centerY(bh + 30, signY - 20, CH);
    c.save(); ls(c, "-1px"); c.font = `900 ${hs}px 'Archivo Black', system-ui`; c.fillStyle = INK; let hy = y + hs * .86; for (const l of lines) { c.fillText(l, M, hy); hy += lh; } c.restore(); ls(c, "0px");
    c.fillStyle = RED; c.fillRect(M, hy - lh + hs * .9, 140, 6);
    paraTop(c, F.body, M, hy - lh + hs * .9 + 26, CW, "400 33px Inter, system-ui", 33, 48, mc(.78));
    c.font = "700 30px Inter, system-ui"; c.fillStyle = INK; c.fillText(F.signoff, M, signY);
    footerMark(c, logo, false, W, H, M); return;
  }
}

export default function LetterFlyer() {
  const { toast } = useApp();
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tpl, setTpl] = useState(0);
  const [fmt, setFmt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Fields>(DEFAULTS);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const [logoReady, setLogoReady] = useState(0);

  useEffect(() => {
    const st = typeof window !== "undefined" ? Number(localStorage.getItem("gt3-letter-tpl")) : 0;
    if (st >= 0 && st < STYLES.length) setTpl(st);
    const fm = typeof window !== "undefined" ? Number(localStorage.getItem("gt3-letter-fmt")) : 0;
    if (fm >= 0 && fm < FORMATS.length) setFmt(fm);
  }, []);
  const pickTpl = (i: number) => { setTpl(i); if (typeof window !== "undefined") localStorage.setItem("gt3-letter-tpl", String(i)); };
  const pickFmt = (i: number) => { setFmt(i); if (typeof window !== "undefined") localStorage.setItem("gt3-letter-fmt", String(i)); };

  useEffect(() => {
    let alive = true;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { if (alive) { logoRef.current = img; setLogoReady((n) => n + 1); } };
    img.src = "/brand/gt3pb-handle.png";
    return () => { alive = false; };
  }, []);

  const draw = useCallback(async () => {
    const cv = canvasRef.current; if (!cv) return; const ctx = cv.getContext("2d"); if (!ctx) return;
    try { await Promise.all([document.fonts.load("900 100px 'Archivo Black'"), document.fonts.load("700 46px Inter"), document.fonts.load("500 24px 'DM Mono'"), document.fonts.load("italic 600 84px Fraunces")]); } catch { /* */ }
    const F = FORMATS[fmt];
    drawStyle(ctx, logoRef.current, STYLES[tpl]?.id ?? "letterhead", f, F.w, F.h);
  }, [f, tpl, fmt, logoReady]);

  useEffect(() => { draw(); }, [draw]);

  const toBlob = () => new Promise<Blob | null>((res) => canvasRef.current?.toBlob(res, "image/png"));
  const download = async () => {
    await draw(); const blob = await toBlob();
    if (!blob) { toast("Export failed — try again.", "error"); return; }
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `gt3-letter-${STYLES[tpl].id}-${FORMATS[fmt].id}-${(f.headline || "note").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40)}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const saveToFeed = async () => {
    if (!supabase) return; setBusy(true);
    await draw(); const blob = await toBlob();
    if (!blob) { toast("Couldn't render — try again.", "error"); setBusy(false); return; }
    const res = await uploadToBucket({ bucket: "content", file: blob, path: `flyer/letter-${new Date().getTime()}.png`, upsert: true });
    if ("error" in res) { toast(`Save failed — ${res.error}`, "error"); setBusy(false); return; }
    const mediaUrl = res.url;
    const caption = `${f.headline}${f.body ? ` — ${f.body.split("\n")[0]}` : ""}`.slice(0, 300);
    const { error } = await supabase.from("content_items").insert({ title: f.headline || "Announcement", kind: "post", caption, media: [{ url: mediaUrl, type: "image" }], media_url: mediaUrl, media_type: "image", created_by: user?.id ?? null, updated_by: user?.id ?? null });
    setBusy(false);
    toast(error ? `Save failed — ${error.message}` : "Saved to the feed — schedule it in Board/Grid");
  };

  const field = (k: keyof Fields, label: string, ph: string) => (
    <label className="rf-f"><span>{label}</span><input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} placeholder={ph} /></label>
  );

  return (
    <div className="rf">
      <div className="rf-tpl-head"><span>Letter · {STYLES[tpl].name} · {FORMATS[fmt].label}</span></div>
      <div className="rf-tpls" role="tablist" aria-label="Letter style">
        {STYLES.map((t, i) => (
          <button key={t.id} type="button" className={`rf-tpl${tpl === i ? " on" : ""}`} onClick={() => pickTpl(i)} title={t.note}>{t.name}</button>
        ))}
      </div>
      <div className="rf-tpls" role="tablist" aria-label="Format">
        {FORMATS.map((t, i) => (
          <button key={t.id} type="button" className={`rf-tpl${fmt === i ? " on" : ""}`} onClick={() => pickFmt(i)}>{t.label}</button>
        ))}
      </div>
      <div className="rf-note">10 editable letter styles × 4 social formats. Pick a style + format, write your note — the only fixed line is <b>Pure Signal. No Noise.</b> Then download or save to the feed.</div>
      {field("kicker", "Kicker (small label)", "Announcement")}
      {field("headline", "Headline", "A Note From GT3")}
      <label className="rf-f"><span>Message (one blank line = new paragraph)</span><textarea rows={5} value={f.body} onChange={(e) => setF((p) => ({ ...p, body: e.target.value }))} /></label>
      {field("signoff", "Sign-off", "— Ryan & Kayla, GT3 Performance Bar")}
      {field("date", "Date (optional)", "July 4, 2026")}
      <canvas ref={canvasRef} width={FORMATS[fmt].w} height={FORMATS[fmt].h} className="rf-canvas" />
      <div className="rf-actions">
        <button type="button" className="rf-dl ghost" onClick={download}>⬇ Download</button>
        <button type="button" className="rf-dl" onClick={saveToFeed} disabled={busy}>{busy ? "Saving…" : "✦ Save to feed"}</button>
      </div>
    </div>
  );
}
